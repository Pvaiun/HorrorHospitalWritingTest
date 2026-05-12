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
    tag: '// corridor · nurses\' station',
    glyph: 'Soothlick',
    prose: [
      'the station is lit from below. a nurse i have not seen before is behind the desk.',
      'she does not look up. she says my name in a voice that is mostly air. she has a tray.',
      'on the tray: !!a small thing!!. she does not push it forward.',
    ],
    choices: [
      {
        key: 'take',
        label: 'Take what she offers',
        prose: 'I take it. it is warm. it does not weigh much. ~~I~~ I feel restored, somewhere.',
        effect(p) { bumpComposure(p, 3); },
      },
      {
        key: 'refuse',
        label: 'Refuse',
        prose: 'I keep my hands at my sides. she does not look up. the tray stays.',
        effect() {},
      },
      {
        key: 'pocket',
        label: 'Pocket a vial from the tray',
        prose: 'I take a small vial from the tray. she does not see me do it. ~~or does, and lets me.~~',
        effect(p) { addItem(p, 'vial'); },
      },
    ],
  },

  empty_room: {
    id: 'empty_room',
    tag: '// corridor · room 0202 · empty',
    glyph: 'Loamback',
    prose: [
      'this room is empty. the bed is made. there is a file on the dresser, open to the third page.',
      'the third page says: ~~Patient 0413~~ Patient 0413.',
      'I close it. it is a little heavier than I expected.',
    ],
    choices: [
      {
        key: 'read',
        label: 'Read the file',
        prose: 'I read it through. some of it is true. some of it is becoming true.',
        effect(p) { bumpComposure(p, 1); addItem(p, 'scrap_of_paper'); },
      },
      {
        key: 'leave',
        label: 'Leave the file',
        prose: 'I leave the file open. ~~I close~~ I leave the door open.',
        effect() {},
      },
      {
        key: 'rewrite',
        label: 'Rewrite the third page',
        prose: 'I scratch out the line. I write another. the page does not ~~object~~ resist. !!I do not recognize my own hand.!!',
        effect(p) { addItem(p, 'ink_bottle'); applyScar(p, 'witnessed'); },
      },
    ],
  },

  mirror: {
    id: 'mirror',
    tag: '// corridor · mirror at the end',
    glyph: 'Lumenpup',
    prose: [
      'a mirror at the end of the corridor. the angle is wrong. it shows the corridor behind me, and also a corridor I have not been in.',
      'in the other corridor, !!I am already past the mirror!!. I have not been ~~looking~~ left.',
    ],
    choices: [
      {
        key: 'wait',
        label: 'Wait for myself',
        prose: 'I wait. the other me passes. we do not nod. ~~she~~ I drop something as I go by.',
        effect(p) { bumpComposure(p, 2); addItem(p, 'worn_ribbon'); },
      },
      {
        key: 'follow',
        label: 'Step through',
        prose: 'I step through. the room composes itself behind me. ~~the corridor I came from is gone~~ I am where I was. there is something in my coat that was not there.',
        effect(p) { addItem(p, 'small_bell'); applyScar(p, 'witnessed'); },
      },
      {
        key: 'shatter',
        label: 'Strike it',
        prose: 'I strike the glass. it does not break. !!my hand does.!!',
        effect(p) { bumpComposure(p, -1); addItem(p, 'sliver_of_glass'); applyScar(p, 'collapsed'); },
      },
    ],
  },

  ward_case: {
    id: 'ward_case',
    tag: '// corridor · ward iii · a file passing by',
    glyph: 'Mireling',
    prose: [
      'a file passes me in the hall. it is not mine. someone is carrying it briskly.',
      'I read the first line as it goes by. ~~Patient~~ 02[[2]]. ~~refuses water~~. !!the room smells of pond.!!',
      'I do not stop. I do not look back. I keep what I read.',
    ],
    choices: [
      {
        key: 'remember',
        label: 'Remember the name',
        prose: 'I write it down. I will keep it. ~~someone~~ someone should.',
        effect(p) { addItem(p, 'scrap_of_paper'); },
      },
      {
        key: 'forget',
        label: 'Forget it on purpose',
        prose: 'I let it go before I am asked to. the corridor is cleaner. ~~I~~ I am calmer for it.',
        effect(p) { bumpComposure(p, 3); },
      },
    ],
  },

  desk: {
    id: 'desk',
    tag: '// corridor · the writing desk',
    glyph: 'Aurabeast',
    prose: [
      'there is a desk in the hallway. it should not be in the hallway. it has a pen, a lamp, and a file.',
      'the file has my name on it. it is open to a page I have not yet ~~lived~~ filled.',
    ],
    choices: [
      {
        key: 'write',
        label: 'Write something true',
        prose: 'I write it. the page accepts it. I am ~~smaller~~ more here.',
        effect(p) { bumpComposure(p, 2); },
      },
      {
        key: 'lie',
        label: 'Write something better',
        prose: 'I write something kinder than the truth. the page accepts it more readily. !!I am more here than I should be.!!',
        effect(p) { bumpComposure(p, 4); applyScar(p, 'named'); },
      },
      {
        key: 'pocket_pen',
        label: 'Pocket the pen',
        prose: 'I take the pen. it is heavier than it should be. ~~black ink~~ black ink.',
        effect(p) { addItem(p, 'ink_bottle'); },
      },
    ],
  },

  garden: {
    id: 'garden',
    tag: '// corridor · a window onto the garden',
    glyph: 'Sproutkin',
    prose: [
      'a window. there is a garden out there. !!there is no garden on the grounds.!!',
      'someone is kneeling in the garden. they have my hands.',
    ],
    choices: [
      {
        key: 'wave',
        label: 'Wave',
        prose: 'they wave back. exactly. ~~I am being copied~~ I am being mirrored. when they straighten, there is a ribbon in their hand. and in mine.',
        effect(p) { addItem(p, 'worn_ribbon'); },
      },
      {
        key: 'turn',
        label: 'Turn away',
        prose: 'I do not look long. the window is clean.',
        effect(p) { bumpComposure(p, 2); },
      },
      {
        key: 'open',
        label: 'Open the window',
        prose: 'cold. a wind comes in from outside. ~~I~~ I am thinner for it. !!I am also sharper.!!',
        effect(p) { bumpComposure(p, -2); addItem(p, 'sliver_of_glass'); },
      },
    ],
  },

  donation_box: {
    id: 'donation_box',
    tag: '// corridor · a wooden box on the floor',
    glyph: 'Loamback',
    prose: [
      'a wooden donation box is set against the wall. it should not be in this part of the building.',
      'the slot is wide enough for a coin. ~~there is~~ there is something already inside, rattling.',
    ],
    choices: [
      {
        key: 'tip',
        label: 'Tip it over',
        prose: 'I tip the box. a black coin falls out, and a child\'s drawing folded in half.',
        effect(p) { addItem(p, 'black_coin'); addItem(p, 'childs_drawing'); },
      },
      {
        key: 'put',
        label: 'Put something in',
        prose: 'I drop the card from my pocket through the slot. ~~the card~~ the card I will not be needing.',
        effect(p) { bumpComposure(p, -1); applyScar(p, 'named'); },
      },
      {
        key: 'leave',
        label: 'Leave it alone',
        prose: 'I keep walking. the rattling continues a long time. ~~or it is~~ or it is something in my chest.',
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
