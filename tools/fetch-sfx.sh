#!/usr/bin/env bash
#
# Fetch the raw SFX source packs into assets-src/ (gitignored, ~338 MB).
#
# You only need this to re-run tools/encode-sfx.mjs. The encoded output in
# public/sfx/ is committed, so a normal build/run never touches any of it.
#
# Requires: curl, unzip, 7zz (brew install sevenzip).
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/assets-src"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$SRC"

need() { command -v "$1" >/dev/null || { echo "missing required tool: $1" >&2; exit 1; }; }
need curl; need unzip; need 7zz

# ── The Free Firearm Sound Library — CC0 ─────────────────────────────────────
# Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney
# https://opengameart.org/content/the-free-firearm-sound-library
if [ ! -d "$SRC/firearms" ]; then
  echo "==> firearms (185 MB)"
  curl -L --retry 3 -o "$TMP/firearms.7z" \
    "https://opengameart.org/sites/default/files/Prepared%20SFX%20Library.7z"
  7zz x "$TMP/firearms.7z" -o"$TMP/fa" -y >/dev/null
  mv "$TMP/fa/Prepared SFX Library" "$SRC/firearms"
fi

# ── Footsteps on different surfaces — CC-BY 3.0 ──────────────────────────────
# congusbongus, mastered from freesound.org for C-Dogs SDL
# https://opengameart.org/content/footsteps-on-different-surfaces
if [ ! -d "$SRC/footsteps" ]; then
  echo "==> footsteps"
  curl -L --retry 3 -o "$TMP/footsteps.zip" \
    "https://opengameart.org/sites/default/files/footsteps_0.zip"
  unzip -qo "$TMP/footsteps.zip" -d "$TMP/fs"
  mv "$TMP/fs/footsteps" "$SRC/footsteps"
fi

# ── Kenney packs — CC0 ───────────────────────────────────────────────────────
# https://kenney.nl/assets/<slug>. The download URL carries a content hash, so
# scrape it off the asset page rather than hardcoding a path that rots.
for slug in impact-sounds interface-sounds ui-audio sci-fi-sounds; do
  dest="$SRC/kenney_$slug"
  [ -d "$dest" ] && continue
  echo "==> kenney $slug"
  url="$(curl -sL "https://kenney.nl/assets/$slug" |
    grep -oE '/media/pages/assets/[^"'"'"' ]*\.zip' | head -1)"
  if [ -z "$url" ]; then echo "  could not find a zip link — skipping" >&2; continue; fi
  curl -L --retry 3 -o "$TMP/k.zip" "https://kenney.nl$url"
  rm -rf "$TMP/k"; unzip -qo "$TMP/k.zip" -d "$TMP/k"
  mkdir -p "$dest"
  # Packs nest audio under Audio/ or sit flat; flatten either shape.
  find "$TMP/k" -name '*.ogg' ! -name '._*' ! -name 'Preview.ogg' -exec cp {} "$dest/" \;
  find "$TMP/k" -name 'License.txt' -exec cp {} "$dest/" \; -quit
done

# macOS resource forks ride along in some of these archives.
find "$SRC" -name '._*' -delete
find "$SRC" -name '.DS_Store' -delete

echo
echo "sources ready in assets-src/ ($(du -sh "$SRC" | cut -f1))"
echo "next: node tools/encode-sfx.mjs"
