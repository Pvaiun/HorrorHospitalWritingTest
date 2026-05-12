// The trait system was retired. Player progression now flows through the
// inventory in src/items.js and the scars system in src/scars.js. This
// file is kept as a stub so callers that still import from it don't break;
// the helpers no-op, and TRAITS is an empty registry.

export const TRAITS = {};

export function traitMods()  { return {}; }
export function traitHooks() { return {}; }
export function getTrait()   { return null; }
export function sumMod()     { return 0; }
export function fireTraitHooks(_player, _hookName, ctx) { return ctx; }
