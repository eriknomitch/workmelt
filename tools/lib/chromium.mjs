/**
 * Every harness in this directory (and the dev-only preview probes under
 * src/**) launches its own Chromium. Playwright refuses to launch when its
 * pinned build is missing, which is the normal state of a sandbox that
 * pre-installs one Chromium revision and pins a different one in
 * package-lock.json — `npx playwright install` then has to download a fresh
 * few-hundred-megabyte build before a single test can run. Falling back to
 * whatever chromium-* build the sandbox already has avoids that download
 * entirely; the renderer is the same Chromium/SwiftShader either way.
 */
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function resolveChromium() {
  const pinned = (() => {
    try {
      return chromium.executablePath();
    } catch {
      return null;
    }
  })();
  if (pinned && existsSync(pinned)) return pinned;

  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || null;
  if (!base || !existsSync(base)) return null;
  const candidates = readdirSync(base)
    .filter((d) => d.startsWith('chromium-'))
    .sort()
    .reverse()
    .flatMap((d) => [
      join(base, d, 'chrome-linux', 'chrome'),
      join(base, d, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
      join(base, d, 'chrome-win', 'chrome.exe'),
    ]);
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** `chromium.launch({ ...opts })` with `executablePath` filled in when needed. */
export function launchOpts(opts = {}) {
  const executablePath = resolveChromium();
  return { ...opts, ...(executablePath ? { executablePath } : {}) };
}
