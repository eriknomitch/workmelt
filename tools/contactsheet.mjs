#!/usr/bin/env node
/**
 * Build a reviewable contact sheet from everything in `artifacts/shots/`.
 *
 * Screenshots are only useful if you can see them side by side with the
 * conditions that produced them. Each shot written by `src/dev/screenshot.js`
 * (F2) or `tools/attach-shot.mjs` carries a JSON sidecar with camera pose,
 * quality preset and a `__PERF__.stats()` reading; this stitches all of that
 * into one page, newest first, with the frame cost under each image.
 *
 *   node tools/contactsheet.mjs                    # -> artifacts/index.html
 *   node tools/contactsheet.mjs --open             # print the file:// URL
 *   node tools/contactsheet.mjs --inline           # embed PNGs (self-contained)
 *   node tools/contactsheet.mjs --limit=24
 *
 * By default images are referenced relatively, which keeps the page a few kB —
 * open it straight off disk. `--inline` base64s the PNGs into the HTML so the
 * page is a single self-contained file you can hand to someone or publish; that
 * inflates it by ~4/3 of the total PNG size, so it is opt-in and capped.
 */
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { resolve, relative, basename } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  })
);

const root = resolve(import.meta.dirname, '..');
const SHOTS = resolve(root, String(args.dir ?? 'artifacts/shots'));
const OUT = resolve(root, String(args.out ?? 'artifacts/index.html'));
const LIMIT = Number(args.limit ?? 60);
const INLINE = !!args.inline;
/** Refuse to build an unopenable page: browsers choke well before this. */
const INLINE_BUDGET = 120 * 1024 * 1024;

if (!existsSync(SHOTS)) {
  console.error(`No shots directory at ${relative(root, SHOTS)}.\n`);
  console.error('Take some first:');
  console.error('  npm run dev   then press F2 in the game');
  console.error('  node tools/attach-shot.mjs        (screenshots a running browser, HUD included)');
  process.exit(1);
}

const pngs = readdirSync(SHOTS)
  .filter((f) => f.endsWith('.png'))
  .map((f) => {
    const full = resolve(SHOTS, f);
    return { file: f, full, mtime: statSync(full).mtimeMs, bytes: statSync(full).size };
  })
  .sort((a, b) => b.mtime - a.mtime)
  .slice(0, LIMIT);

if (!pngs.length) {
  console.error(`No PNGs in ${relative(root, SHOTS)}. Press F2 in the game, or run tools/attach-shot.mjs.`);
  process.exit(1);
}

let inlineTotal = 0;
const cards = pngs.map((p) => {
  const sidecar = p.full.replace(/\.png$/, '.json');
  let meta = {};
  if (existsSync(sidecar)) {
    try {
      meta = JSON.parse(readFileSync(sidecar, 'utf8'));
    } catch {
      /* a broken sidecar must not drop the image from the sheet */
    }
  }

  let src = relative(resolve(OUT, '..'), p.full).split('\\').join('/');
  if (INLINE) {
    inlineTotal += p.bytes;
    if (inlineTotal <= INLINE_BUDGET) {
      src = `data:image/png;base64,${readFileSync(p.full).toString('base64')}`;
    } else {
      console.warn(`[contactsheet] inline budget reached — ${p.file} left as a file reference`);
    }
  }
  return { ...p, meta, src };
});

const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function facts(meta) {
  const out = [];
  const perf = meta.perf;
  if (perf?.fps) out.push(`${perf.fps.p50} fps · 1% low ${perf.fps.low1}`);
  if (perf?.frameMs) out.push(`frame ${perf.frameMs.p50} ms · p99 ${perf.frameMs.p99} ms`);
  if (perf?.bound) out.push(`bound: ${perf.bound}`);
  if (perf?.counters) out.push(`${perf.counters.drawCalls} calls · ${(perf.counters.triangles / 1e6).toFixed(2)}M tris`);
  if (meta.quality) out.push(`quality: ${meta.quality}`);
  if (meta.drawingBuffer) out.push(`buffer ${meta.drawingBuffer.w}×${meta.drawingBuffer.h}`);
  else if (meta.viewport) out.push(`viewport ${meta.viewport.w}×${meta.viewport.h} @${meta.viewport.dpr ?? 1}x`);
  if (meta.camera?.position) out.push(`cam [${meta.camera.position.join(', ')}]`);
  if (meta.frame != null) out.push(`frame #${meta.frame}`);
  return out;
}

const html = `<title>Claude of Duty — shots</title>
<style>
  :root { color-scheme: dark light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    background: #0b0e12; color: #d7e2ea;
  }
  h1 { font-size: 15px; letter-spacing: .12em; text-transform: uppercase; margin: 0 0 4px; }
  .sub { color: #7d8b98; margin-bottom: 20px; }
  .grid { display: grid; gap: 18px; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); }
  figure { margin: 0; background: #12171d; border: 1px solid #212a33; border-radius: 6px; overflow: hidden; }
  figure img { display: block; width: 100%; height: auto; background: #000; cursor: zoom-in; }
  figcaption { padding: 9px 11px 11px; }
  .name { color: #eaf2f8; word-break: break-all; margin-bottom: 5px; }
  .facts { color: #8a99a7; font-size: 11.5px; }
  .facts span { display: block; }
  /* Click to inspect at full size — a contact sheet you cannot zoom is a poster. */
  img:target, .full img { cursor: zoom-out; }
  dialog { border: none; background: #000; padding: 0; max-width: 96vw; max-height: 96vh; }
  dialog img { width: auto; max-width: 96vw; max-height: 96vh; }
  dialog::backdrop { background: rgba(0,0,0,.85); }
  @media (prefers-color-scheme: light) {
    body { background: #f4f6f8; color: #1d262e; }
    figure { background: #fff; border-color: #dde3e9; }
    .name { color: #101820; } .sub, .facts { color: #5c6a77; }
  }
</style>
<h1>Claude of Duty — shots</h1>
<div class="sub">${cards.length} shot${cards.length === 1 ? '' : 's'} from ${esc(relative(root, SHOTS))} · newest first · generated ${new Date().toISOString()}</div>
<div class="grid">
${cards
  .map(
    (c) => `  <figure>
    <img src="${esc(c.src)}" alt="${esc(c.file)}" loading="lazy">
    <figcaption>
      <div class="name">${esc(c.meta.name ? `${c.meta.name} — ${c.file}` : c.file)}</div>
      <div class="facts">${facts(c.meta).map((f) => `<span>${esc(f)}</span>`).join('')}</div>
    </figcaption>
  </figure>`
  )
  .join('\n')}
</div>
<dialog id="zoom"><img alt=""></dialog>
<script>
  // Click any thumbnail for a full-size view; Esc or a second click closes it.
  const dlg = document.getElementById('zoom');
  const big = dlg.querySelector('img');
  document.querySelectorAll('.grid img').forEach((img) => {
    img.addEventListener('click', () => { big.src = img.src; big.alt = img.alt; dlg.showModal(); });
  });
  dlg.addEventListener('click', () => dlg.close());
</script>
`;

writeFileSync(OUT, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(
  JSON.stringify(
    { ok: true, out: relative(root, OUT), shots: cards.length, inline: INLINE, sizeKb: +kb },
    null,
    2
  )
);
if (args.open) console.log(`file://${OUT}`);
