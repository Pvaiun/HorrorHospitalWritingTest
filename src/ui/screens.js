// All non-encounter screens. Each is a page in the same testimony document.

import { el, app } from './dom.js';
import { state } from '../state.js';
import { parseProse } from './textCorrupt.js';
import { renderGlyph } from './glyphs.js';
import { sfx } from '../audio.js';
import { WOUNDS } from '../wounds.js';
import { ITEMS, STARTING_ITEMS } from '../items.js';
import { PATIENTS } from '../patients.js';
import { startNewRun, enterCurrentNode, currentNode, applyResolutionAndAdvance, applyEventEffect, advanceRun, endRun } from '../run.js';
import { EVENTS } from '../events.js';
import { SCARS } from '../scars.js';
import { VERSION } from '../version.js';

// ── helpers ─────────────────────────────────────────────────────────────
function docPage(tag) {
  const wrap = el('div', { class: 'doc-page' });
  wrap.appendChild(el('div', { class: 'doc-page-tag' }, tag));
  return wrap;
}
function actionRow(...children) {
  const row = el('div', { class: 'doc-action-row' });
  for (const c of children) if (c) row.appendChild(c);
  return row;
}
function docButton(label, onclick, variant) {
  const cls = 'doc-button' + (variant ? ' ' + variant : '');
  return el('button', { class: cls, onclick }, [
    el('span', { class: 'doc-button-marker' }, '▸ '),
    el('span', {}, label),
  ]);
}
function prose(text, dim) {
  const e = el('div', { class: dim ? 'doc-prose dim' : 'doc-prose' });
  e.innerHTML = parseProse(text);
  return e;
}
function sectionLabel(text) {
  return el('div', { class: 'sec-label-doc' }, `─ ${text} ─`);
}

// ── title ───────────────────────────────────────────────────────────────
export function renderTitle() {
  app().appendChild(el('div', { class: 'doc-version' }, `v${VERSION}`));
  const page = docPage('// admission · the door · open');
  page.appendChild(prose([
    'I do not remember the address. I have the card. I have been holding it.',
    'a building. a desk. a nurse who was expecting me.',
    'she has a file. she says it is mine. !!she has been waiting.!!',
  ].join('\n\n')));
  page.appendChild(prose('there is a corridor beyond the desk. it descends.', true));

  const save = state.save || { runs: 0, finishes: 0, archive: [] };
  const meta = el('div', { class: 'doc-archive-summary' });
  if (save.runs > 0) {
    meta.appendChild(sectionLabel('what the desk remembers'));
    meta.appendChild(el('div', { class: 'doc-prose dim' },
      `${save.runs} admission${save.runs > 1 ? 's' : ''}. ${save.finishes} discharge${save.finishes === 1 ? '' : 's'}.`));
    if (save.archive.length) {
      const list = el('div', { class: 'doc-archive-list' });
      for (const line of save.archive.slice(0, 5)) {
        list.appendChild(el('div', { class: 'doc-archive-line' }, line));
      }
      meta.appendChild(list);
    }
  }
  page.appendChild(meta);

  page.appendChild(actionRow(
    docButton('admit yourself', () => {
      sfx('select');
      state.screen = 'admission';
      // reset any old run
      state.run = null; state.enc = null;
      // we'll let the player pick a wound
      state.admission = { wound: null };
      import('./render.js').then(m => m.render());
    }),
  ));
  app().appendChild(page);
}

