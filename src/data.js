// Loads the two remaining data files: glyphs (bitmap art) and voiceprose
// (authored prose for files, status flavor, etc.). Everything else — patient
// mechanics, traits, wounds — lives in JS modules under src/.

export const GLYPHS = {};
export const VOICE = {
  subtitles:   {},  // by patient id or general key
  notes:       {},  // by patient id or general key
  afflictions: {},  // by status id
  events:      {},  // misc named lines
};

async function fetchJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
  return r.json();
}

export async function loadData() {
  const [glyphs, voice] = await Promise.all([
    fetchJson('data/glyphs.json'),
    fetchJson('data/voiceprose.json'),
  ]);
  for (const [k, v] of Object.entries(glyphs)) {
    if (k.startsWith('_')) continue;
    GLYPHS[k] = v;
  }
  Object.assign(VOICE.subtitles,   voice.subtitles   || {});
  Object.assign(VOICE.notes,       voice.notes       || {});
  Object.assign(VOICE.afflictions, voice.afflictions || {});
  Object.assign(VOICE.events,      voice.events      || {});
}
