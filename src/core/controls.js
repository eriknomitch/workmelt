/**
 * Persisted control preferences — the half of `config` the player owns, kept
 * out of `config.js` because it survives reloads instead of being derived from
 * a quality preset.
 *
 * The ADS binding carries more weight than it looks. Aiming is right-mouse
 * *held*, which on a laptop trackpad is a two-finger click — and a two-finger
 * click cannot be held while a one-finger click pulls the trigger, so a
 * trackpad player can aim or fire but never both. Two knobs fix that without
 * touching anyone's mouse setup:
 *
 *   adsKey  — a keyboard bind, so ADS leaves the pointer entirely. It is always
 *             a toggle: tap to raise the optic, tap again to lower it. Holding
 *             a key for a whole engagement fights everything else the left hand
 *             is doing, and no hold is exactly what the bind is for.
 *   adsMode — how the *right mouse button* behaves: 'hold' (classic, and the
 *             default) or 'toggle'. It does not affect `adsKey`.
 *
 * `adsKey` defaults to X: unbound elsewhere, and under the same left hand that
 * already covers Z/C for stance, so a trackpad player can aim and fire out of
 * the box without changing a setting.
 *
 *   autoReload — whether an empty magazine reloads itself (on a dry trigger
 *                pull, or a beat after the last round leaves). ON by default,
 *                like every modern shooter; OFF makes R the only way, for
 *                players who want to decide when the gun leaves their shoulder.
 *                `weapons` reads it live from `config.autoReload` every frame.
 */

import { ACTIONS } from './input.js';

export const CONTROLS_STORAGE_KEY = 'cod_controls_v1';
export const ADS_MODES = ['hold', 'toggle'];

export const DEFAULT_CONTROLS = Object.freeze({
  version: 1,
  adsMode: 'hold',
  adsKey: 'KeyX',
  autoReload: true,
});

/**
 * Codes ADS may not steal: everything the game already binds, plus the keys the
 * browser and the menu itself need. `Mouse2` always aims regardless of the
 * keyboard bind, so it is not in here.
 */
const RESERVED = new Set([
  ...Object.values(ACTIONS).flat(),
  'Escape', // pause, and cancels a rebind
  'Tab', // scoreboard
  'Backspace', // clears the bind
  'Delete',
  'Enter',
  'NumpadEnter',
  'MetaLeft',
  'MetaRight',
  'F5',
  'F11',
  'F12',
]);

const LABELS = {
  Space: 'SPACE',
  ShiftLeft: 'L SHIFT',
  ShiftRight: 'R SHIFT',
  ControlLeft: 'L CTRL',
  ControlRight: 'R CTRL',
  AltLeft: 'ALT',
  AltRight: 'ALT GR',
  CapsLock: 'CAPS',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
};

/** True when `code` is a real KeyboardEvent.code the game is not already using. */
export function isBindableKey(code) {
  if (typeof code !== 'string' || !code) return false;
  if (RESERVED.has(code)) return false;
  return /^(Key[A-Z]|Digit\d|Numpad[A-Za-z\d]+|Arrow(Up|Down|Left|Right)|F\d{1,2}|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|CapsLock|Space|Backquote|Minus|Equal|Bracket(Left|Right)|Semicolon|Quote|Comma|Period|Slash|Backslash|IntlBackslash)$/.test(
    code
  );
}

/** Short uppercase label for a keycap, e.g. `KeyX` -> `X`, null -> `NONE`. */
export function keyLabel(code) {
  if (!code) return 'NONE';
  if (LABELS[code]) return LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6).toUpperCase()}`;
  if (code.startsWith('Arrow')) return code.slice(5).toUpperCase();
  return code.toUpperCase();
}

function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Coerce anything into a valid control set; unknown values fall back to defaults. */
export function normalizeControls(raw) {
  const adsMode = ADS_MODES.includes(raw?.adsMode) ? raw.adsMode : DEFAULT_CONTROLS.adsMode;
  let adsKey = DEFAULT_CONTROLS.adsKey;
  // `null` is a meaningful choice ("no keyboard bind") and must round-trip.
  if (raw?.adsKey === null) adsKey = null;
  else if (isBindableKey(raw?.adsKey)) adsKey = raw.adsKey;
  // Strict boolean: a settings file saved before this field existed reads as
  // the default (on), and truthy junk does not silently become a choice.
  const autoReload =
    typeof raw?.autoReload === 'boolean' ? raw.autoReload : DEFAULT_CONTROLS.autoReload;
  return { version: 1, adsMode, adsKey, autoReload };
}

export function loadControlSettings(storage = browserStorage()) {
  let raw = null;
  try {
    raw = JSON.parse(storage?.getItem?.(CONTROLS_STORAGE_KEY) ?? 'null');
  } catch {
    return { ...DEFAULT_CONTROLS };
  }
  if (!raw || raw.version !== 1) return { ...DEFAULT_CONTROLS };
  return normalizeControls(raw);
}

export function saveControlSettings(settings, storage = browserStorage()) {
  const next = normalizeControls(settings);
  try {
    storage?.setItem?.(CONTROLS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* private mode / storage disabled — the session still honours the choice */
  }
  return next;
}
