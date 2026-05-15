# Bloodlines — Codebase Map

A document-horror conversation game. The player is Patient 0413; each wing is a single encounter with one tragic patient. Vanilla ES modules, no build step, no deps. Open `index.html` to run.

## Architecture in one paragraph
`src/main.js` awaits `loadData()` (fetches `data/glyphs.json` and `data/voiceprose.json` into named exports on `src/data.js`), restores the persistent meta-save from `localStorage`, then calls `render()`. The whole app is **state mutation + re-render**: modules import `state` from `src/state.js`, mutate it, then call `render()` from `src/ui/render.js`. `render()` clears `#app` and dispatches on `state.screen` to a screen renderer in `src/ui/screens.js` (or `src/ui/encounter.js` for an encounter). No virtual DOM, no framework, no router. UI builds DOM via `el(tag, props, children)` in `src/ui/dom.js`. The aesthetic is "document horror" — every screen is a page in a corrupted file; creatures are abstract pixel-bitmap glyphs with prose dossiers, not portraits.

## Run shape
ADMISSION → `RUN_DEPTH` wings (one corridor event + one patient encounter each) → FINAL encounter → ARCHIVE. The corridor map shows the player's progress as a thin row of nodes. `src/run.js` defines `fixedWingOrder` — wing 1 is currently Polonius; change this to test a different patient first.

## File map

### `src/`
- `main.js` — entry. Loads data, loads save, kicks off render.
- `state.js` — `state` singleton, `pushLog`, log-buffer cap (80 entries, indices slide in step), constants (`RUN_DEPTH`, `COMPOSURE_MAX`).
- `data.js` — `loadData()`; named exports `GLYPHS`, `VOICE`.
- `save.js` — localStorage-backed meta progression. `defaultSave()`, `loadSave()`, `recordRunOutcome()`. `STARTING_PATIENTS` is the unlocked pool.
- `rng.js` — `rand`, `randi`, `pick`, `pickN`, `sleep`.
- `audio.js` — WebAudio bleeps.
- `run.js` — run lifecycle. `startNewRun(wound)` builds the corridor; `fixedWingOrder` decides patient order; `endRun(payload)` writes the run to save.
- `combat.js` — the encounter engine. `beginEncounter`, `playerVerb` (dispatch), `runSpokeChoice`, `enterSpoke`, `enterSpokeNode`, `exitSpokeToHub`, `runInterjectionResponse`, `maybeFireInterjection`, `flushSurfaceNotes`, `announceHubFlavor`, `applyResponse` (writes lines, scales, flags, composure, etc.). All conversation flow lives here.
- `traits.js` — trait registry. `mods` and `hooks` for resolutions/events.
- `wounds.js` — admission reasons. Each wound gives a small starting mod and a signature trait.
- `events.js` — corridor vignettes. Each event has prose, 2–3 choices, and a per-choice `effect(player, run)`.
- `patients.js` — the encounters. One big file, one object per patient. Mixed authoring styles (see below).

### `src/ui/`
- `render.js` — dispatcher. Reads `state.screen`, routes to a renderer.
- `screens.js` — non-encounter screens (title, admission, corridor, event, event_after, resolution, archive).
- `encounter.js` — the encounter screen. Patient column (file + presented sentence), player column, narrative log (single-line), action menu. Menu precedence: `activeInterjection` > `activeSpoke` > hub.
- `dom.js` — `el(tag, props, children)`, `attachLongPress`.
- `glyphs.js` — bitmap glyph → SVG.
- `textCorrupt.js` — inline markup parser. `**gold**`, `!!red!!`, `[[N]]` redaction, `~~strikethrough~~`.
- `animations.js` — float numbers, column shake.

### `data/`
- `glyphs.json` — 16×16 hand-authored bitmaps, one per species.
- `voiceprose.json` — authored prose for some legacy pieces. Most authoring lives inline in `src/patients.js` etc.

## Conversation system

Every patient is an encounter the player walks through one beat at a time. There are three authored styles in the codebase. They share the same engine; the engine just dispatches differently depending on which fields the patient declares.

