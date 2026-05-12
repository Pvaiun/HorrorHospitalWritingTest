# Bloodlines — Codebase Map

A document-horror duel: you are Patient 0413; each "wing" pits you against one tragic patient in a turn-based fight. Vanilla ES modules, no build step, no deps. Open `index.html` to run.

## Architecture in one paragraph
`src/main.js` awaits `loadData()` (fetches `data/glyphs.json` and `data/voiceprose.json` into named exports on `src/data.js`), restores the persistent meta-save from `localStorage`, then calls `render()`. The whole app is **state mutation + re-render**: modules import `state` from `src/state.js`, mutate it, then call `render()` from `src/ui/render.js`. `render()` clears `#app` and dispatches on `state.screen` to a screen renderer in `src/ui/screens.js` (or `src/ui/encounter.js` for combat). No virtual DOM, no framework, no router. UI builds DOM via `el(tag, props, children)` in `src/ui/dom.js`. The aesthetic is "document horror" — every screen is a page in a corrupted file; creatures are abstract pixel-bitmap glyphs with prose dossiers, not portraits.

## Run shape
A run goes: ADMISSION → 5 wings (one corridor event + one patient encounter each) → FINAL encounter → ARCHIVE. The corridor map shows the player's progress as a thin row of nodes. Patient pool grows as the player completes runs (`save.js` UNLOCK_LADDER).

## File map

### `src/`
- `main.js` — entry. Loads data, loads save, kicks off render.
- `state.js` — `state` singleton, `pushLog`, constants (`RUN_DEPTH=5`, `COMPOSURE_MAX=5`, `POSE_QUEUE_VISIBLE=3`).
- `data.js` — `loadData()`; named exports `GLYPHS`, `VOICE`.
- `save.js` — localStorage-backed meta progression. Adds new wounds / patients to the unlocked pool on each run completion. `defaultSave()`, `loadSave()`, `recordRunOutcome()`.
- `rng.js` — `rand`, `randi`, `pick`, `pickN`, `sleep`.
- `audio.js` — WebAudio bleeps: `hit, crit, heal, select, faint, victory, capture, levelup`.
- `version.js` — single-line version string.
- `run.js` — run lifecycle. `startNewRun(wound)` builds the corridor; `enterCurrentNode()` dispatches into an event or encounter; `applyResolutionAndAdvance()` grants the chosen trait and advances; `endRun(payload)` writes the run to save and shows the archive.
- `combat.js` — the duel engine. `makePlayer`, `beginEncounter`, `playerAct`, `chooseResolution`, `dealDamage`, `heal`, `applyStatus`. Five core verbs (PRESS, STRIKE, ENDURE, LISTEN, SPEAK) plus a wound-given SIGNATURE. Five statuses (BLEED, HUSH, KNOW, RAW, HELD). The patient's queue of "poses" is visible (next 1–N), each pose is a `{ name, tell, effect }` object produced on demand by the patient definition.
- `traits.js` — trait registry. Each trait has optional `mods` (numeric modifiers the engine reads via `sumMod`) and optional `hooks` (named functions like `onEncounterStart`, `onDamageTaken`, `onStrikeHit`, `onSignature`, `onTurnEnd`, `onCorridorEntry`). Signatures are also traits (prefixed `sig_`), one per wound.
- `wounds.js` — admission reasons. Each wound gives a small starting mod (maxHp, composure, etc.) and a signature trait.
- `events.js` — corridor vignettes. Each event has prose, 2–3 choices, and a per-choice `effect(player, run)` mutator.
- `patients.js` — the hand-crafted bossfights. Every patient is its own object with: name, glyph, subtitle, dossier file lines, intro, per-action `flavor`, 2–3 `phases` (each with `name`, `intro`, `hp`, `conditions`), a `produceNextPose(patient, player, turn)` function, optional `onSpeak(patient, player, mult)`, optional `checkPatientWin(patient, player)` alternate loss condition, optional `makeExtras()`, and three branching `resolutions` (`soothe`, `hold`, `listen`) each pointing to a trait id. `role: 'wing'|'final'`. `tier: 1|2|3` controls wing order.

