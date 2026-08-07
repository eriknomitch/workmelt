#!/usr/bin/env node
/**
 * GLB -> REFERENCE RENDERS.
 *
 *   node tools/glb-render.mjs <file.glb> [--scale=1] [--out=.shots/<name>]
 *                             [--views=plan,iso,iso-rear,iso-side,eye] [--cut=<m>]
 *
 * The companion to `glb-plan.mjs`. That one measures a downloaded model and
 * prints an ASCII height field; this one LOOKS at it, writing an orthographic
 * plan and a few perspective angles into `.shots/` so a map can be authored
 * against the picture and not only the numbers.
 *
 * Both exist because a height field cannot tell you three things the map module
 * needs: what the masses actually ARE (a grid of tall cells is a tower block or
 * a stack of containers and the plan reads identically either way), the palette
 * to map onto `palette.js` keys, and whether a mass is a building or a prop.
 *
 * NOTHING HERE SHIPS — same rule as `glb-plan.mjs`. Workmelt generates every
 * mesh in code (AGENTS.md, "Importing a 3D model"); a downloaded map model is
 * reference material and the renders are notes taken from it. This is why the
 * output goes to `.shots/` (gitignored scratch) and not to `shots/`, which is
 * the committed baseline set `tools/baseline.mjs` diffs against.
 *
 * Unlike `glb-plan.mjs` this DOES use three's GLTFLoader, because the whole
 * point is the shaded look — which means it needs a real WebGL context, so it
 * drives a headless Chromium over a throwaway static server rooted at the repo.
 * A GPU-less sandbox still works via SwiftShader, just slower.
 *
 * VIEWS
 *   plan       orthographic top-down, aspect-corrected — the layout reference
 *   iso        3/4 perspective; `iso-rear` and `iso-side` are the other angles
 *   eye        1.7 m eye height looking down the long axis — a scale sanity
 *              check, since props that look right in plan are often not
 *
 * `--cut=<m>` drops every mesh sitting entirely above that height before
 * rendering: roofs off, so a plan view shows interiors instead of rooftops.
 * The threshold is in the SAME units as `--scale` produces (i.e. post-scale
 * metres), matching `glb-plan.mjs`'s slices.
 */

import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

/* ─────────────────────────────────────────────────────────────── arguments ── */

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const flag = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};

if (!file) {
  console.error('usage: node tools/glb-render.mjs <file.glb> [--scale=1] [--out=.shots/<name>] [--views=plan,iso,iso-rear,iso-side,eye] [--cut=<m>]');
  process.exit(2);
}

const ROOT = path.resolve(import.meta.dirname, '..');
const abs = path.resolve(file);
if (!fs.existsSync(abs)) { console.error(`no such file: ${file}`); process.exit(2); }
if (!abs.startsWith(ROOT)) { console.error('the model must live inside the repo (assets-src/ is the home for it)'); process.exit(2); }

const SCALE = Number(flag('scale', '1'));
const CUT = flag('cut', '') === '' ? Infinity : Number(flag('cut', ''));
const VIEWS = flag('views', 'plan,iso,iso-rear,iso-side,eye').split(',').filter(Boolean);
const OUT = flag('out', path.join('.shots', path.basename(abs).replace(/\.(glb|gltf)$/i, '')));
const W = Number(flag('width', '1400'));
const H = Number(flag('height', '1000'));

/* ───────────────────────────────────────────────────────── the render page ── */

// Served from the repo root so the importmap can reach node_modules and the
// loader can fetch the model over http — a file:// page can do neither.
const PAGE = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:#20242b;overflow:hidden}canvas{display:block}</style>
<script type="importmap">
{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}
</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const q = new URLSearchParams(location.search);
const W = Number(q.get('w')), H = Number(q.get('h'));
const SCALE = Number(q.get('scale')), CUT = Number(q.get('cut'));

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H);
renderer.setClearColor(0x20242b);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x40382e, 2.2));
const sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
sun.position.set(6, 12, 4);
scene.add(sun);

