/**
 * Standalone visual harness for the weapons subsystem.
 *
 * The game scene is dark, cluttered and owned by other agents, which makes it a
 * poor place to judge a weapon model. This page boots ONLY materials + the
 * viewmodel against a small studio rig, so silhouette, proportion, chamfers,
 * texel density and hand posing can be reviewed honestly.
 *
 *   /src/weapons/preview.html?w=rifle&view=hero
 *
 * views: hero | side | top | muzzle | optic | grip | stock | hands | fp | ads |
 *        sprint | reload | inspect
 * Dev tool: nothing in the game imports it.
 */
import * as THREE from 'three';
import { MaterialSystem } from '../materials/index.js';
import { Rng } from '../core/rng.js';
import { WeaponMaterials } from './materials.js';
import { Viewmodel } from './viewmodel.js';
import { WEAPON_DEFS } from './defs.js';
import { buildRifle } from './models/rifle.js';
import { buildSmg } from './models/smg.js';
import { buildPistol } from './models/pistol.js';
import { buildG31 } from './models/g31.js';
import { buildSniper } from './models/sniper.js';

const params = new URLSearchParams(location.search);
const WEAPON = params.get('w') ?? 'rifle';
const VIEW = params.get('view') ?? 'hero';
const TIME = Number(params.get('t') ?? 0);
const ARMS = params.get('arms') !== '0';

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.004, 60);

/* ----------------------------------------------------------------- studio -- */
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: { uSun: { value: new THREE.Vector3(-0.35, 0.6, 0.72).normalize() } },
  vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = (projectionMatrix * modelViewMatrix * vec4(position,1.0)).xyww; }`,
  fragmentShader: `
    varying vec3 vD; uniform vec3 uSun;
    void main(){
      vec3 d = normalize(vD);
      vec3 c = mix(vec3(0.30,0.33,0.38), vec3(0.10,0.14,0.22), smoothstep(0.0,0.7,d.y));
      c = mix(vec3(0.055,0.05,0.045), c, smoothstep(-0.25,0.02,d.y));
      float s = max(dot(d, normalize(uSun)), 0.0);
      c += vec3(1.0,0.94,0.86) * pow(s, 40.0) * 1.6;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), skyMat);
sky.frustumCulled = false;
/**
 * BACKDROP FIRST, AND OUT OF THE DEPTH TEST.
 *
 * The game draws the world and the viewmodel into separate targets and
 * composites one over the other (render/index.js steps 9 + 14), so nothing the
 * viewmodel writes into depth can reject a world pixel. This page has one scene
 * and one pass, which is close enough for every view except a scoped optic: the
 * sniper's aperture mask (see parts.js buildOptic) is a depth-only disc that is
 * supposed to hand its pixels back to the world, and against a shared depth
 * buffer it ate the sky instead and rendered the sight picture solid black.
 * Drawing the backdrop first, untested, restores the game's ordering.
 */
skyMat.depthTest = false;
sky.renderOrder = -2;
scene.add(sky);

const key = new THREE.DirectionalLight(0xfff2e0, 3.4);
key.position.set(-2.6, 3.4, 3.0);
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0x9fb8dd, 1.25);
fill.position.set(3.2, 0.6, -1.8);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffd9b0, 1.5);
rim.position.set(1.4, -0.8, -3.4);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0x91b4ff, 0x2b2620, 0.9));

const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();

/* -------------------------------------------------------------- materials -- */
const materials = new MaterialSystem({ renderer });
await materials.init({ config: { quality: 'ultra', q: { anisotropy: 16 } } });

const env = pmrem.fromScene(scene, 0, 0.05, 30);
scene.environment = env.texture;
scene.environmentIntensity = 1.0;

