// Items are one-use objects carried through a run. Each item lives in the
// player's pocket until it's used; using it consumes it. The action menu
// surfaces only items whose `when(patient, player)` predicate is true
// (verbs whose when is missing are always usable).
//
// Some items help. Some hurt. Some do both. The player picks one at
// admission and gains more from corridor events and resolutions.
//
// Item shape:
//   id, name, file (short prose), desc (mechanical), voice (line spoken at pickup)
//   when?(patient, player): bool
//   respond(patient, player): Response   — same shape as a verb response
//
// Items can read patient.def.scales to behave differently across patients.
// They can author composureCost on negative composure, just like verbs.

export const ITEMS = {

  photograph: {
    id: 'photograph',
    name: 'a photograph',
    file: 'Creased twice. Two figures. ~~The smaller one~~ has been folded out of frame.',
    desc: 'Show it. For patients who need to be seen by someone.',
    voice: 'A photograph. I do not remember keeping it.',
    when: (p) => p.def.scales?.recognition !== undefined,
    respond(p) {
      const shifts = { recognition: +3 };
      if (p.def.scales?.grief !== undefined) shifts.grief = +1;
      return {
        lines: [
          'I take it from my pocket. I hold it up to her.',
          'She lifts it carefully. She does not give it back.',
          '~~She knows the smaller one.~~ She names the smaller one.',
        ],
        scales: shifts,
      };
    },
  },

  sugar_cube: {
    id: 'sugar_cube',
    name: 'a sugar cube',
    file: 'Wax paper, slightly damp. The hand that gave it to me ~~was cold~~ did not warm it.',
    desc: 'Eat it. Restore composure.',
    voice: 'A sugar cube. I had it. I did not pack it.',
    respond() {
      return {
        lines: [
          'I unwrap it. I set it on my tongue.',
          'The room ~~stops humming~~ holds still for a moment.',
        ],
        composure: +2,
      };
    },
  },

  handkerchief: {
    id: 'handkerchief',
    name: 'a folded handkerchief',
    file: 'Pressed. An initial stitched in the corner — ~~not mine.~~ Bears the laundry stamp of Ward [[2]].',
    desc: 'Offer it. Calms a panicked patient. Costs a little.',
    voice: 'A handkerchief. ~~Clean.~~ Laundered.',
    when: (p) => {
      const s = p.def.scales || {};
      return s.panic !== undefined || s.agitation !== undefined
          || s.cold !== undefined || s.tension !== undefined;
    },
    respond(p) {
      const s = p.def.scales || {};
      const shifts = {};
      if (s.panic !== undefined)     shifts.panic = -3;
      if (s.agitation !== undefined) shifts.agitation = -3;
      if (s.cold !== undefined)      shifts.cold = -2;
      if (s.tension !== undefined)   shifts.tension = -2;
      return {
        lines: [
          'I unfold it. I offer it.',
          'She takes it. She folds it once more. She puts it in her own pocket.',
        ],
        scales: shifts,
        composure: -1,
        composureCost: 'I gave away the only soft thing I came in with.',
      };
    },
  },

  childs_drawing: {
    id: 'childs_drawing',
    name: "a child's drawing",
    file: 'Crayon. Folded twice. Two figures holding hands. ~~My signature~~ A name in my own hand at the bottom. A name I have not used.',
    desc: 'Show it. For patients holding tenderness or grief.',
    voice: 'A drawing. ~~A child gave it to me.~~ I have no child.',
    when: (p) => {
      const s = p.def.scales || {};
      return s.tenderness !== undefined || s.grief !== undefined || s.release !== undefined;
    },
    respond(p) {
      const s = p.def.scales || {};
      const shifts = {};
      if (s.tenderness !== undefined) shifts.tenderness = +3;
      if (s.grief !== undefined)      shifts.grief = +2;
      if (s.release !== undefined)    shifts.release = +2;
      return {
        lines: [
          'I unfold it. I hold it up.',
          'Her face changes. She does not reach for it.',
          '!!She has not let herself look at one in a long time.!!',
        ],
        scales: shifts,
        composure: -1,
        composureCost: '~~Someone gave me this.~~ I do not remember where I got it.',
      };
    },
  },

  pocket_watch: {
    id: 'pocket_watch',
    name: 'a pocket watch',
    file: 'Silver. Stopped at !!03:17.!! The minute hand resumes when held.',
    desc: "Wind it. Resets the patient's worst condition.",
    voice: 'A watch. ~~It has stopped.~~ It was stopped.',
    respond(p) {
      // find the scale that is most off in a bad direction. for negative
      // scales: highest value is worst. for positive: lowest is worst.
      let worstKey = null;
      let worstHowBad = -1;
      for (const [k, def] of Object.entries(p.def.scales || {})) {
        const v = p.scales[k] ?? 0;
        const max = def.max ?? 10;
        const howBad = def.kind === 'positive' ? (max - v) : v;
        if (howBad > worstHowBad) { worstHowBad = howBad; worstKey = k; }
      }
      const shifts = {};
      if (worstKey) {
        const def = p.def.scales[worstKey];
        const current = p.scales[worstKey];
        const target = def.kind === 'positive' ? Math.max(5, current + 4) : Math.min(3, current - 4);
        shifts[worstKey] = target - current;
      }
      return {
        lines: [
          'I take it from my pocket. I wind the stem.',
          'The hand begins to move. The room settles by a degree.',
          '~~Something has been put back.~~ Something has been put back. I do not know how long it holds.',
        ],
        scales: shifts,
      };
    },
  },

  the_card: {
    id: 'the_card',
    name: 'the admission card',
    file: 'Patient 0413. Creased. ~~The number has been written over another.~~ !!I have been holding it.!!',
    desc: 'Name yourself. Restore composure.',
    voice: 'The card. ~~I am~~ I have been 0413.',
    respond(p) {
      const shifts = {};
      if (p.def.scales?.self !== undefined)        shifts.self = +3;
      if (p.def.scales?.recognition !== undefined) shifts.recognition = +2;
      return {
        lines: [
          'I take it out. I read my number off it. !!Patient 0413.!!',
          'I am here. I am the one who came in.',
        ],
        composure: +2,
        scales: shifts,
      };
    },
  },

  worn_ribbon: {
    id: 'worn_ribbon',
    name: 'a worn ribbon',
    file: 'Red. Tied and untied many times. ~~Once~~ The shape of what it was tied around is still in it.',
    desc: 'Give it. Soft memory. For tender patients.',
    voice: 'A ribbon. ~~Someone~~ Someone wore it.',
    when: (p) => {
      const s = p.def.scales || {};
      return s.tenderness !== undefined || s.recognition !== undefined
          || s.warmth !== undefined || s.trust !== undefined;
    },
    respond(p) {
      const s = p.def.scales || {};
      const shifts = {};
      if (s.tenderness !== undefined)  shifts.tenderness = +2;
      if (s.recognition !== undefined) shifts.recognition = +2;
      if (s.warmth !== undefined)      shifts.warmth = +2;
      if (s.trust !== undefined)       shifts.trust = +2;
      return {
        lines: [
          'I take it out. She sees it before I have lifted it all the way.',
          'She lets me lay it in her hand. She does not speak.',
        ],
        scales: shifts,
      };
    },
  },

  scrap_of_paper: {
    id: 'scrap_of_paper',
    name: 'a scrap of paper',
    file: 'Torn from something larger. A name in handwriting. ~~Mine.~~ A name I have not used.',
    desc: 'Read what is on it. The outcome is uncertain.',
    voice: 'A scrap. With a name on it. ~~I did not write it.~~',
    respond(p) {
      // random behavior — sometimes a name lands, sometimes nothing
      const roll = Math.random();
      if (roll < 0.5 && p.def.scales?.recognition !== undefined) {
        return {
          lines: [
            'I read the name. It is one I had not been carrying on purpose.',
            'She looks up. She half-knows it.',
          ],
          scales: { recognition: +3 },
        };
      }
      if (roll < 0.8) {
        return {
          lines: [
            'I read the name. She does not answer to it.',
            'I put the scrap back. ~~It was not a name.~~ It may not have been a name.',
          ],
          composure: -1,
          composureCost: 'The name was for someone else. ~~Someone I.~~ I do not remember.',
        };
      }
      // rare — bad
      return {
        lines: [
          'I read the name. It is mine.',
          '!!I did not write it.!! Someone wrote it down for me. ~~Recently.~~',
        ],
        composure: -2,
        composureCost: '!!Someone has been writing my name in places I have not been.!!',
        scars: ['named'],
      };
    },
  },

  black_coin: {
    id: 'black_coin',
    name: 'a black coin',
    file: 'Thumbnail-sized. ~~Does not catch light.~~ Warm in pocket. Cold in palm.',
    desc: 'Pay it. Costs me. Shifts something stuck.',
    voice: 'A coin. ~~The weight is wrong.~~',
    respond(p) {
      // shifts every negative scale down by 2 (good), at a composure cost.
      const shifts = {};
      for (const [k, def] of Object.entries(p.def.scales || {})) {
        if (def.kind === 'negative') shifts[k] = -2;
      }
      return {
        lines: [
          'I take it out. I set it on the floor between us.',
          'The room settles. ~~Something has been paid for.~~ Something has been paid for.',
        ],
        scales: shifts,
        composure: -2,
        composureCost: '!!The coin was warm. It is not now.!!',
      };
    },
  },

  vial: {
    id: 'vial',
    name: 'a small vial',
    file: 'Glass. ~~Half empty.~~ Half full. No label. The fluid does not slosh.',
    desc: 'Drink it. Calms me. May also dull.',
    voice: 'A vial. ~~A nurse~~ Someone gave it to me. For the descent.',
    respond(p) {
      const shifts = {};
      if (p.def.scales?.tending !== undefined)   shifts.tending = +2;
      if (p.def.scales?.insistence !== undefined) shifts.insistence = +1;
      return {
        lines: [
          'I open it. I drink half.',
          'The room is suddenly very soft. ~~My edges are gone.~~ My edges are gone. !!I am still here.!!',
        ],
        composure: +2,
        scales: shifts,
        playerEffects: p.def.scales?.tending !== undefined ? { drowsing: +2 } : {},
      };
    },
  },

  sliver_of_glass: {
    id: 'sliver_of_glass',
    name: 'a sliver of glass',
    file: 'From a mirror in the east corridor. Sharp. ~~Clean.~~ Clean of fingerprints.',
    desc: 'Clutch it. Costs composure. Wards off the next blow.',
    voice: 'A sliver. ~~I will not need this.~~',
    respond() {
      return {
        lines: [
          'I close my hand around it. Just enough to mark my palm.',
          '!!The pain is small but it is the loudest thing in the room.!!',
          '~~I am awake.~~ I am awake.',
        ],
        composure: -2,
        composureCost: '~~A little blood.~~ A little blood. It keeps me here.',
        flags: { glass_clutched: true },
      };
    },
  },

  ink_bottle: {
    id: 'ink_bottle',
    name: 'a bottle of ink',
    file: 'Black. Half spilled. The cap is gone. ~~Names~~ Words appear where the spill dries.',
    desc: "Write on the wall. Uncovers her file in full. Costs.",
    voice: 'Ink. ~~Black.~~ Cold.',
    respond(p) {
      // reveal all file lines
      return {
        lines: [
          'I unstop it. I write what I have been told on the wall behind her.',
          '~~I write~~ I write what I remember. The rest fills itself in.',
          '!!The file is open in my hand. All of it.!!',
        ],
        composure: -2,
        composureCost: '~~My hand is black.~~ My hand is black. I cannot wash it off in this room.',
        flags: { _revealAllFile: true },
      };
    },
  },

  small_bell: {
    id: 'small_bell',
    name: 'a small bell',
    file: 'Brass. One note. ~~The note is somewhere in the building already.~~',
    desc: 'Ring it once. Wakes patients who have gone elsewhere.',
    voice: 'A bell. ~~The sound is the same as the corridor.~~',
    respond(p) {
      const shifts = {};
      if (p.def.scales?.sight !== undefined)       shifts.sight = +3;
      if (p.def.scales?.lucidity !== undefined)    shifts.lucidity = +3;
      if (p.def.scales?.recognition !== undefined) shifts.recognition = +2;
      if (p.def.scales?.chord !== undefined)       shifts.chord = -3;
      if (p.def.scales?.tending !== undefined)     shifts.tending = -2;
      return {
        lines: [
          'I ring it. Once. It is louder than the room.',
          'She stops what she is doing. She is here. ~~Partly.~~ Partly.',
        ],
        scales: shifts,
      };
    },
  },
};

export function getItem(id) { return ITEMS[id] || null; }

export function addItem(player, id) {
  if (!ITEMS[id]) return false;
  if (!player.items) player.items = [];
  if (player.items.length >= 8) return false;
  player.items.push(id);
  return true;
}

export function removeItem(player, id) {
  if (!player.items) return;
  const i = player.items.indexOf(id);
  if (i >= 0) player.items.splice(i, 1);
}

// the items the player chooses between at admission.
export const STARTING_ITEMS = [
  'photograph',
  'sugar_cube',
  'handkerchief',
  'pocket_watch',
];

// items the corridor can hand out mid-run. (the_card is special — every
// run starts with it as the player's admission card.)
export const CORRIDOR_ITEMS = [
  'worn_ribbon',
  'scrap_of_paper',
  'black_coin',
  'vial',
  'sliver_of_glass',
  'ink_bottle',
  'small_bell',
  'childs_drawing',
];
