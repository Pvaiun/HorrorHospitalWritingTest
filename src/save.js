// Persistent meta-progression. A single localStorage key holds a JSON blob
// describing what the player has unlocked across runs.
//
// The save grows. Players never lose unlocks; they only gain them. A run that
// completes (win or loss past the first wing) writes one new entry into
// `fragments` and, depending on what happened, may unlock content.

const KEY = 'bloodlines.save.v1';

const STARTING_WOUNDS  = ['amnesia', 'insomnia', 'absence'];
// The final encounter (choir) is always available — it's the room at the
// end of the corridor, not a wing patient — so it lives in the starting
// pool and never appears in UNLOCK_LADDER.
const STARTING_PATIENTS = ['pram', 'pyrelord', 'soothlick', 'glimmer', 'frostfin', 'choir'];

export function defaultSave() {
  return {
    runs: 0,            // total runs played
    finishes: 0,        // runs that reached the final encounter
    fragments: [],      // file fragments earned (string ids)
    unlocked: {
      wounds:   [...STARTING_WOUNDS],
      patients: [...STARTING_PATIENTS],
    },
    // archive: every run leaves a one-line obituary in the player's file.
    archive: [],
  };
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw);
    // defensive merge against missing keys after future migrations.
    const base = defaultSave();
    return {
      ...base,
      ...parsed,
      unlocked: {
        wounds:   Array.from(new Set([...(parsed.unlocked?.wounds   || []), ...base.unlocked.wounds])),
        patients: Array.from(new Set([...(parsed.unlocked?.patients || []), ...base.unlocked.patients])),
      },
      fragments: parsed.fragments || [],
      archive:   parsed.archive   || [],
    };
  } catch (e) {
    return defaultSave();
  }
}

export function writeSave(save) {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* private mode etc. */ }
}

export function wipeSave() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

// Mark a run finished. Adds an archive line, increments counters, and may
// unlock content based on `payload`.
export function recordRunOutcome(save, payload) {
  save.runs++;
  if (payload.reachedFinal) save.finishes++;
  if (payload.fragment && !save.fragments.includes(payload.fragment)) {
    save.fragments.push(payload.fragment);
  }
  if (payload.archiveLine) save.archive.unshift(payload.archiveLine);
  if (save.archive.length > 20) save.archive.length = 20;

  // Each milestone unlocks more content. The pool grows the more runs the
  // player completes; eventually they have everything.
  const UNLOCK_LADDER = [
    { at: 1, wounds: ['witness'],  patients: ['mire']    },
    { at: 2, wounds: ['devotion'], patients: ['hollow']  },
    { at: 3, wounds: ['hollow'],   patients: ['composer']},
  ];
  for (const tier of UNLOCK_LADDER) {
    if (save.runs >= tier.at) {
      for (const w of tier.wounds)   if (!save.unlocked.wounds.includes(w))   save.unlocked.wounds.push(w);
      for (const p of tier.patients) if (!save.unlocked.patients.includes(p)) save.unlocked.patients.push(p);
    }
  }
  writeSave(save);
}
