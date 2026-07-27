/**
 * Headless checks for the advanced graphics option schema.
 *
 *   node src/core/graphics.selftest.mjs
 *
 * The load-bearing one is INVARIANT 3: with no overrides set, folding the
 * schema over a config must leave `config.q` bit-identical to the shipped
 * preset. Every capture, every `tools/baseline.mjs` diff and every
 * `tools/goal.mjs` score depends on that being true, and it is the one thing a
 * new option can quietly break.
 */

import { QUALITY_PRESETS, createConfig } from './config.js';
import {
  GRAPHICS_AUTO,
  GRAPHICS_GROUPS,
  GRAPHICS_OPTIONS,
  GRAPHICS_OPTIONS_BY_ID,
  applyGraphicsOverrides,
  needsRestart,
  optionsInGroup,
  resolveOptionValue,
  sanitizeOverrides,
} from './graphics.js';

let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) return;
  failures++;
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
};
const section = (name) => console.log(`\n${name}`);

const TIERS = Object.keys(QUALITY_PRESETS);

/* ---------------------------------------------------------- 1. schema --- */
section('schema integrity');
{
  const seen = new Set();
  const groups = new Set(GRAPHICS_GROUPS.map((g) => g.id));
  for (const opt of GRAPHICS_OPTIONS) {
    check('unique id', !seen.has(opt.id), opt.id);
    seen.add(opt.id);
    check('has label', typeof opt.label === 'string' && opt.label.length > 0, opt.id);
    check('known group', groups.has(opt.group), `${opt.id} -> ${opt.group}`);
    check('by-id lookup', GRAPHICS_OPTIONS_BY_ID[opt.id] === opt, opt.id);

    if (opt.kind === 'enum') {
      check('enum has values', Array.isArray(opt.values) && opt.values.length > 1, opt.id);
      check('enum leads with auto', opt.values[0].value === GRAPHICS_AUTO, opt.id);
      check('enum has preset+apply', !!opt.preset && !!opt.apply, opt.id);
      const dupes = new Set();
      for (const v of opt.values) {
        check('enum value unique', !dupes.has(v.value), `${opt.id}:${String(v.value)}`);
        dupes.add(v.value);
        check('enum label', typeof v.label === 'string' && v.label.length > 0, opt.id);
      }
    } else if (opt.kind === 'slider') {
      check('slider range', opt.max > opt.min, opt.id);
      check('slider step', opt.step > 0, opt.id);
      check(
        'slider is writable',
        !!opt.renderSetting || (!!opt.apply && !!opt.preset),
        opt.id
      );
    } else {
      check('known kind', false, `${opt.id}: ${opt.kind}`);
    }
  }
  check(
    'every group has options',
    GRAPHICS_GROUPS.every((g) => optionsInGroup(g.id).length > 0)
  );
}

/* ------------------------------------------------------- 2. sanitize --- */
section('sanitizeOverrides');
{
  check('null is empty', Object.keys(sanitizeOverrides(null)).length === 0);
  check('unknown id dropped', sanitizeOverrides({ nope: 1 }).nope === undefined);
  check('auto dropped', sanitizeOverrides({ gtao: 'auto' }).gtao === undefined);
  check('bad enum dropped', sanitizeOverrides({ antialias: 'msaa' }).antialias === undefined);
  check('good enum kept', sanitizeOverrides({ antialias: 'fxaa' }).antialias === 'fxaa');
  check('bool enum kept', sanitizeOverrides({ gtao: false }).gtao === false);
  check('slider clamped high', sanitizeOverrides({ grain: 99 }).grain === 0.05);
  check('slider clamped low', sanitizeOverrides({ brightness: -99 }).brightness === -2);
  check('NaN dropped', sanitizeOverrides({ grain: 'x' }).grain === undefined);
  check(
    'string number coerced',
    sanitizeOverrides({ sharpen: '0.5' }).sharpen === 0.5
  );
}

/* ------------------------------------ 3. no overrides == shipped preset -- */
section('empty overrides are a no-op');
for (const tier of TIERS) {
  const before = JSON.stringify(createConfig({ quality: tier }).q);
  const cfg = createConfig({ quality: tier });
  const { applied } = applyGraphicsOverrides(cfg, {});
  check(`${tier}: nothing applied`, applied.length === 0);
  check(`${tier}: q untouched`, JSON.stringify(cfg.q) === before);
  check(`${tier}: no render patch`, Object.keys(cfg.renderSettings).length === 0);

  // ...and the same for junk that sanitize is expected to eat whole.
  const cfg2 = createConfig({ quality: tier });
  applyGraphicsOverrides(cfg2, { bogus: 3, antialias: 'msaa', gtao: 'auto' });
  check(`${tier}: junk ignored`, JSON.stringify(cfg2.q) === before);
}

