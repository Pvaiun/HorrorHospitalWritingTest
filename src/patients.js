// Each patient is a hand-authored conversation. They expose:
//
//   scales: {
//     key: {
//       initial, min, max, label, kind: 'positive'|'negative',
//       bands: [{ at, word, tone? }, ...],         // threshold descriptors
//       crossUp:   { [bandIdx]: 'message' },       // crossed UP into band
//       crossDown: { [bandIdx]: 'message' },       // crossed DOWN into band
//     }
//   }
//   initialize(patient, player)        — set scale starting values (with RNG)
//   presented(patient): string         — composed sentence read each turn
//   fileReveals: [
//     { at?: number, announce?: 'string' }, // sequential — array index is the file-line
//     ...                                   // `at` is cumulative scale movement; defaults to [7, 20, 35]
//   ]
//   verbs: {
//     [verbId]: {
//       label, desc,
//       when?(patient, player): bool   — contextual gating (be strict; the
//                                        menu should hold 3–4 things at once)
//       respond(patient, player): Response
//     }
//   }
//   wait?:  { label?, desc?, when(p, player): bool, respond?(p, player) }
//   leave?: { label?, desc?, when(p, player): bool, respond?(p, player) }
//   interjections: [
//     { id, when, once?, prose: [...], responses: [{ label, lines, scales, composure, scars, ... }] }
//   ]
//   drift(patient, player): Response   — fallback for WAIT
//   endings: [{ id, when, title, lines, item?, scars? }]
//
// Response shape: { lines: string[]|string, scales: {key: delta},
// composure: int, scars: string[], flags: {key: bool}, ... }
//
// Authored prose should NOT include trailing parenthetical "(scale rises.)"
// lines. The engine emits a single threshold-cross sentence after the
// response — pulled from the scale's crossUp / crossDown messages — only
// when a scale moves into a new named band. This makes feedback feel like
// a continuation of the narrative, not a stat panel.

import { randi, pick } from './rng.js';

function r(min, max) { return randi(min, max); }
function streakCount(p, verbId) { return p.flags.lastVerb === verbId ? (p.flags.streak || 1) : 0; }


// ════════════════════════════════════════════════════════════════════════
// POLONIUS — Patient ??? (the Greek Wing)
// ════════════════════════════════════════════════════════════════════════
//
// A cursed Victorian house, annexed into a wing of the hospital, holds
// one tenant: Polonius, who was born in ancient Greece and has been
// trapped here for nearly a thousand years. Three staff (the butler,
// the cook, the maid) live in the house on a single perpetual day —
// they do not remember. Polonius does. He remembers every loop.
//
// The curse demands one bound tenant. The cursed person resets each
// morning with the house. If the cursed person walks out while only
// one other living thing remains inside, the curse transfers and the
// remaining one becomes the new tenant.
//
// THE HOOK: every patient enters the Greek Wing by holding their
// admission card to a brass slot at the door. The card admits them.
// Inside, the slot becomes the only way back out. There is no handle
// on this side that opens the door without the card.
//
// In the first beat after meeting, Polonius palms the card from the
// player's coat during a polite gesture, and passes it to the maid.
// The maid carries it deeper into the house. The player's goal — the
// only goal — is to get the card back and walk out, before tiredness
// takes them or Polonius walks out a beat ahead. They cannot leave
// without engaging the house, the staff, or Polonius himself.
//
// The player has several avenues open. They can search the house and
// track the card. They can corner Polonius and force him to return it.
// They can find a weapon and kill him; the staff dissolve at his death
// and the card returns. They can find the binding-anchor that ties
// him to the house, destroy it, and free him by mercy. They can also
// blunder, fall asleep, lose the card to the fire, or be walked out
// behind by a host one beat faster.
//
// This patient is authored as a beat-graph: one mega-spoke `main`
// organised in clusters (THRESHOLD, MEETING, LOSS, HUNT, FACE, KILL,
// FREE, RECKONING). Selectors decide cluster transitions based on
// hidden mood, the card's current location, and what the player has
// uncovered. Intrusions fire on probabilistic timers tied to where
// the card is in the house.
// ════════════════════════════════════════════════════════════════════════

// ─── helpers used only by polonius ─────────────────────────────────────

// The card is the goal. It moves through the house as the player and
// the staff move. Tracked entirely in patient flags. See poloniusCardLine
// for the one-line read that surfaces in the patient's presented() block.
//   pocket          — start, before the theft
//   palmed          — Polonius has slipped it, but it's still on his person
//   maid            — Mrs. Halliwell is carrying it
//   cloakroom       — locked in the coat-cupboard at the back
//   butler          — Mr. Halliwell folded it into his newspaper
//   cook            — in the cook's apron pocket, with the lamb
//   study           — locked in the desk in Polonius's study
//   gallery_frame   — slipped behind the empty portrait frame
//   cellar          — buried with the wine, on a shelf
//   fire            — burning in the foyer fireplace (one turn to grab)
//   ash             — the fire has finished with it
//   recovered       — back in the player's pocket
const CARD_STATES = [
  'pocket', 'palmed', 'maid', 'cloakroom', 'butler', 'cook',
  'study', 'gallery_frame', 'cellar', 'fire', 'ash', 'recovered',
];

// Where the player can choose to go next from the HUB. Each room has
// its own entry beat; the hub presents a curated subset based on what
// has been visited and what the card's current location suggests.
const POLONIUS_ROOMS = [
  'parlor', 'library', 'gallery', 'clock_hall', 'dining',
  'cloakroom', 'kitchen', 'study', 'cellar',
];

// One-line description of where the card currently is, intended for
// the presented() string. Returns null if the player does not yet
// know where it is.
function poloniusCardLine(p) {
  const loc = p.flags._card_location;
  const known = p.flags._card_known;
  if (loc === 'pocket')      return 'My card is in my pocket. Just where I left it.';
  if (loc === 'recovered')   return '!!My card is in my pocket again.!! The threshold is no longer a wall.';
  if (loc === 'ash')         return '!!My card is ash.!! The fireplace finished with it. I will not be leaving by the door.';
  if (!known) {
    if (p.flags._suspects_theft) return '~~My pocket is the wrong temperature.~~ Something has been moved.';
    return null;
  }
  if (loc === 'palmed')         return 'My card is on him. In a vest pocket I have only seen the embroidery of.';
  if (loc === 'maid')           return 'My card is in her apron. She has not stopped smiling.';
  if (loc === 'cloakroom')      return 'My card is in the cloakroom. At the back of the house, past the maid.';
  if (loc === 'butler')         return 'My card is folded into his newspaper. He does not turn pages.';
  if (loc === 'cook')           return 'My card is in his apron, with the lamb. The apron is the colour of an unsuccessful evening.';
  if (loc === 'study')          return 'My card is in his study. The study door is locked. The drawer in the desk is locked.';
  if (loc === 'gallery_frame')  return 'My card is behind a portrait in the gallery. ~~There was dust where there should not have been.~~';
  if (loc === 'cellar')         return 'My card is in the cellar, on a shelf, behind a bottle.';
  if (loc === 'fire')           return '!!My card is in the fire.!! The fire is small. There is still time.';
  return null;
}

// Tick the card forward through the house. Called by certain beats and
// by interjections when the player has stalled. The staff move it
// according to Polonius's plan: maid → cloakroom → butler → study;
// then it comes back to Polonius for the endgame. Hot states (fire,
// ash, recovered, palmed_during_endgame) override and stick.
function poloniusAdvanceCard(p) {
  if (!p.flags._card_taken) return;
  const stuck = ['recovered', 'ash', 'fire', 'destroyed'];
  if (stuck.includes(p.flags._card_location)) return;
  // Once Polonius openly threatens or the mask cracks, he wants the
  // card back on him as insurance.
  if (p.flags._mask_on === false && !p.flags._card_known_endgame) {
    p.flags._card_location = 'palmed';
    p.flags._card_known = true;
    p.flags._card_known_endgame = true;
    return;
  }
  const ladder = ['maid', 'cloakroom', 'butler', 'study', 'palmed'];
  const i = ladder.indexOf(p.flags._card_location);
  if (i === -1) return;
  if (i < ladder.length - 1) {
    p.flags._card_location = ladder[i + 1];
    p.flags._card_moved_at = p.turn;
  }
}

// Where can the player go from the HUB right now? Filters POLONIUS_ROOMS
// by what makes sense (kitchen requires having seen the cook; study and
// cellar require having gained leverage; rooms already searched of the
// card are not removed — the player may come back).
function poloniusReachableRooms(p) {
  const out = [];
  for (const r of POLONIUS_ROOMS) {
    if (r === 'kitchen' && !p.flags._seen_cook && !p.flags._been_dining) continue;
    if (r === 'study' && !p.flags._heard_study && !p.flags._been_library) continue;
    if (r === 'cellar' && !p.flags._heard_cellar) continue;
    out.push(r);
  }
  return out;
}

// Selector. Did the player earn a real card-return ending? They need
// the card recovered and to not be visibly drugged.
function hasCardAndComposure(p) {
  if (p.flags._card_location !== 'recovered') return false;
  if (p.scales.tiredness >= 16) return false;
  return true;
}

// Selector. The route the door-attempt takes depends on the card state.
// No card: the slot blinks; the door is plaster from this side. Player
// is funnelled back. Card: a clean walk if Polonius hasn't gathered the
// staff for the trap, else the trap sequence.
function poloniusDoorAttempt(p) {
  if (p.flags._card_location !== 'recovered') return 'e_door_locked';
  if (p.flags._polonius_at_door) return 'e_door_polonius_waits';
  if (p.scales.tiredness >= 14) return 'e_drift_mid_walk';
  return 'e_door_in_reach';
}

// After a HUB choice for "talk to him here," what kind of conversation
// is currently available with Polonius? His mood and what's known
// gate the menu.
function poloniusFaceNode(p) {
  if (p.flags._mask_on === false) return 'f_dropped';
  if (p.flags._heard_truth) return 'f_about_the_card';
  if (p.flags._aware_locked) return 'f_demand_card';
  return 'f_polite';
}

// ─── Suspicion gates ──────────────────────────────────────────────────
//
// The player starts the encounter with no reason to suspect Polonius.
// Defensive choices ("decline the tea," "ask for the card back,"
// "demand to leave," "find a weapon") are gated behind these helpers.
// Choices that move the conversation laterally — observation, polite
// inquiry, exploring the room — are always available.
//
// noticed: at least one specific observation has set off a quiet wrong-
//          ness flag. Unlocks the gentler doubt-choices (asking for the
//          card back politely, declining tea, suggesting they leave).
//
// wondering: enough has accumulated that the guest is openly uncertain.
//            Unlocks demanding the card, pressing on contradictions,
//            attempting to leave.
//
// fighting: the host has admitted enough that the polite frame is gone.
//           Unlocks violence, the FREE path, the open confrontations.

const POLONIUS_OBSERVATIONS = [
  '_obs_clock_no_hands', '_obs_painting_anachronism', '_obs_wallpaper_too_new',
  '_obs_bust_old', '_obs_decanter_full', '_obs_no_breath', '_obs_wrong_corners',
  '_named_hands', '_noticed_chair_warm', '_saw_old_paper', '_saw_guest_book',
  '_saw_previous_guest', '_heard_origin', '_heard_how_long', '_heard_count',
  '_saw_maid_blur', '_saw_maid_lie',
];

function poloniusNoticed(p) {
  return POLONIUS_OBSERVATIONS.some(f => p.flags[f]) || p.scales.unease >= 5;
}

function poloniusWondering(p) {
  const c = POLONIUS_OBSERVATIONS.filter(f => p.flags[f]).length;
  return c >= 2 || p.scales.unease >= 8
      || p.flags._heard_truth || p.flags._mask_on === false
      || p.flags._heard_warning || p.flags._heard_curse_rule;
}

function poloniusFighting(p) {
  return !!(p.flags._heard_truth || p.flags._mask_on === false
         || p.flags._heard_curse_rule || p.flags._heard_warning
         || p.flags._heard_full_plan || p.scales.unease >= 12);
}

const polonius = {
  id: 'polonius',
  name: 'Polonius',
  glyph: 'Hollowoak',
  subtitle: 'A young man, indoors. He has been here a very long time.',
  role: 'wing', tier: 1,

  file: [
    'Subject entered the register on [[8]] — the same day, the same ink, as the order annexing the Greek Wing. The two lines were written without lifting the pen.',
    'He is the sole declared **tenant**. Three staff attend him. They draw no wages. ~~They are not staff.~~ They are not on any payroll.',
    'Standing order: !!no patient is to enter the Greek Wing.!! The wing door reads the admission card. There is no handle on the inside.',
    'Staff who entered in pairs came back unable to account for the hours. The hours appear on their timesheets regardless, in a hand that is not theirs.',
    'Staff who have entered alone ~~have not returned~~ have not returned the same.',
    'Subject answers to Polonius. The file lists prior names. The list continues onto a second page, and the second page is older than the file.',
  ],

  intro: [
    'I press my admission card to the brass slot. The slot reads it. The lock clicks. The door swings open.',
    'The hall beyond is warm. The walls are panelled in dark wood; the wallpaper is dark green velvet. Brass sconces with oil lamps. The smell is wax and old wood. A small fire in a grate to my left.',
    'A young man is in the foyer, by the fire. He is well-dressed in a way that has gone out of fashion. He turns toward the door as I come in.',
    'Welcome, sir, he says. He has a kind, attentive smile. The smile is on time with the voice. I had not expected company tonight.',
  ],

  scales: {
    tiredness: {
      initial: 2, min: 0, max: 20, label: 'tiredness', kind: 'positive',
      bands: [
        { at: 0,  word: 'awake' },
        { at: 4,  word: 'comfortable' },
        { at: 8,  word: 'drowsy' },
        { at: 12, word: 'heavy' },
        { at: 16, word: 'sliding' },
        { at: 19, word: 'falling' },
      ],
      crossUp: {
        2: 'My shoulders have dropped without my deciding to drop them.',
        3: 'I rub my eyes. They want to stay shut.',
        4: '!!I can hear my own pulse. It is slower than it should be.!!',
        5: '!!I am losing the thread of this. The room is going dim at the edges.!!',
      },
      crossDown: {
        4: 'I shake my head clear.',
        3: 'My eyes open all the way.',
        2: 'I am awake. I am awake.',
      },
    },
    intimacy: {
      initial: 0, min: 0, max: 20, label: 'his attention', kind: 'positive',
      bands: [
        { at: 0,  word: 'a guest' },
        { at: 4,  word: 'noticed' },
        { at: 8,  word: 'engaged' },
        { at: 12, word: 'studied' },
        { at: 16, word: 'preferred' },
        { at: 19, word: 'chosen' },
      ],
      crossUp: {
        2: 'He is watching me a little longer than feels right.',
        3: 'He has not looked away in some time.',
        4: '!!He knows the shape of my breathing.!!',
        5: '!!He is reading me.!!',
      },
    },
    unease: {
      initial: 2, min: 0, max: 20, label: 'the wrongness', kind: 'negative',
      bands: [
        { at: 0,  word: 'nothing' },
        { at: 4,  word: 'noticing' },
        { at: 8,  word: 'sure' },
        { at: 12, word: 'certain' },
        { at: 16, word: 'animal' },
        { at: 19, word: 'fleeing' },
      ],
      crossUp: {
        2: 'Something about him does not move quite the way it should.',
        3: 'I have caught two things now. The third would not surprise me.',
        4: '!!This is not a young man. Not entirely.!!',
        5: '!!Whatever he is, he is older than the room.!!',
      },
    },
  },

  initialize(p, player) {
    p.scales.tiredness = 2;
    p.scales.intimacy  = 0;
    p.scales.unease    = 2;
    p.flags.room = 'foyer';
    // Hidden state — drives selectors. Player never sees these unless a
    // beat surfaces them.
    p.flags._mood = 'charming';
    p.flags._mask_on = true;
    // The card is the goal. See poloniusCardLine for the read.
    p.flags._card_location = 'pocket';
    p.flags._card_taken = false;
    p.flags._card_known = false;
  },

  fileReveals: [
    { at: 6,  announce: 'A line fills in. Subject was added to the register the day the Greek Wing was annexed.' },
    { at: 14, announce: 'Another. The house staff are on no payroll.' },
    { at: 22, announce: '!!The wing door reads the admission card. There is no handle on the inside.!!' },
    { at: 32, announce: 'The last line fills in. Staff who have entered alone ~~have not returned~~ have not returned the same.' },
  ],

  // The whole encounter takes place inside a single beat-graph. The hub
  // state never changes; presented() varies by current room flag and the
  // card's current location.
  hubState() { return 'inside'; },

  presented(p, hub) {
    const room = p.flags.room || 'foyer';
    // Default room descriptions are neutral — old-fashioned but pleasant.
    // Once the player has begun to notice oddities, the descriptions
    // pick up the textures that match. Until then the house reads as a
    // well-kept Victorian wing, slightly out of step with the rest of
    // the hospital, but no more.
    const noticed = poloniusNoticed(p);
    const desc = {
      foyer:      noticed
        ? 'The foyer is panelled in dark wood. A coat-tree by the door. A grandfather clock against the wall with no hands on its face. The room is the same size it was an hour ago, and yet it feels smaller.'
        : 'The foyer is panelled in dark wood. A coat-tree by the door. A grandfather clock against the wall. A small fire in an iron grate. The wallpaper is dark green velvet, and the room is warm.',
      parlor:     noticed
        ? 'The parlor is hot. The fire has been burning a long time. Two armchairs face it. A decanter on a side table. An iron poker by the grate. The bronze bust on the mantel is older than the room.'
        : 'The parlor is warm. The fire is small. Two armchairs face it. A decanter on a side table. A bronze bust on the mantel. An iron poker leaning against the grate.',
      library:    'Floor to ceiling shelves. Books bound in calf, in cloth, in older things. A reading lamp is lit. A lectern in the middle of the room.',
      gallery:    'A narrow hall hung with portraits — men and women in clothes from every century. The last frame on the row is empty.',
      clock_hall: 'A hall with a tall clock at its end. The pendulum is swinging. The face has no hands. Two corridors branch off the hall, leading to back rooms.',
      dining:     'A long table set for two. The places are arranged. The candles are burning. The cook stands in the doorway in his apron.',
      hall:       'A corridor lined with closed doors. The wallpaper deepens as the corridor lengthens.',
      bedroom:    'A guest room. The bed is turned down. The window is bricked but painted to look like a window. The painting depicts a night sky I do not recognise.',
      kitchen:    'The kitchen. A great range. A block of knives. A door to a pantry. The cook is at the range. There is a second narrower door set into the back wall.',
      cloakroom:  'A small cloakroom at the back of the house. Three coat-hooks. A shelf above the rod.',
      study:      'A small study. A desk. A bookshelf of ledgers. A locked drawer. A window painted to look like a window.',
      cellar:     'A wine cellar. Cold. Rows of bottles, stoppered in old wax. A low shelf at the back wall.',
    }[room] || 'A room in the house.';

    const cardLine = poloniusCardLine(p);

    // Polonius's read shifts with what the player has noticed. The
    // default frame is polite-host. Direct alarm comes only when the
    // mask drops, very late in the encounter.
    let tail = '';
    if (p.flags._mask_on === false) {
      tail = ' !!He has stopped pretending.!!';
    } else if (poloniusFighting(p)) {
      tail = ' He is being polite, still. He has been polite for a long time.';
    } else if (poloniusWondering(p)) {
      tail = ' He is watching me with the small attention of a host with one guest.';
    } else if (poloniusNoticed(p)) {
      tail = ' He is polite. There is something about the way he stands.';
    } else {
      tail = ' He is being a host.';
    }
    // The card-line is only included once the player knows it's gone.
    // Earlier in the encounter the card is still on the player and the
    // line is just noise.
    const surfaceCard = p.flags._card_known || p.flags._card_location === 'pocket' || p.flags._card_location === 'recovered' || p.flags._card_location === 'ash';
    return surfaceCard && cardLine ? (desc + ' ' + cardLine + tail) : (desc + tail);
  },

  startSpoke: 'main',

  // ─────────────────────────────────────────────────────────────────────
  //  THE BEAT GRAPH
  // ─────────────────────────────────────────────────────────────────────
  spokes: {
    main: {
      label: 'in the house',
      entry: 't_arrival',
      nodes: {

        // ═════════════════════════════════════════════════════════════
        //  CLUSTER: THRESHOLD — the polite welcome
        //
        //  The player arrives. Polonius is a charming host. The default
        //  prose is neutral — old-fashioned but well-kept, warm not
        //  cold, attentive not predatory. Choices are lateral: which
        //  small-talk thread to follow, what to look at, who to ask
        //  about. There are no "stay near the door" or "do not let him
        //  see you" framings here. The player has not yet been given
        //  any reason to suspect.
        //
        //  Suspicion is earned, beat by beat, through observation
        //  choices — examining the clock, looking at the painting,
        //  noticing the wallpaper. Each observation sets a flag and
        //  ticks unease. Some unlock conversation directions.
        //
        //  The cluster exits to m_parlor (the inner room) where the
        //  card-register beat lives.
        // ═════════════════════════════════════════════════════════════

        t_arrival: {
          lines: [
            'He inclines his head. Polonius, sir. The wing has been quiet a long while. You will forgive the formal welcome — we do not get many visitors on this corridor.',
            'He gestures, with a polite open hand, toward the inner doorway. Come in. The parlor is warmer than the foyer, and there is a kettle on.',
          ],
          choices: [
            { label: 'thank him; step inside', goto: 't_step_inside' },
            { label: 'ask his name back, and the wing\'s', goto: 't_his_name' },
            { label: 'look around the foyer first', goto: 't_look_around' },
          ],
        },

        t_his_name: {
          lines: [
            'I say: I have not had your name, sir. Polonius is a — a Greek name?',
            'He brightens. He gives a small, formal bow. Polonius. Yes. The Greek of it has held up a long time. The rest is less interesting than the name.',
            'He smiles. I would offer my hand, sir, but I have been told my hands are cold this evening. I will spare you the courtesy.',
            'He gestures again to the inner doorway. Come in. We can be more comfortable.',
          ],
          flags: { _name_evasion: true },
          scales: { intimacy: +1 },
          choices: [
            { label: 'ask what wing this is', goto: 't_where_am_i' },
            { label: 'look around the foyer first', goto: 't_look_around' },
            { label: 'thank him; step inside', goto: 't_step_inside' },
          ],
        },

        t_where_am_i: {
          lines: [
            'I say: I have not been on this corridor. What wing is this.',
            'He inclines his head. The Greek Wing, sir. It is annexed to the south of the hospital. The wing is not on the printed maps — it has the quality of having always been here without quite being noted.',
            'He pauses, fond. The house is older than the hospital. The hospital was built around it. I am the only resident.',
            'He gestures to the inner doorway. But — come in. I would not keep a guest in a hallway.',
          ],
          flags: { _heard_wing_history: true },
          scales: { intimacy: +1 },
          choices: [
            { label: 'press him on the history of the house', goto: 't_house_age' },
            { label: 'look around the foyer first', goto: 't_look_around' },
            { label: 'thank him; step inside', goto: 't_step_inside' },
          ],
        },

        t_house_age: {
          lines: [
            'I say: how old is the house, then.',
            'A long time, sir. The wing has been here in various forms since the first hospital chapel was attached. The house was moved here originally — a man with the means to move a house had it moved.',
            'He smiles, with a small fondness. A very long time ago.',
            'He says ~~a very long time ago~~ the way one says it about a thing one no longer counts in years.',
          ],
          flags: { _heard_house_old: true, _heard_origin: true },
          scales: { intimacy: +1, unease: +1 },
          choices: [
            { label: 'thank him; step inside', goto: 't_step_inside' },
            { label: 'who had the means to move a house', goto: 't_who_moved_house' },
            { label: 'look around the foyer first', goto: 't_look_around' },
          ],
        },

        t_who_moved_house: {
          lines: [
            'I say: who moves a house.',
            'He shrugs — the easy shrug of a man who has half-forgotten the answer.',
            'A man of means, sir. The name has held up less well than mine. He had it taken apart in beam-numbered pieces and re-set, by a small army of stonemasons, where you are standing now. I am told the masons were paid in gold.',
            'He smiles. The masons did not come back for second commissions. The wages may have been once-only.',
          ],
          flags: { _heard_origin: true },
          scales: { intimacy: +1, unease: +1 },
          choices: [
            { label: 'thank him; step inside', goto: 't_step_inside' },
            { label: 'look around the foyer first', goto: 't_look_around' },
          ],
        },

        t_why_added: {
          lines: [
            'I say: how did the wing come to be annexed.',
            'He brightens. The wing has been here since the second hospital was built. Or the third. I do not remember which. The hospital has been built around the house in pieces. Each renovation absorbed the wing a little further. By the present arrangement, the wing is reached only by one corridor — the one you have come down.',
            'He pauses. He looks at me with attention. He is not the kind of man who has trouble paying attention.',
            'Most visitors arrive without quite having decided to. The corridor is a quality of the house.',
          ],
          flags: { _heard_wing_history: true, _heard_corridor_draws: true },
          scales: { intimacy: +1 },
          choices: [
            { label: 'thank him; step inside', goto: 't_step_inside' },
            { label: 'look around the foyer first', goto: 't_look_around' },
          ],
        },

        t_look_around: {
          lines: [
            'I take in the foyer. Dark wood paneling. A coat-tree to the side of the door. A grandfather clock against the wall, polished, with no dust on it. A small fire in an iron grate. Above the fire: a small painting in an old gold frame. The wallpaper is dark green velvet, with a small repeating laurel pattern.',
            'Polonius waits. He has the patience of a host who is glad to be looked at slowly.',
          ],
          choices: [
            { label: 'examine something in the room', goto: 't_examine' },
            { label: 'ask him about something you noticed', goto: 't_ask_about_noticed', when: (p) => poloniusNoticed(p) },
            { label: 'thank him; step inside', goto: 't_step_inside' },
          ],
        },

        t_examine: {
          // Observation sub-menu — gathered so the look-around beat
          // does not surface too many choices at once. Each option is
          // gated on its observation-flag, so the menu shrinks as the
          // player notices things.
          lines: [
            'I let my eye go where it wants.',
          ],
          choices: [
            { label: 'the grandfather clock', goto: 't_obs_clock', when: (p) => !p.flags._obs_clock_no_hands },
            { label: 'the painting above the fire', goto: 't_obs_painting', when: (p) => !p.flags._obs_painting_anachronism },
            { label: 'the door behind you', goto: 't_obs_door_behind', when: (p) => !p.flags._obs_door_no_handle },
            { label: 'never mind; look elsewhere', goto: 't_look_around' },
          ],
        },

        t_obs_clock: {
          lines: [
            'I cross to the grandfather clock. The case is dark oak, polished. The pendulum is swinging. I can hear the mechanism wound, very quietly, in the case.',
            'I look at the face. The face has no hands. The numerals are there. The brass centre, where the hands should be set, is plain.',
            'I look back at Polonius. He has not remarked on it. He is watching me with polite interest.',
          ],
          flags: { _obs_clock_no_hands: true },
          scales: { unease: +2 },
          choices: [
            { label: 'ask him about the clock', goto: 't_ask_clock' },
            { label: 'continue looking around', goto: 't_look_around' },
            { label: 'step inside', goto: 't_step_inside' },
          ],
        },

        t_ask_clock: {
          lines: [
            'I say: the clock has no hands.',
            'Polonius nods, fond. The clockmaker took the hands off himself, sir. He said it made the time easier to bear. I never had the heart to put them back.',
            'He pauses. He says the line the way one says a line one has said before. He does not say it the way one says it about a clockmaker one knew.',
          ],
          flags: { _heard_how_long: true },
          scales: { unease: +1, intimacy: +1 },
          choices: [
            { label: 'continue looking around', goto: 't_look_around' },
            { label: 'step inside', goto: 't_step_inside' },
          ],
        },

        t_obs_painting: {
          lines: [
            'I look at the painting. A hillside, gentle, ochre, late afternoon. A man and a small white dog in the foreground.',
            'I look at the man. The man is in a chiton — a Greek tunic, the kind I have seen on red-figure pottery. Not the kind I would expect in a Victorian frame.',
            'I look at the brushwork. The brushwork is Victorian. The painting is recent. The clothing is not.',
            'Polonius, behind me: Most do not stop in front of that one, sir. The hills are in southern Greece. The dog was real, once.',
          ],
          flags: { _obs_painting_anachronism: true, _heard_origin: true },
          scales: { unease: +2, intimacy: +1 },
          choices: [
            { label: 'continue looking around', goto: 't_look_around' },
            { label: 'step inside', goto: 't_step_inside' },
          ],
        },

        t_obs_wallpaper: {
          lines: [
            'I run my fingertip along the wallpaper. Dark green velvet. The pattern is a small repeating laurel. The velvet has the soft sheen of fabric that has been brushed often.',
            'I look for the seam between two strips. The seam is straight. I look for another. I cannot find one.',
            'A house this old should have seams I can see. The wallpaper is old in pattern and not in age.',
          ],
          flags: { _obs_wallpaper_too_new: true },
          scales: { unease: +1 },
          choices: [
            { label: 'continue looking around', goto: 't_look_around' },
            { label: 'step inside', goto: 't_step_inside' },
          ],
        },

        t_obs_coat_tree: {
          lines: [
            'I cross to the coat-tree. The wood is dark, polished, old. There are three pegs and a small mirror set into the upright. The mirror is the size of a hand.',
            'There are no coats on the pegs. I look at the floor where a coat would drip. The floor is dry.',
            'I look at the mirror. The mirror shows the foyer, and Polonius, and me. He is looking at the back of my head with the kind of attention I associate with people who like to look.',
          ],
          flags: { _obs_coat_tree: true },
          scales: { unease: +1 },
          choices: [
            { label: 'continue looking around', goto: 't_look_around' },
            { label: 'step inside', goto: 't_step_inside' },
          ],
        },

        t_obs_door_behind: {
          lines: [
            'I look back at the door I came through. The brass slot is at chest height. Below it, the wood is the wood of the door.',
            'I do not see a handle on this side. The door is set into the wallpaper with no visible mechanism for opening.',
            'I bring my hand to the slot. The slot is the kind a card slides into. It is the only mechanism on this side.',
            'Polonius, behind me: The door reads, sir. It does not turn. The house has been particular about its door for a long time. The card, when one has it, is sufficient.',
          ],
          flags: { _obs_door_no_handle: true, _aware_slot: true, _aware_card_needed: true },
          scales: { unease: +2 },
          choices: [
            { label: 'continue looking around', goto: 't_look_around' },
            { label: 'step inside', goto: 't_step_inside' },
          ],
        },

        t_obs_hands_asked: {
          lines: [
            'I say: cold hands?',
            'He looks down at his own hands as if surprised to find them folded in front of himself.',
            'A small thing, sir. The fire in this room is not what it once was. Cold hands in a warm room. The house gets its quirks after some time.',
            'He says ~~quirks~~ with a small fond emphasis, as one says a word one keeps polished.',
          ],
          flags: { _named_hands: true },
          scales: { unease: +1, intimacy: +1 },
          choices: [
            { label: 'thank him; step inside', goto: 't_step_inside' },
            { label: 'look around the foyer', goto: 't_look_around' },
          ],
        },

        t_ask_about_noticed: {
          // A general-purpose follow-up that branches to whichever
          // observation the player has recently made. The conversation
          // surfaces only the most pointed one.
          lines: [
            'I let my eyes rest on him for a beat. He waits, attentive.',
          ],
          choices: [
            {
              label: 'the clock — it has no hands',
              when: (p) => p.flags._obs_clock_no_hands && !p.flags._heard_how_long,
              goto: 't_ask_clock',
            },
            {
              label: 'the painting — the chiton is much older than the frame',
              when: (p) => p.flags._obs_painting_anachronism,
              goto: { to: 't_look_around', lines: ['I say: the painting. The man is in a chiton. The frame is Victorian.', 'He nods, fond. You have a good eye, sir. The painting was made for the man who lives in it. He is — he was — a friend of the house. The frame I had made later.', '~~Made for the man who lives in it.~~'], flags: { _heard_origin: true }, scales: { intimacy: +1, unease: +1 } },
            },
            {
              label: 'the wallpaper — it is too new',
              when: (p) => p.flags._obs_wallpaper_too_new,
              goto: { to: 't_look_around', lines: ['I say: the wallpaper. There are no seams. A house this old should have seams.', 'He smiles. Mrs. Halliwell is meticulous, sir. She re-hangs the wallpaper. She has done so for a long time. I have not had the heart to ask how often.'], scales: { intimacy: +1, unease: +1 } },
            },
            {
              label: 'the cold hands',
              when: (p) => !p.flags._named_hands,
              goto: 't_obs_hands_asked',
            },
            {
              label: 'never mind; step inside',
              goto: 't_step_inside',
            },
          ],
        },

        t_step_inside: {
          lines: [
            'I step through the inner doorway. He follows behind me, then ahead — the smooth way of a host showing a guest in.',
            'The corridor between the foyer and the parlor is short. The wallpaper continues. The lamps continue.',
          ],
          choices: [
            { label: 'continue', goto: 'm_parlor' },
          ],
        },

        // ═════════════════════════════════════════════════════════════
        //  CLUSTER: MEETING — the parlor, and the consensual register
        //
        //  Polonius leads the player into the parlor. The maid is in
        //  the doorway, polite. The chair is offered. The player sits
        //  (or stands, or compliments the room, or examines a small
        //  thing on the mantel). All paths converge on the register
        //  beat — Polonius produces a small ledger and asks for the
        //  admission card, with the courtesy of an old wing keeping
        //  an old book. The player hands it over the way a guest at
        //  a country house hands a card to the butler at the door:
        //  reflexively, politely, without alarm.
        //
        //  Mrs. Halliwell takes the card to the cloakroom. Tea is
        //  poured. The conversation can wander — many lateral choices,
        //  many small observations to surface oddities. The "I think
        //  I should be going" choice is the bridge to LOSS, and it is
        //  visible once the player has accumulated enough turns or
        //  observations to feel ready to leave.
        // ═════════════════════════════════════════════════════════════

        m_parlor: {
          lines: [
            'The parlor is small and warm. A fire in an iron grate. Two armchairs face it. A side table with a decanter of dark wine. A bronze bust on the mantel. An iron poker leaning against the grate.',
            'A young woman is in the inner doorway, smiling. Polonius gestures to her, gracious. Mrs. Halliwell, sir — the household maid. She has been with the wing a long while.',
            'She inclines her head. Sir. Her voice is small and warm.',
            'Polonius gestures to one of the armchairs. Please. The fire is warmer when one sits.',
          ],
          flags: { room: 'parlor' },
          choices: [
            { label: 'thank him; take the chair', goto: 'm_sit' },
            { label: 'remain standing; thank him for the welcome', goto: 'm_stand' },
            { label: 'thank Mrs. Halliwell by name', goto: 'm_thank_maid' },
          ],
        },

        m_thank_maid: {
          lines: [
            'I turn to her. Thank you, Mrs. Halliwell.',
            'She brightens — a small, real brightening. Her smile changes shape for a moment.',
            'You are very welcome, sir. It is a pleasure to have a guest. The wing is quiet.',
            'Polonius, fond: Mrs. Halliwell is partial to a guest. We do not get many.',
          ],
          flags: { _thanked_maid: true },
          scales: { intimacy: +1 },
          composure: +1,
          composureGain: 'I greeted her by name. He had wanted to do that for me.',
          choices: [
            { label: 'sit by the fire', goto: 'm_sit' },
            { label: 'compliment the parlor', goto: 'm_compliment_room' },
            { label: 'examine the bronze bust', goto: 'm_obs_bust' },
          ],
        },

        m_compliment_room: {
          lines: [
            'I say: this is a beautiful room.',
            'Polonius brightens. Thank you, sir. The parlor has had its small ornaments collected over a long while. The bust on the mantel — that is the wing\'s oldest fixture. The wallpaper Mrs. Halliwell keeps. The fire I keep. We divide the labour.',
            'He smiles. We have had a long time to arrange things.',
            '~~A long time. He is being more honest than he means to be.~~',
          ],
          flags: { _heard_long_time: true },
          scales: { intimacy: +2, unease: +1 },
          choices: [
            { label: 'sit by the fire', goto: 'm_sit' },
            { label: 'examine the bronze bust', goto: 'm_obs_bust' },
          ],
        },

        m_obs_bust: {
          lines: [
            'I cross to the mantel. The bust is small, bronze, dark with age and the smoke of many small fires. The face is a young man with a laurel wreath, looking out and slightly down with the small smile of someone being looked at.',
            'I look at the laurel. I look at the face. I look at the face again.',
            'The face is Polonius.',
            'I look at his face, across the room. The two faces are the same face. The bust is older than Victorian. The bust is older than the room. The bust is the face of a man I am in the room with.',
            'Polonius, behind me, says, gently: a vanity. A young man\'s. I had it made a long time ago. Mrs. Halliwell tells me I should retire it.',
            'He smiles. The smile is the same as the smile on the bronze.',
          ],
          flags: { _obs_bust_old: true, _heard_origin: true, _heard_how_long: true },
          scales: { unease: +3, intimacy: +1 },
          composure: -1,
          composureCost: 'The bust is the face of a man I am in the room with.',
          choices: [
            { label: 'sit by the fire', goto: 'm_sit' },
            { label: 'compliment the parlor', goto: 'm_compliment_room', when: (p) => !p.flags._heard_long_time },
          ],
        },

        m_stand: {
          lines: [
            'I say: I am content to stand a moment. Thank you for the welcome.',
            'Polonius nods, gracious. Of course, sir. We need not stand on form. Mrs. Halliwell will bring the tea regardless.',
            'He gestures to a side table where a small leather-bound ledger and a fountain pen sit, with a polite ceremony.',
            'May I attend to the small formality, sir — the wing\'s register. We note all visitors, by an old tradition.',
            'He looks up, attentive, with the open hand of a man asking for a card.',
          ],
          choices: [
            { label: 'give him the card', goto: 'm_card_given' },
            { label: 'ask about the register', goto: 'm_about_register' },
            { label: 'ask why a register is needed', goto: 'm_why_register' },
          ],
        },

        m_sit: {
          lines: [
            'I sit. The cushion gives the right amount. The chair holds me firmly without being firm.',
            'Polonius takes the chair opposite. He moves with the unhurried grace of a host. He reaches to a side table and produces a small leather-bound ledger and a fountain pen.',
            'Forgive me, sir — the small formality. The wing keeps a register of all who visit, by an old tradition. May I have your admission card to note the number?',
            'He extends an open hand. Polite, attentive, patient.',
          ],
          flags: { room: 'parlor' },
          scales: { intimacy: +1 },
          choices: [
            { label: 'give him the card', goto: 'm_card_given' },
            { label: 'ask about the register first', goto: 'm_about_register' },
            { label: 'ask to see the previous entries first', goto: 'm_see_register' },
          ],
        },

        m_about_register: {
          lines: [
            'I say: a register — what does it record.',
            'He smiles. Names, sir. Dates. The number off the card, in the older entries, and the patient number in the newer. A small column for any note one chooses to leave.',
            'He turns the ledger toward me. The page is set with neat lines, in a careful old hand. Eight or nine entries on this page, in different inks. The most recent entry is dated two months past.',
            'He has not yet asked me to look. He waits for the card.',
          ],
          flags: { _heard_register: true },
          scales: { intimacy: +1 },
          choices: [
            { label: 'give him the card', goto: 'm_card_given' },
            { label: 'look at the entries more closely', goto: 'm_see_register' },
            { label: 'ask why a register is needed', goto: 'm_why_register' },
          ],
        },

        m_why_register: {
          lines: [
            'I say: why does the wing keep a register.',
            'He inclines his head. An old tradition, sir. The wing has kept one since the house was first attached to the hospital. Mr. Halliwell — the butler — would have it that the wing has always been a place where visitors were named. I keep the tradition because — he smiles — there is little for me to do besides keep traditions.',
            'He waits, patient, with the open hand.',
          ],
          scales: { intimacy: +1 },
          choices: [
            { label: 'give him the card', goto: 'm_card_given' },
            { label: 'look at the previous entries', goto: 'm_see_register' },
          ],
        },

        m_see_register: {
          lines: [
            'I lean over and look at the ledger. The entries are in different hands and different inks. The most recent is from two months ago — a name I do not know, in a fresh blue ink.',
            'Above it, the entry before is from twenty years ago, in black. Above that, from forty. Above that, sixty.',
            'I turn back a page. The dates run backward steadily. There is a name from the early twentieth century. A name from the nineteenth. The handwriting in the older entries is — looking at the loops, the curl of the f — the same hand that wrote the most recent.',
            'Polonius, watching me read, smiles. The wing has only had the one register-keeper, sir. I have had the time to keep it neatly.',
          ],
          flags: { _saw_register_old: true, _heard_origin: true, _heard_how_long: true, _saw_guest_book: true },
          scales: { unease: +3, intimacy: +1 },
          composure: -1,
          composureCost: 'The handwriting is the same hand, in inks from different centuries.',
          choices: [
            { label: 'give him the card; finish the formality', goto: 'm_card_given' },
            { label: 'ask why he has been here so long', goto: 'm_ask_how_long' },
            {
              label: 'actually — I would prefer to keep the card on me',
              goto: 'm_decline_card',
              when: (p) => poloniusWondering(p),
            },
          ],
        },

        m_ask_how_long: {
          lines: [
            'I say: how long have you been keeping the register.',
            'He looks down at the open page. The pause is a small one. He does not, I notice, breathe through it.',
            'A long time, sir. I am the wing\'s resident — the only one. The hospital is told there is a single tenant in the Greek Wing, and the single tenant is myself.',
            'He smiles. The smile is small and a little tired.',
            'I do not know that I have been counting in years for some while.',
          ],
          flags: { _heard_origin: true, _heard_how_long: true, _obs_no_breath: true },
          scales: { unease: +3, intimacy: +2 },
          composure: -2,
          composureCost: 'He did not breathe through the pause.',
          choices: [
            { label: 'give him the card; finish the formality', goto: 'm_card_given' },
            {
              label: 'actually — I would prefer to keep the card on me',
              goto: 'm_decline_card',
              when: (p) => poloniusWondering(p),
            },
          ],
        },

        m_card_given: {
          lines: [
            'I take the admission card from my pocket. I hand it to him.',
            'He takes it with both hands, the small old-fashioned courtesy of a man receiving a calling card. He turns it once, looks at the number, and copies the number into the ledger with the fountain pen. His handwriting is small and neat.',
            'There. He blots the ink with a small square of felt. Mrs. Halliwell — to the cloakroom shelf, with the visitors\' coats. We will not want the card to wander.',
            'Mrs. Halliwell crosses to the side table. She takes the card from his open hand. She is gone through the inner doorway before I have asked where the cloakroom is.',
            'Polonius smiles. The formalities are done, sir. May I offer you tea? The kettle is on.',
          ],
          flags: {
            _card_taken: true,
            _card_location: 'cloakroom',
            _card_known: true,
            _gave_card_willingly: true,
            _heard_card_in_cloakroom: true,
            _heard_register: true,
          },
          scales: { intimacy: +2 },
          // No unease tick: the player has consented to a polite,
          // reasonable formality. The card-position is now noted in
          // the presented() line, but the prose carries no alarm.
          choices: [
            { label: 'thank him; yes, tea', goto: 'm_tea' },
            { label: 'no tea — but happy to sit', goto: 'm_no_tea' },
            { label: 'compliment the parlor', goto: 'm_compliment_room', when: (p) => !p.flags._heard_long_time },
            { label: 'examine the bronze bust', goto: 'm_obs_bust', when: (p) => !p.flags._obs_bust_old },
          ],
        },

        // A gated alternative — only the alert player picks this. The
        // wing requires a tenant, so Polonius's polite version of the
        // ceremony does not stop here. Instead, the maid takes the
        // card later — through the tea-tray hand-off — and the player
        // discovers that without their consent.
        m_decline_card: {
          lines: [
            'I say: I would prefer to keep the card on me, sir, if it is all the same.',
            'He looks up. He looks at me for a length of time I do not measure. The smile does not change, but the eyes settle on me with a small new attention.',
            'Of course, sir. Of course. The formality is not strict. Mrs. Halliwell — leave the ledger. We will note the number later, by sight if the gentleman prefers.',
            'He closes the ledger. He sets it on the side table. The pen returns to its stand.',
            'But — the kettle is on. May I at least offer the tea?',
          ],
          flags: { _refused_register: true },
          scales: { intimacy: -1, unease: +2 },
          composure: +1,
          composureGain: 'I did not give him the card.',
          choices: [
            { label: 'thank him; yes, tea', goto: 'm_tea_with_card' },
            { label: 'I will skip the tea', goto: 'm_no_tea_with_card' },
          ],
        },

        // ── Tea-tray theft path (only reached if the player declined
        //    the register).
        m_tea_with_card: {
          lines: [
            'A tray appears on the side table. The butler is bowing as he sets it down. I did not see him come in.',
            'Two cups. Two saucers. Tea, Polonius says. It is already poured. I anticipated.',
            'The butler\'s sleeve brushes my knee as he pours, very lightly. He apologises with a small bow. The cup is in my hand before I have reached for it.',
            'Mrs. Halliwell is by the door. She is smiling. There is a small pale thing in her apron pocket. I do not, immediately, recognise it.',
            '~~The butler\'s sleeve. My pocket. The card is no longer in my pocket.~~',
          ],
          flags: {
            _card_taken: true,
            _card_location: 'maid',
            _card_known: true,
            _butler_palmed: true,
            _heard_card_in_cloakroom: true,
          },
          scales: { unease: +4, intimacy: +1 },
          composure: -2,
          composureCost: 'The butler\'s sleeve was at my pocket.',
          choices: [
            { label: 'continue', goto: 'm_tea' },
          ],
        },

        m_no_tea_with_card: {
          lines: [
            'I say: no tea, thank you. I am content as I am.',
            'He nods, gracious. As you wish, sir. Mrs. Halliwell — the tray to the kitchen.',
            'She crosses to the side table to collect a tray that was not there. As she passes me, her hand brushes my coat. The brush is brief and careful. She does not look at me. She continues to the kitchen.',
            'I pat the pocket where the card was. The pocket is light.',
            '~~She did it on the way past. The tray was not there before she crossed.~~',
          ],
          flags: {
            _card_taken: true,
            _card_location: 'maid',
            _card_known: true,
            _maid_palmed: true,
            _heard_card_in_cloakroom: true,
          },
          scales: { unease: +4, intimacy: -1 },
          composure: -2,
          composureCost: 'She did not look at me as she did it.',
          choices: [
            { label: 'continue', goto: 'm_smalltalk' },
          ],
        },

        m_no_tea: {
          lines: [
            'I say: no tea, thank you. I am content as I am.',
            'He nods, gracious. As you wish, sir. The kettle will keep. We can talk a while.',
          ],
          scales: { intimacy: -1 },
          composure: +1,
          composureGain: 'I did not feel obliged.',
          choices: [
            { label: 'continue', goto: 'm_smalltalk' },
          ],
        },

        m_tea: {
          lines: [
            'A tray appears on the side table. The butler is bowing as he sets it down. I did not see him come in.',
            'Two cups. Two saucers. Tea, Polonius says. It is already poured. I anticipated.',
          ],
          scales: { tiredness: +1 },
          choices: [
            {
              label: 'drink',
              goto: { to: 'm_smalltalk', lines: ['I drink. The tea is hot and slightly sweet and tastes of bergamot and something I cannot name.'], scales: { tiredness: +3, intimacy: +1 } },
            },
            {
              label: 'hold the cup a moment',
              goto: { to: 'm_smalltalk', lines: ['I hold the cup. The warmth comes up through the porcelain.'], scales: { tiredness: +1, intimacy: +1 } },
            },
            {
              label: 'thank him; set the cup aside',
              goto: { to: 'm_smalltalk', lines: ['I thank him and set the cup down on the side table. It cools. He does not remark on it.'], scales: { intimacy: -1 }, composure: +1, composureGain: 'I did not drink without thinking.' },
              when: (p) => poloniusNoticed(p),
            },
          ],
        },

        m_smalltalk: {
          lines: [
            'He sets his cup on his knee. He has the cup balanced on the kneecap, which is an old-fashioned manner — most modern men hold the cup in the hand.',
            'It is a pleasure, sir, to have company. We do not have many guests on this corridor. The house and I are accustomed to long evenings without a second voice.',
            'The fire crackles. The clock in the hall does not. There is no rain against any glass. I have not yet seen a window.',
          ],
          scales: { intimacy: +1 },
          choices: [
            { label: 'ask after the staff', goto: 'm_about_staff' },
            { label: 'ask about Polonius himself', goto: 'm_about_him' },
            { label: 'let your eye wander around the room', goto: 'm_look_around_parlor' },
            { label: 'I think I should be going', goto: 'l_should_go', when: (p) => poloniusNoticed(p) || (p.turn || 0) >= 4 },
          ],
        },

        m_about_staff: {
          lines: [
            'I say: the staff, sir. The Halliwells, and the cook.',
            'He brightens, fond. Mrs. Halliwell runs the foyer and the cloakroom and the tea-cups. Mr. Halliwell — her husband — sits the parlor in the evenings; he keeps the keys to the cloakroom on his person. Mr. Cook is at the dining room and the range.',
            'He pauses. They keep their own rooms. They cross paths only at the meals, by tradition. They reset with the morning.',
            'He stops. He had not meant to say the last sentence. He looks at me with the small honesty of a man caught out.',
          ],
          flags: { _heard_staff_routine: true, _heard_staff_resets: true, _heard_origin: true, _heard_keys_butler: true },
          scales: { intimacy: +2, unease: +3 },
          composure: -1,
          composureCost: 'They reset with the morning.',
          choices: [
            { label: 'press him on what that means', goto: 'm_about_him' },
            { label: 'let it pass; continue talking', goto: 'm_smalltalk' },
            { label: 'I think I should be going', goto: 'l_should_go' },
          ],
        },

        m_look_around_parlor: {
          // Observation sub-menu — gated so usually only two or three
          // are visible at a time. The most evocative obs (hands and
          // breathing) are the anchors.
          lines: [
            'I let my eye move around the room while he talks. The parlor has the carefully-arranged quality of a room that is kept, not lived in.',
          ],
          choices: [
            { label: 'look at his hands', goto: 'm_obs_hands', when: (p) => !p.flags._named_hands },
            { label: 'look at his cup, the decanter', goto: 'm_obs_decanter', when: (p) => !p.flags._obs_decanter_full },
            { label: 'count his breaths', goto: 'm_obs_no_breath', when: (p) => !p.flags._obs_no_breath },
            { label: 'look away; continue talking', goto: 'm_smalltalk' },
          ],
        },

        m_about_maid: {
          lines: [
            'I say: Mrs. Halliwell. How long has she been with the wing.',
            'He smiles. A long while. She came on, by the books, in a year I would not embarrass her by stating. She is a steady fixture. She runs the cloakroom and the doorways and the tea-cups, and she does not complain.',
            'He pauses, fond. She is, in her way, my closest friend. She does not remember our friendship in the morning. The mornings are difficult that way.',
            '~~She does not remember our friendship in the morning. He said it the way one says a small clinical fact.~~',
          ],
          flags: { _heard_maid_resets: true, _heard_origin: true },
          scales: { intimacy: +2, unease: +2 },
          composure: -1,
          composureCost: 'She does not remember in the morning.',
          choices: [
            { label: 'continue talking', goto: 'm_smalltalk' },
            { label: 'I think I should be going', goto: 'l_should_go', when: (p) => poloniusNoticed(p) },
          ],
        },

        m_about_butler: {
          lines: [
            'I say: Mr. Halliwell — the butler. The same family?',
            'He nods. Yes — Mr. and Mrs. Halliwell. They came on together, by the books. They keep separate hours by the day — he in the parlor, she in the foyer and the cloakroom, and the cook in the dining room. They cross paths only at the meals, by tradition.',
            'I pause on the way he says ~~by tradition~~. The way one says it about an arrangement that has held for too long to question.',
          ],
          flags: { _heard_staff_routine: true },
          scales: { intimacy: +1, unease: +1 },
          choices: [
            { label: 'continue talking', goto: 'm_smalltalk' },
            { label: 'I think I should be going', goto: 'l_should_go', when: (p) => poloniusNoticed(p) },
          ],
        },

        m_about_him: {
          lines: [
            'I say: and yourself, sir. What was it you did, before the wing.',
            'He looks at the fire for a moment. His face does the small careful arrangement of a man who has been asked the question many times and would like to give the answer he gave the first time.',
            'I was a guest, sir. I came into the house as a guest a long time ago. I was a young man with the means to travel. The house — the house was a house I came to for the night. I remained, in a manner of speaking.',
            'He smiles. The smile is small and tired. I do not get a great many questions about myself, sir. The ones I do get tend to be the same one.',
          ],
          flags: { _heard_origin: true },
          scales: { intimacy: +3, unease: +1 },
          choices: [
            { label: 'why did you stay', goto: 'm_why_stayed' },
            { label: 'continue talking', goto: 'm_smalltalk' },
            { label: 'I think I should be going', goto: 'l_should_go', when: (p) => poloniusNoticed(p) },
          ],
        },

        m_why_stayed: {
          lines: [
            'I say: why did you stay.',
            'He looks up at me. The look is long and patient and tired in a way that surprises me — the way one is surprised by a familiar face under stage lighting.',
            'I did not have a great deal of choice in the matter, sir.',
            'He returns to his cup. He has not drunk from it. The level is the same.',
            'It is an old story. I will not bore a guest with it on a first visit.',
            'He pauses. He looks at me. I would, however, like to hear what brought you onto the corridor. People do not arrive on this corridor by mistake, exactly. The corridor has its own logic.',
          ],
          flags: { _heard_origin: true, _heard_corridor_draws: true },
          scales: { intimacy: +3, unease: +2 },
          composure: -1,
          composureCost: 'He did not have a great deal of choice in the matter.',
          choices: [
            { label: 'tell him something true', goto: { to: 'm_smalltalk', lines: ['I tell him something — a small true thing. A thing about my mother. He drinks it in like wine.'], scales: { intimacy: +3 } } },
            { label: 'turn the question back to him', goto: 'm_smalltalk' },
            { label: 'I think I should be going', goto: 'l_should_go' },
          ],
        },

        m_obs_hands: {
          lines: [
            'I look at his hands, while he speaks. They are folded in his lap. They have not changed position since I came in. They are not the colour hands should be near a fire.',
            'He sees me see them. He places one hand over the other, slowly, as if the gesture had just been taught to him.',
            'Ah, yes, sir. The fire is not what it once was. Cold hands in a warm room. The house gets its quirks after some time.',
            '~~That is not why his hands are that colour.~~',
          ],
          flags: { _named_hands: true },
          scales: { unease: +2, intimacy: +1 },
          composure: -1,
          composureCost: 'That is not why his hands are that colour.',
          choices: [
            { label: 'continue talking', goto: 'm_smalltalk' },
            { label: 'I think I should be going', goto: 'l_should_go' },
          ],
        },

        m_obs_decanter: {
          lines: [
            'I look at the decanter on the side table. It is full. The wine in it is dark, and very old by the look of the wax on the stopper. There are two small glasses beside it. Both glasses are clean.',
            'I look at his cup. He has not drunk from his cup. He has not drunk from the decanter either, that I can see.',
            '~~He sets the cup on his knee. He brings it to his lip only to set it down again. He does not drink.~~',
          ],
          flags: { _obs_decanter_full: true },
          scales: { unease: +1 },
          choices: [
            { label: 'comment on it', goto: 'm_obs_he_doesnt_drink' },
            { label: 'continue talking', goto: 'm_smalltalk' },
          ],
        },

        m_obs_he_doesnt_drink: {
          lines: [
            'I say: you have not drunk from your cup.',
            'He looks down at the cup. He looks at me. He smiles, with the small embarrassment of a man caught in a small habit.',
            'No, sir. I have not. The tea is the maid\'s tradition; she will be hurt if it is not poured. The drinking I leave to my guests.',
            'He pauses. I have not had cause to drink tea in a long while. The taste of it has gone.',
          ],
          flags: { _obs_no_drink: true, _heard_origin: true },
          scales: { unease: +2, intimacy: +1 },
          choices: [
            { label: 'continue talking', goto: 'm_smalltalk' },
            { label: 'I think I should be going', goto: 'l_should_go' },
          ],
        },

        m_obs_chair_warm: {
          lines: [
            'I notice — without meaning to — that the cushion under me is warm. The warmth is not from the fire, which is to my side. The warmth is from the cushion itself.',
            'The cushion has the residual warmth of a body that sat in the chair very recently.',
          ],
          flags: { _noticed_chair_warm: true },
          scales: { unease: +2 },
          choices: [
            { label: 'ask who was sitting here', goto: 'm_who_warmed' },
            { label: 'continue talking', goto: 'm_smalltalk' },
          ],
        },

        m_who_warmed: {
          lines: [
            'I say: this chair has been warmed.',
            'He smiles. Mrs. Halliwell, sir. She warms the chairs at this hour. Every hour, in point of fact. She has been thorough for a long time.',
            '~~Mrs. Halliwell did not warm this seat. There is a slight imprint of weight where a head rested.~~',
          ],
          scales: { unease: +2 },
          flags: { _noticed_chair_warm: true },
          choices: [
            { label: 'continue talking', goto: 'm_smalltalk' },
            { label: 'I think I should be going', goto: 'l_should_go' },
          ],
        },

        m_obs_no_breath: {
          lines: [
            'I let my attention rest on him for a long moment. He is talking, then he is not — he has finished a sentence. He waits, polite, for me to speak.',
            'I count, while he waits. I count to ten. Then to twelve. Then to fifteen.',
            'His chest does not move. Not once. He is not breathing.',
            'When he speaks again, the words come, and his chest stays still.',
          ],
          flags: { _obs_no_breath: true },
          scales: { unease: +4 },
          composure: -2,
          composureCost: 'He had not been breathing for the entire time I was counting.',
          choices: [
            { label: 'do not let it show; continue talking', goto: { to: 'm_smalltalk', lines: ['I do not let it show. I keep my face the face I have.'], composure: +1, composureGain: 'My face did not give it away.' } },
            { label: 'I think I should be going', goto: 'l_should_go' },
          ],
        },

        // ═════════════════════════════════════════════════════════════
        //  CLUSTER: LOSS — the realisation
        //
        //  Entered when the player decides to leave. Polonius is
        //  courteous about it. He rings for the maid to bring the
        //  card from the cloakroom. The maid does not return at once.
        //  He apologises — the cloakroom is locked at this hour, the
        //  keys are with the butler, the butler is in the parlor.
        //  The player tries the door themselves and discovers there
        //  is no handle on the inside.
        //
        //  The shape of the trap becomes visible here. The cluster
        //  exits to hub_corridor with the player motivated to engage.
        // ═════════════════════════════════════════════════════════════

        l_should_go: {
          lines: [
            'I say: I think I should be going.',
            'Polonius looks up from his cup. He nods, fond. Of course, sir. The evening has been a pleasure. Allow me only to send Mrs. Halliwell for your card from the cloakroom.',
            'He turns slightly toward the inner doorway. Mrs. Halliwell — the gentleman\'s card, if you please.',
            'There is no answer from the inner doorway. The doorway is empty.',
          ],
          flags: { _decided_to_leave: true },
          choices: [
            { label: 'wait', goto: 'l_polonius_apologises' },
            { label: 'go to the front door yourself', goto: 'l_try_door' },
          ],
        },

        l_polonius_apologises: {
          lines: [
            'A moment passes. Mrs. Halliwell does not appear.',
            'Polonius\'s smile wavers — only a fraction, more like a man embarrassed by the small inattention of a servant than a man caught in a trick.',
            'Forgive me, sir. The cloakroom is — he checks his pocket watch, almost apologetic — locked at this hour. The keys are with Mr. Halliwell, in the parlor. He keeps them on the evenings.',
            'He pauses. The pause is a small one. He adds, with the same patient courtesy: the parlor is the second door from the end of the corridor. Mr. Halliwell will be obliging.',
            '~~He has placed my way out at the back of the house, behind a man with the keys.~~',
          ],
          flags: { _heard_card_in_cloakroom: true, _heard_parlor_keys: true, _heard_keys_butler: true, _aware_locked: true },
          scales: { unease: +2 },
          choices: [
            { label: 'try the front door yourself first', goto: 'l_try_door' },
            { label: 'walk to the parlor', goto: { to: 'hub_corridor', lines: ['I do not answer. I rise. I walk past him into the corridor.'], composure: +1, composureGain: 'I am moving.' } },
            { label: 'ask why it is structured this way', goto: 'l_why_like_this', when: (p) => poloniusNoticed(p) },
            { label: 'tell him what you think of it', goto: 'l_call_him_out', when: (p) => poloniusWondering(p) },
          ],
        },

        l_try_door: {
          lines: [
            'I rise. I cross from the parlor to the foyer. Polonius does not follow. The fire pops behind me.',
            'I reach the front door. The brass slot is set in the wood at chest height. I push the door. It does not move.',
            'I run my hand around the frame. There is no handle on this side. There is the slot, and there is the door, and there is the wood.',
            'I press my palm to the slot. The slot does not read a palm. The slot reads cards.',
            'Behind me, Polonius is at the parlor doorway. He has not crossed into the foyer. He is letting me discover this without an audience.',
          ],
          flags: { _aware_locked: true, _tried_door: true, _aware_slot: true, _aware_card_needed: true },
          scales: { unease: +3 },
          composure: -2,
          composureCost: 'There is no handle on this side.',
          choices: [
            { label: 'turn back to him', goto: 'l_demand_card' },
            { label: 'press your forehead to the door', goto: 'l_press_forehead' },
          ],
        },

        l_press_forehead: {
          lines: [
            'I press my forehead to the wood. The wood is the wood it was on the other side. I had not noticed how warm it was before.',
            'I close my eyes. I count to four. I open them.',
            'I turn back. Polonius is in the parlor doorway. He has not moved. He has the patience of a man who has watched this scene happen many times and is too courteous to remark on it.',
            'When you are ready, sir, he says, very quietly. We have only just begun.',
          ],
          scales: { unease: +2, intimacy: +1 },
          composure: +1,
          composureGain: 'I gave myself the count of four.',
          choices: [
            { label: 'turn to him', goto: 'l_demand_card' },
          ],
        },

        l_demand_card: {
          lines: [
            'I cross back to him. I say: my card.',
            'He inclines his head. The cloakroom, sir. Mrs. Halliwell placed it with your coat. The cloakroom is locked at this hour; Mr. Halliwell keeps the keys, in the parlor.',
            'He pauses, with the small consideration of a man giving an unwanted piece of news.',
            'The parlor is the second door from the end of the corridor. I would lead you, but I find I am better company over the threshold than I am as a guide. You will reach it. Mr. Halliwell is obliging.',
          ],
          flags: { _heard_card_in_cloakroom: true, _heard_parlor_keys: true, _heard_keys_butler: true, _aware_locked: true },
          scales: { intimacy: +1 },
          choices: [
            { label: 'why is it structured this way', goto: 'l_why_like_this', when: (p) => poloniusNoticed(p) },
            { label: 'walk to the parlor', goto: { to: 'hub_corridor', lines: ['I do not answer further. I am already walking.'], composure: +1, composureGain: 'I am moving.' } },
            { label: 'tell him what you think of it', goto: 'l_call_him_out', when: (p) => poloniusWondering(p) },
          ],
        },

        l_why_like_this: {
          lines: [
            'I say: you could have given it back here. You did not need to put it at the back of the house. Why like this.',
            'He looks at me with the directness of someone who has rehearsed the angle of his head.',
            'Because, sir, you would not have stayed for tea if I had simply asked. You would not have walked into the corridor at all. I would not have had the evening.',
            'He smiles. The smile is older than the face. I am being honest because I cannot afford a polite version. The house is patient. It is also hungry. I would like the meal to last a while.',
            '~~The meal. He said the meal.~~',
          ],
          scales: { unease: +5, intimacy: +3 },
          composure: -2,
          composureCost: 'The meal.',
          flags: { _heard_truth: true, _mask_on: false, _mood: 'mournful' },
          choices: [
            { label: 'what is the meal', goto: 'l_what_is_the_meal' },
            { label: 'walk to the parlor for the keys', goto: { to: 'hub_corridor', lines: ['I do not answer. I walk past him into the corridor.'], composure: +1, composureGain: 'I am moving.' } },
            { label: 'press him further', goto: 'f_about_the_card' },
          ],
        },

        l_what_is_the_meal: {
          lines: [
            'He smiles, smaller. The house is cursed, sir. It has been cursed since long before I came in. It demands one bound tenant. The cursed person resets each morning with the house. If the cursed person walks out while only one other living thing remains inside, the curse transfers, and the remaining one becomes the new tenant.',
            'I am the tenant, sir. I have been the tenant for nine hundred and seventy-two years.',
            'You walked into a house I have been waiting to leave for nine hundred and seventy-two years.',
            'The card is at the back of the house. The keys are between us. I am not going to lie to you about the shape of the evening, sir. I am asking you only to see the shape.',
          ],
          scales: { unease: +6, intimacy: +3 },
          composure: -3,
          composureCost: 'Nine hundred and seventy-two years.',
          flags: { _heard_truth: true, _heard_curse_rule: true, _mask_on: false, _mood: 'mournful' },
          choices: [
            { label: 'walk to the parlor', goto: { to: 'hub_corridor', lines: ['I do not speak. I walk past him into the corridor.'], composure: +1, composureGain: 'I am moving with a goal.' } },
            { label: 'press him further', goto: 'f_about_the_card' },
          ],
        },

        l_call_him_out: {
          lines: [
            'I say: this is a trick. A polite one. You asked for the card the way a friend would, and you have placed it at the back of a house I do not know.',
            'He nods. He nods with the patience of a man who has heard the accusation forty-one times and finds it less interesting on the forty-second.',
            'It is a trick, sir. I do not contest the word. I would gently suggest that I have not been clumsy. The trick has held up for some centuries.',
            'He pauses. He weighs the next sentence, then he gives it freely.',
            'I will be honest, sir. I will be honest because you have said the word out loud. I will do everything I am able to do to keep you in this house long enough for an accident to occur. I am owed an accident. After this I will not be a man with you. I will be a tenant.',
            'The candles in the sconces gutter. They had not been guttering before.',
          ],
          scales: { unease: +5, intimacy: +3 },
          composure: -2,
          composureCost: 'He warned me. That was kindness, of a sort.',
          flags: { _heard_truth: true, _heard_warning: true, _heard_curse_rule: true, _mask_on: false, _mood: 'broken' },
          choices: [
            { label: 'walk to the parlor', goto: { to: 'hub_corridor', lines: ['I do not speak. I move past him into the corridor.'], composure: +1, composureGain: 'I am moving.' } },
            { label: 'press him further', goto: 'f_about_the_card' },
          ],
        },

        // ═════════════════════════════════════════════════════════════
        //  CLUSTER: HUB + ROOMS (part 1) — parlor, library, gallery
        //
        //  The hub is the corridor between the foyer and the back of
        //  the house. It is the player's home base. From here they can
        //  approach the front door (which will not open without a card),
        //  any of the rooms in the wing, the back stair to the cellar,
        //  or Polonius himself. Every choice consumes a turn, which
        //  ticks the card forward through the house (poloniusAdvanceCard).
        // ═════════════════════════════════════════════════════════════

        hub_corridor: {
          lines: [
            'I am in the corridor between the foyer and the back of the house. The wallpaper is darker here. The lamps hang lower. There is a smell of old wood that I can taste.',
            'Doorways branch off the corridor. The front door is behind me. Polonius is in the parlor. The staff are at their stations.',
          ],
          flags: { room: 'hall' },
          choices: [
            { label: 'walk into a room', goto: 'hub_rooms' },
            { label: 'find Polonius — talk to him', goto: (p) => poloniusFaceNode(p) },
            { label: 'try the front door', goto: (p) => poloniusDoorAttempt(p) },
          ],
        },

        hub_rooms: {
          // The hub's most "next-step" rooms — the card-hunt rooms.
          // Aside from the parlor (always visible until the keys are
          // taken), each room only appears once the player has heard
          // enough to want to visit it. Off-path rooms surface via the
          // "wander further into the house" branch.
          lines: [
            'I weigh the doorways. The parlor opens off the corridor on my left. The other doors run further down.',
          ],
          choices: [
            {
              label: 'the parlor — the butler keeps the cloakroom keys',
              goto: { to: 'r_parlor', lines: ['I push the parlor door open.'] },
              when: (p) => !p.flags._have_cloakroom_keys,
            },
            {
              label: 'the cloakroom — your card was placed there',
              goto: { to: 'r_cloakroom_approach', lines: ['I walk to the back of the corridor where the cloakroom is.'] },
              when: (p) => !!p.flags._have_cloakroom_keys && !p.flags._been_cloakroom,
            },
            {
              label: 'the study — locked',
              goto: { to: 'r_study_approach', lines: ['I walk to the door with the brass plate.'] },
              when: (p) => p.flags._heard_study && !p.flags._been_study && (p.flags._card_location === 'study' || p.flags._heard_card_in_study),
            },
            {
              label: 'the cellar — the back stair drops to it',
              goto: { to: 'r_cellar_approach', lines: ['I take the back stair. The cellar door is at the bottom.'] },
              when: (p) => p.flags._heard_cellar && !p.flags._been_cellar,
            },
            {
              label: 'the kitchen — the cook is awake there',
              goto: { to: 'r_kitchen', lines: ['I push the kitchen door open.'] },
              when: (p) => (p.flags._been_dining || p.flags._heard_kitchen) && !p.flags._been_kitchen,
            },
            { label: 'wander further into the house', goto: 'hub_explore' },
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        hub_explore: {
          // The non-card rooms — intel and observation, not central
          // path. Library has the binding-shard archive; gallery has
          // the past tenants; clock hall reveals the staff routes;
          // dining is the cook's bound state and the cleaver.
          // Visited rooms drop out of the menu so each visit narrows
          // the list.
          lines: [
            'I allow myself a room without a goal. The corridor offers a few. The house has more rooms than the hunt has needed.',
          ],
          choices: [
            { label: 'the library', goto: { to: 'r_library', lines: ['I step into the library. The lamp is lit.'] }, when: (p) => !p.flags._been_library },
            { label: 'the gallery', goto: { to: 'r_gallery', lines: ['I follow the corridor to the gallery.'] }, when: (p) => !p.flags._been_gallery },
            { label: 'the clock hall', goto: { to: 'r_clock_hall', lines: ['I take the short hall to the clock.'] }, when: (p) => !p.flags._been_clock_hall },
            { label: 'the dining room', goto: { to: 'r_dining', lines: ['I push open the dining room door.'] }, when: (p) => !p.flags._been_dining },
            { label: 'one I have already been in', goto: 'hub_revisit' },
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        hub_revisit: {
          // Visited intel rooms — surfaced only when the player wants
          // to go back.
          lines: [
            'I think back on the rooms I have already opened. I weigh which one to step into a second time.',
          ],
          choices: [
            { label: 'the library', goto: { to: 'r_library', lines: ['I step back into the library.'] }, when: (p) => !!p.flags._been_library },
            { label: 'the gallery', goto: { to: 'r_gallery', lines: ['I step back into the gallery.'] }, when: (p) => !!p.flags._been_gallery },
            { label: 'the clock hall', goto: { to: 'r_clock_hall', lines: ['I step back into the clock hall.'] }, when: (p) => !!p.flags._been_clock_hall },
            { label: 'the dining room', goto: { to: 'r_dining', lines: ['I step back into the dining room.'] }, when: (p) => !!p.flags._been_dining },
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        // ─── PARLOR ──────────────────────────────────────────────────
        //  The butler keeps the cloakroom keys here on his person.
        //  A poker by the grate, a paper that is too old, a fire that
        //  has been burning for too long. The parlor is the first stop
        //  for a player chasing the card.
        // ─────────────────────────────────────────────────────────────

        r_parlor: {
          lines: [
            'The parlor is hot. The fire has been burning a long time. Two armchairs face it. A side table with a decanter on it. A bronze bust on the mantel. An iron poker leans against the grate.',
            'The butler is in one of the armchairs, reading a newspaper. He looks up at me. He nods, as one nods at a stranger one has been told to expect. He goes back to his paper.',
            'I can see the corner of a brass-headed keyring at his waistcoat pocket.',
          ],
          flags: { room: 'parlor', _been_parlor: true, _saw_keys: true },
          scales: { tiredness: +1, unease: +1 },
          choices: [
            { label: 'speak to the butler about the keys', goto: 'r_parlor_butler' },
            { label: 'try a quieter way to get the keys', goto: 'r_parlor_take_keys' },
            { label: 'take the poker from the grate', goto: 'r_parlor_take_poker', when: (p) => poloniusWondering(p) },
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        r_parlor_take_keys: {
          // Sub-menu for the quiet-keys approaches.
          lines: [
            'The butler is in the chair. The keys are at his waistcoat. He has not looked up from the paper for some minutes. There are several ways to do this.',
          ],
          choices: [
            { label: 'lift them from his pocket while he reads', goto: 'r_parlor_pickpocket', when: (p) => p.scales.intimacy <= 6 || p.flags._butler_distracted },
            { label: 'distract him with the paper first', goto: 'r_parlor_distract' },
            { label: 'check the date on the paper instead', goto: 'r_parlor_paper' },
            { label: 'never mind; back to the parlor', goto: 'r_parlor' },
          ],
        },

        r_parlor_butler: {
          lines: [
            'The butler folds the paper. He looks at me with the politeness of a man whose face has been a polite face for too many years.',
            'Good evening, sir. May I be of help.',
            'I say: the cloakroom keys. They are in your pocket.',
            'He looks down at the pocket as if surprised by it. The keys, sir. Indeed. They are. The cloakroom is at the back of the house; the keys are with me at the master\'s direction. I am to keep them on my person for the evening.',
            'He smiles. The smile is the same smile as Polonius\'s, only colder.',
            'I cannot give them to you, sir. The master has placed them with me. If you wish them, you will have to take it up with the master, or with me. I would prefer it be with the master.',
            '~~He is part of the day. He cannot give the keys away. He can only have them taken.~~',
          ],
          flags: { _heard_keys_butler: true, _butler_keys_explicit: true },
          scales: { intimacy: +1, unease: +1 },
          choices: [
            {
              label: 'try to take the keys by force',
              goto: 'r_parlor_force_keys',
            },
            {
              label: 'distract him; lift the keys',
              goto: 'r_parlor_distract',
            },
            {
              label: 'leave the parlor for now',
              goto: 'r_parlor',
            },
          ],
        },

        r_parlor_paper: {
          lines: [
            'I lean in over his shoulder. The paper is yellowed. The date is 1888. The headline is about a strike that was settled within a year.',
            'Polonius, in the doorway, says: He keeps the same paper. He has read it many times. He finds new things in it.',
            'The butler does not look up.',
          ],
          scales: { unease: +3 },
          flags: { _saw_old_paper: true },
          choices: [
            { label: 'comment on the date', goto: { to: 'r_parlor', lines: ['I say: this paper is over a century old. The butler nods, polite. The strike was a difficult affair, sir.', '~~He spoke as if he had read it last week.~~'], scales: { unease: +2, intimacy: +1 } } },
            { label: 'step back', goto: 'r_parlor' },
          ],
        },

        r_parlor_take_poker: {
          lines: [
            'I lift the poker from the grate. The iron is heavy. The shaft is warmer than iron should be — the fire has been against it.',
            'The butler does not look up. Polonius, in the doorway, smiles a very small smile.',
            'You will not find a use for that, sir, he says, mild. The fire is small. But I would not deprive a guest of his comforts.',
            '~~He saw me take it. He let me take it. He does not believe I will use it.~~',
          ],
          flags: { _armed: true, _weapon: 'poker', _armed_in_view: true },
          scales: { unease: +1, intimacy: +1 },
          composure: +2,
          composureGain: 'I am holding something heavy.',
          choices: [
            { label: 'back to the corridor', goto: 'hub_corridor' },
            { label: 'go after Polonius now', goto: 'k_strike_consider' },
          ],
        },

        r_parlor_pickpocket: {
          lines: [
            'I move toward the butler\'s chair. My hand goes to the brass head of the keyring at his pocket. He does not look up. The keys lift cleanly.',
            'I have them. They are heavy. They are warm with him.',
            'The butler turns the page of his newspaper. He has not turned a page all evening. He turns one now.',
            '~~He let me. He let me take them.~~',
          ],
          flags: { _have_cloakroom_keys: true, _butler_let_keys_go: true },
          scales: { unease: +2, intimacy: +1 },
          composure: +2,
          composureGain: 'The keys are in my hand.',
          choices: [
            {
              label: 'back to the corridor',
              goto: { to: 'hub_corridor', lines: ['I step out. The corridor is colder.'] },
            },
            {
              label: 'straight to the cloakroom',
              goto: { to: 'r_cloakroom_approach', lines: ['I walk for the back of the house. I do not stop in any other room.'] },
            },
          ],
        },

        r_parlor_distract: {
          lines: [
            'I lean in and tap the paper. I say: this article — the second column. The man named Adams. Was the strike settled in his favour or against.',
            'The butler looks down. He reads. He has read the column many times. He has not been asked about it. He frowns. He turns the paper toward the light.',
            'My right hand goes to his waistcoat pocket. The keys lift. He does not feel them go; he is in the article. He is in 1888.',
            'The butler comes back to himself. He looks up. He looks at me. He looks at his pocket. The pocket is empty.',
            'He says, mild as a bowl of milk: I will mention this to the master, sir. I do not think he will be surprised.',
          ],
          flags: { _have_cloakroom_keys: true, _butler_aware: true },
          scales: { unease: +2, intimacy: +1 },
          composure: +2,
          composureGain: 'The keys are in my hand.',
          choices: [
            {
              label: 'go to the cloakroom now',
              goto: { to: 'r_cloakroom_approach', lines: ['I do not say goodbye. I walk straight for the back of the house.'] },
            },
            {
              label: 'back to the corridor',
              goto: 'hub_corridor',
            },
          ],
        },

        r_parlor_force_keys: {
          lines: [
            'I reach for the keys.',
            'The butler\'s hand finds mine in mid-air. The grip is not a butler\'s grip. The grip is the same grip the maid has. The same grip Polonius has.',
            'I cannot move my hand.',
            'Sir, he says, very quietly. I am sorry. I cannot. I am bound to the day. I cannot give the keys, and I cannot let them be taken. You will have to take it up with the master.',
            'He releases me. He nods. He returns to his paper.',
            '~~He was sorry. He meant it. He cannot help me.~~',
          ],
          scales: { unease: +3, intimacy: +1 },
          composure: -2,
          composureCost: 'His grip was the same as the others.',
          flags: { _butler_lucid_briefly: true },
          choices: [
            { label: 'back to the corridor', goto: 'hub_corridor' },
            { label: 'sit by the fire', goto: 'r_parlor_sit' },
          ],
        },

        r_parlor_sit: {
          lines: [
            'I sit. The chair holds me. The fire is small. The butler is reading. Polonius is at the doorway, watching me sit, with a small fond approval.',
            'I rest my eyes. Just for a moment.',
            '~~A moment is all he needs.~~',
          ],
          flags: { _sat_parlor: true },
          scales: { tiredness: +4, intimacy: +2 },
          composure: -1,
          composureCost: 'The chair is too kind.',
          choices: [
            {
              label: 'force yourself up',
              goto: { to: 'r_parlor', lines: ['I push myself upright. The chair gives me up. My limbs are heavier.'], scales: { tiredness: -2 }, composure: +1, composureGain: 'I did not stay in the chair.' },
            },
            {
              label: 'close your eyes for just a moment',
              goto: 'l_drift',
            },
          ],
        },

        // ─── LIBRARY ─────────────────────────────────────────────────
        //  Records of past tenants. The lectern has a ledger naming
        //  every guest who has come through. The shelves contain hints
        //  about the binding token (the FREE path). The chair is warm.
        // ─────────────────────────────────────────────────────────────

        r_library: {
          lines: [
            'The library smells of old paper and dust I can taste. Two of the walls are shelved to the ceiling. A reading lamp is lit. The chair beside it is empty but the cushion is depressed.',
            'A lectern stands in the middle of the room. An open book on it.',
            'Polonius is in the doorway. He runs his fingers along a shelf as he comes in. I have read all of these, he says. I have read most of them more than once. There is time, in a house.',
          ],
          flags: { room: 'library', _been_library: true },
          scales: { tiredness: +1, intimacy: +1 },
          choices: [
            { label: 'cross to the lectern; read the open book', goto: 'r_library_lectern' },
            { label: 'examine the shelves', goto: 'r_library_books' },
            { label: 'look for a book about him', goto: 'r_library_his_book', when: (p) => p.flags._heard_truth || p.flags._heard_origin },
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        r_library_lectern: {
          lines: [
            'I cross to the lectern. The book on it is open to a page in the middle. The page has a list of names. The list is in the same careful hand throughout, but the inks are of different ages.',
            'At the bottom, in the freshest ink, are three names. The first is mine. The given name. The second is the name I have not used in years. The third is the name my mother called me.',
            'There is space below for one more line.',
            'He has not come over. He is standing where I left him, by the shelf, watching me read.',
          ],
          flags: { _saw_guest_book: true },
          scales: { unease: +4 },
          composure: -2,
          composureCost: 'The names were in the right order.',
          choices: [
            { label: 'turn the page back', goto: 'r_library_guest_book_back' },
            { label: 'tear out the page', goto: 'r_library_tear_page' },
            { label: 'close the book; turn to him', goto: 'f_about_the_card' },
          ],
        },

        r_library_guest_book_back: {
          lines: [
            'I turn the pages back. The names go back through the centuries. The handwriting does not change. The inks change. The names become unfamiliar — Russian, German, Welsh. Older still, the names become Latin. Older, Greek.',
            'On the first page, in the smallest hand, in a Greek so old it is almost Phoenician, is a single name. The name is not Polonius.',
            'Below it is the line: !!ἐδέθη τῇ οἰκίᾳ.!! — bound to the house.',
            'Below the line, in the same hand, is a small drawing: a piece of broken pottery with markings on it. A shard.',
            '~~A shard. A small piece of broken pottery, with markings on it. That is what holds him here.~~',
          ],
          flags: { _heard_origin: true, _heard_binding: true, _binding_is_shard: true },
          scales: { unease: +5, intimacy: +1 },
          composure: -2,
          composureCost: 'A shard. Older than the language he speaks.',
          choices: [
            {
              label: 'close the book',
              goto: { to: 'r_library', lines: ['I close the book. I keep the image of the shard in my head.'], composure: +1, composureGain: 'I have something to look for.' },
            },
            {
              label: 'ask him about the shard',
              goto: 'r_library_ask_shard',
            },
          ],
        },

        r_library_guest_book_forward: {
          lines: [
            'I turn the pages forward, past my name. The pages are blank.',
            'I close the book.',
          ],
          scales: { unease: +2 },
          composure: -1,
          composureCost: 'The pages were ready.',
          choices: [
            { label: 'back to the room', goto: 'r_library' },
          ],
        },

        r_library_tear_page: {
          lines: [
            'I take hold of the page. The paper does not tear. The paper is heavier than paper. The fibres do not give. I try harder. My fingertip leaves a mark on the page but the paper is the paper of the house, and the house has decided what the paper will do.',
            'Polonius, mild: I have tried that. Many times. The book is patient.',
            'I leave the page. My name is still on it. The space for one more line is still below.',
          ],
          scales: { unease: +3 },
          composure: -2,
          composureCost: 'The paper would not tear.',
          choices: [
            { label: 'close the book', goto: 'r_library' },
          ],
        },

        r_library_ask_shard: {
          lines: [
            'I say: there is a shard. In the drawing. What is the shard.',
            'He looks down. He looks at his own hands. The hands are the colour his hands are. He weighs the answer.',
            'It is the piece of an oath, sir. A name written into clay, and the clay broken. The clay is what was bound. As long as the clay holds — and it does hold, the shard is in the house — I hold. I cannot leave. The shard cannot leave.',
            'He smiles. The smile is small and bitter. If the shard were broken, sir — broken cleanly, into pieces, by someone not of the day — the binding would end. I would end. I would end the way men end. With time, with the time I am owed.',
            '~~He has told me how to free him. He has told me without my asking him to. I should be careful.~~',
            'He looks up. He does not look guilty. He looks tired.',
            'I am not asking it of you, sir. I am answering your question. There is a difference.',
          ],
          flags: { _heard_binding_full: true, _knows_free_path: true },
          scales: { intimacy: +4, unease: +3 },
          composure: -1,
          composureCost: 'He told me without my asking him to.',
          choices: [
            { label: 'where is the shard', goto: 'r_library_where_shard' },
            { label: 'back to the room', goto: 'r_library' },
          ],
        },

        r_library_where_shard: {
          lines: [
            'I say: where is the shard, then.',
            'He smiles. He does not answer at once.',
            'In the cellar, sir. On a low shelf at the back wall. I placed it there a long time ago. I have not had cause to move it. I cannot enter the cellar without descent, sir — the cellar is reached by a back stair, and the stair is one I have not taken in some time. The cook does the wines.',
            'He pauses. He is uncertain whether to add the next sentence. He adds it.',
            'If you went to the cellar, sir, I would not stop you. Mr. Halliwell would not stop you. Mrs. Halliwell — Mrs. Halliwell is between the front door and the corridor. She is not on the back stair.',
            '~~He has told me the path. He has told me which staff are on it.~~',
          ],
          flags: { _heard_cellar: true, _heard_shard_in_cellar: true, _heard_cook_in_cellar: true },
          scales: { intimacy: +5, unease: +2 },
          composure: +1,
          composureGain: 'He gave me the path.',
          choices: [
            { label: 'back to the room', goto: 'r_library' },
          ],
        },

        r_library_books: {
          lines: [
            'The bindings: a Latin grammar. A natural history with illustrations of an animal I do not recognise. A book in Greek. A book in a script that runs the wrong way and bends to one side as I look at it.',
            'A book without a title, bound in something I would prefer not to think about. Beside it: a small leather-bound notebook, much-used, with a brass clasp.',
          ],
          scales: { unease: +3 },
          choices: [
            {
              label: 'open the notebook',
              goto: 'r_library_notebook',
            },
            {
              label: 'open the untitled book',
              goto: 'r_library_untitled',
            },
            { label: 'leave the books alone', goto: 'r_library' },
          ],
        },

        r_library_notebook: {
          lines: [
            'I unfasten the clasp. The notebook is a daybook. It is dated in the same careful hand as the lectern. The first page is in Greek, then Latin, then English. The English is from the seventeenth century.',
            'The notebook is his. He has been writing in it for nine centuries.',
            'I flip to the last page. The last page is recent. The ink is fresh. The line reads:',
            '~~The new guest has not slept. The new guest is alert. He has seen the slot. He has seen the keys. He has been told about the shard. I do not know what he will do.~~',
            'Polonius is standing very still. He is watching me read about myself.',
          ],
          flags: { _read_notebook: true, _heard_truth: true, _heard_binding: true, _binding_is_shard: true },
          scales: { unease: +6, intimacy: +3 },
          composure: -3,
          composureCost: 'He is writing what I do as I do it.',
          choices: [
            {
              label: 'close it; look at him',
              goto: 'f_dropped',
            },
            {
              label: 'tear out the page',
              goto: 'r_library_tear_page',
            },
          ],
        },

        r_library_untitled: {
          lines: [
            'I open it. The first page is the lectern\'s page, in miniature. My name. My old name. The name my mother called me. The list of forty-one names above mine.',
            'It is the lectern\'s book. Or a copy of it. The copy is older.',
            'He has not moved from the shelf.',
          ],
          scales: { unease: +3 },
          flags: { _saw_guest_book: true },
          choices: [
            { label: 'close it', goto: 'r_library' },
            { label: 'confront him', goto: 'f_about_the_card' },
          ],
        },

        r_library_chair: {
          lines: [
            'I cross to the chair. The cushion is depressed in the centre. There is a slight hollow where a head rested. The hollow is recent.',
            'I say: who was sitting here.',
            'He smiles. The cushion is always like that. The chair has been used. Not recently. Long ago, in the aggregate, by someone who is no longer in the chair.',
            'The way he says ~~no longer in the chair~~ leaves room for several things to be true.',
          ],
          scales: { unease: +2 },
          choices: [
            { label: 'back to the room', goto: 'r_library' },
          ],
        },

        r_library_his_book: {
          lines: [
            'I look for it by intent. I think of his name, and I let the shelf guide my hand. The hand stops at a book bound in dark blue.',
            'I open the book. It is a memoir of him, in his own hand, in three languages. The pages turn easily.',
            'I find a passage in the middle. It reads: ~~The shard is in the cellar. The shard is the piece of broken clay with the name. The shard is what binds me. I have not been able to bring myself to break it. I have not been able to bring myself to leave it where another might find it. I have made my choice forty-one times. The forty-second time will be the same.~~',
            'He is watching me read it. He is not stopping me.',
          ],
          flags: { _heard_binding_full: true, _heard_shard_in_cellar: true, _knows_free_path: true, _heard_cellar: true },
          scales: { unease: +4, intimacy: +3 },
          composure: -2,
          composureCost: 'He has written down what holds him.',
          choices: [
            { label: 'close the book', goto: 'r_library' },
          ],
        },

        // ─── GALLERY ─────────────────────────────────────────────────
        //  The portraits of past tenants. An empty frame at the end of
        //  the row. The card may have been slipped behind it as a trick.
        //  Players who have searched the gallery can find it.
        // ─────────────────────────────────────────────────────────────

        r_gallery: {
          lines: [
            'A narrow hall hung with portraits. Men and women in clothes from every century. A boy in a sailor suit. A girl in a frock from a hundred years ago. A woman in a dress I half-remember from a film. A man in modern clothes.',
            'I stop in front of the man in modern clothes. He is wearing what Polonius is wearing.',
            'He is not Polonius. He is younger. The face is not the same. He is smiling.',
            'At the end of the row, the smallest portrait is empty. The frame is empty. The wall behind it is unfaded.',
          ],
          flags: { room: 'gallery', _been_gallery: true },
          scales: { unease: +3 },
          choices: [
            { label: 'ask about the modern portrait', goto: 'r_gallery_who' },
            { label: 'examine the empty frame', goto: 'r_gallery_empty_frame' },
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        r_gallery_who: {
          lines: [
            'I say: who is this. He is wearing your clothes.',
            'He smiles. That is the previous guest. He stayed a while. He is no longer with us.',
            'He says ~~previous guest~~ with the same fondness as ~~quirks~~.',
            'I am not sure what he means by ~~no longer with us~~. The portrait is fresh.',
            'I have not let the portraits be empty for long, sir. I cannot abide an empty frame.',
            '~~The empty frame at the end of the row is where mine will go.~~',
          ],
          scales: { unease: +4, intimacy: +1 },
          flags: { _saw_previous_guest: true },
          choices: [
            { label: 'back to the gallery', goto: 'r_gallery' },
          ],
        },

        r_gallery_empty_frame: {
          lines: [
            'I cross to the empty frame. It is small — about the size of a hand. The wall behind it is unfaded; a portrait had been here until very recently.',
            'I lift the frame off the nail. There is something behind it.',
            'On the wall behind the frame, hidden by it, is — depending on what the house has decided —',
          ],
          choices: [
            {
              label: 'look',
              goto: (p) => {
                if (p.flags._card_location === 'gallery_frame') return 'r_gallery_card_behind';
                return 'r_gallery_nothing_behind';
              },
            },
          ],
        },

        r_gallery_card_behind: {
          lines: [
            'On the wall behind the frame is my admission card. It is pinned by a small brass tack. The number on it is my number.',
            'I pry the tack. The card comes free. The card is in my hand.',
            'I hear Polonius, somewhere behind me in the corridor — not at the gallery doorway, somewhere further off — make a small sound. The sound is not a sound of surprise. The sound is of a man who has just discovered that today is not the day he had planned.',
            '!!The card is in my pocket again.!!',
          ],
          flags: { _card_location: 'recovered', _recovered_from: 'gallery_frame' },
          scales: { unease: +2 },
          composure: +3,
          composureGain: 'I have the card.',
          choices: [
            {
              label: 'walk to the front door',
              goto: (p) => poloniusDoorAttempt(p),
            },
            {
              label: 'back to the corridor',
              goto: 'hub_corridor',
            },
          ],
        },

        r_gallery_nothing_behind: {
          lines: [
            'On the wall behind the frame is a small brass tack. The tack is empty. There is a faint outline on the wall where something has been pinned and then removed.',
            'I put the frame back on the nail. The room is the room.',
          ],
          scales: { unease: +2 },
          choices: [
            { label: 'back to the gallery', goto: 'r_gallery' },
          ],
        },

        r_gallery_others: {
          lines: [
            'I walk the line of them. They are not arranged by century. They are arranged by something else. By how long someone stood here, perhaps. By the order in which they came in.',
            'The portraits at the start of the row are in old style — tempera on board, gold leaf — and the figures are dressed in things I have only seen in books. The portraits move forward in time as the row moves.',
            'There are forty-one of them.',
          ],
          flags: { _counted_portraits: true, _heard_count: true },
          scales: { unease: +3 },
          composure: -1,
          composureCost: 'Forty-one.',
          choices: [
            { label: 'back to the gallery', goto: 'r_gallery' },
          ],
        },

        // ═════════════════════════════════════════════════════════════
        //  CLUSTER: ROOMS (part 2) — clock hall, dining, cloakroom
        //
        //  The clock hall watches the staff routes — useful intel.
        //  The dining room has the cook and dinner; eat and become
        //  tired. The cloakroom is the first place a player will look
        //  for the card. Without keys, the cloakroom is locked. With
        //  keys, the player goes in and finds the card or finds it has
        //  moved on.
        // ═════════════════════════════════════════════════════════════

        // ─── CLOCK HALL ──────────────────────────────────────────────
        //  The pendulum without hands. The hall branches to the back
        //  of the house. Watching long enough teaches the player where
        //  the staff go and what they carry.
        // ─────────────────────────────────────────────────────────────

        r_clock_hall: {
          lines: [
            'A short hall ending in a tall clock. The pendulum is swinging. The face has no hands.',
            'I stand in front of it. The pendulum is moving. The mechanism is wound. There are no hands.',
            'Two corridors branch off the hall. One curves toward the back of the house. One goes down — a narrow stair I had not noticed.',
            'Polonius, somewhere behind me: The clockmaker took the hands off it himself. He said it made the time easier to bear. I never had the heart to put them back.',
          ],
          flags: { room: 'clock_hall', _been_clock_hall: true, _heard_study: true, _heard_cellar: true },
          scales: { unease: +3 },
          choices: [
            { label: 'stand still; watch the staff cross the corridor', goto: 'r_clock_watch' },
            { label: 'examine the clock', goto: 'r_clock_face' },
            { label: 'follow one of the corridors', goto: 'r_clock_branch' },
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        r_clock_branch: {
          // Sub-menu for the two corridors off the clock hall.
          lines: [
            'I weigh the two corridors. One curves toward the back of the house — the wallpaper darkens. One drops by a narrow stair — the stone smells colder.',
          ],
          choices: [
            { label: 'the back corridor', goto: 'r_clock_back_corridor' },
            { label: 'the stair down', goto: 'r_clock_descend' },
            { label: 'back to the clock hall', goto: 'r_clock_hall' },
          ],
        },

        r_clock_watch: {
          lines: [
            'I stand against the wall in the clock hall. I let the room have my attention while I have its.',
            'After a minute, Mrs. Halliwell crosses from the front of the house to the back. She is carrying a small pale thing. She is going down the corridor to the cloakroom.',
            'A minute later, she returns. Her hands are empty. She is still smiling.',
            'After a while, Mr. Halliwell crosses from the parlor to the back. He is carrying a small pale thing this time. He is going to a door I have not seen open before. The door has a brass plate on it. The plate reads ~~Study~~.',
            'The clock pendulum keeps time the clock does not have.',
          ],
          flags: { _watched_routes: true, _heard_study: true, _heard_cellar: true, _routes_seen: true, _card_known: true },
          scales: { unease: +3, intimacy: +1 },
          composure: +1,
          composureGain: 'I have the routes of the staff.',
          choices: [
            { label: 'back to the clock hall', goto: 'r_clock_hall' },
          ],
        },

        r_clock_face: {
          lines: [
            'I lean in close to the face of the clock. The pendulum is swinging. The face is plain — the hours are inked but the hands are gone.',
            'Where the hands should be, set into the wood at the centre, is a small piece of brass with a hole in it. The hole has the shape of a card slot.',
            '~~The clock keeps time only if someone\'s card is in it. The clock is asking for a card.~~',
            'Polonius, mild, behind me: Do not, sir. The clock is patient. It has been patient for a long time.',
          ],
          flags: { _saw_clock_slot: true, _heard_how_long: true },
          scales: { unease: +4 },
          composure: -1,
          composureCost: 'The clock is asking for a card.',
          choices: [
            { label: 'back to the clock hall', goto: 'r_clock_hall' },
          ],
        },

        r_clock_back_corridor: {
          lines: [
            'I follow the back corridor. It runs along the rear of the house. The wallpaper is darker here.',
            'There is a door with a brass plate. The plate reads ~~Study~~. The door is closed.',
            'Further on, there is a smaller door, painted the same colour as the wallpaper. The smaller door does not have a plate. The wood has wear at the level of a maid\'s hip.',
            '~~The smaller door is the cloakroom.~~',
          ],
          flags: { _heard_study: true, _heard_cloakroom: true, _heard_card_in_cloakroom: true, _aware_locked: true },
          scales: { unease: +2 },
          choices: [
            { label: 'try the cloakroom door', goto: 'r_cloakroom_approach' },
            { label: 'try the study door', goto: 'r_study_approach' },
            { label: 'back to the clock hall', goto: 'r_clock_hall' },
          ],
        },

        r_clock_descend: {
          lines: [
            'I follow the stair down. The stair is narrow. The wood creaks at the third step and again at the seventh. The descent ends in a dim chamber. There is a door at the foot, set into the stone.',
            'The door is the cellar door.',
            'Above me, on the landing, the cook is standing. He has not followed me. He has been here. He is watching me reach the bottom.',
          ],
          flags: { _heard_cellar: true, _seen_cook: true },
          scales: { unease: +3 },
          choices: [
            {
              label: 'open the cellar door',
              goto: 'r_cellar_approach',
            },
            {
              label: 'turn back; speak to the cook',
              goto: 'r_clock_cook_intercepts',
            },
            {
              label: 'back to the clock hall',
              goto: 'r_clock_hall',
            },
          ],
        },

        r_clock_cook_intercepts: {
          lines: [
            'I climb back to the landing. The cook is at the top of the stair, his apron the colour it is. He stops me with a hand. His hand is bigger than I had expected.',
            'Sir, he says, quietly. His voice is the voice of a man who is not — for the moment — part of the day. The accent is northern. The eyes are awake.',
            'The cellar is fine, sir. There is a shelf. There is a shard. The shard is what holds him. I have done the wines for forty-one years. I have looked at the shard every time.',
            'He pauses. Sir. If I leave the kitchen for more than a minute, the day reverts me. I will not remember this conversation in a minute. Go down. I will not stop you. The master cannot stop you on the stair.',
          ],
          flags: { _heard_cellar: true, _heard_binding: true, _heard_shard_in_cellar: true, _binding_is_shard: true, _knows_free_path: true, _heard_cook_aware: true, _seen_cook: true },
          scales: { unease: +3, intimacy: +1 },
          composure: +2,
          composureGain: 'There is someone in this house who is not part of the day.',
          choices: [
            { label: 'thank him; descend', goto: 'r_cellar_approach' },
            { label: 'thank him; back to the corridor', goto: 'hub_corridor' },
          ],
        },

        // ─── DINING ──────────────────────────────────────────────────
        //  Dinner is on the table. Eating brings tiredness. The cook is
        //  in the doorway with his apron. Conversation here is the most
        //  direct way to learn about the cook's lucidity and the cellar.
        // ─────────────────────────────────────────────────────────────

        r_dining: {
          lines: [
            'The dining room. A long table set for two. The places are already arranged. The candles are already burning. Two covered dishes sit between the settings.',
            'The cook appears in the doorway. He is wiping his hands on an apron that has bloodstains old and new. He bows.',
            'Dinner, sir, Polonius says. The cook has prepared it for a long time. It would be unkind to leave it cold.',
            'A meat-cleaver in a sheath at the cook\'s waist. The handle is bone.',
          ],
          flags: { room: 'dining', _been_dining: true, _seen_cook: true },
          scales: { tiredness: +1, unease: +1 },
          choices: [
            { label: 'sit at the table', goto: 'r_dining_eat' },
            { label: 'speak to the cook', goto: 'r_dining_speak_cook' },
            { label: 'reach for the cleaver', goto: 'r_dining_take_cleaver', when: (p) => poloniusWondering(p) },
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        r_dining_eat: {
          lines: [
            'I sit. The chair has been warmed. The food is hot. The cook stands by the doorway, watching me eat.',
            'I take a bite. The food is unspeakably good and tastes of a meal I have eaten before. The wine is poured before I have asked for it.',
            'Polonius is across the table. He is not eating. His knife and fork lie on the plate at an angle no human elbow could produce. He is watching me eat the way one watches a fire.',
          ],
          scales: { tiredness: +5, intimacy: +3 },
          composure: -1,
          composureCost: 'The food was too good.',
          flags: { _ate_dinner: true },
          choices: [
            {
              label: 'set down the cutlery',
              goto: { to: 'r_dining', lines: ['I set the knife and fork down. The cook, in the doorway, makes a small, unhappy sound.', 'Polonius nods. As you wish, sir. The cook will save it.'], scales: { tiredness: -1, intimacy: -1 }, composure: +1, composureGain: 'I stopped.' },
            },
            {
              label: 'keep eating; finish the plate',
              goto: 'r_dining_finish',
            },
          ],
        },

        r_dining_finish: {
          lines: [
            'I finish the plate. The cook is delighted. The bow he gives me is genuine.',
            'I push myself up from the chair. The chair holds on for a beat longer than a chair should.',
            'My limbs are slow. The wine has settled. I will need to walk this off.',
          ],
          scales: { tiredness: +6, intimacy: +2 },
          composure: -2,
          composureCost: 'The meal was complete.',
          choices: [
            {
              label: 'back to the corridor; move',
              goto: { to: 'hub_corridor', lines: ['I step out. I do not stop walking.'], scales: { tiredness: -1 }, composure: +1, composureGain: 'I am moving.' },
            },
          ],
        },

        r_dining_blood: {
          lines: [
            'I say: whose blood is on his apron.',
            'The cook looks at his apron, as if noticing it for the first time. Polonius says, mild: The lamb. He prepared lamb. He has always been a thorough butcher.',
            'The cook nods. He is still standing in the doorway behind me. He has not moved.',
            'I look at the apron again. There are old stains and new. The new are very new.',
          ],
          scales: { unease: +3 },
          flags: { _noticed_blood: true },
          choices: [
            { label: 'back to the room', goto: 'r_dining' },
          ],
        },

        r_dining_speak_cook: {
          lines: [
            'I cross to the cook. The cook is in the doorway. I keep my voice low.',
            'I say, very quietly: I need to leave. The card. The shard. Any of it.',
            'The cook\'s smile is fixed. The eyes do not move. He says, in the same fixed voice: the lamb, sir. The lamb is very good.',
            '~~He cannot hear me here. He is part of the day in the dining room. Polonius is across the table.~~',
            'Polonius, from across the table: He saves himself for the kitchen, sir. Mr. Cook is at his most useful at the range. If you would like to speak with him at length, do so there.',
            '~~The cook is lucid only in the kitchen.~~',
          ],
          flags: { _heard_kitchen: true, _heard_cook_lucid_in_kitchen: true },
          scales: { unease: +2, intimacy: +1 },
          composure: +1,
          composureGain: 'I have a place to find a friend.',
          choices: [
            { label: 'back to the room', goto: 'r_dining' },
            { label: 'follow him to the kitchen now', goto: { to: 'r_kitchen', lines: ['I push past the cook. He yields without resistance. I step into the kitchen.'] } },
          ],
        },

        r_dining_take_cleaver: {
          lines: [
            'I reach for the cleaver at the cook\'s waist. His hand intercepts mine. The grip is the same grip the maid had — fixed, strong, sorry.',
            'Sir, he says, in the dining room voice. The cleaver is for the lamb. The cleaver does not leave the cook.',
            'He releases me. He bows. The cleaver is still at his waist.',
            '~~He is part of the day here. He cannot give the cleaver up here.~~',
            'Polonius, from the table, smiling: As I said, sir. The kitchen is where you would do best to speak with him.',
          ],
          flags: { _heard_kitchen: true, _heard_cook_lucid_in_kitchen: true },
          scales: { unease: +2 },
          composure: -1,
          composureCost: 'I could not get the cleaver.',
          choices: [
            { label: 'back to the room', goto: 'r_dining' },
            { label: 'follow to the kitchen', goto: { to: 'r_kitchen', lines: ['I cross the dining room. The cook is between me and the kitchen door. He is smiling. He moves aside, only barely.'] } },
          ],
        },

        r_dining_decline: {
          lines: [
            'I say: I am not hungry.',
            'The cook\'s face does not move. Polonius nods. Of course. Perhaps later. Mr. Cook, leave the covers on. He may return to it.',
            'The cook does not leave. He stands in the doorway behind me.',
          ],
          scales: { unease: +1 },
          composure: +1,
          composureGain: 'I did not sit at the table.',
          choices: [
            { label: 'back to the room', goto: 'r_dining' },
          ],
        },

        // ─── CLOAKROOM ───────────────────────────────────────────────
        //  The first place to look for the card. The cloakroom is at
        //  the back of the house. The maid is in the inner doorway
        //  unless the player has the keys. With the keys, the room is
        //  empty of staff, and the card is there if it has not been
        //  moved.
        // ─────────────────────────────────────────────────────────────

        r_cloakroom_approach: {
          lines: [
            'I walk to the back of the corridor. The smaller door is set into the wallpaper. Above the handle, in brass: a small lock.',
            'The maid is in front of the door. She is smiling. She is not blocking. She is, however, in the way.',
          ],
          flags: { room: 'hall' },
          choices: [
            {
              label: 'try the door',
              goto: (p) => p.flags._have_cloakroom_keys ? 'r_cloakroom_unlock' : 'r_cloakroom_locked',
            },
            {
              label: 'ask the maid to step aside',
              goto: 'r_cloakroom_ask_maid',
            },
            {
              label: 'try to slip past her',
              goto: 'r_cloakroom_slip',
              when: (p) => p.scales.intimacy <= 6 && !p.flags._maid_alerted,
            },
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        r_cloakroom_locked: {
          lines: [
            'I try the handle. The handle turns; the lock holds. The door does not open.',
            'The maid, beside me: Locked, sir. Mr. Halliwell has the key.',
            'She does not smile less. She does not smile more.',
          ],
          flags: { _aware_keys_needed: true, _heard_parlor_keys: true, _heard_keys_butler: true },
          scales: { unease: +2 },
          composure: -1,
          composureCost: 'The lock is small but it is enough.',
          choices: [
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        r_cloakroom_ask_maid: {
          lines: [
            'I say: Mrs. Halliwell. Please step aside. I would like to try the door.',
            'She does. Of course, sir. She moves a quarter-step. The door is still there. So is she. She is now slightly more in the doorframe than before.',
            'I move past her. Her hand brushes my sleeve. The brush is brief and careful. The brush is the same brush as the coat.',
            '~~She is the maid. She is also a measure of the doorway.~~',
          ],
          scales: { unease: +2, intimacy: +1 },
          choices: [
            {
              label: 'try the door',
              goto: (p) => p.flags._have_cloakroom_keys ? 'r_cloakroom_unlock' : 'r_cloakroom_locked',
            },
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        r_cloakroom_slip: {
          lines: [
            'I feint right and dart left. She does not follow the feint. She does not need to.',
            'Her hand is at my forearm. The grip is far stronger than the body it is attached to.',
            '~~She has done this many more times than I have.~~',
            'She releases me with a small apology. Sir. We have been instructed not to spoil the evening. We are doing our best.',
            'She steps back. Half a step. She is still there.',
          ],
          flags: { _maid_alerted: true },
          scales: { unease: +3 },
          composure: -2,
          composureCost: 'Her grip was not a maid\'s grip.',
          choices: [
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        r_cloakroom_unlock: {
          lines: [
            'I take the keys from my pocket. The brass-headed key fits the brass-headed lock. The lock turns. The door opens.',
            'I step inside. The maid does not follow. She stands at the door, smiling. She is part of the day, on this side of the door.',
            'The cloakroom is small. My coat is on a hook. Two other coats hang beside it; I do not recognise them. A shelf above the rod.',
          ],
          flags: { room: 'cloakroom', _been_cloakroom: true },
          scales: { unease: +2 },
          choices: [
            {
              label: 'search the coat',
              goto: 'r_cloakroom_search_coat',
            },
            {
              label: 'search the shelf',
              goto: 'r_cloakroom_search_shelf',
            },
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        r_cloakroom_search_coat: {
          lines: [
            'I take down my coat. I check the inner pocket. The pocket is — depending on what the house has decided —',
          ],
          choices: [
            {
              label: 'look',
              goto: (p) => {
                if (p.flags._card_location === 'cloakroom') return 'r_cloakroom_card_in_coat';
                return 'r_cloakroom_coat_empty';
              },
            },
          ],
        },

        r_cloakroom_card_in_coat: {
          lines: [
            'The pocket is heavier than empty. I bring out my admission card. The number on it is my number.',
            '!!I have it.!!',
            'I put the coat on. The coat is the right temperature.',
            'Behind me, in the corridor, Mrs. Halliwell\'s smile widens. She has not moved.',
          ],
          flags: { _card_location: 'recovered', _recovered_from: 'cloakroom' },
          scales: { unease: +1 },
          composure: +3,
          composureGain: 'The card is in my pocket. The coat is on.',
          choices: [
            {
              label: 'walk to the front door',
              goto: (p) => poloniusDoorAttempt(p),
            },
          ],
        },

        r_cloakroom_coat_empty: {
          lines: [
            'The pocket is empty. The card is not in the coat. It was placed here. It has been moved.',
            'The other coats: I check them too. Pockets empty. The brass-headed nails in the wall behind them shine faintly.',
            'I am too late by some minutes. The maid put the card here. The butler has carried it on.',
            'Behind me, in the corridor, Mrs. Halliwell\'s smile is the same.',
          ],
          flags: { _heard_study: true, _heard_card_moved: true, _card_known: true },
          scales: { unease: +3 },
          composure: -2,
          composureCost: 'I was too late.',
          choices: [
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        r_cloakroom_search_shelf: {
          lines: [
            'I run my hand along the shelf. The shelf is dusty. There is no card on the shelf. There is a small tin box. I open it.',
            'Inside the tin: forty-one folded slips of paper. Each is the same size and shape. Each has a name on it. The names are the names from the gallery.',
            'At the bottom of the tin, where a forty-second slip would go, is a blank one. A pen on the shelf beside the tin.',
            '~~He has prepared mine. He has not yet written my name.~~',
          ],
          flags: { _saw_slips: true, _heard_count: true },
          scales: { unease: +5 },
          composure: -2,
          composureCost: 'He has prepared a slip with my name on it.',
          choices: [
            {
              label: 'pocket the blank slip',
              goto: { to: 'r_cloakroom_unlock', lines: ['I take the blank slip. I fold it into my pocket. If I have a slip with no name on it, I have what they cannot use yet.'], flags: { _have_blank_slip: true }, composure: +1, composureGain: 'I have his next move in my pocket.' },
            },
            {
              label: 'leave it; keep searching',
              goto: 'r_cloakroom_unlock',
            },
          ],
        },

        // ═════════════════════════════════════════════════════════════
        //  CLUSTER: ROOMS (part 3) — kitchen, study, cellar
        //
        //  The kitchen contains a partly-lucid cook. The study is
        //  locked but contains the card if it has been moved there.
        //  The cellar holds the shard — the FREE path. Reaching the
        //  cellar requires going down the back stair, which the cook
        //  has told the player is unguarded by Polonius.
        // ═════════════════════════════════════════════════════════════

        // ─── KITCHEN ─────────────────────────────────────────────────
        //  The cook is partly lucid here, in his own room. He hates
        //  Polonius. He will tell the player about the shard, the
        //  cellar, and (if asked) about the back-stair route.
        // ─────────────────────────────────────────────────────────────

        r_kitchen: {
          lines: [
            'The kitchen. A great iron range. Steam from a pot the cook has not stirred in a while. A block of knives at the wall. Two cleavers on a high rack. A door to a small pantry. A second door — narrower — set into the back wall.',
            'The cook is at the range. He looks at me. The eyes are different here. The eyes have the lights on. The smile is no longer a fixed smile; it is a hesitant one.',
            'Quietly, in a northern accent: Sir. Quickly. We have a minute. The master saves himself for the parlor. He does not come into the kitchen.',
          ],
          flags: { room: 'kitchen', _been_kitchen: true, _seen_cook_lucid: true },
          scales: { unease: +1, intimacy: +1 },
          composure: +1,
          composureGain: 'The cook is here. The cook is awake.',
          choices: [
            { label: 'ask the cook for help', goto: 'r_kitchen_ask_help' },
            { label: 'take a weapon from the rack', goto: 'r_kitchen_take_cleaver', when: (p) => poloniusWondering(p) },
            { label: 'try the doors at the back', goto: 'r_kitchen_back_door' },
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        r_kitchen_ask_help: {
          // Sub-menu for the cook conversation. He's lucid here and
          // will answer any of three questions; the player can ask
          // one then return to the kitchen.
          lines: [
            'I keep my voice low. I say: I need to know — quickly, before the day reverts you.',
          ],
          choices: [
            { label: 'the shard — where is it', goto: 'r_kitchen_ask_shard' },
            { label: 'my card — where has it gone', goto: 'r_kitchen_ask_card' },
            { label: 'the back stair — what is the route', goto: 'r_kitchen_ask_stair' },
          ],
        },

        r_kitchen_ask_shard: {
          lines: [
            'I say, quickly: the shard. It is in the cellar.',
            'The cook nods. On the back shelf, sir. Low — at the level of a man\'s knee. Behind the third bottle. A piece of broken clay, no bigger than a thumbprint. There is a name scratched into it in a script that is older than any of us.',
            'He pauses. Sir. The shard is what holds him. If you break it, he will go. He will go the way men go. The staff will go with him. The day will end.',
            'The day will end for me, too, sir. I do not mind. I have been here a great while.',
            '~~He is telling me he is ready to be released. He is part of the bargain.~~',
          ],
          flags: { _heard_shard_in_cellar: true, _heard_binding: true, _heard_binding_full: true, _binding_is_shard: true, _knows_free_path: true, _heard_cellar: true, _cook_ready_to_end: true },
          scales: { intimacy: +2 },
          composure: +1,
          composureGain: 'I have the map of the shard.',
          choices: [
            { label: 'continue', goto: 'r_kitchen' },
          ],
        },

        r_kitchen_ask_card: {
          lines: [
            'I say: my card. The admission card. Where is it.',
            'The cook thinks. Sir. The maid brought it to the cloakroom. Mr. Halliwell took it from the cloakroom on the master\'s direction. It is in the study now. Locked drawer. The key is in the desk; the desk is also locked.',
            'He pauses. Or the master is wearing it again, sir, if his mood has cooled. He keeps it on his person in the late evenings. I have seen it.',
            '~~The card is in the study or on him. The cook does not know which.~~',
          ],
          flags: { _heard_study: true, _heard_card_in_study: true, _card_location_unknown_specific: true },
          scales: { unease: +2, intimacy: +1 },
          composure: +1,
          composureGain: 'The card is in one of two places.',
          choices: [
            { label: 'continue', goto: 'r_kitchen' },
          ],
        },

        r_kitchen_ask_stair: {
          lines: [
            'I say: the back stair. Down to the cellar.',
            'He nods. Sir. Through this kitchen. The narrower door. The stair turns once. The cellar is at the bottom. Mrs. Halliwell is at the front. Mr. Halliwell is in the parlor. The master will not come down. He has not been down in some centuries. The cellar is cold for him.',
            'He pauses. Sir, when you come back up. Do not stop in the kitchen on the way out. Run for the front. The master will be in the foyer when he hears the shard break, and he will be quick. Have the card before you break it.',
            '~~Have the card before I break it. The order matters.~~',
          ],
          flags: { _heard_back_stair: true, _heard_route: true, _heard_break_order: true, _heard_cellar: true },
          scales: { unease: +1 },
          composure: +2,
          composureGain: 'I have the order of operations.',
          choices: [
            { label: 'continue', goto: 'r_kitchen' },
          ],
        },

        r_kitchen_take_knife: {
          lines: [
            'I take a small knife from the block. It is sharp. It is the cook\'s knife. The handle has worn to the cook\'s hand and now fits mine awkwardly.',
            'The cook nods. Take it, sir. I have had no need of it in the kitchen for some time.',
          ],
          flags: { _armed: true, _weapon: 'knife' },
          scales: { unease: +1 },
          composure: +1,
          composureGain: 'I have something in my pocket that the cook gave me.',
          choices: [
            { label: 'continue', goto: 'r_kitchen' },
          ],
        },

        r_kitchen_take_cleaver: {
          lines: [
            'I reach for a cleaver on the high rack. The cook nods. He hands it down himself. The cleaver is heavier than the knife. It has been used for things that are not lamb.',
            'Sir, he says. Aim for the side of the head, if the master gives you cause. The bone gives. He has been hit before. He gets up. The staff dissolve when he goes down hard enough.',
          ],
          flags: { _armed: true, _weapon: 'cleaver' },
          scales: { unease: +1 },
          composure: +2,
          composureGain: 'I am holding the cleaver the cook handed me.',
          choices: [
            { label: 'continue', goto: 'r_kitchen' },
          ],
        },

        r_kitchen_pantry: {
          lines: [
            'I open the pantry. It is dark. There are shelves of preserved things. Pickled lemons. A jar of something with a label written in Greek. A row of small bottles.',
            'I close the pantry. The pantry is no use to me at the moment.',
          ],
          scales: { unease: +1 },
          choices: [
            { label: 'back to the kitchen', goto: 'r_kitchen' },
          ],
        },

        r_kitchen_back_door: {
          lines: [
            'I open the narrower door. Behind it is a stair down, narrow and stone-walled.',
            'The cook, behind me: That is the way, sir. The cellar door is at the bottom. I will not follow.',
            '~~He will not follow because he cannot. The kitchen is the room he is awake in.~~',
          ],
          flags: { _heard_back_stair: true, _heard_cellar: true },
          scales: { unease: +1 },
          choices: [
            { label: 'descend to the cellar', goto: 'r_cellar_approach' },
            { label: 'back to the kitchen', goto: 'r_kitchen' },
          ],
        },

        // ─── STUDY ───────────────────────────────────────────────────
        //  Polonius's study. Locked. The card may be in the locked
        //  drawer of the desk. The desk has papers — names of past
        //  tenants, with notes. Picking the lock is hard.
        // ─────────────────────────────────────────────────────────────

        r_study_approach: {
          lines: [
            'I walk to the door with the brass plate. The plate reads ~~Study~~. The door is closed.',
            'I try the handle. The handle turns; the lock holds.',
          ],
          flags: { _aware_study_locked: true },
          choices: [
            {
              label: 'pick the lock',
              goto: 'r_study_pick',
              when: (p) => p.flags._armed || p.flags._have_cloakroom_keys,
            },
            {
              label: 'try the cloakroom keys',
              goto: 'r_study_try_keys',
              when: (p) => p.flags._have_cloakroom_keys,
            },
            {
              label: 'shoulder the door',
              goto: 'r_study_shoulder',
            },
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        r_study_try_keys: {
          lines: [
            'I take out the cloakroom keys. The brass-headed one does not fit. The smaller key — there is a smaller key on the ring — does. The smaller key was a butler\'s key. The butler has many.',
            'The study door opens.',
          ],
          flags: { _study_open: true },
          scales: { unease: +1 },
          composure: +1,
          composureGain: 'The smaller key fit.',
          choices: [
            { label: 'enter the study', goto: 'r_study_inside' },
          ],
        },

        r_study_pick: {
          lines: [
            'I work the lock with what I have. The lock is small. The mechanism is old. After what feels like several minutes, the lock turns.',
            'The door opens. I step into the study.',
            'Down the corridor, Polonius makes a small sound. The sound is one a man makes when an inevitability advances by a step.',
          ],
          flags: { _study_open: true, _picked_study_lock: true },
          scales: { unease: +2, intimacy: +1 },
          composure: +1,
          composureGain: 'I picked it.',
          choices: [
            { label: 'enter the study', goto: 'r_study_inside' },
          ],
        },

        r_study_shoulder: {
          lines: [
            'I throw my weight at the door. The door is older than I am and stronger than I am. My shoulder will feel it in the morning, if there is a morning.',
            'On the third attempt the latch gives. The door swings inward. The frame around the latch is splintered.',
            'Down the corridor, fast: footsteps. Polonius is coming.',
          ],
          flags: { _study_open: true, _study_forced: true, _polonius_alerted: true },
          scales: { unease: +3 },
          composure: -1,
          composureCost: 'The door was not quiet.',
          choices: [
            { label: 'enter the study', goto: 'r_study_inside' },
          ],
        },

        r_study_inside: {
          lines: [
            'A small study. A desk with a green leather top. A bookshelf of ledgers. A locked drawer at the right of the desk. A window painted to look like a window.',
            'A leather notebook on the desk; an ink-pot; a fountain pen with a fresh nib. A small bowl of brass tacks.',
            'There are papers spread across the desk. The papers are written in his hand.',
          ],
          flags: { room: 'study', _been_study: true },
          scales: { unease: +2, intimacy: +1 },
          choices: [
            {
              label: 'try the drawer',
              goto: 'r_study_drawer',
            },
            {
              label: 'read the papers',
              goto: 'r_study_papers',
            },
            {
              label: 'open the notebook',
              goto: 'r_study_notebook',
            },
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        r_study_drawer: {
          lines: [
            'I try the drawer. The drawer is locked. The lock is brass and small.',
          ],
          choices: [
            {
              label: 'pry the drawer with the cleaver',
              goto: 'r_study_pry_cleaver',
              when: (p) => p.flags._weapon === 'cleaver',
            },
            {
              label: 'pry the drawer with the knife',
              goto: 'r_study_pry_knife',
              when: (p) => p.flags._weapon === 'knife',
            },
            {
              label: 'pry the drawer with the poker',
              goto: 'r_study_pry_poker',
              when: (p) => p.flags._weapon === 'poker',
            },
            {
              label: 'pick the lock with what you have',
              goto: 'r_study_pick_drawer',
            },
            { label: 'back to the desk', goto: 'r_study_inside' },
          ],
        },

        r_study_pry_cleaver: {
          lines: [
            'I wedge the blade of the cleaver between the drawer and the desk. I lever it. The wood gives. The drawer slides open in pieces.',
            'Inside the drawer is —',
          ],
          flags: { _study_drawer_open: true, _drawer_forced: true },
          scales: { unease: +1 },
          choices: [
            {
              label: 'look',
              goto: (p) => p.flags._card_location === 'study' ? 'r_study_card_found' : 'r_study_drawer_empty',
            },
          ],
        },

        r_study_pry_knife: {
          lines: [
            'I work the knife into the seam. The knife is small. The drawer is older than the knife. The knife snaps before the drawer gives.',
            'The blade is in two pieces. The drawer is still locked.',
            '~~The drawer was patient with me. The knife was not.~~',
          ],
          flags: { _weapon: null, _broke_knife: true },
          scales: { unease: +2 },
          composure: -2,
          composureCost: 'I broke the cook\'s knife on a small lock.',
          choices: [
            { label: 'back to the desk', goto: 'r_study_inside' },
          ],
        },

        r_study_pry_poker: {
          lines: [
            'I wedge the poker between the drawer and the desk. The poker is iron. The wood is wood. The drawer gives.',
            'Inside the drawer is —',
          ],
          flags: { _study_drawer_open: true, _drawer_forced: true },
          scales: { unease: +1 },
          choices: [
            {
              label: 'look',
              goto: (p) => p.flags._card_location === 'study' ? 'r_study_card_found' : 'r_study_drawer_empty',
            },
          ],
        },

        r_study_pick_drawer: {
          lines: [
            'I work the lock with the pin from a tack. It takes longer than I have. After what feels like several minutes the pins line up.',
            'The drawer slides open.',
            'Inside the drawer is —',
          ],
          flags: { _study_drawer_open: true },
          scales: { unease: +1, intimacy: +1 },
          composure: +1,
          composureGain: 'The pins lined up.',
          choices: [
            {
              label: 'look',
              goto: (p) => p.flags._card_location === 'study' ? 'r_study_card_found' : 'r_study_drawer_empty',
            },
          ],
        },

        r_study_card_found: {
          lines: [
            'Inside the drawer is my admission card. The number on it is my number. The card is on top of a small pile of other cards — admission cards, every one — with names and dates on them in his hand. Forty-one cards. Mine is the forty-second on top.',
            'I take my card. I leave the others.',
            '!!The card is in my pocket.!!',
            'Down the corridor: Polonius is coming. Fast.',
          ],
          flags: { _card_location: 'recovered', _recovered_from: 'study', _saw_card_pile: true, _polonius_alerted: true },
          scales: { unease: +3 },
          composure: +3,
          composureGain: 'I have the card.',
          choices: [
            {
              label: 'run for the front door',
              goto: (p) => poloniusDoorAttempt(p),
            },
          ],
        },

        r_study_drawer_empty: {
          lines: [
            'Inside the drawer are forty-one admission cards. They are arranged in chronological order. The most recent is over fifty years old. The names mean nothing to me. The dates are written in his hand.',
            'Mine is not here. Mine has been moved. He is wearing it again.',
          ],
          flags: { _saw_card_pile: true, _card_known: true, _card_location_palmed: true },
          scales: { unease: +4 },
          composure: -2,
          composureCost: 'He is wearing it again.',
          choices: [
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        r_study_papers: {
          lines: [
            'The papers are notes — half in English, half in Greek, half in a script I cannot place. They are notes on each previous guest. What worked. What did not. How long each lasted. How each was lost.',
            'I read the most recent. The most recent is dated two months ago.',
            '~~He has been keeping a research notebook. He has been studying us.~~',
            'A column of names runs down the side. The column ends at my name. To the right of my name, in fresh ink, is a single word: ~~careful~~.',
          ],
          flags: { _read_papers: true, _heard_count: true },
          scales: { unease: +4 },
          composure: -1,
          composureCost: 'He has been keeping notes on me.',
          choices: [
            { label: 'back to the desk', goto: 'r_study_inside' },
          ],
        },

        r_study_notebook: {
          lines: [
            'I open the leather notebook. The notebook is the same notebook as in the library. The last page is the last page I read. The page now has another line below the one I had seen.',
            'The line reads: ~~The new guest has the keys. He is in the study. He is reading this entry as I write it. He will, I think, look up.~~',
            'I look up. The page is dry. The pen is on the desk. The pen is not in his hand.',
            '~~He is not writing this. The book is.~~',
          ],
          flags: { _saw_self_book: true },
          scales: { unease: +5 },
          composure: -3,
          composureCost: 'The book wrote the line as I read it.',
          choices: [
            { label: 'close the book', goto: 'r_study_inside' },
          ],
        },

        // ─── CELLAR ──────────────────────────────────────────────────
        //  The shard. The FREE path. Reaching this room requires
        //  knowledge of the back stair (from the cook, the library,
        //  or the clock-hall). Once here, the shard is on a low shelf
        //  at the back wall, behind the third bottle.
        // ─────────────────────────────────────────────────────────────

        r_cellar_approach: {
          lines: [
            'I open the door at the foot of the stair. The cellar is cold. The air is still. It tastes of wax and stone.',
            'Wine bottles in rows, stoppered with wax that is older than any country I would name. The bottles run to the back wall.',
            'A low shelf at the back wall, at the level of a man\'s knee.',
            'No one is down here. Polonius is not down here. The staff are not down here. The cellar is mine.',
          ],
          flags: { room: 'cellar', _been_cellar: true },
          scales: { unease: +2 },
          composure: +1,
          composureGain: 'No one is down here.',
          choices: [
            {
              label: 'look at the wine',
              goto: 'r_cellar_wine',
            },
            {
              label: 'check the back shelf',
              goto: 'r_cellar_shelf',
            },
            {
              label: 'search behind the third bottle',
              goto: 'r_cellar_third_bottle',
              when: (p) => p.flags._heard_shard_in_cellar,
            },
            { label: 'back up the stair', goto: 'hub_corridor' },
          ],
        },

        r_cellar_wine: {
          lines: [
            'I walk the rows. The wax seals on the bottles are stamped with shields I do not recognise — houses long extinguished. The dust on the bottles is undisturbed except along the third row, where a sleeve has brushed it thin.',
            '~~Someone has been at the third row recently.~~',
          ],
          flags: { _saw_dust_print: true },
          scales: { unease: +2 },
          choices: [
            { label: 'check that row', goto: 'r_cellar_third_bottle' },
            { label: 'back to the cellar', goto: 'r_cellar_approach' },
          ],
        },

        r_cellar_shelf: {
          lines: [
            'I cross to the low shelf at the back wall. The shelf is bare except for dust and a small wooden box.',
            'I open the box. Inside the box is a piece of broken pottery — terracotta, the colour of rust, with a curve to it. About the size of a thumbprint.',
            'On the inside curve of the shard, in a script that is older than my language, is a name. The name is not Polonius. The name is Greek and very short. It has a breathing mark in it.',
            '!!This is the shard. This is what holds him.!!',
          ],
          flags: { _have_shard: true, _knows_free_path: true, _binding_is_shard: true },
          scales: { unease: +3 },
          composure: +3,
          composureGain: 'I have the shard.',
          choices: [
            { label: 'pocket the shard; back to the cellar', goto: 'r_cellar_with_shard' },
          ],
        },

        r_cellar_third_bottle: {
          lines: [
            'I crouch at the third bottle in the third row. I move the bottle. Behind the bottle, against the cellar wall, is a small wooden box.',
            'I open the box. Inside the box is a piece of broken pottery — terracotta, the colour of rust, with a curve to it. About the size of a thumbprint.',
            'On the inside curve of the shard, in a script that is older than my language, is a name. The name is not Polonius. The name is Greek and very short. It has a breathing mark in it.',
            '!!This is the shard. This is what holds him.!!',
          ],
          flags: { _have_shard: true, _knows_free_path: true, _binding_is_shard: true },
          scales: { unease: +3 },
          composure: +3,
          composureGain: 'I have the shard.',
          choices: [
            { label: 'pocket the shard; back to the cellar', goto: 'r_cellar_with_shard' },
          ],
        },

        r_cellar_with_shard: {
          lines: [
            'I close the box. I put the shard in my pocket. The shard is warm.',
            'I climb the stair. The cellar is behind me. The kitchen is at the top.',
          ],
          flags: { _have_shard: true },
          scales: { unease: +2 },
          choices: [
            { label: 'back up to the corridor', goto: 'hub_corridor' },
            {
              label: 'break the shard here',
              goto: 'free_break_shard',
            },
          ],
        },

        // ═════════════════════════════════════════════════════════════
        //  CLUSTER: LULL — he wants you tired
        //
        //  Tiredness is the second-best ending for Polonius. A guest
        //  who sleeps in the house is bound. The chair, the wine, the
        //  bedroom — every comfort routes here. Players can wake up
        //  out of a drift but not out of a full sleep.
        // ═════════════════════════════════════════════════════════════

        l_drift: {
          lines: [
            'My eyes are closed. The fire is warm against the lid.',
            'When I open them — when I open them — Polonius is closer. He has moved. He is in the chair beside me, and the chair beside me was not there when I closed my eyes.',
            '!!I did not hear it move.!!',
            'He says, very softly: Sleep, sir. I will see to the rest.',
          ],
          composure: -3,
          composureCost: 'The chair moved.',
          scales: { tiredness: +4, unease: +4 },
          choices: [
            {
              label: 'wake up fully — stand',
              goto: { to: 'hub_corridor', lines: ['I push myself upright. My heart is pounding. The chair tries to keep me but I take my weight back. I walk out of the parlor without looking at him.'], scales: { tiredness: -4 }, composure: +2, composureGain: 'I am awake. I am back on my feet.' },
            },
            {
              label: 'use the sliver of glass to keep awake',
              goto: { to: 'hub_corridor', lines: ['I press the sliver into my thumb. The pain is small but it is the loudest thing in the room. I stand up.'], scales: { tiredness: -5 }, composure: +1, composureGain: 'A little blood. It keeps me here.', flags: { _used_sliver: true } },
              when: (p, player) => (player.items || []).includes('sliver_of_glass'),
            },
            {
              label: 'accept the bedroom; lie down properly',
              goto: 'l_offered_bed',
            },
            {
              label: 'close your eyes again',
              goto: { to: 'end_slept', lines: ['I close my eyes. Just for another moment. The chair is warm. He is humming, very softly, in a language I do not know.'], flags: { _slept: true } },
            },
          ],
        },

        l_offered_bed: {
          lines: [
            'He stands. He gestures down a corridor I do not remember being there before.',
            'There is a guest room. The bed is made. You have had a long evening. I would not be a host worth the name if I did not at least offer.',
            'The corridor he is gesturing toward is darker than the others.',
          ],
          scales: { tiredness: +2 },
          choices: [
            {
              label: 'follow him to the room',
              goto: 'l_bedroom',
            },
            {
              label: 'decline; go back to the corridor',
              goto: { to: 'hub_corridor', lines: ['I say: no, thank you. I really must be going.'], scales: { intimacy: -1 }, composure: +1, composureGain: 'I did not follow him down the dark corridor.' },
            },
            {
              label: 'tell him you will not sleep in this house',
              goto: { to: 'hub_corridor', lines: ['I say: I am not going to fall asleep in this house.', 'He smiles. He smiles small and tired. As you wish, sir. As you wish.'], scales: { unease: +2 }, composure: +1, composureGain: 'I said the thing out loud.' },
            },
          ],
        },

        l_bedroom: {
          lines: [
            'The room is small and warm. The window is bricked but painted to look like a window. The brick painting depicts a night sky I have never seen — the constellations are wrong, or very old.',
            'He stands at the door. I will leave you to rest, sir. I will not disturb. There is water on the table. I wish you well.',
            'He closes the door behind him. I hear the latch.',
          ],
          flags: { room: 'bedroom' },
          scales: { tiredness: +4 },
          composure: -2,
          composureCost: 'The latch.',
          choices: [
            {
              label: 'lie down',
              goto: { to: 'end_slept', lines: ['I lie down. Just for a moment, I tell myself. Just to think.'], flags: { _slept: true } },
            },
            {
              label: 'try the door',
              goto: 'l_bedroom_door',
            },
            {
              label: 'try the window',
              goto: 'l_bedroom_window',
            },
          ],
        },

        l_bedroom_door: {
          lines: [
            'The door is unlocked. He did not lock it. The latch I heard was only the latch.',
            'The corridor outside is empty. He has gone somewhere. The lamps have burned down.',
          ],
          choices: [
            {
              label: 'leave the room; back to the corridor',
              goto: { to: 'hub_corridor', lines: ['I step out. I do not look at the bed.'], composure: +1, composureGain: 'I did not sit down on it.' },
            },
            {
              label: 'go back to the bed',
              goto: { to: 'end_slept', lines: ['I close the door and turn back to the bed. The bed has been ready all evening.'], flags: { _slept: true } },
            },
          ],
        },

        l_bedroom_window: {
          lines: [
            'The window is brick. I touch the painting. The painting is paint over brick. The brick is real.',
            'In the painting, a small figure is standing on a far hill. The figure is looking at me. I had not noticed it before.',
          ],
          scales: { unease: +3 },
          composure: -2,
          composureCost: 'The figure had not been there before.',
          choices: [
            { label: 'try the door', goto: 'l_bedroom_door' },
            { label: 'lie down', goto: { to: 'end_slept', lines: ['I lie down. The bed is too soft.'], flags: { _slept: true } } },
          ],
        },

        // ═════════════════════════════════════════════════════════════
        //  CLUSTER: FACE — Polonius conversations from the hub
        //
        //  Selected by `talk to him` from hub_corridor. The exact node
        //  depends on his mood and what is known — poloniusFaceNode is
        //  the selector. The player can demand the card here, hear his
        //  pleas, hear his threats, or — if leverage is right — get
        //  him to bring the card to them. Most beats exit to hub_corridor
        //  except for the cornering beats, which can route to KILL.
        // ═════════════════════════════════════════════════════════════

        f_polite: {
          lines: [
            'I find him in the parlor. He is in the armchair opposite the butler. The butler is reading the paper.',
            'He rises when I come in. He has the small courtesy of a man who rises when a guest enters a room.',
            'Sir. The evening proceeds. May I be of any small assistance.',
          ],
          flags: { room: 'parlor' },
          scales: { intimacy: +1 },
          choices: [
            { label: 'small talk — ask about the wing', goto: 'f_about_arrangement' },
            { label: 'ask plainly for the card back', goto: 'f_demand_card', when: (p) => poloniusNoticed(p) },
            { label: 'press him on what is going on', goto: 'f_about_the_card', when: (p) => poloniusWondering(p) },
            { label: 'ask how to free him from the wing', goto: 'f_offers_trade', when: (p) => p.flags._heard_truth || p.flags._heard_binding },
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        f_ask_after_maid: {
          lines: [
            'I say: Mrs. Halliwell — has she returned with the card.',
            'He looks toward the inner doorway, fond. Not yet, sir. The cloakroom is locked at this hour, as I mentioned. She is, in her way, waiting on Mr. Halliwell\'s keys.',
            'He pauses. He has had this question before.',
            'You will find the keys faster than I will, sir. They are in his waistcoat pocket. He saves himself for breakfast in the evenings and will not come for a shout — but he will be obliging in person.',
          ],
          flags: { _heard_parlor_keys: true, _heard_keys_butler: true },
          scales: { intimacy: +1 },
          choices: [
            { label: 'back to the corridor', goto: 'hub_corridor' },
            { label: 'ask plainly for the card', goto: 'f_demand_card', when: (p) => poloniusNoticed(p) },
          ],
        },

        f_about_arrangement: {
          lines: [
            'I say: the staff — they all have their own room, by the day. Why is it arranged that way.',
            'He looks at me with the small attention of a man who knows he is being asked, by the question, about something more than the question.',
            'A tradition, sir. Mr. Halliwell in the parlor; Mrs. Halliwell in the foyer and the cloakroom; Mr. Cook in the dining room. They cross paths only at the meals. The arrangement has held since I was a young man.',
            'He pauses. He says, fond: they reset with the morning, sir. The arrangement does not change.',
            'He stops. The sentence got out before he weighed it. He watches me to see whether I have caught it.',
          ],
          flags: { _heard_staff_routine: true, _heard_staff_resets: true, _heard_origin: true },
          scales: { intimacy: +2, unease: +3 },
          composure: -1,
          composureCost: 'They reset with the morning.',
          choices: [
            { label: 'back to the corridor', goto: 'hub_corridor' },
            { label: 'press him', goto: 'f_about_the_card', when: (p) => poloniusWondering(p) },
          ],
        },

        f_demand_card: {
          lines: [
            'I say: I would like the card back, sir. Plainly.',
            'He inclines his head. The smile is polite and tired. The card is at the back of the house, sir. In the cloakroom. I do not have it on my person; I gave it to Mrs. Halliwell. She locked it with the coats.',
            'He pauses. He lifts his arms a small way from his sides.',
            'You may, of course, search me. If it would put your mind at rest.',
          ],
          flags: { _heard_card_offer_search: true },
          scales: { intimacy: +1 },
          choices: [
            {
              label: 'take him up on it; search him',
              goto: 'f_search_polonius',
            },
            {
              label: 'press him — that is not the whole of it',
              goto: 'f_press_lie',
              when: (p) => poloniusWondering(p),
            },
            { label: 'thank him; back to the corridor', goto: 'hub_corridor' },
          ],
        },

        f_search_polonius: {
          lines: [
            'I step forward. I put my hands on him. He does not flinch. His coat is the wrong temperature; it has been against his body for so long that the body has become the coat.',
            'I search the vest pocket. The vest pocket is —',
          ],
          choices: [
            {
              label: 'look',
              goto: (p) => p.flags._card_location === 'palmed' ? 'f_search_card_found' : 'f_search_empty',
            },
          ],
        },

        f_search_card_found: {
          lines: [
            'In his vest pocket is my admission card. I take it out. The number on it is my number.',
            '!!I have the card.!!',
            'Polonius is still, very still. He has not stopped me. He has not pulled away. He says, very quietly: well done, sir. The forty-first did not have the courage.',
            'His eyes do something that the mask does not move to cover.',
          ],
          flags: { _card_location: 'recovered', _recovered_from: 'polonius' },
          scales: { unease: +3, intimacy: +1 },
          composure: +3,
          composureGain: 'I touched him for it.',
          choices: [
            {
              label: 'walk to the front door',
              goto: (p) => poloniusDoorAttempt(p),
            },
            {
              label: 'step back; back to the corridor',
              goto: 'hub_corridor',
            },
          ],
        },

        f_search_empty: {
          lines: [
            'The vest pocket is empty. I check the other pockets. They are empty. I check the coat. The coat hangs the wrong way around him but the pockets are empty.',
            'He smiles. As I said, sir. The card is at the back of the house. I would not lie to you about the card.',
            '~~He would lie to me about anything. But not about this. He wants me to chase the card. He wants me deeper.~~',
          ],
          flags: { _searched_polonius: true },
          scales: { unease: +2 },
          composure: -1,
          composureCost: 'It was not on him.',
          choices: [
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        f_press_lie: {
          lines: [
            'I say: that is a lie. You know where the card is. You moved it. You are still moving it.',
            'He nods, slowly. He does not deny.',
            'I am, sir. I am moving it. Mr. Halliwell has retrieved it from the cloakroom; he is on his way to the study with it now. The drawer in the study is locked. The key to the drawer is in my pocket.',
            'He produces a small brass key. He turns it once over in his fingers. He returns it to his vest.',
            '~~He has shown me. He has told me. He has done both as a courtesy.~~',
            'I am not lying to you about the shape of the evening, sir. I am only winning. Walk through the house. Try.',
          ],
          flags: { _heard_card_in_study: true, _heard_truth: true, _mask_on: false, _heard_drawer_key: true, _card_location: 'study' },
          scales: { unease: +5, intimacy: +2 },
          composure: -2,
          composureCost: 'He has told me he is winning.',
          choices: [
            { label: 'back to the corridor', goto: 'hub_corridor' },
            { label: 'lunge for the brass key', goto: 'f_lunge_key' },
            { label: 'find a weapon', goto: 'k_strike_consider' },
          ],
        },

        f_lunge_key: {
          lines: [
            'I lunge for his vest. His hand is on my wrist before I have closed the distance. The grip is light. It is also unmovable.',
            'Sir. Please. He is mild about it. I will not let you have the key by this method. The butler will be at the study in a moment regardless. I am giving you a fair race.',
            'He releases me. He nods. He sits back down.',
          ],
          scales: { unease: +2 },
          composure: -2,
          composureCost: 'His grip was the maid\'s grip.',
          choices: [
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        f_about_the_card: {
          lines: [
            'I say: why are you doing this. Why take the card at all. Why not lock the door and have done with it.',
            'He smiles. He looks at the fire.',
            'Because, sir, a locked door is a noise. A locked door brings a guest banging on it. A guest who bangs on a door is a guest who does not stay long enough. The card is a — kindness. The card lets you believe you can go. The card lets you believe with every step deeper that you are still walking toward the door.',
            'He pauses. I am sorry, sir. I am being honest. I have not had the energy for elaborate cruelties in a long time. The card is the cruelty I have left.',
          ],
          flags: { _heard_truth: true, _mask_on: false, _mood: 'mournful' },
          scales: { unease: +5, intimacy: +3 },
          composure: -2,
          composureCost: 'The card is the cruelty he has left.',
          choices: [
            { label: 'how do I get out', goto: 'f_how_to_leave' },
            { label: 'how do I free you', goto: 'f_offers_trade' },
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        f_how_to_leave: {
          lines: [
            'He looks at me. The look is long, and patient, and tired beyond what should be possible for one face.',
            'Walk back through the front door, sir. With the card. The door will read. The door will open. It always has.',
            'He pauses. But sir. I will be honest with you again. I will do everything I am able to do to keep you in this house long enough for an accident to occur. I am owed an accident. After this, I will not be a man with you. I will be a tenant.',
          ],
          scales: { unease: +5, intimacy: +3 },
          composure: -2,
          composureCost: 'He warned me. That was kindness, of a sort.',
          flags: { _heard_warning: true, _heard_truth: true, _mask_on: false, _heard_curse_rule: true },
          choices: [
            { label: 'walk out and start the hunt', goto: 'hub_corridor' },
            { label: 'how do I free you instead', goto: 'f_offers_trade' },
          ],
        },

        f_offers_trade: {
          lines: [
            'I say: tell me how to free you. Without becoming the next tenant.',
            'He is quiet for a long moment.',
            'There is a shard, sir. A piece of broken clay. It was buried in the foundation of the house, the day the house was first cursed. It has my name written on it — my first name, in a language nobody alive speaks. I moved it to the cellar a long time ago, when I still hoped to break it myself.',
            'I have not broken it. I have not been able to break it. The hand that placed it is the hand that must not break it. Someone not of the day must break it. You are not of the day, sir.',
            'If the shard is broken, the binding ends. I will go. I will go the way men go — old, and tired, and human. The staff will go with me. The house will be empty.',
            'You will not be bound. The curse needs a tenant; if there is no tenant when the curse ends, the curse ends with it. The door will open. You will walk out.',
            '~~He has told me the whole of it. He could have lied. He did not lie.~~',
          ],
          flags: { _heard_binding: true, _heard_binding_full: true, _binding_is_shard: true, _knows_free_path: true, _heard_cellar: true, _heard_shard_in_cellar: true },
          scales: { intimacy: +4, unease: +2 },
          composure: -1,
          composureCost: 'He gave me the path out of him.',
          choices: [
            {
              label: 'why are you telling me this',
              goto: 'f_why_telling_me',
            },
            {
              label: 'where is the shard',
              goto: { to: 'hub_corridor', lines: ['I say: where is the shard. He smiles. In the cellar, sir. On a low shelf at the back wall. Behind the third bottle in the third row. Mr. Cook has put a hand print on the row, if you are paying attention.', '~~He has told me where. He has told me. He is asking me to do it.~~'], flags: { _heard_shard_in_cellar: true } },
            },
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        f_why_telling_me: {
          lines: [
            'He smiles. The smile is small and old and not unkind.',
            'Because I am tired, sir. Because I am a man who has been waiting a very long time, and I have, at the centre of myself, the small part that has always wanted the rest of me to go. I would like to go, sir. I would like to go the way men go.',
            'He pauses. I am also a man who, when the shard is in the cellar and you are upstairs and the card is on me, will move to the front door faster than you. I am the man and I am the tenant. I am asking you to be quick.',
            '~~He has told me he is tired. He has told me he will fight me. Both are true. He has been both for nine hundred years.~~',
          ],
          scales: { intimacy: +5, unease: +3 },
          composure: -2,
          composureCost: 'Both are true.',
          flags: { _mood: 'broken', _heard_origin: true },
          choices: [
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        f_dropped: {
          lines: [
            'I find him in the parlor. The chair is empty. He is standing. The fire is burning low.',
            'He has stopped pretending. The face does not arrange itself the way a face does. The smile is on the wrong part of the mouth. The eyes do not blink in the way an eye blinks.',
            '!!Καλά, sir. Πολύ καλά.!! he says, very quietly. I have been honest. I have been more honest than I have been in a long time. I find I am out of polite.',
          ],
          flags: { _mask_on: false, _mood: 'predatory' },
          scales: { unease: +5 },
          composure: -2,
          composureCost: 'The smile is on the wrong part of the mouth.',
          choices: [
            { label: 'demand the card', goto: 'f_demand_card' },
            { label: 'find a weapon', goto: 'k_strike_consider' },
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        f_step_away: {
          lines: [
            'I say: step away from the front door.',
            'He smiles, broken. I have not been at the front door, sir. I will be at the front door when you are at the front door, and not before. I am a courteous host. I do not crowd the threshold.',
            'He pauses. But sir — when you do come to it, I will be there a beat ahead. That is the only beat I need. One beat.',
            '~~One beat. He will be one beat ahead. I will need to be the one in front.~~',
          ],
          flags: { _heard_one_beat: true, _polonius_at_door: false },
          scales: { unease: +3, intimacy: +1 },
          composure: -1,
          composureCost: 'One beat.',
          choices: [
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        // ═════════════════════════════════════════════════════════════
        //  CLUSTER: KILL — the violence path
        //
        //  A weapon, an act, an aftermath. The body releases the curse
        //  for a window of time — Polonius has told the player they
        //  will have one hour before dawn to cross the threshold. If
        //  the player kills him with the card already in pocket, the
        //  walk-out is clean (with blood). If the card is still in the
        //  house, the player must find it from the body or from the
        //  rooms before dawn.
        // ═════════════════════════════════════════════════════════════

        k_strike_consider: {
          lines: [
            'I find him. He is wherever he is — in the parlor by the fire, or in the corridor, or at the foot of the stair. He does not run.',
            'I have a weapon in my hand. The weapon is —',
            (p) => p.flags._weapon === 'poker'   ? 'The iron poker from the parlor grate. It is heavy. It is warm.' :
                   p.flags._weapon === 'cleaver' ? 'The cook\'s cleaver. The handle is bone. The blade is the colour of old water.' :
                   p.flags._weapon === 'knife'   ? 'The cook\'s knife. The handle has worn to his hand.' :
                   'My hands. Only my hands.',
            'He is looking at the weapon. He has gone very still. The stillness is not the prey stillness. It is the stillness of something choosing not to move.',
            'Sir. He is mild about it. If you do this, you will have one hour to cross the threshold before dawn. You will not have me. I have done it. The body remains.',
            'He pauses. He adds, more quietly: I would not begrudge you the hour.',
          ],
          scales: { unease: +3 },
          flags: { _at_strike: true },
          choices: [
            {
              label: 'strike',
              goto: 'k_strike_now',
              when: (p) => !!p.flags._armed && !!p.flags._weapon,
            },
            {
              label: 'wait — go find a weapon first',
              goto: { to: 'hub_corridor', lines: ['I lower my hand. I am unarmed. I need something heavier than a man\'s hand for this.'], composure: -1, composureCost: 'I lost the moment.' },
              when: (p) => !p.flags._armed || !p.flags._weapon,
            },
            {
              label: 'put it down',
              goto: { to: 'hub_corridor', lines: ['I lower the weapon. I take a breath. I do not strike. I will not be the man who strikes if I can be the man who finds another way.'], composure: +1, composureGain: 'I did not.', flags: { _refused_strike: true } },
            },
          ],
        },

        k_strike_now: {
          lines: [
            'I bring the weapon down on the side of his head. The first blow is the worst, in that it is the only one I have to commit to. The skull gives the way old wood gives.',
            '!!The second blow is mechanical. The third I do not remember.!!',
            'His body lies on the rug. The blood is the wrong colour — too dark, with a sheen of something metallic. The mouth has stopped being a mouth.',
            'The staff are gone. They were here a moment ago. They are not here. The clock without hands has stopped swinging.',
            'I look down at him. He is, somehow, smiling. The smile is the smallest one. It is, I think, gratitude.',
          ],
          composure: -5,
          composureCost: 'The skull gave the way old wood gives.',
          flags: { _killed_polonius: true, _staff_dissolved: true },
          choices: [
            {
              label: 'search the body',
              goto: 'k_search_body',
            },
          ],
        },

        k_search_body: {
          lines: [
            'I crouch. I search his pockets. The body weighs less than it should.',
            'The vest pocket has —',
          ],
          choices: [
            {
              label: 'look',
              goto: (p) => p.flags._card_location === 'palmed' || p.flags._card_location === 'study'
                ? 'k_search_card_on_body'
                : 'k_search_no_card_on_body',
            },
          ],
        },

        k_search_card_on_body: {
          lines: [
            'In the vest pocket: my admission card. It was on him. He had taken it back when his mood cooled, and he had kept it close, the way a man keeps a small ill-advised pet.',
            'I take the card. The number is my number.',
            '!!I have it. The body is here. The card is in my pocket.!!',
            'The clock in the hall begins to chime. It chimes a number. I do not count the chimes. I have an hour.',
          ],
          flags: { _card_location: 'recovered', _recovered_from: 'body' },
          scales: { unease: +2 },
          composure: +2,
          composureGain: 'The card is in my pocket.',
          choices: [
            {
              label: 'walk to the front door',
              goto: 'k_dawn_walk',
            },
          ],
        },

        k_search_no_card_on_body: {
          lines: [
            'The vest pocket is empty. The card is not on him. The card is in the study, where he left it.',
            'The clock in the hall begins to chime. It chimes a number. I do not count the chimes. I have an hour. I have less.',
          ],
          flags: { _card_known: true, _need_to_find_card: true },
          scales: { unease: +3 },
          composure: -1,
          composureCost: 'It was not on him.',
          choices: [
            {
              label: 'sprint for the study',
              goto: 'k_sprint_study',
            },
            {
              label: 'walk; you have time',
              goto: { to: 'hub_corridor', lines: ['I stand. The house is empty of staff. I have the run of it. I have an hour.'] },
            },
          ],
        },

        k_sprint_study: {
          lines: [
            'I run for the back of the house. The corridor is empty. The doors are open. The study door is not locked — there is no butler to lock it, and the lock was at the master\'s direction.',
            'I find the desk. I find the drawer. The drawer is locked.',
            'I find the small brass key in the dead man\'s pocket — I went back for it without thinking — and the drawer opens.',
            'My card is on top of the pile of forty-one. I take it.',
            '!!I have the card.!!',
            'The clock chimes another number behind me.',
          ],
          flags: { _card_location: 'recovered', _recovered_from: 'study_after_kill' },
          scales: { unease: +2 },
          composure: +3,
          composureGain: 'The drawer opened.',
          choices: [
            {
              label: 'walk to the front door',
              goto: 'k_dawn_walk',
            },
          ],
        },

        k_dawn_walk: {
          lines: [
            'I walk for the front of the house. The corridor is longer than it should be. The wallpaper has the same dust on it as the rest of the house.',
            'The foyer. The front door. The brass slot.',
            'I press the card to the slot. The slot reads. The lock clicks. The door swings inward.',
            'The hospital corridor is on the other side. The lights are too bright after the lamps. The corridor is the corridor.',
            'I step through. I do not look back.',
          ],
          flags: { _walked_free: true, _escaped_violent: true },
          composure: +1,
          composureGain: 'I crossed.',
          choices: [
            { label: 'end', goto: 'end_walked_free_violent' },
          ],
        },

        // ═════════════════════════════════════════════════════════════
        //  CLUSTER: FREE — the shard, the mercy ending
        //
        //  Player breaks the shard. Polonius ages, dies cleanly. The
        //  staff fade. The card materialises in the player's pocket if
        //  it was not there. The door opens with no resistance.
        // ═════════════════════════════════════════════════════════════

        free_break_shard: {
          lines: [
            'I take the shard from my pocket. It is warm — warmer than I am. I close my hand around it.',
            'I look at it. The name on the inside curve is faded. I close my hand harder.',
            'The shard breaks. The break is not the sound of clay. The break is the sound of a door, very far away, swinging open.',
            'The pieces fall through my fingers. The pieces are small and red.',
          ],
          flags: { _broke_shard: true },
          scales: { unease: +2 },
          composure: -1,
          composureCost: 'The sound was the sound of a door.',
          choices: [
            { label: 'climb to find him', goto: 'free_he_ages' },
          ],
        },

        free_he_ages: {
          lines: [
            'I climb the stair. The cellar is behind me. The kitchen is empty — the cook is gone, and not in the way of staff going. The apron is on the floor. There is no body inside the apron.',
            'I cross the corridor. The wallpaper is fading as I walk. The lamps are going out one by one. The house is finishing.',
            'I find him in the parlor. He is in the chair he was always in. He is not the man he was when I came in.',
            'He is older. He is the age the shard was. His hands are the colour of old paper. His eyes have gone soft and far. He is smiling. The smile is the smallest he has produced and the largest he has meant.',
            'He says, very quietly: thank you. The Greek is rough on his tongue, in the way it is rough on a tongue that has not used it in centuries.',
            'He closes his eyes. He does not open them.',
            'The chair holds an old man, not breathing.',
          ],
          flags: { _freed_polonius: true, _polonius_died: true, _staff_dissolved: true },
          scales: { unease: +3 },
          composure: -2,
          composureCost: 'He was lighter when I touched his shoulder.',
          choices: [
            { label: 'check your pocket', goto: 'free_card_returns' },
          ],
        },

        free_card_returns: {
          lines: [
            'I pat the pocket. The pocket is heavier than empty. I bring out my admission card. The number on it is my number. It is warm.',
            'I do not know how it got there. The house may have decided. The house is empty now. The house has no opinions.',
            '!!I have the card.!!',
          ],
          flags: { _card_location: 'recovered', _recovered_from: 'freed' },
          scales: { unease: +1 },
          composure: +3,
          composureGain: 'The card came back.',
          choices: [
            { label: 'walk to the front door', goto: 'free_walk_out' },
          ],
        },

        free_walk_out: {
          lines: [
            'I walk to the foyer. The grandfather clock is silent. The clock has no pendulum any more — the pendulum is on the floor, where it has fallen.',
            'The front door. The brass slot. I press the card.',
            'The slot reads. The lock clicks. The door swings inward.',
            'The hospital corridor is on the other side. I step through.',
            'Behind me, the wing settles. The wallpaper darkens, the way old paper darkens, all at once.',
            'When I look back, the door is gone. There is a wall where the door was. There has never been a Greek Wing.',
          ],
          flags: { _walked_free: true, _freed_polonius: true },
          composure: +2,
          composureGain: 'I let him out.',
          choices: [
            { label: 'end', goto: 'end_walked_free_freed' },
          ],
        },

        // ═════════════════════════════════════════════════════════════
        //  CLUSTER: RECKONING — the door, the trap, the endings
        //
        //  poloniusDoorAttempt routes the player based on card state
        //  and tiredness. Without a card, the door is plaster from this
        //  side. With a card, the player either walks out clean or
        //  meets Polonius at the threshold for the trap.
        // ═════════════════════════════════════════════════════════════

        e_door_locked: {
          lines: [
            'I walk to the front door. The brass slot is at chest height. I press my palm to the wood. The wood is wood.',
            'The slot is the only opening. The slot reads cards. The slot does not read palms.',
            'The corridor I came in by is plaster, the way a corridor is plaster when there has never been a corridor.',
            'I cannot leave by this door without the card.',
          ],
          flags: { _aware_locked: true, _tried_door_again: true },
          scales: { unease: +2 },
          composure: -1,
          composureCost: 'I cannot leave by this door without the card.',
          choices: [
            { label: 'back to the corridor', goto: 'hub_corridor' },
          ],
        },

        e_door_in_reach: {
          lines: [
            'I walk for the front of the house. The corridor seems longer than it did. The wallpaper darkens as I walk.',
            'The foyer. The front door. The brass slot.',
            'Polonius is in the foyer. He arrived without my hearing him. He is between me and the door, but only barely. He has placed himself to make a point, not to make a barrier.',
            'Sir, he says. One last word. Please. One.',
            '~~He is not asking. He is not blocking either. He is doing the small bow a man does when he has lost.~~',
          ],
          flags: { room: 'foyer' },
          scales: { unease: +2 },
          composure: +1,
          composureGain: 'I have the card. He is doing the bow.',
          choices: [
            {
              label: 'press the card to the slot; walk through',
              goto: 'e_walk_through',
            },
            {
              label: 'hear his last word',
              goto: 'e_last_word',
            },
            {
              label: 'invite him to walk out with you',
              goto: 'e_invite_him_lie',
            },
          ],
        },

        e_walk_through: {
          lines: [
            'I press the card to the slot. The slot reads.',
            'The lock clicks. The door swings inward. The hospital corridor lies beyond it.',
            'I do not look at him. I cross the threshold.',
            'I do not look back into the wing as I walk down the corridor toward the ward I should have been in all along.',
            'The doorway behind me, when I look at the wall by the lights of the hospital, is no longer there.',
          ],
          flags: { _walked_free: true },
          choices: [
            { label: 'end', goto: 'end_walked_free' },
          ],
        },

        e_last_word: {
          lines: [
            'I let him speak. He bows.',
            'Sir. Thank you. Thank you for the evening. It has been pleasant. It has been pleasant the way a meal is pleasant — there is the eating and then there is the wanting more.',
            '~~He means he is going to remember me for a long time.~~',
            'He smiles. Go. I will not delay you. I would not be a host worth the name.',
            'He steps aside. He steps aside half a step. The doorway is open.',
          ],
          composure: +1,
          composureGain: 'He let me leave with a word.',
          choices: [
            {
              label: 'press the card; walk through',
              goto: 'e_walk_through',
            },
            {
              label: 'one last question',
              goto: 'e_last_question',
            },
          ],
        },

        e_last_question: {
          lines: [
            'He waits, patient. He has all the time in the world. He always has.',
            'Ask, sir.',
          ],
          choices: [
            {
              label: 'what was your real name',
              goto: { to: 'e_walk_through', lines: ['I ask his real name. He does not answer. He smiles. He inclines his head.', 'I press the card to the slot.'] },
            },
            {
              label: 'how many guests',
              goto: { to: 'e_walk_through', lines: ['I ask how many. He smiles. Forty-one, sir. You would have been forty-two.', '~~He sounded pleased to say a number.~~', 'I press the card to the slot.'] },
            },
          ],
        },

        e_invite_him_lie: {
          lines: [
            'I say: walk out with me. Together. We will step over at the same moment.',
            'He smiles. The smile is bright. It is the brightest his face has been since I came in.',
            'Yes. Yes. Together. We would step over the threshold at the same moment, would we not. We would. We would take a step at once, sir.',
            'He repeats the words "at once" a second time, more quietly. The repetition has a small extra weight.',
            'He extends his arm to my elbow.',
          ],
          scales: { intimacy: +3, unease: +3 },
          flags: { _agreed_together: true },
          choices: [
            {
              label: 'take his arm; walk together',
              goto: 'e_polonius_a_step_ahead',
            },
            {
              label: 'on second thought, walk through alone',
              goto: { to: 'e_walk_through', lines: ['I say: actually — no. I will not. I press the card to the slot myself. He smiles. The smile is small.'] },
            },
          ],
        },

        e_door_polonius_waits: {
          lines: [
            'I walk for the front of the house. The corridor seems longer than it did. The wallpaper has changed colour. The lamps are further apart.',
            'Polonius is in the corridor. He is between me and the foyer. He is not pretending now. The face is in pieces. The smile holds; the rest of the face has rearranged itself to make room for it.',
            'He says, very quietly: sir. I am sorry. We are at the part of the evening that I had hoped to avoid.',
          ],
          scales: { unease: +5 },
          composure: -2,
          composureCost: 'The face was in pieces.',
          choices: [
            {
              label: 'feint and dart past him',
              goto: 'e_dart_past',
            },
            {
              label: 'press the card high; walk through him',
              goto: 'e_walk_through_him',
            },
            {
              label: 'grab the poker from the foyer fire',
              goto: 'k_strike_consider',
              when: (p) => !p.flags._armed,
            },
            {
              label: 'strike him with what you have',
              goto: 'k_strike_consider',
              when: (p) => !!p.flags._armed,
            },
          ],
        },

        e_dart_past: {
          lines: [
            'I feint right and dart left. He does not follow the feint. He does not need to. He has been doing this for nine hundred years.',
            'His arm comes around. It is not the speed of an arm. It is the speed of something that has decided to be an arm in that moment.',
            'I am, however, faster — because I have been moving for the last half-hour, and he has been sitting in chairs.',
            'I am past him. The door is six paces away.',
          ],
          flags: { _escaped_violent: true },
          scales: { unease: +3 },
          composure: +1,
          composureGain: 'I was faster.',
          choices: [
            { label: 'press the card to the slot', goto: { to: 'e_walk_through', lines: ['I press the card. The slot reads.'] } },
          ],
        },

        e_walk_through_him: {
          lines: [
            'I drive my shoulder into his sternum. He folds — he folds the way a stack of paper folds, with no rigidity to push back through. He is lighter than he should be.',
            'He is on the rug. He is not making the sounds a winded man makes. He is making the sounds a winded actor makes from the wings of a stage.',
            'I press the card to the slot. The slot reads.',
          ],
          composure: +2,
          composureGain: 'He went down. He was as light as I had thought.',
          flags: { _knocked_polonius_down: true, _escaped_violent: true },
          choices: [
            { label: 'walk through', goto: 'e_walk_through' },
          ],
        },

        e_polonius_a_step_ahead: {
          lines: [
            'We walk together. His arm is on mine. His arm is too light. We cross the foyer. The door is open — has the slot read already? — and we are at the threshold.',
            'He says, at once, sir, at once, and his foot crosses the threshold a beat before mine. Only a beat. I see his shoe touch the corridor floor before mine has lifted.',
            'I try to step. The doorway is in front of me but my foot will not go.',
          ],
          composure: -4,
          composureCost: 'A beat.',
          flags: { _polonius_left_first: true },
          choices: [
            {
              label: 'try harder',
              goto: 'end_polonius_escaped_node',
            },
          ],
        },

        end_polonius_escaped_node: {
          lines: [
            'I push against nothing. My foot will not cross. The doorway is in front of me, an inch from my face.',
            'He is in the corridor. He is laughing. He is laughing a laugh I have not heard from him. It is the laugh of someone who has just woken up.',
            'He walks down the corridor. He does not look back.',
            'The door closes. The maid is behind me. She is smiling. She says: Welcome home, sir.',
          ],
          flags: { _became_tenant: true },
          composure: -3,
          composureCost: 'A beat.',
          choices: [
            { label: 'end', goto: 'end_polonius_escaped' },
          ],
        },

        e_drift_mid_walk: {
          lines: [
            'My legs are heavy. The corridor is going dim at the edges. The wallpaper is folding in.',
            'I lean against the wall. Just for a moment. The wall is warm.',
            'I will close my eyes only for a moment.',
          ],
          choices: [
            {
              label: 'force yourself awake',
              goto: { to: 'hub_corridor', lines: ['I shake my head. I push off the wall. I will not. I will not.'], scales: { tiredness: -4 }, composure: -1 },
            },
            {
              label: 'use the sliver to wake yourself',
              goto: { to: 'hub_corridor', lines: ['I press the sliver into my thumb. The pain is small but it is the loudest thing in the corridor. I am awake. I push off the wall.'], scales: { tiredness: -5 }, composure: +1, composureGain: 'A little blood. It keeps me here.', flags: { _used_sliver: true } },
              when: (p, player) => (player.items || []).includes('sliver_of_glass'),
            },
            {
              label: 'just for a moment',
              goto: { to: 'end_slept_node', lines: ['Just for a moment. The wallpaper is so warm. The corridor is so quiet.'], flags: { _slept: true } },
            },
          ],
        },

        end_slept_node: {
          choices: [ { label: 'end', goto: 'end_slept' } ],
        },

        // ─── Card-destruction sub-cluster ───────────────────────────
        //  A few beats in the house can place the card on the fire or
        //  in the cellar shelves with the wines. If the card burns,
        //  the player cannot leave — the only way out becomes the
        //  FREE path (break the shard, the house ends, the door opens
        //  on its own). If the player has no shard, the card-fire
        //  ending is terminal.
        // ─────────────────────────────────────────────────────────────

        card_burns: {
          lines: [
            'The card is in the fire. The fire is small but the card is paper.',
            'The card curls at the corners. The number on it browns and goes.',
            'In a moment, the card is ash.',
          ],
          flags: { _card_location: 'ash', _card_destroyed: true },
          scales: { unease: +5 },
          composure: -3,
          composureCost: 'The card is ash.',
          choices: [
            {
              label: 'find the shard; this is the only way out now',
              goto: 'hub_corridor',
              when: (p) => !p.flags._have_shard,
            },
            {
              label: 'break the shard',
              goto: 'free_break_shard',
              when: (p) => p.flags._have_shard,
            },
            {
              label: 'sit down. There is no way out',
              goto: { to: 'end_imprisoned_node', lines: ['I sit by the fire. The fire is small. The fire has my card.', 'I do not know how long I sit there. I think I may have sat there for a long time.'], flags: { _imprisoned: true } },
              when: (p) => !p.flags._knows_free_path,
            },
          ],
        },

        end_imprisoned_node: {
          choices: [ { label: 'end', goto: 'end_imprisoned' } ],
        },

      },  // end nodes
    },  // end main spoke
  },  // end spokes

  // ─────────────────────────────────────────────────────────────────────
  //  INTERJECTIONS — uninvited beats that interrupt the conversation.
  //  They fire on probabilistic timers tied to turn count / state and
  //  shove the player into a beat they didn't choose. The one-turn
  //  cooldown plus the spoke-active guard mean they only land between
  //  beats, never mid-scene.
  // ─────────────────────────────────────────────────────────────────────
  interjections: [
    // Card-tick — when the player has lingered, the staff move the
    // card deeper. This is the most important interjection in the
    // new design: it advances the hunt's clock.
    {
      id: 'maid_passes_with_card',
      when: (p) => p.flags._card_location === 'maid'
                && p.turn >= 3
                && !p.flags._card_known_endgame
                && Math.random() < 0.85,
      prose: [
        'Mrs. Halliwell crosses the corridor in front of me without acknowledging me. She is carrying a small pale thing in her apron pocket. I can see the corner of it.',
        '~~My card. She has just moved my card. She is heading for the back of the house.~~',
      ],
      responses: [
        {
          label: 'follow her, fast',
          desc: 'Chase the card.',
          lines: [
            'I follow. She rounds the corner faster than she walked. By the time I round it, the cloakroom door is closing.',
            'She is no longer in the corridor. She is on the other side of the cloakroom door. I hear the lock turn.',
          ],
          scales: { unease: +2 },
          flags: { _card_location: 'cloakroom', _card_known: true, _heard_card_in_cloakroom: true, _aware_locked: true, _heard_parlor_keys: true },
        },
        {
          label: 'let her go; mark where she went',
          desc: 'Stay calm.',
          lines: [
            'I watch her round the corner. The cloakroom is at the back of the house. The card has gone there.',
          ],
          scales: { unease: +1 },
          composure: +1,
          composureGain: 'I am not running in a corridor.',
          flags: { _card_location: 'cloakroom', _card_known: true, _heard_card_in_cloakroom: true, _aware_locked: true },
        },
      ],
    },

    {
      id: 'butler_carries_card',
      when: (p) => p.flags._card_location === 'cloakroom'
                && p.turn >= 7
                && !p.flags._have_cloakroom_keys
                && Math.random() < 0.85,
      prose: [
        'Mr. Halliwell crosses my line of sight. He is folding a small pale thing into the paper. He has just come from the cloakroom.',
        '~~The card has moved. It is in the newspaper. The newspaper is in the parlor.~~',
      ],
      responses: [
        {
          label: 'follow him; do not be seen',
          desc: 'Track the card.',
          lines: [
            'I follow at a distance. He goes to the parlor. He sits in the armchair. He opens the paper. The card is folded into the second column.',
            'I have the room where the card is. I do not yet have the card.',
          ],
          scales: { unease: +2 },
          flags: { _card_location: 'butler', _card_known: true, _saw_butler_with_card: true },
        },
        {
          label: 'demand he give it to you',
          desc: 'Confront.',
          lines: [
            'I step in front of him. I say: the card. Now.',
            'He looks at me. The face is the polite face. Sir, he says, the cloakroom is locked at this hour. The master will see to the card. I am only delivering it.',
            'He keeps walking. He is past me before I can answer.',
          ],
          scales: { unease: +3 },
          flags: { _card_location: 'butler', _card_known: true },
        },
      ],
    },

    {
      id: 'butler_to_study',
      when: (p) => p.flags._card_location === 'butler'
                && p.turn >= 10
                && Math.random() < 0.85,
      prose: [
        'Mr. Halliwell rises from the armchair. He folds the paper. He walks to the door of the parlor and into the corridor.',
        'He is going to the study. The card is in the paper. The paper is in his hand.',
      ],
      responses: [
        {
          label: 'cut him off',
          desc: 'Get in his way.',
          lines: [
            'I step in front of him in the corridor. He does not stop. He passes through the place I am standing — not through me, but around me, in pieces. I am not in his way after all.',
            'He goes into the study. I hear the lock turn. The card is in the study now.',
          ],
          scales: { unease: +3 },
          composure: -1,
          composureCost: 'He passed around me in pieces.',
          flags: { _card_location: 'study', _card_known: true, _heard_study: true, _heard_card_in_study: true },
        },
        {
          label: 'follow at a distance',
          desc: 'Mark the route.',
          lines: [
            'I keep my distance. He unlocks the study door. He goes in. The door shuts. The lock turns. The card is in the study now.',
            'I have the room. I do not have the keys.',
          ],
          scales: { unease: +1 },
          flags: { _card_location: 'study', _card_known: true, _heard_study: true, _heard_card_in_study: true },
        },
      ],
    },

    {
      id: 'polonius_at_threshold',
      when: (p) => p.flags._card_location === 'recovered'
                && !p.flags._walked_free
                && !p.flags._broke_shard
                && p.turn >= 1
                && !p.flags._fired_polonius_at_threshold
                && Math.random() < 0.9,
      prose: [
        'I notice — without being told, the way one notices a draught — that Polonius is no longer where I saw him last.',
        'He is at the front of the house. He has placed himself, with no haste, in the foyer. He is not at the door, but he is closer to it than the door is to me.',
        '~~He is between me and the threshold. He is making sure he can go first if I go.~~',
      ],
      responses: [
        {
          label: 'walk to the door now; do not think',
          desc: 'Race him.',
          lines: [
            'I walk for the front of the house. I do not slow. I do not look at him as I pass. The slot. The card. The door.',
          ],
          flags: { _polonius_at_door: true },
        },
        {
          label: 'wait; let him commit first',
          desc: 'Hold position.',
          lines: [
            'I do not move. He does not move. We are both standing very still in the corridor between us. He, eventually, with the small grace of a man who has run out of patience, takes a half-step closer to the foyer.',
            '~~He cannot wait me out. I can, however, wait him out for a few beats more.~~',
          ],
          scales: { unease: +2 },
          composure: +1,
          composureGain: 'I did not move first.',
          flags: { _polonius_at_door: true },
        },
      ],
    },

    {
      id: 'clock_chimes',
      once: true,
      when: (p) => p.turn >= 8
                && !p.flags._walked_free
                && Math.random() < 0.65,
      prose: [
        'The clock without hands chimes. It chimes a number I do not count. It chimes for longer than a clock should.',
        'Polonius, somewhere nearby, says, almost to himself: Late. Later than I thought. Sir — we have less time than I had imagined.',
      ],
      responses: [
        {
          label: 'what happens when the chimes stop',
          desc: 'Press him.',
          lines: [
            'I say: what happens when the chimes stop.',
            'He smiles. The dawn, sir. The dawn returns the staff to the day. The dawn does not return me. The dawn would, in your case, finish the evening.',
            '~~The dawn would finish the evening. He has been waiting for dawn.~~',
          ],
          scales: { unease: +4 },
          composure: -2,
          composureCost: 'The dawn would finish the evening.',
          flags: { _heard_dawn: true },
        },
        {
          label: 'use the chimes to move; act now',
          desc: 'Take the pressure.',
          lines: [
            'I move. While the chimes are still going I am already a corridor closer to where I need to be.',
          ],
          composure: +1,
          composureGain: 'I am moving with the chimes.',
        },
      ],
    },

    {
      id: 'glimpse_of_him',
      once: true,
      when: (p) => p.turn >= 6
                && !p.flags._walked_free
                && p.flags._mask_on !== false
                && Math.random() < 0.7,
      prose: [
        'I catch his reflection in the polished side of a silver bowl. The reflection is not quite Polonius. The face is older. The face does not have all of its features in their accustomed places.',
        'When I look up, he is in the position he was before. He has not moved. The reflection has.',
      ],
      responses: [
        {
          label: 'look back at the bowl',
          desc: 'Verify.',
          lines: [
            'I look back at the bowl. The reflection is just him now. The features are in their accustomed places. The face is smiling.',
            'The face was not smiling a moment ago, when I looked away.',
          ],
          scales: { unease: +4 },
          composure: -2,
          composureCost: 'The face was not smiling a moment ago.',
        },
        {
          label: 'pretend not to have seen',
          desc: 'Walk on.',
          lines: [
            'I keep walking. He keeps pace. The reflection in the bowl, when I pass, is what I would expect a reflection to be.',
            'I do not look at the bowl again.',
          ],
          scales: { unease: +3 },
        },
      ],
    },

    {
      id: 'sleepiness_strikes',
      once: true,
      when: (p) => p.scales.tiredness >= 12
                && !p.flags._walked_free
                && Math.random() < 0.85,
      prose: [
        'The room slides. The lamps double, then resolve. My eyes were closed. I do not remember closing them.',
        'Polonius is closer than he was. His head is at the angle of someone who has been studying me for some moments.',
        'Are you well, sir? You look very tired.',
      ],
      responses: [
        {
          label: 'I am fine; force yourself upright',
          desc: 'Burn through it.',
          lines: [
            'I say: I am fine.',
            'I push myself upright. My limbs are where I left them, more or less.',
          ],
          scales: { tiredness: -2 },
          composure: -1,
          composureCost: 'My limbs were not all the way where I left them.',
        },
        {
          label: 'use the sliver to keep awake',
          desc: 'Take the pain.',
          lines: [
            'I press the sliver into the pad of my thumb. The pain is small but it is the loudest thing in the corridor. I am awake. I am all the way awake.',
          ],
          scales: { tiredness: -4 },
          composure: +1,
          composureGain: 'A little blood. It keeps me here.',
          flags: { _used_sliver: true },
          when: (p, player) => (player?.items || []).includes('sliver_of_glass'),
        },
        {
          label: 'concede; sit a moment',
          desc: 'Sit.',
          lines: [
            'I say: I think I need to sit.',
            'He is delighted. The delight is real. Of course. Of course. Mrs. Halliwell. The chair by the fire.',
            'The chair is suddenly closer to me than it was.',
          ],
          scales: { tiredness: +3, intimacy: +2 },
        },
      ],
    },

    {
      id: 'cook_passes_with_apron',
      when: (p) => p.flags._seen_cook
                && p.turn >= 5
                && !p.flags._heard_cook_aware
                && !p.flags._walked_free
                && Math.random() < 0.5,
      prose: [
        'The cook passes the corridor end. He is going back to the kitchen with a pot. He is not slowing down.',
        'As he passes, his head moves — slightly, only an inch — toward me. The eyes are on me for one beat that is too long to be the cook of the dining room.',
        '~~He is awake. He is being careful.~~',
      ],
      responses: [
        {
          label: 'follow him into the kitchen',
          desc: 'Press the opening.',
          lines: [
            'I follow him into the kitchen. The cook is at the range. The eyes are awake. We have a minute.',
          ],
          scales: { unease: +1 },
          composure: +1,
          composureGain: 'I followed.',
          flags: { _heard_kitchen: true, _seen_cook_lucid: true },
        },
        {
          label: 'mark the moment; carry on',
          desc: 'Remember the look.',
          lines: [
            'I do not break stride. I have, however, marked the look. He is not entirely part of the day in his own room.',
          ],
          flags: { _heard_cook_aware: true, _heard_kitchen: true },
        },
      ],
    },

    // Last-resort move: if the player has held off long enough that
    // Polonius is out of polite options, he takes the card from his
    // vest and holds it over the parlor fire. The player has one beat
    // to recover it or live with it gone.
    {
      id: 'polonius_holds_card_over_fire',
      when: (p) => p.flags._mask_on === false
                && p.flags._card_location === 'palmed'
                && p.flags._heard_card_offer_search
                && p.turn >= 10
                && !p.flags._fired_polonius_holds_card_over_fire
                && Math.random() < 0.6,
      prose: [
        'He is at the parlor fire. The card is between his thumb and forefinger. He holds it over the small fire at a small height.',
        'Sir, he says, mild. I have decided. If I cannot have the evening, I will at least have the card.',
        '~~He will drop it. He will drop it if I do not move.~~',
      ],
      responses: [
        {
          label: 'lunge for the card',
          desc: 'Take it from his hand.',
          lines: [
            'I cross to him. The lunge is short — he is at arm\'s length, and he is not very strong.',
            'I catch his wrist. The card is between us. I twist his hand toward me, gently. The card comes loose. I have it.',
            'He smiles. He smiles with a small respect.',
            '!!The card is in my pocket.!!',
          ],
          flags: { _card_location: 'recovered', _recovered_from: 'fire_save' },
          scales: { unease: +2 },
          composure: +3,
          composureGain: 'I caught his wrist before he dropped it.',
        },
        {
          label: 'plead with him',
          desc: 'Words instead of motion.',
          lines: [
            'I say: please. Polonius. Please.',
            'He looks at me. The look is long. The look is tired.',
            'His thumb opens.',
            'The card falls. The fire takes it. The corners curl. In a moment the card is ash.',
          ],
          flags: { _card_location: 'ash', _card_destroyed: true, _card_known: true },
          scales: { unease: +5 },
          composure: -3,
          composureCost: 'The card is ash.',
        },
        {
          label: 'let it burn',
          desc: 'Make the gamble.',
          lines: [
            'I do not move. He waits. He waits a beat too long. He drops the card.',
            'The card falls. The fire takes it. The corners curl. In a moment the card is ash.',
          ],
          flags: { _card_location: 'ash', _card_destroyed: true, _card_known: true },
          scales: { unease: +5 },
          composure: -3,
          composureCost: 'The card is ash.',
        },
      ],
    },

    {
      id: 'polonius_in_a_mirror',
      when: (p) => p.flags._mask_on === false
                && !p.flags._walked_free
                && p.turn >= 4
                && Math.random() < 0.7,
      prose: [
        'I pass a mirror in the corridor. The mirror is the kind a Victorian hangs at the end of a passage to make the passage feel longer.',
        'In the mirror, the passage is longer. In the mirror, Polonius is directly behind me. In the corridor, he is not.',
        'I turn around. The corridor is empty.',
        'I turn back to the mirror. He is still in it. He is smiling.',
      ],
      responses: [
        {
          label: 'face the mirror; do not move',
          desc: 'Stare him down.',
          lines: [
            'I face the mirror. He, in the mirror, faces me. After a length of time I do not measure, the reflection looks slightly tired. He fades, by degrees, until the mirror is only a mirror.',
            'The corridor is the corridor.',
          ],
          scales: { unease: +3 },
          composure: +1,
          composureGain: 'I did not move first, even from a reflection.',
        },
        {
          label: 'walk past the mirror without looking',
          desc: 'Refuse.',
          lines: [
            'I walk past. I do not look. I do not give him the seeing of him.',
          ],
          scales: { unease: +2 },
        },
      ],
    },
  ],

  // ─────────────────────────────────────────────────────────────────────
  //  ENDINGS — fire when their `when` matches at end of beat.
  // ─────────────────────────────────────────────────────────────────────
  endings: [
    // Order matters — more specific endings come first.
    {
      id: 'walked_free_freed',
      when: (p) => p.flags._walked_free && p.flags._freed_polonius,
      title: 'You let him out',
      lines: [
        'I am in the hospital corridor. The lights are too bright. My coat is on. My card is in my pocket. I do not have any blood on me.',
        'I look back. There is a wall where the door was. The wall has the dust of a wall that has always been a wall.',
        'I walk back to the ward. I will tell no one. There is no one to tell.',
        '~~There is a small piece of broken clay in my pocket. There was a name on it. There is no name on it any more.~~',
      ],
      item: 'small_bell',
    },

    {
      id: 'walked_free_violent',
      when: (p) => p.flags._walked_free && p.flags._escaped_violent && !p.flags._killed_polonius && !p.flags._freed_polonius,
      title: 'You fought your way out',
      lines: [
        'I am in the corridor. The hospital lights are very bright. There is the heat of my own breath in my ears.',
        'I look down. There is a smear of his under my fingernail. The smear is the wrong colour. I do not look at it for long.',
        'My card is in my pocket. The slot read it.',
        'I look back. The doorway is plaster, the way a doorway is plaster when there has never been a doorway.',
        'I walk back to the ward. I do not stop to wash my hand on the way. The night nurse will not ask.',
      ],
      item: 'sliver_of_glass',
      scars: ['named'],
    },

    {
      id: 'player_killed_him',
      when: (p) => p.flags._killed_polonius && p.flags._walked_free,
      title: 'You walked out with blood on your shoes',
      lines: [
        'The weapon is still in my hand. I do not remember the last few strikes.',
        'My card is in my pocket. I retrieved it from the body or from the drawer; the order is hard to remember now.',
        'The corridor is bright. The night nurse is at her station. She looks at my hands. Her face goes very still.',
        'I do not remember what I tell her. I remember that she stops me at the door of my ward and says, very quietly: there is no Greek Wing, sir. There has never been a Greek Wing. Are you alright.',
        'I am holding a thing that came from a house that does not exist. The thing is heavy. There is blood on it. The blood is older than blood should be.',
      ],
      item: 'sliver_of_glass',
      scars: ['named'],
    },

    {
      id: 'walked_free',
      when: (p) => p.flags._walked_free,
      title: 'You walked out of the Greek Wing',
      lines: [
        'I am in the corridor. The hospital lights are too bright after the lamps. My card is in my pocket. The corner of it is bent where it was held against the slot.',
        'I look back. The doorway is plaster, the way a doorway is plaster when there has never been a doorway.',
        'I walk back to the ward. I will not tell anyone. They would not believe me. I would not believe me.',
        '~~He is still in the house. The forty-third guest will find him exactly as I did.~~',
      ],
      item: 'small_bell',
    },

    {
      id: 'killed_by_polonius',
      when: (p) => p.flags._killed,
      title: 'He had hold of you',
      lines: [
        'His hand is on my throat. His hand is not the temperature a hand should be.',
        'He says, very close to my ear, in a language that has not been spoken on this floor: καλά. Πολύ καλά.',
        'He sets me down with the care one uses for something one will need later.',
        'The maid is there with a sheet. She is smiling. She has folded the sheet into a small neat package.',
      ],
      item: null,
      scars: ['collapsed', 'named'],
    },

    {
      id: 'slept_in_the_house',
      when: (p) => p.flags._slept,
      title: 'You closed your eyes',
      lines: [
        'I close my eyes. Only for a moment.',
        'When I open them the room is the same. The fire is the same. Polonius is gone.',
        'The maid is in the doorway. She is smiling. Good morning, sir. You slept very well. The master is out for the day. He left at dawn. He left in good spirits.',
        '!!I rise. The chair gives me up. My limbs are very heavy. My limbs are very mine in a way they were not yesterday.!!',
        '~~I am the tenant now. The card is on the side table; the door is just there; the door has no handle on this side.~~',
      ],
      item: null,
      scars: ['collapsed', 'named'],
    },

    {
      id: 'imprisoned',
      when: (p) => p.flags._imprisoned,
      title: 'They locked the door from the outside',
      lines: [
        'I sit in the chair by the fire. The fire does not go down. The fire does not go up.',
        'I do not know how long I sit. I do not know if it is hours or days.',
        'When the door opens it is the maid. She is bringing me tea. She is smiling.',
        'You\'ll be wanting your supper, sir. The cook has prepared it.',
      ],
      item: null,
      scars: ['collapsed'],
    },

    {
      id: 'polonius_escaped',
      when: (p) => p.flags._became_tenant,
      title: 'He stepped through a beat ahead of you',
      lines: [
        'He is in the corridor. The hospital lights are on him. He is laughing.',
        'My foot will not cross the threshold. The doorway is in front of me. The doorway is a wall.',
        'The maid is at my elbow. She is taking my coat. She is hanging it on the coat-tree.',
        'Welcome home, sir, she says. The master will be back in the morning. He will be sorry to have missed you, but very pleased to find you here.',
      ],
      item: null,
      scars: ['collapsed', 'named'],
    },
  ],
};
//
// A young woman whose son died at delivery. She refuses to accept it. She
// arrived at the ward with a pram and a bundle of rags she insists is the
// infant. She rocks him, sings him a five-note lullaby, and has a violent
// fit when anyone questions the bundle. Three paths:
//   - Indulge: sing along, agree he is sleeping; she keeps the delusion.
//   - Confront: name the death gently; if she can bear it, she grieves;
//     if pushed too hard, she goes into a fit.
//   - Take the bundle: lower her grip and lift it out of her hands.
//     She lets go. She is free of it.

const pram = {
  id: 'pram',
  name: '[The Pram]',
  glyph: 'Emberkin',
  subtitle: 'She is rocking her son. The wheels have never turned.',
  role: 'wing', tier: 1,
  file: [
    'Subject was admitted with a perambulator. Contents ~~rags, folded to the weight of a child~~ as Subject reports: her son, sleeping.',
    'The son ~~was stillborn~~ did not survive the delivery of [[8]]. !!Subject was informed too late, and then too often.!!',
    'Standing order: staff will ~~not tell her again~~ not correct her. !!Do not touch the pram. Do not stop the song.!!',
  ],
  intro: [
    'She has the chair by the window and the pram against her knees, and she is rocking it — on the spot, by the handle. The wheels never come into it.',
    'She is humming. Five notes, then the same five. By the third round my pulse has picked up the tempo. She does not look up.',
  ],

  scales: {
    lucidity: {
      initial: 0, min: 0, max: 10, label: 'lucidity', kind: 'positive',
      bands: [
        { at: 0, word: 'under the song' },
        { at: 2, word: 'fogged' },
        { at: 5, word: 'surfacing' },
        { at: 7, word: 'clear-eyed' },
        { at: 9, word: 'all the way here' },
      ],
      crossUp: {
        2: 'Her eyes have come up off the blanket.',
        3: 'She is in the room with me. The part of her that counts the notes.',
        4: '!!She has remembered where she is.!!',
      },
      crossDown: {
        1: 'She has gone back under the song.',
        0: 'The song has her again. All five notes of her.',
      },
    },
    grip: {
      initial: 7, min: 0, max: 10, label: 'grip', kind: 'negative',
      bands: [
        { at: 0, word: 'hands open' },
        { at: 3, word: 'resting on the handle' },
        { at: 5, word: 'closed' },
        { at: 7, word: 'white-knuckled' },
        { at: 9, word: 'part of the pram' },
      ],
      crossUp: {
        2: 'Her knuckles have whitened on the handle.',
        3: 'Her arms have gone to wood. The rocking does not slow for it.',
        4: '!!I cannot tell anymore where her hands end and the handle begins.!!',
      },
      crossDown: {
        3: 'Her arms have eased.',
        2: 'Her fingers have loosened on the handle.',
        1: 'She has let the handle go. Her hands hang as if returned to her.',
        0: 'The pram stands at her feet. Her hands are in her lap, palms up, off duty.',
      },
    },
    agitation: {
      initial: 2, min: 0, max: 10, label: 'agitation', kind: 'negative',
      bands: [
        { at: 0, word: 'in time' },
        { at: 3, word: 'off the beat' },
        { at: 6, word: 'climbing' },
        { at: 8, word: 'past singing' },
        { at: 10, word: 'fit' },
      ],
      crossUp: {
        2: 'The five notes have moved up a key. Nothing else in the room has.',
        3: 'The rocking has lost the beat. My pulse keeps trying to find it for her.',
        4: '!!The sound she is making has no notes in it at all.!!',
      },
      crossDown: {
        2: 'The worst is past. Her breath has come back to four counts.',
        1: 'She is no longer screaming.',
        0: 'Calm. The five notes resume, as if from the top.',
      },
    },
  },

  initialize(p) {
    p.scales.lucidity = 0;
    p.scales.grip = r(6, 8);
    p.scales.agitation = r(1, 3);
  },

  fileReveals: [
    { announce: 'A line fills in. Subject holds ~~rags, the heavy fold where a head would be~~ the infant. Correctly.' },
    { announce: 'Another. The lullaby is logged as ~~hers, from her own nursery~~ five notes, in rotation, without error.' },
    { announce: 'The last line. Subject has been informed on [[2]] occasions. !!Each time was the first time.!!' },
  ],

  presented(p) {
    const l = p.scales.lucidity;
    const g = p.scales.grip;
    const a = p.scales.agitation;

    let arms;
    if (a >= 7)      arms = '!!She is rocking at a speed no child is rocked at. The floorboards have taken up the count.!!';
    else if (g >= 7) arms = 'The rocking has quickened. Her arms have shortened their travel, hoarding the pram in.';
    else if (g >= 4) arms = 'She rocks the pram at a nursing pace. The wheels do not turn. They have never had to.';
    else if (g >= 1) arms = 'Her arms rest along the handle, riding the last of the rocking out.';
    else             arms = 'The pram stands at her feet, still. It does not look used to it.';

    let eyes;
    if (l >= 7)      eyes = 'Her eyes are on me. They do not slide back to the blanket. She is here.';
    else if (l >= 4) eyes = 'Her eyes find me between notes. The blanket reclaims them by the fifth.';
    else if (a >= 5) eyes = 'Her eyes are fixed past the room, on a distance the window does not have.';
    else             eyes = 'She does not look up. Her eyes keep to the blanket, where the fold lies heaviest.';

    let voice;
    if (a >= 7)      voice = '!!She is keening, and the keening keeps the rocking\'s time.!!';
    else if (a >= 4) voice = 'Her humming has thinned. It is the only part of her that has noticed me.';
    else             voice = 'She hums five notes, and then the same five. I have started counting them. I did not decide to.';

    return `${arms} ${eyes} ${voice}`;
  },

  verbs: {

    listen: {
      label: 'listen',
      desc: 'Stay quiet. Let her sing.',
      respond(p) {
        const reps = streakCount(p, 'listen');
        if (reps >= 3) {
          return {
            lines: [
              'I keep listening. The five notes have worn a path in me the way feet wear terrazzo.',
              'She has not once needed me here. The song was full before I came.',
            ],
            scales: { grip: +1, lucidity: -1 },
            composure: -1,
            composureCost: 'I have the song by heart now. That is where it keeps things.',
          };
        }
        return {
          lines: [
            'I let her sing. Five notes, a rest, the same five. The rest is where a name would go.',
            'The rocking holds its tempo. My pulse has stopped arguing with it.',
          ],
          scales: { lucidity: +1 },
        };
      },
    },

    sing_with_her: {
      label: 'sing with her',
      desc: 'Take up the five notes with her. Indulge her.',
      respond(p) {
        const reps = streakCount(p, 'sing_with_her');
        if (reps >= 2) {
          return {
            lines: [
              'I hum the line again. She comes in on the second note, above me, and I am the accompaniment now.',
              'She looks at me for the first time. !!You know it,!! she says. !!Good. Now you know it.!!',
              'We hum it together, round on round. Somewhere in the rounds it stops being hers to stop.',
            ],
            scales: { grip: -1, agitation: -2, lucidity: -1 },
            flags: { sang_with_her: true },
            composure: -1,
            composureCost: 'I have put my voice to the song. That is a signature, of a kind.',
          };
        }
        return {
          lines: [
            'I find the line she keeps offering and hum one bar of it, low, under hers.',
            'Her humming makes room for mine without breaking. Her shoulders come down a width. She does not look up, but the song is sung by two now.',
          ],
          scales: { grip: -1, agitation: -1, lucidity: -1 },
          flags: { sang_with_her: true },
        };
      },
    },

    ask_about_him: {
      label: 'ask about him',
      desc: 'Ask after the child. Gently.',
      respond(p) {
        if (p.scales.agitation >= 6) {
          return {
            lines: [
              'I ask: how is he?',
              '!!Shh,!! she snaps. !!Shh. You will wake him, and then.!! The sentence has no end. The humming comes back in the wrong key.',
            ],
            scales: { agitation: +3, grip: +2 },
            composure: -1,
            composureCost: 'Her face went wrong on the second shh.',
          };
        }
        if (p.scales.lucidity >= 5) {
          return {
            lines: [
              'I ask: how is he?',
              'The humming stops mid-round. She looks at the blanket a long time, at the heavy end of it. He is sleeping, she says — softer, like a question minding its manners.',
            ],
            scales: { lucidity: +2, agitation: +1, grip: -1 },
          };
        }
        return {
          lines: [
            'I ask: how is he?',
            'She smiles, a small one, pre-counted. He is sleeping, she says. He has been so good. So good. The words rock at the same tempo as her arms.',
          ],
          scales: { lucidity: +1, agitation: +1 },
        };
      },
    },

    tell_her_he_is_gone: {
      label: 'tell her he is gone',
      desc: 'Name the death. Plainly.',
      when: (p) => p.scales.lucidity >= 3,
      respond(p) {
        if (p.scales.agitation >= 6 || p.scales.lucidity < 5) {
          return {
            lines: [
              'I say: he is not in the pram. He did not survive.',
              '!!You stop that,!! she says. !!You stop that this minute.!!',
              'Her mouth opens on a scream pitched past hearing. The rocking goes to a gallop, and my pulse, traitor, goes with it.',
            ],
            scales: { agitation: +5, grip: +3, lucidity: +1 },
            composure: -2,
            composureCost: '!!My pulse is keeping her time now, not mine.!!',
          };
        }
        if (p.scales.lucidity >= 7) {
          return {
            lines: [
              'I say: he did not survive the delivery. What is in the blanket is the blanket.',
              'She does not look up. The humming stops on the fourth note, and the fifth never comes.',
              'A long time passes at the rocking\'s old tempo, without the rocking. Then, very small: ~~I know.~~ I know.',
            ],
            scales: { lucidity: +3, grip: -3, agitation: +2 },
            flags: { told_her: true },
            composure: -1,
            composureCost: 'It has been said in this room now. !!By me.!!',
          };
        }
        return {
          lines: [
            'I say: he is not in the pram. He did not survive the delivery.',
            'The humming stops. She looks at me the way you look at a stain on a christening gown. Why would you say that, she asks. Why would you say that to me. The second asking has no question left in it.',
          ],
          scales: { lucidity: +2, agitation: +3, grip: +1 },
          composure: -1,
          composureCost: 'I have said it. !!She has heard it. Those are two different weights.!!',
        };
      },
    },

    touch_her_hand: {
      label: 'touch her hand',
      desc: 'Lay your fingers on the back of her hand. Calm her.',
      when: (p) => p.scales.agitation <= 6,
      respond(p) {
        return {
          lines: [
            'I lay my hand over hers on the handle. Her hand is warm, and rocking, and mine rocks with it.',
            p.scales.lucidity >= 4
              ? 'She does not pull away. Under my palm her grip lets down, the way milk lets down, without permission being asked.'
              : 'She does not pull away. She does not return it either. My hand is in the song now, is all.',
          ],
          scales: { grip: -2, agitation: -2, lucidity: +1 },
        };
      },
    },

    take_the_bundle: {
      label: 'take the bundle',
      desc: 'Lift the rags out of the pram. Gently.',
      when: (p) => p.scales.grip <= 3 && p.scales.agitation <= 5,
      respond(p) {
        if (p.flags.told_her || p.scales.lucidity >= 7) {
          return {
            lines: [
              'I lift the bundle from the pram. The weight is wrong. It is the weight of cloth, only.',
              'She watches me do it. She does not stop me.',
              'I hold it a moment, then set it down on the chair beside her. She does not look at it again.',
              '!!Her arms are empty. She lets them be empty. She breathes.!!',
            ],
            scales: { grip: -10, agitation: -2, lucidity: +2 },
            flags: { freed: true },
            composure: -1,
            composureCost: 'I have taken what was not there. I have taken it anyway.',
          };
        }
        return {
          lines: [
            'I lift the bundle from the pram. She lets me. Her hands stay in the shape of holding.',
            'She is under the song still. Her arms go on rocking the weight that is no longer in them.',
          ],
          scales: { grip: -10, agitation: +1, lucidity: +1 },
          flags: { freed: true },
          composure: -2,
          composureCost: 'I have taken what she was holding. !!I am not sure she has noticed.!!',
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Let the rocking run.',
    when: (p) => p.scales.agitation >= 5 || p.scales.grip >= 7 || p.turn >= 4,
  },

  interjections: [
    {
      id: 'hes_sleeping',
      once: true,
      when: (p) => p.scales.grip >= 7 && p.turn >= 2,
      prose: [
        'The rocking stops mid-travel. She leans in over the blanket, shoulders rounding, a wall going up around the fold.',
        'She looks at me and whispers: !!He is sleeping. Yes?!!',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'Agree. Let her keep him.',
          lines: [
            'I nod. I say: yes. He is sleeping.',
            'The rocking settles back to its nursing pace. Her shoulders come down a width, and the song picks up its round.',
            '~~I have not lied.~~ I have answered a question with the answer it came for.',
          ],
          scales: { grip: -1, agitation: -2, lucidity: -1 },
          flags: { sang_with_her: true },
          scars: ['named'],
        },
        {
          label: 'your arms must be tired',
          desc: 'Redirect, without lying.',
          lines: [
            'I say: your arms must be tired. You have been rocking a long time.',
            'She considers her arms a long moment, the full length of them. They have been someone else\'s all morning.',
            'After a moment she sets them down on the handle and does not lift them again.',
          ],
          scales: { grip: -3, lucidity: +2, agitation: -1 },
        },
        {
          label: "he is not",
          desc: 'The truth. Quietly.',
          lines: [
            'I say: he is not sleeping.',
            'The color leaves her face from the mouth outward. !!Do not say that,!! she says. !!Not in this room. Not over him.!!',
          ],
          scales: { lucidity: +2, agitation: +4, grip: +2 },
          composure: -1,
          composureCost: '!!I have said it in this room.!!',
        },
      ],
    },

    {
      id: 'do_I_know_you',
      once: true,
      when: (p) => p.scales.lucidity >= 4,
      prose: [
        'The humming stops mid-bar, on the fourth note. She looks at me with her head tipped, reading me like a label that has come half off.',
        'She says: ~~Do I know you?~~',
      ],
      responses: [
        {
          label: "I don't think so",
          desc: 'Gentle truth.',
          lines: [
            'I say: I do not think so. I came in this morning.',
            'She weighs it without alarm. Strangers are no trouble. It is the known faces that have been telling her things.',
          ],
          scales: { lucidity: +2, grip: -1 },
        },
        {
          label: 'you do',
          desc: 'A kind lie.',
          lines: [
            'I say: you do.',
            'She eases. She does not check. But her eyes never come all the way back to me after — known things do not get looked at.',
          ],
          scales: { agitation: -2, lucidity: -3 },
          scars: ['named'],
          composure: -1,
          composureCost: 'I have agreed to be someone she has been waiting for.',
        },
        {
          label: "I'm here either way",
          desc: 'Sidestep.',
          lines: [
            'I say: it does not matter. I am here either way.',
            'She nods slowly, files me under visitors, and goes back to the count.',
          ],
          scales: { lucidity: +1 },
        },
        {
          label: '[amnesia] I do not remember',
          desc: 'The answer I came in with.',
          when: (_, player) => player.wound === 'amnesia',
          lines: [
            'I say: I do not remember if I knew anyone. I came in this morning without a name to give.',
            'She nods. She is not surprised. She has been here longer than that.',
            'She says, quietly: ~~Then we are even.~~',
          ],
          scales: { lucidity: +2, agitation: -1, grip: -1 },
        },
        {
          label: '[insomnia] my memory has thinned',
          desc: 'Trade her my sleeplessness for hers.',
          when: (_, player) => player.wound === 'insomnia',
          lines: [
            'I say: I have not slept in days. The faces all slide off.',
            'She lifts her head. Of everything said in this room today, that is the first thing she has had a use for.',
            '~~She sleeps in this chair.~~ She has not slept in this chair.',
          ],
          scales: { lucidity: +1, agitation: -1 },
        },
        {
          label: '[split personality] one of me does',
          desc: 'Offer her the half that fits.',
          when: (_, player) => player.wound === 'split_personality',
          lines: [
            'I say: one of me does. The other does not.',
            'She takes it without surprise. She nods, slowly, twice — once for each.',
            '~~She has been waiting for someone.~~ She has been waiting for one of me.',
          ],
          scales: { lucidity: +2, agitation: -1, grip: -1 },
        },
      ],
    },

    {
      id: 'whose_was_he',
      once: true,
      when: (p) => p.scales.lucidity >= 6 && p.scales.grip <= 4,
      prose: [
        'The humming has run out, and she has let it run. Her eyes come from the blanket to me, carrying the question over carefully, like a full cup.',
        'She asks: ~~Whose was he?~~',
      ],
      responses: [
        {
          label: 'yours',
          desc: 'Name it. Let her have the answer.',
          lines: [
            'I say: he was yours.',
            'She nods. She tilts forward until her brow rests against the side of the pram.',
            '!!The sound she makes is small, and very old.!!',
          ],
          scales: { lucidity: +3, grip: -2, agitation: -1 },
          flags: { told_her: true },
          composure: -1,
          composureCost: 'I have given her what no one has been allowed to give her.',
        },
        {
          label: "I don't know",
          desc: 'Do not claim. Do not deny.',
          lines: [
            'I say: I do not know. Tell me about him.',
            'She does. For a long time.',
          ],
          scales: { lucidity: +2, grip: -1 },
        },
        {
          label: "someone's",
          desc: 'Soften it.',
          lines: [
            "I say: someone's. Someone you loved.",
            'She nods, and takes it, and her eyes go past me to the window, where the answer can stay unowned.',
          ],
          scales: { lucidity: -1, grip: +1 },
        },
      ],
    },

    {
      id: 'wake_him',
      once: true,
      when: (p) => p.scales.agitation >= 5 && p.scales.grip >= 6,
      prose: [
        'The humming has gone loud and flat, more breath than note. The rocking has left the song behind.',
        '!!Be quiet,!! she says. !!You will wake him.!!',
      ],
      responses: [
        {
          label: 'be quiet',
          desc: 'Meet her where she is.',
          lines: [
            'I lower my voice. I stop moving.',
            'Her humming finds the five notes again, one at a time, like stairs in the dark.',
          ],
          scales: { agitation: -3, grip: -1, lucidity: -1 },
          composure: -1,
          composureCost: 'I am being quiet for someone who is not in the room.',
        },
        {
          label: 'he is not asleep',
          desc: 'Say it. Plainly.',
          lines: [
            'I say: he is not asleep.',
            'She stands up halfway. !!Get out,!! she says. !!Get out of my room.!!',
          ],
          scales: { agitation: +5, grip: +3, lucidity: +1 },
          composure: -2,
          composureCost: '!!She is on her feet.!!',
        },
        {
          label: 'say nothing',
          desc: 'Let her run through it.',
          lines: [
            'I do not move. I let the song run.',
            'It gets louder before it gets quieter. It does get quieter. Eventually.',
          ],
          scales: { agitation: +1, grip: +1 },
          composure: -2,
          composureCost: 'The rocking is the only sound. It is the worst sound.',
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.agitation >= 6) {
      return {
        lines: [
          'I wait. The rocking has outrun the song. The wheels knock the floor at each end of the travel — four knocks, four knocks.',
          'The hum has moved into the floor, and up the chair legs, and into my teeth.',
        ],
        scales: { agitation: +2, grip: +1 },
        composure: -1,
        composureCost: 'The room is fast now. Faster than I am.',
      };
    }
    if (p.scales.grip >= 7) {
      return {
        lines: [
          'I wait. She tucks the blanket in. She tucks it in again. She tucks it in again.',
          'Her arms do not tire.',
        ],
        scales: { grip: +1, agitation: +1 },
        composure: -1,
        composureCost: 'She is doing it for someone who is not under the blanket.',
      };
    }
    if (p.scales.lucidity >= 5 && p.scales.grip <= 4) {
      return {
        lines: [
          'I wait. The rocking lets down by degrees, the way a kettle goes off the boil.',
          'Her eyes leave the pram. They do not return to it right away.',
        ],
        scales: { lucidity: +1 },
      };
    }
    return pick([
      { lines: ['The rocking quickens and eases, quickens and eases, hunting a tempo it has misplaced.'], scales: { grip: +1, agitation: +1 } },
      { lines: ['She pauses, and gives the pram a sidelong look, the kind you give a door you may have left unlocked.'], scales: { lucidity: +1 } },
      { lines: ['I wait. Nothing changes. The five notes go around again. And again.'], scales: { agitation: +1 }, composure: -1 },
    ]);
  },

  endings: [
    // Took the bundle. She is freed.
    {
      id: 'freed',
      when: (p) => p.flags.freed && p.scales.agitation <= 5,
      title: 'You take it from her',
      lines(p) {
        if (p.scales.lucidity >= 6) {
          return [
            'She is sitting with her hands in her lap. They have not been in her lap in months.',
            'She does not weep. She breathes. I leave the room with the bundle.',
            '!!She does not call me back.!!',
          ];
        }
        return [
          'I have the bundle. She lets me carry it out.',
          'She is under the song still. The empty pram rocks on a while, lighter, and the lightness takes its time reaching her.',
        ];
      },
      item: 'worn_ribbon',
      scars(p) { return p.scales.lucidity >= 6 ? [] : ['taken']; },
    },
    // She is told and grieves.
    {
      id: 'grieved',
      when: (p) => p.flags.told_her && p.scales.lucidity >= 7 && p.scales.agitation <= 5 && !p.flags.freed,
      title: 'She lets him go',
      lines: [
        'She lifts the blanket. She folds it. She folds it again.',
        'She sets it on the seat of the pram and lets the handle go.',
        'She cries without sound, in the hours-kept way of this place. !!Nobody has to be quiet for him anymore.!!',
      ],
      item: 'handkerchief',
    },
    // Violent fit. Player is chased out.
    {
      id: 'fit',
      when: (p) => p.scales.agitation >= 10,
      title: 'She has a fit',
      lines: [
        '!!She is on her feet.!! The pram is between us. She is screaming without sound.',
        'I am at the door. I am through the door. She does not follow.',
        '!!She is rocking again before I am all the way out.!!',
      ],
      item: null,
      scars: ['witnessed', 'failed'],
    },
    // Indulged. Player sang along. She keeps the delusion.
    {
      id: 'indulged',
      when: (p) => p.flags.sang_with_her && p.turn >= 10 && !p.flags.told_her && !p.flags.freed,
      title: 'You sing with her',
      lines: [
        'I leave when the song lets me. She does not look up. She has had a visitor today; the song has had a second voice.',
        'The lullaby continues through the door. !!Five notes.!!',
      ],
      item: null,
      scars: ['named'],
    },
    // Timeout without progress.
    {
      id: 'she_stays',
      when: (p) => p.turn >= 14,
      title: 'She outlasts you',
      lines: [
        'She has been rocking longer than I can stay. The hour has moved without me.',
        'I leave the room. The five notes follow me to the turn of the corridor, and stop being heard without stopping.',
      ],
      item: null,
      scars: ['failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: ['I close the door on the fourth note. The fifth comes anyway. It does not need me, and it does not see me go.'],
      item: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// THE PATRIARCH — Patient 0091
// ════════════════════════════════════════════════════════════════════════
//
// A man who was the head of a household. Lordly, abusive, physical. One of
// his daughters took her own life. He went mad and refused to learn the
// lesson. He now holds court in this room over a family that has stopped
// coming, and attacks any who defy him. Three paths:
//   - Submit: kneel and accept; he keeps you as a daughter of the house.
//   - Grieve: name her, lower his guard, close his eyes when he finally weeps.
//   - Chased out: push him too far; he stands, and the door becomes the only
//     thing in the room.

const patriarch = {
  id: 'patriarch',
  name: '[The Patriarch]',
  glyph: 'Pyrelord',
  subtitle: 'He keeps order in a house that has stopped coming.',
  role: 'wing', tier: 1,
  file: [
    'Subject was the head of his household for forty years. He ~~beat his daughters~~ enforced expectations physically.',
    'His daughter [[7]] was found on [[8]] with ~~his belt~~ an article of his property. !!The ruling was suicide. He has appealed it nightly since.!!',
    'Subject continues to convene the household at six. Attendance: ~~none, in nine years~~ recorded as pending. The minutes are taken regardless.',
  ],
  intro: [
    'The chair is set square to the door, the way a bench faces a dock. He does not rise. Rising is for the ones who enter.',
    'He reads me the way you read a summons — once for the name, once for the offense. The proceedings are waiting on my title.',
  ],

  scales: {
    presence: {
      initial: 8, min: 0, max: 10, label: 'presence', kind: 'negative',
      bands: [
        { at: 0, word: 'vacated' },
        { at: 3, word: 'subsiding' },
        { at: 5, word: 'presiding' },
        { at: 7, word: 'in session' },
        { at: 9, word: 'load-bearing' },
      ],
      crossUp: {
        3: 'The room comes back to order. I am in it on sufferance.',
        4: 'The house has its load-bearing wall back. Everything leans on him again, including me.',
      },
      crossDown: {
        2: 'A crack has gone up him, hairline, the kind surveyors photograph.',
        1: 'He has settled, the way buildings settle. The chair holds more of him than it did.',
        0: 'The bench is just a chair. He is just the man in it.',
      },
    },
    grief: {
      initial: 0, min: 0, max: 10, label: 'grief', kind: 'positive',
      bands: [
        { at: 0, word: 'within tolerance' },
        { at: 2, word: 'a hairline' },
        { at: 5, word: 'taking load' },
        { at: 7, word: 'past load' },
        { at: 9, word: 'coming down' },
      ],
      crossUp: {
        2: 'A sound starts in him, low, the sound walls make at night when the house cools.',
        3: 'His mouth has lost its plumb.',
        4: '!!Water is coming through. He sits under it as if it were happening to the ceiling.!!',
      },
      crossDown: {
        1: 'He has shored it. The crack is still there. It is painted now.',
        0: 'Inspection over. The structure is declared sound, by the structure.',
      },
    },
    rage: {
      initial: 1, min: 0, max: 10, label: 'rage', kind: 'negative',
      bands: [
        { at: 0, word: 'in recess' },
        { at: 2, word: 'objecting' },
        { at: 5, word: 'finding contempt' },
        { at: 7, word: 'passing sentence' },
        { at: 9, word: 'about to stand' },
      ],
      crossUp: {
        2: 'He has begun to note my conduct. Out loud. In the third person.',
        3: 'His hand has found the arm of the chair, where a gavel would live.',
        4: '!!He is leaning forward over the whole room. The proceedings are no longer civil.!!',
      },
      crossDown: {
        1: 'The objection is withdrawn. His hand returns to his knee.',
      },
    },
  },

  initialize(p) {
    p.scales.presence = r(7, 9);
    p.scales.grief = 0;
    p.scales.rage = r(0, 2);
  },

  fileReveals: [
    { announce: 'A line fills in. On [[5]] Subject struck an orderly who ~~said her name~~ spoke out of turn. The orderly is recorded as **clumsy**.' },
    { announce: 'Another. The instrument was ~~his belt, the one he is wearing~~ a household article. !!It was returned to him with his effects.!!' },
    { announce: 'The last line. Subject has been informed of her death. The minutes show ~~he struck the informant~~ the matter was tabled. It is tabled nightly.' },
  ],

  presented(p) {
    const pr = p.scales.presence;
    const g  = p.scales.grief;
    const ra = p.scales.rage;

    let stance;
    if (pr >= 8)      stance = 'He sits the way a courthouse sits on a town square. The room is in session because he is in it.';
    else if (pr >= 5) stance = 'He sits forward, hearing the room out. Whatever it says, he will rule on it.';
    else if (pr >= 2) stance = 'The chair is a size too big for him now. He fills it the way a flag fills a courtroom. By arrangement.';
    else              stance = 'He sits in the chair the way furniture sits in a vacated house. Nothing is in session.';

    let mood;
    if (ra >= 7)      mood = '!!Both hands are on the arms of the chair, and the chair has become the thing a man rises from.!!';
    else if (ra >= 4) mood = 'His hand opens and closes on the chair arm, at the pace of a man counting offenses.';
    else if (ra >= 2) mood = 'His mouth has been ruled straight, like a line in a ledger.';
    else              mood = 'He is in order. Every part of him has been entered correctly.';

    let inner;
    if (g >= 7)      inner = 'The front of him has failed. He is still upright the way condemned buildings are upright.';
    else if (g >= 4) inner = 'Under his breathing there is a second sound, low, like joists taking weight.';
    else if (g >= 1) inner = 'Behind his eyes a load has shifted. The face does not report it.';
    else             inner = 'Nothing in him moves that has not been approved.';

    return `${stance} ${mood} ${inner}`;
  },

  verbs: {

    listen: {
      label: 'listen',
      desc: 'Stay quiet. Let him speak.',
      respond(p) {
        const reps = streakCount(p, 'listen');
        if (reps >= 3) {
          return {
            lines: [
              'I have heard this ruling before. He reads it again in full, with the same pauses. The minutes do not shorten for being repeated.',
              'My attention slackens, and he marks it. !!The witness will attend,!! he says. I am the witness now. I was a guest a minute ago.',
            ],
            scales: { presence: -2, rage: +1 },
          };
        }
        return {
          lines: [
            'I let him proceed. He addresses his daughters in order of age. He leaves a pause after each name, the length of an apology.',
            'He sets out the order of the household, article by article. It is sound. It is the soundness of a house no one lives in.',
          ],
          scales: { presence: -1, grief: +1 },
        };
      },
    },

    kneel: {
      label: 'kneel',
      desc: 'Kneel beside the chair. Submit to him.',
      respond(p) {
        const reps = streakCount(p, 'kneel');
        if (reps >= 1) {
          return {
            lines: [
              'I kneel a second time. He looks down at me a long moment. !!Yes,!! he says. !!Entered.!!',
              'His hand comes to rest on the crown of my head, with the weight of a seal coming down on wax. The room is mine to leave when the session ends. No session here has ever ended.',
            ],
            scales: { presence: +1, rage: -2 },
            flags: { kneeled_twice: true },
            composure: -2,
            composureCost: 'I have given him a daughter to keep.',
          };
        }
        if (p.scales.presence >= 7) {
          return {
            lines: [
              'I kneel at the side of the chair, where the kneeling is done. The floor there is worn paler than the rest.',
              '!!Good,!! he says, and the word goes into the record. The room squares itself around him like a paragraph.',
            ],
            scales: { presence: +1, rage: -1 },
            composure: -1,
            composureCost: 'My knees found the worn place without being shown. That is what the worn place is for.',
          };
        }
        return {
          lines: [
            'I kneel, and the gesture arrives in a room that has stopped expecting it. He looks at me the way you look at mail for a previous tenant.',
            'Then his hand finds my shoulder, and he says a name. Two syllables, worn smooth from saying. Not mine.',
          ],
          scales: { rage: -1, grief: +1 },
          composure: -1,
          composureCost: 'He said the name the way you test a beam. I held.',
        };
      },
    },

    agree: {
      label: 'agree',
      desc: 'Tell him he is right. Whatever he was saying.',
      respond(p) {
        if (p.scales.presence >= 7) {
          return {
            lines: [
              'I say: you are right. It goes into the minutes in his favor.',
              'He nods once, the nod of a motion carried. !!Good. You understand the order of things.!! He proceeds with the full weight of a seconded man.',
            ],
            scales: { presence: +1, rage: -2 },
            composure: -1,
            composureCost: 'I have signed onto something I have not been reading.',
          };
        }
        return {
          lines: [
            'I say: you are right. The words go in, but the motion finds no floor.',
            'He nods and continues, and the argument leans. I can hear it leaning, the way you hear a staircase under a stranger.',
          ],
          scales: { presence: -1, rage: -1, grief: +1 },
        };
      },
    },

    interrupt: {
      label: 'interrupt',
      desc: 'Cut into what he is saying.',
      respond(p) {
        const reps = streakCount(p, 'interrupt');
        if (reps >= 2) {
          return {
            lines: [
              'I cut in a third time, and the silence that follows is not mine. He has gaveled the room with it.',
              '!!You are out of order,!! he says. !!In my house there is no out of order. There is only out.!!',
            ],
            scales: { presence: -2, rage: +3 },
            composure: -2,
            composureCost: '!!His voice has changed.!!',
          };
        }
        if (p.scales.presence >= 7) {
          return {
            lines: [
              'I speak into the middle of his sentence. The sentence stops around me like a door held open by mistake.',
              '!!The floor is not yours,!! he says. !!It will be yours when I yield it. I have never yielded it.!!',
            ],
            scales: { presence: -1, rage: +2 },
            composure: -1,
            composureCost: 'My body filed for recess without me. I caught it checking the door.',
          };
        }
        return {
          lines: [
            'I speak over him. He lets me, the way a court lets a man exhaust himself for the record.',
            'When I stop, he resumes from the exact word I interrupted. My remarks are not stricken. They were never entered.',
          ],
          scales: { presence: -1, rage: +1 },
        };
      },
    },

    call_by_name: {
      label: 'call him by name',
      desc: 'Use his given name. Not father. Not sir.',
      when: (p) => p.scales.presence <= 7,
      respond(p) {
        const reps = streakCount(p, 'call_by_name');
        if (reps >= 1) {
          return {
            lines: [
              'I say it again. The name goes through him like damp through plaster, finding the old route.',
              '!!No one calls me that,!! he says. !!Not under this roof.!! But the roof has heard it twice now, and roofs remember water.',
            ],
            scales: { presence: -2, grief: +2, rage: +1 },
          };
        }
        return {
          lines: [
            'I say his given name. Two syllables with no office attached to them.',
            'He goes still the way a house goes still between the lightning and the count.',
          ],
          scales: { presence: -2, grief: +2, rage: +1 },
          composure: -1,
          composureCost: 'The name has been said under this roof now. Load has been applied.',
        };
      },
    },

    touch_his_hand: {
      label: 'touch his hand',
      desc: 'Lay your fingers on the back of his hand.',
      when: (p) => p.scales.presence <= 6 && p.scales.rage <= 5,
      respond(p) {
        return {
          lines: [
            'I lay my hand over his on the arm of the chair. It is dry and cool, like a banister no one uses.',
            p.scales.grief >= 4
              ? 'His hand turns under mine and closes, hard — the grip of a man holding the rail of a structure that has started to move.'
              : 'He does not withdraw it. He examines my hand like an exhibit no one has entered, and rules nothing, and lets it lie.',
          ],
          scales: { grief: +2, rage: -2, presence: -1 },
        };
      },
    },

    say_her_name: {
      label: 'say her name',
      desc: "Speak the daughter's name out loud.",
      when: (p) => p.scales.presence <= 7,
      respond(p) {
        if (p.scales.rage >= 6) {
          return {
            lines: [
              'I say her name. The one the file gives a width instead of letters.',
              '!!Get out of my house,!! he says. !!That matter is closed. It was closed by ruling.!!',
              'He has begun to stand.',
            ],
            scales: { rage: +4, presence: -1, grief: +1 },
            composure: -2,
            composureCost: '!!He is rising.!!',
          };
        }
        if (p.scales.presence <= 4 && p.scales.rage <= 3) {
          return {
            lines: [
              'I say her name, quietly, the way you set a weight on a floor you do not trust.',
              'It takes the load. Then his face goes — not all at once, the way a wall goes, a course at a time, from the bottom.',
              'He says it back. Once, as a finding. Then again, as nothing of the kind.',
            ],
            scales: { grief: +4, presence: -2, rage: -1 },
            flags: { named_her: true },
            composure: -1,
            composureCost: 'She is in the record now. I entered her.',
          };
        }
        return {
          lines: [
            'I say her name into the middle of his order. It lands like a summons on a bench.',
            'He stops. His eyes go to the door — checking it is shut, checking who heard. !!That name is not before this house,!! he says.',
          ],
          scales: { grief: +2, rage: +3 },
          composure: -1,
          composureCost: 'He checked the door before he answered. The door, not me.',
        };
      },
    },

    close_his_eyes: {
      label: 'close his eyes',
      desc: 'Lower his eyelids. Let him stop watching the door.',
      when: (p) => p.flags.named_her && p.scales.grief >= 6 && p.scales.rage <= 3,
      respond() {
        return {
          lines: [
            'I bring my palm down over his eyes. He lets me. No motion opposes.',
            'The breath goes out of him the long way, the way a building lets go of the day\'s heat. Under it, her name. Once. Off the record.',
            '!!The room is a room again.!!',
          ],
          flags: { closed_eyes: true },
          scales: { presence: -4, rage: -3 },
          composure: -1,
          composureCost: 'I have adjourned a session that outlived its house.',
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Let the session run.',
    when: (p) => p.scales.presence >= 7,
  },

  interjections: [
    {
      id: 'address_me',
      once: true,
      when: (p) => p.scales.presence >= 8 && p.turn >= 1,
      prose: [
        'He looks at me directly for the first time, and I am found. There has been no charge. There does not need to be.',
        'He says: !!You will address me by my title. It will be entered before anything else you say.!!',
      ],
      responses: [
        {
          label: 'use his title',
          desc: 'Submit to the expectation.',
          lines: [
            'I give him the title. It goes down, and I go down with it, somewhere in the minutes.',
            'He continues as though I had been present from the start. By his record, I have been.',
          ],
          scales: { presence: +2, rage: -2 },
          composure: -1,
          composureCost: 'I have agreed to be governed.',
        },
        {
          label: 'use his given name',
          desc: 'The intimate, threatening choice.',
          lines: [
            'I give him his given name instead. The one with no house attached to it.',
            '!!You will not,!! he says. !!~~She called me~~ You will not call me that in this house.!!',
          ],
          scales: { presence: -2, rage: +3, grief: +1 },
        },
        {
          label: 'say nothing',
          desc: 'Refuse the bargain.',
          lines: [
            'I do not speak.',
            'He waits. The wait is itself a kind of sentence, and he lets me serve it standing. Then he rules on my silence and moves on.',
          ],
          scales: { presence: -1, rage: +2 },
        },
      ],
    },

    {
      id: 'discipline_them',
      once: true,
      when: (p) => p.scales.presence >= 6 && p.turn >= 3,
      prose: [
        'He has arrived at the question of how the household was kept. He reads it out like findings.',
        'He says: !!A house stands by its rules. I applied them evenly. No one can say I was not even.!!',
      ],
      responses: [
        {
          label: 'agree',
          desc: 'Tell him he was right.',
          lines: [
            'I say: yes. A house needs its rules.',
            'He nods once. !!So entered.!! His shoulders come down like a load finding its footing.',
          ],
          scales: { presence: +2, rage: -2 },
          composure: -2,
          composureCost: 'My signature is on a finding I do not hold.',
        },
        {
          label: 'ask if it worked',
          desc: 'Make him answer for himself.',
          lines: [
            'I ask: did it work?',
            'He says: !!They are good women.!! The room takes the minutes. ~~They are~~ They were. He does not correct it out loud. The page does.',
          ],
          scales: { presence: -2, grief: +2, rage: +1 },
        },
        {
          label: 'ask about the one who is not here',
          desc: 'Bring her up.',
          lines: [
            'I ask: and the one who is not here?',
            'His hand closes on the chair arm to the knuckle. !!Her matter is settled,!! he says. !!It was settled in this house, by this house. You will not reopen it.!!',
          ],
          scales: { presence: -2, grief: +2, rage: +3 },
          composure: -1,
          composureCost: 'Settled. The word a floor uses, just before.',
        },
      ],
    },

    {
      id: 'where_are_they',
      once: true,
      when: (p) => p.scales.grief >= 4 && p.scales.presence <= 6,
      prose: [
        'His eyes go to the door, then to me, and find me insufficient. I am in a seat that was issued to someone else.',
        'He asks: ~~The session will come to order.~~ Where are they?',
      ],
      responses: [
        {
          label: "they'll come",
          desc: 'Gentle. Probably a lie.',
          lines: [
            "I say: they'll come.",
            'He nods, and adjourns nothing, and goes back to watching the door. The watch is part of the order of the house now. It keeps its own hours.',
            'The varnish on the chair arms is worn through where his hands wait. That is how long.',
          ],
          scales: { presence: +1, rage: -1, grief: -1 },
          scars: ['named'],
        },
        {
          label: "they won't",
          desc: 'The truth.',
          lines: [
            'I say: they will not. They have not come in years.',
            'He takes it the way a wall takes water. Nothing, for a long moment. Then the line of him moves where lines do not move.',
            '!!The room is larger than him now. It was his size a minute ago.!!',
          ],
          scales: { presence: -3, grief: +4, rage: +1 },
          composure: -2,
          composureCost: 'I have said it out loud.',
        },
        {
          label: 'tell me their names',
          desc: 'Redirect.',
          lines: [
            'I say: tell me their names.',
            'He gives them. One. Two. Before the third he stops, and starts again from one, the way you re-add a column that keeps coming out wrong.',
          ],
          scales: { grief: +2, presence: -1 },
        },
      ],
    },

    {
      id: 'what_do_you_want',
      once: true,
      when: (p) => p.scales.presence <= 3 && p.scales.grief >= 4,
      prose: [
        'He has stopped speaking. The chair has more of him than he does. What is left sits where the title used to.',
        'He asks, with no bench left under it: ~~What do you want from me?~~',
      ],
      responses: [
        {
          label: 'nothing',
          desc: 'Release him from the duty.',
          lines: [
            'I say: nothing.',
            'He examines the word for the demand hidden in it and finds none. His shoulders come off duty, one before the other.',
            'It is the first time he has used the chair as a chair, not as a station.',
          ],
          scales: { grief: +3, presence: -3, rage: -1 },
        },
        {
          label: 'say her name with me',
          desc: 'Ask him to say it aloud.',
          lines: [
            'I say her name, and leave it in the air between us, and ask him to second it.',
            'He shakes his head. The head goes on shaking while his mouth says it. Once. The two of him are not in session together.',
          ],
          scales: { grief: +3, presence: -2 },
          flags: { named_her: true },
          composure: -1,
          composureCost: 'He has said the name out loud. !!Once.!!',
        },
        {
          label: "tell me you're sorry",
          desc: 'For her.',
          lines: [
            'I say: tell me you are sorry.',
            'He looks up. The silence runs long enough to be measured, so I measure it. Nine breaths. Ten.',
            'Then he says: ~~It was for her good.~~ I am sorry.',
          ],
          scales: { grief: +4, presence: -3 },
          composure: -2,
          composureCost: 'He has said it. !!I cannot give it to her.!!',
        },
        {
          label: '[amnesia] tell me what I came in for',
          desc: 'Make him the clerk for once.',
          when: (_, player) => player.wound === 'amnesia',
          lines: [
            'I say: I do not know what I came in for. Tell me.',
            'He looks up. Questions travel one way in this house, and I have sent one back up the stairs.',
            'After a moment he says: ~~you came in alone. You knew the way.~~',
            'He sits with that. So do I.',
          ],
          scales: { grief: +1, presence: -1 },
        },
        {
          label: '[insomnia] something I can sleep on',
          desc: 'Ask for the soft answer.',
          when: (_, player) => player.wound === 'insomnia',
          lines: [
            'I say: tell me something I can sleep on.',
            'He looks at me a long time. Then says: ~~there is nothing left to sit up for.~~',
            'His hands settle on the chair arms, palms down, the way you close a ledger for the night.',
          ],
          scales: { grief: +2, presence: -2 },
        },
        {
          label: '[split personality] which one of you I am talking to',
          desc: 'Address the man, not the patriarch.',
          when: (_, player) => player.wound === 'split_personality',
          lines: [
            'I say: tell me which one of you I am talking to. The man, or the lord of the house.',
            'He goes still. The question has no precedent, and he is a man who rules from precedent.',
            'He says: ~~the lord of the house.~~ There is only the one left.',
          ],
          scales: { grief: +2, presence: -2 },
          composure: -1,
          composureCost: 'I asked the bench to identify itself. It did.',
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.rage >= 5) {
      return {
        lines: [
          'I wait. His attention does not. It stays on me with the weight of a beam stored upright.',
          '!!Is there business?!! he asks. !!If there is no business, the room will be cleared.!!',
        ],
        scales: { rage: +1, presence: +1 },
        composure: -1,
        composureCost: 'My feet have squared to the door. They ruled before I did.',
      };
    }
    if (p.scales.presence >= 7) {
      return pick([
        { lines: ['I wait. He calls on the eldest. He waits the exact length of an answer, nods at it, and moves to the next item.'], scales: { presence: +1 } },
        { lines: ['I wait. He dictates to a clerk who is not there. The infractions are itemized by daughter, by date. He has the dates cold.'], scales: { presence: +1, rage: +1 }, composure: -1 },
        { lines: ['I wait. He sets out the order of the house again, clause by clause. The clauses have not changed. The house has.'], scales: { presence: +1 } },
      ]);
    }
    if (p.scales.grief >= 4) {
      return {
        lines: [
          'I wait. His eyes make their circuit: the door, the empty middle of the room, the door. ~~Where is she?~~',
          'It is not addressed to me. It is not addressed to anyone on the roll.',
        ],
        scales: { grief: +1 },
      };
    }
    return {
      lines: ['I wait. He watches the door the way a surveyor watches a wall he knows is wet inside.'],
      scales: { presence: -1 },
    };
  },

  endings: [
    // Grief path: he weeps, the player closes his eyes.
    {
      id: 'release',
      when: (p) => p.flags.closed_eyes && p.scales.grief >= 6,
      title: 'The house settles',
      lines: [
        'He does not wipe his face. He says her name once more, at the volume of a man alone, while I am still in the room.',
        'When I leave, he is in the chair, and the chair is only carrying him. Nothing else is filed under it.',
        '!!The door does not need to be watched.!!',
      ],
      item: 'small_bell',
    },
    // Submission path: kneeled twice, presence stays high.
    {
      id: 'submit',
      when: (p) => p.flags.kneeled_twice && p.scales.presence >= 7,
      title: 'You bow',
      lines: [
        'I leave the room walking backward, because daughters of the house do not show the bench their backs. I know this now without having been told.',
        'At the door he says a name, and my mouth answers to it. ~~Hers.~~ Mine now, on the record.',
        '!!He will be waiting when I come back.!!',
      ],
      item: 'ink_bottle',
      scars: ['named'],
    },
    // Chased out: rage maxes.
    {
      id: 'chased_out',
      when: (p) => p.scales.rage >= 9,
      title: 'He stands. You run.',
      lines: [
        '!!He is on his feet, and the room re-measures itself around him.!! Standing, he is the size the chair was. The chair was the largest thing in the room.',
        'I am at the door. I am through the door. Behind me his footsteps keep the unhurried rate of a man who has never once had to chase.',
        '!!He stops at the threshold. The house ends there, so he does.!!',
      ],
      item: null,
      scars: ['failed'],
    },
    // Outlasted: turn limit without breakthrough.
    {
      id: 'outlasted',
      when: (p) => p.turn >= 14 && !p.flags.closed_eyes,
      title: 'He outlasts you',
      lines: [
        'He is in the chair, and the chair is in the house, and the house is in him. There is no seam where a person could be let in.',
        'I adjourn myself. The door takes both hands, the way doors do when the room has not recognized your motion to leave.',
      ],
      item: null,
      scars: ['failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: ['I close the door mid-clause. The clause goes on behind it. It was never addressed to me.'],
      item: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════
// THE NIGHT NURSE — Patient 0042
// ════════════════════════════════════════════════════════════════════════
//
// A nurse who worked the night ward for thirty-eight years. One night she
// administered the wrong dose. The patient did not survive. She redoubled
// on the work, stayed past every shift, and over the next year burned out
// badly enough to make two more fatal errors. She was fired. She would
// not accept it. She still arrives every night to do her rounds. The
// staff replaced her medication tray with sugar water and let her keep
// folding sheets. Three paths:
//   - Be attended to: let her tend you. She works her old routine, and
//     eventually she notices the tray is empty.
//   - Confront her: name the patient she lost. She breaks down and
//     grieves for the first time in years.
//   - Walk away: leave her to the work. She does not notice you go.

const soothlick = {
  id: 'soothlick',
  name: '[The Night Round]',
  glyph: 'Soothlick',
  subtitle: 'She has not held a license in [[2]] years.',
  role: 'wing', tier: 1,
  file: [
    'Subject kept the night ward for thirty-eight years. For the last [[2]] of them, no roster has kept her.',
    'On three occasions her patients ~~did not wake~~ **rested** ahead of schedule. !!The last was in [[8]]. She signed all three charts.!!',
    'Subject was ~~dismissed~~ relieved of duties. Staff ~~cannot stop her~~ do not schedule against her. Her rounds continue. They are on no chart.',
  ],
  intro: [
    'The lights are down to night levels. No one lowered them. She is at the foot of the bed, squaring a sheet that was already square.',
    'I read her tag. The hospital on it is this one. The hospital does not have her. She does not look up. I am not due yet.',
  ],

  scales: {
    tending: {
      initial: 6, min: 0, max: 10, label: 'tending', kind: 'negative',
      bands: [
        { at: 0, word: 'off duty' },
        { at: 3, word: 'small things' },
        { at: 5, word: 'on her rounds' },
        { at: 7, word: 'double shift' },
        { at: 9, word: 'will not stop' },
      ],
      crossUp: {
        2: 'She has found more that needs doing. There is always more.',
        3: 'She has begun the full round. Every bed, in order.',
        4: '!!The round has no last bed in it.!!',
      },
      crossDown: {
        2: 'She has stepped back from the bed. One small step, unscheduled.',
        1: 'The tray is down. Her hands are unemployed.',
        0: 'She has stopped tending. The ward breathes on without her. It always could.',
      },
    },
    clarity: {
      initial: 0, min: 0, max: 10, label: 'clarity', kind: 'positive',
      bands: [
        { at: 0, word: 'in 1972' },
        { at: 2, word: 'between rounds' },
        { at: 5, word: 'noticing' },
        { at: 7, word: 'awake' },
        { at: 9, word: 'all the way back' },
      ],
      crossUp: {
        2: 'Her eyes have come up off the sheet.',
        3: 'She has looked at the window. The dark outside is older than her shift.',
        4: '!!She is here, and the hour is the real hour.!!',
      },
      crossDown: {
        1: 'The work has taken her hands back.',
        0: 'The round has resumed. Whatever woke in her is **resting** again.',
      },
    },
    guilt: {
      initial: 0, min: 0, max: 10, label: 'guilt', kind: 'positive',
      bands: [
        { at: 0, word: 'sealed' },
        { at: 2, word: 'measured' },
        { at: 5, word: 'rising' },
        { at: 7, word: 'in her hands' },
        { at: 9, word: 'spilling' },
      ],
      crossUp: {
        2: 'Her pour has lost its level. Only just. A nurse would notice.',
        3: 'She has put the tray down without being asked. Nothing is due.',
        4: '!!She has covered her mouth.!!',
      },
      crossDown: {
        1: 'She has folded it away with the linens.',
        0: 'Her hands are level again. Whatever was rising has been brought back to the line.',
      },
    },
  },

  initialize(p) {
    p.scales.tending = r(5, 7);
    p.scales.clarity = 0;
    p.scales.guilt = 0;
  },

  fileReveals: [
    { announce: 'A line fills in. Patient [[7]] was due half a grain. ~~She gave five.~~ The chart shows a clerical inconsistency.' },
    { announce: 'Another. The tray she carries is restocked weekly, with care, by staff who sign for it. ~~With sugar water.~~ With everything she needs.' },
    { announce: 'The last line. The beds on her round ~~are empty. All of them. Every night.~~ are not assigned to her.' },
  ],

  presented(p) {
    const t = p.scales.tending;
    const c = p.scales.clarity;
    const g = p.scales.guilt;

    let work;
    if (t >= 8)      work = 'She is at the bedside with the tray. Everything on it is lined up by size. Tonight has a list, and I am on it.';
    else if (t >= 5) work = 'She moves bed to bed. Each gets its minute. The minutes are exact.';
    else if (t >= 2) work = 'She is between rounds. Her hands keep finding small things — a fold, a cup a finger off square — and put them right without consulting her.';
    else             work = 'She stands near the door she never opens. Her hands hang empty. They do not know the posture.';

    let eyes;
    if (c >= 7)      eyes = 'Her eyes are on me, level. She knows the year. She is staying anyway, the way you stay with a patient past the end of a shift.';
    else if (c >= 4) eyes = 'Her eyes find me between tasks, and each time they have to start over on who I am.';
    else if (c >= 1) eyes = 'Her eyes have begun to include me. Not as a bed. Not yet as a person.';
    else             eyes = 'Her eyes are with her hands. I am later in the round.';

    let hands;
    if (g >= 7)      hands = '!!Her hands have been put down at her sides, like instruments she no longer trusts.!!';
    else if (g >= 4) hands = 'Her hands pour a little wide of level. She corrects them. They drift again.';
    else if (g >= 1) hands = 'Her hands run a beat behind her eyes, like a pulse taken twice to be sure.';
    else             hands = 'Her hands are steady.';

    return `${work} ${eyes} ${hands}`;
  },

  verbs: {

    let_her_tend: {
      label: 'let her tend you',
      desc: 'Lie still. Let her smooth the sheet.',
      respond(p) {
        const reps = streakCount(p, 'let_her_tend');
        if (reps >= 2) {
          return {
            lines: [
              'I lie still for it again. Her hands know the order: brow, wrist, sheet. I am well kept.',
              'Then her humming runs out. She is looking at the tray. ~~There is nothing on it.~~ She counts what is on it. She counts it twice.',
            ],
            scales: { tending: -2, clarity: +2 },
            flags: { let_her_tend: true },
            composure: -1,
            composureCost: 'Her hands were kind. The tray was empty. Both of these are true.',
          };
        }
        return {
          lines: [
            'I lie still. She draws the sheet to my chin and squares it. The starch smells of carbolic and old sun.',
            'She hums, low, three notes worth. It is the sound of being checked on. I had forgotten the sound.',
          ],
          scales: { tending: +1, clarity: +1 },
          flags: { let_her_tend: true },
        };
      },
    },

    refuse_quietly: {
      label: 'refuse quietly',
      desc: 'Wave her off. Do not take what she is offering.',
      respond(p) {
        const reps = streakCount(p, 'refuse_quietly');
        if (reps >= 2) {
          return {
            lines: [
              'I decline again. She accepts it the way she accepts a pulse: noted, charted, due to be taken again.',
              'My no has been worked into the round. It comes around nightly now, like the rest of me.',
            ],
            composure: -1,
            composureCost: 'I am being managed. Gently. On schedule.',
          };
        }
        return {
          lines: [
            'I lift a hand between us. I say: nothing for me. Not tonight.',
            'She sets the tray down within reach anyway. Refusal, in her experience, is a stage the patient passes through.',
          ],
          scales: { tending: -2 },
        };
      },
    },

    ask_about_shift: {
      label: 'ask about her shift',
      desc: 'When did she come on? When is she off?',
      when: (p) => p.scales.clarity <= 6,
      respond(p) {
        const reps = streakCount(p, 'ask_about_shift');
        if (reps >= 1) {
          return {
            lines: [
              'I ask it again, smaller: how long have you been on?',
              'She looks at the window. She does not answer. The not-answering takes a long time, and she does it standing quite still.',
            ],
            scales: { clarity: +3, tending: -2 },
            composure: -1,
            composureCost: 'I should not have asked twice.',
          };
        }
        return {
          lines: [
            'I ask: when did you come on?',
            'Seven, she says, at once, the way you answer a doctor. Then she hears it. Her eyes go to the window. The dark there is not evening dark. It has not been evening for years.',
          ],
          scales: { clarity: +2 },
        };
      },
    },

    say_her_name: {
      label: 'say her name',
      desc: 'Use the name on her tag. Not "nurse".',
      when: (p) => p.scales.clarity >= 2,
      respond(p) {
        if (p.scales.clarity >= 5) {
          return {
            lines: [
              'I say her name. The one on her tag.',
              'She stops mid-fold. Yes? she says — present, reporting for it. No one has called her anything but nurse in years.',
            ],
            scales: { clarity: +2, guilt: +1, tending: -1 },
          };
        }
        return {
          lines: [
            'I say her name. The one on her tag.',
            'She does not turn. The name goes past her like a page on the tannoy for someone two wards over.',
          ],
          scales: { clarity: +1 },
        };
      },
    },

    name_the_patient: {
      label: 'name the patient',
      desc: 'Name the one she lost. The first one.',
      when: (p) => p.scales.clarity >= 4,
      respond(p) {
        if (p.scales.clarity >= 7 && p.scales.tending <= 5) {
          return {
            lines: [
              'I say his name. The patient from [[8]].',
              'The sheet leaves her hands. She watches it go down. Her hands stay where the sheet was.',
              'She lowers herself to the floor at the foot of the bed and sits. !!It has been due for years. Tonight it is administered.!!',
            ],
            scales: { guilt: +4, clarity: +2, tending: -3 },
            flags: { named_him: true },
            composure: -1,
            composureCost: 'His name is on the air now, like ether. We are both breathing it.',
          };
        }
        return {
          lines: [
            'I say his name. The patient from [[8]].',
            'She goes still. !!Not on the ward,!! she says. !!Names carry on a night ward.!! She says it at the volume nurses keep for the dying.',
          ],
          scales: { guilt: +2, clarity: +1, tending: +1 },
          composure: -1,
          composureCost: 'She did not ask how I knew it. That is the part I keep returning to.',
        };
      },
    },

    tell_her_she_was_fired: {
      label: 'tell her she was let go',
      desc: 'Plainly. She is not on the roster.',
      when: (p) => p.scales.clarity >= 5,
      respond(p) {
        if (p.scales.clarity >= 7) {
          return {
            lines: [
              'I say: you were let go. You are not on the roster.',
              'She nods, once, the way she would take an order she disagreed with. Her eyes go down to the tray and do not come back up.',
              'I know, she says. Quietly, like a reading taken at night and not written down.',
            ],
            scales: { clarity: +3, tending: -4, guilt: +2 },
            flags: { told_her: true },
            composure: -1,
            composureCost: '!!I have said it aloud.!!',
          };
        }
        return {
          lines: [
            'I say: you were let go. You are not on the roster.',
            'She does not look at me. !!That is not correct,!! she says. !!I have been here all night.!!',
          ],
          scales: { clarity: +2, tending: +1, guilt: +1 },
          composure: -1,
          composureCost: 'She is not lying. She has been here all night.',
        };
      },
    },

    let_her_rest: {
      label: 'let her rest',
      desc: 'Tell her she can stop now. The work is done.',
      when: (p) => p.flags.named_him && p.scales.guilt >= 6,
      respond() {
        return {
          lines: [
            'I say: the round is finished. Everyone has been seen to. You can stop now.',
            'She looks at her hands. She lets the corner of the sheet go, and the sheet stays where it is, without her.',
            'She puts her face in her hands. !!Her shift is over.!!',
          ],
          scales: { tending: -10, guilt: -2, clarity: +2 },
          flags: { released: true },
          composure: -1,
          composureCost: 'I have signed her out. Nothing gave me the authority but the hour.',
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Lie still. Let her work around me.',
    when: (p) => p.scales.tending >= 5 || p.turn >= 5,
  },

  interjections: [
    {
      id: 'who_are_you_tonight',
      once: true,
      when: (p) => p.scales.tending >= 6 && p.turn >= 2,
      prose: [
        'She pauses at the corner of the sheet, mid-tuck. Her eyes come up the bed to my face, checking it against a list.',
        'She asks: ~~Who are you tonight?~~',
      ],
      responses: [
        {
          label: 'a new patient',
          desc: 'Accept her premise.',
          lines: [
            'I say: a new patient.',
            'She nods. New patients are the easiest hour of the night. The sheet comes up to my chin, and the round closes over me.',
          ],
          scales: { tending: +2, clarity: -1 },
          flags: { let_her_tend: true },
          scars: ['named'],
        },
        {
          label: 'a visitor',
          desc: 'A small lie.',
          lines: [
            'I say: a visitor.',
            'She pauses. Visiting hours ended at eight. Eight of some year. She does not say which, and neither does the window.',
          ],
          scales: { clarity: +2, tending: -1 },
        },
        {
          label: 'someone who came to find you',
          desc: 'The truest answer.',
          lines: [
            'I say: someone who came to find you.',
            'She stops. Her face goes through its stations — nurse, then woman, then neither.',
            'She lets the sheet go.',
          ],
          scales: { clarity: +3, guilt: +1, tending: -3 },
          composure: -1,
          composureCost: 'The corner of the sheet is not right. She has not noticed.',
        },
        {
          label: '[amnesia] I do not know',
          desc: 'Hand her the truth I came in with.',
          when: (_, player) => player.wound === 'amnesia',
          lines: [
            'I say: I do not know. They admitted me without anyone with me.',
            'She nods. She has had patients with nothing attached to them. They are the lightest work on the round.',
            'Her hand goes back to the corner of the sheet.',
          ],
          scales: { tending: +1, clarity: +1 },
        },
        {
          label: '[insomnia] someone on the late rounds with you',
          desc: 'Trade my watch for hers.',
          when: (_, player) => player.wound === 'insomnia',
          lines: [
            'I say: someone who has not slept. Like you.',
            'She looks up. Properly. For the first time.',
            'She says: ~~yes.~~ The room is loud at this hour.',
          ],
          scales: { clarity: +2, guilt: +1, tending: -1 },
        },
        {
          label: '[split personality] one of us. The other is at home',
          desc: 'Split the answer for her.',
          when: (_, player) => player.wound === 'split_personality',
          lines: [
            'I say: one of us came in. The other is at home.',
            'She takes it without blinking. People arrive on this ward in pieces. The pieces all get the same sheet.',
          ],
          scales: { clarity: +2, tending: -1 },
        },
      ],
    },

    {
      id: 'what_year',
      once: true,
      when: (p) => p.scales.clarity >= 5 && p.turn >= 3,
      prose: [
        'She stops mid-fold. The tiredness arrives all at once, the way it does at the end of a double.',
        'She asks, quietly: ~~What year is it?~~',
      ],
      responses: [
        {
          label: 'tell her the year',
          desc: 'Gently.',
          lines: [
            'I tell her the number. She holds it. She does not write it anywhere. There is nowhere on her chart for it.',
            'Then she sits on the foot of the bed. The bed takes her weight as if this, too, were overdue.',
          ],
          scales: { clarity: +3, guilt: +2, tending: -4 },
          composure: -1,
          composureCost: 'She has lost more time than I have been alive.',
        },
        {
          label: "it doesn't matter",
          desc: 'Kind refusal.',
          lines: [
            'I say: it does not matter. You are needed here regardless.',
            'She nods, grateful at the edges, and resumes the round. A touch slower. Doses get smaller near the end of the night.',
          ],
          scales: { tending: -1, clarity: -1 },
          scars: ['named'],
        },
        {
          label: "I don't know",
          desc: 'Meet her where she is.',
          lines: [
            "I say: I do not know.",
            'A small breath goes out of her. Between us we have no year at all. The ward will run to schedule regardless.',
          ],
          scales: { clarity: +1 },
        },
      ],
    },

    {
      id: 'I_was_supposed_to',
      once: true,
      when: (p) => p.scales.clarity >= 6 && p.turn >= 5,
      prose: [
        'The fold stops halfway. She holds the two corners apart, going nowhere.',
        'She says, to herself: ~~I was supposed to be home by now.~~',
      ],
      responses: [
        {
          label: "they'll be waiting",
          desc: 'A kind lie.',
          lines: [
            "I say: they'll still be there.",
            'She nods. She does not check. She knows better than to check.',
          ],
          scales: { tending: -1, clarity: -1 },
          scars: ['named'],
        },
        {
          label: 'you can go',
          desc: 'Release her.',
          lines: [
            'I say: you can go. The night will keep.',
            'She looks at the window, where going would be. She does not stand. But the fold stops, and stays stopped.',
            'Her hands are her own.',
          ],
          scales: { clarity: +3, tending: -4, guilt: +1 },
          composure: -1,
          composureCost: 'The work was the only thing keeping the hour off her.',
        },
        {
          label: "ask who's home",
          desc: 'Ask.',
          lines: [
            'I ask: who is at home?',
            'She says a name. One. It comes out at the volume of a pulse.',
          ],
          scales: { clarity: +2 },
        },
      ],
    },

    {
      id: 'I_lost_one',
      once: true,
      when: (p) => p.scales.guilt >= 5 && p.scales.clarity >= 4,
      prose: [
        'The folding has stopped on its own. Her hands hold their level the way a tired hand holds it — by correcting.',
        'She says, smaller: ~~I lost one of them.~~',
      ],
      responses: [
        {
          label: 'I know',
          desc: 'Meet her in the admission.',
          lines: [
            'I say: I know.',
            'She nods at the floor. Her hands have gone still at last. Folded. Off duty.',
            'She says: ~~three.~~ I lost three.',
          ],
          scales: { guilt: +3, clarity: +2, tending: -2 },
          flags: { named_him: true },
          composure: -1,
          composureCost: 'I have agreed with the worst thing in the room.',
        },
        {
          label: 'tell me about him',
          desc: 'Invite the memory.',
          lines: [
            'I ask: who was he?',
            'She begins. She is careful with the name. She says it the way she measures a dose.',
            'When she is done she looks at the tray. She does not pick it up.',
          ],
          scales: { guilt: +4, clarity: +2, tending: -3 },
          composure: -2,
          composureCost: 'She has said his name out loud.',
        },
        {
          label: 'it was an accident',
          desc: 'Try to soften it.',
          lines: [
            'I say: it was an accident.',
            'She shakes her head. !!I gave it to him,!! she says. !!I measured it. I measured it twice.!!',
          ],
          scales: { guilt: +2, clarity: +1 },
          composure: -1,
          composureCost: 'Absolution is a dose too. I had no order for it.',
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.guilt >= 6) {
      return {
        lines: [
          'I wait. Nothing is being smoothed. Her hands rest in her lap, and the rest is not restful.',
          'She watches the dark window for as long as a temperature takes. Then longer.',
        ],
        scales: { guilt: +1, clarity: +1 },
      };
    }
    if (p.scales.tending >= 6) {
      return {
        lines: ['I wait. She straightens the sheet under my chin. Her humming is the sound the room makes.'],
        scales: { tending: +1 },
        composure: -1,
        composureCost: 'My breathing has slowed to rounds pace. I did not slow it.',
      };
    }
    return {
      lines: ['I wait. Her shoes make no sound on the terrazzo. Night shoes. Bought for this.'],
      scales: { tending: +1 },
    };
  },

  endings: [
    // Be attended to → she notices the tray is empty
    {
      id: 'she_notices',
      when: (p) => p.flags.let_her_tend && p.scales.clarity >= 6 && p.scales.tending <= 3,
      title: 'She sets the tray down',
      lines: [
        'She takes the inventory. The tray. The cup. The folded sheet. The count comes out the same twice.',
        'There is nothing here, she says. Not to me. It is the last entry of the night.',
        '!!She leaves the room the way nurses leave the dead: quietly, and without turning around.!!',
      ],
      item: 'vial',
    },
    // Confront → she grieves
    {
      id: 'she_grieved',
      when: (p) => p.flags.released || (p.flags.named_him && p.scales.guilt >= 7 && p.scales.tending <= 4),
      title: 'Her shift ends',
      lines: [
        'She sits on the floor at the foot of the bed, off her feet at last. No bell rings for her. She stays down.',
        'She says his name. Once, the way it is written. Then again, the way it was said.',
        '!!The name was due years ago. It is given now, in full.!!',
      ],
      item: 'small_bell',
    },
    // She keeps working → too long
    {
      id: 'kept_working',
      when: (p) => p.scales.tending >= 9 && p.turn >= 8,
      title: 'Her work outlasts you',
      lines: [
        'She works around me. I have become part of the round — turned, smoothed, seen to.',
        'I leave before the round ends. !!The round does not end.!! My door closes itself behind me, soft as a jar.',
      ],
      item: null,
      scars: ['failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: [
        'I close the door. She is still straightening the sheet. ~~For someone who is not there.~~ For someone.',
      ],
      item: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// THE BOY AT THE WALL — Patient 0157
// ════════════════════════════════════════════════════════════════════════

const glimmer = {
  id: 'glimmer',
  name: '[The Witness]',
  glyph: 'Glimmerfox',
  subtitle: 'He has not blinked.',
  role: 'wing', tier: 2,
  file: [
    'Subject was [[1]] years old when [[8]] went into the road. The rest of the household looked away. Subject ~~could not~~ did not.',
    "Subject's eyes have remained open. Pupils respond to light. ~~They do not respond to anything nearer than the road.~~ They do not respond to staff.",
    'Standing order: !!do not cross Subject\'s line of sight, and do not follow it.!! The furniture has been arranged accordingly. The arrangement is reviewed yearly.',
  ],
  intro: [
    'He is on the floor against the wall, knees up, one hand making a slow petting motion over the boards beside him. The boards are worn pale under the motion, in its exact shape.',
    'His eyes are open and aimed past me, through the door, at street level. Everything in the room has moved to the walls over the years, out of that line. I come in the long way. So did the furniture.',
  ],

  scales: {
    present: {
      initial: 0, min: 0, max: 10, label: 'present', kind: 'positive',
      bands: [
        { at: 0, word: 'at the road' },
        { at: 2, word: 'elsewhere' },
        { at: 5, word: 'stirring' },
        { at: 7, word: 'here' },
        { at: 9, word: 'with me' },
      ],
      crossUp: {
        2: 'I have come into the part of the room he keeps track of.',
        3: 'His hand has found my sleeve.',
        4: 'He is here. All of him. All eight years.',
      },
      crossDown: {
        1: 'He has gone back down the line of sight, all the way to the end of it.',
      },
    },
    stare: {
      initial: 7, min: 0, max: 10, label: 'stare', kind: 'negative',
      bands: [
        { at: 0, word: 'eyes closed' },
        { at: 3, word: 'blinking' },
        { at: 5, word: 'fixed' },
        { at: 7, word: 'locked' },
        { at: 9, word: 'unable to look away' },
      ],
      crossUp: {
        3: 'His eyes have stopped moving.',
        4: '!!I have been counting. He has not blinked since I began.!!',
      },
      crossDown: {
        2: 'He has blinked. Once. I counted it.',
        1: 'His eyes have begun to close.',
        0: '!!His eyes are closed.!!',
      },
    },
    pressure: {
      initial: 1, min: 0, max: 10, label: 'pressure', kind: 'negative',
      bands: [
        { at: 0, word: 'quiet' },
        { at: 3, word: 'gathering' },
        { at: 5, word: 'building' },
        { at: 7, word: 'at his teeth' },
        { at: 9, word: 'about to be asked' },
      ],
      crossUp: {
        2: 'The question has moved up his throat.',
        3: 'His lips are shaping a word.',
        4: '!!The question has come to the front of his mouth.!!',
      },
      crossDown: {
        2: 'The question has settled back down.',
        1: 'The question has been answered.',
        0: 'He is not asking anymore.',
      },
    },
  },
  initialize(p, player) {
    p.scales.stare    = r(7, 9);
    p.scales.pressure = r(1, 3);
    p.scales.present  = 0;
    if (player?.scars?.includes('taken')) p.scales.pressure = Math.min(10, p.scales.pressure + 1);
  },

  fileReveals: [
    { announce: 'A line fills in. The road is [[4]] miles from this room. ~~You can hear it from here.~~ You cannot hear it from here.' },
    { announce: 'Another. The household looked away, all of them, at the same instant. The file marks Subject the exception. The file\'s word for it is **witness**.' },
    { announce: 'The last line. Light crosses his floor and the furniture follows it, an inch a year, like a sundial. He is the gnomon. He has not moved.' },
  ],

  presented(p) {
    const pr = p.scales.present;
    const st = p.scales.stare;
    const ps = p.scales.pressure;
    let eyes;
    if (st >= 8)      eyes = 'His eyes stand open the whole width. Dust settles on him out of the window light, and he lets it, the way a sill lets it.';
    else if (st >= 5) eyes = 'His eyes give me a slow length of their attention, then return down the line to the door. The line has right of way.';
    else if (st >= 2) eyes = 'His eyes have taken on weight. A blink gets through now and then, like a door easing in a draft.';
    else              eyes = 'His eyes are closed. His shoulders are loose.';
    let mouth;
    if (ps >= 7)      mouth = '!!His mouth has begun the first letter of it. It has been the first letter for a while.!!';
    else if (ps >= 4) mouth = 'His lips are parted the width of a word. Nothing comes through yet.';
    else if (ps >= 1) mouth = 'His lips are pressed to a seam.';
    else              mouth = 'His face is at rest the way unvisited rooms are at rest.';
    let reach;
    if (pr >= 7)      reach = 'He has hold of my sleeve. He has not let go.';
    else if (pr >= 4) reach = 'His arm is folded across his own knee. He has remembered it is his.';
    else if (pr >= 1) reach = 'His hand has crossed half the floor between us, flat to the boards, and stopped. The last span is mine to close.';
    else              reach = 'He leans low over the worn place in the boards, his hand going through the old motion, slow, at the height of a small back.';
    return `${eyes} ${mouth} ${reach}`;
  },

  verbs: {

    sit_with_him: {
      label: 'sit with him',
      desc: 'Lower yourself to the floor. Match his level.',
      respond(p) {
        if (p.scales.stare >= 7) {
          return {
            lines: [
              'I come down onto the boards beside him, against the wall, out of the line.',
              'He does not turn. The window light moves a hand\'s width across the floor between us. He does not.',
              'After a while my eyes water on his behalf. His do not.',
            ],
            scales: { present: +1, pressure: +1 },
            composure: -1,
            composureCost: 'He is small against the wall. The wall has had forty years to get used to it.',
          };
        }
        return {
          lines: [
            'I sit beside him. Our shoulders line up at the same height. Mine had farther to come down.',
            'He looks at the floor between us, at the worn place. I keep my hands off the worn place.',
          ],
          scales: { present: +2, stare: -1 },
        };
      },
    },

    look_at_floor: {
      label: "look where he's looking",
      desc: 'Follow his eyes. Let yourself see, too.',
      respond(p) {
        const reps = streakCount(p, 'look_at_floor');
        if (reps >= 1) {
          return {
            lines: [
              'I take the line again, farther this time. Past the doorframe. Past the corridor that should stop it. The line does not honor walls.',
              'At the far end of it the road sound starts up, faint, tires on a wet street. !!Four floors down and forty years back.!! I do not look away.',
            ],
            scales: { present: +2, stare: -2, pressure: -1 },
            composure: -2,
            composureCost: 'There are two of us looking now.',
          };
        }
        return {
          lines: [
            'I line my eyes up with his. The door. The hallway through it. The line keeps going where the building should interrupt it, and is not interrupted.',
            'Somewhere down the line there is daylight. Morning daylight, on a road surface. !!I can hear the road. This deep in the building, I can hear the road.!!',
            'I do not see what is on it. I understand that if I keep looking, I will.',
            '~~I look away.~~ I do not. I hold the line with him.',
          ],
          scales: { present: +3, pressure: +1 },
          composure: -1,
          composureCost: 'The road sound stays in my ears after I stop. Like water after swimming.',
        };
      },
    },

    cover_his_eyes: {
      label: 'cover his eyes',
      desc: 'Shield them. Let him stop seeing.',
      when: (p) => p.scales.present >= 4 && p.scales.stare <= 6,
      respond(p) {
        if (p.scales.present >= 5) {
          return {
            lines: [
              'I crouch and shield his eyes with my palm. His lashes brush warm against the skin.',
              'Under my hand, his eyes close. They go down slow, like a window being given permission.',
              'He breathes out. The breath is longer than he is. It has been going out since he was eight.',
              '!!He leans his forehead against my arm.!!',
            ],
            scales: { stare: -4, present: +2, pressure: -2 },
          };
        }
        return {
          lines: [
            'I raise my hand toward his eyes. They flinch and hold open. The watch is his, and I am not yet anyone who can relieve him of it.',
            'I let my hand come down empty. Not yet.',
          ],
          scales: { pressure: +2, stare: +1 },
          composure: -1,
          composureCost: 'His eyes have not blinked. Mine have begun to hurt.',
        };
      },
    },

    answer_him: {
      label: 'answer his question',
      desc: 'Say what he cannot ask. You may not know it yet.',
      when: (p) => p.scales.pressure >= 5 && p.scales.present >= 3,
      respond(p) {
        if (p.scales.pressure >= 6 && p.scales.present >= 4) {
          return {
            lines: [
              'I say: you could not have stopped it.',
              'I say: you did not look away.',
              'I say: it was not your fault. It has never been your fault.',
              'He begins to cry. ~~He is forty.~~ He is eight. He is eight. He is eight.',
              '!!It is said now. Said things stay in rooms like this.!!',
            ],
            scales: { present: +3, pressure: -5, stare: -3 },
            composure: -1,
            composureCost: 'I stood at the edge of what he watches. The edge does not wash off.',
          };
        }
        return {
          lines: [
            'I start an answer. It goes down the line and falls short of the road. I can tell by his eyes, which do not change.',
            'I am early, or I am late. The room does not say which. Rooms here keep that to themselves.',
          ],
          scales: { pressure: +2, present: -1 },
          composure: -2,
          composureCost: '!!I am answering nothing.!!',
        };
      },
    },

    tell_him_about_yours: {
      label: 'tell him about yours',
      desc: 'Tell him something you saw, that you cannot stop seeing.',
      when: (p, player) => (player.scars?.length || 0) > 0 && p.scales.present >= 2,
      respond(p, player) {
        const hasWitnessed = player.scars?.includes('witnessed');
        if (hasWitnessed) {
          return {
            lines: [
              'I tell him what I saw in this building, the version of it that can be said indoors.',
              'I tell him the part where I should have looked away and did not.',
              'He listens. His eyes do not move. But his fingers find the hem of my sleeve.',
            ],
            scales: { present: +3, stare: -2, pressure: -1 },
          };
        }
        return {
          lines: [
            'I tell him a thing I watched once and could not put down. It is small, next to his. I offer it at its true size.',
            'He listens with the near edge of his attention. The near edge is enough.',
          ],
          scales: { present: +2, stare: -1 },
        };
      },
    },

    say_what_he_sees: {
      label: "name what he's seeing",
      desc: 'Describe it out loud. Carefully. Accurately.',
      when: (p) => p.scales.stare >= 5 && p.scales.present >= 3,
      respond() {
        return {
          lines: [
            'I say it out loud, carefully, in order: the road. The morning. The five minutes. I stop at the curb of it.',
            'I say it without hurry. He listens. His lips move with mine.',
            'We have agreed on the edges of it. The middle stays his. The middle was always going to stay his.',
          ],
          scales: { present: +3, stare: -2, pressure: -2 },
          composure: -1,
          composureCost: 'The edges are mine now too. Edges are enough to cut.',
        };
      },
    },

    let_him_pet: {
      label: 'let him pet you',
      desc: 'He has been making the petting motion on the floor for forty years. Offer your sleeve.',
      when: (p) => p.scales.present >= 3 && p.scales.pressure <= 6,
      respond() {
        return {
          lines: [
            'I slide my sleeve under his fingers on the floor. They find the cuff.',
            'The motion carries on over my cuff, slow and exact, worn smooth as the boards it learned on.',
            'After a while he leans his head against my arm.',
          ],
          scales: { present: +3, stare: -2, pressure: -1 },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Hold still. The question is coming on its own.',
    when: (p) => p.scales.pressure >= 4 || p.scales.stare >= 7 || p.turn >= 4,
  },

  interjections: [
    {
      id: 'did_you_see',
      once: true,
      when: (p) => p.scales.present >= 4 && p.scales.pressure >= 5,
      prose: [
        'He turns toward me. It is the first time the line of sight has bent for anyone.',
        'He asks: ~~Did you see?~~ The words come out stiff at the corners, like furniture out of a sealed room.',
      ],
      responses: [
        {
          label: 'I saw',
          desc: 'Meet him there.',
          lines: [
            'I say: I saw.',
            'His face goes, slowly, the way wet paper goes — holding its shape, holding it, then none at all.',
            'He is eight, and here. Until this minute he was the only one on watch.',
          ],
          scales: { present: +4, pressure: -4, stare: -3 },
          composure: -1,
          composureCost: 'I am looking at the door. I am not looking away.',
        },
        {
          label: 'I see now',
          desc: 'Soften — show him the present.',
          lines: [
            'I say: I see you. I see you now.',
            'He blinks. ~~Once.~~ Once.',
          ],
          scales: { present: +3, stare: -2 },
        },
        {
          label: 'I look away',
          desc: 'Show him that looking away is allowed.',
          lines: [
            'I look away. At the wall, where nothing has ever happened. I make the looking loud.',
            'He watches me do it. Watching me is already not watching the road. Neither of us says so.',
          ],
          scales: { stare: -4, pressure: -2, present: +1 },
        },
        {
          label: '[amnesia] I do not remember what I saw',
          desc: 'Hand him the gap.',
          when: (_, player) => player.wound === 'amnesia',
          lines: [
            'I say: I do not remember. I was there. I do not have it any more.',
            'He looks at me a long, careful time. Of all the answers, that is the one he has been saving a hope for.',
            'He blinks. Once.',
          ],
          scales: { pressure: -2, stare: -2, present: +1 },
        },
        {
          label: '[insomnia] I have been awake since then',
          desc: 'Tell him what staying open does.',
          when: (_, player) => player.wound === 'insomnia',
          lines: [
            'I say: I have not slept since. The eyes stay open. The picture stays.',
            'He nods. Quickly. Twice.',
            'Two of us now, holding our eyes open in the same building.',
          ],
          scales: { present: +3, pressure: -2, stare: -1 },
          composure: -1,
          composureCost: 'I have admitted what I have been keeping behind my teeth.',
        },
        {
          label: '[split personality] one of me saw',
          desc: 'Split the witness in two.',
          when: (_, player) => player.wound === 'split_personality',
          lines: [
            'I say: one of me saw. The other was somewhere else.',
            'He thinks about that. He nods, slow.',
            'He has wished for that arrangement.',
          ],
          scales: { present: +2, stare: -3, pressure: -1 },
        },
      ],
    },

    {
      id: 'where_did_he_go',
      once: true,
      when: (p) => p.scales.present >= 5 && p.scales.stare <= 5,
      prose: [
        'His hand is at the worn place, going through the motion, slower than usual. A question pace.',
        'He asks, very small: ~~Where did he go?~~',
      ],
      responses: [
        {
          label: 'somewhere quiet',
          desc: 'Gentle. No specifics.',
          lines: [
            'I say: somewhere quiet. Where it does not hurt.',
            'He weighs it the way children weigh what adults say: entirely. Then he nods, and the nod is small and final.',
          ],
          scales: { present: +2, stare: -1, pressure: -2 },
        },
        {
          label: "I don't know",
          desc: 'Honest.',
          lines: [
            "I say: I don't know.",
            'He nods. It is the answer he keeps in his own mouth. Now we both keep it.',
          ],
          scales: { present: +3, stare: -3 },
        },
        {
          label: 'with the others',
          desc: 'Place him.',
          lines: [
            'I say: with the others. The rest of yours.',
            'He goes down the line with it, farther than I can follow, and is gone the length of three breaths.',
            'When he comes back, he is holding my sleeve and does not let go.',
          ],
          scales: { present: +2, pressure: -3 },
          composure: -1,
          composureCost: 'I have told him where the dead go. I do not know.',
        },
      ],
    },

    {
      id: 'can_we_go_now',
      once: true,
      when: (p) => p.scales.pressure >= 6 && p.scales.present >= 4,
      prose: [
        'He has begun to rock, a small travel, an inch each way. His lips go through the words once without sound. A rehearsal.',
        'He asks me: ~~Can we go now? Can we go home?~~',
      ],
      responses: [
        {
          label: 'soon',
          desc: 'A small lie.',
          lines: [
            'I say: soon.',
            'He nods. He does not believe me. He holds my sleeve anyway.',
          ],
          scales: { pressure: -1, present: +1, stare: +1 },
          scars: ['named'],
        },
        {
          label: 'we have to stay',
          desc: 'The harder truth.',
          lines: [
            'I say: we have to stay a little longer.',
            'He takes it quietly. For a moment the forty years sit on him where they belong. Then they get off again.',
          ],
          scales: { stare: -1, pressure: -1, present: +2 },
          composure: -1,
          composureCost: 'He does not argue. That is worse.',
        },
        {
          label: 'where is home',
          desc: 'Ask him.',
          lines: [
            'I ask: where is home?',
            'He gives it to me. A street name. A number. The words have kept their creases, like clothes out of a case no one opened.',
            '!!The number is gone. The street is gone. The five minutes are still running.!!',
          ],
          scales: { present: +3, pressure: -2 },
          composure: -2,
          composureCost: 'An address with no door left to it. I have it by heart already.',
        },
      ],
    },

    {
      id: 'mom_isnt_coming',
      once: true,
      when: (p) => p.scales.stare >= 7 && p.turn >= 3,
      prose: [
        'The petting motion has stopped. He is very still.',
        'He says, ~~to her~~ to the door: she said five minutes. ~~It has been forty years.~~ It has been longer than five minutes.',
      ],
      responses: [
        {
          label: "she'll come",
          desc: 'A kind, terrible lie.',
          lines: [
            "I say: she'll come.",
            'He nods, and settles back into the waiting as if the waiting had just been freshly made up, like a bed.',
          ],
          scales: { stare: +1, pressure: -2 },
          scars: ['named'],
          composure: -1,
          composureCost: 'She said five minutes. I have added to them.',
        },
        {
          label: 'she came back',
          desc: 'A different lie.',
          lines: [
            'I say: she came back. She has been here. You have been here with her.',
            'His eyes come partway off the line, for the first time, and do not know where else to be.',
          ],
          scales: { pressure: -1, stare: -1, present: +1 },
          composure: -1,
          composureCost: 'I have lied to a child about his mother.',
        },
        {
          label: "I'll stay",
          desc: 'Commit to the room.',
          lines: [
            "I say: I'll stay until someone comes.",
            'He reaches for my sleeve. His fingers are small and cold.',
          ],
          scales: { present: +3, stare: -2, pressure: -1 },
          composure: -1,
          composureCost: 'I have promised to outwait someone who is not coming.',
        },
      ],
    },
  ],

  drift(p) {
    p.scales.pressure = Math.min(10, (p.scales.pressure || 0) + 1);
    if (p.scales.pressure >= 7) {
      return {
        lines: [
          'I wait. His lips part on the question and hold there, open the width of it.',
          'Then they close over it again. It is not smaller for being swallowed.',
        ],
        scales: { pressure: +1, stare: +1 },
        composure: -1,
        composureCost: 'I am starting to hear it too.',
      };
    }
    if (p.scales.pressure >= 4) {
      return {
        lines: [
          'I wait. The petting motion keeps its slow time against the boards. The window light has moved a board\'s width. He has not.',
          'His fingers are very small.',
        ],
        scales: { stare: +1 },
        composure: -1,
        composureCost: 'I keep checking the floor under his hand.',
      };
    }
    return {
      lines: ['I wait. Dust comes down through the window light. It is the only thing in the room with somewhere to be.'],
      scales: { pressure: +1 },
    };
  },

  endings: [
    {
      id: 'eyes_closed',
      when: (p) => p.scales.stare <= 2 && p.scales.present >= 6,
      title: 'You close his eyes',
      lines: [
        'He is asleep against my arm, or near it. His eyes are closed. The lids look new. They have hardly been used.',
        'I do not move. I do not want to be the one who makes him open them.',
      ],
      item: 'photograph',
    },
    {
      id: 'answered',
      when: (p) => p.scales.pressure <= 1 && p.scales.present >= 7,
      title: 'You give him an answer',
      lines: [
        'He is crying, at last, at eight years old — on schedule by a clock that runs forty years slow.',
        '!!The room catches up all at once. The furniture is suddenly old.!!',
      ],
      item: 'scrap_of_paper',
    },
    {
      id: 'witnessed_with',
      when: (p) => p.scales.present >= 8 && p.scales.stare >= 5,
      title: 'You see for him',
      lines: [
        'I sit beside him and take up the line where it leaves the door. We hold it together, two pairs of eyes on one watch.',
        'I do not count the time. It is the first thing in this building I have not counted. He sets his head against my arm.',
        '!!The watch is mine now. It does not end at the door.!!',
      ],
      item: 'ink_bottle',
      scars: ['witnessed'],
    },
    {
      id: 'pressure_broke',
      when: (p) => p.scales.pressure >= 10,
      title: 'The question outlasts you',
      lines: [
        'The question fills the room to the sills. It is louder than the road, and the road should not be audible at all.',
        '!!I leave before it is asked. If it is asked, it will have to be answered, and I do not have the answer on me.!!',
      ],
      item: null,
      scars: ['witnessed', 'failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: ['I close the door behind me. The line of sight goes through it. ~~Through me.~~ I stand in it a moment, on the wrong side, and then I step out of the line.'],
      item: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// THE BENCH — Patient 0118
// ════════════════════════════════════════════════════════════════════════
//
// A young woman who sent her husband off to war. She sat at the rail
// platform every night to meet him on his return. Summer turned to
// winter. She did not move. She froze onto the bench. Her husband died
// in the war; she has not been told. Three paths:
//   - Warm her: thaw her hands, ease the wait, tell her he is not coming,
//     walk her off the bench.
//   - Pretend to be him: say his name as he would say it; she stands and
//     takes your arm. Tragic — he will leave again.
//   - Sit with her: stay on the bench until you are also frozen. The cold
//     takes you.

const frostfin = {
  id: 'frostfin',
  name: '[The Bench]',
  glyph: 'Frostfin',
  subtitle: 'The last service is delayed.',
  role: 'wing', tier: 1,
  file: [
    'Subject was recovered from the rail platform with a core temperature of [[4]] degrees. The bench was under her. It had been under her since [[8]].',
    'Her husband ~~was killed at~~ was declared killed in action at [[7]]. !!Subject has not been informed.!! ~~Her son wrote that he would come for her.~~ A relative was notified.',
    'The bench was admitted with Subject. No removal order was issued. ~~Staff cannot lift her.~~ Staff do not sit on the bench.',
  ],
  intro: [
    'The cold begins at the threshold, exact as a border. Under it there is an announcement that never quite arrives at words — the acoustics of a high glass roof, in a room with a low ceiling.',
    'A wooden bench faces the window. She is on it, buttoned to the throat, watching the door the way you watch a board that still says **expected**.',
  ],

  scales: {
    warmth: {
      initial: 0, min: 0, max: 10, label: 'warmth', kind: 'positive',
      bands: [
        { at: 0, word: 'a stranger' },
        { at: 2, word: 'thawing' },
        { at: 5, word: 'close' },
        { at: 7, word: 'leaning into me' },
        { at: 9, word: 'kin' },
      ],
      crossUp: {
        2: 'Her shoulder has found mine. One inch of it.',
        3: 'Her arm has come to rest against mine, and my arm is colder for it.',
        4: '~~She has decided I will do.~~',
      },
      crossDown: {
        1: 'She has gone back to the door. Back to **expected**.',
      },
    },
    waiting: {
      initial: 7, min: 0, max: 10, label: 'waiting', kind: 'negative',
      bands: [
        { at: 0, word: 'settled' },
        { at: 3, word: 'between services' },
        { at: 5, word: 'watching the door' },
        { at: 7, word: 'bolt upright' },
        { at: 9, word: 'fused to the bench' },
      ],
      crossUp: {
        3: 'Her spine has set. ~~The bench has her.~~',
      },
      crossDown: {
        2: 'Her shoulders have eased.',
        1: 'She has settled.',
        0: 'She is not waiting anymore.',
      },
    },
    cold: {
      initial: 4, min: 0, max: 10, label: 'cold', kind: 'negative',
      bands: [
        { at: 0, word: 'warm' },
        { at: 3, word: 'cool' },
        { at: 5, word: 'cold' },
        { at: 7, word: 'freezing' },
        { at: 9, word: 'killing' },
      ],
      crossUp: {
        2: 'My breath has begun to show.',
        3: '!!The cold has crossed my skin and started on the joints. My fingers answer late.!!',
        4: '!!The cold has stopped being weather. It is a withdrawal, and it is coming out of me.!!',
      },
      crossDown: {
        2: 'The room has warmed by a degree.',
        1: 'My fingers report back in, one at a time.',
        0: 'The room is warm now.',
      },
    },
  },

  initialize(p) {
    p.scales.cold = r(4, 6);
    p.scales.waiting = r(7, 9);
    p.scales.warmth = 0;
  },

  fileReveals: [
    { announce: 'A line fills in. Subject was on the bench from ~~the last service~~ summer until winter. Nothing ran in between.' },
    { announce: 'Another. Her husband ~~died in the mud at~~ was killed in action on [[8]]. The letter is on file. The envelope was never opened.' },
    { announce: 'The last line. Subject has been informed on [[2]] occasions. ~~She refuses it.~~ It does not take. !!Each morning he is due again.!!' },
  ],

  presented(p) {
    const c = p.scales.cold;
    const w = p.scales.waiting;
    const wa = p.scales.warmth;

    let temp;
    if (c >= 7)      temp = '!!The room is white with cold. My breath shows. Hers does not.!!';
    else if (c >= 4) temp = 'The room is cold the way platforms are cold: from below, and patiently.';
    else if (c >= 1) temp = 'The room is cool, and grudging about every degree it gives back.';
    else             temp = 'The room is warm.';

    let post;
    if (w >= 8)      post = 'She sits bolt upright, the posture of a passenger one stop from home. She has not shifted her weight since I last counted.';
    else if (w >= 5) post = 'She sits upright, buttoned to the throat, facing the door at the angle you face an arrivals board.';
    else if (w >= 2) post = 'Her shoulders have dropped. The bench has begun to be a bench.';
    else             post = 'She leans, slightly. The timetable has loosened its grip.';

    let warm;
    if (wa >= 7)      warm = 'Her arm is against mine. The heat goes one way through the wool.';
    else if (wa >= 4) warm = 'She has shifted toward me. Her eyes leave the door now, in short visits.';
    else if (wa >= 1) warm = 'She glances at me the way you check a clock against your own watch.';
    else              warm = 'She is watching the door.';

    return `${temp} ${post} ${warm}`;
  },

  verbs: {

    sit_with_her: {
      label: 'sit with her',
      desc: 'Sit on the bench. Join the timetable.',
      respond(p) {
        const reps = streakCount(p, 'sit_with_her');
        if (reps >= 2) {
          return {
            lines: [
              'I have been on the bench long enough to learn it through my coat: the bench is taking heat too.',
              'We are waiting in the same direction now. Overhead, the announcement almost resolves into a platform number.',
            ],
            scales: { warmth: +2, waiting: -1, cold: +2 },
            composure: -2,
            composureCost: '!!Two of my fingers have stopped reporting.!!',
          };
        }
        return {
          lines: [
            'I sit. The bench takes its fee at once, through the coat, a flat rate.',
            'After a while I am also waiting. I did not choose a train, but I am waiting for it.',
          ],
          scales: { warmth: +1, waiting: -1, cold: +1 },
          composure: -1,
          composureCost: 'My breath shows. Hers does not.',
        };
      },
    },

    warm_the_room: {
      label: 'warm the room',
      desc: 'Find a radiator. Find a lamp. Find anything.',
      respond() {
        return {
          lines: [
            'I quarter the room. Behind the bench there is a small heater, cord wound tight, stored the way stations store lost property. I plug it in.',
            'The room comes up a degree. She does not acknowledge the heater. But her hands move into her lap, off the cold wood.',
          ],
          scales: { cold: -2, warmth: +1 },
        };
      },
    },

    warm_her_hands: {
      label: 'warm her hands',
      desc: 'Take her hands. Pay the difference.',
      when: (p) => p.scales.warmth >= 1 || p.turn >= 2,
      respond(p) {
        if (p.scales.warmth >= 5) {
          return {
            lines: [
              'I cup her hands between mine and hold the loss steady. She lets me.',
              'Feeling comes back into them slowly — mine leaving, hers arriving. She studies her own fingers like luggage she had given up on.',
            ],
            scales: { warmth: +2, waiting: -2, cold: -1 },
          };
        }
        return {
          lines: [
            'I take her hands, and my heat leaves at a rate I can count, knuckle by knuckle.',
            'She does not pull away. She does not return anything. The exchange runs one way.',
          ],
          scales: { warmth: +1, cold: +1 },
          composure: -1,
          composureCost: 'Her hands are colder than the bench.',
        };
      },
    },

    ask_about_him: {
      label: 'ask about him',
      desc: 'Ask who she is waiting for.',
      when: (p) => p.scales.warmth >= 2,
      respond() {
        return {
          lines: [
            'I ask: who are you waiting for?',
            'She tells me. His name comes out in pieces, the way a frozen thing thaws — edges first. She has not said it aloud in years.',
            'She watches the door while she speaks. But the door has lost a fraction of her. I have it.',
          ],
          scales: { warmth: +2, waiting: -1 },
        };
      },
    },

    tell_her_he_is_gone: {
      label: 'tell her he is gone',
      desc: 'Tell her he was killed.',
      when: (p) => p.scales.warmth >= 4,
      respond(p) {
        if (p.scales.warmth < 6) {
          return {
            lines: [
              'I say: he is not coming. He was killed.',
              'Nothing in her face moves. She says: I knew. She says it the way you note a delay — confirmed, and not boarded.',
            ],
            scales: { warmth: -1, waiting: +1, cold: +1 },
            composure: -1,
            composureCost: '!!She has heard it before. By morning he will be due again.!!',
          };
        }
        return {
          lines: [
            'I say: he was killed. He is not coming.',
            'She looks at me for a long time. Her eyes fill and hold, the way cold water holds.',
            'She says: ~~yes.~~ I know. ~~I know.~~ I know.',
          ],
          scales: { warmth: +1, waiting: -4 },
          flags: { told_her: true },
          composure: -1,
          composureCost: '!!She has accepted it for the first time.!!',
        };
      },
    },

    say_you_are_him: {
      label: 'say you are him',
      desc: 'Lie. Be the one who is due.',
      when: (p) => p.scales.warmth >= 4,
      respond() {
        return {
          lines: [
            'I say: !!I am sorry I am late.!!',
            'She turns. She does not check my face against anything. She stands — the first time the bench has let her — and takes my arm.',
            'She walks me to the door at a pace for two. ~~She does not look at me closely.~~ She is careful not to look at me closely. There is a discipline to it.',
          ],
          scales: { warmth: +3, waiting: -6 },
          flags: { pretended: true },
          composure: -2,
          composureCost: 'I have taken on his lateness. It is forty years deep.',
          scars: ['named'],
        };
      },
    },

    walk_her_off_bench: {
      label: 'walk her off the bench',
      desc: 'Help her stand. Lead her away.',
      when: (p) => p.flags.told_her && p.scales.warmth >= 6 && p.scales.waiting <= 3,
      respond() {
        return {
          lines: [
            'I offer my arm. She stands the way you step down from a long journey: unsteady, surprised by solid ground.',
            'She walks to the door without looking back. !!Behind us the bench is just carpentry.!!',
          ],
          scales: { waiting: -5, warmth: +1 },
          flags: { walked_off: true },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Hold the bench. The room bills by the minute.',
    when: (p) => p.scales.waiting >= 6 || p.turn >= 4,
  },

  interjections: [
    {
      id: 'has_the_train_come',
      once: true,
      when: (p) => p.scales.waiting >= 6 && p.turn >= 2,
      prose: [
        'She does not turn her head. She addresses the door, in the voice you keep for staff:',
        '~~Has the train come?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'Lie kindly.',
          lines: [
            'I say: yes. It came in. On time.',
            'Her shoulders come down a full inch. She does not ask who got off. She has had practice not asking that.',
          ],
          scales: { waiting: -3, warmth: +1, cold: +1 },
          scars: ['named'],
        },
        {
          label: 'not yet',
          desc: 'Honest.',
          lines: [
            'I say: not yet.',
            'She nods: of course. A delay is a kind of promise. Her arm finds mine, and the cold finds my arm.',
          ],
          scales: { warmth: +2, waiting: +1 },
          composure: -1,
          composureCost: 'My breath shows. Hers does not.',
        },
        {
          label: "I don't think it's coming",
          desc: 'The truth.',
          lines: [
            "I say: I don't think it's coming.",
            'She is quiet. She looks at the stretch of bench beside her, the seat kept open through forty years of timetable.',
            'She says: ~~he said he would come.~~ I knew. Very small.',
          ],
          scales: { waiting: -4, warmth: +1, cold: +1 },
          composure: -2,
          composureCost: 'The bench is colder than the floor.',
        },
      ],
    },
    {
      id: 'is_it_late',
      once: true,
      when: (p) => p.scales.waiting >= 7 && p.turn >= 4,
      prose: [
        'She turns her wrist over and presses where a watch should be. The skin there is a paler band.',
        'She asks: ~~Is it late?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'A small truth.',
          lines: [
            'I say: yes. It is late.',
            'She nods slowly. She does not stand. Late is still a board word. Late still arrives.',
          ],
          scales: { waiting: +1, cold: +1 },
          composure: -1,
          composureCost: 'I have agreed to an hour that already happened.',
        },
        {
          label: 'we have time',
          desc: 'A kind lie.',
          lines: [
            'I say: we have time.',
            'She eases by a degree — I feel the degree leave me. Her eyes go back to the door.',
          ],
          scales: { waiting: -1, warmth: +1 },
          scars: ['named'],
        },
        {
          label: 'too late for trains',
          desc: 'Gentle truth.',
          lines: [
            'I say: too late for trains.',
            'She is quiet. Overhead, the announcement stops mid-syllable. ~~She had not let herself say it.~~ Someone had to be first.',
          ],
          scales: { waiting: -3, warmth: +1, cold: +1 },
          composure: -2,
          composureCost: 'The door is heavier than I expected.',
        },
      ],
    },
    {
      id: 'will_you_wait',
      once: true,
      when: (p) => p.scales.warmth >= 5,
      prose: [
        'She leans into me. For the first time the door goes unwatched.',
        'She asks me: ~~Will you wait with me?~~',
      ],
      responses: [
        {
          label: 'I will',
          desc: 'Commit to the bench.',
          lines: [
            'I say: I will.',
            'She sets her head against my shoulder. It is the weight of a coat. The cold comes through it like a draft under a door.',
          ],
          scales: { warmth: +3, waiting: -2, cold: +2 },
          composure: -2,
          composureCost: '!!Two of my fingers have stopped reporting.!!',
        },
        {
          label: 'only a while',
          desc: 'An honest limit.',
          lines: [
            'I say: only a while. I cannot stay long.',
            'She nods. Terms are a thing she understands; the railway taught her terms. She presses my shoulder once and stays.',
          ],
          scales: { warmth: +1, waiting: -1 },
        },
        {
          label: 'I have to go',
          desc: 'Leave the offer.',
          lines: [
            'I say: I have to go soon.',
            'She holds my shoulder one beat past comfortable — a passenger keeping a door from closing. Then she eases off.',
          ],
          scales: { warmth: -2, cold: +1, waiting: +2 },
          composure: -2,
          composureCost: 'My breath shows. Hers does not.',
        },
      ],
    },
    {
      id: 'which_one',
      once: true,
      when: (p) => p.scales.warmth >= 4,
      prose: [
        'Her head turns. She reads my face the way you read a destination through dirty glass.',
        'She asks: ~~Which one are you?~~',
      ],
      responses: [
        {
          label: 'tell her my name',
          desc: 'I am not him.',
          lines: [
            'I say: I am Patient 0413. I came in this morning. I am not your husband.',
            'She nods. ~~She is not disappointed.~~ She is filing me under a different heading. She had not been sure.',
          ],
          scales: { warmth: -1, cold: +1, waiting: +1 },
          composure: -1,
          composureCost: '!!I am waiting too.!!',
        },
        {
          label: 'I am the one who came',
          desc: 'Let her have a guess.',
          lines: [
            'I say: I am the one who came.',
            'She takes my arm and leans her whole wait into it. ~~She does not check.~~ Checking is the one expense she will not make.',
          ],
          scales: { warmth: +3, waiting: -2 },
          scars: ['named'],
        },
        {
          label: "I don't know",
          desc: 'Honest.',
          lines: [
            "I say: I don't know.",
            'She nods. ~~That is also the answer she has.~~',
          ],
          scales: { warmth: +1 },
        },
        {
          label: '[amnesia] I do not remember which I would be',
          desc: 'Make her guess the better answer.',
          when: (_, player) => player.wound === 'amnesia',
          lines: [
            'I say: I do not remember if I was ever one of yours.',
            'She considers it the way you consider a timetable with a line missing.',
            'She says: ~~then we can decide.~~',
          ],
          scales: { warmth: +2, waiting: -1 },
        },
        {
          label: '[insomnia] the one who came on the late train',
          desc: 'Be the one she has been awake for.',
          when: (_, player) => player.wound === 'insomnia',
          lines: [
            'I say: the one who came on the late train.',
            'Her face changes. ~~Recognition.~~ Relief. It has always been the late one she was holding the bench for.',
            'She squeezes my sleeve, twice, the press of a conductor\'s punch.',
          ],
          scales: { warmth: +3, waiting: -3, cold: -2 },
          composure: -1,
          composureCost: 'She has been waiting a long time, and I have agreed to be the reason.',
        },
        {
          label: '[split personality] both of us came. One stayed home',
          desc: 'Give her the math she wants.',
          when: (_, player) => player.wound === 'split_personality',
          lines: [
            'I say: both of us came. One of me stayed at home with the chair pulled out.',
            'She nods. Two is a number the bench understands.',
            'She does not let go of my arm.',
          ],
          scales: { warmth: +2, waiting: -1 },
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.cold >= 5) {
      return {
        lines: [
          'I wait. The cold works at me with the patience of scheduled stock. My eyelids have taken on weight.',
          'I am getting tired in the way she is tired. The bench has begun fitting me.',
        ],
        scales: { cold: +1, waiting: +1 },
        composure: -1,
        composureCost: '!!The bench is colder than the floor.!!',
      };
    }
    if (p.scales.waiting >= 6) {
      return {
        lines: ['I wait. Overhead, the not-quite announcement runs again — a platform, then a number that never lands. The door admits no one.'],
        scales: { cold: +1, waiting: +1 },
        composure: -1,
        composureCost: '!!I am waiting too.!!',
      };
    }
    return {
      lines: ['I wait. She presses her sleeve to where the watch should be, and reads the time off her own skin.'],
      scales: { warmth: +1, cold: +1 },
    };
  },

  endings: [
    // Walked off the bench (good): she accepts and stands.
    {
      id: 'walked_off',
      when: (p) => p.flags.walked_off,
      title: 'You walk her off the bench',
      lines: [
        'She walks beside me to the door. She does not look back at the bench.',
        'She cries quietly, all the way. She does not stop walking.',
        '!!The bench is just a bench again.!!',
      ],
      item: 'worn_ribbon',
    },
    // Pretended to be him (tragic): she stands believing he came.
    {
      id: 'pretended',
      when: (p) => p.flags.pretended,
      title: 'She lets you walk her out',
      lines: [
        'She holds my arm tighter when we reach the door.',
        '!!She does not look at me close. She does not look close at all.!!',
        'I leave her at the next door. She will sit on a new bench tomorrow.',
      ],
      item: 'handkerchief',
      scars: ['named'],
    },
    // Frozen with her (bad): composure broke or cold maxed.
    {
      id: 'frozen',
      when: (p, player) => p.scales.cold >= 9 || player.composure <= 0,
      title: 'The cold takes you',
      lines: [
        'The room is very cold. I am very tired. I sit down on the bench. She does not look at me.',
        '!!I do not know which of us is waiting now.!!',
      ],
      item: null,
      scars: ['collapsed'],
    },
    // Outlasted (timeout).
    {
      id: 'still_waiting',
      when: (p) => p.turn >= 12,
      title: 'She outlasts you',
      lines: [
        'She has been waiting longer than I can be a guest. ~~He is not coming.~~ He never was.',
        'I leave her on the bench.',
      ],
      item: null,
      scars: ['failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: ['I close the door. She is on the bench. She has not looked up since I came in.'],
      item: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// THE CHOIR — the final ward
// ════════════════════════════════════════════════════════════════════════

const choir = {
  id: 'choir',
  name: '[The Choir]',
  glyph: 'Lumenpup',
  subtitle: 'They were singing when I came in.',
  role: 'final',
  file: [
    'The final ward houses the choir. The census lists one patient. The duty nurse counts the voices through the door and stops at a number she does not enter on the form.',
    'Each admission ~~surrenders a voice~~ resolves a note. !!The chord is almost full.!!',
    'Subject 0413 has been ~~the missing note~~ on file since [[8]]. The choir keeps her seat. The form says **expected**.',
  ],
  intro: [
    'The door opens on the sound before it opens on the room. The choir is standing in rows. The choir are turning their heads.',
    'They turn at one speed, the way a field turns under wind. ~~Some of them have my face.~~ All of them have a face I have worn.',
    '!!One of them is me. She is holding my note for me.!!',
  ],

  scales: {
    self: {
      initial: 10, min: 0, max: 10, label: 'self', kind: 'positive',
      bands: [
        { at: 0, word: 'almost gone' },
        { at: 3, word: 'thin' },
        { at: 5, word: 'here' },
        { at: 7, word: 'intact' },
        { at: 9, word: 'whole' },
      ],
      crossDown: {
        3: 'I am thinner than I was. My shadow has gone grey at the edges.',
        2: 'I am hard to find, even from in here.',
        1: 'There is enough of me left to write this. That is what is left.',
        0: '!!I am almost gone. The pen is heavier than the hand.!!',
      },
      crossUp: {
        2: 'I am back. ~~Most of me.~~ Enough of me.',
        3: 'I am here. The floor takes my weight again and creaks to confirm it.',
      },
    },
    recognition: {
      initial: 0, min: 0, max: 10, label: 'recognition', kind: 'positive',
      bands: [
        { at: 0, word: 'unknown' },
        { at: 2, word: 'stirring' },
        { at: 5, word: 'hearing it' },
        { at: 7, word: 'knowing' },
        { at: 9, word: 'seeing whole' },
      ],
      crossUp: {
        2: 'I can hear the gap in the chord. It is my width exactly.',
        3: 'The rows have become faces. Each face has a file. I have read some of them.',
        4: '!!I know what this is. It is a register, and it is being called.!!',
      },
      crossDown: { 1: 'The faces have gone back to being rows.' },
    },
    chord: {
      initial: 2, min: 0, max: 10, label: 'chord', kind: 'negative',
      bands: [
        { at: 0, word: 'silent' },
        { at: 3, word: 'humming' },
        { at: 5, word: 'stacking' },
        { at: 7, word: 'full' },
        { at: 9, word: 'resolving' },
      ],
      crossUp: {
        2: 'The chord has thickened. The wired glass hums along.',
        3: '!!The chord has found my pitch. It is holding that door open.!!',
        4: '!!The chord is one note from full, and the gap is shaped like a person standing where I stand.!!',
      },
      crossDown: {
        2: 'The chord has come apart into people.',
        1: 'One voice has stopped. The rest close over it like water.',
        0: 'The chord is gone. The room is only breathing.',
      },
    },
    voice: {
      initial: 0, min: 0, max: 10, label: 'voice', kind: 'negative',
      bands: [
        { at: 0, word: 'silent' },
        { at: 3, word: 'humming' },
        { at: 5, word: 'joining' },
        { at: 7, word: 'blended' },
        { at: 9, word: 'lost in chord' },
      ],
      crossUp: {
        2: 'There is a hum in the room at my pitch. I put my hand to my throat. ~~It is not me.~~ It is me.',
        3: 'My voice has been seated with the others.',
        4: '!!I can hear myself from across the room. From over there, I sound settled.!!',
      },
      crossDown: {
        2: 'My mouth has closed.',
        1: 'I have stopped singing. The hum runs on a half-second longer than I do.',
        0: 'I am silent. The chord holds my place at pitch, the way a finger holds a page.',
      },
    },
  },
  initialize(p, player) {
    const carried = player.items?.length || 0;
    p.scales.chord = 3 + Math.min(3, Math.floor(carried / 2));
    p.scales.voice = 0;
    p.scales.self = 10;
    p.scales.recognition = 0;
  },

  fileReveals: [
    { announce: 'A line fills in. The choir predates the staff. The choir predates the wards. ~~The choir predates the building.~~ The building was raised around the sound.' },
    { announce: 'Another. Discharges from the final ward: the column is blank. ~~No one has left.~~ The column was printed blank.' },
    { announce: '!!The last line is already filled in. Subject 0413 is the missing note. The hand is mine.!!' },
  ],

  presented(p) {
    const s = p.scales.self;
    const re = p.scales.recognition;
    const c = p.scales.chord;
    const v = p.scales.voice;
    let song;
    if (c >= 8)      song = '!!The chord is full. It is not getting louder. It is getting nearer.!!';
    else if (c >= 5) song = 'The choir is singing in parts. I can name the wards the parts came from.';
    else if (c >= 2) song = 'The choir is humming just under the pitch of the fluorescent tubes, waiting for the key to be agreed.';
    else             song = 'The choir is quiet. The choir are watching me. Both sentences are true. I have checked them twice.';
    let me;
    if (v >= 7)      me = '~~I am singing.~~ A voice with my name on it is singing. I am over here, listening to it.';
    else if (v >= 4) me = 'I am humming. I did not start.';
    else if (re >= 3) me = 'I can hear the gap where my voice would go. I stand back from it the way you stand back from a platform edge.';
    else              me = 'My mouth is closed.';
    let left;
    if (s >= 7)      left = 'I am here. When I count my fingers against the light, the count comes back ten.';
    else if (s >= 4) left = '~~I am tired.~~ I am thinner. The light through the window takes less trouble going around me.';
    else if (s >= 1) left = 'There is less of me than the coat says. The coat is keeping my shape on file.';
    else              left = '~~I am~~ What is left of me is writing this down. The hand is faint but legible.';
    return `${song} ${me} ${left}`;
  },

  verbs: {

    hold_yourself: {
      label: 'hold yourself',
      desc: 'Do not move. Do not sing. Be the rest in the bar.',
      respond(p) {
        const reps = streakCount(p, 'hold_yourself');
        if (reps >= 2) {
          return {
            lines: [
              'I keep holding. The chord moves around me the way water moves around a piling — patient, taking measurements.',
              'I do not give it my note. Holding a note back is also a way of holding a note.',
            ],
            scales: { self: -1, recognition: +2 },
            composure: -1,
            composureCost: 'My jaw aches with the not-singing.',
          };
        }
        return {
          lines: [
            'I stand on the pale worn path just inside the door and hold. I am the one who came in. The sentence bears weight, so I stand on it.',
            'The chord leans my way, then passes, the way a torch beam passes a person standing among coats.',
          ],
          scales: { recognition: +2 },
        };
      },
    },

    listen_for_yours: {
      label: 'listen for your voice',
      desc: 'Pick out your own voice in the chord. Find where it is.',
      respond() {
        return {
          lines: [
            'I listen for myself. I find myself in the second row of the sound, holding a long low note with no strain in it. None at all. The note has had practice.',
            'I came in this morning. ~~The voice came in~~ The voice did not come in. It was here when the doors were hung.',
          ],
          scales: { recognition: +3, self: -1 },
          composure: -1,
          composureCost: 'I have heard my own breath used by someone else.',
          flags: { found_voice: true },
        };
      },
    },

    sing: {
      label: 'sing with them',
      desc: 'Join the chord. Let your voice in.',
      when: (p) => p.scales.recognition >= 1,
      respond(p) {
        const reps = streakCount(p, 'sing');
        if (reps >= 1) {
          return {
            lines: [
              'I sing on. The chord makes room for me. The chord makes room of me. One word of that is wrong, and I cannot hear which.',
            ],
            scales: { voice: +3, chord: +2, self: -2 },
            composure: -1,
            composureCost: '!!I am being learned.!!',
          };
        }
        return {
          lines: [
            'I open my mouth and the note is already in it, warmed up, waiting to go.',
            'It fits. ~~The chord made room.~~ Nothing made room. I was always the size of the gap.',
          ],
          scales: { voice: +2, chord: +1, self: -1 },
        };
      },
    },

    name_yourself: {
      label: 'name yourself',
      desc: 'Say your number. Out loud.',
      when: (p) => p.scales.self >= 3,
      respond(p) {
        const reps = streakCount(p, 'name_yourself');
        if (reps >= 1) {
          return {
            lines: [
              'I say it again, louder, the way you repeat an order down a bad line. !!Patient 0413.!!',
              'The chord loses a note — mine, taken back across the counter. ~~Stolen.~~ Reclaimed.',
            ],
            scales: { self: +2, voice: -2, recognition: +1 },
          };
        }
        return {
          lines: [
            'I say: !!Patient 0413.!!',
            'The chord stumbles on the number like a stair that is not where the foot expects. One voice loses its place. ~~Mine.~~ The one that was using mine.',
          ],
          scales: { voice: -2, self: +2, chord: -1 },
        };
      },
    },

    take_yours_out: {
      label: 'take your voice out',
      desc: 'Reach into the chord. Pull yourself free of it.',
      when: (p) => p.flags.found_voice && p.scales.recognition >= 5,
      respond(p) {
        if (p.scales.recognition < 7) {
          return {
            lines: [
              'I reach into the sound for my voice. My hand knows the pitch the way it knows a coat in a dark hall. ~~It is my coat.~~ It is a coat my size.',
              'I pull. A singer goes quiet, somewhere in the third row. ~~Me.~~ Not me. I have silenced a stranger with my name on her breath.',
            ],
            scales: { self: -1, recognition: -1 },
            composure: -2,
            composureCost: 'One of them sounds like me. All of them do, in the right light.',
            scars: ['witnessed'],
          };
        }
        return {
          lines: [
            'I reach into the chord and take hold of my voice. It is exactly where I left it. Nothing in this building is ever lost. That is the trouble with this building.',
            'I pull it out. The chord closes ranks behind it, one short. I am ~~smaller~~ louder for it.',
            '!!I have me again.!!',
          ],
          scales: { voice: -10, self: +3, chord: -3 },
          flags: { excised: true },
        };
      },
    },

    close_door: {
      label: 'close the door',
      desc: 'Shut it. Which side you are on is decided by where you stand.',
      when: (p) => p.scales.self >= 5,
      respond() {
        return {
          lines: [
            'I close the door. ~~From the inside.~~ From the outside.',
            'The rubber seal takes the chord down to one note, soft as a jar closing on it.',
            'I am out. The count on the corridor side is one. I do not take the count in the room.',
          ],
          flags: { shut_door: true },
        };
      },
    },

    look_at_yours: {
      label: 'look at one of them',
      desc: 'Pick a single singer. See who it is.',
      when: (p) => p.scales.recognition >= 3,
      respond(p) {
        const reps = streakCount(p, 'look_at_yours');
        const which = reps + 1;
        const memories = [
          ['I look at one singer. She rocks as she sings, five beats to the bar, the tempo of a lullaby I have counted before.', 'There is no pram. Her arms hold the shape of one anyway, and the shape is sleeping.'],
          ['I look at another. He sits while the rest stand, dictating his part to a clerk who is not there. He has the dates cold.', '~~I closed his eyes.~~ I closed his eyes.'],
          ['I look at another. She sings walking — four steps, a pause the length of a pulse taken, four steps — down a row of beds that are not there.', 'Her part is rounds. The tray she carries has been sugar water for years. The rounds go on either way.'],
          ['I look at another. She sings seated, buttoned to the throat, facing the door the way you face an arrivals board.', 'I sat with her. ~~For an hour.~~ For a winter.'],
        ];
        const m = memories[Math.min(which - 1, memories.length - 1)];
        return {
          lines: [m[0], m[1]],
          scales: { recognition: +2, self: -1 },
          composure: -1,
          composureCost: 'I know them by what I did for them. Knowing is how the chord knows me back.',
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Stand still. The chord can keep time longer than I can.',
    when: () => true,
  },

  interjections: [
    {
      id: 'one_of_us',
      once: true,
      when: (p) => p.scales.voice >= 4,
      prose: [
        'The chord pauses on a held breath. One singer steps out of the rows. She has my haircut, and my habit of counting — her lips move through the numbers between the lines.',
        'She asks me, in the plural: ~~Are we one of us yet?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'Concede.',
          lines: [
            'I say: yes.',
            'The chord takes the word the way a collection plate takes a coin — without comment, already moving on.',
            '!!Somewhere in the rows, a mouth I know closes around my note and keeps it.!!',
          ],
          scales: { voice: +4, chord: +3, self: -3 },
          composure: -2,
          composureCost: 'The yes is entered. There is no column for taking it back.',
        },
        {
          label: 'no',
          desc: 'Refuse.',
          lines: [
            'I say: no.',
            'The chord does not argue. It goes back one bar and sings the question again, unchanged, the way a form sent back unsigned comes back to you unsigned.',
          ],
          scales: { self: +2, voice: -2, recognition: +2 },
        },
        {
          label: "I don't know",
          desc: 'Honest.',
          lines: [
            "I say: I don't know.",
            'The chord holds under it, patient as a pedal note. Not knowing is a note too. They can use it.',
          ],
          scales: { recognition: +3 },
        },
      ],
    },
    {
      id: 'sing_with_us',
      once: true,
      when: (p) => p.scales.chord >= 7 && p.scales.voice <= 3,
      prose: [
        'The chord opens down the middle, the way rows part for a procession. The aisle is my width. The aisle is my height.',
        "One voice asks: ~~Won't you sing with us?~~",
      ],
      responses: [
        {
          label: 'no',
          desc: 'Firm.',
          lines: [
            'I say: no.',
            'The aisle closes without hurry. They go on. ~~They have learned to.~~ They have always had to.',
          ],
          scales: { chord: -2, self: +2 },
        },
        {
          label: 'one note',
          desc: 'Small concession.',
          lines: [
            'I give them one note, the smallest I own.',
            'The chord settles over it like a stamp coming down on wax. One note is an instalment. The schedule of the rest is theirs now.',
          ],
          scales: { voice: +2, chord: +1, self: -1 },
          composure: -1,
          composureCost: 'The minutes will record that one note was **volunteered**.',
        },
        {
          label: 'I came to take mine out',
          desc: 'Declare intent.',
          lines: [
            'I say: I came to take my voice out.',
            'The quiet that follows is total and instant, a trained quiet. No one has said that in this room. The room has no procedure for it, and a room without a procedure is only a room.',
          ],
          scales: { self: +3, chord: -3, recognition: +2 },
        },
      ],
    },
    {
      id: 'who_were_you',
      once: true,
      when: (p) => p.scales.recognition >= 5 && p.scales.self >= 5,
      prose: [
        'The chord drops to a single line. Many mouths, one sentence, no leader I can find.',
        'They ask: ~~Who were you, before us?~~',
      ],
      responses: [
        {
          label: 'Patient 0413',
          desc: 'Your number. Flatly.',
          lines: [
            'I say: Patient 0413. I came in this morning.',
            'The number goes through the rows like a name called in a waiting room. One voice stops humming. ~~Mine.~~ The one wearing mine.',
          ],
          scales: { self: +3, voice: -2, recognition: +1 },
        },
        {
          label: 'someone with a file',
          desc: 'Less specific.',
          lines: [
            'I say: someone with a file. Someone admitted.',
            'They accept it the way the desk accepts a form with one box blank — provisionally, with the blank box waiting.',
          ],
          scales: { recognition: +1, voice: +1, self: -1 },
          composure: -1,
          composureCost: 'A blank box, somewhere, has my width.',
        },
        {
          label: "I don't remember",
          desc: 'The truest answer.',
          lines: [
            "I say: I don't remember.",
            'The chord takes this kindly. ~~It has been here longer.~~ It has been me longer. It offers to remember on my behalf, the way the desk offers to hold valuables.',
          ],
          scales: { voice: +3, chord: +2, self: -2 },
          composure: -1,
          composureCost: 'It remembers me wrong by one detail. I cannot find the detail.',
        },
        {
          label: '[amnesia] I came in with no name',
          desc: 'The file goes all the way to the cover.',
          when: (_, player) => player.wound === 'amnesia',
          lines: [
            'I say: there was no before. I was admitted without identification.',
            'The chord goes quiet for one held bar. ~~They have never had a blank one.~~ They have been waiting for a blank one.',
            'A voice says: ~~that is the easiest kind to take.~~',
          ],
          scales: { voice: +2, chord: +2, self: -2 },
          composure: -2,
          composureCost: 'I have given them what I have no other use for.',
        },
        {
          label: '[insomnia] someone who could not sleep',
          desc: 'Identify by what kept me up.',
          when: (_, player) => player.wound === 'insomnia',
          lines: [
            'I say: someone who could not sleep. Someone the night kept open.',
            'The chord softens by a degree. The night ones are sung differently here — lower, with longer rests.',
            'They do not press. For the night ones, the pressing is left to the hours.',
          ],
          scales: { self: +1, voice: +1, recognition: +1 },
        },
        {
          label: '[split personality] one of two. The other is at home',
          desc: 'Withhold a half from the chord.',
          when: (_, player) => player.wound === 'split_personality',
          lines: [
            'I say: I am one of two. The other is at home in a chair you cannot reach.',
            'The chord recounts itself. ~~They have not had a doubled one.~~ They have, once. No one sings about her.',
            'A voice says: we will take the one in the room. Another voice says it again, the same words, one beat behind — a round, started on me.',
          ],
          scales: { self: +2, voice: -2, recognition: +1 },
          composure: -1,
          composureCost: 'I have offered them the half I came with.',
        },
      ],
    },
    {
      id: 'we_missed_you',
      once: true,
      when: (p) => p.scales.voice >= 3 && p.scales.self <= 6,
      prose: [
        'A single voice comes out of the chord, closer than the rows allow. It is at my ear. The rows have not moved.',
        'It says: ~~We missed you.~~ We never lost you.',
      ],
      responses: [
        {
          label: 'I missed you',
          desc: 'Echo.',
          lines: [
            'I say: I missed you.',
            'The chord opens around me like a door I do not remember knocking on. ~~I do not step forward.~~ The step has been taken with me in it.',
          ],
          scales: { voice: +3, chord: +2, self: -2 },
          composure: -2,
          composureCost: 'I answered in their tense.',
        },
        {
          label: 'I do not know you',
          desc: 'Refuse the claim.',
          lines: [
            'I say: I do not know you.',
            'The voice withdraws without hurt, the way a hand comes back from a door that did not open. The others continue. ~~The chord is poorer.~~ The chord is the same. That is worse.',
          ],
          scales: { self: +2, chord: -2, recognition: +1 },
        },
        {
          label: 'who am I',
          desc: 'Turn it around.',
          lines: [
            'I say: who am I, to you?',
            'The chord answers all at once, each voice a different word: daughter. Witness. Debt. The late one. 0413. The one who counts.',
            '!!I answer to more of them than I can afford.!!',
          ],
          scales: { recognition: +3, self: -1 },
          composure: -1,
          composureCost: 'Six names, and a hand going up in me for each.',
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.chord >= 6) {
      return {
        lines: [
          'I wait. The chord deepens. One singer rocks to a five-count. One walks her rounds between beds that are not there. One sits, dictating to a clerk the chord does not bother to provide.',
          'The choir has learned the whole hospital. The choir are singing it back, wing by wing.',
        ],
        scales: { self: -1, voice: +1, chord: +1 },
        composure: -1,
        composureCost: 'I have been here longer than I came in for.',
      };
    }
    return {
      lines: ['I wait. The choir hums under the failing tube. ~~One voice sounds like mine.~~ One voice is being saved for mine. There is a difference, and the difference is me.'],
      scales: { chord: +1, voice: +1 },
      composure: -1,
      composureCost: 'The hum is at my pitch whenever I stop listening for it.',
    };
  },

  endings: [
    {
      id: 'excised',
      when: (p) => p.flags.excised && p.scales.self >= 6,
      title: 'You take yourself out',
      lines: [
        'I leave with my voice where it belongs, behind my teeth. The chord is a note poorer. ~~I am poorer.~~ I am louder.',
        'The singing goes on behind me, full-sounding, the way it sounded before I learned the gap. It was never short of a voice. !!It was short of a yes.!!',
        'I take the stairs.',
      ],
      item: 'sliver_of_glass',
    },
    {
      id: 'shut_out',
      when: (p) => p.flags.shut_door && p.scales.self >= 5 && p.scales.voice <= 3,
      title: 'You shut the door',
      lines: [
        'I close it from the outside. An inch of door does what it can. Through the wood the chord is one note, knocking politely, like a radiator asking.',
        'I walk back the way I came. ~~A different corridor.~~ The same corridor.',
        'I leave my file at the desk. The nurse on duty takes it without looking up. There has always been a nurse I have not met.',
      ],
      item: 'ink_bottle',
    },
    {
      id: 'joined',
      when: (p) => p.scales.voice >= 8 && p.scales.self <= 2,
      title: 'You join them',
      lines: [
        'My voice is in the chord. The chord is full. Somewhere below, the boiler, the trolleys, the failing tube all come into tune with it.',
        '~~I am the one who came in.~~ We are the one who came in. The grammar settles over me like a sheet drawn up.',
        '!!The door is open. Someone outside is being admitted.!!',
      ],
      item: null,
      scars: ['collapsed'],
    },
    {
      id: 'outlasted',
      when: (p) => p.scales.self <= 0,
      title: 'The chord finishes you',
      lines: [
        'What is left of me is not enough to pull the door shut. The choir does not mark my going. ~~I was here.~~ The chord holds the place where here was.',
      ],
      item: null,
      scars: ['collapsed'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// THE MOTHER — Patient 0084
// ════════════════════════════════════════════════════════════════════════

const hollow = {
  id: 'hollow',
  name: '[The Mother]',
  glyph: 'Hollowoak',
  subtitle: 'She has been given several daughters.',
  role: 'wing', tier: 2,
  file: [
    'Subject was admitted [[6]] years prior. Subject continues to ~~claim whoever enters~~ recognize the daughter. The daughter is recorded as [[9]].',
    "**Volunteers** placed in Subject's room are ~~reassigned~~ withdrawn from the program. They answer to the wrong name for weeks after.",
    "When asked her own name, Subject gives the orderly's. !!The orderly has stopped contradicting her.!!",
  ],
  intro: [
    'She is at the door before I am through it, and her hand finds my arm above the elbow, where a mother holds. The chair by the window is already pulled out. The tea on the table is already at drinking heat.',
    'She says: there you are. The words go in under the sternum, like a hook cast years ago and only now drawn.',
  ],

  scales: {
    recognition: {
      initial: 0, min: 0, max: 10, label: 'recognition', kind: 'positive',
      bands: [
        { at: 0, word: 'looking past me' },
        { at: 2, word: 'searching my face' },
        { at: 5, word: 'half-knowing' },
        { at: 7, word: 'seeing me' },
        { at: 9, word: 'all the way here' },
      ],
      crossUp: {
        2: 'She has begun to read my face like a page — line by line, not all at once.',
        3: 'She sees me. Partly.',
        4: '!!She sees me. Not the daughter. The woman standing in the daughter\'s outline.!!',
      },
      crossDown: {
        1: 'Her eyes have left my face.',
      },
    },
    grief: {
      initial: 2, min: 0, max: 10, label: 'grief', kind: 'positive',
      bands: [
        { at: 0, word: 'composed' },
        { at: 2, word: 'stirring' },
        { at: 5, word: 'rising' },
        { at: 7, word: 'spilling' },
        { at: 9, word: 'released' },
      ],
      crossUp: {
        2: 'Her lips have begun to shape a name she has not said in a while.',
        3: 'Her face has gone somewhere older than the room. The room waits.',
        4: '!!The grief is up. It has been kept at drinking heat too.!!',
      },
      crossDown: {
        1: 'She has folded the grief away, the way you fold a thing you intend to take out again.',
      },
    },
    insistence: {
      initial: 6, min: 0, max: 10, label: 'insistence', kind: 'negative',
      bands: [
        { at: 0, word: 'separate' },
        { at: 3, word: 'claiming' },
        { at: 5, word: 'sure of me' },
        { at: 7, word: 'rooted' },
        { at: 9, word: 'unmovable' },
      ],
      crossUp: {
        3: 'Her grip on my arm has tightened.',
        4: '!!The decision is made. I am hers. There is no form on which to contest it.!!',
      },
      crossDown: {
        2: 'Her grip has eased by a finger.',
        1: 'She has stopped insisting.',
        0: 'She has let me go. The arm remembers the hand. The rest of me is mine.',
      },
    },
    panic: {
      initial: 1, min: 0, max: 10, label: 'panic', kind: 'negative',
      bands: [
        { at: 0, word: 'calm' },
        { at: 3, word: 'uneasy' },
        { at: 5, word: 'edged' },
        { at: 7, word: 'rising' },
        { at: 9, word: 'broken' },
      ],
      crossUp: {
        2: 'Her breath has gone short.',
        3: 'She has gone pale around the mouth.',
        4: '!!She is not in this room anymore. She is in the one where it happened.!!',
      },
      crossDown: {
        1: 'Her breath has settled.',
        0: 'She is calm. The kettle is on again. No one has filled it.',
      },
    },
  },
  initialize(p, player) {
    p.scales.insistence = r(6, 8);
    p.scales.grief = r(1, 3);
    p.scales.recognition = 0;
    p.scales.panic = r(1, 3);
    if (player.scars?.includes('named')) p.scales.insistence = Math.min(10, p.scales.insistence + 1);
  },

  fileReveals: [
    { announce: "A line fills in. Subject was admitted with her daughter. The daughter's admission was ~~brief~~ closed within the week." },
    { announce: 'Another. The room next door is held **vacant**. The bed in it is made nightly. No one is recorded as sleeping there.' },
    { announce: 'The last line writes itself in. When Subject is asked who she is, she answers with whoever is in the room. !!Today that is me.!!' },
  ],

  presented(p) {
    const i = p.scales.insistence;
    const re = p.scales.recognition;
    const g = p.scales.grief;
    const pa = p.scales.panic;
    let grip;
    if (i >= 8)      grip = 'Her hand is on my arm where it landed when I came in. It has not moved. It weighs nothing. It cannot be lifted.';
    else if (i >= 5) grip = 'She catches at my sleeve, often, without looking. The hand does the noticing for her.';
    else if (i >= 2) grip = 'Her grip has eased. Her hand stays within reach of my sleeve, the way a cup stays within reach of its saucer.';
    else             grip = 'She has let me go. She sits with herself.';
    let eyes;
    if (re >= 7)     eyes = 'Her eyes are on me, and they have me right: a stranger, my size, in her daughter\'s chair.';
    else if (re >= 4) eyes = 'Her eyes work my face the way hands work a key that almost fits the lock.';
    else if (pa >= 5) eyes = 'Her eyes make their circuit: door, window, door. She is counting exits, or arrivals.';
    else              eyes = 'Her eyes are on me without using me. The looking goes through to someone standing in my outline.';
    let mouth;
    if (g >= 7)      mouth = 'Her mouth is shaping a name she has not said in a long time.';
    else if (g >= 4) mouth = 'Her lips are moving without sound.';
    else             mouth = 'Her mouth is at rest. Everything about her is set out neatly, like a table laid for two.';
    return `${grip} ${eyes} ${mouth}`;
  },

  verbs: {

    let_her: {
      label: 'let her',
      desc: 'Be who she thinks you are. For a while.',
      respond(p) {
        const reps = streakCount(p, 'let_her');
        if (reps >= 3) {
          return {
            lines: [
              'I have been her daughter the better part of an hour. I have given her a week I did not live: the walk, the young man, the rain.',
              'She is glad in a way that takes. ~~I am tired.~~ I am less. The shape I am filling was kept warm for someone else, and it fits, and the fit is the cost.',
            ],
            scales: { insistence: +2, recognition: -1 },
            composure: -2,
            composureCost: 'Her hand has been on my arm so long it has a temperature I answer to.',
            scars: ['named'],
          };
        }
        if (p.scales.insistence >= 7) {
          return {
            lines: [
              'I let her tell me what I have been doing this week.',
              'I have been at school. I have been seeing a young man. I have been thinking of cutting my hair.',
              'She is glad for me. The gladness comes out fully made, like the tea. ~~She has been waiting to give it.~~ It was poured before I arrived.',
            ],
            scales: { grief: -1, insistence: +1 },
            composure: -1,
            composureCost: 'I have been her daughter a while now.',
          };
        }
        return {
          lines: [
            'I let the hand stay. I let the face be read.',
            'She calls me a pet name, soft with use. It is one letter off a name that would fit me. The letter sits in my ear all the same. ~~She was afraid I would not come.~~ She is afraid of the day I do not.',
          ],
          scales: { insistence: +1, panic: -1 },
        };
      },
    },

    sit_quietly: {
      label: 'sit quietly with her',
      desc: 'Not as anyone in particular. Just sit.',
      respond(p) {
        return {
          lines: [
            'I sit beside her — in the other chair, not the pulled-out one. A person, present, unassigned.',
            p.scales.recognition >= 3
              ? 'She looks at me sidelong, and lets the chair by the window stay empty. It is the heaviest thing she has lifted today.'
              : 'Her hand crosses to my sleeve anyway, on its own errand.',
          ],
          scales: { recognition: +2, insistence: -1, panic: -1 },
        };
      },
    },

    correct_her: {
      label: 'correct her',
      desc: 'Say: I am not her.',
      when: (p) => p.scales.recognition >= 3,
      respond(p) {
        const reps = streakCount(p, 'correct_her');
        if (reps >= 1) {
          return {
            lines: [
              'I say it again. ~~She does not hear it.~~ She declines it, the way a hand declines change from a tray.',
              'She lets go of my arm and presses two fingers to her own wrist, taking the pulse of something. Her breath has changed registers.',
            ],
            scales: { panic: +3, recognition: -1 },
            composure: -2,
            composureCost: 'Twice now. The second no costs double.',
          };
        }
        if (p.scales.recognition >= 6) {
          return {
            lines: [
              'I say: I am not your daughter.',
              'She looks at me a long time. She does not argue. She lets go of my arm.',
              'She says: ~~I knew that.~~ I knew that.',
              'She sits down. The chair is too big for her, all at once, the way chairs are too big for children.',
            ],
            scales: { insistence: -4, recognition: +3, grief: +2 },
            composure: -1,
            composureCost: '!!I have unmade her daughter in front of her.!!',
          };
        }
        return {
          lines: [
            'I say: I am not your daughter.',
            'She hears it the way you hear weather through a window: noted, irrelevant to the room.',
            'Her grip does not move. The fact has been received and filed under nothing.',
          ],
          scales: { recognition: +1, panic: +2 },
          composure: -1,
          composureCost: 'I told the truth and the room absorbed it like a spill.',
        };
      },
    },

    ask_about_her: {
      label: 'ask about her',
      desc: 'Ask: what was she like? And listen.',
      when: (p) => p.scales.insistence <= 7,
      respond(p) {
        const reps = streakCount(p, 'ask_about_her');
        if (reps >= 1) {
          return {
            lines: [
              'I ask another, and another. She hands me details one at a time, the way you hand someone china: a knee scar shaped like a comma. A coat with one toggle gone. A way of standing in doorways.',
              'Between us, on the table, a person is being set out.',
            ],
            scales: { grief: +2, recognition: +1 },
          };
        }
        return {
          lines: [
            'I ask: what was she like?',
            'She answers at length, and the length is the point: every minute of the telling is a minute the daughter is at the table.',
            'At the end she says a name. ~~The name.~~ A name.',
            'I write it down. I will keep it.',
          ],
          scales: { grief: +3, recognition: +2, insistence: -1 },
        };
      },
    },

    say_her_name: {
      label: 'say her name',
      desc: 'Use her own. The one on her file.',
      when: (p) => p.scales.recognition >= 4,
      respond(p, player) {
        const r_ = player.items?.includes('scrap_of_paper');
        if (r_) {
          return {
            lines: [
              'I say her name — her own, from the spine of her file. ~~I have practiced it.~~ I have carried it folded in the chest pocket. It lands like a parcel she had stopped expecting.',
              'She answers: yes? She says it not as a question.',
              '!!Her grip on my arm gives way.!!',
            ],
            scales: { recognition: +3, insistence: -2 },
          };
        }
        return {
          lines: [
            'I say her name. Her own, the one on the file, worn from disuse like a coin kept in a drawer.',
            p.scales.recognition >= 5
              ? 'She answers: yes? She says it like a question she had stopped asking.'
              : 'She frowns at the name, holding it to the light, deciding whether it is hers or belongs to a woman she once stood next to.',
          ],
          scales: { recognition: +2, insistence: -1, panic: +1 },
        };
      },
    },

    write_the_name: {
      label: "write the daughter's name",
      desc: 'In your file. So that someone will keep it.',
      when: (p) => p.scales.grief >= 6 && p.scales.recognition >= 5,
      respond() {
        return {
          lines: [
            'I write the name into my own file, in the space the page leaves me. ~~Because she asked.~~ She did not ask. That is why.',
            'She watches the pen the whole way. She does not stop me. She checks the spelling over my shoulder, once, with one nod.',
            '!!The name is on paper that leaves this room.!!',
          ],
          scales: { grief: +2, recognition: +2, insistence: -1 },
          flags: { kept_name: true },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Let her talk. The tea stays at drinking heat. It always does.',
    when: (p) => p.scales.insistence >= 6 || p.turn >= 4,
  },

  interjections: [
    {
      id: 'tell_me_about_yourself',
      once: true,
      when: (p) => p.scales.recognition >= 4 && p.scales.insistence <= 6,
      prose: [
        'She has stopped mid-story. Her eyes come up from the tea to my face, careful, the way you look up from a letter to check the person against it.',
        'She asks: ~~Tell me about yourself.~~',
      ],
      responses: [
        {
          label: 'I came in this morning',
          desc: 'Plant yourself in the present.',
          lines: [
            'I tell her: I came in this morning. I was found at the front entrance.',
            'She takes it in slowly, stirring it into what she already has.',
            'She says: yes. Yes, I remember now.',
          ],
          scales: { recognition: +3, insistence: -2 },
        },
        {
          label: "I don't know",
          desc: 'Meet her where she is.',
          lines: [
            "I say: I don't know.",
            'She nods, slowly, and pats my hand. It is the first thing I have said that she has believed all the way through.',
          ],
          scales: { recognition: +2, grief: +3 },
        },
        {
          label: 'tell me first',
          desc: 'Turn it around.',
          lines: [
            'I say: tell me first. Who are you?',
            'She is quiet a long time. Then she says her own name, in two pieces, checking each piece against the other. ~~She has not said it in a while.~~ It has not been said to her in longer.',
          ],
          scales: { recognition: +4, insistence: -3, grief: +1 },
        },
        {
          label: '[amnesia] I came in without identification',
          desc: 'Hand her the cover of my file.',
          when: (_, player) => player.wound === 'amnesia',
          lines: [
            'I say: I cannot. I came in without identification, without anyone with me.',
            'She holds it. Her face softens at the blank where a name should be. She knows the blank. She keeps one made up in the next room.',
            'She says: ~~then we are both starting over.~~',
          ],
          scales: { recognition: +2, insistence: -2, grief: +1 },
        },
        {
          label: '[insomnia] I have not slept in days',
          desc: 'Trade her my watch for hers.',
          when: (_, player) => player.wound === 'insomnia',
          lines: [
            'I say: I have not slept in days. There is not much left to tell.',
            'She takes my hand, briefly, and turns it over, reading the palm for tiredness.',
            '~~Mothers do not sleep.~~ Mothers wait up. She is still waiting up.',
          ],
          scales: { recognition: +2, insistence: -1, grief: +2 },
        },
        {
          label: '[split personality] there are two of me',
          desc: 'Offer her the half she did not get back.',
          when: (_, player) => player.wound === 'split_personality',
          lines: [
            'I say: there are two of me. One is here. The other is still at home.',
            'She goes very still. ~~She will not ask which one I am.~~ She has already set a place for both.',
            'She says: ~~stay anyway.~~',
          ],
          scales: { recognition: +1, insistence: -3, grief: +3 },
          composure: -1,
          composureCost: 'There are two cups on the table now. I watched her pour neither.',
        },
      ],
    },

    {
      id: 'do_you_have_to_go',
      once: true,
      when: (p) => p.scales.panic >= 5 && p.scales.insistence >= 5,
      prose: [
        'A trolley passes in the corridor. Her grip arrives on my arm before the sound does.',
        'She asks: ~~Do you have to go?~~',
      ],
      responses: [
        {
          label: "I'll stay",
          desc: 'Commit.',
          lines: [
            "I say: I'll stay.",
            'Her grip eases. Somewhere behind me a kettle comes off the boil. No one has filled one.',
          ],
          scales: { panic: -4, insistence: +1 },
          composure: -1,
          composureCost: 'Stay has a length here. It is not mine to set.',
        },
        {
          label: "I'll come back",
          desc: 'A kinder lie.',
          lines: [
            "I say: I have to go. But I'll come back. ~~I will not.~~ Tomorrow.",
            'She nods. Tomorrow is a word she has long experience of holding. She lets go of my arm one finger at a time.',
          ],
          scales: { panic: -2, insistence: -2 },
          scars: ['named'],
        },
        {
          label: "you'll be alright",
          desc: 'Gentle. Honest.',
          lines: [
            "I say: you'll be alright.",
            'She looks at the pulled-out chair, then at me. She does not stop me. The chair stays pulled out.',
          ],
          scales: { panic: -1, recognition: +1 },
        },
      ],
    },

    {
      id: 'were_you_there',
      once: true,
      when: (p) => p.scales.grief >= 6 && p.scales.recognition >= 4,
      prose: [
        'Her face goes still over the cup. Her thumb finds her ring and turns it, once, the way you wind a small clock.',
        'She asks me: ~~Were you at the funeral?~~',
      ],
      responses: [
        {
          label: 'I was',
          desc: 'Tell her yes.',
          lines: [
            'I say: I was. I was there.',
            'She nods. You wore the grey coat, she says. I have never owned a grey coat. I find myself certain of its buttons.',
          ],
          scales: { grief: +3, recognition: +1, insistence: -1 },
          composure: -1,
          composureCost: 'I am borrowing a summer that was not mine.',
        },
        {
          label: "I wasn't",
          desc: 'Tell her no.',
          lines: [
            "I say: I wasn't.",
            'She is quiet. Then: no, she says. No one was. It rained, and the cars came late. She gives it like a timetable. Her grip does not move.',
          ],
          scales: { grief: +2, panic: +1, insistence: -1 },
        },
        {
          label: 'tell me about it',
          desc: 'Open it.',
          lines: [
            'I say: tell me about it.',
            'She does. The wrong hymn. The vicar with the stress on the wrong half of the name. A coffin you could carry one-armed. ~~She has never said it aloud.~~ She has said it nightly, to the room next door.',
          ],
          scales: { grief: +3, recognition: +2 },
          composure: -1,
          composureCost: 'A coffin you could carry one-armed. I will keep the measurement.',
        },
      ],
    },

    {
      id: 'she_was_so_small',
      once: true,
      when: (p) => p.scales.grief >= 5 && p.scales.insistence <= 6,
      prose: [
        'She has gone very still. Her arms have moved into a curve without her, around a weight the room does not contain.',
        'She says, ~~to me~~ mostly to herself: ~~She was so small. I held her in one arm.~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'Just stay there with it.',
          lines: [
            'I say: yes. She was small.',
            'She breathes out. The curve of her arms eases, as if something in them had been set down gently.',
          ],
          scales: { grief: +3, recognition: +1, insistence: -2 },
          composure: -1,
          composureCost: 'My own arms made the curve back. I did not instruct them.',
        },
        {
          label: 'how small',
          desc: 'Invite the detail.',
          lines: [
            'I ask: how small?',
            'She measures a shape into the air, careful and exact. She names a weight. She names a length.',
            'Six pounds, eleven ounces. Nineteen inches. The numbers stand in the air where the shape was.',
          ],
          scales: { grief: +3, recognition: +2 },
          composure: -1,
          composureCost: 'I wrote the numbers down. Someone had to be holding them.',
        },
        {
          label: 'change the subject',
          desc: 'Spare her.',
          lines: [
            'I look at the clock and ask about tea. There is tea in front of me already. There has been tea in front of me since before I sat down.',
            'She does not answer. Her arms hold their curve a moment longer, then remember the table. ~~She had more.~~ She had all of it.',
          ],
          scales: { grief: -2, insistence: +2, panic: +1 },
          composure: -1,
          composureCost: 'The tea was at drinking heat. It is always at drinking heat. I drank it anyway.',
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.insistence >= 7) {
      return {
        lines: [
          'I wait. She tells me about my eighth birthday: the cake with the lemon icing, the dress with the wrong sleeves, how I cried and would not say why.',
          '~~I remember it.~~ I was not there. Somewhere in me, the lemon icing has a taste.',
        ],
        scales: { insistence: +1 },
        composure: -1,
        composureCost: 'The icing was lemon. I know it was lemon. I was not there.',
      };
    }
    if (p.scales.recognition >= 4) {
      return {
        lines: [
          'I wait. She is quiet, and she watches my face the way you watch a window at dusk — for the room behind it, not the glass.',
        ],
        scales: { recognition: +1, grief: +1 },
      };
    }
    return {
      lines: ['I wait. She hums to herself, a tune with a gap in it where a child\'s part would answer. She leaves the gap open every time it comes around.'],
      scales: { grief: +1, insistence: +1 },
    };
  },

  endings: [
    {
      id: 'her_name_kept',
      when: (p) => p.flags.kept_name && p.scales.grief >= 8 && p.scales.recognition >= 6,
      title: "You keep her daughter's name",
      lines: [
        'The name leaves the room in my file, in my hand. I will say it to people who are paid to know it, and to some who are not.',
        '~~It is mine.~~ It is hers. It is mine to carry.',
      ],
      item: 'scrap_of_paper',
    },
    {
      id: 'truth_told',
      when: (p) => p.scales.recognition >= 9 && p.scales.grief >= 5,
      title: 'You tell her the truth',
      lines: [
        'She has heard me. She has known a while — the way you know a clock is wrong and thank it anyway.',
        'She says her own name aloud, once, softly, and sets it on the table between us like a cup returned to its saucer.',
      ],
      item: 'ink_bottle',
    },
    {
      id: 'i_am_her',
      when: (p) => p.scales.insistence >= 10 && p.scales.recognition <= 3,
      title: 'You are her, for as long as it takes',
      lines: [
        'I let her give me the history entire: the school, the young man, the haircut I am still deciding on. I am going to do very well. She has always known I would.',
        '!!She is at peace.!! She has not been at peace since.',
        'I leave the room with the things she has given me. ~~They are not mine.~~ They are mine now.',
      ],
      item: 'photograph',
      scars: ['named'],
    },
    {
      id: 'panicked',
      when: (p) => p.scales.panic >= 9,
      title: 'You lose her',
      lines: [
        'Her face has shut like a house at bad news. Whoever she sees now, it is no one who can help her, and it is wearing my coat.',
        '!!I leave. The chair stays pulled out behind me.!!',
      ],
      item: null,
      scars: ['witnessed', 'failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: ['I close the door. Through it she is still calling me in. ~~My name.~~ Her daughter\'s name. From the corridor, the difference is one letter.'],
      item: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// THE POND — Patient 0212
// ════════════════════════════════════════════════════════════════════════

const mire = {
  id: 'mire',
  name: '[The Pond]',
  glyph: 'Mireling',
  subtitle: 'There is no pond on the grounds.',
  role: 'wing', tier: 2,
  file: [
    'Subject persists in asking after the pond. There is no pond on the grounds. The grounds have been walked.',
    'Subject describes a ~~stone~~ statue at the edge, of the right size. The absence of any pond is restated for the file. The grounds have been walked twice.',
    'Family report Subject placed [[11]] in a pond. !!The room is mopped on the hour. The water is recorded as condensation. The hospital wishes it noted, formally, that there is no pond.!!',
  ],
  intro: [
    'The wet on the floor begins at the door as a film and deepens toward the far wall by even degrees, like the painted markings on a lock gate. I read it the way you read depth. Shallow end. Deep end.',
    'She is at the deep end, facing the wall. She does not turn. She is asking the wall, politely, the way one asks staff:',
    'Where is the pond. You know the one. The one with the statue.',
  ],

  scales: {
    recognition: {
      initial: 0, min: 0, max: 10, label: 'recognition', kind: 'positive',
      bands: [
        { at: 0, word: 'elsewhere' },
        { at: 2, word: 'sidelong' },
        { at: 5, word: 'half-here' },
        { at: 7, word: 'with me' },
        { at: 9, word: 'all here' },
      ],
      crossUp: {
        2: 'Her eyes have left the wall.',
        3: 'She has turned. Partly.',
        4: '!!She has turned all the way. The wall is just a wall behind her.!!',
      },
      crossDown: { 1: 'Her eyes have gone back to the wall.' },
    },
    release: {
      initial: 0, min: 0, max: 10, label: 'release', kind: 'positive',
      bands: [
        { at: 0, word: 'silent' },
        { at: 2, word: 'circling' },
        { at: 5, word: 'speaking around it' },
        { at: 7, word: 'naming it' },
        { at: 9, word: 'let go' },
      ],
      crossUp: {
        2: 'Words are surfacing, one at a time, in the order drowned things surface.',
        3: 'The words are coming up faster than she can stop them.',
        4: '!!She is speaking around it in smaller and smaller circles.!!',
      },
      crossDown: { 1: 'The words have gone back under.' },
    },
    approach: {
      initial: 0, min: 0, max: 10, label: 'approach', kind: 'negative',
      bands: [
        { at: 0, word: 'far wall' },
        { at: 3, word: 'stepping' },
        { at: 5, word: 'between me and the door' },
        { at: 7, word: "arm's length" },
        { at: 9, word: 'on me' },
      ],
      crossUp: {
        3: 'She has crossed half the room.',
        4: '!!She is on me. Her hand is on my collar.!!',
      },
      crossDown: {
        2: 'She has stepped back.',
        1: 'She has gone back to the wall.',
      },
    },
    pond: {
      initial: 2, min: 0, max: 10, label: 'pond', kind: 'negative',
      bands: [
        { at: 0, word: 'dry floor' },
        { at: 3, word: 'damp' },
        { at: 5, word: 'wet' },
        { at: 7, word: 'ankle-deep' },
        { at: 9, word: 'submerging' },
      ],
      crossUp: {
        2: 'The damp has crossed the room\'s halfway line. I had marked the line by a tile.',
        3: '!!The wet has reached my shoes. My reflection has arrived in it, half a second late.!!',
        4: '!!I am in to the ankles. The room has a deep end now, and she is standing in it.!!',
      },
      crossDown: {
        2: 'The floor has gone back to being a floor.',
        1: 'The carpet is drying from the door inward.',
        0: 'The room is a room again.',
      },
    },
  },
  initialize(p, player) {
    p.scales.approach = 0;
    p.scales.pond = r(2, 4);
    p.scales.recognition = 0;
    p.scales.release = 0;
    if (player?.scars?.includes('taken')) p.scales.approach = Math.min(10, p.scales.approach + 1);
    if (player?.scars?.includes('named')) p.scales.approach = Math.min(10, p.scales.approach + 1);
  },

  fileReveals: [
    { announce: 'A line fills in. The grounds were surveyed on [[8]]. The survey found no pond. The surveyor asked not to be sent again.' },
    { announce: 'Another. The statue is ~~a child~~ not on file. It is of the right size. The file does not say for what.' },
    { announce: 'The last line writes itself in. What she placed in the pond is entered as [[11]]. The bar lies flat on the page, like still water.' },
  ],

  presented(p) {
    const a = p.scales.approach;
    const pd = p.scales.pond;
    const re = p.scales.recognition;
    const rl = p.scales.release;
    let dist;
    if (a >= 8)      dist = '!!She is in front of me, her hand closed on my collar, her face an inch from mine and not one drop on it.!!';
    else if (a >= 5) dist = 'She has crossed half the room. She is between me and the door now.';
    else if (a >= 2) dist = 'She has come up the gradient toward me, out of the deep end, without one sound of wading.';
    else             dist = 'She is at the far wall. She is asking the wall.';
    let water;
    if (pd >= 7)     water = 'The water is at my ankles, colder at the left one. The room has a current, and the current runs toward her.';
    else if (pd >= 4) water = 'The floor is wet enough to hold reflections. Mine moves a half-beat behind me. Hers moves first.';
    else if (pd >= 1) water = 'The floor is damp in a gradient I can read like depth markings: a film at the door, a sheen at the middle, a shine at her feet.';
    else             water = 'The floor is dry. I check it twice, the second time with my palm.';
    let eyes;
    if (re >= 5)     eyes = 'She has turned. Her eyes rest on me with the patience of water finding its level.';
    else if (rl >= 4) eyes = 'She has said something she had not said before. She will not look at me.';
    else if (a >= 3) eyes = 'She is looking at me, sidelong.';
    else             eyes = 'She is asking the wall about the pond. She has not turned.';
    return `${dist} ${water} ${eyes}`;
  },

  verbs: {

    answer_about_pond: {
      label: 'answer her',
      desc: 'Tell her where the pond is. ~~Or where it was.~~',
      respond(p) {
        const reps = streakCount(p, 'answer_about_pond');
        if (reps >= 2) {
          return {
            lines: [
              'I keep answering. Every answer is a bucketful. The pond is being filled from my side of the room.',
              'The gradient has steepened. The deep end is wider than it was, and her face is nearer than her feet account for.',
            ],
            scales: { approach: +2, pond: +2 },
            composure: -1,
            composureCost: 'I am building it for her, answer by answer.',
          };
        }
        if (p.scales.pond <= 3) {
          return {
            lines: [
              'I say: it is out by the east lawn. The one with the statue.',
              'She nods slowly. She does not turn. But the room dries by a degree.',
              'Her advance stops. The room holds at damp.',
            ],
            scales: { pond: +1, recognition: +1 },
          };
        }
        return {
          lines: [
            'I say: it is out by the east lawn.',
            'She answers, without turning: !!I have been there. I have been there recently.!!',
            'She takes a step closer. In the wet, her reflection took it before her.',
          ],
          scales: { approach: +1, pond: +1 },
        };
      },
    },

    bar_the_door: {
      label: 'stand by the door',
      desc: 'Close yourself off from the room. Wait it out.',
      respond(p) {
        const reps = streakCount(p, 'bar_the_door');
        if (reps >= 1) {
          return {
            lines: [
              'I hold the door. She has stopped advancing. The water has not. It comes on at the pace of a tide with an appointment.',
            ],
            scales: { approach: -1, pond: +1 },
            composure: -2,
            composureCost: 'The room is wetter than the corridor. By a degree.',
          };
        }
        return {
          lines: [
            'I move to the door. I put my back to it.',
            'She stops mid-step. The shine at her feet keeps coming a yard farther, then settles, like wake catching up to a stopped boat.',
          ],
          scales: { approach: -2, recognition: +1 },
          composure: -1,
          composureCost: 'The door behind me is warm. ~~The corridor is not.~~',
        };
      },
    },

    ask_about_statue: {
      label: 'ask about the statue',
      desc: 'What was at the edge of the pond? A stone? A person?',
      when: (p) => p.scales.pond >= 3,
      respond(p, player) {
        const r_ = player.items?.includes('scrap_of_paper');
        if (r_) {
          return {
            lines: [
              'I ask. But I already half-remember it. I say what I remember, and let her correct me.',
              'She corrects me, gently, the way you straighten a picture in someone else\'s house. ~~It is a person.~~ It is the size of a person who had only just stopped being carried.',
              'She says the name. !!She says the name.!!',
            ],
            scales: { release: +3, pond: +1, recognition: +1 },
            composure: -1,
            composureCost: '!!I have answered her too well.!!',
          };
        }
        if (p.scales.pond >= 5) {
          return {
            lines: [
              'I ask: what does the statue look like?',
              'She describes it: the folded hands, the pleated coat the rain has rounded, the face the moss has been kind to. ~~It is a person.~~ It is of the right size.',
              'Her voice breaks at the end. She does not turn.',
            ],
            scales: { release: +2, pond: +1 },
          };
        }
        return {
          lines: [
            'I ask: what does the statue look like?',
            'She pauses a long time. Whatever she is reaching for is at the bottom of something.',
          ],
          scales: { pond: +1, recognition: +1 },
        };
      },
    },

    ask_what_she_put_in: {
      label: 'ask what she put in',
      desc: 'Gently. What did she put in the pond?',
      when: (p) => p.scales.pond >= 5 && p.scales.recognition >= 2,
      respond(p) {
        if (p.scales.pond <= 5) {
          return {
            lines: [
              'I ask: what did you put in the pond.',
              'She does not answer. She does not turn. But she stops asking about the pond.',
              'We are quiet a long time. In the corridor, on the hour, a mop bucket is set down.',
            ],
            scales: { release: +2, approach: -1, pond: -1 },
          };
        }
        return {
          lines: [
            'I ask: what did you put in the pond.',
            'She is silent. She does not turn. She has pressed herself flat against the wall.',
            'After a long time she says: I put in [[9]]. The bar lies on the page where the word went under.',
            '!!She said it whole. The page would not hold it.!!',
          ],
          scales: { release: +3, pond: +1, recognition: +1 },
          composure: -1,
          composureCost: 'The bar is nine characters wide. I counted. I should not have counted.',
        };
      },
    },

    turn_her_around: {
      label: 'turn her around',
      desc: 'Gently. Take her by the wrist.',
      when: (p) => p.scales.recognition >= 2 && p.scales.approach <= 4,
      respond() {
        return {
          lines: [
            'I take her by the wrist. I turn her around slowly. She lets me.',
            'She comes around the way a boat comes around — slow, the stern swinging wide. Her eyes are very tired. They hold mine and do not go back to the wall.',
          ],
          scales: { recognition: +3, pond: -1 },
          composure: -1,
          composureCost: 'Her wrist was cold, and the cold had a direction.',
        };
      },
    },

    dry_a_corner: {
      label: 'dry a corner',
      desc: 'Pretend the water is yours to deal with. Towels.',
      when: (p) => p.scales.pond >= 4,
      respond() {
        return {
          lines: [
            'I find a towel folded on the radiator, waiting, stamped Ward II. I dry the corner by the door.',
            'The corner becomes shallow end again. She watches me work the way you watch someone bail a sea.',
          ],
          scales: { pond: -2, recognition: +1, approach: -1 },
        };
      },
    },

    sit_on_the_wet: {
      label: 'sit on the wet floor',
      desc: 'Be in the pond with her.',
      when: (p) => p.scales.pond >= 6 && p.scales.release >= 3,
      respond() {
        return {
          lines: [
            'I sit down on the wet floor. My coat soaks through immediately.',
            'She turns. All the way. She wades up the gradient and sits beside her own reflection, beside me, and the water settles around the two of us at one level. ~~We are in the same room.~~ We are in the same pond.',
          ],
          scales: { recognition: +3, release: +2, approach: -2 },
          composure: -2,
          composureCost: 'My coat will dry. I will be carrying the waterline a while.',
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Let her ask the wall. The water keeps its own minutes.',
    when: (p) => p.scales.approach >= 3 || p.scales.pond >= 5 || p.turn >= 4,
  },

  interjections: [
    {
      id: 'do_you_remember_him',
      once: true,
      when: (p) => p.scales.pond >= 5 && p.scales.recognition >= 2,
      prose: [
        'She has stopped asking the wall. She has not turned, but her shoulders have come down, the way water goes still before a thing surfaces.',
        'She asks the wall: ~~Do you remember him?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'Pretend you do.',
          lines: [
            'I say: yes.',
            'She steps back from the wall. In the wet, her reflection stays at the wall a moment before following. ~~She is grateful.~~ She is borrowing.',
          ],
          scales: { release: +2, approach: +1, recognition: +2 },
          scars: ['named'],
        },
        {
          label: "I don't know him",
          desc: 'Honest.',
          lines: [
            "I say: I don't know him.",
            'She does not answer. Then, to the wall: ~~No one does anymore.~~',
          ],
          scales: { release: +3, pond: +1 },
          composure: -1,
          composureCost: 'The damp has reached the second tile. I am keeping count.',
        },
        {
          label: 'tell me about him',
          desc: "Invite. Don't claim.",
          lines: [
            'I say: tell me about him.',
            'She does. For a long time. ~~Some of it is happy.~~ Some of it is.',
            'At the end she gives me his name. It is dry. It is the only dry thing in the room.',
          ],
          scales: { release: +3, recognition: +2 },
        },
        {
          label: '[amnesia] I do not remember anyone',
          desc: 'The truth I came in with.',
          when: (_, player) => player.wound === 'amnesia',
          lines: [
            'I say: I do not remember anyone. I came in without anyone with me.',
            'She faces the wall again. ~~She is angry.~~ She is not angry.',
            'She says: ~~no one does anymore.~~',
          ],
          scales: { release: +2, recognition: +1, pond: +1 },
        },
        {
          label: '[insomnia] I have not slept enough to remember',
          desc: 'Thin the answer.',
          when: (_, player) => player.wound === 'insomnia',
          lines: [
            'I say: I have not slept enough. The faces have gone soft.',
            'She nods at the wall. ~~Hers have too.~~ One has not.',
            'After a while she takes a step away from it.',
          ],
          scales: { release: +2, approach: +1, recognition: +1 },
        },
        {
          label: '[split personality] one of me does. The one at home',
          desc: 'Send her to the wrong house.',
          when: (_, player) => player.wound === 'split_personality',
          lines: [
            'I say: one of me does. The one still at the house.',
            'She is quiet. Then she turns. ~~For the first time tonight.~~',
            'She says: ~~then you can tell me where he is.~~',
          ],
          scales: { release: +1, approach: +2, recognition: +1, pond: +1 },
          composure: -1,
          composureCost: 'I have given her an address that is not mine.',
        },
      ],
    },

    {
      id: 'are_you_going_to_stop_me',
      once: true,
      when: (p) => p.scales.approach >= 5 && p.turn >= 3,
      prose: [
        'She has crossed half the room and stopped, at the middle depth. She looks at me full on, for the first time. The water stills around her ankles, waiting on the answer too.',
        'She asks: ~~Are you going to stop me?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'Commit to standing between her and it.',
          lines: [
            'I say: yes.',
            'She lets out a long breath. She sits down on the wet floor. Thank god, she says.',
          ],
          scales: { approach: -5, recognition: +3, release: +1 },
          composure: -1,
          composureCost: 'The water has not gone anywhere. ~~It is patient.~~',
        },
        {
          label: 'no',
          desc: 'Do not stand in her way.',
          lines: [
            'I say: no. I am not going to stop you.',
            'She looks at me a long time. She does not move.',
            'Then she walks back to the deep end. ~~She did not want to go.~~ She wanted to be kept.',
          ],
          scales: { approach: -3, recognition: +2, pond: +1 },
          composure: -1,
          composureCost: '!!Nobody stood in her way the first time either.!!',
        },
        {
          label: "I can't",
          desc: 'Honest.',
          lines: [
            "I say: I can't. But I am here.",
            'She nods. She sits down where she is, at middle depth, her skirt going dark around her in a circle.',
          ],
          scales: { approach: -4, release: +2, recognition: +2 },
        },
      ],
    },

    {
      id: 'whats_at_the_bottom',
      once: true,
      when: (p) => p.scales.pond >= 6 && p.scales.release >= 3,
      prose: [
        'Her shoulders are very still — the stillness of a surface that knows it is about to be looked into.',
        'She asks the floor: ~~What is at the bottom of the pond?~~',
      ],
      responses: [
        {
          label: 'something heavy',
          desc: 'Meet her where she is.',
          lines: [
            'I say: something heavy.',
            'She nods. Heavy is a measurement she has kept exact for forty years.',
          ],
          scales: { release: +3, recognition: +1, pond: +1 },
          composure: -1,
          composureCost: 'The carpet is gone under me.',
        },
        {
          label: "I don't know",
          desc: 'Do not name it.',
          lines: [
            "I say: I don't know.",
            'She nods. ~~She wanted an answer.~~ She wanted the question to stay a question. I have kept it one.',
          ],
          scales: { release: +1, recognition: +1, pond: -1 },
        },
        {
          label: 'a person',
          desc: 'Name it.',
          lines: [
            'I say: a person.',
            'The room goes quiet to its corners. ~~She has not let anyone say it.~~ No one has tried it to her face.',
            '!!She does not deny it.!!',
          ],
          scales: { release: +4, recognition: +2, pond: +2 },
          composure: -2,
          composureCost: 'The word is in the room now. The water rose to meet it.',
        },
      ],
    },

    {
      id: 'I_didnt_mean_it',
      once: true,
      when: (p) => p.scales.release >= 5 && p.scales.recognition >= 3,
      prose: [
        'She has turned slightly. She is looking at her own sleeves where the water has darkened them.',
        "She says: ~~I didn't mean to.~~",
      ],
      responses: [
        {
          label: 'I know',
          desc: 'Simple.',
          lines: [
            'I say: I know.',
            'She nods, twice, the second time to herself. ~~She has not been told that.~~ She has not let anyone near enough to tell her.',
          ],
          scales: { release: +3, recognition: +2, pond: -1 },
        },
        {
          label: 'tell me what happened',
          desc: 'Invite.',
          lines: [
            'I say: tell me what happened.',
            'She does. Some of it. The story has a surface, and she stays above it, and what is below stays below.',
          ],
          scales: { release: +3, recognition: +2 },
          composure: -1,
          composureCost: 'The story has a surface. I did not break it.',
        },
        {
          label: "it doesn't matter",
          desc: 'Do not require the story.',
          lines: [
            "I say: it doesn't matter what you meant.",
            'She looks at me. She does not agree. But she does not turn back to the wall.',
          ],
          scales: { recognition: +2, release: -1, pond: +1 },
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.approach >= 4) {
      return {
        lines: [
          'I wait. She takes another step up the gradient. The waterline on my shoes has a new high mark. I keep the marks the way a lock-keeper keeps them.',
        ],
        scales: { approach: +1, pond: +1 },
        composure: -1,
        composureCost: 'The room is wetter than the corridor. By a degree.',
      };
    }
    return {
      lines: [
        'I wait. She asks the wall again, with the patience of someone who has learned that walls outlast staff. The shine at her feet has gained a tile.',
      ],
      scales: { pond: +1, approach: +1 },
      composure: -1,
      composureCost: 'My shoes are taking on water. ~~The pond was about this size.~~',
    };
  },

  endings: [
    {
      id: 'pond_acknowledged',
      when: (p) => p.scales.release >= 8 && p.scales.recognition >= 7,
      title: 'You let her say it',
      lines: [
        'We sit on the wet floor a long time. She does not ask about the pond again.',
        'She gives me the name of what she put in. On this page it reads [[9]]. !!That is not her doing. She said it whole.!!',
        'I take it with me.',
      ],
      item: 'small_bell',
    },
    {
      id: 'denial_held',
      when: (p) => p.scales.pond <= 1 && p.scales.recognition >= 6,
      title: 'You hold the room from her',
      lines: [
        'She has not turned. The floor has dried to a film, then to a floor. There is no pond on the grounds. The file says so three times, each time more formally.',
        'She does not look at me when I leave. But the room is a room.',
      ],
      item: 'worn_ribbon',
    },
    {
      id: 'weight_named',
      when: (p) => p.scales.release >= 9 && p.scales.pond >= 5,
      title: 'She names the weight',
      lines: [
        '!!She names it. The name goes into me and not onto the page. The page gets the bar.!!',
        'I take it from her. She lets it go the way you let go of a railing. ~~I have a thing now I did not come in with.~~ I am heavier by exactly its weight.',
      ],
      item: 'scrap_of_paper',
      scars: ['witnessed'],
    },
    {
      id: 'pulled_in',
      when: (p) => p.scales.approach >= 9,
      title: 'She takes you to the pond',
      lines: [
        'Her hand on my collar. The floor opens.',
        '!!I do not know what was at the bottom. I do not know whose name she spoke as I went under.!!',
      ],
      item: null,
      scars: ['witnessed', 'collapsed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: ['I leave the room. The corridor is dry. My shoes print the terrazzo for eleven steps, and then I am dry too, as far as anyone can see.'],
      item: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// COMPOSER — Halowyrm in a different room
// ════════════════════════════════════════════════════════════════════════
//
//   silence    (positive) — your contribution. she composes in your quiet
//   completion (positive) — the chord's readiness to finish
//   chord      (negative) — notes stacking in the air; if it lands without
//                          you ready, it's a release without grace
//   tension    (negative) — the room's musical pressure

const composer = {
  id: 'composer',
  name: '[The Composer]',
  glyph: 'Halowyrm',
  subtitle: 'She is composing the room.',
  role: 'wing', tier: 2,
  file: [
    'Subject was a piano instructor. A student fell from the lesson-room window on [[8]]. Subject did not look up.',
    'Subject composes the same chord. Subject believes the chord will ~~bring the child back~~ correct the moment.',
    'Each near-completion has cost staff [[3]] minutes of unaccounted time. !!Do not stand at the keyboard.!!',
  ],
  intro: [
    'The upright piano is in the corner. She is at the bench. Her fingers hover above the keys but she is not playing.',
    'She is humming. ~~The chord.~~ A chord. She has been at it forty years.',
  ],

  scales: {
    silence: {
      initial: 0, min: 0, max: 10, label: 'silence', kind: 'positive',
      bands: [
        { at: 0, word: 'loud in me' },
        { at: 2, word: 'breathing' },
        { at: 5, word: 'listening' },
        { at: 7, word: 'quiet' },
        { at: 9, word: 'absent' },
      ],
      crossUp: {
        2: 'I have stopped fidgeting. She has noticed.',
        3: 'The room has space for her now.',
        4: '~~I am not in the song.~~ I am next to it.',
      },
      crossDown: {
        1: 'My breathing has gotten loud again.',
      },
    },
    completion: {
      initial: 2, min: 0, max: 10, label: 'completion', kind: 'positive',
      bands: [
        { at: 0, word: 'empty' },
        { at: 3, word: 'searching' },
        { at: 5, word: 'near' },
        { at: 7, word: 'ready' },
        { at: 9, word: 'landing' },
      ],
      crossUp: {
        2: 'The song has begun to know what it is.',
        3: 'She has found the last few notes.',
        4: '!!The chord is ready to land.!!',
      },
      crossDown: {
        1: 'She has lost her place again.',
      },
    },
    chord: {
      initial: 3, min: 0, max: 10, label: 'chord', kind: 'negative',
      bands: [
        { at: 0, word: 'silent' },
        { at: 3, word: 'humming' },
        { at: 5, word: 'stacking' },
        { at: 7, word: 'full' },
        { at: 9, word: 'demanding release' },
      ],
      crossUp: {
        3: 'The chord has thickened. There are voices in it.',
        4: '!!The chord wants to land. It is louder than the room.!!',
      },
      crossDown: {
        2: 'A note has fallen out of it.',
        1: 'The chord has come apart.',
        0: 'The chord is gone. The room is quiet.',
      },
    },
    tension: {
      initial: 1, min: 0, max: 10, label: 'tension', kind: 'negative',
      bands: [
        { at: 0, word: 'calm' },
        { at: 3, word: 'humming' },
        { at: 5, word: 'tight' },
        { at: 7, word: 'trembling' },
        { at: 9, word: 'breaking' },
      ],
      crossUp: {
        2: 'The room has gone tight.',
        3: '!!My teeth are ringing.!!',
        4: '!!The room is about to fall apart.!!',
      },
      crossDown: {
        2: 'The tension has eased.',
        1: 'The room has settled.',
      },
    },
  },
  initialize(p, player) {
    p.scales.chord = r(3, 5);
    p.scales.silence = 0;
    p.scales.completion = r(2, 4);
    p.scales.tension = r(1, 3);
    if (player?.scars?.includes('named'))     p.scales.tension = Math.min(10, p.scales.tension + 1);
    if (player?.scars?.includes('witnessed')) p.scales.chord = Math.min(10, p.scales.chord + 1);
  },

  fileReveals: [
    { announce: 'A line of her file fills in. ~~The student fell from the lesson-room window.~~' },
    { announce: '~~She believes the chord will correct the moment.~~ The chord is in the room.' },
    { announce: 'The last line completes the page. **She did not look up.**' },
  ],

  presented(p) {
    const c = p.scales.chord;
    const s = p.scales.silence;
    const co = p.scales.completion;
    const t = p.scales.tension;
    let sound;
    if (c >= 8)      sound = '!!The chord is full. It has been full a while. It wants to land.!!';
    else if (c >= 5) sound = 'The chord is almost there. It is several notes thick.';
    else if (c >= 2) sound = 'The chord is forming. A few notes are stacked, humming.';
    else             sound = 'The room is quiet. She has not begun.';
    let posture;
    if (co >= 7)     posture = 'She is trembling above the keys. Ready to land.';
    else if (co >= 4) posture = 'She is poised over the keys without pressing them.';
    else if (co >= 1) posture = 'She drifts above the keys. Searching.';
    else              posture = 'She has stopped. The keys are at rest in front of her.';
    let me;
    if (t >= 6)      me = '!!The room is loud. My ears are full.!!';
    else if (s >= 4) me = 'I am very quiet in the corner. The room has space for her.';
    else if (s >= 1) me = 'I am holding still. Listening.';
    else             me = 'I am breathing normally. It is loud, in here.';
    return `${sound} ${posture} ${me}`;
  },

  verbs: {

    hold_still: {
      label: 'hold still',
      desc: 'Do nothing. Let the room have its breath.',
      respond(p) {
        const reps = streakCount(p, 'hold_still');
        if (reps >= 2) {
          return {
            lines: [
              'I am very still. She has stopped noticing me. Which is the right way.',
              'A note arrives. Another. She has been working.',
            ],
            scales: { silence: +2, completion: +2, chord: +1 },
          };
        }
        return {
          lines: [
            'I keep still. I keep quiet. I keep my breathing low.',
            'She adds a note. She leaves it alone.',
          ],
          scales: { silence: +1, chord: +1 },
        };
      },
    },

    listen_carefully: {
      label: 'listen carefully',
      desc: 'Attend to the chord. Let her feel attended to.',
      respond(p) {
        return {
          lines: [
            'I listen. I follow the shape of what she is building. I do not breathe in time.',
            p.scales.completion >= 4
              ? 'She nods, slightly. She knows I am with her.'
              : 'She does not notice me listening. But the chord deepens a little anyway.',
          ],
          scales: { silence: +2, completion: +1 },
        };
      },
    },

    add_a_note: {
      label: 'hum a low note',
      desc: 'Add to the chord. Quietly.',
      when: (p) => p.scales.silence >= 3 && p.scales.chord >= 3,
      respond(p) {
        const reps = streakCount(p, 'add_a_note');
        if (reps >= 2) {
          return {
            lines: [
              'I keep humming notes. The chord has thickened. She has not stopped.',
              '~~The chord has more of me in it than I meant.~~ I have given more than I should have.',
            ],
            scales: { chord: +2, tension: +1, silence: -1 },
            composure: -1,
            composureCost: 'Her hand stopped above the keys. ~~Not because of me.~~',
          };
        }
        if (p.scales.chord >= 7) {
          return {
            lines: [
              'I hum a low note. It does not fit. ~~The chord winces around it.~~',
              'She stops humming. She looks at me. !!She is angry. Briefly.!!',
            ],
            scales: { chord: -1, completion: -1, tension: +2 },
            composure: -2,
            composureCost: 'One of the notes is wrong. It is the one I added.',
          };
        }
        return {
          lines: [
            'I hum a note. It fits. ~~It is one she had been waiting for.~~',
            'She nods, almost.',
          ],
          scales: { chord: +1, completion: +2 },
        };
      },
    },

    close_the_lid: {
      label: 'close the piano lid',
      desc: 'Reach past her. Close it. Gently.',
      when: (p) => p.scales.completion <= 4 && p.scales.silence >= 4,
      respond(p) {
        if (p.scales.completion <= 3) {
          return {
            lines: [
              'I reach past her. Her shoulder is warm. I lower the lid over the keys.',
              'The chord stops in the air. ~~It does not finish.~~ It cannot.',
              'She lowers her arms. She rests them on the closed lid. She breathes out.',
              '!!She has been waiting for someone to do this.!!',
            ],
            flags: { closed_lid: true },
            scales: { chord: -5, completion: -3, tension: -2 },
          };
        }
        return {
          lines: [
            'I reach to close it. She gets to the lid first. She does not push me away.',
            'She says: !!Not yet.!! She is firm.',
          ],
          scales: { tension: +2 },
          composure: -1,
          composureCost: '!!The chord has gone wrong.!!',
        };
      },
    },

    let_her_finish: {
      label: 'let her finish',
      desc: 'Sit at the bench with her. Play the chord with her.',
      when: (p) => p.scales.completion >= 6 && p.scales.chord >= 6,
      respond(p) {
        if (p.scales.silence >= 5 && p.scales.completion >= 7 && p.scales.chord >= 7) {
          return {
            lines: [
              'I sit on the bench beside her. I find her shoulder with my shoulder.',
              'I press my fingers to the keys where hers are.',
              'We press. The chord lands. The room composes itself around it.',
              '!!She lets the keys go. She has finished. ~~She does not check the window.~~!!',
            ],
            flags: { finished_chord: true },
            scales: { completion: -8, chord: -8 },
          };
        }
        return {
          lines: [
            'I sit beside her. I reach for the keys. She shakes her head. ~~Not now.~~ Not yet.',
            'She guides my fingers back off the keyboard gently.',
          ],
          scales: { silence: +1, tension: +2 },
          composure: -1,
          composureCost: 'The room is humming. ~~The chord is in my chest.~~',
        };
      },
    },

    play_wrong_note: {
      label: 'play a wrong note',
      desc: 'Sing a note that does not fit. Break the chord.',
      when: (p) => p.scales.chord >= 6,
      respond() {
        return {
          lines: [
            'I sing a note that does not fit. It is wrong. It is obviously wrong.',
            'She stops humming. She stares at the spot the chord was in.',
            'One of the notes has dropped out of it. The others are leaning.',
          ],
          scales: { chord: -3, completion: -2, tension: +3 },
          composure: -1,
          composureCost: 'Her not-yet has gone on too long.',
        };
      },
    },

    ask_about_the_song: {
      label: 'ask about the song',
      desc: 'What is this? Who is it for?',
      when: (p) => p.scales.silence >= 4 && p.scales.chord >= 4,
      respond() {
        return {
          lines: [
            'I ask: what is this song?',
            'She tells me. Quietly. It is for ~~the one who fell~~ a child. She is not sure whose.',
            'Either way she has been writing it forty years.',
          ],
          scales: { completion: +2, tension: -1 },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Hold the silence. Let the chord stack itself.',
    when: (p) => p.scales.completion <= 6 || p.scales.silence >= 3 || p.turn >= 4,
  },

  interjections: [
    {
      id: 'can_you_hear_it',
      once: true,
      when: (p) => p.scales.chord >= 6 && p.scales.silence >= 4,
      prose: [
        'She pauses, suspended above the keyboard. She turns her head slightly toward me.',
        'She asks: ~~Can you hear it?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'Confirm. Let her have a listener.',
          lines: [
            'I say: yes.',
            'She returns to the keys. Her tremor has steadied. She is no longer alone in this.',
          ],
          scales: { completion: +3, silence: +2 },
        },
        {
          label: 'I hear a chord',
          desc: 'Precise. Less than yes.',
          lines: [
            'I say: I hear a chord. Four notes. One of them is a half-step under the others.',
            'She nods slowly. She is surprised. She had not thought anyone was that careful.',
          ],
          scales: { completion: +3, chord: +1, silence: +1 },
        },
        {
          label: 'I hear it now',
          desc: 'Soft.',
          lines: [
            'I say: I hear it now.',
            'She adds a fingering I have not seen before. The chord widens by one note. She is teaching me, briefly.',
          ],
          scales: { chord: +1, completion: +2, silence: +1 },
        },
      ],
    },
    {
      id: 'which_brother',
      once: true,
      when: (p) => p.scales.silence >= 4 && p.scales.completion >= 3,
      prose: [
        'She has gone still, briefly. She is looking at the keys.',
        'She asks: ~~Which one was at the window? Was it the boy or the girl? I cannot remember which this is for.~~',
      ],
      responses: [
        {
          label: 'the boy',
          desc: 'Pick one.',
          lines: [
            'I say: the boy.',
            'She nods. She begins again. One note at a time. ~~She does not check.~~',
          ],
          scales: { completion: +2, chord: +1 },
          scars: ['named'],
        },
        {
          label: 'the girl',
          desc: 'Pick the other.',
          lines: [
            'I say: the girl.',
            'She pauses. She is not sure. But she begins again.',
          ],
          scales: { completion: +1, tension: +1 },
          scars: ['named'],
        },
        {
          label: 'tell me what you remember',
          desc: 'Do not name.',
          lines: [
            'I say: tell me what you remember.',
            'She does. It is small. ~~A scraped knee. A way of saying a particular word.~~',
            '!!A child, made specific.!!',
          ],
          scales: { completion: +3, silence: +1 },
        },
      ],
    },
    {
      id: 'is_this_right',
      once: true,
      when: (p) => p.scales.chord >= 7 && p.scales.tension <= 5,
      prose: [
        'She has stopped humming. She is suspended above the keys, very still.',
        'She asks: ~~Is this right? Does it sound right?~~',
      ],
      responses: [
        {
          label: 'it sounds right',
          desc: 'Give her the reassurance.',
          lines: [
            'I say: it sounds right.',
            'She nods. She returns to the keys. ~~Her tremor is steadier than it was.~~',
          ],
          scales: { completion: +3, silence: +1 },
        },
        {
          label: 'one note is wrong',
          desc: 'Be honest. Point it out.',
          lines: [
            'I say: one of the notes is wrong. The third from the bottom.',
            'She stares at the keys. She reaches. She withdraws. ~~She does not press it.~~',
          ],
          scales: { chord: -2, tension: +2, completion: +1 },
          composure: -1,
          composureCost: 'The lid is heavier than I thought.',
        },
        {
          label: "I can't tell",
          desc: 'Honest in a different way.',
          lines: [
            "I say: I can't tell.",
            'She nods. ~~She has been wondering, too.~~',
          ],
          scales: { completion: +1, silence: +1, tension: +1 },
        },
        {
          label: '[amnesia] I do not remember what the right one was',
          desc: 'Confess the gap in the score.',
          when: (_, player) => player.wound === 'amnesia',
          lines: [
            'I say: I do not remember what the right one is. I am sorry.',
            'She lifts her hand off the keys. Slowly.',
            'She says: ~~that is the kindest answer I have been given.~~',
          ],
          scales: { completion: +2, chord: -1, silence: +2 },
        },
        {
          label: '[insomnia] it sounds right to someone who has not slept',
          desc: 'Hand her a thin verdict.',
          when: (_, player) => player.wound === 'insomnia',
          lines: [
            'I say: it sounds right to someone who has not slept in days.',
            'She thinks about that. ~~She has not slept either.~~',
            'She nods at the keys. The chord goes quieter. Once.',
          ],
          scales: { completion: +2, chord: -1, tension: -1 },
        },
        {
          label: '[split personality] one of me hears it right',
          desc: 'Two ears. Two answers.',
          when: (_, player) => player.wound === 'split_personality',
          lines: [
            'I say: one of me hears it right. The other does not.',
            'She turns to me — properly — and for the first time her hands are off the keys at the same time.',
            'She says: ~~then we are three.~~',
          ],
          scales: { completion: +2, chord: -2, silence: +2 },
          composure: -1,
          composureCost: 'She has counted me twice. ~~I am not sure she should.~~',
        },
      ],
    },
    {
      id: 'am_I_done',
      once: true,
      when: (p) => p.scales.completion >= 6 && p.scales.silence >= 3,
      prose: [
        'She lets her arms fall to her lap. She looks at the keys as if for the first time tonight.',
        'She asks me: ~~Am I done?~~',
      ],
      responses: [
        {
          label: "you're done",
          desc: 'Release her.',
          lines: [
            "I say: you're done.",
            'She nods slowly. She lowers the lid and rests her arms on the wood. ~~She has been waiting.~~',
          ],
          scales: { chord: -3, completion: -2, tension: -2 },
          flags: { closed_lid: true },
          composure: -1,
          composureCost: 'I have spoken for her ending. ~~Forty years of it.~~',
        },
        {
          label: 'one more note',
          desc: 'Help her finish.',
          lines: [
            'I say: one more note.',
            'She nods. She lifts a finger. She presses one key. ~~The room rings.~~ The building rings.',
          ],
          scales: { completion: +3, chord: +2 },
        },
        {
          label: "I don't know",
          desc: 'Honest.',
          lines: [
            "I say: I don't know. Only you know.",
            'She sits with that. She does not move toward the keys. She does not begin again.',
          ],
          scales: { completion: -1, silence: +2, tension: +1 },
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.completion >= 7 && p.scales.chord >= 7 && p.scales.silence < 4) {
      return {
        lines: [
          'I wait. She adds the final note. The chord lands without me. ~~Without anyone.~~',
          '!!The room composes itself. But I was not in it.!!',
        ],
        scales: { chord: -7, completion: -7, tension: +3 },
        composure: -2,
        composureCost: 'The chord landed without me. I heard where I would have been.',
        flags: { finished_alone: true },
      };
    }
    return {
      lines: ['I wait. She adds a note. Then another. The chord deepens.'],
      scales: { chord: +1, completion: +1, tension: +1 },
    };
  },

  endings: [
    {
      id: 'finished_together',
      when: (p) => p.flags.finished_chord,
      title: 'You finish the chord with her',
      lines: [
        'She has eased back from the keys. I am still pressing the chord. She leans against my shoulder.',
        'We do not say anything for a long time.',
      ],
      item: 'scrap_of_paper',
    },
    {
      id: 'closed_lid',
      when: (p) => p.flags.closed_lid && p.scales.silence >= 4,
      title: 'You close the lid',
      lines: [
        'The lid is closed. She rests her arms on the wood. The room is quiet for the first time.',
        '!!She lets it be quiet.!!',
      ],
      item: 'sliver_of_glass',
    },
    {
      id: 'finished_alone',
      when: (p) => p.flags.finished_alone,
      title: 'She finishes it without you',
      lines: [
        'The chord arrives. She does not look at me. She has finished what she came in to finish.',
        'I leave the room. ~~The chord follows me for some hours.~~ The chord is in the corridor now too.',
      ],
      item: 'photograph',
      scars: ['witnessed'],
    },
    {
      id: 'broken',
      when: (p) => p.scales.tension >= 9,
      title: 'The chord falls apart',
      lines: [
        'She lets the keys go. She stares at them. The chord is in pieces around her.',
        '!!She has lost the place she was holding it from.!!',
      ],
      item: null,
      scars: ['witnessed', 'failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: ['I close the door. The chord is humming behind me. ~~It always was.~~'],
      item: null,
      scars: ['abandoned'],
    },
  ],
};



// ════════════════════════════════════════════════════════════════════════
// THE CHILDREN AT THE DOOR — Patient(s) 0117 and 0118
// ════════════════════════════════════════════════════════════════════════
//
// Folklore: the Black-Eyed Children. Two of them in the corridor. They
// cannot enter without the patient's word.
//
// Architecture: HUB-AND-SPOKE. `hubState(p, player)` returns a named
// scene; each scene has its own toolkit of SPOKES. A spoke is a multi-
// node sub-conversation — while inside one, the hub menu is replaced by
// the current node's choices. A spoke's exit choice can let the hub
// recompute or force a specific scene.
//
// Fourteen scenes. About eighty spokes. No wait. No leave. No drift.
// Every action is authored.
//
//   at_the_door       door closed. you have not spoken. they knock evenly.
//   engaged           you have spoken. the shorter one carries the talking.
//   mother_story      she is telling you about her mother. your throat tight.
//   tense             you have caught them. they know you know.
//   pressing          invitation is dangerously high. the bolt drifts.
//   screaming         they throw themselves at the door. a fear tactic.
//   self_harm         sounds of the shorter one hurting herself.
//   tricking          a specific deception — imitating someone, pretending.
//   more_arrive       more voices in the corridor. three. four. five.
//   silence           they have gone completely quiet.
//   recognized        the shorter one knows things only your mother knew.
//   power_out         the corridor lights die. the peephole is black.
//   barricaded        chain set, chair wedged. you defend; they wait.
//   orderly_present   an orderly is in the corridor. he is talking.
//
// Urgent spokes are time-limited triggered responses that appear in the
// hub menu with a red bar and a "now" tag. Most of them expire after a
// few turns if not picked. Some persist.

const children = {
  id: 'children',
  name: '[Children at the Door]',
  glyph: 'Sproutkin',
  subtitle: 'Two children in the corridor. They are not allowed in unless you say.',
  role: 'wing', tier: 1,
  file: [
    'Subject reports two **minors** in the corridor outside Ward 1. Barefoot. Hair wet. No wet weather is on record.',
    'Staff have not seen them. The night camera ~~has~~ has not.',
    'The minors have **requested admission** [[7]] times in three hours. Each request is logged as polite. !!They have not been let in.!!',
    'Taller minor wears a uniform consistent with St. Anselm\'s. ~~St. Anselm\'s was demolished in [[4]].~~',
    'Shorter minor has addressed Subject by ~~a given name not on the admission card.~~',
    'Night nurse declines to walk past the door. !!She has been a nurse here for [[2]] years.!!',
  ],
  intro: [
    'The door is six panels of painted wood with a bolt, a chain, and a brass peephole. I have read it the way you read a contract. The gap at the sill is one finger wide.',
    'I have been listening longer than I have been awake. The listening started without me.',
    'Two voices. The shorter one sits low against the wood, about bolt height. The taller one stands further back and does not breathe where I can hear it.',
    'She knocks. Three taps. Even pressure. The kind of knock somebody teaches.',
    'She says: !!mister. Please. Can we come in?!!',
  ],

  scales: {
    invitation: {
      initial: 4, min: 0, max: 20, label: 'invitation', kind: 'negative',
      bands: [
        { at: 0, word: 'refused' },
        { at: 4, word: 'asked again' },
        { at: 8, word: 'considered' },
        { at: 12, word: 'leaning yes' },
        { at: 16, word: 'in my mouth' },
        { at: 19, word: 'said' },
      ],
      crossUp: {
        2: 'The asking has changed key. Nothing else about it has changed.',
        3: 'My hand has been to the bolt and back. I did not send it.',
        4: '!!My hand is on the bolt. I do not remember putting it there.!!',
        5: '!!The word is in my mouth. I have not bitten down on it yet.!!',
      },
      crossDown: {
        2: 'My hand is back at my side. I counted it there.',
        1: 'Three steps between me and the door. I count them twice.',
        0: 'The asking is just sound again. Sound stays outside.',
      },
    },
    latch: {
      initial: 14, min: 0, max: 20, label: 'the bolt', kind: 'positive',
      bands: [
        { at: 0, word: 'turning' },
        { at: 4, word: 'past the keep' },
        { at: 8, word: 'loose' },
        { at: 12, word: 'set' },
        { at: 16, word: 'dropped' },
        { at: 19, word: 'chained' },
      ],
      crossUp: {
        3: 'The bolt is fully dropped. Both of my hands are off it.',
        4: '!!The chain is across. The door is doubled.!!',
      },
      crossDown: {
        4: 'The bolt has eased back a quarter turn. Neither of my hands was on it.',
        3: 'The bolt is loose in its housing.',
        2: 'The bolt is barely in its keep.',
        1: '!!The bolt has turned itself the rest of the way.!!',
        0: 'Nothing holds the door now but its habit of being shut.',
      },
    },
    suspicion: {
      initial: 2, min: 0, max: 20, label: 'suspicion', kind: 'positive',
      bands: [
        { at: 0, word: 'none' },
        { at: 4, word: 'noticing' },
        { at: 8, word: 'wrong' },
        { at: 12, word: 'adding up' },
        { at: 16, word: 'certain' },
        { at: 19, word: 'not children' },
      ],
      crossUp: {
        2: 'The please is the same please every time. Worn smooth, like a stair.',
        3: 'They speak like a letter written by someone old, read aloud by someone small.',
        4: '!!They are not children. I do not know what they are.!!',
        5: 'Whatever they are, the door is not the thing keeping them out. !!The rule is.!!',
      },
      crossDown: { 1: 'I have talked myself around. It took both of us.' },
    },
  },

  initialize(p, player) {
    p.scales.invitation = 4;
    p.scales.latch = 14;
    p.scales.suspicion = 2;
    if (player.scars?.includes('named'))     p.scales.invitation = 6;
    if (player.scars?.includes('abandoned')) p.scales.latch = 12;
    if (player.wound === 'amnesia')          p.scales.latch -= 2;
    if (player.wound === 'insomnia')         p.scales.suspicion = 4;
  },

  fileReveals: [
    { at: 4,  announce: 'A line of the file fills itself in. Subject reports two **minors** outside Ward 1. The hand is not mine.' },
    { at: 9,  announce: 'Another. Staff have not seen them. ~~Neither has the night camera.~~ The strike is fresh.' },
    { at: 14, announce: 'Another. **Requested admission**, seven times in three hours. Each request filed as polite.' },
    { at: 20, announce: 'Another. The taller minor wears the uniform of a school that closed in [[4]].' },
    { at: 28, announce: 'Another. The shorter has named Subject by ~~a name not on file.~~' },
    { at: 36, announce: '!!The last line. The night nurse will not walk past the door. She has been a nurse here a long time.!!' },
  ],

  hubState(p, player) {
    if (p.flags.in_the_room)            return 'in_the_room';
    if (p.flags.orderly_present)        return 'orderly_present';
    if (p.flags.chain_set || p.flags.chair_wedged) return 'barricaded';
    if (p.flags.power_out)              return 'power_out';
    if (p.flags.they_are_screaming)     return 'screaming';
    if (p.flags.they_are_self_harming)  return 'self_harm';
    if (p.flags.trick_active)           return 'tricking';
    if (p.flags.more_have_arrived)      return 'more_arrive';
    if (p.flags.they_have_gone_silent && (p.turn - (p.flags.silence_start || -99)) <= 3)
                                        return 'silence';
    if (p.flags.they_have_recognized && !p.flags.recognition_resolved)
                                        return 'recognized';
    if (p.flags.engaged && p.scales.invitation >= 14) return 'pressing';
    if (p.flags.in_mother_story)        return 'mother_story';
    // 'tense' represents alarm — it persists whenever you have made a major
    // catch or pushed suspicion past the line, whether or not you have
    // spoken through the door. So a deep examination followed by an
    // unrelated action does not collapse you back to at_the_door and lose
    // the confront option.
    if (p.scales.suspicion >= 10 || p.flags.confronted_anything) return 'tense';
    if (p.flags.engaged)                return 'engaged';
    return 'at_the_door';
  },

  presented(p, hub) {
    switch (hub) {
      case 'at_the_door': {
        const what = p.flags.heard_lesson
          ? '!!I have heard the asking rehearsed. He sets the line; she carries it to the door.!! '
          : (p.flags.overheard ? 'Through the gap I have heard her breathing. Only hers. I have stopped assuming it is both. ' : '');
        const eye = p.flags.saw_eye
          ? '!!Through the peephole, her eye filled the brass. No white. Bone-pale lashes.!! '
          : (p.flags.seen_them ? 'Through the peephole, two children, wet-haired, barefoot on dry linoleum. ' : 'I have not looked. The door is grain and paint and a brass lens I have not used. ');
        return what + eye + 'The shorter one knocks. Three taps. Even pressure. She says: !!mister. Please.!!';
      }
      case 'engaged':
        return 'The shorter one carries the talking. Her voice sits at bolt height against the wood. She leaves a space after each question the exact size of an answer. '
          + (p.flags.taller_speaking
              ? 'The taller one is speaking now. His voice is older than his height. '
              : 'The taller one waits. I have not heard him breathe yet. ')
          + (p.flags.asked_want
              ? 'They have said what they want. In. The rest of the conversation is the terms.'
              : '');
      case 'mother_story':
        return 'The shorter one is low at the gap, telling me about a kitchen. A window over the sink. A song. '
          + 'The taller one has gone quiet in a way that is its own sound. My eyes have been closed for I do not know how many breaths.';
      case 'tense':
        return (p.flags.engaged
            ? 'They know I have caught them. The asking has not stopped; it has gone careful. She weighs each word now before setting it against the wood. '
            : 'I have caught them out. The asking holds its volume and its twelve-second interval. Only the cadence has thinned. ')
          + 'Neither pair of feet has moved on the linoleum since I counted them last.';
      case 'pressing':
        return '!!The bolt is loose in its housing. My hand is at my side, then at the bolt, then at my side. The word is in my mouth.!! '
          + 'She is at the gap, whispering. Her please lands on my exhale. Every exhale. I did not set that rhythm.';
      case 'screaming':
        return '!!They are throwing themselves at the door. The shorter one screams. Under the screaming, the taller one is laughing.!! '
          + 'The bolt holds. The frame holds. I count the hits in fours to keep them weather.';
      case 'self_harm':
        return '!!The shorter one is hurting herself. I can hear her teeth on her own arm. Her crying is the right shape but the wrong rhythm.!! '
          + 'The taller one is silent. He is letting it run.';
      case 'tricking':
        return 'The voice on the other side of the door has changed. !!It is not the shorter one anymore. It is a voice I have heard before, but not in this corridor.!!';
      case 'more_arrive':
        return '!!There are more of them now. Three voices. Four. They are taking turns at the door.!! '
          + 'The asking never stops; it changes mouths. Under the door, the line of light is broken in more places than I can account for.';
      case 'silence':
        return '!!They have gone completely quiet. No breathing, no shifting, no asking. The gap shows unbroken light.!! '
          + 'Quiet is not gone. I make myself write that down: quiet is not gone.';
      case 'recognized':
        return '!!The shorter one is using my mother\'s pet name for me. The name is correct. The mouth is not.!! '
          + 'Behind her, the taller one keeps his silence the way you keep a receipt.';
      case 'power_out':
        return '!!The corridor lights are out. The peephole is black. The voices continue without interruption.!! '
          + 'The gap at the sill is a line of nothing now. I keep my feet a stride back from it.';
      case 'barricaded':
        return 'Chain across. Bolt dropped. Chair under the handle. The door is an inventory now, and I keep taking it. '
          + 'The asking has gone quiet and patient, a voice with its hands folded. They are not waiting for the door. They are waiting for me.';
      case 'orderly_present':
        return 'An orderly has come down the corridor. He is at my door. He is speaking. '
          + 'The children have gone quiet for him. Their quiet is a thing they do on purpose. !!I did not hear them leave.!!';
      default:
        return 'The door is shut. The voices are not.';
    }
  },

  // ─────────────────────────────────────────────────────────────────────
  //  HUB FLAVOR — fires once when the scene transitions into this hub
  //  state. Short, present-tense, document-horror tone. The `presented`
  //  block already paints the standing scene; these lines mark the shift.
  // ─────────────────────────────────────────────────────────────────────

  hubFlavor: {
    engaged: 'The conversation has begun. You cannot un-begin one. She settles in at the gap, low against the wood.',
    tense: 'I have caught them out. The asking does not stop for being caught. It only goes careful.',
    pressing: '!!The bolt is loose. My hand is going to it. The word is in my mouth.!!',
    mother_story: 'The asking has dropped out of her voice. She is telling me about a kitchen.',
    screaming: '!!The asking has stopped. They are throwing themselves at the door and screaming.!!',
    self_harm: '!!The asking has stopped. There is a wet sound at the gap. She is hurting herself.!!',
    tricking: 'The voice has changed owners mid-sentence. The cadence stayed. The throat did not.',
    more_arrive: '!!More feet in the corridor. More voices. The asking goes around them like a plate being passed.!!',
    silence: 'The corridor has gone quiet all at once, like a radio switched off rather than a room emptied.',
    recognized: '!!She has used my mother\'s pet name for me. I have not heard it said aloud since the funeral.!!',
    power_out: '!!The line of light under the door is struck out. The asking does not pause for the dark.!!',
    barricaded: 'The chain is across. The chair is wedged. The door is doubled. The asking turns patient, like interest accruing.',
    orderly_present: 'An orderly has come down the corridor. He is at my door. The children have gone quiet for him. Their quiet has manners too.',
    in_the_room: '!!The door is open. They are inside. The rest of this page was never written.!!',
  },

  // ─────────────────────────────────────────────────────────────────────
  //  SPOKES
  // ─────────────────────────────────────────────────────────────────────

  spokes: {

    // ═════════════════════════════════════════════════════════════════
    //  HUB: at_the_door
    // ═════════════════════════════════════════════════════════════════

    examine_the_peephole: {
      label: 'look through the peephole',
      desc: 'The brass lens. Lean in.',
      when: (p, _pl, hub) => hub === 'at_the_door' && !p.flags.peephole_examined,
      entry: 'lens',
      nodes: {
        lens: {
          lines: [
            'I lean to the lens. The brass is colder than the wood around it. The wood is warmer than it should be.',
            'Two children. The shorter one stands square to the lens, hands folded in front of her as if for a recital. The taller one keeps a step back, where the light goes least.',
            'Their hair is wet. Their feet are bare on the linoleum. Neither of them is shivering, and neither of them is trying not to.',
          ],
          scales: { suspicion: +3 },
          flags: { seen_them: true },
          choices: [
            { label: 'press your eye to the lens', goto: 'eye_at_lens' },
            { label: 'tilt to see the floor', goto: 'floor' },
            { label: 'pull back from the lens', goto: { lines: ['I step back. The lens goes dark. The dark does not mean gone.'], flags: { peephole_examined: true }, to: 'hub' } },
          ],
        },
        eye_at_lens: {
          lines: [
            'I press in. Her eye is already at the lens from the other side, focused, as if I had kept an appointment.',
            'It is the whole of the brass circle. No white. The lashes are bone-pale and very still.',
            'She has not blinked.',
          ],
          scales: { suspicion: +5 },
          flags: { saw_eye: true },
          composure: -1,
          composureCost: 'She has not blinked since I leaned in.',
          choices: [
            { label: 'hold the look', goto: 'hold_look' },
            { label: 'tilt to the floor', goto: 'floor' },
            { label: 'pull back', goto: { lines: ['I pull back. The brass goes dark.'], composure: +1, composureGain: 'I have my own room around me again.', flags: { peephole_examined: true }, to: 'hub' } },
          ],
        },
        hold_look: {
          lines: [
            'I do not pull back. I hold her look through the brass.',
            'Her eye does not move. After a long beat the eyelid lowers, then opens, slowly, the way a doll closes and reopens when tilted.',
            '!!She did not blink. She lowered. There is a difference.!!',
          ],
          scales: { suspicion: +5 },
          composure: -2,
          composureCost: 'It was not a blink.',
          choices: [
            { label: 'pull back, hard', goto: { lines: ['I pull away from the lens fast enough to feel it in my neck.'], flags: { peephole_examined: true }, to: 'hub', forceState: 'tense' } },
          ],
        },
        floor: {
          lines: [
            'I tilt my head. She steps aside without being asked. The corridor floor comes into frame, as if presented.',
            'Wet footprints where they are standing. The prints continue back down the corridor, the way they came.',
            'There are more sets of prints than there are children.',
          ],
          scales: { suspicion: +4 },
          flags: { saw_prints: true },
          composure: -1,
          composureCost: 'More sets than children.',
          choices: [
            { label: 'count them', goto: 'count' },
            { label: 'pull back', goto: { lines: ['I straighten. The lens goes dark.'], flags: { peephole_examined: true }, to: 'hub' } },
          ],
        },
        count: {
          lines: [
            'I count. Three sets coming in. The third is larger than either child\'s, and barefoot all the same.',
            'The third set comes down the corridor and does not arrive anywhere. It is not behind them. It is not in the corridor at all.',
          ],
          scales: { suspicion: +5 },
          flags: { counted_prints: true, counted_prints_turn: p => p.turn, peephole_examined: true },
          composure: -2,
          composureCost: 'The third set is not in the corridor anymore.',
          choices: [
            { label: 'pull back from the door', goto: { lines: ['I straighten. The lens goes dark.'], composure: +1, composureGain: 'I have what I went there for. I do not need to look again.', to: 'hub', forceState: 'tense' } },
          ],
        },
      },
    },

    listen_at_the_gap: {
      label: 'listen at the gap under the door',
      desc: 'Crouch. An ear to the linoleum.',
      when: (p, _pl, hub) => hub === 'at_the_door' && !p.flags.gap_examined,
      entry: 'gap',
      nodes: {
        gap: {
          lines: [
            'I crouch. I press my cheek to the floor. The gap under the door is the width of a finger.',
            'Two pairs of feet, bare. Hers rise to the toes and settle, rise and settle. His have not moved since I started counting.',
            'Breathing, close to the floor. Hers, on a count of four. I wait through ten of hers for one of his and do not get it.',
          ],
          scales: { suspicion: +3 },
          flags: { overheard: true },
          choices: [
            { label: 'stay and listen for them to speak', goto: 'rehearsal' },
            { label: 'press an ear to the wood, higher', goto: 'wood' },
            { label: 'stand up', goto: { lines: ['I stand. My knees are loud. Her count of four does not falter for them.'], flags: { gap_examined: true }, to: 'hub' } },
          ],
        },
        rehearsal: {
          lines: [
            'I stay there. After a long beat they begin to talk to each other. They think the wood is thick enough.',
            'The taller one says, evenly: ~~try the please again. Slower this time.~~',
            'The shorter one says: ~~okay. Like before?~~ The taller one: ~~yes. Like before.~~',
          ],
          scales: { suspicion: +4 },
          flags: { heard_taller: true },
          composure: -1,
          composureCost: 'He is coaching her.',
          choices: [
            { label: 'press higher, hear what else', goto: 'wood' },
            { label: 'stand up slowly', goto: { lines: ['I stand. Her breathing stops for one beat, two. Then it resumes on the same count of four.'], flags: { gap_examined: true }, to: 'hub' } },
          ],
        },
        wood: {
          lines: [
            'I stand and press my ear flat to a panel. The grain carries sound the way a desk carries a pen scratch.',
            'The taller one is reciting numbers. Quietly. ~~Seven doors. Three refused. He is the fourth. He is awake.~~',
            'The shorter one repeats them after him, like a child learning a catechism.',
          ],
          scales: { suspicion: +5 },
          flags: { heard_lesson: true, heard_lesson_turn: p => p.turn, gap_examined: true },
          composure: -2,
          composureCost: 'I am the fourth door.',
          choices: [
            { label: 'pull away from the wood', goto: { lines: ['I take my ear off the wood.'], composure: +1, composureGain: 'Knowing the shape of the thing is steadier than not knowing it.', to: 'hub', forceState: 'tense' } },
          ],
        },
      },
    },

    speak_through_the_door: {
      label: 'speak through the door',
      desc: 'Begin. It cannot be un-begun.',
      when: (p, _pl, hub) => hub === 'at_the_door' && !p.flags.engaged,
      entry: 'first_word',
      nodes: {
        first_word: {
          lines: [
            'I bring my mouth to the wood. My breath comes back off the grain, warmed. The door does the breathing for both of us.',
            'There are three things I could say. Saying any of them signs me into the conversation.',
          ],
          choices: [
            { label: 'who is at my door', goto: 'who' },
            { label: 'what do you want', goto: 'what' },
            { label: 'i can hear you', goto: 'hear' },
          ],
        },
        who: {
          lines: [
            'I say: who is at my door.',
            (p) => p.flags.heard_lesson
              ? 'The shorter one says, immediately: ~~Hannah. And my brother. We are very cold, mister.~~ The taller one is quiet. He has been ready for this part.'
              : 'The shorter one says: !!mister. We are so glad you are awake.!! ~~We have been at the door a long time. We have been hoping you would speak.~~',
          ],
          scales: { invitation: +2 },
          flags: { engaged: true, asked_who_initial: true, mister_count: 1 },
          composure: -1,
          composureCost: 'She was glad I was awake.',
          choices: [
            { label: 'go on', goto: { to: 'hub' } },
          ],
        },
        what: {
          lines: [
            'I say: what do you want.',
            'The shorter one says: ~~to come in. Just to come in. Just for a little while. Until our mother comes for us.~~',
            'She does not say the phrase. She produces it, the way you produce a ticket.',
          ],
          scales: { invitation: +2, suspicion: +1 },
          flags: { engaged: true, asked_want: true, asked_want_turn: p => p.turn, mister_count: 1 },
          choices: [
            { label: 'go on', goto: { to: 'hub' } },
          ],
        },
        hear: {
          lines: [
            'I say: I can hear you. I have been at the door longer than you knew.',
            'There is a pause. The taller one says, evenly: ~~that is alright, mister. We can hear you too.~~',
            'The shorter one says: ~~we are very cold.~~ No beat lost. The pivot was already loaded.',
          ],
          scales: { invitation: +1, suspicion: +3 },
          flags: { engaged: true, mister_count: 1, called_their_bluff: true },
          composure: -1,
          composureCost: 'They were not surprised.',
          choices: [
            { label: 'go on', goto: { to: 'hub' } },
          ],
        },
      },
    },

    step_back_and_listen: {
      label: 'step back and listen',
      desc: 'Move away from the door. Just listen.',
      when: (p, _pl, hub) => hub === 'at_the_door' && !p.flags.stepped_back,
      entry: 'back',
      nodes: {
        back: {
          lines: [
            'I take three steps backward. The bed creaks behind my calves. I sit on it.',
            'The asking crosses the room at the same volume it had at the door. Distance is not a thing it spends.',
          ],
          scales: { invitation: -2 },
          flags: { stepped_back: true },
          composure: +1,
          composureGain: 'The room is mine for a moment.',
          choices: [
            { label: 'listen for the pattern', goto: 'pattern' },
            { label: 'listen for what else is in the corridor', goto: 'corridor' },
            { label: 'go back to the door', goto: { lines: ['I stand and cross back to the door. The asking continues.'], to: 'hub' } },
          ],
        },
        pattern: {
          lines: [
            'I count the seconds between asks. Twelve. Thirteen. Twelve. Thirteen. They do not vary.',
            'Children do not keep time. Clocks keep time, and things that have been told to.',
          ],
          scales: { suspicion: +4 },
          flags: { noticed_pattern: true },
          composure: -1,
          composureCost: 'Twelve. Thirteen. Twelve.',
          choices: [
            { label: 'go back to the door', goto: { to: 'hub' } },
          ],
        },
        corridor: {
          lines: [
            'I listen past them. The radiator knocks once. A pipe ticks as it cools. The fluorescent above my door hums at the pitch it always hums.',
            'No trolley wheels. No desk chatter. No second hum of any other awake room. The ward has been cleared around this conversation.',
          ],
          scales: { suspicion: +2 },
          composure: -1,
          composureCost: 'No one else is on this floor.',
          choices: [
            { label: 'go back to the door', goto: { to: 'hub' } },
          ],
        },
      },
    },

    check_the_corridor_lights: {
      label: 'check the corridor for shadow',
      desc: 'The strip under the door. The light through the gap.',
      when: (p, _pl, hub) => hub === 'at_the_door' && !p.flags.checked_shadow && !p.flags.peephole_examined,
      entry: 'look',
      nodes: {
        look: {
          lines: [
            'I crouch an arm\'s length back. The corridor strip lays a line of light under the door, thin as a ruled margin.',
            'Two interruptions in it, child-sized. I time them against my pulse.',
            'Thirty seconds. Sixty. Neither shadow moves a hair. Children fidget. These have been stood like furniture.',
          ],
          scales: { suspicion: +3 },
          flags: { checked_shadow: true },
          composure: -1,
          composureCost: 'Children fidget. These did not.',
          choices: [
            { label: 'go back to the door', goto: { to: 'hub' } },
          ],
        },
      },
    },

    read_the_door_itself: {
      label: 'examine your own door',
      desc: 'The bolt. The chain. The frame.',
      when: (p, _pl, hub) => hub === 'at_the_door' && !p.flags.read_door,
      entry: 'survey',
      nodes: {
        survey: {
          lines: [
            'I read my own door like a clause. Brass bolt, set in its keep. Chain hanging slack against the frame, links the colour of old spoons.',
            'There is a hook for the chain. The hook is mine to lift.',
            'Peephole at eye height. Frame sound. The hinges are on my side, which means whoever hung this door expected the trouble to be outside it.',
          ],
          flags: { read_door: true },
          choices: [
            { label: 'test the bolt with one hand', goto: 'bolt' },
            { label: 'lift the chain in your hand', goto: 'chain' },
            { label: 'step away from the door', goto: { to: 'hub' } },
          ],
        },
        bolt: {
          lines: [
            'I slide the bolt back a quarter inch and home again. The metal is loose where it should be tight.',
            'The shorter one says, on the other side: ~~that is alright, mister. We can wait until you are sure.~~',
            'She knew which sound that was.',
          ],
          scales: { suspicion: +2, invitation: +1 },
          composure: -1,
          composureCost: 'A quarter inch, and she heard it.',
          choices: [
            { label: 'lift the chain', goto: 'chain' },
            { label: 'step away', goto: { to: 'hub' } },
          ],
        },
        chain: {
          lines: [
            'I lift the chain in my hand. It is heavier than I remember chains being. The links are colder than the room.',
            'I do not put it in the keep. Not yet.',
          ],
          flags: { chain_in_hand: true },
          choices: [
            { label: 'drop it in the keep now', goto: { lines: ['I let it drop. The metal taps the door. The voices outside stop for one beat. Two.', 'The shorter one says, more softly than before: ~~please. We will be quick.~~'], scales: { latch: +6, invitation: -3, suspicion: +1 }, composure: +1, composureGain: 'The chain is across. I am steadier for it.', flags: { chain_set: true }, to: 'hub' } },
            { label: 'hang it back, gently', goto: { lines: ['I let the chain back onto the hook. The links settle without sound.'], composure: +1, composureGain: 'I have not panicked.', scales: { suspicion: +1 }, to: 'hub' } },
          ],
        },
      },
    },

    // ═════════════════════════════════════════════════════════════════
    //  HUB: engaged
    // ═════════════════════════════════════════════════════════════════

    ask_who_they_are: {
      label: 'ask who they are',
      desc: 'Plainly. Through the wood.',
      when: (p, _pl, hub) => hub === 'engaged' && !p.flags.asked_who,
      entry: 'ask',
      nodes: {
        ask: {
          lines: [
            'I say: who are you. The two of you.',
            'The shorter one says: ~~we are children, mister. From Saint Anselm\'s. Down the road.~~',
            (p) => p.flags.heard_lesson
              ? 'It is the rehearsed answer, word for word. He wrote it. She has delivered it.'
              : 'Saint Anselm\'s. ~~I have heard the name. I do not remember in what context.~~',
          ],
          scales: { suspicion: (p) => p.flags.heard_lesson ? +4 : +3 },
          flags: { asked_who: true, knows_anselms: true, mister_count: (p) => (p.flags.mister_count || 0) + 1 },
          choices: [
            { label: 'ask which Saint Anselm\'s', goto: 'which' },
            { label: 'ask who taught them to answer like that', goto: 'taught' },
            { label: 'let it go', goto: { to: 'hub' } },
          ],
        },
        which: {
          lines: [
            'I say: there are two Saint Anselm\'s within a mile of here. Which.',
            'There is a pause. The taller one murmurs something into her ear. The shorter one says: ~~the one with the red roof, mister.~~',
            'Neither of them has a red roof. ~~Neither of them has had a roof for some years.~~',
          ],
          scales: { suspicion: +5, invitation: -1 },
          flags: { caught_anselm_lie: true, caught_them_out: true },
          composure: +1,
          composureGain: 'Caught. On the record.',
          choices: [
            { label: 'let it go', goto: { to: 'hub' } },
          ],
        },
        taught: {
          lines: [
            'I say: who taught you to answer that way. Both at the same time.',
            'The taller one says, immediately: ~~our mother, mister. She taught us to be polite.~~',
            'It is the first thing he has said. It does not match how he speaks to her.',
          ],
          scales: { suspicion: +4 },
          flags: { taller_spoken: true },
          choices: [
            { label: 'let it go', goto: { to: 'hub' } },
          ],
        },
      },
    },

    ask_what_they_want: {
      label: 'ask what they want',
      desc: 'Plainly.',
      when: (p, _pl, hub) => hub === 'engaged' && !p.flags.asked_want,
      entry: 'ask',
      nodes: {
        ask: {
          lines: [
            'I say: what do you want.',
            'The shorter one says: ~~to come in. Just to come in. Just for a little while. Until our mother comes for us.~~',
            'She does not say the phrase. She produces it, the way you produce a ticket.',
          ],
          scales: { invitation: +2, suspicion: +1 },
          flags: { asked_want: true, asked_want_turn: p => p.turn, mister_count: (p) => (p.flags.mister_count || 0) + 1 },
          choices: [
            { label: 'ask where your mother is', goto: 'mother' },
            { label: 'repeat the phrase back to her', goto: 'repeat' },
            { label: 'let her wait', goto: { to: 'hub' } },
          ],
        },
        mother: {
          lines: [
            'I say: where is your mother. Where did she go.',
            'The shorter one says, slowly: ~~she went to find a telephone. To call our father. He was on a ship.~~',
            'A pause. ~~She has been gone a while.~~',
          ],
          scales: { invitation: +3, suspicion: +2 },
          flags: { asked_mother: true, asked_mother_turn: p => p.turn },
          composure: -1,
          composureCost: 'I was almost more worried about their mother than about them.',
          choices: [
            { label: 'ask about the ship', goto: 'ship' },
            { label: 'let it go', goto: { to: 'hub' } },
          ],
        },
        ship: {
          lines: [
            'I say: tell me about your father. The ship.',
            'The shorter one says: ~~he had not been home in some months. Then there was a telegram.~~',
            'A long pause. ~~Then the telegram. Then nothing.~~',
          ],
          scales: { invitation: +4, suspicion: +1 },
          flags: { asked_father: true },
          composure: -2,
          composureCost: 'Then the telegram. Then nothing.',
          choices: [
            { label: 'let it go', goto: { to: 'hub' } },
          ],
        },
        repeat: {
          lines: [
            'I say, slowly: just to come in. Just for a little while. Until our mother comes for us.',
            'I have her cadence. The shorter one is quiet. Then she says: ~~you say it nicely, mister.~~',
            'She did not expect me to say it back.',
          ],
          scales: { suspicion: +4, invitation: +1 },
          flags: { repeated_phrase: true },
          composure: -1,
          composureCost: 'She did not expect it.',
          choices: [
            { label: 'let it go', goto: { to: 'hub' } },
          ],
        },
      },
    },

    ask_their_names: {
      label: 'ask their names',
      desc: 'Both of them.',
      when: (p, _pl, hub) => hub === 'engaged' && !p.flags.asked_names,
      entry: 'ask',
      nodes: {
        ask: {
          lines: [
            'I say: tell me your names. Both of you.',
            'The shorter one says: ~~Hannah.~~ The taller one does not speak. The shorter one says: ~~he is shy. His name is Thomas.~~',
            (p) => p.flags.heard_lesson
              ? 'Thomas was one of the numbers the taller one was reciting. Not a name. ~~A number.~~'
              : 'Hannah is fast. Thomas is given second-hand.',
          ],
          scales: { suspicion: +3 },
          flags: { asked_names: true, mister_count: (p) => (p.flags.mister_count || 0) + 1 },
          choices: [
            { label: 'ask Thomas to speak for himself', goto: 'thomas' },
            { label: 'ask for surnames', goto: 'surnames' },
            { label: 'let it go', goto: { to: 'hub' } },
          ],
        },
        thomas: {
          lines: [
            'I say: Thomas. Say your own name.',
            'There is a long pause. The shorter one murmurs: ~~go on. He said your name.~~',
            'Then the taller one says, evenly: ~~Thomas, mister.~~ The exact volume of the shorter one. The exact pitch.',
          ],
          scales: { suspicion: +6 },
          flags: { thomas_spoke: true, taller_spoken: true },
          composure: -1,
          composureCost: 'The exact pitch.',
          choices: [
            { label: 'let it go', goto: { to: 'hub' } },
          ],
        },
        surnames: {
          lines: [
            'I say: your surnames. Both.',
            'There is a pause long enough to confer in. The shorter one says: ~~we do not use them, mister. Our mother said it was rude.~~',
            'She has the answer ready. It is not the kind of answer a child has ready.',
          ],
          scales: { suspicion: +4 },
          flags: { surnames_dodged: true },
          choices: [
            { label: 'let it go', goto: { to: 'hub' } },
          ],
        },
      },
    },

    change_the_subject: {
      label: 'change the subject',
      desc: 'Pivot. Take charge of the rhythm.',
      when: (p, _pl, hub) => hub === 'engaged' && !p.flags.changed_subject,
      entry: 'pivot',
      nodes: {
        pivot: {
          lines: [
            'I say: tell me something else. Something that is not about coming in.',
            'There is a pause. The shorter one says, more slowly: ~~what would you like to hear about, mister?~~',
            'She does not know what to do with the question. She is waiting to be told what topic is safe.',
          ],
          scales: { suspicion: +2, invitation: -1 },
          flags: { changed_subject: true },
          choices: [
            { label: 'ask what colour her dress is', goto: 'dress' },
            { label: 'ask what the corridor smells like', goto: 'smell' },
            { label: 'let it go', goto: { to: 'hub' } },
          ],
        },
        dress: {
          lines: [
            'I say: what colour is your dress.',
            'A pause. The shorter one says: ~~blue, mister.~~ The taller one says, immediately after: ~~blue.~~',
            'I did not ask him.',
          ],
          scales: { suspicion: +4 },
          composure: -1,
          composureCost: 'I did not ask him.',
          choices: [
            { label: 'let it go', goto: { to: 'hub' } },
          ],
        },
        smell: {
          lines: [
            'I say: what does the corridor smell like, where you are.',
            'A longer pause. The shorter one says: ~~the corridor smells like a corridor, mister.~~',
            'She did not have the answer rehearsed. She was honest. The honesty is worse than the rehearsals.',
          ],
          scales: { suspicion: +3, invitation: +1 },
          composure: -2,
          composureCost: 'The honesty was worse.',
          choices: [
            { label: 'let it go', goto: { to: 'hub' } },
          ],
        },
      },
    },

    examine_while_talking: {
      label: 'sneak a look through the peephole',
      desc: 'They will hear you move.',
      when: (p, _pl, hub) => hub === 'engaged' && !p.flags.snuck_a_look,
      entry: 'lean',
      nodes: {
        lean: {
          lines: [
            'I lean very slowly toward the peephole. The shorter one stops mid-please.',
            'She says: ~~mister? Are you looking?~~',
          ],
          choices: [
            { label: 'look anyway', goto: 'look' },
            { label: 'pretend you were not', goto: 'pretend' },
            { label: 'admit you were', goto: 'admit' },
          ],
        },
        look: {
          lines: [
            'I press in. Her eye is at the lens. ~~Hello, mister.~~ She smiles. The teeth are wrong.',
          ],
          scales: { suspicion: +5, invitation: -1 },
          flags: { saw_eye: true, snuck_a_look: true },
          composure: -2,
          composureCost: 'The teeth.',
          choices: [
            { label: 'pull back', goto: { to: 'hub', forceState: 'tense' } },
          ],
        },
        pretend: {
          lines: [
            'I step back. I say nothing. She says, gently: ~~that is alright, mister. We can wait until you are sure.~~',
          ],
          scales: { invitation: +2, suspicion: +1 },
          flags: { snuck_a_look: true },
          choices: [
            { label: 'return to the conversation', goto: { to: 'hub' } },
          ],
        },
        admit: {
          lines: [
            'I say: yes. I was looking.',
            'She says: ~~good, mister. We have been hoping you would see us properly.~~',
          ],
          scales: { invitation: +3 },
          flags: { snuck_a_look: true },
          composure: -1,
          composureCost: 'She has been hoping.',
          choices: [
            { label: 'return to the conversation', goto: { to: 'hub' } },
          ],
        },
      },
    },

    end_the_conversation: {
      label: 'end the conversation',
      desc: 'Stop responding. Step away.',
      when: (p, _pl, hub) => hub === 'engaged' && p.turn >= 3,
      entry: 'stop',
      nodes: {
        stop: {
          lines: [
            'I stop. I say: I am not talking to you anymore.',
            'There is a long pause. The shorter one says: ~~that is alright, mister. We can wait.~~',
            'She has not lowered her voice. She has not raised it. She has simply waited.',
          ],
          scales: { suspicion: +2 },
          flags: { ended_conversation: true, engaged: false },
          choices: [
            { label: 'step back from the door', goto: { to: 'hub' } },
          ],
        },
      },
    },

    make_small_talk: {
      label: 'make small talk',
      desc: 'Pretend it is normal.',
      when: (p, _pl, hub) => hub === 'engaged' && !p.flags.made_small_talk,
      entry: 'open',
      nodes: {
        open: {
          lines: [
            'I say: cold tonight, isn\'t it.',
            'The shorter one says: ~~yes, mister. Very cold. That is why we want to come in.~~',
            'The pivot is smooth. Smoother than a child.',
          ],
          scales: { suspicion: +2, invitation: +1 },
          flags: { made_small_talk: true },
          choices: [
            { label: 'try a different topic', goto: 'topic' },
            { label: 'let her have the pivot', goto: { to: 'hub' } },
          ],
        },
        topic: {
          lines: [
            'I say: did you walk a long way to get here.',
            'A pause. The shorter one says: ~~we walked, mister.~~ The taller one says nothing. She does not specify how far.',
            'I have asked five questions. She has answered three of them.',
          ],
          scales: { suspicion: +3 },
          composure: -1,
          composureCost: 'She has answered three.',
          choices: [
            { label: 'let it go', goto: { to: 'hub' } },
          ],
        },
      },
    },

    // ═════════════════════════════════════════════════════════════════
    //  HUB: mother_story
    // ═════════════════════════════════════════════════════════════════

    listen_to_more: {
      label: 'listen to more',
      desc: 'Let her keep talking.',
      when: (p, _pl, hub) => hub === 'mother_story' && !p.flags.listened_long,
      entry: 'listen',
      nodes: {
        listen: {
          lines: [
            'I let her talk. She tells me about the kitchen. The window over the sink. The radio that was always on a quarter-volume.',
            'A song her mother sang while doing the dishes. She has the melody. She hums it through the door.',
            'I find I have crossed the floor without remembering. My hand is near the bolt.',
          ],
          scales: { invitation: +5, suspicion: -1 },
          flags: { listened_long: true },
          composure: -3,
          composureCost: 'I had crossed the floor without remembering.',
          choices: [
            { label: 'pull your hand back', goto: 'pull' },
            { label: 'ask her to sing it again', goto: 'sing' },
            { label: 'walk away from the door', goto: 'walk' },
          ],
        },
        pull: {
          lines: [
            'I pull my hand back. I look at the back of it the way you look at something you do not own.',
            'The shorter one says: ~~it is alright, mister. You can listen.~~',
          ],
          scales: { invitation: -2, suspicion: +2 },
          composure: +1,
          composureGain: 'My hand is mine again.',
          choices: [
            { label: 'go on', goto: { to: 'hub' } },
          ],
        },
        sing: {
          lines: [
            'I say: sing it again.',
            'She does. The melody is the same melody. The words are slightly different.',
            'My mother used to hum a song like that. The words she changed were the ones my mother changed.',
          ],
          scales: { invitation: +6, suspicion: +3 },
          flags: { they_have_recognized: true, recognition_via: 'song' },
          composure: -3,
          composureCost: 'The words she changed were the ones my mother changed.',
          choices: [
            { label: 'pull back, hard', goto: { to: 'hub', forceState: 'recognized' } },
          ],
        },
        walk: {
          lines: [
            'I take three steps back from the door. I sit on the bed. My hands are open in my lap.',
            'She keeps talking. About the kitchen. About the song. She does not seem to need me to be at the door.',
          ],
          scales: { invitation: -3 },
          composure: +1,
          flags: { in_mother_story: false },
          composureGain: 'She does not need me at the door for this.',
          choices: [
            { label: 'go on', goto: { to: 'hub' } },
          ],
        },
      },
    },

    catch_an_inconsistency: {
      label: 'catch an inconsistency',
      desc: 'She said one thing. Then another.',
      when: (p, _pl, hub) => hub === 'mother_story' && !p.flags.caught_inconsistency,
      entry: 'catch',
      nodes: {
        catch: {
          lines: [
            'I say: you said your father was on a ship. Earlier you said he was at the office.',
            'There is a pause. The shorter one says: ~~did I say that, mister? I am tired.~~',
            'She is not tired. Her cadence has not changed.',
          ],
          scales: { suspicion: +5, invitation: -2 },
          flags: { caught_inconsistency: true },
          choices: [
            { label: 'push the inconsistency', goto: 'push' },
            { label: 'let it slide', goto: 'slide' },
          ],
        },
        push: {
          lines: [
            'I say: which is it. The ship or the office.',
            'A longer pause. The taller one says, finally: ~~the ship, mister. The office was a guess.~~',
            'The shorter one says nothing. She is letting him take it.',
          ],
          scales: { suspicion: +6, invitation: -3 },
          flags: { caught_them_out: true, taller_spoken: true },
          composure: +1,
          composureGain: 'I have a small breath back.',
          choices: [
            { label: 'let it go', goto: { to: 'hub', forceState: 'tense' } },
          ],
        },
        slide: {
          lines: [
            'I say: alright.',
            'The shorter one says, more gently: ~~thank you, mister.~~',
            'She knows I let it slide.',
          ],
          scales: { invitation: +3, suspicion: +1 },
          composure: -1,
          composureCost: 'She knew I let it slide.',
          choices: [
            { label: 'go on', goto: { to: 'hub' } },
          ],
        },
      },
    },

    name_what_youre_feeling: {
      label: 'name what you are feeling',
      desc: 'Out loud. To them. Or to yourself.',
      when: (p, _pl, hub) => hub === 'mother_story' && !p.flags.named_feeling,
      entry: 'name',
      nodes: {
        name: {
          lines: [
            'I say, out loud: I am being made to sympathize. This is what that feels like.',
            'There is a long pause. The shorter one says: ~~it is alright, mister. It is alright to feel that.~~',
            'She did not deny it. She gave me permission.',
          ],
          scales: { suspicion: +4, invitation: -2 },
          flags: { named_feeling: true },
          composure: +2,
          composureGain: 'The room is mine again.',
          choices: [
            { label: 'press on', goto: 'press' },
            { label: 'go on', goto: { to: 'hub' } },
          ],
        },
        press: {
          lines: [
            'I say: I do not want to feel this. I want you to stop.',
            'The shorter one says, very softly: ~~we know, mister. We are not making you feel anything you did not want to.~~',
            'The phrase is exactly right. Exactly. Right.',
          ],
          scales: { suspicion: +6, invitation: -1 },
          composure: -1,
          composureCost: 'Exactly right.',
          choices: [
            { label: 'pull all the way back', goto: { to: 'hub', forceState: 'tense', flags: { in_mother_story: false } } },
          ],
        },
      },
    },

    pull_back_abruptly: {
      label: 'pull back abruptly',
      desc: 'Interrupt her. Loudly.',
      when: (p, _pl, hub) => hub === 'mother_story' && !p.flags.pulled_back_abruptly,
      entry: 'cut',
      nodes: {
        cut: {
          lines: [
            'I say, louder than I mean to: stop. Stop talking about the kitchen.',
            'There is a long quiet. The shorter one says, very softly: ~~alright, mister. I am sorry.~~',
            'She sounds like she is about to cry. The crying does not come.',
          ],
          scales: { suspicion: +3, invitation: -3 },
          flags: { pulled_back_abruptly: true, in_mother_story: false },
          composure: +1,
          composureGain: 'I have my own breathing back.',
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    // ═════════════════════════════════════════════════════════════════
    //  HUB: tense
    // ═════════════════════════════════════════════════════════════════

    confront_what_you_caught: {
      label: 'tell them what you noticed',
      desc: 'Name a catch out loud.',
      // Visible whenever any catch is still unaddressed. One catch per visit
      // (each inner choice exits to hub), but the spoke stays in the menu
      // across hubs and turns until every catch has been used.
      when: (p, _pl, hub) => (hub === 'tense' || hub === 'engaged' || hub === 'pressing' || hub === 'mother_story')
        && ((p.flags.heard_lesson      && !p.flags.confronted_rehearsal)
         || (p.flags.counted_prints    && !p.flags.addressed_third)
         || (p.flags.caught_them_out   && !p.flags.confronted_contradiction)),
      entry: 'pick',
      nodes: {
        pick: {
          lines: [
            'I open my mouth at the door. I pick one of the things I have caught.',
          ],
          choices: [
            { label: 'i heard you rehearse',            when: (p) => p.flags.heard_lesson   && !p.flags.confronted_rehearsal,    goto: 'rehearse' },
            { label: 'i counted three sets of prints',  when: (p) => p.flags.counted_prints && !p.flags.addressed_third,         goto: 'prints' },
            { label: 'i caught the contradiction',      when: (p) => p.flags.caught_them_out && !p.flags.confronted_contradiction, goto: 'contradict' },
          ],
        },
        rehearse: {
          lines: [
            'I say: I heard you. I heard you teaching her how to ask.',
            'A long quiet. The shorter one says, after a beat: ~~that is alright, mister. He has been teaching me for a while.~~',
            'She says it the way one admits to a small habit.',
          ],
          scales: { suspicion: +5, invitation: -3 },
          flags: { confronted_anything: true, confronted_rehearsal: true },
          composure: +1,
          composureGain: 'My breath is steadier for having said it.',
          choices: [
            { label: 'press on', goto: { to: 'hub' } },
          ],
        },
        prints: {
          lines: [
            'I say: there are three sets of prints in the corridor. Whose is the third.',
            'A long pause. The taller one speaks for the first time at volume: ~~the one who showed us your door, mister.~~',
            'The shorter one is letting him answer.',
          ],
          scales: { suspicion: +7, invitation: -1 },
          flags: { confronted_anything: true, addressed_third: true, taller_speaking: true, who_showed: true },
          composure: +2,
          composureGain: 'Naming the third set out loud has put my feet under me.',
          choices: [
            { label: 'press on', goto: { to: 'hub' } },
          ],
        },
        contradict: {
          lines: [
            'I say: you contradicted yourself. You are not who you said you were.',
            'A pause. The shorter one says, gently: ~~we are who we say we are, mister. We are who you let us be.~~',
            'I do not remember letting them be anything.',
          ],
          scales: { suspicion: +5, invitation: -2 },
          flags: { confronted_anything: true, confronted_contradiction: true },
          composure: +1,
          composureGain: 'I have named one of their seams.',
          choices: [
            { label: 'press on', goto: { to: 'hub' } },
          ],
        },
      },
    },

    keep_asking_questions: {
      label: 'keep asking questions',
      desc: 'They are answering even more carefully now.',
      when: (p, _pl, hub) => hub === 'tense' && !p.flags.tense_questions_done,
      entry: 'pick',
      nodes: {
        pick: {
          lines: ['I have things I have not asked. They are watching me decide.'],
          choices: [
            { label: 'ask which school again', when: (p) => p.flags.knows_anselms && !p.flags.asked_school, goto: 'school' },
            { label: 'ask about the telephone', when: (p) => p.flags.asked_mother && !p.flags.asked_telephone, goto: 'phone' },
            { label: 'ask who their mother really is', when: (p) => p.flags.asked_mother, goto: 'mother_real' },
            { label: 'go quiet for a moment', goto: { to: 'hub' } },
          ],
        },
        school: {
          lines: [
            'I say: Saint Anselm\'s. Tell me about it.',
            'The shorter one says, brightly: ~~it is down the road. We walk to it every morning. We come back the same way.~~',
            'Saint Anselm\'s has been demolished for some decades.',
          ],
          scales: { suspicion: +5 },
          flags: { tense_questions_done: true, asked_school: true },
          composure: -1,
          composureCost: 'Demolished for some decades.',
          choices: [
            { label: 'let it go', goto: { to: 'hub' } },
          ],
        },
        phone: {
          lines: [
            'I say: which telephone. The nearest one is at the end of the ward. It is locked at this hour.',
            'A pause. The shorter one says: ~~there is one at the school, mister. She would have walked there.~~',
            'Saint Anselm\'s has not had a working telephone in a long time.',
          ],
          scales: { suspicion: +5, invitation: -1 },
          flags: { tense_questions_done: true, asked_telephone: true },
          composure: -1,
          composureCost: 'She has an answer for everything.',
          choices: [
            { label: 'let it go', goto: { to: 'hub' } },
          ],
        },
        mother_real: {
          lines: [
            'I say: who is your mother. Really.',
            'A long pause. The taller one says: ~~she was a good woman, mister. She does not need to be more than that to you.~~',
          ],
          scales: { suspicion: +4 },
          flags: { tense_questions_done: true, taller_spoken: true },
          choices: [
            { label: 'let it go', goto: { to: 'hub' } },
          ],
        },
      },
    },

    test_them: {
      label: 'ask a question only a child knows',
      desc: 'Colour. A small test.',
      when: (p, _pl, hub) => hub === 'tense' && !p.flags.tested,
      entry: 'test',
      nodes: {
        test: {
          lines: [
            'I say: what colour is the sky in the afternoon.',
            'A pause. Long enough to count to four. The shorter one says: ~~blue.~~',
            'I say: at sunset. The shorter one does not answer. The taller one says, softly, into her ear: ~~orange. Say orange.~~ She says: ~~orange.~~ A beat late.',
          ],
          scales: { suspicion: +6, invitation: -1 },
          flags: { tested: true, tested_turn: p => p.turn },
          composure: -1,
          composureCost: 'He had to tell her the colour.',
          choices: [
            { label: 'press the catch', goto: 'press' },
            { label: 'let it sit', goto: { to: 'hub' } },
          ],
        },
        press: {
          lines: [
            'I say: he told you the colour. I heard him. He said orange first.',
            'The shorter one is quiet. The taller one says, with no inflection: ~~she does not see colours, mister. I have been the one who knows them for her.~~',
            'It is the worst answer he could have given. It is also the truth. I have it.',
          ],
          scales: { suspicion: +6 },
          flags: { challenged_orange: true, taller_speaking: true },
          composure: +1,
          composureGain: 'I have the worst answer he could have given.',
          choices: [
            { label: 'let it go', goto: { to: 'hub' } },
          ],
        },
      },
    },

    start_to_defend: {
      label: 'set the chain',
      desc: 'Drop it into the keep. Commit.',
      when: (p, _pl, hub) => hub === 'tense' && !p.flags.chain_set,
      entry: 'commit',
      nodes: {
        commit: {
          lines: [
            'I lift the chain in my hand. It is heavier than it should be.',
          ],
          choices: [
            { label: 'drop it into the keep', goto: 'drop' },
            { label: 'hang it back, quietly', goto: 'hang' },
          ],
        },
        drop: {
          lines: [
            'I let the chain drop into the keep. The metal taps the door.',
            'The voices outside stop. For one beat. Two.',
            'The shorter one says, more softly than before: ~~please. We will be quick. We only need a moment.~~',
          ],
          scales: { latch: +6, invitation: -3, suspicion: +1 },
          flags: { chain_set: true },
          composure: +1,
          composureGain: 'The door is doubled. I am steadier for it.',
          choices: [
            { label: 'step back', goto: { to: 'hub', forceState: 'barricaded' } },
          ],
        },
        hang: {
          lines: [
            'I let the chain back onto the hook. The links settle.',
            'The shorter one says: ~~thank you, mister. We knew you would not.~~',
            'I did not say I would not. She decided for me.',
          ],
          scales: { invitation: +2, suspicion: +1 },
          composure: -1,
          composureCost: 'She decided for me.',
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    match_their_breathing: {
      label: 'match their breathing',
      desc: 'A sympathetic risk.',
      when: (p, _pl, hub) => hub === 'tense' && p.flags.overheard && !p.flags.matched_breathing,
      entry: 'match',
      nodes: {
        match: {
          lines: [
            'I slow my breath. I match the shorter one\'s rhythm. In. Out. Three counts.',
            'After a minute her breath has matched mine. So has the taller one\'s. The three of us breathe at the same rate.',
            'I do not know who began matching whom.',
          ],
          scales: { invitation: +3, suspicion: +2 },
          flags: { matched_breathing: true, synced: true },
          composure: -2,
          composureCost: 'I did not know who began matching whom.',
          choices: [
            { label: 'break the rhythm', goto: 'break' },
            { label: 'hold the rhythm', goto: 'hold' },
          ],
        },
        break: {
          lines: [
            'I take a fast shallow breath. Then a long one. I refuse the pattern.',
            'After a beat, on the other side of the door, the shorter one\'s breath matches my new rhythm. So does the taller one\'s.',
            'I cannot get them off my breathing.',
          ],
          scales: { suspicion: +5, invitation: -1 },
          flags: { unsynced: true },
          composure: -2,
          composureCost: 'I cannot get them off my breathing.',
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
        hold: {
          lines: [
            'I let the rhythm run. The three of us breathe together for a long minute.',
            'The shorter one says, softly, on an exhale: ~~thank you, mister. That helps.~~',
            'I do not know what it helps.',
          ],
          scales: { invitation: +5, suspicion: +1 },
          composure: -3,
          composureCost: 'I did not know what it helped.',
          choices: [
            { label: 'pull away', goto: { to: 'hub' } },
          ],
        },
      },
    },

    tell_them_what_you_know: {
      label: 'tell them what you know',
      desc: 'Out loud. The whole of it.',
      when: (p, _pl, hub) => hub === 'tense' && p.scales.suspicion >= 12 && !p.flags.told_what_you_know,
      entry: 'tell',
      nodes: {
        tell: {
          lines: [
            'I say: I know what you are. I know you cannot come in unless I say. I know there is one of you I have not heard yet.',
            'There is a long quiet. The taller one says, evenly: ~~we have known you know, mister. We did not need to be told.~~',
            'The shorter one says: ~~it is alright. We can wait.~~',
          ],
          scales: { suspicion: +3, invitation: -3 },
          flags: { told_what_you_know: true },
          composure: +2,
          composureGain: 'The naming has put me back in my body.',
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    // ═════════════════════════════════════════════════════════════════
    //  HUB: pressing
    // ═════════════════════════════════════════════════════════════════

    say_your_own_name: {
      label: 'say your own name',
      desc: 'Out loud. An anchor.',
      when: (p, _pl, hub) => hub === 'pressing' && !p.flags.said_name,
      entry: 'say',
      nodes: {
        say: {
          lines: [
            'I say my name. Full. Out loud. Twice. Then my number.',
            'The room is solid around me. I have stopped reaching for the bolt.',
            'The shorter one outside says, quietly: ~~that is a good name, mister. You should hear how I would say it.~~',
          ],
          scales: { invitation: -5, suspicion: +2 },
          flags: { said_name: true },
          composure: +2,
          composureGain: 'I have my own name in the room.',
          choices: [
            { label: 'say it again', goto: 'again' },
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
        again: {
          lines: [
            'I say it again. Slower. The shape of every syllable.',
            'The shorter one is quiet. The taller one says: ~~that is enough for now, mister.~~',
          ],
          scales: { invitation: -3 },
          composure: +1,
          composureGain: 'I take my hand off the wall.',
          choices: [
            { label: 'go on', goto: { to: 'hub' } },
          ],
        },
      },
    },

    bite_the_inside_of_your_cheek: {
      label: 'bite the inside of your cheek',
      desc: 'A sting. Stay here.',
      when: (p, _pl, hub) => hub === 'pressing' && !p.flags.bit_cheek,
      entry: 'bite',
      nodes: {
        bite: {
          lines: [
            'I bite. A small sting. A small bit of blood.',
            'The room steadies. The bolt is set. My hand is in my pocket.',
            'The shorter one says, after a beat: ~~that was not necessary, mister.~~',
          ],
          scales: { invitation: -4 },
          flags: { bit_cheek: true },
          composure: +1,
          composureGain: 'The room is solid. So am I.',
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    recite_an_address: {
      label: 'recite an address',
      desc: 'Anywhere you have lived. Anchor.',
      when: (p, _pl, hub) => hub === 'pressing' && !p.flags.recited_address,
      entry: 'say',
      nodes: {
        say: {
          lines: [
            'I say an address out loud. A street. A city. A postal code.',
            'It is mine. Or it was mine.',
          ],
          scales: { invitation: -3 },
          flags: { recited_address: true },
          composure: +1,
          composureGain: 'The walls go where they should be.',
          choices: [
            { label: 'say another one', goto: 'another' },
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
        another: {
          lines: [
            'I say a second address. My grandmother\'s. Then a school. Then the street I lived on as a child.',
            'The shorter one says, when I stop: ~~we know all of those, mister. You can say them in any order.~~',
          ],
          scales: { invitation: -2, suspicion: +5 },
          composure: -2,
          composureCost: 'They knew all of them.',
          choices: [
            { label: 'pull back, hard', goto: { to: 'hub', forceState: 'tense' } },
          ],
        },
      },
    },

    refuse_the_word: {
      label: 'refuse the word',
      desc: 'Say no. Plainly.',
      when: (p, _pl, hub) => hub === 'pressing' && !p.flags.refused_word,
      entry: 'refuse',
      nodes: {
        refuse: {
          lines: [
            'I say: no. The answer is no. I am not letting you in.',
            'A pause. The shorter one says: ~~that is alright, mister. We have all night.~~',
            'The asking does not stop. It does not speed up either.',
          ],
          scales: { invitation: -3, suspicion: +2 },
          flags: { refused_word: true },
          composure: +1,
          composureGain: 'I have given a thing a name.',
          choices: [
            { label: 'say it again, louder', goto: 'louder' },
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
        louder: {
          lines: [
            'I say it louder. NO.',
            'The shorter one is quiet for one beat. Then she says, more softly: ~~you do not have to shout, mister. We can hear you.~~',
          ],
          scales: { invitation: -4, suspicion: +1 },
          composure: +1,
          composureGain: 'I am still here.',
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    bargain_with_them: {
      label: 'bargain with them',
      desc: 'Try to negotiate. Risky.',
      when: (p, _pl, hub) => hub === 'pressing' && !p.flags.tried_bargain,
      entry: 'open',
      nodes: {
        open: {
          lines: [
            'I say: I will not let you in. But I can call someone. I can do something else.',
            'A pause. The shorter one says: ~~there is nothing else to do, mister. Only the door is open.~~',
            'The door is not open.',
          ],
          scales: { suspicion: +3, invitation: +1 },
          flags: { tried_bargain: true },
          choices: [
            { label: 'offer to open the food slot', goto: 'slot' },
            { label: 'offer to call your nurse', goto: 'nurse' },
            { label: 'withdraw the offer', goto: 'withdraw' },
          ],
        },
        slot: {
          lines: [
            'I say: there is a slot at the bottom of the door. For trays. I can open that.',
            'A long pause. The shorter one says, slowly: ~~yes, mister. That would be very kind.~~',
            'The taller one says, very quietly: ~~it would not need to be very wide.~~',
          ],
          scales: { invitation: +4, suspicion: +3 },
          composure: -3,
          composureCost: 'It would not need to be very wide.',
          flags: { offered_slot: true },
          choices: [
            { label: 'withdraw the offer', goto: 'withdraw' },
            { label: 'open the slot', goto: 'open_slot' },
          ],
        },
        nurse: {
          lines: [
            'I say: I can call my nurse. She can take you somewhere warm. Not here.',
            'A pause. The shorter one says: ~~we have spoken to her. She did not hear us.~~',
            'I have not seen the night nurse since dinner.',
          ],
          scales: { suspicion: +4, invitation: -1 },
          flags: { tried_nurse_offer: true },
          choices: [
            { label: 'withdraw the offer', goto: 'withdraw' },
          ],
        },
        withdraw: {
          lines: [
            'I say: never mind. Forget I offered.',
            'The shorter one says, very softly: ~~you cannot un-offer something, mister. We heard you.~~',
          ],
          scales: { suspicion: +2 },
          composure: -2,
          composureCost: 'You cannot un-offer.',
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
        open_slot: {
          lines: [
            'I bend to the food slot. My hand is on the flap. I am about to do it.',
            'The shorter one is below it, very close. I can hear her breathing through the flap.',
          ],
          scales: { invitation: +5 },
          choices: [
            { label: 'open it', goto: 'opened_slot' },
            { label: 'pull your hand back', goto: { lines: ['I pull my hand back. I stand up too fast and my pulse is in my ears.', 'The shorter one says, gently: ~~next time, mister.~~'], scales: { invitation: -2, suspicion: +2 }, composure: -2, composureCost: 'Next time.', to: 'hub' } },
          ],
        },
        opened_slot: {
          lines: [
            '!!I open the slot. Three fingers come through it. They are not a child\'s fingers.!!',
            'The slot will not close again. The fingers are holding it.',
          ],
          scales: { latch: -8, invitation: +6 },
          flags: { slot_opened: true },
          composure: -4,
          composureCost: '!!The fingers were not a child\'s.!!',
          shake: true,
          choices: [
            { label: 'kick the slot shut', goto: { lines: ['I bring my heel down on the slot. The fingers withdraw. The flap closes but does not latch.', '!!The latch on the slot is broken.!!'], scales: { latch: +2 }, flags: { slot_broken: true }, to: 'hub' } },
            { label: 'stagger back', goto: { lines: ['I stagger back. The slot is open. The hand is in the room.'], scales: { invitation: +5 }, flags: { in_the_room: true }, to: 'hub' } },
          ],
        },
      },
    },

    step_back_from_the_door: {
      label: 'step back from the door',
      desc: 'A pace. Sit on the bed.',
      when: (p, _pl, hub) => hub === 'pressing' && !p.flags.stepped_far_back,
      entry: 'back',
      nodes: {
        back: {
          lines: [
            'I take a step back. Another. My calves find the bed. I sit.',
            'The asking does not change. The volume does not change. The distance does.',
          ],
          scales: { invitation: -3 },
          flags: { stepped_far_back: true },
          composure: +1,
          composureGain: 'The distance is mine.',
          choices: [
            { label: 'lie down', goto: 'lie' },
            { label: 'stand again', goto: { to: 'hub' } },
          ],
        },
        lie: {
          lines: [
            'I lie back. My eyes are on the ceiling. The asking is on my left.',
            'The shorter one says: ~~he has lain down, Thomas. He is going to think about it.~~',
            'I had not told her I had lain down.',
          ],
          scales: { suspicion: +4, invitation: +1 },
          composure: -2,
          composureCost: 'She knew.',
          choices: [
            { label: 'sit up', goto: { to: 'hub' } },
          ],
        },
      },
    },

    almost_open_the_door: {
      label: 'open the door',
      desc: 'Just to look.',
      when: (p, _pl, hub) => hub === 'pressing' && p.scales.invitation >= 16 && !p.flags.chair_wedged && !p.flags.chain_set,
      entry: 'reach',
      nodes: {
        reach: {
          lines: [
            'I take the chain off. I slide the bolt back. I open the door three fingers.',
            'The shorter one\'s hand is on the edge before there is an edge. The taller one is past me before I am ready.',
            'She looks up at me. The whites of her eyes are not there.',
          ],
          scales: { latch: -12, invitation: +10 },
          composure: -4,
          composureCost: '!!I gave them the gap. They were ready for it.!!',
          flags: { opened: true, in_the_room: true },
          shake: true,
          choices: [
            { label: '...', goto: { to: 'hub' } },
          ],
        },
      },
    },

    // ═════════════════════════════════════════════════════════════════
    //  HUB: screaming
    // ═════════════════════════════════════════════════════════════════

    drop_the_chain_now: {
      label: 'drop the chain',
      desc: 'Set the second lock. Now.',
      when: (p, _pl, hub) => hub === 'screaming' && !p.flags.chain_set,
      entry: 'drop',
      nodes: {
        drop: {
          lines: [
            'I lift the chain. My hand is shaking. I let it drop into the keep.',
            'The metal taps the door. Under the screaming, the tap is the loudest sound in the room.',
            'The screaming does not stop. It quiets a degree.',
          ],
          scales: { latch: +6, invitation: -4, suspicion: +1 },
          flags: { chain_set: true },
          composure: +2,
          composureGain: 'I have done a thing in the middle of it.',
          choices: [
            { label: 'step back', goto: { to: 'hub', forceState: 'barricaded' } },
          ],
        },
      },
    },

    wedge_the_chair_screaming: {
      label: 'wedge the chair under the handle',
      desc: 'Drag it. Drive it home.',
      when: (p, _pl, hub) => hub === 'screaming' && !p.flags.chair_wedged,
      entry: 'wedge',
      nodes: {
        wedge: {
          lines: [
            'I take the chair. I drag it. The legs squeal against the linoleum.',
            'I tilt it. The back goes under the handle. I press the seat down until it stops.',
            'The screaming continues. The door does not move.',
          ],
          scales: { latch: +6, invitation: -3, suspicion: +1 },
          flags: { chair_wedged: true },
          composure: +1,
          composureGain: 'Neither do I.',
          choices: [
            { label: 'step back', goto: { to: 'hub', forceState: 'barricaded' } },
          ],
        },
      },
    },

    shout_back: {
      label: 'shout back at them',
      desc: 'Match their volume.',
      when: (p, _pl, hub) => hub === 'screaming' && !p.flags.shouted_back,
      entry: 'shout',
      nodes: {
        shout: {
          lines: [
            'I shout. As loud as I can. I tell them to stop.',
            'They do not stop. They get louder. The taller one is laughing under it. The laugh is older than his voice.',
          ],
          scales: { suspicion: +2, invitation: -1 },
          flags: { shouted_back: true },
          composure: -2,
          composureCost: 'The laugh was older than his voice.',
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    hold_yourself_still: {
      label: 'hold yourself still',
      desc: 'Endure. Do not react.',
      when: (p, _pl, hub) => hub === 'screaming' && !p.flags.held_still_in_screaming,
      entry: 'hold',
      nodes: {
        hold: {
          lines: [
            'I stand in the middle of the room. My hands at my sides. My breathing slow.',
            'The screaming runs for a long minute. Then it pauses.',
            'The shorter one says, in the pause, quietly: ~~he is not afraid. Stop.~~ The screaming does not resume.',
          ],
          scales: { invitation: -4, suspicion: +3 },
          flags: { held_still_in_screaming: true, they_are_screaming: false, they_have_gone_silent: true, silence_start: p => p.turn },
          composure: +1,
          composureGain: 'She named me not afraid.',
          choices: [
            { label: 'breathe', goto: { to: 'hub', forceState: 'silence' } },
          ],
        },
      },
    },

    cover_your_ears_screaming: {
      label: 'cover your ears',
      desc: 'Stop processing.',
      when: (p, _pl, hub) => hub === 'screaming' && !p.flags.covered_ears,
      entry: 'cover',
      nodes: {
        cover: {
          lines: [
            'I press my palms over my ears. The screaming is in my fingers.',
            'I count to ten. Then twenty. Then thirty.',
            'When I take my hands away, the screaming has thinned. The shorter one is asking again, the way she did at the start.',
          ],
          scales: { invitation: -2, suspicion: +1 },
          flags: { covered_ears: true, they_are_screaming: false },
          composure: -1,
          composureCost: 'I had to stop hearing them.',
          choices: [
            { label: 'lower your hands', goto: { to: 'hub' } },
          ],
        },
      },
    },

    // ═════════════════════════════════════════════════════════════════
    //  HUB: self_harm
    // ═════════════════════════════════════════════════════════════════

    cover_ears_self_harm: {
      label: 'cover your ears',
      desc: 'Refuse to hear it.',
      when: (p, _pl, hub) => hub === 'self_harm' && !p.flags.covered_ears_sh,
      entry: 'cover',
      nodes: {
        cover: {
          lines: [
            'I press my palms over my ears. The sound goes through them anyway.',
            'I can still hear her teeth. I can still hear his silence.',
          ],
          scales: { invitation: -1, suspicion: +2 },
          flags: { covered_ears_sh: true },
          composure: -2,
          composureCost: 'It went through.',
          choices: [
            { label: 'lower your hands', goto: { to: 'hub' } },
          ],
        },
      },
    },

    speak_to_the_shorter_self_harm: {
      label: 'speak to her — gently',
      desc: 'Try to stop her.',
      when: (p, _pl, hub) => hub === 'self_harm' && !p.flags.spoke_to_shorter_sh,
      entry: 'speak',
      nodes: {
        speak: {
          lines: [
            'I say, through the door: stop. Please. You do not have to do that.',
            'The biting stops for a beat. The shorter one says, with her mouth full: ~~we have to, mister. It is the only way you will hear us.~~',
            'She resumes.',
          ],
          scales: { invitation: +3, suspicion: +2 },
          flags: { spoke_to_shorter_sh: true },
          composure: -3,
          composureCost: 'She said it with her mouth full.',
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    address_the_taller_self_harm: {
      label: 'speak to the taller one',
      desc: 'Call out the one who is letting it happen.',
      when: (p, _pl, hub) => hub === 'self_harm' && !p.flags.addressed_taller_sh,
      entry: 'speak',
      nodes: {
        speak: {
          lines: [
            'I say: you. Thomas. You are letting her do that. Stop her.',
            'A long pause. The biting stops.',
            'The taller one says, evenly: ~~she stops when you let us in, mister. She does not stop for me.~~',
            'He says it without raising his voice. He has said it before.',
          ],
          scales: { invitation: +1, suspicion: +5 },
          flags: { addressed_taller_sh: true, taller_speaking: true, they_are_self_harming: false },
          composure: +1,
          composureGain: 'The biting has stopped. The reason has named itself.',
          choices: [
            { label: 'step back', goto: { to: 'hub', forceState: 'tense' } },
          ],
        },
      },
    },

    walk_to_the_window_self_harm: {
      label: 'walk to the window',
      desc: 'Distance. The other side of the room.',
      when: (p, _pl, hub) => hub === 'self_harm' && !p.flags.walked_to_window,
      entry: 'walk',
      nodes: {
        walk: {
          lines: [
            'I cross the room. The window is barred. The courtyard is dark below.',
            'I can hear her biting from here. The room is not big enough to be far from it.',
          ],
          scales: { invitation: -3, suspicion: +1 },
          flags: { walked_to_window: true },
          composure: -2,
          composureCost: 'The room was not big enough.',
          choices: [
            { label: 'cross back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    let_self_harm_run: {
      label: 'let it run its course',
      desc: 'Endure.',
      when: (p, _pl, hub) => hub === 'self_harm' && !p.flags.let_run_sh && p.turn >= 5,
      entry: 'endure',
      nodes: {
        endure: {
          lines: [
            'I sit on the bed. I do not move. I do not speak.',
            'The biting goes for a long time. Then it stops. The shorter one is breathing wetly.',
            'She says, softer than before: ~~that is alright, mister. We tried.~~',
          ],
          scales: { invitation: -4, suspicion: +3 },
          flags: { let_run_sh: true, they_are_self_harming: false, they_have_gone_silent: true, silence_start: p => p.turn },
          composure: -1,
          composureCost: 'I let it go on.',
          choices: [
            { label: 'breathe', goto: { to: 'hub', forceState: 'silence' } },
          ],
        },
      },
    },

    // ═════════════════════════════════════════════════════════════════
    //  HUB: tricking
    // ═════════════════════════════════════════════════════════════════

    call_out_the_trick: {
      label: 'call out the trick',
      desc: 'Name what they are doing.',
      when: (p, _pl, hub) => hub === 'tricking' && !p.flags.called_trick,
      entry: 'name',
      nodes: {
        name: {
          lines: [
            'I say: that is not who you sound like. That is someone you are pretending to be.',
            'A long pause. The voice on the other side returns to the shorter one\'s. She says: ~~we wanted to see if you would notice, mister.~~',
            'She does not sound disappointed.',
          ],
          scales: { suspicion: +5, invitation: -3 },
          flags: { called_trick: true, trick_active: false },
          composure: +2,
          composureGain: 'I have my own voice back in my head.',
          choices: [
            { label: 'step back', goto: { to: 'hub', forceState: 'tense' } },
          ],
        },
      },
    },

    play_along: {
      label: 'play along',
      desc: 'See where it goes.',
      when: (p, _pl, hub) => hub === 'tricking' && !p.flags.played_along,
      entry: 'along',
      nodes: {
        along: {
          lines: [
            'I say: I am here. I am listening.',
            'The voice on the other side says, in the borrowed cadence: ~~it has been so long. Will you let me in.~~',
            'The phrasing is familiar. It is not quite how she phrased things.',
          ],
          scales: { invitation: +5, suspicion: +3 },
          flags: { played_along: true },
          composure: -2,
          composureCost: 'The phrasing was almost right.',
          choices: [
            { label: 'press for a specific detail', goto: 'detail' },
            { label: 'withdraw', goto: 'withdraw' },
          ],
        },
        detail: {
          lines: [
            'I ask: what did you call me. When I was small.',
            'A long pause. The voice says, in a slightly different shade of the same cadence: ~~something kind, mister. Something only you would know.~~',
            'The pronoun has slipped. I have one.',
          ],
          scales: { suspicion: +6, invitation: -2 },
          flags: { caught_pronoun_slip: true, trick_active: false },
          composure: +1,
          composureGain: 'The pronoun slipped. I have one.',
          choices: [
            { label: 'pull all the way back', goto: { to: 'hub', forceState: 'tense' } },
          ],
        },
        withdraw: {
          lines: [
            'I say: I am not playing this anymore.',
            'The voice returns to the shorter one\'s. She says: ~~that is alright, mister. It was worth a try.~~',
          ],
          scales: { suspicion: +3, invitation: -2 },
          flags: { trick_active: false },
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    ask_a_specific_test: {
      label: 'ask only-you-would-know',
      desc: 'Something the real person would know.',
      when: (p, _pl, hub) => hub === 'tricking' && !p.flags.asked_specific_test,
      entry: 'test',
      nodes: {
        test: {
          lines: [
            'I say: what was the name of the dog. The one that was not allowed in the kitchen.',
            'A pause longer than any pause yet. The voice says: ~~there were many dogs, mister. I do not remember.~~',
            'There was one dog.',
          ],
          scales: { suspicion: +6, invitation: -4 },
          flags: { asked_specific_test: true, trick_active: false },
          composure: +1,
          composureGain: 'There was one dog. They did not know it.',
          choices: [
            { label: 'pull back', goto: { to: 'hub', forceState: 'tense' } },
          ],
        },
      },
    },

    refuse_to_be_fooled: {
      label: 'refuse to be fooled',
      desc: 'Cold. Final.',
      when: (p, _pl, hub) => hub === 'tricking' && !p.flags.refused_trick,
      entry: 'refuse',
      nodes: {
        refuse: {
          lines: [
            'I say: I know who is at the door. You are not them. I am not opening.',
            'The voice returns. The shorter one says: ~~alright, mister. We will try something else.~~',
          ],
          scales: { suspicion: +3, invitation: -4 },
          flags: { refused_trick: true, trick_active: false },
          composure: +1,
          composureGain: 'I have named the line.',
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    who_taught_you_trick: {
      label: 'who taught you to do this',
      desc: 'Pull the thread.',
      when: (p, _pl, hub) => hub === 'tricking' && !p.flags.asked_who_taught_trick,
      entry: 'ask',
      nodes: {
        ask: {
          lines: [
            'I say: who taught you to do that. To borrow a voice.',
            'A pause. The shorter one says, in her own voice: ~~the one before you, mister. He was very good at it.~~',
          ],
          scales: { suspicion: +6 },
          flags: { asked_who_taught_trick: true, taller_speaking: false, trick_active: false, one_before: true },
          composure: -2,
          composureCost: 'The one before me.',
          choices: [
            { label: 'pull back', goto: { to: 'hub', forceState: 'tense' } },
          ],
        },
      },
    },

    // ═════════════════════════════════════════════════════════════════
    //  HUB: more_arrive
    // ═════════════════════════════════════════════════════════════════

    count_the_voices: {
      label: 'count the voices',
      desc: 'How many are out there.',
      when: (p, _pl, hub) => hub === 'more_arrive' && !p.flags.counted_voices,
      entry: 'count',
      nodes: {
        count: {
          lines: [
            'I press my ear to the wood. I listen for the asks.',
            'I count five children. Each one is a different age. Each one is asking.',
            'They are taking turns. The shorter one is no longer doing all the talking.',
          ],
          scales: { suspicion: +5 },
          flags: { counted_voices: true },
          composure: -2,
          composureCost: 'Five.',
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    listen_for_familiars: {
      label: 'listen for a voice you know',
      desc: 'Do you know any of them.',
      when: (p, _pl, hub) => hub === 'more_arrive' && !p.flags.listened_familiars,
      entry: 'listen',
      nodes: {
        listen: {
          lines: [
            'I listen for one I might know. A voice I would have known as a child.',
            'I hear one. The third in the rotation. Her cadence is one I know.',
            '~~I cannot place where I know it from. The fact that I know it is the worst thing about it.~~',
          ],
          scales: { suspicion: +4, invitation: +3 },
          flags: { listened_familiars: true, heard_familiar: true },
          composure: -3,
          composureCost: 'The fact that I knew it.',
          choices: [
            { label: 'pull back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    ask_who_else_is_there: {
      label: 'ask who else is there',
      desc: 'Through the door.',
      when: (p, _pl, hub) => hub === 'more_arrive' && !p.flags.asked_who_else,
      entry: 'ask',
      nodes: {
        ask: {
          lines: [
            'I say: who else is at my door.',
            'The shorter one says: ~~our friends, mister. They wanted to meet you.~~',
            'A pause. ~~They have heard about you for a long time.~~',
          ],
          scales: { suspicion: +4, invitation: +1 },
          flags: { asked_who_else: true },
          composure: -2,
          composureCost: 'A long time.',
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    address_the_group: {
      label: 'speak to the group',
      desc: 'All of them, at once.',
      when: (p, _pl, hub) => hub === 'more_arrive' && !p.flags.addressed_group,
      entry: 'speak',
      nodes: {
        speak: {
          lines: [
            'I say: all of you. Whoever you are. I am not opening this door.',
            'The asks stop for one beat. Then they resume. Differently.',
            'It is no longer please. It is now: ~~we want to come in.~~ Five voices. Slightly off-sync.',
          ],
          scales: { suspicion: +5, invitation: -1 },
          flags: { addressed_group: true },
          composure: -3,
          composureCost: 'Five voices.',
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    defend_now_more: {
      label: 'set the chain right now',
      desc: 'Defense.',
      when: (p, _pl, hub) => hub === 'more_arrive' && !p.flags.chain_set,
      entry: 'set',
      nodes: {
        set: {
          lines: [
            'I lift the chain. I drop it into the keep.',
            'All five voices stop. For one beat. Two.',
            'They resume.',
          ],
          scales: { latch: +6, invitation: -3, suspicion: +1 },
          flags: { chain_set: true },
          choices: [
            { label: 'step back', goto: { to: 'hub', forceState: 'barricaded' } },
          ],
        },
      },
    },

    // ═════════════════════════════════════════════════════════════════
    //  HUB: silence
    // ═════════════════════════════════════════════════════════════════

    wait_in_silence: {
      label: 'wait in the silence',
      desc: 'Stand and listen.',
      when: (p, _pl, hub) => hub === 'silence' && !p.flags.waited_silence,
      entry: 'wait',
      nodes: {
        wait: {
          lines: [
            'I stand in the middle of the room. I listen. The radiator. A pipe.',
            'After a long minute, the asking resumes. The shorter one is at the door again. As if she had never stopped.',
          ],
          scales: { suspicion: +2 },
          flags: { waited_silence: true, they_have_gone_silent: false },
          choices: [
            { label: 'go on', goto: { to: 'hub' } },
          ],
        },
      },
    },

    speak_first_silence: {
      label: 'speak first',
      desc: 'Break the silence.',
      when: (p, _pl, hub) => hub === 'silence' && !p.flags.spoke_first_silence,
      entry: 'speak',
      nodes: {
        speak: {
          lines: [
            'I say: are you still there.',
            'A pause. The shorter one says, gently: ~~yes, mister. We were waiting for you to ask.~~',
          ],
          scales: { invitation: +3, suspicion: +2 },
          flags: { spoke_first_silence: true, they_have_gone_silent: false },
          composure: -1,
          composureCost: 'They were waiting.',
          choices: [
            { label: 'go on', goto: { to: 'hub' } },
          ],
        },
      },
    },

    peek_in_silence: {
      label: 'peek through the peephole',
      desc: 'See if they are still there.',
      when: (p, _pl, hub) => hub === 'silence' && !p.flags.peeked_silence,
      entry: 'peek',
      nodes: {
        peek: {
          lines: [
            'I lean to the lens. The corridor is empty.',
            'A second later, the shorter one steps into the lens from the side. She had been pressed against the door, out of sight.',
            'She smiles up at me.',
          ],
          scales: { suspicion: +5, invitation: +2 },
          flags: { peeked_silence: true, they_have_gone_silent: false },
          composure: -2,
          composureCost: 'She had been pressed against the door.',
          choices: [
            { label: 'pull back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    say_their_names_silence: {
      label: 'say their names',
      desc: 'Hannah. Thomas.',
      when: (p, _pl, hub) => hub === 'silence' && p.flags.asked_names && !p.flags.said_their_names,
      entry: 'name',
      nodes: {
        name: {
          lines: [
            'I say: Hannah. Thomas.',
            'A pause. The shorter one says: ~~we are here, mister.~~ The taller one does not answer. The shorter one says: ~~he is shy, still.~~',
          ],
          scales: { invitation: +3, suspicion: +1 },
          flags: { said_their_names: true, they_have_gone_silent: false },
          composure: -1,
          composureCost: 'I named them.',
          choices: [
            { label: 'go on', goto: { to: 'hub' } },
          ],
        },
      },
    },

    // ═════════════════════════════════════════════════════════════════
    //  HUB: recognized
    // ═════════════════════════════════════════════════════════════════

    ask_how_she_knows: {
      label: 'ask how she knows',
      desc: 'Pull the thread.',
      when: (p, _pl, hub) => hub === 'recognized' && !p.flags.asked_how_knows,
      entry: 'ask',
      nodes: {
        ask: {
          lines: [
            'I say: how do you know that. That word. That name.',
            'A long pause. The shorter one says: ~~we have been in your file, mister. We were in your file before you were.~~',
          ],
          scales: { suspicion: +6, invitation: +1 },
          flags: { asked_how_knows: true },
          composure: -3,
          composureCost: 'Before me.',
          choices: [
            { label: 'press on', goto: 'press' },
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
        press: {
          lines: [
            'I say: my file is here. In this room. You have not been in it.',
            'The shorter one says: ~~not that file, mister. The other one.~~',
          ],
          scales: { suspicion: +5, invitation: -1 },
          flags: { pressed_recognition: true },
          choices: [
            { label: 'pull back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    deny_it_all: {
      label: 'deny what she said',
      desc: 'You are not who she is talking to.',
      when: (p, _pl, hub) => hub === 'recognized' && !p.flags.denied_recognition,
      entry: 'deny',
      nodes: {
        deny: {
          lines: [
            'I say: you are wrong. That is not my name. That is not what she called me.',
            'The shorter one says, with no surprise: ~~that is alright, mister. You do not have to admit it.~~',
            'She did not believe me. She did not need to.',
          ],
          scales: { invitation: -3, suspicion: +2 },
          flags: { denied_recognition: true, recognition_resolved: true },
          composure: +1,
          composureGain: 'I needed to say it.',
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    name_what_she_is: {
      label: 'name what she is',
      desc: 'Out loud. To her face.',
      when: (p, _pl, hub) => hub === 'recognized' && !p.flags.named_what_she_is,
      entry: 'name',
      nodes: {
        name: {
          lines: [
            'I say: you are not a child. You are not the shorter one of two children. You are something else, and you have been at this door for years.',
            'A pause. The shorter one says, very softly: ~~that is alright. I have been called worse.~~',
            'The pet name is gone from the door.',
          ],
          scales: { suspicion: +4, invitation: -2 },
          flags: { named_what_she_is: true, recognition_resolved: true },
          composure: +2,
          composureGain: 'I have my mother\'s back.',
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    who_told_you_about_me: {
      label: 'who told you about me',
      desc: 'Where did the knowledge come from.',
      when: (p, _pl, hub) => hub === 'recognized' && !p.flags.asked_who_told,
      entry: 'ask',
      nodes: {
        ask: {
          lines: [
            'I say: who told you. About me. About her.',
            'The shorter one says, quietly: ~~the one before you, mister. He gave us everything he had.~~',
            'I do not know who the one before me is. I do not know if there was one.',
          ],
          scales: { suspicion: +5 },
          flags: { asked_who_told: true, one_before: true, recognition_resolved: true },
          composure: -3,
          composureCost: 'I did not know if there was one before.',
          choices: [
            { label: 'pull back', goto: { to: 'hub', forceState: 'tense' } },
          ],
        },
      },
    },

    // ═════════════════════════════════════════════════════════════════
    //  HUB: power_out
    // ═════════════════════════════════════════════════════════════════

    listen_in_the_dark: {
      label: 'listen in the dark',
      desc: 'Heightened. Without sight.',
      when: (p, _pl, hub) => hub === 'power_out' && !p.flags.listened_dark,
      entry: 'listen',
      nodes: {
        listen: {
          lines: [
            'I stand still. I close my eyes, though they were not helping anyway.',
            'I hear the asks more clearly. The shorter one\'s voice is closer than it was. Her face is at the door, against the wood.',
            'Behind her, nothing. The taller one is not breathing.',
          ],
          scales: { suspicion: +5 },
          flags: { listened_dark: true },
          composure: -2,
          composureCost: 'He was not breathing.',
          choices: [
            { label: 'open your eyes', goto: { to: 'hub' } },
          ],
        },
      },
    },

    try_to_see_under_door: {
      label: 'look for shadow under the door',
      desc: 'The gap. Any light at all.',
      when: (p, _pl, hub) => hub === 'power_out' && !p.flags.looked_under_dark,
      entry: 'look',
      nodes: {
        look: {
          lines: [
            'I crouch. The gap under the door is black. No shadows. No light at all.',
            'A wet finger comes under the gap. It withdraws when my breath hits it.',
          ],
          scales: { suspicion: +6 },
          flags: { looked_under_dark: true },
          composure: -3,
          composureCost: 'It was waiting for me to look.',
          choices: [
            { label: 'stand up fast', goto: { to: 'hub' } },
          ],
        },
      },
    },

    back_to_the_window: {
      label: 'back to the window',
      desc: 'Moonlight.',
      when: (p, _pl, hub) => hub === 'power_out' && !p.flags.backed_to_window,
      entry: 'back',
      nodes: {
        back: {
          lines: [
            'I cross to the window. The bars are spaced narrow. The courtyard below has a single lamp burning.',
            'In the lamp\'s circle, two figures stand. Both my height. They wave up at me.',
            'They look like the children at my door. They are full-grown.',
          ],
          scales: { suspicion: +5 },
          flags: { backed_to_window: true, saw_courtyard: true },
          composure: -4,
          composureCost: 'They were full-grown.',
          choices: [
            { label: 'cross back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    call_for_orderly_dark: {
      label: 'call for the orderly',
      desc: 'Shout. In the dark.',
      when: (p, _pl, hub) => hub === 'power_out' && !p.flags.orderly_alerted,
      entry: 'call',
      nodes: {
        call: {
          lines: [
            'I shout. As loud as I can. I name him.',
            'A long way down the corridor, in the dark, a door opens. A voice answers. The voice is faint.',
            'Footsteps. Slow. Coming.',
          ],
          scales: { invitation: -3, suspicion: +1 },
          flags: { orderly_alerted: true },
          choices: [
            { label: 'wait', goto: { to: 'hub', triggerInterjection: 'orderly_at_door' } },
          ],
        },
      },
    },

    // ═════════════════════════════════════════════════════════════════
    //  HUB: barricaded
    // ═════════════════════════════════════════════════════════════════

    read_your_own_file: {
      label: 'read your own file',
      desc: 'It was in the chair.',
      when: (p, _pl, hub) => hub === 'barricaded' && !p.flags.read_file,
      entry: 'read',
      nodes: {
        read: {
          lines: [
            'The file is in the seat of the chair, under my weight. I lift it. The cover is warm.',
            'My given name is not on the cover. The number is. The page beneath the cover has been written on this evening.',
            'The shorter one outside says: ~~he is reading. Good. He should know what he is doing.~~',
          ],
          scales: { suspicion: +3, invitation: -1 },
          flags: { read_file: true, _revealAllFile: true },
          composure: -1,
          composureCost: 'She narrated my reading.',
          choices: [
            { label: 'set the file down', goto: { to: 'hub' } },
          ],
        },
      },
    },

    check_the_window_barricaded: {
      label: 'check the window',
      desc: 'The barred one. The courtyard.',
      when: (p, _pl, hub) => hub === 'barricaded' && !p.flags.saw_courtyard,
      entry: 'cross',
      nodes: {
        cross: {
          lines: [
            'I cross to the window. The bars are spaced narrow. The courtyard is dark. The lamps are out.',
            'There are two figures in the courtyard, looking up at my window. They wave.',
            'They look like the children at my door. The footprints at my door are wet. The figures in the courtyard are not.',
          ],
          scales: { suspicion: +5 },
          flags: { saw_courtyard: true },
          composure: -3,
          composureCost: 'Two of them in the courtyard.',
          choices: [
            { label: 'turn back to the room', goto: { to: 'hub' } },
          ],
        },
      },
    },

    listen_for_the_corridor: {
      label: 'listen for the corridor',
      desc: 'Past them. Tune them out.',
      when: (p, _pl, hub) => hub === 'barricaded' && !p.flags.listened_for_corridor,
      entry: 'listen',
      nodes: {
        listen: {
          lines: [
            'I stand at the door. I tune them out and listen past them.',
            'The radiator. A pipe somewhere. A door, two floors down. The night nurse\'s chair, faintly, very far away.',
            'The corridor is still real. The night is still real.',
          ],
          scales: { invitation: -2 },
          composure: +2,
          flags: { listened_for_corridor: true },
          composureGain: 'The night ends.',
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    shout_for_the_orderly: {
      label: 'shout for the orderly',
      desc: 'Loudly. Down the corridor.',
      when: (p, _pl, hub) => hub === 'barricaded' && !p.flags.orderly_alerted,
      entry: 'shout',
      nodes: {
        shout: {
          lines: [
            'I shout for him. Loud as my voice will go. I name him.',
            'A long way down the corridor, a door opens. A voice answers. I cannot make it out.',
            'The shorter one says, on the other side of mine: ~~he heard you, mister.~~ She does not sound worried.',
            'A pause. Then footsteps in the corridor. Slow. Coming.',
          ],
          scales: { invitation: -3, suspicion: +1 },
          flags: { orderly_alerted: true },
          choices: [
            { label: 'wait', goto: { to: 'hub', triggerInterjection: 'orderly_at_door' } },
          ],
        },
      },
    },

    bang_on_the_wall: {
      label: 'bang on the wall',
      desc: 'The next room. Signal them.',
      when: (p, _pl, hub) => hub === 'barricaded' && !p.flags.banged_wall && !p.flags.orderly_alerted,
      entry: 'bang',
      nodes: {
        bang: {
          lines: [
            'I bring the side of my fist against the wall. Twice. Loud.',
            'I wait. There is no answer through the wall.',
            'The shorter one says, in the corridor: ~~there is no one in that room. The bed is made.~~',
          ],
          scales: { suspicion: +3 },
          flags: { banged_wall: true },
          composure: -1,
          composureCost: 'She knew which room.',
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    // ═════════════════════════════════════════════════════════════════
    //  HUB: orderly_present
    // ═════════════════════════════════════════════════════════════════

    tell_him_the_truth: {
      label: 'tell him the truth',
      desc: 'There are children in the corridor.',
      when: (p, _pl, hub) => hub === 'orderly_present' && !p.flags.told_orderly,
      entry: 'tell',
      nodes: {
        tell: {
          lines: [
            'I say: there are two children in the corridor outside my door. They have been asking to come in for an hour.',
            'There is a pause. The orderly says, slowly: ~~there is no one in the corridor.~~',
            'A beat. He says: ~~I am opening the door.~~',
          ],
          scales: { invitation: -6 },
          flags: { told_orderly: true, orderly_opening: true },
          composure: +2,
          composureGain: 'I have said the true thing. My breath comes back.',
          choices: [
            { label: 'wait', goto: { to: 'hub' } },
          ],
        },
      },
    },

    warn_him_not_to_open: {
      label: 'warn him not to open',
      desc: 'Caution him first.',
      when: (p, _pl, hub) => hub === 'orderly_present' && !p.flags.warned_orderly,
      entry: 'warn',
      nodes: {
        warn: {
          lines: [
            'I say: do not open the door. Look first. Through the peephole if you have to.',
            'There is a pause. He says: ~~understood.~~ I hear him lean in.',
            'A long pause. He says, very evenly: ~~I do not see anyone.~~',
          ],
          scales: { invitation: -3, suspicion: +2 },
          flags: { warned_orderly: true, orderly_cautious: true },
          composure: +1,
          composureGain: 'There is someone else here who knows.',
          choices: [
            { label: 'wait', goto: { to: 'hub' } },
          ],
        },
      },
    },

    send_him_away: {
      label: 'send him away',
      desc: 'Pretend you are fine.',
      when: (p, _pl, hub) => hub === 'orderly_present' && !p.flags.sent_orderly_away,
      entry: 'cover',
      nodes: {
        cover: {
          lines: [
            'I say: I am alright. I did not mean to call.',
            'The orderly says, after a pause: ~~understood, Patient.~~ His footsteps recede.',
            'The shorter one says, just under my door: ~~thank you, mister.~~',
          ],
          scales: { invitation: +3, suspicion: +1 },
          flags: { sent_orderly_away: true, orderly_present: false },
          composure: -3,
          composureCost: 'She thanked me for sending him away.',
          choices: [
            { label: 'step back', goto: { to: 'hub', forceState: 'pressing' } },
          ],
        },
      },
    },

    describe_what_you_hear: {
      label: 'describe what you hear',
      desc: 'Let him hear what you hear.',
      when: (p, _pl, hub) => hub === 'orderly_present' && !p.flags.described_to_orderly,
      entry: 'describe',
      nodes: {
        describe: {
          lines: [
            'I say: stand at my door. Listen. The shorter one knocks every twelve seconds. The taller one is silent.',
            'I wait. The shorter one does not knock. The orderly says: ~~I hear the radiator. Nothing else.~~',
            'There is a long pause. He says: ~~I will sit by your door tonight.~~',
          ],
          scales: { invitation: -4, suspicion: +1 },
          flags: { described_to_orderly: true, orderly_will_sit: true },
          composure: +1,
          composureGain: 'He will sit by the door tonight.',
          choices: [
            { label: 'breathe', goto: { to: 'hub' } },
          ],
        },
      },
    },

    // ═════════════════════════════════════════════════════════════════
    //  SOFT REACTS — appear in the hub menu like any other action when
    //  their `when` matches. Each declares a `surfaceNote` that posts as
    //  a one-line scene-shift the first time the option becomes reachable,
    //  so the player understands what just happened in the world without
    //  having to click the action to find out. The hard pressure beats
    //  (a fingertip at the gap, the screaming, the orderly arriving, the
    //  lights going out, the self-harm) are instead authored as forced
    //  `interjections` below.
    // ═════════════════════════════════════════════════════════════════

    she_is_at_the_gap: {
      label: 'answer her at the gap',
      desc: 'She has come close to the wood.',
      surfaceNote: 'She is at the gap. She says: !!mister. Please. We are not allowed to come in unless you say.!!',
      when: (p, _pl, hub) => (hub === 'engaged' || hub === 'tense') && p.scales.invitation >= 6
        && !p.flags.reacted_mister_please && !p.flags.told_to_leave,
      entry: 'open',
      nodes: {
        open: {
          lines: [
            'I lean toward the door. Her voice is very close to the wood now. ~~Mister. Please. We are not allowed to come in unless you say.~~',
          ],
          flags: { reacted_mister_please: true },
          choices: [
            { label: 'who told you that', goto: 'who_told' },
            { label: 'I am not saying', goto: 'not_saying' },
            { label: 'just for a minute', goto: 'concede' },
          ],
        },
        who_told: {
          lines: [
            'I say: who told you that. About needing me to say.',
            'She does not answer. The taller one says, from further back: ~~she is not supposed to tell you. We are not supposed to talk about that part.~~',
          ],
          scales: { suspicion: +6 },
          flags: { learned_rule: true },
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
        not_saying: {
          lines: [
            'I say: I am not saying.',
            'She is quiet for a long beat. Then: ~~that is alright. We can wait. We are very good at waiting.~~',
          ],
          scales: { invitation: -3, suspicion: +2 },
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
        concede: {
          lines: [
            'I say: just for a minute.',
            'The bolt slides back without my hand on it. The chain rattles in the keep.',
          ],
          scales: { invitation: +8, latch: -8 },
          flags: { said_yes: true, in_the_room: true },
          composure: -3,
          composureCost: '!!The bolt moved when I said the word.!!',
          choices: [
            { label: '...', goto: { to: 'hub' } },
          ],
        },
      },
    },

    address_the_taller: {
      label: 'address the taller one',
      desc: 'He has spoken. He is waiting.',
      surfaceNote: 'The taller one has spoken at full volume for the first time. His voice is older than his height. He says: ~~mister. We will not ask much longer.~~',
      when: (p, _pl, hub) => (hub === 'tense' || hub === 'engaged') && (p.flags.tested || p.flags.confronted_rehearsal || p.flags.threatened || false)
        && !p.flags.reacted_taller_speaks && p.flags.taller_spoken !== true && p.flags.taller_speaking !== true,
      entry: 'open',
      nodes: {
        open: {
          lines: [
            'I turn my ear to the door. The taller one is still at full volume. He is still waiting.',
          ],
          flags: { reacted_taller_speaks: true, taller_spoken: true },
          choices: [
            { label: 'good', goto: 'good' },
            { label: 'what happens when you stop asking', goto: 'what_happens' },
            { label: 'who taught you', goto: 'who_taught' },
          ],
        },
        good: {
          lines: [
            'I say: good.',
            'He is quiet for a long beat. Then he says, slower: ~~we will not ask much longer.~~ The same words. Differently.',
          ],
          scales: { suspicion: +3, invitation: +2 },
          flags: { taller_speaking: true },
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
        what_happens: {
          lines: [
            'I say: what happens when you stop asking.',
            'He says: ~~you will not need to be asked.~~',
          ],
          scales: { suspicion: +7, invitation: +3 },
          composure: -3,
          composureCost: 'He answered without thinking.',
          flags: { taller_speaking: true, threat_explicit: true },
          choices: [
            { label: 'pull back', goto: { to: 'hub' } },
          ],
        },
        who_taught: {
          lines: [
            'I say: who taught you to do this. The asking.',
            'He is quiet for a very long time. Then he says: ~~the one before you, mister.~~',
          ],
          scales: { suspicion: +8 },
          composure: -3,
          composureCost: 'The one before me.',
          flags: { taller_speaking: true, one_before: true },
          choices: [
            { label: 'pull back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    answer_her_narration: {
      label: 'answer her narration',
      desc: 'She is describing what you are doing.',
      surfaceNote: 'The shorter one has begun describing me, with no question in her voice. ~~He is at the bolt. He is touching the chain. He has stepped back.~~ I have not moved.',
      when: (p, _pl, hub) => (hub === 'tense' || hub === 'pressing') && p.scales.suspicion >= 12
        && !p.flags.reacted_narration && !p.flags.chain_set,
      entry: 'open',
      nodes: {
        open: {
          lines: [
            'She continues, evenly, as if reading. ~~He is listening to me. He is deciding what to say.~~',
          ],
          flags: { reacted_narration: true },
          choices: [
            { label: 'stop talking', goto: 'stop' },
            { label: 'narrate her back', goto: 'narrate_back' },
            { label: 'do not answer', goto: 'silent' },
          ],
        },
        stop: {
          lines: [
            'I say: stop talking.',
            'She says, evenly: ~~he said stop. He is standing very still.~~',
          ],
          scales: { suspicion: +4, invitation: -1 },
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
        narrate_back: {
          lines: [
            'I say: you are at the gap. Your hair is wet. The taller one is behind you, not breathing in time with you.',
            'She is quiet. The taller one says: ~~he has been watching.~~ Not a question.',
          ],
          scales: { suspicion: +6, invitation: -2 },
          flags: { you_narrated_them: true },
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
        silent: {
          lines: [
            'I do not answer. She narrates for a long time. Each thing she says is true.',
            'When she stops, the corridor is quiet. I have not moved any of the things she described.',
          ],
          scales: { suspicion: +3, invitation: +3 },
          composure: -3,
          composureCost: 'Each thing she said was true.',
          flags: { let_her_narrate: true },
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    answer_the_one_word: {
      label: 'answer the one word',
      desc: 'She knows which word.',
      surfaceNote: 'The shorter one has lowered her voice almost to nothing. ~~Mister. We only need one word from you. We know which word.~~',
      when: (p, _pl, hub) => hub === 'pressing' && p.scales.invitation >= 14
        && !p.flags.reacted_one_word && !p.flags.chair_wedged,
      entry: 'open',
      nodes: {
        open: {
          lines: [
            'My mouth is dry. The word is sitting on my tongue the way a coin sits in a pocket.',
          ],
          flags: { reacted_one_word: true },
          choices: [
            { label: 'I am not saying', goto: 'not_saying' },
            { label: 'I do not know the word', goto: 'dont_know' },
            { label: 'yes', goto: 'yes' },
          ],
        },
        not_saying: {
          lines: [
            'I say: I am not saying.',
            'A long beat. The shorter one says: ~~we can wait until you say it. We have all night.~~',
          ],
          scales: { invitation: +1, suspicion: +3 },
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
        dont_know: {
          lines: [
            'I say: I do not know the word.',
            'She says: ~~that is alright. You will. It is in your mouth.~~',
          ],
          scales: { invitation: +5, suspicion: +1 },
          composure: -3,
          composureCost: 'It is in my mouth.',
          choices: [
            { label: 'pull back', goto: { to: 'hub' } },
          ],
        },
        yes: {
          lines: [
            'I say: yes.',
            'The bolt slides back without my hand on it. The chain rattles in the keep.',
          ],
          scales: { invitation: +10, latch: -10 },
          composure: -4,
          composureCost: '!!I said it.!!',
          flags: { said_yes: true, in_the_room: true },
          choices: [
            { label: '...', goto: { to: 'hub' } },
          ],
        },
      },
    },

    take_her_mother_offer: {
      label: 'meet her mother offer',
      desc: 'The asking has dropped out of her voice.',
      surfaceNote: 'The asking has dropped out of her voice. After a long beat she says, more quietly: ~~mister. Can I tell you about her? About our mother?~~',
      when: (p, _pl, hub) => hub === 'engaged' && p.flags.asked_mother && !p.flags.reacted_mother_offer,
      entry: 'open',
      nodes: {
        open: {
          lines: [
            'It is just talking now, with the asking gone. She is waiting on me.',
          ],
          flags: { reacted_mother_offer: true },
          choices: [
            { label: 'tell me', goto: 'tell_me' },
            { label: 'I cannot', goto: 'cannot' },
            { label: 'stop', goto: 'stop' },
          ],
        },
        tell_me: {
          lines: [
            'I say: tell me.',
            'She does. About a kitchen. A dog. A song.',
          ],
          scales: { invitation: +5 },
          flags: { in_mother_story: true },
          composure: -1,
          composureCost: 'My throat is tight.',
          choices: [
            { label: 'listen', goto: { to: 'hub', forceState: 'mother_story' } },
          ],
        },
        cannot: {
          lines: [
            'I say: I cannot. I am sorry. I cannot listen to that right now.',
            'A quiet. The shorter one says: ~~that is alright, mister. It is alright to not be ready.~~',
          ],
          scales: { invitation: +2 },
          composure: -1,
          composureCost: 'She gave me permission to not be ready.',
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
        stop: {
          lines: [
            'I say: stop. I am not who you think I am.',
            'A long beat. The shorter one says: ~~that is alright, mister. We do not need you to be.~~',
          ],
          scales: { suspicion: +3, invitation: -2 },
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
      },
    },

    answer_their_song: {
      label: 'answer their song',
      desc: 'A song you know.',
      surfaceNote: 'They have begun to sing, both of them. The shorter one is on key, the taller half a step lower. It is a song I know. I do not know how I know it.',
      when: (p, _pl, hub) => (hub === 'engaged' || hub === 'mother_story') && p.turn >= 5
        && !p.flags.reacted_song && p.scales.suspicion <= 14 && p.scales.invitation <= 12,
      entry: 'open',
      nodes: {
        open: {
          lines: [
            'They are still singing. They will keep going until I do something.',
          ],
          flags: { reacted_song: true },
          choices: [
            { label: 'sing the next line', goto: 'next_line' },
            { label: 'sing your own song', goto: 'own_song' },
            { label: 'do not sing', goto: 'silent' },
          ],
        },
        next_line: {
          lines: [
            'I sing the next line of the song. I have the right words.',
            'They stop. The shorter one says: ~~no, mister. We do not know that line.~~',
            'I sing it again. They do not pick it up. The song has stopped.',
          ],
          scales: { suspicion: +4, invitation: -3 },
          flags: { caught_song: true },
          choices: [
            { label: 'go on', goto: { to: 'hub' } },
          ],
        },
        own_song: {
          lines: [
            'I sing. Anything. The first song that comes to me. Loudly.',
            'They wait until I am finished. Then they pick up at the same line they were on.',
          ],
          scales: { invitation: -2, suspicion: +1 },
          choices: [
            { label: 'step back', goto: { to: 'hub' } },
          ],
        },
        silent: {
          lines: [
            'I do not sing. They sing the whole song through. Their voices come into harmony for the chorus.',
            'When they finish, they go quiet.',
          ],
          scales: { invitation: +3, suspicion: +1 },
          flags: { listened_to_song: true, they_have_gone_silent: true, silence_start: p => p.turn },
          choices: [
            { label: 'go on', goto: { to: 'hub', forceState: 'silence' } },
          ],
        },
      },
    },

    answer_the_changed_voice: {
      label: 'answer the changed voice',
      desc: 'It is not the shorter one anymore.',
      surfaceNote: 'The voice on the other side has changed mid-sentence. It is not the shorter one anymore. ~~My nurse\'s, but younger. My mother\'s, but older. Something has split the difference.~~',
      when: (p, _pl, hub) => hub === 'tense' && p.flags.confronted_anything
        && !p.flags.reacted_trick_trigger && p.scales.suspicion >= 12,
      entry: 'open',
      nodes: {
        open: {
          lines: [
            'It is still going. The new voice is using the same phrases. The cadence is hers. The timbre is not.',
            'I have a choice to make about who I am talking to.',
          ],
          scales: { suspicion: +4 },
          flags: { reacted_trick_trigger: true, trick_active: true },
          composure: -3,
          composureCost: 'Something split the difference.',
          choices: [
            { label: 'name the voice', goto: 'name_it' },
            { label: 'pretend not to notice', goto: 'pretend' },
            { label: 'face it', goto: { to: 'hub', forceState: 'tricking' } },
          ],
        },
        name_it: {
          lines: [
            'I say: that is my nurse\'s voice. Younger. You should not have it.',
            'The voice stops mid-word. The shorter one returns, quieter than before: ~~we are sorry, mister. We were practicing.~~',
          ],
          scales: { suspicion: +5, invitation: -3 },
          flags: { named_voice: true },
          choices: [
            { label: 'step back', goto: { to: 'hub', forceState: 'tricking' } },
          ],
        },
        pretend: {
          lines: [
            'I do not name it. I answer as if it were still her.',
            'A long pause. The new voice tries again. It is closer this time. The vowels almost belong.',
          ],
          scales: { invitation: +3, suspicion: +2 },
          composure: -2,
          composureCost: 'I let it be hers.',
          flags: { let_trick_continue: true },
          choices: [
            { label: 'go on', goto: { to: 'hub', forceState: 'tricking' } },
          ],
        },
      },
    },

    answer_more_voices: {
      label: 'answer the new voices',
      desc: 'More than two now.',
      surfaceNote: 'Soft footsteps in the corridor. A third pair, slow. Then a fourth. New voices begin to join the asking. Different ages. Different accents.',
      when: (p, _pl, hub) => (hub === 'tense' || hub === 'pressing' || hub === 'barricaded')
        && p.turn >= 8 && !p.flags.reacted_more_arrive,
      entry: 'open',
      nodes: {
        open: {
          lines: [
            'They are still arriving. The asking rotates between them. They have practiced this.',
          ],
          scales: { suspicion: +5 },
          flags: { reacted_more_arrive: true, more_have_arrived: true },
          composure: -2,
          composureCost: 'Different ages.',
          choices: [
            { label: 'face it', goto: { to: 'hub', forceState: 'more_arrive' } },
          ],
        },
      },
    },

    answer_the_pet_name: {
      label: 'answer the pet name',
      desc: 'She said something only she would know.',
      surfaceNote: 'The shorter one has just called me something. The way my mother used to. The same diminutive. The same cadence. I have not spoken my given name out loud since I came onto this ward.',
      when: (p, _pl, hub) => (hub === 'engaged' || hub === 'tense' || hub === 'mother_story')
        && p.turn >= 6 && !p.flags.reacted_recognition && p.scales.invitation >= 8,
      entry: 'open',
      nodes: {
        open: {
          lines: [
            'She is using it again. Softer the second time. As if checking that I noticed.',
          ],
          flags: { reacted_recognition: true, they_have_recognized: true },
          composure: -3,
          composureCost: 'I had not said my name.',
          choices: [
            { label: 'face it', goto: { to: 'hub', forceState: 'recognized' } },
          ],
        },
      },
    },

  },

  // ─────────────────────────────────────────────────────────────────────
  //  INTERJECTIONS — the pressure beats. The patient (or the world)
  //  acts first; the player picks one of a short menu of responses; the
  //  turn advances. They never fire mid-spoke. The engine enforces a
  //  one-turn cooldown between fires unless a fire is explicitly chained
  //  with `allowBackToBack` or routed in from a spoke choice's
  //  `goto: { to: 'hub', triggerInterjection: 'id' }`.
  // ─────────────────────────────────────────────────────────────────────

  interjections: [
    {
      id: 'fingertip_at_gap',
      once: true,
      when: (p, _pl, hub) => hub === 'barricaded' && p.flags.chain_set,
      prose: [
        'A small fingertip has appeared at the gap under the door. Pale. Wet.',
        'It is moving. Slowly. Side to side. The way one tests a surface.',
      ],
      responses: [
        {
          label: 'step on it',
          desc: 'Bring your heel down.',
          lines: [
            'I bring my heel down on it. There is no give. There is no flinch.',
            'The finger stays where it is. The shorter one says, evenly: ~~that did not hurt, mister.~~',
            'I lift my foot. The finger withdraws. Slowly.',
          ],
          scales: { suspicion: +6, invitation: -3 },
          composure: -3,
          composureCost: 'No give. No flinch.',
          flags: { stamped: true },
        },
        {
          label: 'kick the door',
          desc: 'Drive it back. Loud.',
          lines: [
            'I kick the door. The finger pulls back. The shorter one cries out. The cry is the right shape but the wrong rhythm.',
            'The taller one says, away from the door: ~~he kicked.~~ The way one notes a weather change.',
          ],
          scales: { suspicion: +3, invitation: -2, latch: +1 },
          composure: -1,
          composureCost: 'The cry was the wrong rhythm.',
        },
        {
          label: 'leave it alone',
          desc: 'Step back from the gap.',
          lines: [
            'I step back from the door. The finger continues for a long time. Then it withdraws.',
            'There is a wet line on the linoleum where it had been.',
          ],
          scales: { invitation: +4, suspicion: +2 },
          composure: -2,
          composureCost: 'A wet line on the linoleum.',
        },
      ],
    },

    {
      id: 'they_begin_screaming',
      once: true,
      when: (p, _pl, hub) => hub !== 'screaming' && hub !== 'barricaded' && hub !== 'orderly_present'
        && p.scales.suspicion >= 14 && p.scales.invitation >= 6
        && (p.flags.threatened || p.flags.confronted_anything || p.flags.told_what_you_know),
      prose: [
        'Something changes. The asking stops. The shorter one steps back. A pause.',
        '!!Then the banging starts. Then the screaming. Both of them. The door does not move but the frame does.!!',
      ],
      responses: [
        {
          label: 'put your shoulder to the door',
          desc: 'Hold the wood. Be the second hinge.',
          lines: [
            'I put my shoulder to the door. The wood is shaking. My ribs absorb each impact.',
            'They cannot get the door to give. They go on anyway. My breathing is the same as theirs by the end.',
          ],
          scales: { latch: +2, suspicion: +2 },
          composure: -2,
          composureCost: 'My breathing matched theirs.',
          flags: { they_are_screaming: true, held_door: true },
        },
        {
          label: 'scream back',
          desc: 'Match them. Meet noise with noise.',
          lines: [
            'I scream back. As loud as I can. Through the wood.',
            'They go quiet immediately. The shorter one says, very small: ~~we did not know you could do that, mister.~~',
            'The asking does not resume.',
          ],
          scales: { suspicion: +3, invitation: -4 },
          composure: -3,
          composureCost: 'They went quiet for it.',
          flags: { they_are_screaming: true, screamed_back: true },
        },
        {
          label: 'cover your ears and wait',
          desc: 'Take it. Let the noise pass through you.',
          lines: [
            'I cover my ears. I stand very still in the middle of the room and let it happen.',
            'It goes on. I count and lose count. When it stops, the corridor is the same kind of quiet as before.',
          ],
          scales: { invitation: +2, suspicion: +1 },
          composure: -3,
          composureCost: 'I lost time inside the noise.',
          flags: { they_are_screaming: true, endured_screams: true },
        },
      ],
    },

    {
      id: 'she_hurts_herself',
      once: true,
      when: (p, _pl, hub) => (hub === 'pressing' || hub === 'tense') && p.flags.refused_word,
      prose: [
        'There is a wet sound at the gap. The shorter one has begun to bite herself. I can hear her teeth on her own arm.',
        'The taller one is not stopping her. He says, quiet: ~~she will keep going, mister. Until you say.~~',
      ],
      responses: [
        {
          label: 'tell her to stop',
          desc: 'Speak through the wood. Make her hear you.',
          lines: [
            'I say: stop. You do not have to do that. Please stop.',
            'She does not stop. The taller one says: ~~she cannot hear no, mister. She has only ever heard yes.~~',
          ],
          scales: { suspicion: +3, invitation: +2 },
          composure: -3,
          composureCost: 'She cannot hear no.',
          flags: { they_are_self_harming: true, told_her_to_stop: true },
        },
        {
          label: 'cover your ears',
          desc: 'Refuse the bait. Wait it out.',
          lines: [
            'I cover my ears. I sit on the floor with my back to the door.',
            'The wet sound continues. I cannot tell when it stops because I am not listening.',
            'When I take my hands off, the corridor is silent. There is a small smear on the linoleum at the gap.',
          ],
          scales: { invitation: -2, suspicion: +2 },
          composure: -3,
          composureCost: 'A small smear at the gap.',
          flags: { they_are_self_harming: true, refused_to_listen: true },
        },
        {
          label: 'say yes',
          desc: 'End it. Open the door.',
          lines: [
            'I say: yes.',
            'The wet sound stops at once. The bolt slides back without my hand on it.',
          ],
          scales: { invitation: +10, latch: -10 },
          composure: -4,
          composureCost: '!!I said it because she was bleeding.!!',
          flags: { said_yes: true, in_the_room: true },
        },
      ],
    },

    {
      id: 'lights_go_out',
      once: true,
      when: (p, _pl, hub) => (hub === 'tense' || hub === 'pressing' || hub === 'barricaded' || hub === 'screaming')
        && p.turn >= 10,
      prose: [
        'The fluorescent above my door buzzes once. The line of light under the door darkens to black.',
        'The voices outside do not change. They have not been relying on the lights.',
      ],
      responses: [
        {
          label: 'stand still and listen',
          desc: 'Let your eyes do nothing. Hear what is there.',
          lines: [
            'I stand very still. I close my eyes against the dark. I listen.',
            'There are more of them than I had heard. Many more. Spaced along the corridor in both directions.',
          ],
          scales: { suspicion: +6 },
          composure: -3,
          composureCost: 'There were more than I had heard.',
          flags: { power_out: true, counted_them: true },
        },
        {
          label: 'find the chain by touch',
          desc: 'Reach for the metal. Verify the door.',
          lines: [
            'I run my hand up the door until I find the chain. It is still across.',
            'I hold onto it. The metal is colder than the air.',
          ],
          scales: { latch: +1 },
          composure: -1,
          composureCost: 'Colder than the air.',
          flags: { power_out: true, holding_chain: true },
        },
        {
          label: 'call out to the orderly',
          desc: 'Make noise. Bring someone.',
          lines: [
            'I shout for the orderly. The shorter one, very close to the gap, says: ~~the orderly is not coming, mister. He has stopped at a different door.~~',
            'My shout dies in the dark of the corridor.',
          ],
          scales: { suspicion: +3, invitation: +1 },
          composure: -2,
          composureCost: 'He stopped at a different door.',
          flags: { power_out: true, orderly_alerted: true },
        },
      ],
    },

    {
      id: 'orderly_at_door',
      once: true,
      when: (p, _pl, hub) => p.flags.orderly_alerted && !p.flags.orderly_present
        && hub !== 'orderly_present',
      prose: [
        'An orderly\'s footsteps come down the corridor. The voices outside have gone very quiet.',
        'He stops outside my door. He says, through the wood: ~~Patient. Was that you who called.~~',
      ],
      responses: [
        {
          label: 'answer him',
          desc: 'It was you. Tell him about the corridor.',
          lines: [
            'I say: yes. It was me. I called. There are children in the corridor.',
            'A long beat. The orderly says: ~~There are no children on this ward, sir. I am opening the door.~~',
          ],
          flags: { orderly_present: true, called_orderly_in: true },
          composure: +1,
          composureGain: 'A voice that is not theirs.',
        },
        {
          label: 'stay silent',
          desc: 'Do not draw him to the door.',
          lines: [
            'I do not answer. The orderly waits. Then he says, softer: ~~Patient. I can hear you breathing.~~',
            'I do not answer that either. After a long time he walks away. The asking resumes the instant his footsteps stop.',
          ],
          scales: { suspicion: +3, invitation: +1 },
          composure: -2,
          composureCost: 'He could hear me breathing.',
          flags: { ignored_orderly: true },
        },
        {
          label: 'tell him to go away',
          desc: 'Send him off. Keep him out of it.',
          lines: [
            'I say: I am fine. Go away. I am fine.',
            'The orderly says: ~~Alright, sir. I will check on you in the morning.~~ His footsteps go back the way they came.',
            'The shorter one whispers, very close to the gap: ~~thank you, mister. He did not need to be here.~~',
          ],
          scales: { suspicion: +4, invitation: +3 },
          composure: -3,
          composureCost: 'They thanked me.',
          flags: { dismissed_orderly: true, sent_orderly_away: true },
        },
      ],
    },
  ],

  // ─────────────────────────────────────────────────────────────────────
  //  ENDINGS — fire on flags/scales as soon as their `when` matches.
  // ─────────────────────────────────────────────────────────────────────

  endings: [
    {
      id: 'orderly_came_through',
      when: (p) => p.flags.orderly_alerted && (p.flags.orderly_opening || p.flags.orderly_cautious || p.flags.orderly_will_sit)
        && p.scales.suspicion >= 6 && p.scales.latch >= 8 && !p.flags.sent_orderly_away,
      title: 'The orderly comes through',
      lines: [
        'The orderly is at my door. He unbolts it from his side. He sets the override.',
        'The corridor is empty behind him. The fluorescent tubes are warm. There is a wet print on the linoleum where the two had been standing.',
        'He says: !!I have been at the end of the hall for an hour. There has been no one in this corridor.!!',
        'He looks at the prints for a long beat. Then he says: !!I will sit in the chair by your door tonight.!!',
      ],
      item: 'handkerchief',
    },
    {
      id: 'ground_them_down',
      when: (p) => p.scales.suspicion >= 16 && p.scales.invitation <= 4
        && p.flags.chair_wedged && (p.flags.confronted_anything || p.flags.tested),
      title: 'You ground them down',
      lines: [
        'I have been at the door a long time. I have answered every ask with a no.',
        'The shorter one says, after the longest silence yet: ~~that is enough. We have asked enough.~~',
        'They are gone before the taller one speaks again. There is no sound to their going.',
        'The fluorescent tube above my door flickers once and steadies.',
      ],
      item: 'small_bell',
    },
    {
      id: 'outwaited',
      when: (p) => p.scales.suspicion >= 14 && p.scales.latch >= 14 && p.turn >= 14
        && !p.flags.engaged,
      title: 'You outwait them',
      lines: [
        'I have not spoken to them. The asking has thinned. The spaces between have grown.',
        'The taller one says, finally: ~~he is not going to let us in. We have to go.~~',
        'They step back from the door. Their footprints are wet on the linoleum.',
        'In the morning, the prints are still there. The orderly photographs them. He does not look at me when he does.',
      ],
      item: 'sliver_of_glass',
    },
    {
      id: 'broke_spell',
      when: (p) => (p.flags.bit_cheek || p.flags.said_name) && p.flags.in_mother_story !== true
        && p.scales.invitation <= 8 && p.scales.suspicion >= 8 && p.flags.read_file,
      title: 'You broke the spell',
      lines: [
        'I am at the bed. I am not at the door. I do not go to the door even when she asks.',
        'Eventually the asking thins. The taller one says, very quietly: ~~he came back to himself.~~',
        'I sit there until the line of light under the door changes colour.',
      ],
      item: 'worn_ribbon',
    },
    {
      id: 'said_yes',
      when: (p) => p.flags.in_the_room === true && p.flags.said_yes,
      title: 'You said yes',
      lines: [
        'The bolt is on the floor. They are in the room. They have not moved past the threshold yet.',
        'The taller one closes the door behind them. He sets the chain. He drops the bolt. He turns the chair so it faces the bed.',
        'The shorter one says, settling onto the bed beside me: ~~it has been a long time, mister. You can sleep now.~~',
      ],
      item: null,
      scars: ['collapsed', 'named'],
    },
    {
      id: 'opened',
      when: (p) => p.flags.in_the_room === true && p.flags.opened,
      title: 'You opened it a crack',
      lines: [
        'She has the door. The taller one is past me before I have time to push back.',
        'They are in the room. They are small in here. They are very polite.',
        'She looks up at me. !!Thank you for letting us in, mister. We will be very quiet.!!',
        'The taller one closes the door behind them. He sets the chain. ~~Not for me.~~',
      ],
      item: null,
      scars: ['collapsed'],
    },
    {
      id: 'slot_invasion',
      when: (p) => p.flags.in_the_room === true && p.flags.slot_opened,
      title: 'The slot was wide enough',
      lines: [
        'The hand is in the room. Then the arm. Then the shoulder.',
        'It is not a child. It has never been a child. It says, when it has come fully through: ~~thank you, mister.~~',
      ],
      item: null,
      scars: ['collapsed'],
    },
    {
      id: 'sent_him_away',
      when: (p) => p.flags.sent_orderly_away && p.scales.invitation >= 12,
      title: 'You sent the orderly away',
      lines: [
        'The corridor is empty again. The shorter one is at the gap, thanking me.',
        'I do not know why I sent him away. I had been calling for him for some time.',
        'The bolt has eased back. My hand is on it. I do not remember putting it there.',
      ],
      item: null,
      scars: ['collapsed', 'named'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You leave through the bathroom',
      lines: [
        'I go through the bathroom door. The window over the basin is wide enough for me to fit through.',
        'I am in the courtyard. The two children are at the end of it, looking up at my window.',
        'When they see me at ground level they begin to walk toward me. ~~They have a lot of time.~~',
      ],
      item: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════


// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// THE SCULPTURE — Containment object 173
// ════════════════════════════════════════════════════════════════════════
//
// SCP-173. A small concrete figure with rebar in the mouth. Does not move
// while under direct line of sight. Moves the instant you blink. Has been
// known to break the neck. The door has been bolted from the outside.
// The verbs split sharply: things that hold gaze cost strain but keep it
// still; things that break gaze move it. Doing nothing is doing the
// worst thing — your eyelid is on its own schedule.
//
// Paths:
//   - Back to the door without losing the gaze. Pound until the orderly
//     opens the bolt from the outside.
//   - Force a final stare-down: name what you see, place a hand on it,
//     make eye contact at near-zero distance and outlast.
//   - Blink one too many times.

const sculpture = {
  id: 'sculpture',
  name: '[The Sculpture]',
  glyph: 'Cinderling',
  subtitle: 'It is in the corner. It does not move while you are looking.',
  role: 'wing', tier: 1,
  file: [
    'Item: concrete, humanoid, the height of a child of seven. Two lengths of rebar fixed at the mouth, bent past each other.',
    'Item is **stationary** under continuous line of sight. ~~Breaches correlate with the staff blink rate.~~ Breaches do not occur.',
    'Protocol: two observers, blinks alternating. ~~Subject is one observer.~~ Subject will alternate.',
    'The door is bolted from the corridor side. The override is mounted on the corridor wall, at a height convenient to staff.',
    'Sounds are logged from the cell while it stands empty. ~~Concrete dragged on concrete. Then something softer.~~ Settling.',
    'The strip light flickers. Maintenance has logged it as ~~faulty~~ scheduled. The schedule is not ours.',
  ],
  intro: [
    'The cell is four paces by five. I count them on the way in. Poured concrete, floor and walls, one pour older than the other.',
    'No furniture. No window. One door, behind me. The bolt went home before I had finished turning around.',
    'A strip light along one wall, recessed behind frosted glass. It flickers once, as if taking attendance, and steadies.',
    'In the far corner, a figure. Child-height. Floor-colored. Last verified: now.',
    'It is facing me. ~~It was facing the door when the bolt went home.~~ It is facing me.',
  ],

  scales: {
    distance: {
      initial: 16, min: 0, max: 20, label: 'distance', kind: 'positive',
      bands: [
        { at: 0, word: 'at my throat' },
        { at: 4, word: 'within arm' },
        { at: 8, word: 'a step away' },
        { at: 12, word: 'mid-room' },
        { at: 16, word: 'in the corner' },
        { at: 19, word: 'against the far wall' },
      ],
      crossDown: {
        4: 'Half the room is behind it now. I did not see the half go.',
        3: 'It stands a pace nearer than the record says.',
        2: '!!It is within arm. Its hands are at its sides, which is the posture of waiting.!!',
        1: '!!Within arm. The mouth is open now. No log records it opening.!!',
        0: '!!At my throat. The rebar is the nearest thing in the room.!!',
      },
      crossUp: {
        3: 'One step back. The count to the door comes down by one. It has not moved.',
        4: 'Another step back. Behind it, the corner it started in stands empty, like a plinth between exhibits.',
      },
    },
    strain: {
      initial: 0, min: 0, max: 20, label: 'eye strain', kind: 'negative',
      bands: [
        { at: 0, word: 'clear' },
        { at: 4, word: 'dry' },
        { at: 8, word: 'burning' },
        { at: 12, word: 'watering' },
        { at: 16, word: 'closing on its own' },
        { at: 19, word: 'shut' },
      ],
      crossUp: {
        3: 'Water now. The figure goes soft at the edges, like a photograph of itself.',
        4: '!!My eyelids have stopped taking instructions.!!',
        5: '!!Dark at the rim of everything. My eyes are closing whether I am consulted or not.!!',
      },
      crossDown: {
        2: 'Rested. The figure comes back sharp, every edge accounted for.',
        1: 'The burning stands down.',
      },
    },
    door: {
      initial: 0, min: 0, max: 20, label: 'door', kind: 'positive',
      bands: [
        { at: 0, word: 'far' },
        { at: 4, word: 'a few steps' },
        { at: 8, word: 'within reach behind me' },
        { at: 12, word: 'at my back' },
        { at: 16, word: 'in my hand' },
        { at: 19, word: 'pounding' },
      ],
      crossUp: {
        3: 'My back finds the door. Wood, then the cold line of the hinge.',
        4: '!!The handle is in my hand. The bolt is on the other side of it, doing its work.!!',
      },
    },
  },

  initialize(p, player) {
    p.scales.distance = 16;
    p.scales.strain = 0;
    p.scales.door = 0;
    if (player.scars?.includes('witnessed')) p.scales.strain = 3;
    if (player.scars?.includes('collapsed')) p.scales.distance = 14;
    if (player.wound === 'insomnia') p.scales.strain = 4;
  },

  fileReveals: [
    { at: 5,  announce: 'A line fills in. Mean duration of a breach: 4.2 seconds. My blink rate, logged at admission: sixteen the minute. The two figures are kept on separate pages.' },
    { at: 10, announce: 'Another. The item has been measured at four prior intakes. The four heights on file do not agree.' },
    { at: 16, announce: 'Another. The override is mounted on the corridor wall. ~~There is no override on this side.~~ This side was not expected to need one.' },
    { at: 24, announce: 'Another. Item has stood in this cell since [[4]]. ~~The cell was poured around it.~~' },
    { at: 32, announce: 'Another. Condition: **stationary**. Last verified: ~~continuously~~ at intervals.' },
    { at: 42, announce: '!!The last line. Two observers assigned to this cell are carried in the ledger as **reassigned**. Neither signed out.!!' },
  ],

  presented(p) {
    const d = p.scales.distance;
    const s = p.scales.strain;
    const dr = p.scales.door;

    let it;
    if (d <= 1)      it = '!!It is at my throat. Its hands are at either side of my jaw, fitted, like a frame around an exhibit. Past the rebar there is the back of the mouth, and I am looking at it.!!';
    else if (d <= 4) it = '!!Within reach. I can count the bends in the rebar from here. Four. Yesterday\'s count was four. I do not have a yesterday in this room.!!';
    else if (d <= 8) it = 'It has crossed the floor between blinks I did not record. Its hands are open. The head is tilted forward two degrees, the angle of reading a placard.';
    else if (d <= 12)it = 'It stands at the seam where the two pours of the floor meet. Mid-room. The seam was nine paces from the door when I counted on the way in. ~~Nine.~~ Eight.';
    else if (d <= 16)it = 'It is in its corner. Hands at sides. Mouth closed. Last verified: now, and now, and now.';
    else             it = 'It is against the far wall, backed into its corner like a thing on loan that no one will claim. It has not moved from where it ~~started~~ was installed.';

    let eye;
    if (s >= 16)     eye = '!!My eyes are at their limit. The rim of the room is going dark. I am holding the lids up with my forehead, with my scalp, with whatever still answers. They will close. The only open question is when.!!';
    else if (s >= 12)eye = '!!Watering hard. The room runs at the edges. My forehead is doing the work my eyelids have resigned from.!!';
    else if (s >= 8) eye = 'Burning now. The figure wears a halo it has not earned. I have started counting to hold the blink off — the count is the only schedule in this room that is mine.';
    else if (s >= 4) eye = 'Dry. The outline of the figure has loosened by a thread against the wall behind it.';
    else             eye = 'My eyes are clear. The figure is sharp to its last edge. I have counted its edges. I will count them again.';

    let back;
    if (dr >= 16)    back = 'My back is on the door. The handle sits at my hip like a confiscated thing. The bolt is on the corridor side, where the protocol keeps it.';
    else if (dr >= 12)back = 'My back is at the door. Both hands at my sides, near the handle, not on it. Reaching is a decision I am saving.';
    else if (dr >= 8) back = 'Most of the room is behind me now. I have counted the paces left. ~~Four.~~ The count comes back five.';
    else if (dr >= 4) back = 'A few steps gained toward the door. I keep the count under my breath, where the room cannot amend it.';
    else if (dr >= 1) back = 'One step back. I have logged it. One.';
    else              back = 'I have not moved. The record can say that much for me.';

    return `${it} ${eye} ${back}`;
  },

  verbs: {

    stare: {
      label: 'stare',
      desc: 'Do not blink. Hold the line of sight.',
      respond(p) {
        const reps = streakCount(p, 'stare');
        if (reps >= 3) {
          return {
            lines: [
              'I keep staring. The water doubles every edge it touches. There are two figures now, overlapping, and both of them are still.',
              'It has not moved. It has not moved. I write it twice because twice is how often I checked.',
              'The strip light flickers. I do not blink. The flicker is logged. The blink is not.',
            ],
            scales: { strain: +5 },
            composure: -3,
            composureCost: 'My body has filed an objection. I am holding my eyes open over it.',
          };
        }
        if (reps >= 2) {
          return {
            lines: [
              'I keep staring. The figure keeps being a figure. The room keeps being four paces by five.',
              'I count heartbeats instead of blinking. I pass sixty. I pass sixty again.',
              'My eyes are two dry stones.',
            ],
            scales: { strain: +4 },
            composure: -2,
            composureCost: 'Past sixty twice, and nothing in the room is mine but the count.',
          };
        }
        if (reps >= 1) {
          return {
            lines: [
              'I keep staring. The figure does not move. Water gathers at the rim of my sight, patient as everything else in here.',
              'The wall is somewhere behind me. I know the distance as a number. I do not turn to confirm the number.',
            ],
            scales: { strain: +3 },
            composure: -1,
            composureCost: 'The count to the door is a number I am taking on faith.',
          };
        }
        return {
          lines: [
            'I do not blink. The figure does not move. We are both exhibits now.',
            'The room is quiet enough to hear the strip light: a thin hum, filed under maintenance.',
          ],
          scales: { strain: +2 },
        };
      },
    },

    back_toward_the_door: {
      label: 'back toward the door',
      desc: 'Step backward. Eyes forward.',
      respond(p) {
        const reps = streakCount(p, 'back_toward_the_door');
        if (reps >= 2) {
          return {
            lines: [
              'Another step back. My heel finds the door before the count says it should. ~~Three paces short.~~ The room has been shortened, or the count has.',
              'The figure has not moved. Through the water it is a grey smear in the corner, exactly where the record wants it.',
            ],
            scales: { door: +4, strain: +3 },
            composure: -1,
            composureCost: 'The floor behind me is unverified. I am walking on the last count I took.',
          };
        }
        if (reps >= 1) {
          return {
            lines: [
              'Another step back. My calf finds the wall. The wall is where I counted it. Small mercies, logged.',
              'The figure has not moved. My eyes are dry as paper.',
            ],
            scales: { door: +3, strain: +2 },
            composure: -1,
            composureCost: 'Most of the way to the door, by my own arithmetic.',
          };
        }
        return {
          lines: [
            'I step backward without turning my head. The pace is half a pace. I log it as one anyway.',
            'The figure does not move. The wall arrives sooner than the count said it would.',
          ],
          scales: { door: +2, strain: +1 },
        };
      },
    },

    side_step_toward_the_door: {
      label: 'side-step toward the door',
      desc: 'Laterally. Eyes still on it.',
      when: (p) => p.scales.door <= 12,
      respond(p) {
        return {
          lines: [
            'I pour my weight into one leg and bring the other across. Quietly. The way you move in a room where you are not meant to be the exhibit.',
            'My foot reads the seam in the concrete. I do not look down to check it. The seam will have to take my word.',
          ],
          scales: { door: +2, strain: +1 },
          composure: -1,
          composureCost: 'I surveyed the floor with a foot. The eyes were spoken for.',
        };
      },
    },

    two_step_retreat: {
      label: 'two-step retreat',
      desc: 'Fast. Eyes open. Risky.',
      when: (p) => p.scales.door <= 14,
      respond(p) {
        return {
          lines: [
            'Two steps, fast, backward. The water jumps in my eyes.',
            'For one beat there are two of it, side by side, and I cannot say which one is on the record.',
            'My sight resettles. One figure. Same corner. My back is nearer the wall by two counted steps.',
          ],
          scales: { door: +5, strain: +4 },
          composure: -2,
          composureCost: 'For a beat there were two of it, and no way to file the second.',
        };
      },
    },

    count: {
      label: 'count to thirty',
      desc: 'Hold the stare. Pass the time.',
      respond(p) {
        const reps = streakCount(p, 'count');
        if (reps >= 1) {
          return {
            lines: [
              'I begin again at one. I get to thirty. I do not blink.',
              'The strip light has flickered twice during the count. I did not flinch.',
            ],
            scales: { strain: +4 },
            composure: -2,
            composureCost: 'The light flickered. I did not flinch.',
          };
        }
        return {
          lines: [
            'I count to thirty in my head. The figure does not move. I do not blink.',
            'On twenty-seven the strip light flickers. I do not flinch.',
          ],
          scales: { strain: +3 },
          composure: -1,
          composureCost: 'My eyes are heavier than they were at one.',
        };
      },
    },

    name_what_you_see: {
      label: 'name what you see',
      desc: 'Out loud. Without looking away.',
      respond(p) {
        const reps = streakCount(p, 'name_what_you_see');
        const obs = [
          [
            'I say: there is rebar in its mouth. The rebar is bent. There are two pieces, like fangs, twisted past each other.',
            'I say: the bend in the rebar is exactly the same as it was a minute ago.',
          ],
          [
            'I say: there is a brown stain on its left shoulder. The stain is dry. It is the size of a thumbprint.',
            'I say: the stain has not changed shape.',
          ],
          [
            'I say: there is a chip on the inside of its right elbow. About a centimeter. The chip has gray inside the gray.',
            'I say: the chip is exactly the same. The chip has not chipped further.',
          ],
          [
            'I say: there is dust on its left shoe. The dust is the same color as the floor. It has been here longer than I have.',
            'I say: the dust has not moved.',
          ],
        ];
        const idx = Math.min(reps, obs.length - 1);
        return {
          lines: obs[idx],
          scales: { strain: +3 },
          composure: -1,
          composureCost: 'Saying it out loud keeps my eyes on it.',
        };
      },
    },

    focus_on_a_detail: {
      label: 'focus on its mouth',
      desc: 'The rebar. Lock on it.',
      when: (p) => p.scales.distance <= 12,
      respond(p) {
        const reps = streakCount(p, 'focus_on_a_detail');
        if (reps >= 1) {
          return {
            lines: [
              'I keep on the rebar. The bend is the same. The angle is the same.',
              'The angle has changed by maybe a degree. I cannot be sure.',
              'I am not sure.',
            ],
            scales: { strain: +4 },
            composure: -2,
            composureCost: 'I am not sure if the angle has changed.',
          };
        }
        return {
          lines: [
            'I narrow my gaze to its mouth. The rebar is two pieces. They are bent past each other.',
            'I count the angles. There are four bends. I memorize them.',
          ],
          scales: { strain: +2 },
        };
      },
    },

    close_one_eye: {
      label: 'close one eye',
      desc: 'Rest it. Keep the other open.',
      when: (p) => p.scales.strain >= 5,
      respond(p) {
        const reps = streakCount(p, 'close_one_eye');
        if (reps >= 1) {
          return {
            lines: [
              'I switch eyes. The other one rests. The first one floods.',
              'For a beat the figure is on both walls. Then it is on only one.',
            ],
            scales: { strain: -4, distance: -1 },
            composure: -2,
            composureCost: 'For a beat the figure was on both walls.',
          };
        }
        return {
          lines: [
            'I close my left eye. I keep my right on the figure.',
            'My right eye floods. The figure has a second outline against the wall now.',
          ],
          scales: { strain: -4, distance: -1 },
          composure: -1,
          composureCost: 'For a beat I could not be sure of what I was looking at.',
        };
      },
    },

    blink_fast: {
      label: 'blink fast',
      desc: 'A controlled blink. Quarter-second.',
      respond(p) {
        return {
          lines: [
            'I blink. As fast as my body can. A quarter of a second.',
            'The figure is one pace closer than it was. Its hands have not come up.',
          ],
          scales: { strain: -3, distance: -2 },
          composure: -2,
          composureCost: 'It used the quarter second.',
        };
      },
    },

    recite_an_address: {
      label: 'recite an address',
      desc: 'Anything. Yours. Your mother\'s. Anchor.',
      respond(p) {
        const reps = streakCount(p, 'recite_an_address');
        if (reps >= 1) {
          return {
            lines: [
              'I say the address again. Slower. The street, then the city, then the postal code.',
              'My eyes are wet but they are open. The figure has not moved.',
            ],
            scales: { strain: -2 },
            composure: +1,
          };
        }
        return {
          lines: [
            'I say an address out loud. A street. A city. A postal code.',
            'It is mine. Or it was mine. The figure has not moved.',
          ],
          scales: { strain: -2 },
          composure: +1,
        };
      },
    },

    glance_at_the_floor: {
      label: 'glance at the floor',
      desc: 'Just for a second. Find your footing.',
      respond(p) {
        return {
          lines: [
            'I look down. Just for a second. My foot was about to find the seam.',
            'When I look up the figure is two paces closer than it was. Its hands have come up.',
          ],
          scales: { distance: -5, strain: -1 },
          composure: -3,
          composureCost: '!!It moved while I was looking at my feet.!!',
          shake: true,
        };
      },
    },

    look_at_its_eyes: {
      label: 'look at its eyes',
      desc: 'The sockets. Specifically.',
      when: (p) => p.scales.distance <= 12 && p.scales.strain <= 10,
      respond(p) {
        const reps = streakCount(p, 'look_at_its_eyes');
        if (reps >= 1) {
          return {
            lines: [
              'I look again. The sockets are not empty. There is something at the back of them.',
              'It is wet. It is small. It moves when my eye moves.',
            ],
            scales: { strain: +4 },
            composure: -3,
            composureCost: 'There is something at the back of its sockets.',
            flags: { saw_eyes: true },
          };
        }
        return {
          lines: [
            'I focus on the sockets. They are deep. They are not empty.',
            'I cannot see what is in them. The light is poor.',
          ],
          scales: { strain: +3 },
          composure: -1,
          composureCost: 'The sockets were not empty.',
        };
      },
    },

    reach_for_the_handle: {
      label: 'reach for the handle',
      desc: 'Behind you. Eyes still forward.',
      when: (p) => p.scales.door >= 12,
      respond(p) {
        const reps = streakCount(p, 'reach_for_the_handle');
        if (reps >= 1) {
          return {
            lines: [
              'I find the handle again. It is the same handle. The lock is the same lock.',
              'I twist hard. Nothing.',
            ],
            scales: { strain: +1 },
            composure: -1,
            composureCost: 'It is the same lock.',
          };
        }
        return {
          lines: [
            'I reach behind me. My fingers find the handle. The handle is cold.',
            'I twist it. Nothing. The door is bolted from the outside.',
          ],
          scales: { strain: +1 },
          composure: -2,
          composureCost: '!!The door is locked from the outside.!!',
          flags: { handle_tried: true },
        };
      },
    },

    pound_on_the_door: {
      label: 'pound on the door',
      desc: 'For the orderly. Eyes still forward.',
      when: (p) => p.scales.door >= 14,
      respond(p) {
        const reps = streakCount(p, 'pound_on_the_door');
        if (reps >= 3) {
          return {
            lines: [
              'I pound a fourth time. There are footsteps in the corridor. Faster.',
              'A voice calls through the door. ~~Hold on. I am coming.~~',
              'The bolt slides on the other side.',
            ],
            scales: { strain: +1 },
            flags: { orderly_coming: true },
          };
        }
        if (reps >= 2) {
          return {
            lines: [
              'I pound again. There are footsteps in the corridor. Slow. They have stopped.',
              'I do not know if they are coming closer.',
            ],
            scales: { strain: +1 },
            composure: -1,
            composureCost: 'The footsteps stopped. I do not know where.',
          };
        }
        if (reps >= 1) {
          return {
            lines: [
              'I pound the heel of my fist against the door. Harder.',
              'A footstep. Distant. Then nothing.',
            ],
            scales: { strain: +1 },
            composure: -1,
            composureCost: 'One footstep. Then nothing.',
          };
        }
        return {
          lines: [
            'I pound the heel of my fist against the door. The figure does not move.',
            'No one answers.',
          ],
          scales: { strain: +1 },
          composure: -2,
          composureCost: 'No one answered.',
        };
      },
    },

    scream: {
      label: 'scream',
      desc: 'All of it. Eyes open.',
      when: (p) => p.scales.door >= 12 || p.scales.strain >= 12,
      respond(p) {
        return {
          lines: [
            'I scream. The note is high and ragged and it leaves me.',
            'The figure does not move. The strip light flickers and steadies.',
            'In the corridor, a door opens. Footsteps. Faster than the orderly\'s.',
          ],
          scales: { strain: +2 },
          composure: -3,
          composureCost: 'I gave the whole of my breath to one note.',
          flags: { screamed: true },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Do nothing. Eventually you blink.',
    when: () => true,
  },

  interjections: [
    {
      id: 'forced_blink',
      once: true,
      when: (p) => p.scales.strain >= 12,
      prose: [
        'My eyes are watering badly. They want to shut. They have already shut once or twice in fractions of a second I cannot account for.',
        'They are going to shut for longer. ~~I can choose how.~~',
      ],
      responses: [
        {
          label: 'hold one open',
          desc: 'Sacrifice the left. Keep the right.',
          lines: [
            'I let my left eye close. I hold the right one open with the tips of my fingers.',
            'It feels obscene. The figure does not move.',
          ],
          scales: { strain: -6, distance: -1 },
          composure: -2,
          composureCost: 'I am keeping my eye open with my hand.',
        },
        {
          label: 'blink fast',
          desc: 'A quarter of a second. Hope.',
          lines: [
            'I blink. Very fast. As fast as my body can.',
            'The figure is one pace closer. Its head is tilted by a degree.',
          ],
          scales: { distance: -3, strain: -5 },
          composure: -2,
          composureCost: '!!It used the quarter second.!!',
        },
        {
          label: 'let them close',
          desc: 'Eyes shut. Long.',
          lines: [
            'I let my eyes close. ~~A breath. Two.~~ Three.',
            'When I open them the figure has its hand on my chest.',
          ],
          scales: { distance: -10, strain: -14 },
          composure: -4,
          composureCost: '!!Its hand is on my chest.!!',
          shake: true,
        },
        {
          label: 'press your eyes with your palms',
          desc: 'Drive the tears back.',
          lines: [
            'I press both palms against my eye sockets without closing my eyes. The pressure forces the tears back.',
            'I open my hands. The figure has not moved. My vision is doubled but it is open.',
          ],
          scales: { strain: -4, distance: -1 },
          composure: -1,
          composureCost: 'My vision is doubled.',
        },
      ],
    },
    {
      id: 'light_flicker',
      once: true,
      when: (p) => p.turn >= 3,
      prose: [
        'The strip light flickers. Long. Three flickers in succession.',
        'In the third flicker the figure is in a different posture than it was in the second.',
        'I am not sure of that. ~~I am sure of that.~~',
      ],
      responses: [
        {
          label: 'do not flinch',
          desc: 'Hold the gaze through it.',
          lines: [
            'I do not flinch. The fourth flicker comes. The fifth does not.',
            'The figure is in its original posture again. I am not sure if it ever was not.',
          ],
          scales: { strain: +4 },
          composure: -2,
          composureCost: 'I am not sure if it ever was not.',
        },
        {
          label: 'close one eye through it',
          desc: 'Hedge.',
          lines: [
            'I close my left eye for the duration of the flicker. The right is still on the figure.',
            'When the light steadies I open the left. The figure is in the same place. I think.',
          ],
          scales: { strain: -2, distance: -1 },
        },
        {
          label: 'name the strip light',
          desc: 'Anchor the room.',
          lines: [
            'I say: strip light. Fluorescent. Recessed. Frosted glass.',
            'I say it the way I would describe a thing to someone else. The flickers stop.',
          ],
          scales: { strain: +1 },
          composure: +1,
        },
      ],
    },
    {
      id: 'sound_behind_you',
      once: true,
      when: (p) => p.scales.door >= 6 && p.turn >= 4,
      prose: [
        'A sound behind me. Concrete on concrete. Small.',
        'My eyes want to dart. The figure is in front of me.',
      ],
      responses: [
        {
          label: 'do not turn',
          desc: 'Eyes forward.',
          lines: [
            'I do not turn. The sound does not come again.',
            'The figure has not moved.',
          ],
          scales: { strain: +3 },
          composure: -2,
          composureCost: 'I do not know what the sound was.',
        },
        {
          label: 'turn your head',
          desc: 'Just briefly.',
          lines: [
            'I turn my head. Just a beat.',
            'When I look back the figure is three paces closer than it was. Its mouth is open.',
          ],
          scales: { distance: -6, strain: -1 },
          composure: -3,
          composureCost: '!!Its mouth is open.!!',
          shake: true,
        },
        {
          label: 'ask through the door',
          desc: 'Out loud. Without turning.',
          lines: [
            'I say: who is there.',
            'There is no answer. The sound does not come again. The figure has not moved.',
          ],
          scales: { strain: +1 },
        },
      ],
    },
    {
      id: 'it_tilts',
      once: true,
      when: (p) => p.scales.distance <= 12 && p.scales.strain <= 12,
      prose: [
        'I am sure the figure\'s head has tilted by a degree while I have been watching it.',
        'I am sure. I have not blinked. ~~I have not blinked.~~',
      ],
      responses: [
        {
          label: 'measure against the wall',
          desc: 'Use the seam behind it as a reference.',
          lines: [
            'I use the corner seam behind it as a reference. The head is at one angle to the seam.',
            'A beat. The head is at the same angle. I was wrong. ~~I was right.~~',
          ],
          scales: { strain: +3 },
          composure: -2,
          composureCost: 'I was right. I was wrong. I do not know which.',
        },
        {
          label: 'speak its name',
          desc: 'It does not have one.',
          lines: [
            'I say the containment number out loud. Slowly. As a question.',
            'The figure does not respond. The figure does not move. ~~I have not blinked.~~',
          ],
          scales: { strain: +2 },
        },
        {
          label: 'ignore it',
          desc: 'Eyes forward. Move on.',
          lines: [
            'I do not give it the moment. I keep my eyes on it. I do not check.',
            'I will not know. I do not need to know.',
          ],
          scales: { strain: +2 },
          composure: -1,
          composureCost: 'I do not need to know. I want to know.',
        },
      ],
    },
    {
      id: 'final_stare',
      once: true,
      when: (p) => p.scales.distance <= 4 && p.scales.strain <= 14,
      prose: [
        'It is within reach. Its open mouth is at the level of my chest.',
        'It is waiting for me to blink. I have not blinked. I am very close to blinking.',
      ],
      responses: [
        {
          label: 'do not blink',
          desc: 'Just hold.',
          lines: [
            'I do not blink. I do not breathe in for a long time.',
            'The figure does not move.',
          ],
          scales: { strain: +4 },
          composure: -2,
          composureCost: 'My eyes are open. They have stopped wanting to close.',
        },
        {
          label: 'name what is in its mouth',
          desc: 'Aloud.',
          lines: [
            'I say: that is rebar. From a building. Bent.',
            'I say: it has been wedged in for a long time. The bend is old.',
            'The figure has not moved. ~~Its mouth has closed by a degree.~~',
          ],
          scales: { strain: +3, distance: +2 },
          flags: { named_mouth: true },
        },
        {
          label: 'put a hand on its head',
          desc: 'Crown of the head. Slow.',
          lines: [
            'I lower my hand onto the top of its head. It is rough. It is the temperature of the room.',
            'It does not move. ~~My eyes have not closed.~~',
          ],
          scales: { strain: +2, distance: +2 },
          flags: { touched_it: true },
          composure: -2,
          composureCost: 'I touched it.',
        },
        {
          label: 'put a hand over its mouth',
          desc: 'Cover the rebar.',
          lines: [
            'I bring my palm down over the rebar. The metal is room-temperature.',
            'My fingers wrap the back of its skull. It does not move under my hand.',
            'I am the one closer to it now.',
          ],
          scales: { strain: +3, distance: +1 },
          flags: { covered_mouth: true },
          composure: -3,
          composureCost: 'My fingers wrapped the back of its skull.',
        },
      ],
    },
    {
      id: 'corridor_voice',
      once: true,
      when: (p) => p.flags.handle_tried,
      prose: [
        'A voice on the other side of the door. Faint. The orderly\'s.',
        'He says: ~~hold on. There is a — give me a minute. The override has — hold on.~~',
      ],
      responses: [
        {
          label: 'hold on',
          desc: 'Tell him to keep working.',
          lines: [
            'I say: hold on. I am not blinking. I will not blink.',
            'He does not answer. There is a sound of metal on metal.',
          ],
          scales: { strain: +2 },
        },
        {
          label: 'hurry',
          desc: 'Loudly. Through the door.',
          lines: [
            'I say: hurry. Please.',
            'He does not answer. He is still working.',
          ],
          scales: { strain: +2 },
          composure: -1,
          composureCost: 'He has been working on the override longer than he should have to.',
        },
        {
          label: 'describe what you see',
          desc: 'So he knows.',
          lines: [
            'I say: it is two paces from me. Its mouth is open. I have not blinked in some minutes.',
            'He says: ~~understood. Hold on.~~',
          ],
          scales: { strain: +3 },
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.strain >= 14) {
      return {
        lines: [
          'I do nothing. My eyes close on their own. Not for long. Half a second.',
          'When I open them the figure is two paces closer than it was. Its head has tilted.',
        ],
        scales: { distance: -2, strain: -2 },
        composure: -2,
        composureCost: 'I blinked. I did not mean to.',
      };
    }
    if (p.scales.strain >= 8) {
      return {
        lines: [
          'I do nothing. My eyes water. A blink slips through. A quarter of a second.',
          'When I open them the figure is one pace closer than it was.',
        ],
        scales: { distance: -1, strain: -1 },
        composure: -1,
        composureCost: 'I blinked. I did not mean to.',
      };
    }
    return {
      lines: [
        'I do nothing. My eyes close on their own. A small blink.',
        'The figure has moved a small amount.',
      ],
      scales: { distance: -1, strain: -1 },
      composure: -1,
      composureCost: 'A small blink. A small movement.',
    };
  },

  endings: [
    {
      id: 'backed_out',
      when: (p) => p.flags.orderly_coming && p.scales.distance >= 4,
      title: 'The bolt slides',
      lines: [
        'The bolt slides. The door opens behind me.',
        'I back out without looking away. The orderly catches me by the elbow.',
        'He shuts the door. He sets the override. The room is the figure\'s again.',
        'He says: !!I am sorry. I am very sorry. The override was — the override was sticking.!!',
      ],
      item: 'handkerchief',
    },
    {
      id: 'screamed_in',
      when: (p) => p.flags.screamed && p.scales.distance >= 4,
      title: 'You screamed. He came.',
      lines: [
        'The bolt slides. Faster than the orderly would have moved.',
        'A night nurse is at the door. She pulls me by the wrist into the corridor.',
        'She does not look into the room before she closes it.',
        'She says: !!do not scream like that again. I was on the other side of the building.!!',
      ],
      item: 'small_bell',
    },
    {
      id: 'final_stare_won',
      when: (p) => (p.flags.named_mouth || p.flags.touched_it || p.flags.covered_mouth) && p.scales.distance >= 2 && p.scales.strain <= 14,
      title: 'You hold the stare',
      lines: [
        'It does not move. I do not blink. The room steadies.',
        'After a long beat, a sound from the corridor. The bolt slides. The door opens.',
        'The figure has not moved. Its mouth has closed by a degree. I am almost sure of that.',
      ],
      item: 'sliver_of_glass',
    },
    {
      id: 'it_let_you_go',
      when: (p) => p.flags.covered_mouth && p.flags.saw_eyes && p.scales.strain <= 16,
      title: 'You hold its mouth',
      lines: [
        'My palm is over the rebar. My fingers are at the back of its skull. The figure does not move.',
        'I take my hand away. I back to the door, slowly. The figure does not move.',
        'The bolt slides on the other side. I leave it where I found it.',
      ],
      item: 'sliver_of_glass',
    },
    {
      id: 'reached',
      when: (p) => p.scales.distance <= 0,
      title: 'It is at your throat',
      lines: [
        'I blink. The figure is at my throat. Its open mouth is at my collarbone.',
        'The rebar is the last thing in the room. The rebar is the last thing.',
      ],
      item: null,
      scars: ['collapsed'],
    },
    {
      id: 'closed_eyes',
      when: (p) => p.scales.strain >= 20,
      title: 'Your eyes close',
      lines: [
        'My eyes shut. I cannot make them open. I count my heartbeats. I count past three.',
        'The figure has been waiting for this. I do not feel it cross the room.',
        'I only feel the rebar.',
      ],
      item: null,
      scars: ['collapsed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You turn your back',
      lines: [
        'I look at the door. I do not look at the figure.',
        'I do not hear it cross the room. ~~That is the last thing I do not hear.~~',
      ],
      item: null,
      scars: ['collapsed'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// THE PLAGUE DOCTOR — Containment object 049
// ════════════════════════════════════════════════════════════════════════
//
// SCP-049. A figure in 17th-century plague-doctor regalia. Polite, fluent
// in Latin, civilized. He believes he can perceive a "Pestilence" inside
// every patient he attends, and that his touch will administer the cure.
// The cure is fatal. He bows. He explains. He approaches. He addresses
// the player as "miser" (Latin: wretch, sick one).
//
// Paths:
//   - Sow doubt: refute the diagnosis with a specific symptom he has not
//     accounted for; catch him in the Latin; name the date his license
//     was struck from the register.
//   - Break the rite: knock the case, defile the camphor, refuse the
//     gown. The ritual is brittle if you make it visible.
//   - The cure.

const plague = {
  id: 'plague',
  name: '[The Plague Doctor]',
  glyph: 'Charnel',
  subtitle: 'He has diagnosed your pestilence. He has the cure.',
  role: 'wing', tier: 2,
  file: [
    'Subject reports a Visitor in the dress of a 17th-century plague physician.',
    'Visitor carries a leather case. ~~Lancets within.~~ Implements within.',
    'Visitor speaks chiefly in Latin. ~~Subject does not have Latin. The Visitor is being understood anyway.~~',
    'Visitor has identified Subject as a carrier of the Pestilence. !!He intends to administer.!!',
    'The room smells of camphor and vinegar of the four thieves. The window has been closed.',
    'Four other patients on this ward were attended last night. ~~None were present at roll call.~~',
  ],
  intro: [
    'He is standing at the foot of the bed. The beak is dark and curved. The hat is wide and black and low-crowned. The robe is ash grey, ankle-length, gathered at the throat.',
    'His gloves are dark leather. He has not taken them off. He has not taken the beak off either.',
    'He bows from the waist. He says, in even Latin: !!Salve. Sum medicus. Veni curare.!!',
    'He sets the leather case on the writing table. He unbuckles the first strap. He has done this before.',
    'He says: ~~the pestilence in you is well-advanced. We shall begin with the lesser instruments.~~',
  ],

  scales: {
    proximity: {
      initial: 14, min: 0, max: 20, label: 'proximity', kind: 'positive',
      bands: [
        { at: 0, word: 'gloved thumb on throat' },
        { at: 4, word: 'at the bedside' },
        { at: 8, word: 'at arm' },
        { at: 12, word: 'at the table' },
        { at: 16, word: 'at the foot' },
        { at: 19, word: 'in the doorway' },
      ],
      crossDown: {
        4: 'He has stepped around the table.',
        3: 'He has crossed to the bedside.',
        2: '!!His gloved hand is on the rail of the bed.!!',
        1: '!!His glove is on my wrist. He is taking a pulse he does not need.!!',
        0: '!!His thumb is on my throat. Below the jaw.!!',
      },
      crossUp: {
        3: 'He has stepped back to the table.',
        4: 'He has returned to the foot of the bed.',
        5: 'He has stepped into the doorway. He has not left the room.',
      },
    },
    cure: {
      initial: 2, min: 0, max: 20, label: 'the rite', kind: 'negative',
      bands: [
        { at: 0, word: 'unbegun' },
        { at: 4, word: 'first invocation' },
        { at: 8, word: 'second invocation' },
        { at: 12, word: 'implements laid' },
        { at: 16, word: 'lance in hand' },
        { at: 19, word: 'about to begin' },
      ],
      crossUp: {
        2: 'He has set out the first instrument. ~~A small brass tube.~~',
        3: '!!He has finished the second invocation. The room smells of camphor.!!',
        4: '!!He has the lance. He has begun to peel his glove back.!!',
        5: '!!He has the lance over the wrist. He is reciting the final verse.!!',
      },
      crossDown: {
        3: 'He has set the instrument back. He is reviewing the case.',
        2: 'He has folded one of the cloths.',
        1: 'He has gone back to the case.',
      },
    },
    doubt: {
      initial: 0, min: 0, max: 20, label: 'his doubt', kind: 'positive',
      bands: [
        { at: 0, word: 'unshaken' },
        { at: 4, word: 'consulting' },
        { at: 8, word: 'uncertain' },
        { at: 12, word: 'reconsidering' },
        { at: 16, word: 'misdiagnosed' },
        { at: 19, word: 'kneeling' },
      ],
      crossUp: {
        3: 'He has paused. He is reading his own notes from the case.',
        4: '!!He has closed the case.!!',
        5: '!!He has set the beak on the writing chair. He has not removed it.!!',
      },
      crossDown: { 1: 'He has resolved his doubt. He is sure again.' },
    },
  },

  initialize(p, player) {
    p.scales.proximity = 14;
    p.scales.cure = 2;
    p.scales.doubt = 0;
    if (player.scars?.includes('witnessed')) p.scales.cure = 4;
    if (player.scars?.includes('collapsed')) p.scales.proximity = 12;
    if (player.wound === 'amnesia') p.scales.cure = 4;
  },

  fileReveals: [
    { at: 5,  announce: 'A line fills in. Visitor has been on the ward for [[3]] days. ~~He has attended four others.~~' },
    { at: 10, announce: 'Another. The implements in his case are not period. ~~They are sharpened to a modern edge.~~' },
    { at: 16, announce: 'Another. The Latin he is speaking is a funeral office. Specifically, the office for one who has died of plague.' },
    { at: 24, announce: 'Another. His credentials are signed by a board that was disbanded in [[4]].' },
    { at: 32, announce: 'Another. The four others he attended are in the basement morgue. ~~They are not noted in the day log.~~' },
    { at: 42, announce: '!!The last line. He has been struck from the medical register on the same date his credentials were signed.!!' },
  ],

  presented(p) {
    const px = p.scales.proximity;
    const c = p.scales.cure;
    const d = p.scales.doubt;

    let where;
    if (px <= 1)      where = '!!His glove is on my throat. The thumb is below my jaw. He is taking a pulse he does not need. He has been taking it for some seconds.!!';
    else if (px <= 4) where = '!!He is at the bedside. He has set his beak against the lapel of his robe. He is leaning slightly forward.!!';
    else if (px <= 8) where = 'He has come around the table. He is standing over the writing chair. He has the lance in one hand and the cloth in the other.';
    else if (px <= 12)where = 'He is at the writing table. He has both gloves on the case. He is selecting.';
    else if (px <= 16)where = 'He is at the foot of the bed. The case is open behind him. His weight is on his back foot.';
    else              where = 'He is in the doorway. The case is open on the table. He has not picked anything up yet.';

    let rite;
    if (c >= 16)      rite = '!!He has the lance in his right hand. His left glove is half off. He is reciting the final verse of the rite. The Latin is sharp at the consonants.!!';
    else if (c >= 12) rite = 'He has the brass tube. He has the cloths laid out. He has the lance ready. He is reading the third invocation.';
    else if (c >= 8)  rite = 'He has the first implement out. He is reciting the second verse in Latin. The room smells of vinegar.';
    else if (c >= 4)  rite = 'He has begun reciting. The first verse is shorter than I expected. He has begun unrolling a cloth.';
    else              rite = 'The case is open. He has not lifted anything out. He has been reading the notes.';

    let mind;
    if (d >= 16)      mind = '!!He has closed the case. He has set the beak on the writing chair. He is reading his own notes by hand.!!';
    else if (d >= 12) mind = '!!He has paused mid-verse. He is reading his own notes from the case for the third time.!!';
    else if (d >= 8)  mind = 'His head has tilted. He has paused mid-recitation. He is consulting the chart.';
    else if (d >= 4)  mind = 'He has glanced at the case twice in a row. He had not before.';
    else              mind = 'He is certain. His movements are exact. The bow is the same depth every time.';

    return `${where} ${rite} ${mind}`;
  },

  verbs: {

    object_to_the_diagnosis: {
      label: 'object to the diagnosis',
      desc: 'You do not have the pestilence.',
      respond(p, player) {
        const reps = streakCount(p, 'object_to_the_diagnosis');
        if (reps >= 2) {
          return {
            lines: [
              'I object a third time. The same words. ~~I do not have the pestilence.~~',
              'He inclines the beak. He says, with no impatience: !!Miser. The pestilence is the kindest illness. It does not let its host know it is there.!!',
              'He turns to the case. He selects another implement.',
            ],
            scales: { cure: +3, doubt: +1 },
            composure: -2,
            composureCost: 'He found my objection charming.',
          };
        }
        if (reps >= 1) {
          return {
            lines: [
              'I say it again. I do not have the pestilence.',
              'He bows. He says, gently: !!Miser. The pestilence does not announce itself. That is its first kindness. The second is brief.!!',
            ],
            scales: { cure: +2, doubt: +1 },
            composure: -1,
            composureCost: 'He is sure. He is kind about it.',
          };
        }
        return {
          lines: [
            'I say: I do not have what you think I have.',
            'He inclines his head. He says: !!Ah. They do say that.!! He returns to the case.',
          ],
          scales: { doubt: +2 },
        };
      },
    },

    name_a_missing_symptom: {
      label: 'name a symptom he misses',
      desc: 'No buboes. No fever. No rose on the chest.',
      respond(p) {
        const reps = streakCount(p, 'name_a_missing_symptom');
        if (reps >= 2) {
          return {
            lines: [
              'I name a third. My eyes are not yellow. My tongue is not coated. My lymph is not swollen at the throat or under the arm.',
              'He has been listening. The bird-beak has been still for some seconds.',
              'He turns to the case. He reads. He does not turn back to me.',
            ],
            scales: { doubt: +5, cure: -2 },
            composure: -1,
            composureCost: 'He listened to all three.',
            flags: { three_symptoms: true },
          };
        }
        if (reps >= 1) {
          return {
            lines: [
              'I name another. My tongue is clean. My breath is not foul. The hollow at my throat is not warm to the back of my hand.',
              'He pauses. He turns to the case. He reads. The bird-beak nods, once.',
            ],
            scales: { doubt: +4, cure: -1 },
            composure: -1,
            composureCost: 'The beak nodded, once.',
          };
        }
        return {
          lines: [
            'I say: I have no buboes. No fever. No swelling at the lymph. No rose on my chest. No vomit on my breath.',
            'He inclines his head. He has heard me. He says: ~~the pestilence wears many faces, miser. The face it wears for you is the absence of all of these.~~',
          ],
          scales: { doubt: +3 },
        };
      },
    },

    demand_his_credentials: {
      label: 'demand his credentials',
      desc: 'A letter. A seal. A name.',
      respond(p) {
        const reps = streakCount(p, 'demand_his_credentials');
        if (reps >= 1) {
          return {
            lines: [
              'I say: I want to see them again. The seal.',
              'He hands the paper back to me. The seal is broken at a different place than before. ~~The wax has moved.~~',
              'I look up at him. He has not moved. The seal has moved.',
            ],
            scales: { doubt: +4, cure: -1 },
          };
        }
        return {
          lines: [
            'I say: by whose order are you here.',
            'He produces a folded paper from inside the robe. The seal is broken. The hand of the writing is not the same as the hand on the seal.',
            'I show him the discrepancy. He looks at it for a long beat. He puts the paper back inside the robe.',
            'He says: ~~the seal is from the Board, miser. The Board issued it to me before I was a physician.~~',
          ],
          scales: { doubt: +4, proximity: +1 },
          composure: -1,
          composureCost: 'The seal was not in the hand of its writing.',
          flags: { credentials_questioned: true },
        };
      },
    },

    ask_what_year_he_thinks_it_is: {
      label: 'ask what year he thinks it is',
      desc: 'Plainly. Make him date himself.',
      when: (p) => p.turn >= 1,
      respond(p) {
        return {
          lines: [
            'I say: what year do you think it is.',
            'He answers without thinking. He gives a year in the seventeenth century. Specifically. He gives the month as well.',
            'A beat. He says, more slowly: ~~no. That is. I beg your pardon. Let me consult.~~ He does not consult.',
            'He says, after a pause: ~~it is the year of the Lord. Let us not concern ourselves with the number.~~',
          ],
          scales: { doubt: +5 },
          composure: -1,
          composureCost: 'He named a month from a century I have not lived in.',
          flags: { caught_year: true },
        };
      },
    },

    ask_his_given_name: {
      label: 'ask his given name',
      desc: 'Not his title. His name.',
      when: (p) => p.turn >= 1,
      respond(p) {
        return {
          lines: [
            'I say: what is your given name.',
            'He inclines the beak. He says: ~~it has been many years. I am called Medicus. I have not had a given name for some time.~~',
            'He does not try to remember it.',
          ],
          scales: { doubt: +3, cure: -1 },
          composure: -1,
          composureCost: 'He has not had a given name for some time.',
        };
      },
    },

    describe_your_actual_wound: {
      label: 'describe your actual wound',
      desc: 'What you were admitted for. Plainly.',
      when: (p) => p.turn >= 1,
      respond(p, player) {
        const w = player.wound;
        let lines;
        if (w === 'amnesia') lines = [
          'I say: I was admitted because I cannot remember my address. That is what is wrong with me. It is not the pestilence.',
          'He says: ~~ah. The pestilence settles in the memory first, miser. The buboes follow.~~',
          'He says it the way a teacher corrects a child who has the wrong answer.',
        ];
        else if (w === 'insomnia') lines = [
          'I say: I cannot sleep. That is what was on my admission. It is not the pestilence.',
          'He says: ~~the wakefulness is the pestilence speaking, miser. It does not let the body close its eyes lest it be discovered.~~',
        ];
        else if (w === 'split_personality') lines = [
          'I say: I left another version of myself at home. That is what is on my file. Not the pestilence.',
          'He says: ~~ah. The doubling. The pestilence has its preferred shapes. The doubling is one. The cure is the same.~~',
        ];
        else lines = [
          'I say: I have a different complaint. Not the pestilence.',
          'He says: ~~there is no complaint, miser, that is not the pestilence in disguise.~~',
        ];
        return {
          lines,
          scales: { doubt: +3, cure: +1 },
          composure: -1,
          composureCost: 'He had an answer for it. He has an answer for everything.',
        };
      },
    },

    cover_your_face: {
      label: 'cover your face',
      desc: 'Deny him the breath. The pestilence travels through breath.',
      when: (p) => p.scales.proximity <= 12,
      respond(p) {
        const reps = streakCount(p, 'cover_your_face');
        if (reps >= 1) {
          return {
            lines: [
              'I keep the sheet up. I press it against my nose. I breathe through the linen.',
              'He has stopped his recitation. He says: ~~you have done this before, miser. Were you a physician?~~',
            ],
            scales: { proximity: +3, cure: -3 },
            composure: -1,
            composureCost: 'He asked if I had been a physician.',
          };
        }
        return {
          lines: [
            'I draw the sheet up across my nose and mouth.',
            'He stops. He looks at me. He says: !!Ah. You know the bridge of it.!! He steps back a half pace.',
            'He says, conversationally: ~~few of the unschooled know the bridge of breath, miser.~~',
          ],
          scales: { proximity: +3, cure: -2 },
          composure: -1,
          composureCost: 'I admitted I know how it travels.',
        };
      },
    },

    demand_open_window: {
      label: 'demand he open the window',
      desc: 'The pestilence stagnates in closed air.',
      when: (p) => p.turn >= 1,
      respond(p) {
        if (p.scales.doubt >= 6) {
          return {
            lines: [
              'I say: the window. Open it.',
              'He pauses. He says, after a beat: ~~that is correct, miser. The air must move.~~',
              'He crosses to the window. He unfastens it. The night air comes in. The camphor smell thins.',
              'He turns back to me. He looks at me differently. ~~You know more than your file says.~~',
            ],
            scales: { doubt: +3, cure: -3, proximity: +2 },
            flags: { window_open: true },
          };
        }
        return {
          lines: [
            'I say: the window. Open it. The room has gone close.',
            'He does not move. He says: ~~the pestilence is in the air outside as well, miser. The window remains closed.~~',
          ],
          scales: { doubt: +1, cure: +1 },
          composure: -1,
          composureCost: 'He refused without consulting the case.',
        };
      },
    },

    demand_he_remove_the_beak: {
      label: 'demand he remove the beak',
      desc: 'Take it off. Let me see your face.',
      when: (p) => p.scales.doubt >= 4,
      respond(p) {
        return {
          lines: [
            'I say: take the beak off. I would like to see your face.',
            'He goes very still. He says: ~~the beak is part of the order, miser. The order has not authorized its removal.~~',
            'A long pause. He says: ~~there is nothing under it that would help you.~~',
          ],
          scales: { doubt: +4, cure: -1 },
          composure: -2,
          composureCost: 'Nothing under the beak that would help me.',
        };
      },
    },

    ask_about_the_others_he_cured: {
      label: 'ask about the others he cured',
      desc: 'Their condition afterward.',
      when: (p) => p.turn >= 2,
      respond(p) {
        return {
          lines: [
            'I say: the others you have attended. Where are they.',
            'He bows. He says: ~~at rest, miser. The cure is brief. The rest is permanent.~~',
            'He says it the way someone announces good news. He does not see what is wrong with the sentence.',
          ],
          scales: { doubt: +5, cure: -1 },
          composure: -2,
          composureCost: 'He did not see what was wrong with the sentence.',
        };
      },
    },

    quote_him_back: {
      label: 'quote the rite back to him',
      desc: 'In Latin. The exact phrase he misspoke.',
      when: (p) => p.scales.doubt >= 6,
      respond(p) {
        return {
          lines: [
            'I quote the line. I correct the verb tense. I correct the case ending.',
            'He goes very still. The beak does not move. He says: ~~you are not a physician. You are not from the Board.~~ It is not a question.',
            'He closes the case. Slowly. He does not look at the case as he closes it.',
          ],
          scales: { doubt: +6, cure: -4, proximity: +1 },
          flags: { quoted_him: true },
        };
      },
    },

    name_the_register: {
      label: 'name the date he was struck',
      desc: 'From the medical register. Out loud.',
      when: (p) => p.scales.doubt >= 8,
      respond(p) {
        return {
          lines: [
            'I say a date. I do not know how I know it. It is the date his license was struck.',
            'The gloves stop moving. He says, after some seconds: ~~that is correct.~~',
            'He sets the beak on the writing chair. He sets the lance back into the case. He folds his hands.',
          ],
          scales: { doubt: +7, cure: -6, proximity: +2 },
          composure: -2,
          composureCost: 'I named a date that was not in my file.',
          flags: { register_named: true },
        };
      },
    },

    knock_the_case: {
      label: 'knock the case off the table',
      desc: 'Physical. Direct.',
      when: (p) => p.scales.proximity >= 6,
      respond(p) {
        if (p.scales.doubt >= 4) {
          return {
            lines: [
              'I swing my arm across the table. The case clatters onto the floor.',
              'Brass implements scatter. One of them — the lance — rolls under the bed. He does not bend for them.',
              'He looks at the case on the floor. He says, quietly: ~~that was unnecessary, miser.~~ He has not stepped forward.',
            ],
            scales: { cure: -7, doubt: +4, proximity: +2 },
            composure: -2,
            composureCost: 'I am out of the bed. He is not stopping me.',
            shake: true,
            flags: { case_knocked: true },
          };
        }
        return {
          lines: [
            'I swing my arm. The case rocks. He steadies it with one gloved hand. He has not even looked.',
            'He says: !!Miser. Please.!! The rite continues around me.',
          ],
          scales: { cure: +3, proximity: -1 },
          composure: -2,
          composureCost: 'He steadied the case without looking at me.',
        };
      },
    },

    spit_in_the_camphor: {
      label: 'spit into the camphor dish',
      desc: 'Defile the ritual.',
      when: (p) => p.scales.proximity >= 8,
      respond(p) {
        return {
          lines: [
            'I sit up. I lean across. I spit into the camphor dish on the writing table.',
            'He pauses. He looks at the dish. He says: ~~that was not necessary either, miser.~~',
            'But the smell of camphor has dropped by a degree. The room is more like a room.',
          ],
          scales: { cure: -3, doubt: +2 },
          composure: -2,
          composureCost: 'I spat at his rite. He was patient about it.',
          flags: { camphor_defiled: true },
        };
      },
    },

    show_admission_card: {
      label: 'show him your admission card',
      desc: 'You are a Subject. Not a carrier.',
      when: (p) => p.turn >= 1,
      respond(p) {
        return {
          lines: [
            'I take the card from my coat. I hold it up so the beak can read it.',
            'He looks at the card. He says: ~~the number is yours. But you have been listed as a carrier on the day log.~~',
            '~~He wrote the day log.~~ He has access to the day log.',
          ],
          scales: { doubt: +2, cure: +1 },
          composure: -1,
          composureCost: 'He has access to the day log.',
        };
      },
    },

    step_off_the_bed: {
      label: 'step off the bed',
      desc: 'Stand. Take a step. He cannot operate on you upright.',
      when: (p) => !p.flags.gowned && p.scales.proximity >= 6,
      respond(p) {
        if (p.scales.proximity <= 8) {
          return {
            lines: [
              'I sit up. I swing my legs off the bed. He puts a gloved hand on my shoulder.',
              'He says, gently: ~~miser. Please. The cure requires that you be supine.~~',
              'He does not press down. He waits.',
            ],
            scales: { cure: +2 },
            composure: -2,
            composureCost: 'His glove was on my shoulder.',
          };
        }
        return {
          lines: [
            'I get off the bed. The floor is cold under my feet.',
            'He bows. He says: ~~miser. I will resume when you have returned to the bed.~~',
            'He returns to the case. He turns his back.',
          ],
          scales: { cure: -3, proximity: +2 },
          flags: { stood_up: true },
        };
      },
    },

    submit: {
      label: 'submit to the cure',
      desc: 'Lay back. Bare the wrist.',
      when: (p) => p.scales.proximity <= 6,
      respond(p) {
        return {
          lines: [
            'I lay back. I draw my sleeve up. The vein at the wrist is close to the skin.',
            'He bows. He says: !!Miser. You will not feel it long.!!',
            'He takes the lance from the case. He lays it across the wrist. He recites the final verse.',
          ],
          scales: { cure: +6, proximity: -3 },
          composure: -3,
          composureCost: 'I have bared the wrist.',
          flags: { submitted: true },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Let him continue.',
    when: () => true,
  },

  interjections: [
    {
      id: 'salve_miser',
      once: true,
      when: (p) => p.turn >= 1,
      prose: [
        'He has finished the first invocation. He turns toward the bed.',
        'He says: ~~salve, miser. The pestilence is in the second intercostal. I shall begin there. The lesser instruments first, then the lance. You will be at peace before the third bell.~~',
      ],
      responses: [
        {
          label: 'no',
          desc: 'Plain.',
          lines: [
            'I say: no.',
            'He bows. He says: ~~as you wish, miser. The pestilence does not negotiate. We shall continue.~~',
          ],
          scales: { cure: +2, doubt: +1 },
        },
        {
          label: 'show me where',
          desc: 'Make him put a finger on it.',
          lines: [
            'I say: show me where.',
            'He points, through the glove, at a place on my chest. The place is empty. There is no swelling, no heat, no tenderness.',
            'He says: ~~it is beneath. It does not show. It does not need to show.~~',
          ],
          scales: { doubt: +4, cure: -1 },
        },
        {
          label: 'how did you find it',
          desc: 'Make him explain.',
          lines: [
            'I say: how did you find it.',
            'He pauses. He says: !!The smell.!! He inclines the beak.',
            '~~He cannot smell through the beak. The beak is full of dried herbs.~~',
          ],
          scales: { doubt: +5, cure: -2 },
          flags: { caught_smell: true },
        },
        {
          label: 'I will need a second opinion',
          desc: 'Procedural delay.',
          lines: [
            'I say: I would like a second physician to look. Before the cure.',
            'He inclines the beak. He says: ~~there is no second physician on this ward tonight, miser. The Board has not seen fit to send one.~~',
            'He says it the way a man says a thing that has worked out for him.',
          ],
          scales: { doubt: +2 },
          composure: -1,
          composureCost: 'No second physician on the ward tonight.',
        },
      ],
    },
    {
      id: 'the_lance',
      once: true,
      when: (p) => p.scales.cure >= 12,
      prose: [
        'He has the lance out. It is brass. It is longer than a lance has any reason to be. The handle is wrapped in linen that has been changed many times.',
        'He says: ~~the cure is brief. Three drops. Less than a moment of attention.~~',
      ],
      responses: [
        {
          label: 'put it down',
          desc: 'Quietly.',
          lines: [
            'I say: put it down.',
            'He looks at the lance. He sets it on the cloth. He does not pick it back up.',
            'A long beat. He picks up the brass tube instead. He continues.',
          ],
          scales: { cure: -4, doubt: +2 },
        },
        {
          label: 'three drops of what',
          desc: 'Make him say it.',
          lines: [
            'I say: three drops of what.',
            'He says, gently: ~~of you, miser. The pestilence is in the humour. The cure releases it.~~',
          ],
          scales: { cure: +3, doubt: +3 },
          composure: -1,
          composureCost: 'He said it out loud.',
        },
        {
          label: 'where does it go after',
          desc: 'Where do the drops go.',
          lines: [
            'I say: the three drops. Where do they go.',
            'He produces a small glass vial from the case. It is half full. The fluid inside does not catch the light.',
            'He says: ~~they go into here, miser. With the others. The Board collects them.~~',
          ],
          scales: { doubt: +5 },
          composure: -3,
          composureCost: 'The vial was half full.',
          flags: { saw_vial: true },
        },
        {
          label: 'I am ready',
          desc: 'Yield.',
          lines: [
            'I say: I am ready.',
            'He bows. He approaches. He has the lance. He has the cloth. He has the vial.',
          ],
          scales: { cure: +6, proximity: -3 },
          composure: -3,
          composureCost: 'I said the word he needed.',
          flags: { said_ready: true },
        },
      ],
    },
    {
      id: 'orderly_at_door',
      once: true,
      when: (p) => p.turn >= 3 && p.scales.cure <= 14,
      prose: [
        'There is a knock at the door. The orderly. He says, through the door: ~~Subject. Vitals check.~~',
        'The plague doctor turns his head a degree toward the door. He says, in Latin, evenly: ~~Adlecit hic. Mors moratur.~~',
        'The orderly\'s footsteps recede. He has not opened the door.',
      ],
      responses: [
        {
          label: 'call out to him',
          desc: 'In English. Loudly.',
          lines: [
            'I shout: I do not consent. There is a man here who is not a physician.',
            'The footsteps stop. A pause. They resume. They do not come back.',
            'The plague doctor inclines the beak. He says: ~~the orderly does not have Latin, miser. But he has been told who to listen to.~~',
          ],
          scales: { doubt: +3, cure: +1 },
          composure: -3,
          composureCost: '!!The orderly was told who to listen to.!!',
        },
        {
          label: 'ask him what he said',
          desc: 'In Latin. To his face.',
          lines: [
            'I say: what did you tell him.',
            'He says: ~~that you are with me. That the cure is in progress. That mortality is delayed.~~',
            'He says delayed with a small smile, audible through the beak.',
          ],
          scales: { doubt: +3, cure: +1 },
          composure: -2,
          composureCost: 'He smiled when he said delayed.',
        },
        {
          label: 'pound on the wall',
          desc: 'Signal the next room.',
          lines: [
            'I throw my hand against the wall. Twice.',
            'There is no answer through the wall. The doctor continues his recitation.',
            'He says, conversationally: ~~the next room was attended last night, miser.~~',
          ],
          scales: { doubt: +2 },
          composure: -3,
          composureCost: 'The next room was attended last night.',
        },
      ],
    },
    {
      id: 'final_confession',
      once: true,
      when: (p) => p.scales.cure >= 8,
      prose: [
        'He sets the lance back in the case. He brings a small folded paper from the inside of his robe. He unfolds it.',
        'He says: ~~it is customary, miser, that the patient writes a final letter. You may dictate. I shall write it for you.~~',
        'He has a pencil in his other glove. The pencil has been recently sharpened.',
      ],
      responses: [
        {
          label: 'I will not dictate',
          desc: 'Refuse.',
          lines: [
            'I say: I will not dictate.',
            'He folds the paper. He puts it back inside the robe. He says: ~~that is your right, miser. The cure proceeds without the letter.~~',
          ],
          scales: { cure: +2, doubt: +1 },
        },
        {
          label: 'I am not going to die',
          desc: 'Refuse the premise.',
          lines: [
            'I say: I am not going to die. There is no letter to write.',
            'He inclines the beak. He says: ~~the cure ends the carriage, miser. The carriage is what would die. The patient does not.~~',
            'He pauses. He says: ~~the patient is at rest. There is a difference.~~',
          ],
          scales: { doubt: +4, cure: -1 },
          composure: -2,
          composureCost: 'There is a difference between rest and death.',
        },
        {
          label: 'who has been getting these letters',
          desc: 'Make him say.',
          lines: [
            'I say: the four others. Their letters. Where did they go.',
            'He says: ~~into the case, miser. With the vials. The Board collects them.~~',
            'The letters have never left the case.',
          ],
          scales: { doubt: +5 },
          composure: -2,
          composureCost: 'Into the case with the vials.',
        },
        {
          label: 'I will dictate',
          desc: 'Stall by talking.',
          lines: [
            'I begin to dictate. Slowly. To my mother, who is no longer living. The doctor writes. The pencil scratches.',
            'I dictate for some minutes. He waits patiently for each word. He does not hurry me.',
            'When I stop, he folds the paper. He puts it inside the robe. He says: ~~thank you, miser. We may continue.~~',
          ],
          scales: { cure: +3 },
          composure: -1,
          composureCost: 'I dictated a letter he was patient with.',
        },
      ],
    },
    {
      id: 'beak_on_forehead',
      once: true,
      when: (p) => p.scales.proximity <= 4,
      prose: [
        'He bends over me. He brings the tip of the beak down. He sets it against my forehead.',
        'He says: ~~it is the laying-on of the beak, miser. It is the herbs that do the curing.~~',
        'The beak is heavier than it looks. It smells of camphor and something underneath.',
      ],
      responses: [
        {
          label: 'do not move',
          desc: 'Endure.',
          lines: [
            'I do not move. The beak stays on my forehead. He says nothing.',
            'After a long minute he straightens. He says: ~~good. The herbs are taking.~~',
          ],
          scales: { cure: +4 },
          composure: -3,
          composureCost: 'The beak stayed there for a long minute.',
        },
        {
          label: 'turn your head',
          desc: 'Slide out from under it.',
          lines: [
            'I turn my head. The beak slides across my forehead. He lets it.',
            'He says: ~~the herbs are imprecise, miser. They will still take.~~',
          ],
          scales: { cure: +2, proximity: +1 },
          composure: -1,
          composureCost: 'He let me slide. He had a plan for it.',
        },
        {
          label: 'push it off',
          desc: 'With your hand.',
          lines: [
            'I bring my hand up. I push the beak away from my forehead.',
            'He straightens. He says, with surprise: ~~miser. That is the first time someone has put hands on the beak.~~',
            'He sets the beak back at his belt. He returns to the case.',
          ],
          scales: { cure: -3, doubt: +3, proximity: +2 },
          flags: { pushed_beak: true },
        },
      ],
    },
    {
      id: 'mirror_glimpse',
      once: true,
      when: (p) => p.turn >= 4 && p.scales.doubt >= 4,
      prose: [
        'There is a small mirror on the writing table, behind the case. The angle is wrong for me to see most of the room.',
        'I can see the plague doctor in it. There is a second figure standing beside him. Hooded. Smaller.',
        'When I look up directly, there is no second figure.',
      ],
      responses: [
        {
          label: 'look at the mirror again',
          desc: 'Test it.',
          lines: [
            'I look at the mirror. The second figure is there. It is standing beside him, holding something on a tray.',
            'I look up. There is nothing.',
            'I look at the mirror again. The figure is gone.',
          ],
          scales: { doubt: +3 },
          composure: -3,
          composureCost: 'The figure was holding something on a tray.',
        },
        {
          label: 'ask who the assistant is',
          desc: 'Out loud.',
          lines: [
            'I say: the assistant. The one in the mirror.',
            'He does not look at the mirror. He says: ~~there is no assistant on this ward, miser. The Board has not authorized one.~~',
            'He says it the way someone answers a question they have been waiting to be asked.',
          ],
          scales: { doubt: +4, cure: -1 },
        },
        {
          label: 'take the mirror off the table',
          desc: 'Move it. Break the angle.',
          lines: [
            'I sit up. I take the mirror off the table. I lay it face-down on the bed beside me.',
            'He does not stop me. He says: ~~the mirror is not part of the case, miser. You may keep it.~~',
            'I have a mirror on the bed. It is face-down. ~~I will not turn it back over.~~',
          ],
          scales: { doubt: +2, cure: -1 },
          flags: { mirror_down: true },
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.cure >= 12) {
      return {
        lines: [
          'I do nothing. He turns to the case. He selects another implement. He recites another verse. The Latin is sharper than it was.',
          'The room is heavier with camphor than it was. The radiator has gone louder.',
        ],
        scales: { cure: +3, proximity: -1 },
        composure: -3,
        composureCost: 'I let him do another verse of the rite.',
      };
    }
    if (p.scales.cure >= 6) {
      return {
        lines: [
          'I do nothing. He recites a verse in Latin. He selects an implement. He returns the implement.',
          'He hums beneath the beak. The hum is a funeral piece. I do not have Latin but I have the melody.',
        ],
        scales: { cure: +2 },
        composure: -2,
        composureCost: 'I knew the melody.',
      };
    }
    return {
      lines: [
        'I do nothing. He continues his preparations. He does not need me to participate.',
        'He hums beneath the beak. A funeral piece. Short. He has hummed it before.',
      ],
      scales: { cure: +2 },
      composure: -1,
      composureCost: 'He has finished another verse.',
    };
  },

  endings: [
    {
      id: 'quoted',
      when: (p) => p.flags.quoted_him && p.scales.doubt >= 12,
      title: 'You quote the rite',
      lines: [
        'He closes the case. He buckles the first strap. He buckles the second.',
        'He bows. He says: !!Miser. I have erred. The Board will be informed.!! He does not look up from the case as he speaks.',
        'He leaves through the door I came in through. The orderly does not stop him in the corridor.',
        'The leather case stays on the writing table.',
      ],
      item: 'pocket_watch',
    },
    {
      id: 'register_named',
      when: (p) => p.flags.register_named && p.scales.doubt >= 16,
      title: 'You name the date',
      lines: [
        'He sets the beak on the writing chair. He kneels beside the bed.',
        'He says: ~~I have erred for some hundred years, miser. I beg your pardon.~~',
        'He says it the way one prays. He does not look up.',
        'I leave the room. The beak is on the chair. The case is open on the table. The lance is in his hand and he has not moved.',
      ],
      item: 'small_bell',
    },
    {
      id: 'misdiagnosed',
      when: (p) => p.flags.three_symptoms && p.scales.doubt >= 10 && p.scales.cure <= 8,
      title: 'You break the diagnosis',
      lines: [
        'He has paused. He has been reading the case. He has closed it.',
        'He bows. He says: !!Miser. I have come to the wrong room. I shall make my apologies to the Board.!!',
        'He leaves the implements. He takes only the beak and the case.',
        'The brass tube is still on the cloth on the writing table. I keep it.',
      ],
      item: 'sliver_of_glass',
    },
    {
      id: 'case_knocked',
      when: (p) => p.flags.case_knocked && p.scales.doubt >= 8 && p.scales.cure <= 10,
      title: 'You knock the case',
      lines: [
        'The implements are on the floor. He does not bend for them. He stands at the foot of the bed for a long time.',
        'He says, finally: ~~that was unnecessary, miser. The Board will be informed.~~',
        'He leaves. He does not take the case. The implements stay on the floor.',
        'In the morning the implements are gone. The robe is still folded on the writing chair.',
      ],
      item: 'handkerchief',
    },
    {
      id: 'pushed_beak',
      when: (p) => p.flags.pushed_beak && p.scales.doubt >= 8,
      title: 'You pushed the beak',
      lines: [
        'He has been writing in the case for some time. He has not spoken.',
        'He stands. He bows. He says: !!Miser. The cure cannot be administered to one who lays hands on the beak. It is an old rule.!!',
        'He leaves. He takes the case. He does not take the beak. The beak is on the writing chair.',
        'I put the beak in my coat pocket. I do not look inside it.',
      ],
      item: 'ink_bottle',
    },
    {
      id: 'cured',
      when: (p) => p.scales.cure >= 20,
      title: 'He administers the cure',
      lines: [
        'He has the lance. He bows. He says: ~~vade in pace, miser. The Pestilence is leaving you. The Pestilence is left.~~',
        'The lance is colder than the room. Then it is warmer than the room.',
        'I do not feel the second drop.',
      ],
      item: null,
      scars: ['collapsed'],
    },
    {
      id: 'submitted',
      when: (p) => p.flags.submitted && p.scales.cure >= 10,
      title: 'You bared the wrist',
      lines: [
        'I held the wrist out. He worked quickly. He hummed under the beak.',
        'When he had what he needed, he bowed. He sealed the vial. He set it in the case beside the others.',
        'He says: !!The pestilence has left you, miser.!! ~~So has most of the rest.~~',
      ],
      item: null,
      scars: ['collapsed', 'named'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: [
        'I leave through the door. He bows as I go. He says: !!Miser. I shall wait. The pestilence is patient. So am I.!!',
        '~~He is at the next room when I come back.~~ He is at the next room.',
      ],
      item: null,
      scars: ['abandoned', 'failed'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════
// THE WEIGHT — Patient 0413 (sleep paralysis)
// ════════════════════════════════════════════════════════════════════════
//
// The Old Hag. Sleep paralysis. Mara. Night-mare. You are in your
// assigned ward bed. You are awake. You cannot move. She is on your
// chest. Her hands are at your collarbones. She is heavier each turn.
// The verbs are small physical efforts: a finger, a breath, an ankle,
// an eyelid. The interior voice is the only motion left.
//
// Paths:
//   - Move enough that the orderly hears: scream, kick the bedframe, get
//     a hand off the bed, knock the headboard, pull the call cord.
//   - Outlast her: do not look at her, breathe shallow, accept that
//     this is a long night and the night ends.
//   - Let her have it.

const weight = {
  id: 'weight',
  name: '[The Weight]',
  glyph: 'Wraithfin',
  subtitle: 'You are awake. You cannot move. She is on your chest.',
  role: 'wing', tier: 2,
  file: [
    'Subject is in bed. Time [[5]]. Subject is asleep. ~~Subject is unable to indicate distress.~~ Subject is awake.',
    'Night nurse has passed the door twice. !!The door has not been opened.!!',
    'The mattress is wet under Subject. The mattress was dry at admission.',
    'Subject\'s eyes are open. Subject\'s pupils are responsive. Subject is not responding to verbal address.',
    'Pulse rate 142 and rising. Logged as ~~normal sleep.~~ Normal sleep.',
    'The bedside lamp is off. The call cord above the bed has been pulled. ~~The bell at the nurse\'s station did not ring.~~',
  ],
  intro: [
    'I am in my bed. The ceiling is wrong above me. The corridor light is a thin line under the door.',
    'There is something on my chest. Small. The size of a child but heavier than a child. Heavier than the bed should let her be.',
    'Her hands are at my collarbones. Her hair is on the pillow on either side of my face.',
    'I am awake. My eyes are open. The room is the room I was admitted to.',
    '!!I cannot move.!!',
  ],

  scales: {
    air: {
      initial: 14, min: 0, max: 20, label: 'air', kind: 'positive',
      bands: [
        { at: 0, word: 'none' },
        { at: 4, word: 'thin' },
        { at: 8, word: 'shallow' },
        { at: 12, word: 'a breath' },
        { at: 16, word: 'a lungful' },
        { at: 19, word: 'open' },
      ],
      crossDown: {
        4: 'My breath has gone shallow. I am breathing across the top of my lungs.',
        3: 'My breath has narrowed to a thread.',
        2: '!!I cannot get a full breath. The air comes in halfway and stops.!!',
        1: '!!The next inhale does not finish.!!',
        0: '!!There is no more air in me to draw on.!!',
      },
      crossUp: {
        3: 'A half-breath has reached me. I am still here.',
        4: 'My lungs have filled again.',
      },
    },
    pressure: {
      initial: 10, min: 0, max: 20, label: 'her weight', kind: 'negative',
      bands: [
        { at: 0, word: 'gone' },
        { at: 4, word: 'present' },
        { at: 8, word: 'pressing' },
        { at: 12, word: 'crushing' },
        { at: 16, word: 'unbearable' },
        { at: 19, word: 'more than the bed' },
      ],
      crossUp: {
        3: 'Her weight has settled further. The mattress has bowed.',
        4: '!!The mattress is on the floor under me. She is heavier than the bed.!!',
        5: '!!My ribs are giving in increments. The bed is gone under us.!!',
      },
      crossDown: {
        3: 'Her weight has eased. I can feel my ribs again.',
        2: 'Her weight is gone from me. ~~Only from me.~~',
        1: 'I can feel the mattress against my back. The mattress is mine again.',
      },
    },
    movement: {
      initial: 0, min: 0, max: 20, label: 'movement', kind: 'positive',
      bands: [
        { at: 0, word: 'stone' },
        { at: 4, word: 'a finger' },
        { at: 8, word: 'a hand' },
        { at: 12, word: 'a foot' },
        { at: 16, word: 'a side' },
        { at: 19, word: 'free' },
      ],
      crossUp: {
        2: 'My index finger has moved against the sheet.',
        3: 'My hand has come off the mattress.',
        4: '!!My ankle has cleared the bed. My heel has found the floor.!!',
        5: '!!My side has rolled. The weight has come off my chest.!!',
      },
    },
  },

  initialize(p, player) {
    p.scales.air = 14;
    p.scales.pressure = 10;
    p.scales.movement = 0;
    if (player.wound === 'insomnia') p.scales.air = 12;
    if (player.wound === 'split_personality') p.scales.pressure = 12;
    if (player.scars?.includes('collapsed')) p.scales.pressure = 12;
    if (player.scars?.includes('witnessed')) p.scales.air = 12;
  },

  fileReveals: [
    { at: 5,  announce: 'A line fills in. The night nurse passes this door at 02:14 and 02:46. She does not stop.' },
    { at: 10, announce: 'Another. The pulse trace at the station is flat. Subject\'s actual pulse is at one hundred forty-two.' },
    { at: 16, announce: 'Another. The call cord above the bed is wired through. ~~The bell does not ring at the station.~~' },
    { at: 24, announce: 'Another. The patient in the bed before me was admitted with insomnia. ~~The bed has held three.~~' },
    { at: 32, announce: 'Another. Subject\'s file notes a pattern of paralysis in this bed. ~~The pattern was not investigated.~~' },
    { at: 42, announce: '!!The last line. Her weight is logged on the bed. Not on Subject.!!' },
  ],

  presented(p) {
    const a = p.scales.air;
    const w = p.scales.pressure;
    const m = p.scales.movement;

    let breath;
    if (a <= 1)      breath = '!!My next breath does not start. My ribs are not moving. The pillow under my head is wet.!!';
    else if (a <= 4) breath = '!!The breath I have is the size of a coin. I am breathing across the top of my lungs. My fingers are cold.!!';
    else if (a <= 8) breath = 'My breath is shallow. The room has narrowed to it. I am counting it without meaning to.';
    else if (a <= 12)breath = 'My breath is small. Even. Careful. The intake is two seconds. The hold is one. The release is three.';
    else             breath = 'I am breathing. Carefully. The intake is a full breath. The release is longer than the intake.';

    let her;
    if (w >= 16)     her = '!!Her face is on top of my face. Her hair is in my mouth. Her weight is greater than the bed. The bed is on the floor.!!';
    else if (w >= 12)her = '!!Her face is close to mine. Her hair is on my cheek. Her hands are pressing down through my collarbones. Her weight is enormous.!!';
    else if (w >= 8) her = 'Her hands are at my collarbones. Her hair is on the pillow on either side of my face. Her face is above mine.';
    else if (w >= 4) her = 'She is on my chest. She is small. She is heavier than she should be. Her hands are flat on my collarbones.';
    else             her = '~~She is gone.~~ She has lifted off my chest. Mostly. Her hand is still on my left collarbone.';

    let me;
    if (m >= 16)     me = '!!My side has rolled. My foot has the floor. My hand has the rail of the bed.!!';
    else if (m >= 12)me = '!!My right ankle has cleared the bed. My heel is on the floor. My hand is at the edge of the mattress.!!';
    else if (m >= 8) me = 'My hand has come off the mattress. My fingers are open. My right ankle is at the edge of the bed.';
    else if (m >= 4) me = 'My index finger has moved. The sheet is loose under it. My middle finger has begun to follow.';
    else if (m >= 1) me = 'My index finger has twitched. The sheet has not moved with it. Yet.';
    else             me = 'I cannot move. My eyes are the only part of me that moves. They are tired.';

    return `${breath} ${her} ${me}`;
  },

  verbs: {

    move_a_finger: {
      label: 'move a finger',
      desc: 'The index. The smallest motion.',
      respond(p) {
        const reps = streakCount(p, 'move_a_finger');
        if (reps >= 3) {
          return {
            lines: [
              'My middle finger has come off the sheet. The ring finger is moving.',
              'My hand is half open. The weight on my chest has not noticed.',
              'I do not stop. I am being very small about it.',
            ],
            scales: { movement: +4, pressure: -1 },
          };
        }
        if (reps >= 2) {
          return {
            lines: [
              'My index is off the sheet. My middle finger is moving with it.',
              'The hand is half open.',
            ],
            scales: { movement: +3, pressure: -1 },
          };
        }
        if (reps >= 1) {
          return {
            lines: [
              'My index has moved. A quarter inch. The sheet is loose under it.',
              'I do not stop.',
            ],
            scales: { movement: +2 },
          };
        }
        return {
          lines: [
            'I try the index. Nothing for a long moment. Then a twitch.',
            'It costs everything I have. The pulse in my temple is louder than the room.',
          ],
          scales: { movement: +1 },
          composure: -1,
          composureCost: 'I have spent a great deal on a small thing.',
        };
      },
    },

    shift_a_breath: {
      label: 'shift a breath',
      desc: 'Get the lung past the weight.',
      respond(p) {
        const reps = streakCount(p, 'shift_a_breath');
        if (p.scales.pressure >= 14) {
          return {
            lines: [
              'I push the air up under her weight. I get a quarter of an inhale.',
              'The rest does not come. The intake catches at the top of my chest. I do not get the rest.',
            ],
            scales: { air: +1, pressure: +1 },
            composure: -1,
            composureCost: 'The air I got is small.',
          };
        }
        if (reps >= 1) {
          return {
            lines: [
              'I get another breath through. Larger than the last.',
              'My chest rises a centimeter under her. She does not seem to notice.',
            ],
            scales: { air: +3 },
          };
        }
        return {
          lines: [
            'I get a breath through. Most of it.',
            'My chest rises a centimeter under her. The mattress creaks under us.',
          ],
          scales: { air: +2 },
        };
      },
    },

    move_an_eyelid: {
      label: 'move an eyelid',
      desc: 'Close one. Just to count.',
      respond(p) {
        return {
          lines: [
            'I close one eye. Just the right. I count to ten under it.',
            'I open it. The room is the same. The weight is the same. The count reached ten.',
          ],
          composure: +1,
          scales: { movement: +1 },
        };
      },
    },

    look_at_her: {
      label: 'look at her',
      desc: 'See what is on you.',
      respond(p) {
        const reps = streakCount(p, 'look_at_her');
        if (reps >= 1) {
          return {
            lines: [
              'I look at her again. She is closer. Her face is the size of a small hand above my own.',
              'Her mouth is open. There is nothing inside her mouth.',
              'I should not have looked again.',
            ],
            scales: { pressure: +4, air: -1 },
            composure: -3,
            composureCost: 'There was nothing inside her mouth.',
          };
        }
        return {
          lines: [
            'I look down past my chin. She is small. Her hair is wet at the ends. Her hands are on my collarbones.',
            'She is looking at me. She has been the whole time.',
          ],
          scales: { pressure: +3, air: -1 },
          composure: -2,
          composureCost: 'Her eyes are open. They have been open the whole time.',
        };
      },
    },

    press_an_ankle_off_the_bed: {
      label: 'press an ankle off the bed',
      desc: 'Roll a heel. Find the floor.',
      when: (p) => p.scales.movement >= 6,
      respond(p) {
        if (p.scales.movement >= 12) {
          return {
            lines: [
              'My right ankle clears the bed. My heel finds the floor.',
              'Her weight slips. Her hands are still at my collarbones, but they are not the whole of her now.',
              'The bed is mostly mine again. My side has begun to roll.',
            ],
            scales: { movement: +4, pressure: -4, air: +2 },
            flags: { ankle_out: true },
          };
        }
        return {
          lines: [
            'I work the ankle. It moves an inch toward the side of the bed. Then another.',
            'She has not noticed. Her weight has not shifted.',
          ],
          scales: { movement: +3 },
          composure: -1,
          composureCost: 'The ankle is heavier than it should be.',
        };
      },
    },

    bite_the_tongue: {
      label: 'bite the inside of your cheek',
      desc: 'Hard. To wake.',
      respond(p) {
        const reps = streakCount(p, 'bite_the_tongue');
        if (reps >= 1) {
          return {
            lines: [
              'I bite again. Harder. The blood is warm in my mouth.',
              'The room is sharper for a moment. My fingers find their edges.',
            ],
            scales: { movement: +4, air: -1 },
            composure: -2,
            composureCost: 'Blood in my mouth. A real amount.',
          };
        }
        return {
          lines: [
            'I bite the inside of my cheek. The pain is sharp. A small amount of blood.',
            'For a beat the room is sharper too. My fingers are mine again.',
          ],
          scales: { movement: +3, air: -1 },
          composure: -1,
          composureCost: '~~Blood in my mouth.~~ A little blood.',
        };
      },
    },

    press_tongue_to_teeth: {
      label: 'press your tongue to your teeth',
      desc: 'Try to swallow.',
      respond(p) {
        return {
          lines: [
            'I press the tip of my tongue against the back of my front teeth. The swallow comes after a beat.',
            'The motion lifts something in my throat. The motion was real. The motion was mine.',
          ],
          scales: { movement: +2 },
        };
      },
    },

    try_a_syllable: {
      label: 'try a syllable',
      desc: 'Through the teeth. A word, half formed.',
      when: (p) => p.scales.movement >= 4,
      respond(p) {
        if (p.scales.movement >= 8) {
          return {
            lines: [
              'I get half a syllable past my teeth. Not a word. A vowel.',
              'Down the corridor, a chair scrapes. The night nurse has stood.',
            ],
            scales: { movement: +1 },
            flags: { nurse_stood: true },
          };
        }
        return {
          lines: [
            'I try the word. Nothing leaves my mouth. My jaw is the only part of me that moved.',
            'She has not noticed. The corridor has not noticed.',
          ],
          scales: { movement: +1, air: -1 },
          composure: -1,
          composureCost: 'I could not get the word out.',
        };
      },
    },

    push_thumb_against_her_hand: {
      label: 'push your thumb against her hand',
      desc: 'The hand on your right collarbone. The thumb against it.',
      when: (p) => p.scales.movement >= 4,
      respond(p) {
        return {
          lines: [
            'My right thumb finds the back of her hand. Her skin is cold. The cold is wrong for a body.',
            'I press up against her. She does not yield. But for the first time my hand is on her instead of her on me.',
          ],
          scales: { movement: +3, pressure: -2 },
          composure: -2,
          composureCost: 'Her skin was cold. The cold was wrong.',
          flags: { touched_her: true },
        };
      },
    },

    reach_for_the_call_cord: {
      label: 'reach for the call cord',
      desc: 'Above the bed. To the right of the headboard.',
      when: (p) => p.scales.movement >= 8,
      respond(p) {
        if (p.scales.movement >= 14) {
          return {
            lines: [
              'I get my hand above my head. My fingers find the cord. The cord is the wrong texture.',
              'I pull. The cord comes loose. The end of it is frayed. The bell at the station does not ring.',
              'I let the cord fall. I have her attention now. She is closer.',
            ],
            scales: { pressure: +3, movement: -1 },
            composure: -3,
            composureCost: 'The cord was cut. The bell did not ring.',
            flags: { cord_pulled: true },
          };
        }
        return {
          lines: [
            'I work my hand up the side of my head. My fingers find the rail above the pillow. They have not found the cord yet.',
            'I am closer to it than I was.',
          ],
          scales: { movement: +2 },
          composure: -1,
          composureCost: 'I have not found the cord yet.',
        };
      },
    },

    reach_for_the_lamp: {
      label: 'reach for the bedside lamp',
      desc: 'The pull chain. To the left of the bed.',
      when: (p) => p.scales.movement >= 6,
      respond(p) {
        if (p.scales.movement >= 14) {
          return {
            lines: [
              'My left hand finds the lamp. I get a finger around the chain. I pull.',
              'The bulb comes on. The light is yellow. The light is on her.',
              'She is small under it. She is not what I had thought.',
            ],
            scales: { pressure: -4, movement: +2, air: +2 },
            composure: -2,
            composureCost: 'She is not what I had thought.',
            flags: { lamp_on: true },
          };
        }
        return {
          lines: [
            'I work my left hand off the mattress. I get it to the edge of the bed. The lamp is closer than the cord.',
            'I have not got the chain yet.',
          ],
          scales: { movement: +2 },
        };
      },
    },

    knock_with_a_knuckle: {
      label: 'knock the headboard',
      desc: 'Side of the fist. The wall behind the bed.',
      when: (p) => p.scales.movement >= 8,
      respond(p) {
        const reps = streakCount(p, 'knock_with_a_knuckle');
        if (reps >= 2) {
          return {
            lines: [
              'I knock a third time. There is an answer through the wall. Three knocks.',
              'A door opens in the corridor. Footsteps. Slow but coming.',
            ],
            scales: { pressure: -2 },
            flags: { neighbor_knocked: true },
          };
        }
        if (reps >= 1) {
          return {
            lines: [
              'I knock again. Three. Three more. The pattern someone in distress would knock.',
              'A pause. A knock back. Three. Three. The next room is awake.',
            ],
            scales: { movement: +1 },
            flags: { neighbor_aware: true },
          };
        }
        return {
          lines: [
            'I bring the side of my fist against the headboard. Three knocks. As loud as my arm will go.',
            'I wait. There is no answer through the wall yet.',
          ],
          scales: { movement: +1 },
        };
      },
    },

    listen_for_the_corridor: {
      label: 'listen for the corridor',
      desc: 'The floor outside. The far door.',
      respond(p) {
        return {
          lines: [
            'I listen. The corridor is the corridor. The night nurse\'s chair creaks. The radiator in the hall ticks. A door, somewhere, two floors down.',
            'The sounds are still real. The corridor is still doing its work.',
          ],
          composure: +1,
        };
      },
    },

    count_her_exhales: {
      label: 'count her exhales',
      desc: 'Hers. Not yours.',
      respond(p) {
        const reps = streakCount(p, 'count_her_exhales');
        if (reps >= 1) {
          return {
            lines: [
              'I count again. Ten exhales. They are the same length. The same warmth.',
              'She is not breathing the way I am. She is breathing the way someone who has been doing this a long time breathes.',
            ],
            scales: { movement: +1 },
            composure: -1,
            composureCost: 'She has been doing this a long time.',
          };
        }
        return {
          lines: [
            'I count her exhales. Hers are slow. Slower than mine. Steady. Even.',
            'After ten of them my own breathing has steadied.',
          ],
          scales: { air: +1, movement: +1 },
          composure: +1,
        };
      },
    },

    say_your_own_name: {
      label: 'say your own name',
      desc: 'In your head. Slowly. To anchor.',
      respond(p) {
        return {
          lines: [
            'I say my name. Inside my head. The full version. The diminutive. My number.',
            'I am here. I am in this body. I am the one in the bed.',
          ],
          composure: +2,
          scales: { movement: +1 },
        };
      },
    },

    let_a_tear_fall: {
      label: 'let a tear fall',
      desc: 'Stop holding it back.',
      when: (p) => p.scales.movement >= 2,
      respond(p) {
        return {
          lines: [
            'I stop holding it back. A tear falls. Sideways. Into my hairline.',
            'She has lifted her face a degree. She is watching where the tear went.',
          ],
          scales: { movement: +1, pressure: +1 },
          composure: -1,
          composureCost: 'She watched where the tear went.',
        };
      },
    },

    scream: {
      label: 'scream',
      desc: 'All of it. Once.',
      when: (p) => p.scales.movement >= 10 || p.flags.nurse_stood,
      respond(p) {
        return {
          lines: [
            'I scream. The sound is small and shapeless and it leaves me.',
            'The weight on my chest jerks. The hair lifts from my face.',
            'A door opens in the corridor. Footsteps. Fast.',
          ],
          scales: { pressure: -8, air: +5, movement: +4 },
          composure: -3,
          composureCost: 'I gave everything to one note.',
          flags: { screamed: true },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Keep your eyes open. Let it pass.',
    when: () => true,
  },

  leave: {
    label: 'close your eyes',
    desc: 'Let the night carry you through.',
    respond(p) {
      return {
        lines: [
          'I let my eyes shut. The weight does not lift. She does not move.',
          'I am awake under it. ~~For a long time.~~',
        ],
        composure: -2,
        composureCost: 'I let her have the rest of the night.',
        scars: ['abandoned'],
        flags: { left: true },
      };
    },
  },

  interjections: [
    {
      id: 'she_speaks',
      once: true,
      when: (p) => p.scales.pressure >= 12,
      prose: [
        'Her mouth is against my ear. Her breath is colder than the room. Her hair is on my cheek.',
        'She says: ~~stop trying. It is easier if you stop trying. The morning is hours away. You will be tired.~~',
      ],
      responses: [
        {
          label: 'I am not stopping',
          desc: 'Through your teeth.',
          lines: [
            'I say it through my teeth. I am not stopping.',
            'She presses harder for a beat. Then less. ~~She heard me.~~',
            'She has not moved her mouth from my ear.',
          ],
          scales: { pressure: -2, movement: +3, air: -1 },
          composure: -1,
          composureCost: 'I spent a breath I needed to say it.',
        },
        {
          label: 'get off',
          desc: 'Two words.',
          lines: [
            'I say: get off.',
            'She does not. Her weight settles back. But she has heard.',
          ],
          scales: { pressure: +1, movement: +2 },
          composure: -1,
          composureCost: 'She was heavier for a beat.',
        },
        {
          label: 'who are you',
          desc: 'Ask.',
          lines: [
            'I get the question out, mostly.',
            'She says: ~~I have been on you a long time. You did not notice until tonight.~~',
            'She says it conversationally. As if she is making a small confession.',
          ],
          scales: { pressure: +2, air: -1 },
          composure: -2,
          composureCost: 'She has been on me for longer than tonight.',
        },
        {
          label: 'what would happen if I stopped',
          desc: 'Ask the bad question.',
          lines: [
            'I say: what would happen.',
            'She says: ~~you would sleep. I would still be here. Tomorrow you would be tired in a way you have been tired before.~~',
            'She says it as if she has said it many times.',
          ],
          scales: { pressure: +3 },
          composure: -2,
          composureCost: 'She has said it before.',
          flags: { offered_stop: true },
        },
      ],
    },
    {
      id: 'nurse_outside',
      once: true,
      when: (p) => p.flags.nurse_stood && !p.flags.screamed,
      prose: [
        'The night nurse is at the door. She has not opened it. She is listening.',
        'She is waiting for a sound. ~~Anything.~~ She has heard this kind of quiet before.',
      ],
      responses: [
        {
          label: 'kick the bedframe',
          desc: 'With the ankle that moves.',
          when: (p) => p.scales.movement >= 6,
          lines: [
            'I get the heel down. The bedframe rings against the wall.',
            'The door opens. The corridor light is on me.',
            'The nurse has the file in one hand. Her other hand is at her mouth.',
          ],
          scales: { pressure: -4, movement: +3 },
          flags: { framed_kicked: true },
        },
        {
          label: 'try a word',
          desc: 'Whatever you can.',
          lines: [
            'I get half a word past my teeth. A vowel. Loud as a vowel can be.',
            'The handle turns. The door eases open. The nurse is in the doorway.',
          ],
          scales: { movement: +3 },
          flags: { door_opened: true },
        },
        {
          label: 'do not call her',
          desc: 'Outwait alone.',
          lines: [
            'I do not make a sound. The nurse waits at the door for a long time. Then her footsteps go on down the corridor.',
            'She is gone. The next room\'s door does not open.',
          ],
          scales: { pressure: +3, air: -1 },
          composure: -2,
          composureCost: 'I let the nurse leave.',
        },
        {
          label: 'rap on the wall',
          desc: 'With your hand.',
          when: (p) => p.scales.movement >= 5,
          lines: [
            'I bring my hand against the wall behind the bed. Twice. Then twice more.',
            'The nurse is still at the door. The knocking has been heard. She knocks back. Once. ~~Hold on.~~',
            'The handle turns.',
          ],
          scales: { movement: +1 },
          flags: { door_opened: true },
        },
      ],
    },
    {
      id: 'her_hair_in_your_mouth',
      once: true,
      when: (p) => p.scales.pressure >= 14,
      prose: [
        'Her face has lowered. Her hair is in my mouth. It is wet. It is the wrong texture for hair.',
        'I cannot turn my head.',
      ],
      responses: [
        {
          label: 'bite down',
          desc: 'On the hair.',
          lines: [
            'I close my teeth on the hair. I get my mouth around it. I bite.',
            'She lifts a degree. Her hair pulls free. The taste in my mouth is salt and old water.',
          ],
          scales: { pressure: -3, movement: +3, air: +1 },
          composure: -2,
          composureCost: 'The taste was salt and old water.',
          flags: { bit_hair: true },
        },
        {
          label: 'spit it out',
          desc: 'Sideways.',
          lines: [
            'I press it out of my mouth with my tongue. It does not move easily. There is a lot of it.',
            'Some of it stays. I cannot get all of it.',
          ],
          scales: { air: -1, movement: +1 },
          composure: -2,
          composureCost: 'I could not get all of it.',
        },
        {
          label: 'do not move',
          desc: 'Wait it out.',
          lines: [
            'I do not move. I breathe through my nose. The hair is in my mouth for a long time.',
            'When she lifts again, my mouth is clear. The taste stays.',
          ],
          scales: { pressure: +1, air: -2 },
          composure: -2,
          composureCost: 'The taste stayed.',
        },
      ],
    },
    {
      id: 'second_figure',
      once: true,
      when: (p) => p.turn >= 5,
      prose: [
        'There is a figure at the foot of the bed. I cannot see it directly. I see it at the edge of my vision.',
        'It is taller than the woman on my chest. It is standing very still. It has been standing very still.',
      ],
      responses: [
        {
          label: 'look at it directly',
          desc: 'Eyes that way.',
          lines: [
            'I move my eyes to the foot of the bed. There is nothing there.',
            'I move my eyes back. The figure is back at the edge of my vision.',
          ],
          scales: { pressure: +2 },
          composure: -3,
          composureCost: 'It was at the edge of my vision again.',
        },
        {
          label: 'ignore it',
          desc: 'Eyes on the ceiling.',
          lines: [
            'I look at the ceiling. The figure remains where it is. I do not need to look at it.',
            'I can still feel it.',
          ],
          scales: { movement: +1 },
          composure: -1,
          composureCost: 'I could still feel it.',
        },
        {
          label: 'speak to it',
          desc: 'Aloud. Mostly.',
          lines: [
            'I get a sound out. Half a word. Addressed to the foot of the bed.',
            'The woman on my chest lifts. She turns her head toward the foot of the bed. She nods to it.',
            'The figure inclines its head back.',
          ],
          scales: { pressure: -2, movement: +2 },
          composure: -3,
          composureCost: 'They nodded to each other.',
          flags: { addressed_figure: true },
        },
      ],
    },
    {
      id: 'lamp_clicks',
      once: true,
      when: (p) => p.turn >= 4 && !p.flags.lamp_on,
      prose: [
        'The bedside lamp clicks. The chain has moved. The bulb does not come on.',
        'The chain swings for a beat. It stops at an angle.',
      ],
      responses: [
        {
          label: 'reach for it again',
          desc: 'The pull chain.',
          when: (p) => p.scales.movement >= 4,
          lines: [
            'I work my left hand toward it. The chain is closer than the call cord.',
            'I get a finger around the chain. I pull.',
            'The bulb does not come on. The chain has been disconnected from the lamp.',
          ],
          scales: { movement: +2 },
          composure: -2,
          composureCost: 'The chain was disconnected.',
        },
        {
          label: 'watch the chain',
          desc: 'See if it moves again.',
          lines: [
            'I watch the chain. It stays where it is. The bulb does not come on.',
            'After a long beat the chain moves a degree. Then it stops.',
          ],
          scales: { pressure: +1 },
          composure: -2,
          composureCost: 'The chain moved a degree on its own.',
        },
        {
          label: 'ignore the lamp',
          desc: 'Eyes elsewhere.',
          lines: [
            'I look at the door instead. The lamp is not going to help.',
          ],
          composure: +1,
        },
      ],
    },
    {
      id: 'she_says_your_name',
      once: true,
      when: (p) => p.scales.pressure >= 10 && p.turn >= 3,
      prose: [
        'She says my given name. The way one says it to a friend.',
        'Then she says my given name with the diminutive. The way only one person has.',
      ],
      responses: [
        {
          label: 'do not answer',
          desc: 'Stay quiet.',
          lines: [
            'I do not answer. She says it again. She is patient.',
            'My eyes are wet. The wet is going sideways.',
          ],
          scales: { pressure: +2 },
          composure: -2,
          composureCost: 'She is patient.',
        },
        {
          label: 'ask how she knows it',
          desc: 'Inside your head.',
          lines: [
            'I think the question at her. She answers as if she heard it.',
            'She says: ~~you have been calling yourself that in your sleep. For some weeks.~~',
            'I have not been calling myself that in my sleep.',
          ],
          scales: { pressure: +1 },
          composure: -3,
          composureCost: 'She heard the question I had not said.',
        },
        {
          label: 'refuse the name',
          desc: 'That is not who I am tonight.',
          lines: [
            'I get a word out. Not. Just not.',
            'She is quiet. After a beat she says: ~~alright. Then I will wait.~~',
          ],
          scales: { pressure: -1, movement: +2 },
        },
      ],
    },
    {
      id: 'corridor_dark',
      once: true,
      when: (p) => p.turn >= 6,
      prose: [
        'The line of corridor light under the door has gone out.',
        'A second later it has come back on. Dimmer. The corridor light has been switched.',
      ],
      responses: [
        {
          label: 'wait for it to come back fully',
          desc: 'Do not assume.',
          lines: [
            'I wait. The line of light comes back to full brightness after some seconds.',
            'I do not know why it dimmed.',
          ],
          composure: -1,
          composureCost: 'I do not know why the corridor dimmed.',
        },
        {
          label: 'look at her shadow',
          desc: 'Against the wall.',
          lines: [
            'I look past her. There is no shadow against the wall. There is only my own.',
            'The line of light steadies. I keep my eyes on the wall.',
          ],
          scales: { pressure: -2, movement: +2 },
          composure: -2,
          composureCost: 'There was no shadow but mine.',
          flags: { saw_no_shadow: true },
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.pressure >= 14) {
      return {
        lines: [
          'I do nothing. Her weight settles further. The mattress has bowed under us.',
          'My next breath is smaller than the last. I have to choose to take it.',
        ],
        scales: { pressure: +2, air: -2 },
        composure: -2,
        composureCost: 'I had to choose to take the breath.',
      };
    }
    if (p.scales.air <= 6) {
      return {
        lines: [
          'I do nothing. My breath is small. The room has narrowed. I cannot feel my fingers.',
          'I do not get the next inhale all the way in.',
        ],
        scales: { air: -2, pressure: +1 },
        composure: -2,
        composureCost: 'The inhale did not finish.',
      };
    }
    return {
      lines: [
        'I do nothing. Her weight settles a little further. The breath I had is smaller.',
        'The corridor light is the same. The room is the room. I am still in it.',
      ],
      scales: { pressure: +1, air: -1 },
      composure: -1,
      composureCost: 'A breath I needed has gone past.',
    };
  },

  endings: [
    {
      id: 'screamed',
      when: (p) => p.flags.screamed && p.scales.movement >= 8,
      title: 'You scream the night nurse in',
      lines: [
        'The door is open. The nurse is at the bed. She takes my hand and finds my wrist.',
        'The weight is gone. The mattress is wet. The room is bright.',
        'She does not ask what was on me. She is writing it down. She is writing very fast.',
        'When she leaves she leaves the corridor door propped open. The light from outside reaches all the way to my pillow.',
      ],
      item: 'small_bell',
    },
    {
      id: 'framed_kicked',
      when: (p) => p.flags.framed_kicked,
      title: 'You kick the frame',
      lines: [
        'The bedframe rings against the wall. The nurse comes in fast.',
        'She lifts the sheet. The weight is gone. My ankle is bruised where it caught the rail.',
        'She does not let go of my wrist. Her own pulse is not steady either.',
      ],
      item: 'sliver_of_glass',
    },
    {
      id: 'door_opened',
      when: (p) => p.flags.door_opened,
      title: 'The door eases open',
      lines: [
        'The nurse is in the doorway. The corridor light is across my pillow.',
        'She does not come in right away. She watches the room for a beat. Then she comes in.',
        'When she touches the sheet to lift it she is very gentle.',
      ],
      item: 'handkerchief',
    },
    {
      id: 'ankle_out',
      when: (p) => p.flags.ankle_out && p.scales.movement >= 14,
      title: 'You get the ankle down',
      lines: [
        'My heel is on the floor. My side rolls. Her weight slides off into the mattress.',
        'I am sitting up. The room is mine. The sheet is wet under where I was.',
        'I do not look at the bed. I cross to the door. The door opens.',
      ],
      item: 'handkerchief',
    },
    {
      id: 'cord_pulled',
      when: (p) => p.flags.cord_pulled && p.scales.movement >= 10,
      title: 'You pull the cord',
      lines: [
        'The cord is in my hand. The bell does not ring. The frayed end is in my palm.',
        'But the cord has come down from above the bed. The motion was loud against the headboard.',
        'A door opens in the next room. A patient there is at her door. She has heard. She calls the nurse.',
      ],
      item: 'small_bell',
    },
    {
      id: 'lamp_on',
      when: (p) => p.flags.lamp_on && p.scales.movement >= 8,
      title: 'You turn the lamp on',
      lines: [
        'The bulb comes on. The light is yellow. She is small under it.',
        'She is not the shape she was a moment ago. The lamp is too direct for her.',
        'She is gone before the bulb is warm. The mattress is wet where she was. The lamp is the only light.',
      ],
      item: 'small_bell',
    },
    {
      id: 'neighbor_knocked',
      when: (p) => p.flags.neighbor_knocked && p.scales.movement >= 10,
      title: 'The next room hears you',
      lines: [
        'There is a knocking through the wall. Then voices in the corridor. Then footsteps to my door.',
        'The next patient and the night nurse are in the doorway together.',
        'The weight is gone. The mattress is wet. The next patient does not ask. She has been on the wall side of this before.',
      ],
      item: 'sliver_of_glass',
    },
    {
      id: 'suffocated',
      when: (p) => p.scales.air <= 0,
      title: 'The breath does not finish',
      lines: [
        'The inhale starts. It does not finish.',
        'She is the last thing on my chest. The pillow under me is wet. My eyes are open.',
      ],
      item: null,
      scars: ['collapsed'],
    },
    {
      id: 'crushed',
      when: (p) => p.scales.pressure >= 20,
      title: 'She is heavier than the bed',
      lines: [
        'The mattress is touching the floor. She is above me. Her hair is in my mouth.',
        'I cannot make any of the parts of me move. The corridor light is gone under the door.',
      ],
      item: null,
      scars: ['collapsed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You let your eyes close',
      lines: [
        'I let them close. The weight is the same. The night is the same.',
        'In the morning the mattress is wet. I do not remember when she got off me.',
      ],
      item: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════
// registry
// ════════════════════════════════════════════════════════════════════════

export const PATIENTS = {
  polonius,
  pram, patriarch, soothlick, glimmer, frostfin, hollow, mire, composer,
  children, sculpture, plague, weight,
  choir,
};

export function getPatient(id) { return PATIENTS[id] || null; }
