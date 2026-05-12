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
      'Vitals nominal. Responds to questions. !!Cannot produce a residence.!!',
      'Settled in the assigned room without resistance. ~~Subject knew the way.~~',
    ],
    mods: { startComposure: 3 },
  },

  insomnia: {
    id: 'insomnia',
    name: 'Insomnia',
    one_liner: 'I have not slept in [[3]] days. I am still functioning.',
    file: [
      'Subject reports last sleep [[5]] days prior. Pupils normal. Pulse elevated.',
      'EEG taken at 02:14: ~~normal awake state~~ no recorded state.',
      'When instructed to lie down: !!declines.!!',
    ],
    mods: { startComposure: 3, composureMax: 1 },
  },

  absence: {
    id: 'absence',
    name: 'Absence',
    one_liner: 'I left a chair pulled out at home. ~~No one~~ Someone is sitting in it.',
    file: [
      'Subject reports a prior self ambulatory at the residence.',
      'Subject is calm about this. !!Staff are not.!!',
      'Asked which one is on the ward: ~~the wrong one~~ I do not know.',
    ],
    mods: { startComposure: 2, composureMax: 2 },
  },

  witness: {
    id: 'witness',
    name: 'Witness',
    one_liner: 'I saw something. I wrote it down. The paper is in my coat.',
    file: [
      'Subject was located at the address with a written account in their coat.',
      'The account is [[12]]. The handwriting matches the intake form.',
      'Subject does not remember writing it. ~~The page is still warm.~~',
    ],
    mods: { startComposure: 2 },
  },

  devotion: {
    id: 'devotion',
    name: 'Devotion',
    one_liner: 'I came here on purpose. I had a list. I have most of the list.',
    file: [
      'Subject presented at admissions with a list of names.',
      'Two of the names are staff. The others are !!not yet on file.!!',
      'Subject requests to be brought to one of them daily. ~~We have been complying.~~',
    ],
    mods: { startComposure: 4 },
  },

  hollow: {
    id: 'hollow',
    name: 'Hollow',
    one_liner: 'I am empty. Something will come back to the empty place.',
    file: [
      'Subject reports an internal vacancy. Imaging unremarkable. !!Imaging does not register Subject.!!',
      'Will not eat without prompting. When prompted, eats without satisfaction.',
      'Asked what is missing: ~~everyone~~ I will know when it returns.',
    ],
    mods: { startComposure: 2, composureMax: 2 },
  },
};

export function getWound(id) { return WOUNDS[id] || null; }
