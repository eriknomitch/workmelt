#!/usr/bin/env node
/**
 * Input + control-binding checks.
 *
 * Focus is ADS resolution, because that is the one input path with a mode
 * switch behind it: the keyboard bind always toggles, the right mouse button
 * follows `adsMode` (hold by default), the two share one latch, and every
 * consumer of `input.ads` has to see the same answer either way.
 *
 *   node src/core/input.selftest.mjs
 */

import assert from 'node:assert/strict';
import { createConfig } from './config.js';
import { Input } from './input.js';
import {
  DEFAULT_CONTROLS,
  isBindableKey,
  keyLabel,
  loadControlSettings,
  normalizeControls,
  saveControlSettings,
} from './controls.js';

// `_pollGamepad` reads the navigator global; Node may not have one.
globalThis.navigator ??= {};

let checks = 0;

function check(name, fn) {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
}

/** A canvas stub is enough — the test never attaches DOM listeners. */
function makeInput(overrides = {}) {
  const canvas = { addEventListener() {}, removeEventListener() {} };
  return new Input(canvas, createConfig(overrides));
}

const down = (input, code) => input._pendingDown.add(code);
const up = (input, code) => input._pendingUp.add(code);

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

/* ------------------------------------------------- hold mode (mouse only) -- */

check('hold mode aims only while the right button is down', () => {
  const input = makeInput({ adsMode: 'hold', adsKey: null });
  input.beginFrame();
  assert.equal(input.ads, false);

  down(input, 'Mouse2');
  input.beginFrame();
  assert.equal(input.ads, true);

  input.beginFrame(); // still held, no new events
  assert.equal(input.ads, true);

  up(input, 'Mouse2');
  input.beginFrame();
  assert.equal(input.ads, false);
});

/* --------------------------------------------- the key toggles, always -- */

check('the keyboard bind latches even in hold mode', () => {
  const input = makeInput({ adsMode: 'hold', adsKey: 'KeyX' });
  down(input, 'KeyX');
  input.beginFrame();
  assert.equal(input.ads, true);

  up(input, 'KeyX');
  input.beginFrame();
  assert.equal(input.ads, true, 'releasing the key must not drop the optic');

  // Firing while the optic is up is the whole point on a trackpad, and now it
  // needs no hold at all.
  down(input, 'Mouse0');
  input.beginFrame();
  assert.equal(input.ads, true);
  assert.equal(input.fire, true);

  down(input, 'KeyX');
  input.beginFrame();
  assert.equal(input.ads, false, 'second tap unlatches');
  assert.equal(input.fire, true);
});

check('the mouse still holds while a key latch is available', () => {
  const input = makeInput({ adsMode: 'hold', adsKey: 'KeyX' });
  down(input, 'Mouse2');
  input.beginFrame();
  assert.equal(input.ads, true);
  up(input, 'Mouse2');
  input.beginFrame();
  assert.equal(input.ads, false, 'a mouse hold is still a hold');

  // A hold layered on top of a latch must not consume it on release.
  down(input, 'KeyX');
  input.beginFrame();
  down(input, 'Mouse2');
  input.beginFrame();
  assert.equal(input.ads, true);
  up(input, 'Mouse2');
  input.beginFrame();
  assert.equal(input.ads, true, 'releasing the mouse must not steal the latch');
});

check('sprint breaks a key latch in hold mode too', () => {
  const input = makeInput({ adsMode: 'hold', adsKey: 'KeyX' });
  down(input, 'KeyX');
  input.beginFrame();
  up(input, 'KeyX');
  input.beginFrame();
  assert.equal(input.ads, true);

  down(input, 'ShiftLeft');
  input.beginFrame();
  assert.equal(input.ads, false, 'sprint is gated on not being scoped');
});

/* --------------------------------------------- toggle mode (mouse too) -- */

check('toggle mode latches on press and survives the release', () => {
  const input = makeInput({ adsMode: 'toggle', adsKey: null });

  down(input, 'Mouse2');
  input.beginFrame();
  assert.equal(input.ads, true);

  up(input, 'Mouse2');
  input.beginFrame();
  assert.equal(input.ads, true, 'releasing must not drop the latch');

  down(input, 'Mouse2');
  input.beginFrame();
  assert.equal(input.ads, false, 'second press unlatches');
});

check('toggle mode latches from the keyboard bind too', () => {
  const input = makeInput({ adsMode: 'toggle', adsKey: 'KeyX' });
  down(input, 'KeyX');
  input.beginFrame();
  up(input, 'KeyX');
  input.beginFrame();
  assert.equal(input.ads, true);

  // Either source unlatches — they drive one shared state, not two.
  down(input, 'Mouse2');
  input.beginFrame();
  assert.equal(input.ads, false);
});

check('a held key does not re-latch every frame', () => {
  const input = makeInput({ adsMode: 'toggle', adsKey: 'KeyX' });
  down(input, 'KeyX');
  input.beginFrame();
  assert.equal(input.ads, true);
  for (let i = 0; i < 5; i++) {
    input.beginFrame();
    assert.equal(input.ads, true);
  }
});

check('sprint breaks a toggle latch', () => {
  const input = makeInput({ adsMode: 'toggle', adsKey: 'KeyX' });
  down(input, 'KeyX');
  input.beginFrame();
  up(input, 'KeyX');
  input.beginFrame();
  assert.equal(input.ads, true);

  down(input, 'ShiftLeft');
  input.beginFrame();
  assert.equal(input.ads, false, 'sprint is gated on not being scoped');

  // Holding sprint must not block a deliberate re-scope.
  down(input, 'KeyX');
  input.beginFrame();
  assert.equal(input.ads, true);
});

