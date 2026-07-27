/**
 * AI — player liveries: the high-chroma colour every character in the match is
 * identified by, and the flat untextured material set that renders it.
 *
 * This module replaces the per-texel camouflage baker that used to live in
 * `textures.js`. The brief is the opposite of what that system was built for:
 * a figure should be recognised by COLOUR at a glance, not read as a
 * photoreal soldier, and every character in one match must be a different
 * colour. Nothing here is textured, so:
 *
 *   - boot loses the 3.27 s blocking CPU bake (measured; see TEXTURE-PERF.md §5)
 *   - characters lose 38.7 MB of RGBA8 texture memory
 *   - a character fragment issues ZERO texture fetches
 *
 * Form is carried by `flatShading` instead. The rig is faceted geometry (see
 * the `FACETS` note in `parts.js`), so every triangle gets one normal and the
 * per-facet value steps become the surface detail — the same trade the
 * first-person arms took in `src/weapons/hands.js`.
 *
 * COLOUR SPACE. Every value below is LINEAR. `THREE.Color(r,g,b)` writes the
 * working colour space directly, which is linear-sRGB with three's colour
 * management on, so these are albedos and not swatches. Liveries are AUTHORED
 * as full-brightness sRGB neons and scaled into the albedo band by the gains in
 * `BAND` — that keeps the hue exact and puts the calibration in one place.
 */

import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/* Albedo band                                                         */
/* ------------------------------------------------------------------ */

/**
 * What a livery albedo is allowed to be, in linear luminance.
 *
 * MEASURED off the shipping frame and kept from the old bake's calibration
 * table: the environment's *sunlit* surfaces currently behave like 0.05-0.09
 * albedo on screen, and the read-back fit is roughly
 *
 *     screen_linear ~= 2.1 x albedo      (albedo 0.17 -> sRGB 155,
 *                                         albedo 0.09 -> sRGB 124,
 *                                         albedo 0.05 -> sRGB  96)
 *
 * so a `suit` at 0.30 renders around sRGB 212 on its dominant channel while
 * the two channels the hue leaves near zero stay around sRGB 60-70. That is
 * the whole trick: the figure is far brighter AND far more chromatic than
 * anything in the level, without the dominant channel clipping to white and
 * throwing the hue away. Pushing `suit` past ~0.40 does exactly that — the
 * old uniform bake went chalky at 0.21 for the same reason.
 *
 *   suit    0.300  jacket, trousers, helmet cover, head wrap — the identity
 *   accent  0.400  head, neck, helmet cover and head wrap — lifted 25 %
 *                  toward white so the head reads a value step hotter than the suit
 *   carrier        plate carrier and bare helmet shell: `carrierHue` of the hue
 *                  over a `carrierBase` neutral floor
 *   kit     0.012  webbing, pouches, straps — reads as black nylon
 *   trim    0.007  boots and gloves, the darkest thing on the figure
 *
 * THE CARRIER IS A WASH, NOT A SCALE, and that floor is the reason. Scaling a
 * pure hue by a constant makes the result's LUMINANCE a property of the hue: a
 * blue carrier lands four times darker than a yellow one, because linear blue
 * carries 0.07 of the luminance and yellow 0.93. Scaled straight, a blue
 * carrier fell *below* the near-black webbing and the value hierarchy inverted
 * on one twelfth of the palette. Washing a fixed neutral with a fraction of the
 * hue keeps the carrier tinted while pinning its luminance floor, so `carrier`
 * is above `kit` for every hue — measured across all twelve by selftest.mjs.
 */
export const BAND = Object.freeze({
  suit: 0.300,
  accent: 0.400,
  accentLift: 0.25,
  carrierHue: 0.090,
  carrierBase: 0.028,
  kit: 0.012,
  trim: 0.007,
});

/** Neutral hardware albedos. Helmet shells, optics, weapon, soles, visor. */
export const HARDWARE = Object.freeze({
  polymer: [0.020, 0.021, 0.023],
  steel: [0.034, 0.035, 0.038],
  rubber: [0.012, 0.012, 0.013],
  glass: [0.008, 0.010, 0.013],
});

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

/**
 * Full-saturation LINEAR RGB at hue `h` in [0,1). The usual six-sector ramp,
 * but built in the working colour space rather than in sRGB and converted.
 *
 * Authoring these in sRGB is the obvious thing and it is wrong: the transfer
 * curve is applied per channel, so it does not preserve hue angle. Twelve hues
 * spaced 30 degrees apart in sRGB collapse toward the primaries once converted
 * — MEASURED at 12 to 17 degrees between the reds, which put three "different"
 * player colours inside one orange. Generating in linear means the spacing you
 * ask for is the spacing you get.
 */
function hueLinear(h) {
  const x = (((h % 1) + 1) % 1) * 6;
  const i = Math.floor(x);
  const f = x - i;
  switch (i) {
    case 0: return [1, f, 0];
    case 1: return [1 - f, 1, 0];
    case 2: return [0, 1, f];
    case 3: return [0, 1 - f, 1];
    case 4: return [f, 0, 1];
    default: return [1, 0, 1 - f];
  }
}