/* -------------------------------------------------------------- viewmodel -- */
const events = {
  handlers: new Map(),
  on(t, f) {
    (this.handlers.get(t) ?? this.handlers.set(t, new Set()).get(t)).add(f);
    return () => this.handlers.get(t)?.delete(f);
  },
  emit(t, p) {
    for (const f of this.handlers.get(t) ?? []) f(p);
  },
};
const ctx = {
  scene,
  camera,
  viewScene: scene,
  viewCamera: camera,
  canvas,
  config: { quality: 'ultra', q: { anisotropy: 16 } },
  events,
  time: { elapsed: 0, dt: 1 / 60, frame: 0 },
  rng: new Rng(0xbeef1234),
  get: (id) => (id === 'materials' ? materials : null),
  peek: (id) => (id === 'materials' ? materials : null),
  has: (id) => id === 'materials',
};

const mats = new WeaponMaterials(ctx);
const vm = new Viewmodel(ctx, mats);
const FIRST_PERSON = ['fp', 'ads', 'sprint', 'reload', 'inspect'].includes(VIEW);
vm.trackCamera = FIRST_PERSON;
if (!FIRST_PERSON) {
  vm.rigOverride = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
}

const builders = { rifle: buildRifle, smg: buildSmg, pistol: buildPistol, g31: buildG31, sniper: buildSniper };
const stats = {};
for (const id of Object.keys(builders)) {
  const def = { ...WEAPON_DEFS[id] };
  def.cycleTime = 60 / def.rpm;
  const entry = vm.addWeapon(builders[id](), def);
  stats[id] = entry.tris;
}
vm.setActive(WEAPON);
if (!ARMS) {
  vm.armL.root.visible = false;
  vm.armR.root.visible = false;
}

const state = {
  ads: VIEW === 'ads',
  sprint: VIEW === 'sprint',
  lowReady: false,
  speed: 0,
  crouch: false,
  airborne: false,
  trigger: false,
  empty: false,
};
if (VIEW === 'reload') vm.play('reloadEmpty');
if (VIEW === 'inspect') vm.play('inspect');

// Settle the animation stack, then optionally scrub to a time.
for (let i = 0; i < 20; i++) vm.update(1 / 60, state);
if (VIEW === 'ads') vm.adsT = 1;
if (TIME > 0) {
  const steps = Math.round(TIME * 60);
  for (let i = 0; i < steps; i++) vm.update(1 / 60, state);
}
vm.update(1 / 60, state);

/* ------------------------------------------------------------------ views -- */
const w = vm.active;
w.group.updateMatrixWorld(true);
const bbox = new THREE.Box3().setFromObject(w.group);
const centre = bbox.getCenter(new THREE.Vector3());
const size = bbox.getSize(new THREE.Vector3());
const span = Math.max(size.x, size.y, size.z);

/**
 * Look at a weapon-local point from a direction, fitting a sphere of `radius`
 * metres to the SHORTER screen axis. A weapon is a long thin object on a 16:9
 * canvas, so fitting to the vertical FOV alone leaves it tiny in frame.
 */
function frame(localTarget, dir, radius, fov = 38) {
  const t = new THREE.Vector3().fromArray(localTarget);
  camera.fov = fov;
  const aspect = camera.aspect;
  const halfV = (fov * 0.5 * Math.PI) / 180;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  // The tightest axis wins vertically; horizontally we have far more room, so
  // fit the long axis to the horizontal field and let height take care of itself.
  const d = radius / Math.tan(Math.min(halfV * 2.6, halfH));
  camera.position.copy(t).addScaledVector(new THREE.Vector3().fromArray(dir).normalize(), d);
  camera.lookAt(t);
  camera.updateProjectionMatrix();
}