check('blur and clearAdsToggle drop the latch', () => {
  const input = makeInput({ adsMode: 'toggle', adsKey: 'KeyX' });
  down(input, 'KeyX');
  input.beginFrame();
  assert.equal(input.ads, true);

  input._onBlur();
  input.beginFrame();
  assert.equal(input.ads, false, 'losing focus must not leave the optic up');

  down(input, 'KeyX');
  input.beginFrame();
  assert.equal(input.ads, true);
  input.clearAdsToggle();
  assert.equal(input.ads, false);
});

check('a latch survives the mode switch, and the menu is what drops it', () => {
  const input = makeInput({ adsMode: 'toggle', adsKey: 'KeyX' });
  down(input, 'Mouse2');
  input.beginFrame();
  up(input, 'Mouse2');
  input.beginFrame();
  assert.equal(input.ads, true);

  // A latch is legal in either mode now, so `_resolveAds` no longer clears one
  // on sight — a key latch is exactly that state. Changing the mouse mode is
  // the one case that could strand a mouse latch, which is why `_setAdsMode`
  // calls `clearAdsToggle` (src/ui/menu.js).
  input.config.adsMode = 'hold';
  input.clearAdsToggle();
  input.beginFrame();
  assert.equal(input.ads, false);
});

check('clearing a latch leaves a genuinely held button aiming', () => {
  const input = makeInput({ adsMode: 'hold', adsKey: 'KeyX' });
  down(input, 'Mouse2');
  down(input, 'KeyX');
  input.beginFrame();
  assert.equal(input.ads, true);

  input.clearAdsToggle();
  assert.equal(input.ads, true, 'the right button is still down');
  up(input, 'Mouse2');
  input.beginFrame();
  assert.equal(input.ads, false);
});

check('an unbound ads key leaves the mouse in charge', () => {
  const input = makeInput({ adsMode: 'hold', adsKey: null });
  down(input, 'KeyX');
  input.beginFrame();
  assert.equal(input.ads, false);
  down(input, 'Mouse2');
  input.beginFrame();
  assert.equal(input.ads, true);
});

/* -------------------------------------------------------------- bindings -- */

check('defaults ship a trackpad-usable ads key', () => {
  assert.equal(DEFAULT_CONTROLS.adsKey, 'KeyX');
  assert.equal(DEFAULT_CONTROLS.adsMode, 'hold');
  assert.equal(createConfig().adsKey, 'KeyX');
  assert.ok(isBindableKey(DEFAULT_CONTROLS.adsKey));
});

check('keys the game already owns are not bindable', () => {
  for (const code of ['KeyW', 'KeyA', 'Space', 'ShiftLeft', 'KeyR', 'Escape', 'Tab'])
    assert.equal(isBindableKey(code), false, `${code} should be reserved`);
  for (const code of ['KeyX', 'KeyB', 'AltLeft', 'CapsLock', 'Digit5'])
    assert.equal(isBindableKey(code), true, `${code} should be bindable`);
  assert.equal(isBindableKey(null), false);
  assert.equal(isBindableKey('NotAKey'), false);
});

check('key labels read like keycaps', () => {
  assert.equal(keyLabel('KeyX'), 'X');
  assert.equal(keyLabel('Digit4'), '4');
  assert.equal(keyLabel('AltLeft'), 'ALT');
  assert.equal(keyLabel('ArrowUp'), 'UP');
  assert.equal(keyLabel(null), 'NONE');
});

check('bad stored controls fall back instead of throwing', () => {
  assert.deepEqual(normalizeControls({ adsMode: 'wat', adsKey: 'KeyW' }), {
    version: 1,
    adsMode: 'hold',
    adsKey: 'KeyX',
    autoReload: true,
  });
  // An explicit "no bind" has to round-trip, unlike a missing field.
  assert.equal(normalizeControls({ adsKey: null }).adsKey, null);
  assert.equal(normalizeControls(undefined).adsKey, 'KeyX');
});

check('auto-reload defaults on and only a real boolean turns it off', () => {
  assert.equal(DEFAULT_CONTROLS.autoReload, true);
  assert.equal(createConfig().autoReload, true);
  // A settings file saved before the field existed reads as the default.
  assert.equal(normalizeControls({ adsMode: 'hold', adsKey: 'KeyX' }).autoReload, true);
  assert.equal(normalizeControls({ autoReload: false }).autoReload, false);
  assert.equal(normalizeControls({ autoReload: true }).autoReload, true);
  // Truthy/falsy junk is not a choice.
  assert.equal(normalizeControls({ autoReload: 0 }).autoReload, true);
  assert.equal(normalizeControls({ autoReload: 'off' }).autoReload, true);
});

check('controls round-trip through storage', () => {
  const storage = memoryStorage();
  assert.deepEqual(loadControlSettings(storage), { ...DEFAULT_CONTROLS });

  saveControlSettings({ adsMode: 'toggle', adsKey: 'KeyB', autoReload: false }, storage);
  assert.deepEqual(loadControlSettings(storage), {
    version: 1,
    adsMode: 'toggle',
    adsKey: 'KeyB',
    autoReload: false,
  });

  saveControlSettings({ adsMode: 'toggle', adsKey: null }, storage);
  assert.equal(loadControlSettings(storage).adsKey, null);

  storage.setItem('cod_controls_v1', '{not json');
  assert.deepEqual(loadControlSettings(storage), { ...DEFAULT_CONTROLS });
});

check('missing storage is not an error', () => {
  assert.deepEqual(loadControlSettings(null), { ...DEFAULT_CONTROLS });
  assert.deepEqual(saveControlSettings({ adsMode: 'toggle' }, null), {
    version: 1,
    adsMode: 'toggle',
    adsKey: 'KeyX',
    autoReload: true,
  });
});

console.log(`\ninput selftest: ${checks} checks passed`);
