// Entry point. Loaded by index.html as a module. Loads JSON (glyphs + voice
// prose), restores the persisted meta-save from localStorage, then kicks off
// the first render.
import { loadData } from './data.js';
import { loadSave } from './save.js';
import { render } from './ui/render.js';
import { advanceLog } from './combat.js';
import { state } from './state.js';

await loadData();
state.save = loadSave();
state.screen = 'title';
render();

// Keyboard: space / enter advance the combat log when something is
// waiting for the player to click. (Mouse click on the narrative window
// also advances — both routes go through advanceLog().)
document.addEventListener('keydown', (e) => {
  if (state.screen !== 'encounter') return;
  if (state.typingIdx < 0 && !state.logAwaitingClick) return;
  if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
    e.preventDefault();
    advanceLog();
  }
});
