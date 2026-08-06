#!/usr/bin/env node
/**
 * Touch control checks — the pure half of src/ui/touch.js.
 *
 * The stick maths and the button->code mapping are what gameplay actually
 * feels; the DOM shell around them is exercised by the browser playtests.
 * The mapping check matters most: a touch button bound to a code no ACTIONS
 * entry (or pseudo-mouse code) owns would render, press, and do nothing.
 *
 *   node src/ui/touch.selftest.mjs
 */

import assert from 'node:assert/strict';
import { STICK, TOUCH_BUTTONS, stickVector } from './touch.js';
import { ACTIONS } from '../core/input.js';

let checks = 0;

function check(name, fn) {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
}

/* ----------------------------------------------------------- stick maths -- */

check('rest and sub-deadzone drags read as zero', () => {
  assert.deepEqual(stickVector(0, 0), { x: 0, y: 0, mag: 0 });
  const r = STICK.radius;
  const sub = stickVector(r * STICK.deadzone * 0.9, 0);
  assert.equal(sub.x, 0);
  assert.equal(sub.y, 0);
});

check('a full drag up is full forward, +y', () => {
  const v = stickVector(0, -STICK.radius);
  assert.ok(Math.abs(v.x) < 1e-9);
  assert.ok(Math.abs(v.y - 1) < 1e-9, 'drag up must be +y (forward)');
  assert.ok(v.y > STICK.sprintAt, 'full forward must clear the sprint gate');
});

check('overdrag clamps to the unit circle', () => {
  const v = stickVector(STICK.radius * 5, -STICK.radius * 5);
  assert.ok(Math.abs(Math.hypot(v.x, v.y) - 1) < 1e-9);
});

check('the deadzone edge is continuous, not a jump', () => {
  const r = STICK.radius;
  const justOver = stickVector(0, -r * (STICK.deadzone + 0.01));
  assert.ok(justOver.y > 0 && justOver.y < 0.05, `deadzone exit should be small, got ${justOver.y}`);
});

check('direction is preserved through the deadzone rescale', () => {
  const v = stickVector(30, -40); // 3-4-5 triangle
  const angIn = Math.atan2(40, 30);
  const angOut = Math.atan2(v.y, v.x);
  assert.ok(Math.abs(angIn - angOut) < 1e-9);
});

/* -------------------------------------------------------- button mapping -- */

check('every touch button code is a code the game actually binds', () => {
  const bound = new Set(Object.values(ACTIONS).flat());
  bound.add('Mouse0'); // fire is the mouse pseudo-code, read by input.fire
  for (const def of TOUCH_BUTTONS) {
    if (!def.code) {
      assert.ok(
        ['toggleAds', 'wheel', 'pause'].includes(def.action),
        `${def.id} has neither a code nor a known action`
      );
      continue;
    }
    assert.ok(bound.has(def.code), `${def.id} -> ${def.code} is bound to nothing`);
  }
});

check('cookable equipment and fire are hold buttons, taps are taps', () => {
  const byId = Object.fromEntries(TOUCH_BUTTONS.map((d) => [d.id, d]));
  // A tap-fire grenade could never cook, and a tap-fire trigger could never
  // hold automatic fire — these are the contract with weapons/throwables.
  for (const id of ['fire', 'fire2', 'lethal', 'tactical', 'jump', 'crouch'])
    assert.equal(byId[id].hold, true, `${id} must be hold-to-press`);
  for (const id of ['reload', 'use']) assert.ok(!byId[id].hold, `${id} must be a tap`);
  assert.equal(byId.ads.action, 'toggleAds', 'touch ADS is always a toggle');
  assert.equal(byId.pause.action, 'pause');
});

check('ids are unique and every button carries a glyph', () => {
  const ids = TOUCH_BUTTONS.map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const def of TOUCH_BUTTONS) assert.ok(def.glyph, `${def.id} has no glyph`);
});

console.log(`\ntouch selftest: ${checks} checks passed`);
