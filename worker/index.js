/**
 * Cloudflare Worker entry — hosts the built client and the multiplayer relay
 * from a single Worker, so the game and its WebSocket share one origin (the
 * client connects to `wss://<same-host>/ws` automatically).
 *
 *   • `/ws?room=CODE`  → routed to the Room Durable Object named CODE, so every
 *                        player in a room lands on the same instance.
 *   • `/healthz`       → liveness.
 *   • everything else  → served from the built client in ./dist via the ASSETS
 *                        binding (SPA fallback to index.html so deep links work).
 *
 * Deploy:  npm run build && npx wrangler deploy   (see MULTIPLAYER.md)
 */
export { Room } from './room.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }
      const room = (url.searchParams.get('room') || 'lobby')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 24) || 'lobby';
      const id = env.ROOM.idFromName(room);
      const stub = env.ROOM.get(id);
      return stub.fetch(request);
    }

    if (url.pathname === '/healthz') {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } });
    }

    // Static client (and SPA fallback) via the Assets binding.
    return env.ASSETS.fetch(request);
  },
};
