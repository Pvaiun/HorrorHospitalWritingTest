// The encounter screen. No HP bars, no pose queue. The patient's column
// shows: name, glyph, file, a composed "presented state" sentence (derived
// from her hidden scales), and the set of scales by NAME (revealed values
// hidden unless the player has a trait like unblinking/witness).
//
// The action menu is patient-specific: each patient defines its own verbs.
// WAIT and LEAVE are universal. The wound-given SIGNATURE sits below the
// rest.

import { el, app } from './dom.js';
import { state, COMPOSURE_MAX } from '../state.js';
import { isPlayerTurn, playerVerb, advanceLog, bandFor } from '../combat.js';
import { renderGlyph } from './glyphs.js';
import { parseProse } from './textCorrupt.js';
import { WOUNDS } from '../wounds.js';
import { SCARS } from '../scars.js';
import { ITEMS } from '../items.js';

export function renderEncounter() {
  const enc = state.enc;
  if (!enc) return;
  const screen = el('div', { class: 'enc-screen' });
  screen.appendChild(encStripEl());
  screen.appendChild(dossierGridEl(enc));
  screen.appendChild(narrativeOrActionsEl(enc));
  app().appendChild(screen);
}

function encStripEl() {
  const enc = state.enc;
  const wing = Math.min(state.run ? Math.ceil((state.run.idx + 1) / 2) : 1, 5);
  const left = el('div', { class: 'enc-strip-left' }, [
    el('span', {}, '// engagement'),
    el('span', { class: 'enc-sep' }, ' · '),
    el('span', {}, enc.patient.def.role === 'final' ? 'the final ward' : `wing ${wing}`),
    el('span', { class: 'enc-sep' }, ' · '),
    el('span', {}, `file ${enc.patient.id}`),
    el('span', { class: 'enc-sep' }, ' · '),
    el('span', {}, `turn ${enc.patient.turn + 1}`),
  ]);
  const right = el('div', { class: 'enc-strip-right' }, [
    el('span', { class: 'doc-blot' }, '●'),
    ' they are here',
  ]);
  return el('div', { class: 'enc-strip' }, [left, right]);
}

function dossierGridEl(enc) {
  const grid = el('div', { class: 'enc-grid' });
  grid.appendChild(patientColEl(enc.patient));
  grid.appendChild(el('div', { class: 'enc-divider' }));
  grid.appendChild(playerColEl(enc.player));
  return grid;
}

function patientColEl(patient) {
  const col = el('div', { class: 'enc-col enc-col-patient' });
  // glyph + name + subtitle
  const head = el('div', { class: 'enc-head' });
  const g = el('div', { class: 'enc-glyph' });
  g.innerHTML = renderGlyph(patient.glyph);
  head.appendChild(g);
  const headText = el('div', { class: 'enc-head-text' });
  headText.appendChild(el('div', { class: 'enc-name', html: parseProse(patient.name) }));
  headText.appendChild(el('div', { class: 'enc-sub', html: parseProse(patient.subtitle || '') }));
  head.appendChild(headText);
  col.appendChild(head);

  // file (small, 3 lines). lines are redacted until the player has earned
  // them — uncovered as the patient's state crosses certain thresholds.
  const file = el('div', { class: 'enc-file' });
  const encRef = state.enc;
  const revealed = encRef._revealedFile || [];
  const lines = patient.file || [];
  for (let i = 0; i < lines.length; i++) {
    if (revealed.includes(i)) {
      file.appendChild(el('div', { class: 'enc-file-line', html: parseProse(lines[i]) }));
    } else {
      const placeholder = el('div', { class: 'enc-file-line enc-file-line-redacted' });
      placeholder.appendChild(el('span', { class: 'redact', style: 'width:36ch;' }, ' '));
      file.appendChild(placeholder);
    }
  }
  col.appendChild(file);

  // presented state — the heart of the read. Composed from scales by the
  // patient's own presented(patient) function.
  const presented = (typeof patient.def.presented === 'function')
    ? patient.def.presented(patient)
    : '';
  if (presented) {
    col.appendChild(el('div', { class: 'enc-section-label' }, '─ she presents as ─'));
    col.appendChild(el('div', { class: 'enc-presented', html: parseProse(presented) }));
  }

  // scale names (always shown). Values are hidden unless revealed.
  col.appendChild(scaleListEl(patient));

  // effects on the patient herself (named, not numeric, e.g. nothing yet)
  // — left out by default; patients can flag specific effects via prose.

  return col;
}

