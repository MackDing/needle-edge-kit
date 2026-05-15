// Platform-dispatching router with dependency injection.
//
// Two ways to use:
//   1. Default (production):   const { route } = require('./host_functions');
//                              route(call, { confirm }) — auto-picks impl by os.platform()
//   2. Test/custom:            const { createRouter } = require('./host_functions');
//                              const r = createRouter({ my_tool: async () => ({...}) });
//                              r.route(call, { confirm })

const os = require('os');

// Add a platform here once its impl file exists. We deliberately do NOT list
// 'linux' until linux.js ships — a missing entry produces a clean error at
// route() time instead of a cryptic 'MODULE_NOT_FOUND' at startup.
const PLATFORM_FILES = {
  win32:  './windows',
  darwin: './darwin',
};

// Tool-domain overlay: when the renderer is loading OA tools (or any non-platform
// tool set), the platform handlers won't have those names. Overlay matching
// tool-domain handlers on top of the platform impl. First match wins.
//
// Configure via NEEDLE_OVERLAY env var (comma-separated module paths).
//   default: ./oa_mock   (so the OA demo works out of the box)
//   to disable: NEEDLE_OVERLAY=''  (only platform handlers)
const _overlayEnv = process.env.NEEDLE_OVERLAY;
const OVERLAY_FILES = _overlayEnv === undefined
  ? ['./oa_mock']
  : _overlayEnv.split(',').map(s => s.trim()).filter(Boolean);

const DANGEROUS = new Set(['run_shell']);
const DEDUP_MS  = 1500;
const RECENT    = new Map();   // shared across module-level route() calls

function getDefaultImpl() {
  const file = PLATFORM_FILES[os.platform()];
  if (!file) {
    throw new Error(
      `needle: unsupported platform '${os.platform()}'. ` +
      `Implemented: ${Object.keys(PLATFORM_FILES).join(', ')}.`,
    );
  }
  // Merge platform handlers with any tool-domain overlay (e.g. OA mocks).
  // Overlay wins on key collision so domain-specific mocks override platform behavior.
  const platform = require(file);
  const merged = { ...platform };
  for (const ov of OVERLAY_FILES) {
    try { Object.assign(merged, require(ov)); } catch (e) {
      console.error(`[host_functions] overlay ${ov} failed to load: ${e.message}`);
    }
  }
  return merged;
}

function createRouter(impl) {
  return {
    async route(call, { confirm } = {}) {
      const fn = impl[call.name];
      if (!fn) return { name: call.name, error: 'unknown_tool' };

      if (DANGEROUS.has(call.name)) {
        const ok = confirm ? await confirm(call) : false;
        if (!ok) return { name: call.name, error: 'user_rejected' };
      }

      const key = call.name + JSON.stringify(call.arguments);
      const now = Date.now();
      if ((RECENT.get(key) ?? 0) + DEDUP_MS > now) {
        return { name: call.name, error: 'debounced' };
      }
      RECENT.set(key, now);

      try {
        const ok = await fn(call.arguments);
        return { name: call.name, ok };
      } catch (e) {
        return { name: call.name, error: e?.message ?? String(e) };
      }
    },
  };
}

let _defaultRouter = null;
function defaultRouter() {
  if (!_defaultRouter) _defaultRouter = createRouter(getDefaultImpl());
  return _defaultRouter;
}

async function route(call, opts) {
  return defaultRouter().route(call, opts);
}

module.exports = {
  route,
  createRouter,
  DANGEROUS,
  // Test seam — not part of the public API.
  _getDefaultImpl: getDefaultImpl,
};
