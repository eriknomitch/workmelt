/**
 * WORLD — the surface palette.
 *
 * A named set of material variants pulled from the `materials` library. Keeping
 * them in one table means the level uses a deliberate, limited palette (which is
 * what makes a real map read as one place) and that every mesh sharing a key
 * merges into the same draw call.
 *
 * `surface` is the ARCHITECTURE.md physics/FX tag. `tint` is a linear multiply
 * on the baked albedo, so values stay inside 0.02–0.9 reflectance.
 */
export const PALETTE = {
  // ---------------------------------------------------------- architecture --
  plaster_cream: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: 0xcfc0a4, scale: 2.35, weather: [0.4, 0.5, 1.4, 0.55] },
  },
  plaster_sand: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: 0xb9a582, scale: 2.1, weather: [0.45, 0.5, 1.5, 0.6] },
  },
  plaster_blue: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: 0x8f9aa0, scale: 2.2, weather: [0.4, 0.55, 1.5, 0.6] },
  },
  plaster_pink: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: 0xc09a86, scale: 2.5, weather: [0.45, 0.5, 1.3, 0.55] },
  },
  plaster_white: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: 0xd8d2c4, scale: 1.9, weather: [0.3, 0.35, 0.9, 0.5] },
  },
  brick: {
    name: 'brick',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0xa8846c, scale: 1.3 },
  },
  /** Hollow clay block exposed where the render has spalled off. */
  brick_fine: {
    name: 'brick',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0x9c8068, scale: 0.62, weather: [0.45, 0.5, 0.8, 0.6] },
  },
  concrete: {
    name: 'concrete',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0xa9a49a, scale: 2.5 },
  },
  /**
   * Prop-scale concrete. A 2.5 m texture tile across a 0.5 m block shows a
   * single smear of noise and reads as untextured plastic; small objects need
   * their own, much tighter tiling.
   */
  concrete_prop: {
    name: 'concrete',
    surface: 'concrete',
    opts: {
      vertexMasks: true,
      tint: 0xa5a096,
      scale: 0.9,
      normalStrength: 1.3,
      weather: [0.45, 0.5, 0.35, 0.55],
    },
  },
  concrete_dark: {
    name: 'concrete',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0x7d7a73, scale: 2.2, weather: [0.4, 0.6, 1.2, 0.6] },
  },
  /** Roof screed: flat, sand-dusted, and the biggest surface in any skyline. */
  roof_screed: {
    name: 'concrete',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0xb5a992, scale: 2.8, weather: [0.6, 0.2, 0.3, 0.45] },
  },
  floor_concrete: {
    name: 'concrete_floor',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0x9e9a91, scale: 3.0 },
  },
  tile_floor: {
    name: 'tile',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0xa9a08d, scale: 1.4 },
  },

  // ----------------------------------------------------------------- ground --
  /**
   * The street itself. A black tarmac road makes a sunlit Levantine town read
   * as a wet European city at dusk — the actual surface is old tarmac buried
   * under years of blown sand and dust, so the base is warm compacted earth and
   * the asphalt only shows through where wheels have polished it.
   */
  road_dust: {
    name: 'gravel',
    surface: 'dirt',
    opts: {
      vertexMasks: true,
      tint: 0xc9b896,
      // 2.2 m, not 1.5: the aggregate reads as 25-45 mm stone instead of a
      // 15 mm rash, and the macro relief band lands on ruts rather than on
      // individual pebbles.
      scale: 2.2,
      // de-tile: a repeating cracked-earth tile down a 100 m street is the most
      // obvious tell in any procedural level.
      detile: 0.9,
      // .w is cavity grime. On gravel the height field IS the aggregate, so
      // this darkens every interstice: at 0.4 the road histogram was bimodal
      // (mass at 32-80 and 144-176 with a hollow middle) — dither, not surface.
      weather: [0.4, 0.04, 0.08, 0.14],
      // No edge wear on a road. The vertex wear mask exists to rub through the
      // arris of a prop; on a 100 m plane it just brightens every stone crown.
      wear: [0, 0.5, 0.45, 0],
    },
  },
  asphalt: {
    name: 'asphalt',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0x9d968a, scale: 3.2, detile: 0.6, wear: [0, 0.55, 0.45, 0] },
  },
  /**
   * The driving line: tarmac polished bare by tyres and stained with oil. A
   * clear stop darker than `road_dust`, because a rut the same value as the dust
   * around it is invisible and the road goes back to being one flat plane.
   */
  road_rut: {
    name: 'asphalt',
    surface: 'concrete',
    opts: {
      vertexMasks: true,
      tint: 0x6f6a62,
      scale: 1.5,
      detile: 0.7,
      weather: [0.3, 0.5, 0.15, 0.28],
      wear: [0, 0.55, 0.45, 0],
    },
  },
  sand: {
    name: 'sand',
    surface: 'sand',
    opts: { vertexMasks: true, scale: 2.6, detile: 0.7, wear: [0, 0.45, 0.45, 0] },
  },
  dirt: {
    name: 'dirt',
    surface: 'dirt',
    opts: { vertexMasks: true, scale: 2.4, detile: 0.8, wear: [0, 0.5, 0.45, 0] },
  },
  gravel: {
    name: 'gravel',
    surface: 'dirt',
    opts: { vertexMasks: true, scale: 1.8, wear: [0, 0.5, 0.45, 0] },
  },
  /**
   * The refinery apron on Rust: a poured slab under years of blown grit, and
   * the single biggest surface in that map's frame. Untinted `gravel` reads as
   * white sand at 30 m — there is nothing to hold a value against a bright sky,
   * and the whole yard flattens. So: a warm mid tint that sits near 0.22
   * reflectance, cavity grime doing the tonal work, and `detile` because a 55 m
   * apron is exactly where a repeating tile announces itself.
   */
  yard_slab: {
    name: 'gravel',
    surface: 'dirt',
    opts: {
      vertexMasks: true,
      tint: 0xa8977a,
      scale: 2.1,
      detile: 0.85,
      weather: [0.4, 0.06, 0.1, 0.2],
      wear: [0, 0.5, 0.45, 0],
    },
  },
  /**
   * The contact fillet swept up against anything standing on the ground (see
   * Assembler.put / props.dustSkirt). It has to read as the ground's own grit
   * piled up, so it is the same generator as the road at a slightly darker,
   * greyer tint, with the grime mask doing the work at the contact line. The
   * first attempt used `dirt`, which is a stop lighter and carries mud cracks:
   * every prop got a pale polygonal plate around it.
   */
  dust_skirt: {
    name: 'gravel',
    surface: 'dirt',
    opts: {
      vertexMasks: true,
      tint: 0xa89d86,
      scale: 1.1,
      weather: [0.3, 0.0, 0.0, 0.16],
      wear: [0, 0.9, 0.7, 0],
    },
  },

  // ------------------------------------------------------------------ metal --
  metal_rust: { name: 'metal_rust', surface: 'metal', opts: { vertexMasks: true, scale: 1.1 } },
  /**
   * Prop-scale rust. A 1.1 m tile wrapped round a 0.6 m oil drum shows one smear
   * of noise and the drum reads as pink plastic — the same trap as
   * `concrete_prop` / `wood_prop`. Drums and buckets are eye-level silhouette
   * breakers in the mid-ground, so they need tiling that resolves at 3 m.
   */
  metal_rust_prop: {
    name: 'metal_rust',
    surface: 'metal',
    opts: {
      vertexMasks: true,
      tint: 0x9d7c66,
      scale: 0.4,
      normalStrength: 1.35,
      weather: [0.5, 0.35, 0.3, 0.5],
    },
  },
  metal_blue: {
    name: 'metal_painted',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0x6d8390, scale: 1.3 },
  },
  metal_green: {
    name: 'metal_painted',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0x76806a, scale: 1.3 },
  },
  metal_dark: {
    name: 'metal_painted',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0x4a4a48, scale: 1.0 },
  },
  steel: { name: 'metal_brushed', surface: 'metal', opts: { vertexMasks: true, scale: 0.9 } },
  corrugated: { name: 'corrugated', surface: 'metal', opts: { vertexMasks: true, scale: 2.2 } },
  /**
   * Corrugated hoarding. Tighter than the 2.2 m roof tile above — fence sheet
   * really is a finer profile than roof sheet — but only by a third. The first
   * pass ran this at 0.85 and the containers at 1.25, and both came out as a
   * comb: at 8 ribs to the tile that is a 10-15 cm pitch, against the ~28 cm a
   * real corrugation actually has. Measure the pitch, do not eyeball the number.
   */
  corrugated_fine: {
    name: 'corrugated',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0x9a9084, scale: 1.5, normalStrength: 1.3, weather: [0.5, 0.4, 0.35, 0.5] },
  },

  /**
   * SHIPPING CONTAINERS — the Rust map's whole vocabulary of cover.
   *
   * All four are the corrugated generator under a paint tint. The tints are
   * desaturated on purpose — a saturated primary-red box reads as a toy — but
   * the first pass went too far the other way: measured against a sunset frame,
   * red/blue/green all landed near 0.06 reflectance and the entire yard merged
   * into one dark mass with no cover legible inside it. These sit around
   * 0.18-0.28, which is where a painted steel box actually is, and which keeps
   * three distinguishable values in a frame full of containers.
   */
  /**
   * SHIPPING CONTAINER PAINT. `scale` is a tile size in metres, so BIGGER means
   * coarser: the ribs have to land at roughly the 28 cm pitch of a real ISO
   * corrugation, and 2.4 is what does that on this generator.
   */
  container_red: {
    name: 'corrugated',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0xb5624a, scale: 2.4, normalStrength: 1.25, weather: [0.55, 0.45, 0.5, 0.5] },
  },
  container_blue: {
    name: 'corrugated',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0x5c7f9c, scale: 2.4, normalStrength: 1.25, weather: [0.5, 0.45, 0.5, 0.5] },
  },
  container_green: {
    name: 'corrugated',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0x6d8460, scale: 2.4, normalStrength: 1.25, weather: [0.5, 0.4, 0.4, 0.5] },
  },
  container_sand: {
    name: 'corrugated',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0xb9a988, scale: 2.4, normalStrength: 1.25, weather: [0.6, 0.4, 0.45, 0.5] },
  },
  /**
   * Structural steel that is PAINTED and only rusting through at the arris —
   * the derrick legs, gantry stringers and pipe trestles. Distinct from
   * `metal_rust`, which is bare corroded sheet: a whole 14 m tower in bare rust
   * reads as one orange silhouette with no structure in it.
   */
  steel_frame: {
    name: 'metal_painted',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0x7c6a58, scale: 0.75, normalStrength: 1.2, weather: [0.6, 0.4, 0.5, 0.5] },
  },
  /** Walkway grating and stair treads: darker, and rough enough to kill glare. */
  steel_grate: {
    name: 'metal_brushed',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0x585552, scale: 0.5, normalStrength: 1.2, weather: [0.5, 0.5, 0.5, 0.6] },
  },

  // ---------------------------------------------------------------- organic --
  wood: { name: 'wood', surface: 'wood', opts: { vertexMasks: true, scale: 1.8 } },
  /**
   * Prop-scale timber. A 1.8 m grain tile across a 0.5 m crate slat shows one
   * soft smear; crates, pallets, planks and stall tables need ~0.5 m tiling
   * before the grain, the saw marks and the dirt in the joints read at all.
   */
  wood_prop: {
    name: 'wood',
    surface: 'wood',
    opts: {
      vertexMasks: true,
      tint: 0xb08a5e,
      scale: 0.55,
      normalStrength: 1.45,
      weather: [0.35, 0.3, 0.35, 0.5],
    },
  },
  wood_prop_dark: {
    name: 'wood',
    surface: 'wood',
    opts: {
      vertexMasks: true,
      tint: 0x7d6244,
      scale: 0.5,
      normalStrength: 1.45,
      weather: [0.35, 0.35, 0.4, 0.55],
    },
  },
  wood_dark: {
    name: 'wood',
    surface: 'wood',
    opts: { vertexMasks: true, tint: 0x8a6a4a, scale: 1.5 },
  },
  wood_pale: {
    name: 'wood',
    surface: 'wood',
    opts: { vertexMasks: true, tint: 0xc0a482, scale: 1.2 },
  },
  fabric_red: {
    name: 'fabric',
    surface: 'fabric',
    opts: { vertexMasks: true, tint: 0xa2564a, scale: 0.26, three: { side: 2 } },
  },
  fabric_teal: {
    name: 'fabric',
    surface: 'fabric',
    opts: { vertexMasks: true, tint: 0x5f8a8c, scale: 0.26, three: { side: 2 } },
  },
  fabric_cream: {
    name: 'fabric',
    surface: 'fabric',
    opts: { vertexMasks: true, tint: 0xbcb298, scale: 0.26, three: { side: 2 } },
  },
  /**
   * Hessian. The weave has to be fine — a 0.5 m tile turns every sandbag into a
   * picnic basket, and sandbags are the most-repeated prop in the level.
   *
   * The tint is deliberately well under a bright sand value: an emplacement is
   * dozens of square metres of one material low in the frame, and at the old
   * value it was the brightest thing in the bottom two thirds of the night shot
   * with nothing lighting it. Filled hessian is a mid-tone — 0.18-0.24 linear —
   * darker than the plaster behind it and darker than the dust it sits on.
   */
  burlap: {
    name: 'burlap',
    surface: 'fabric',
    opts: { vertexMasks: true, tint: 0xa2957a, scale: 0.16, weather: [0.5, 0.3, 0.4, 0.5] },
  },
  rubber: { name: 'rubber', surface: 'rubber', opts: { vertexMasks: true, scale: 0.45 } },
  glass: { name: 'glass', surface: 'glass', opts: { scale: 2.0 } },
  foliage: { name: 'foliage', surface: 'foliage', opts: { vertexMasks: true } },

  // ------------------------------------------------- the Wilmot estate --
  /**
   * Mown lawn. There is no grass generator in the library, so this is the dirt
   * field under a green multiply with the mud-crack macro tiled down — at 30 m
   * it reads as turf, at 0.5 m as thatch, and the FBM roll in the map's height
   * field does the rest. Surface stays `dirt` so footsteps land soft, not leafy.
   */
  lawn: {
    name: 'dirt',
    surface: 'dirt',
    opts: {
      vertexMasks: true,
      tint: 0x718a4e,
      scale: 1.7,
      detile: 0.85,
      weather: [0.35, 0.05, 0.1, 0.2],
      wear: [0, 0.5, 0.4, 0],
    },
  },
  /**
   * The opaque heart of every hedge, topiary ball and tree crown. The alpha-cut
   * `foliage` shell floats just proud of this; the core is what stops daylight
   * showing through the middle of a clipped mass, so it sits well darker than
   * the lit leaf surface — shadowed interior, not painted green.
   */
  leaf_core: {
    name: 'dirt',
    surface: 'foliage',
    opts: { vertexMasks: true, tint: 0x38452c, scale: 0.7, normalStrength: 1.3, weather: [0.3, 0.2, 0.2, 0.4] },
  },
  bark: {
    name: 'wood',
    surface: 'wood',
    opts: { vertexMasks: true, tint: 0x6d5a45, scale: 0.55, normalStrength: 1.5, weather: [0.4, 0.35, 0.4, 0.55] },
  },
  /** Rose beds in the sunken garden: the foliage sheet under a warm multiply. */
  bloom: {
    name: 'foliage',
    surface: 'foliage',
    opts: { vertexMasks: true, tint: 0xc08a92 },
  },
  /**
   * The manor's English-revival brick, left bare: the chimney stacks above the
   * roofline and the greenhouse plinth. Everything else on the house is
   * `brick_lime` — see there for why the two are one wall in two finishes.
   */
  brick_red: {
    name: 'brick',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0x96604c, scale: 0.6, weather: [0.4, 0.45, 0.8, 0.55] },
  },
  /**
   * LIMEWASHED BRICK — the house's actual finish, and the one thing a
   * photograph of it settles instantly: the walls are white, not red.
   *
   * It is emphatically not plaster: it is a thin coat brushed ONTO brick, so
   * the coursing still reads in raking light and the wash wears off the
   * arrises first. That comes from the `brick_limewash` BAKE, not from here —
   * `tint` is a multiply and no multiple of red brick is white. See the note
   * on the library entry, and on BRICK's `uParam.x`, for the coat itself.
   *
   * What is left to do here is hold the result near white (the tint is a hair
   * off neutral, warm, so it does not tip blue against the lawn) and let the
   * wall weather. The rain and ground-splash terms run well above
   * `brick_red`'s: a white wall shows its streaking and its grubby bottom
   * metre, and a clean one would read as new paint on a 1935 house.
   */
  brick_lime: {
    name: 'brick_limewash',
    surface: 'concrete',
    opts: {
      vertexMasks: true,
      tint: 0xf2ece0,
      scale: 0.6,
      weather: [0.45, 0.5, 0.85, 0.45],
      wear: [0.55, 0.55, 0.35, 0],
      wearColor: 0xa8786a,
      grimeColor: 0x45463a,
    },
  },
  /**
   * The roof. Warm brown, coarse and thick — the house is roofed in heavy
   * shingle-cut tile that has gone mossy, not the cool blue-grey slate the
   * first pass assumed. `normalStrength` and the cavity-grime term do the
   * work: the surface is visibly uneven course to course.
   */
  roof_tile: {
    name: 'tile',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0x5e4c3a, scale: 1.3, normalStrength: 1.5, weather: [0.5, 0.3, 0.5, 0.65] },
  },
  /** Interior hardwood, per the listing. Plank field at floor scale. */
  floor_wood: {
    name: 'plank',
    surface: 'wood',
    opts: { vertexMasks: true, tint: 0x8d6a48, scale: 1.2, normalStrength: 1.2 },
  },
  /** The restored barn's painted board siding. */
  barn_red: {
    name: 'plank',
    surface: 'wood',
    opts: { vertexMasks: true, tint: 0x86463a, scale: 1.4, normalStrength: 1.25, weather: [0.5, 0.4, 0.6, 0.55] },
  },
  /** Tennis-court acrylic over asphalt. */
  court_green: {
    name: 'asphalt',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0x51705a, scale: 2.4, detile: 0.6, wear: [0, 0.5, 0.4, 0] },
  },
  /** Pool and fountain water: glassy, transparent, sky-fed. */
  pool_water: {
    name: 'glass',
    surface: 'water',
    opts: {
      scale: 2.4,
      tint: 0x5d8a8e,
      roughness: [0.24, 0.05],
      three: { opacity: 0.44, envMapIntensity: 1.9 },
    },
  },
  /** Greenhouse glazing bars, porch columns, window trim: painted white. */
  frame_white: {
    name: 'metal_painted',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0xc9c6bc, scale: 0.9, weather: [0.45, 0.3, 0.4, 0.45] },
  },
  /** Cut stone for copings, sills, balustrades and steps — paler than raw concrete. */
  stone_pale: {
    name: 'concrete',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0xb3a892, scale: 1.5, weather: [0.5, 0.35, 0.6, 0.5] },
  },
  /**
   * Bluestone paving for the terrace and the garden paths. Cooler and greyer
   * than the cut stone it used to share a key with, which matters because the
   * two now meet along the terrace edge: warm coping over cold paving is the
   * contrast that reads as two different stones instead of one big slab.
   *
   * The cavity-grime term is the highest on the map. Every joint in these
   * paths has moss and weed in it, and grime pooling in the cavities is what
   * puts it there without a single extra triangle.
   */
  flagstone: {
    name: 'concrete',
    surface: 'concrete',
    opts: {
      vertexMasks: true,
      tint: 0x8e9490,
      scale: 2.2,
      normalStrength: 1.15,
      weather: [0.4, 0.25, 0.5, 0.75],
      grimeColor: 0x3a4030,
    },
  },
  /** Baled hay: hessian run bright and dry. */
  straw: {
    name: 'burlap',
    surface: 'fabric',
    opts: { vertexMasks: true, tint: 0xc0a05e, scale: 0.3, weather: [0.4, 0.2, 0.3, 0.4] },
  },

  // ------------------------------------------------- the Chicago Loop --
  /**
   * Chicago common brick: darker and browner than the market's sand-blasted
   * walls or the manor's English red — a hundred years of soot in the mortar.
   */
  brick_chicago: {
    name: 'brick',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0x77584a, scale: 0.62, weather: [0.45, 0.5, 0.9, 0.6] },
  },
  /** Grey limestone/granite for storefront bases and the bank's whole face. */
  stone_grey: {
    name: 'concrete',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0x97938c, scale: 1.7, weather: [0.45, 0.4, 0.7, 0.5] },
  },
  /** Cream terracotta cladding — the Loop's theatre-and-department-store skin. */
  terracotta: {
    name: 'plaster',
    surface: 'plaster',
    opts: { vertexMasks: true, tint: 0xc4b391, scale: 1.5, weather: [0.4, 0.4, 1.1, 0.5] },
  },
  /**
   * The elevated structure itself. A century of paint and grime over riveted
   * steel — darker and colder than Rust's `steel_frame`, because the L reads
   * as a black lattice against the sky in every photograph ever taken of it.
   */
  el_steel: {
    name: 'metal_painted',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0x3b3831, scale: 0.8, normalStrength: 1.2, weather: [0.6, 0.45, 0.55, 0.55] },
  },
  /** Road paint: the dashed centreline and the transit lane. */
  paint_yellow: {
    name: 'plaster',
    surface: 'concrete',
    opts: { vertexMasks: true, tint: 0xa8862e, scale: 0.8, weather: [0.5, 0.3, 0.3, 0.4] },
  },
  /** Painted signage red: the blade sign, hydrants, the news boxes. */
  sign_red: {
    name: 'metal_painted',
    surface: 'metal',
    opts: { vertexMasks: true, tint: 0x8c3b32, scale: 0.9, weather: [0.5, 0.4, 0.5, 0.5] },
  },

  // ------------------------------------------------------------- apertures --
  /**
   * The dark core BEHIND a window opening. A window is not a grey rectangle: it
   * is a hole with a dark room behind it, and the only thing that sells it is a
   * genuinely dark backing plane set 15-25 cm back from the glass so the reveal
   * casts onto it and the opening parallaxes as the camera moves. Final linear
   * albedo lands around 0.03 (the tint is a linear multiply on the baked
   * plaster albedo), which is the reflectance of an unlit room seen from a
   * sunlit street — dark, but still carrying plaster texture rather than being
   * a black hole.
   */
  window_void: {
    name: 'plaster',
    surface: 'plaster',
    opts: {
      vertexMasks: true,
      tint: 0x474441,
      scale: 1.1,
      roughness: [1.0, 0.15],
      weather: [0.2, 0.7, 0.2, 0.7],
    },
  },
  /**
   * The dark shell inside a non-enterable building. Seen through doorways and
   * blown-out holes as well as windows, so it sits a stop above `window_void`:
   * dark, readable, never a white blank.
   */
  interior_shell: {
    name: 'plaster',
    surface: 'plaster',
    opts: {
      vertexMasks: true,
      tint: 0x5f5b56,
      scale: 1.6,
      roughness: [1.0, 0.1],
      weather: [0.25, 0.8, 0.3, 0.65],
    },
  },
  /**
   * Window glass. Distinct from the `glass` used on bottles and shards purely
   * so the roughness can be forced down: below 0.62 the render's SSR/IBL path
   * kicks in and the pane picks up the sky, which is what stops a window
   * reading as taped-over paper.
   */
  window_glass: {
    name: 'glass',
    surface: 'glass',
    opts: {
      scale: 2.0,
      roughness: [0.3, 0.06],
      three: { opacity: 0.16, envMapIntensity: 2.1 },
    },
  },
  /** Plywood sheet nailed over a broken window. */
  plywood: {
    name: 'wood',
    surface: 'wood',
    opts: {
      vertexMasks: true,
      tint: 0x7a6549,
      scale: 0.62,
      normalStrength: 1.2,
      weather: [0.5, 0.45, 0.5, 0.6],
    },
  },

  // ---------------------------------------------------------------- emissive --
  /** Bare interior bulb. Tiny surface, so it needs real radiance to read. */
  emissive_warm: {
    name: 'plaster',
    surface: 'glass',
    opts: {
      scale: 0.4,
      tint: 0xfff0d8,
      three: { emissive: 0xffd39a, emissiveIntensity: 12, toneMapped: true },
    },
  },
  /**
   * A lit room seen from the street. Much dimmer than `emissive_warm`: this is a
   * whole wall of a room catching a bulb, not the bulb itself, and at daylight
   * exposure it only has to lift the opening off the dark-core value.
   */
  window_glow: {
    name: 'plaster',
    surface: 'plaster',
    opts: {
      vertexMasks: true,
      tint: 0x6a5a45,
      scale: 1.2,
      three: { emissive: 0xffb066, emissiveIntensity: 1.1, toneMapped: true },
    },
  },
  /**
   * A lit sign face: a marquee letterboard, a blade sign, a diner's name over
   * the door. It sits between the two above on purpose — `window_glow` is a
   * whole room catching one bulb and reads as a value, not as a light, while
   * `emissive_warm` is the bulb itself and blows out anything larger than a
   * few centimetres. A sign board is neither: a painted panel with a bank of
   * lamps a hand's width behind it, bright enough to be the brightest thing on
   * a night street and still hold its lettering instead of clipping to white.
   */
  sign_glow: {
    name: 'plaster',
    surface: 'plaster',
    opts: {
      scale: 0.9,
      tint: 0xf7e6c8,
      three: { emissive: 0xffd9a0, emissiveIntensity: 3.4, toneMapped: true },
    },
  },
  /** Street-lamp diffuser. Emission is driven by time of day at runtime. */
  lamp_lens: {
    name: 'glass',
    surface: 'glass',
    opts: {
      scale: 1.0,
      three: { emissive: 0xffc47a, emissiveIntensity: 0, opacity: 0.5 },
    },
  },
};
