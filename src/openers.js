// Title-screen openers. One is picked at random each time the title is
// rendered. Each entry is the three paragraphs of the main prose block;
// the dim corridor line below it is fixed and lives in screens.js.

export const TITLE_OPENERS = [
  // The Letter
  [
    "I'm at the address on the letter. The one I received in the mail written in ~~my own~~ a strange handwriting.",
    "I walk through the front door. A desk. A nurse greets me. !!Hello again!!, she says. !!I've been expecting you.!!",
    "The walls are dark and tall. Screams echo through the halls. This is not a [[10]].",
  ],

  // The Bus
  [
    "The bus I take every day is empty when I board. The driver does not look at me. The doors open at the stop ~~I have been dreading~~ I do not know.",
    "A nurse is waiting on the curb. !!Welcome,!! she says. !!We were beginning to wonder.!!",
    "The lobby behind her is dim. A long corridor leads past the desk. This is not a [[4]] I have ever seen.",
  ],

  // The Phone Call
  [
    "My phone rings. I answer. The voice on the other end is ~~my own~~ a stranger's. It tells me an address.",
    "I drive to it. A building. I walk inside. A desk. A nurse looks up. !!Welcome,!! she says. !!We've been trying to reach you.!!",
    "The walls of the lobby are dark and tall. Screams echo down a corridor I cannot see the end of. This is not the [[7]] the voice gave me.",
  ],

  // The Mirror
  [
    "I look in the mirror over my sink. The face in the glass is ~~not mine~~ unfamiliar. I turn from the sink.",
    "A desk. A nurse looks up from my file. !!Welcome back,!! she says. !!The doctor is ready for you.!!",
    "The mirror is on the wall behind me. The corridor stretches in front. This is not the [[8]] I came into.",
  ],

  // The Cemetery
  [
    "I walk through the cemetery at night. I read the inscriptions on the stones. The name on one is ~~mine~~ familiar.",
    "I look up. The cemetery is gone. A desk. A nurse looks up from my file. !!Welcome,!! she says. !!Your visit is overdue.!!",
    "The corridor stretches in both directions. The night sky is gone. This is not the [[5]] I came to visit.",
  ],

  // The Light Switch
  [
    "I turn off the lights in my bedroom. I turn them back on a moment later. The room I am in is ~~where I always end up~~ not my bedroom. It is a long corridor.",
    "A desk at the far end. A nurse looks up. !!Hello again,!! she says. !!Your room is ready.!!",
    "The fluorescents overhead hum. The walls are tall and dim. I do not see a [[6]] on any wall.",
  ],
];
