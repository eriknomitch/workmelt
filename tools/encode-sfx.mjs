#!/usr/bin/env node
/**
 * SFX ENCODER — assets-src/ masters → public/sfx/ web-ready Opus.
 *
 *   node tools/encode-sfx.mjs            encode everything
 *   node tools/encode-sfx.mjs shot ui    encode only those groups
 *   node tools/encode-sfx.mjs --force    ignore the up-to-date check
 *
 * Sources come from tools/sfx-sources.mjs. Get the masters with
 * tools/fetch-sfx.sh; they are gitignored, the output here is committed.
 *
 * Three things happen per file, and each is load-bearing:
 *
 *  1. TRANSIENT DETECTION. The firearm masters are ~10 s takes with the shot
 *     somewhere inside and a long room tail after it. We decode to raw PCM,
 *     find the peak sample, and cut a window around it. Doing this by hand for
 *     56 files would be the actual work; doing it by peak is exact and free.
 *
 *  2. MONO. spatial.js panner is HRTF, which downmixes stereo to mono anyway.
 *     Encoding mono is what the graph wants and costs half the bytes.
 *
 *  3. TAIL TRIM + FADE. mixer.js runs its own convolution reverb driven by the
 *     space probe. Baked-in room tail would double-verb every shot, so we keep
 *     only the near field and let the game supply the room.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES, CREDITS } from './sfx-sources.mjs';

/* execFile, never exec: arguments go straight to the binary, so a filename with
 * a space or a quote in it (there are several — "Carl Gustav M45") is passed
 * through verbatim instead of being re-parsed by a shell. */
const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets-src');
const OUT = join(ROOT, 'public', 'sfx');

const RATE = 48000;          // Opus is natively 48 k; anything else resamples twice.
const PEAK_DB = -1.0;        // leave a hair of headroom for the mixer's limiter
const FADE = 0.03;           // seconds, tail fade so a hard cut never clicks

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = new Set(args.filter((a) => !a.startsWith('--')));

/* ── ffmpeg helpers ───────────────────────────────────────────────────────── */

async function have(bin) {
  try { await run(bin, ['-version']); return true; } catch { return false; }
}

/**
 * Locate the loudest sample, in seconds from the start.
 *
 * Decoding the whole file to 8 kHz mono s16 is enough to find a transient to
 * within a millisecond and keeps even a 96 kHz master under a megabyte of RAM.
 */
async function findPeak(file) {
  const { stdout } = await run('ffmpeg', [
    '-v', 'error', '-i', file,
    '-ac', '1', '-ar', '8000', '-f', 's16le', '-',
  ], { encoding: 'buffer', maxBuffer: 1 << 28 });

  const pcm = new Int16Array(stdout.buffer, stdout.byteOffset, stdout.length >> 1);
  let peak = 0, at = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] < 0 ? -pcm[i] : pcm[i];
    if (v > peak) { peak = v; at = i; }
  }
  if (!peak) return null; // silent file — caller skips it
  return at / 8000;
}

/** Trim around the transient, normalize, mono 48 k, encode Opus. */
async function encodeOne(file, dest, { lead, dur, bitrate }) {
  const peak = await findPeak(file);
  if (peak === null) return null;
  const start = Math.max(0, peak - lead);

  // `-ss` before `-i` seeks fast; `atrim` after guarantees an exact length.
  // loudnorm would flatten the dynamics that make a gunshot read as one, so
  // this is peak normalization only.
  const filters = [
    `atrim=0:${dur.toFixed(4)}`,
    'asetpts=PTS-STARTPTS',
    `afade=t=out:st=${Math.max(0, dur - FADE).toFixed(4)}:d=${FADE}`,
    // Plain swr: soxr is absent from most Homebrew ffmpeg builds, and the
    // difference is inaudible once libopus has re-encoded at 48 k anyway.
    `aresample=${RATE}`,
    `alimiter=limit=${dbToLin(PEAK_DB).toFixed(6)}:level=false`,
  ].join(',');

  await run('ffmpeg', [
    '-v', 'error', '-y',
    '-ss', start.toFixed(4), '-i', file,
    '-ac', '1',
    '-af', filters,
    '-c:a', 'libopus', '-b:a', bitrate, '-vbr', 'on',
    '-application', 'audio',
    dest,
  ]);

  // Peak-normalize in a second pass: we now know the trimmed clip's true peak,
  // which the first pass could not (it only saw the untrimmed file).
  const gain = await normalizeGain(dest);
  if (Math.abs(gain) > 0.5) {
    const tmp = `${dest}.tmp.opus`;
    await run('ffmpeg', [
      '-v', 'error', '-y', '-i', dest,
      '-af', `volume=${gain.toFixed(3)}dB`,
      '-c:a', 'libopus', '-b:a', bitrate, '-vbr', 'on', '-application', 'audio',
      tmp,
    ]);
    await rm(dest);
    await rename(tmp, dest);
  }

  const { size } = await stat(dest);
  return { size };
}

