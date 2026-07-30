#!/usr/bin/env bash
#
# SessionStart hook for Claude Code on the web.
#
# A cloud session clones the repo fresh and node_modules/ is gitignored, so
# without this every session starts with no dependencies and the first browser
# harness dies with:
#
#   Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'playwright'
#
# It delegates to scripts/setup.sh, which is the documented bootstrap and
# already has the retry/backoff these sandboxes' flaky proxies need.
#
# SKIP_BROWSERS=1 is deliberate. The sandbox preseeds a Chromium under
# /opt/pw-browsers that is usually a revision behind the one package-lock.json
# pins, and `playwright install` would download a few hundred megabytes of a
# build we do not need: tools/lib/chromium.mjs already falls back to whatever
# chromium-* is present, and the renderer is the same Chromium/SwiftShader
# either way. Run ./scripts/setup.sh by hand if you do want the pinned build.
#
# Run it directly to test:  CLAUDE_CODE_REMOTE=true .claude/hooks/session-start.sh
set -euo pipefail

# Local checkouts bootstrap through ./scripts/setup.sh on their own schedule;
# only the ephemeral cloud container needs this on every session.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# Harnesses read this to find the preseeded browser cache. It is normally
# exported into the container already; set it when it is not, and persist it so
# every later tool call in the session sees the same value.
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] && [ -d /opt/pw-browsers ]; then
  export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo 'export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers' >> "$CLAUDE_ENV_FILE"
  fi
fi

# setup.sh is idempotent: it no-ops the install when node_modules already
# satisfies package-lock.json, so a resumed session pays almost nothing.
SKIP_BROWSERS=1 ./scripts/setup.sh
