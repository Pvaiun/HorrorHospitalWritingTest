// Persistent meta-progression. A single localStorage key holds a JSON blob
// describing what the player has unlocked across runs.
//
// The save grows. Players never lose unlocks; they only gain them. A run that
// completes (win or loss past the first wing) writes one new entry into
// `fragments` and, depending on what happened, may unlock content.

const KEY = 'bloodlines.save.v1';

const STARTING_WOUNDS  = ['amnesia', 'insomnia', 'absence'];
// Every patient is unlocked from the start. The final encounter (choir)
// lives alongside the wing patients here; the run builder routes it to
// the final slot.
const STARTING_PATIENTS = ['pram', 'pyrelord', 'soothlick', 'glimmer', 'frostfin', 'hollow', 'mire', 'composer', 'choir'];

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

// Mark a run finished. Adds an archive line, increments counters, and
// writes the save. Every wound and patient is available from admission,
// so this no longer unlocks anything.
export function recordRunOutcome(save, payload) {
  save.runs++;
  if (payload.reachedFinal) save.finishes++;
  if (payload.fragment && !save.fragments.includes(payload.fragment)) {
    save.fragments.push(payload.fragment);
  }
  if (payload.archiveLine) save.archive.unshift(payload.archiveLine);
  if (save.archive.length > 20) save.archive.length = 20;
  writeSave(save);
}
