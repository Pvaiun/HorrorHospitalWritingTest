// Scars are run-long debuffs. Unlike items — which the player spends —
// scars accumulate and make the rest of the run harder. They affect
// composure caps, starting composure, and patient seeding (some patients
// react to specific scars, e.g. someone marked TAKEN starts colder with
// the mother because she senses something).
//
// Each scar may declare:
//   composureCap: int           — caps the player's max composure
//   startComposureDelta: int    — added to starting composure each fight
//   driftBite: int              — extra composure damage when drift hurts you
//   seedShift: { scaleKey: int } — applied to certain patient scales at start
//                                  (read by patients in initialize())

export const SCARS = {
  taken: {
    id: 'taken',
    name: 'Taken',
    file: 'I took something out of a room. ~~Someone~~ It is still keeping me.',
    desc: 'Patients open more slowly. Tenderness, trust, warmth start −1.',
  },
  witnessed: {
    id: 'witnessed',
    name: 'Witnessed',
    file: 'I saw it. I have not put down what I saw. !!It is in my chest.!!',
    desc: 'Maximum composure −1.',
    composureCap: 4,
  },
  named: {
    id: 'named',
    name: 'Named',
    file: 'Someone called me a name that was not mine. ~~It fit.~~',
    desc: 'Patients claim harder. Insistence, grip, waiting start +1.',
  },
  abandoned: {
    id: 'abandoned',
    name: 'Abandoned',
    file: 'I left a door open. ~~The room~~ Whatever was inside is still through it.',
    desc: 'Starting composure −1 each room.',
    startComposureDelta: -1,
  },
  failed: {
    id: 'failed',
    name: 'Failed',
    file: 'The hour ran out. They ran out with me. !!I could not finish.!!',
    desc: 'Starting composure −1 each room. Waiting bites harder.',
    startComposureDelta: -1,
    driftBite: 1,
  },
  collapsed: {
    id: 'collapsed',
    name: 'Collapsed',
    file: 'I went under. I am not all the way back. ~~Most of me~~ Some of me returned.',
    desc: 'Maximum composure −1.',
    composureCap: 4,
  },
  wearing: {
    id: 'wearing',
    name: 'Wearing',
    file: 'The corridor is on me. The wallpaper smell. The fluorescent. ~~The rest.~~',
    desc: 'Starting composure −1 each room.',
    startComposureDelta: -1,
  },
};

export function applyScar(player, sid) {
  if (!SCARS[sid]) return;
  if (!player.scars) player.scars = [];
  if (!player.scars.includes(sid)) player.scars.push(sid);
}

export function getScar(id) { return SCARS[id] || null; }

// Helpers used by combat.js and patients.js to read scar effects.
export function scarsCap(player) {
  let cap = Infinity;
  for (const sid of player.scars || []) {
    const s = SCARS[sid];
    if (s && typeof s.composureCap === 'number') cap = Math.min(cap, s.composureCap);
  }
  return cap;
}

export function scarsStartDelta(player) {
  let total = 0;
  for (const sid of player.scars || []) {
    const s = SCARS[sid];
    if (s && typeof s.startComposureDelta === 'number') total += s.startComposureDelta;
  }
  return total;
}

export function scarsDriftBite(player) {
  let total = 0;
  for (const sid of player.scars || []) {
    const s = SCARS[sid];
    if (s && typeof s.driftBite === 'number') total += s.driftBite;
  }
  return total;
}