const nodes = w.model.nodes;
const bore = nodes.muzzle[1];
switch (VIEW) {
  case 'hero':
    frame([0, bore * 0.75, (bbox.min.z + bbox.max.z) * 0.5], [0.62, 0.3, 1], span * 0.6, 34);
    break;
  case 'side':
    frame([0, bore * 0.7, (bbox.min.z + bbox.max.z) * 0.5], [1, 0.04, 0.02], span * 0.56, 34);
    break;
  case 'top':
    frame([0, bore * 0.7, (bbox.min.z + bbox.max.z) * 0.5], [0.02, 1, 0.05], span * 0.56, 34);
    break;
  case 'muzzle':
    frame(nodes.muzzle, [0.75, 0.4, 0.95], 0.075, 36);
    break;
  case 'optic':
    frame(nodes.sight, [0.85, 0.42, 0.9], 0.085, 36);
    break;
  case 'grip':
    frame([0, -0.02, 0.01], [1.0, 0.25, 0.75], 0.12, 38);
    break;
  case 'stock':
    frame([0, bore - 0.01, 0.16], [0.9, 0.3, 0.8], 0.14, 38);
    break;
  case 'hands':
    frame([0, -0.03, -0.12], [0.6, 0.15, 1.0], 0.22, 40);
    break;
  case 'reload':
  case 'inspect':
  case 'fp':
  case 'sprint':
    camera.position.set(0, 0, 0);
    camera.quaternion.identity();
    camera.fov = 60;
    camera.updateProjectionMatrix();
    break;
  case 'ads':
    camera.position.set(0, 0, 0);
    camera.quaternion.identity();
    camera.fov = 60 * (w.def.viewFov ?? 0.86);
    camera.updateProjectionMatrix();
    break;
  default:
    frame([0, bore, 0], [0.6, 0.35, 1], span * 0.62, 34);
}

if (!FIRST_PERSON) {
  // Static views: put the light rig in a sensible place relative to the gun.
  key.position.copy(camera.position).add(new THREE.Vector3(-1.6, 2.4, 0.9));
  key.target.position.copy(centre);
  key.target.updateMatrixWorld();
}

/* ------------------------------------------------------------------ loop --- */
/**
 * Fixed timestep, exactly like the game's capture path (src/dev/shots.js pins
 * `engine.step` to 1000/60 ms when `?capture=1`). This page is screenshotted by
 * shoot.mjs after a fixed number of rAF ticks, so driving the animation stack
 * from `performance.now()` made the grabbed pose depend on boot duration and
 * frame pacing: the same frame index rendered different pixels run to run. The
 * pre-roll above already scrubs with 1/60 steps, so the loop now agrees with it.
 *
 * `?grab=N` additionally freezes the animation after exactly N steps and only
 * then flags `__READY__`, so every frame the screenshot RPC lands on is the same
 * frame. Without it the grabbed pose still depended on how many rAF ticks fitted
 * inside the RPC. `grab=0` (the default when a human opens the page) keeps the
 * animation running forever.
 */
const STEP = 1 / 60;
const GRAB = Math.max(0, Math.round(Number(params.get('grab')) || 0));
let frames = 0;
function tick() {
  const dt = STEP;
  // Held pose: `t=` scrubs to a fixed time in the pre-roll above, and `grab=`
  // stops the clock once the capture frame is reached.
  const frozen = TIME > 0 || (GRAB > 0 && frames >= GRAB);
  ctx.time.elapsed += dt;
  ctx.time.dt = dt;
  ctx.time.frame++;
  if (!frozen) {
    if (VIEW === 'reload' || VIEW === 'inspect') {
      if (!vm.clipPlaying) vm.play(VIEW === 'reload' ? 'reloadEmpty' : 'inspect');
    }
    vm.update(dt, state);
  }
  renderer.render(scene, camera);
  if (++frames === Math.max(4, GRAB)) {
    window.__INFO__ = {
      weapon: WEAPON,
      view: VIEW,
      tris: stats,
      calls: renderer.info.render.calls,
      drawnTris: renderer.info.render.triangles,
      bbox: [size.x, size.y, size.z].map((v) => +v.toFixed(3)),
      bmin: bbox.min.toArray().map((v) => +v.toFixed(3)),
      bmax: bbox.max.toArray().map((v) => +v.toFixed(3)),
      rig: vm.rig.position.toArray().map((v) => +v.toFixed(3)),
      base: vm._basePos.toArray().map((v) => +v.toFixed(3)),
      hip: w.def.hipPos,
      adsT: +vm.adsT.toFixed(3),
      sprintT: +vm.sprintT.toFixed(3),
      clip: vm.clipName,
    };
    window.__READY__ = true;
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
