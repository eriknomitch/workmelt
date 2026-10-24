/**
 * Geist + Geist Mono, bundled — the brand faces DESIGN.md names, shipped from
 * our own origin like every other asset (ARCHITECTURE.md rule 3).
 *
 * Browser-only: src/main.js imports it first thing, so the fetch starts before
 * either boot is even requested, and the two boots import `fontsReady` from it.
 * src/ui/brand.js stays a plain leaf that Node can import (the lobby playtest
 * and input selftest reach it through src/match/ui.js), and Node cannot import
 * a stylesheet.
 *
 * The packages register the faces as 'Geist Variable' / 'Geist Mono Variable',
 * which is why the stacks in brand.js lead with those names. Each family is
 * split by unicode-range, so a browser only fetches the subsets a string on
 * screen actually uses — in practice the ~29 KB + ~23 KB Latin files.
 */
import '@fontsource-variable/geist/wght.css';
import '@fontsource-variable/geist-mono/wght.css';

/**
 * Resolves once the Latin subsets of both faces are loaded (or failed). Started
 * at import, so the fetch runs alongside the boot chunk's rather than after it.
 *
 * The boots hold `window.__READY__` on this: every capture harness gates on that
 * flag, and a face that swaps in after it would make the same shot render in the
 * fallback on one run and in Geist on the next. A normal boot never waits on it
 * — the UI is legible in the fallback stacks — so it can only cost a capture.
 */
export const fontsReady =
  typeof document === 'undefined' || !document.fonts
    ? Promise.resolve()
    : Promise.all([
        document.fonts.load("300 1em 'Geist Variable'", 'A'),
        document.fonts.load("500 1em 'Geist Mono Variable'", 'A'),
      ]).then(
        () => {},
        () => {}
      );