function dbToLin(db) { return 10 ** (db / 20); }

/** How many dB to add to bring this file's peak to PEAK_DB. */
async function normalizeGain(file) {
  const { stderr } = await run('ffmpeg', [
    '-v', 'info', '-i', file, '-af', 'volumedetect', '-f', 'null', '-',
  ], { encoding: 'utf8' }).catch((e) => ({ stderr: e.stderr ?? '' }));
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(stderr);
  if (!m) return 0;
  return PEAK_DB - parseFloat(m[1]);
}

/* ── driver ───────────────────────────────────────────────────────────────── */

async function main() {
  if (!(await have('ffmpeg'))) {
    console.error('ffmpeg not found. brew install ffmpeg');
    process.exit(1);
  }
  try {
    await stat(SRC);
  } catch {
    console.error(`no assets-src/ — run tools/fetch-sfx.sh first`);
    process.exit(1);
  }

  const work = SOURCES.filter((e) => !only.size || only.has(e.group));
  if (!work.length) {
    console.error(`nothing matches ${[...only].join(', ')}`);
    process.exit(1);
  }

  await mkdir(OUT, { recursive: true });

  // Start from the manifest already on disk so a filtered run (`… shot ui`)
  // updates just those groups instead of dropping every group it skipped.
  const manifest = only.size ? await readManifest() : {};
  let files = 0, bytes = 0, missing = 0;

  for (const entry of work) {
    const { group, key, src, ...opts } = entry;
    await mkdir(join(OUT, group), { recursive: true });
    const urls = [];

    for (let i = 0; i < src.length; i++) {
      const from = join(SRC, src[i]);
      const name = `${key}_${i}.opus`;
      const dest = join(OUT, group, name);

      try {
        await stat(from);
      } catch {
        console.warn(`  MISS ${src[i]}`);
        missing++;
        continue;
      }

      if (!force && (await newer(dest, from))) {
        urls.push(`${group}/${name}`);
        bytes += (await stat(dest)).size;
        files++;
        continue;
      }

      const res = await encodeOne(from, dest, opts);
      if (!res) { console.warn(`  SILENT ${src[i]}`); missing++; continue; }
      urls.push(`${group}/${name}`);
      bytes += res.size;
      files++;
    }

    if (!urls.length) continue;
    (manifest[group] ??= {})[key] = urls;
    console.log(`  ${group}/${key.padEnd(12)} ${String(urls.length).padStart(2)} variants`);
  }

  await writeFile(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(OUT, 'CREDITS.md'), credits());

  console.log(`\n${files} files, ${(bytes / 1048576).toFixed(2)} MB → public/sfx/`);
  if (missing) console.log(`${missing} source file(s) missing or silent — those fall back to synthesis`);
}

/** Existing manifest, or an empty one if this is a first run. */
async function readManifest() {
  try {
    return JSON.parse(await readFile(join(OUT, 'manifest.json'), 'utf8'));
  } catch { return {}; }
}

/**
 * True when `dest` is a usable, up-to-date encode of `from`.
 *
 * The size check is not paranoia: a killed ffmpeg leaves a zero-byte file
 * behind, and mtime alone would then treat that stub as done forever.
 */
async function newer(dest, from) {
  try {
    const [d, s] = await Promise.all([stat(dest), stat(from)]);
    return d.size > 0 && d.mtimeMs >= s.mtimeMs;
  } catch { return false; }
}

function credits() {
  const lines = [
    '# Sound credits',
    '',
    'Generated by `tools/encode-sfx.mjs`. Everything in `public/sfx/` is derived',
    'from the packs below — trimmed, normalized, downmixed to mono and encoded to',
    '48 kHz Opus. Sources live in `assets-src/` (gitignored, `tools/fetch-sfx.sh`).',
    '',
  ];
  for (const c of CREDITS) {
    lines.push(`## ${c.pack}`, '');
    lines.push(`- **Author:** ${c.authors}`);
    lines.push(`- **License:** ${c.license}${c.attributionRequired ? ' — **attribution required**' : ''}`);
    lines.push(`- **Source:** ${c.url}`);
    lines.push(`- **Used for:** ${c.used}`);
    lines.push('');
  }
  lines.push('---', '');
  lines.push('Anything without a sample here is synthesized at runtime by');
  lines.push('`src/audio/weapons.js`, `foley.js` and `vox.js` — suppressed weapons, enemy');
  lines.push('barks, glass/flesh/rubber footsteps, dry-fire and the low-health cue.');
  lines.push('');
  return lines.join('\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