// ── admission (wound + starting item) ──────────────────────────────────
export function renderAdmission() {
  app().appendChild(el('div', { class: 'doc-version' }, `v${VERSION}`));
  const page = docPage('// admission · patient 0413 · day one');
  page.appendChild(prose([
    'the nurse opens the desk. she opens a file. she pushes it across to me.',
    'the first line is for me to write. she says: !!just say what is wrong.!!',
    'I read the choices already there. I do not remember which I came in for.',
  ].join('\n\n')));

  const available = (state.save?.unlocked.wounds || []).filter(id => WOUNDS[id]);
  page.appendChild(sectionLabel('what is wrong'));

  const list = el('div', { class: 'doc-card-list' });
  for (const id of available) {
    const w = WOUNDS[id];
    list.appendChild(woundCardEl(w, state.admission?.wound === id));
  }
  page.appendChild(list);

  // starting item — the nurse asks what I have in my pocket.
  page.appendChild(prose([
    'she asks: !!what do you have in your pocket?!! I empty it onto the desk.',
    '~~I do not remember packing it.~~ I do not remember putting any of this in.',
  ].join('\n\n')));
  page.appendChild(sectionLabel('what I brought'));
  const itemList = el('div', { class: 'doc-card-list' });
  for (const iid of STARTING_ITEMS) {
    const it = ITEMS[iid];
    if (!it) continue;
    itemList.appendChild(itemCardEl(it, state.admission?.startingItem === iid));
  }
  page.appendChild(itemList);

  const ready = !!state.admission?.wound && !!state.admission?.startingItem;
  const btn = docButton(ready ? 'descend' : 'choose first', () => {
    if (!ready) return;
    sfx('select');
    startNewRun(state.admission.wound, state.admission.startingItem);
    import('./render.js').then(m => m.render());
  });
  if (!ready) btn.disabled = true;

  page.appendChild(actionRow(
    docButton('〈 back', () => { state.screen = 'title'; import('./render.js').then(m => m.render()); }, 'small'),
    btn,
  ));
  app().appendChild(page);
}

function itemCardEl(it, selected) {
  const card = el('button', { class: 'doc-card wound-card item-card' + (selected ? ' selected' : '') });
  card.addEventListener('click', () => {
    state.admission = state.admission || {};
    state.admission.startingItem = it.id;
    import('./render.js').then(m => m.render());
  });
  card.appendChild(el('div', { class: 'doc-card-marker' }, selected ? '▸' : ' '));
  const body = el('div', { class: 'doc-card-body' });
  body.appendChild(el('div', { class: 'doc-card-head' }, [
    el('span', { class: 'doc-card-name' }, it.name),
  ]));
  if (it.file) {
    body.appendChild(el('div', { class: 'wound-file', html: parseProse(it.file) }));
  }
  body.appendChild(el('div', { class: 'wound-signature', html: parseProse(it.desc || '') }));
  card.appendChild(body);
  return card;
}

function woundCardEl(w, selected) {
  const card = el('button', { class: 'doc-card wound-card' + (selected ? ' selected' : '') });
  card.addEventListener('click', () => {
    state.admission = state.admission || {};
    state.admission.wound = w.id;
    import('./render.js').then(m => m.render());
  });
  card.appendChild(el('div', { class: 'doc-card-marker' }, selected ? '▸' : ' '));
  const body = el('div', { class: 'doc-card-body' });
  body.appendChild(el('div', { class: 'doc-card-head' }, [
    el('span', { class: 'doc-card-name' }, w.name),
    el('span', { class: 'doc-card-meta' }, w.one_liner ? `· ${stripMarkup(w.one_liner)}` : ''),
  ]));
  const file = el('div', { class: 'wound-file' });
  for (const line of w.file) {
    file.appendChild(el('div', { class: 'wound-file-line', html: parseProse(line) }));
  }
  body.appendChild(file);
  body.appendChild(el('div', { class: 'wound-signature' }, woundMechLine(w)));
  card.appendChild(body);
  return card;
}

function woundMechLine(w) {
  const start = w.mods?.startComposure ?? 0;
  const capBonus = w.mods?.composureMax ?? 0;
  const cap = 5 + capBonus;
  const parts = [`start · ${start} of ${cap} composure each room`];
  if (capBonus > 0) parts.push('the gauge holds more');
  if (start >= 4) parts.push('calmer at the door');
  else if (start <= 2) parts.push('thin on entry');
  return parts.join(' · ');
}

function stripMarkup(s) {
  return String(s || '')
    .replace(/~~/g, '')
    .replace(/\*\*/g, '')
    .replace(/!!/g, '')
    .replace(/\[\[\d+\]\]/g, '———');
}

// ── corridor (map) ──────────────────────────────────────────────────────
export function renderCorridor() {
  const run = state.run;
  if (!run) return;
  const n = currentNode();
  if (!n) return;
  app().appendChild(el('div', { class: 'doc-version' }, `v${VERSION}`));
  const page = docPage('// the corridor · ' + corridorTag(n));

  // a thin map showing where you are
  page.appendChild(corridorMapEl(run));

  // a small prose line per stop
  page.appendChild(prose(corridorIntro(run, n)));

  // file state
  page.appendChild(playerStatusEl(run.player));

  const isPatient = n.kind === 'patient' || n.kind === 'final';
  const label = isPatient ? (n.kind === 'final' ? 'enter the final ward' : 'enter the room')
                          : 'continue down the hall';
  page.appendChild(actionRow(
    docButton(label, () => {
      sfx('select');
      enterCurrentNode();
      import('./render.js').then(m => m.render());
    })
  ));
  app().appendChild(page);
}