/** Names for the twelve 30-degree stops, by hue index (0 = red). */
const HUE_NAMES = [
  'ember', 'flare', 'sulphur', 'acid', 'venom', 'mint',
  'glacier', 'azure', 'cobalt', 'violet', 'fuchsia', 'rose',
];

/**
 * Slot -> hue index. Twelve stops visited in steps of 5, which is coprime with
 * 12 and so hits every one exactly once, and starting at fuchsia.
 *
 * Slots are handed out in join order, so CONSECUTIVE slots are what a small
 * match actually gets, and consecutive entries here are 5/12 of a turn apart —
 * the first two players in a room are fuchsia and acid green, not two
 * neighbouring oranges. Going round the wheel in order would have given them
 * adjacent hues.
 *
 * `MAX_ROOM` on both relays is 12, which is why there are exactly twelve:
 * every human in a full room gets a curated stop and only bots fall through to
 * the generated hues.
 */
const ORDER = Object.freeze(
  Array.from({ length: 12 }, (_, i) => (10 + i * 5) % 12)
);

/**
 * Slots 0..PLAYER_SLOTS-1 belong to humans and are assigned by the relay, which
 * is the only party that can see a whole room at once (`skin` in the `welcome`
 * message — see MULTIPLAYER.md). Bots take slots from `BOT_SLOT` upward, so a
 * garrison can never wear a colour a player is already identified by.
 */
export const PLAYER_SLOTS = ORDER.length;
export const BOT_SLOT = ORDER.length;

const GOLDEN = 0.618033988749895;

const cache = new Map();

/**
 * The livery for a slot. Any non-negative integer is valid: past the twelve
 * curated stops the hue is generated by golden-angle rotation, offset half a
 * curated step (1/24 turn) so the first generated hues land BETWEEN the ones
 * players are wearing rather than on top of them.
 *
 * @param slot integer >= 0
 * @returns { id, name, slot, suit, accent, carrier, kit, trim } — linear RGB
 */
export function liveryFor(slot) {
  const s = Math.max(0, Math.floor(slot || 0));
  let l = cache.get(s);
  if (l) return l;

  const curated = s < ORDER.length;
  const hue = curated
    ? hueLinear(ORDER[s] / 12)
    : hueLinear(1 / 24 + (s - ORDER.length) * GOLDEN);
  const id = curated ? HUE_NAMES[ORDER[s]] : `hue${s}`;

  // The accent is the hue lifted toward white BEFORE it is scaled: a pure hue
  // at 0.40 clips its dominant channel and the head goes to a white blob, and
  // a head that has lost its hue is the one part of the figure that most
  // needed to keep it — every variant covers the skull, so the headgear IS the
  // accent's whole visible surface (see the helmet block in soldier.js).
  const w = BAND.accentLift;

  l = Object.freeze({
    id,
    name: id[0].toUpperCase() + id.slice(1),
    slot: s,
    suit: hue.map((c) => c * BAND.suit),
    accent: hue.map((c) => (c * (1 - w) + w) * BAND.accent),
    carrier: hue.map((c) => c * BAND.carrierHue + BAND.carrierBase),
    kit: [BAND.kit, BAND.kit, BAND.kit],
    trim: [BAND.trim, BAND.trim, BAND.trim],
  });
  cache.set(s, l);
  return l;
}

/** Every curated livery, for menus and self-tests. */
export const LIVERIES = ORDER.map((_, i) => liveryFor(i));

/**
 * A livery as a CSS colour, for a scoreboard swatch.
 *
 * The suit albedo is the wrong number to put in a swatch: it is deliberately
 * dark (0.30 on its dominant channel) because in the level it is multiplied by
 * a sun, and a `<span>` has no sun. So the hue is renormalised to full
 * brightness and then encoded to sRGB — the swatch shows what the player looks
 * like in daylight, not the albedo underneath. Hue is preserved exactly, which
 * is the only property the swatch has to get right.
 */
export function liveryCss(livery) {
  const c = livery.suit;
  const peak = Math.max(c[0], c[1], c[2]) || 1;
  const enc = (v) => {
    const x = v / peak;
    const s = x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(Math.max(0, Math.min(1, s)) * 255);
  };
  return `rgb(${enc(c[0])},${enc(c[1])},${enc(c[2])})`;
}

/* ------------------------------------------------------------------ */
/* Silhouette                                                          */
/* ------------------------------------------------------------------ */

/**
 * View-dependent edge darkening, kept from the textured era because it is the
 * one thing that stops a character dissolving into a 0.94-linear sky — and a
 * neon figure needs it MORE, not less, since its albedo is now three stops
 * above the level it stands in.
 *
 * Outgoing radiance is scaled by `1 - strength * smoothstep(edge,1,1-|N.V|)^power`
 * using the geometric normal. `strength` is 0.34 rather than the old 0.62: at
 * 0.62 the band ate the outer sliver of every neon limb and the figure read as
 * outlined in black, which is a cartoon, not a silhouette.
 */
