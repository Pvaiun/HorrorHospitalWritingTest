// Corridor events — short vignettes between patient encounters. Each
// event presents a scene and 2–3 choices. Each choice carries an
// `effect(player, run)` that mutates the player (composure, scars, items).
//
// Items are the primary reward: most "good" choices hand the player an
// item from the CORRIDOR pool, sometimes alongside a small composure
// boost. Some "good" choices have a hidden cost — a scar, a worse item,
// or a composure ding later.
//
// Prose register: see docs/VOICE.md.

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
      'The nurses\' station is lit from underneath, the way you light a face to make it a mask. A nurse I have not met is on duty. There has always been a nurse I have not met.',
      'She says my number without looking up. 0413, she says, the way other people say there you are. On the desk between us she sets a tray, and on the tray, folded in wax paper, !!something warm.!!',
      'She does not push it toward me. The kindnesses here wait to be reached for. ~~That is how they count as yours.~~ That is how they count.',
    ],
    choices: [
      {
        key: 'take',
        label: 'Take what she offers',
        prose: 'I eat it standing up, like a child at a funeral. It is warm all the way down. ~~I am steadier.~~ The room is steadier. One of us is.',
        effect(p) { bumpComposure(p, 3); },
      },
      {
        key: 'refuse',
        label: 'Refuse',
        prose: 'I keep my hands in my pockets. She turns a page I cannot see and initials it. The tray stays on the desk, and it is still there when the desk is too far behind me to be sure of.',
        effect() {},
      },
      {
        key: 'pocket',
        label: 'Pocket a vial from the tray',
        prose: 'At the edge of the tray there is a vial that was not offered. I take it. ~~She does not see me.~~ She sees me, and writes nothing down. That is the largest kindness on the tray.',
        effect(p) { addItem(p, 'vial'); },
      },
    ],
  },

  empty_room: {
    id: 'empty_room',
    tag: '// Corridor · Room 0202 · vacant',
    glyph: 'Loamback',
    prose: [
      'Room 0202 stands open. The bed is made so tightly the blanket has a horizon. On the dresser a file lies open to its third page, and the third page is about ~~Subject 0413~~ me.',
      'The hand is one I half-know, the way you know a voice through a wall. The entries stop at today. There is room left on the page.',
      'The radiator knocks once, politely. ~~Asking.~~ Announcing.',
    ],
    choices: [
      {
        key: 'read',
        label: 'Read the file',
        prose: 'I read it standing, thumb holding my place, as if the file could close on me. Some of it is true. Some of it is becoming true while I hold it. When I set it down, the damp page keeps hold of my thumb a half-second longer than paper should.',
        effect(p) { bumpComposure(p, 1); addItem(p, 'scrap_of_paper'); },
      },
      {
        key: 'leave',
        label: 'Leave the file',
        prose: 'I leave it open. Closing it would mean touching it again. In the corridor I find I am walking the pale path worn down the middle of the floor, where everyone walks. ~~It fits.~~',
        effect() {},
      },
      {
        key: 'rewrite',
        label: 'Rewrite the third page',
        prose: 'I scratch out the third line and write my own in the space the page left me. The ink takes without complaint. !!The handwriting it dries into is not the one I wrote it in.!!',
        effect(p) { addItem(p, 'ink_bottle'); applyScar(p, 'witnessed'); },
      },
    ],
  },

  mirror: {
    id: 'mirror',
    tag: '// Corridor · The east mirror',
    glyph: 'Lumenpup',
    prose: [
      'The east mirror hangs where the corridor turns, angled the way shop mirrors are angled — to show what you are about to do. It shows the corridor behind me. It also shows a corridor I have not been down.',
      'In the other corridor !!I am already past the mirror,!! walking away, unhurried. ~~I will not~~ I have not turned left. Yet.',
    ],
    choices: [
      {
        key: 'wait',
        label: 'Wait for myself',
        prose: 'I stand still and let myself arrive. The other one passes without turning her head. We are polite about it, the way strangers are polite about resembling each other. Where she passed, a ribbon lies on the floor, the way a tide leaves what it was carrying.',
        effect(p) { bumpComposure(p, 2); addItem(p, 'worn_ribbon'); },
      },
      {
        key: 'follow',
        label: 'Step through',
        prose: 'I step through. It is like stepping into water at exactly blood heat — no edge to it, no proof. I am where I was. The corridor is the corridor. But my coat hangs heavier on one side, by the weight of a thing I did not pack.',
        effect(p) { addItem(p, 'small_bell'); applyScar(p, 'witnessed'); },
      },
      {
        key: 'shatter',
        label: 'Strike it',
        prose: 'I hit the glass with the heel of my hand. It does not break. The glass here is wired through with patience. !!Something in me does.!! When I take my hand away a sliver comes with it, lying in my palm like a thing that wanted carrying.',
        effect(p) { bumpComposure(p, -1); addItem(p, 'sliver_of_glass'); applyScar(p, 'collapsed'); },
      },
    ],
  },

  ward_case: {
    id: 'ward_case',
    tag: '// Corridor · Ward III · A file in passing',
    glyph: 'Mireling',
    prose: [
      'An orderly passes me carrying a file the way you carry a pan that has caught fire — at speed, at arm\'s length, his face turned from it.',
      'I read the cover as it goes by. ~~Subject~~ 02[[2]]. ~~Drowned the smaller one.~~ Refuses water. For three steps the corridor smells of pond. !!There is no pond on the grounds.!!',
      'The smell does not follow me. I keep what I read. The reading was the taking.',
    ],
    choices: [
      {
        key: 'remember',
        label: 'Remember the number',
        prose: 'I write the number on a corner of paper, fold it twice, and put it in the pocket over my chest. Someone should hold it who is not paid to. ~~No one~~ Someone should.',
        effect(p) { addItem(p, 'scrap_of_paper'); },
      },
      {
        key: 'forget',
        label: 'Forget it on purpose',
        prose: 'I set the number down before anyone asks me to carry it. It goes easily. ~~Too easily.~~ Everything here is easier to put down than it has any right to be, and I am steadier for it, and I do not like what that proves.',
        effect(p) { bumpComposure(p, 3); },
      },
    ],
  },

  desk: {
    id: 'desk',
    tag: '// Corridor · A writing desk · misplaced',
    glyph: 'Aurabeast',
    prose: [
      'A writing desk stands in the middle of the corridor, square to the walls, the way furniture stands in a room it owns. Desks do not belong in corridors. The corridor does not appear to know this.',
      'A pen. A lamp, still warm. A file with my number on the spine, open to a page I have not ~~lived~~ filled in yet. Someone has only just left. Or is only just arriving.',
    ],
    choices: [
      {
        key: 'write',
        label: 'Write something true',
        prose: 'I sit, because the chair is at the angle a chair is left at for you. I write one true thing on the empty page. The page takes it the way dry ground takes water. ~~I am smaller for it.~~ I am more legible for it.',
        effect(p) { bumpComposure(p, 2); },
      },
      {
        key: 'lie',
        label: 'Write something kinder',
        prose: 'I write a kinder thing than the truth. The page takes it faster — lies are the local currency, and the file makes change. !!Somewhere in the building, a box that was empty is now checked.!!',
        effect(p) { bumpComposure(p, 4); applyScar(p, 'named'); },
      },
      {
        key: 'pocket_pen',
        label: 'Pocket the pen',
        prose: 'I take the pen. It has the weight of a full pen and then some. ~~It is not ink.~~ Black ink. As I leave, the lamp goes out behind me, courteous, like a door closing on a guest.',
        effect(p) { addItem(p, 'ink_bottle'); },
      },
    ],
  },

  garden: {
    id: 'garden',
    tag: '// Corridor · A window · onto the garden',
    glyph: 'Sproutkin',
    prose: [
      'A window, where there was wall this morning. Through it, a garden in grey light, the rows kept by someone exact. !!There is no garden on the grounds.!! The grounds have been checked. The checking is on file.',
      'Someone kneels in the dirt with their back to me, planting at intervals too even for a person. They straighten. They have my hands. ~~Their face~~ They have my face.',
    ],
    choices: [
      {
        key: 'wave',
        label: 'Wave',
        prose: 'I raise a hand. They raise the same hand at the same speed — not after me, with me. We are being conducted. When they kneel back to the dirt there is a ribbon at the end of their row, and a ribbon in my coat pocket, and I only watched one of them arrive.',
        effect(p) { addItem(p, 'worn_ribbon'); },
      },
      {
        key: 'turn',
        label: 'Turn away',
        prose: 'I give the window my back. It costs more than it should. Ten steps on I check my hands — mine, both mine — and the wall is only wall the whole way down.',
        effect(p) { bumpComposure(p, 2); },
      },
      {
        key: 'open',
        label: 'Open the window',
        prose: 'The latch turns as if it has been kept oiled for me. The air that comes in is outdoor air, the first in longer than I can account for, and it passes through me as if I have fewer layers than a person should. I am thinner for it. !!I am also sharper.!! Frost climbs the inside of the glass as I close it, in the shape of rows.',
        effect(p) { bumpComposure(p, -2); addItem(p, 'sliver_of_glass'); },
      },
    ],
  },

  donation_box: {
    id: 'donation_box',
    tag: '// Corridor · A wooden box on the floor',
    glyph: 'Loamback',
    prose: [
      'A wooden box stands against the wall with a coin slot in the lid, the kind that waits beside church doors. The brass plate where the cause should be engraved is blank. It is the only polished thing on this floor.',
      'When I am two steps past it, it rattles. Once. The weight of the sound is wrong for a coin. Whatever is in there has been keeping its change ready.',
    ],
    choices: [
      {
        key: 'tip',
        label: 'Tip it over',
        prose: 'I tip the box. It is lighter than its sound. Out of the slot — which is too narrow for either — come a black coin and a child\'s drawing, folded in half. Paid in, both, by hands smaller than the slot.',
        effect(p) { addItem(p, 'black_coin'); addItem(p, 'childs_drawing'); },
      },
      {
        key: 'put',
        label: 'Put something in',
        prose: 'I post my admission card through the slot. It does not land. The box swallows like a throat, and the silence afterward is the receipt. ~~My name.~~ The card I will not be needing.',
        effect(p) { bumpComposure(p, -1); applyScar(p, 'named'); },
      },
      {
        key: 'leave',
        label: 'Leave it alone',
        prose: 'I keep walking. The rattle keeps time with my steps for longer than the box stays in sight. ~~Behind me.~~ In my chest. I pay it no attention, which is a way of paying.',
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