function corridorTag(n) {
  if (n.kind === 'final') return 'the final ward';
  if (n.kind === 'patient') return `wing ${n.wing} · room`;
  return `wing ${n.wing} · hall`;
}

function corridorIntro(run, n) {
  if (n.kind === 'final') {
    return 'the corridor ends at a door I have not seen before. ~~it is locked from~~ it is unlocked. !!from this side.!!';
  }
  if (n.kind === 'patient') {
    const def = PATIENTS[n.id];
    return `a room. the door is ajar. the file on the desk says ${def ? def.name : '[]'}. ~~the room is~~ the room is.`;
  }
  return 'I keep walking. ~~the hall does not~~ the hall does end.';
}

function corridorMapEl(run) {
  const wrap = el('div', { class: 'corridor-map' });
  for (let i = 0; i < run.nodes.length; i++) {
    const node = run.nodes[i];
    const isCur = i === run.idx;
    const passed = i < run.idx;
    let symbol;
    if (node.kind === 'final')   symbol = isCur ? '◉' : passed ? '✓' : '◇';
    else if (node.kind === 'patient') symbol = isCur ? '◉' : passed ? '✓' : '○';
    else                          symbol = isCur ? '◉' : passed ? '·' : '·';
    const cls = 'corridor-node' + (isCur ? ' current' : '') + (passed ? ' passed' : '') + ' kind-' + node.kind;
    wrap.appendChild(el('span', { class: cls }, symbol));
    if (i < run.nodes.length - 1) wrap.appendChild(el('span', { class: 'corridor-rule' }, '─'));
  }
  return wrap;
}

function playerStatusEl(player) {
  const wrap = el('div', { class: 'corridor-status' });
  const w = WOUNDS[player.wound];
  wrap.appendChild(el('div', { class: 'corridor-status-head' }, [
    el('span', { class: 'corridor-status-name' }, 'patient 0413'),
    el('span', { class: 'corridor-status-sep' }, ' · '),
    el('span', { class: 'corridor-status-meta' }, w ? w.name : 'unmarked'),
  ]));
  wrap.appendChild(el('div', { class: 'corridor-status-body' }, [
    el('span', { class: 'corridor-status-cell' }, `composure ${player.composure}/${player.composureMax}`),
    el('span', { class: 'corridor-status-cell' }, `pocket ${(player.items || []).length}`),
    el('span', { class: 'corridor-status-cell' }, `scars ${(player.scars || []).length}`),
  ]));

  // inventory — name + file line + desc for each item.
  const items = (player.items || []).filter(i => ITEMS[i]);
  if (items.length) {
    wrap.appendChild(el('div', { class: 'corridor-trait-list-label' }, '─ in my pocket ─'));
    for (const iid of items) {
      const it = ITEMS[iid];
      const row = el('div', { class: 'corridor-trait-row item' });
      row.appendChild(el('span', { class: 'corridor-trait-name' }, it.name));
      row.appendChild(el('span', { class: 'corridor-trait-desc' }, it.desc));
      wrap.appendChild(row);
    }
  }

  // scars — visible, named, with their meaning.
  const scars = (player.scars || []).filter(s => SCARS[s]);
  if (scars.length) {
    wrap.appendChild(el('div', { class: 'corridor-trait-list-label' }, '─ what stayed ─'));
    for (const sid of scars) {
      const s = SCARS[sid];
      const row = el('div', { class: 'corridor-trait-row scar' });
      row.appendChild(el('span', { class: 'corridor-trait-name' }, s.name));
      row.appendChild(el('span', { class: 'corridor-trait-desc' }, s.desc));
      wrap.appendChild(row);
    }
  }

  return wrap;
}