### `src/ui/`
- `render.js` — dispatcher. Reads `state.screen`, routes to a renderer.
- `screens.js` — all non-encounter screens (title, admission, corridor, event, event_after, resolution, archive).
- `encounter.js` — the live combat screen. Two columns (patient ↔ player), pose queue, status row, action menu, narrative window.
- `dom.js` — `el(tag, props, children)`, `attachLongPress`.
- `glyphs.js` — bitmap glyph → SVG.
- `textCorrupt.js` — inline markup: `~~strike~~`, `[[N]]` redaction, `**gold**`, `!!red!!`.
- `animations.js` — float numbers, column shake / lunge / recoil.

### `data/`
- `glyphs.json` — 16×16 hand-authored bitmaps, one per species. `#` filled, `.` empty.
- `voiceprose.json` — authored prose: subtitles, notes, status flavor. Most authoring now lives inline in `src/patients.js` / `src/wounds.js` / `src/events.js` / `src/traits.js` — each one a single readable unit.

## Combat in one paragraph
Each turn: patient telegraphs its next pose(s); player picks one of five core actions or their wound-given SIGNATURE; resolves player → patient; statuses tick at turn end; phase advances when patient HP hits 0; final phase ends with a resolution choice that grants one of three branching traits. Damage modifiers (bracing on ENDURE, raw amplification, trait hooks) are applied inside `dealDamage`. Combat is async — `combat.js` interleaves `pushLog`, `drainLog` (typewriter sleep) and `render()` so each line of narration lands in beat with the action.

## Conventions
- **`state` is global and mutated directly.** Don't pass as a parameter; import it.
- **Re-render after mutation.** Any user-visible change ends with `render()`. Async combat flows in `combat.js` interleave `render()` and `await sleep(ms)` for animation pacing.
- **No build step.** Browser-native ES modules.
- **No comments unless non-obvious.** Identifiers carry intent.
- **Patients are bossfights, not fodder.** Each one is hand-crafted with a unique mechanic and three branching outcomes; they appear once per run, drawn from a growing pool.

## Adding things — checklists

**New patient:** add an object to `src/patients.js` with id, glyph (must exist in `glyphs.json`), file lines, intro, flavor, phases, `produceNextPose`, `resolutions` (3 keys: soothe / hold / listen), optional `onSpeak` / `checkPatientWin` / `makeExtras`. Reference traits in `resolutions[*].trait`. Set `tier`. Register in `PATIENTS` at the bottom. Add to `save.js` UNLOCK_LADDER if it should be gated.

**New trait:** add an entry to `TRAITS` in `src/traits.js` with `name`, `desc`, `voice`, optional `mods` and `hooks`. Hooks receive a ctx — see existing traits for the available fields. Reference the trait id from a patient resolution or an event effect.

**New wound:** add an entry to `WOUNDS` in `src/wounds.js` with `file` (3 lines), `mods`, and a `signature` (a `sig_*` trait id from `TRAITS`). Add a new `sig_*` trait alongside in `traits.js`. Add to `STARTING_WOUNDS` in `save.js` if it should be available from run 0; otherwise wire it into `UNLOCK_LADDER`.

**New event:** add an entry to `EVENTS` in `src/events.js` with tag, prose, and choices (`{ key, label, prose, effect(player, run) }`).

**New screen:** add a renderer in `src/ui/screens.js`, register in the `switch` in `src/ui/render.js`, set `state.screen = 'name'` to enter.

## Test / verify
No automated tests. Manual: open `index.html` (any static server works), play through the relevant flow. For combat changes, the in-encounter narrative box (`state.log`, rendered on the encounter screen) is the primary signal.
