/**
 * UI-only boot — what `?renderGame=false` loads instead of the game.
 *
 * For debugging the HTML surfaces and for tests that only care about markup
 * and style, booting the engine is pure cost: a WebGL context, a level build,
 * a shader pre-warm and a frame loop, none of which the DOM needs. This stands
 * up the lobby — the screen a normal load opens on — with the real map cards
 * and garrison chips, and nothing behind it: no engine, no canvas rendering,
 * no relay connection.
 *
 * WHAT STILL WORKS   the whole lobby DOM: map cards (a click repaints the
 *                    selection and saves the preference, exactly the solo
 *                    path), garrison chips, the layout explorations,
 *                    copy-link, and keyboard focus.
 * WHAT IS INERT      anything that needs the engine or the wire — Play,
 *                    warm-up, settings — logs a `[uionly]` note instead.
 *
 * `?mp=0` is honoured for LAYOUT only (it collapses the room panel, same as
 * the real boot); there is never an actual relay connection here, so the
 * default view shows the lobby in its "connecting" dress, permanently.
 *
 * `window.__READY__` is raised once the lobby is painted so the page can be
 * driven by the same wait the capture harnesses use, and the view is exposed
 * as `window.__UIONLY__` for poking from a test or the devtools console.
 */

import { MatchStartUI } from '../match/ui.js';
import { mapSummaries, resolveBootMap, saveMapPreference } from '../world/maps.js';

const DEFAULT_BOTS = 'standard';

export async function bootUiOnly() {
  const params = new URLSearchParams(location.search);
  const multiplayer = params.get('mp') !== '0';

  const ui = new MatchStartUI({ multiplayer });
  ui.setMaps(mapSummaries());
  ui.setMap(resolveBootMap({ search: location.search }));
  ui.setMapNote(multiplayer ? 'Shared with everyone in your room' : '');
  ui.setBots(DEFAULT_BOTS);

  // The solo map path from src/match/index.js, minus the world rebuild there
  // is no world to rebuild: repaint the card and keep the choice for the next
  // real boot.
  ui.onMap = (id) => {
    ui.setMap(id);
    saveMapPreference(id);
  };
  ui.onBots = (key) => ui.setBots(key);

  const inert = (what) => () =>
    console.info(`[uionly] ${what} ignored — the game is not running (?renderGame=false)`);
  ui.onPrimary = inert('play');
  ui.onAlt = inert('warm-up');
  // The pause menu is wired straight into ctx/config/quality, so without an
  // engine there is nothing for it to edit.
  ui.onSettings = inert('settings');
  ui.onName = () => {};
  ui.onCopyInvite = () => {
    navigator.clipboard?.writeText(location.href).catch(() => {});
    ui.flashCopied();
  };

  ui.setVisible(true);
  if (multiplayer) {
    // The model a real boot renders in the instant before the relay answers —
    // which is the honest state here, because no answer is ever coming.
    ui.render({
      connected: false,
      everConnected: false,
      full: 0,
      live: false,
      players: [],
      myId: null,
      ready: false,
      map: null,
    });
  } else {
    ui.render({});
  }
  requestAnimationFrame(() => ui.focusPrimary());

  window.__UIONLY__ = ui;
  window.__READY__ = true;
  console.info('[boot] renderGame=false — engine skipped, HTML UI only');
}
