// The encounter. Not a fight in the JRPG sense — a conversation with
// someone whose mind is its own weather.
//
// Each patient defines its own SCALES (hidden axes like "tenderness",
// "grip", "lucidity"), its own VERBS (the things you can do — patient-
// specific, with branched authored responses), its own DRIFT (what
// happens on a WAIT turn — the patient acts on its own), and its own
// ENDINGS (the first matching ending fires; that's the resolution).
//
// The engine here is small. It dispatches to the patient's hand-authored
// functions, applies their returned effects to encounter state, drains
// the log between every entry (click-to-advance), and checks endings.
// All the texture lives in src/patients.js.

import { state, pushLog, clearLog, COMPOSURE_MAX } from './state.js';
import { sleep, randi } from './rng.js';
import { sfx } from './audio.js';
import { render } from './ui/render.js';
import { WOUNDS } from './wounds.js';
import { applyScar, scarsCap, scarsStartDelta, scarsDriftBite } from './scars.js';
import { ITEMS, addItem, removeItem } from './items.js';
import { shakeStage, spawnCallout } from './ui/animations.js';

// ─── player setup ───────────────────────────────────────────────────────

export function makePlayer(wound, startingItemId) {
  const w = WOUNDS[wound];
  const player = {
    name: 'Patient 0413',
    wound,
    items: [],
    scars: [],
    composureMax: COMPOSURE_MAX,
    composure: 0,
  };
  // the admission card is always in your pocket. add it as the first item.
  if (ITEMS['the_card']) addItem(player, 'the_card');
  // and whatever the player picked at admission.
  if (startingItemId && ITEMS[startingItemId]) addItem(player, startingItemId);
  recomputePlayerStats(player);
  const initComposure = (w?.mods.startComposure || 0);
  player.composure = Math.min(player.composureMax, Math.max(0, initComposure));
  return player;
}

export function recomputePlayerStats(player) {
  // composureMax: base + wound mod, then capped by any scar that caps it
  // (Witnessed and Collapsed both cap at 4).
  const w = WOUNDS[player.wound];
  player.composureMax = COMPOSURE_MAX + (w?.mods.composureMax || 0);
  player.composureMax = Math.min(player.composureMax, scarsCap(player));
  if (player.composure > player.composureMax) player.composure = player.composureMax;
}

// ─── encounter setup ────────────────────────────────────────────────────

export function beginEncounter(patientDef, player) {
  // Build the live patient instance. patient.scales is the per-encounter
  // hidden state; the patient definition's initialize() (if present) sets
  // the starting values (often with small RNG variance).
  const patient = {
    id: patientDef.id,
    name: patientDef.name,
    glyph: patientDef.glyph,
    subtitle: patientDef.subtitle,
    file: [...(patientDef.file || [])],
    def: patientDef,
    scales: {},
    effects: {},
    playerEffects: {},
    flags: {},
    turn: 0,
  };
  for (const [k, def] of Object.entries(patientDef.scales || {})) {
    patient.scales[k] = clamp(def.initial ?? 0, def.min ?? 0, def.max ?? 5);
  }
  if (typeof patientDef.initialize === 'function') {
    try { patientDef.initialize(patient, player); } catch (e) { console.error('initialize error', e); }
  }

  // Composure carries across encounters — events and resolutions add to it.
  // The wound's startComposure is a per-fight BASELINE: composure can carry
  // above it from events, but is raised TO it at fight start if depleted.
  // Scars apply a startComposureDelta (Abandoned/Failed/Wearing: -1 each).
  // An absolute floor of 1 keeps the player able to act.
  recomputePlayerStats(player);
  const w = WOUNDS[player.wound];
  const ABS_FLOOR = 1;
  let baseline = (w?.mods.startComposure || 0) + scarsStartDelta(player);
  baseline = Math.max(ABS_FLOOR, Math.min(player.composureMax, baseline));
  player.composure = Math.max(baseline, player.composure);
  player.composure = Math.min(player.composureMax, player.composure);

  state.enc = {
    patient,
    player,
    awaitingPlayer: false,
    awaitingResolution: false,
    over: false,
    outcome: null,
    endingId: null,
    pendingItem: null,
    pendingScars: [],
    _revealedFile: [],     // indices of file lines uncovered through play
    _knownBands: {},       // scale-key → last seen band index (for cross detection)
    _totalScaleMovement: 0, // running sum of |actual scale deltas| — drives file reveals
  };
  // seed _knownBands so the first turn's cross-messages are meaningful
  for (const k of Object.keys(patient.scales)) {
    state.enc._knownBands[k] = bandIndex(patient, k);
  }
  clearLog();
  state.screen = 'encounter';

  runEncounterIntro();
}