/* ------------------------------------------- 4. enum apply round-trips --- */
section('enum apply/preset round-trip');
for (const tier of TIERS) {
  for (const opt of GRAPHICS_OPTIONS) {
    if (opt.kind !== 'enum') continue;
    for (const { value } of opt.values) {
      if (value === GRAPHICS_AUTO) continue;
      const cfg = createConfig({ quality: tier });
      applyGraphicsOverrides(cfg, { [opt.id]: value });
      const back = opt.preset(cfg.q, cfg);
      check(
        `${tier}/${opt.id}`,
        back === value,
        `applied ${String(value)}, preset() reads back ${String(back)}`
      );
    }
  }
}

/* --------------------------------------- 5. what needs a restart, does --- */
section('restart classification');
{
  check('renderScale is live', needsRestart('renderScale') === false);
  check('pixelRatioCap is live', needsRestart('pixelRatioCap') === false);
  check('brightness is live', needsRestart('brightness') === false);
  check('shadowLift is live', needsRestart('ambientFill') === false);
  check('fov is live', needsRestart('fovSlider') === false);
  check('antialias restarts', needsRestart('antialias') === true);
  check('textureScale restarts', needsRestart('textureScale') === true);
  check('shadowQuality restarts', needsRestart('shadowQuality') === true);
  check('gtao restarts', needsRestart('gtao') === true);
  check('unknown id', needsRestart('nope') === false);
  // Every slider is either backed by a live render setting or has its own live
  // hook — a slider you have to restart for is a slider nobody will drag.
  for (const opt of GRAPHICS_OPTIONS)
    if (opt.kind === 'slider') check(`slider ${opt.id} is live`, needsRestart(opt.id) === false);
}

/* -------------------------------------------- 6. render-setting routing -- */
section('render-setting routing');
{
  const cfg = createConfig({ quality: 'ultra' });
  applyGraphicsOverrides(cfg, { grain: 0, brightness: 0.5, sharpen: 0.4 });
  check('grain routed', cfg.renderSettings.grain === 0);
  check('sharpen routed', cfg.renderSettings.sharpen === 0.4);
  // Brightness is inverted on the way in: the renderer stores EV where positive
  // is DARKER, and no shipped brightness slider has ever worked that way.
  check('brightness inverted', cfg.renderSettings.exposureBias === -0.5);
  check('q not polluted', cfg.q.grain === undefined && cfg.q.brightness === undefined);
}

/* ------------------------------------------------ 7. resolveOptionValue -- */
section('resolveOptionValue');
{
  const q = createConfig({ quality: 'ultra' }).q;
  const gtao = GRAPHICS_OPTIONS_BY_ID.gtao;
  check(
    'override wins',
    resolveOptionValue(gtao, { overrides: { gtao: false }, q }).value === false
  );
  const fromPreset = resolveOptionValue(gtao, { overrides: {}, q });
  check('preset fallback', fromPreset.value === true && fromPreset.source === 'preset');

  // A live slider reads its "current" value off the renderer, never off a copy
  // of the renderer's defaults kept in this schema.
  const render = { settings: { grain: 0.011, exposureBias: -0.75 } };
  const grain = GRAPHICS_OPTIONS_BY_ID.grain;
  check('live read-back', resolveOptionValue(grain, { overrides: {}, q, render }).value === 0.011);
  const brightness = GRAPHICS_OPTIONS_BY_ID.brightness;
  check(
    'live read-back inverts',
    resolveOptionValue(brightness, { overrides: {}, q, render }).value === 0.75
  );
  check(
    'override beats renderer',
    resolveOptionValue(grain, { overrides: { grain: 0.03 }, q, render }).value === 0.03
  );
}

/* ------------------------------------------ 8. the settings that matter -- */
section('visibility settings reach the right places');
{
  // The three knobs the "I cannot see anyone" complaint is actually answered by.
  const cfg = createConfig({ quality: 'high' });
  applyGraphicsOverrides(cfg, {
    renderScale: 1.5,
    pixelRatioCap: 2,
    textureScale: 2,
    anisotropy: 16,
  });
  check('render scale pinned', cfg.q.renderScale === 1.5);
  check('scale ceiling widened', cfg.q.maxRenderScale >= 1.5);
  check('scaler locked out', cfg.q.lockRenderScale === true);
  check('dpr cap raised', cfg.q.pixelRatioCap === 2);
  check('world bake raised', cfg.q.textureScale === 2);
  check('aniso raised', cfg.q.anisotropy === 16);
}

console.log(
  failures === 0
    ? `\nOK — ${GRAPHICS_OPTIONS.length} options across ${GRAPHICS_GROUPS.length} groups`
    : `\n${failures} FAILURE(S)`
);
process.exit(failures === 0 ? 0 : 1);
