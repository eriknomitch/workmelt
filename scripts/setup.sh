#!/usr/bin/env bash
#
# Environment bootstrap. Cloud/CI sandboxes call this once before running any
# npm script or harness in tools/.
#
# It does three things, idempotently:
#   1. installs the pinned node dependencies (npm ci, falling back to install)
#   2. installs the Chromium build that the pinned playwright expects
#   3. verifies that Chromium actually starts and exposes WebGL2 (SwiftShader),
#      which is what tools/capture.mjs and friends need
#
# Usage:
#   ./scripts/setup.sh          # deps + browser + verify
#   SKIP_BROWSERS=1 ./scripts/setup.sh
#   SKIP_VERIFY=1 ./scripts/setup.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log() { printf '\033[36m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[setup] warning:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[31m[setup] error:\033[0m %s\n' "$*" >&2; exit 1; }

# Network steps get four tries with 2/4/8s backoff: sandbox proxies flake.
retry() {
  local delay=2 attempt=1
  until "$@"; do
    if (( attempt >= 4 )); then return 1; fi
    warn "'$1' failed (attempt $attempt), retrying in ${delay}s"
    sleep "$delay"
    delay=$(( delay * 2 ))
    attempt=$(( attempt + 1 ))
  done
}

# ---------------------------------------------------------------- node deps ---
command -v node >/dev/null || die 'node not found on PATH'
command -v npm >/dev/null || die 'npm not found on PATH'
log "node $(node -v), npm $(npm -v)"

if [[ -f package-lock.json ]]; then
  # npm ci wipes node_modules every run; skip it when the tree already matches
  # the lockfile so a second setup call is near-instant.
  if [[ -d node_modules ]] && npm ls --depth=0 >/dev/null 2>&1; then
    log 'node_modules already satisfies package-lock.json'
  else
    log 'installing dependencies (npm ci)'
    retry npm ci --no-audit --no-fund || {
      warn 'npm ci failed, falling back to npm install'
      retry npm install --no-audit --no-fund || die 'dependency install failed'
    }
  fi
else
  log 'installing dependencies (npm install)'
  retry npm install --no-audit --no-fund || die 'dependency install failed'
fi

# ------------------------------------------------------------------ browsers ---
# Sandboxes preseed a shared browser cache at /opt/pw-browsers and export the
# same variable, so honour whatever is exported and adopt the shared cache only
# when it is already there. On a normal workstation /opt is not writable and
# playwright's own per-user cache is the right place anyway.
if [[ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" && -d /opt/pw-browsers ]]; then
  export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
fi

if [[ "${SKIP_BROWSERS:-}" == 1 ]]; then
  log 'SKIP_BROWSERS=1, not touching browsers'
elif [[ ! -d node_modules/playwright ]]; then
  log 'playwright not installed, skipping browser download'
else
  # mkdir -p covers "does not exist yet"; -w covers "exists but read-only".
  if [[ -n "${PLAYWRIGHT_BROWSERS_PATH:-}" ]] &&
     { ! mkdir -p "$PLAYWRIGHT_BROWSERS_PATH" 2>/dev/null ||
       [[ ! -w "$PLAYWRIGHT_BROWSERS_PATH" ]]; }; then
    warn "cannot write $PLAYWRIGHT_BROWSERS_PATH; using playwright's default user cache"
    warn 'unset PLAYWRIGHT_BROWSERS_PATH in your shell too, or tools/ will look in the wrong place'
    unset PLAYWRIGHT_BROWSERS_PATH
  fi

  # The preseeded cache is often a revision behind the pinned playwright, which
  # fails at launch with "Executable doesn't exist". Downloading the matching
  # revision is the fix; it is a no-op once present.
  log "installing Chromium for playwright $(node -p "require('playwright/package.json').version")"
  retry npx --no-install playwright install chromium chromium-headless-shell ||
    warn 'browser download failed; capture/playtest harnesses will not run'
fi

# -------------------------------------------------------------------- verify ---
# tools/capture.mjs needs a real WebGL2 context. There is no GPU in these
# sandboxes, so Chromium must fall back to SwiftShader — assert that it does.
verify_gl() {
  node --input-type=module -e '
    import { chromium } from "playwright";
    const browser = await chromium.launch({
      headless: true,
      args: ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--mute-audio"],
    });
    try {
      const page = await browser.newPage();
      const renderer = await page.evaluate(() => {
        const gl = document.createElement("canvas").getContext("webgl2");
        if (!gl) return null;
        const dbg = gl.getExtension("WEBGL_debug_renderer_info");
        return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      });
      if (!renderer) throw new Error("no WebGL2 context");
      console.log(renderer);
    } finally {
      await browser.close();
    }
  '
}

if [[ "${SKIP_VERIFY:-}" == 1 ]]; then
  log 'SKIP_VERIFY=1, skipping WebGL2 check'
elif [[ ! -d node_modules/playwright ]]; then
  log 'playwright not installed, skipping WebGL2 check'
else
  log 'checking headless WebGL2'
  if renderer="$(verify_gl 2>&1)"; then
    log "WebGL2 ok: ${renderer##*$'\n'}"
  else
    warn 'headless WebGL2 unavailable:'
    printf '%s\n' "$renderer" >&2
    # Missing shared libraries are the usual cause and are recoverable when we
    # can reach the package manager.
    if command -v apt-get >/dev/null && [[ "$(id -u)" == 0 ]]; then
      log 'installing system libraries (playwright install-deps chromium)'
      if retry npx --no-install playwright install-deps chromium && renderer="$(verify_gl 2>&1)"; then
        log "WebGL2 ok: ${renderer##*$'\n'}"
      else
        warn 'still no WebGL2; tools/capture.mjs and tools/playtest.mjs will fail'
      fi
    else
      warn 'cannot install system libraries here; tools/capture.mjs will fail'
    fi
  fi
fi

log 'done. next: npm run dev, npm run build, node tools/capture.mjs'