async function runEncounterIntro() {
  const enc = state.enc;
  state.acting = true;
  render();
  await sleep(180);
  const intro = enc.patient.def.intro;
  const lines = Array.isArray(intro) ? intro : [intro || 'a door.'];
  for (const l of lines) {
    pushLog({ text: l, cls: 'intro' });
    await drainLog();
  }
  // a patient may interject immediately if their opening condition matches.
  await maybeFireInterjection();
  state.acting = false;
  enc.awaitingPlayer = true;
  render();
}

// ─── verb / interjection dispatch ──────────────────────────────────────
//
// Verbs are no longer gated by composure cost. Composure is your run-long
// health track; you lose it as a CONSEQUENCE of risky verbs or patient
// reactions, never as a precondition to act.
//
// Verbs can declare a `when(patient, player)` predicate; the UI hides
// verbs whose predicate returns false. So the available action set shifts
// as the patient changes state — different scales surface different
// possibilities.
//
// Interjections are patient-initiated turns. Each patient may declare a
// list of interjections (`{ id, when, once?, prose: [...], responses: [...] }`).
// When the player would normally act, we check interjections first; if
// one fires, its responses replace the verb menu for that turn.
//
// `patient.flags.lastVerb` and `patient.flags.streak` are tracked by the
// engine so authored responses can branch when the player repeats a verb.

export async function playerVerb(verbId) {
  const enc = state.enc;
  if (!enc || !enc.awaitingPlayer || state.acting) return;
  state.acting = true;
  enc.awaitingPlayer = false;
  if (enc.activeInterjection) {
    await runInterjectionResponse(parseInt(verbId, 10));
  } else {
    await runPlayerVerb(verbId);
  }
}

async function runPlayerVerb(verbId) {
  const enc = state.enc;
  const p = enc.player;
  const pat = enc.patient;

  // streak tracking — authored responses can read pat.flags.lastVerb and
  // pat.flags.streak to make repeated verbs land differently.
  if (pat.flags.lastVerb === verbId) {
    pat.flags.streak = (pat.flags.streak || 1) + 1;
  } else {
    pat.flags.streak = 1;
  }
  pat.flags.lastVerb = verbId;

  if (verbId === 'wait') {
    // patient may define a bespoke wait.respond; otherwise fall back to drift.
    const resp = (typeof pat.def.wait?.respond === 'function')
      ? pat.def.wait.respond(pat, p)
      : callDrift(pat, p);
    await applyResponse(resp);
  } else if (verbId === 'leave') {
    pat.flags.left = true;
    const resp = (typeof pat.def.leave?.respond === 'function')
      ? pat.def.leave.respond(pat, p)
      : (typeof pat.def.onLeave === 'function')
        ? pat.def.onLeave(pat, p)
        : { lines: ['I walk out. I leave the door open behind me.', 'I am farther from her than I came.'], composure: -2, composureCost: '~~I closed the door.~~ I closed the door.', scars: ['abandoned'] };
    await applyResponse(resp);
  } else if (typeof verbId === 'string' && verbId.startsWith('item:')) {
    const itemId = verbId.slice(5);
    await runPlayerItem(itemId);
  } else {
    const verb = (pat.def.verbs || {})[verbId];
    if (!verb) {
      pushLog({ text: 'I cannot do that here.', cls: 'flavor' });
      await drainLog();
      state.acting = false; enc.awaitingPlayer = true; render(); return;
    }
    const resp = (typeof verb.respond === 'function')
      ? verb.respond(pat, p)
      : { lines: ['nothing happens.'] };
    await applyResponse(resp);
  }

  if (state.shownLogIdx < state.log.length - 1) await drainLog();

  pat.turn++;
  await postTurn();
}

async function runPlayerItem(itemId) {
  const enc = state.enc;
  const p = enc.player;
  const pat = enc.patient;
  const item = ITEMS[itemId];
  if (!item || !(p.items || []).includes(itemId)) {
    pushLog({ text: 'I reach. it is not in my pocket anymore.', cls: 'flavor' });
    await drainLog();
    return;
  }
  removeItem(p, itemId);
  pushLog({ text: item.voice || `(${item.name})`, cls: 'sig' });
  await drainLog();
  const resp = (typeof item.respond === 'function')
    ? item.respond(pat, p)
    : { lines: ['nothing happens.'] };
  await applyResponse(resp);
}