new GLTFLoader().load(q.get('model'), (gltf) => {
  const root = gltf.scene;
  root.scale.setScalar(SCALE);
  root.updateMatrixWorld(true);

  // Roofs off: hide anything sitting ENTIRELY above the cut, so a wall that
  // straddles it still draws and the plan keeps its rooms.
  let hidden = 0, meshes = 0;
  if (Number.isFinite(CUT)) {
    const b = new THREE.Box3();
    root.traverse((o) => { if (o.isMesh && ++meshes && b.setFromObject(o).min.y >= CUT) { o.visible = false; hidden++; } });
  }
  scene.add(root);

  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());
  const R = Math.max(size.x, size.z);

  function persp(yaw, pitch) {
    const c = new THREE.PerspectiveCamera(38, W / H, 0.1, R * 8);
    const d = R * 1.15;
    c.position.set(mid.x + Math.sin(yaw) * d * Math.cos(pitch), box.max.y + d * Math.sin(pitch), mid.z + Math.cos(yaw) * d * Math.cos(pitch));
    c.lookAt(mid.x, box.min.y + size.y * 0.25, mid.z);
    return c;
  }

  const views = {
    plan: () => {
      // Fit the long (Z) axis and derive the width from the canvas aspect, or
      // the plan comes out stretched and every coordinate read off it is wrong.
      const hh = Math.max(size.z, size.x / (W / H)) / 2 * 1.04, hw = hh * (W / H);
      const c = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.1, R * 4 + size.y);
      c.position.set(mid.x, box.max.y + R, mid.z);
      c.up.set(0, 0, -1);          // north (-Z) up, matching LEVEL space
      c.lookAt(mid.x, 0, mid.z);
      return c;
    },
    iso: () => persp(0.8, 0.55),
    'iso-rear': () => persp(0.8 + Math.PI, 0.55),
    'iso-side': () => persp(0.8 + Math.PI / 2, 0.42),
    eye: () => {
      const c = new THREE.PerspectiveCamera(70, W / H, 0.1, R * 6);
      c.position.set(mid.x, box.min.y + 1.7, box.max.z - size.z * 0.06);
      c.lookAt(mid.x, box.min.y + 1.7, box.min.z);
      return c;
    },
  };

  window.__shoot = (name) => {
    if (!views[name]) throw new Error('unknown view: ' + name);
    renderer.render(scene, views[name]());
  };
  window.__INFO__ = { extent: size.toArray(), min: box.min.toArray(), max: box.max.toArray(), hidden, meshes };
  window.__READY__ = true;
}, undefined, (e) => { window.__ERR__ = String(e && e.message || e); });
</script>`;

/* ──────────────────────────────────────────────────────────────── the run ── */

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__render') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
    return;
  }
  const target = path.join(ROOT, url);
  if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(target)] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// SwiftShader keeps this working on a GPU-less sandbox; it is the same fallback
// tools/capture.mjs relies on, just without the frame-rate stakes.
const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.error('  [page]', e.message));

const model = '/' + path.relative(ROOT, abs).split(path.sep).join('/');
await page.goto(`http://127.0.0.1:${port}/__render?model=${encodeURIComponent(model)}&scale=${SCALE}&cut=${CUT}&w=${W}&h=${H}`);
await page.waitForFunction('window.__READY__ || window.__ERR__', null, { timeout: 120000 });

const err = await page.evaluate('window.__ERR__');
if (err) {
  console.error(`failed to load ${file}: ${err}`);
  await browser.close(); server.close();
  process.exit(1);
}

const info = await page.evaluate('window.__INFO__');
const [ex, ey, ez] = info.extent;
console.log(`${path.basename(abs)} — extent ${ex.toFixed(1)} x ${ey.toFixed(1)} x ${ez.toFixed(1)} (--scale=${SCALE})`);
if (Number.isFinite(CUT)) {
  // Worth saying out loud: a model whose buildings are single floor-to-roof
  // meshes has nothing sitting ENTIRELY above the cut, so the flag is a no-op
  // and the plan still shows rooftops. Silently identical output would read as
  // "the interiors look like that", which is the wrong conclusion.
  console.log(`roofs off above ${CUT} m — hid ${info.hidden}/${info.meshes} meshes`);
  if (info.hidden === 0) console.log('  (nothing sits entirely above the cut; this model has no separate roof meshes)');
}

fs.mkdirSync(path.dirname(path.resolve(ROOT, OUT)), { recursive: true });
for (const view of VIEWS) {
  await page.evaluate((v) => window.__shoot(v), view);
  const out = path.resolve(ROOT, `${OUT}-${view}.png`);
  await page.locator('canvas').screenshot({ path: out });
  console.log('wrote', path.relative(ROOT, out));
}
console.log('\nNow READ those files back with the Read tool — a .png nobody looked at is not a reference render.');

await browser.close();
server.close();
