import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

/**
 * Receives screenshots POSTed by `src/dev/screenshot.js` (F2 / `__SHOT__()`) and
 * writes them into `artifacts/shots/` alongside a JSON sidecar.
 *
 * Dev only (`apply: 'serve'`). A production build has no sink, which the client
 * detects from the 404 and falls back to a browser download — so the same key
 * works in both places, it just lands somewhere less useful in a build.
 *
 * The PNG arrives as a raw body with metadata in `x-shot-meta`, so nothing has to
 * be base64-encoded on the way across.
 */
function shotSink({ dir = 'artifacts/shots' } = {}) {
  return {
    name: 'ow-shot-sink',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const outDir = resolve(root, dir);

      server.middlewares.use('/__shot', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('POST only');
          return;
        }

        const chunks = [];
        let bytes = 0;
        // A 4K PNG is a few MB; refuse anything absurd rather than buffering it.
        const LIMIT = 64 * 1024 * 1024;

        req.on('data', (c) => {
          bytes += c.length;
          if (bytes > LIMIT) {
            res.statusCode = 413;
            res.end('too large');
            req.destroy();
            return;
          }
          chunks.push(c);
        });

        req.on('end', () => {
          if (res.writableEnded) return;
          try {
            let meta = {};
            const raw = req.headers['x-shot-meta'];
            if (raw) {
              try {
                meta = JSON.parse(decodeURIComponent(raw));
              } catch {
                /* a malformed sidecar must not lose the image */
              }
            }

            const url = new URL(req.url ?? '/', 'http://localhost');
            const name = safeName(url.searchParams.get('name') || meta.name || 'shot');
            // Sortable, filename-safe, and unique per second without a counter.
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
            const base = `${stamp}_${name}`;

            mkdirSync(outDir, { recursive: true });
            const png = resolve(outDir, `${base}.png`);
            writeFileSync(png, Buffer.concat(chunks));
            writeFileSync(
              resolve(outDir, `${base}.json`),
              JSON.stringify({ ...meta, file: `${base}.png`, bytes }, null, 2)
            );

            const rel = relative(root, png);
            server.config.logger.info(`  shot  ${rel}  (${(bytes / 1024).toFixed(0)} kB)`);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true, path: rel, bytes }));
          } catch (err) {
            res.statusCode = 500;
            res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
          }
        });
      });
    },
  };
}

function safeName(s) {
  return (
    String(s)
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'shot'
  );
}

export default defineConfig({
  plugins: [shotSink()],
  // Bind IPv4 explicitly: the default `localhost` binds ::1 only on macOS,
  // which the capture harness (127.0.0.1) cannot reach.
  // `hmr: false` when the capture harness owns the server (OW_NO_HMR=1): a file
  // saved by a concurrently-working agent otherwise reloads the page mid-capture
  // and playwright fails with "Execution context was destroyed".
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: process.env.OW_NO_HMR ? false : undefined,
  },
  preview: { host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 4096 },
  // Large binary game assets served verbatim.
  assetsInclude: ['**/*.ktx2', '**/*.hdr', '**/*.exr', '**/*.bin', '**/*.glb'],
});