async function runInterjectionResponse(idx) {
  const enc = state.enc;
  const pat = enc.patient;
  const intr = enc.activeInterjection;
  const resp = intr.responses[idx];
  enc.activeInterjection = null;
  pat.flags.lastVerb = `interjection:${intr.id}`;
  pat.flags.streak = 1;
  if (resp) await applyResponse(resp);
  if (state.shownLogIdx < state.log.length - 1) await drainLog();
  pat.turn++;
  await postTurn();
}

// Common end-of-turn handler: check endings, then composure, then maybe
// fire an interjection before handing back to the player.
async function postTurn() {
  const enc = state.enc;
  const p = enc.player;
  const pat = enc.patient;
  const ending = checkEndings(pat, p);
  if (ending) { await fireEnding(ending); return; }
  if (p.composure <= 0) { await fireCollapse(); return; }
  // Look for an interjection to fire before the next player turn.
  await maybeFireInterjection();
  state.acting = false;
  enc.awaitingPlayer = true;
  render();
}

async function maybeFireInterjection() {
  const enc = state.enc;
  const pat = enc.patient;
  const player = enc.player;
  for (const intr of pat.def.interjections || []) {
    if (intr.once && pat.flags['_fired_' + intr.id]) continue;
    let matches = false;
    try { matches = !!intr.when(pat, player); } catch (e) { console.error('interjection when', intr.id, e); }
    if (!matches) continue;
    enc.activeInterjection = intr;
    pat.flags['_fired_' + intr.id] = true;
    const proseLines = Array.isArray(intr.prose) ? intr.prose : (intr.prose ? [intr.prose] : []);
    for (const l of proseLines) {
      pushLog({ text: l, cls: 'interjection' });
      await drainLog();
    }
    return true;
  }
  return false;
}

function callDrift(pat, player) {
  let resp;
  if (typeof pat.def.drift === 'function') {
    try { resp = pat.def.drift(pat, player); }
    catch (e) { console.error('drift error', e); resp = null; }
  }
  resp = resp || { lines: ['nothing happens, for a while.'] };
  // scars can make drift bite harder.
  const bite = scarsDriftBite(player);
  if (bite > 0 && typeof resp.composure === 'number' && resp.composure < 0) {
    resp = { ...resp, composure: resp.composure - bite,
             composureCost: resp.composureCost || 'the room is heavier than it should be. ~~something in me~~ something has been wearing.' };
  }
  return resp;
}