export const RIM = Object.freeze({ strength: 0.34, edge: 0.42, power: 1.9 });

/* ------------------------------------------------------------------ */
/* Public: the material set                                            */
/* ------------------------------------------------------------------ */

const col = (c) => new THREE.Color(c[0], c[1], c[2]);

/**
 * Which livery colour and surface response each of `MATERIAL_SLOTS` gets.
 * `pick` is a key into the livery object, or null for a fixed hardware colour.
 *
 * Roughness is the only thing separating these surfaces now that they share a
 * hue family and carry no maps, so the spread is deliberately wide: matte suit,
 * satin carrier, near-mirror visor.
 */
const SLOTS = {
  cloth: { pick: 'suit', rough: 0.78, metal: 0 },
  gear: { pick: 'kit', rough: 0.68, metal: 0 },
  boot: { pick: 'trim', rough: 0.52, metal: 0 },
  rubber: { fixed: HARDWARE.rubber, rough: 0.86, metal: 0 },
  plate: { pick: 'carrier', rough: 0.44, metal: 0 },
  polymer: { fixed: HARDWARE.polymer, rough: 0.36, metal: 0 },
  accent: { pick: 'accent', rough: 0.62, metal: 0 },
  glass: { fixed: HARDWARE.glass, rough: 0.11, metal: 0, env: 1.4, rim: 0.5 },
  steel: { fixed: HARDWARE.steel, rough: 0.42, metal: 1 },
};

/**
 * Flat material set for the characters. One `MeshStandardMaterial` per
 * (slot, livery) pair, cached — they are untextured, so a set costs a few
 * hundred bytes and no GPU memory at all.
 *
 * Everything stays a plain `MeshStandardMaterial`, which is what lets render's
 * `MaterialPatcher` inject the CSM sun shadow, the screen-space contact shadow,
 * GTAO and the bounce fill. The rim term is added through `onBeforeCompile`,
 * and the patcher chains our hook, so the two coexist.
 *
 * `customProgramCacheKey` deliberately does NOT include the livery: colour is a
 * uniform, so every livery of a given slot shares one compiled program. That is
 * what makes per-player colour free — twelve players do not mean twelve times
 * the shader compiles, and `prewarmMaterials()` warming one livery warms them
 * all.
 */
export class SoldierMaterials {
  constructor() {
    /** `${slot}|${liveryId}` -> THREE.Material */
    this.materials = new Map();
    /** Kept so the boot log can report the bake that is no longer there. */
    this.bakeMs = 0;
  }

  /**
   * @param slotName one of `MATERIAL_SLOTS`
   * @param livery   a `liveryFor()` result
   */
  get(slotName, livery) {
    const spec = SLOTS[slotName] ?? SLOTS.polymer;
    const key = `${slotName}|${spec.fixed ? 'fixed' : livery.id}`;
    let m = this.materials.get(key);
    if (m) return m;
    const c = spec.fixed ?? livery[spec.pick];
    m = new THREE.MeshStandardMaterial({
      color: col(c),
      roughness: spec.rough,
      metalness: spec.metal,
      // The geometry's vertex colours are pure baked AO x a per-part value
      // step (see `_shade` in geo.js, which runs with weathering off). They
      // are what keeps a crevice dark now that no ORM map does.
      vertexColors: true,
      flatShading: true,
      envMapIntensity: spec.env ?? 1,
      dithering: true,
    });
    m.name = `ai_${slotName}`;
    this._attachRim(m, spec.rim ?? 1);
    this.materials.set(key, m);
    return m;
  }

  /** Flat material for goggle lenses / optic glass. */
  glass() {
    return this.get('glass', LIVERIES[0]);
  }

  /**
   * Silhouette edge darkening. One `onBeforeCompile`, because render's
   * `MaterialPatcher` chains whatever hook it finds and calls ours first.
   */
  _attachRim(m, scale) {
    const uni = {
      owCharRim: {
        value: new THREE.Vector4(RIM.strength * scale, RIM.edge, RIM.power, 0),
      },
    };
    m.userData.owCharRim = uni.owCharRim;
    const tag = `ai-flat-rim${(RIM.strength * scale).toFixed(2)}`;
    m.customProgramCacheKey = () => tag;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.owCharRim = uni.owCharRim;
      shader.fragmentShader = 'uniform vec4 owCharRim;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `{
          float owF = 1.0 - abs( dot( normalize( vViewPosition ), nonPerturbedNormal ) );
          float owEdge = pow( smoothstep( owCharRim.y, 1.0, owF ), owCharRim.z );
          outgoingLight *= 1.0 - owCharRim.x * owEdge;
        }
        #include <opaque_fragment>`
      );
    };
  }

  dispose() {
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }
}
