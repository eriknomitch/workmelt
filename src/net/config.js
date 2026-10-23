/**
 * Where to connect and which room to join — all derived from the URL so an
 * invite is just a link. The address bar is always a valid share link: if the
 * player arrived without a `?room=`, we mint one and write it back with
 * `history.replaceState`, so "copy the URL" is all it takes to invite a friend.
 */

const CALLSIGNS = [
  'Reaper', 'Ghost', 'Viper', 'Hawk', 'Wolf', 'Raven', 'Fox', 'Bishop',
  'Havoc', 'Cipher', 'Nomad', 'Echo', 'Talon', 'Ruin', 'Saint', 'Vandal',
];

function randomCode(n = 6) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'; // no ambiguous chars
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[(Math.random() * alphabet.length) | 0];
  return s;
}

/**
 * Did this player arrive on somebody's invite link?
 *
 * Read at module load, BEFORE `resolveRoom()` gets a chance to mint a room and
 * write it into the address bar — after that the two cases are indistinguishable.
 * The lobby uses it for nothing more than a line of copy, but that line is the
 * difference between "why am I here" and "you were invited".
 */
export const arrivedByInvite = (() => {
  try {
    return !!new URLSearchParams(location.search).get('room');
  } catch {
    return false;
  }
})();

export function resolveRoom() {
  const params = new URLSearchParams(location.search);
  let room = (params.get('room') || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
  if (!room) {
    room = randomCode();
    params.set('room', room);
    const url = `${location.pathname}?${params.toString()}${location.hash}`;
    history.replaceState(null, '', url);
  }
  return room;
}

export function resolveServerUrl() {
  const params = new URLSearchParams(location.search);
  const override = params.get('server');
  if (override) return override;
  // Vite sets import.meta.env.DEV during `npm run dev`. In dev the relay runs on
  // its own port (8787); in a production build the same origin hosts both.
  const dev = import.meta.env && import.meta.env.DEV;
  if (dev) return `ws://${location.hostname}:8787/ws`;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export function resolveName() {
  const params = new URLSearchParams(location.search);
  const fromUrl = params.get('name');
  if (fromUrl) return fromUrl.slice(0, 20);
  try {
    const saved = localStorage.getItem('cod_name');
    if (saved) return saved;
  } catch {}
  const name = `${CALLSIGNS[(Math.random() * CALLSIGNS.length) | 0]}-${(Math.random() * 90 + 10) | 0}`;
  return name;
}

/**
 * This tab's reconnect token: how the relay recognises a player coming back to
 * a match after their socket dropped — a network blip, or the page reloading
 * itself (context loss, a graphics tier change) — so they resume their score
 * instead of re-entering at zero. It is identity, not a secret.
 *
 * sessionStorage, not localStorage: it has to survive a reload of THIS tab, and
 * must not be shared with a second tab of the same browser, which is a second
 * player. Without storage it is per page load, which just means no resume.
 */
export function resolveToken() {
  try {
    const saved = sessionStorage.getItem('cod_token');
    if (saved) return saved;
  } catch {}
  const bytes = new Uint8Array(12);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = (Math.random() * 256) | 0;
  }
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    sessionStorage.setItem('cod_token', token);
  } catch {}
  return token;
}

export function saveName(name) {
  try {
    localStorage.setItem('cod_name', name);
  } catch {}
}

export function inviteLink(room) {
  const params = new URLSearchParams(location.search);
  params.set('room', room);
  params.delete('server');
  params.delete('name');
  return `${location.origin}${location.pathname}?${params.toString()}`;
}
