// ===== Pup N Away — asset loader =====
//
// Preloads every image the current run needs before gameplay starts,
// reporting progress for the loading screen. A missing/broken image
// degrades to "just don't draw it" in production (matching every other
// Quest Zone game's asset-loading policy) but is logged loudly to the
// console — with the exact path that failed — whenever
// window.PNA_DEV_MODE is true, per the brief's "report the exact
// missing path in development mode" rule.
(function () {
  // Bump alongside the `?v=N` cache-busting query on this game's own
  // <script> tags in index.html whenever an image at an EXISTING path
  // is replaced (a new path never needs it — it was never cached under
  // the old one). Without this, a browser that already has an old/
  // interrupted response cached for a given image path — e.g. from a
  // request that got cut off mid-transfer during dev-server restarts —
  // keeps serving that broken cached copy forever, no matter how many
  // times the underlying file on disk changes, since a plain path with
  // no query string looks identical to the cache every time.
  const ASSET_CACHE_VERSION = 'v45';
  function loadImage(path) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ path, img, ok: true });
      img.onerror = () => {
        if (window.PNA_DEV_MODE) {
          console.error('[Pup N Away] missing or broken asset: ' + path);
        }
        resolve({ path, img: null, ok: false });
      };
      img.src = path + (path.indexOf('?') === -1 ? '?' : '&') + ASSET_CACHE_VERSION;
    });
  }

  // Flattens the nested ASSETS manifest into a flat { key: path } map so
  // callers can address any image by a stable dotted key
  // ("dogRun.right.0", "backgrounds.dreamBedroom", ...) without ever
  // touching a literal path themselves.
  function flatten(obj, prefix, out) {
    Object.keys(obj).forEach((k) => {
      const v = obj[k];
      const key = prefix ? prefix + '.' + k : k;
      if (Array.isArray(v)) {
        v.forEach((item, i) => {
          if (typeof item === 'string') out[key + '.' + i] = item;
          else flatten(item, key + '.' + i, out);
        });
      } else if (typeof v === 'string') {
        out[key] = v;
      } else if (v && typeof v === 'object') {
        flatten(v, key, out);
      }
    });
    return out;
  }

  async function loadAll(onProgress) {
    const cfg = window.PNA_CONFIG;
    const flat = flatten(cfg.ASSETS, '', {});
    const keys = Object.keys(flat);
    const images = {};
    const missing = [];
    let done = 0;

    await Promise.all(keys.map(async (key) => {
      const result = await loadImage(flat[key]);
      images[key] = result.ok ? result.img : null;
      if (!result.ok) missing.push(result.path);
      done++;
      if (onProgress) onProgress(done, keys.length);
    }));

    return { images, missing, total: keys.length };
  }

  window.PNA_Assets = { loadAll, flatten };
})();