function playerColEl(player) {
  const col = el('div', { class: 'enc-col enc-col-player' });
  const w = player.wound ? WOUNDS[player.wound] : null;
  const head = el('div', { class: 'enc-head' });
  const g = el('div', { class: 'enc-glyph' });
  g.innerHTML = renderGlyph('Lumenpup');
  head.appendChild(g);
  const headText = el('div', { class: 'enc-head-text' });
  headText.appendChild(el('div', { class: 'enc-name' }, 'Patient 0413'));
  headText.appendChild(el('div', { class: 'enc-sub', html: parseProse(w ? w.one_liner : '') }));
  head.appendChild(headText);
  col.appendChild(head);

  // composure pips
  col.appendChild(composureRowEl(player));

  // patient-applied effects on the player (e.g. drowsing from Soothlick)
  col.appendChild(playerEffectsRowEl());

  // scars (run-long debuffs)
  col.appendChild(scarRowEl(player));

  // inventory (one-use items)
  col.appendChild(itemListEl(player));

  return col;
}

function scaleListEl(patient) {
  const wrap = el('div', { class: 'enc-scales' });
  wrap.appendChild(el('div', { class: 'enc-section-label' }, '─ what shifts ─'));
  const entries = Object.entries(patient.def.scales || {});
  if (!entries.length) {
    wrap.appendChild(el('div', { class: 'enc-scale-empty' }, '— nothing the file tracks —'));
    return wrap;
  }
  const list = el('div', { class: 'enc-scale-list' });
  for (const [key, def] of entries) {
    const row = el('div', { class: 'enc-scale-row' });
    row.appendChild(el('span', { class: 'enc-scale-name' }, (def.label || key) + ' ·'));
    const band = bandFor(patient, key);
    const word = band?.word ?? '—';
    const tone = bandTone(def, band);
    row.appendChild(el('span', { class: 'enc-scale-word ' + tone }, word));
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}

// Resolve a band's tone — explicit if authored, else inferred from the
// band's position in the bands array combined with the scale's kind. The
// first/last bands of a scale anchor the tone; middle bands stay neutral.
function bandTone(scaleDef, band) {
  if (!band) return 'neutral';
  if (band.tone) return band.tone;
  const bands = scaleDef.bands || [];
  if (bands.length <= 1) return 'neutral';
  const idx = bands.indexOf(band);
  const kind = scaleDef.kind || '';
  const lowFrac = idx / (bands.length - 1);
  if (kind === 'positive') {
    if (lowFrac >= 0.75) return 'good';
    if (lowFrac <= 0.25) return 'bad';
    return 'neutral';
  }
  if (kind === 'negative') {
    if (lowFrac >= 0.75) return 'bad';
    if (lowFrac <= 0.25) return 'good';
    return 'neutral';
  }
  return 'neutral';
}

function composureRowEl(player) {
  const row = el('div', { class: 'enc-stat-row' });
  row.appendChild(el('span', { class: 'enc-stat-label' }, 'composure'));
  const pips = el('span', { class: 'enc-pips' });
  const max = player.composureMax || COMPOSURE_MAX;
  for (let i = 0; i < max; i++) {
    pips.appendChild(el('span', { class: 'enc-pip' + (i < player.composure ? ' lit' : '') }, i < player.composure ? '●' : '○'));
  }
  row.appendChild(pips);
  row.appendChild(el('span', { class: 'enc-stat-num' }, `${player.composure}/${max}`));
  return row;
}

function playerEffectsRowEl() {
  const enc = state.enc;
  const eff = enc.patient.playerEffects || {};
  const items = Object.entries(eff).filter(([_, v]) => v > 0);
  const wrap = el('div', { class: 'enc-stat-row' });
  wrap.appendChild(el('span', { class: 'enc-stat-label' }, 'on me'));
  if (!items.length) {
    wrap.appendChild(el('span', { class: 'enc-status-empty' }, '— '));
    return wrap;
  }
  const list = el('span', { class: 'enc-status-list' });
  items.forEach(([k, v], i) => {
    if (i > 0) list.appendChild(el('span', { class: 'enc-cond-sep' }, ' · '));
    list.appendChild(el('span', { class: 'enc-status' }, [
      el('span', { class: 'doc-blot' }, '●'),
      ' ',
      k,
      ' ',
      el('span', { class: 'enc-status-num' }, `×${v}`),
    ]));
  });
  wrap.appendChild(list);
  return wrap;
}

function itemListEl(player) {
  const wrap = el('div', { class: 'enc-trait-block' });
  wrap.appendChild(el('div', { class: 'enc-stat-label' }, 'in my pocket'));
  const items = (player.items || []).filter(i => ITEMS[i]);
  if (!items.length) {
    wrap.appendChild(el('div', { class: 'enc-status-empty' }, '— empty —'));
    return wrap;
  }
  const list = el('div', { class: 'enc-trait-stack' });
  for (const iid of items) {
    const it = ITEMS[iid];
    const row = el('div', { class: 'enc-trait-card item' });
    row.appendChild(el('div', { class: 'enc-trait-card-name' }, it.name));
    if (it.file) {
      row.appendChild(el('div', { class: 'enc-trait-card-file', html: parseProse(it.file) }));
    }
    row.appendChild(el('div', { class: 'enc-trait-card-desc' }, it.desc));
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}

function scarRowEl(player) {
  const wrap = el('div', { class: 'enc-trait-block' });
  wrap.appendChild(el('div', { class: 'enc-stat-label' }, 'scars'));
  const scars = (player.scars || []).filter(s => SCARS[s]);
  if (!scars.length) {
    wrap.appendChild(el('div', { class: 'enc-status-empty' }, '— none —'));
    return wrap;
  }
  const list = el('div', { class: 'enc-trait-stack' });
  for (const sid of scars) {
    const s = SCARS[sid];
    const row = el('div', { class: 'enc-trait-card scar' });
    row.appendChild(el('div', { class: 'enc-trait-card-name' }, s.name));
    row.appendChild(el('div', { class: 'enc-trait-card-desc' }, s.desc));
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}

function narrativeOrActionsEl(enc) {
  const box = el('div', { class: 'enc-bottom' });
  box.appendChild(narrativeWindowEl());
  const logBusy = state.typingIdx >= 0 || state.logAwaitingClick;
  if (logBusy) return box;
  if (enc.awaitingPlayer && !state.acting) {
    box.appendChild(verbMenuEl(enc));
  } else if (enc.over && enc.outcome === 'collapsed') {
    box.appendChild(collapsePanelEl());
  }
  return box;
}

function narrativeWindowEl() {
  const clickable = state.typingIdx >= 0 || state.logAwaitingClick;
  const wrap = el('div', { class: 'enc-narr' + (clickable ? ' clickable' : '') });
  wrap.appendChild(el('div', { class: 'enc-section-label' }, '─ the room ─'));
  const idx = state.shownLogIdx;
  const entry = idx >= 0 ? state.log[idx] : null;
  const line = el('div', { class: 'enc-narr-line' + (entry ? ' ' + (entry.cls || '') : '') });
  if (!entry) {
    line.appendChild(el('span', {}, '—'));
  } else {
    const text = el('span', { class: 'enc-narr-text' });
    const html = parseProse(entry.text || '');
    const typing = idx === state.typingIdx;
    if (typing) text.innerHTML = typewriterize(html, 22);
    else        text.innerHTML = html;
    line.appendChild(text);
    if (entry.damage > 0)    line.appendChild(el('span', { class: 'enc-narr-dmg' },  `−${entry.damage}`));
    else if (entry.heal > 0) line.appendChild(el('span', { class: 'enc-narr-heal' }, `+${entry.heal}`));
  }
  wrap.appendChild(line);
  if (clickable) {
    const prompt = el('div', { class: 'enc-narr-prompt' });
    prompt.appendChild(el('span', { class: 'enc-narr-prompt-cursor' }, '▸ '));
    prompt.appendChild(el('span', {}, state.typingIdx >= 0 ? 'skip' : 'continue'));
    wrap.appendChild(prompt);
    wrap.addEventListener('click', advanceLog);
  }
  return wrap;
}

function verbMenuEl(enc) {
  // Two modes: interjection (patient asks something, player picks a response)
  // or normal verb menu (filtered by each verb's when() predicate).
  if (enc.activeInterjection) return interjectionMenuEl(enc);
  const wrap = el('div', { class: 'enc-actions' });
  wrap.appendChild(el('div', { class: 'enc-section-label' }, '─ what I may do ─'));
  const grid = el('div', { class: 'enc-actions-grid' });
  for (const a of listVerbs(enc)) grid.appendChild(verbButton(a));
  wrap.appendChild(grid);
  return wrap;
}

function interjectionMenuEl(enc) {
  const wrap = el('div', { class: 'enc-actions interjection' });
  wrap.appendChild(el('div', { class: 'enc-section-label' }, '─ how I answer ─'));
  const grid = el('div', { class: 'enc-actions-grid' });
  enc.activeInterjection.responses.forEach((r, idx) => {
    const btn = el('button', { class: 'enc-act interjection-resp' });
    btn.addEventListener('click', () => playerVerb(String(idx)));
    btn.appendChild(el('span', { class: 'enc-act-marker' }, '▸'));
    btn.appendChild(el('span', { class: 'enc-act-label' }, r.label));
    if (r.desc) btn.appendChild(el('span', { class: 'enc-act-desc', html: parseProse(r.desc) }));
    grid.appendChild(btn);
  });
  wrap.appendChild(grid);
  return wrap;
}

function listVerbs(enc) {
  const p = enc.player;
  const pat = enc.patient;
  const acts = [];
  for (const [id, v] of Object.entries(pat.def.verbs || {})) {
    // contextual gating — verbs may declare when(patient, player) and only
    // appear in the menu when their condition is met. Verbs with no when()
    // are always available.
    if (typeof v.when === 'function') {
      try { if (!v.when(pat, p)) continue; } catch (e) { continue; }
    }
    acts.push({ id, label: v.label.toUpperCase(), desc: v.desc || '' });
  }
  // WAIT is no longer in the menu by default. Each patient may surface it
  // via `wait.when(patient, player)`; otherwise it stays hidden.
  if (typeof pat.def.wait?.when === 'function') {
    try {
      if (pat.def.wait.when(pat, p)) {
        acts.push({
          id: 'wait',
          label: (pat.def.wait.label || 'WAIT').toUpperCase(),
          desc: pat.def.wait.desc || 'let the room move on its own.',
        });
      }
    } catch (e) {}
  }
  // LEAVE surfaces only when the player has run themselves down or stayed
  // a long time — it's the "close the file" option, not a casual button.
  const canLeave = (typeof pat.def.leave?.when === 'function')
    ? (() => { try { return !!pat.def.leave.when(pat, p); } catch { return false; } })()
    : (p.composure <= 1 || pat.turn >= 6);
  if (canLeave) {
    acts.push({
      id: 'leave',
      label: (pat.def.leave?.label || 'LEAVE').toUpperCase(),
      desc: pat.def.leave?.desc || 'close the door behind you. ~~it leaves a mark.~~',
      danger: true,
    });
  }
  // items in pocket — each is a one-use verb gated by its own `when`.
  for (const iid of (p.items || [])) {
    const it = ITEMS[iid];
    if (!it) continue;
    if (typeof it.when === 'function') {
      try { if (!it.when(pat, p)) continue; } catch (e) { continue; }
    }
    acts.push({
      id: `item:${iid}`,
      label: (it.name || iid).toUpperCase(),
      desc: it.desc || '',
      item: true,
    });
  }
  return acts;
}

function verbButton(act) {
  const cls = 'enc-act'
    + (act.item ? ' item' : '')
    + (act.danger ? ' danger' : '');
  const btn = el('button', { class: cls });
  btn.addEventListener('click', () => playerVerb(act.id));
  btn.appendChild(el('span', { class: 'enc-act-marker' }, act.item ? '◆' : '▸'));
  btn.appendChild(el('span', { class: 'enc-act-label' }, act.label));
  if (act.item) btn.appendChild(el('span', { class: 'enc-act-tag' }, 'use'));
  btn.appendChild(el('span', { class: 'enc-act-desc', html: parseProse(act.desc || '') }));
  return btn;
}

function collapsePanelEl() {
  const wrap = el('div', { class: 'enc-loss' });
  wrap.appendChild(el('div', { class: 'enc-section-label' }, '─ the page ends here ─'));
  const prose = el('div', { class: 'enc-loss-prose' });
  prose.innerHTML = parseProse('I have no more of myself to spend. ~~the room~~ the room keeps the rest.');
  wrap.appendChild(prose);
  const btn = el('button', { class: 'doc-button', onclick: () => {
    import('../run.js').then(m => m.reportEncounterLost());
  } }, [
    el('span', { class: 'doc-button-marker' }, '▸ '),
    el('span', {}, 'close the file'),
  ]);
  wrap.appendChild(el('div', { class: 'doc-action-row' }, [btn]));
  return wrap;
}

function typewriterize(html, msPerChar) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  let charIdx = 0;
  function walk(node) {
    if (node.nodeType === 3) {
      const text = node.textContent;
      const frag = document.createDocumentFragment();
      for (const ch of text) {
        const span = document.createElement('span');
        span.className = 'tw-char';
        span.style.animationDelay = (charIdx++ * msPerChar) + 'ms';
        span.textContent = ch;
        frag.appendChild(span);
      }
      node.parentNode.replaceChild(frag, node);
    } else if (node.nodeType === 1) {
      const children = Array.from(node.childNodes);
      for (const c of children) walk(c);
    }
  }
  walk(tmp);
  return tmp.innerHTML;
}
