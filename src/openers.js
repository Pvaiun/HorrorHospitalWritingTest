// Title-screen openers. One is picked at random each time the title is
// rendered. Each entry is the three paragraphs of the main prose block;
// the dim corridor line below it is fixed and lives in screens.js.
// Prose register: see docs/VOICE.md.

export const TITLE_OPENERS = [
  // The Letter
  [
    "I am at the address from the letter. No stamp, no postmark — it was simply in the box one morning, addressed in ~~my own~~ a stranger's handwriting. The paper smelled faintly of carbolic soap.",
    "Inside the front door: a desk. A nurse looks up as if I am on time. !!Hello again,!! she says. !!I've been expecting you.!!",
    "The walls are dark and taller than walls need to be. A long way down the corridor, someone is ~~screaming~~ singing. This is not a [[10]].",
  ],

  // The Bus
  [
    "The bus I take every day is empty when I board. The driver does not look at me, and I cannot find the moment the streets stop being the ones I know. The doors open at a stop ~~I have been dreading~~ that is not on the route.",
    "A nurse is waiting on the curb, hands folded, the way people wait for the expected. !!Welcome,!! she says. !!We were beginning to wonder.!!",
    "Behind her, a lobby. A desk. A corridor going down past the reach of its own lights. This is not a [[4]] I have ever seen.",
  ],

  // The Phone Call
  [
    "My phone rings. The voice on the other end is ~~my own~~ a stranger's, and it reads me an address the way you read to a child — slowly, and twice.",
    "I drive there. A building with no sign on it. A desk, a nurse, my file already open. !!Welcome,!! she says. !!We've been trying to reach you.!!",
    "The lobby walls go up into the dark, and the corridor goes back farther than the building does. This is not the [[7]] the voice gave me.",
  ],

  // The Mirror
  [
    "I look into the mirror over my sink, and the face in the glass is ~~not mine~~ unfamiliar — by a margin too small to swear to. I turn away from it.",
    "Behind me is a desk. A nurse looks up from my file. !!Welcome back,!! she says. !!The doctor is ready for you.!!",
    "The mirror is still on the wall, hanging over a sink that is no longer there. The corridor runs out ahead of me. This is not the [[8]] I was standing in.",
  ],

  // The Cemetery
  [
    "I walk the cemetery at night, reading the stones the way I read everything — to make sure it stays written. The name on one of them is ~~mine~~ familiar.",
    "I look up from it, and the night is a ceiling. A desk. A nurse looks up from my file. !!Welcome,!! she says. !!Your visit is overdue.!!",
    "The corridor runs in both directions, farther than the grounds could hold. The grass underfoot is terrazzo now. This is not the [[5]] I came to visit.",
  ],

  // The Light Switch
  [
    "I turn off my bedroom light. I turn it back on a moment later, because the dark had a draft in it. The room the light comes back to is ~~where I always end up~~ not my bedroom. It is a long corridor.",
    "At the far end, a desk. A nurse looks up. !!Hello again,!! she says. !!Your room is ready.!!",
    "The fluorescents hum overhead, one of them failing somewhere I cannot see. There is no [[6]] on any of these walls.",
  ],
];
