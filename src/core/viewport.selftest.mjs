#!/usr/bin/env node
/**
 * Viewport handling: how the engine reacts to the window changing size.
 *
 *   node src/core/viewport.selftest.mjs
 *
 * The behaviour under test is the COALESCING contract. A window drag delivers
 * one `resize` event per frame, and every one of them used to tear down and
 * rebuild the whole post chain — ~160 MB of render targets per megapixel, so
 * ~590 MB per event at 1440p and ~1.3 GB at 4K, synchronously on the main
 * thread. What must hold now:
 *
 *   1. a drag costs ONE reallocation, not one per event;
 *   2. `resize()` stays synchronous for `init()` and the capture harnesses;
 *   3. a spurious event at an unchanged size costs nothing at all;
 *   4. a devicePixelRatio change at a FIXED css size still counts as a change,
 *      because that is exactly the Retina-to-non-Retina window drag that used
 *      to leave the backbuffer wrong for the rest of the session.
 */

import assert from 'node:assert/strict';
import { Engine } from './engine.js';
import { createConfig } from './config.js';

let checks = 0;
const check = (name, fn) => {
  fn();
  checks++;
  console.log(`  ok  ${name}`);
};

/**
 * The engine touches `addEventListener`, `matchMedia` and `devicePixelRatio` on
 * the global. Node has none of them, and installing real ones is the point:
 * these tests drive the listener the engine actually registers.
 */
function harness({ width = 1920, height = 1080, dpr = 1 } = {}) {
  const listeners = new Map();
  const mediaListeners = new Set();
  const canvas = {
    clientWidth: width,
    clientHeight: height,
    addEventListener() {},
    removeEventListener() {},
    getContext: () => null,
    style: {},
  };

  globalThis.addEventListener = (type, fn) => {
    (listeners.get(type) ?? listeners.set(type, new Set()).get(type)).add(fn);
  };
  globalThis.removeEventListener = (type, fn) => listeners.get(type)?.delete(fn);
  globalThis.matchMedia = () => ({
    addEventListener: (_t, fn) => mediaListeners.add(fn),
    removeEventListener: (_t, fn) => mediaListeners.delete(fn),
  });
  Object.defineProperty(globalThis, 'devicePixelRatio', { value: dpr, configurable: true });
  globalThis.innerWidth = width;
  globalThis.innerHeight = height;
  // `Engine.dispose()` detaches input, which reaches for the document.
  globalThis.document ??= { addEventListener() {}, removeEventListener() {}, body: { classList: { add() {}, remove() {} } } };

  const engine = new Engine({ canvas, config: createConfig({ deterministic: true }) });

  // A subsystem that only counts how many times it is told the size changed.
  const resizes = [];
  engine.registry.add({
    constructor: { id: 'probe' },
    resize: (w, h) => resizes.push(`${w}x${h}`),
  });

  // Stand in for Engine.init() without booting any real subsystem: register the
  // same listeners it registers, then apply the initial size synchronously.
  globalThis.addEventListener('resize', engine._onResize);
  engine._watchPixelRatio();
  engine.resize();

  return {
    engine,
    resizes,
    fire: (w, h) => {
      canvas.clientWidth = w;
      canvas.clientHeight = h;
      for (const fn of listeners.get('resize') ?? []) fn();
    },
    setDpr: (v) => Object.defineProperty(globalThis, 'devicePixelRatio', {
      value: v,
      configurable: true,
    }),
    dprChange: () => {
      for (const fn of [...mediaListeners]) fn();
    },
    /** Pump one frame at `nowMs`, which is what settles a pending resize. */
    step: (nowMs) => engine.step(nowMs),
    /**
     * Pump frames until the quiet window has elapsed. Two are needed by
     * construction: the first records "the window was still moving at t", the
     * second finds it has been still for long enough.
     */
    settle: (nowMs = 1e6) => {
      engine.step(nowMs);
      engine.step(nowMs + engine._resizeQuietMs + 1);
    },
    listenerCount: (type) => listeners.get(type)?.size ?? 0,
    mediaCount: () => mediaListeners.size,
  };
}

