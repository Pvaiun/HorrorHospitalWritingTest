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
  name: '[The Empty Pram]',
  glyph: 'Emberkin',
  subtitle: 'the mother has not left.',
  role: 'wing', tier: 1,
  file: [
    'subject was admitted with a pram. the pram is empty.',
    'staff have not informed her [[12]]. she has not asked.',
    'asked when *it* could leave. corrected herself. !!she meant herself.!!',
  ],
  intro: [
    'the door is half-open. she does not look up when I come in. she is sitting on the chair by the window with the pram between her knees.',
    'I close the door. she rocks the pram by the handle. the wheels do not turn.',
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
        2: 'her shoulders ease — by a quarter inch.',
        3: 'something in her has begun to lean toward me.',
        4: 'she is here, with me, in the way mothers are here.',
      },
      crossDown: {
        2: 'her shoulders cinch again. the door is in her face.',
        1: 'she has gone behind her eyes. I am not in this with her.',
        0: '~~she has~~ she has put me out of the room without standing up.',
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
        2: 'her eyes have come up off the blanket.',
        3: 'she is in the room with me — partly.',
        4: '!!she has remembered where she is.!!',
      },
      crossDown: {
        1: 'she has slipped under again.',
        0: 'her eyes are gone. ~~for now.~~',
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
        2: 'her hands have tightened on the handle.',
        3: 'her arms are rigid. the pram is hers, and only hers.',
        4: '!!her hands have stopped being hands.!!',
      },
      crossDown: {
        3: 'her arms ease, by a degree.',
        2: 'her fingers have loosened on the handle.',
        1: 'her hands are her own again. she has set them down.',
        0: 'her hands are open in her lap.',
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
        1: 'her humming has changed pitch.',
        2: 'her rocking has gone off-beat. she is hearing something I cannot.',
        3: 'her anger has turned to fury.',
        4: '!!she has gone somewhere I cannot follow.!!',
      },
      crossDown: {
        2: 'the worst of it has passed. her breath has come back.',
        1: 'she is no longer furious. only angry.',
        0: 'she has calmed.',
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
    { announce: 'a line of her file fills itself in. ~~the pram. the pram is empty.~~' },
    { announce: 'another line, in my hand. **she has not been told.**' },
    { announce: 'the last line writes itself. ~~she meant herself.~~' },
  ],

  presented(p) {
    const t = p.scales.tenderness;
    const g = p.scales.grip;
    const l = p.scales.lucidity;
    const a = p.scales.agitation;
    let arms;
    if (a >= 7)      arms = '!!her arms are rigid. she rocks the pram so fast the room moves with her.!!';
    else if (g >= 7) arms = 'she rocks the pram quickly. her arms are tight around the handle.';
    else if (g >= 4) arms = 'she rocks the pram. steady. the wheels do not turn.';
    else if (g >= 1) arms = 'her hands rest on the pram. she has mostly stopped rocking.';
    else             arms = 'her hands are open. the pram is between her feet.';
    let eyes;
    if (l >= 7)      eyes = 'her eyes are on me. on me. she has not blinked.';
    else if (l >= 4) eyes = 'her eyes find the middle distance. they leave the pram, sometimes.';
    else if (a >= 5) eyes = 'her eyes are somewhere I cannot follow — fixed and far.';
    else             eyes = 'she does not look up. her eyes are on the blanket.';
    let mood;
    if (a >= 7)      mood = '~~something~~ something is wrong. she is hearing the wrong thing.';
    else if (t >= 7) mood = 'she has been waiting for someone. ~~me?~~ for someone.';
    else if (t >= 4) mood = 'her shoulders are not so tight. she hums, sometimes. quietly.';
    else if (t >= 2) mood = 'she hums under her breath. the song is from before.';
    else             mood = 'she does not seem to know I am here.';
    return `${arms} ${eyes} ${mood}`;
  },

  verbs: {

    // ─── always available: two low-risk reads ────────────────────────

    watch_her: {
      label: 'watch her',
      desc: 'sit at the door. observe. let her be in the room first.',
      respond(p) {
        const reps = streakCount(p, 'watch_her');
        if (reps >= 2) {
          return {
            lines: [
              'I watch her again. she has noticed someone watching.',
              'her humming stops. her arms tighten. her eyes do not move.',
              '~~she is performing now. for someone.~~',
            ],
            scales: { grip: +1, agitation: +1 },
            composure: -1,
            composureCost: 'her humming has changed key. ~~it costs.~~',
          };
        }
        if (reps >= 1) {
          return {
            lines: [
              'I watch a while longer. the rhythm of her rocking has a count to it. three short, one long.',
              'her humming changes pitch when the wheels click. ~~she is in a song I cannot hear yet.~~',
            ],
            scales: { lucidity: +1 },
          };
        }
        return {
          lines: [
            'I do not move from the door. I let her be in the room first.',
            'I watch how she holds the handle. I watch which side of the pram she favors. I watch the empty wheels.',
          ],
          scales: { lucidity: +1 },
        };
      },
    },

    sit_near: {
      label: 'sit near her',
      desc: 'lower yourself to the floor at a polite distance.',
      respond(p) {
        const reps = streakCount(p, 'sit_near');
        if (p.scales.agitation >= 6) {
          return {
            lines: [
              'I lower myself to the floor near her. she stiffens. her rocking goes wrong.',
              '!!her humming has gone up half a step. she is hearing me as a stranger.!!',
            ],
            scales: { agitation: +1, grip: +1 },
            composure: -1,
            composureCost: 'her arms have closed around the pram. ~~something between us has shut.~~',
          };
        }
        if (reps >= 2) {
          return {
            lines: [
              'I am very close now. she has stopped humming for a moment.',
              'she leans in my direction, almost. she does not look at me.',
            ],
            scales: { tenderness: +2, grip: -1 },
          };
        }
        return {
          lines: [
            'I sit on the floor a few feet from the chair. close, but not crowding.',
            'her shoulders drop a quarter of an inch. she does not look at me. she does not stop me.',
          ],
          scales: { tenderness: +1, lucidity: +1 },
        };
      },
    },

    // ─── contextual: opened by state, closed by it ─────────────────────

    rock_with_her: {
      label: 'rock with her',
      desc: 'match her rhythm. quietly.',
      when: (p) => p.scales.tenderness >= 3 && p.scales.agitation <= 5,
      respond(p) {
        const reps = streakCount(p, 'rock_with_her');
        if (reps >= 3) {
          return {
            lines: [
              'I rock with her again. and again. ~~the rhythm has become~~ the rhythm has become a thing we are doing.',
              'her face has not changed. she has stopped giving back.',
            ],
            scales: { tenderness: -1, agitation: +1 },
            composure: -1,
            composureCost: 'her face has gone wrong. ~~I can hear the door behind me.~~',
          };
        }
        if (p.scales.grip >= 7) {
          return {
            lines: [
              'I rock with her. her tempo is fast. I match it.',
              'she does not slow. she does not speed. but she is no longer alone with it.',
            ],
            scales: { tenderness: +2, grip: -1 },
          };
        }
        if (p.scales.tenderness >= 5) {
          return {
            lines: [
              'I rock alongside her. her shoulders drop. her humming finds my shoulder. she lets me into the rhythm.',
              'after a while we are not two people, exactly. we are a slower thing.',
            ],
            scales: { tenderness: +2, grip: -2, lucidity: +1 },
          };
        }
        return {
          lines: [
            'I sit on the floor and match her tempo. it catches me before I find it.',
            'after a while she is rocking with me, not despite me.',
          ],
          scales: { tenderness: +1, grip: -1 },
        };
      },
    },

    hum_along: {
      label: 'hum along',
      desc: 'pick up the line she keeps starting.',
      when: (p) => p.scales.grip >= 5 && p.scales.agitation <= 5 && p.scales.tenderness >= 2,
      respond(p) {
        const reps = streakCount(p, 'hum_along');
        if (reps >= 2) {
          return {
            lines: [
              'I keep humming. she has stopped. I am the only one in the song now.',
              'she watches my mouth. ~~she does not know what I am asking for.~~',
            ],
            scales: { grip: +1, agitation: +1 },
            composure: -1,
            composureCost: 'I have done something I cannot take back.',
          };
        }
        if (p.scales.grip >= 8) {
          return {
            lines: [
              'I find the line she keeps starting. I hum a bar of it. she stops.',
              'her eyes flick to me. she does not pick the song up where I left it. she starts it again from the beginning. slower.',
            ],
            scales: { grip: -2, tenderness: +2 },
          };
        }
        return {
          lines: [
            'I hum the bar she keeps coming back to. she meets me on the second beat.',
            'we hold it together a while. her arms loosen slightly around the pram.',
          ],
          scales: { grip: -1, agitation: -1, tenderness: +1 },
        };
      },
    },

    touch_blanket: {
      label: 'touch the blanket',
      desc: 'gentle. lay a hand on the bundle. ~~she does not~~ sometimes she lets you.',
      when: (p) => p.scales.tenderness >= 4 && p.scales.grip <= 4,
      respond(p) {
        const reps = streakCount(p, 'touch_blanket');
        if (reps >= 2) {
          return {
            lines: [
              'I touch the blanket again. she pulls the pram against her chest.',
              '!!she has decided I am the wrong person.!!',
            ],
            scales: { grip: +3, tenderness: -2, agitation: +2 },
            composure: -2,
            composureCost: 'the rocking is the only sound. it is the worst sound.',
          };
        }
        if (p.scales.grip >= 4) {
          return {
            lines: [
              'my hand rests on the blanket. it is cold under my palm.',
              'she stiffens but does not move my hand. she watches it. carefully. as if it might do something on its own.',
            ],
            scales: { grip: -1, agitation: +1 },
            composure: -1,
            composureCost: 'the room is fast now. faster than I am.',
          };
        }
        return {
          lines: [
            'my hand on the blanket. the blanket is folded over what is not there.',
            'she looks at my hand. then at me. she does not pull away.',
            '~~something quiet passes between us.~~',
          ],
          scales: { grip: -2, lucidity: +2, tenderness: +1 },
        };
      },
    },

    look_inside: {
      label: 'look inside',
      desc: 'lift the corner of the blanket. let her see you see.',
      when: (p) => p.scales.grip <= 3 && p.scales.tenderness >= 6 && p.scales.lucidity >= 3,
      respond(p) {
        return {
          lines: [
            'I lift the corner of the blanket. she does not stop me.',
            'the blanket has been folded over itself. neatly. there is nothing else under it.',
            'she watches my face. she is watching to see if I will pretend.',
            '~~I do not pretend.~~ I do not pretend.',
            'something happens in her face — slowly, on her own time.',
          ],
          scales: { lucidity: +4, grip: -3, agitation: -1, tenderness: +1 },
          flags: { saw_inside: true },
        };
      },
    },

    name_the_child: {
      label: 'name the child',
      desc: 'speak a name. ~~yours.~~ someone\'s.',
      when: (p) => p.scales.lucidity >= 4 && p.scales.agitation <= 4,
      respond(p) {
        const reps = streakCount(p, 'name_the_child');
        if (reps >= 1) {
          return {
            lines: [
              'I say another name. a different one this time.',
              'she does not look up. she is past names.',
            ],
            scales: { agitation: +2, lucidity: -1 },
            composure: -1,
            composureCost: 'her humming has changed key. ~~it costs.~~',
          };
        }
        if (p.scales.grip >= 7) {
          return {
            lines: [
              'I say a name. ~~mine.~~ a name.',
              'her arms cinch. her humming stops. somewhere behind her eyes she is leaving the room.',
              '!!she will not come back from this soon.!!',
            ],
            scales: { grip: +2, tenderness: -3, agitation: +4, lucidity: -2 },
            composure: -2,
            composureCost: 'her arms have closed around the pram. ~~something between us has shut.~~',
            flags: { spiked: true },
          };
        }
        if (p.scales.lucidity >= 6 || p.scales.tenderness >= 7) {
          return {
            lines: [
              'I say a name. it is one I half-remember.',
              'she repeats it. quietly. she turns it in her mouth like a stone.',
              'she looks at the pram. she looks at me. ~~she sees~~ she sees.',
            ],
            scales: { lucidity: +3, grip: -2, tenderness: +1 },
          };
        }
        return {
          lines: [
            'I say a name. she does not answer to it. but she looks up.',
            'her eyes are not all the way here. but they are not all the way gone, either.',
          ],
          scales: { lucidity: +2, agitation: +1 },
        };
      },
    },

    tell_her_my_name: {
      label: 'tell her my name',
      desc: 'speak yourself. plainly. as someone from outside.',
      when: (p) => p.scales.agitation >= 5 || (p.scales.lucidity >= 5 && p.scales.tenderness <= 5),
      respond(p) {
        if (p.scales.agitation >= 7) {
          return {
            lines: [
              'I crouch in front of her. I say: !!I am Patient 0413. I came in this morning. I am not from before.!!',
              'her rocking slows by a half. she is hearing me, partially. her eyes flicker to my coat, my hands, my coat again.',
            ],
            scales: { agitation: -3, lucidity: +2 },
            composure: -1,
            composureCost: 'her face has gone wrong. ~~I can hear the door behind me.~~',
          };
        }
        return {
          lines: [
            'I tell her my name and my number. I tell her this is the third floor.',
            'she nods. she does not stop rocking. but she is — slightly — in the same room.',
          ],
          scales: { lucidity: +2, tenderness: +1, agitation: -1 },
        };
      },
    },

    step_away: {
      label: 'step away',
      desc: 'back off. give her the room. ~~it costs~~ it costs you to be useless.',
      when: (p) => p.scales.agitation >= 6,
      respond(p) {
        return {
          lines: [
            'I stand and back up to the door. I keep my eyes on her shoes, not her face.',
            p.scales.agitation >= 8
              ? 'after a long time her humming returns. her tempo slows. the room widens again.'
              : 'the room loosens by a degree. her humming returns, a little.',
          ],
          scales: { agitation: -3, tenderness: -1 },
          composure: -2,
          composureCost: 'I have done something I cannot take back.',
        };
      },
    },

    take_pram: {
      label: 'take the pram',
      desc: 'force. lift it from her hands. ~~she does not~~ she does not always let you.',
      when: (p) => p.scales.agitation >= 7 || (p.scales.tenderness >= 7 && p.scales.grip <= 3),
      respond(p) {
        return {
          lines: [
            'I close my hands over the handle. her hands are over the handle. I lift.',
            p.scales.agitation >= 6
              ? '!!she screams without sound.!! she does not let go quickly. when she does her hands stay in the shape of holding.'
              : (p.scales.tenderness >= 5
                  ? 'she resists, for a moment. then her hands let go. she watches mine.'
                  : 'her hands resist longer than I expect. then her fingers loosen, one at a time. she does not look at me.'),
            'I am holding the pram now. she is not.',
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
    desc: 'let the rocking run on its own. ~~no one comes.~~',
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
        'she stops rocking. she looks up. for the first time since I came in.',
        'she says, quietly: ~~are you here for me?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'tell her yes. lie or not.',
          lines: [
            'I say: yes.',
            'her shoulders drop. she breathes. her hands stay on the handle but they have gone slack.',
            '~~she has been waiting a long time.~~',
          ],
          scales: { tenderness: +3, grip: -2, agitation: -1 },
          composure: -1,
          composureCost: 'the rocking is the only sound. it is the worst sound.',
        },
        {
          label: 'no, I came for someone else',
          desc: 'a softer truth.',
          lines: [
            'I say: no. I came for someone else. I will sit with you while I wait.',
            'she nods. her face does not change. but the rocking slows by half.',
          ],
          scales: { lucidity: +2, grip: -1, tenderness: -1 },
        },
        {
          label: 'I don\'t know',
          desc: 'the most honest answer.',
          lines: [
            'I say: I do not know.',
            'she does not seem surprised. she keeps rocking. she says, mostly to herself: ~~neither did I.~~',
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
        'she pauses the rocking. she covers the blanket with her free hand, protective.',
        'she looks past me at the door, then to me. she whispers: !!she\'s sleeping. yes?!!',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'agree. let her keep the world she has.',
          lines: [
            'I nod. I say: yes. she is sleeping.',
            'her rocking finds a slower rhythm. her shoulders ease. she goes on humming the same five notes.',
            '~~she has not been told.~~',
          ],
          scales: { grip: -1, agitation: -2 },
          scars: ['named'],
        },
        {
          label: 'her arms must be tired',
          desc: 'redirect, without lying.',
          lines: [
            'I say: your arms must be tired. you have been rocking a long time.',
            'she looks at her own arms as if she has just noticed them.',
            'after a moment she sets them down on the handle and does not lift them again.',
          ],
          scales: { grip: -3, lucidity: +2, tenderness: +1 },
        },
        {
          label: 'I don\'t know',
          desc: 'do not tell her either way.',
          lines: [
            'I say: I do not know.',
            'she watches me. her face has shifted. she is preparing for something.',
          ],
          scales: { lucidity: +1, agitation: +3, grip: +1 },
          composure: -1,
          composureCost: 'the room is fast now. faster than I am.',
        },
      ],
    },

    {
      id: 'do_I_know_you',
      once: true,
      when: (p) => p.scales.lucidity >= 5 && p.scales.tenderness >= 5,
      prose: [
        'her humming stops mid-bar. she squints at me.',
        'she says: ~~do I know you?~~',
      ],
      responses: [
        {
          label: 'I don\'t think so',
          desc: 'gentle truth.',
          lines: [
            'I say: I don\'t think so. I came in this morning.',
            'she takes that in. she is not upset. she nods.',
          ],
          scales: { lucidity: +2, grip: -1 },
        },
        {
          label: 'you do',
          desc: 'a kind lie.',
          lines: [
            'I say: you do.',
            'she relaxes — just a little. she does not check. but she does not look at me with full eyes again, after.',
          ],
          scales: { tenderness: +3, lucidity: -3 },
          scars: ['named'],
          composure: -1,
          composureCost: 'her humming has changed key. ~~it costs.~~',
        },
        {
          label: 'I\'m here either way',
          desc: 'sidestep.',
          lines: [
            'I say: it doesn\'t matter. I\'m here either way.',
            'she nods slowly. she is not sure that is true. she keeps rocking.',
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
        'she has stopped humming. she looks at the blanket. then at me.',
        'she asks: ~~whose was she?~~',
      ],
      responses: [
        {
          label: 'yours',
          desc: 'name it. let her have the answer.',
          lines: [
            'I say: she was yours.',
            'she nods. ~~slowly.~~ she nods. she puts her face in her hand.',
            '!!the sound she makes is small, and very old.!!',
          ],
          scales: { lucidity: +3, tenderness: +2, grip: -2 },
          composure: -1,
          composureCost: 'her arms have closed around the pram. ~~something between us has shut.~~',
        },
        {
          label: 'I don\'t know',
          desc: 'do not claim. do not deny.',
          lines: [
            'I say: I don\'t know. tell me about her.',
            'she does. for a long time.',
            '~~for as long as she has.~~ for as long as she has.',
          ],
          scales: { lucidity: +2, tenderness: +1, grip: -1 },
        },
        {
          label: 'someone\'s',
          desc: 'soften it.',
          lines: [
            'I say: someone\'s. someone you loved.',
            'she nods. she takes that. but her eyes have gone past me, to the window.',
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
        'she has started humming louder. faster. her rocking is at the wrong tempo for the song.',
        'she says, not to me: !!shhh shh shh.!! ~~it is not a~~ it is not a lullaby anymore.!!',
      ],
      responses: [
        {
          label: 'shhh with her',
          desc: 'meet her where she is.',
          lines: [
            'I shhh with her. quietly. with the same rhythm.',
            'she does not stop. but the volume drops by half.',
          ],
          scales: { agitation: -2, tenderness: +1 },
          composure: -1,
          composureCost: 'her face has gone wrong. ~~I can hear the door behind me.~~',
        },
        {
          label: 'put a hand on hers',
          desc: 'risk contact. stop the rhythm.',
          lines: [
            'I put my hand over hers on the handle. she does not pull away.',
            '!!her humming stops for a beat.!! ~~she is~~ she is somewhere, listening.',
          ],
          scales: { grip: -2, agitation: -3, lucidity: +1 },
          composure: -1,
          composureCost: 'I have done something I cannot take back.',
        },
        {
          label: 'say nothing',
          desc: 'let her run through it.',
          lines: [
            'I do not move. I let the song run.',
            'it gets louder before it gets quieter. ~~it does~~ it does get quieter.',
          ],
          scales: { agitation: +1, grip: +1 },
          composure: -2,
          composureCost: 'the rocking is the only sound. it is the worst sound.',
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
          'I wait. she rocks harder. the wheels click against the floor. she does not see the room.',
          '~~her humming~~ her humming has become a hum I can hear in my teeth.',
        ],
        scales: { agitation: +2, grip: +1, tenderness: -1 },
        composure: -1,
        composureCost: 'the room is fast now. faster than I am.',
      };
    }
    if (g >= 7) {
      return {
        lines: [
          'I wait. she tucks the blanket in. she tucks it in again. she tucks it in again.',
          'her arms do not tire.',
        ],
        scales: { grip: +1, agitation: +1 },
        composure: -1,
        composureCost: 'her humming has changed key. ~~it costs.~~',
      };
    }
    if (t >= 5 && g <= 4) {
      return {
        lines: [
          'I wait. she rocks slower. a long time passes.',
          'her eyes leave the pram. she watches the wall. her hands forget the rhythm, briefly.',
        ],
        scales: { lucidity: +1, tenderness: +1 },
      };
    }
    return pick([
      { lines: ['she rocks faster. then slower. her arms tighten and ease.'], scales: { grip: +1, agitation: +1 } },
      { lines: ['she pauses. she looks at the pram, sidelong, like she has just remembered something.'], scales: { lucidity: +1, agitation: +1 } },
      { lines: ['I wait. nothing changes. ~~a long time~~ a while passes. it is not pleasant.'], scales: { agitation: +1 }, composure: -1 },
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
      title: 'she lets it go herself',
      lines: [
        'she looks at the pram. she looks at me. ~~she sees~~ she sees what is there.',
        'she lifts the blanket. she folds it. she folds it again. she sets it on the seat of the pram.',
        'she puts her hands in her lap. she does not weep. she sits a long time without rocking.',
        '!!something quiet has been done here. she did it.!!',
      ],
      item: 'worn_ribbon',
    },
    {
      id: 'lets_take',
      when: (p) => p.scales.tenderness >= 9 && p.scales.grip <= 2 && p.scales.lucidity >= 5 && !p.flags.took_pram,
      title: 'she lets you take it',
      lines: [
        'she lifts the bundle out of the pram. she puts it in my arms. she is careful with what is not there.',
        'her hands stay open for a long time after. she does not put them down.',
        'the room is very quiet.',
      ],
      item: 'handkerchief',
    },
    {
      id: 'broke',
      when: (p) => p.scales.agitation >= 10,
      title: 'she breaks',
      lines: [
        'she is rocking and rocking. she does not see me. she does not see the room.',
        'she has gone somewhere I cannot follow. the pram is in her arms still. her hands are the shape of the handle.',
        '!!I close the door behind me. softly. she does not notice.!!',
      ],
      item: null,
      scars: ['witnessed', 'failed'],
    },
    {
      id: 'forced',
      when: (p) => p.flags.took_pram,
      title: 'you take it from her',
      lines(p) {
        if (p.scales.tenderness >= 6 && p.scales.agitation <= 3) {
          return [
            'I have the pram. she lets me. she does not look at me.',
            'her hands are open. she does not know what to do with them.',
            '~~she will be alright.~~ she will be alright.',
          ];
        }
        return [
          'I have the pram. she did not let me. her hands are still in the shape of the handle.',
          'she weeps without sound. she will not look at me.',
          '!!I close the door behind me. she does not stop rocking.!!',
        ];
      },
      item: 'black_coin',
      scars(p) { return (p.scales.tenderness >= 6 && p.scales.agitation <= 3) ? [] : ['taken']; },
    },
    {
      id: 'she_stays',
      when: (p) => p.turn >= 14 && p.scales.lucidity < 6,
      title: 'she outlasts you',
      lines: [
        'she has been rocking longer than I can stay. the hour has moved without me.',
        'I leave the room. she is still humming. she has not noticed.',
      ],
      item: null,
      scars: ['failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'you walk out',
      lines: [
        'I close the door. she keeps rocking. I do not know if she ever knew I was in the room.',
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
  name: '[The Father in the Chair]',
  glyph: 'Pyrelord',
  subtitle: 'he still presides.',
  role: 'wing', tier: 2,
  file: [
    'subject occupies the room as if it remains his.',
    'family report he has been deceased since ~~1986~~ longer.',
    'daughters visit. he **knows their names**.',
  ],
  intro: [
    'he is in the chair. he was in the chair when I came in. ~~he chose it~~ I did not choose this room.',
    'he is looking at the door. he is waiting for someone. he does not seem to see me yet.',
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
        3: 'his weight settles the room again. ~~I am a guest.~~',
        4: 'the room has chosen its master. it is not me.',
      },
      crossDown: {
        2: 'the chair has begun to be a chair.',
        1: 'he is small. he was always small. ~~it took~~ it took years to see.',
        0: 'he is just a man in a chair.',
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
        2: 'his hands have begun to shake.',
        3: 'something in him has come loose.',
        4: '!!he is weeping without sound.!!',
      },
      crossDown: {
        1: 'he has folded the grief back away.',
        0: 'he is composed again. nothing is the matter.',
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
        2: 'his eyes have come off the door, briefly, to me.',
        3: 'he is taking my face in. ~~for the first time.~~',
        4: '!!he is here. all the way here.!!',
      },
      crossDown: {
        1: 'his eyes have gone back to the door.',
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
    { announce: 'a line writes itself in. ~~the room remains his.~~' },
    { announce: 'another. ~~since 1986. longer.~~' },
    { announce: 'the last line, in my hand. **he knows their names.**' },
  ],

  presented(p) {
    const pr = p.scales.presence;
    const g  = p.scales.grief;
    const re = p.scales.recognition;
    let chair;
    if (pr >= 8)      chair = 'he sits in the chair as if it has always been his. his weight settles the room.';
    else if (pr >= 5) chair = 'he sits in the chair. less easily than before. the room is still arranged around him.';
    else if (pr >= 2) chair = 'he is in the chair, smaller now. the room has begun to be a room.';
    else              chair = 'he is small in the chair. it does not fit him.';
    let eyes;
    if (re >= 7)      eyes = 'his eyes are on me. all the way. he knows it is me.';
    else if (re >= 4) eyes = 'his eyes find me, sometimes. then leave for someone he is expecting.';
    else if (re >= 1) eyes = 'he glances at me as if at a stranger\'s coat in his hallway.';
    else              eyes = 'he is looking at someone who is not in the room.';
    let hands;
    if (g >= 7)      hands = 'his hands are folded so tightly they have stopped shaking.';
    else if (g >= 4) hands = 'his hands are folded in his lap. unsteady.';
    else if (g >= 1) hands = 'his hands are at rest on the arms of the chair.';
    else             hands = 'his hands sit composed on the arms of the chair. perfect.';
    return `${chair} ${eyes} ${hands}`;
  },

  verbs: {

    listen_to_him: {
      label: 'listen to him',
      desc: 'attend to what he is saying. stay quiet.',
      respond(p) {
        const reps = streakCount(p, 'listen_to_him');
        if (reps >= 3) {
          return {
            lines: [
              'I have been listening a long time. ~~he~~ he is repeating himself.',
              'he notices my attention has gone glassy. his voice loses certainty for the first time.',
            ],
            scales: { presence: -2, grief: +1 },
          };
        }
        return {
          lines: [
            'I let him speak. I do not interrupt. I do not look away.',
            'he is dictating a letter to a clerk who is not in the room. the letter is to one of his daughters.',
            'he keeps losing his place and starting over. the salutation has changed twice.',
          ],
          scales: { recognition: +1, grief: +1 },
        };
      },
    },

    hold_position: {
      label: 'hold the door',
      desc: 'stand silent at the threshold. decline to acknowledge.',
      respond(p) {
        if (p.scales.presence >= 7) {
          return {
            lines: [
              'I do not enter the room as a guest. I stand at the door. I do not address him.',
              'his eyes find me, briefly. they do not find what they wanted there.',
            ],
            scales: { presence: -2 },
          };
        }
        return {
          lines: [
            'I hold the door. the room is, marginally, mine to leave.',
            'he speaks toward the wall. ~~the wall does not~~ the wall does not answer either.',
          ],
          scales: { presence: -1, recognition: +1 },
        };
      },
    },

    kneel: {
      label: 'kneel',
      desc: 'put yourself lower than him. ~~it costs.~~',
      when: (p) => p.scales.presence >= 6,
      respond(p) {
        if (p.scales.presence >= 8) {
          return {
            lines: [
              'I kneel beside the chair. I look up at him.',
              'he does not look down. he is satisfied this is the correct shape of a room. his hand finds the top of my head, briefly, paternal.',
            ],
            scales: { presence: +1, grief: +1 },
            composure: -2,
            composureCost: 'his quiet is the worst sound in the room.',
          };
        }
        return {
          lines: [
            'I kneel. he does not understand why.',
            'after a moment he reaches out and pats my shoulder. he calls me by a name. ~~it is not mine.~~',
          ],
          scales: { recognition: +1, grief: +1 },
          composure: -1,
          composureCost: 'his hand on my wrist is very cold.',
        };
      },
    },

    interrupt: {
      label: 'speak over him',
      desc: 'cut into his sentence. take the air.',
      when: (p) => p.scales.presence >= 5,
      respond(p) {
        const reps = streakCount(p, 'interrupt');
        if (reps >= 2) {
          return {
            lines: [
              'I interrupt again. and again. he goes quiet.',
              'his quiet is the worst sound in the room. ~~I have~~ I have done something wrong.',
            ],
            scales: { grief: +2, recognition: -1 },
            composure: -2,
            composureCost: '!!the chair is larger than it should be.!!',
          };
        }
        if (p.scales.presence >= 7) {
          return {
            lines: [
              'I speak over him. !!loudly.!! the word LISTEN has its own room briefly.',
              'he stops. he looks at me. for the first time he is not above the room. for a moment he is just in it.',
            ],
            scales: { presence: -2, recognition: +1 },
            composure: -1,
            composureCost: 'I am a guest. I am only a guest.',
          };
        }
        return {
          lines: [
            'I speak over him. he does not protest.',
            'he was not saying anything I had not heard. he was saying it to no one in particular.',
          ],
          scales: { presence: -2, grief: +1 },
        };
      },
    },

    ask_his_name: {
      label: 'ask his name',
      desc: 'gently. as if you had not been told it.',
      when: (p) => p.scales.presence <= 6 && p.scales.recognition >= 2,
      respond(p) {
        return {
          lines: [
            'I ask: what should I call you?',
            p.scales.presence >= 6
              ? 'he gives me the family\'s honorific. without hesitation. it is well-rehearsed.'
              : 'he pauses. it has been a while since anyone asked. he gives me his given name. quietly.',
          ],
          scales: { recognition: +2, presence: -1 },
        };
      },
    },

    call_by_name: {
      label: 'call him by name',
      desc: 'his given name. not "father", not "sir".',
      when: (p) => p.scales.recognition >= 5,
      respond(p) {
        const reps = streakCount(p, 'call_by_name');
        if (reps >= 1) {
          return {
            lines: [
              'I say the name again. he had only just been the man who answered to it.',
              'I am asking too much of him too fast.',
            ],
            scales: { grief: +1, recognition: -1 },
            composure: -1,
            composureCost: 'the door does not need to be watched. ~~it does anyway.~~',
          };
        }
        if (p.scales.recognition >= 7) {
          return {
            lines: [
              'I say it. his given name. the one his mother used.',
              'he turns toward me. all the way. ~~he is here.~~ he is here.',
              'his eyes fill. he does not speak.',
            ],
            scales: { recognition: +3, grief: +3, presence: -3 },
          };
        }
        return {
          lines: [
            'I say it. his given name.',
            'he frowns. he is trying to remember if anyone calls him that.',
            'something passes through him. he does not speak for a moment.',
          ],
          scales: { recognition: +2, grief: +1, presence: -1 },
        };
      },
    },

    touch_his_hand: {
      label: 'touch his hand',
      desc: 'a small contact. nothing more.',
      when: (p) => p.scales.grief >= 5 && p.scales.recognition >= 4,
      respond(p) {
        return {
          lines: [
            'I put my hand over his on the arm of the chair. his hand is dry and very still.',
            p.scales.recognition >= 6
              ? 'he turns his hand and holds mine back. firmly. the grip is the grip of someone holding onto a railing.'
              : 'he does not move his hand. but he does not move it away.',
          ],
          scales: { grief: +2, recognition: +1, presence: -1 },
        };
      },
    },

    sit_in_chair: {
      label: 'sit in the chair',
      desc: 'lift him out. take the seat. claim the room.',
      when: (p) => p.scales.presence <= 3,
      respond(p) {
        if (p.scales.presence <= 1) {
          return {
            lines: [
              'I help him out of the chair. he is light. he goes without protest.',
              'I sit. the chair fits. the room composes itself around me.',
              'he stands a while, then sits on the floor at my feet, like a guest.',
              '!!the room is mine now.!!',
            ],
            scales: { presence: -5 },
            composure: -1,
            composureCost: 'he has not blinked. ~~for a long time.~~',
            flags: { sat_in_chair: true },
          };
        }
        return {
          lines: [
            'I take his arm to lift him. he plants his weight.',
            'his hand on my wrist is very cold. ~~I do not~~ I do not force it. not yet.',
          ],
          scales: { grief: +1, presence: +1 },
          composure: -1,
          composureCost: 'his quiet is the worst sound in the room.',
        };
      },
    },

    close_his_eyes: {
      label: 'close his eyes',
      desc: 'lay a hand over them. let him stop watching the door.',
      when: (p) => p.scales.grief >= 6 && p.scales.presence <= 4,
      respond(p) {
        if (p.scales.grief >= 7) {
          return {
            lines: [
              'I close his eyes with my palm. his lashes are dry.',
              'he does not resist. ~~he~~ a long held breath leaves him.',
              'the chair is suddenly too large.',
              '!!the room is a room again.!!',
            ],
            flags: { closed_eyes: true },
            scales: { presence: -4, grief: -2 },
            composure: -1,
            composureCost: 'his hand on my wrist is very cold.',
          };
        }
        return {
          lines: [
            'I reach. he flinches. he is still watching the door for someone.',
            'I lower my hand. !!not yet.!!',
          ],
          scales: { grief: +1, presence: +1 },
          composure: -1,
          composureCost: '!!the chair is larger than it should be.!!',
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'let him hold the room. wait him out — or for him to slip.',
    when: (p) => p.scales.presence >= 7 || p.turn >= 5,
  },

  // ─── interjections — five authored, only some fire in any run ───────

  interjections: [
    {
      id: 'young_man',
      once: true,
      when: (p) => p.scales.presence >= 8 && p.turn >= 2,
      prose: [
        'he raises a hand for silence — though no one is speaking. he turns his head toward me. precisely.',
        'he says: ~~young man.~~ ~~young woman.~~ — he tries both. — !!you may sit.!!',
      ],
      responses: [
        {
          label: 'sit',
          desc: 'accept his courtesy.',
          lines: [
            'I sit on the chair he indicates. it is a guest chair, set across from his.',
            'he nods, satisfied. the room is shaped correctly again. ~~he has~~ he has a visitor.',
          ],
          scales: { presence: +2, recognition: +1 },
          composure: -1,
          composureCost: 'I am a guest. I am only a guest.',
        },
        {
          label: 'stay standing',
          desc: 'do not take the offered place.',
          lines: [
            'I do not sit. I stay where I am.',
            'his hand stays in the air a moment longer than is comfortable. then he lowers it.',
            'he had not anticipated this. he is, briefly, surprised.',
          ],
          scales: { presence: -2, recognition: +1 },
        },
        {
          label: 'I\'m not young',
          desc: 'correct him.',
          lines: [
            'I say: I am not young. ~~not~~ not now.',
            'he looks at me with new eyes. for a moment he is not sure what year it is. for a moment he allows that he is not sure.',
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
        'he stops mid-sentence. his eyes track something across the room that is not there.',
        'he says, smaller: ~~I had a son.~~ ~~I had~~ — ~~I think I had a son.~~',
      ],
      responses: [
        {
          label: 'tell me about him',
          desc: 'invite the memory.',
          lines: [
            'I ask: what was he like?',
            'he begins. he begins three times. it has been a long time since anyone asked.',
            'after a while his account becomes very specific — a knee scar, a way of saying a particular word.',
            '!!he is here. he is talking about someone real.!!',
          ],
          scales: { grief: +3, recognition: +3, presence: -3 },
          composure: -1,
          composureCost: 'the door does not need to be watched. ~~it does anyway.~~',
        },
        {
          label: 'are you sure?',
          desc: 'gently doubt the memory.',
          lines: [
            'I ask: are you sure?',
            'he is quiet for a long time. then he says: ~~no.~~ ~~yes.~~ ~~I think so.~~',
            'the not-knowing is more painful than the knowing.',
          ],
          scales: { grief: +2, presence: -2 },
          composure: -2,
          composureCost: 'he has not blinked. ~~for a long time.~~',
        },
        {
          label: 'I think you did',
          desc: 'affirm without claiming to know.',
          lines: [
            'I say: I think you did.',
            'he nods, relieved. he looks at me with great attention.',
            '~~he is grateful in a way I did not earn.~~',
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
        'he has stopped speaking. his hands are folded in his lap. he looks tired.',
        'he asks, almost without volume: ~~what do you want me to say?~~',
      ],
      responses: [
        {
          label: 'nothing',
          desc: 'release him from the duty.',
          lines: [
            'I say: nothing.',
            'he sits with that. his hands unfold. he leans back into the chair. it is the first time he has used it as a chair, not as a throne.',
          ],
          scales: { grief: +3, presence: -3 },
        },
        {
          label: 'your name',
          desc: 'ask for what no one has asked.',
          lines: [
            'I say: your name. the one you don\'t use anymore.',
            'he stares at the wall. ~~he is trying to find it.~~ he is trying to find it.',
            'eventually he says it. quietly. then again, louder, as if to himself.',
          ],
          scales: { recognition: +3, grief: +1 },
        },
        {
          label: 'tell me you\'re finished',
          desc: 'gentle. precise.',
          lines: [
            'I say: tell me you\'re finished.',
            'he looks up at me. for a long time he does not say anything.',
            'then he says: ~~yes.~~ ~~I am.~~ his eyes close.',
          ],
          scales: { grief: +4, presence: -4 },
          composure: -1,
          composureCost: 'his quiet is the worst sound in the room.',
        },
      ],
    },

    {
      id: 'the_clerk',
      once: true,
      when: (p) => p.scales.presence >= 7 && p.turn >= 4,
      prose: [
        'he stops dictating. he turns his head slightly. he addresses a corner of the room.',
        'he says: !!Mr. Hargrove — take this down.!! ~~there is no~~ there is no Mr. Hargrove.',
      ],
      responses: [
        {
          label: 'pretend to take it down',
          desc: 'play the clerk.',
          lines: [
            'I take a notepad I do not have. I write nothing on it.',
            'he dictates a paragraph that sounds like the end of something. when he is finished, he nods at me to file it.',
          ],
          scales: { presence: +1, grief: +1, recognition: -1 },
          composure: -1,
          composureCost: 'his hand on my wrist is very cold.',
        },
        {
          label: 'there is no clerk',
          desc: 'say it.',
          lines: [
            'I say: there is no clerk here. it is only me.',
            'he frowns. he is trying to place me. he is failing.',
            '!!his voice has lost an inch of itself.!!',
          ],
          scales: { presence: -3, recognition: +2, grief: +2 },
          composure: -1,
          composureCost: '!!the chair is larger than it should be.!!',
        },
        {
          label: 'who was Hargrove',
          desc: 'ask him.',
          lines: [
            'I ask: who was Mr. Hargrove?',
            'he is quiet for a long time. ~~he is not sure.~~ he is not sure.',
            'eventually he says: a friend. a long time ago.',
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
        'his head tilts. he looks at me as if he had only just noticed I was not one of his daughters.',
        'he asks: ~~where are my daughters?~~',
      ],
      responses: [
        {
          label: 'they\'ll come',
          desc: 'gentle. probably a lie.',
          lines: [
            'I say: they\'ll come.',
            'he nods. he goes back to watching the door.',
            '~~he has been doing this a long time.~~',
          ],
          scales: { presence: +2, recognition: -1, grief: -1 },
          scars: ['named'],
        },
        {
          label: 'they came already',
          desc: 'the more painful truth.',
          lines: [
            'I say: they came. yesterday. you don\'t remember.',
            'he sits with that. he looks at his hands. he says: ~~oh.~~ ~~yes.~~',
            '!!the room is suddenly larger than he is.!!',
          ],
          scales: { presence: -3, grief: +3, recognition: +1 },
          composure: -2,
          composureCost: 'I am a guest. I am only a guest.',
        },
        {
          label: 'tell me their names',
          desc: 'redirect to what he has.',
          lines: [
            'I say: tell me their names.',
            'he does. one at a time. he says them like a prayer he has kept the form of.',
          ],
          scales: { recognition: +3, grief: +2, presence: -1 },
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.presence >= 7) {
      return pick([
        { lines: ['I wait. he speaks. he is dictating something to a clerk who is not in the room.'], scales: { presence: +1 } },
        { lines: ['I wait. someone (a daughter?) knocks at the door, briefly. she does not come in. he nods, as if she had.'], scales: { presence: +1 }, composure: -1 },
        { lines: ['I wait. he recounts a victory. it is one I have not heard before. it might be true.'], scales: { presence: +2 } },
      ]);
    }
    if (p.scales.recognition >= 4) {
      return {
        lines: [
          'I wait. he turns slowly to look at me.',
          'he says: ~~when did you come in?~~ when did you come in?',
        ],
        scales: { grief: +1, recognition: +1 },
      };
    }
    return {
      lines: ['I wait. the room is still. ~~someone is~~ no one is at the door.'],
      scales: { presence: -1 },
    };
  },

  endings: [
    {
      id: 'close_eyes',
      when: (p) => p.flags.closed_eyes && p.scales.grief >= 4 && p.scales.presence <= 2,
      title: 'you let him rest',
      lines: [
        'he is gone. his hands are open in his lap.',
        'the room is a room. the chair is just a chair.',
        '!!the door does not need to be watched.!!',
      ],
      item: 'small_bell',
    },
    {
      id: 'name_kept',
      when: (p) => p.scales.recognition >= 9 && p.scales.grief >= 6,
      title: 'you keep his name',
      lines: [
        'I write his name on the wall. he watches me do it. he does not stop me.',
        'I leave the room with the name in my mouth. he sits very still in the chair.',
        '!!the wall keeps it.!!',
      ],
      item: 'scrap_of_paper',
    },
    {
      id: 'took_chair',
      when: (p) => p.flags.sat_in_chair,
      title: 'you take his place',
      lines: [
        'the chair fits. the room is mine. he is on the floor still.',
        'he calls me sir, once, without irony. ~~I do not~~ I do not correct him.',
      ],
      item: 'ink_bottle',
      scars: ['named'],
    },
    {
      id: 'walks_out',
      when: (p) => p.scales.presence >= 9 && p.turn >= 8,
      title: 'he outlasts you',
      lines: [
        'he is in the chair. he has always been in the chair. I cannot find an edge to begin from.',
        '!!I leave him to it. the door is heavier than I expected.!!',
      ],
      item: null,
      scars: ['failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'you walk out',
      lines: ['I close the door. he was speaking when I left. ~~he kept speaking.~~ he kept speaking.'],
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
  name: '[The Night Nurse]',
  glyph: 'Soothlick',
  subtitle: 'other patients have stopped reporting it.',
  role: 'wing', tier: 2,
  file: [
    'patient was a night nurse for ~~thirty~~ thirty-eight years.',
    'found in other patients\' rooms after lights-out. she does not turn the door handle.',
    'patients she has tended report **sleeping better**. they do not wake all the way.',
  ],
  intro: [
    'the lights have gone down. the room is dim in a way I do not remember being dim a minute ago.',
    'she is at the foot of a bed. ~~mine~~ a bed. she is straightening a sheet. she has not looked at me yet.',
  ],

  scales: {
    trust: {
      initial: 0, min: 0, max: 10, label: 'trust', kind: 'positive',
      bands: [
        { at: 0, word: 'a stranger' },
        { at: 2, word: 'her patient' },
        { at: 5, word: 'a person' },
        { at: 7, word: 'kin' },
        { at: 9, word: 'kept' },
      ],
      crossUp: {
        2: 'she has started to see me as a person, not a chart.',
        3: 'she trusts me with the small instruments.',
        4: '~~she would let me close her eyes if I asked.~~',
      },
      crossDown: {
        1: 'her hands have gone back to the chart.',
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
        2: 'her eyes have come up off the sheet, briefly.',
        3: 'she has noticed the year.',
        4: '!!she is here. she is awake.!!',
      },
      crossDown: {
        1: 'she has slipped back into the work.',
        0: 'her hands have resumed without her.',
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
        2: 'she has gone deeper into the work.',
        3: 'she has decided which work needs doing tonight.',
        4: '!!she is not going to stop until she has finished.!!',
      },
      crossDown: {
        2: 'her hands have left the work, for a moment.',
        1: 'she has set the tray down.',
        0: 'she has stopped tending. it is the first time.',
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
    { announce: 'a line of her file fills in. ~~thirty-eight years.~~' },
    { announce: 'another line. **she does not turn the door handle.**' },
    { announce: 'the last line. ~~they do not wake all the way.~~' },
  ],

  presented(p) {
    const t = p.scales.tending;
    const s = p.scales.sight;
    const tr = p.scales.trust;
    const dr = p.playerEffects.drowsing || 0;
    let work;
    if (t >= 8)      work = 'she is at my bedside. she has decided which work needs doing tonight.';
    else if (t >= 5) work = 'she is at the bedside. she is doing the work she came to do.';
    else if (t >= 2) work = 'she is pacing. her hands keep finding things to fix.';
    else             work = 'she has stopped. she is at the door, not sure if she should leave.';
    let eyes;
    if (s >= 7)      eyes = 'her eyes are on me. she knows what year it is. she has decided to be here anyway.';
    else if (s >= 4) eyes = 'her eyes find me sometimes. she is not sure who she is tending.';
    else if (tr >= 4) eyes = 'her eyes have started to make me out. ~~as a person.~~';
    else             eyes = 'her eyes are on her work. they are not on me.';
    let sleep;
    if (dr >= 6)      sleep = '!!the room is very warm. I have closed my eyes once already without meaning to.!!';
    else if (dr >= 3) sleep = '~~the room is~~ the room is heavier than it was. my eyelids are.';
    else if (dr >= 1) sleep = 'the room is very warm.';
    else              sleep = 'the room is cold and bright.';
    return `${work} ${eyes} ${sleep}`;
  },

  verbs: {

    refuse_quietly: {
      label: 'refuse quietly',
      desc: 'shake your head. wave her off. don\'t take what she\'s offering.',
      respond(p, player) {
        const sleepless = (p.flags.glass_clutched || player.items?.includes('sliver_of_glass'));
        const reps = streakCount(p, 'refuse_quietly');
        if (reps >= 2) {
          return {
            lines: [
              'I wave her off again. and again. she is patient. she will be back.',
              'but my refusal has become a routine — and routine is what she works in.',
            ],
            playerEffects: sleepless ? {} : { drowsing: +1 },
            composure: -1,
            composureCost: 'her humming is the sound the room makes. ~~I am tired.~~',
          };
        }
        return {
          lines: [
            'I wave her off. I say: !!I do not need this.!!',
            'she sets the tray down anyway. her face does not change.',
            'but she does not press. her hands go back to her sides.',
          ],
          scales: { tending: -2 },
          playerEffects: sleepless ? {} : { drowsing: -1 },
        };
      },
    },

    sit_up: {
      label: 'sit up straighter',
      desc: 'visible alertness. effortful.',
      respond(p, player) {
        const sleepless = (p.flags.glass_clutched || player.items?.includes('sliver_of_glass'));
        const reps = streakCount(p, 'sit_up');
        if (reps >= 2) {
          return {
            lines: [
              'I sit up again. and again. ~~it is~~ it is taking something out of me.',
              'she has gone back to fixing the sheet.',
            ],
            scales: { sight: +1 },
            composure: -1,
            composureCost: 'the dark window is the loudest thing here.',
          };
        }
        return {
          lines: [
            'I square my shoulders. I plant my feet. I am being a person, deliberately.',
            'her hand pauses above the sheet. she has to revise something.',
          ],
          scales: { sight: +1, tending: -1 },
          playerEffects: sleepless ? {} : { drowsing: -1 },
        };
      },
    },

    accept_tending: {
      label: 'let her tend you',
      desc: 'close your eyes a moment. let her smooth the sheet.',
      when: (p) => p.scales.tending >= 4,
      respond(p, player) {
        const sleepless = (p.flags.glass_clutched || player.items?.includes('sliver_of_glass'));
        const reps = streakCount(p, 'accept_tending');
        if (reps >= 1) {
          return {
            lines: [
              'I let her again. her hands are practiced. ~~I am~~ I am getting better at letting.',
              'she hums something low. it is a song I half-recognize but cannot place.',
            ],
            scales: { trust: +1, tending: +1 },
            playerEffects: sleepless ? {} : { drowsing: +3 },
          };
        }
        return {
          lines: [
            'I let her hand cool my forehead. her fingers smell of paper and bleach.',
            p.scales.tending >= 6
              ? 'she hums something soft. she has done this a long time. she is good at it.'
              : 'her hand is unsteady. she is not sure she remembers how this part goes.',
            sleepless
              ? '~~I do not~~ I do not close my eyes. ~~her~~ her hum does not catch.'
              : '~~her hum~~ her hum is the sound the room makes.',
          ],
          scales: { trust: +2, tending: +1 },
          playerEffects: sleepless ? {} : { drowsing: +2 },
        };
      },
    },

    ask_about_shift: {
      label: 'ask about her shift',
      desc: 'when did she come on? when is she off?',
      when: (p) => p.scales.trust >= 3 && p.scales.sight <= 6,
      respond(p) {
        const reps = streakCount(p, 'ask_about_shift');
        if (reps >= 1) {
          return {
            lines: [
              'I ask again, differently. how long has she been here? the question lands somewhere it had been avoiding.',
              'she stares at the dark window for a long time. she does not answer.',
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
              'she answers without thinking: !!seven.!! then she stops. she looks at the dark window. ~~a long time ago~~ a long time ago.',
            ],
            scales: { sight: +3, tending: -2 },
          };
        }
        return {
          lines: [
            'I ask: when did you come on?',
            'she says: at seven. she says it the way she always says it. she does not look at the clock.',
            'something passes behind her eyes — briefly.',
          ],
          scales: { sight: +1 },
        };
      },
    },

    break_a_vial: {
      label: 'break a vial',
      desc: 'sweep the tray. shock her.',
      when: (p) => p.scales.tending >= 7 && p.scales.sight <= 4,
      respond(p) {
        return {
          lines: [
            'I sweep my hand across her tray. a vial breaks. the noise is very loud in the room.',
            'she stares at the floor. her hands shake. her face is the face of someone who has lost something irreplaceable.',
            '!!I should not have done this.!!',
          ],
          scales: { sight: +3, tending: +2 },
          playerEffects: { drowsing: -2 },
          composure: -2,
          composureCost: 'her hand is cool. ~~I do not~~ I do not move away.',
          scars: ['witnessed'],
          shake: true,
        };
      },
    },

    say_her_name: {
      label: 'say her name',
      desc: 'use the name on her file. not "nurse".',
      when: (p) => p.scales.sight >= 3 && p.scales.trust >= 3,
      respond(p, player) {
        const r_ = player.items?.includes('scrap_of_paper');
        if (r_) {
          return {
            lines: [
              'I say her name. I say it the way she would have been called for. ~~I have practiced.~~',
              'she stops. she stands very still. she says: yes? — as if she has heard the question, not the name.',
            ],
            scales: { sight: +3, trust: +2 },
          };
        }
        return {
          lines: [
            'I say her name. ~~the one she does not~~ the one on her file.',
            p.scales.sight >= 5
              ? 'she answers to it. she says: yes? she has not been spoken to in a while.'
              : 'she does not turn. she goes on straightening the sheet, but slowly. it is a name she half-recognizes.',
          ],
          scales: { sight: +2 },
        };
      },
    },

    take_her_hand: {
      label: 'take her hand',
      desc: 'gently. stop hers from working.',
      when: (p) => p.scales.trust >= 5 && p.scales.sight >= 4,
      respond(p) {
        return {
          lines: [
            'I take her hand. she lets me. her fingers are cool and very thin.',
            'she does not move. for a while we are two people holding still.',
            p.scales.sight >= 5
              ? '~~she squeezes back, briefly.~~ she squeezes back, briefly.'
              : 'her hand stays where I put it.',
          ],
          scales: { trust: +3, tending: -2 },
        };
      },
    },

    sit_vigil: {
      label: 'sit the vigil with her',
      desc: 'pull up a chair. tend the room with her, not at her.',
      when: (p) => p.scales.trust >= 6 && p.scales.sight >= 5,
      respond(p) {
        return {
          lines: [
            'I pull up a chair beside the bedside. I do what she does. I match her care.',
            'after a while she shows me how to straighten the corner of the sheet. it has to be exact.',
          ],
          scales: { trust: +3, sight: +1, tending: -1 },
          flags: { kept_vigil: true },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'lie still. let her work around me. ~~it is heavy.~~',
    when: (p) => p.scales.tending >= 5 || p.turn >= 5,
  },

  interjections: [
    {
      id: 'who_are_you_tonight',
      once: true,
      when: (p) => p.scales.tending >= 6 && p.turn >= 2,
      prose: [
        'her hand pauses on the corner of the sheet. she looks at me as if she has just realized I am there.',
        'she asks: ~~who are you tonight?~~',
      ],
      responses: [
        {
          label: 'a new patient',
          desc: 'accept her premise.',
          lines: [
            'I say: a new patient.',
            'she nods. she has done this a thousand times. her hands resume.',
          ],
          scales: { tending: +2 },
          playerEffects: { drowsing: +2 },
          scars: ['named'],
        },
        {
          label: 'a visitor',
          desc: 'a small lie.',
          lines: [
            'I say: a visitor.',
            'she pauses. she looks at the dark window. she has not had a visitor in a while.',
          ],
          scales: { sight: +2, tending: -1 },
        },
        {
          label: 'someone who came to find you',
          desc: 'the truest answer.',
          lines: [
            'I say: someone who came to find you.',
            'her hand stops. her face does several things in sequence.',
            'she lets the sheet go.',
          ],
          scales: { sight: +3, trust: +2, tending: -3 },
          composure: -1,
          composureCost: 'the corner of the sheet is not right. ~~I cannot~~ I cannot fix it.',
        },
      ],
    },

    {
      id: 'what_year',
      once: true,
      when: (p) => p.scales.sight >= 5 && p.turn >= 3,
      prose: [
        'she stops mid-fold. her eyes look very tired suddenly.',
        'she asks, quietly: ~~what year is it?~~',
      ],
      responses: [
        {
          label: 'tell her the truth',
          desc: 'gently.',
          lines: [
            'I tell her. she does not contradict me. she does not say anything for a long time.',
            'eventually she sits on the foot of the bed. she has not sat down in a while.',
          ],
          scales: { sight: +3, trust: +2, tending: -4 },
          composure: -1,
          composureCost: 'I have been a patient too long.',
        },
        {
          label: 'it doesn\'t matter',
          desc: 'kind refusal.',
          lines: [
            'I say: it doesn\'t matter. you are needed here regardless.',
            'she nods, almost grateful. her hands resume — slower now.',
          ],
          scales: { trust: +2, tending: -1 },
          scars: ['named'],
        },
        {
          label: 'I don\'t know',
          desc: 'meet her where she is.',
          lines: [
            'I say: I don\'t know.',
            'she lets out a small breath. she looks at me as if I had answered the easier question correctly.',
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
        'she has stopped fixing the sheet. she sits beside me on the bed.',
        'she asks: ~~will you stay until the light comes back?~~',
      ],
      responses: [
        {
          label: 'I\'ll stay',
          desc: 'commit.',
          lines: [
            'I say: I\'ll stay.',
            'she nods. she takes my wrist, gently, like checking a pulse.',
            'I do not move. the hour passes through us.',
          ],
          scales: { trust: +3, sight: +2, tending: -3 },
          composure: -1,
          composureCost: 'her humming is the sound the room makes. ~~I am tired.~~',
          flags: { kept_vigil: true },
        },
        {
          label: 'I can\'t',
          desc: 'a small kindness.',
          lines: [
            'I say: I can\'t. but I will stay as long as I can.',
            'she nods. she does not let go of my wrist immediately.',
          ],
          scales: { trust: +1, tending: -1, sight: -1 },
        },
        {
          label: 'someone else will',
          desc: 'redirect.',
          lines: [
            'I say: someone else will. ~~there will be someone.~~',
            'she does not believe me, exactly. but she stops asking.',
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
        'she pauses with her hand on the corner of the sheet. she watches me.',
        'she asks: ~~did you come for me, tonight?~~',
      ],
      responses: [
        {
          label: 'I did',
          desc: 'meet her there.',
          lines: [
            'I say: I did.',
            'she sets the sheet down. she sits on the foot of the bed. ~~she has been~~ she has been waiting.',
          ],
          scales: { sight: +3, trust: +2, tending: -3 },
        },
        {
          label: 'I came for the room',
          desc: 'less than yes.',
          lines: [
            'I say: I came for the room.',
            'she nods slowly. she takes the sheet up again. her humming has changed key.',
          ],
          scales: { sight: +1, tending: -1 },
        },
        {
          label: 'no one came',
          desc: 'sharp truth.',
          lines: [
            'I say: no one came. ~~not for years.~~',
            'her hand stops mid-fold. ~~she~~ she does not say anything.',
            '!!the room has aged a decade in a second.!!',
          ],
          scales: { sight: +4, tending: -3, trust: -1 },
          composure: -2,
          composureCost: 'the dark window is the loudest thing here.',
        },
      ],
    },

    {
      id: 'I_was_supposed_to',
      once: true,
      when: (p) => p.scales.sight >= 7 && p.turn >= 5,
      prose: [
        'she has the sheet halfway folded. she is looking at her hands.',
        'she says, ~~to herself~~ to herself: I was supposed to be home by now.',
      ],
      responses: [
        {
          label: 'they\'ll be waiting',
          desc: 'a kind lie.',
          lines: [
            'I say: they\'ll still be there.',
            'she nods. ~~she does not~~ she does not check.',
          ],
          scales: { trust: +1, tending: -1, sight: -1 },
          scars: ['named'],
        },
        {
          label: 'you can go',
          desc: 'release her.',
          lines: [
            'I say: you can go. the work is done.',
            'she looks at the dark window. she does not stand. but she stops folding.',
            '~~her hands are her own.~~',
          ],
          scales: { sight: +3, tending: -4 },
          composure: -1,
          composureCost: '!!I should not have done that.!!',
        },
        {
          label: 'who\'s home',
          desc: 'ask.',
          lines: [
            'I ask: who is at home?',
            'she names someone. quietly. it has been a long time since she said the name out loud.',
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
          'I wait. her hand finds my forehead. ~~I close~~ I close my eyes.',
          'I am very warm. the room is very dim. the bed is very soft. I have been awake a long time.',
        ],
        scales: { tending: +1 },
        composure: -1,
        composureCost: 'her hand is cool. ~~I do not~~ I do not move away.',
      };
    }
    if (dr >= 4) {
      return {
        lines: [
          'I wait. she straightens the sheet under my chin. her humming is the sound the room makes.',
        ],
        scales: { tending: +1 },
        composure: -1,
        composureCost: 'the corner of the sheet is not right. ~~I cannot~~ I cannot fix it.',
      };
    }
    return {
      lines: ['I wait. her shoes make no sound on the floor.'],
      scales: { tending: +1 },
    };
  },

  endings: [
    {
      id: 'sleep',
      when: (p) => (p.playerEffects.drowsing || 0) >= 8,
      title: 'she tends you to sleep',
      lines: [
        'her hand is cool on my forehead. her humming is the sound the room makes.',
        '~~I~~ I close my eyes. when I open them I am still here. ~~but I have~~ but I have lost something I cannot find again.',
        '!!I do not know how long I was gone.!!',
      ],
      item: 'vial',
      scars: ['witnessed'],
    },
    {
      id: 'vigil_kept',
      when: (p) => p.flags.kept_vigil && p.scales.sight >= 7 && p.scales.trust >= 7,
      title: 'you keep her vigil',
      lines: [
        'I sit with her at the bedside. she shows me how to do it.',
        'we straighten sheets for someone who is not in the bed. it takes a long time. ~~hours.~~ hours.',
        '!!she lets me leave when the light comes back.!!',
      ],
      item: 'small_bell',
    },
    {
      id: 'woken',
      when: (p) => p.scales.sight >= 9 && p.scales.tending <= 2,
      title: 'you wake her',
      lines: [
        'she looks at the clock. she looks at me. her face is a face that has been awake too long.',
        'she says: ~~I should have gone home~~ I should have gone home.',
        'she sits down on the floor. she does not put down the tray.',
      ],
      item: 'sliver_of_glass',
    },
    {
      id: 'too_long',
      when: (p) => p.scales.tending >= 9 && p.turn >= 8,
      title: 'her work outlasts you',
      lines: [
        'she works around me. I am one of the things she is straightening tonight.',
        '!!I leave before she finishes.!!',
      ],
      item: null,
      scars: ['failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'you walk out',
      lines: [
        'I close the door. she is still straightening the sheet. ~~for someone who is not~~ for someone.',
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
  name: '[The Boy at the Wall]',
  glyph: 'Glimmerfox',
  subtitle: 'he was eight. he doesn\'t blink.',
  role: 'wing', tier: 3,
  file: [
    'patient was eight when it ran into the road.',
    'he watched. the rest of the family looked away. he ~~has not~~ cannot stop.',
    'subject sits at his feet. he pets it. **it has been forty years.**',
  ],
  intro: [
    'he is on the floor by the wall. he has not stood up. his hand is on something at his side that is not there.',
    'his eyes are open. they have been open since I came in. they have been open since he was eight.',
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
        2: 'he has noticed I am in the room.',
        3: 'his hand has found my sleeve.',
        4: '~~he is eight.~~ he is here. he is eight, here.',
      },
      crossDown: {
        1: 'he has slipped back into the wall.',
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
        3: 'his eyes have stopped moving.',
        4: '!!he has not blinked in some time.!!',
      },
      crossDown: {
        2: 'he has blinked. ~~once.~~',
        1: 'his eyes have begun to close.',
        0: '!!his eyes are closed.!!',
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
        2: 'the question is louder than it was.',
        3: 'his lips are shaping a word.',
        4: '!!the question has come to the front of his mouth.!!',
      },
      crossDown: {
        2: 'the question has eased.',
        1: 'the question has been answered.',
        0: 'he is not asking anymore.',
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
    { announce: 'a line of his file fills in. ~~he was eight when it ran into the road.~~' },
    { announce: '**he watched. the rest of the family looked away.**' },
    { announce: 'the last line, in my hand. ~~it has been forty years.~~' },
  ],

  presented(p) {
    const pr = p.scales.present;
    const st = p.scales.stare;
    const ps = p.scales.pressure;
    let eyes;
    if (st >= 8)      eyes = 'his eyes are wide open. he has not blinked. ~~he cannot.~~';
    else if (st >= 5) eyes = 'his eyes track me, slowly, then go back to the door.';
    else if (st >= 2) eyes = 'his eyes are heavier than they were. he blinks, sometimes.';
    else              eyes = 'his eyes are closed. his shoulders are loose.';
    let mouth;
    if (ps >= 7)      mouth = '!!his mouth is shaping a word he is about to say.!!';
    else if (ps >= 4) mouth = 'his lips are parted, slightly. the question is waiting.';
    else if (ps >= 1) mouth = 'his lips are pressed together as if to hold something back.';
    else              mouth = 'his face is empty in the way only a child can manage.';
    let hands;
    if (pr >= 7)      hands = 'his hand is on my sleeve. he has not let go.';
    else if (pr >= 4) hands = 'his hand is on his own knee. he has remembered it is his.';
    else if (pr >= 1) hands = 'his hand is on the floor between us. close, but not touching.';
    else              hands = 'his hand is on the floor beside him, on something that is not there.';
    return `${eyes} ${mouth} ${hands}`;
  },

  verbs: {

    sit_with_him: {
      label: 'sit with him',
      desc: 'lower yourself to the floor. match his level.',
      respond(p) {
        if (p.scales.stare >= 7) {
          return {
            lines: [
              'I sit on the floor against the wall, beside him.',
              'he does not turn. he does not blink.',
              'after a while my eyes hurt for him.',
            ],
            scales: { present: +1, pressure: +1 },
            composure: -1,
            composureCost: 'his small hand on my sleeve. ~~it is small.~~',
          };
        }
        return {
          lines: [
            'I sit beside him. our shoulders are not touching but they are at the same height.',
            'he looks at the floor between us. there is nothing on the floor between us.',
          ],
          scales: { present: +2, stare: -1 },
        };
      },
    },

    look_at_floor: {
      label: 'look where he\'s looking',
      desc: 'follow his eyes. let yourself see, too.',
      respond(p) {
        const reps = streakCount(p, 'look_at_floor');
        if (reps >= 1) {
          return {
            lines: [
              'I look again. this time I see more. the wallpaper, the doorframe, the gap between.',
              'I see the shape of what he is looking at. I do not look away.',
            ],
            scales: { present: +2, stare: -2, pressure: -1 },
            composure: -2,
            composureCost: 'I am looking at the door. I am not looking away.',
          };
        }
        return {
          lines: [
            'I follow his eyes. they are pointed at the door. ~~at the street through the door~~ at the street.',
            'I see a road. I see a small dog. I see a car.',
            '!!I see what he saw.!!',
            '~~I~~ I do not look away. I make myself not look away.',
          ],
          scales: { present: +3, pressure: +1 },
          composure: -1,
          composureCost: 'the question is still in his mouth. ~~louder.~~',
        };
      },
    },

    cover_his_eyes: {
      label: 'cover his eyes',
      desc: 'put your hand over them. let him stop seeing.',
      when: (p) => p.scales.present >= 4 && p.scales.stare <= 6,
      respond(p) {
        if (p.scales.present >= 5) {
          return {
            lines: [
              'I crouch and put my hand over his eyes. his lashes brush my palm.',
              'his eyes close. for the first time today, they close.',
              '~~he breathes out.~~ he breathes out. it has been forty years of holding.',
              '!!he leans his forehead against my wrist.!!',
            ],
            scales: { stare: -4, present: +2, pressure: -2 },
          };
        }
        return {
          lines: [
            'I reach. his eyes flinch but do not close. he does not let me take it from him.',
            'I lower my hand. ~~not yet.~~ not yet.',
          ],
          scales: { pressure: +2, stare: +1 },
          composure: -1,
          composureCost: 'his eyes have not blinked. mine have begun to hurt.',
        };
      },
    },

    answer_him: {
      label: 'answer his question',
      desc: 'say what he cannot ask. you may not know it yet.',
      when: (p) => p.scales.pressure >= 5 && p.scales.present >= 3,
      respond(p) {
        if (p.scales.pressure >= 6 && p.scales.present >= 4) {
          return {
            lines: [
              'I say: you could not have stopped it.',
              'I say: you did not look away.',
              'I say: it was not your fault. it has never been your fault.',
              'he begins to cry. ~~he~~ he is eight. he is eight. he is eight.',
              '!!I have given him something I cannot take back.!!',
            ],
            scales: { present: +3, pressure: -5, stare: -3 },
            composure: -1,
            composureCost: 'I have seen what he saw. ~~I cannot~~ I cannot unsee it.',
          };
        }
        return {
          lines: [
            'I try to answer. but I am answering nothing. the room does not change.',
            'he does not stop staring. I do not know if I am too early or too late.',
          ],
          scales: { pressure: +2, present: -1 },
          composure: -2,
          composureCost: '!!I am answering nothing.!!',
        };
      },
    },

    tell_him_about_yours: {
      label: 'tell him about yours',
      desc: 'tell him something you saw, that you cannot stop seeing.',
      when: (p, player) => (player.scars?.length || 0) > 0 && p.scales.present >= 2,
      respond(p, player) {
        const hasWitnessed = player.scars?.includes('witnessed');
        if (hasWitnessed) {
          return {
            lines: [
              'I tell him about something I have seen. ~~I will not forget it.~~',
              'I tell him the part where I should have looked away and did not.',
              'he listens. his eyes do not move. but his hand finds the hem of my sleeve.',
            ],
            scales: { present: +3, stare: -2, pressure: -1 },
          };
        }
        return {
          lines: [
            'I tell him about something I have seen. it is small, what I have to give.',
            'he listens, partially. it is enough.',
          ],
          scales: { present: +2, stare: -1 },
        };
      },
    },

    say_what_he_sees: {
      label: 'name what he\'s seeing',
      desc: 'describe it out loud. carefully. accurately.',
      when: (p) => p.scales.stare >= 5 && p.scales.present >= 3,
      respond() {
        return {
          lines: [
            'I describe what he is looking at. the road, the gravel, the small body in the gravel.',
            'I say it without hurry. he listens. his lips move with mine.',
            'we have agreed on the shape of what happened.',
          ],
          scales: { present: +3, stare: -2, pressure: -2 },
          composure: -1,
          composureCost: 'his small hand on my sleeve. ~~it is small.~~',
        };
      },
    },

    let_him_pet: {
      label: 'let him pet you',
      desc: 'his hand on the floor is doing the shape of petting. offer your sleeve.',
      when: (p) => p.scales.present >= 3 && p.scales.pressure <= 6,
      respond() {
        return {
          lines: [
            'I slide my sleeve under his hand on the floor. his fingers find the cuff.',
            'his hand does the shape of petting. ~~something he has been doing for a long time.~~',
            'after a while he leans his head against my arm.',
          ],
          scales: { present: +3, stare: -2, pressure: -1 },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'let the question keep building. ~~it will not~~ it does not stop on its own.',
    when: (p) => p.scales.pressure >= 4 || p.scales.stare >= 7 || p.turn >= 4,
  },

  interjections: [
    {
      id: 'did_you_see',
      once: true,
      when: (p) => p.scales.present >= 4 && p.scales.pressure >= 5,
      prose: [
        'he turns toward me. his lips form a word he has been saving.',
        'he asks: ~~did you see?~~',
      ],
      responses: [
        {
          label: 'I saw',
          desc: 'meet him there.',
          lines: [
            'I say: I saw.',
            'his face breaks open, slowly, the way the dam goes.',
            'he is eight. he is here. he has been very alone.',
          ],
          scales: { present: +4, pressure: -4, stare: -3 },
          composure: -1,
          composureCost: 'I am looking at the door. I am not looking away.',
        },
        {
          label: 'I see now',
          desc: 'soften — show him the present.',
          lines: [
            'I say: I see you. I see you now.',
            'he blinks. ~~once.~~ once.',
          ],
          scales: { present: +3, stare: -2 },
        },
        {
          label: 'I look away',
          desc: 'show him that looking away is allowed.',
          lines: [
            'I look away. I look at the wall. ~~deliberately.~~',
            'he watches me do it. he is allowed to do it too, eventually.',
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
        'his hand is on the floor between us, doing the petting shape.',
        'he asks, very small: ~~where did he go?~~',
      ],
      responses: [
        {
          label: 'somewhere quiet',
          desc: 'gentle. no specifics.',
          lines: [
            'I say: somewhere quiet. where it does not hurt.',
            'he considers this. eventually he nods.',
          ],
          scales: { present: +2, stare: -1, pressure: -2 },
        },
        {
          label: 'I don\'t know',
          desc: 'honest.',
          lines: [
            'I say: I don\'t know.',
            'he nods. he expected that answer. ~~it was a test he was failing too.~~',
          ],
          scales: { present: +3, stare: -3 },
        },
        {
          label: 'with the others',
          desc: 'place him.',
          lines: [
            'I say: with the others. the rest of yours.',
            'he sits with that. he is somewhere I cannot follow for a moment.',
            'when he comes back his hand stays on my sleeve.',
          ],
          scales: { present: +2, pressure: -3 },
          composure: -1,
          composureCost: 'the question is still in his mouth. ~~louder.~~',
        },
      ],
    },

    {
      id: 'can_we_go_now',
      once: true,
      when: (p) => p.scales.pressure >= 6 && p.scales.present >= 4,
      prose: [
        'he is rocking slightly. his lips move without sound for a moment.',
        'he asks me: ~~can we go now? can we go home?~~',
      ],
      responses: [
        {
          label: 'soon',
          desc: 'a small lie.',
          lines: [
            'I say: soon.',
            'he nods. he does not believe me. he holds my sleeve anyway.',
          ],
          scales: { pressure: -1, present: +1, stare: +1 },
          scars: ['named'],
        },
        {
          label: 'we have to stay',
          desc: 'the harder truth.',
          lines: [
            'I say: we have to stay a little longer.',
            'he is very quiet. ~~he is~~ he is older than eight, in this moment.',
          ],
          scales: { stare: -1, pressure: -1, present: +2 },
          composure: -1,
          composureCost: 'his eyes have not blinked. mine have begun to hurt.',
        },
        {
          label: 'where is home',
          desc: 'ask him.',
          lines: [
            'I ask: where is home?',
            'he tells me. a street name. a number. ~~his voice~~ his voice is very small.',
            '!!a place that has not been there in forty years.!!',
          ],
          scales: { present: +3, pressure: -2 },
          composure: -2,
          composureCost: 'I have seen what he saw. ~~I cannot~~ I cannot unsee it.',
        },
      ],
    },

    {
      id: 'mom_isnt_coming',
      once: true,
      when: (p) => p.scales.stare >= 7 && p.turn >= 3,
      prose: [
        'his hand has stopped petting the floor. he is very still.',
        'he says, ~~to no one~~ to no one: she said five minutes. ~~it has been~~ it has been a while.',
      ],
      responses: [
        {
          label: 'she\'ll come',
          desc: 'a kind, terrible lie.',
          lines: [
            'I say: she\'ll come.',
            'he nods. ~~he has been~~ he has been waiting for someone to say that.',
          ],
          scales: { stare: +1, pressure: -2 },
          scars: ['named'],
          composure: -1,
          composureCost: '!!I am answering nothing.!!',
        },
        {
          label: 'she came back',
          desc: 'a different lie.',
          lines: [
            'I say: she came back. she has been here. you have been here with her.',
            'he is confused. ~~he~~ he wants to believe me.',
          ],
          scales: { pressure: -1, stare: -1, present: +1 },
          composure: -1,
          composureCost: 'his small hand on my sleeve. ~~it is small.~~',
        },
        {
          label: 'I\'ll stay',
          desc: 'commit to the room.',
          lines: [
            'I say: I\'ll stay until someone comes.',
            'he reaches for my sleeve. his fingers are small and cold.',
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
          'I wait. his lips part. ~~he is going to ask~~ he is going to ask.',
          'he closes his mouth again. but the question is louder now.',
        ],
        scales: { pressure: +1, stare: +1 },
        composure: -1,
        composureCost: 'the question is still in his mouth. ~~louder.~~',
      };
    }
    if (p.scales.pressure >= 4) {
      return {
        lines: [
          'I wait. his hand is on the floor. it is doing the shape of petting.',
          'his fingers are very small.',
        ],
        scales: { stare: +1 },
        composure: -1,
        composureCost: 'his eyes have not blinked. mine have begun to hurt.',
      };
    }
    return {
      lines: ['I wait. he stares. nothing else happens for a long time.'],
      scales: { pressure: +1 },
    };
  },

  endings: [
    {
      id: 'eyes_closed',
      when: (p) => p.scales.stare <= 2 && p.scales.present >= 6,
      title: 'you close his eyes',
      lines: [
        'he is leaning against my arm. his eyes are closed. it is the first time in a long time.',
        'I do not move. I do not want to be the one who makes him open them.',
      ],
      item: 'photograph',
    },
    {
      id: 'answered',
      when: (p) => p.scales.pressure <= 1 && p.scales.present >= 7,
      title: 'you give him an answer',
      lines: [
        'he is crying. he is eight. eight, finally. ~~for the first time~~ for the first time.',
        '!!the room has aged forty years in a minute.!!',
      ],
      item: 'scrap_of_paper',
    },
    {
      id: 'witnessed_with',
      when: (p) => p.scales.present >= 8 && p.scales.stare >= 5,
      title: 'you see for him',
      lines: [
        'I sit beside him. we look at the door together. ~~we do not~~ we do not look away.',
        'I do not know how long. I keep what we saw. he sets his head against my arm.',
        '!!I am the one who saw it now. it is in me.!!',
      ],
      item: 'ink_bottle',
      scars: ['witnessed'],
    },
    {
      id: 'pressure_broke',
      when: (p) => p.scales.pressure >= 10,
      title: 'the question outlasts you',
      lines: [
        'the question is the loudest thing in the room. it is louder than I am.',
        '!!I have to leave before he asks it out loud.!!',
      ],
      item: null,
      scars: ['witnessed', 'failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'you walk out',
      lines: ['I close the door behind me. ~~he was watching~~ he is watching the door I came through.'],
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
  subtitle: 'she was found on the bench after.',
  role: 'wing', tier: 1,
  file: [
    'patient was located on the bench outside the train station.',
    'she had been there since her ~~husband~~ son said he would come.',
    'her hands have not warmed since. **staff do not hold them long.**',
  ],
  intro: [
    'the room is much colder than the corridor was. the window is dark. there is a bench in the room. she is sitting on the bench.',
    'her coat is buttoned to the throat. she is waiting for someone. she has been waiting a long time.',
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
        2: 'her shoulder has shifted toward mine.',
        3: 'her arm has rested against mine.',
        4: '~~she has~~ she has decided I will do.',
      },
      crossDown: {
        1: 'she has gone back to watching the door.',
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
        2: 'her eyes have come off the door.',
        3: 'she has placed me. ~~for the moment.~~',
        4: '!!she has decided I am here for her.!!',
      },
      crossDown: {
        1: 'her eyes have gone back to the door.',
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
        2: 'my breath has begun to show.',
        3: '!!the cold has crossed into the body. my fingers are stiff.!!',
        4: '!!the room is taking something from me.!!',
      },
      crossDown: {
        2: 'the room has warmed by a degree.',
        1: 'I can feel my fingers again.',
        0: 'the room is warm now. ~~or has become.~~',
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
        3: 'her posture has gone rigid again. ~~she is~~ she is locked to the bench.',
      },
      crossDown: {
        2: 'her shoulders have eased.',
        1: 'she has settled. her hands are in her lap.',
        0: 'she is not waiting anymore.',
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
    { announce: 'a line of her file fills in. ~~the bench outside the train station.~~' },
    { announce: 'another. ~~her son said he would come.~~' },
    { announce: 'the last line. **staff do not hold them long.**' },
  ],

  presented(p) {
    const c = p.scales.cold;
    const w = p.scales.waiting;
    const re = p.scales.recognition;
    const wa = p.scales.warmth;
    let temp;
    if (c >= 7)      temp = '!!the room is white with cold. my breath is visible. hers is not.!!';
    else if (c >= 4) temp = 'the room is cold. my fingers are stiff.';
    else if (c >= 1) temp = 'the room is cool. warming, slowly.';
    else             temp = 'the room is warm. ~~or has become~~ or has become.';
    let post;
    if (w >= 8)      post = 'she is bolt upright. she has not shifted her weight in some time.';
    else if (w >= 5) post = 'she sits upright on the bench. her hands folded.';
    else if (w >= 2) post = 'her shoulders have dropped. her hands rest on her knees.';
    else             post = 'she is leaning, slightly. she has settled.';
    let eyes;
    if (re >= 7)     eyes = 'her eyes are on me. she has decided I am here, for her, now.';
    else if (re >= 4) eyes = 'her eyes move to me, sometimes, then away to the door.';
    else if (re >= 1) eyes = 'her eyes glance at me, sidelong, when I move.';
    else              eyes = 'her eyes are on the door.';
    return `${temp} ${post} ${eyes}`;
  },

  verbs: {

    sit_with_her: {
      label: 'sit with her',
      desc: 'on the bench. join the wait.',
      respond(p) {
        const reps = streakCount(p, 'sit_with_her');
        if (reps >= 2) {
          return {
            lines: [
              'I have been sitting a while. ~~her arm~~ her arm rests against mine, slightly.',
              'we are doing the same thing in the same direction. ~~it is not lonely.~~',
            ],
            scales: { warmth: +2, recognition: +1, waiting: -1 },
            composure: -1,
            composureCost: 'the cold is in my fingers now.',
          };
        }
        if (p.scales.waiting >= 7) {
          return {
            lines: [
              'I sit on the bench beside her. she does not move.',
              'after a while I am also waiting. it is not entirely unpleasant.',
            ],
            scales: { warmth: +1, waiting: -1 },
            composure: -1,
            composureCost: 'my breath is visible. hers is not.',
          };
        }
        return {
          lines: [
            'I sit beside her. she shifts, slightly, to make room.',
            'her shoulder almost touches mine. ~~she is~~ she is warmer than the room.',
          ],
          scales: { warmth: +1, recognition: +1, cold: -1 },
        };
      },
    },

    warm_the_room: {
      label: 'warm the room',
      desc: 'find a lamp. find the radiator. find something useful to do.',
      respond(p) {
        const reps = streakCount(p, 'warm_the_room');
        if (reps >= 2) {
          return {
            lines: [
              'I move around the room. fixing small things. she watches me.',
              '~~she is~~ she is amused, almost.',
            ],
            scales: { cold: -2, recognition: +1 },
          };
        }
        return {
          lines: [
            'I find a lamp. I find the radiator. I find a small thing to do.',
            'the room warms a degree. she does not seem to notice. but her hands are less cold than they were.',
          ],
          scales: { cold: -2 },
        };
      },
    },

    take_her_hand: {
      label: 'take her hand',
      desc: 'her hand is on her knee. it is very cold.',
      when: (p) => p.scales.recognition >= 2 && p.scales.warmth >= 2,
      respond(p) {
        return {
          lines: [
            'I take her hand. it is colder than I expected. ~~as cold as~~ as cold as a hand can be.',
            p.scales.waiting >= 5
              ? 'she does not let go. her hand stays in mine like an object set down.'
              : 'she squeezes back. ~~once.~~ once.',
          ],
          scales: { warmth: +2, recognition: +2, waiting: -1 },
          composure: -1,
          composureCost: 'the bench is colder than the floor.',
        };
      },
    },

    say_his_name: {
      label: 'say his name',
      desc: 'the one she is waiting for.',
      when: (p) => p.scales.recognition >= 4,
      respond(p, player) {
        const r_ = player.items?.includes('scrap_of_paper');
        if (r_) {
          return {
            lines: [
              'I say his name. I say it the way she would have. ~~I have~~ practiced.',
              'she turns slowly. fully. she is looking at me as if she had been about to.',
              'she does not believe it is him. but she is willing to be wrong.',
            ],
            scales: { recognition: +3, waiting: -3, warmth: +1 },
            composure: -1,
            composureCost: '!!I am waiting too.!!',
          };
        }
        if (p.scales.recognition >= 5) {
          return {
            lines: [
              'I say his name. her name for him.',
              'she turns. all the way. her eyes are very bright. she says: where have you been?',
              '!!I am not him. I do not say so.!!',
            ],
            scales: { recognition: +2, waiting: -3 },
            composure: -1,
            composureCost: 'her hand is the same temperature as the room.',
            scars: ['named'],
          };
        }
        return {
          lines: [
            'I say his name. she stiffens.',
            'she is not sure who is saying it. she looks at me, sidelong.',
          ],
          scales: { recognition: +1, warmth: -1 },
          composure: -1,
          composureCost: 'the door is heavier than I expected.',
        };
      },
    },

    say_you_came: {
      label: 'say you came',
      desc: 'lie. say you are him.',
      when: (p) => p.scales.warmth >= 4 && p.scales.recognition >= 4,
      respond(p) {
        return {
          lines: [
            'I say: !!I am sorry I am late.!!',
            'she nods. she does not check. she stands up. she takes my arm.',
            'she walks me to the door of the room. ~~she does not~~ she does not look back at the bench.',
            '~~she does not~~ she does not look at me close.',
          ],
          scales: { waiting: -5, warmth: +3 },
          composure: -2,
          composureCost: 'the cold is in my fingers now.',
          scars: ['named'],
          flags: { lied: true },
        };
      },
    },

    ask_why_here: {
      label: 'ask who she\'s waiting for',
      desc: 'a question, gently.',
      when: (p) => p.scales.recognition >= 4 && p.scales.warmth >= 3,
      respond() {
        return {
          lines: [
            'I ask: who are you waiting for?',
            'she tells me. she tells me carefully. it takes her a while. ~~she has not~~ she has not said his name in a long time.',
            'her hand stays on her knee. her eyes stay on the door, but they are mine now.',
          ],
          scales: { recognition: +3, waiting: -2 },
        };
      },
    },

    bring_her_a_coat: {
      label: 'put a coat over her',
      desc: 'find one. her own coat is too thin.',
      when: (p) => p.scales.warmth >= 3 && p.scales.cold >= 3,
      respond() {
        return {
          lines: [
            'I find a heavier coat in the closet. I drape it over her shoulders.',
            'she lets me. she does not thank me. but her shoulders settle.',
          ],
          scales: { cold: -3, warmth: +1, waiting: -1 },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'sit with her. let the room go on cooling. ~~it costs.~~',
    when: (p) => p.scales.waiting >= 6 || p.turn >= 4,
  },

  interjections: [
    {
      id: 'has_the_train_come',
      once: true,
      when: (p) => p.scales.waiting >= 6 && p.turn >= 2,
      prose: [
        'she does not turn her head. she asks the door:',
        '~~has the train come?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'lie kindly.',
          lines: [
            'I say: yes. it came in.',
            'her shoulders drop. she sits a long time without speaking. she does not check.',
          ],
          scales: { waiting: -3, warmth: +1, cold: +1 },
          scars: ['named'],
        },
        {
          label: 'not yet',
          desc: 'honest.',
          lines: [
            'I say: not yet.',
            'she nods. of course. she keeps waiting. but her arm finds its way to my arm.',
          ],
          scales: { recognition: +2, waiting: +1 },
          composure: -1,
          composureCost: 'my breath is visible. hers is not.',
        },
        {
          label: 'I don\'t think it\'s coming',
          desc: 'the truth.',
          lines: [
            'I say: I don\'t think it\'s coming.',
            'she is quiet. she looks at her hands for a long time.',
            'she says: ~~I knew.~~ very small.',
          ],
          scales: { recognition: +3, waiting: -4, warmth: +1, cold: +1 },
          composure: -2,
          composureCost: 'the bench is colder than the floor.',
        },
      ],
    },
    {
      id: 'which_one',
      once: true,
      when: (p) => p.scales.recognition >= 4 && p.scales.warmth >= 3,
      prose: [
        'her head turns. she squints at me. she has only just noticed.',
        'she asks: ~~which one are you?~~ ~~which~~ — which of mine?',
      ],
      responses: [
        {
          label: 'tell her my name',
          desc: 'I am not one of them.',
          lines: [
            'I say: I am Patient 0413. I came in this morning. I am not yours.',
            'she nods. ~~she is not~~ she is not disappointed. she had not been sure.',
          ],
          scales: { recognition: +3, warmth: -1, cold: +1 },
          composure: -1,
          composureCost: '!!I am waiting too.!!',
        },
        {
          label: 'I am the one who came',
          desc: 'let her have a guess.',
          lines: [
            'I say: I am the one who came.',
            'she takes my arm with both hands. ~~she does~~ she does not check.',
          ],
          scales: { warmth: +3, recognition: -1, waiting: -2 },
          scars: ['named'],
        },
        {
          label: 'I don\'t know',
          desc: 'honest.',
          lines: [
            'I say: I don\'t know.',
            'she nods. ~~that is~~ that is also the answer she has.',
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
        'her hand finds her own wrist. she presses where a watch should be.',
        'she asks: ~~is it late?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'a small truth.',
          lines: [
            'I say: yes. it is late.',
            'she nods slowly. she does not stand.',
          ],
          scales: { waiting: +1, recognition: +1, cold: +1 },
          composure: -1,
          composureCost: 'her hand is the same temperature as the room.',
        },
        {
          label: 'we have time',
          desc: 'a kind lie.',
          lines: [
            'I say: we have time.',
            'she relaxes a degree. her eyes have gone back to the door.',
          ],
          scales: { waiting: -1, warmth: +1 },
          scars: ['named'],
        },
        {
          label: 'too late for trains',
          desc: 'gentle truth.',
          lines: [
            'I say: too late for trains.',
            'she is quiet. ~~she had~~ she had not let herself say it.',
          ],
          scales: { waiting: -3, recognition: +2, warmth: +1, cold: +1 },
          composure: -2,
          composureCost: 'the door is heavier than I expected.',
        },
      ],
    },
    {
      id: 'will_you_wait',
      once: true,
      when: (p) => p.scales.warmth >= 5 && p.scales.recognition >= 4,
      prose: [
        'her hand is on my sleeve. she has stopped watching the door.',
        'she asks me: ~~will you wait with me?~~',
      ],
      responses: [
        {
          label: 'I will',
          desc: 'commit to the bench.',
          lines: [
            'I say: I will.',
            'she sets her head against my shoulder. ~~it is~~ it is light. it is very light.',
          ],
          scales: { warmth: +3, waiting: -2, recognition: +1 },
          composure: -1,
          composureCost: 'the cold is in my fingers now.',
        },
        {
          label: 'only a while',
          desc: 'an honest limit.',
          lines: [
            'I say: only a while. I cannot stay long.',
            'she nods. she pats my hand. she does not let go.',
          ],
          scales: { warmth: +1, waiting: -1 },
        },
        {
          label: 'I have to go',
          desc: 'leave the offer.',
          lines: [
            'I say: I have to go soon.',
            'her hand stays on my sleeve a moment longer than is comfortable. then she lets go.',
          ],
          scales: { warmth: -2, cold: +1, waiting: +2 },
          composure: -2,
          composureCost: 'my breath is visible. hers is not.',
        },
      ],
    },
  ],

  drift(p, player) {
    if (p.scales.cold >= 5) {
      return {
        lines: [
          'I wait. the cold has not lessened. ~~I~~ I am tired in a way I do not understand.',
        ],
        scales: { cold: +1, waiting: +1 },
        composure: -1,
        composureCost: 'the bench is colder than the floor.',
      };
    }
    if (p.scales.waiting >= 6) {
      return {
        lines: [
          'I wait. she shifts on the bench. she watches the door. ~~no one comes.~~ no one comes.',
        ],
        scales: { cold: +1, waiting: +1 },
        composure: -1,
        composureCost: '!!I am waiting too.!!',
      };
    }
    return {
      lines: ['I wait. she shifts. her hand finds her own knee.'],
      scales: { warmth: +1, cold: +1 },
    };
  },

  endings: [
    {
      id: 'sat_through',
      when: (p) => p.scales.warmth >= 9 && p.scales.recognition >= 6 && p.scales.waiting <= 2,
      title: 'she lets you sit with her',
      lines: [
        'she does not need him to come. she has decided I will do.',
        'we sit a long time. the room warms by a degree. ~~the door does not~~ the door does not open.',
        'eventually she pats my hand. that is the ending. ~~for both of us.~~',
      ],
      item: 'worn_ribbon',
    },
    {
      id: 'walked_out',
      when: (p) => p.flags.lied && p.scales.waiting <= 2 && p.scales.warmth >= 6,
      title: 'she lets you walk her out',
      lines: [
        'she lets me walk her out of the room. she takes my arm tighter when we reach the door.',
        '!!she does not look at me close. she does not look close at all.!!',
      ],
      item: 'handkerchief',
      scars: ['named'],
    },
    {
      id: 'frozen',
      when: (p, player) => p.scales.cold >= 9 || player.composure <= 0,
      title: 'the cold takes you',
      lines: [
        'the room is very cold. ~~I am~~ I am very tired. I sit down on the bench. she does not look at me.',
        '!!I do not know which of us is waiting now.!!',
      ],
      item: null,
      scars: ['collapsed'],
    },
    {
      id: 'still_waiting',
      when: (p) => p.turn >= 12 && p.scales.waiting >= 7,
      title: 'she outlasts you',
      lines: [
        'she has been waiting longer than I can be a guest. ~~he~~ he is not coming.',
        '!!I leave her on the bench.!!',
      ],
      item: null,
      scars: ['failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'you walk out',
      lines: ['I close the door. she is on the bench. ~~she does not~~ she does not look up.'],
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
  subtitle: 'they were here when I arrived. ~~they are~~ I am.',
  role: 'final',
  file: [
    'the door at the top of the ward is open. there is a room I have not been in.',
    'inside: a long bench. on the bench, every patient I have met. and others I have not.',
    'they are singing. they are not singing for me. !!they have been singing the whole time.!!',
  ],
  intro: [
    'the choir is at the door of the room.',
    'they are all looking at me. ~~one of them is me.~~',
    'one of them is me.',
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
        3: 'I am thinner than I was. the room can see through me.',
        2: 'I am hard to see, even to me.',
        1: 'there is very little of me left.',
        0: '!!I am almost gone.!!',
      },
      crossUp: {
        2: 'I am back. ~~mostly.~~',
        3: 'I am here. all the way here.',
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
        3: 'I can see them. each one. as themselves.',
        4: '!!I know what this is.!!',
      },
      crossDown: { 1: 'they have blurred together again.' },
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
        2: 'the chord has thickened.',
        3: '!!the chord wants me in it.!!',
        4: '!!the chord is full. it knows what shape I would be.!!',
      },
      crossDown: {
        2: 'the chord has come apart.',
        1: 'one voice has gone.',
        0: 'the chord is gone.',
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
        2: 'I have begun to hum. ~~I do not~~ I do not remember starting.',
        3: 'my voice is in the chord.',
        4: '!!I can hear myself from outside.!!',
      },
      crossDown: {
        2: 'my mouth has closed.',
        1: 'I have stopped singing.',
        0: 'I am silent. ~~for now.~~',
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
    { announce: 'a line of the file fills in. ~~there is a room I have not been in.~~' },
    { announce: '**every patient I have met. and others I have not.**' },
    { announce: '!!they have been singing the whole time.!!' },
  ],

  presented(p) {
    const s = p.scales.self;
    const re = p.scales.recognition;
    const c = p.scales.chord;
    const v = p.scales.voice;
    let song;
    if (c >= 8)      song = '!!the chord is full. it has been full a while.!!';
    else if (c >= 5) song = 'the choir is singing. several parts. familiar parts.';
    else if (c >= 2) song = 'the choir is humming. it has not yet found its key.';
    else             song = 'the choir is quiet. they are watching me.';
    let me;
    if (v >= 7)      me = '~~my voice~~ my voice is in the chord. I can hear it from outside.';
    else if (v >= 4) me = 'I am humming. I did not start.';
    else if (re >= 3) me = 'I can pick out where my voice would go. I am keeping it back.';
    else              me = 'my mouth is closed.';
    let left;
    if (s >= 7)      left = 'I am still mostly here.';
    else if (s >= 4) left = '~~I am~~ I am thinner than I was.';
    else if (s >= 1) left = 'I am hard to see, even to me.';
    else              left = '~~I am almost~~ I am almost gone.';
    return `${song} ${me} ${left}`;
  },

  verbs: {

    hold_yourself: {
      label: 'hold yourself',
      desc: 'do not move. do not sing. anchor.',
      respond(p) {
        const reps = streakCount(p, 'hold_yourself');
        if (reps >= 2) {
          return {
            lines: [
              'I keep holding. the chord widens around me, looking for the gap.',
              'I do not give it. but it is exhausting work.',
            ],
            scales: { self: -1, recognition: +2 },
            composure: -1,
            composureCost: '~~my voice~~ my voice is in the chord. I did not start.',
          };
        }
        return {
          lines: [
            'I stand at the door. I do not move. I do not sing.',
            'the chord searches for me. it does not find me yet.',
          ],
          scales: { recognition: +2 },
        };
      },
    },

    listen_for_yours: {
      label: 'listen for your voice',
      desc: 'pick out your own voice in the chord. find where it is.',
      respond() {
        return {
          lines: [
            'I listen. I am there. I have been there. I have been singing for longer than I have been listening.',
            '~~for how long~~ for how long.',
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
      desc: 'join the chord. let your voice in.',
      when: (p) => p.scales.recognition >= 1,
      respond(p) {
        const reps = streakCount(p, 'sing');
        if (reps >= 1) {
          return {
            lines: [
              'I sing more. the chord widens to make room. ~~I~~ I narrow.',
            ],
            scales: { voice: +3, chord: +2, self: -2 },
            composure: -1,
            composureCost: '!!I am being learned.!!',
          };
        }
        return {
          lines: [
            'I open my mouth. a note comes out. it fits.',
            'the chord widens to make room. ~~or I~~ or I narrow to fit.',
          ],
          scales: { voice: +2, chord: +1, self: -1 },
        };
      },
    },

    name_yourself: {
      label: 'name yourself',
      desc: 'say your number. out loud.',
      when: (p) => p.scales.self >= 3,
      respond(p) {
        const reps = streakCount(p, 'name_yourself');
        if (reps >= 1) {
          return {
            lines: [
              'I say it again. !!Patient 0413.!!',
              'the chord loses a note. my own note. ~~it had been there.~~',
            ],
            scales: { self: +2, voice: -2, recognition: +1 },
          };
        }
        return {
          lines: [
            'I say: !!Patient 0413.!!',
            'the chord falters. one voice loses its place. ~~it might be~~ it might be mine.',
          ],
          scales: { voice: -2, self: +2, chord: -1 },
        };
      },
    },

    take_yours_out: {
      label: 'take your voice out',
      desc: 'reach into the chord. pull yourself free of it.',
      when: (p) => p.flags.found_voice && p.scales.recognition >= 5,
      respond(p) {
        if (p.scales.recognition < 7) {
          return {
            lines: [
              'I reach for what I think is my voice. ~~I find~~ I find someone else\'s.',
              'I pull it. they go quiet. ~~I do not~~ I do not know who.',
            ],
            scales: { self: -1, recognition: -1 },
            composure: -2,
            composureCost: 'one of them sounds like me. all of them do, in the right light.',
            scars: ['witnessed'],
          };
        }
        return {
          lines: [
            'I reach into the chord. my voice is there, exactly where I left it.',
            'I pull it out. the chord is poorer for it. I am ~~smaller~~ louder for it.',
            '!!I have me again.!!',
          ],
          scales: { voice: -10, self: +3, chord: -3 },
          flags: { excised: true },
        };
      },
    },

    close_door: {
      label: 'close the door',
      desc: 'shut it from the inside. or the outside. you decide.',
      when: (p) => p.scales.self >= 5,
      respond() {
        return {
          lines: [
            'I close the door. ~~from the inside.~~ from the outside.',
            'the chord goes on without me. I can hear it down the corridor.',
            '(I am out. ~~mostly.~~)',
          ],
          flags: { shut_door: true },
        };
      },
    },

    look_at_yours: {
      label: 'look at one of them',
      desc: 'pick a single singer. see who it is.',
      when: (p) => p.scales.recognition >= 3,
      respond(p) {
        const reps = streakCount(p, 'look_at_yours');
        const which = reps + 1;
        const memories = [
          ['I look at one of them. she is rocking a pram. her arms are tight.', 'I have been in this room before. ~~recently.~~'],
          ['I look at another. he sits in a chair. he is dictating to a clerk who is not here.', '~~I closed his eyes.~~ I closed his eyes.'],
          ['I look at another. she is humming a chord. her hands are above the keys.', '~~I never let her finish.~~'],
          ['I look at another. she is on a bench, waiting. her hands are cold.', 'I sat with her. ~~for an hour.~~ for an hour.'],
        ];
        const m = memories[Math.min(which - 1, memories.length - 1)];
        return {
          lines: [m[0], m[1]],
          scales: { recognition: +2, self: -1 },
          composure: -1,
          composureCost: 'the door is open. ~~from inside.~~',
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'let the chord come for me. ~~it will.~~',
    when: () => true,
  },

  interjections: [
    {
      id: 'one_of_us',
      once: true,
      when: (p) => p.scales.voice >= 4,
      prose: [
        'the chord pauses. one voice steps slightly forward — it is mine, I think.',
        'it asks me: ~~are you one of us yet?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'concede.',
          lines: [
            'I say: yes.',
            'the chord widens. another note. ~~mine.~~',
            '!!they have me now.!!',
          ],
          scales: { voice: +4, chord: +3, self: -3 },
          composure: -2,
          composureCost: 'I have been here longer than I came in for.',
        },
        {
          label: 'no',
          desc: 'refuse.',
          lines: [
            'I say: no.',
            'the chord wavers. one voice falters. they wait for me to change my mind.',
          ],
          scales: { self: +2, voice: -2, recognition: +2 },
        },
        {
          label: 'I don\'t know',
          desc: 'honest.',
          lines: [
            'I say: I don\'t know.',
            'they accept it. for now. the chord holds its place.',
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
        'the chord opens. there is a space in it shaped like a person. shaped like me.',
        'one voice asks: ~~won\'t you sing with us?~~',
      ],
      responses: [
        {
          label: 'no',
          desc: 'firm.',
          lines: [
            'I say: no.',
            'the chord closes around the space. they continue without me. ~~they have learned~~ they have learned to.',
          ],
          scales: { chord: -2, self: +2 },
        },
        {
          label: 'one note',
          desc: 'small concession.',
          lines: [
            'I sing one note. just one. it fits.',
            'the chord settles for it.',
          ],
          scales: { voice: +2, chord: +1, self: -1 },
          composure: -1,
          composureCost: '~~my voice~~ my voice is in the chord. I did not start.',
        },
        {
          label: 'I came to take mine out',
          desc: 'declare intent.',
          lines: [
            'I say: I came to take my voice out.',
            'they go quiet. they have not been told that. they did not know it was possible.',
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
        'the chord shifts. several voices, in unison.',
        'they ask: ~~who were you, before us?~~',
      ],
      responses: [
        {
          label: 'Patient 0413',
          desc: 'your number. flatly.',
          lines: [
            'I say: Patient 0413. I came in this morning.',
            'the chord falters. one voice stops humming. ~~it was mine.~~',
          ],
          scales: { self: +3, voice: -2, recognition: +1 },
        },
        {
          label: 'someone with a file',
          desc: 'less specific.',
          lines: [
            'I say: someone with a file. someone admitted.',
            'they accept that. it is not enough to undo what is being done.',
          ],
          scales: { recognition: +1, voice: +1, self: -1 },
          composure: -1,
          composureCost: 'I am thinner than I was.',
        },
        {
          label: 'I don\'t remember',
          desc: 'the truest answer.',
          lines: [
            'I say: I don\'t remember.',
            'the chord nods. ~~it has been here~~ it has been here longer. it remembers for me.',
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
        'a single voice — closer than the others — speaks.',
        'it says: ~~we missed you. ~~ we missed you.',
      ],
      responses: [
        {
          label: 'I missed you',
          desc: 'echo.',
          lines: [
            'I say: I missed you.',
            'the chord opens around me. ~~I~~ I do not move forward, but I have already moved.',
          ],
          scales: { voice: +3, chord: +2, self: -2 },
          composure: -2,
          composureCost: 'one of them sounds like me. all of them do, in the right light.',
        },
        {
          label: 'I do not know you',
          desc: 'refuse the claim.',
          lines: [
            'I say: I do not know you.',
            'the voice goes quiet. the others continue. ~~the chord~~ the chord is poorer.',
          ],
          scales: { self: +2, chord: -2, recognition: +1 },
        },
        {
          label: 'who am I',
          desc: 'turn it around.',
          lines: [
            'I say: who am I, to you?',
            'the chord answers. each voice says a different thing. ~~no two~~ no two are the same.',
            '!!I do not recognize most of them.!!',
          ],
          scales: { recognition: +3, self: -1 },
          composure: -1,
          composureCost: 'the door is open. ~~from inside.~~',
        },
      ],
    },
  ],

  drift(p) {
    if (p.scales.chord >= 6) {
      return {
        lines: [
          'I wait. the chord deepens. one voice rises — ~~rocking, quietly~~ rocking, quietly. another — humming. another, ~~staring~~ staring.',
          'they have learned the whole ward. they are singing it.',
        ],
        scales: { self: -1, voice: +1, chord: +1 },
        composure: -1,
        composureCost: 'I have been here longer than I came in for.',
      };
    }
    return {
      lines: ['I wait. the choir hums. ~~one voice~~ one voice sounds like mine. it always has.'],
      scales: { chord: +1, voice: +1 },
      composure: -1,
      composureCost: '~~my voice~~ my voice is in the chord. I did not start.',
    };
  },

  endings: [
    {
      id: 'excised',
      when: (p) => p.flags.excised && p.scales.self >= 6,
      title: 'you take yourself out',
      lines: [
        'I leave the room with my voice in my hand. the chord is poorer. ~~I am~~ I am poorer.',
        'I walk past them down the corridor. they continue without me. they always did.',
        'I take the stairs.',
      ],
      item: 'sliver_of_glass',
    },
    {
      id: 'shut_out',
      when: (p) => p.flags.shut_door && p.scales.self >= 5 && p.scales.voice <= 3,
      title: 'you shut the door',
      lines: [
        'I close it from the outside. the choir is muffled by an inch of wood.',
        'I walk back the way I came. ~~the corridor is~~ a different corridor.',
        'I leave my file at the desk. the nurse takes it without looking up.',
      ],
      item: 'ink_bottle',
    },
    {
      id: 'joined',
      when: (p) => p.scales.voice >= 8 && p.scales.self <= 2,
      title: 'you join them',
      lines: [
        'my voice is in the chord. it has always been in the chord. ~~I am~~ I am in the chord.',
        'the room is full of me. there are many of me. I am no longer ~~looking out from~~ I am no longer looking out.',
        '!!the door is open. someone outside is being admitted.!!',
      ],
      item: null,
      scars: ['collapsed'],
    },
    {
      id: 'outlasted',
      when: (p) => p.scales.self <= 0,
      title: 'the chord finishes you',
      lines: [
        'I am thinner than I should be. the choir has not noticed I am gone. ~~or that I was ever~~ or that I was ever here.',
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
  subtitle: 'she is sure she had a daughter.',
  role: 'wing', tier: 2,
  file: [
    'patient cannot recall the name of ~~her daughter~~ the one she came in with.',
    'she has been told the room next door is empty. she continues to thank the staff for *the visits*.',
    'when asked her own name, she gave the orderly\'s. ~~**I** told her it was hers.~~',
  ],
  intro: [
    'she is at the door before I am all the way through it. she takes my hand. she has been waiting.',
    '~~she says: there you are.~~ she says: there you are.',
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
        2: 'she has begun to study my face properly.',
        3: 'she sees me — partly.',
        4: '!!she sees me. she sees who I am.!!',
      },
      crossDown: {
        1: 'her eyes have left my face.',
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
        2: 'her lips have begun to shape a name she has not said in a while.',
        3: 'her face has shifted. she is somewhere old.',
        4: '!!the grief has come up.!!',
      },
      crossDown: {
        1: 'she has folded the grief back away.',
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
        3: 'her grip on my arm has tightened.',
        4: '!!she has decided I am her. she will not be moved.!!',
      },
      crossDown: {
        2: 'her hand has gone back to her lap.',
        1: 'she has stopped insisting.',
        0: 'her hands are her own. she has let me go.',
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
        2: 'her breath has gone short.',
        3: 'her hand has found her throat.',
        4: '!!she is not in the room anymore. she is somewhere worse.!!',
      },
      crossDown: {
        1: 'her breath has settled.',
        0: 'she is calm. ~~for now.~~',
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
    { announce: 'a line of her file fills in. ~~her daughter.~~ ~~the one she came in with.~~' },
    { announce: '**the room next door is empty.**' },
    { announce: 'the last line, in my hand. ~~she gave the orderly\'s name.~~' },
  ],

  presented(p) {
    const i = p.scales.insistence;
    const re = p.scales.recognition;
    const g = p.scales.grief;
    const pa = p.scales.panic;
    let grip;
    if (i >= 8)      grip = 'her hand is on my arm and stays there. she has not let go since I came in.';
    else if (i >= 5) grip = 'her hand finds my sleeve, often. she does not seem to notice doing it.';
    else if (i >= 2) grip = 'her hand is in her own lap, sometimes. it has not entirely settled.';
    else             grip = 'her hands are her own again. they are folded in her lap.';
    let eyes;
    if (re >= 7)     eyes = 'her eyes are on me. she has seen me. she has seen who I am.';
    else if (re >= 4) eyes = 'her eyes are searching my face for someone she half-knows.';
    else if (pa >= 5) eyes = 'her eyes flick around the room. she is checking exits.';
    else              eyes = 'her eyes are on me without seeing me. she is somewhere else, behind them.';
    let mouth;
    if (g >= 7)      mouth = 'her mouth is shaping a name she has not said in a long time.';
    else if (g >= 4) mouth = 'her lips are moving without sound.';
    else             mouth = 'her mouth is at rest. she is composed.';
    return `${grip} ${eyes} ${mouth}`;
  },

  verbs: {

    let_her: {
      label: 'let her',
      desc: 'be who she thinks you are. for a while.',
      respond(p) {
        const reps = streakCount(p, 'let_her');
        if (reps >= 3) {
          return {
            lines: [
              'I have been her daughter a while now. I have told her about a week I did not have.',
              '~~she has~~ she has been very glad. but I am tired.',
            ],
            scales: { insistence: +2, recognition: -1 },
            composure: -2,
            composureCost: 'her hand is around my arm. it has not let go.',
            scars: ['named'],
          };
        }
        if (p.scales.insistence >= 7) {
          return {
            lines: [
              'I let her tell me what I have been doing this week.',
              'I have been at school. I have been seeing a young man. I have been thinking of cutting my hair.',
              'she is glad for me. it is a long monologue. ~~she has been waiting to give it.~~',
            ],
            scales: { grief: -1, insistence: +1 },
            composure: -1,
            composureCost: 'I have been her daughter a while now.',
          };
        }
        return {
          lines: [
            'I let her hold my hand. I let her look at my face.',
            'she breathes out. ~~she has been~~ she has been afraid I would not come.',
          ],
          scales: { insistence: +1, panic: -1 },
        };
      },
    },

    sit_quietly: {
      label: 'sit quietly with her',
      desc: 'not as anyone in particular. just sit.',
      respond(p) {
        return {
          lines: [
            'I sit beside her. I do not perform a relation. I am a person who is here.',
            p.scales.recognition >= 3
              ? 'she looks at me, sidelong. she is letting me be what I am.'
              : 'she takes my hand anyway, but absentmindedly.',
          ],
          scales: { recognition: +2, insistence: -1, panic: -1 },
        };
      },
    },

    correct_her: {
      label: 'correct her',
      desc: 'say: I am not her.',
      when: (p) => p.scales.recognition >= 3,
      respond(p) {
        const reps = streakCount(p, 'correct_her');
        if (reps >= 1) {
          return {
            lines: [
              'I say it again. ~~she does not~~ she does not want to hear it again.',
              'her hand goes from my arm to her own throat. her breath has changed.',
            ],
            scales: { panic: +3, recognition: -1 },
            composure: -2,
            composureCost: 'her breath has changed. ~~she has heard~~ she has heard something.',
          };
        }
        if (p.scales.recognition >= 6) {
          return {
            lines: [
              'I say: I am not your daughter.',
              'she looks at me a long time. she does not argue. she lets go of my arm.',
              'she says: ~~I knew that.~~ I knew that.',
              'she sits down. she is suddenly very small.',
            ],
            scales: { insistence: -4, recognition: +3, grief: +2 },
            composure: -1,
            composureCost: '!!I have given her something I am not.!!',
          };
        }
        return {
          lines: [
            'I say: I am not your daughter.',
            'she does not hear me. or she hears but it is a fact she has already decided does not apply.',
            'her hand stays on my arm.',
          ],
          scales: { recognition: +1, panic: +2 },
          composure: -1,
          composureCost: 'I have been telling her a week I did not have.',
        };
      },
    },

    ask_about_her: {
      label: 'ask about her',
      desc: 'ask: what was she like? — and listen.',
      when: (p) => p.scales.insistence <= 7,
      respond(p) {
        const reps = streakCount(p, 'ask_about_her');
        if (reps >= 1) {
          return {
            lines: [
              'I ask another. and another. she gives me details. small ones. a knee scar. a favorite color.',
              'she is bringing back a person, one detail at a time.',
            ],
            scales: { grief: +2, recognition: +1 },
          };
        }
        return {
          lines: [
            'I ask: what was she like?',
            'she answers. she answers for a long time. she remembers a great deal. some of it is happy.',
            'at the end she says a name. ~~the name~~ a name.',
            'I write it down. I will keep it.',
          ],
          scales: { grief: +3, recognition: +2, insistence: -1 },
        };
      },
    },

    say_her_name: {
      label: 'say her name',
      desc: 'use her own — the one on her file.',
      when: (p) => p.scales.recognition >= 4,
      respond(p, player) {
        const r_ = player.items?.includes('scrap_of_paper');
        if (r_) {
          return {
            lines: [
              'I say her name. her own. ~~I~~ I have practiced this. it lands on her like a thing she had set down somewhere and missed.',
              'she answers. yes? she says it not as a question.',
              '!!her hands fold in her lap.!!',
            ],
            scales: { recognition: +3, insistence: -2 },
          };
        }
        return {
          lines: [
            'I say her name. her own. the one on her file. she has not been called by it in a long time.',
            p.scales.recognition >= 5
              ? 'she answers. yes? she says it like a question she had stopped asking.'
              : 'she frowns. she is trying to decide if I am talking to her, or to someone else with the same name.',
          ],
          scales: { recognition: +2, insistence: -1, panic: +1 },
        };
      },
    },

    write_the_name: {
      label: 'write the daughter\'s name',
      desc: 'in your file. so that someone will keep it.',
      when: (p) => p.scales.grief >= 6 && p.scales.recognition >= 5,
      respond() {
        return {
          lines: [
            'I write the name in my file. carefully. ~~as if she had~~ as if she had asked me to.',
            'she watches me do it. she does not stop me.',
            '!!the name belongs somewhere now.!!',
          ],
          scales: { grief: +2, recognition: +2, insistence: -1 },
          flags: { kept_name: true },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'let her tell me my own history. ~~it costs.~~',
    when: (p) => p.scales.insistence >= 6 || p.turn >= 4,
  },

  interjections: [
    {
      id: 'tell_me_about_yourself',
      once: true,
      when: (p) => p.scales.recognition >= 4 && p.scales.insistence <= 6,
      prose: [
        'she is looking at me carefully. she has stopped speaking.',
        'she asks: ~~tell me about yourself. ~~ tell me about yourself.',
      ],
      responses: [
        {
          label: 'I came in this morning',
          desc: 'plant yourself in the present.',
          lines: [
            'I tell her: I came in this morning. I was found at the front entrance.',
            'she takes that in slowly. she nods.',
            'she says: yes. yes, I remember now.',
          ],
          scales: { recognition: +3, insistence: -2 },
        },
        {
          label: 'I don\'t know',
          desc: 'meet her where she is.',
          lines: [
            'I say: I don\'t know.',
            'she nods slowly. she has been on this side of the question.',
          ],
          scales: { recognition: +2, grief: +3 },
        },
        {
          label: 'tell me first',
          desc: 'turn it around.',
          lines: [
            'I say: tell me first. who are you?',
            'she is quiet for a long time. she says her own name. ~~she has not said it in a while.~~',
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
        'she has heard a sound outside the room. her hand tightens.',
        'she asks: ~~do you have to go?~~',
      ],
      responses: [
        {
          label: 'I\'ll stay',
          desc: 'commit.',
          lines: [
            'I say: I\'ll stay.',
            'her hand relaxes. her breath steadies. ~~she had been afraid.~~',
          ],
          scales: { panic: -4, insistence: +1 },
          composure: -1,
          composureCost: 'her face has shut.',
        },
        {
          label: 'I\'ll come back',
          desc: 'a kinder lie.',
          lines: [
            'I say: I have to go. but I\'ll come back. ~~tomorrow.~~ tomorrow.',
            'she nods. she does not check her watch. but she lets go of my arm.',
          ],
          scales: { panic: -2, insistence: -2 },
          scars: ['named'],
        },
        {
          label: 'you\'ll be alright',
          desc: 'gentle. honest.',
          lines: [
            'I say: you\'ll be alright.',
            'she does not seem convinced. but she does not stop me either.',
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
        'her face has gone still. she is looking somewhere I cannot see.',
        'she asks me: ~~were you at the funeral?~~',
      ],
      responses: [
        {
          label: 'I was',
          desc: 'tell her yes.',
          lines: [
            'I say: I was. I was there.',
            'she nods. ~~the small one~~ a small one was there too, she says.',
          ],
          scales: { grief: +3, recognition: +1, insistence: -1 },
          composure: -1,
          composureCost: 'her hand is around my arm. it has not let go.',
        },
        {
          label: 'I wasn\'t',
          desc: 'tell her no.',
          lines: [
            'I say: I wasn\'t.',
            'she is quiet. ~~for a long~~ for a long time. she does not let go of my arm.',
          ],
          scales: { grief: +2, panic: +1, insistence: -1 },
        },
        {
          label: 'tell me about it',
          desc: 'open it.',
          lines: [
            'I say: tell me about it.',
            'she does. it is small. and clear. ~~she has~~ she has not let herself say any of it out loud.',
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
        'her hand has come up to her own mouth.',
        'she says, ~~mostly~~ mostly to herself: ~~she was so small. I held her in one arm.~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'just stay there with it.',
          lines: [
            'I say: yes. she was small.',
            'she breathes out. ~~she has been holding it.~~',
          ],
          scales: { grief: +3, recognition: +1, insistence: -2 },
          composure: -1,
          composureCost: 'her breath has changed. ~~she has heard~~ she has heard something.',
        },
        {
          label: 'how small',
          desc: 'invite the detail.',
          lines: [
            'I ask: how small?',
            'she gestures with her hands. she names a weight. she names a length.',
            '~~a person, made specific.~~',
          ],
          scales: { grief: +3, recognition: +2 },
          composure: -1,
          composureCost: '!!I have given her something I am not.!!',
        },
        {
          label: 'change the subject',
          desc: 'spare her.',
          lines: [
            'I look at the clock. I ask if she wants tea.',
            'she does not answer for a long time. ~~she had been about to say~~ she had been about to say more.',
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
          'I wait. she is telling me about a birthday party. it was for me. I was eight.',
          '~~it was a long time ago.~~ it was a long time ago.',
        ],
        scales: { insistence: +1 },
        composure: -1,
        composureCost: 'her face has shut.',
      };
    }
    if (p.scales.recognition >= 4) {
      return {
        lines: [
          'I wait. she is quiet. she watches my face like she might find something she has misplaced.',
        ],
        scales: { recognition: +1, grief: +1 },
      };
    }
    return {
      lines: ['I wait. she is humming. she is humming something I do not recognize. it sounds like an old song.'],
      scales: { grief: +1, insistence: +1 },
    };
  },

  endings: [
    {
      id: 'her_name_kept',
      when: (p) => p.flags.kept_name && p.scales.grief >= 8 && p.scales.recognition >= 6,
      title: 'you keep her daughter\'s name',
      lines: [
        'I write the name in my file. I will say it to other people who ought to know it.',
        '~~it is mine~~ it is hers. it is mine to carry.',
      ],
      item: 'scrap_of_paper',
    },
    {
      id: 'truth_told',
      when: (p) => p.scales.recognition >= 9 && p.scales.grief >= 5,
      title: 'you tell her the truth',
      lines: [
        'she has heard me. she has known a while. she sits with it.',
        'she says her own name out loud. ~~one~~ once. softly. she has not said it in a long time.',
      ],
      item: 'ink_bottle',
    },
    {
      id: 'i_am_her',
      when: (p) => p.scales.insistence >= 10 && p.scales.recognition <= 3,
      title: 'you are her, for as long as it takes',
      lines: [
        'I let her tell me my history. I let her tell me what I am about to do with my life.',
        '!!she is at peace.!! she has not been at peace since.',
        'I leave the room with the things she has given me. ~~they are not~~ they are mine now.',
      ],
      item: 'photograph',
      scars: ['named'],
    },
    {
      id: 'panicked',
      when: (p) => p.scales.panic >= 9,
      title: 'you lose her',
      lines: [
        'her face has shut. she does not see me anymore. she is afraid in a way I cannot reach.',
        '!!I leave the room. she does not notice.!!',
      ],
      item: null,
      scars: ['witnessed', 'failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'you walk out',
      lines: ['I close the door. ~~she does not~~ she is still saying the name she calls me.'],
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
  subtitle: 'there is no pond on the grounds.',
  role: 'wing', tier: 3,
  file: [
    'patient asks staff about the pond on the grounds. there is no pond.',
    'she specifies a ~~stone~~ statue at the edge. none on file.',
    'family report she put **something** in a pond, once. they will not say what.',
  ],
  intro: [
    'the floor of the room is wet. it is not raining outside. it has not rained.',
    'she is at the far wall. she does not turn. she is asking, into the wall:',
    'where is the pond. you know the one. the one with the statue.',
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
        2: 'her eyes have left the wall.',
        3: 'she has turned. partly.',
        4: '!!she is here. she is with me.!!',
      },
      crossDown: { 1: 'her eyes have gone back to the wall.' },
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
        2: 'she has begun to say what she has not said.',
        3: 'the words are coming.',
        4: '!!she has named it.!!',
      },
      crossDown: { 1: 'the words have gone back inside.' },
    },
    approach: {
      initial: 0, min: 0, max: 10, label: 'approach', kind: 'negative',
      bands: [
        { at: 0, word: 'far wall' },
        { at: 3, word: 'stepping' },
        { at: 5, word: 'between me and the door' },
        { at: 7, word: 'arm\'s length' },
        { at: 9, word: 'on me' },
      ],
      crossUp: {
        3: 'she has crossed half the room.',
        4: '!!she is on me. her hand is on my collar.!!',
      },
      crossDown: {
        2: 'she has stepped back.',
        1: 'she has gone back to the wall.',
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
        2: 'the floor has wet through the carpet.',
        3: '!!the floor is open under me.!!',
        4: '!!I am up to my ankles. the room is becoming the pond.!!',
      },
      crossDown: {
        2: 'the floor has gone back to being a floor.',
        1: 'the carpet is dry.',
        0: 'the room is a room again.',
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
    { announce: 'a line of her file fills in. ~~there is no pond on the grounds.~~' },
    { announce: '~~the statue.~~ ~~none on file.~~' },
    { announce: 'the last line. **she put something in a pond, once.**' },
  ],

  presented(p) {
    const a = p.scales.approach;
    const pd = p.scales.pond;
    const re = p.scales.recognition;
    const rl = p.scales.release;
    let dist;
    if (a >= 8)      dist = '!!she is in front of me. her hand is on my collar.!!';
    else if (a >= 5) dist = 'she has crossed half the room. she is between me and the door now.';
    else if (a >= 2) dist = 'she has taken steps toward me. she is closer than before.';
    else             dist = 'she is at the far wall. she is asking the wall.';
    let water;
    if (pd >= 7)     water = 'the floor is wet to the ankles. the carpet is gone under it.';
    else if (pd >= 4) water = 'the floor is wet. my shoes leave prints on it.';
    else if (pd >= 1) water = 'the floor is damp. there is no water source.';
    else             water = 'the floor is dry. the room is normal.';
    let eyes;
    if (re >= 5)     eyes = 'she has turned. she is looking at me as if I belong to the room.';
    else if (rl >= 4) eyes = 'she has said something she had not said before. she will not look at me.';
    else if (a >= 3) eyes = 'she is looking at me, sidelong.';
    else             eyes = 'she is asking the wall about the pond. she has not turned.';
    return `${dist} ${water} ${eyes}`;
  },

  verbs: {

    answer_about_pond: {
      label: 'answer her',
      desc: 'tell her where the pond is. ~~or where it was.~~',
      respond(p) {
        const reps = streakCount(p, 'answer_about_pond');
        if (reps >= 2) {
          return {
            lines: [
              'I keep answering. each answer makes the pond more real.',
              'the floor is getting wetter. her face is closer than before.',
            ],
            scales: { approach: +2, pond: +2 },
            composure: -1,
            composureCost: 'the floor is wet to my ankles.',
          };
        }
        if (p.scales.pond <= 3) {
          return {
            lines: [
              'I say: it is out by the east lawn. the one with the statue.',
              'she nods slowly. she does not turn. but the room dries by a degree.',
              'her approach stops. she is waiting.',
            ],
            scales: { pond: +1, recognition: +1 },
          };
        }
        return {
          lines: [
            'I say: it is out by the east lawn.',
            'she answers — without turning — !!I have been there. I have been there recently.!!',
            'she takes a step closer.',
          ],
          scales: { approach: +1, pond: +1 },
        };
      },
    },

    bar_the_door: {
      label: 'stand by the door',
      desc: 'close yourself off from the room. wait it out.',
      respond(p) {
        const reps = streakCount(p, 'bar_the_door');
        if (reps >= 1) {
          return {
            lines: [
              'I stay at the door. she has stopped advancing. but the room is colder.',
            ],
            scales: { approach: -1, pond: +1 },
            composure: -2,
            composureCost: 'the room is wetter than the corridor. by a degree.',
          };
        }
        return {
          lines: [
            'I move to the door. I put my back to it.',
            'she does not advance. she has stopped, mid-step. her face is on the wall still.',
          ],
          scales: { approach: -2, recognition: +1 },
          composure: -1,
          composureCost: 'her hand on my collar was warm.',
        };
      },
    },

    ask_about_statue: {
      label: 'ask about the statue',
      desc: 'what was at the edge of the pond? a stone? a person?',
      when: (p) => p.scales.pond >= 3,
      respond(p, player) {
        const r_ = player.items?.includes('scrap_of_paper');
        if (r_) {
          return {
            lines: [
              'I ask, but I already half-remember it. I say what I remember, and let her correct me.',
              'she corrects me, gently. she fills in what I was missing. ~~it is a person.~~ it is a person.',
              'she says the name. !!she says the name.!!',
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
              'she begins to describe it. she describes it in great detail. ~~it is a person~~ it is a person.',
              'her voice breaks at the end. she does not turn.',
            ],
            scales: { release: +2, pond: +1 },
          };
        }
        return {
          lines: [
            'I ask: what does the statue look like?',
            'she pauses. she is trying to remember. it is a slow remembering.',
          ],
          scales: { pond: +1, recognition: +1 },
        };
      },
    },

    ask_what_she_put_in: {
      label: 'ask what she put in',
      desc: 'gently. what did she put in the pond?',
      when: (p) => p.scales.pond >= 5 && p.scales.recognition >= 2,
      respond(p) {
        if (p.scales.pond <= 5) {
          return {
            lines: [
              'I ask: what did you put in the pond.',
              'she does not answer. she does not turn. but she stops asking about the pond.',
              'we are quiet a long time.',
            ],
            scales: { release: +2, approach: -1, pond: -1 },
          };
        }
        return {
          lines: [
            'I ask: what did you put in the pond.',
            'she is silent. she does not turn. her hands are flat against the wall.',
            'after a long time she says: ~~something~~ something I should not have.',
            '!!she does not say what.!!',
          ],
          scales: { release: +3, pond: +1, recognition: +1 },
          composure: -1,
          composureCost: 'the carpet is gone under me.',
        };
      },
    },

    turn_her_around: {
      label: 'turn her around',
      desc: 'gently. take her by the wrist.',
      when: (p) => p.scales.recognition >= 2 && p.scales.approach <= 4,
      respond() {
        return {
          lines: [
            'I take her by the wrist. I turn her around slowly. she lets me.',
            'her eyes are very tired. she looks at me. she does not look at the wall.',
          ],
          scales: { recognition: +3, pond: -1 },
          composure: -1,
          composureCost: 'I should not have told her where the pond is.',
        };
      },
    },

    dry_a_corner: {
      label: 'dry a corner',
      desc: 'pretend the water is yours to deal with. towels.',
      when: (p) => p.scales.pond >= 4,
      respond() {
        return {
          lines: [
            'I find a towel. I dry the corner of the room near the door.',
            'the carpet is fabric again, briefly. she watches my hands.',
          ],
          scales: { pond: -2, recognition: +1, approach: -1 },
        };
      },
    },

    sit_on_the_wet: {
      label: 'sit on the wet floor',
      desc: 'be in the pond with her.',
      when: (p) => p.scales.pond >= 6 && p.scales.release >= 3,
      respond() {
        return {
          lines: [
            'I sit down on the wet floor. my coat soaks through immediately.',
            'she turns. all the way. she sits beside me. ~~we are in the same room now.~~',
          ],
          scales: { recognition: +3, release: +2, approach: -2 },
          composure: -2,
          composureCost: 'the floor is wet to my ankles.',
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'let her keep asking the wall. ~~the room~~ the room is wetter every minute.',
    when: (p) => p.scales.approach >= 3 || p.scales.pond >= 5 || p.turn >= 4,
  },

  interjections: [
    {
      id: 'do_you_remember_him',
      once: true,
      when: (p) => p.scales.pond >= 5 && p.scales.recognition >= 2,
      prose: [
        'she has stopped speaking to the wall. she has not turned, but her shoulders have changed.',
        'she asks, into the wall: ~~do you remember him?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'pretend you do.',
          lines: [
            'I say: yes.',
            'she takes a step away from the wall. she comes closer to me. ~~she is~~ she is grateful.',
          ],
          scales: { release: +2, approach: +1, recognition: +2 },
          scars: ['named'],
        },
        {
          label: 'I don\'t know him',
          desc: 'honest.',
          lines: [
            'I say: I don\'t know him.',
            'she does not answer for a long time. then she says: ~~no one does anymore.~~',
          ],
          scales: { release: +3, pond: +1 },
          composure: -1,
          composureCost: 'the room is wetter than the corridor. by a degree.',
        },
        {
          label: 'tell me about him',
          desc: 'invite, don\'t claim.',
          lines: [
            'I say: tell me about him.',
            'she does. she does for a long time. ~~some of it~~ some of it is happy.',
            'at the end she gives me his name.',
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
        'she has crossed half the room. she stops. she looks at me — full on — for the first time.',
        'she asks: ~~are you going to stop me?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'commit to standing between her and it.',
          lines: [
            'I say: yes.',
            'she lets out a long breath. she sits down on the wet floor. ~~thank god~~ thank god, she says.',
          ],
          scales: { approach: -5, recognition: +3, release: +1 },
          composure: -1,
          composureCost: 'her hand on my collar was warm.',
        },
        {
          label: 'no',
          desc: 'do not stand in her way.',
          lines: [
            'I say: no. I am not going to stop you.',
            'she looks at me a long time. she does not move.',
            'eventually she walks back to the wall. ~~she did~~ she did not want to go.',
          ],
          scales: { approach: -3, recognition: +2, pond: +1 },
          composure: -1,
          composureCost: '!!I have answered her too well.!!',
        },
        {
          label: 'I can\'t',
          desc: 'honest.',
          lines: [
            'I say: I can\'t. but I am here.',
            'she nods. she sits down where she is. the room has a sitting woman in it.',
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
        'she has stopped speaking to the wall. her shoulders are very still.',
        'she asks the floor: ~~what is at the bottom of the pond?~~',
      ],
      responses: [
        {
          label: 'something heavy',
          desc: 'meet her where she is.',
          lines: [
            'I say: something heavy.',
            'she nods. ~~she has been~~ she has been remembering its weight.',
          ],
          scales: { release: +3, recognition: +1, pond: +1 },
          composure: -1,
          composureCost: 'the carpet is gone under me.',
        },
        {
          label: 'I don\'t know',
          desc: 'do not name it.',
          lines: [
            'I say: I don\'t know.',
            'she nods. she does not seem disappointed. ~~she did~~ she did not want to be told.',
          ],
          scales: { release: +1, recognition: +1, pond: -1 },
        },
        {
          label: 'a person',
          desc: 'name it.',
          lines: [
            'I say: a person.',
            'she is very quiet. ~~she has not~~ she has not let anyone say it.',
            '!!she does not deny it.!!',
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
        'she has turned slightly. she is looking at her own hands.',
        'she says: ~~I didn\'t mean to.~~',
      ],
      responses: [
        {
          label: 'I know',
          desc: 'simple.',
          lines: [
            'I say: I know.',
            'she nods. ~~she has not~~ she has not been told that.',
          ],
          scales: { release: +3, recognition: +2, pond: -1 },
        },
        {
          label: 'tell me what happened',
          desc: 'invite.',
          lines: [
            'I say: tell me what happened.',
            'she does. some of it. ~~she leaves~~ she leaves a lot of it under the water.',
          ],
          scales: { release: +3, recognition: +2 },
          composure: -1,
          composureCost: 'the floor is wet to my ankles.',
        },
        {
          label: 'it doesn\'t matter',
          desc: 'do not require the story.',
          lines: [
            'I say: it doesn\'t matter what you meant.',
            'she looks at me a long time. she does not agree. but she does not turn back to the wall.',
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
          'I wait. she takes another step toward me. the floor is wet to my ankles now.',
        ],
        scales: { approach: +1, pond: +1 },
        composure: -1,
        composureCost: 'the room is wetter than the corridor. by a degree.',
      };
    }
    return {
      lines: [
        'I wait. she is asking the wall about the pond. she does not advance, but the floor is wetter than it was.',
      ],
      scales: { pond: +1, approach: +1 },
      composure: -1,
      composureCost: 'her hand on my collar was warm.',
    };
  },

  endings: [
    {
      id: 'pond_acknowledged',
      when: (p) => p.scales.release >= 8 && p.scales.recognition >= 7,
      title: 'you let her say it',
      lines: [
        'we sit on the wet floor a long time. she does not ask about the pond again.',
        'she gives me the name of what she put in. !!she has not said it out loud in years.!!',
        'I take it with me.',
      ],
      item: 'small_bell',
    },
    {
      id: 'denial_held',
      when: (p) => p.scales.pond <= 1 && p.scales.recognition >= 6,
      title: 'you hold the room from her',
      lines: [
        'she has not turned. the floor is barely damp now. the pond is somewhere else, where it always was.',
        'she does not look at me when I leave. but the room is a room.',
      ],
      item: 'worn_ribbon',
    },
    {
      id: 'weight_named',
      when: (p) => p.scales.release >= 9 && p.scales.pond >= 5,
      title: 'she names the weight',
      lines: [
        '!!she names it. she gives me the name.!!',
        'I close my hands around it. she lets me. ~~I have~~ I have a thing now I did not come in with.',
      ],
      item: 'scrap_of_paper',
      scars: ['witnessed'],
    },
    {
      id: 'pulled_in',
      when: (p) => p.scales.approach >= 9,
      title: 'she takes you to the pond',
      lines: [
        'her hand on my collar. the floor opens.',
        '!!I do not know what was at the bottom. I do not know whose name she spoke as I went under.!!',
      ],
      item: null,
      scars: ['witnessed', 'collapsed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'you walk out',
      lines: ['I leave the room. the corridor is dry. ~~for now.~~'],
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
  subtitle: 'she has been writing the same chord for years.',
  role: 'wing', tier: 3,
  file: [
    'patient has been composing in the day room since admission.',
    'staff have noticed: she does not write notes down. she ~~hums them~~ holds them.',
    'when interrupted she stares at the spot the music was in. !!she does not look up.!!',
  ],
  intro: [
    'the upright piano is in the corner of the room. she is at the bench. her hands are above the keys but she is not playing.',
    'she is humming. ~~the chord~~ a chord. she has been writing it a long time.',
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
        2: 'I have stopped fidgeting. she has noticed.',
        3: 'the room has space for her now.',
        4: '~~I am not~~ I am not in the song. I am next to it.',
      },
      crossDown: {
        1: 'my breathing has gotten loud again.',
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
        2: 'the song has begun to know what it is.',
        3: 'her hands have found the last few notes.',
        4: '!!the chord is ready to land.!!',
      },
      crossDown: {
        1: 'she has lost her place again.',
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
        3: 'the chord has thickened. there are voices in it.',
        4: '!!the chord wants to land. it is louder than the room.!!',
      },
      crossDown: {
        2: 'a note has fallen out of it.',
        1: 'the chord has come apart.',
        0: 'the chord is gone. the room is quiet.',
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
        2: 'the room has gone tight.',
        3: '!!my teeth are ringing.!!',
        4: '!!the room is about to fall apart.!!',
      },
      crossDown: {
        2: 'the tension has eased.',
        1: 'the room has settled.',
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
    { announce: 'a line of her file fills in. ~~composing in the day room since admission.~~' },
    { announce: '~~she holds the notes.~~ she does not write them down.' },
    { announce: 'the last line. **she does not look up.**' },
  ],

  presented(p) {
    const c = p.scales.chord;
    const s = p.scales.silence;
    const co = p.scales.completion;
    const t = p.scales.tension;
    let sound;
    if (c >= 8)      sound = '!!the chord is full. it has been full a while. it wants to land.!!';
    else if (c >= 5) sound = 'the chord is almost there. it is several notes thick.';
    else if (c >= 2) sound = 'the chord is forming. a few notes are stacked, humming.';
    else             sound = 'the room is quiet. she has not begun.';
    let hands;
    if (co >= 7)     hands = 'her hands are trembling above the keys. ready to land.';
    else if (co >= 4) hands = 'her hands are over the keys. she has not pressed any of them.';
    else if (co >= 1) hands = 'her hands move above the keys. searching.';
    else              hands = 'her hands are folded in her lap. she has stopped.';
    let me;
    if (t >= 6)      me = '!!the room is loud. my ears are full.!!';
    else if (s >= 4) me = 'I am very quiet in the corner. the room has space for her.';
    else if (s >= 1) me = 'I am holding still. listening.';
    else             me = 'I am breathing normally. it is loud, in here.';
    return `${sound} ${hands} ${me}`;
  },

  verbs: {

    hold_still: {
      label: 'hold still',
      desc: 'do nothing. let the room have its breath.',
      respond(p) {
        const reps = streakCount(p, 'hold_still');
        if (reps >= 2) {
          return {
            lines: [
              'I am very still. she has stopped noticing me, which is the right way.',
              'a note arrives. another. she has been working.',
            ],
            scales: { silence: +2, completion: +2, chord: +1 },
          };
        }
        return {
          lines: [
            'I keep still. I keep quiet. I keep my breathing low.',
            'she adds a note. she leaves it alone.',
          ],
          scales: { silence: +1, chord: +1 },
        };
      },
    },

    listen_carefully: {
      label: 'listen carefully',
      desc: 'attend to the chord. let her feel attended to.',
      respond(p) {
        return {
          lines: [
            'I listen. I follow the shape of what she is building. I do not breathe in time.',
            p.scales.completion >= 4
              ? 'she nods, slightly. she knows I am with her.'
              : 'she does not notice me listening, but the chord deepens a little anyway.',
          ],
          scales: { silence: +2, completion: +1 },
        };
      },
    },

    add_a_note: {
      label: 'hum a low note',
      desc: 'add to the chord. quietly.',
      when: (p) => p.scales.silence >= 3 && p.scales.chord >= 3,
      respond(p) {
        const reps = streakCount(p, 'add_a_note');
        if (reps >= 2) {
          return {
            lines: [
              'I keep humming notes. the chord has thickened. she has not stopped.',
              '~~but the chord has~~ but the chord has more of me in it than I meant.',
            ],
            scales: { chord: +2, tension: +1, silence: -1 },
            composure: -1,
            composureCost: 'her hand stopped above the keys. ~~not~~ not because of me.',
          };
        }
        if (p.scales.chord >= 7) {
          return {
            lines: [
              'I hum a low note. it does not fit. ~~the chord~~ the chord winces around it.',
              'she stops humming. she looks at me. !!she is angry, briefly.!!',
            ],
            scales: { chord: -1, completion: -1, tension: +2 },
            composure: -2,
            composureCost: 'one of the notes is wrong. it is the one I added.',
          };
        }
        return {
          lines: [
            'I hum a note. it fits. ~~it is~~ it is one she had been waiting for.',
            'she nods, almost.',
          ],
          scales: { chord: +1, completion: +2 },
        };
      },
    },

    close_the_lid: {
      label: 'close the piano lid',
      desc: 'reach past her. close it. gently.',
      when: (p) => p.scales.completion <= 4 && p.scales.silence >= 4,
      respond(p) {
        if (p.scales.completion <= 3) {
          return {
            lines: [
              'I reach past her. her shoulder is warm. I lower the lid over the keys.',
              'the chord stops in the air. ~~it~~ it does not finish.',
              'she lowers her hands. she rests them on the closed lid. she breathes out.',
              '!!she has been waiting for someone to do this.!!',
            ],
            flags: { closed_lid: true },
            scales: { chord: -5, completion: -3, tension: -2 },
          };
        }
        return {
          lines: [
            'I reach to close it. her hand is on the lid first. she does not push me away.',
            'she says: !!not yet.!! she is firm.',
          ],
          scales: { tension: +2 },
          composure: -1,
          composureCost: '!!the chord has gone wrong.!!',
        };
      },
    },

    let_her_finish: {
      label: 'let her finish',
      desc: 'lay your hands on the keys with hers. press together.',
      when: (p) => p.scales.completion >= 6 && p.scales.chord >= 6,
      respond(p) {
        if (p.scales.silence >= 5 && p.scales.completion >= 7 && p.scales.chord >= 7) {
          return {
            lines: [
              'I sit on the bench beside her. I find her shoulder with my shoulder.',
              'I lay my hands on the keys where hers are.',
              'we press. the chord lands. the room composes itself around it.',
              '!!she sets her hands in her lap. she has finished.!!',
            ],
            flags: { finished_chord: true },
            scales: { completion: -8, chord: -8 },
          };
        }
        return {
          lines: [
            'I sit beside her. I lay my hands on the keys. she shakes her head. ~~not now.~~ not yet.',
            'she lifts my hands off the keys gently.',
          ],
          scales: { silence: +1, tension: +2 },
          composure: -1,
          composureCost: 'the room is humming. ~~the chord~~ the chord is in my chest.',
        };
      },
    },

    play_wrong_note: {
      label: 'play a wrong note',
      desc: 'sing a note that does not fit. break the chord.',
      when: (p) => p.scales.chord >= 6,
      respond() {
        return {
          lines: [
            'I sing a note that does not fit. it is wrong. it is obviously wrong.',
            'she stops humming. she stares at the spot the chord was in.',
            'one of the notes has dropped out of it. the others are leaning.',
          ],
          scales: { chord: -3, completion: -2, tension: +3 },
          composure: -1,
          composureCost: 'her not-yet has gone on too long.',
        };
      },
    },

    ask_about_the_song: {
      label: 'ask about the song',
      desc: 'what is this? who is it for?',
      when: (p) => p.scales.silence >= 4 && p.scales.chord >= 4,
      respond() {
        return {
          lines: [
            'I ask: what is this song?',
            'she tells me. quietly. it is for her husband. or her brother. she is not sure which.',
            'either way she has been writing it for a long time.',
          ],
          scales: { completion: +2, tension: -1 },
        };
      },
    },
  },

  wait: {
    label: 'wait',
    desc: 'hold the silence. let the chord stack itself.',
    when: (p) => p.scales.completion <= 6 || p.scales.silence >= 3 || p.turn >= 4,
  },

  interjections: [
    {
      id: 'can_you_hear_it',
      once: true,
      when: (p) => p.scales.chord >= 6 && p.scales.silence >= 4,
      prose: [
        'she pauses with her hands above the keys. she turns her head, slightly, toward me.',
        'she asks: ~~can you hear it?~~',
      ],
      responses: [
        {
          label: 'yes',
          desc: 'confirm. let her have a listener.',
          lines: [
            'I say: yes.',
            'she returns to the keys. her hands have steadied. she is no longer alone in this.',
          ],
          scales: { completion: +3, silence: +2 },
        },
        {
          label: 'I hear a chord',
          desc: 'precise. less than yes.',
          lines: [
            'I say: I hear a chord. four notes. one of them is a half-step under the others.',
            'she nods slowly. she is surprised. she had not thought anyone was that careful.',
          ],
          scales: { completion: +3, chord: +1, silence: +1 },
        },
        {
          label: 'I hear it now',
          desc: 'soft.',
          lines: [
            'I say: I hear it now.',
            'her hands move. the chord widens by one note. she is teaching me, briefly.',
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
        'her hands have stopped, briefly. she is looking at the keys.',
        'she asks: ~~did I have a brother, or a husband? I cannot remember which this is for.~~',
      ],
      responses: [
        {
          label: 'a brother',
          desc: 'pick one.',
          lines: [
            'I say: a brother.',
            'she nods. she begins again. one note at a time. ~~she does not check.~~',
          ],
          scales: { completion: +2, chord: +1 },
          scars: ['named'],
        },
        {
          label: 'a husband',
          desc: 'pick the other.',
          lines: [
            'I say: a husband.',
            'she pauses. she is not sure. but she begins again.',
          ],
          scales: { completion: +1, tension: +1 },
          scars: ['named'],
        },
        {
          label: 'tell me what you remember',
          desc: 'do not name.',
          lines: [
            'I say: tell me what you remember.',
            'she does. it is small. ~~a knee scar. a way of saying a particular word.~~',
            '!!a person, made specific.!!',
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
        'she has stopped humming. her hands are above the keys, very still.',
        'she asks: ~~is this right? does it sound right?~~',
      ],
      responses: [
        {
          label: 'it sounds right',
          desc: 'give her the reassurance.',
          lines: [
            'I say: it sounds right.',
            'she nods. she returns to the keys. ~~her hands~~ her hands are steadier than they were.',
          ],
          scales: { completion: +3, silence: +1 },
        },
        {
          label: 'one note is wrong',
          desc: 'be honest. point it out.',
          lines: [
            'I say: one of the notes is wrong. the third from the bottom.',
            'she stares at the keys. she lifts her hand. she lowers it. ~~she~~ she does not press it.',
          ],
          scales: { chord: -2, tension: +2, completion: +1 },
          composure: -1,
          composureCost: 'the lid is heavier than I thought.',
        },
        {
          label: 'I can\'t tell',
          desc: 'honest in a different way.',
          lines: [
            'I say: I can\'t tell.',
            'she nods. ~~she~~ she has been wondering, too.',
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
        'her hands drop to her lap. she looks at the keys as if for the first time tonight.',
        'she asks me: ~~am I done?~~',
      ],
      responses: [
        {
          label: 'you\'re done',
          desc: 'release her.',
          lines: [
            'I say: you\'re done.',
            'she nods slowly. her hands rest on the closed lid. ~~she~~ she has been waiting.',
          ],
          scales: { chord: -3, completion: -2, tension: -2 },
          flags: { closed_lid: true },
          composure: -1,
          composureCost: 'her hand stopped above the keys. ~~not~~ not because of me.',
        },
        {
          label: 'one more note',
          desc: 'help her finish.',
          lines: [
            'I say: one more note.',
            'she nods. she lifts a hand. she presses one key. ~~the room~~ the room rings.',
          ],
          scales: { completion: +3, chord: +2 },
        },
        {
          label: 'I don\'t know',
          desc: 'honest.',
          lines: [
            'I say: I don\'t know. only you know.',
            'she sits with that. her hands stay in her lap. she does not begin again.',
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
          'I wait. she adds the final note. the chord lands without me. ~~without anyone.~~',
          '!!the room composes itself. but I was not in it.!!',
        ],
        scales: { chord: -7, completion: -7, tension: +3 },
        composure: -2,
        composureCost: 'one of the notes is wrong. it is the one I added.',
        flags: { finished_alone: true },
      };
    }
    return {
      lines: ['I wait. she adds a note. then another. the chord deepens.'],
      scales: { chord: +1, completion: +1, tension: +1 },
    };
  },

  endings: [
    {
      id: 'finished_together',
      when: (p) => p.flags.finished_chord,
      title: 'you finish the chord with her',
      lines: [
        'her hands are in her lap. mine are still on the keys. she puts hers over mine.',
        'we do not say anything. ~~for a long time.~~ for a long time.',
      ],
      item: 'scrap_of_paper',
    },
    {
      id: 'closed_lid',
      when: (p) => p.flags.closed_lid && p.scales.silence >= 4,
      title: 'you close the lid',
      lines: [
        'the lid is closed. she rests her hands on the wood. the room is quiet for the first time.',
        '!!she lets it be quiet.!!',
      ],
      item: 'sliver_of_glass',
    },
    {
      id: 'finished_alone',
      when: (p) => p.flags.finished_alone,
      title: 'she finishes it without you',
      lines: [
        'the chord arrives. she does not look at me. she has finished what she came in to finish.',
        'I leave the room. ~~the chord follows me~~ the chord follows me for some hours.',
      ],
      item: 'photograph',
      scars: ['witnessed'],
    },
    {
      id: 'broken',
      when: (p) => p.scales.tension >= 9,
      title: 'the chord falls apart',
      lines: [
        'her hands drop. she stares at the keys. the chord is in pieces around her.',
        '!!she has lost the place she was holding it from.!!',
      ],
      item: null,
      scars: ['witnessed', 'failed'],
    },
    {
      id: 'abandoned',
      when: (p) => p.flags.left,
      title: 'you walk out',
      lines: ['I close the door. the chord is humming behind me. ~~it always was.~~'],
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
