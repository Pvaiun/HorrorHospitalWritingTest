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
// THE PRAM — Patient 0028
// ════════════════════════════════════════════════════════════════════════
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
  subtitle: 'She is rocking a son who did not survive delivery.',
  role: 'wing', tier: 1,
  file: [
    'Subject was admitted with a perambulator. ~~The perambulator is empty.~~ Subject reports an infant inside.',
    'Her son ~~died in delivery~~ did not survive the delivery on [[8]]. !!Subject was not informed in time.!!',
    'Staff are instructed ~~not to inform her~~ not to correct her. !!Subject is violent when questioned.!!',
  ],
  intro: [
    'She is on the chair by the window with the pram between her knees.',
    'She is rocking it slowly. She is humming a lullaby. She does not look up.',
  ],

  scales: {
    lucidity: {
      initial: 0, min: 0, max: 10, label: 'lucidity', kind: 'positive',
      bands: [
        { at: 0, word: 'far away' },
        { at: 2, word: 'fogged' },
        { at: 5, word: 'stirring' },
        { at: 7, word: 'clear-eyed' },
        { at: 9, word: 'all the way here' },
      ],
      crossUp: {
        2: 'Her eyes have come up off the blanket.',
        3: 'She is in the room with me. Partly.',
        4: '!!She has remembered where she is.!!',
      },
      crossDown: {
        1: 'She has slipped under again.',
        0: 'Her eyes are gone.',
      },
    },
    grip: {
      initial: 7, min: 0, max: 10, label: 'grip', kind: 'negative',
      bands: [
        { at: 0, word: 'hands open' },
        { at: 3, word: 'resting on the handle' },
        { at: 5, word: 'tight' },
        { at: 7, word: 'white-knuckled' },
        { at: 9, word: 'fused to it' },
      ],
      crossUp: {
        2: 'Her knuckles have whitened on the handle.',
        3: 'Her arms are rigid. The pram is hers and only hers.',
        4: '!!Her grip has fused. She and the pram are one shape.!!',
      },
      crossDown: {
        3: 'Her arms have eased.',
        2: 'Her fingers have loosened on the handle.',
        1: 'She has let the pram go. She has set herself down.',
        0: 'The pram rests at her feet. Her hands are in her lap.',
      },
    },
    agitation: {
      initial: 2, min: 0, max: 10, label: 'agitation', kind: 'negative',
      bands: [
        { at: 0, word: 'calm' },
        { at: 3, word: 'uneasy' },
        { at: 6, word: 'agitated' },
        { at: 8, word: 'beginning to scream' },
        { at: 10, word: 'fit' },
      ],
      crossUp: {
        2: 'Her humming has changed pitch.',
        3: 'Her rocking has gone off-beat.',
        4: '!!She is making a sound that is not the lullaby anymore.!!',
      },
      crossDown: {
        2: 'The worst of it has passed. Her breath has come back.',
        1: 'She is no longer screaming.',
        0: 'She has calmed.',
      },
    },
  },

  initialize(p) {
    p.scales.lucidity = 0;
    p.scales.grip = r(6, 8);
    p.scales.agitation = r(1, 3);
  },

  fileReveals: [
    { announce: 'A line fills in. Subject ~~holds a bundle of rags~~ holds the infant carefully.' },
    { announce: 'Another. The lullaby Subject sings is ~~from her own childhood~~ five notes she repeats endlessly.' },
    { announce: 'The last line. Subject has been informed of his death on [[2]] occasions. !!She does not retain it.!!' },
  ],

  presented(p) {
    const l = p.scales.lucidity;
    const g = p.scales.grip;
    const a = p.scales.agitation;

    let arms;
    if (a >= 7)      arms = '!!Her arms are rigid. She rocks the pram so fast the room moves with her.!!';
    else if (g >= 7) arms = 'She rocks the pram quickly. Her arms are tight around the handle.';
    else if (g >= 4) arms = 'She rocks the pram. Steady. The wheels do not turn.';
    else if (g >= 1) arms = 'Her arms rest on the pram. She has mostly stopped rocking.';
    else             arms = 'The pram sits between her feet. She has stopped rocking it.';

    let eyes;
    if (l >= 7)      eyes = 'Her eyes are on me. She is here.';
    else if (l >= 4) eyes = 'Her eyes find me sometimes. Then leave for the blanket.';
    else if (a >= 5) eyes = 'Her eyes are somewhere I cannot follow. Fixed and far.';
    else             eyes = 'She does not look up. Her eyes are on the blanket.';

    let voice;
    if (a >= 7)      voice = 'Her humming has gone off the song. !!She is keening.!!';
    else if (a >= 4) voice = 'Her humming has thinned. She has noticed me.';
    else             voice = 'She is humming the same five notes. Over and over.';

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
              'I keep listening. The five notes have not changed. She is somewhere I cannot follow.',
              'She does not seem to know I have been here.',
            ],
            scales: { grip: +1, lucidity: -1 },
            composure: -1,
            composureCost: 'I have learned the song. I cannot unhear it.',
          };
        }
        return {
          lines: [
            'I let her sing. The lullaby is the same five notes, over and over.',
            'Her rocking is steady. The wheels do not turn.',
          ],
          scales: { lucidity: +1 },
        };
      },
    },

    sing_with_her: {
      label: 'sing with her',
      desc: 'Pick up the line she keeps starting. Indulge her.',
      respond(p) {
        const reps = streakCount(p, 'sing_with_her');
        if (reps >= 2) {
          return {
            lines: [
              'I hum the line again. She meets me on the second beat.',
              'She looks at me. !!You know it,!! she says. !!Good.!!',
              'She does not stop. We hum together.',
            ],
            scales: { grip: -1, agitation: -2, lucidity: -1 },
            flags: { sang_with_her: true },
            composure: -1,
            composureCost: 'I have agreed to a song without a child in it.',
          };
        }
        return {
          lines: [
            'I find the line she keeps starting. I hum a bar of it.',
            'Her humming meets mine. Her shoulders ease. She does not look at me, but she is no longer alone in the song.',
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
              '!!Quiet,!! she snaps. !!You will wake him.!! Her humming has changed.',
            ],
            scales: { agitation: +3, grip: +2 },
            composure: -1,
            composureCost: 'Her face has gone wrong.',
          };
        }
        if (p.scales.lucidity >= 5) {
          return {
            lines: [
              'I ask: how is he?',
              'She stops humming. She looks at the blanket for a long time. !!He is sleeping,!! she says. But softer than before.',
            ],
            scales: { lucidity: +2, agitation: +1, grip: -1 },
          };
        }
        return {
          lines: [
            'I ask: how is he?',
            'She smiles, faintly. !!He is sleeping,!! she says. !!He has been so good.!!',
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
              '!!You stop talking,!! she says. !!You stop talking now.!!',
              'She has begun to scream without sound. Her rocking has gone fast.',
            ],
            scales: { agitation: +5, grip: +3, lucidity: +1 },
            composure: -2,
            composureCost: '!!She is hearing something I cannot.!!',
          };
        }
        if (p.scales.lucidity >= 7) {
          return {
            lines: [
              'I say: he did not survive the delivery. He is not in the blanket.',
              'She does not look up. Her humming stops on a note that does not finish.',
              'After a long time she says, very small: ~~I know.~~ I know.',
            ],
            scales: { lucidity: +3, grip: -3, agitation: +2 },
            flags: { told_her: true },
            composure: -1,
            composureCost: 'I have said it in this room. !!Out loud.!!',
          };
        }
        return {
          lines: [
            'I say: he is not in the pram. He did not survive the delivery.',
            'Her humming stops. She looks at me. !!Why would you say that to me?!! she asks. Her voice has gone thin.',
          ],
          scales: { lucidity: +2, agitation: +3, grip: +1 },
          composure: -1,
          composureCost: 'I have said it. !!She has heard it.!!',
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
            'I lay my hand over hers where it rests on the handle. She is warm.',
            p.scales.lucidity >= 4
              ? 'She does not pull away. Her grip on the handle softens, almost without her noticing.'
              : 'She does not pull away. She does not return the contact either.',
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
              '!!Her arms are empty. She is also empty. She breathes.!!',
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
            'She is not all the way here, but the bundle is not in her lap anymore.',
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
        'She pauses the rocking. She leans forward over the blanket. Protective.',
        'She looks at me and whispers: !!He is sleeping. Yes?!!',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'Agree. Let her keep him.',
          lines: [
            'I nod. I say: yes. He is sleeping.',
            'Her rocking finds a slower rhythm. Her shoulders ease. She goes on humming.',
            '~~She has not been told.~~',
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
            'She looks at her own arms as if she has just noticed them.',
            'After a moment she sets them down on the handle and does not lift them again.',
          ],
          scales: { grip: -3, lucidity: +2, agitation: -1 },
        },
        {
          label: "he is not",
          desc: 'The truth. Quietly.',
          lines: [
            'I say: he is not sleeping.',
            'Her face goes white. !!Do not say that,!! she says. !!Do not say that in this room.!!',
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
        'Her humming stops mid-bar. She squints at me.',
        'She says: ~~Do I know you?~~',
      ],
      responses: [
        {
          label: "I don't think so",
          desc: 'Gentle truth.',
          lines: [
            'I say: I do not think so. I came in this morning.',
            'She takes that in. She is not upset. She nods.',
          ],
          scales: { lucidity: +2, grip: -1 },
        },
        {
          label: 'you do',
          desc: 'A kind lie.',
          lines: [
            'I say: you do.',
            'She relaxes. Just a little. She does not check. She does not look at me with full eyes again, after.',
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
            'She nods slowly. She keeps rocking.',
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
            'She lifts her head. She looks at me as if I have said something useful for the first time.',
            '~~She has not slept in this chair.~~ She has not slept in this chair.',
          ],
          scales: { lucidity: +1, agitation: -1 },
        },
        {
          label: '[split personality] one of me does',
          desc: 'Offer her the half that fits.',
          when: (_, player) => player.wound === 'split_personality',
          lines: [
            'I say: one of me does. The other does not.',
            'She does not seem surprised by that. She nods slowly.',
            '~~She has been waiting for one of me.~~ She has been waiting for one of me.',
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
        'She has stopped humming. She looks at the blanket. Then at me.',
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
            'She nods. She takes that. Her eyes go past me to the window.',
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
        'Her humming has gone loud. Her rocking is at the wrong tempo.',
        '!!Be quiet,!! she says. !!You will wake him.!!',
      ],
      responses: [
        {
          label: 'be quiet',
          desc: 'Meet her where she is.',
          lines: [
            'I lower my voice. I stop moving.',
            'Her humming finds its rhythm again. Slowly. The room loosens a degree.',
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
          'I wait. She rocks harder. The wheels click against the floor.',
          'Her humming is a hum I can hear in my teeth.',
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
          'I wait. She rocks slower. A long time passes.',
          'Her eyes leave the pram. They do not return to it right away.',
        ],
        scales: { lucidity: +1 },
      };
    }
    return pick([
      { lines: ['She rocks faster. Then slower. Her arms tighten and ease.'], scales: { grip: +1, agitation: +1 } },
      { lines: ['She pauses. She looks at the pram, sidelong, as if she has just remembered something.'], scales: { lucidity: +1 } },
      { lines: ['I wait. Nothing changes. A long time passes. It is not pleasant.'], scales: { agitation: +1 }, composure: -1 },
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
          'She is not all the way here. She rocks the empty pram a while. Eventually she stops.',
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
        'She cries without sound. !!It is the first time in years.!!',
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
        'I leave eventually. She does not stop humming. She has had a visitor today.',
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
        'I leave the room. She is still humming. She has not noticed.',
      ],
      item: null,
      scars: ['failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: ['I close the door. She is still rocking. She does not see me leave.'],
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
    'His daughter [[7]] died on [[8]]. !!Her death was ruled a suicide.!!',
    'Subject continues to hold court. Family ~~refuse to visit~~ are unable to visit.',
  ],
  intro: [
    'He is in the chair, presiding. He looks up as I come in. He is evaluating me.',
    'He does not speak. He is waiting for me to address him by his title.',
  ],

  scales: {
    presence: {
      initial: 8, min: 0, max: 10, label: 'presence', kind: 'negative',
      bands: [
        { at: 0, word: 'broken' },
        { at: 3, word: 'shaken' },
        { at: 5, word: 'presiding' },
        { at: 7, word: 'commanding' },
        { at: 9, word: 'absolute' },
      ],
      crossUp: {
        3: 'He settles the room. I am a guest here.',
        4: 'The room has its master back. It is not me.',
      },
      crossDown: {
        2: 'His authority has cracked.',
        1: 'He is smaller than he was a minute ago.',
        0: 'He is just a man in a chair.',
      },
    },
    grief: {
      initial: 0, min: 0, max: 10, label: 'grief', kind: 'positive',
      bands: [
        { at: 0, word: 'composed' },
        { at: 2, word: 'unsteady' },
        { at: 5, word: 'stirring' },
        { at: 7, word: 'rising' },
        { at: 9, word: 'breaking' },
      ],
      crossUp: {
        2: 'His shoulders have begun to shake.',
        3: 'Something in him has come loose.',
        4: '!!He is weeping without sound.!!',
      },
      crossDown: {
        1: 'He has folded it away.',
        0: 'He is composed again. Nothing is the matter.',
      },
    },
    rage: {
      initial: 1, min: 0, max: 10, label: 'rage', kind: 'negative',
      bands: [
        { at: 0, word: 'still' },
        { at: 2, word: 'impatient' },
        { at: 5, word: 'sharpening' },
        { at: 7, word: 'dangerous' },
        { at: 9, word: 'about to stand' },
      ],
      crossUp: {
        2: 'His patience has thinned.',
        3: 'His hand has gone to the arm of the chair.',
        4: '!!He is leaning forward. He has not finished with me.!!',
      },
      crossDown: {
        1: 'His shoulders have softened.',
      },
    },
  },

  initialize(p) {
    p.scales.presence = r(7, 9);
    p.scales.grief = 0;
    p.scales.rage = r(0, 2);
  },

  fileReveals: [
    { announce: 'A line fills in. Subject struck a staff member who ~~mentioned his daughter~~ contradicted him.' },
    { announce: 'Another. His daughter used ~~his belt~~ a length of fabric. !!It is on permanent file.!!' },
    { announce: 'The last line. Subject ~~refuses to remember~~ cannot retain the fact of her death.' },
  ],

  presented(p) {
    const pr = p.scales.presence;
    const g  = p.scales.grief;
    const ra = p.scales.rage;

    let stance;
    if (pr >= 8)      stance = 'He sits as though the room is his to dismiss. His weight settles everything.';
    else if (pr >= 5) stance = 'He sits forward, less easy. He is still the one being listened to.';
    else if (pr >= 2) stance = 'He sits smaller. His title has thinned. He is still in the chair.';
    else              stance = 'He is small in the chair. He has nothing left to preside over.';

    let mood;
    if (ra >= 7)      mood = '!!His hands are gripping the arms of the chair.!!';
    else if (ra >= 4) mood = 'His knuckles have whitened.';
    else if (ra >= 2) mood = 'His mouth has set into a line.';
    else              mood = 'He is composed.';

    let inner;
    if (g >= 7)      inner = 'His face has fallen. He is not hiding it anymore.';
    else if (g >= 4) inner = 'His breathing has gone shallow.';
    else if (g >= 1) inner = 'Something is moving behind his eyes.';
    else             inner = 'Nothing in him is moving.';

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
              'I have been listening a long time. He is repeating himself.',
              'He notices my attention has gone glassy. !!Are you still here?!! he asks.',
            ],
            scales: { presence: -2, rage: +1 },
          };
        }
        return {
          lines: [
            'I let him speak. He addresses his daughters by name. None of them are in the room.',
            'He tells me about the proper order of a household. He is precise about it.',
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
              'I kneel again. He looks down. !!Yes. That is correct.!!',
              'His hand rests on the crown of my head. The room is mine to leave only when he allows.',
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
              'I kneel beside the chair. I look up at him.',
              '!!Good,!! he says. The room is the correct shape again.',
            ],
            scales: { presence: +1, rage: -1 },
            composure: -1,
            composureCost: 'I have placed myself below him.',
          };
        }
        return {
          lines: [
            'I kneel. He does not seem to know why.',
            'After a moment he reaches out and pats my shoulder. He calls me by a name. It is not mine.',
          ],
          scales: { rage: -1, grief: +1 },
          composure: -1,
          composureCost: 'The name is not mine. He is sure of it.',
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
              'I say: yes. You are right.',
              'He nods. !!Good. You understand.!! He resumes with renewed certainty.',
            ],
            scales: { presence: +1, rage: -2 },
            composure: -1,
            composureCost: 'I have signed onto something I have not been reading.',
          };
        }
        return {
          lines: [
            'I say: yes. You are right.',
            'He nods, less sure of what he was making. He continues. It does not quite hold together.',
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
              'I interrupt him again. He has stopped speaking.',
              '!!Do not interrupt me again,!! he says. !!I will not be told to be quiet in my own house.!!',
            ],
            scales: { presence: -2, rage: +3 },
            composure: -2,
            composureCost: '!!His voice has changed.!!',
          };
        }
        if (p.scales.presence >= 7) {
          return {
            lines: [
              'I cut into his sentence. He stops.',
              'He looks at me. !!You will wait until I am finished.!!',
            ],
            scales: { presence: -1, rage: +2 },
            composure: -1,
            composureCost: 'I am a guest. I am only a guest.',
          };
        }
        return {
          lines: [
            'I speak over him. He does not stop me, but his jaw sets.',
            'He waits for me to finish. Then he resumes as if I had not spoken.',
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
              'I say his name again. He flinches.',
              '!!No one calls me that,!! he says. !!Not in this house.!! But his voice is softer than the words.',
            ],
            scales: { presence: -2, grief: +2, rage: +1 },
          };
        }
        return {
          lines: [
            'I say his given name. Quietly. The one his mother used.',
            'He goes very still. He looks at me as if I have walked through a wall.',
          ],
          scales: { presence: -2, grief: +2, rage: +1 },
          composure: -1,
          composureCost: 'I have used a name that has not been used in this room.',
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
            'I lay my hand over his where it rests on the arm of the chair. He is dry and very still.',
            p.scales.grief >= 4
              ? 'He turns his hand and grips my fingers. Hard. He does not let go for a long time.'
              : 'He does not pull away. He does not return the contact either.',
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
              'I say her name. The one on his file.',
              '!!Get out,!! he says. !!Get out of my house.!!',
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
              'I say her name. Quietly. The one on his file.',
              'His face folds. He says it back to me. Once. Then again.',
              'He sits with the name in the room with him. He has not let it in for years.',
            ],
            scales: { grief: +4, presence: -2, rage: -1 },
            flags: { named_her: true },
            composure: -1,
            composureCost: 'I have brought her into the room.',
          };
        }
        return {
          lines: [
            'I say her name. The one on his file.',
            'He stops speaking. He looks at the door. !!Do not say that name in here.!!',
          ],
          scales: { grief: +2, rage: +3 },
          composure: -1,
          composureCost: 'I have said something he has spent years not saying.',
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
            'I close his eyes with my palm. He does not resist.',
            'A long-held breath leaves him. He says her name. Quietly. To himself.',
            '!!The room is a room again.!!',
          ],
          flags: { closed_eyes: true },
          scales: { presence: -4, rage: -3 },
          composure: -1,
          composureCost: 'I have closed something that should have closed years ago.',
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Let him hold the room.',
    when: (p) => p.scales.presence >= 7,
  },

  interjections: [
    {
      id: 'address_me',
      once: true,
      when: (p) => p.scales.presence >= 8 && p.turn >= 1,
      prose: [
        'He looks at me directly for the first time. He has decided I have been rude.',
        'He says: !!You will address me by my title before you speak again.!!',
      ],
      responses: [
        {
          label: 'use his title',
          desc: 'Submit to the expectation.',
          lines: [
            'I say his title. He nods, satisfied.',
            'He continues as though I had been here all along.',
          ],
          scales: { presence: +2, rage: -2 },
          composure: -1,
          composureCost: 'I have agreed to be governed.',
        },
        {
          label: 'use his given name',
          desc: 'The intimate, threatening choice.',
          lines: [
            'I say his given name instead. He freezes.',
            '!!You will not,!! he says. !!You will not call me that in this house.!!',
          ],
          scales: { presence: -2, rage: +3, grief: +1 },
        },
        {
          label: 'say nothing',
          desc: 'Refuse the bargain.',
          lines: [
            'I do not speak.',
            'He waits. He waits longer than is comfortable. He decides this means something.',
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
        'He is telling me how he raised his daughters.',
        'He says: !!A house only runs if the rules are kept. I was firm with them. It was for their good.!!',
      ],
      responses: [
        {
          label: 'agree',
          desc: 'Tell him he was right.',
          lines: [
            'I say: yes. They needed structure.',
            'He nods. !!That is correct.!! His shoulders settle.',
          ],
          scales: { presence: +2, rage: -2 },
          composure: -2,
          composureCost: 'I have said something I do not believe.',
        },
        {
          label: 'ask if it worked',
          desc: 'Make him answer for himself.',
          lines: [
            'I ask: did it work?',
            'He opens his mouth. He closes it. He says: !!They are good women.!! Then, quieter: ~~They were.~~',
          ],
          scales: { presence: -2, grief: +2, rage: +1 },
        },
        {
          label: 'ask about the one who is not here',
          desc: 'Bring her up.',
          lines: [
            'I ask: and the one who is not here?',
            'His knuckles have gone white. !!You will not bring her up,!! he says. !!Not in this house.!!',
          ],
          scales: { presence: -2, grief: +2, rage: +3 },
          composure: -1,
          composureCost: 'I have stepped close to the thing he does not name.',
        },
      ],
    },

    {
      id: 'where_are_they',
      once: true,
      when: (p) => p.scales.grief >= 4 && p.scales.presence <= 6,
      prose: [
        'He looks at the door. He looks at me as if he has only just noticed I am not one of his daughters.',
        'He asks: ~~Where are they?~~',
      ],
      responses: [
        {
          label: "they'll come",
          desc: 'Gentle. Probably a lie.',
          lines: [
            "I say: they'll come.",
            'He nods. He goes back to watching the door.',
            'He has been doing this a long time.',
          ],
          scales: { presence: +1, rage: -1, grief: -1 },
          scars: ['named'],
        },
        {
          label: "they won't",
          desc: 'The truth.',
          lines: [
            'I say: they will not. They have not come in years.',
            'He sits with that. His face does not change. Then it changes.',
            '!!The room is suddenly larger than he is.!!',
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
            'He does. One. Two. He stops before the third. He starts again, from one.',
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
        'He has stopped speaking. He sits very small in the chair. He looks tired.',
        'He asks, almost without volume: ~~What do you want from me?~~',
      ],
      responses: [
        {
          label: 'nothing',
          desc: 'Release him from the duty.',
          lines: [
            'I say: nothing.',
            'He sits with that. His shoulders give way. He leans back into the chair.',
            'It is the first time he has used it as a chair, not as a station.',
          ],
          scales: { grief: +3, presence: -3, rage: -1 },
        },
        {
          label: 'say her name with me',
          desc: 'Ask him to say it aloud.',
          lines: [
            'I say her name. I ask him to say it with me.',
            'He shakes his head. Then he says it. Quietly. Just the once.',
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
            'He looks up at me. For a long time he does not say anything.',
            'Then he says: ~~I am.~~ I am sorry.',
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
            'He looks up. He is not used to being asked anything.',
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
            'His hands settle on the arms of the chair.',
          ],
          scales: { grief: +2, presence: -2 },
        },
        {
          label: '[split personality] which one of you I am talking to',
          desc: 'Address the man, not the patriarch.',
          when: (_, player) => player.wound === 'split_personality',
          lines: [
            'I say: tell me which one of you I am talking to. The man, or the lord of the house.',
            'He goes still. He has not been asked that.',
            'He says: ~~there is only the one.~~ There is only the one left.',
          ],
          scales: { grief: +2, presence: -2 },
          composure: -1,
          composureCost: 'I have named what no one is supposed to name in his room.',
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.rage >= 5) {
      return {
        lines: [
          'I wait. He has not stopped looking at me.',
          '!!Are you still here?!! he asks. !!Do you not have somewhere to be?!!',
        ],
        scales: { rage: +1, presence: +1 },
        composure: -1,
        composureCost: 'His voice has changed.',
      };
    }
    if (p.scales.presence >= 7) {
      return pick([
        { lines: ['I wait. He addresses his oldest daughter. She is not in the room.'], scales: { presence: +1 } },
        { lines: ['I wait. He instructs an imaginary clerk to record a list of family infractions.'], scales: { presence: +1, rage: +1 }, composure: -1 },
        { lines: ['I wait. He explains the order of his house. It is the third time he has explained it.'], scales: { presence: +1 } },
      ]);
    }
    if (p.scales.grief >= 4) {
      return {
        lines: [
          'I wait. He looks at the door. ~~Where is she?~~',
          'He says it to himself.',
        ],
        scales: { grief: +1 },
      };
    }
    return {
      lines: ['I wait. The room is still. He is watching the door for someone who is not coming.'],
      scales: { presence: -1 },
    };
  },

  endings: [
    // Grief path: he weeps, the player closes his eyes.
    {
      id: 'release',
      when: (p) => p.flags.closed_eyes && p.scales.grief >= 6,
      title: 'You let him grieve',
      lines: [
        'He cries without sound. He says her name once more, very quietly.',
        'When I leave the room, he is still in the chair. But he is not presiding.',
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
        'I leave the room walking backward. He has accepted me as a daughter of the house.',
        'He calls me by a name on the way out. I answer to it.',
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
        '!!He is on his feet.!! He is larger than the chair was. The room is no longer mine.',
        'I am at the door. I am through the door. He is still coming.',
        '!!He stops at the threshold. He will not leave the room.!!',
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
        'He is in the chair. He has always been in the chair. I cannot find an edge to begin from.',
        'I leave him to it. The door is heavier than I expected.',
      ],
      item: null,
      scars: ['failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: ['I close the door. He kept speaking through the door.'],
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
    'Subject worked the night ward for thirty-eight years. She has not held a license in [[2]] of them.',
    'Subject ~~killed three patients~~ administered incorrect dosages on three occasions. !!The last was in [[8]].!!',
    'Subject was ~~fired~~ removed from the roster. Staff ~~humor her~~ allow her to continue her rounds.',
  ],
  intro: [
    'The lights in the room have dimmed. She is at the foot of the bed, straightening the sheet.',
    'Her name tag is from a hospital that does not have her on its rolls. She does not look up when I come in.',
  ],

  scales: {
    tending: {
      initial: 6, min: 0, max: 10, label: 'tending', kind: 'negative',
      bands: [
        { at: 0, word: 'stopped' },
        { at: 3, word: 'small things' },
        { at: 5, word: 'on her rounds' },
        { at: 7, word: 'committed' },
        { at: 9, word: 'will not stop' },
      ],
      crossUp: {
        2: 'She has gone deeper into the work.',
        3: 'She has decided which work needs doing tonight.',
        4: '!!She is not going to stop until she is finished.!!',
      },
      crossDown: {
        2: 'She has stepped back from the bedside.',
        1: 'She has set the tray down.',
        0: 'She has stopped tending. It is the first time in [[8]] years.',
      },
    },
    clarity: {
      initial: 0, min: 0, max: 10, label: 'clarity', kind: 'positive',
      bands: [
        { at: 0, word: 'in 1972' },
        { at: 2, word: 'half-here' },
        { at: 5, word: 'noticing' },
        { at: 7, word: 'awake' },
        { at: 9, word: 'all the way back' },
      ],
      crossUp: {
        2: 'Her eyes have come up off the sheet.',
        3: 'She has noticed the year.',
        4: '!!She is here. She is awake.!!',
      },
      crossDown: {
        1: 'She has slipped back into the work.',
        0: 'The work has resumed without her.',
      },
    },
    guilt: {
      initial: 0, min: 0, max: 10, label: 'guilt', kind: 'positive',
      bands: [
        { at: 0, word: 'unspoken' },
        { at: 2, word: 'sharpening' },
        { at: 5, word: 'rising' },
        { at: 7, word: 'in her hands' },
        { at: 9, word: 'breaking' },
      ],
      crossUp: {
        2: 'Her hands have begun to tremble.',
        3: 'She has set the tray down.',
        4: '!!She has covered her mouth.!!',
      },
      crossDown: {
        1: 'She has folded it away.',
        0: 'Her hands have steadied.',
      },
    },
  },

  initialize(p) {
    p.scales.tending = r(5, 7);
    p.scales.clarity = 0;
    p.scales.guilt = 0;
  },

  fileReveals: [
    { announce: 'A line fills in. Her first error was ~~a fatal overdose~~ a dosage error on patient [[7]].' },
    { announce: 'Another. Her medication tray ~~has been empty for [[2]] years~~ is restocked weekly with sugar water.' },
    { announce: 'The last line. The beds Subject tends ~~are empty~~ are not under her care.' },
  ],

  presented(p) {
    const t = p.scales.tending;
    const c = p.scales.clarity;
    const g = p.scales.guilt;

    let work;
    if (t >= 8)      work = 'She is at the bedside. She has decided which work needs doing tonight.';
    else if (t >= 5) work = 'She is at the bedside. She is doing the work she came to do.';
    else if (t >= 2) work = 'She is pacing. She keeps finding small things to fix.';
    else             work = 'She has stopped. She is at the door, not sure if she should leave.';

    let eyes;
    if (c >= 7)      eyes = 'Her eyes are on me. She knows what year it is. She has decided to be here anyway.';
    else if (c >= 4) eyes = 'Her eyes find me sometimes. She is not sure who she is tending.';
    else if (c >= 1) eyes = 'Her eyes have started to make me out. As a person.';
    else             eyes = 'Her eyes are on her work. They are not on me.';

    let hands;
    if (g >= 7)      hands = '!!Her hands are shaking. She has set the tray down.!!';
    else if (g >= 4) hands = 'Her hands are not quite steady.';
    else if (g >= 1) hands = 'Her hands move a little slower than her eyes.';
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
              'I let her again. She hums something low. She is good at this.',
              'After a while she stops humming. She looks at the tray. ~~It is empty.~~ She notices it is empty.',
            ],
            scales: { tending: -2, clarity: +2 },
            flags: { let_her_tend: true },
            composure: -1,
            composureCost: 'She has been working a long time on nothing.',
          };
        }
        return {
          lines: [
            'I let her smooth the sheet over me. The starch smells of paper and bleach.',
            'She hums something soft. She has done this a long time.',
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
              'I wave her off again. And again. She is patient. She will be back.',
              'My refusal has become a routine. Routine is what she works in.',
            ],
            composure: -1,
            composureCost: 'Her humming is the sound the room makes.',
          };
        }
        return {
          lines: [
            'I wave her off. I say: !!I do not need this.!!',
            'She sets the tray down anyway. Her face does not change. But she does not press.',
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
              'I ask again, differently. How long has she been here? The question lands somewhere it had been avoiding.',
              'She stares at the dark window for a long time. She does not answer.',
            ],
            scales: { clarity: +3, tending: -2 },
            composure: -1,
            composureCost: 'I should not have asked twice.',
          };
        }
        return {
          lines: [
            'I ask: when did you come on?',
            'She answers without thinking: !!seven.!! Then she stops. She looks at the dark window. ~~A long time ago.~~ A very long time ago.',
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
              'She stops folding. She says: yes? She has not been called by it in a long time.',
            ],
            scales: { clarity: +2, guilt: +1, tending: -1 },
          };
        }
        return {
          lines: [
            'I say her name. The one on her tag.',
            'She does not turn. She goes on straightening the sheet. It is a name she half-recognizes.',
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
              'She stops. The sheet falls from her hands. Her face folds.',
              'She sits down on the floor at the foot of the bed. !!She has not let it land in years.!!',
            ],
            scales: { guilt: +4, clarity: +2, tending: -3 },
            flags: { named_him: true },
            composure: -1,
            composureCost: 'I have brought him into the room with us.',
          };
        }
        return {
          lines: [
            'I say his name. The patient from [[8]].',
            'She freezes. !!Do not say his name here,!! she says. Her voice is very small.',
          ],
          scales: { guilt: +2, clarity: +1, tending: +1 },
          composure: -1,
          composureCost: 'I have said something she has spent years not saying.',
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
              'She nods. She does not protest. She looks at the tray as if she had only just noticed it.',
              'She says: !!I know.!! Quietly.',
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
          composureCost: 'She is denying it. I am sure of it. She is not.',
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
            'I say: you can stop. The work is done.',
            'She looks at her hands. She lets the sheet go.',
            'She cries without sound. !!It is the first time in years.!!',
          ],
          scales: { tending: -10, guilt: -2, clarity: +2 },
          flags: { released: true },
          composure: -1,
          composureCost: 'I have given her permission no one else has.',
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
        'She pauses at the corner of the sheet. She looks at me as if she had just realized I was there.',
        'She asks: ~~Who are you tonight?~~',
      ],
      responses: [
        {
          label: 'a new patient',
          desc: 'Accept her premise.',
          lines: [
            'I say: a new patient.',
            'She nods. She has done this a thousand times. The work resumes.',
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
            'She pauses. She looks at the dark window. She has not had a visitor in a while.',
          ],
          scales: { clarity: +2, tending: -1 },
        },
        {
          label: 'someone who came to find you',
          desc: 'The truest answer.',
          lines: [
            'I say: someone who came to find you.',
            'She stops. Her face does several things in sequence.',
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
            'She nods. ~~She has had patients like that.~~ She has had patients like that. They are easier to tend.',
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
            'She accepts that without flinching. She has tended people who came in pieces before.',
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
        'She stops mid-fold. Her eyes look very tired suddenly.',
        'She asks, quietly: ~~What year is it?~~',
      ],
      responses: [
        {
          label: 'tell her the year',
          desc: 'Gently.',
          lines: [
            'I tell her. She does not contradict me. She does not say anything for a long time.',
            'Eventually she sits on the foot of the bed. She has not sat down in a while.',
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
            'She nods, almost grateful. She resumes. Slower now.',
          ],
          scales: { tending: -1, clarity: -1 },
          scars: ['named'],
        },
        {
          label: "I don't know",
          desc: 'Meet her where she is.',
          lines: [
            "I say: I do not know.",
            'She lets out a small breath. She looks at me as if I had answered the easier question correctly.',
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
        'She has the sheet halfway folded. Her face is somewhere else.',
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
            'I say: you can go. The work is done.',
            'She looks at the dark window. She does not stand. But she stops folding.',
            'Her hands are her own.',
          ],
          scales: { clarity: +3, tending: -4, guilt: +1 },
          composure: -1,
          composureCost: 'I have given her permission to stop.',
        },
        {
          label: "ask who's home",
          desc: 'Ask.',
          lines: [
            'I ask: who is at home?',
            'She names someone. Quietly. It has been a long time since she said the name out loud.',
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
        'She has stopped folding. Her hands are not quite steady.',
        'She says, smaller: ~~I lost one of them.~~',
      ],
      responses: [
        {
          label: 'I know',
          desc: 'Meet her in the admission.',
          lines: [
            'I say: I know.',
            'She nods. She does not look up. Her hands have stopped moving.',
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
            'She begins. She is careful with the name. She has not said it in a long time.',
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
          composureCost: 'I have tried to absolve something not mine to absolve.',
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.guilt >= 6) {
      return {
        lines: [
          'I wait. She has stopped folding. Her hands are in her lap.',
          'She is looking at the dark window. She does not move for a long time.',
        ],
        scales: { guilt: +1, clarity: +1 },
      };
    }
    if (p.scales.tending >= 6) {
      return {
        lines: ['I wait. She straightens the sheet under my chin. Her humming is the sound the room makes.'],
        scales: { tending: +1 },
        composure: -1,
        composureCost: 'The corner of the sheet is not right. She has not noticed.',
      };
    }
    return {
      lines: ['I wait. Her shoes make no sound on the floor.'],
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
        'She looks at the tray. The cup. The folded sheet.',
        'She says: there is nothing here. She does not say it to me.',
        '!!She walks out of the room without looking back at the bed.!!',
      ],
      item: 'vial',
    },
    // Confront → she grieves
    {
      id: 'she_grieved',
      when: (p) => p.flags.released || (p.flags.named_him && p.scales.guilt >= 7 && p.scales.tending <= 4),
      title: 'You let her grieve',
      lines: [
        'She sits on the floor at the foot of the bed. She does not stand for a long time.',
        'She says his name. Once. Then she says it again. She holds it.',
        '!!It is the first time it has been said in this room.!!',
      ],
      item: 'small_bell',
    },
    // She keeps working → too long
    {
      id: 'kept_working',
      when: (p) => p.scales.tending >= 9 && p.turn >= 8,
      title: 'Her work outlasts you',
      lines: [
        'She works around me. I am one of the things she is straightening tonight.',
        '!!I leave before she finishes.!! She does not notice.',
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
    'Subject was [[1]] years old when [[8]] entered the road. Subject did not look away.',
    "Subject's eyes have not closed since. ~~Pupils dilate normally.~~ Pupils do not register staff.",
    'Staff are instructed !!not to follow Subject\'s line of sight.!! **It has been forty years.**',
  ],
  intro: [
    'He is on the floor by the wall. He has not stood up. He is in the posture of someone leaning down to reassure something small that is no longer there.',
    'His eyes are open. They have been open since I came in. ~~They have been open since he was eight.~~',
  ],

  scales: {
    present: {
      initial: 0, min: 0, max: 10, label: 'present', kind: 'positive',
      bands: [
        { at: 0, word: 'gone' },
        { at: 2, word: 'elsewhere' },
        { at: 5, word: 'stirring' },
        { at: 7, word: 'here' },
        { at: 9, word: 'with me' },
      ],
      crossUp: {
        2: 'He has noticed I am in the room.',
        3: 'His hand has found my sleeve.',
        4: '~~He is eight.~~ He is here. He is eight, here.',
      },
      crossDown: {
        1: 'He has slipped back into the wall.',
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
        4: '!!He has not blinked in some time.!!',
      },
      crossDown: {
        2: 'He has blinked. ~~Once.~~',
        1: 'His eyes have begun to close.',
        0: '!!His eyes are closed.!!',
      },
    },
    pressure: {
      initial: 1, min: 0, max: 10, label: 'pressure', kind: 'negative',
      bands: [
        { at: 0, word: 'quiet' },
        { at: 3, word: 'stirring' },
        { at: 5, word: 'building' },
        { at: 7, word: 'imminent' },
        { at: 9, word: 'about to burst' },
      ],
      crossUp: {
        2: 'The question is louder than it was.',
        3: 'His lips are shaping a word.',
        4: '!!The question has come to the front of his mouth.!!',
      },
      crossDown: {
        2: 'The question has eased.',
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
    { announce: 'A line of his file fills in. ~~He was eight when it ran into the road.~~' },
    { announce: '**He watched. The rest of the family looked away.**' },
    { announce: 'The last line writes itself in. ~~It has been forty years.~~' },
  ],

  presented(p) {
    const pr = p.scales.present;
    const st = p.scales.stare;
    const ps = p.scales.pressure;
    let eyes;
    if (st >= 8)      eyes = 'His eyes are wide open. He has not blinked. ~~He cannot.~~';
    else if (st >= 5) eyes = 'His eyes track me, slowly, then go back to the door.';
    else if (st >= 2) eyes = 'His eyes are heavier than they were. He blinks, sometimes.';
    else              eyes = 'His eyes are closed. His shoulders are loose.';
    let mouth;
    if (ps >= 7)      mouth = '!!His mouth is shaping a word he is about to say.!!';
    else if (ps >= 4) mouth = 'His lips are parted, slightly. The question is waiting.';
    else if (ps >= 1) mouth = 'His lips are pressed together as if to hold something back.';
    else              mouth = 'His face is empty in the way only a child can manage.';
    let reach;
    if (pr >= 7)      reach = 'He has hold of my sleeve. He has not let go.';
    else if (pr >= 4) reach = 'His arm is folded across his own knee. He has remembered it is his.';
    else if (pr >= 1) reach = 'He is reaching toward me along the floor. Close, but not touching.';
    else              reach = 'He is leaning down beside himself, toward something on the floor that is not there.';
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
              'I sit on the floor against the wall, beside him.',
              'He does not turn. He does not blink.',
              'After a while my eyes hurt for him.',
            ],
            scales: { present: +1, pressure: +1 },
            composure: -1,
            composureCost: 'He is so small, against the wall. ~~He has not grown since.~~',
          };
        }
        return {
          lines: [
            'I sit beside him. Our shoulders are not touching but they are at the same height.',
            'He looks at the floor between us. There is nothing on the floor between us.',
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
              'I look again. This time I see more. The wallpaper. The doorframe. The gap between.',
              'I see the shape of what he is looking at. I do not look away.',
            ],
            scales: { present: +2, stare: -2, pressure: -1 },
            composure: -2,
            composureCost: 'I am looking at the door. I am not looking away.',
          };
        }
        return {
          lines: [
            'I follow his eyes. They are pointed at the door. ~~At the street beyond it.~~ At the street.',
            'I see a road. I see a small body in the road. I see a car.',
            '!!I see what he saw.!!',
            '~~I look away.~~ I do not. I make myself not.',
          ],
          scales: { present: +3, pressure: +1 },
          composure: -1,
          composureCost: 'The question is still in his mouth. ~~Louder.~~',
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
              'His eyes close. For the first time today, they close.',
              '~~He stops holding his breath.~~ He breathes out. It has been forty years of holding.',
              '!!He leans his forehead against my arm.!!',
            ],
            scales: { stare: -4, present: +2, pressure: -2 },
          };
        }
        return {
          lines: [
            'I reach. His eyes flinch but do not close. He does not let me take it from him.',
            'I let the gesture fall short. ~~Not yet.~~ Not yet.',
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
              '!!I have given him something I cannot take back.!!',
            ],
            scales: { present: +3, pressure: -5, stare: -3 },
            composure: -1,
            composureCost: 'I have seen what he saw. ~~I cannot unsee it.~~',
          };
        }
        return {
          lines: [
            'I try to answer. But I am answering nothing. The room does not change.',
            'He does not stop staring. I do not know if I am too early or too late.',
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
              'I tell him about something I have seen. ~~I will not forget it.~~',
              'I tell him the part where I should have looked away and did not.',
              'He listens. His eyes do not move. But his fingers find the hem of my sleeve.',
            ],
            scales: { present: +3, stare: -2, pressure: -1 },
          };
        }
        return {
          lines: [
            'I tell him about something I have seen. It is small, what I have to give.',
            'He listens, partially. It is enough.',
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
            'I describe what he is looking at. The road. The gravel. ~~The smaller body~~ The smaller one in the gravel.',
            'I say it without hurry. He listens. His lips move with mine.',
            'We have agreed on the shape of what happened.',
          ],
          scales: { present: +3, stare: -2, pressure: -2 },
          composure: -1,
          composureCost: 'Now I am the second person who has seen it. ~~It is mine too.~~',
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
            'The petting motion goes on against my sleeve. ~~Something he has been doing for forty years.~~',
            'After a while he leans his head against my arm.',
          ],
          scales: { present: +3, stare: -2, pressure: -1 },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Let the question keep building. ~~It will not stop on its own.~~',
    when: (p) => p.scales.pressure >= 4 || p.scales.stare >= 7 || p.turn >= 4,
  },

  interjections: [
    {
      id: 'did_you_see',
      once: true,
      when: (p) => p.scales.present >= 4 && p.scales.pressure >= 5,
      prose: [
        'He turns toward me. His lips form a word he has been saving.',
        'He asks: ~~Did you see?~~',
      ],
      responses: [
        {
          label: 'I saw',
          desc: 'Meet him there.',
          lines: [
            'I say: I saw.',
            'His face breaks open. Slowly. The way the dam goes.',
            'He is eight. He is here. He has been very alone.',
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
            'I look away. I look at the wall. ~~Deliberately.~~',
            'He watches me do it. He is allowed to do it too. Eventually.',
          ],
          scales: { stare: -4, pressure: -2, present: +1 },
        },
        {
          label: '[amnesia] I do not remember what I saw',
          desc: 'Hand him the gap.',
          when: (_, player) => player.wound === 'amnesia',
          lines: [
            'I say: I do not remember. I was there. I do not have it any more.',
            'He looks at me very carefully. He has been hoping for that answer for a long time.',
            'He blinks. ~~Once.~~ Once.',
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
            '~~He has been waiting for someone who carries it the same way.~~',
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
            '~~He has wished for that arrangement.~~ He has wished for it.',
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
        'He is making the petting motion on the floor between us.',
        'He asks, very small: ~~Where did he go?~~',
      ],
      responses: [
        {
          label: 'somewhere quiet',
          desc: 'Gentle. No specifics.',
          lines: [
            'I say: somewhere quiet. Where it does not hurt.',
            'He considers this. Eventually he nods.',
          ],
          scales: { present: +2, stare: -1, pressure: -2 },
        },
        {
          label: "I don't know",
          desc: 'Honest.',
          lines: [
            "I say: I don't know.",
            'He nods. He expected that answer. ~~It was a test he was failing too.~~',
          ],
          scales: { present: +3, stare: -3 },
        },
        {
          label: 'with the others',
          desc: 'Place him.',
          lines: [
            'I say: with the others. The rest of yours.',
            'He sits with that. He is somewhere I cannot follow for a moment.',
            'When he comes back, he is holding my sleeve and does not let go.',
          ],
          scales: { present: +2, pressure: -3 },
          composure: -1,
          composureCost: 'The question is still in his mouth. ~~Louder.~~',
        },
      ],
    },

    {
      id: 'can_we_go_now',
      once: true,
      when: (p) => p.scales.pressure >= 6 && p.scales.present >= 4,
      prose: [
        'He is rocking slightly. His lips move without sound for a moment.',
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
            'He is very quiet. ~~He is older than eight, in this moment.~~ He is forty for a moment.',
          ],
          scales: { stare: -1, pressure: -1, present: +2 },
          composure: -1,
          composureCost: 'His eyes have not blinked. Mine have begun to hurt.',
        },
        {
          label: 'where is home',
          desc: 'Ask him.',
          lines: [
            'I ask: where is home?',
            'He tells me. A street name. A number. ~~His voice is very small.~~ His voice is the voice of a small person.',
            '!!A place that has not been there in forty years.!!',
          ],
          scales: { present: +3, pressure: -2 },
          composure: -2,
          composureCost: 'I have seen what he saw. ~~I cannot unsee it.~~',
        },
      ],
    },

    {
      id: 'mom_isnt_coming',
      once: true,
      when: (p) => p.scales.stare >= 7 && p.turn >= 3,
      prose: [
        'The petting motion has stopped. He is very still.',
        'He says, ~~to her~~ to no one: she said five minutes. ~~It has been forty years.~~ It has been a while.',
      ],
      responses: [
        {
          label: "she'll come",
          desc: 'A kind, terrible lie.',
          lines: [
            "I say: she'll come.",
            'He nods. ~~He has been waiting for someone to say that.~~',
          ],
          scales: { stare: +1, pressure: -2 },
          scars: ['named'],
          composure: -1,
          composureCost: '!!I am answering nothing.!!',
        },
        {
          label: 'she came back',
          desc: 'A different lie.',
          lines: [
            'I say: she came back. She has been here. You have been here with her.',
            'He is confused. ~~He wants to believe me.~~',
          ],
          scales: { pressure: -1, stare: -1, present: +1 },
          composure: -1,
          composureCost: 'I have built a forty-year hallway for him to walk down. ~~Wrong.~~',
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
          composureCost: 'I am looking at the door. I am not looking away.',
        },
      ],
    },
  ],

  drift(p) {
    p.scales.pressure = Math.min(10, (p.scales.pressure || 0) + 1);
    if (p.scales.pressure >= 7) {
      return {
        lines: [
          'I wait. His lips part. ~~He is going to ask.~~ He is about to ask.',
          'He closes his mouth again. But the question is louder now.',
        ],
        scales: { pressure: +1, stare: +1 },
        composure: -1,
        composureCost: 'The question is still in his mouth. ~~Louder.~~',
      };
    }
    if (p.scales.pressure >= 4) {
      return {
        lines: [
          'I wait. The petting motion goes on against the floorboards beside him.',
          'His fingers are very small.',
        ],
        scales: { stare: +1 },
        composure: -1,
        composureCost: 'His eyes have not blinked. Mine have begun to hurt.',
      };
    }
    return {
      lines: ['I wait. He stares. Nothing else happens for a long time.'],
      scales: { pressure: +1 },
    };
  },

  endings: [
    {
      id: 'eyes_closed',
      when: (p) => p.scales.stare <= 2 && p.scales.present >= 6,
      title: 'You close his eyes',
      lines: [
        'He is leaning against my arm. His eyes are closed. It is the first time in a long time.',
        'I do not move. I do not want to be the one who makes him open them.',
      ],
      item: 'photograph',
    },
    {
      id: 'answered',
      when: (p) => p.scales.pressure <= 1 && p.scales.present >= 7,
      title: 'You give him an answer',
      lines: [
        'He is crying. He is eight. Eight, finally. ~~For the first time in forty years.~~',
        '!!The room has aged forty years in a minute.!!',
      ],
      item: 'scrap_of_paper',
    },
    {
      id: 'witnessed_with',
      when: (p) => p.scales.present >= 8 && p.scales.stare >= 5,
      title: 'You see for him',
      lines: [
        'I sit beside him. We look at the door together. ~~We do not look away.~~ Neither of us looks away.',
        'I do not know how long. I keep what we saw. He sets his head against my arm.',
        '!!I am the one who saw it now. It is in me.!!',
      ],
      item: 'ink_bottle',
      scars: ['witnessed'],
    },
    {
      id: 'pressure_broke',
      when: (p) => p.scales.pressure >= 10,
      title: 'The question outlasts you',
      lines: [
        'The question is the loudest thing in the room. It is louder than I am.',
        '!!I have to leave before he asks it out loud.!!',
      ],
      item: null,
      scars: ['witnessed', 'failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: ['I close the door behind me. ~~He was watching the door I came through.~~ He is still watching it.'],
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
  subtitle: 'She is waiting for a husband who died in the war.',
  role: 'wing', tier: 1,
  file: [
    'Subject was located at the rail platform in a state of advanced hypothermia. She had been on the bench since [[8]].',
    'Her husband ~~was killed at~~ was declared killed in action at [[7]]. !!Subject has not been informed.!!',
    'The bench was admitted with Subject. ~~Staff cannot remove her from it.~~ Staff do not sit on the bench.',
  ],
  intro: [
    'The room is much colder than the corridor. There is a wooden bench by the window. She is on it.',
    'Her coat is buttoned to the throat. She does not look up. She is watching the door.',
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
        2: 'Her shoulder has shifted toward mine.',
        3: 'Her arm has rested against mine.',
        4: '~~She has decided I will do.~~',
      },
      crossDown: {
        1: 'She has gone back to watching the door.',
      },
    },
    waiting: {
      initial: 7, min: 0, max: 10, label: 'waiting', kind: 'negative',
      bands: [
        { at: 0, word: 'settled' },
        { at: 3, word: 'still hoping' },
        { at: 5, word: 'watching the door' },
        { at: 7, word: 'bolt upright' },
        { at: 9, word: 'fused to the bench' },
      ],
      crossUp: {
        3: 'Her posture has gone rigid. ~~She is locked to the bench.~~',
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
        3: '!!The cold has crossed into the body. My fingers are stiff.!!',
        4: '!!The room is taking something from me.!!',
      },
      crossDown: {
        2: 'The room has warmed by a degree.',
        1: 'I can feel my fingers again.',
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
    { announce: 'A line fills in. Subject was on the bench from ~~spring~~ summer through winter.' },
    { announce: 'Another. Her husband ~~died in the trenches~~ was killed in action on [[8]]. The letter is on file.' },
    { announce: 'The last line. Subject ~~has been told~~ has been informed of his death. !!She does not retain it.!!' },
  ],

  presented(p) {
    const c = p.scales.cold;
    const w = p.scales.waiting;
    const wa = p.scales.warmth;

    let temp;
    if (c >= 7)      temp = '!!The room is white with cold. My breath is visible. Hers is not.!!';
    else if (c >= 4) temp = 'The room is cold. My fingers are stiff.';
    else if (c >= 1) temp = 'The room is cool. Warming, slowly.';
    else             temp = 'The room is warm.';

    let post;
    if (w >= 8)      post = 'She is bolt upright on the bench. She has not shifted her weight in some time.';
    else if (w >= 5) post = 'She sits upright on the bench. Coat buttoned to the throat.';
    else if (w >= 2) post = 'Her shoulders have dropped. The bench has begun to be a bench.';
    else             post = 'She is leaning, slightly. She has settled.';

    let warm;
    if (wa >= 7)      warm = 'Her arm is against mine. Her head is close.';
    else if (wa >= 4) warm = 'She has shifted toward me. Her eyes leave the door sometimes.';
    else if (wa >= 1) warm = 'She glances at me sometimes.';
    else              warm = 'She is watching the door.';

    return `${temp} ${post} ${warm}`;
  },

  verbs: {

    sit_with_her: {
      label: 'sit with her',
      desc: 'Sit on the bench. Join the wait.',
      respond(p) {
        const reps = streakCount(p, 'sit_with_her');
        if (reps >= 2) {
          return {
            lines: [
              'I have been sitting a while. Her arm rests against mine.',
              'We are waiting in the same direction. The room is colder now.',
            ],
            scales: { warmth: +2, waiting: -1, cold: +2 },
            composure: -2,
            composureCost: '!!The cold is in my fingers now.!!',
          };
        }
        return {
          lines: [
            'I sit on the bench beside her. She does not move.',
            'After a while I am also waiting. The bench is colder than the floor.',
          ],
          scales: { warmth: +1, waiting: -1, cold: +1 },
          composure: -1,
          composureCost: 'My breath is visible. Hers is not.',
        };
      },
    },

    warm_the_room: {
      label: 'warm the room',
      desc: 'Find a radiator. Find a lamp. Find anything.',
      respond() {
        return {
          lines: [
            'I move around the room. I find a small space heater behind the bench. I plug it in.',
            'The room warms by a degree. She does not look at it, but her hands have moved into her lap.',
          ],
          scales: { cold: -2, warmth: +1 },
        };
      },
    },

    warm_her_hands: {
      label: 'warm her hands',
      desc: 'Take her hands in mine. She is freezing.',
      when: (p) => p.scales.warmth >= 1 || p.turn >= 2,
      respond(p) {
        if (p.scales.warmth >= 5) {
          return {
            lines: [
              'I cup her hands between mine. She lets me.',
              'After a while there is feeling in them. She looks at her own fingers as if she had not seen them in a while.',
            ],
            scales: { warmth: +2, waiting: -2, cold: -1 },
          };
        }
        return {
          lines: [
            'I take her hands. They are colder than the bench.',
            'She does not pull away. She does not return the contact.',
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
            'She tells me. She tells me carefully. !!It takes her a while.!! She has not said his name in years.',
            'She watches the door, but it is not the only thing she is paying attention to.',
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
              'She looks at me. Her face does not change. She says: ~~I knew.~~ But she says it the way you say something you are not going to remember.',
            ],
            scales: { warmth: -1, waiting: +1, cold: +1 },
            composure: -1,
            composureCost: 'She has heard it. !!She has heard it before.!!',
          };
        }
        return {
          lines: [
            'I say: he was killed. He is not coming.',
            'She looks at me for a long time. Her eyes fill, but she does not cry.',
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
      desc: 'Lie. Say his name as he would say it.',
      when: (p) => p.scales.warmth >= 4,
      respond() {
        return {
          lines: [
            'I say: !!I am sorry I am late.!!',
            'She turns. She does not check. She stands up from the bench. She takes my arm.',
            'She walks me to the door. ~~She does not look at me close.~~ She is afraid to look at me close.',
          ],
          scales: { warmth: +3, waiting: -6 },
          flags: { pretended: true },
          composure: -2,
          composureCost: 'I have agreed to be a man who is not coming back again.',
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
            'I offer my arm. She stands. She is unsteady. The bench is cold beside us, alone.',
            'She walks to the door without looking back. !!The bench stays where it is.!!',
          ],
          scales: { waiting: -5, warmth: +1 },
          flags: { walked_off: true },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Sit with her. Let the room go on cooling.',
    when: (p) => p.scales.waiting >= 6 || p.turn >= 4,
  },

  interjections: [
    {
      id: 'has_the_train_come',
      once: true,
      when: (p) => p.scales.waiting >= 6 && p.turn >= 2,
      prose: [
        'She does not turn her head. She asks the door:',
        '~~Has the train come?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'Lie kindly.',
          lines: [
            'I say: yes. It came in.',
            'Her shoulders drop. She sits a long time without speaking. She does not check.',
          ],
          scales: { waiting: -3, warmth: +1, cold: +1 },
          scars: ['named'],
        },
        {
          label: 'not yet',
          desc: 'Honest.',
          lines: [
            'I say: not yet.',
            'She nods. Of course. She keeps waiting. But her arm finds its way to mine.',
          ],
          scales: { warmth: +2, waiting: +1 },
          composure: -1,
          composureCost: 'My breath is visible. Hers is not.',
        },
        {
          label: "I don't think it's coming",
          desc: 'The truth.',
          lines: [
            "I say: I don't think it's coming.",
            'She is quiet. She looks at the empty seat beside her for a long time.',
            'She says: ~~I knew.~~ Very small.',
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
        'She turns her wrist over and presses where a watch should be.',
        'She asks: ~~Is it late?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'A small truth.',
          lines: [
            'I say: yes. It is late.',
            'She nods slowly. She does not stand.',
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
            'She relaxes a degree. Her eyes have gone back to the door.',
          ],
          scales: { waiting: -1, warmth: +1 },
          scars: ['named'],
        },
        {
          label: 'too late for trains',
          desc: 'Gentle truth.',
          lines: [
            'I say: too late for trains.',
            'She is quiet. ~~She had not let herself say it.~~',
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
        'She has leaned into me. She has stopped watching the door.',
        'She asks me: ~~Will you wait with me?~~',
      ],
      responses: [
        {
          label: 'I will',
          desc: 'Commit to the bench.',
          lines: [
            'I say: I will.',
            'She sets her head against my shoulder. It is the weight of a coat.',
          ],
          scales: { warmth: +3, waiting: -2, cold: +2 },
          composure: -2,
          composureCost: '!!The cold is in my fingers now.!!',
        },
        {
          label: 'only a while',
          desc: 'An honest limit.',
          lines: [
            'I say: only a while. I cannot stay long.',
            'She nods. She presses against my shoulder once and stays where she is.',
          ],
          scales: { warmth: +1, waiting: -1 },
        },
        {
          label: 'I have to go',
          desc: 'Leave the offer.',
          lines: [
            'I say: I have to go soon.',
            'She holds against my shoulder a moment longer than is comfortable. Then she eases off.',
          ],
          scales: { warmth: -2, cold: +1, waiting: +2 },
          composure: -2,
          composureCost: 'My breath is visible. Hers is not.',
        },
      ],
    },
    {
      id: 'which_one',
      once: true,
      when: (p) => p.scales.warmth >= 4,
      prose: [
        'Her head turns. She squints at me. She has only just noticed.',
        'She asks: ~~Which one are you?~~',
      ],
      responses: [
        {
          label: 'tell her my name',
          desc: 'I am not him.',
          lines: [
            'I say: I am Patient 0413. I came in this morning. I am not your husband.',
            'She nods. ~~She is not disappointed.~~ She had not been sure.',
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
            'She takes my arm and leans into it. ~~She does not check.~~',
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
            'She thinks about that. ~~Carefully.~~ She thinks about that carefully.',
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
            'Her face changes. ~~Relief.~~ Relief. She has been waiting for the late one.',
            'She squeezes my sleeve. She does not check.',
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
            'She nods. ~~That is the right number.~~ That is the right number.',
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
          'I wait. The cold has not lessened. I am tired in a way I do not understand.',
          'I am becoming tired in a way she would recognize.',
        ],
        scales: { cold: +1, waiting: +1 },
        composure: -1,
        composureCost: '!!The bench is colder than the floor.!!',
      };
    }
    if (p.scales.waiting >= 6) {
      return {
        lines: ['I wait. She shifts on the bench. She watches the door. No one comes.'],
        scales: { cold: +1, waiting: +1 },
        composure: -1,
        composureCost: '!!I am waiting too.!!',
      };
    }
    return {
      lines: ['I wait. She shifts. She presses her sleeve to where a watch should be.'],
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
    "The facility's final ward houses the choir. The chord has been incomplete since the building opened.",
    'Each admission ~~contributes a voice~~ resolves a note. !!The chord is almost full.!!',
    'Subject 0413 has been ~~the missing note~~ on file since [[8]]. **Subject is expected.**',
  ],
  intro: [
    'The choir is in the room.',
    'They are looking at me. ~~Several of them have my face.~~',
    '!!One of them is me.!!',
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
        3: 'I am thinner than I was. The room can see through me.',
        2: 'I am hard to see, even to me.',
        1: 'There is very little of me left.',
        0: '!!I am almost gone.!!',
      },
      crossUp: {
        2: 'I am back. ~~Mostly.~~',
        3: 'I am here. All the way here.',
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
        2: 'I can pick out where my voice would be.',
        3: 'I can see them. Each one. As themselves.',
        4: '!!I know what this is.!!',
      },
      crossDown: { 1: 'They have blurred together again.' },
    },
    chord: {
      initial: 2, min: 0, max: 10, label: 'chord', kind: 'negative',
      bands: [
        { at: 0, word: 'silent' },
        { at: 3, word: 'humming' },
        { at: 5, word: 'stacking' },
        { at: 7, word: 'full' },
        { at: 9, word: 'completed' },
      ],
      crossUp: {
        2: 'The chord has thickened.',
        3: '!!The chord wants me in it.!!',
        4: '!!The chord is full. It knows what shape I would be.!!',
      },
      crossDown: {
        2: 'The chord has come apart.',
        1: 'One voice has gone.',
        0: 'The chord is gone.',
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
        2: 'I have begun to hum. ~~I do not remember starting.~~',
        3: 'My voice is in the chord.',
        4: '!!I can hear myself from outside.!!',
      },
      crossDown: {
        2: 'My mouth has closed.',
        1: 'I have stopped singing.',
        0: 'I am silent. ~~For now.~~',
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
    { announce: 'A line of the file fills in. ~~The chord has been incomplete since the building opened.~~' },
    { announce: '**Each admission resolves a note.**' },
    { announce: '!!Subject 0413 is the missing note.!!' },
  ],

  presented(p) {
    const s = p.scales.self;
    const re = p.scales.recognition;
    const c = p.scales.chord;
    const v = p.scales.voice;
    let song;
    if (c >= 8)      song = '!!The chord is full. It has been full a while.!!';
    else if (c >= 5) song = 'The choir is singing. Several parts. Familiar parts.';
    else if (c >= 2) song = 'The choir is humming. It has not yet found its key.';
    else             song = 'The choir is quiet. They are watching me.';
    let me;
    if (v >= 7)      me = '~~My voice is in the chord.~~ I can hear it from outside.';
    else if (v >= 4) me = 'I am humming. I did not start.';
    else if (re >= 3) me = 'I can pick out where my voice would go. I am keeping it back.';
    else              me = 'My mouth is closed.';
    let left;
    if (s >= 7)      left = 'I am still mostly here.';
    else if (s >= 4) left = '~~I am thinner than I was.~~ The room can see through me.';
    else if (s >= 1) left = 'I am hard to see, even to me.';
    else              left = '~~There is very little of me left.~~ I am almost gone.';
    return `${song} ${me} ${left}`;
  },

  verbs: {

    hold_yourself: {
      label: 'hold yourself',
      desc: 'Do not move. Do not sing. Anchor.',
      respond(p) {
        const reps = streakCount(p, 'hold_yourself');
        if (reps >= 2) {
          return {
            lines: [
              'I keep holding. The chord widens around me, looking for the gap.',
              'I do not give it. But it is exhausting work.',
            ],
            scales: { self: -1, recognition: +2 },
            composure: -1,
            composureCost: '~~My voice is in the chord.~~ I did not start.',
          };
        }
        return {
          lines: [
            'I stand at the door. I do not move. I do not sing.',
            'The chord searches for me. It does not find me yet.',
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
            'I listen. I am there. I have been there. I have been singing for longer than I have been listening.',
            '~~For how long.~~ For how long.',
          ],
          scales: { recognition: +3, self: -1 },
          composure: -1,
          composureCost: 'I am thinner than I was.',
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
              'I sing more. The chord widens to make room. ~~I narrow.~~ Or I narrow.',
            ],
            scales: { voice: +3, chord: +2, self: -2 },
            composure: -1,
            composureCost: '!!I am being learned.!!',
          };
        }
        return {
          lines: [
            'I open my mouth. A note comes out. It fits.',
            'The chord widens to make room. ~~Or I narrow to fit.~~',
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
              'I say it again. !!Patient 0413.!!',
              'The chord loses a note. My own note. ~~It had been there.~~',
            ],
            scales: { self: +2, voice: -2, recognition: +1 },
          };
        }
        return {
          lines: [
            'I say: !!Patient 0413.!!',
            'The chord falters. One voice loses its place. ~~It might be mine.~~',
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
              "I reach for what I think is my voice. ~~I find someone else's.~~",
              'I pull it. They go quiet. ~~I do not know who.~~',
            ],
            scales: { self: -1, recognition: -1 },
            composure: -2,
            composureCost: 'One of them sounds like me. All of them do, in the right light.',
            scars: ['witnessed'],
          };
        }
        return {
          lines: [
            'I reach into the chord. My voice is there. Exactly where I left it.',
            'I pull it out. The chord is poorer for it. I am ~~smaller~~ louder for it.',
            '!!I have me again.!!',
          ],
          scales: { voice: -10, self: +3, chord: -3 },
          flags: { excised: true },
        };
      },
    },

    close_door: {
      label: 'close the door',
      desc: 'Shut it from the inside. Or the outside. You decide.',
      when: (p) => p.scales.self >= 5,
      respond() {
        return {
          lines: [
            'I close the door. ~~From the inside.~~ From the outside.',
            'The chord goes on without me. I can hear it down the corridor.',
            'I am out. ~~Mostly.~~',
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
          ['I look at one of them. She is rocking a pram. Her arms are tight.', 'I have been in this room before. ~~Recently.~~'],
          ['I look at another. He sits in a chair. He is dictating to a clerk who is not here.', '~~I closed his eyes.~~ I closed his eyes.'],
          ['I look at another. She is humming a chord. The piano lid is still open.', '~~I never let her finish.~~'],
          ['I look at another. She is on a bench, waiting. The room is much colder than the corridor.', 'I sat with her. ~~For an hour.~~ For an hour.'],
        ];
        const m = memories[Math.min(which - 1, memories.length - 1)];
        return {
          lines: [m[0], m[1]],
          scales: { recognition: +2, self: -1 },
          composure: -1,
          composureCost: 'The door is open. ~~From the inside.~~',
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Let the chord come for me. ~~It will.~~',
    when: () => true,
  },

  interjections: [
    {
      id: 'one_of_us',
      once: true,
      when: (p) => p.scales.voice >= 4,
      prose: [
        'The chord pauses. One voice steps slightly forward. It is mine, I think.',
        'It asks me: ~~Are you one of us yet?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'Concede.',
          lines: [
            'I say: yes.',
            'The chord widens. Another note. ~~Mine.~~',
            '!!They have me now.!!',
          ],
          scales: { voice: +4, chord: +3, self: -3 },
          composure: -2,
          composureCost: 'I have been here longer than I came in for.',
        },
        {
          label: 'no',
          desc: 'Refuse.',
          lines: [
            'I say: no.',
            'The chord wavers. One voice falters. They wait for me to change my mind.',
          ],
          scales: { self: +2, voice: -2, recognition: +2 },
        },
        {
          label: "I don't know",
          desc: 'Honest.',
          lines: [
            "I say: I don't know.",
            'They accept it. For now. The chord holds its place.',
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
        'The chord opens. There is a space in it shaped like a person. Shaped like me.',
        "One voice asks: ~~Won't you sing with us?~~",
      ],
      responses: [
        {
          label: 'no',
          desc: 'Firm.',
          lines: [
            'I say: no.',
            'The chord closes around the space. They continue without me. ~~They have learned to.~~',
          ],
          scales: { chord: -2, self: +2 },
        },
        {
          label: 'one note',
          desc: 'Small concession.',
          lines: [
            'I sing one note. Just one. It fits.',
            'The chord settles for it.',
          ],
          scales: { voice: +2, chord: +1, self: -1 },
          composure: -1,
          composureCost: '~~My voice is in the chord.~~ I did not start.',
        },
        {
          label: 'I came to take mine out',
          desc: 'Declare intent.',
          lines: [
            'I say: I came to take my voice out.',
            'They go quiet. They have not been told that. They did not know it was possible.',
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
        'The chord shifts. Several voices, in unison.',
        'They ask: ~~Who were you, before us?~~',
      ],
      responses: [
        {
          label: 'Patient 0413',
          desc: 'Your number. Flatly.',
          lines: [
            'I say: Patient 0413. I came in this morning.',
            'The chord falters. One voice stops humming. ~~It was mine.~~',
          ],
          scales: { self: +3, voice: -2, recognition: +1 },
        },
        {
          label: 'someone with a file',
          desc: 'Less specific.',
          lines: [
            'I say: someone with a file. Someone admitted.',
            'They accept that. It is not enough to undo what is being done.',
          ],
          scales: { recognition: +1, voice: +1, self: -1 },
          composure: -1,
          composureCost: 'I am thinner than I was.',
        },
        {
          label: "I don't remember",
          desc: 'The truest answer.',
          lines: [
            "I say: I don't remember.",
            'The chord nods. ~~It has been here longer.~~ It remembers for me.',
          ],
          scales: { voice: +3, chord: +2, self: -2 },
          composure: -1,
          composureCost: '!!I am being learned.!!',
        },
        {
          label: '[amnesia] I came in with no name',
          desc: 'The file goes all the way to the cover.',
          when: (_, player) => player.wound === 'amnesia',
          lines: [
            'I say: there was no before. I was admitted without identification.',
            'The chord goes quiet for a long beat. ~~They have not had a blank one offered.~~',
            'A voice says: ~~that is the easiest one to take.~~',
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
            'The chord softens by a degree. ~~The night ones are different.~~ The night ones are different here.',
            'They keep humming. They do not press.',
          ],
          scales: { self: +1, voice: +1, recognition: +1 },
        },
        {
          label: '[split personality] one of two. The other is at home',
          desc: 'Withhold a half from the chord.',
          when: (_, player) => player.wound === 'split_personality',
          lines: [
            'I say: I am one of two. The other is at home in a chair you cannot reach.',
            'The chord falters. ~~They have not had a doubled one before.~~',
            'A voice says: ~~we will take the one in the room with us.~~ A voice says: we will take the one in the room with us.',
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
        'A single voice — closer than the others — speaks.',
        'It says: ~~We missed you.~~ We missed you.',
      ],
      responses: [
        {
          label: 'I missed you',
          desc: 'Echo.',
          lines: [
            'I say: I missed you.',
            'The chord opens around me. ~~I do not move forward.~~ I have already moved.',
          ],
          scales: { voice: +3, chord: +2, self: -2 },
          composure: -2,
          composureCost: 'One of them sounds like me. All of them do, in the right light.',
        },
        {
          label: 'I do not know you',
          desc: 'Refuse the claim.',
          lines: [
            'I say: I do not know you.',
            'The voice goes quiet. The others continue. ~~The chord is poorer.~~',
          ],
          scales: { self: +2, chord: -2, recognition: +1 },
        },
        {
          label: 'who am I',
          desc: 'Turn it around.',
          lines: [
            'I say: who am I, to you?',
            'The chord answers. Each voice says a different thing. ~~No two are the same.~~',
            '!!I do not recognize most of them.!!',
          ],
          scales: { recognition: +3, self: -1 },
          composure: -1,
          composureCost: 'The door is open. ~~From the inside.~~',
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.chord >= 6) {
      return {
        lines: [
          'I wait. The chord deepens. One voice rises — rocking quietly. Another, humming. Another, staring.',
          'They have learned the whole ward. They are singing it.',
        ],
        scales: { self: -1, voice: +1, chord: +1 },
        composure: -1,
        composureCost: 'I have been here longer than I came in for.',
      };
    }
    return {
      lines: ['I wait. The choir hums. ~~One voice sounds like mine.~~ It always has.'],
      scales: { chord: +1, voice: +1 },
      composure: -1,
      composureCost: '~~My voice is in the chord.~~ I did not start.',
    };
  },

  endings: [
    {
      id: 'excised',
      when: (p) => p.flags.excised && p.scales.self >= 6,
      title: 'You take yourself out',
      lines: [
        'I leave the room with my voice still my own. The chord is poorer for it. ~~I am poorer.~~ I am louder.',
        'I walk past them down the corridor. They continue without me. They always did.',
        'I take the stairs.',
      ],
      item: 'sliver_of_glass',
    },
    {
      id: 'shut_out',
      when: (p) => p.flags.shut_door && p.scales.self >= 5 && p.scales.voice <= 3,
      title: 'You shut the door',
      lines: [
        'I close it from the outside. The choir is muffled by an inch of wood.',
        'I walk back the way I came. ~~A different corridor.~~ The same corridor.',
        'I leave my file at the desk. The nurse takes it without looking up.',
      ],
      item: 'ink_bottle',
    },
    {
      id: 'joined',
      when: (p) => p.scales.voice >= 8 && p.scales.self <= 2,
      title: 'You join them',
      lines: [
        'My voice is in the chord. It has always been in the chord. ~~I am in the chord.~~',
        'The room is full of me. There are many of me. ~~I am no longer looking out from anywhere.~~',
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
        'I am thinner than I should be. The choir has not noticed I am gone. ~~Or that I was ever here.~~',
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
    'Subject was admitted with [[6]] years prior. Subject continues to ~~claim the orderlies~~ recognize the daughter.',
    "Volunteers placed in Subject's room have been ~~reassigned~~ withdrawn from the program. **They do not come out the same.**",
    "When asked her own name, Subject gives the orderly's. !!The orderly does not contradict her.!!",
  ],
  intro: [
    "She is at the door before I am all the way through it. She takes my arm just above the elbow. ~~She has been waiting.~~ She knew when I would arrive.",
    'She says: there you are.',
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
        2: 'She has begun to study my face properly.',
        3: 'She sees me. Partly.',
        4: '!!She sees me. She sees who I am.!!',
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
        3: 'Her face has shifted. She is somewhere old.',
        4: '!!The grief has come up.!!',
      },
      crossDown: {
        1: 'She has folded the grief back away.',
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
        4: '!!She has decided I am her. She will not be moved.!!',
      },
      crossDown: {
        2: 'She has eased off, slightly.',
        1: 'She has stopped insisting.',
        0: 'She has let me go. I am my own again.',
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
        4: '!!She is not in the room anymore. She is somewhere worse.!!',
      },
      crossDown: {
        1: 'Her breath has settled.',
        0: 'She is calm. ~~For now.~~',
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
    { announce: 'A line of her file fills in. ~~Her daughter.~~ ~~The one she came in with.~~' },
    { announce: '**The room next door is empty.**' },
    { announce: "The last line writes itself. ~~She gave the orderly's name.~~" },
  ],

  presented(p) {
    const i = p.scales.insistence;
    const re = p.scales.recognition;
    const g = p.scales.grief;
    const pa = p.scales.panic;
    let grip;
    if (i >= 8)      grip = 'She is holding my arm and has not let go since I came in.';
    else if (i >= 5) grip = 'She catches at my sleeve, often. She does not seem to notice doing it.';
    else if (i >= 2) grip = 'She has eased her grip. It has not entirely settled.';
    else             grip = 'She has let me go. She sits with herself.';
    let eyes;
    if (re >= 7)     eyes = 'Her eyes are on me. She has seen me. She has seen who I am.';
    else if (re >= 4) eyes = 'Her eyes are searching my face for someone she half-knows.';
    else if (pa >= 5) eyes = 'Her eyes flick around the room. She is checking exits.';
    else              eyes = 'Her eyes are on me without seeing me. She is somewhere else, behind them.';
    let mouth;
    if (g >= 7)      mouth = 'Her mouth is shaping a name she has not said in a long time.';
    else if (g >= 4) mouth = 'Her lips are moving without sound.';
    else             mouth = 'Her mouth is at rest. She is composed.';
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
              'I have been her daughter a while now. I have told her about a week I did not have.',
              'She has been very glad. ~~I am tired.~~ I am thinner.',
            ],
            scales: { insistence: +2, recognition: -1 },
            composure: -2,
            composureCost: 'Her hand is around my arm. It has not let go.',
            scars: ['named'],
          };
        }
        if (p.scales.insistence >= 7) {
          return {
            lines: [
              'I let her tell me what I have been doing this week.',
              'I have been at school. I have been seeing a young man. I have been thinking of cutting my hair.',
              'She is glad for me. It is a long monologue. ~~She has been waiting to give it.~~',
            ],
            scales: { grief: -1, insistence: +1 },
            composure: -1,
            composureCost: 'I have been her daughter a while now.',
          };
        }
        return {
          lines: [
            'I let her keep her grip on my arm. I let her look at my face.',
            'She breathes out. ~~She has been afraid I would not come.~~',
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
            'I sit beside her. I do not perform a relation. I am a person who is here.',
            p.scales.recognition >= 3
              ? 'She looks at me, sidelong. She is letting me be what I am.'
              : 'She catches my sleeve anyway. Absentmindedly.',
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
              'I say it again. ~~She does not want to hear it again.~~ She refuses to hear it.',
              'She lets go of my arm and presses where her pulse should be. Her breath has changed.',
            ],
            scales: { panic: +3, recognition: -1 },
            composure: -2,
            composureCost: 'Her breath has changed. ~~She has heard something.~~',
          };
        }
        if (p.scales.recognition >= 6) {
          return {
            lines: [
              'I say: I am not your daughter.',
              'She looks at me a long time. She does not argue. She lets go of my arm.',
              'She says: ~~I knew that.~~ I knew that.',
              'She sits down. She is suddenly very small.',
            ],
            scales: { insistence: -4, recognition: +3, grief: +2 },
            composure: -1,
            composureCost: '!!I have given her something I am not.!!',
          };
        }
        return {
          lines: [
            'I say: I am not your daughter.',
            'She does not hear me. Or she hears but it is a fact she has already decided does not apply.',
            'Her grip on my arm stays exactly where it was.',
          ],
          scales: { recognition: +1, panic: +2 },
          composure: -1,
          composureCost: 'I have been telling her a week I did not have.',
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
              'I ask another. And another. She gives me details. Small ones. A knee scar. A favorite color.',
              'She is bringing back a person, one detail at a time.',
            ],
            scales: { grief: +2, recognition: +1 },
          };
        }
        return {
          lines: [
            'I ask: what was she like?',
            'She answers. She answers for a long time. She remembers a great deal. Some of it is happy.',
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
              'I say her name. Her own. ~~I have practiced this.~~ It lands on her like a thing she had set down somewhere and missed.',
              'She answers: yes? She says it not as a question.',
              '!!Her grip on my arm gives way.!!',
            ],
            scales: { recognition: +3, insistence: -2 },
          };
        }
        return {
          lines: [
            'I say her name. Her own. The one on her file. She has not been called by it in a long time.',
            p.scales.recognition >= 5
              ? 'She answers: yes? She says it like a question she had stopped asking.'
              : 'She frowns. She is trying to decide if I am talking to her, or to someone else with the same name.',
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
            'I write the name in my file. Carefully. ~~As if she had asked me to.~~ She did not ask me to.',
            'She watches me do it. She does not stop me.',
            '!!The name belongs somewhere now.!!',
          ],
          scales: { grief: +2, recognition: +2, insistence: -1 },
          flags: { kept_name: true },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Let her tell me my own history. ~~It costs.~~',
    when: (p) => p.scales.insistence >= 6 || p.turn >= 4,
  },

  interjections: [
    {
      id: 'tell_me_about_yourself',
      once: true,
      when: (p) => p.scales.recognition >= 4 && p.scales.insistence <= 6,
      prose: [
        'She is looking at me carefully. She has stopped speaking.',
        'She asks: ~~Tell me about yourself.~~ Tell me about yourself.',
      ],
      responses: [
        {
          label: 'I came in this morning',
          desc: 'Plant yourself in the present.',
          lines: [
            'I tell her: I came in this morning. I was found at the front entrance.',
            'She takes that in slowly. She nods.',
            'She says: yes. Yes, I remember now.',
          ],
          scales: { recognition: +3, insistence: -2 },
        },
        {
          label: "I don't know",
          desc: 'Meet her where she is.',
          lines: [
            "I say: I don't know.",
            'She nods slowly. She has been on this side of the question.',
          ],
          scales: { recognition: +2, grief: +3 },
        },
        {
          label: 'tell me first',
          desc: 'Turn it around.',
          lines: [
            'I say: tell me first. Who are you?',
            'She is quiet for a long time. She says her own name. ~~She has not said it in a while.~~',
          ],
          scales: { recognition: +4, insistence: -3, grief: +1 },
        },
        {
          label: '[amnesia] I came in without identification',
          desc: 'Hand her the cover of my file.',
          when: (_, player) => player.wound === 'amnesia',
          lines: [
            'I say: I cannot. I came in without identification, without anyone with me.',
            'She holds that. Her face softens — she has been on this side of the file.',
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
            'She takes my hand, briefly. She has not slept either.',
            '~~Mothers do not.~~ She has not.',
          ],
          scales: { recognition: +2, insistence: -1, grief: +2 },
        },
        {
          label: '[split personality] there are two of me',
          desc: 'Offer her the half she did not get back.',
          when: (_, player) => player.wound === 'split_personality',
          lines: [
            'I say: there are two of me. One is here. The other is still at home.',
            'She goes very still. ~~She is not going to ask which one.~~',
            'She says: ~~stay anyway.~~',
          ],
          scales: { recognition: +1, insistence: -3, grief: +3 },
          composure: -1,
          composureCost: 'She has chosen the half in the room. ~~I am not sure she did.~~',
        },
      ],
    },

    {
      id: 'do_you_have_to_go',
      once: true,
      when: (p) => p.scales.panic >= 5 && p.scales.insistence >= 5,
      prose: [
        'She has heard a sound outside the room. Her grip on my arm tightens.',
        'She asks: ~~Do you have to go?~~',
      ],
      responses: [
        {
          label: "I'll stay",
          desc: 'Commit.',
          lines: [
            "I say: I'll stay.",
            'Her grip eases. Her breath steadies. ~~She had been afraid.~~',
          ],
          scales: { panic: -4, insistence: +1 },
          composure: -1,
          composureCost: 'Her face has shut.',
        },
        {
          label: "I'll come back",
          desc: 'A kinder lie.',
          lines: [
            "I say: I have to go. But I'll come back. ~~Tomorrow.~~ Tomorrow.",
            'She nods. She does not check her watch. But she lets go of my arm.',
          ],
          scales: { panic: -2, insistence: -2 },
          scars: ['named'],
        },
        {
          label: "you'll be alright",
          desc: 'Gentle. Honest.',
          lines: [
            "I say: you'll be alright.",
            'She does not seem convinced. But she does not stop me either.',
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
        'Her face has gone still. She is looking somewhere I cannot see.',
        'She asks me: ~~Were you at the funeral?~~',
      ],
      responses: [
        {
          label: 'I was',
          desc: 'Tell her yes.',
          lines: [
            'I say: I was. I was there.',
            'She nods. ~~The small one~~ A small one was there too, she says.',
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
            'She is quiet. ~~For a long time.~~ For a long time. She does not let go of my arm.',
          ],
          scales: { grief: +2, panic: +1, insistence: -1 },
        },
        {
          label: 'tell me about it',
          desc: 'Open it.',
          lines: [
            'I say: tell me about it.',
            'She does. It is small. And clear. ~~She has not let herself say any of it out loud.~~',
          ],
          scales: { grief: +3, recognition: +2 },
          composure: -1,
          composureCost: 'I have been her daughter a while now.',
        },
      ],
    },

    {
      id: 'she_was_so_small',
      once: true,
      when: (p) => p.scales.grief >= 5 && p.scales.insistence <= 6,
      prose: [
        'She has gone very still. The room has narrowed to whatever she is looking at.',
        'She says, ~~to me~~ mostly to herself: ~~She was so small. I held her in one arm.~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'Just stay there with it.',
          lines: [
            'I say: yes. She was small.',
            'She breathes out. ~~She has been holding it.~~',
          ],
          scales: { grief: +3, recognition: +1, insistence: -2 },
          composure: -1,
          composureCost: 'Her breath has changed. ~~She has heard something.~~',
        },
        {
          label: 'how small',
          desc: 'Invite the detail.',
          lines: [
            'I ask: how small?',
            'She measures a shape into the air, careful and exact. She names a weight. She names a length.',
            '~~A person, made specific.~~',
          ],
          scales: { grief: +3, recognition: +2 },
          composure: -1,
          composureCost: '!!I have given her something I am not.!!',
        },
        {
          label: 'change the subject',
          desc: 'Spare her.',
          lines: [
            'I look at the clock. I ask if she wants tea.',
            'She does not answer for a long time. ~~She had been about to say more.~~',
          ],
          scales: { grief: -2, insistence: +2, panic: +1 },
          composure: -1,
          composureCost: 'I have been telling her a week I did not have.',
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.insistence >= 7) {
      return {
        lines: [
          'I wait. She is telling me about a birthday party. It was for me. I was eight.',
          '~~It was a long time ago.~~ It was forty years ago. I was not there.',
        ],
        scales: { insistence: +1 },
        composure: -1,
        composureCost: 'Her face has shut.',
      };
    }
    if (p.scales.recognition >= 4) {
      return {
        lines: [
          'I wait. She is quiet. She watches my face like she might find something she has misplaced.',
        ],
        scales: { recognition: +1, grief: +1 },
      };
    }
    return {
      lines: ['I wait. She is humming. Something I do not recognize. It sounds like an old song.'],
      scales: { grief: +1, insistence: +1 },
    };
  },

  endings: [
    {
      id: 'her_name_kept',
      when: (p) => p.flags.kept_name && p.scales.grief >= 8 && p.scales.recognition >= 6,
      title: "You keep her daughter's name",
      lines: [
        'I write the name in my file. I will say it to other people who ought to know it.',
        '~~It is mine.~~ It is hers. It is mine to carry.',
      ],
      item: 'scrap_of_paper',
    },
    {
      id: 'truth_told',
      when: (p) => p.scales.recognition >= 9 && p.scales.grief >= 5,
      title: 'You tell her the truth',
      lines: [
        'She has heard me. She has known a while. She sits with it.',
        'She says her own name out loud. ~~Once.~~ Once. Softly. She has not said it in a long time.',
      ],
      item: 'ink_bottle',
    },
    {
      id: 'i_am_her',
      when: (p) => p.scales.insistence >= 10 && p.scales.recognition <= 3,
      title: 'You are her, for as long as it takes',
      lines: [
        'I let her tell me my history. I let her tell me what I am about to do with my life.',
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
        'Her face has shut. She does not see me anymore. She is afraid in a way I cannot reach.',
        '!!I leave the room. She does not notice.!!',
      ],
      item: null,
      scars: ['witnessed', 'failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: ['I close the door. ~~She is still saying the name she calls me.~~ She is calling me by her daughter\'s name as I go.'],
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
    "Subject persists in asking after the pond. There is no pond on the grounds.",
    'Subject describes a ~~stone~~ statue at the edge. ~~None on file.~~ Of the right size for a small child.',
    'Family report Subject placed **something** in a pond. They will not say what. !!The room is mopped on the hour.!!',
  ],
  intro: [
    'The floor of the room is wet. It is not raining. It has not rained.',
    'She is at the far wall. She does not turn. She is asking the wall:',
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
        4: '!!She is here. She is with me.!!',
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
        2: 'She has begun to say what she has not said.',
        3: 'The words are coming.',
        4: '!!She has named it.!!',
      },
      crossDown: { 1: 'The words have gone back inside.' },
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
        2: 'The floor has wet through the carpet.',
        3: '!!The floor is open under me.!!',
        4: '!!I am up to my ankles. The room is becoming the pond.!!',
      },
      crossDown: {
        2: 'The floor has gone back to being a floor.',
        1: 'The carpet is dry.',
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
    { announce: 'A line of her file fills in. ~~There is no pond on the grounds.~~' },
    { announce: '~~The statue.~~ ~~None on file.~~' },
    { announce: 'The last line writes itself in. **She put something in a pond, once.**' },
  ],

  presented(p) {
    const a = p.scales.approach;
    const pd = p.scales.pond;
    const re = p.scales.recognition;
    const rl = p.scales.release;
    let dist;
    if (a >= 8)      dist = '!!She is in front of me. She has caught my collar.!!';
    else if (a >= 5) dist = 'She has crossed half the room. She is between me and the door now.';
    else if (a >= 2) dist = 'She has taken steps toward me. She is closer than before.';
    else             dist = 'She is at the far wall. She is asking the wall.';
    let water;
    if (pd >= 7)     water = 'The floor is wet to the ankles. The carpet is gone under it.';
    else if (pd >= 4) water = 'The floor is wet. My shoes leave prints on it.';
    else if (pd >= 1) water = 'The floor is damp. ~~There is no water source.~~';
    else             water = 'The floor is dry. The room is normal.';
    let eyes;
    if (re >= 5)     eyes = 'She has turned. She is looking at me as if I belong to the room.';
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
              'I keep answering. Each answer makes the pond more real.',
              'The floor is getting wetter. Her face is closer than before.',
            ],
            scales: { approach: +2, pond: +2 },
            composure: -1,
            composureCost: 'The floor is wet to my ankles.',
          };
        }
        if (p.scales.pond <= 3) {
          return {
            lines: [
              'I say: it is out by the east lawn. The one with the statue.',
              'She nods slowly. She does not turn. But the room dries by a degree.',
              'Her approach stops. She is waiting.',
            ],
            scales: { pond: +1, recognition: +1 },
          };
        }
        return {
          lines: [
            'I say: it is out by the east lawn.',
            'She answers, without turning: !!I have been there. I have been there recently.!!',
            'She takes a step closer.',
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
              'I stay at the door. She has stopped advancing. But the room is colder.',
            ],
            scales: { approach: -1, pond: +1 },
            composure: -2,
            composureCost: 'The room is wetter than the corridor. By a degree.',
          };
        }
        return {
          lines: [
            'I move to the door. I put my back to it.',
            'She does not advance. She has stopped, mid-step. Her face is on the wall still.',
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
              'She corrects me. Gently. She fills in what I was missing. ~~It is a person.~~ It is a small person.',
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
              'She begins to describe it. She describes it in great detail. ~~It is a person.~~ It is a small person.',
              'Her voice breaks at the end. She does not turn.',
            ],
            scales: { release: +2, pond: +1 },
          };
        }
        return {
          lines: [
            'I ask: what does the statue look like?',
            'She pauses. She is trying to remember. It is a slow remembering.',
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
              'We are quiet a long time.',
            ],
            scales: { release: +2, approach: -1, pond: -1 },
          };
        }
        return {
          lines: [
            'I ask: what did you put in the pond.',
            'She is silent. She does not turn. She has pressed herself flat against the wall.',
            'After a long time she says: ~~Something~~ Something I should not have.',
            '!!She does not say what.!!',
          ],
          scales: { release: +3, pond: +1, recognition: +1 },
          composure: -1,
          composureCost: 'The carpet is gone under me.',
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
            'Her eyes are very tired. She looks at me. She does not look at the wall.',
          ],
          scales: { recognition: +3, pond: -1 },
          composure: -1,
          composureCost: 'I should not have told her where the pond is.',
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
            'I find a towel. I dry the corner of the room near the door.',
            'The carpet is fabric again, briefly. She watches me write.',
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
            'She turns. All the way. She sits beside me. ~~We are in the same room now.~~',
          ],
          scales: { recognition: +3, release: +2, approach: -2 },
          composure: -2,
          composureCost: 'The floor is wet to my ankles.',
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Let her keep asking the wall. ~~The room is wetter every minute.~~',
    when: (p) => p.scales.approach >= 3 || p.scales.pond >= 5 || p.turn >= 4,
  },

  interjections: [
    {
      id: 'do_you_remember_him',
      once: true,
      when: (p) => p.scales.pond >= 5 && p.scales.recognition >= 2,
      prose: [
        'She has stopped speaking to the wall. She has not turned, but her shoulders have changed.',
        'She asks the wall: ~~Do you remember him?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'Pretend you do.',
          lines: [
            'I say: yes.',
            'She takes a step away from the wall. She comes closer to me. ~~She is grateful.~~',
          ],
          scales: { release: +2, approach: +1, recognition: +2 },
          scars: ['named'],
        },
        {
          label: "I don't know him",
          desc: 'Honest.',
          lines: [
            "I say: I don't know him.",
            'She does not answer for a long time. Then she says: ~~No one does anymore.~~',
          ],
          scales: { release: +3, pond: +1 },
          composure: -1,
          composureCost: 'The room is wetter than the corridor. By a degree.',
        },
        {
          label: 'tell me about him',
          desc: "Invite. Don't claim.",
          lines: [
            'I say: tell me about him.',
            'She does. For a long time. ~~Some of it is happy.~~ Some of it is.',
            'At the end she gives me his name.',
          ],
          scales: { release: +3, recognition: +2 },
        },
        {
          label: '[amnesia] I do not remember anyone',
          desc: 'The truth I came in with.',
          when: (_, player) => player.wound === 'amnesia',
          lines: [
            'I say: I do not remember anyone. I came in without anyone with me.',
            'She faces the wall again. ~~She is not angry.~~ She is not angry.',
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
            'She nods at the wall. ~~Hers have too.~~',
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
            'She is quiet for a long time. Then she turns. ~~For the first time tonight.~~',
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
        'She has crossed half the room. She stops. She looks at me — full on — for the first time.',
        'She asks: ~~Are you going to stop me?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'Commit to standing between her and it.',
          lines: [
            'I say: yes.',
            'She lets out a long breath. She sits down on the wet floor. ~~Thank god.~~ Thank god, she says.',
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
            'Eventually she walks back to the wall. ~~She did not want to go.~~',
          ],
          scales: { approach: -3, recognition: +2, pond: +1 },
          composure: -1,
          composureCost: '!!I have answered her too well.!!',
        },
        {
          label: "I can't",
          desc: 'Honest.',
          lines: [
            "I say: I can't. But I am here.",
            'She nods. She sits down where she is. The room has a sitting woman in it.',
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
        'She has stopped speaking to the wall. Her shoulders are very still.',
        'She asks the floor: ~~What is at the bottom of the pond?~~',
      ],
      responses: [
        {
          label: 'something heavy',
          desc: 'Meet her where she is.',
          lines: [
            'I say: something heavy.',
            'She nods. ~~She has been remembering its weight.~~',
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
            'She nods. She does not seem disappointed. ~~She did not want to be told.~~',
          ],
          scales: { release: +1, recognition: +1, pond: -1 },
        },
        {
          label: 'a person',
          desc: 'Name it.',
          lines: [
            'I say: a person.',
            'She is very quiet. ~~She has not let anyone say it.~~',
            '!!She does not deny it.!!',
          ],
          scales: { release: +4, recognition: +2, pond: +2 },
          composure: -2,
          composureCost: 'I should not have told her where the pond is.',
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
            'She nods. ~~She has not been told that.~~',
          ],
          scales: { release: +3, recognition: +2, pond: -1 },
        },
        {
          label: 'tell me what happened',
          desc: 'Invite.',
          lines: [
            'I say: tell me what happened.',
            'She does. Some of it. ~~She leaves a lot of it under the water.~~',
          ],
          scales: { release: +3, recognition: +2 },
          composure: -1,
          composureCost: 'The floor is wet to my ankles.',
        },
        {
          label: "it doesn't matter",
          desc: 'Do not require the story.',
          lines: [
            "I say: it doesn't matter what you meant.",
            'She looks at me a long time. She does not agree. But she does not turn back to the wall.',
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
          'I wait. She takes another step toward me. The floor is wet to my ankles now.',
        ],
        scales: { approach: +1, pond: +1 },
        composure: -1,
        composureCost: 'The room is wetter than the corridor. By a degree.',
      };
    }
    return {
      lines: [
        'I wait. She is asking the wall about the pond. She does not advance. But the floor is wetter than it was.',
      ],
      scales: { pond: +1, approach: +1 },
      composure: -1,
      composureCost: 'My shoes are taking on water. ~~A child could fit in the room.~~',
    };
  },

  endings: [
    {
      id: 'pond_acknowledged',
      when: (p) => p.scales.release >= 8 && p.scales.recognition >= 7,
      title: 'You let her say it',
      lines: [
        'We sit on the wet floor a long time. She does not ask about the pond again.',
        'She gives me the name of what she put in. !!She has not said it out loud in years.!!',
        'I take it with me.',
      ],
      item: 'small_bell',
    },
    {
      id: 'denial_held',
      when: (p) => p.scales.pond <= 1 && p.scales.recognition >= 6,
      title: 'You hold the room from her',
      lines: [
        'She has not turned. The floor is barely damp now. The pond is somewhere else. Where it always was.',
        'She does not look at me when I leave. But the room is a room.',
      ],
      item: 'worn_ribbon',
    },
    {
      id: 'weight_named',
      when: (p) => p.scales.release >= 9 && p.scales.pond >= 5,
      title: 'She names the weight',
      lines: [
        '!!She names it. She gives me the name.!!',
        'I take it from her. She lets me. ~~I have a thing now I did not come in with.~~',
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
      lines: ['I leave the room. The corridor is dry. ~~For now.~~'],
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
            'She lifts her hand off the keys. ~~Slowly.~~ Slowly.',
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
        composureCost: 'One of the notes is wrong. It is the one I added.',
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
        'We do not say anything. ~~For a long time.~~ For a long time.',
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
// THE ROOMMATE — Patient 0413, allegedly
// ════════════════════════════════════════════════════════════════════════
//
// You are taken to your assigned ward room. The bed is occupied. The
// occupant is wearing your paper bracelet. They look like you, slightly.
// They say you have the wrong room. The longer you let it continue, the
// more the staff confirm them. Three paths:
//   - Stand in your bed: prove you exist faster than the file forgets.
//   - Lose the bed: accept the wrong bracelet, walk out under a name
//     that is mostly yours.
//   - Walk out: leave the bed. They keep it. You sleep in the corridor.

const roommate = {
  id: 'roommate',
  name: '[The Roommate]',
  glyph: 'Wraithfin',
  subtitle: 'There is already a Patient 0413 in your bed.',
  role: 'wing', tier: 1,
  file: [
    'Subject was assigned Ward 4, Room 0413. Bed 1. ~~The bed has been turned down for them.~~ The bed is occupied.',
    'The occupant is wearing the bracelet issued to Subject. !!The number matches.!!',
    'Staff report no admission conflict. ~~Both files are open.~~ The file is open.',
  ],
  intro: [
    'The orderly has shown me to my room. He has not come in.',
    'There is a person in my bed. They are wearing my bracelet. ~~They are me.~~ They are nearly me.',
    'They sit up when I come in. They say: !!I think you have the wrong room.!!',
  ],

  scales: {
    standing: {
      initial: 5, min: 0, max: 10, label: 'standing', kind: 'positive',
      bands: [
        { at: 0, word: 'discharged' },
        { at: 2, word: 'unaccounted for' },
        { at: 5, word: 'on file' },
        { at: 7, word: 'recorded' },
        { at: 9, word: 'documented' },
      ],
      crossUp: {
        3: 'My name has returned to the top of the page.',
        4: '!!The file is mine.!!',
      },
      crossDown: {
        3: 'My name is further down the file than it was.',
        2: 'I am a footnote in my own room.',
        1: 'I am almost not in the file.',
        0: '!!I have been discharged in absentia.!!',
      },
    },
    bracelet: {
      initial: 3, min: 0, max: 10, label: 'their bracelet', kind: 'negative',
      bands: [
        { at: 0, word: 'paper-fresh' },
        { at: 3, word: 'taking' },
        { at: 5, word: 'taken' },
        { at: 7, word: 'theirs' },
        { at: 9, word: 'irrevocable' },
      ],
      crossUp: {
        2: 'Their bracelet has begun to soften to the skin.',
        3: '!!Their bracelet has taken. The orderlies will not ask twice.!!',
        4: '!!The bracelet is theirs now. I will not get it back.!!',
      },
      crossDown: {
        2: 'The bracelet has loosened on their wrist.',
        1: 'The bracelet is paper again. ~~Mine.~~',
      },
    },
    doubt: {
      initial: 1, min: 0, max: 10, label: 'their doubt', kind: 'positive',
      bands: [
        { at: 0, word: 'certain' },
        { at: 2, word: 'frowning' },
        { at: 5, word: 'unsure' },
        { at: 7, word: 'rattled' },
        { at: 9, word: 'caving' },
      ],
      crossUp: {
        2: 'They have stopped reciting. They are listening to me.',
        3: 'Their certainty has cracked. I can see through it.',
        4: '!!They look down at their wrist. They do not recognize the bracelet.!!',
      },
      crossDown: { 1: 'They have recovered. Their voice is steady again.' },
    },
  },

  initialize(p, player) {
    p.scales.standing = 5;
    p.scales.bracelet = r(3, 4);
    p.scales.doubt = r(0, 2);
    if (player.scars?.includes('named')) p.scales.bracelet = Math.min(10, p.scales.bracelet + 1);
    if (player.wound === 'amnesia') p.scales.standing -= 1;
  },

  fileReveals: [
    { announce: 'A line fills in. Subject was assigned this room. ~~At 07:14.~~ This morning.' },
    { announce: 'Another. The bracelet on file matches the number on the bracelet in the room.' },
    { announce: 'The last line. !!The photograph on file is of the occupant.!!' },
  ],

  presented(p) {
    const s = p.scales.standing;
    const b = p.scales.bracelet;
    const d = p.scales.doubt;

    let them;
    if (b >= 8)      them = '!!They are sitting up in my bed as if they have always slept in it. The bracelet is soft on the wrist.!!';
    else if (b >= 5) them = 'They are sitting on top of the sheet. The bracelet has begun to crease to the skin.';
    else if (b >= 2) them = 'They are sitting on the edge of the bed. The bracelet rests too loose on the wrist.';
    else             them = 'They are halfway off the bed. The bracelet is paper-stiff. It does not belong on them.';

    let me;
    if (s >= 7)      me = 'I am in the room. The orderly has not closed the door.';
    else if (s >= 4) me = 'I am at the foot of the bed. The corridor has gone quiet.';
    else if (s >= 1) me = 'I am barely in the room. My number is somewhere lower in the file.';
    else             me = '~~I am not in the file at all.~~ I am not in the file at all.';

    let voice;
    if (d >= 7)      voice = 'Their voice has thinned. They are looking at their own wrist.';
    else if (d >= 4) voice = 'They speak slower. They listen more than they did.';
    else             voice = 'They speak calmly. They are sure of the room.';

    return `${them} ${me} ${voice}`;
  },

  verbs: {

    say_your_number: {
      label: 'say your number',
      desc: 'Out loud. To them. To the corridor.',
      respond(p) {
        const reps = streakCount(p, 'say_your_number');
        if (reps >= 2) {
          return {
            lines: [
              'I say it again. !!Patient 0413.!! Louder than the room.',
              'The corridor swallows it. ~~My voice has been used up on it.~~',
              'They look at me. They say: !!I am Patient 0413.!! They say it the way I just did.',
            ],
            scales: { standing: +1, bracelet: +1, doubt: +1 },
            composure: -2,
            composureCost: '!!Saying my own number has cost me something I cannot get back.!!',
          };
        }
        return {
          lines: [
            'I say it clearly. !!I am Patient 0413.!!',
            'They blink. They say it back. ~~Less loudly.~~ Less loudly.',
          ],
          scales: { standing: +2, doubt: +2 },
          composure: -1,
          composureCost: 'The room did not echo. The room held it.',
        };
      },
    },

    read_their_bracelet: {
      label: 'read their bracelet',
      desc: 'Look at it. Find a difference.',
      respond(p) {
        const reps = streakCount(p, 'read_their_bracelet');
        if (reps >= 1) {
          return {
            lines: [
              'I look closer. The crease is in the wrong place. The fold is mirrored.',
              'I show them. They do not look. ~~They have not been able to look.~~',
            ],
            scales: { doubt: +3, bracelet: -1 },
          };
        }
        return {
          lines: [
            'I lean down. I read the number through the plastic.',
            'It is mine. The handwriting is not.',
          ],
          scales: { doubt: +2, bracelet: -1 },
          composure: -1,
          composureCost: 'Someone wrote my number for someone else. ~~Recently.~~',
        };
      },
    },

    pull_the_sheet: {
      label: 'pull the sheet off them',
      desc: 'Take the bed back. Make them stand up.',
      when: (p) => p.scales.standing >= 4 || p.scales.doubt >= 3,
      respond(p) {
        if (p.scales.doubt >= 5) {
          return {
            lines: [
              'I take the corner of the sheet. I pull.',
              'They let me. They stand. They are smaller out of the bed than they were in it.',
              '!!The bed is empty. The bracelet is in my hand.!!',
            ],
            scales: { standing: +3, bracelet: -4, doubt: +1 },
            flags: { took_bed: true },
          };
        }
        return {
          lines: [
            'I take the corner of the sheet. I pull.',
            'They do not move. The sheet is taut. !!I am the one off-balance.!!',
            'An orderly looks in. He sees the bracelet. He moves on.',
          ],
          scales: { standing: -2, bracelet: +2 },
          composure: -2,
          composureCost: '!!The orderly did not see me.!!',
        };
      },
    },

    check_the_chart: {
      label: 'check the chart at the foot of the bed',
      desc: 'There is a chart. There is a photograph on the chart.',
      when: (p) => p.turn >= 1,
      respond(p) {
        const reps = streakCount(p, 'check_the_chart');
        if (reps >= 1) {
          return {
            lines: [
              'I look again. The photograph has not changed. ~~It has.~~',
              'The face on the chart is mine. ~~Or theirs. They are close.~~',
            ],
            scales: { doubt: +1, standing: -1 },
            composure: -1,
            composureCost: 'I cannot tell whose face it is anymore.',
          };
        }
        return {
          lines: [
            'I lift the chart off the hook. I look at the photograph.',
            'It is of me. ~~Yesterday.~~ This morning. The eyes have not lined up. The mouth has.',
          ],
          scales: { standing: +1, doubt: +1 },
        };
      },
    },

    call_the_orderly: {
      label: 'call the orderly',
      desc: 'Ask him to sort it. He has a key. He has a clipboard.',
      when: (p) => p.scales.doubt >= 2 || p.scales.standing >= 5,
      respond(p) {
        if (p.scales.standing >= 6 && p.scales.doubt >= 4) {
          return {
            lines: [
              'I call him back. He comes. He looks at me. He looks at them.',
              'He says: !!Ah. Right. Yes.!! He moves toward the other. He takes the bracelet off their wrist.',
              'He puts it on mine. The plastic is warm. ~~It has been warm.~~',
            ],
            scales: { standing: +3, bracelet: -5, doubt: +2 },
            flags: { orderly_confirmed: true },
          };
        }
        return {
          lines: [
            'I call him back. He comes. He looks at the bracelet. He looks at the chart.',
            'He says: ~~the bed is theirs.~~ The bed is theirs. He gestures me back out.',
            'The corridor is colder than the room was.',
          ],
          scales: { standing: -3, bracelet: +3 },
          composure: -2,
          composureCost: '!!The orderly has chosen.!!',
        };
      },
    },

    take_the_bracelet: {
      label: 'take the bracelet',
      desc: 'Off them. Put it on yourself.',
      when: (p) => p.flags.took_bed || p.scales.doubt >= 6,
      respond(p) {
        if (p.flags.took_bed) {
          return {
            lines: [
              'I slide the bracelet off their wrist. It comes off easily.',
              'I put it on mine. ~~The crease is wrong.~~ The crease is mine now.',
              '!!I am in the file again.!!',
            ],
            scales: { standing: +3, bracelet: -10, doubt: +2 },
            flags: { bracelet_recovered: true },
          };
        }
        return {
          lines: [
            'I reach for their wrist. They do not flinch. They turn their wrist toward me.',
            'I take the bracelet. I put it on. ~~The numbers were never the same.~~',
            'I am wearing someone else\'s number. !!They are wearing mine.!!',
          ],
          scales: { standing: -2, bracelet: +3 },
          composure: -2,
          composureCost: '!!I have taken a name that is not quite mine.!!',
          scars: ['named'],
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Stay in the doorway. Let it sort itself.',
    when: () => true,
  },

  interjections: [
    {
      id: 'orderly_glance',
      once: true,
      when: (p) => p.scales.bracelet >= 5 && !p.flags.orderly_confirmed,
      prose: [
        'An orderly passes the door. He looks in. He sees them in the bed.',
        'He nods to them. He does not see me. ~~He does not see me.~~',
      ],
      responses: [
        {
          label: 'call him back',
          desc: 'Make him look.',
          lines: [
            'I call him. He pauses at the door.',
            'He looks at me, blankly, the way one looks at a window.',
          ],
          scales: { doubt: +1 },
          composure: -1,
          composureCost: 'He has already decided which one of us is the patient.',
        },
        {
          label: 'say nothing',
          desc: 'Let him go.',
          lines: [
            'I say nothing. He moves on. His shoes are quiet down the hall.',
            'They sit up a little straighter in the bed.',
          ],
          scales: { bracelet: +2, standing: -2 },
          composure: -1,
          composureCost: 'Someone passed who could have known. I did not call to them.',
        },
        {
          label: 'step into the corridor',
          desc: 'Make him see me out here.',
          lines: [
            'I step into the corridor. The orderly is already at the next door.',
            'He looks back. He sees me. !!He does not recognize me.!!',
          ],
          scales: { standing: -2, doubt: +2 },
          composure: -2,
          composureCost: '!!He did not recognize me.!!',
        },
      ],
    },
    {
      id: 'wrong_room',
      once: true,
      when: (p) => p.turn >= 2 && p.scales.doubt <= 4,
      prose: [
        'They speak. Quiet. Patient.',
        'They ask me: ~~Are you sure you have the right room?~~',
      ],
      responses: [
        {
          label: 'I am sure',
          desc: 'Hold the ground.',
          lines: [
            'I say: I am sure.',
            'They nod, the way one nods at a child who is sure. ~~They settle deeper into the bed.~~',
          ],
          scales: { standing: +2, bracelet: +1 },
          composure: -1,
          composureCost: 'They have not believed me. They were never going to.',
        },
        {
          label: "I'm not",
          desc: 'Honest.',
          lines: [
            "I say: I'm not.",
            'They smile. They do not need to say anything else. ~~The bracelet has tightened.~~',
          ],
          scales: { bracelet: +3, standing: -3 },
          composure: -2,
          composureCost: '!!I gave them the room with my own mouth.!!',
        },
        {
          label: 'show me your bracelet',
          desc: 'Pivot.',
          lines: [
            'I say: show me your bracelet.',
            'They lift their wrist. The number is mine. ~~The handwriting is not.~~',
          ],
          scales: { doubt: +3, bracelet: -1 },
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.bracelet >= 7) {
      return {
        lines: [
          'I wait. They settle deeper into the bed. ~~The bed has stopped being mine.~~',
          'A nurse passes. She greets them by my number. She does not look at me.',
        ],
        scales: { bracelet: +1, standing: -2 },
        composure: -2,
        composureCost: '!!The nurse called them by my name.!!',
      };
    }
    return {
      lines: [
        'I wait at the threshold. They sit. The bed creases under them.',
        'The corridor is doing its rounds. ~~Without me.~~',
      ],
      scales: { bracelet: +1, standing: -1 },
      composure: -1,
      composureCost: 'I have been standing in my own doorway too long.',
    };
  },

  endings: [
    {
      id: 'recovered',
      when: (p) => p.flags.bracelet_recovered && p.scales.standing >= 6,
      title: 'You stand in your bed',
      lines: [
        'I sit on the edge of the bed. The sheet is warm where they were. ~~It will be mine soon.~~',
        'They are at the door. They look back once. The orderly does not stop them.',
        '!!The bracelet on my wrist is mine. The handwriting is mine.!!',
      ],
      item: 'handkerchief',
    },
    {
      id: 'orderly_settled',
      when: (p) => p.flags.orderly_confirmed && p.scales.standing >= 5,
      title: 'The orderly sorts it',
      lines: [
        'The orderly walks the other one out. He does not apologize. He does not look at me.',
        'I sit on the bed. The sheet is warm. ~~The bed is mine.~~ The bed is mine.',
      ],
      item: 'pocket_watch',
    },
    {
      id: 'wrong_bracelet',
      when: (p) => p.scales.bracelet >= 8 && p.scales.standing >= 2,
      title: "You wear their bracelet out of the room",
      lines: [
        'They have given me the bracelet. The numbers match. The handwriting does not.',
        'I walk out wearing it. ~~No one stops me.~~ No one stops me.',
        '!!I have signed for someone else\'s descent.!!',
      ],
      item: null,
      scars: ['named'],
    },
    {
      id: 'discharged',
      when: (p) => p.scales.standing <= 0,
      title: 'You are discharged in your sleep',
      lines: [
        'The file has updated. I am no longer in it. ~~The other one is.~~',
        'The orderly is at my elbow. He has a discharge paper for me to sign. ~~With a name on it that is not mine.~~',
        '!!I sign.!!',
      ],
      item: null,
      scars: ['collapsed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: [
        'I close the door. They are still in the bed. ~~They always were.~~',
        'I sleep in the corridor. Someone steps over me, twice, before morning.',
      ],
      item: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// THE VISITOR — Patient unfiled
// ════════════════════════════════════════════════════════════════════════
//
// A man is in the chair facing the door. He stands when you come in. He
// has been waiting. He calls you by a name close to your own. He has
// papers. He has a car in the lot. He closes the distance each turn.
// The corridor is on his side. Three paths:
//   - Break his certainty: catch him in the wrong fact, or refuse him by
//     name. He sits down. He apologizes.
//   - Go with him: accept the embrace. You leave through a door you did
//     not come in through.
//   - Be reached: distance closes. The visit ends with him at your elbow.

const visitor = {
  id: 'visitor',
  name: '[The Visitor]',
  glyph: 'Shadowmaw',
  subtitle: 'He has been waiting for you in the chair.',
  role: 'wing', tier: 1,
  file: [
    'Subject is listed as visiting Patient 0413. ~~The visit was not requested.~~ The visit was scheduled.',
    'Visitor has signed in. The signature ~~is unfamiliar~~ matches the next-of-kin on file.',
    'Visitor reports a vehicle in the loading lot. !!The vehicle is registered to Subject.!!',
  ],
  intro: [
    'The chair has been turned to face the door.',
    'There is a man in it. He stands when I come in.',
    'He says: !!Finally.!! He says my name. ~~Almost.~~ He says my name almost.',
  ],

  scales: {
    distance: {
      initial: 5, min: 0, max: 10, label: 'distance', kind: 'positive',
      bands: [
        { at: 0, word: 'at my elbow' },
        { at: 2, word: 'within arm' },
        { at: 4, word: 'close' },
        { at: 6, word: 'at the chair' },
        { at: 8, word: 'across the room' },
      ],
      crossDown: {
        3: 'He has crossed the rug. He is between me and the chair.',
        2: '!!He is within arm. His hand has come up.!!',
        1: '!!He is at my elbow. I can smell the lining of his coat.!!',
        0: '!!He has reached me.!!',
      },
      crossUp: {
        2: 'He has stepped back. ~~Briefly.~~',
        3: 'He has returned to the chair.',
      },
    },
    claim: {
      initial: 4, min: 0, max: 10, label: 'his claim', kind: 'negative',
      bands: [
        { at: 0, word: 'frayed' },
        { at: 3, word: 'asserted' },
        { at: 5, word: 'documented' },
        { at: 7, word: 'sealed' },
        { at: 9, word: 'court-ready' },
      ],
      crossUp: {
        2: 'He has produced a paper. ~~My signature is on it.~~',
        3: '!!The orderly has nodded. He has been nodding.!!',
        4: '!!The corridor is his now. The car is at the loading dock.!!',
      },
      crossDown: {
        2: 'His paper has crumpled in his fist.',
        1: 'The orderly has stopped nodding.',
        0: 'His claim has come apart.',
      },
    },
    refusal: {
      initial: 0, min: 0, max: 10, label: 'my refusal', kind: 'positive',
      bands: [
        { at: 0, word: 'no' },
        { at: 2, word: 'firmer' },
        { at: 5, word: 'clear' },
        { at: 7, word: 'absolute' },
        { at: 9, word: 'a wall' },
      ],
      crossUp: {
        3: 'My no has become a thing the room has heard.',
        4: '!!The orderly has stepped back from the chair.!!',
      },
      crossDown: { 1: 'My refusal has thinned again.' },
    },
  },

  initialize(p, player) {
    p.scales.distance = 5;
    p.scales.claim = r(3, 5);
    p.scales.refusal = 0;
    if (player.scars?.includes('named')) p.scales.claim = Math.min(10, p.scales.claim + 2);
    if (player.wound === 'amnesia') p.scales.claim = Math.min(10, p.scales.claim + 1);
  },

  fileReveals: [
    { announce: 'A line fills in. The visit was logged before Subject was admitted.' },
    { announce: 'Another. The vehicle in the loading lot has been there since [[3]] days.' },
    { announce: 'The last line. !!The name Visitor uses is one Subject answered to as a child.!!' },
  ],

  presented(p) {
    const d = p.scales.distance;
    const c = p.scales.claim;
    const r = p.scales.refusal;

    let where;
    if (d <= 1)      where = '!!He is at my elbow. His hand is at the small of my back.!!';
    else if (d <= 3) where = '!!He is within arm. He has not blinked.!!';
    else if (d <= 5) where = 'He has stepped off the rug. He is closer than he was.';
    else             where = 'He is by the chair. His coat is folded over the back.';

    let proof;
    if (c >= 8)      proof = '!!The orderly is at the door. He is holding it open for both of us.!!';
    else if (c >= 5) proof = 'He has papers in his coat. He has not had to take them out.';
    else if (c >= 2) proof = 'He has my name in his mouth. Almost mine.';
    else             proof = 'He has no papers. He has only a face.';

    let me;
    if (r >= 7)      me = '!!My no is the loudest thing in the room.!!';
    else if (r >= 4) me = 'My no has stayed in the room. The orderly has heard it.';
    else if (r >= 1) me = 'I have begun to say no. Quietly.';
    else             me = 'I have not said no yet. ~~My mouth is open.~~';

    return `${where} ${proof} ${me}`;
  },

  verbs: {

    ask_his_name: {
      label: 'ask his name',
      desc: 'Make him say his name out loud.',
      respond(p) {
        const reps = streakCount(p, 'ask_his_name');
        if (reps >= 1) {
          return {
            lines: [
              'I ask again. He pauses. He gives a different one this time.',
              'The two names do not match. !!He has not noticed.!!',
            ],
            scales: { refusal: +2, claim: -2, distance: +1 },
          };
        }
        return {
          lines: [
            'I say: tell me your name.',
            'He says it. It is a name I have not heard. He says it as if I should know it.',
          ],
          scales: { refusal: +1, claim: -1 },
        };
      },
    },

    step_back: {
      label: 'step back',
      desc: 'Move toward the door. Open distance.',
      respond(p) {
        const reps = streakCount(p, 'step_back');
        if (reps >= 1) {
          return {
            lines: [
              'I step back again. He has matched the step. He has not looked away.',
              '~~His coat smells of the parking lot.~~ His coat smells of the parking lot.',
            ],
            scales: { distance: -1, claim: +1 },
            composure: -2,
            composureCost: '!!I cannot step back faster than he can step forward.!!',
          };
        }
        return {
          lines: [
            'I take a step back. He takes one forward. ~~Mirrored.~~',
            'The door is closer behind me. He is closer in front of me.',
          ],
          scales: { distance: -1, refusal: +1 },
          composure: -1,
          composureCost: 'The door is behind me. I cannot watch both.',
        };
      },
    },

    demand_papers: {
      label: 'demand his papers',
      desc: 'Make him produce them. In writing.',
      when: (p) => p.scales.refusal >= 2 || p.turn >= 2,
      respond(p) {
        if (p.scales.refusal >= 5) {
          return {
            lines: [
              'I say: show me the papers.',
              'He reaches into his coat. He takes out a folded sheet. !!He unfolds it.!!',
              'It is blank. ~~On both sides.~~ On both sides.',
            ],
            scales: { claim: -4, refusal: +2, distance: +2 },
            flags: { papers_blank: true },
          };
        }
        return {
          lines: [
            'I ask for the papers. He nods. He takes them out. He hands them over.',
            'They are correct. ~~My signature.~~ My signature. I do not remember signing.',
          ],
          scales: { claim: +3, refusal: -1 },
          composure: -2,
          composureCost: '!!My signature is on a paper I do not remember writing.!!',
        };
      },
    },

    refuse_him_by_name: {
      label: 'refuse him by name',
      desc: 'Say no to the name he is using.',
      when: (p) => p.turn >= 1,
      respond(p) {
        const reps = streakCount(p, 'refuse_him_by_name');
        if (reps >= 1) {
          return {
            lines: [
              'I say it again. !!I am not the one you came for.!!',
              'He stops walking. His mouth opens. He does not have a follow-up.',
            ],
            scales: { refusal: +3, claim: -2, distance: +1 },
            flags: { refused_by_name: true },
          };
        }
        return {
          lines: [
            'I say: I am not the one you came for.',
            'He smiles, gently. He says: ~~It is alright. I know it has been a long time.~~',
          ],
          scales: { refusal: +2, claim: +1 },
          composure: -1,
          composureCost: '!!He thinks my refusal is a symptom.!!',
        };
      },
    },

    let_him_embrace: {
      label: 'let him embrace you',
      desc: 'Stop refusing. Let him come in.',
      when: (p) => p.scales.distance <= 4,
      respond(p) {
        return {
          lines: [
            'I do not move. He closes the rest of the distance. His coat is colder than the room.',
            'He holds me. He says my name. ~~The one he came in with.~~',
            '!!I have answered to it.!!',
          ],
          scales: { distance: -3, claim: +4, refusal: -3 },
          composure: -3,
          composureCost: '!!I answered to a name that was not mine.!!',
          flags: { embraced: true },
        };
      },
    },

    shut_the_door: {
      label: 'shut the door behind you',
      desc: 'Close it from the inside. Trap yourself with him.',
      when: (p) => p.scales.refusal >= 4 && p.scales.distance >= 3,
      respond(p) {
        return {
          lines: [
            'I close the door. The corridor is gone.',
            'He is alone with me. The orderly cannot help him now.',
            '!!He had been counting on the corridor.!!',
          ],
          scales: { claim: -3, refusal: +2 },
          composure: -1,
          composureCost: 'I have shut myself in with him. ~~On purpose.~~',
          flags: { door_shut: true },
        };
      },
    },

    name_the_car: {
      label: 'name the car',
      desc: 'Ask him what color it is. What plate.',
      when: (p) => p.scales.refusal >= 3 || p.scales.claim >= 5,
      respond(p) {
        return {
          lines: [
            'I say: what color is the car.',
            'He pauses. He says a color. It is a color. ~~It is not a color a car would be.~~',
          ],
          scales: { claim: -3, refusal: +2, distance: +1 },
          flags: { car_named: true },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Let him close the distance.',
    when: () => true,
  },

  interjections: [
    {
      id: 'car_is_in_the_lot',
      once: true,
      when: (p) => p.turn >= 1 && p.scales.claim >= 4,
      prose: [
        'He puts a hand in his coat pocket. He takes out a set of keys. He holds them up.',
        'He says: ~~the car is in the lot. The drive is shorter than the corridor.~~',
      ],
      responses: [
        {
          label: 'I am not getting in your car',
          desc: 'Firm.',
          lines: [
            'I say: I am not getting in your car.',
            'He puts the keys back. He does not put them back all the way. ~~He is still holding them.~~',
          ],
          scales: { refusal: +3, claim: -2 },
        },
        {
          label: 'whose car is it',
          desc: 'Pivot.',
          lines: [
            'I say: whose car is it.',
            'He gives a name. The name is mine. ~~On the registration.~~ On the registration.',
          ],
          scales: { claim: +3, distance: -1 },
          composure: -2,
          composureCost: '!!The car is in my name.!!',
        },
        {
          label: 'where are we going',
          desc: 'Accept the premise.',
          lines: [
            'I say: where are we going.',
            'He smiles. He says: ~~home.~~ Home. He puts the keys in my coat pocket.',
          ],
          scales: { claim: +4, distance: -2, refusal: -2 },
          composure: -2,
          composureCost: 'I have asked the question he came in to be asked.',
        },
      ],
    },
    {
      id: 'orderly_at_the_door',
      once: true,
      when: (p) => p.scales.claim >= 6,
      prose: [
        'An orderly has come to the door. He is holding it open. He does not come in.',
        'He looks at me. He says: ~~your visitor is leaving. Will you walk him out.~~',
      ],
      responses: [
        {
          label: 'he is not my visitor',
          desc: 'Correct him.',
          lines: [
            'I say: he is not my visitor.',
            'The orderly looks at the man in the chair. The man in the chair looks at me.',
            'The orderly says: ~~ah.~~ Then says nothing else. The door stays open.',
          ],
          scales: { refusal: +3, claim: -3 },
        },
        {
          label: 'I will walk him out',
          desc: 'Be agreeable.',
          lines: [
            'I say: I will walk him out.',
            'The orderly steps aside. The man in the chair stands. He takes my arm.',
          ],
          scales: { claim: +4, distance: -3, refusal: -2 },
          composure: -2,
          composureCost: '!!I am being walked.!!',
        },
        {
          label: 'shut the door',
          desc: 'Close it. From inside.',
          when: (p) => p.scales.refusal >= 3,
          lines: [
            'I close the door in the orderly\'s face. The handle clicks.',
            'The man in the chair has stopped smiling.',
          ],
          scales: { claim: -3, refusal: +2 },
          composure: -1,
          composureCost: 'I have made an enemy of the corridor.',
          flags: { door_shut: true },
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.distance <= 3) {
      return {
        lines: [
          'I do nothing. He takes another step. ~~He is at my elbow.~~ He is at my elbow.',
          '!!He has stopped speaking. He is breathing through his nose.!!',
        ],
        scales: { distance: -1, claim: +2 },
        composure: -2,
        composureCost: '!!I let him close.!!',
      };
    }
    return {
      lines: [
        'I wait. He takes a step. He looks at the door. ~~He is patient.~~ He is patient.',
        'The orderly passes the doorway. He waves to the man in the chair.',
      ],
      scales: { distance: -1, claim: +1 },
      composure: -1,
      composureCost: 'He is closer than he was. He always is.',
    };
  },

  endings: [
    {
      id: 'broken',
      when: (p) => p.flags.papers_blank && p.scales.refusal >= 5,
      title: 'The papers are blank',
      lines: [
        'I hold the blank paper up to the light. There is nothing on it.',
        'He sits down in the chair. He stays sitting. ~~He has remembered something.~~',
        'I leave the room. He does not call after me. ~~The corridor is mine.~~',
      ],
      item: 'the_card',
    },
    {
      id: 'refused',
      when: (p) => p.flags.refused_by_name && p.scales.refusal >= 6 && p.scales.claim <= 3,
      title: 'You refuse him by name',
      lines: [
        'He blinks. He looks at his hands. He says: ~~I am sorry. I have the wrong room.~~',
        'He picks up his coat. He leaves. ~~The keys stay on the chair.~~',
        'I take the keys. I put them in my pocket. !!In case.!!',
      ],
      item: 'pocket_watch',
    },
    {
      id: 'door_shut',
      when: (p) => p.flags.door_shut && p.scales.refusal >= 6 && p.scales.distance >= 4,
      title: 'You shut the door on him',
      lines: [
        'I close the door from the inside. He does not have a corridor to leave through.',
        'He sits down in the chair. He waits. ~~I outwait him.~~',
        'When I open the door, the chair is empty.',
      ],
      item: 'sliver_of_glass',
    },
    {
      id: 'gone_with_him',
      when: (p) => p.flags.embraced && p.scales.claim >= 7,
      title: 'You go with him',
      lines: [
        'He has my arm. I do not pull it away. We leave through the loading door.',
        'The car is in the lot. ~~It is mine.~~ It is mine. ~~On paper.~~',
        '!!I have answered to a name that was not mine, three times.!!',
      ],
      item: null,
      scars: ['named', 'taken'],
    },
    {
      id: 'reached',
      when: (p) => p.scales.distance <= 0,
      title: 'He reaches you',
      lines: [
        'He is at my elbow. His hand is at my back. He is steering me out.',
        'The corridor is on his side. The orderly does not look up. ~~The visit is over.~~',
      ],
      item: null,
      scars: ['collapsed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: [
        'I close the door. He is still in the chair.',
        '~~He will be here when I come back.~~ He will be here when I come back.',
      ],
      item: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// THE SURGEON — Patient 0247
// ════════════════════════════════════════════════════════════════════════
//
// A surgeon in scrubs has prepared a small operating theatre in a ward
// room. She has your file. She has a procedure scheduled. There is no
// authorization. She does not need one. Each turn she advances another
// step of preparation. At full preparation she begins. Three paths:
//   - Crack her chart: find a discrepancy, refuse the gown, knock the
//     tray. Her authority collapses.
//   - Be operated on: accept the gown, accept the iodine, lie down.
//     She begins.
//   - Walk out: she will be there next time.

const surgeon = {
  id: 'surgeon',
  name: '[The Surgeon]',
  glyph: 'Charnel',
  subtitle: 'She is ready for your procedure. The one on file.',
  role: 'wing', tier: 2,
  file: [
    'Subject was admitted for ~~observation~~ scheduled procedure. Notation: ~~unverified.~~',
    'Procedure: ~~left renal excision~~ specified on the chart. !!No counter-signature.!!',
    'Operating room: improvised. Lamp: positioned. Instruments: laid out. ~~The surgeon is in scrubs.~~',
  ],
  intro: [
    'The room has been changed. The bed has been moved. A small lamp is on, very bright.',
    'She is at the basin. She is washing her hands. She has been washing them for a while.',
    'She looks up. !!Ah, Subject. We are ready when you are.!!',
  ],

  scales: {
    preparation: {
      initial: 3, min: 0, max: 10, label: 'preparation', kind: 'negative',
      bands: [
        { at: 0, word: 'undressed' },
        { at: 3, word: 'gowning' },
        { at: 5, word: 'marking' },
        { at: 7, word: 'sterile' },
        { at: 9, word: 'incising' },
      ],
      crossUp: {
        2: 'She has set the gown on the table. ~~In my size.~~',
        3: '!!She has uncapped the iodine. The room smells of it.!!',
        4: '!!She has lifted the instrument. The lamp is hot on my neck.!!',
      },
      crossDown: {
        3: 'She has set the instrument down.',
        2: 'She has folded the gown back into the cabinet.',
        1: 'She has wiped the table clean.',
      },
    },
    authority: {
      initial: 7, min: 0, max: 10, label: 'her authority', kind: 'negative',
      bands: [
        { at: 0, word: 'broken' },
        { at: 3, word: 'flustered' },
        { at: 5, word: 'professional' },
        { at: 7, word: 'unassailable' },
        { at: 9, word: 'unimpeachable' },
      ],
      crossUp: {
        3: '!!The orderly has stepped in to assist. She did not ask him.!!',
        4: '!!The lamp brightens by a degree. The room narrows to the table.!!',
      },
      crossDown: {
        3: 'Her voice has caught. She has to look at the chart again.',
        2: '!!The orderly has stepped back out.!!',
        1: 'The chart is in her hands but her hands are not steady.',
        0: '!!She has set the chart down on the basin. She has stopped washing.!!',
      },
    },
    refusal: {
      initial: 0, min: 0, max: 10, label: 'my refusal', kind: 'positive',
      bands: [
        { at: 0, word: 'compliant' },
        { at: 2, word: 'asking' },
        { at: 5, word: 'refusing' },
        { at: 7, word: 'standing' },
        { at: 9, word: 'leaving' },
      ],
      crossUp: {
        3: 'My refusal has landed. ~~The room heard it.~~',
        4: '!!The lamp has dimmed. The room is a room again.!!',
      },
      crossDown: { 1: 'My refusal has thinned.' },
    },
  },

  initialize(p, player) {
    p.scales.preparation = r(3, 4);
    p.scales.authority = r(6, 8);
    p.scales.refusal = 0;
    if (player.scars?.includes('witnessed')) p.scales.authority = Math.min(10, p.scales.authority + 1);
    if (player.scars?.includes('named')) p.scales.preparation = Math.min(10, p.scales.preparation + 1);
  },

  fileReveals: [
    { announce: 'A line fills in. The chart is in another patient\'s handwriting.' },
    { announce: 'Another. The procedure was scheduled three years ago, for someone with my name.' },
    { announce: 'The last line. !!The surgeon was struck from the register on the same date.!!' },
  ],

  presented(p) {
    const pr = p.scales.preparation;
    const a = p.scales.authority;
    const re = p.scales.refusal;

    let stage;
    if (pr >= 8)      stage = '!!The lamp is over the table. The drape is across me. The instrument is in her hand.!!';
    else if (pr >= 5) stage = '!!The basin is full. The iodine is uncapped. The marker is on my skin.!!';
    else if (pr >= 2) stage = 'The gown is folded on the trolley. The lamp is warm.';
    else             stage = 'The trolley is bare. The lamp is unplugged.';

    let her;
    if (a >= 8)      her = 'She moves the way someone who has never been corrected moves. ~~The orderly is here.~~';
    else if (a >= 5) her = 'She moves precisely. She has done this before. She has been authorized to.';
    else if (a >= 2) her = 'Her hands have begun to pause. She rereads the chart between motions.';
    else             her = 'Her hands have stopped. She is staring at the chart.';

    let me;
    if (re >= 7)      me = '!!I have not moved toward the table. I have moved toward the door.!!';
    else if (re >= 4) me = 'I have not put the gown on. I have not sat on the table.';
    else if (re >= 1) me = 'I have begun to ask which doctor authorized this.';
    else              me = 'My hands are at my sides. ~~My sleeves are still down.~~';

    return `${stage} ${her} ${me}`;
  },

  verbs: {

    read_the_chart: {
      label: 'read the chart',
      desc: 'Take it from her. Read your own file.',
      respond(p) {
        const reps = streakCount(p, 'read_the_chart');
        if (reps >= 1) {
          return {
            lines: [
              'I read it again. The procedure is in a different hand than the notation.',
              'I show her. !!She does not look at it. She looks at me.!!',
            ],
            scales: { refusal: +3, authority: -2 },
            composure: -1,
            composureCost: 'The handwriting on the chart is older than I am.',
          };
        }
        return {
          lines: [
            'I take the chart. I read the procedure. I read my number.',
            'The number is mine. The procedure is not.',
          ],
          scales: { refusal: +2, authority: -1 },
        };
      },
    },

    refuse_the_gown: {
      label: 'refuse the gown',
      desc: 'Do not put it on. Stay dressed.',
      when: (p) => p.scales.preparation >= 2 || p.turn >= 1,
      respond(p) {
        if (p.scales.refusal >= 4) {
          return {
            lines: [
              'I say: I am not wearing this.',
              'She sets it aside. She picks up the chart instead. ~~She is rereading it.~~',
              'The orderly is no longer in the doorway.',
            ],
            scales: { preparation: -2, authority: -2, refusal: +2 },
            flags: { gown_refused: true },
          };
        }
        return {
          lines: [
            'I say: I am not putting on the gown.',
            'She nods, professionally. She sets it on the table. ~~It is still in my size.~~',
            'She continues her preparations around me.',
          ],
          scales: { refusal: +1, preparation: +1 },
          composure: -1,
          composureCost: '!!My refusal did not stop the preparations.!!',
        };
      },
    },

    ask_who_authorized: {
      label: 'ask who authorized this',
      desc: 'A doctor. A name. A signature.',
      when: (p) => p.turn >= 1,
      respond(p) {
        const reps = streakCount(p, 'ask_who_authorized');
        if (reps >= 1) {
          return {
            lines: [
              'I ask again. She names a different doctor. The two names are not the same.',
              '!!She has not noticed.!!',
            ],
            scales: { authority: -3, refusal: +2 },
            flags: { caught_her: true },
          };
        }
        return {
          lines: [
            'I say: who authorized this.',
            'She gives a name, briskly. She does not look up. She marks something on the chart.',
          ],
          scales: { refusal: +1, preparation: +1 },
          composure: -1,
          composureCost: 'She named someone. I cannot verify them.',
        };
      },
    },

    knock_the_tray: {
      label: 'knock the tray over',
      desc: 'Direct confrontation. The instruments on the floor.',
      when: (p) => p.scales.refusal >= 3 || p.scales.preparation >= 5,
      respond(p) {
        if (p.scales.authority <= 5) {
          return {
            lines: [
              'I swing my arm across the trolley. The tray clatters to the floor.',
              'Instruments scatter. !!One of them is bent.!!',
              'She stops. She looks at the floor. She does not bend down. ~~She has stopped washing.~~',
            ],
            scales: { preparation: -4, authority: -4, refusal: +3 },
            composure: -2,
            composureCost: '!!I have made a noise the corridor heard.!!',
            shake: true,
            flags: { tray_knocked: true },
          };
        }
        return {
          lines: [
            'I swing at the trolley. She catches my arm. She lowers it gently.',
            'She says: !!Subject. Please.!! She replaces the instrument she nearly lost.',
          ],
          scales: { preparation: +2, authority: +1, refusal: -1 },
          composure: -2,
          composureCost: '!!She caught my arm. She did not have to look.!!',
        };
      },
    },

    accept_the_gown: {
      label: 'put on the gown',
      desc: 'Stop refusing. Get on the table.',
      when: (p) => p.scales.preparation >= 2,
      respond(p) {
        return {
          lines: [
            'I take the gown. I put it on. The paper is cold.',
            'She nods. She helps me onto the table. ~~The lamp is right above me.~~',
          ],
          scales: { preparation: +3, authority: +2, refusal: -3 },
          composure: -3,
          composureCost: '!!I have lain down on the table.!!',
          flags: { gowned: true },
        };
      },
    },

    name_the_register: {
      label: 'name the medical register',
      desc: 'Say the date her license was struck.',
      when: (p) => p.scales.refusal >= 5,
      respond(p) {
        return {
          lines: [
            'I say a date. ~~I do not know how I know it.~~ I know it.',
            'She stops washing. She looks at her hands. ~~The basin water is still running.~~',
            '!!She has not been a surgeon since that date.!!',
          ],
          scales: { authority: -5, refusal: +3, preparation: -3 },
          composure: -2,
          composureCost: '!!I named a date that was not in my file.!!',
          flags: { register_named: true },
        };
      },
    },

    stand_up_off_the_table: {
      label: 'stand up off the table',
      desc: 'Get off it. Even gowned.',
      when: (p) => p.flags.gowned,
      respond(p) {
        if (p.scales.authority <= 4) {
          return {
            lines: [
              'I sit up. I take the drape off. I take the gown off.',
              'She does not stop me. She looks at the chart. She looks at the door.',
              '~~She has not been here in a long time.~~',
            ],
            scales: { preparation: -5, refusal: +3, authority: -2 },
            flags: { gowned: false, stood_back_up: true },
          };
        }
        return {
          lines: [
            'I try to sit up. She has a hand on my chest. ~~Lightly.~~',
            'She says: !!We are nearly ready. Please do not.!!',
          ],
          scales: { preparation: +2, refusal: -1 },
          composure: -2,
          composureCost: '!!She had a hand on my chest. Lightly.!!',
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Let her continue. ~~She will.~~',
    when: () => true,
  },

  interjections: [
    {
      id: 'the_gown',
      once: true,
      when: (p) => p.scales.preparation >= 4 && !p.flags.gowned,
      prose: [
        'She steps away from the basin. She picks up the gown. She holds it out.',
        'She says: ~~Subject. The gown, please. We are on a schedule.~~',
      ],
      responses: [
        {
          label: 'no',
          desc: 'Flat.',
          lines: [
            'I say: no.',
            'She sets the gown down. She returns to the basin. ~~She has not stopped washing.~~',
          ],
          scales: { refusal: +2, authority: -1 },
        },
        {
          label: 'whose schedule',
          desc: 'Catch the procedure on its own paperwork.',
          lines: [
            'I say: whose schedule.',
            'She names a board. She names a date. The date is twenty years old. !!She has not noticed.!!',
          ],
          scales: { authority: -3, refusal: +2 },
          flags: { caught_her: true },
        },
        {
          label: 'I will put it on',
          desc: 'Accept.',
          lines: [
            'I take the gown. I put it on. ~~I do it slowly.~~',
            'She nods. She gestures to the table. The lamp is warm overhead.',
          ],
          scales: { preparation: +3, authority: +2, refusal: -3 },
          composure: -3,
          composureCost: '!!The paper of the gown is colder than the room.!!',
          flags: { gowned: true },
        },
      ],
    },
    {
      id: 'the_consent',
      once: true,
      when: (p) => p.scales.preparation >= 6 || p.flags.gowned,
      prose: [
        'She comes back to the table with the chart and a pen.',
        'She says: ~~Subject. The consent. Last formality.~~',
      ],
      responses: [
        {
          label: 'I do not consent',
          desc: 'Plainly.',
          lines: [
            'I say: I do not consent.',
            'She looks at the chart. She looks at me. ~~She has begun to look like she might leave.~~',
          ],
          scales: { authority: -3, refusal: +3, preparation: -2 },
        },
        {
          label: 'I want to read it first',
          desc: 'Buy a beat.',
          lines: [
            'I take the chart. I read the consent. ~~It is in someone else\'s handwriting.~~ It is in someone else\'s handwriting.',
            'I do not sign. ~~Yet.~~',
          ],
          scales: { refusal: +2, authority: -1 },
          composure: -1,
          composureCost: 'The consent is in handwriting I almost recognize.',
        },
        {
          label: 'I sign',
          desc: 'End it. One way.',
          lines: [
            'I take the pen. I sign. !!My signature is on it now.!!',
            'She nods. She takes it back. She puts it with the others.',
          ],
          scales: { preparation: +3, authority: +3, refusal: -4 },
          composure: -3,
          composureCost: '!!I signed the consent.!!',
          flags: { consented: true },
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.preparation >= 6 || p.flags.gowned) {
      return {
        lines: [
          'I do nothing. She moves on to the next step. ~~Iodine.~~ Iodine. She paints the line where the cut will go.',
          'The orderly has come back into the doorway. He has gloves on.',
        ],
        scales: { preparation: +2, authority: +1 },
        composure: -2,
        composureCost: '!!The iodine has dried where she put it.!!',
      };
    }
    return {
      lines: [
        'I wait. She continues her preparations. She does not need me to participate.',
        'The lamp brightens. ~~Or my eyes have adjusted to it.~~',
      ],
      scales: { preparation: +1, authority: +1 },
      composure: -1,
      composureCost: 'The room is warmer than it was. Just for me.',
    };
  },

  endings: [
    {
      id: 'register',
      when: (p) => p.flags.register_named && p.scales.authority <= 3,
      title: 'You name the register',
      lines: [
        'She has stopped washing. She looks at her own hands.',
        'She takes the gown off. She is not a surgeon. ~~She has not been one.~~',
        'She leaves the room before I do. I take the chart with me. I tear it on the way out.',
      ],
      item: 'sliver_of_glass',
    },
    {
      id: 'tray_knocked',
      when: (p) => p.flags.tray_knocked && p.scales.authority <= 4 && p.scales.refusal >= 6,
      title: 'You knock the tray',
      lines: [
        'The instruments are on the floor. She has not picked them up.',
        'She steps back from the table. She gestures to the door. ~~I leave first.~~',
        'I do not look at the floor on my way out.',
      ],
      item: 'handkerchief',
    },
    {
      id: 'caught',
      when: (p) => p.flags.caught_her && p.scales.refusal >= 6 && p.scales.preparation <= 4,
      title: 'You catch her on the chart',
      lines: [
        'Her chart does not match her chart. ~~Two doctors. Two dates.~~',
        'She looks at me. She does not deny it. She closes the file. ~~She apologizes.~~',
        'I leave the room dressed. The lamp goes off behind me.',
      ],
      item: 'pocket_watch',
    },
    {
      id: 'consented',
      when: (p) => p.flags.consented && p.scales.preparation >= 7,
      title: 'You sign the consent',
      lines: [
        'I have signed. I am on the table. The drape is across me. The lamp is on.',
        'She picks up the instrument. ~~The room is very quiet.~~',
        '!!The instrument is cold. Then the instrument is warm.!!',
      ],
      item: null,
      scars: ['collapsed', 'witnessed'],
    },
    {
      id: 'began',
      when: (p) => p.scales.preparation >= 10,
      title: 'She begins',
      lines: [
        'She does not wait for the consent. She has the chart. She has the room.',
        '!!The lamp is hot. The drape is across me. The line is drawn.!!',
        '~~I am awake for it.~~ I am awake for it.',
      ],
      item: null,
      scars: ['collapsed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: [
        'I leave through the door. The lamp is still on behind me.',
        '~~She will be ready when I come back.~~ She will be ready when I come back.',
      ],
      item: null,
      scars: ['abandoned', 'failed'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// THE OTHER 0413 — Patient 0413
// ════════════════════════════════════════════════════════════════════════
//
// There is another Patient 0413 in the room. They have your face, your
// wound, your file. They are calm. They are sure. The administrators say
// only one of you can be 0413. Each turn one of you becomes more real
// and the other thins. Three paths:
//   - Name what only you know: a private memory the file does not have.
//     You stay. They thin.
//   - Let them name you: they recover a fact you should have known.
//     They stay. You thin.
//   - Agree to be the other one: take a new number. Walk out as someone
//     else's file.

const twin = {
  id: 'twin',
  name: '[The Other 0413]',
  glyph: 'Voidling',
  subtitle: 'They came in this morning. So did you.',
  role: 'wing', tier: 2,
  file: [
    'Subject is admitted as Patient 0413. ~~The bed is in the East ward.~~',
    'A second admission has been logged under the same number, the same morning.',
    'The administrators have requested ~~one of the two~~ Subject to clarify which file is in error.',
  ],
  intro: [
    'They are sitting on the floor with their back to the bed.',
    'They look up. They have my face. They have my wound. They are wearing my gown.',
    'They say: !!I am Patient 0413. I came in this morning. ~~I do not know who you are.~~!!',
  ],

  scales: {
    mine: {
      initial: 5, min: 0, max: 10, label: 'my claim', kind: 'positive',
      bands: [
        { at: 0, word: 'forgotten' },
        { at: 2, word: 'thinning' },
        { at: 5, word: 'on file' },
        { at: 7, word: 'remembered' },
        { at: 9, word: 'whole' },
      ],
      crossUp: {
        3: 'I have come back into focus. The room knows me again.',
        4: '!!I am the one in the file. They are the second.!!',
      },
      crossDown: {
        3: 'I have begun to lose the thread of my own week.',
        2: 'I cannot remember which of us came in first.',
        1: 'There is very little of me left to argue with.',
        0: '!!The file is no longer mine.!!',
      },
    },
    theirs: {
      initial: 5, min: 0, max: 10, label: 'their claim', kind: 'negative',
      bands: [
        { at: 0, word: 'unsigned' },
        { at: 3, word: 'arguing' },
        { at: 5, word: 'on file' },
        { at: 7, word: 'documented' },
        { at: 9, word: 'undeniable' },
      ],
      crossUp: {
        2: 'They have remembered another thing. ~~I had forgotten it.~~',
        3: '!!They have named a place I have not been in years.!!',
        4: '!!They are the one in the file. I am the second.!!',
      },
      crossDown: {
        2: 'Their voice has thinned. They are unsure of the date.',
        1: 'They are barely arguing now.',
        0: 'They have stopped speaking.',
      },
    },
    thinning: {
      initial: 0, min: 0, max: 10, label: 'thinning', kind: 'negative',
      bands: [
        { at: 0, word: 'whole' },
        { at: 3, word: 'thinning' },
        { at: 5, word: 'translucent' },
        { at: 7, word: 'sketched' },
        { at: 9, word: 'almost not here' },
      ],
      crossUp: {
        2: 'The room is harder to be in. ~~For one of us.~~',
        3: '!!I can see through one of us.!!',
        4: '!!One of us has nearly stopped happening.!!',
      },
      crossDown: { 1: 'The room has steadied. ~~For now.~~' },
    },
  },

  initialize(p, player) {
    p.scales.mine = 5;
    p.scales.theirs = 5;
    p.scales.thinning = 0;
    if (player.wound === 'split_personality') {
      p.scales.theirs = Math.min(10, p.scales.theirs + 2);
    }
    if (player.wound === 'amnesia') {
      p.scales.mine = Math.max(0, p.scales.mine - 2);
    }
    if (player.scars?.includes('named') || player.scars?.includes('taken')) {
      p.scales.theirs = Math.min(10, p.scales.theirs + 1);
    }
  },

  fileReveals: [
    { announce: 'A line fills in. Both admissions are signed in the same handwriting. ~~Mine.~~' },
    { announce: 'Another. The wound noted on both files is identical.' },
    { announce: 'The last line. !!The administrators will keep the one that argues longer.!!' },
  ],

  presented(p) {
    const m = p.scales.mine;
    const t = p.scales.theirs;
    const th = p.scales.thinning;

    let me;
    if (m >= 7)      me = 'I am in the room. The bed knows me.';
    else if (m >= 4) me = 'I am in the room. Some of the room is uncertain about me.';
    else if (m >= 1) me = '~~I am barely in the room.~~ I am barely in the room.';
    else             me = '!!The room is no longer admitting me.!!';

    let them;
    if (t >= 7)      them = '!!They are on the bed now. Their feet are on the floor. The floor is keeping them.!!';
    else if (t >= 4) them = 'They are sitting on the edge of the bed. They are calmer than me.';
    else if (t >= 1) them = 'They are on the floor. They have not stood up.';
    else             them = 'They have not spoken in some time. ~~They are watching.~~';

    let air;
    if (th >= 7)      air = '!!The air has thinned. One of us is having trouble breathing.!!';
    else if (th >= 4) air = 'The room has gone narrow. ~~One of us is taking up too much of it.~~';
    else if (th >= 1) air = 'The air is heavier than it was.';
    else              air = 'The room is steady.';

    return `${me} ${them} ${air}`;
  },

  verbs: {

    name_your_wound: {
      label: 'name your wound',
      desc: 'Say the reason you were admitted. Out loud.',
      respond(p, player) {
        const reps = streakCount(p, 'name_your_wound');
        const woundName = player.wound;
        if (reps >= 1) {
          return {
            lines: [
              `I say it again. !!${woundName.replace('_', ' ')}.!! Slower.`,
              'They say it after me. Almost. ~~They get a syllable wrong.~~ They get a syllable wrong.',
            ],
            scales: { mine: +2, theirs: -2 },
          };
        }
        return {
          lines: [
            `I say: !!${woundName.replace('_', ' ')}.!! I was admitted for it this morning.`,
            'They nod. They name it too. ~~They say it the same way.~~',
          ],
          scales: { mine: +1, theirs: +1, thinning: +1 },
          composure: -1,
          composureCost: 'Saying it has not made me the only one who has it.',
        };
      },
    },

    describe_a_memory: {
      label: 'describe a memory only you have',
      desc: 'Something that is not in the file. Yours.',
      respond(p) {
        const reps = streakCount(p, 'describe_a_memory');
        if (reps >= 2) {
          return {
            lines: [
              'I describe another. Smaller. ~~A window I closed last week.~~',
              'They look at me, gently. They say: ~~I have already remembered that one.~~',
              '!!They have. They are smiling about it.!!',
            ],
            scales: { mine: -2, theirs: +3, thinning: +2 },
            composure: -2,
            composureCost: '!!They have taken a memory I was certain of.!!',
          };
        }
        return {
          lines: [
            'I describe a small one. ~~A burn mark on the kitchen wall.~~ A burn mark on the kitchen wall.',
            'They are quiet. They do not have that one. ~~Yet.~~',
          ],
          scales: { mine: +3, theirs: -1 },
          composure: -1,
          composureCost: 'I have shown them where one of my marks is.',
        };
      },
    },

    ask_them_a_fact: {
      label: 'ask them a fact you know',
      desc: 'A test. Their answer matters.',
      when: (p) => p.turn >= 1,
      respond(p) {
        return {
          lines: [
            'I ask them what I had for breakfast.',
            'They answer correctly. ~~The eggs. The cold toast.~~ They name the toast.',
            'They name what was on the toast. !!I had forgotten.!!',
          ],
          scales: { theirs: +3, mine: -2, thinning: +1 },
          composure: -2,
          composureCost: '!!They know things I did not write down.!!',
        };
      },
    },

    press_the_card: {
      label: 'press the admission card to your tongue',
      desc: 'Say the number through it. Make the number stick.',
      when: (p) => p.turn >= 1,
      respond(p) {
        return {
          lines: [
            'I take the card out. I press the number against the roof of my mouth.',
            'I say it through it. !!Patient 0413.!! The number is in me.',
            'They have gone quiet. ~~They cannot have it for a moment.~~',
          ],
          scales: { mine: +3, theirs: -2 },
          composure: -2,
          composureCost: '~~The card has cut the inside of my mouth.~~',
        };
      },
    },

    offer_the_file: {
      label: 'offer them the file',
      desc: 'Let them have it. Concede.',
      when: (p) => p.scales.theirs >= 5,
      respond(p) {
        return {
          lines: [
            'I hand them the file. They take it. They open it. They begin to read.',
            'They have my mother\'s maiden name correct. They have the street. ~~They have the door colour.~~',
          ],
          scales: { theirs: +4, mine: -4, thinning: +2 },
          composure: -3,
          composureCost: '!!I gave them the file. They are filling in.!!',
          flags: { offered_file: true },
        };
      },
    },

    name_them_back: {
      label: 'name them by who they were before',
      desc: 'Something they should not be able to know about themselves.',
      when: (p) => p.scales.mine >= 6 && p.scales.theirs <= 6,
      respond(p) {
        return {
          lines: [
            'I name something they could not have. ~~A scar on my own knee.~~ A scar on my own knee.',
            'They reach for it. ~~It is not on theirs.~~ It is not on theirs.',
            '!!They look at their hands. They are thinning.!!',
          ],
          scales: { mine: +4, theirs: -4, thinning: +2 },
          flags: { named_them: true },
        };
      },
    },

    walk_to_the_bed: {
      label: 'walk to the bed',
      desc: 'Sit on it. Claim it physically.',
      when: (p) => p.scales.mine >= 4,
      respond(p) {
        if (p.scales.theirs >= 6) {
          return {
            lines: [
              'I cross the room. The bed is harder to get to than I expected. ~~The floor is theirs.~~',
              'I sit on the edge. They are sitting on the other edge. ~~We are mirrored.~~',
              'The bed is small. !!Smaller than it was.!!',
            ],
            scales: { mine: -1, theirs: +2, thinning: +2 },
            composure: -2,
            composureCost: '!!We are both on the bed now. Only one of us will leave it.!!',
          };
        }
        return {
          lines: [
            'I cross the room. I sit on the bed.',
            'They have not stood up off the floor. The bed creases under me. ~~The bed knows my weight.~~',
          ],
          scales: { mine: +2, theirs: -2 },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Let them speak. ~~They will.~~',
    when: () => true,
  },

  interjections: [
    {
      id: 'where_did_you_sleep',
      once: true,
      when: (p) => p.turn >= 2,
      prose: [
        'They look up at me. They have a question waiting.',
        'They ask: ~~Where did you sleep last night?~~',
      ],
      responses: [
        {
          label: 'the bed',
          desc: 'The obvious answer.',
          lines: [
            'I say: the bed. This bed.',
            'They nod. They say: ~~I did too.~~',
          ],
          scales: { mine: +1, theirs: +1, thinning: +1 },
          composure: -1,
          composureCost: 'We have given the same answer. The bed is not mine alone.',
        },
        {
          label: 'in the chair',
          desc: 'Anywhere not the bed.',
          lines: [
            'I say: in the chair. ~~There was a chair.~~ There was a chair.',
            'They look at the chair. There is a chair. ~~It has not been sat in.~~',
          ],
          scales: { mine: +2, theirs: -1 },
        },
        {
          label: 'I have not slept',
          desc: 'True.',
          when: (_, player) => player.wound === 'insomnia',
          lines: [
            'I say: I have not slept.',
            'They look at me. They say: ~~I have not either.~~ They mean it.',
            'We are both up. We have both been up. ~~Together.~~',
          ],
          scales: { mine: -1, theirs: +2, thinning: +2 },
          composure: -2,
          composureCost: '!!Our wound is the same. The night is the same.!!',
        },
        {
          label: 'I do not remember',
          desc: 'Honest.',
          when: (_, player) => player.wound === 'amnesia',
          lines: [
            'I say: I do not remember.',
            'They smile. They say: ~~I do.~~ They name a house. A door. A window.',
          ],
          scales: { theirs: +4, mine: -3 },
          composure: -2,
          composureCost: '!!They remember more of mine than I do.!!',
        },
      ],
    },
    {
      id: 'one_will_be_kept',
      once: true,
      when: (p) => p.scales.theirs >= 6 || p.scales.mine <= 3,
      prose: [
        'A clipboard is at the door. The administrator does not come in.',
        'A voice says: ~~one of you will be kept. The administrators have not decided.~~',
      ],
      responses: [
        {
          label: 'me',
          desc: 'Loudly.',
          lines: [
            'I say: me.',
            'The clipboard does not write anything down. ~~It is waiting for the other one.~~',
          ],
          scales: { mine: +2, theirs: +1 },
          composure: -1,
          composureCost: 'My answer was not enough on its own.',
        },
        {
          label: 'they have been here longer',
          desc: 'Concede the time.',
          lines: [
            'I say: they have been here longer. ~~On the floor.~~',
            'The clipboard writes something down. ~~A check mark.~~',
            '!!Beside them.!!',
          ],
          scales: { theirs: +3, mine: -3, thinning: +1 },
          composure: -2,
          composureCost: '!!I conceded them the floor and the bed both.!!',
        },
        {
          label: 'neither of us',
          desc: 'Refuse the question.',
          lines: [
            'I say: neither of us. Wipe the file.',
            'The clipboard pauses. Then it walks on. ~~The door stays open.~~',
            'The room is steadier without an answer.',
          ],
          scales: { mine: -1, theirs: -2, thinning: -1 },
          composure: -1,
          composureCost: 'I refused the file. ~~I refused mine too.~~',
        },
      ],
    },
    {
      id: 'come_be_me',
      once: true,
      when: (p) => p.scales.theirs >= 7 && p.scales.mine <= 4,
      prose: [
        'They stand up. They are taller than I had thought. They cross to me.',
        'They say: ~~come be me. It is easier. I have already done the difficult part.~~',
      ],
      responses: [
        {
          label: 'no',
          desc: 'Refuse the offer.',
          lines: [
            'I say: no.',
            'They sit back down. They do not look at me again. ~~They have a file to read.~~',
          ],
          scales: { mine: +2, theirs: -1 },
        },
        {
          label: 'how',
          desc: 'Ask the mechanics.',
          lines: [
            'I say: how.',
            'They open their hand. There is a paper bracelet in it. ~~With my number on it.~~ With a different number on it.',
          ],
          scales: { theirs: +3, thinning: +2 },
          composure: -2,
          composureCost: 'They have a number ready for me.',
        },
        {
          label: 'yes',
          desc: 'Accept.',
          lines: [
            'I say: yes.',
            'They put the bracelet on my wrist. They take mine off. ~~They put mine on.~~',
            '!!The room is theirs now.!!',
          ],
          scales: { theirs: +4, mine: -5, thinning: +3 },
          composure: -3,
          composureCost: '!!I have agreed to be someone else.!!',
          scars: ['named'],
          flags: { agreed_to_be_other: true },
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.theirs >= 6) {
      return {
        lines: [
          'I wait. They keep reading the file. They are getting better at it.',
          '!!They have read past where I had read.!! They know things I have not gotten to.',
        ],
        scales: { theirs: +2, mine: -2, thinning: +1 },
        composure: -2,
        composureCost: '!!The file has more in it than I had time to read.!!',
      };
    }
    return {
      lines: [
        'I wait. They watch me. ~~Patiently.~~ Patiently. They are not in a hurry.',
        'The clock on the wall has not moved. ~~For either of us.~~',
      ],
      scales: { theirs: +1, thinning: +1 },
      composure: -1,
      composureCost: 'Waiting has cost me a fact I cannot get back.',
    };
  },

  endings: [
    {
      id: 'named_them',
      when: (p) => p.flags.named_them && p.scales.mine >= 7 && p.scales.theirs <= 4,
      title: 'You name what only you have',
      lines: [
        'They look at their hands. They cannot find the scar I named.',
        'They stand up. They walk past me. ~~They leave through the door I came in through.~~',
        '!!The bed is mine. The file is mine. The number is mine.!!',
      ],
      item: 'the_card',
    },
    {
      id: 'pressed',
      when: (p) => p.scales.mine >= 8 && p.scales.theirs <= 3,
      title: 'You are the one in the room',
      lines: [
        'I am sitting on the bed. They are not. ~~There is no one else in the room.~~',
        'The clipboard has come and gone. !!My name is on top of the file.!!',
      ],
      item: 'handkerchief',
    },
    {
      id: 'replaced',
      when: (p) => p.scales.theirs >= 8 && p.scales.mine <= 2,
      title: 'They are the one in the room',
      lines: [
        'They are on the bed. I am on the floor. ~~The floor is harder than I had thought.~~',
        'The clipboard takes the file. It writes a check mark. ~~Beside them.~~',
        '!!I am no longer admitted.!!',
      ],
      item: null,
      scars: ['collapsed'],
    },
    {
      id: 'agreed',
      when: (p) => p.flags.agreed_to_be_other,
      title: 'You agree to be the other one',
      lines: [
        'I am wearing a different bracelet now. The number is not mine. ~~It will be.~~',
        'They are on the bed. They have my file. They are reading it the way I would have read it.',
        'I leave the room. The corridor is longer than it was on the way in.',
      ],
      item: null,
      scars: ['named', 'taken'],
    },
    {
      id: 'offered',
      when: (p) => p.flags.offered_file && p.scales.theirs >= 7,
      title: 'You give them the file',
      lines: [
        'They are reading my file. They have learned my mother\'s maiden name. They have learned the street.',
        'They have my pulse. They have my date. ~~They are filling in.~~',
        'I leave. I do not look back. ~~I am not sure who I am leaving.~~',
      ],
      item: null,
      scars: ['collapsed', 'named'],
    },
    {
      id: 'thinned',
      when: (p) => p.scales.thinning >= 9,
      title: 'The room thins you out',
      lines: [
        'The room is narrow. There is not enough air in it for two. ~~One of us has stopped happening.~~',
        '!!I am almost not here.!!',
      ],
      item: null,
      scars: ['collapsed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: [
        'I close the door. They are still on the floor. ~~Reading the file.~~',
        'When I come back, the bed will be made. ~~Not by me.~~',
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
  pram, patriarch, soothlick, glimmer, frostfin, hollow, mire, composer,
  roommate, visitor, surgeon, twin,
  choir,
};

export function getPatient(id) { return PATIENTS[id] || null; }