### Style 1: verbs + interjections (legacy hub)
The patient defines a `verbs` map. Each verb is a one-shot hub action with a single authored `respond(pat, player)` returning a `Response` (lines, scales, flags, composure, etc.). The player sees the hub menu with all eligible verbs (filtered by per-verb `when`) and picks one per turn. `interjections: [...]` is a parallel array of forced beats that the engine auto-fires from a hub-idle moment when their `when(pat, player, hub)` matches. Each interjection has `prose: [...]` (the patient's action) and `responses: [...]` (the player's response menu — same shape as a Response, plus a `label`). Used by Pram, Patriarch, and most older patients. Good for tight one-shot loops with the occasional forced beat.

### Style 2: hub + spokes (Children at the Door)
The patient defines a `hubState(p, player)` that names the current scene, a `presented(p, hub)` that paints the standing description, and a `spokes: { id: { ... } }` map. Each spoke is a small node-graph (`entry`, `nodes: { id: { lines, choices, ... } }`). Spoke nodes' choices route via `goto: 'node_id'` (within spoke), `goto: { to: 'hub' }` (exit), or `goto: { to: 'hub', forceState: 'name' }` (exit to a forced hub state). Spokes can be filtered from the hub menu with `when(p, player, hub)`. Two soft mechanisms layer on top:
- **`hubFlavor: { state: line }`** on the patient — posts one line into the narrative log the first time we transition into that hub state.
- **`surfaceNote: 'line'`** on a spoke — posts one line the first time the spoke becomes available, so the player understands a new option has surfaced without having to click it to find out.

`interjections: [...]` works the same as Style 1 and naturally fires at hub-idle moments between spokes. This is the right style for "rooms / hub states with a small menu of actions per state."

### Style 3: beat-graph (Polonius)
The patient declares `startSpoke: 'main'`. The engine drops the player into that spoke immediately after the intro and never returns to a hub menu. The whole encounter lives inside one mega-spoke whose nodes (= beats) route to other nodes via authored `goto`s. Every beat is small (1–3 lines + 2–3 choices); cluster transitions go through small selector functions (`poloniusPickRoom`, `poloniusAfterReveal`, etc.) that return a node id based on accumulated state. Use this for encounters where there's no neutral hub to return to — the conversation has continuous momentum and direction.

Beat-graph patients also stop using `interjections` — those don't compose well with continuity-driven flow (we tried; the return felt jarring). Instead, dramatic surprise comes from:
- **Per-line `{ text, cls }`** on a beat's `lines` array — a single line in any beat can be marked `cls: 'interjection'` to get the gold accent treatment.
- **Inline probabilistic routing** — a choice's `goto` can be a function: `goto: (p) => Math.random() < 0.25 ? 'rare_beat' : 'normal_beat'`. The rare beat is an authored node attached to that specific predecessor; the dice are local, not global.

Polonius is the working example: ~100 beats across nine clusters (THRESHOLD → WELCOME → TOUR → CONFIDENCE → REVEAL → LULL → REACH → TURN → RECKONING), three small low-occurrence variants (`r_clock_chimes_now`, `l_cook_in_doorway`, `r_library_book_moves`), five gold-accent dramatic lines hand-placed.

## Engine primitives (shared)

These live in `combat.js` and apply to all styles:

