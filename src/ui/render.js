// Render dispatcher. Clears the app root, draws the title bar where
// appropriate, and dispatches to a screen renderer based on state.screen.
//
// Called after every state mutation by every module. Stays small.

import { el, app } from './dom.js';
import { state } from '../state.js';
import {
  renderTitle, renderAdmission, renderCorridor, renderEvent, renderEventAfter,
  renderResolution, renderArchive,
} from './screens.js';
import { renderEncounter } from './encounter.js';

export function render() {
  const root = app();
  root.innerHTML = '';
  // title bar on non-encounter, non-title screens
  if (state.screen !== 'encounter' && state.screen !== 'title') {
    root.appendChild(el('h1', {}, 'BLOODLINES'));
    root.appendChild(el('div', { class: 'subtitle' }, 'a document horror duel'));
  } else if (state.screen === 'title') {
    root.appendChild(el('h1', {}, 'BLOODLINES'));
    root.appendChild(el('div', { class: 'subtitle' }, 'a document horror duel'));
  }
  switch (state.screen) {
    case 'title':       renderTitle();       break;
    case 'admission':   renderAdmission();   break;
    case 'corridor':    renderCorridor();    break;
    case 'event':       renderEvent();       break;
    case 'event_after': renderEventAfter();  break;
    case 'encounter':   renderEncounter();   break;
    case 'resolution':  renderResolution();  break;
    case 'archive':     renderArchive();     break;
    default:
      root.appendChild(el('div', { class: 'doc-prose' }, `(unknown screen: ${state.screen})`));
  }
}
