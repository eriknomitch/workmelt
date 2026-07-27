/**
 * DEV ONLY — standalone character rig for iterating on the soldier model and
 * its animation without booting the whole game. Studio lighting, neutral
 * background, a real PMREM environment so metals and the goggle glass behave.
 *
 *   node src/ai/shoot.mjs --view=front --variant=vanguard --out=/tmp/ai-front.png
 *
 * Query params: variant, view (front|back|three|face|gear|legs|line), clip, phase, aim
 */

import * as THREE from 'three';
import { Rng } from '../core/rng.js';
import { SoldierMaterials, liveryFor } from './livery.js';
import { buildSoldier, VARIANTS } from './soldier.js';
import { RIG } from './rig.js';
import { Animator } from './animator.js';

const q = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.05, 60);

/* ---- environment: sky gradient + ground bounce, through PMREM ---- */
const envScene = new THREE.Scene();
{
  const g = new THREE.SphereGeometry(20, 32, 24);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      varying vec3 vP;
      void main(){
        vec3 d = normalize(vP);
        vec3 sky = mix(vec3(0.55,0.68,0.92), vec3(0.16,0.22,0.32), clamp(d.y*1.4,0.0,1.0));
        vec3 ground = vec3(0.18,0.16,0.13);
        vec3 c = mix(ground, sky, smoothstep(-0.12, 0.10, d.y));
        // sun disc for a real specular highlight
        float s = max(0.0, dot(d, normalize(vec3(-0.45,0.62,0.35))));
        c += vec3(6.0,5.4,4.6) * pow(s, 900.0);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  envScene.add(new THREE.Mesh(g, m));
}
const pmrem = new THREE.PMREMGenerator(renderer);
const env = pmrem.fromScene(envScene, 0.04).texture;
scene.environment = env;
scene.background = new THREE.Color(0x1b1f24);

/* ---- key / fill / rim ---- */
const key = new THREE.DirectionalLight(0xfff3e0, 3.1);
key.position.set(-3.2, 4.4, 2.6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -1.6;
key.shadow.camera.right = 1.6;
key.shadow.camera.top = 2.4;
key.shadow.camera.bottom = -0.2;
key.shadow.bias = -0.0006;
scene.add(key);
const rim = new THREE.DirectionalLight(0x9fc4ff, 1.1);
rim.position.set(2.6, 2.0, -3.4);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0x9ab4d0, 0x2a231b, 0.55));

/* ---- ground ---- */
{
  const g = new THREE.CircleGeometry(6, 48).rotateX(-Math.PI / 2);
  const m = new THREE.MeshStandardMaterial({ color: 0x2a2723, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(g, m);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

/* ---- characters ---- */
const rng = new Rng(0xa11ce);
const materials = new SoldierMaterials();

const view = q.get('view') ?? 'front';
const variantName = q.get('variant') ?? 'vanguard';
const names = view === 'line' ? Object.keys(VARIANTS) : [variantName];
const actors = [];

for (let i = 0; i < names.length; i++) {
  // One livery per body in the line-up, so the preview shows the palette doing
  // the job it exists for rather than three bodies in the same colour.
  const def = buildSoldier(names[i], { rng: rng.fork(), materials, livery: liveryFor(i) });
  const { bones, skeleton, root } = RIG.createSkeleton();
  const mesh = new THREE.SkinnedMesh(def.geometry, def.materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.add(root);
  group.add(mesh);
  mesh.bind(skeleton);
  group.position.x = (i - (names.length - 1) / 2) * 1.15;
  scene.add(group);
  const animator = new Animator(RIG, bones, { rng: rng.fork() });
  actors.push({ group, mesh, bones, animator, def });
  console.info(`[preview] ${names[i]} ${def.stats.triangles} tris ${def.stats.vertices} verts`);
}

/* ---- camera framing ---- */
const VIEWS = {
  front: { pos: [0.0, 1.05, 3.1], look: [0, 1.02, 0], fov: 34 },
  three: { pos: [1.85, 1.25, 2.45], look: [0, 1.02, 0], fov: 34 },
  back: { pos: [0.1, 1.15, -3.0], look: [0, 1.02, 0], fov: 34 },
  face: { pos: [0.34, 1.68, 0.86], look: [0, 1.62, 0.02], fov: 24 },
  gear: { pos: [0.55, 1.32, 1.25], look: [0, 1.26, 0.05], fov: 30 },
  legs: { pos: [0.7, 0.55, 1.5], look: [0, 0.5, 0], fov: 32 },
  line: { pos: [0, 1.25, 4.6], look: [0, 1.05, 0], fov: 40 },
  // 25 m at the game's on-screen scale: a 1.75 m man subtends 4.0 deg, which in
  // a 1600 px frame at 30 deg vertical fov is ~215 px tall — exactly his
  // footprint in the `combat` shot. This is the view that proves the camo macro
  // blotches survive the mip chain instead of averaging to flat tan.
  far: { pos: [0.9, 1.35, 25], look: [0, 1.0, 0], fov: 30 },
  // 12 m: mid-range, where the gear silhouette has to read
  mid: { pos: [0.6, 1.3, 12], look: [0, 1.0, 0], fov: 30 },
};
const V = VIEWS[view] ?? VIEWS.front;
camera.position.fromArray(V.pos);
camera.lookAt(new THREE.Vector3().fromArray(V.look));
camera.fov = V.fov;
camera.updateProjectionMatrix();

/* ---- animation ---- */
const clip = q.get('clip') ?? 'idle';
const phase = Number(q.get('phase') ?? 0);
const aim = q.get('aim');
const aimTarget = new THREE.Vector3(
  ...(aim ? aim.split(',').map(Number) : [0.5, 1.6, 6])
);

/** Frame index is the only clock here: see the loop below. */
const PREVIEW_DT = 1 / 60;
let frameIndex = 0;
let t = phase;
function frame(dt) {
  t = phase + frameIndex * dt;
  for (const a of actors) {
    a.animator.setState({ clip, speed: 1, aimTarget, lookTarget: aimTarget, aimWeight: 1 });
    a.animator.update(dt, t);
    a.group.updateMatrixWorld(true);
  }
}

function loop() {
  requestAnimationFrame(loop);
  // This page has no engine, so it has no ctx.time — but it must not read the
  // wall clock either. shoot.mjs pumps a fixed number of frames and screenshots
  // frame N, so a real-dt integration made the pose depend on machine load and
  // on how long the texture bake happened to take. Frame index IS the clock:
  // frame N is always at t = phase + N/60, on any machine, at any frame rate.
  frameIndex++;
  frame(PREVIEW_DT);
  renderer.render(scene, camera);
  if (frameIndex === 4) window.__READY__ = true;
}
requestAnimationFrame(loop);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
