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
// THE EMPTY PRAM — Patient 0028
// ════════════════════════════════════════════════════════════════════════

const pram = {
  id: 'pram',
  name: '[The Pram]',
  glyph: 'Emberkin',
  subtitle: 'She has not let go.',
  role: 'wing', tier: 1,
  file: [
    'Subject was admitted with a perambulator. ~~The perambulator is empty.~~ Contents of the perambulator have not been weighed since intake.',
    'Staff have been instructed not to ~~inform her~~ correct the discrepancy. Subject does not request correction.',
    'Subject was asked when **the child** could be discharged. Subject corrected herself. !!She meant herself.!!',
  ],
  intro: [
    'The door is half open. She does not look up. She is on the chair by the window with the pram between her knees.',
    'I close the door behind me. She rocks the pram by the handle. The wheels do not turn.',
  ],

  scales: {
    tenderness: {
      initial: 2, min: 0, max: 10, label: 'tenderness', kind: 'positive',
      bands: [
        { at: 0, word: 'closed off' },
        { at: 2, word: 'guarded' },
        { at: 5, word: 'softening' },
        { at: 7, word: 'open' },
        { at: 9, word: 'trusting' },
      ],
      crossUp: {
        2: 'Her shoulders ease by a quarter inch.',
        3: 'Something in her has begun to lean toward me.',
        4: 'She is here with me, in the way a mother is here.',
      },
      crossDown: {
        2: 'Her shoulders cinch again. The door is in my face.',
        1: 'She has gone behind her eyes. I am not in this with her.',
        0: '~~She has put me out of her room.~~ She has put me out without standing up.',
      },
    },
    lucidity: {
      initial: 0, min: 0, max: 10, label: 'lucidity', kind: 'positive',
      bands: [
        { at: 0, word: 'far away' },
        { at: 2, word: 'fogged' },
        { at: 5, word: 'stirring' },
        { at: 7, word: 'clear-eyed' },
        { at: 9, word: 'lucid' },
      ],
      crossUp: {
        2: 'Her eyes have come up off the blanket.',
        3: 'She is in the room with me. Partly.',
        4: '!!She has remembered where she is.!!',
      },
      crossDown: {
        1: 'She has slipped under again.',
        0: 'Her eyes are gone. ~~For now.~~',
      },
    },
    grip: {
      initial: 6, min: 0, max: 10, label: 'grip', kind: 'negative',
      bands: [
        { at: 0, word: 'hands open' },
        { at: 3, word: 'resting on the handle' },
        { at: 5, word: 'tight' },
        { at: 7, word: 'white-knuckled' },
        { at: 9, word: 'fused to it' },
      ],
      crossUp: {
        2: 'Her hands have tightened on the handle.',
        3: 'Her arms are rigid. The pram is hers and only hers.',
        4: '!!Her hands have stopped being hands.!!',
      },
      crossDown: {
        3: 'Her arms ease by a degree.',
        2: 'Her fingers have loosened on the handle.',
        1: 'Her hands are her own again. She has set them down.',
        0: 'Her hands are open in her lap.',
      },
    },
    agitation: {
      initial: 1, min: 0, max: 10, label: 'agitation', kind: 'negative',
      bands: [
        { at: 0, word: 'calm' },
        { at: 3, word: 'uneasy' },
        { at: 6, word: 'agitated' },
        { at: 8, word: 'angry' },
        { at: 10, word: 'furious' },
      ],
      crossUp: {
        1: 'Her humming has changed pitch.',
        2: 'Her rocking has gone off-beat. She is hearing something I cannot.',
        3: 'Her anger has turned to fury.',
        4: '!!She has gone somewhere I cannot follow.!!',
      },
      crossDown: {
        2: 'The worst of it has passed. Her breath has come back.',
        1: 'She is no longer furious. Only angry.',
        0: 'She has calmed.',
      },
    },
  },
  initialize(patient, player) {
    patient.scales.tenderness = r(1, 2);
    patient.scales.grip       = r(6, 8);
    patient.scales.lucidity   = 0;
    patient.scales.agitation  = r(1, 3);
    if (player.scars?.includes('taken'))     patient.scales.tenderness = Math.max(0, patient.scales.tenderness - 1);
    if (player.scars?.includes('abandoned')) patient.scales.grip       = Math.min(10, patient.scales.grip + 1);
  },

  fileReveals: [
    { announce: 'A line of her file fills itself in. ~~The pram is empty.~~ The contents have not been weighed.' },
    { announce: 'Another, in my hand. **She has not been told.**' },
    { announce: 'The last line writes itself. ~~She meant herself.~~' },
  ],

  presented(p) {
    const t = p.scales.tenderness;
    const g = p.scales.grip;
    const l = p.scales.lucidity;
    const a = p.scales.agitation;
    let arms;
    if (a >= 7)      arms = '!!Her arms are rigid. She rocks the pram so fast the room moves with her.!!';
    else if (g >= 7) arms = 'She rocks the pram quickly. Her arms are tight around the handle.';
    else if (g >= 4) arms = 'She rocks the pram. Steady. The wheels do not turn.';
    else if (g >= 1) arms = 'Her hands rest on the pram. She has mostly stopped rocking.';
    else             arms = 'Her hands are open. The pram is between her feet.';
    let eyes;
    if (l >= 7)      eyes = 'Her eyes are on me. On me. She has not blinked.';
    else if (l >= 4) eyes = 'Her eyes find the middle distance. They leave the pram sometimes.';
    else if (a >= 5) eyes = 'Her eyes are somewhere I cannot follow. Fixed and far.';
    else             eyes = 'She does not look up. Her eyes are on the blanket.';
    let mood;
    if (a >= 7)      mood = 'Her humming has gone off the song. !!She is hearing someone I am not.!!';
    else if (t >= 7) mood = 'She has been waiting for someone. ~~Me?~~ For someone.';
    else if (t >= 4) mood = 'Her shoulders are not so tight. She hums, sometimes. Quietly.';
    else if (t >= 2) mood = 'She hums under her breath. The song is from before.';
    else             mood = 'She does not seem to know I am here.';
    return `${arms} ${eyes} ${mood}`;
  },

  verbs: {

    // ─── always available: two low-risk reads ────────────────────────

    watch_her: {
      label: 'watch her',
      desc: 'Sit at the door. Observe. Let her be in the room first.',
      respond(p) {
        const reps = streakCount(p, 'watch_her');
        if (reps >= 2) {
          return {
            lines: [
              'I watch again. She has noticed someone watching.',
              'Her humming stops. Her arms tighten. Her eyes do not move.',
              '~~She is performing for someone.~~ She is performing for someone in this room I cannot see.',
            ],
            scales: { grip: +1, agitation: +1 },
            composure: -1,
            composureCost: 'Her humming has changed key. ~~It is the key staff use to find her.~~',
          };
        }
        if (reps >= 1) {
          return {
            lines: [
              'I watch a while longer. The rhythm of her rocking has a count to it. Three short, one long.',
              'Her humming changes pitch when the wheels click. ~~She is in a song I cannot hear yet.~~',
            ],
            scales: { lucidity: +1 },
          };
        }
        return {
          lines: [
            'I do not move from the door. I let her be in the room first.',
            'I watch how she holds the handle. I watch which side of the pram she favors. I watch the wheels that do not turn.',
          ],
          scales: { lucidity: +1 },
        };
      },
    },

    sit_near: {
      label: 'sit near her',
      desc: 'Lower yourself to the floor at a polite distance.',
      respond(p) {
        const reps = streakCount(p, 'sit_near');
        if (p.scales.agitation >= 6) {
          return {
            lines: [
              'I lower myself to the floor near her. She stiffens. Her rocking goes wrong.',
              '!!Her humming has gone up half a step. She is hearing me as a stranger.!!',
            ],
            scales: { agitation: +1, grip: +1 },
            composure: -1,
            composureCost: 'Her arms have closed around the pram. ~~Something between us has shut.~~',
          };
        }
        if (reps >= 2) {
          return {
            lines: [
              'I am very close now. She has stopped humming for a moment.',
              'She leans in my direction. Almost. She does not look at me.',
            ],
            scales: { tenderness: +2, grip: -1 },
          };
        }
        return {
          lines: [
            'I sit on the floor a few feet from the chair. Close, but not crowding.',
            'Her shoulders drop a quarter of an inch. She does not look at me. She does not stop me.',
          ],
          scales: { tenderness: +1, lucidity: +1 },
        };
      },
    },

    // ─── contextual: opened by state, closed by it ─────────────────────

    rock_with_her: {
      label: 'rock with her',
      desc: 'Match her rhythm. Quietly.',
      when: (p) => p.scales.tenderness >= 3 && p.scales.agitation <= 5,
      respond(p) {
        const reps = streakCount(p, 'rock_with_her');
        if (reps >= 3) {
          return {
            lines: [
              'I rock with her again. And again. ~~The rhythm has become~~ The rhythm has become a thing we are doing together.',
              'Her face has not changed. She has stopped giving back.',
            ],
            scales: { tenderness: -1, agitation: +1 },
            composure: -1,
            composureCost: 'Her face has gone wrong. ~~I can hear the door behind me.~~',
          };
        }
        if (p.scales.grip >= 7) {
          return {
            lines: [
              'I rock with her. Her tempo is fast. I match it.',
              'She does not slow. She does not speed. But she is no longer alone with it.',
            ],
            scales: { tenderness: +2, grip: -1 },
          };
        }
        if (p.scales.tenderness >= 5) {
          return {
            lines: [
              'I rock alongside her. Her shoulders drop. Her humming finds my shoulder. She lets me into the rhythm.',
              'After a while we are not two people, exactly. We are a slower thing.',
            ],
            scales: { tenderness: +2, grip: -2, lucidity: +1 },
          };
        }
        return {
          lines: [
            'I sit on the floor and match her tempo. It catches me before I find it.',
            'After a while she is rocking with me, not despite me.',
          ],
          scales: { tenderness: +1, grip: -1 },
        };
      },
    },

    hum_along: {
      label: 'hum along',
      desc: 'Pick up the line she keeps starting.',
      when: (p) => p.scales.grip >= 5 && p.scales.agitation <= 5 && p.scales.tenderness >= 2,
      respond(p) {
        const reps = streakCount(p, 'hum_along');
        if (reps >= 2) {
          return {
            lines: [
              'I keep humming. She has stopped. I am the only one in the song now.',
              'She watches my mouth. ~~She does not know what I am asking for.~~',
            ],
            scales: { grip: +1, agitation: +1 },
            composure: -1,
            composureCost: 'I have learned a song I did not come in knowing.',
          };
        }
        if (p.scales.grip >= 8) {
          return {
            lines: [
              'I find the line she keeps starting. I hum a bar of it. She stops.',
              'Her eyes flick to me. She does not pick the song up where I left it. She starts it again from the beginning. Slower.',
            ],
            scales: { grip: -2, tenderness: +2 },
          };
        }
        return {
          lines: [
            'I hum the bar she keeps coming back to. She meets me on the second beat.',
            'We hold it together a while. Her arms loosen slightly around the pram.',
          ],
          scales: { grip: -1, agitation: -1, tenderness: +1 },
        };
      },
    },

    touch_blanket: {
      label: 'touch the blanket',
      desc: 'Gentle. Lay a hand on the bundle. ~~She does not always let you.~~',
      when: (p) => p.scales.tenderness >= 4 && p.scales.grip <= 4,
      respond(p) {
        const reps = streakCount(p, 'touch_blanket');
        if (reps >= 2) {
          return {
            lines: [
              'I touch the blanket again. She pulls the pram against her chest.',
              '!!She has decided I am the wrong person.!!',
            ],
            scales: { grip: +3, tenderness: -2, agitation: +2 },
            composure: -2,
            composureCost: 'The rocking is the only sound. It is the worst sound.',
          };
        }
        if (p.scales.grip >= 4) {
          return {
            lines: [
              'My hand rests on the blanket. It is cold under my palm.',
              'She stiffens but does not move my hand. She watches it. Carefully. As if it might do something on its own.',
            ],
            scales: { grip: -1, agitation: +1 },
            composure: -1,
            composureCost: 'The room is fast now. Faster than I am.',
          };
        }
        return {
          lines: [
            'My hand on the blanket. ~~There is nothing under it.~~ There is something under it.',
            'She looks at my hand. Then at me. She does not pull away.',
            'Something quiet passes between us. ~~She has been waiting for someone to verify.~~',
          ],
          scales: { grip: -2, lucidity: +2, tenderness: +1 },
        };
      },
    },

    look_inside: {
      label: 'look inside',
      desc: 'Lift the corner of the blanket. Let her see you see.',
      when: (p) => p.scales.grip <= 3 && p.scales.tenderness >= 6 && p.scales.lucidity >= 3,
      respond(p) {
        return {
          lines: [
            'I lift the corner of the blanket. She does not stop me.',
            'The blanket has been folded over itself. Neatly. ~~There is something there.~~ There is nothing under it.',
            'She watches my face. She is watching to see if I will pretend.',
            'I do not pretend. ~~I have nothing here to pretend at.~~',
            'Something happens in her face. Slowly. On her own time.',
          ],
          scales: { lucidity: +4, grip: -3, agitation: -1, tenderness: +1 },
          flags: { saw_inside: true },
        };
      },
    },

    name_the_child: {
      label: 'name the child',
      desc: 'Speak a name. ~~Yours.~~ Someone\'s.',
      when: (p) => p.scales.lucidity >= 4 && p.scales.agitation <= 4,
      respond(p) {
        const reps = streakCount(p, 'name_the_child');
        if (reps >= 1) {
          return {
            lines: [
              'I say another name. A different one this time.',
              'She does not look up. ~~She is past names.~~ She is past being named.',
            ],
            scales: { agitation: +2, lucidity: -1 },
            composure: -1,
            composureCost: 'Her humming has changed key. ~~It is a key staff use to find her.~~',
          };
        }
        if (p.scales.grip >= 7) {
          return {
            lines: [
              'I say a name. ~~Mine.~~ A name.',
              'Her arms cinch. Her humming stops. Somewhere behind her eyes she is leaving the room.',
              '!!She will not come back from this soon.!!',
            ],
            scales: { grip: +2, tenderness: -3, agitation: +4, lucidity: -2 },
            composure: -2,
            composureCost: 'Her arms have closed around the pram. ~~Something between us has shut.~~',
            flags: { spiked: true },
          };
        }
        if (p.scales.lucidity >= 6 || p.scales.tenderness >= 7) {
          return {
            lines: [
              'I say a name. It is one I half-remember.',
              'She repeats it. Quietly. She turns it in her mouth like a stone.',
              'She looks at the pram. She looks at me. ~~She sees the difference.~~ She sees.',
            ],
            scales: { lucidity: +3, grip: -2, tenderness: +1 },
          };
        }
        return {
          lines: [
            'I say a name. She does not answer to it. But she looks up.',
            'Her eyes are not all the way here. But they are not all the way gone either.',
          ],
          scales: { lucidity: +2, agitation: +1 },
        };
      },
    },

    tell_her_my_name: {
      label: 'tell her my name',
      desc: 'Speak yourself. Plainly. As someone from outside.',
      when: (p) => p.scales.agitation >= 5 || (p.scales.lucidity >= 5 && p.scales.tenderness <= 5),
      respond(p) {
        if (p.scales.agitation >= 7) {
          return {
            lines: [
              'I crouch in front of her. I say: !!I am Patient 0413. I came in this morning. I am not from before.!!',
              'Her rocking slows by a half. She is hearing me, partially. Her eyes flicker to my coat, my hands, my coat again.',
            ],
            scales: { agitation: -3, lucidity: +2 },
            composure: -1,
            composureCost: 'Her face has gone wrong. ~~I can hear the door behind me.~~',
          };
        }
        return {
          lines: [
            'I tell her my name and my number. I tell her this is the third floor.',
            'She nods. She does not stop rocking. But she is, slightly, in the same room.',
          ],
          scales: { lucidity: +2, tenderness: +1, agitation: -1 },
        };
      },
    },

    step_away: {
      label: 'step away',
      desc: 'Back off. Give her the room. ~~It costs to be useless.~~',
      when: (p) => p.scales.agitation >= 6,
      respond(p) {
        return {
          lines: [
            'I stand and back up to the door. I keep my eyes on her shoes, not her face.',
            p.scales.agitation >= 8
              ? 'After a long time her humming returns. Her tempo slows. The room widens again.'
              : 'The room loosens by a degree. Her humming returns. A little.',
          ],
          scales: { agitation: -3, tenderness: -1 },
          composure: -2,
          composureCost: 'I have done something I cannot take back.',
        };
      },
    },

    take_pram: {
      label: 'take the pram',
      desc: 'Force. Lift it from her hands. ~~She does not always let you.~~',
      when: (p) => p.scales.agitation >= 7 || (p.scales.tenderness >= 7 && p.scales.grip <= 3),
      respond(p) {
        return {
          lines: [
            'I close my hands over the handle. Her hands are over the handle. I lift.',
            p.scales.agitation >= 6
              ? '!!She screams without sound.!! She does not let go quickly. When she does her hands stay in the shape of holding.'
              : (p.scales.tenderness >= 5
                  ? 'She resists for a moment. Then her hands let go. She watches mine.'
                  : 'Her hands resist longer than I expect. Then her fingers loosen, one at a time. She does not look at me.'),
            'I am holding the pram now. She is not.',
          ],
          scales: { grip: -10, agitation: p.scales.tenderness >= 5 ? 0 : +2 },
          composure: p.scales.tenderness >= 5 ? -1 : -2,
          flags: { took_pram: true },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Let the rocking run on its own. ~~No one comes.~~',
    when: (p) => p.scales.agitation >= 5 || p.scales.grip >= 7 || p.turn >= 4,
  },

  // ─── interjections — patient-initiated turns ─────────────────────────
  // Five authored; only some fire in a given run. Each one is a small
  // hinge — its responses sometimes cost composure even when "right".

  interjections: [
    {
      id: 'are_you_here_for_me',
      once: true,
      when: (p) => p.scales.tenderness >= 5 && p.scales.grip <= 5 && p.turn >= 2,
      prose: [
        'She stops rocking. She looks up. For the first time since I came in.',
        'She says, quietly: ~~Are you here for me?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'Tell her yes. Lie or not.',
          lines: [
            'I say: yes.',
            'Her shoulders drop. She breathes. Her hands stay on the handle but they have gone slack.',
            '~~She has been waiting a long time.~~',
          ],
          scales: { tenderness: +3, grip: -2, agitation: -1 },
          composure: -1,
          composureCost: 'The rocking is the only sound. It is the worst sound.',
        },
        {
          label: 'no, I came for someone else',
          desc: 'A softer truth.',
          lines: [
            'I say: no. I came for someone else. I will sit with you while I wait.',
            'She nods. Her face does not change. But the rocking slows by half.',
          ],
          scales: { lucidity: +2, grip: -1, tenderness: -1 },
        },
        {
          label: "I don't know",
          desc: 'The most honest answer.',
          lines: [
            'I say: I do not know.',
            'She does not seem surprised. She keeps rocking. She says, mostly to herself: ~~Neither did I.~~',
          ],
          scales: { lucidity: +3, tenderness: +1 },
        },
      ],
    },

    {
      id: 'shes_sleeping',
      once: true,
      when: (p) => p.scales.grip >= 8 && p.turn >= 3,
      prose: [
        'She pauses the rocking. She covers the blanket with her free hand. Protective.',
        'She looks past me at the door, then to me. She whispers: !!She is sleeping. Yes?!!',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'Agree. Let her keep the world she has.',
          lines: [
            'I nod. I say: yes. She is sleeping.',
            'Her rocking finds a slower rhythm. Her shoulders ease. She goes on humming the same five notes.',
            '~~She has not been told.~~',
          ],
          scales: { grip: -1, agitation: -2 },
          scars: ['named'],
        },
        {
          label: 'her arms must be tired',
          desc: 'Redirect, without lying.',
          lines: [
            'I say: your arms must be tired. You have been rocking a long time.',
            'She looks at her own arms as if she has just noticed them.',
            'After a moment she sets them down on the handle and does not lift them again.',
          ],
          scales: { grip: -3, lucidity: +2, tenderness: +1 },
        },
        {
          label: "I don't know",
          desc: 'Do not tell her either way.',
          lines: [
            'I say: I do not know.',
            'She watches me. Her face has shifted. She is preparing for something.',
          ],
          scales: { lucidity: +1, agitation: +3, grip: +1 },
          composure: -1,
          composureCost: 'The room is fast now. Faster than I am.',
        },
      ],
    },

    {
      id: 'do_I_know_you',
      once: true,
      when: (p) => p.scales.lucidity >= 5 && p.scales.tenderness >= 5,
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
            'She relaxes. Just a little. She does not check. But she does not look at me with full eyes again, after.',
          ],
          scales: { tenderness: +3, lucidity: -3 },
          scars: ['named'],
          composure: -1,
          composureCost: 'Her humming has changed key. ~~It is the key staff use to find her.~~',
        },
        {
          label: "I'm here either way",
          desc: 'Sidestep.',
          lines: [
            'I say: it does not matter. I am here either way.',
            'She nods slowly. She is not sure that is true. She keeps rocking.',
          ],
          scales: { tenderness: +1, lucidity: +1 },
        },
      ],
    },

    {
      id: 'whose_was_she',
      once: true,
      when: (p) => p.scales.lucidity >= 6 && p.scales.grip <= 4 && p.turn >= 4,
      prose: [
        'She has stopped humming. She looks at the blanket. Then at me.',
        'She asks: ~~Whose was she?~~',
      ],
      responses: [
        {
          label: 'yours',
          desc: 'Name it. Let her have the answer.',
          lines: [
            'I say: she was yours.',
            'She nods. ~~Slowly.~~ She nods. She puts her face in her hand.',
            '!!The sound she makes is small, and very old.!!',
          ],
          scales: { lucidity: +3, tenderness: +2, grip: -2 },
          composure: -1,
          composureCost: 'Her arms have closed around the pram. ~~Something between us has shut.~~',
        },
        {
          label: "I don't know",
          desc: 'Do not claim. Do not deny.',
          lines: [
            'I say: I do not know. Tell me about her.',
            'She does. For a long time.',
            '~~For as long as the file allows.~~ For as long as she has.',
          ],
          scales: { lucidity: +2, tenderness: +1, grip: -1 },
        },
        {
          label: "someone's",
          desc: 'Soften it.',
          lines: [
            'I say: someone\'s. Someone you loved.',
            'She nods. She takes that. But her eyes have gone past me, to the window.',
          ],
          scales: { tenderness: +1, lucidity: -1, grip: +1 },
        },
      ],
    },

    {
      id: 'the_song_louder',
      once: true,
      when: (p) => p.scales.agitation >= 6 && p.scales.grip >= 6,
      prose: [
        'She has started humming louder. Faster. Her rocking is at the wrong tempo.',
        '!!She is shushing something.!! ~~It is not a lullaby.~~ It is not what it was.',
      ],
      responses: [
        {
          label: 'shhh with her',
          desc: 'Meet her where she is.',
          lines: [
            'I shhh with her. Quietly. With the same rhythm.',
            'She does not stop. But the volume drops by half.',
          ],
          scales: { agitation: -2, tenderness: +1 },
          composure: -1,
          composureCost: 'Her face has gone wrong. ~~I can hear the door behind me.~~',
        },
        {
          label: 'put a hand on hers',
          desc: 'Risk contact. Stop the rhythm.',
          lines: [
            'I put my hand over hers on the handle. She does not pull away.',
            '!!Her humming stops for a beat.!! ~~She is listening.~~ She is listening for something else.',
          ],
          scales: { grip: -2, agitation: -3, lucidity: +1 },
          composure: -1,
          composureCost: 'I have done something I cannot take back.',
        },
        {
          label: 'say nothing',
          desc: 'Let her run through it.',
          lines: [
            'I do not move. I let the song run.',
            'It gets louder before it gets quieter. ~~It does get quieter.~~ Eventually.',
          ],
          scales: { agitation: +1, grip: +1 },
          composure: -2,
          composureCost: 'The rocking is the only sound. It is the worst sound.',
        },
      ],
    },
  ],

  // ─── drift on WAIT ───────────────────────────────────────────────────
  // Drift is harsh by default. Bad scales trend up; composure leaks if the
  // room is stuck. Calm middle states are the only place WAIT is gentle.

  drift(p, player) {
    const a = p.scales.agitation;
    const g = p.scales.grip;
    const t = p.scales.tenderness;
    if (a >= 6) {
      return {
        lines: [
          'I wait. She rocks harder. The wheels click against the floor. She does not see the room.',
          '~~Her humming has become~~ Her humming is a hum I can hear in my teeth.',
        ],
        scales: { agitation: +2, grip: +1, tenderness: -1 },
        composure: -1,
        composureCost: 'The room is fast now. Faster than I am.',
      };
    }
    if (g >= 7) {
      return {
        lines: [
          'I wait. She tucks the blanket in. She tucks it in again. She tucks it in again.',
          'Her arms do not tire.',
        ],
        scales: { grip: +1, agitation: +1 },
        composure: -1,
        composureCost: 'Her humming has changed key. ~~It is a key staff use to find her.~~',
      };
    }
    if (t >= 5 && g <= 4) {
      return {
        lines: [
          'I wait. She rocks slower. A long time passes.',
          'Her eyes leave the pram. She watches the wall. Her hands forget the rhythm, briefly.',
        ],
        scales: { lucidity: +1, tenderness: +1 },
      };
    }
    return pick([
      { lines: ['She rocks faster. Then slower. Her arms tighten and ease.'], scales: { grip: +1, agitation: +1 } },
      { lines: ['She pauses. She looks at the pram, sidelong, like she has just remembered something.'], scales: { lucidity: +1, agitation: +1 } },
      { lines: ['I wait. Nothing changes. ~~A long time passes.~~ A while passes. It is not pleasant.'], scales: { agitation: +1 }, composure: -1 },
    ]);
  },

  // ─── endings ─────────────────────────────────────────────────────────
  // Two real victories — each needs two scales in the right place AND at
  // least some of the file uncovered. The rest are failures, force-states,
  // or timeout.

  endings: [
    {
      id: 'lets_go',
      when: (p) => p.scales.lucidity >= 9 && p.scales.grip <= 2 && p.scales.agitation <= 4,
      title: 'She lets it go herself',
      lines: [
        'She looks at the pram. She looks at me. ~~She sees what is there.~~ She sees what is not.',
        'She lifts the blanket. She folds it. She folds it again. She sets it on the seat of the pram.',
        'She puts her hands in her lap. She does not weep. She sits a long time without rocking.',
        '!!Something quiet has been done here. She did it.!!',
      ],
      item: 'worn_ribbon',
    },
    {
      id: 'lets_take',
      when: (p) => p.scales.tenderness >= 9 && p.scales.grip <= 2 && p.scales.lucidity >= 5 && !p.flags.took_pram,
      title: 'She lets you take it',
      lines: [
        'She lifts the bundle out of the pram. She puts it in my arms. She is careful with what is not there.',
        'Her hands stay open for a long time after. She does not put them down.',
        'The room is very quiet.',
      ],
      item: 'handkerchief',
    },
    {
      id: 'broke',
      when: (p) => p.scales.agitation >= 10,
      title: 'She breaks',
      lines: [
        'She is rocking and rocking. She does not see me. She does not see the room.',
        'She has gone somewhere I cannot follow. The pram is in her arms still. Her hands are the shape of the handle.',
        '!!I close the door behind me. Softly. She does not notice.!!',
      ],
      item: null,
      scars: ['witnessed', 'failed'],
    },
    {
      id: 'forced',
      when: (p) => p.flags.took_pram,
      title: 'You take it from her',
      lines(p) {
        if (p.scales.tenderness >= 6 && p.scales.agitation <= 3) {
          return [
            'I have the pram. She lets me. She does not look at me.',
            'Her hands are open. She does not know what to do with them.',
            '~~She will not be alright.~~ She will be alright.',
          ];
        }
        return [
          'I have the pram. She did not let me. Her hands are still in the shape of the handle.',
          'She weeps without sound. She will not look at me.',
          '!!I close the door behind me. She does not stop rocking.!!',
        ];
      },
      item: 'black_coin',
      scars(p) { return (p.scales.tenderness >= 6 && p.scales.agitation <= 3) ? [] : ['taken']; },
    },
    {
      id: 'she_stays',
      when: (p) => p.turn >= 14 && p.scales.lucidity < 6,
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
      lines: [
        'I close the door. She keeps rocking. ~~She never knew I was in the room.~~',
      ],
      item: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════
// THE FATHER IN THE CHAIR — Patient 0091
// ════════════════════════════════════════════════════════════════════════

const pyrelord = {
  id: 'pyrelord',
  name: '[The Chair]',
  glyph: 'Pyrelord',
  subtitle: 'He still presides.',
  role: 'wing', tier: 2,
  file: [
    'Subject was pronounced deceased on [[8]]. Subject continues to occupy the chair.',
    'Family ~~visit weekly~~ are summoned weekly. Subject addresses them by name.',
    'Subject has requested his belt. !!The request is on permanent file.!!',
  ],
  intro: [
    'He is in the chair. He was in the chair when I came in. ~~He chose it.~~ I did not choose this room.',
    'He is watching the door. He is waiting for someone. He has not noticed me yet.',
  ],

  scales: {
    presence: {
      initial: 8, min: 0, max: 10, label: 'presence', kind: 'negative',
      bands: [
        { at: 0, word: 'small in the chair' },
        { at: 3, word: 'composed' },
        { at: 5, word: 'presiding' },
        { at: 7, word: 'imperial' },
        { at: 9, word: 'absolute' },
      ],
      crossUp: {
        3: 'His weight settles the room again. ~~I am a guest.~~',
        4: 'The room has chosen its master. It is not me.',
      },
      crossDown: {
        2: 'The chair has begun to be a chair.',
        1: 'He is small. ~~He was always small.~~ It took years to see.',
        0: 'He is just a man in a chair.',
      },
    },
    grief: {
      initial: 2, min: 0, max: 10, label: 'grief', kind: 'positive',
      bands: [
        { at: 0, word: 'composed' },
        { at: 2, word: 'unsteady' },
        { at: 5, word: 'stirring' },
        { at: 7, word: 'rising' },
        { at: 9, word: 'spilling' },
      ],
      crossUp: {
        2: 'His hands have begun to shake.',
        3: 'Something in him has come loose.',
        4: '!!He is weeping without sound.!!',
      },
      crossDown: {
        1: 'He has folded the grief back away.',
        0: 'He is composed again. Nothing is the matter.',
      },
    },
    recognition: {
      initial: 0, min: 0, max: 10, label: 'recognition', kind: 'positive',
      bands: [
        { at: 0, word: 'looking past me' },
        { at: 2, word: 'glancing' },
        { at: 5, word: 'placing me' },
        { at: 7, word: 'seeing me' },
        { at: 9, word: 'all the way here' },
      ],
      crossUp: {
        2: 'His eyes have come off the door. Briefly. To me.',
        3: 'He is taking my face in. ~~For the first time.~~',
        4: '!!He is here. All the way here.!!',
      },
      crossDown: {
        1: 'His eyes have gone back to the door.',
      },
    },
  },
  initialize(p, player) {
    p.scales.presence    = r(7, 9);
    p.scales.grief       = r(1, 3);
    p.scales.recognition = 0;
    if (player?.scars?.includes('named'))    p.scales.presence = Math.min(10, p.scales.presence + 1);
    if (player?.scars?.includes('witnessed')) p.scales.recognition = Math.max(0, p.scales.recognition - 0);
  },

  fileReveals: [
    { announce: 'A line writes itself in. ~~He has been deceased since [[8]].~~' },
    { announce: 'Another. ~~Family are summoned. They have not refused.~~' },
    { announce: 'The last line, in my hand. **He has requested his belt.**' },
  ],

  presented(p) {
    const pr = p.scales.presence;
    const g  = p.scales.grief;
    const re = p.scales.recognition;
    let chair;
    if (pr >= 8)      chair = 'He sits in the chair as if it has always been his. His weight settles the room.';
    else if (pr >= 5) chair = 'He sits in the chair. Less easily than before. The room is still arranged around him.';
    else if (pr >= 2) chair = 'He is in the chair. Smaller now. The room has begun to be a room.';
    else              chair = 'He is small in the chair. It does not fit him.';
    let eyes;
    if (re >= 7)      eyes = 'His eyes are on me. All the way. He knows it is me.';
    else if (re >= 4) eyes = 'His eyes find me sometimes. Then leave for someone he is expecting.';
    else if (re >= 1) eyes = "He glances at me as if at a stranger's coat in his hallway.";
    else              eyes = 'He is looking at someone who is not in the room.';
    let hands;
    if (g >= 7)      hands = 'His hands are folded so tightly they have stopped shaking.';
    else if (g >= 4) hands = 'His hands are folded in his lap. Unsteady.';
    else if (g >= 1) hands = 'His hands are at rest on the arms of the chair.';
    else             hands = 'His hands sit composed on the arms of the chair. Perfect.';
    return `${chair} ${eyes} ${hands}`;
  },

  verbs: {

    listen_to_him: {
      label: 'listen to him',
      desc: 'Attend to what he is saying. Stay quiet.',
      respond(p) {
        const reps = streakCount(p, 'listen_to_him');
        if (reps >= 3) {
          return {
            lines: [
              'I have been listening a long time. ~~He is repeating himself.~~ He is repeating himself, word for word.',
              'He notices my attention has gone glassy. His voice loses certainty for the first time.',
            ],
            scales: { presence: -2, grief: +1 },
          };
        }
        return {
          lines: [
            'I let him speak. I do not interrupt. I do not look away.',
            'He is dictating a letter to a clerk who is not in the room. The letter is to one of his daughters.',
            'He keeps losing his place and starting over. The salutation has changed twice.',
          ],
          scales: { recognition: +1, grief: +1 },
        };
      },
    },

    hold_position: {
      label: 'hold the door',
      desc: 'Stand silent at the threshold. Decline to acknowledge.',
      respond(p) {
        if (p.scales.presence >= 7) {
          return {
            lines: [
              'I do not enter the room as a guest. I stand at the door. I do not address him.',
              'His eyes find me briefly. They do not find what they wanted there.',
            ],
            scales: { presence: -2 },
          };
        }
        return {
          lines: [
            'I hold the door. The room is, marginally, mine to leave.',
            'He speaks toward the wall. ~~The wall is also a daughter.~~ The wall does not answer either.',
          ],
          scales: { presence: -1, recognition: +1 },
        };
      },
    },

    kneel: {
      label: 'kneel',
      desc: 'Put yourself lower than him. ~~It costs.~~',
      when: (p) => p.scales.presence >= 6,
      respond(p) {
        if (p.scales.presence >= 8) {
          return {
            lines: [
              'I kneel beside the chair. I look up at him.',
              'He does not look down. He is satisfied this is the correct shape of a room. His hand finds the top of my head. Briefly. Paternal.',
            ],
            scales: { presence: +1, grief: +1 },
            composure: -2,
            composureCost: 'His quiet is the worst sound in the room.',
          };
        }
        return {
          lines: [
            'I kneel. He does not understand why.',
            'After a moment he reaches out and pats my shoulder. He calls me by a name. ~~It is not mine.~~',
          ],
          scales: { recognition: +1, grief: +1 },
          composure: -1,
          composureCost: 'His hand on my wrist is very cold.',
        };
      },
    },

    interrupt: {
      label: 'speak over him',
      desc: 'Cut into his sentence. Take the air.',
      when: (p) => p.scales.presence >= 5,
      respond(p) {
        const reps = streakCount(p, 'interrupt');
        if (reps >= 2) {
          return {
            lines: [
              'I interrupt again. And again. He goes quiet.',
              'His quiet is the worst sound in the room. ~~I have done something wrong.~~',
            ],
            scales: { grief: +2, recognition: -1 },
            composure: -2,
            composureCost: '!!The chair is larger than it should be.!!',
          };
        }
        if (p.scales.presence >= 7) {
          return {
            lines: [
              'I speak over him. !!Loudly.!! The word LISTEN has its own room briefly.',
              'He stops. He looks at me. For the first time he is not above the room. For a moment he is just in it.',
            ],
            scales: { presence: -2, recognition: +1 },
            composure: -1,
            composureCost: 'I am a guest. I am only a guest.',
          };
        }
        return {
          lines: [
            'I speak over him. He does not protest.',
            'He was not saying anything I had not heard. He was saying it to no one in particular.',
          ],
          scales: { presence: -2, grief: +1 },
        };
      },
    },

    ask_his_name: {
      label: 'ask his name',
      desc: 'Gently. As if you had not been told it.',
      when: (p) => p.scales.presence <= 6 && p.scales.recognition >= 2,
      respond(p) {
        return {
          lines: [
            'I ask: what should I call you?',
            p.scales.presence >= 6
              ? "He gives me the family's honorific. Without hesitation. It is well-rehearsed."
              : 'He pauses. It has been a while since anyone asked. He gives me his given name. Quietly.',
          ],
          scales: { recognition: +2, presence: -1 },
        };
      },
    },

    call_by_name: {
      label: 'call him by name',
      desc: 'His given name. Not "father". Not "sir".',
      when: (p) => p.scales.recognition >= 5,
      respond(p) {
        const reps = streakCount(p, 'call_by_name');
        if (reps >= 1) {
          return {
            lines: [
              'I say the name again. He had only just been the man who answered to it.',
              'I am asking too much of him too fast.',
            ],
            scales: { grief: +1, recognition: -1 },
            composure: -1,
            composureCost: 'The door does not need to be watched. ~~It does anyway.~~',
          };
        }
        if (p.scales.recognition >= 7) {
          return {
            lines: [
              'I say it. His given name. The one his mother used.',
              'He turns toward me. All the way. ~~He is here.~~ He is here.',
              'His eyes fill. He does not speak.',
            ],
            scales: { recognition: +3, grief: +3, presence: -3 },
          };
        }
        return {
          lines: [
            'I say it. His given name.',
            'He frowns. He is trying to remember if anyone calls him that.',
            'Something passes through him. He does not speak for a moment.',
          ],
          scales: { recognition: +2, grief: +1, presence: -1 },
        };
      },
    },

    touch_his_hand: {
      label: 'touch his hand',
      desc: 'A small contact. Nothing more.',
      when: (p) => p.scales.grief >= 5 && p.scales.recognition >= 4,
      respond(p) {
        return {
          lines: [
            'I put my hand over his on the arm of the chair. His hand is dry and very still.',
            p.scales.recognition >= 6
              ? 'He turns his hand and holds mine back. Firmly. The grip is the grip of someone holding onto a railing.'
              : 'He does not move his hand. But he does not move it away.',
          ],
          scales: { grief: +2, recognition: +1, presence: -1 },
        };
      },
    },

    sit_in_chair: {
      label: 'sit in the chair',
      desc: 'Lift him out. Take the seat. Claim the room.',
      when: (p) => p.scales.presence <= 3,
      respond(p) {
        if (p.scales.presence <= 1) {
          return {
            lines: [
              'I help him out of the chair. He is light. He goes without protest.',
              'I sit. The chair fits. The room composes itself around me.',
              'He stands a while, then sits on the floor at my feet. Like a guest.',
              '!!The room is mine now.!!',
            ],
            scales: { presence: -5 },
            composure: -1,
            composureCost: 'He has not blinked. ~~For a long time.~~',
            flags: { sat_in_chair: true },
          };
        }
        return {
          lines: [
            'I take his arm to lift him. He plants his weight.',
            'His hand on my wrist is very cold. ~~I do not force it.~~ Not yet.',
          ],
          scales: { grief: +1, presence: +1 },
          composure: -1,
          composureCost: 'His quiet is the worst sound in the room.',
        };
      },
    },

    close_his_eyes: {
      label: 'close his eyes',
      desc: 'Lay a hand over them. Let him stop watching the door.',
      when: (p) => p.scales.grief >= 6 && p.scales.presence <= 4,
      respond(p) {
        if (p.scales.grief >= 7) {
          return {
            lines: [
              'I close his eyes with my palm. His lashes are dry.',
              'He does not resist. ~~The breath he has been holding for years~~ A long held breath leaves him.',
              'The chair is suddenly too large.',
              '!!The room is a room again.!!',
            ],
            flags: { closed_eyes: true },
            scales: { presence: -4, grief: -2 },
            composure: -1,
            composureCost: 'His hand on my wrist is very cold.',
          };
        }
        return {
          lines: [
            'I reach. He flinches. He is still watching the door for someone.',
            'I lower my hand. !!Not yet.!!',
          ],
          scales: { grief: +1, presence: +1 },
          composure: -1,
          composureCost: '!!The chair is larger than it should be.!!',
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Let him hold the room. Wait him out — or for him to slip.',
    when: (p) => p.scales.presence >= 7 || p.turn >= 5,
  },

  // ─── interjections — five authored, only some fire in any run ───────

  interjections: [
    {
      id: 'young_man',
      once: true,
      when: (p) => p.scales.presence >= 8 && p.turn >= 2,
      prose: [
        'He raises a hand for silence. No one is speaking. He turns his head toward me. Precisely.',
        'He says: ~~Young man.~~ ~~Young woman.~~ — he tries both — !!you may sit.!!',
      ],
      responses: [
        {
          label: 'sit',
          desc: 'Accept his courtesy.',
          lines: [
            'I sit on the chair he indicates. It is a guest chair, set across from his.',
            'He nods, satisfied. The room is shaped correctly again. ~~He has a visitor at last.~~ He has a visitor.',
          ],
          scales: { presence: +2, recognition: +1 },
          composure: -1,
          composureCost: 'I am a guest. I am only a guest.',
        },
        {
          label: 'stay standing',
          desc: 'Do not take the offered place.',
          lines: [
            'I do not sit. I stay where I am.',
            'His hand stays in the air a moment longer than is comfortable. Then he lowers it.',
            'He had not anticipated this. He is, briefly, surprised.',
          ],
          scales: { presence: -2, recognition: +1 },
        },
        {
          label: "I'm not young",
          desc: 'Correct him.',
          lines: [
            'I say: I am not young. ~~Not now.~~ Not anymore.',
            'He looks at me with new eyes. For a moment he is not sure what year it is. For a moment he allows that he is not sure.',
          ],
          scales: { presence: -3, recognition: +2, grief: +1 },
        },
      ],
    },

    {
      id: 'I_had_a_son',
      once: true,
      when: (p) => p.scales.grief >= 5 && p.scales.recognition >= 4,
      prose: [
        'He stops mid-sentence. His eyes track something across the room that is not there.',
        'He says, smaller: ~~I had a son.~~ ~~I had~~ — I think I had a son.',
      ],
      responses: [
        {
          label: 'tell me about him',
          desc: 'Invite the memory.',
          lines: [
            'I ask: what was he like?',
            'He begins. He begins three times. It has been a long time since anyone asked.',
            'After a while his account becomes very specific. A knee scar. A way of saying a particular word.',
            '!!He is here. He is talking about someone real.!!',
          ],
          scales: { grief: +3, recognition: +3, presence: -3 },
          composure: -1,
          composureCost: 'The door does not need to be watched. ~~It does anyway.~~',
        },
        {
          label: 'are you sure?',
          desc: 'Gently doubt the memory.',
          lines: [
            'I ask: are you sure?',
            'He is quiet for a long time. Then he says: ~~no~~ ~~yes~~ ~~I think so.~~',
            'The not-knowing is worse than the knowing.',
          ],
          scales: { grief: +2, presence: -2 },
          composure: -2,
          composureCost: 'He has not blinked. ~~For a long time.~~',
        },
        {
          label: 'I think you did',
          desc: 'Affirm without claiming to know.',
          lines: [
            'I say: I think you did.',
            'He nods, relieved. He looks at me with great attention.',
            '~~He is grateful in a way I did not earn.~~',
          ],
          scales: { recognition: +2, grief: +2, presence: -1 },
          scars: ['named'],
        },
      ],
    },

    {
      id: 'what_do_you_want',
      once: true,
      when: (p) => p.scales.presence <= 3 && p.scales.grief >= 5,
      prose: [
        'He has stopped speaking. His hands are folded in his lap. He looks tired.',
        'He asks, almost without volume: ~~What do you want me to say?~~',
      ],
      responses: [
        {
          label: 'nothing',
          desc: 'Release him from the duty.',
          lines: [
            'I say: nothing.',
            'He sits with that. His hands unfold. He leans back into the chair. It is the first time he has used it as a chair, not as a throne.',
          ],
          scales: { grief: +3, presence: -3 },
        },
        {
          label: 'your name',
          desc: 'Ask for what no one has asked.',
          lines: [
            "I say: your name. The one you do not use anymore.",
            'He stares at the wall. ~~He is afraid he will not find it.~~ He is trying to find it.',
            'Eventually he says it. Quietly. Then again, louder, as if to himself.',
          ],
          scales: { recognition: +3, grief: +1 },
        },
        {
          label: "tell me you're finished",
          desc: 'Gentle. Precise.',
          lines: [
            "I say: tell me you are finished.",
            'He looks up at me. For a long time he does not say anything.',
            'Then he says: ~~yes.~~ ~~I am.~~ His eyes close.',
          ],
          scales: { grief: +4, presence: -4 },
          composure: -1,
          composureCost: 'His quiet is the worst sound in the room.',
        },
      ],
    },

    {
      id: 'the_clerk',
      once: true,
      when: (p) => p.scales.presence >= 7 && p.turn >= 4,
      prose: [
        'He stops dictating. He turns his head slightly. He addresses a corner of the room.',
        'He says: !!Mr. Hargrove — take this down.!! ~~There is no Mr. Hargrove.~~ There is no Mr. Hargrove on the ward.',
      ],
      responses: [
        {
          label: 'pretend to take it down',
          desc: 'Play the clerk.',
          lines: [
            'I take a notepad I do not have. I write nothing on it.',
            'He dictates a paragraph that sounds like the end of something. When he is finished, he nods at me to file it.',
          ],
          scales: { presence: +1, grief: +1, recognition: -1 },
          composure: -1,
          composureCost: 'His hand on my wrist is very cold.',
        },
        {
          label: 'there is no clerk',
          desc: 'Say it.',
          lines: [
            'I say: there is no clerk here. It is only me.',
            'He frowns. He is trying to place me. He is failing.',
            '!!His voice has lost an inch of itself.!!',
          ],
          scales: { presence: -3, recognition: +2, grief: +2 },
          composure: -1,
          composureCost: '!!The chair is larger than it should be.!!',
        },
        {
          label: 'who was Hargrove',
          desc: 'Ask him.',
          lines: [
            'I ask: who was Mr. Hargrove?',
            'He is quiet for a long time. ~~He cannot remember.~~ He is not sure.',
            'Eventually he says: a friend. A long time ago.',
          ],
          scales: { recognition: +2, grief: +2, presence: -1 },
        },
      ],
    },

    {
      id: 'where_are_my_daughters',
      once: true,
      when: (p) => p.scales.grief >= 6 && p.scales.recognition >= 5,
      prose: [
        'His head tilts. He looks at me as if he had only just noticed I was not one of his daughters.',
        'He asks: ~~Where are my daughters?~~',
      ],
      responses: [
        {
          label: "they'll come",
          desc: 'Gentle. Probably a lie.',
          lines: [
            "I say: they'll come.",
            'He nods. He goes back to watching the door.',
            '~~He has been doing this a long time.~~',
          ],
          scales: { presence: +2, recognition: -1, grief: -1 },
          scars: ['named'],
        },
        {
          label: 'they came already',
          desc: 'The more painful truth.',
          lines: [
            "I say: they came. Yesterday. You don't remember.",
            'He sits with that. He looks at his hands. He says: ~~oh.~~ ~~Yes.~~',
            '!!The room is suddenly larger than he is.!!',
          ],
          scales: { presence: -3, grief: +3, recognition: +1 },
          composure: -2,
          composureCost: 'I am a guest. I am only a guest.',
        },
        {
          label: 'tell me their names',
          desc: 'Redirect to what he has.',
          lines: [
            'I say: tell me their names.',
            'He does. One at a time. He says them like a prayer he has kept the form of.',
          ],
          scales: { recognition: +3, grief: +2, presence: -1 },
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.presence >= 7) {
      return pick([
        { lines: ['I wait. He speaks. He is dictating something to a clerk who is not in the room.'], scales: { presence: +1 } },
        { lines: ['I wait. Someone — a daughter? — knocks at the door briefly. She does not come in. He nods, as if she had.'], scales: { presence: +1 }, composure: -1 },
        { lines: ['I wait. He recounts a victory. It is one I have not heard before. It might be true.'], scales: { presence: +2 } },
      ]);
    }
    if (p.scales.recognition >= 4) {
      return {
        lines: [
          'I wait. He turns slowly to look at me.',
          'He says: ~~When did you come in?~~ When did you come in?',
        ],
        scales: { grief: +1, recognition: +1 },
      };
    }
    return {
      lines: ['I wait. The room is still. ~~Someone is at the door.~~ No one is at the door.'],
      scales: { presence: -1 },
    };
  },

  endings: [
    {
      id: 'close_eyes',
      when: (p) => p.flags.closed_eyes && p.scales.grief >= 4 && p.scales.presence <= 2,
      title: 'You let him rest',
      lines: [
        'He is gone. His hands are open in his lap.',
        'The room is a room. The chair is just a chair.',
        '!!The door does not need to be watched.!!',
      ],
      item: 'small_bell',
    },
    {
      id: 'name_kept',
      when: (p) => p.scales.recognition >= 9 && p.scales.grief >= 6,
      title: 'You keep his name',
      lines: [
        'I write his name on the wall. He watches me do it. He does not stop me.',
        'I leave the room with the name in my mouth. He sits very still in the chair.',
        '!!The wall keeps it.!!',
      ],
      item: 'scrap_of_paper',
    },
    {
      id: 'took_chair',
      when: (p) => p.flags.sat_in_chair,
      title: 'You take his place',
      lines: [
        'The chair fits. The room is mine. He is on the floor still.',
        'He calls me sir, once. ~~Without irony.~~ I do not correct him.',
      ],
      item: 'ink_bottle',
      scars: ['named'],
    },
    {
      id: 'walks_out',
      when: (p) => p.scales.presence >= 9 && p.turn >= 8,
      title: 'He outlasts you',
      lines: [
        'He is in the chair. He has always been in the chair. I cannot find an edge to begin from.',
        '!!I leave him to it. The door is heavier than I expected.!!',
      ],
      item: null,
      scars: ['failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: ['I close the door. ~~He was speaking when I left.~~ He kept speaking through the door.'],
      item: null,
      scars: ['abandoned'],
    },
  ],
};

// ════════════════════════════════════════════════════════════════════════
// THE NIGHT NURSE — Patient 0042
// ════════════════════════════════════════════════════════════════════════

const soothlick = {
  id: 'soothlick',
  name: '[The Night Round]',
  glyph: 'Soothlick',
  subtitle: 'She is still rounding.',
  role: 'wing', tier: 2,
  file: [
    "Subject's tenure as ward sister spanned ~~thirty~~ thirty-eight years. Subject's patients ~~expired~~ rested ahead of schedule.",
    'No inquest was held. Subject was admitted instead. !!Subject does not turn the door handle.!!',
    'Patients Subject has tended report **sleeping better**. They do not wake all the way.',
  ],
  intro: [
    'The lights have gone down. The room is dim in a way it was not a minute ago.',
    'She is at the foot of a bed. ~~Mine.~~ A bed. She is straightening a sheet. She has not looked at me yet.',
  ],

  scales: {
    trust: {
      initial: 0, min: 0, max: 10, label: 'trust', kind: 'positive',
      bands: [
        { at: 0, word: 'a stranger' },
        { at: 2, word: 'her patient' },
        { at: 5, word: 'a person' },
        { at: 7, word: 'kin' },
        { at: 9, word: '**kept**' },
      ],
      crossUp: {
        2: 'She has started to see me as a person. Not a chart.',
        3: 'She trusts me with the small instruments.',
        4: '~~She would close my eyes if I asked.~~',
      },
      crossDown: {
        1: 'Her hands have gone back to the chart.',
        0: 'I am a stranger again.',
      },
    },
    sight: {
      initial: 0, min: 0, max: 10, label: 'sight', kind: 'positive',
      bands: [
        { at: 0, word: 'in 1972' },
        { at: 2, word: 'half-here' },
        { at: 5, word: 'stirring' },
        { at: 7, word: 'awake' },
        { at: 9, word: 'all the way back' },
      ],
      crossUp: {
        2: 'Her eyes have come up off the sheet. Briefly.',
        3: 'She has noticed the year.',
        4: '!!She is here. She is awake.!!',
      },
      crossDown: {
        1: 'She has slipped back into the work.',
        0: 'Her hands have resumed without her.',
      },
    },
    tending: {
      initial: 4, min: 0, max: 10, label: 'tending', kind: 'negative',
      bands: [
        { at: 0, word: 'stilled' },
        { at: 3, word: 'fixing things' },
        { at: 5, word: 'working' },
        { at: 7, word: 'committed' },
        { at: 9, word: 'consuming' },
      ],
      crossUp: {
        2: 'She has gone deeper into the work.',
        3: 'She has decided which work needs doing tonight.',
        4: '!!She is not going to stop until she has finished.!!',
      },
      crossDown: {
        2: 'Her hands have left the work for a moment.',
        1: 'She has set the tray down.',
        0: 'She has stopped tending. It is the first time in [[8]] years.',
      },
    },
  },
  initialize(p, player) {
    p.scales.trust   = 0;
    p.scales.sight   = 0;
    p.scales.tending = r(4, 6);
    p.playerEffects.drowsing = 0;
    if (player.scars?.includes('witnessed')) p.scales.tending = Math.min(10, p.scales.tending + 1);
  },

  fileReveals: [
    { announce: 'A line of her file fills in. ~~Thirty-eight years on the night ward.~~' },
    { announce: 'Another. **She does not turn the door handle.**' },
    { announce: 'The last line, in my hand. ~~Her patients did not wake.~~' },
  ],

  presented(p) {
    const t = p.scales.tending;
    const s = p.scales.sight;
    const tr = p.scales.trust;
    const dr = p.playerEffects.drowsing || 0;
    let work;
    if (t >= 8)      work = 'She is at my bedside. She has decided which work needs doing tonight.';
    else if (t >= 5) work = 'She is at the bedside. She is doing the work she came to do.';
    else if (t >= 2) work = 'She is pacing. Her hands keep finding things to fix.';
    else             work = 'She has stopped. She is at the door, not sure if she should leave.';
    let eyes;
    if (s >= 7)      eyes = 'Her eyes are on me. She knows what year it is. She has decided to be here anyway.';
    else if (s >= 4) eyes = 'Her eyes find me sometimes. She is not sure who she is tending.';
    else if (tr >= 4) eyes = 'Her eyes have started to make me out. ~~As a person.~~';
    else             eyes = 'Her eyes are on her work. They are not on me.';
    let sleep;
    if (dr >= 6)      sleep = '!!The room is very warm. I have closed my eyes once already without meaning to.!!';
    else if (dr >= 3) sleep = '~~The room is heavier than it was.~~ My eyelids are.';
    else if (dr >= 1) sleep = 'The room is very warm.';
    else              sleep = 'The room is cold and bright.';
    return `${work} ${eyes} ${sleep}`;
  },

  verbs: {

    refuse_quietly: {
      label: 'refuse quietly',
      desc: "Shake your head. Wave her off. Do not take what she is offering.",
      respond(p, player) {
        const sleepless = (p.flags.glass_clutched || player.items?.includes('sliver_of_glass'));
        const reps = streakCount(p, 'refuse_quietly');
        if (reps >= 2) {
          return {
            lines: [
              'I wave her off again. And again. She is patient. She will be back.',
              'My refusal has become a routine. ~~Routine is what she works in.~~',
            ],
            playerEffects: sleepless ? {} : { drowsing: +1 },
            composure: -1,
            composureCost: 'Her humming is the sound the room makes. ~~I am tired.~~',
          };
        }
        return {
          lines: [
            'I wave her off. I say: !!I do not need this.!!',
            'She sets the tray down anyway. Her face does not change.',
            'But she does not press. Her hands go back to her sides.',
          ],
          scales: { tending: -2 },
          playerEffects: sleepless ? {} : { drowsing: -1 },
        };
      },
    },

    sit_up: {
      label: 'sit up straighter',
      desc: 'Visible alertness. Effortful.',
      respond(p, player) {
        const sleepless = (p.flags.glass_clutched || player.items?.includes('sliver_of_glass'));
        const reps = streakCount(p, 'sit_up');
        if (reps >= 2) {
          return {
            lines: [
              'I sit up again. And again. ~~It is taking something out of me.~~ I am running out of straightening.',
              'She has gone back to fixing the sheet.',
            ],
            scales: { sight: +1 },
            composure: -1,
            composureCost: 'The dark window is the loudest thing here.',
          };
        }
        return {
          lines: [
            'I square my shoulders. I plant my feet. I am being a person, deliberately.',
            'Her hand pauses above the sheet. She has to revise something.',
          ],
          scales: { sight: +1, tending: -1 },
          playerEffects: sleepless ? {} : { drowsing: -1 },
        };
      },
    },

    accept_tending: {
      label: 'let her tend you',
      desc: 'Close your eyes a moment. Let her smooth the sheet.',
      when: (p) => p.scales.tending >= 4,
      respond(p, player) {
        const sleepless = (p.flags.glass_clutched || player.items?.includes('sliver_of_glass'));
        const reps = streakCount(p, 'accept_tending');
        if (reps >= 1) {
          return {
            lines: [
              'I let her again. Her hands are practiced. ~~I am getting better at letting.~~ I am letting more each time.',
              'She hums something low. It is a song I half-recognize but cannot place.',
            ],
            scales: { trust: +1, tending: +1 },
            playerEffects: sleepless ? {} : { drowsing: +3 },
          };
        }
        return {
          lines: [
            'I let her hand cool my forehead. Her fingers smell of paper and bleach.',
            p.scales.tending >= 6
              ? 'She hums something soft. She has done this a long time. She is good at it.'
              : 'Her hand is unsteady. She is not sure she remembers how this part goes.',
            sleepless
              ? '~~I do not close my eyes.~~ Her hum does not catch.'
              : '~~Her hum is what the room is made of.~~ Her hum is the sound the room makes.',
          ],
          scales: { trust: +2, tending: +1 },
          playerEffects: sleepless ? {} : { drowsing: +2 },
        };
      },
    },

    ask_about_shift: {
      label: 'ask about her shift',
      desc: 'When did she come on? When is she off?',
      when: (p) => p.scales.trust >= 3 && p.scales.sight <= 6,
      respond(p) {
        const reps = streakCount(p, 'ask_about_shift');
        if (reps >= 1) {
          return {
            lines: [
              'I ask again, differently. How long has she been here? The question lands somewhere it had been avoiding.',
              'She stares at the dark window for a long time. She does not answer.',
            ],
            scales: { sight: +3, tending: -2 },
            composure: -1,
            composureCost: '!!I should not have done that.!!',
          };
        }
        if (p.scales.sight >= 3) {
          return {
            lines: [
              'I ask: when did you come on?',
              'She answers without thinking: !!seven.!! Then she stops. She looks at the dark window. ~~A long time ago.~~ A very long time ago.',
            ],
            scales: { sight: +3, tending: -2 },
          };
        }
        return {
          lines: [
            'I ask: when did you come on?',
            'She says: at seven. She says it the way she always says it. She does not look at the clock.',
            'Something passes behind her eyes. Briefly.',
          ],
          scales: { sight: +1 },
        };
      },
    },

    break_a_vial: {
      label: 'break a vial',
      desc: 'Sweep the tray. Shock her.',
      when: (p) => p.scales.tending >= 7 && p.scales.sight <= 4,
      respond(p) {
        return {
          lines: [
            'I sweep my hand across her tray. A vial breaks. The noise is very loud in the room.',
            'She stares at the floor. Her hands shake. Her face is the face of someone who has lost something irreplaceable.',
            '!!I should not have done this.!!',
          ],
          scales: { sight: +3, tending: +2 },
          playerEffects: { drowsing: -2 },
          composure: -2,
          composureCost: 'Her hand is cool. ~~I do not move away.~~',
          scars: ['witnessed'],
          shake: true,
        };
      },
    },

    say_her_name: {
      label: 'say her name',
      desc: 'Use the name on her file. Not "nurse".',
      when: (p) => p.scales.sight >= 3 && p.scales.trust >= 3,
      respond(p, player) {
        const r_ = player.items?.includes('scrap_of_paper');
        if (r_) {
          return {
            lines: [
              'I say her name. The way she would have been called for. ~~I have practiced.~~',
              'She stops. She stands very still. She says: yes? — as if she has heard the question, not the name.',
            ],
            scales: { sight: +3, trust: +2 },
          };
        }
        return {
          lines: [
            'I say her name. ~~The one she has not been called by in [[2]] years.~~ The one on her file.',
            p.scales.sight >= 5
              ? 'She answers to it. She says: yes? She has not been spoken to in a while.'
              : 'She does not turn. She goes on straightening the sheet. Slowly. It is a name she half-recognizes.',
          ],
          scales: { sight: +2 },
        };
      },
    },

    take_her_hand: {
      label: 'take her hand',
      desc: 'Gently. Stop hers from working.',
      when: (p) => p.scales.trust >= 5 && p.scales.sight >= 4,
      respond(p) {
        return {
          lines: [
            'I take her hand. She lets me. Her fingers are cool and very thin.',
            'She does not move. For a while we are two people holding still.',
            p.scales.sight >= 5
              ? 'She squeezes back. ~~Briefly.~~ Once.'
              : 'Her hand stays where I put it.',
          ],
          scales: { trust: +3, tending: -2 },
        };
      },
    },

    sit_vigil: {
      label: 'sit the vigil with her',
      desc: 'Pull up a chair. Tend the room with her, not at her.',
      when: (p) => p.scales.trust >= 6 && p.scales.sight >= 5,
      respond(p) {
        return {
          lines: [
            'I pull up a chair beside the bedside. I do what she does. I match her care.',
            'After a while she shows me how to straighten the corner of the sheet. It has to be exact.',
          ],
          scales: { trust: +3, sight: +1, tending: -1 },
          flags: { kept_vigil: true },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Lie still. Let her work around me. ~~It is heavy.~~',
    when: (p) => p.scales.tending >= 5 || p.turn >= 5,
  },

  interjections: [
    {
      id: 'who_are_you_tonight',
      once: true,
      when: (p) => p.scales.tending >= 6 && p.turn >= 2,
      prose: [
        'Her hand pauses on the corner of the sheet. She looks at me as if she has just realized I am there.',
        'She asks: ~~Who are you tonight?~~',
      ],
      responses: [
        {
          label: 'a new patient',
          desc: 'Accept her premise.',
          lines: [
            'I say: a new patient.',
            'She nods. She has done this a thousand times. Her hands resume.',
          ],
          scales: { tending: +2 },
          playerEffects: { drowsing: +2 },
          scars: ['named'],
        },
        {
          label: 'a visitor',
          desc: 'A small lie.',
          lines: [
            'I say: a visitor.',
            'She pauses. She looks at the dark window. She has not had a visitor in a while.',
          ],
          scales: { sight: +2, tending: -1 },
        },
        {
          label: 'someone who came to find you',
          desc: 'The truest answer.',
          lines: [
            'I say: someone who came to find you.',
            'Her hand stops. Her face does several things in sequence.',
            'She lets the sheet go.',
          ],
          scales: { sight: +3, trust: +2, tending: -3 },
          composure: -1,
          composureCost: 'The corner of the sheet is not right. ~~I cannot fix it.~~',
        },
      ],
    },

    {
      id: 'what_year',
      once: true,
      when: (p) => p.scales.sight >= 5 && p.turn >= 3,
      prose: [
        'She stops mid-fold. Her eyes look very tired suddenly.',
        'She asks, quietly: ~~What year is it?~~',
      ],
      responses: [
        {
          label: 'tell her the truth',
          desc: 'Gently.',
          lines: [
            'I tell her. She does not contradict me. She does not say anything for a long time.',
            'Eventually she sits on the foot of the bed. She has not sat down in a while.',
          ],
          scales: { sight: +3, trust: +2, tending: -4 },
          composure: -1,
          composureCost: 'I have been a patient too long.',
        },
        {
          label: "it doesn't matter",
          desc: 'Kind refusal.',
          lines: [
            "I say: it does not matter. You are needed here regardless.",
            'She nods, almost grateful. Her hands resume. Slower now.',
          ],
          scales: { trust: +2, tending: -1 },
          scars: ['named'],
        },
        {
          label: "I don't know",
          desc: 'Meet her where she is.',
          lines: [
            "I say: I do not know.",
            'She lets out a small breath. She looks at me as if I had answered the easier question correctly.',
          ],
          scales: { trust: +3, sight: +1 },
        },
      ],
    },

    {
      id: 'will_you_stay',
      once: true,
      when: (p) => p.scales.trust >= 6 && p.scales.sight >= 5,
      prose: [
        'She has stopped fixing the sheet. She sits beside me on the bed.',
        'She asks: ~~Will you stay until the light comes back?~~',
      ],
      responses: [
        {
          label: "I'll stay",
          desc: 'Commit.',
          lines: [
            "I say: I'll stay.",
            'She nods. She takes my wrist gently. Like checking a pulse.',
            'I do not move. The hour passes through us.',
          ],
          scales: { trust: +3, sight: +2, tending: -3 },
          composure: -1,
          composureCost: 'Her humming is the sound the room makes. ~~I am tired.~~',
          flags: { kept_vigil: true },
        },
        {
          label: "I can't",
          desc: 'A small kindness.',
          lines: [
            "I say: I can't. But I will stay as long as I can.",
            'She nods. She does not let go of my wrist immediately.',
          ],
          scales: { trust: +1, tending: -1, sight: -1 },
        },
        {
          label: 'someone else will',
          desc: 'Redirect.',
          lines: [
            'I say: someone else will. ~~There will be someone.~~',
            'She does not believe me, exactly. But she stops asking.',
          ],
          scales: { sight: +1, trust: -1 },
        },
      ],
    },

    {
      id: 'did_you_come_for_me',
      once: true,
      when: (p) => p.scales.trust >= 4 && p.scales.sight >= 3 && p.turn >= 3,
      prose: [
        'She pauses with her hand on the corner of the sheet. She watches me.',
        'She asks: ~~Did you come for me tonight?~~',
      ],
      responses: [
        {
          label: 'I did',
          desc: 'Meet her there.',
          lines: [
            'I say: I did.',
            'She sets the sheet down. She sits on the foot of the bed. ~~She has been waiting.~~',
          ],
          scales: { sight: +3, trust: +2, tending: -3 },
        },
        {
          label: 'I came for the room',
          desc: 'Less than yes.',
          lines: [
            'I say: I came for the room.',
            'She nods slowly. She takes the sheet up again. Her humming has changed key.',
          ],
          scales: { sight: +1, tending: -1 },
        },
        {
          label: 'no one came',
          desc: 'Sharp truth.',
          lines: [
            'I say: no one came. ~~Not for years.~~',
            'Her hand stops mid-fold. ~~She does not say anything.~~ She does not say anything for a long time.',
            '!!The room has aged a decade in a second.!!',
          ],
          scales: { sight: +4, tending: -3, trust: -1 },
          composure: -2,
          composureCost: 'The dark window is the loudest thing here.',
        },
      ],
    },

    {
      id: 'I_was_supposed_to',
      once: true,
      when: (p) => p.scales.sight >= 7 && p.turn >= 5,
      prose: [
        'She has the sheet halfway folded. She is looking at her hands.',
        'She says, ~~to me~~ to herself: I was supposed to be home by now.',
      ],
      responses: [
        {
          label: "they'll be waiting",
          desc: 'A kind lie.',
          lines: [
            "I say: they'll still be there.",
            'She nods. ~~She does not check.~~ She knows better than to check.',
          ],
          scales: { trust: +1, tending: -1, sight: -1 },
          scars: ['named'],
        },
        {
          label: 'you can go',
          desc: 'Release her.',
          lines: [
            'I say: you can go. The work is done.',
            'She looks at the dark window. She does not stand. But she stops folding.',
            '~~Her hands are her own.~~',
          ],
          scales: { sight: +3, tending: -4 },
          composure: -1,
          composureCost: '!!I should not have done that.!!',
        },
        {
          label: "who's home",
          desc: 'Ask.',
          lines: [
            'I ask: who is at home?',
            'She names someone. Quietly. It has been a long time since she said the name out loud.',
          ],
          scales: { sight: +2, trust: +2 },
        },
      ],
    },
  ],

  drift(p, player) {
    const sleepless = (p.flags.glass_clutched || player.items?.includes('sliver_of_glass'));
    if (!sleepless) {
      p.playerEffects.drowsing = Math.min(8, (p.playerEffects.drowsing || 0) + 1);
    }
    const dr = p.playerEffects.drowsing;
    if (dr >= 6) {
      return {
        lines: [
          'I wait. Her hand finds my forehead. ~~I close my eyes.~~ My eyes close.',
          'I am very warm. The room is very dim. The bed is very soft. I have been awake a long time.',
        ],
        scales: { tending: +1 },
        composure: -1,
        composureCost: 'Her hand is cool. ~~I do not move away.~~',
      };
    }
    if (dr >= 4) {
      return {
        lines: [
          'I wait. She straightens the sheet under my chin. Her humming is the sound the room makes.',
        ],
        scales: { tending: +1 },
        composure: -1,
        composureCost: 'The corner of the sheet is not right. ~~I cannot fix it.~~',
      };
    }
    return {
      lines: ['I wait. Her shoes make no sound on the floor.'],
      scales: { tending: +1 },
    };
  },

  endings: [
    {
      id: 'sleep',
      when: (p) => (p.playerEffects.drowsing || 0) >= 8,
      title: 'She tends you to sleep',
      lines: [
        'Her hand is cool on my forehead. Her humming is the sound the room makes.',
        '~~I close my eyes.~~ My eyes close. When I open them I am still here. ~~But I have lost something I cannot find again.~~ But I am less of me.',
        '!!I do not know how long I was gone.!!',
      ],
      item: 'vial',
      scars: ['witnessed'],
    },
    {
      id: 'vigil_kept',
      when: (p) => p.flags.kept_vigil && p.scales.sight >= 7 && p.scales.trust >= 7,
      title: 'You keep her vigil',
      lines: [
        'I sit with her at the bedside. She shows me how to do it.',
        'We straighten sheets for someone who is not in the bed. ~~Hours.~~ It takes hours.',
        '!!She lets me leave when the light comes back.!!',
      ],
      item: 'small_bell',
    },
    {
      id: 'woken',
      when: (p) => p.scales.sight >= 9 && p.scales.tending <= 2,
      title: 'You wake her',
      lines: [
        'She looks at the clock. She looks at me. Her face is a face that has been awake too long.',
        'She says: ~~I should have gone home decades ago.~~ I should have gone home.',
        'She sits down on the floor. She does not put down the tray.',
      ],
      item: 'sliver_of_glass',
    },
    {
      id: 'too_long',
      when: (p) => p.scales.tending >= 9 && p.turn >= 8,
      title: 'Her work outlasts you',
      lines: [
        'She works around me. I am one of the things she is straightening tonight.',
        '!!I leave before she finishes.!!',
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
  role: 'wing', tier: 3,
  file: [
    'Subject was [[1]] years old when [[8]] entered the road. Subject did not look away.',
    "Subject's eyes have not closed since. ~~Pupils dilate normally.~~ Pupils do not register staff.",
    'Staff are instructed !!not to follow Subject\'s line of sight.!! **It has been forty years.**',
  ],
  intro: [
    'He is on the floor by the wall. He has not stood up. His hand is on something at his side that is not there.',
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
    { announce: 'The last line, in my hand. ~~It has been forty years.~~' },
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
    let hands;
    if (pr >= 7)      hands = 'His hand is on my sleeve. He has not let go.';
    else if (pr >= 4) hands = 'His hand is on his own knee. He has remembered it is his.';
    else if (pr >= 1) hands = 'His hand is on the floor between us. Close, but not touching.';
    else              hands = 'His hand is on the floor beside him, on something that is not there.';
    return `${eyes} ${mouth} ${hands}`;
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
            composureCost: 'His small hand on my sleeve. ~~It is small.~~',
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
      desc: 'Put your hand over them. Let him stop seeing.',
      when: (p) => p.scales.present >= 4 && p.scales.stare <= 6,
      respond(p) {
        if (p.scales.present >= 5) {
          return {
            lines: [
              'I crouch and put my hand over his eyes. His lashes brush my palm.',
              'His eyes close. For the first time today, they close.',
              '~~He stops holding his breath.~~ He breathes out. It has been forty years of holding.',
              '!!He leans his forehead against my wrist.!!',
            ],
            scales: { stare: -4, present: +2, pressure: -2 },
          };
        }
        return {
          lines: [
            'I reach. His eyes flinch but do not close. He does not let me take it from him.',
            'I lower my hand. ~~Not yet.~~ Not yet.',
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
              'He listens. His eyes do not move. But his hand finds the hem of my sleeve.',
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
          composureCost: 'His small hand on my sleeve. ~~It is small.~~',
        };
      },
    },

    let_him_pet: {
      label: 'let him pet you',
      desc: 'His hand on the floor is doing the shape of petting. Offer your sleeve.',
      when: (p) => p.scales.present >= 3 && p.scales.pressure <= 6,
      respond() {
        return {
          lines: [
            'I slide my sleeve under his hand on the floor. His fingers find the cuff.',
            'His hand does the shape of petting. ~~Something he has been doing for forty years.~~',
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
      ],
    },

    {
      id: 'where_did_he_go',
      once: true,
      when: (p) => p.scales.present >= 5 && p.scales.stare <= 5,
      prose: [
        'His hand is on the floor between us. Doing the petting shape.',
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
            'When he comes back his hand stays on my sleeve.',
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
        'His hand has stopped petting the floor. He is very still.',
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
          composureCost: 'His small hand on my sleeve. ~~It is small.~~',
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
          'I wait. His hand is on the floor. It is doing the shape of petting.',
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

const frostfin = {
  id: 'frostfin',
  name: '[The Bench]',
  glyph: 'Frostfin',
  subtitle: 'The bench is not a chair.',
  role: 'wing', tier: 1,
  file: [
    'Subject was located at the platform in a state of advanced **preservation**. She had been there since her ~~husband~~ son said he would come.',
    "Subject continues to consult a watch. ~~The watch was removed.~~ The watch is still in her hand.",
    'The bench was admitted with Subject. !!Staff do not sit on the bench.!! **Her hands have not warmed.**',
  ],
  intro: [
    'The room is much colder than the corridor. The window is dark. There is a bench in the room. She is sitting on the bench.',
    'Her coat is buttoned to the throat. She is waiting for someone. ~~She has been waiting since [[12]].~~',
  ],

  scales: {
    warmth: {
      initial: 0, min: 0, max: 10, label: 'warmth', kind: 'positive',
      bands: [
        { at: 0, word: 'a stranger' },
        { at: 2, word: 'thawing' },
        { at: 5, word: 'close' },
        { at: 7, word: 'warm with me' },
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
    recognition: {
      initial: 0, min: 0, max: 10, label: 'recognition', kind: 'positive',
      bands: [
        { at: 0, word: 'looking past me' },
        { at: 2, word: 'sidelong' },
        { at: 5, word: 'seeing' },
        { at: 7, word: 'looking at me' },
        { at: 9, word: 'all the way here' },
      ],
      crossUp: {
        2: 'Her eyes have come off the door.',
        3: 'She has placed me. ~~For the moment.~~',
        4: '!!She has decided I am here for her.!!',
      },
      crossDown: {
        1: 'Her eyes have gone back to the door.',
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
        0: 'The room is warm now. ~~Or I have become.~~',
      },
    },
    waiting: {
      initial: 7, min: 0, max: 10, label: 'waiting', kind: 'negative',
      bands: [
        { at: 0, word: 'settled' },
        { at: 3, word: 'still hoping' },
        { at: 5, word: 'watching the door' },
        { at: 7, word: 'bolt upright' },
        { at: 9, word: 'unable to leave' },
      ],
      crossUp: {
        3: 'Her posture has gone rigid. ~~She is locked to the bench.~~',
      },
      crossDown: {
        2: 'Her shoulders have eased.',
        1: 'She has settled. Her hands are in her lap.',
        0: 'She is not waiting anymore.',
      },
    },
  },
  initialize(p, player) {
    p.scales.cold    = r(4, 6);
    p.scales.waiting = r(7, 9);
    p.scales.recognition = 0;
    p.scales.warmth = 0;
    if (player?.scars?.includes('taken')) p.scales.warmth = Math.max(0, p.scales.warmth - 1);
    if (player?.scars?.includes('named')) p.scales.waiting = Math.min(10, p.scales.waiting + 1);
  },

  fileReveals: [
    { announce: 'A line of her file fills in. ~~Located at the platform.~~' },
    { announce: 'Another. ~~Her son said he would come.~~' },
    { announce: 'The last line, in my hand. **Her hands have not warmed.**' },
  ],

  presented(p) {
    const c = p.scales.cold;
    const w = p.scales.waiting;
    const re = p.scales.recognition;
    const wa = p.scales.warmth;
    let temp;
    if (c >= 7)      temp = '!!The room is white with cold. My breath is visible. Hers is not.!!';
    else if (c >= 4) temp = 'The room is cold. My fingers are stiff.';
    else if (c >= 1) temp = 'The room is cool. Warming, slowly.';
    else             temp = 'The room is warm. ~~Or I have become.~~';
    let post;
    if (w >= 8)      post = 'She is bolt upright. She has not shifted her weight in some time.';
    else if (w >= 5) post = 'She sits upright on the bench. Her hands folded.';
    else if (w >= 2) post = 'Her shoulders have dropped. Her hands rest on her knees.';
    else             post = 'She is leaning, slightly. She has settled.';
    let eyes;
    if (re >= 7)     eyes = 'Her eyes are on me. She has decided I am here for her now.';
    else if (re >= 4) eyes = 'Her eyes move to me sometimes. Then away to the door.';
    else if (re >= 1) eyes = 'Her eyes glance at me, sidelong, when I move.';
    else              eyes = 'Her eyes are on the door.';
    return `${temp} ${post} ${eyes}`;
  },

  verbs: {

    sit_with_her: {
      label: 'sit with her',
      desc: 'On the bench. Join the wait.',
      respond(p) {
        const reps = streakCount(p, 'sit_with_her');
        if (reps >= 2) {
          return {
            lines: [
              'I have been sitting a while. ~~Her arm has rested against mine.~~ Her arm rests against mine.',
              'We are doing the same thing in the same direction. ~~It is not lonely.~~',
            ],
            scales: { warmth: +2, recognition: +1, waiting: -1 },
            composure: -1,
            composureCost: 'The cold is in my fingers now.',
          };
        }
        if (p.scales.waiting >= 7) {
          return {
            lines: [
              'I sit on the bench beside her. She does not move.',
              'After a while I am also waiting. It is not entirely unpleasant.',
            ],
            scales: { warmth: +1, waiting: -1 },
            composure: -1,
            composureCost: 'My breath is visible. Hers is not.',
          };
        }
        return {
          lines: [
            'I sit beside her. She shifts slightly to make room.',
            'Her shoulder almost touches mine. ~~She is warmer than the room.~~ She is colder than the room.',
          ],
          scales: { warmth: +1, recognition: +1, cold: -1 },
        };
      },
    },

    warm_the_room: {
      label: 'warm the room',
      desc: 'Find a lamp. Find the radiator. Find something useful to do.',
      respond(p) {
        const reps = streakCount(p, 'warm_the_room');
        if (reps >= 2) {
          return {
            lines: [
              'I move around the room. Fixing small things. She watches me.',
              '~~She is amused, almost.~~',
            ],
            scales: { cold: -2, recognition: +1 },
          };
        }
        return {
          lines: [
            'I find a lamp. I find the radiator. I find a small thing to do.',
            'The room warms a degree. She does not seem to notice. But her hands are less cold than they were.',
          ],
          scales: { cold: -2 },
        };
      },
    },

    take_her_hand: {
      label: 'take her hand',
      desc: 'Her hand is on her knee. It is very cold.',
      when: (p) => p.scales.recognition >= 2 && p.scales.warmth >= 2,
      respond(p) {
        return {
          lines: [
            'I take her hand. It is colder than I expected. ~~As cold as a hand can be.~~ Colder.',
            p.scales.waiting >= 5
              ? 'She does not let go. Her hand stays in mine like an object set down.'
              : 'She squeezes back. ~~Once.~~ Once.',
          ],
          scales: { warmth: +2, recognition: +2, waiting: -1 },
          composure: -1,
          composureCost: 'The bench is colder than the floor.',
        };
      },
    },

    say_his_name: {
      label: 'say his name',
      desc: 'The one she is waiting for.',
      when: (p) => p.scales.recognition >= 4,
      respond(p, player) {
        const r_ = player.items?.includes('scrap_of_paper');
        if (r_) {
          return {
            lines: [
              'I say his name. I say it the way she would have. ~~I have practiced.~~',
              'She turns slowly. Fully. She is looking at me as if she had been about to.',
              'She does not believe it is him. But she is willing to be wrong.',
            ],
            scales: { recognition: +3, waiting: -3, warmth: +1 },
            composure: -1,
            composureCost: '!!I am waiting too.!!',
          };
        }
        if (p.scales.recognition >= 5) {
          return {
            lines: [
              'I say his name. Her name for him.',
              'She turns. All the way. Her eyes are very bright. She says: where have you been?',
              '!!I am not him. I do not say so.!!',
            ],
            scales: { recognition: +2, waiting: -3 },
            composure: -1,
            composureCost: 'Her hand is the same temperature as the room.',
            scars: ['named'],
          };
        }
        return {
          lines: [
            'I say his name. She stiffens.',
            'She is not sure who is saying it. She looks at me, sidelong.',
          ],
          scales: { recognition: +1, warmth: -1 },
          composure: -1,
          composureCost: 'The door is heavier than I expected.',
        };
      },
    },

    say_you_came: {
      label: 'say you came',
      desc: 'Lie. Say you are him.',
      when: (p) => p.scales.warmth >= 4 && p.scales.recognition >= 4,
      respond(p) {
        return {
          lines: [
            'I say: !!I am sorry I am late.!!',
            'She nods. She does not check. She stands up. She takes my arm.',
            'She walks me to the door of the room. ~~She does not look back at the bench.~~ The bench is not for her anymore.',
            '~~She does not look at me close.~~ She is afraid to look at me close.',
          ],
          scales: { waiting: -5, warmth: +3 },
          composure: -2,
          composureCost: 'The cold is in my fingers now.',
          scars: ['named'],
          flags: { lied: true },
        };
      },
    },

    ask_why_here: {
      label: "ask who she's waiting for",
      desc: 'A question, gently.',
      when: (p) => p.scales.recognition >= 4 && p.scales.warmth >= 3,
      respond() {
        return {
          lines: [
            'I ask: who are you waiting for?',
            'She tells me. She tells me carefully. It takes her a while. ~~She has not said his name in years.~~',
            'Her hand stays on her knee. Her eyes stay on the door, but they are mine now.',
          ],
          scales: { recognition: +3, waiting: -2 },
        };
      },
    },

    bring_her_a_coat: {
      label: 'put a coat over her',
      desc: 'Find one. Her own coat is too thin.',
      when: (p) => p.scales.warmth >= 3 && p.scales.cold >= 3,
      respond() {
        return {
          lines: [
            'I find a heavier coat in the closet. I drape it over her shoulders.',
            'She lets me. She does not thank me. But her shoulders settle.',
          ],
          scales: { cold: -3, warmth: +1, waiting: -1 },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'Sit with her. Let the room go on cooling. ~~It costs.~~',
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
          scales: { recognition: +2, waiting: +1 },
          composure: -1,
          composureCost: 'My breath is visible. Hers is not.',
        },
        {
          label: "I don't think it's coming",
          desc: 'The truth.',
          lines: [
            "I say: I don't think it's coming.",
            'She is quiet. She looks at her hands for a long time.',
            'She says: ~~I knew.~~ Very small.',
          ],
          scales: { recognition: +3, waiting: -4, warmth: +1, cold: +1 },
          composure: -2,
          composureCost: 'The bench is colder than the floor.',
        },
      ],
    },
    {
      id: 'which_one',
      once: true,
      when: (p) => p.scales.recognition >= 4 && p.scales.warmth >= 3,
      prose: [
        'Her head turns. She squints at me. She has only just noticed.',
        'She asks: ~~Which one are you?~~ ~~Which~~ — which of mine?',
      ],
      responses: [
        {
          label: 'tell her my name',
          desc: 'I am not one of them.',
          lines: [
            'I say: I am Patient 0413. I came in this morning. I am not yours.',
            'She nods. ~~She is not disappointed.~~ She had not been sure.',
          ],
          scales: { recognition: +3, warmth: -1, cold: +1 },
          composure: -1,
          composureCost: '!!I am waiting too.!!',
        },
        {
          label: 'I am the one who came',
          desc: 'Let her have a guess.',
          lines: [
            'I say: I am the one who came.',
            'She takes my arm with both hands. ~~She does not check.~~',
          ],
          scales: { warmth: +3, recognition: -1, waiting: -2 },
          scars: ['named'],
        },
        {
          label: "I don't know",
          desc: 'Honest.',
          lines: [
            "I say: I don't know.",
            'She nods. ~~That is also the answer she has.~~',
          ],
          scales: { recognition: +2, warmth: +1 },
        },
      ],
    },
    {
      id: 'is_it_late',
      once: true,
      when: (p) => p.scales.waiting >= 7 && p.turn >= 4,
      prose: [
        'Her hand finds her own wrist. She presses where a watch should be.',
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
          scales: { waiting: +1, recognition: +1, cold: +1 },
          composure: -1,
          composureCost: 'Her hand is the same temperature as the room.',
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
          scales: { waiting: -3, recognition: +2, warmth: +1, cold: +1 },
          composure: -2,
          composureCost: 'The door is heavier than I expected.',
        },
      ],
    },
    {
      id: 'will_you_wait',
      once: true,
      when: (p) => p.scales.warmth >= 5 && p.scales.recognition >= 4,
      prose: [
        'Her hand is on my sleeve. She has stopped watching the door.',
        'She asks me: ~~Will you wait with me?~~',
      ],
      responses: [
        {
          label: 'I will',
          desc: 'Commit to the bench.',
          lines: [
            'I say: I will.',
            'She sets her head against my shoulder. ~~It is light. Very light.~~ It is the weight of a coat.',
          ],
          scales: { warmth: +3, waiting: -2, recognition: +1 },
          composure: -1,
          composureCost: 'The cold is in my fingers now.',
        },
        {
          label: 'only a while',
          desc: 'An honest limit.',
          lines: [
            'I say: only a while. I cannot stay long.',
            'She nods. She pats my hand. She does not let go.',
          ],
          scales: { warmth: +1, waiting: -1 },
        },
        {
          label: 'I have to go',
          desc: 'Leave the offer.',
          lines: [
            'I say: I have to go soon.',
            'Her hand stays on my sleeve a moment longer than is comfortable. Then she lets go.',
          ],
          scales: { warmth: -2, cold: +1, waiting: +2 },
          composure: -2,
          composureCost: 'My breath is visible. Hers is not.',
        },
      ],
    },
  ],

  drift(p, player) {
    if (p.scales.cold >= 5) {
      return {
        lines: [
          'I wait. The cold has not lessened. ~~I am tired in a way I do not understand.~~ I am becoming tired in a way she would recognize.',
        ],
        scales: { cold: +1, waiting: +1 },
        composure: -1,
        composureCost: 'The bench is colder than the floor.',
      };
    }
    if (p.scales.waiting >= 6) {
      return {
        lines: [
          'I wait. She shifts on the bench. She watches the door. ~~No one comes.~~ No one comes.',
        ],
        scales: { cold: +1, waiting: +1 },
        composure: -1,
        composureCost: '!!I am waiting too.!!',
      };
    }
    return {
      lines: ['I wait. She shifts. Her hand finds her own knee.'],
      scales: { warmth: +1, cold: +1 },
    };
  },

  endings: [
    {
      id: 'sat_through',
      when: (p) => p.scales.warmth >= 9 && p.scales.recognition >= 6 && p.scales.waiting <= 2,
      title: 'She lets you sit with her',
      lines: [
        'She does not need him to come. She has decided I will do.',
        'We sit a long time. The room warms by a degree. ~~The door does not open.~~ It does not need to.',
        'Eventually she pats my hand. That is the ending. ~~For both of us.~~',
      ],
      item: 'worn_ribbon',
    },
    {
      id: 'walked_out',
      when: (p) => p.flags.lied && p.scales.waiting <= 2 && p.scales.warmth >= 6,
      title: 'She lets you walk her out',
      lines: [
        'She lets me walk her out of the room. She takes my arm tighter when we reach the door.',
        '!!She does not look at me close. She does not look close at all.!!',
      ],
      item: 'handkerchief',
      scars: ['named'],
    },
    {
      id: 'frozen',
      when: (p, player) => p.scales.cold >= 9 || player.composure <= 0,
      title: 'The cold takes you',
      lines: [
        'The room is very cold. ~~I am very tired.~~ I am very tired. I sit down on the bench. She does not look at me.',
        '!!I do not know which of us is waiting now.!!',
      ],
      item: null,
      scars: ['collapsed'],
    },
    {
      id: 'still_waiting',
      when: (p) => p.turn >= 12 && p.scales.waiting >= 7,
      title: 'She outlasts you',
      lines: [
        'She has been waiting longer than I can be a guest. ~~He is not coming.~~ He never was.',
        '!!I leave her on the bench.!!',
      ],
      item: null,
      scars: ['failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'You walk out',
      lines: ['I close the door. She is on the bench. ~~She does not look up.~~ She has not looked up since I came in.'],
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
          ['I look at another. She is humming a chord. Her hands are above the keys.', '~~I never let her finish.~~'],
          ['I look at another. She is on a bench, waiting. Her hands are cold.', 'I sat with her. ~~For an hour.~~ For an hour.'],
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
        'I leave the room with my voice in my hand. The chord is poorer. ~~I am poorer.~~ I am louder.',
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
    "She is at the door before I am all the way through it. She takes my hand. ~~She has been waiting.~~ She knew when I would arrive.",
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
        { at: 0, word: 'hands her own' },
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
        2: 'Her hand has gone back to her lap.',
        1: 'She has stopped insisting.',
        0: 'Her hands are her own. She has let me go.',
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
        3: 'Her hand has found her throat.',
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
    { announce: "The last line, in my hand. ~~She gave the orderly's name.~~" },
  ],

  presented(p) {
    const i = p.scales.insistence;
    const re = p.scales.recognition;
    const g = p.scales.grief;
    const pa = p.scales.panic;
    let grip;
    if (i >= 8)      grip = 'Her hand is on my arm and stays there. She has not let go since I came in.';
    else if (i >= 5) grip = 'Her hand finds my sleeve, often. She does not seem to notice doing it.';
    else if (i >= 2) grip = 'Her hand is in her own lap, sometimes. It has not entirely settled.';
    else             grip = 'Her hands are her own again. They are folded in her lap.';
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
            'I let her hold my hand. I let her look at my face.',
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
              : 'She takes my hand anyway. Absentmindedly.',
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
              'Her hand goes from my arm to her own throat. Her breath has changed.',
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
            'Her hand stays on my arm.',
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
              '!!Her hands fold in her lap.!!',
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
      ],
    },

    {
      id: 'do_you_have_to_go',
      once: true,
      when: (p) => p.scales.panic >= 5 && p.scales.insistence >= 5,
      prose: [
        'She has heard a sound outside the room. Her hand tightens.',
        'She asks: ~~Do you have to go?~~',
      ],
      responses: [
        {
          label: "I'll stay",
          desc: 'Commit.',
          lines: [
            "I say: I'll stay.",
            'Her hand relaxes. Her breath steadies. ~~She had been afraid.~~',
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
          composureCost: 'Her hand is around my arm. It has not let go.',
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
        'Her hand has come up to her own mouth.',
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
            'She gestures with her hands. She names a weight. She names a length.',
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
  role: 'wing', tier: 3,
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
    { announce: 'The last line, in my hand. **She put something in a pond, once.**' },
  ],

  presented(p) {
    const a = p.scales.approach;
    const pd = p.scales.pond;
    const re = p.scales.recognition;
    const rl = p.scales.release;
    let dist;
    if (a >= 8)      dist = '!!She is in front of me. Her hand is on my collar.!!';
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
          composureCost: 'Her hand on my collar was warm.',
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
            'She is silent. She does not turn. Her hands are flat against the wall.',
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
            'The carpet is fabric again, briefly. She watches my hands.',
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
          composureCost: 'Her hand on my collar was warm.',
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
        'She has turned slightly. She is looking at her own hands.',
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
      composureCost: 'Her hand on my collar was warm.',
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
        'I close my hands around it. She lets me. ~~I have a thing now I did not come in with.~~',
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
  role: 'wing', tier: 3,
  file: [
    'Subject was a piano instructor. A student fell from the lesson-room window on [[8]]. Subject did not look up.',
    'Subject composes the same chord. Subject believes the chord will ~~bring the child back~~ correct the moment.',
    'Each near-completion has cost staff [[3]] minutes of unaccounted time. !!Do not stand at the keyboard.!!',
  ],
  intro: [
    'The upright piano is in the corner. She is at the bench. Her hands are above the keys but she is not playing.',
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
        3: 'Her hands have found the last few notes.',
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
    { announce: 'The last line, in my hand. **She did not look up.**' },
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
    let hands;
    if (co >= 7)     hands = 'Her hands are trembling above the keys. Ready to land.';
    else if (co >= 4) hands = 'Her hands are over the keys. She has not pressed any of them.';
    else if (co >= 1) hands = 'Her hands move above the keys. Searching.';
    else              hands = 'Her hands are folded in her lap. She has stopped.';
    let me;
    if (t >= 6)      me = '!!The room is loud. My ears are full.!!';
    else if (s >= 4) me = 'I am very quiet in the corner. The room has space for her.';
    else if (s >= 1) me = 'I am holding still. Listening.';
    else             me = 'I am breathing normally. It is loud, in here.';
    return `${sound} ${hands} ${me}`;
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
              'She lowers her hands. She rests them on the closed lid. She breathes out.',
              '!!She has been waiting for someone to do this.!!',
            ],
            flags: { closed_lid: true },
            scales: { chord: -5, completion: -3, tension: -2 },
          };
        }
        return {
          lines: [
            'I reach to close it. Her hand is on the lid first. She does not push me away.',
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
      desc: 'Lay your hands on the keys with hers. Press together.',
      when: (p) => p.scales.completion >= 6 && p.scales.chord >= 6,
      respond(p) {
        if (p.scales.silence >= 5 && p.scales.completion >= 7 && p.scales.chord >= 7) {
          return {
            lines: [
              'I sit on the bench beside her. I find her shoulder with my shoulder.',
              'I lay my hands on the keys where hers are.',
              'We press. The chord lands. The room composes itself around it.',
              '!!She sets her hands in her lap. She has finished. ~~She does not check the window.~~!!',
            ],
            flags: { finished_chord: true },
            scales: { completion: -8, chord: -8 },
          };
        }
        return {
          lines: [
            'I sit beside her. I lay my hands on the keys. She shakes her head. ~~Not now.~~ Not yet.',
            'She lifts my hands off the keys gently.',
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
        'She pauses with her hands above the keys. She turns her head slightly toward me.',
        'She asks: ~~Can you hear it?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'Confirm. Let her have a listener.',
          lines: [
            'I say: yes.',
            'She returns to the keys. Her hands have steadied. She is no longer alone in this.',
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
            'Her hands move. The chord widens by one note. She is teaching me, briefly.',
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
        'Her hands have stopped, briefly. She is looking at the keys.',
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
        'She has stopped humming. Her hands are above the keys, very still.',
        'She asks: ~~Is this right? Does it sound right?~~',
      ],
      responses: [
        {
          label: 'it sounds right',
          desc: 'Give her the reassurance.',
          lines: [
            'I say: it sounds right.',
            'She nods. She returns to the keys. ~~Her hands are steadier than they were.~~',
          ],
          scales: { completion: +3, silence: +1 },
        },
        {
          label: 'one note is wrong',
          desc: 'Be honest. Point it out.',
          lines: [
            'I say: one of the notes is wrong. The third from the bottom.',
            'She stares at the keys. She lifts her hand. She lowers it. ~~She does not press it.~~',
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
      ],
    },
    {
      id: 'am_I_done',
      once: true,
      when: (p) => p.scales.completion >= 6 && p.scales.silence >= 3,
      prose: [
        'Her hands drop to her lap. She looks at the keys as if for the first time tonight.',
        'She asks me: ~~Am I done?~~',
      ],
      responses: [
        {
          label: "you're done",
          desc: 'Release her.',
          lines: [
            "I say: you're done.",
            'She nods slowly. Her hands rest on the closed lid. ~~She has been waiting.~~',
          ],
          scales: { chord: -3, completion: -2, tension: -2 },
          flags: { closed_lid: true },
          composure: -1,
          composureCost: 'Her hand stopped above the keys. ~~Not because of me.~~',
        },
        {
          label: 'one more note',
          desc: 'Help her finish.',
          lines: [
            'I say: one more note.',
            'She nods. She lifts a hand. She presses one key. ~~The room rings.~~ The building rings.',
          ],
          scales: { completion: +3, chord: +2 },
        },
        {
          label: "I don't know",
          desc: 'Honest.',
          lines: [
            "I say: I don't know. Only you know.",
            'She sits with that. Her hands stay in her lap. She does not begin again.',
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
        'Her hands are in her lap. Mine are still on the keys. She puts hers over mine.',
        'We do not say anything. ~~For a long time.~~ For a long time.',
      ],
      item: 'scrap_of_paper',
    },
    {
      id: 'closed_lid',
      when: (p) => p.flags.closed_lid && p.scales.silence >= 4,
      title: 'You close the lid',
      lines: [
        'The lid is closed. She rests her hands on the wood. The room is quiet for the first time.',
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
        'Her hands drop. She stares at the keys. The chord is in pieces around her.',
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
// registry
// ════════════════════════════════════════════════════════════════════════

export const PATIENTS = {
  pram, pyrelord, soothlick, glimmer, frostfin, hollow, mire, composer, choir,
};

export function getPatient(id) { return PATIENTS[id] || null; }