// A response is the contract between patient definitions and the engine.
// All shapes:
//   { lines: string[]|string, scales: {key:delta}, composure: int,
//     scars: string[], effects: {key:delta}, playerEffects: {key:delta},
//     flags: {key:bool}, callout?: string, shake?: bool }
async function applyResponse(resp) {
  if (!resp) return;
  const enc = state.enc;
  const pat = enc.patient;
  const p = enc.player;
  const lines = Array.isArray(resp.lines) ? resp.lines : (resp.lines ? [resp.lines] : []);

  // capture band indices BEFORE shifting so we can detect crossings.
  const beforeBands = {};
  if (resp.scales) {
    for (const k of Object.keys(resp.scales)) beforeBands[k] = bandIndex(pat, k);
  }

  if (resp.scales) {
    for (const [k, dv] of Object.entries(resp.scales)) {
      const actual = shiftScale(pat, k, dv);
      enc._totalScaleMovement = (enc._totalScaleMovement || 0) + Math.abs(actual);
    }
  }
  if (resp.effects) {
    for (const [k, dv] of Object.entries(resp.effects)) {
      pat.effects[k] = Math.max(0, (pat.effects[k] || 0) + dv);
    }
  }
  if (resp.playerEffects) {
    for (const [k, dv] of Object.entries(resp.playerEffects)) {
      pat.playerEffects[k] = Math.max(0, (pat.playerEffects[k] || 0) + dv);
    }
  }
  if (resp.flags) {
    for (const [k, v] of Object.entries(resp.flags)) pat.flags[k] = v;
  }
  if (typeof resp.composure === 'number') {
    const before = p.composure;
    p.composure = clamp(p.composure + resp.composure, 0, p.composureMax);
    const delta = p.composure - before;
    // queue a styled cost line if the player took composure damage and the
    // response authored a reason. fired AFTER the prose so the cost lands
    // as punctuation, not preamble.
    if (delta < 0 && resp.composureCost) {
      enc._pendingCostLine = { text: resp.composureCost, amount: delta };
    } else if (delta < 0 && !resp.composureCost) {
      // fallback so every loss has at least a quiet acknowledgment
      enc._pendingCostLine = { text: 'it costs me something I cannot put down.', amount: delta };
    }
  }
  if (Array.isArray(resp.scars)) {
    for (const sid of resp.scars) {
      if (!p.scars.includes(sid)) p.scars.push(sid);
    }
    recomputePlayerStats(p);
  }
  if (resp.callout) spawnCallout(resp.callout);
  if (resp.shake) shakeStage();

  for (const l of lines) {
    pushLog({ text: l, cls: 'narr' });
    await drainLog();
  }

  // emit composure-cost line AFTER prose. styled red, with the amount.
  if (enc._pendingCostLine) {
    const c = enc._pendingCostLine;
    pushLog({ text: c.text, cls: 'cost', damage: -c.amount });
    enc._pendingCostLine = null;
    await drainLog();
  }

  // emit threshold-cross messages AFTER authored prose. these stand in for
  // the old "(scale rises. scale falls.)" tail; they fire only when a scale
  // crosses into a new band (calm → on edge), not on every tick.
  for (const k of Object.keys(beforeBands)) {
    const before = beforeBands[k];
    const after = bandIndex(pat, k);
    if (after === before) continue;
    const def = pat.def.scales?.[k];
    const direction = after > before ? 'up' : 'down';
    const msgs = direction === 'up' ? (def?.crossUp || {}) : (def?.crossDown || {});
    // emit the line for the destination band (highest band reached in this delta).
    const msg = msgs[after];
    if (msg) {
      pushLog({ text: msg, cls: 'cross' });
      await drainLog();
    }
    enc._knownBands[k] = after;
  }

  // file reveal pass — uncover any file lines whose `when` is now true.
  await checkFileReveals(pat);

  // ink-bottle item sets _revealAllFile; reveal anything still hidden.
  if (pat.flags._revealAllFile) {
    pat.flags._revealAllFile = false;
    enc._revealedFile = enc._revealedFile || [];
    const total = (pat.def.file || []).length;
    for (let i = 0; i < total; i++) {
      if (!enc._revealedFile.includes(i)) enc._revealedFile.push(i);
    }
  }
}

// Find the band index whose `at` is the highest <= the scale's current value.
function bandIndex(pat, key) {
  const def = pat.def.scales?.[key];
  if (!def || !Array.isArray(def.bands) || !def.bands.length) return 0;
  const v = pat.scales[key] ?? 0;
  let idx = 0;
  for (let i = 0; i < def.bands.length; i++) {
    if ((def.bands[i].at ?? 0) <= v) idx = i;
    else break;
  }
  return idx;
}

export function bandFor(pat, key) {
  const def = pat.def.scales?.[key];
  if (!def || !Array.isArray(def.bands) || !def.bands.length) return null;
  return def.bands[bandIndex(pat, key)] || null;
}

// File reveals are paced by cumulative scale movement (`enc._totalScaleMovement`)
// rather than turns or fixed scale thresholds — so investigative *engagement*
// uncovers the file, not the calendar. Reveals fire strictly in order and at
// most one per response, so each line gets its own narrative beat.
const DEFAULT_REVEAL_THRESHOLDS = [7, 20, 35];

async function checkFileReveals(pat) {
  const enc = state.enc;
  if (!Array.isArray(pat.def.fileReveals)) return;
  enc._revealedFile = enc._revealedFile || [];
  const nextIdx = enc._revealedFile.length;
  if (nextIdx >= pat.def.fileReveals.length) return;
  const fr = pat.def.fileReveals[nextIdx];
  const threshold = (typeof fr.at === 'number') ? fr.at
                  : (DEFAULT_REVEAL_THRESHOLDS[nextIdx] ?? 99);
  if ((enc._totalScaleMovement || 0) < threshold) return;
  enc._revealedFile.push(nextIdx);
  const announce = fr.announce || 'a line of the file fills itself in. ~~in my hand.~~';
  pushLog({ text: announce, cls: 'reveal' });
  await drainLog();
}

