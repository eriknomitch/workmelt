#!/usr/bin/env node
/**
 * Local multiplayer dev: runs the Vite dev server (client, :5173) and the
 * relay (:8787) side by side. The client's src/net/config.js auto-connects to
 * ws://<host>:8787 in dev, so two browser tabs on the same ?room=… play together.
 *
 *   npm run dev:mp
 *   → open http://localhost:5173  (a room code is added to the URL)
 *   → copy the invite link / open it in a second tab to test
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function run(name, cmd, args, env) {
  const p = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'pipe' });
  const tag = `[${name}]`;
  p.stdout.on('data', (d) => process.stdout.write(prefix(tag, d)));
  p.stderr.on('data', (d) => process.stderr.write(prefix(tag, d)));
  p.on('exit', (code) => {
    console.log(`${tag} exited (${code}); shutting down`);
    process.exit(code ?? 0);
  });
  return p;
}

function prefix(tag, buf) {
  return String(buf)
    .split('\n')
    .map((l) => (l ? `${tag} ${l}` : l))
    .join('\n');
}

const vite = run('client', resolve(root, 'node_modules/.bin/vite'), ['--port', '5173', '--strictPort']);
const relay = run('relay', process.execPath, [resolve(root, 'server/index.mjs')], { PORT: '8787' });

const bye = () => {
  vite.kill();
  relay.kill();
  process.exit(0);
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);

console.log('\n  Multiplayer dev up:');
console.log('    client  http://localhost:5173');
console.log('    relay   ws://localhost:8787/ws');
console.log('  Open the URL, copy the invite link, open it in a second tab.\n');
