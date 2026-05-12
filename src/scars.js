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
    file: 'I took something from someone. ~~she~~ they didn\'t put it down.',
    desc: 'patients open more slowly. tenderness/trust/warmth start −1.',
  },
  witnessed: {
    id: 'witnessed',
    name: 'Witnessed',
    file: 'I saw her go. I have not put down what I saw.',
    desc: 'max composure −1.',
    composureCap: 4,
  },
  named: {
    id: 'named',
    name: 'Named',
    file: 'she called me something. it has not quite let go.',
    desc: 'patients hold tighter. insistence/grip/waiting start +1.',
  },
  abandoned: {
    id: 'abandoned',
    name: 'Abandoned',
    file: 'I left a door open. someone is still through it.',
    desc: 'starting composure −1 per fight.',
    startComposureDelta: -1,
  },
  failed: {
    id: 'failed',
    name: 'Failed',
    file: 'I ran out of time. she ran out with me.',
    desc: 'starting composure −1 per fight. drift bites a little harder.',
    startComposureDelta: -1,
    driftBite: 1,
  },
  collapsed: {
    id: 'collapsed',
    name: 'Collapsed',
    file: 'I went under. I am not all the way back.',
    desc: 'max composure −1.',
    composureCap: 4,
  },
  wearing: {
    id: 'wearing',
    name: 'Wearing',
    file: 'the corridor is on me. the wallpaper, the wallpaper smell.',
    desc: 'starting composure −1 per fight.',
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
