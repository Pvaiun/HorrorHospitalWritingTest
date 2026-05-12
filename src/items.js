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
    file: 'creased twice. ~~someone~~ someone is in it I do not quite know.',
    desc: 'show it. for patients you need to be seen by.',
    voice: 'I had this in my coat. I do not remember putting it there.',
    when: (p) => p.def.scales?.recognition !== undefined,
    respond(p) {
      const shifts = { recognition: +3 };
      if (p.def.scales?.grief !== undefined) shifts.grief = +1;
      return {
        lines: [
          'I take the photograph from my pocket. I show it to her.',
          'she takes it. she does not give it back.',
          '~~she has seen this face before.~~ she has seen this face before.',
        ],
        scales: shifts,
      };
    },
  },

  sugar_cube: {
    id: 'sugar_cube',
    name: 'a sugar cube',
    file: 'wrapped in wax paper. one corner has gone soft.',
    desc: 'eat it. restore composure.',
    voice: 'I had this. I do not know why.',
    respond() {
      return {
        lines: [
          'I unwrap it. I put it on my tongue.',
          '~~the room~~ the room stops humming for a moment.',
        ],
        composure: +2,
      };
    },
  },

  handkerchief: {
    id: 'handkerchief',
    name: 'a folded handkerchief',
    file: 'pressed. an initial stitched in the corner — ~~not mine.~~',
    desc: 'offer it. calm a patient. costs a little.',
    voice: 'a handkerchief. ~~clean.~~ clean.',
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
          'I unfold the handkerchief. I offer it.',
          'she takes it. she folds it again. she puts it in her own pocket.',
        ],
        scales: shifts,
        composure: -1,
        composureCost: 'I gave away the only soft thing I had.',
      };
    },
  },

  childs_drawing: {
    id: 'childs_drawing',
    name: 'a child\'s drawing',
    file: 'crayon. folded twice. ~~signed~~ signed at the bottom in a name I almost recognize.',
    desc: 'show it. for patients with tenderness or grief.',
    voice: 'a drawing. ~~someone~~ someone gave it to me.',
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
          'I unfold the drawing. I hold it up.',
          'her face changes. she does not take it.',
          '!!she has not let herself look at one in a while.!!',
        ],
        scales: shifts,
        composure: -1,
        composureCost: '~~someone gave me~~ I do not remember where I got this.',
      };
    },
  },

  pocket_watch: {
    id: 'pocket_watch',
    name: 'a pocket watch',
    file: 'silver. it was ticking when I came in. it is not now.',
    desc: 'wind it. resets the patient\'s worst scale.',
    voice: 'a watch. ~~it has stopped.~~ it has stopped.',
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
          'I take the watch from my pocket. I wind it.',
          'the hand begins to move. the room settles a degree.',
          '~~something is~~ something is being put back. ~~I do not~~ I do not know how long it holds.',
        ],
        scales: shifts,
      };
    },
  },

  the_card: {
    id: 'the_card',
    name: 'the admission card',
    file: 'creased. Patient 0413. !!I have been holding it.!!',
    desc: 'name yourself. restore composure.',
    voice: 'the card. ~~I am~~ I am 0413.',
    respond(p) {
      const shifts = {};
      if (p.def.scales?.self !== undefined)        shifts.self = +3;
      if (p.def.scales?.recognition !== undefined) shifts.recognition = +2;
      return {
        lines: [
          'I take the card out. I read my own number off it. !!Patient 0413.!!',
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
    file: 'red. it has been tied and untied many times. ~~once~~ once it was tied around something.',
    desc: 'give it. soft memory. gentle.',
    voice: 'a ribbon. ~~someone~~ someone wore it.',
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
          'I take the ribbon out. she sees it before I have lifted it all the way.',
          'she lets me put it in her hand. she does not say anything.',
        ],
        scales: shifts,
      };
    },
  },

  scrap_of_paper: {
    id: 'scrap_of_paper',
    name: 'a scrap of paper',
    file: 'torn from something larger. a name. ~~not~~ not the one I expected.',
    desc: 'read what\'s on it. ~~who knows~~ who knows what it is.',
    voice: 'a scrap. with a name on it. ~~I~~ I did not write it.',
    respond(p) {
      // random behavior — sometimes a name lands, sometimes nothing
      const roll = Math.random();
      if (roll < 0.5 && p.def.scales?.recognition !== undefined) {
        return {
          lines: [
            'I read the name. it is one I had not been carrying on purpose.',
            'she looks up. she half-knows it.',
          ],
          scales: { recognition: +3 },
        };
      }
      if (roll < 0.8) {
        return {
          lines: [
            'I read the name. she does not respond to it.',
            'I put the scrap back. ~~I am not~~ I am not certain it was a name.',
          ],
          composure: -1,
          composureCost: 'the name was for someone else. ~~someone I~~ I do not remember.',
        };
      }
      // rare — bad
      return {
        lines: [
          'I read the name. it is mine.',
          '!!I did not write it.!! someone wrote it down for me. ~~recently.~~',
        ],
        composure: -2,
        composureCost: '!!someone has been writing my name in places I have not been.!!',
        scars: ['named'],
      };
    },
  },

  black_coin: {
    id: 'black_coin',
    name: 'a black coin',
    file: 'the size of a thumbnail. it does not catch the light. ~~I do not remember~~ I have been carrying it.',
    desc: 'pay it. it costs. it shifts something stuck.',
    voice: 'a coin. ~~it does not~~ it does not weigh much.',
    respond(p) {
      // shifts every negative scale down by 2 (good), at a composure cost.
      const shifts = {};
      for (const [k, def] of Object.entries(p.def.scales || {})) {
        if (def.kind === 'negative') shifts[k] = -2;
      }
      return {
        lines: [
          'I take the coin out. I set it on the floor between us.',
          'the room settles. ~~something has been~~ something has been paid for.',
        ],
        scales: shifts,
        composure: -2,
        composureCost: '!!the coin was warm. it is not now.!!',
      };
    },
  },

  vial: {
    id: 'vial',
    name: 'a small vial',
    file: 'glass. ~~half~~ half full. no label.',
    desc: 'drink it. it calms. ~~it~~ it may also dull.',
    voice: 'a vial. ~~someone~~ someone gave it to me. for the trip.',
    respond(p) {
      const shifts = {};
      if (p.def.scales?.tending !== undefined)   shifts.tending = +2;
      if (p.def.scales?.insistence !== undefined) shifts.insistence = +1;
      return {
        lines: [
          'I open the vial. I drink half of it.',
          'the room is suddenly very soft. my edges have gone. ~~I am still~~ I am still here.',
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
    file: 'small. sharp at one end. ~~clean.~~ clean.',
    desc: 'clutch it. costs composure now. wards off the next blow.',
    voice: 'a sliver. ~~I~~ I will not need this.',
    respond() {
      return {
        lines: [
          'I close my hand around the sliver. just enough to mark my palm.',
          '!!the pain is small but it is the loudest thing in the room.!!',
          '~~I am awake.~~ I am awake.',
        ],
        composure: -2,
        composureCost: '~~a little blood.~~ a little blood. it keeps me here.',
        flags: { glass_clutched: true },
      };
    },
  },

  ink_bottle: {
    id: 'ink_bottle',
    name: 'a bottle of ink',
    file: 'black. half spilled. ~~the cap~~ the cap is gone.',
    desc: 'write on the wall. ~~it costs.~~ uncovers her file in full.',
    voice: 'ink. ~~black.~~ black.',
    respond(p) {
      // reveal all file lines
      // engine will mark them; we just return a flag and let the engine
      // pick it up. easiest: set patient flag here and have the engine
      // honor it. (engine already runs checkFileReveals after each
      // response — but that's gated by `when`. simpler: write directly.)
      return {
        lines: [
          'I unstop the ink. I write what I have been told on the wall behind her.',
          '~~I write~~ I write what I remember. the rest fills itself in.',
          '!!the file is open in my hand. it is in full.!!',
        ],
        composure: -2,
        composureCost: '~~my hand~~ my hand is black. I cannot wash it off in this room.',
        flags: { _revealAllFile: true },
      };
    },
  },

  small_bell: {
    id: 'small_bell',
    name: 'a small bell',
    file: 'brass. one note. ~~someone~~ someone has rung it before.',
    desc: 'ring it once. wakes patients who have gone elsewhere.',
    voice: 'a bell. ~~the sound is~~ the sound is the same as the corridor.',
    respond(p) {
      const shifts = {};
      if (p.def.scales?.sight !== undefined)       shifts.sight = +3;
      if (p.def.scales?.lucidity !== undefined)    shifts.lucidity = +3;
      if (p.def.scales?.recognition !== undefined) shifts.recognition = +2;
      if (p.def.scales?.chord !== undefined)       shifts.chord = -3;
      if (p.def.scales?.tending !== undefined)     shifts.tending = -2;
      return {
        lines: [
          'I ring the bell. once. it is louder than the room.',
          'she stops what she is doing. she is here. ~~partly.~~ partly.',
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
// run starts with it as the player\'s admission card.)
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