// ── event (corridor vignette) ───────────────────────────────────────────
export function renderEvent() {
  const n = currentNode();
  if (!n) return;
  const eventDef = EVENTS[n.id];
  if (!eventDef) { advanceRun(); return; }
  app().appendChild(el('div', { class: 'doc-version' }, `v${VERSION}`));
  const page = docPage(eventDef.tag);

  // prose
  const proseWrap = el('div', { class: 'event-prose' });
  for (const line of eventDef.prose) {
    proseWrap.appendChild(el('div', { class: 'doc-prose', html: parseProse(line) }));
  }
  page.appendChild(proseWrap);

  // choices
  page.appendChild(sectionLabel('what I do'));
  const choices = el('div', { class: 'event-choices' });
  for (const c of eventDef.choices) {
    const btn = el('button', { class: 'event-choice' });
    btn.appendChild(el('span', { class: 'event-choice-marker' }, '▸'));
    btn.appendChild(el('span', { class: 'event-choice-label' }, c.label));
    btn.addEventListener('click', () => {
      sfx('select');
      state.eventOutcome = { id: eventDef.id, choice: c.key };
      // show the choice prose, then a continue button
      state.screen = 'event_after';
      import('./render.js').then(m => m.render());
    });
    choices.appendChild(btn);
  }
  page.appendChild(choices);
  app().appendChild(page);
}

export function renderEventAfter() {
  const n = currentNode();
  const eventDef = EVENTS[n.id];
  const out = state.eventOutcome;
  if (!eventDef || !out) { advanceRun(); return; }
  const choice = eventDef.choices.find(c => c.key === out.choice);
  app().appendChild(el('div', { class: 'doc-version' }, `v${VERSION}`));
  const page = docPage(eventDef.tag);
  // show what I chose
  page.appendChild(el('div', { class: 'doc-prose', html: parseProse(choice.prose) }));
  page.appendChild(actionRow(docButton('continue', () => {
    sfx('select');
    applyEventEffect(eventDef, out.choice);
    state.eventOutcome = null;
    import('./render.js').then(m => m.render());
  })));
  app().appendChild(page);
}

// ── resolution (after an encounter resolves) ────────────────────────────
//
// Endings are determined by the encounter itself (the patient's scales
// crossed a threshold). The resolution screen shows: which ending fired,
// what trait you keep, what scars you carry forward.
export function renderResolution() {
  const enc = state.enc;
  if (!enc) return;
  const patient = enc.patient;
  app().appendChild(el('div', { class: 'doc-version' }, `v${VERSION}`));
  const page = docPage(`// resolution · file ${patient.id}`);

  // dossier head
  const head = el('div', { class: 'resolution-head' });
  const g = el('div', { class: 'enc-glyph' });
  g.innerHTML = renderGlyph(patient.glyph);
  head.appendChild(g);
  const headText = el('div', { class: 'resolution-head-text' });
  headText.appendChild(el('div', { class: 'enc-name', html: parseProse(patient.name) }));
  headText.appendChild(el('div', { class: 'enc-sub', html: parseProse(patient.subtitle || '') }));
  head.appendChild(headText);
  page.appendChild(head);

  // ending title
  if (enc.endingTitle) {
    page.appendChild(el('div', { class: 'resolution-title' }, [
      el('span', { class: 'resolution-title-mark' }, '— '),
      el('span', { class: 'resolution-title-text', html: parseProse(enc.endingTitle) }),
      el('span', { class: 'resolution-title-mark' }, ' —'),
    ]));
  }

  // item taken with me — pressed into your hand, or picked up off the floor
  const item = enc.pendingItem ? ITEMS[enc.pendingItem] : null;
  if (item) {
    const taken = el('div', { class: 'resolution-trait-taken' });
    taken.appendChild(el('div', { class: 'enc-section-label' }, '─ what I take with me ─'));
    taken.appendChild(el('div', { class: 'resolution-trait-name' }, item.name));
    if (item.file) {
      taken.appendChild(el('div', { class: 'resolution-trait-voice', html: parseProse(item.file) }));
    }
    taken.appendChild(el('div', { class: 'resolution-trait-desc' }, item.desc));
    page.appendChild(taken);
  } else {
    page.appendChild(el('div', { class: 'doc-prose dim' },
      'nothing in my pocket this time. ~~the room~~ the room did not give me anything.'));
  }

  // scars carried forward
  const scars = (enc.pendingScars || []).filter(s => SCARS[s]);
  if (scars.length) {
    const scarWrap = el('div', { class: 'resolution-scars' });
    scarWrap.appendChild(el('div', { class: 'enc-section-label' }, '─ what stayed ─'));
    for (const sid of scars) {
      const s = SCARS[sid];
      const row = el('div', { class: 'resolution-scar-row' });
      row.appendChild(el('span', { class: 'resolution-scar-name' }, s.name));
      row.appendChild(el('span', { class: 'resolution-scar-desc' }, s.desc));
      scarWrap.appendChild(row);
    }
    page.appendChild(scarWrap);
  }

  const isFinal = patient.def.role === 'final';
  page.appendChild(actionRow(docButton(isFinal ? 'leave' : 'walk on', () => {
    sfx('select');
    applyResolutionAndAdvance();
    import('./render.js').then(m => m.render());
  })));
  app().appendChild(page);
}