- **`pat.turn`** ticks once per spoke exit for hub-and-spoke patients, and once per beat for beat-graph patients (i.e. patients declaring `startSpoke`). Use it in `when()` for time-gated content.
- **`pat.flags`** is a free-form bag the author can read and write. `pat.flags.lastVerb` and `pat.flags.streak` are written by the engine so authors can detect verb repetition.
- **`pat.scales`** is per-encounter numeric state with `bands` declared in `patient.scales`. Scales drive `presented()` and selector logic. The scales panel is no longer rendered in the UI — they're background plumbing.
- **`composure`** is on the player; running it to 0 fires `fireCollapse` (a generic loss).
- **`endings: [{ id, when(p), title, lines, item?, scars? }]`** — the engine checks these after every applyResponse. First match fires `fireEnding` and the encounter resolves.
- **`Response` shape**: `{ lines, scales, flags, composure, composureCost, composureGain, scars, effects, playerEffects, callout, shake }`. Every patient-driven moment ultimately turns into a Response and goes through `applyResponse`.
- **Function-valued fields**: `lines`, `scales`, `flags`, etc. inside a node or choice can be functions of `(pat, player)`. `goto` can be a function returning a string or object; `goto.to` can also be a function. Use this for state-aware routing inside a single authored beat.
- **`cls`-tagged lines**: lines can be strings OR `{ text, cls, ... }` objects. Known classes include `intro`, `flavor`, `interjection` (gold accent, italic), `surface-note`, `hub-shift`, `cost`, `mend`.

## Conventions
- **`state` is global and mutated directly.** Import it; don't pass as a parameter.
- **Re-render after mutation.** Any user-visible change ends with `render()`. `combat.js` interleaves `render()` with `await sleep(ms)` for typewriter pacing.
- **No build step.** Browser-native ES modules.
- **No comments unless non-obvious.** Identifiers carry intent.
- **Patients are bossfights, not fodder.** Each one is hand-crafted with a specific mechanic and several branching outcomes; they appear once per run.
- **Strikethrough (`~~...~~`)** is reserved for the unspoken meaning beneath what was said. Spoken dialogue renders plain. Stress moments use `!!...!!` for red emphasis.

## Adding a new patient — by style

**Beat-graph (Polonius-style).** Add an object to `src/patients.js` with id, name, glyph (must exist in `glyphs.json`), file lines, intro, scales, `initialize(p, player)`, `hubState()` returning a constant, `presented(p, hub)` keyed off a `p.flags.room`, `startSpoke: 'main'`, and `spokes.main.nodes` containing every beat keyed by id. Cluster the beat ids by prefix (`t_*`, `w_*` ...). Selectors are local helper functions above the patient definition. Endings array fires on flags/scales. Register in `PATIENTS` at the bottom; add the id to `STARTING_PATIENTS` in `save.js`; place in `fixedWingOrder` in `run.js`.

**Hub-and-spoke (Children-style).** Same boilerplate as above, but `hubState(p, player)` returns a meaningful scene name from flags. Each spoke ends with `goto: { to: 'hub' }` to return to the hub menu. Add `hubFlavor: { state: line }` for each scene transition, optional `surfaceNote` on individual spokes, and `interjections: [...]` for forced beats at hub idle.

**Verbs + interjections (legacy).** Define `verbs: { id: { label, desc, when?, respond(p, player) } }`. Each `respond` returns a Response. Optionally `wait`, `leave`, `drift` for the implicit fallback verbs. `interjections: [...]` for forced beats. Useful for tight, single-room encounters.

## Authoring patterns we tried and rejected

- **Procedural intrusion injection** on beat-graph patients (a global `maybeDivert` hook that rolled at every beat entry to swap in an intrusion beat). It read as unrelated injection rather than authored content, and the return-from-detour felt jarring no matter how we handled it. The mechanism is removed. Use per-line gold styling and inline `goto: (p) => Math.random() < N ? 'rare' : 'normal'` instead — authored, local, scoped to a specific predecessor.
- **Hidden patient mood drift biasing selectors.** Built and removed. Added run-to-run variance but produced inconsistent prose tone since the variants didn't all share authorial care. May revisit, but only with hand-tuned variant pools per cluster, not procedural drift.
- **Forced opt-in flag on beats for "interruption-safe" moments.** Every beat is effectively an open prompt; the flag had no useful granularity.

## Test / verify
No automated tests. Manual: open `index.html` (any static server works), play through the relevant flow. `node --check src/<file>.js` for syntax. For graph integrity on beat-graph patients, grep for `to: '<id>'` and `goto: '<id>'` references and confirm each target id exists as a node.
