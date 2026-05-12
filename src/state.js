// Global mutable game state. Imported by every module that needs to read or
// write state; the renderer reads state.screen and dispatches.
//
// The whole app is one document. A "run" is a single descent from admission
// to discharge (or to whatever takes you). state.run holds the per-run state;
// state.save holds persistent meta progression (loaded from localStorage).

export const RUN_DEPTH = 5;          // number of wings before the final encounter
export const COMPOSURE_MAX = 5;

// The single state object. All modules mutate it directly.
export const state = {
  screen: 'title',
  save: null,   // loaded from localStorage on boot
  run:   null,  // null between runs

  // ── encounter live state (set by combat engine while screen === 'encounter')
  enc:   null,

  // ── narration / typing / click-to-advance
  // The combat engine pushes log entries freely; drainLog walks each one
  // in turn (typing it out, waiting for a player click, then advancing).
  // shownLogIdx is the index of the entry currently visible. The narrative
  // window reads this — not the latest — so unread entries queue up cleanly.
  log: [],
  shownLogIdx: -1,           // current index of the entry the player is reading
  typingIdx: -1,             // index currently typewriting (-1 when idle)
  logAwaitingClick: false,   // true while the engine waits for the player to acknowledge
  _logClickResolve: null,    // promise resolver for "advance to next entry"
  _typeSkipResolve: null,    // promise resolver for "skip the typewriter on this entry"

  // ── pending UI gates
  acting: false,
};

// pushLog accepts either a string or a structured object. The combat engine
// drains the log between actions, animating each line in beat. Fields:
//   text       — required, parsed via parseProse
//   cls        — extra css class on the line
//   damage     — number to render as -N in red
//   heal       — number to render as +N
//   pause      — ms to pause after typing finishes (default depends on length)
//   anim       — { kind: 'shake'|'lunge'|'recoil'|'callout', side?, text? }
export function pushLog(text, opts) {
  let entry;
  if (text && typeof text === 'object' && !Array.isArray(text)) entry = { ...text };
  else entry = { text: String(text || ''), ...(opts || {}) };
  entry.text   = String(entry.text || '');
  entry.cls    = entry.cls || '';
  entry.damage = entry.damage || 0;
  entry.heal   = entry.heal   || 0;
  state.log.push(entry);
  if (state.log.length > 80) state.log.shift();
}

export function clearLog() {
  state.log.length = 0;
  state.shownLogIdx = -1;
  state.typingIdx = -1;
  state.logAwaitingClick = false;
  state._logClickResolve = null;
  state._typeSkipResolve = null;
}

let _idCounter = 1;
export function nextId() { return _idCounter++; }