// ── archive (run end) ───────────────────────────────────────────────────
export function renderArchive() {
  const summary = state.lastRunSummary;
  app().appendChild(el('div', { class: 'doc-version' }, `v${VERSION}`));
  const tag = summary?.payload.outcome === 'finished' ? 'discharged' :
              summary?.payload.outcome === 'lost'     ? 'expired'     : 'closed';
  const page = docPage(`// archive · patient 0413 · ${tag}`);

  if (summary?.payload.outcome === 'finished') {
    page.appendChild(prose([
      'the door is open. the corridor behind me is closed.',
      'I do not look back. ~~someone is signing me out~~. someone is signing me out.',
      '!!the hand is not the one I came in with.!!',
    ].join('\n\n')));
  } else {
    page.appendChild(prose([
      'the page ~~ends~~ stops here.',
      'another file has been opened. !!0413 was already taken.!!',
    ].join('\n\n')));
  }

  // run summary
  if (summary) {
    const w = WOUNDS[summary.wound];
    page.appendChild(sectionLabel('what was kept'));
    page.appendChild(el('div', { class: 'doc-prose dim' }, `admitted · ${w ? w.name : summary.wound}`));
    if (summary.resolutions.length) {
      const list = el('div', { class: 'archive-resolutions' });
      for (const r of summary.resolutions) {
        const it = r.item ? ITEMS[r.item] : null;
        const p = PATIENTS[r.patient];
        const card = el('div', { class: 'archive-res-card' });
        card.appendChild(el('div', { class: 'archive-res-header' }, [
          el('span', { class: 'archive-res-patient' }, p ? p.name : `[${r.patient}]`),
          el('span', { class: 'archive-res-sep' }, ' — '),
          el('span', { class: 'archive-res-key' }, r.endingTitle || r.endingId || 'unresolved'),
        ]));
        // ending prose recap, if recorded
        if (Array.isArray(r.endingLines) && r.endingLines.length) {
          const prose = el('div', { class: 'archive-res-prose' });
          for (const line of r.endingLines) {
            prose.appendChild(el('div', { class: 'archive-res-line-prose', html: parseProse(line) }));
          }
          card.appendChild(prose);
        }
        // item + scars taken
        const footer = el('div', { class: 'archive-res-footer' });
        footer.appendChild(el('span', { class: 'archive-res-trait-label' }, 'took · '));
        footer.appendChild(el('span', { class: 'archive-res-trait' }, it ? it.name : 'nothing'));
        if (r.scars && r.scars.length) {
          footer.appendChild(el('span', { class: 'archive-res-sep' }, ' · '));
          footer.appendChild(el('span', { class: 'archive-res-trait-label' }, 'scars · '));
          footer.appendChild(el('span', { class: 'archive-res-scars' },
            r.scars.map(s => (SCARS[s] ? SCARS[s].name : s)).join(', ')));
        }
        card.appendChild(footer);
        list.appendChild(card);
      }
      page.appendChild(list);
    }
  }

  // unlock notifications
  const save = state.save;
  if (save) {
    page.appendChild(sectionLabel('the desk remembers'));
    page.appendChild(el('div', { class: 'doc-prose dim' },
      `${save.runs} admission${save.runs > 1 ? 's' : ''} on file. ${save.finishes} discharged.`));
    const next = nextUnlockHint(save);
    if (next) page.appendChild(el('div', { class: 'doc-prose dim', html: parseProse(next) }));
  }

  page.appendChild(actionRow(docButton('begin another admission', () => {
    sfx('select');
    state.screen = 'title';
    import('./render.js').then(m => m.render());
  })));
  app().appendChild(page);
}

function nextUnlockHint(save) {
  if (save.runs < 1) return 'one more file may open at the door.';
  if (save.runs < 2) return 'another patient is still on file.';
  if (save.runs < 3) return 'the desk still has pages I have not read.';
  if (save.runs < 5) return 'the desk has the rest.';
  return null;
}
