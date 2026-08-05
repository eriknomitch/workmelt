import { FONT_STACK, FONT_DISPLAY, FONT_MONO } from './util.js';

/**
 * All HUD styling lives here as one injected stylesheet.
 *
 * Design system
 * -------------
 *  scale     every dimension is `calc(N * var(--k))` where --k is set from the
 *            viewport height (1080p == 1.0). The HUD therefore holds its
 *            proportions from 720p to 4K without re-authoring.
 *  spacing   4px grid: --u. Screen margins are 6u (24px @1080p), the same
 *            margin CoD uses (~2.2% of height).
 *  type      one condensed system stack, uppercase, tabular figures, three
 *            ink levels (94% / 58% / 30%) and one accent per semantic:
 *            amber = caution, red = threat, cyan = friendly/objective.
 *  contrast  every text run carries a two-stop shadow (tight dark + wide
 *            dark bloom) so it survives a blown-out sky *and* a black
 *            interior without a scrim behind it.
 */

const CSS = `
.ow-hud, .ow-hud * { margin:0; padding:0; box-sizing:border-box; }

.ow-hud {
  --k: 1;
  --u: calc(4px * var(--k));
  --pad: calc(var(--u) * 6.5);

  --ink:   rgba(238,244,247,.95);
  --ink-2: rgba(214,227,234,.60);
  --ink-3: rgba(196,210,219,.30);
  --hair:  rgba(255,255,255,.15);
  --hair-2:rgba(255,255,255,.07);

  --amber: #ffb02a;
  --red:   #ff3f31;
  --blood: #8d0f0a;
  --cyan:  #79d2ff;
  --friend:#8fc8ff;
  --enemy: #ff7a63;
  --ok:    #a8e86a;

  --sh: 0 1px 2px rgba(0,0,0,.92), 0 0 calc(10px * var(--k)) rgba(0,0,0,.45);
  --sh-hard: 0 1px 1px rgba(0,0,0,.95);

  /* Symmetric synthesized outlines. An offset drop-shadow is a web-overlay
     tell and it fights whatever direction the scene key light comes from; a
     ring of eight equal-radius hard shadows reads as a drawn outline and is
     direction-free. Each is paired with one tight soft shadow for the seat. */
  --oc: #080c10;
  --o1:
    calc(1.5px * var(--k)) 0 0 var(--oc), calc(-1.5px * var(--k)) 0 0 var(--oc),
    0 calc(1.5px * var(--k)) 0 var(--oc), 0 calc(-1.5px * var(--k)) 0 var(--oc),
    calc(1.1px * var(--k)) calc(1.1px * var(--k)) 0 var(--oc),
    calc(-1.1px * var(--k)) calc(1.1px * var(--k)) 0 var(--oc),
    calc(1.1px * var(--k)) calc(-1.1px * var(--k)) 0 var(--oc),
    calc(-1.1px * var(--k)) calc(-1.1px * var(--k)) 0 var(--oc);
  --o2:
    calc(2px * var(--k)) 0 0 var(--oc), calc(-2px * var(--k)) 0 0 var(--oc),
    0 calc(2px * var(--k)) 0 var(--oc), 0 calc(-2px * var(--k)) 0 var(--oc),
    calc(1.45px * var(--k)) calc(1.45px * var(--k)) 0 var(--oc),
    calc(-1.45px * var(--k)) calc(1.45px * var(--k)) 0 var(--oc),
    calc(1.45px * var(--k)) calc(-1.45px * var(--k)) 0 var(--oc),
    calc(-1.45px * var(--k)) calc(-1.45px * var(--k)) 0 var(--oc);
  /* outline + tight soft seat, no directional offset */
  --sh-o1: var(--o1), 0 0 calc(4px * var(--k)) rgba(3,6,9,.8);
  --sh-o2: var(--o2), 0 0 calc(5px * var(--k)) rgba(3,6,9,.85);

  --ff: ${FONT_STACK};
  --fd: ${FONT_DISPLAY};
  --fm: ${FONT_MONO};

  position: fixed; inset: 0;
  pointer-events: none;
  z-index: 10;
  font-family: var(--ff);
  font-weight: 600;
  color: var(--ink);
  letter-spacing: .06em;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1, "lnum" 1;
  -webkit-font-smoothing: antialiased;
  text-transform: uppercase;
  overflow: hidden;
  contain: layout style;
  user-select: none;
}

.ow-hud .lbl {
  font-size: calc(10.5px * var(--k));
  letter-spacing: .2em;
  color: var(--ink-2);
  text-shadow: var(--sh);
}
.ow-layer { position:absolute; inset:0; }

/* ============================================================== crosshair */
.ow-cross { position:absolute; left:50%; top:50%; width:0; height:0; }
.ow-blade {
  position:absolute; left:0; top:0;
  width: calc(1.6px * var(--k));
  height: calc(8px * var(--k));
  margin-left: calc(-0.8px * var(--k));
  margin-top: calc(-4px * var(--k));
  background: linear-gradient(to top, rgba(255,255,255,.62), #fff 62%);
  box-shadow: 0 0 0 1px rgba(0,0,0,.55), 0 0 calc(3px * var(--k)) rgba(0,0,0,.75);
  transform-origin: 50% 50%;
  will-change: transform, opacity;
}
.ow-dot {
  position:absolute; left:0; top:0;
  width: calc(2.2px * var(--k)); height: calc(2.2px * var(--k));
  margin-left: calc(-1.1px * var(--k)); margin-top: calc(-1.1px * var(--k));
  background:#fff; border-radius:50%;
  box-shadow: 0 0 0 1px rgba(0,0,0,.6), 0 0 calc(4px * var(--k)) rgba(0,0,0,.7);
  will-change: opacity, transform;
}
/* thin lower "shotgun" reference tick — reads as a real reticle, not a plus */
.ow-cross-ads { position:absolute; left:0; top:0; }

/* ============================================================ hitmarkers */
.ow-hit {
  position:absolute; left:50%; top:50%;
  width: calc(56px * var(--k)); height: calc(56px * var(--k));
  margin-left: calc(-28px * var(--k)); margin-top: calc(-28px * var(--k));
  will-change: transform, opacity;
}
.ow-hit svg { width:100%; height:100%; display:block; overflow:visible; }

/* =============================================== directional damage arcs */
.ow-dmg {
  position:absolute; left:50%; top:50%;
  width: calc(340px * var(--k)); height: calc(340px * var(--k));
  margin-left: calc(-170px * var(--k)); margin-top: calc(-170px * var(--k));
  will-change: transform, opacity;
}
.ow-dmg svg { width:100%; height:100%; display:block; overflow:visible; }

/* ============================================================ hurt state */
.ow-blood { position:absolute; inset:-7%; will-change: opacity, transform; }
.ow-blood-a {
  position:absolute; inset:0;
  background:
    radial-gradient(ellipse 78% 74% at 50% 50%, rgba(0,0,0,0) 62%, rgba(122,14,10,.30) 86%, rgba(74,8,5,.60) 100%);
  filter: url(#ow-warp);
}
.ow-blood-b {
  position:absolute; inset:0; opacity:.5; mix-blend-mode:multiply;
  background:
    radial-gradient(circle at 2% 22%,  rgba(96,10,8,.75) 0, rgba(96,10,8,0) 17%),
    radial-gradient(circle at 99% 58%, rgba(96,10,8,.7) 0, rgba(96,10,8,0) 15%),
    radial-gradient(circle at 26% 101%,rgba(88,10,8,.75) 0, rgba(88,10,8,0) 19%),
    radial-gradient(circle at 74% -2%, rgba(88,10,8,.7) 0, rgba(88,10,8,0) 18%);
  filter: url(#ow-warp);
}
.ow-desat { position:absolute; inset:0; backdrop-filter: saturate(.6) contrast(1.04) brightness(.97); }
.ow-hitflash { position:absolute; inset:0;
  background: radial-gradient(ellipse 90% 86% at 50% 50%, rgba(150,16,10,.22) 40%, rgba(160,18,12,.62) 100%);
  mix-blend-mode:screen; }
.ow-lowbeat {
  position:absolute; inset:0;
  background: radial-gradient(ellipse 76% 70% at 50% 50%, rgba(0,0,0,0) 64%, rgba(150,14,10,.34) 100%);
}

/* ========================================================= flashbang whiteout
   Sits ABOVE the HUD, unlike the hurt overlays, because a stun has to take the
   ammo counter and minimap with it. Three stacked stages driven from flash.js:
   a hard bloom, a lingering bleach that lifts the black point rather than
   simply whitening, and a burned-in afterimage placed at the blast. */
.ow-flash { position:absolute; inset:0; pointer-events:none; }
.ow-flash-bloom { position:absolute; inset:0; opacity:0; background:#fffdf6; }
.ow-flash-bleach {
  position:absolute; inset:0; opacity:0;
  background: rgba(255,251,238,.55);
  backdrop-filter: saturate(.35) brightness(1.55) contrast(.72) blur(1.5px);
}
.ow-flash-ghost { position:absolute; inset:0; opacity:0; mix-blend-mode:screen; }

/* ====================================================== vitals (bottom left)
   The most important number on the screen, so it gets the mirror position to
   the ammo block: bottom-left of the safe area, labelled, with a numeric
   readout and a genuinely dark track so the empty part of the bar is legible
   over sunlit gravel. Armour is a visually distinct second row — thinner,
   cyan, plate-segmented — so it can never be mistaken for health. */
.ow-vitals {
  position:absolute; left:var(--pad); bottom:var(--pad);
  width: calc(196px * var(--k));
}
.ow-vt-head {
  display:flex; align-items:baseline; justify-content:space-between;
  margin-bottom: calc(var(--u) * 1.1);
}
.ow-vt-lbl {
  font-size: calc(9.5px * var(--k)); letter-spacing:.24em; color: var(--ink-2);
  text-shadow: var(--sh-o1);
}
.ow-vt-num {
  font-family: var(--fd); font-size: calc(26px * var(--k)); font-weight:700;
  letter-spacing:.02em; line-height:.85; color: var(--ink);
  text-shadow: var(--o2), 0 0 calc(12px * var(--k)) rgba(0,0,0,.5);
  will-change: color, transform;
}
.ow-vt-num i {
  font-style:normal; font-family: var(--ff); font-size: calc(11px * var(--k));
  color: var(--ink-3); letter-spacing:.1em; margin-left: calc(2px * var(--k));
}
/* health track: dark well + hairline, five 20 HP segments */
.ow-vt-track {
  position:relative; height: calc(9px * var(--k));
  background: rgba(5,9,12,.72);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.55), 0 0 0 1px rgba(216,232,240,.16),
              0 calc(1px * var(--k)) calc(4px * var(--k)) rgba(0,0,0,.5);
  overflow:hidden;
}
.ow-vt-track > i {
  position:absolute; left:0; top:0; bottom:0; width:100%;
  transform-origin:left center;
  background: linear-gradient(to bottom, #fbfdfc 0%, #e1e7e4 46%, #b3bcb9 100%);
  will-change: transform;
}
.ow-vt-track > u {
  position:absolute; left:0; right:0; top:0; bottom:0;
  background-image: repeating-linear-gradient(to right,
    rgba(0,0,0,0) 0, rgba(0,0,0,0) calc(20% - 1px),
    rgba(4,8,11,.85) calc(20% - 1px), rgba(4,8,11,.85) 20%);
}
.ow-vitals.low .ow-vt-track > i { background: linear-gradient(to bottom, #ffd98a, #f2a01c); }
.ow-vitals.low .ow-vt-num { color: var(--amber); }
.ow-vitals.crit .ow-vt-track > i { background: linear-gradient(to bottom, #ff8b7a, #e02414); }
.ow-vitals.crit .ow-vt-num { color: var(--red); }

/* armour: thinner, cyan, plate-segmented, its own label */
.ow-armour {
  display:flex; align-items:center; gap: calc(var(--u) * 1.4);
  margin-top: calc(var(--u) * 1.5);
}
.ow-armour .ow-vt-lbl { color: rgba(150,206,238,.7); }
.ow-arm-plates { display:flex; gap: calc(var(--u) * .8); flex:1; }
.ow-plate {
  flex:1; height: calc(5px * var(--k));
  background: rgba(5,9,12,.7);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,.5), 0 0 0 1px rgba(121,190,230,.18);
  position:relative; overflow:hidden;
}
.ow-plate i {
  position:absolute; left:0; top:0; bottom:0; width:100%;
  background: linear-gradient(to bottom, #bde9ff, #3ba6e2);
  transform-origin: left center;
}

/* ================================================================== ammo
   The whole block is ONE column of fixed width (--ammo-w) pinned to the right
   margin, so every row shares the same left edge and no row can ever grow
   sideways into another. Rows are explicit grids with an 8px gutter; the
   equipment counts get their own row above the weapon name rather than sharing
   the head row, which is what used to collide. */
.ow-ammo {
  position:absolute; right:var(--pad); bottom:var(--pad);
  --ammo-w: calc(168px * var(--k));
  --gut: calc(8px * var(--k));
  width: var(--ammo-w);
  text-align:right; line-height:1;
}
.ow-ammo-head {
  display:grid; grid-auto-flow:column; grid-auto-columns:max-content;
  justify-content:end; align-items:center;
  column-gap: var(--gut); margin-bottom:calc(var(--u) * 1.1);
}
.ow-ammo-name {
  font-size: calc(12.5px * var(--k)); letter-spacing:.22em;
  color: var(--ink); text-shadow: var(--sh-o1);
  white-space:nowrap; overflow:hidden; text-overflow:clip;
  max-width: calc(var(--ammo-w) - 52px * var(--k));
}
.ow-ammo-mode {
  font-size: calc(9.5px * var(--k)); letter-spacing:.2em; color: var(--ink-2);
  border:1px solid var(--hair); padding: calc(1.5px * var(--k)) calc(4px * var(--k));
  background: rgba(6,10,13,.34);
  text-shadow: var(--sh-hard); white-space:nowrap;
}
.ow-ammo-row {
  display:grid; grid-auto-flow:column; grid-auto-columns:max-content;
  justify-content:end; align-items:baseline;
  column-gap: calc(var(--gut) * .55);
}
.ow-ammo-cur {
  font-family: var(--fd);
  font-size: calc(56px * var(--k)); font-weight:700; letter-spacing:.02em;
  color: var(--ink); text-shadow: var(--o2), 0 0 calc(16px * var(--k)) rgba(0,0,0,.55);
  will-change: color, transform;
}
.ow-ammo-sep { font-size: calc(20px * var(--k)); color: var(--ink-3); font-weight:400;
  text-shadow: var(--sh-o1); }
.ow-ammo-res { font-family: var(--fd); font-size: calc(24px * var(--k)); color: var(--ink-2);
  text-shadow: var(--sh-o1); }
.ow-ammo-low .ow-ammo-cur { color: var(--amber); }
.ow-ammo-empty .ow-ammo-cur { color: var(--red); }

.ow-mag {
  display:flex; justify-content:flex-end; gap: calc(1.6px * var(--k));
  margin-top: calc(var(--u) * 1.1);
}
.ow-mag b {
  display:block; width: calc(2.6px * var(--k)); height: calc(10px * var(--k));
  background: var(--ink); box-shadow: 0 0 0 1px rgba(4,8,11,.75);
}
/* spent rounds read as an empty *socket*, not a pale ghost: a dark well is the
   only thing that survives gravel at this size */
.ow-mag b.off { background: rgba(6,10,13,.62); box-shadow: 0 0 0 1px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.07); }
.ow-mag b.warn { background: var(--amber); }

.ow-reload {
  margin-top: calc(var(--u) * 1.6);
  font-size: calc(10.5px * var(--k)); letter-spacing:.28em; color: var(--amber);
  text-shadow: var(--sh-o1);
}
.ow-reload-bar {
  margin-top: calc(var(--u) * .8); margin-left:auto; margin-right:0;
  width: calc(86px * var(--k)); height: calc(2.5px * var(--k));
  background: rgba(6,10,13,.7); box-shadow: 0 0 0 1px rgba(0,0,0,.4);
}
.ow-reload-bar i { display:block; height:100%; width:0; background: var(--amber); transform-origin:left; }

/* equipment: its own row, in flow, above the weapon name */
.ow-equip {
  display:grid; grid-auto-flow:column; grid-auto-columns:max-content;
  justify-content:end; align-items:center;
  column-gap: calc(var(--gut) * 2); margin-bottom: calc(var(--u) * 1.4);
}
.ow-slot {
  display:grid; grid-auto-flow:column; grid-auto-columns:max-content;
  align-items:center; column-gap: var(--gut); opacity:.9;
}
.ow-slot svg { width: calc(13px * var(--k)); height: calc(16.5px * var(--k)); display:block;
  filter: drop-shadow(0 0 calc(2px * var(--k)) rgba(0,0,0,.95)); }
.ow-slot span { font-size: calc(11px * var(--k)); color: var(--ink-2); text-shadow: var(--sh-o1);
  min-width: calc(7px * var(--k)); text-align:left; }
.ow-slot.empty { opacity:.34; }

/* ============================================================== killfeed */
.ow-killfeed {
  position:absolute; right:var(--pad); top:calc(var(--pad) + var(--u) * 2);
  display:flex; flex-direction:column; align-items:flex-end;
  gap: calc(var(--u) * 1.1);
}
/* Rows sit in the top right, which in daylight is sky: the scrim has to be
   dark and dense enough to matter (58%), feathered only at the far end so it
   dissolves instead of terminating in a rectangle. */
.ow-kf-row {
  position:relative;
  display:flex; align-items:center; gap: calc(var(--u) * 1.6);
  font-size: calc(13.5px * var(--k)); letter-spacing:.09em;
  padding: calc(var(--u) * .8) calc(var(--u) * 1.5);
  border-right: calc(2px * var(--k)) solid rgba(255,255,255,.18);
  text-shadow: var(--sh-o1);
  will-change: transform, opacity;
}
.ow-kf-row::before {
  content:''; position:absolute; inset:0; z-index:-1;
  background: rgba(5,9,12,.58);
  -webkit-mask-image: linear-gradient(to right, rgba(0,0,0,0) 0%, #000 22%, #000 100%);
          mask-image: linear-gradient(to right, rgba(0,0,0,0) 0%, #000 22%, #000 100%);
}
.ow-kf-row.mine::before { background: rgba(26,17,3,.66); }
.ow-kf-row.mine { border-right-color: var(--amber); }
.ow-kf-a { color: var(--friend); }
.ow-kf-v { color: var(--enemy); }
.ow-kf-row.mine .ow-kf-a { color: #fff; }
.ow-kf-w { display:flex; align-items:center; gap:calc(var(--u) * .8); opacity:.9; }
.ow-kf-w svg { width: calc(31px * var(--k)); height: calc(12px * var(--k)); display:block;
  filter: drop-shadow(0 1px 1px rgba(0,0,0,.9)); }
.ow-kf-hs svg { width: calc(12px * var(--k)); height: calc(12px * var(--k)); display:block;
  filter: drop-shadow(0 1px 1px rgba(0,0,0,.9)); }

/* =============================================================== compass */
.ow-compass {
  position:absolute; left:50%; top:calc(var(--pad) * .7);
  width: calc(470px * var(--k)); height: calc(41px * var(--k));
  transform: translateX(-50%);
  -webkit-mask-image: linear-gradient(to right, transparent, #000 16%, #000 84%, transparent);
          mask-image: linear-gradient(to right, transparent, #000 16%, #000 84%, transparent);
  overflow:hidden;
}
/* Scrim: 45% dark behind the tape, feathered horizontally over the outer 20%
   at each end so it dissolves rather than terminating in a rectangle, and
   rolled off at the very top and bottom edge. The previous 23-29% version was
   too weak to do anything at all against blown cloud — grey cardinals on white
   sky, unreadable. The glyphs additionally carry a symmetric dark outline. */
.ow-compass::before {
  content:''; position:absolute; inset:0;
  background: linear-gradient(to bottom,
    rgba(3,6,9,0) 0%, rgba(3,6,9,.45) 20%, rgba(3,6,9,.45) 66%,
    rgba(3,6,9,.20) 88%, rgba(3,6,9,0) 100%);
  -webkit-mask-image: linear-gradient(to right, rgba(0,0,0,0) 0%, #000 20%, #000 80%, rgba(0,0,0,0) 100%);
          mask-image: linear-gradient(to right, rgba(0,0,0,0) 0%, #000 20%, #000 80%, rgba(0,0,0,0) 100%);
}
/* NO will-change:transform HERE — deliberate, do not "optimise" it back.
   It promoted the strip to its own composited layer, and a composited layer is
   rasterised ONCE at whatever sub-pixel raster translation its transform happened
   to have at the moment the compositor first rastered it; later transform changes
   only move the cached texture. That moment is wall-clock bound, so the anti-
   aliasing of all 144 ticks and the cardinal labels depended on how long boot took
   — the single remaining reason enabling shader pre-warm shifted pixels after the
   capture harness was made frame-deterministic (~0.06% of pixels, up to 70/255,
   confined to this strip). Unpromoted, the strip is repainted from its current
   transform every frame, which is a pure function of heading. The paint is a
   470x41 css-px band; the hint was not buying anything measurable. */
.ow-compass-strip { position:absolute; left:0; top:0; height:100%; }
.ow-tick {
  position:absolute; top: calc(19px * var(--k));
  width:1px; background: rgba(255,255,255,.7);
  height: calc(4px * var(--k));
  box-shadow: 0 0 0 1px rgba(4,8,11,.6), 0 0 calc(2px * var(--k)) rgba(0,0,0,.9);
}
.ow-tick.maj { height: calc(7.5px * var(--k)); width: calc(1.5px * var(--k)); background: rgba(255,255,255,.95); }
.ow-tick-l {
  position:absolute; top: calc(1px * var(--k)); transform: translateX(-50%);
  font-size: calc(13.5px * var(--k)); letter-spacing:.1em; font-weight:700;
  color: #fff; text-shadow: var(--sh-o1);
}
.ow-tick-l.sub { font-size: calc(10px * var(--k)); font-weight:700; color: rgba(233,243,249,.9);
  top: calc(3.5px * var(--k)); }
.ow-compass-base {
  position:absolute; left:0; right:0; top: calc(18px * var(--k)); height:1px;
  background: linear-gradient(to right, transparent, rgba(255,255,255,.4), transparent);
  box-shadow: 0 1px 0 rgba(4,8,11,.5);
}
.ow-compass-caret {
  position:absolute; left:50%; top:calc(12.5px * var(--k)); transform:translateX(-50%);
  width:0; height:0;
  border-left: calc(4.5px * var(--k)) solid transparent;
  border-right: calc(4.5px * var(--k)) solid transparent;
  border-top: calc(5.5px * var(--k)) solid var(--amber);
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.95));
}
.ow-compass-obj {
  position:absolute; top: calc(28px * var(--k)); transform:translateX(-50%);
  font-size: calc(9.5px * var(--k)); letter-spacing:.06em;
  width: calc(13px * var(--k)); height: calc(13px * var(--k));
  display:flex; align-items:center; justify-content:center;
  color:#08161c; background: var(--cyan);
  box-shadow: 0 1px 2px rgba(0,0,0,.8);
  will-change: transform;
}

/* ============================================================= match bar */
.ow-match {
  position:absolute; left:50%; top:calc(var(--pad) * .7 + 45px * var(--k));
  transform: translateX(-50%);
  display:flex; align-items:center; gap: calc(var(--u) * 2.5);
  font-size: calc(11px * var(--k)); letter-spacing:.18em;
  color: var(--ink-2); text-shadow: var(--sh-o1);
}
.ow-match b { font-family: var(--fd); font-size: calc(19px * var(--k)); font-weight:700;
  letter-spacing:.04em; }
.ow-match .us { color: var(--friend); }
.ow-match .them { color: var(--enemy); }
.ow-match .clock { color: var(--ink); font-variant-numeric: tabular-nums; }
.ow-match .sep { width:1px; height: calc(11px * var(--k)); background: var(--hair); }

/* =============================================================== minimap */
.ow-minimap {
  position:absolute; left:var(--pad); top:var(--pad);
  width: calc(178px * var(--k)); height: calc(178px * var(--k));
}
/* scrim — a soft dark plate a few px larger than the widget so the map sits on
   the frame instead of floating on top of it. Behind the canvas, so it only
   reads in the margin, under the corner brackets and the N / zone labels. */
.ow-minimap::before {
  content:''; position:absolute;
  inset: calc(-7px * var(--k));
  border-radius: calc(10px * var(--k));
  background: rgba(4,8,11,.07);
  box-shadow: 0 0 calc(16px * var(--k)) calc(6px * var(--k)) rgba(4,8,11,.05);
  pointer-events:none;
}
/* The panel used to be the darkest thing in a frame whose sky tops out at 236,
   which pulled the eye straight into the corner. Its plate now sits in the
   mid-lows (see minimap.js) and the drop shadow is lighter to match. */
.ow-minimap canvas {
  position:absolute; inset:0; width:100%; height:100%; display:block;
  border-radius: calc(4px * var(--k));
  box-shadow: inset 0 0 0 1px rgba(196,220,238,.16), 0 calc(2px * var(--k)) calc(10px * var(--k)) rgba(0,0,0,.3);
}
.ow-mm-corner { position:absolute; width:calc(9px * var(--k)); height:calc(9px * var(--k)); }
.ow-mm-corner::before, .ow-mm-corner::after { content:''; position:absolute; background:rgba(255,255,255,.32); }
.ow-mm-corner::before { width:100%; height:1px; }
.ow-mm-corner::after { width:1px; height:100%; }
.ow-mm-corner.tl { left:calc(-1px * var(--k)); top:calc(-1px * var(--k)); }
.ow-mm-corner.tr { right:calc(-1px * var(--k)); top:calc(-1px * var(--k)); }
.ow-mm-corner.tr::before { right:0; } .ow-mm-corner.tr::after { right:0; }
.ow-mm-corner.bl { left:calc(-1px * var(--k)); bottom:calc(-1px * var(--k)); }
.ow-mm-corner.bl::before { bottom:0; }
.ow-mm-corner.br { right:calc(-1px * var(--k)); bottom:calc(-1px * var(--k)); }
.ow-mm-corner.br::before { bottom:0; right:0; } .ow-mm-corner.br::after { right:0; }
.ow-mm-n {
  position:absolute; left:50%; top:calc(-13px * var(--k)); transform:translateX(-50%);
  font-size: calc(9.5px * var(--k)); letter-spacing:.2em; color:var(--ink-2); text-shadow:var(--sh);
}
.ow-mm-tag {
  position:absolute; left:0; top:calc(100% + var(--u)); display:flex; gap:calc(var(--u)*1.5);
  font-size: calc(9.5px * var(--k)); letter-spacing:.2em; color:var(--ink-3); text-shadow:var(--sh);
}

/* ========================================================= world markers */
.ow-mk {
  position:absolute; left:0; top:0;
  display:flex; flex-direction:column; align-items:center;
  will-change: transform, opacity;
}
.ow-mk-glyph { position:relative; width:calc(16px * var(--k)); height:calc(16px * var(--k)); }
.ow-mk-glyph svg { position:absolute; inset:0; width:100%; height:100%; display:block; overflow:visible;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,.85)); }
.ow-mk-letter {
  position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  font-size: calc(9.5px * var(--k)); color:#08161c; font-weight:700;
}
.ow-mk-dist {
  margin-top: calc(var(--u) * .6);
  font-size: calc(10px * var(--k)); letter-spacing:.12em; color: var(--ink);
  text-shadow: var(--sh);
}
.ow-mk-name { font-size: calc(9px * var(--k)); letter-spacing:.18em; color: var(--ink-2); text-shadow:var(--sh); }
.ow-mk.threat .ow-mk-dist { color: var(--red); }

/* grenade danger */
.ow-nade { position:absolute; left:0; top:0; will-change: transform, opacity; }
.ow-nade-ring {
  position:absolute; left:50%; top:50%; width:calc(30px * var(--k)); height:calc(30px * var(--k));
  margin:calc(-15px * var(--k)) 0 0 calc(-15px * var(--k));
  border: calc(1.5px * var(--k)) solid var(--red); border-radius:50%;
  will-change: transform, opacity;
}
.ow-nade-core {
  position:absolute; left:50%; top:50%; width:calc(15px * var(--k)); height:calc(15px * var(--k));
  margin:calc(-7.5px * var(--k)) 0 0 calc(-7.5px * var(--k));
}
.ow-nade-core svg { width:100%; height:100%; display:block; filter:drop-shadow(0 1px 2px rgba(0,0,0,.9)); }
.ow-nade-label {
  position:absolute; left:50%; top:calc(13px * var(--k)); transform:translateX(-50%);
  font-size: calc(9px * var(--k)); letter-spacing:.24em; color:var(--red); white-space:nowrap;
  text-shadow: var(--sh);
}

/* ======================================================== damage numbers */
.ow-dn {
  position:absolute; left:0; top:0; font-family: var(--fd);
  font-size: calc(17px * var(--k)); font-weight:700; letter-spacing:.03em;
  color: var(--ink); text-shadow: 0 1px 2px rgba(0,0,0,.95), 0 0 calc(8px * var(--k)) rgba(0,0,0,.6);
  will-change: transform, opacity;
}
.ow-dn.hs   { color: var(--amber); font-size: calc(21px * var(--k)); }
.ow-dn.kill { color: var(--red);   font-size: calc(23px * var(--k)); }
.ow-dn.armour { color: var(--cyan); }

/* ================================================================ prompt */
.ow-prompt {
  position:absolute; left:50%; top:58%;
  transform: translate(-50%,-50%);
  display:flex; align-items:center; gap: calc(var(--u) * 2);
  will-change: opacity, transform;
}
.ow-key {
  min-width: calc(22px * var(--k)); height: calc(22px * var(--k));
  padding: 0 calc(var(--u) * 1.2);
  display:flex; align-items:center; justify-content:center;
  font-size: calc(11px * var(--k)); letter-spacing:.06em;
  border: 1px solid rgba(255,255,255,.55); border-radius: calc(2px * var(--k));
  background: rgba(8,11,14,.42);
  box-shadow: 0 1px 3px rgba(0,0,0,.7), inset 0 1px 0 rgba(255,255,255,.14);
  text-shadow: var(--sh-hard);
}
.ow-prompt-txt { font-size: calc(12px * var(--k)); letter-spacing:.2em; text-shadow: var(--sh); }
.ow-prompt-sub { font-size: calc(9.5px * var(--k)); letter-spacing:.2em; color:var(--ink-2); }
.ow-prompt-arc { position:absolute; left:calc(-6px * var(--k)); top:50%; }

/* =========================================================== reload hint */
/* Low-magazine nudge under the sight line: keycap + verb, amber like every
   other ammunition warning. Sits below the interaction prompt (58%) and above
   the health bar, roughly on the weapon's receiver. */
.ow-reload-hint {
  position:absolute; left:50%; top:67%;
  transform: translate(-50%,-50%);
  display:flex; align-items:center; gap: calc(var(--u) * 1.6);
  will-change: opacity, transform;
}
.ow-reload-hint-txt {
  font-size: calc(12px * var(--k)); letter-spacing:.24em;
  color: var(--amber); text-shadow: var(--sh);
}

/* ================================================================ banner */
.ow-banner {
  position:absolute; left:50%; top:31%;
  transform: translate(-50%,-50%);
  text-align:center;
  /* wide side padding on purpose: the scrim's outer 20% is a feather, so the
     band has to be substantially wider than the type for the type to sit on
     the solid part of it */
  padding: calc(var(--u) * 4) calc(var(--u) * 30);
  will-change: opacity, transform;
}
/* A soft radial haze over a blown sky does nothing except add milk: at 62% in
   the middle and 0 at the edge, its average density is far too low to seat white
   type on a 236-luma cloud. This is a flat 60% dark band, feathered across the
   outer 20% at each end (and rolled off top/bottom so it is a band, not a box). */
.ow-banner::before {
  content:''; position:absolute; inset:0; z-index:-1;
  background: linear-gradient(to bottom,
    rgba(4,7,10,0) 0%, rgba(4,7,10,.60) 20%, rgba(4,7,10,.60) 80%, rgba(4,7,10,0) 100%);
  -webkit-mask-image: linear-gradient(to right, rgba(0,0,0,0) 0%, #000 20%, #000 80%, rgba(0,0,0,0) 100%);
          mask-image: linear-gradient(to right, rgba(0,0,0,0) 0%, #000 20%, #000 80%, rgba(0,0,0,0) 100%);
}
.ow-banner-t {
  font-family: var(--fd);
  font-size: calc(30px * var(--k)); letter-spacing:.3em; font-weight:700;
  text-shadow: var(--sh-o2);
}
.ow-banner-s {
  margin-top: calc(var(--u) * 1.4);
  font-size: calc(12px * var(--k)); letter-spacing:.3em; color: var(--amber); font-weight:700;
  text-shadow: var(--sh-o1);
}
.ow-banner-rule {
  margin: calc(var(--u) * 1.4) auto 0; width: calc(120px * var(--k)); height:1px;
  background: linear-gradient(to right, transparent, rgba(255,255,255,.5), transparent);
}

/* ================================================================== menu */
/* The pause / settings menu is NOT in-world chrome — it is a WORKMELT product
   surface, so it drops the HUD's outlined amber treatment entirely and uses the
   brand tokens from src/ui/brand.js: Gunmetal panel at 88% over a Dark Slate
   scrim, 1px Hairline rules, 8px radius, Bebas for display and Inter for every
   string. Melt Green is a hover border and a slider fill only, never a wash.

   Sizes are plain px, not calc(N * var(--k)): the HUD scales with the viewport
   because it has to sit in fixed relation to the crosshair, but a settings
   panel is read at arm's length and wants normal, honest UI sizes. */
.ow-menu {
  /* Fixed and above everything: the panel is mounted on the shared #ui host,
     outside .ow-hud, so it can cover the lobby (z-index 60) too. */
  position:fixed; inset:0; z-index:80; pointer-events:auto;
  display:grid; place-items:center; padding: 24px;
  background: rgb(var(--wm-void-rgb) / .82);
  backdrop-filter: blur(10px) saturate(.85);
  opacity:0; will-change: opacity;
  font-family: var(--wm-body); text-transform:none; letter-spacing:normal;
  color: var(--wm-fg); font-weight:400;
}
.ow-menu *, .ow-menu *::before, .ow-menu *::after { box-sizing:border-box; }
.ow-menu :focus-visible { outline: 2px solid var(--wm-accent); outline-offset: 2px; }
.ow-menu .grow { flex: 1 1 auto; }
.ow-menu-inner {
  width: min(560px, 100%); max-height: min(760px, 100%);
  display:flex; flex-direction:column;
  background: var(--wm-panel); border: 1px solid var(--wm-border);
  border-radius: var(--wm-r); box-shadow: var(--wm-shadow-lift);
  overflow:hidden;
}
.ow-menu-hd {
  display:flex; align-items:flex-start; gap: 12px; flex:none;
  padding: 18px 20px 16px; border-bottom: 1px solid var(--wm-border);
}
.ow-menu h1 {
  font-family: var(--wm-display); font-weight:400;
  font-size: 34px; letter-spacing:.1em; line-height:1; text-transform:uppercase;
}
.ow-menu .sub {
  margin-top: 7px; font-size: 11px; font-weight:600; letter-spacing:.1em;
  text-transform:uppercase; color: var(--wm-muted-fg);
}
.ow-x {
  appearance:none; width:30px; height:30px; flex:none; border-radius: var(--wm-r-sm);
  border:1px solid var(--wm-border); background:none; color: var(--wm-muted-fg);
  display:grid; place-items:center; cursor:pointer;
  transition: color var(--wm-t), border-color var(--wm-t);
}
.ow-x:hover { color: var(--wm-fg); border-color: var(--wm-accent); }
.ow-menu-bd { padding: 4px 20px 14px; overflow-y:auto; flex: 1 1 auto; min-height:0; }
.ow-menu-ft { flex:none; padding: 14px 20px 16px; border-top: 1px solid var(--wm-border); }

/* Tab strip for the advanced graphics groups. Pinned between the header and the
   scrolling body — with ~38 settings behind it, a strip that scrolled away
   would leave the player with no way back without a full scroll up. Chips
   rather than an underlined rail: DESIGN.md wants 8px-grid enterprise UI, and a
   chip carries the Ice-White-fill active state the segmented controls already
   use, so the whole panel has one selected-state vocabulary. */
.ow-tabs {
  flex:none; display:flex; flex-wrap:wrap; gap: 6px;
  padding: 12px 20px; border-bottom: 1px solid var(--wm-border);
}
.ow-tab {
  appearance:none; border:1px solid var(--wm-border); border-radius: var(--wm-r-sm);
  background: var(--wm-panel-2); color: var(--wm-muted-fg);
  font-family: var(--wm-body); font-weight:600; text-transform:uppercase;
  font-size: 10px; letter-spacing:.08em; padding: 6px 10px; cursor:pointer;
  transition: color var(--wm-t), background var(--wm-t), border-color var(--wm-t);
}
.ow-tab:hover { color: var(--wm-fg); background: var(--wm-hover); }
.ow-tab.on { color: var(--wm-bg); background: var(--wm-fg); border-color: var(--wm-fg); }

.ow-group {
  font-size: 11px; font-weight:600; letter-spacing:.1em; text-transform:uppercase;
  color: var(--wm-muted-fg); padding: 18px 0 2px;
}
/* The first group header in a tab sits right under the strip, so it does not
   need the 18px it uses to separate two groups mid-panel. */
.ow-panel > .ow-group:first-child { padding-top: 10px; }
/* A setting the player has moved off its preset. Melt Green is a border and an
   accent only (the 4% rule), so "changed" is a left rule, not a fill. */
.ow-row-set { box-shadow: inset 2px 0 0 -1px var(--wm-accent); padding-left: 8px; }
.ow-row-set > .name { color: var(--wm-fg); }
/* Marks a row that cannot take effect until the page reloads. */
.ow-tag {
  margin-left: 8px; padding: 2px 5px; border-radius: 3px; vertical-align: middle;
  font-size: 9px; font-weight:600; letter-spacing:.08em;
  color: var(--wm-muted-fg); border: 1px solid var(--wm-border);
}
.ow-row-set .ow-tag { color: var(--wm-warn); border-color: var(--wm-warn); }
.ow-row {
  display:flex; align-items:center; justify-content:space-between;
  gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--wm-border); min-height: 52px;
}
.ow-row:last-child { border-bottom: 0; }
.ow-row > .name {
  font-size: 13px; font-weight:500; letter-spacing:.01em; color: var(--wm-fg);
  text-transform: none;
}
.ow-row > .val {
  font-size: 12px; font-weight:600; color: var(--wm-fg-dim); font-variant-numeric: tabular-nums;
  min-width: 52px; text-align:right;
}
.ow-seg { display:flex; gap:0; flex:none; }
.ow-seg button {
  appearance:none; border:1px solid var(--wm-border); border-right:0;
  background: var(--wm-panel-2); color: var(--wm-muted-fg);
  font-family: var(--wm-body); font-weight:600; text-transform:uppercase;
  font-size: 10px; letter-spacing:.08em; padding: 7px 11px;
  cursor:pointer; position:relative;
  transition: color var(--wm-t), background var(--wm-t), border-color var(--wm-t);
}
.ow-seg button:first-child { border-radius: var(--wm-r-sm) 0 0 var(--wm-r-sm); }
.ow-seg button:last-child { border-right:1px solid var(--wm-border); border-radius: 0 var(--wm-r-sm) var(--wm-r-sm) 0; }
.ow-seg button:hover { color: var(--wm-fg); background: var(--wm-hover); }
/* Ice White fill, Graphite text — 14.91:1, the primary pairing in DESIGN.md. */
.ow-seg button.on { color: var(--wm-bg); background: var(--wm-fg); border-color: var(--wm-fg); }
.ow-select {
  appearance:none; min-width: 168px; border-radius: var(--wm-r-sm);
  border:1px solid var(--wm-border); background: var(--wm-panel-2);
  color: var(--wm-fg); font-family: var(--wm-body); font-size: 12px; font-weight:500;
  letter-spacing:.01em; padding: 7px 10px; cursor:pointer;
  transition: border-color var(--wm-t);
}
.ow-select:hover { border-color: var(--wm-accent); }
/* Rebind button. Named ow-bind, not ow-key — that one is already the in-world
   "press F" keycap. Sized like .ow-select so the settings column stays flush,
   and wide enough that a two-word prompt ("PRESS A KEY", "IN USE") does not
   reflow the row. */
.ow-bind {
  appearance:none; min-width: 168px; border-radius: var(--wm-r-sm);
  border:1px solid var(--wm-border); background: var(--wm-panel-2);
  color: var(--wm-fg); font-family: var(--wm-body); font-size: 11px; font-weight:600;
  letter-spacing:.1em; text-transform:uppercase; text-align:center; padding: 8px 10px;
  cursor:pointer; transition: color var(--wm-t), background var(--wm-t), border-color var(--wm-t);
}
.ow-bind:hover { border-color: var(--wm-accent); }
.ow-bind.on { color: var(--wm-bg); background: var(--wm-accent); border-color: var(--wm-accent); }
.ow-quality-status {
  min-width: 200px !important; font-size: 11px !important;
  white-space:nowrap; font-variant-numeric: tabular-nums;
}
.ow-slider { position:relative; width: 200px; height: 20px; flex:none; }
.ow-slider .track {
  position:absolute; left:0; right:0; top:50%; height: 4px; border-radius: 2px;
  transform: translateY(-50%); background: rgb(var(--wm-fg-rgb) / .14);
}
.ow-slider .fill {
  position:absolute; left:0; top:50%; height: 4px; border-radius: 2px;
  transform: translateY(-50%); background: var(--wm-fg);
}
.ow-slider .knob {
  position:absolute; top:50%; width: 12px; height: 12px; border-radius: 3px;
  background: var(--wm-fg); transform: translate(-50%,-50%);
  transition: background var(--wm-t);
}
.ow-slider:hover .knob { background: var(--wm-accent); }
.ow-slider input {
  position:absolute; inset:0; width:100%; height:100%; margin:0;
  appearance:none; background:transparent; cursor:pointer; opacity:0;
}
.ow-btns { display:flex; align-items:center; gap: 10px; }
.ow-btn {
  appearance:none; border:1px solid var(--wm-fg); background: transparent;
  color: var(--wm-fg); font-family: var(--wm-display); font-weight:400;
  text-transform:uppercase; font-size: 17px; letter-spacing:.08em;
  border-radius: var(--wm-r); padding: 11px 20px 8px; cursor:pointer;
  transition: background var(--wm-t), border-color var(--wm-t), color var(--wm-t);
}
.ow-btn:hover { border-color: var(--wm-accent); }
.ow-btn.primary { background: var(--wm-fg); border-color: var(--wm-fg); color: var(--wm-bg); }
.ow-btn.primary:hover { background: var(--wm-fg-warm); }
/* Danger is 3.57:1 on Dark Slate — large text and borders only, which at 17px
   Bebas it is. It fills only on hover, so leaving a match is never a mis-click. */
.ow-btn.danger { border-color: var(--wm-border); color: var(--wm-muted-fg); }
.ow-btn.danger:hover { background: var(--wm-danger); border-color: var(--wm-danger); color: var(--wm-bg); }
/* Only on screen while a RESTART-tagged graphics setting is waiting to apply.
   Warning, not Danger: reloading is the thing the player just asked for, it is
   simply the thing that costs a loading screen. */
.ow-btn.warn { border-color: var(--wm-warn); color: var(--wm-warn); }
.ow-btn.warn:hover { background: var(--wm-warn); border-color: var(--wm-warn); color: var(--wm-bg); }
.ow-menu .hint {
  margin-top: 14px; font-size: 11px; font-weight:500; letter-spacing:.06em;
  text-transform:uppercase; color: var(--wm-muted-fg); text-align:center;
}

/* Click-to-resume target. Only on screen when the game is live and the browser
   has not given pointer lock back yet — see the header of src/ui/menu.js. */
.ow-lockhint {
  position:fixed; left:50%; bottom: 14%; z-index:45; transform: translateX(-50%);
  display:flex; align-items:center; gap: 10px; pointer-events:auto; cursor:pointer;
  padding: 10px 16px; border-radius: var(--wm-r);
  background: var(--wm-panel); border: 1px solid var(--wm-border);
  box-shadow: var(--wm-shadow); font-family: var(--wm-body); text-transform:none;
  letter-spacing:normal; white-space:nowrap;
  transition: border-color var(--wm-t);
}
.ow-lockhint:hover { border-color: var(--wm-accent); }
.ow-lockhint .t {
  font-family: var(--wm-display); font-size: 19px; letter-spacing:.08em;
  text-transform:uppercase; color: var(--wm-fg); line-height:1;
}
.ow-lockhint .k {
  font-size: 10px; font-weight:600; letter-spacing:.08em; color: var(--wm-fg-dim);
  border:1px solid var(--wm-border); border-radius: 3px; padding: 2px 5px; margin-left: 4px;
}
.ow-lockhint .s { font-size: 12px; color: var(--wm-muted-fg); }

@media (max-height: 620px) {
  .ow-menu { padding: 12px; }
  .ow-menu h1 { font-size: 26px; }
  .ow-menu-hd { padding: 12px 16px; }
  .ow-menu-bd { padding: 0 16px 8px; }
  .ow-tabs { padding: 8px 16px; }
  .ow-group { padding: 12px 0 2px; }
  .ow-row { padding: 9px 0; min-height: 0; }
}
@media (max-width: 560px) {
  .ow-row { flex-wrap: wrap; gap: 8px; }
  .ow-slider, .ow-select, .ow-bind { width: 100%; min-width: 0; }
  .ow-btns { flex-wrap: wrap; }
  .ow-menu .grow { flex-basis: 100%; }
}

/* ============================================================ perf readout */
/* Debug overlay, not game chrome: monospace so digits do not reflow, plain dark
   plate rather than the HUD's outlined type, and it deliberately sits outside
   the opacity fade so it stays readable with the pause menu open. */
.ow-perf {
  position:absolute; pointer-events:none;
  width: calc(180px * var(--k));
  padding: calc(5px * var(--k)) calc(7px * var(--k)) calc(6px * var(--k));
  background: rgba(6,10,14,.62);
  border:1px solid rgba(255,255,255,.10);
  border-radius: calc(3px * var(--k));
  font-family: ${FONT_MONO};
  font-size: calc(9.5px * var(--k));
  line-height:1.42;
  color: var(--ink-2);
  font-variant-numeric: tabular-nums;
  text-shadow: 0 1px 1px rgba(0,0,0,.9);
}
/* Default slot: under the minimap (top var(--pad) + 178px), the only corner no
   other HUD element claims. */
.ow-perf-tl { left:var(--pad); top: calc(var(--pad) + 192px * var(--k)); }
.ow-perf-tr { right:var(--pad); top: var(--pad); }
.ow-perf-bl { left:var(--pad); bottom: var(--pad); }
.ow-perf-br { right:var(--pad); bottom: var(--pad); }

.ow-perf-head { display:flex; align-items:baseline; gap: calc(3px * var(--k)); }
.ow-perf-fps {
  font-family: var(--fd);
  font-size: calc(26px * var(--k)); font-weight:700; line-height:.92;
  letter-spacing:.01em; color: var(--ink);
}
.ow-perf-unit { font-size: calc(8.5px * var(--k)); letter-spacing:.18em; color: var(--ink-3); }
.ow-perf-bound {
  margin-left:auto; align-self:center;
  font-size: calc(8px * var(--k)); letter-spacing:.14em;
  padding: 0 calc(3px * var(--k));
  border:1px solid var(--hair); border-radius: calc(2px * var(--k));
  color: var(--ink-2);
}
.ow-perf-good .ow-perf-fps { color: var(--ok); }
.ow-perf-warn .ow-perf-fps { color: var(--amber); }
.ow-perf-bad  .ow-perf-fps { color: var(--red); }

.ow-perf-sub { font-size: calc(8.5px * var(--k)); color: var(--ink-3); margin-top: calc(1px * var(--k)); }
.ow-perf-graph {
  display:block; margin: calc(4px * var(--k)) 0 calc(3px * var(--k));
  background: rgba(0,0,0,.30);
  border-radius: calc(2px * var(--k));
}
.ow-perf-body { margin-top: calc(1px * var(--k)); }
.ow-perf-row { display:flex; align-items:center; gap: calc(3px * var(--k)); }
.ow-perf-label { width: calc(30px * var(--k)); color: var(--ink-3); letter-spacing:.08em; flex:none; }
.ow-perf-value { width: calc(42px * var(--k)); text-align:right; color: var(--ink); flex:none; }
.ow-perf-track {
  flex:1; height: calc(3px * var(--k));
  background: rgba(255,255,255,.09); border-radius: calc(2px * var(--k)); overflow:hidden;
}
.ow-perf-bar { display:block; height:100%; width:0%; background: var(--cyan); }
.ow-perf-line {
  font-size: calc(8.5px * var(--k)); color: var(--ink-3);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
.ow-perf-alert { color: var(--amber); }
.ow-perf-hint {
  margin-top: calc(2px * var(--k));
  font-size: calc(7.5px * var(--k)); letter-spacing:.16em; color: rgba(255,255,255,.20);
}

/* ============================================================== fadeouts */
.ow-hidden { display:none !important; }
`;

const DEFS = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <defs>
    <!-- organic edge for the blood vignette: banded turbulence displacing the
         gradient so the hurt overlay never reads as a clean radial ramp -->
    <filter id="ow-warp" x="-12%" y="-12%" width="124%" height="124%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.006 0.011" numOctaves="4" seed="17" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="34" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
  </defs>
</svg>`;

let installed = false;

export function installStyles() {
  if (installed && document.getElementById('ow-ui-style')) return;
  const s = document.createElement('style');
  s.id = 'ow-ui-style';
  s.textContent = CSS;
  document.head.appendChild(s);
  const d = document.createElement('div');
  d.id = 'ow-ui-defs';
  d.innerHTML = DEFS;
  document.body.appendChild(d);
  installed = true;
}

export function removeStyles() {
  document.getElementById('ow-ui-style')?.remove();
  document.getElementById('ow-ui-defs')?.remove();
  installed = false;
}
