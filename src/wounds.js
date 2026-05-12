// Wounds are admission reasons. Each is the anomalous quality the facility
// has decided requires containment. The wound is the seed of the player's
// file. Wounds no longer hand out signatures — those have been replaced
// by the inventory system in src/items.js.

export const WOUNDS = {
  amnesia: {
    id: 'amnesia',
    name: 'Amnesia',
    one_liner: 'I do not remember the address. I am here anyway.',
    file: [
      'Subject was admitted unaccompanied. No identification on file.',
      'Vitals nominal. Responds to questions. !!Cannot give an address.!!',
      'Settled into the assigned room without resistance. ~~Subject knew the way.~~',
    ],
    mods: { startComposure: 4 },
  },

  insomnia: {
    id: 'insomnia',
    name: 'Insomnia',
    one_liner: 'I have not slept in [[3]] days. I am still functioning.',
    file: [
      'Subject reports last sleep [[5]] days prior. Pupils normal. Pulse elevated.',
      'EEG taken at 02:14: ~~normal waking rhythm~~ no detectable rhythm.',
      'When asked to lie down, Subject !!refuses.!!',
    ],
    mods: { startComposure: 3, composureMax: 1 },
  },

  absence: {
    id: 'absence',
    name: 'Split Personality',
    one_liner: 'I left a chair pulled out at home. ~~No one~~ Someone is sitting in it.',
    file: [
      'Subject reports a second self still walking the rooms at the residence.',
      'Subject is calm about this. !!Staff are not.!!',
      'Asked which one is on the ward: ~~the wrong one~~ I do not know.',
    ],
    mods: { startComposure: 2, composureMax: 2 },
  },
};

export function getWound(id) { return WOUNDS[id] || null; }
