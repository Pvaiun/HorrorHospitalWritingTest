// Wounds are admission reasons. Each is a starting state for a run: a
// small handicap and a small gift. The wound is the seed of the player's
// file. Wounds no longer hand out signatures — those have been replaced
// by the inventory system in src/items.js.

export const WOUNDS = {
  amnesia: {
    id: 'amnesia',
    name: 'Amnesia',
    one_liner: 'I do not remember the address.',
    file: [
      'Subject arrived unaccompanied. No identification.',
      'Vitals normal. Responds to questions. !!Does not remember the address.!!',
      'Settled in room without resistance.',
    ],
    // composureMax adds to your cap; startComposure is the per-fight
    // baseline floor your composure drops to (you can always carry more
    // across from events; never less than this).
    mods: { startComposure: 3 },
  },

  insomnia: {
    id: 'insomnia',
    name: 'Insomnia',
    one_liner: 'I have been awake for a while now.',
    file: [
      'Subject has not slept since admission. Reports last sleep was [[5]] days prior.',
      'Pupils normal. Pulse elevated.',
      'When asked to lie down: !!declines.!!',
    ],
    mods: { startComposure: 3, composureMax: 1 },
  },

  absence: {
    id: 'absence',
    name: 'Absence',
    one_liner: 'I left a chair pulled out at home. ~~No one~~ Someone is sitting in it.',
    file: [
      'Subject reports a previous self still active at the residence.',
      'Subject is calm about this. Staff are not.',
      'Asked which is here, in this chair: !!I do not know.!!',
    ],
    mods: { startComposure: 2 },
  },

  witness: {
    id: 'witness',
    name: 'Witness',
    one_liner: 'I saw something. I wrote it down. The paper is in my coat.',
    file: [
      'Subject was found at the address with a written account in their coat.',
      'The account is [[12]]. The handwriting matches.',
      'Subject does not remember writing it.',
    ],
    mods: { startComposure: 2 },
  },

  devotion: {
    id: 'devotion',
    name: 'Devotion',
    one_liner: 'I came here on purpose. I think.',
    file: [
      'Subject presented at admissions with a list of names.',
      'Two of the names are staff. The others are !!not yet on file.!!',
      'Subject asks to be brought to one of them daily.',
    ],
    mods: { startComposure: 4 },
  },

  hollow: {
    id: 'hollow',
    name: 'Hollow',
    one_liner: 'I am not full of much.',
    file: [
      'Subject reports an internal emptiness. Imaging unremarkable.',
      'Will not eat without prompting. Eats slowly when reminded.',
      'When asked what is missing, answers: ~~everything~~ I will know when it comes back.',
    ],
    mods: { startComposure: 2, composureMax: 2 },
  },
};

export function getWound(id) { return WOUNDS[id] || null; }
