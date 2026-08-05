/**
 * Entry dispatcher — decides WHICH boot runs before anything heavy is fetched.
 *
 * `?renderGame=false` (or `=0`) is a debugging/test-performance switch: it
 * skips the engine entirely — no WebGL context, no world build, no pre-warm,
 * and none of the subsystem modules are even requested — and stands up only
 * the HTML UI (the lobby) so markup and styles can be inspected in isolation.
 * See src/dev/uionly.js for exactly what that mode offers.
 *
 * The real boot lives in ./boot.js. Both sides are dynamic imports on purpose:
 * a static import here would make the browser fetch and parse the whole engine
 * even on a UI-only load, which is precisely the cost the flag exists to avoid.
 */
const renderGame = !['false', '0'].includes(new URLSearchParams(location.search).get('renderGame'));

if (renderGame) {
  await import('./boot.js');
} else {
  const { bootUiOnly } = await import('./dev/uionly.js');
  await bootUiOnly();
}