function shiftScale(pat, key, delta) {
  if (delta === 0) return 0;
  const def = pat.def.scales?.[key];
  const min = def?.min ?? 0;
  const max = def?.max ?? 5;
  const before = pat.scales[key] || 0;
  pat.scales[key] = clamp(before + delta, min, max);
  return pat.scales[key] - before;
}

// ─── endings ────────────────────────────────────────────────────────────

function checkEndings(pat, player) {
  for (const e of pat.def.endings || []) {
    try {
      if (e.when(pat, player)) return e;
    } catch (err) { console.error('ending check error', err); }
  }
  return null;
}

async function fireEnding(ending) {
  const enc = state.enc;
  // lines / scars / trait may be authored as functions of (patient, player)
  // for endings whose prose depends on how you got there.
  const rawLines = (typeof ending.lines === 'function')
    ? ending.lines(enc.patient, enc.player)
    : ending.lines;
  const lines = Array.isArray(rawLines) ? rawLines : (rawLines ? [rawLines] : []);
  for (const l of lines) {
    pushLog({ text: l, cls: 'ending' });
    await drainLog();
  }
  const rawScars = (typeof ending.scars === 'function')
    ? ending.scars(enc.patient, enc.player)
    : ending.scars;
  const scars = Array.isArray(rawScars) ? rawScars : (rawScars ? [rawScars] : []);
  const item = (typeof ending.item === 'function')
    ? ending.item(enc.patient, enc.player)
    : (ending.item || null);

  enc.over = true;
  enc.outcome = 'resolved';
  enc.endingId = ending.id;
  enc.endingTitle = ending.title;
  enc.endingLines = lines;
  enc.pendingItem = item;
  enc.pendingScars = scars;
  enc.awaitingResolution = true;
  state.acting = false;
  state.screen = 'resolution';
  sfx('victory');
  render();
}

async function fireCollapse() {
  const enc = state.enc;
  pushLog({ text: 'I have no more of myself to spend. the room runs me out.', cls: 'fatal' });
  await drainLog();
  enc.over = true;
  enc.outcome = 'collapsed';
  enc.endingId = 'collapsed';
  enc.pendingItem = null;
  enc.pendingScars = ['collapsed'];
  state.acting = false;
  sfx('faint');
  render();
}

// ─── log draining (click-to-advance) ────────────────────────────────────

async function drainLog() {
  while (state.shownLogIdx < state.log.length - 1) {
    const idx = state.shownLogIdx + 1;
    state.shownLogIdx = idx;
    state.typingIdx = idx;
    state.logAwaitingClick = false;
    render();

    const entry = state.log[idx];
    const txtLen = (entry.text || '').length;
    const typeMs = Math.min(txtLen * 14, 1200);

    await Promise.race([
      sleep(typeMs),
      new Promise(r => { state._typeSkipResolve = r; }),
    ]);
    state._typeSkipResolve = null;
    state.typingIdx = -1;
    state.logAwaitingClick = true;
    render();

    await new Promise(resolve => { state._logClickResolve = resolve; });
    state._logClickResolve = null;
    state.logAwaitingClick = false;
  }
  render();
}

export function advanceLog() {
  if (state._typeSkipResolve) {
    const r = state._typeSkipResolve;
    state._typeSkipResolve = null;
    r();
    return;
  }
  if (state._logClickResolve) {
    const r = state._logClickResolve;
    state._logClickResolve = null;
    r();
  }
}

// ─── resolution ─────────────────────────────────────────────────────────

export function acknowledgeResolution() {
  const enc = state.enc;
  if (!enc) return;
  if (enc.pendingItem && ITEMS[enc.pendingItem]) {
    addItem(enc.player, enc.pendingItem);
  }
  for (const sid of enc.pendingScars) {
    applyScar(enc.player, sid);
  }
  recomputePlayerStats(enc.player);
}

// ─── public introspection ───────────────────────────────────────────────

export function isPlayerTurn() {
  return !!(state.enc && state.enc.awaitingPlayer && !state.acting);
}

// Legacy: verbs no longer have an upfront composure cost. Composure
// changes happen inside the verb's response (composure: -N), as a
// consequence of context, not a precondition. Kept exported for any
// remaining callers; always returns 0 now.
export function effectiveVerbCost(_player, _verb) { return 0; }

// ─── helpers ────────────────────────────────────────────────────────────

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
