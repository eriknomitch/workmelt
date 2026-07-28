import { defineConfig } from 'vite';

export default defineConfig({
  // Bind IPv4 explicitly: the default `localhost` binds ::1 only on macOS,
  // which the capture harness (127.0.0.1) cannot reach.
  // `hmr: false` when the capture harness owns the server (OW_NO_HMR=1): a file
  // saved by a concurrently-working agent otherwise reloads the page mid-capture
  // and playwright fails with "Execution context was destroyed".
  // Port: 5273 rather than Vite's default 5173, because another checkout on this
  // machine may already own 5173 and `strictPort` turns that into a hard failure
  // rather than a silent hop to 5174. `OW_PORT` overrides it; every capture
  // harness reads the same variable so a one-off port applies end to end.
  server: {
    host: '127.0.0.1',
    port: Number(process.env.OW_PORT ?? 5273),
    strictPort: true,
    hmr: process.env.OW_NO_HMR ? false : undefined,
  },
  preview: { host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 4096 },
  // Large binary game assets served verbatim.
  assetsInclude: ['**/*.ktx2', '**/*.hdr', '**/*.exr', '**/*.bin', '**/*.glb'],
});