check('the initial size is applied synchronously, before any frame runs', () => {
  const h = harness({ width: 1600, height: 900 });
  assert.deepEqual(h.resizes, ['1600x900']);
  assert.equal(h.engine.camera.aspect, 1600 / 900);
});

check('a resize event does not reallocate until the drag settles', () => {
  const h = harness();
  h.resizes.length = 0;

  h.fire(1500, 844);
  assert.deepEqual(h.resizes, [], 'the event alone must not resize');

  // Still inside the quiet window: the frame renders at the old size and the
  // browser scales it, which is a uniform stretch and not a geometry error.
  h.step(50);
  assert.deepEqual(h.resizes, []);

  h.settle(300);
  assert.deepEqual(h.resizes, ['1500x844']);
});

check('a 60-event drag costs one reallocation, not sixty', () => {
  const h = harness();
  h.resizes.length = 0;

  // One event per frame for a second, each at a different size, with a frame
  // pumped in between — the real shape of a window drag.
  for (let i = 0; i < 60; i++) {
    h.fire(1200 + i * 8, Math.round((1200 + i * 8) * 0.5625));
    h.step(i * 16.7);
  }
  assert.deepEqual(h.resizes, [], 'nothing settles while the drag is still moving');

  h.settle(60 * 16.7 + 200);
  assert.deepEqual(h.resizes, ['1672x941'], 'exactly one reallocation, at the final size');
});

check('an unchanged size is free even when the event fires', () => {
  const h = harness({ width: 1920, height: 1080 });
  h.resizes.length = 0;
  h.fire(1920, 1080);
  h.settle();
  assert.deepEqual(h.resizes, [], 'same size, same dpr: nothing to do');
});

check('a devicePixelRatio change at a fixed css size is still a change', () => {
  const h = harness({ width: 1920, height: 1080, dpr: 1 });
  h.resizes.length = 0;

  // Dragging a window from a Retina panel to a non-Retina one: the css box is
  // identical, so the size guard alone would swallow it and the backbuffer
  // would keep the wrong pixel ratio for the rest of the session.
  h.setDpr(2);
  h.dprChange();
  h.settle();
  assert.deepEqual(h.resizes, ['1920x1080'], 'the dpr move must reach the renderer');
});

check('the dpr media query is re-armed against the new ratio', () => {
  const h = harness({ dpr: 1 });
  assert.equal(h.mediaCount(), 1);
  h.setDpr(2);
  h.dprChange();
  // A `resolution` query only fires on leaving the value it was built with, so a
  // handler that does not re-arm fires exactly once per session.
  assert.equal(h.mediaCount(), 1, 'still exactly one live listener, on the new value');
  h.setDpr(3);
  h.dprChange();
  h.settle();
  assert.equal(h.engine._lastDpr, 3, 'the second move lands too');
});

check('dispose releases both the window and the media listener', () => {
  const h = harness();
  h.engine.dispose();
  assert.equal(h.listenerCount('resize'), 0);
  assert.equal(h.mediaCount(), 0);
});

check('a zero-size canvas never produces a zero-size viewport', () => {
  const h = harness();
  h.resizes.length = 0;
  h.fire(0, 0);
  h.settle();
  // Falls back to the window, and the window is clamped to at least 1px, so no
  // subsystem is ever handed a dimension it would divide by.
  for (const size of h.resizes) {
    const [w, hh] = size.split('x').map(Number);
    assert.ok(w >= 1 && hh >= 1, `degenerate size ${size}`);
  }
  assert.ok(Number.isFinite(h.engine.camera.aspect) && h.engine.camera.aspect > 0);
});

console.log(`\n${checks} viewport checks passed`);
