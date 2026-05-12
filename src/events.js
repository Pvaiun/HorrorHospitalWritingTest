// Corridor events — short vignettes between patient encounters. Each
// event presents a scene and 2–3 choices. Each choice carries an
// `effect(player, run)` that mutates the player (composure, scars, items).
//
// Items are the primary reward: most "good" choices hand the player an
// item from the CORRIDOR pool, sometimes alongside a small composure
// boost. Some "good" choices have a hidden cost — a scar, a worse item,
// or a composure ding later.

import { pick } from './rng.js';
import { applyScar } from './scars.js';
import { addItem } from './items.js';
import { COMPOSURE_MAX } from './state.js';

function bumpComposure(p, n) {
  p.composure = Math.max(0, Math.min(p.composureMax || COMPOSURE_MAX, (p.composure || 0) + n));
}

export const EVENTS = {

  nurse: {
    id: 'nurse',
    tag: '// Corridor · Nurses\' station · after hours',
    glyph: 'Soothlick',
    prose: [
      'The station is lit from below. A nurse I have not seen before is at the desk.',
      'She does not look up. She says my number in a voice that is mostly air. She has a tray.',
      'On the tray: !!a small thing.!! ~~She knows what I came for.~~ She does not push it forward.',
    ],
    choices: [
      {
        key: 'take',
        label: 'Take what she offers',
        prose: 'I take it. It is warm. ~~My hand~~ My hand is steadier for a moment.',
        effect(p) { bumpComposure(p, 3); },
      },
      {
        key: 'refuse',
        label: 'Refuse',
        prose: 'I keep my hands at my sides. She does not look up. The tray stays.',
        effect() {},
      },
      {
        key: 'pocket',
        label: 'Pocket a vial from the tray',
        prose: 'I take a small vial from the tray. ~~She does not see me.~~ She sees me, and lets me.',
        effect(p) { addItem(p, 'vial'); },
      },
    ],
  },

  empty_room: {
    id: 'empty_room',
    tag: '// Corridor · Room 0202 · vacant',
    glyph: 'Loamback',
    prose: [
      'The room is empty. The bed is made. A file lies open on the dresser, at the third page.',
      'The third page reads: ~~Subject 0413~~ Patient 0413.',
      'I close it. It is heavier than it should be.',
    ],
    choices: [
      {
        key: 'read',
        label: 'Read the file',
        prose: 'I read it through. Some of it is true. ~~Some of it is happening now.~~ Some of it is becoming true.',
        effect(p) { bumpComposure(p, 1); addItem(p, 'scrap_of_paper'); },
      },
      {
        key: 'leave',
        label: 'Leave the file',
        prose: 'I leave the file open. ~~I close~~ I leave the door open behind me.',
        effect() {},
      },
      {
        key: 'rewrite',
        label: 'Rewrite the third page',
        prose: 'I scratch out the line. I write another. The page does not ~~object~~ resist. !!I do not recognize my own hand.!!',
        effect(p) { addItem(p, 'ink_bottle'); applyScar(p, 'witnessed'); },
      },
    ],
  },

  mirror: {
    id: 'mirror',
    tag: '// Corridor · The east mirror',
    glyph: 'Lumenpup',
    prose: [
      'A mirror at the end of the corridor. The angle is wrong. It shows the corridor behind me, and also a corridor I have not been in.',
      'In the other corridor, !!I am already past the mirror.!! ~~I have not~~ I have not turned left.',
    ],
    choices: [
      {
        key: 'wait',
        label: 'Wait for myself',
        prose: 'I wait. The other one passes. We do not look at each other. ~~She~~ The other drops something on her way by.',
        effect(p) { bumpComposure(p, 2); addItem(p, 'worn_ribbon'); },
      },
      {
        key: 'follow',
        label: 'Step through',
        prose: 'I step through. The room composes itself behind me. ~~The corridor I came from is gone.~~ I am where I was. Something is in my coat that was not there before.',
        effect(p) { addItem(p, 'small_bell'); applyScar(p, 'witnessed'); },
      },
      {
        key: 'shatter',
        label: 'Strike it',
        prose: 'I strike the glass. It does not break. !!My hand does.!!',
        effect(p) { bumpComposure(p, -1); addItem(p, 'sliver_of_glass'); applyScar(p, 'collapsed'); },
      },
    ],
  },

  ward_case: {
    id: 'ward_case',
    tag: '// Corridor · Ward III · A file in passing',
    glyph: 'Mireling',
    prose: [
      'A file passes me in the hall. It is not mine. An orderly is carrying it briskly.',
      'I read the first line as it goes by. ~~Subject~~ 02[[2]]. ~~Drowned the smaller one.~~ Refuses water. !!The corridor smells of pond.!!',
      'I do not stop. I do not look back. I keep what I read.',
    ],
    choices: [
      {
        key: 'remember',
        label: 'Remember the number',
        prose: 'I write it down. I will keep it. ~~Someone~~ Someone should.',
        effect(p) { addItem(p, 'scrap_of_paper'); },
      },
      {
        key: 'forget',
        label: 'Forget it on purpose',
        prose: 'I let it go before I am asked to. The corridor is cleaner. ~~I~~ I am steadier for it.',
        effect(p) { bumpComposure(p, 3); },
      },
    ],
  },

  desk: {
    id: 'desk',
    tag: '// Corridor · A writing desk · misplaced',
    glyph: 'Aurabeast',
    prose: [
      'A desk in the hallway. It should not be in the hallway. A pen. A lamp. A file.',
      'The file has my number on it. It is open to a page I have not yet ~~lived~~ filled.',
    ],
    choices: [
      {
        key: 'write',
        label: 'Write something true',
        prose: 'I write it. The page accepts it. ~~I am smaller for it.~~ I am more here.',
        effect(p) { bumpComposure(p, 2); },
      },
      {
        key: 'lie',
        label: 'Write something kinder',
        prose: 'I write something kinder than the truth. The page accepts it more readily. !!I am more here than I should be.!!',
        effect(p) { bumpComposure(p, 4); applyScar(p, 'named'); },
      },
      {
        key: 'pocket_pen',
        label: 'Pocket the pen',
        prose: 'I take the pen. It is heavier than it should be. ~~Black ink.~~ Black ink.',
        effect(p) { addItem(p, 'ink_bottle'); },
      },
    ],
  },

  garden: {
    id: 'garden',
    tag: '// Corridor · A window · onto the garden',
    glyph: 'Sproutkin',
    prose: [
      'A window. There is a garden through it. !!There is no garden on the grounds.!!',
      'Someone is kneeling in the dirt. ~~Their hands~~ They have my hands.',
    ],
    choices: [
      {
        key: 'wave',
        label: 'Wave',
        prose: 'They wave back. Exactly. ~~I am being copied.~~ I am being mirrored. When they straighten, there is a ribbon in their hand. And in mine.',
        effect(p) { addItem(p, 'worn_ribbon'); },
      },
      {
        key: 'turn',
        label: 'Turn away',
        prose: 'I do not look long. The window is clean.',
        effect(p) { bumpComposure(p, 2); },
      },
      {
        key: 'open',
        label: 'Open the window',
        prose: 'Cold. A wind comes in from outside. ~~I am thinner~~ I am thinner for it. !!I am also sharper.!!',
        effect(p) { bumpComposure(p, -2); addItem(p, 'sliver_of_glass'); },
      },
    ],
  },

  donation_box: {
    id: 'donation_box',
    tag: '// Corridor · A wooden box on the floor',
    glyph: 'Loamback',
    prose: [
      'A wooden donation box is set against the wall. It should not be in this part of the building.',
      'The slot is wide enough for a coin. ~~There is~~ Something is already inside, rattling.',
    ],
    choices: [
      {
        key: 'tip',
        label: 'Tip it over',
        prose: "I tip the box. A black coin falls out, and a child's drawing folded in half.",
        effect(p) { addItem(p, 'black_coin'); addItem(p, 'childs_drawing'); },
      },
      {
        key: 'put',
        label: 'Put something in',
        prose: 'I drop the card from my pocket through the slot. ~~The card~~ The card I will not be needing.',
        effect(p) { bumpComposure(p, -1); applyScar(p, 'named'); },
      },
      {
        key: 'leave',
        label: 'Leave it alone',
        prose: 'I keep walking. The rattling continues a long time. ~~Or it is~~ Or it is something in my chest.',
        effect(p) { bumpComposure(p, 1); },
      },
    ],
  },
};

export function pickEventPool(n) {
  const keys = Object.keys(EVENTS);
  const shuffled = keys.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const out = shuffled.slice(0, Math.min(n, shuffled.length));
  while (out.length < n) out.push(pick(keys));
  return out;
}

export function getEvent(id) { return EVENTS[id] || null; }
