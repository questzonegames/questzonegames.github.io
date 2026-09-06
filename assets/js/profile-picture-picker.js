// ===== Quest Zone — Profile Pictures (catalog, gallery, display) =====
//
// Replaces every small circular "who is this" badge (Players search
// results, and any future highscores/game-lobby row) with a picked,
// static picture instead of a live-rendered avatar — see supabase/
// migrations/20260906090000_profile_pictures.sql for why: a live avatar
// scaled into a tiny circle threw off items positioned in real pixels
// against that tiny container's own size. A plain picture can't do that;
// it's just an image.
//
// window.QZProfilePicture.ready()          -> promise, resolves once the
//                                              catalog (public.
//                                              profile_pictures) has
//                                              loaded. Call before urlFor().
// window.QZProfilePicture.urlFor(id)        -> resolved image URL for a
//                                              picture id (falls back to
//                                              'default' for null/unknown
//                                              ids, and to a plain person-
//                                              silhouette SVG data URI if
//                                              even 'default' can't load).
// window.QZProfilePicture.imgHtml(id, cls)  -> convenience: a ready-to-
//                                              insert <img> tag string.
// window.QZProfilePicture.open()            -> opens the gallery modal for
//                                              the SIGNED-IN account to
//                                              pick/buy/equip a picture.
//                                              Requires qz-auth.js.
//
// Requires qz-auth.js and site.js (qzToast) already loaded on the page.
(function () {
  const FALLBACK_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '<circle cx="50" cy="50" r="50" fill="#101a30"/>' +
    '<circle cx="50" cy="38" r="16" fill="#3a4a72"/>' +
    '<path d="M18 88c0-19 14-32 32-32s32 13 32 32" fill="#3a4a72"/></svg>'
  );

  function pathPrefix() {
    // Same trick qz-header-auth.js uses: the logo link is already
    // correctly relative per page ("index.html" at the root, "../
    // index.html" one level down) — reuse that instead of hardcoding
    // depth per page.
    const logo = document.querySelector('.logo');
    const href = logo ? logo.getAttribute('href') || '' : '';
    return href.replace(/index\.html$/, '');
  }

  let catalogPromise = null;
  let catalogById = {}; // id -> row, once loaded
  let ownedIds = null; // Set, only fetched when the gallery is actually opened

  function loadCatalog() {
    if (catalogPromise) return catalogPromise;
    catalogPromise = (async () => {
      if (!window.QZAuth || !window.QZAuth.client) return {};
      const { data, error } = await window.QZAuth.client
        .from('profile_pictures')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error || !data) return {};
      const byId = {};
      data.forEach((row) => { byId[row.id] = row; });
      catalogById = byId;
      return byId;
    })();
    return catalogPromise;
  }

  function ready() { return loadCatalog(); }

  function urlFor(id) {
    const prefix = pathPrefix();
    const row = (id && catalogById[id]) || catalogById['default'];
    if (!row) return FALLBACK_SVG;
    return prefix + row.image_path;
  }

  function imgHtml(id, extraClass) {
    const src = urlFor(id);
    const cls = extraClass ? ' class="' + extraClass + '"' : '';
    return '<img src="' + src + '" alt=""' + cls + '>';
  }

  // ================= gallery modal (own account only) =================
  let modalEl = null;
  let gridEl = null;
  let statusEl = null;

  function injectStyles() {
    if (document.getElementById('qz-pfp-style')) return;
    const style = document.createElement('style');
    style.id = 'qz-pfp-style';
    style.textContent = `
      .qz-pfp-backdrop {
        position: fixed; inset: 0; z-index: 700; display: none;
        align-items: flex-start; justify-content: center;
        padding: 6vh 16px; overflow-y: auto;
        background: rgba(4,7,14,0.75); backdrop-filter: blur(3px);
      }
      .qz-pfp-backdrop.show { display: flex; }
      .qz-pfp-modal {
        position: relative; width: 100%; max-width: 520px;
        border: 1.5px solid rgba(140,195,255,0.35); border-radius: 14px;
        background: linear-gradient(165deg, #0d1830 0%, #081222 55%, #050a16 100%);
        box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 30px rgba(60,140,255,0.15);
        padding: 24px 22px 22px;
        font-family: 'Exo 2', sans-serif;
      }
      .qz-pfp-close {
        position: absolute; top: 12px; right: 12px; width: 28px; height: 28px;
        border-radius: 50%; border: 1.5px solid rgba(140,160,190,0.3); background: rgba(10,16,28,0.7);
        color: #a9b1d6; font-size: 14px; cursor: pointer; line-height: 1;
      }
      .qz-pfp-close:hover { color: #fff; border-color: rgba(255,255,255,0.4); }
      .qz-pfp-title {
        font-family: 'Orbitron', sans-serif; font-weight: 800; font-size: 15px;
        letter-spacing: 0.06em; text-transform: uppercase; text-align: center;
        color: #fff; margin: 0 0 4px;
      }
      .qz-pfp-sub { font-size: 12px; color: #a9b1d6; text-align: center; margin: 0 0 16px; }
      .qz-pfp-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(84px, 1fr)); gap: 14px;
        max-height: 50vh; overflow-y: auto; padding: 4px;
      }
      .qz-pfp-cell { display: flex; flex-direction: column; align-items: center; gap: 6px; }
      .qz-pfp-thumb-btn {
        position: relative; width: 72px; height: 72px; border-radius: 50%;
        border: 2.5px solid rgba(120,160,220,0.3); padding: 0; cursor: pointer;
        background: #0a0e18; overflow: hidden; transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .qz-pfp-thumb-btn img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .qz-pfp-thumb-btn:hover { border-color: rgba(150,200,255,0.6); }
      .qz-pfp-thumb-btn.selected { border-color: #7fb3ff; box-shadow: 0 0 0 3px rgba(59,130,246,0.3), 0 0 14px rgba(90,160,255,0.5); }
      .qz-pfp-thumb-btn.locked img { opacity: 0.35; filter: grayscale(0.6); }
      .qz-pfp-thumb-btn.locked::after {
        content: '🔒'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
        font-size: 20px;
      }
      .qz-pfp-thumb-btn:disabled { cursor: default; }
      .qz-pfp-name { font-size: 10px; color: #cfe0ff; text-align: center; max-width: 78px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .qz-pfp-price { font-size: 9.5px; color: #ffd24d; text-align: center; }
      .qz-pfp-status { min-height: 16px; font-size: 12px; text-align: center; margin: 14px 0 6px; color: #ff9d9d; }
      .qz-pfp-status.ok { color: #6be3a0; }
      .qz-pfp-actions { display: flex; gap: 10px; margin-top: 4px; }
      .qz-pfp-btn {
        flex: 1; padding: 10px 12px; border-radius: 8px; cursor: pointer;
        font-family: 'Orbitron', sans-serif; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase;
        border: 1.5px solid rgba(120,160,220,0.35); background: rgba(4,8,16,0.55); color: #cfe0ff;
      }
      .qz-pfp-btn:hover:not(:disabled) { box-shadow: 0 0 14px rgba(90,160,255,0.4); }
      .qz-pfp-btn:disabled { opacity: 0.4; cursor: not-allowed; }
      .qz-pfp-btn.primary { background: linear-gradient(180deg,#3b6fe0,#1c3a8f); border-color: rgba(150,200,255,0.8); color: #fff; }
      .qz-pfp-btn.buy { background: linear-gradient(180deg,#c9932f,#8a5f12); border-color: rgba(255,210,120,0.8); color: #fff; }
    `;
    document.head.appendChild(style);
  }

  function build() {
    if (modalEl) return;
    injectStyles();
    modalEl = document.createElement('div');
    modalEl.className = 'qz-pfp-backdrop';
    modalEl.innerHTML =
      '<div class="qz-pfp-modal">' +
        '<button type="button" class="qz-pfp-close" aria-label="Close">✕</button>' +
        '<h3 class="qz-pfp-title">Select a Profile Picture</h3>' +
        '<p class="qz-pfp-sub">Shown next to your name in Players search and elsewhere on the site.</p>' +
        '<div class="qz-pfp-grid" id="qz-pfp-grid"></div>' +
        '<div class="qz-pfp-status" id="qz-pfp-status"></div>' +
        '<div class="qz-pfp-actions">' +
          '<button type="button" class="qz-pfp-btn" id="qz-pfp-buy" hidden>Buy</button>' +
          '<button type="button" class="qz-pfp-btn primary" id="qz-pfp-save">Save as Profile Picture</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modalEl);
    gridEl = modalEl.querySelector('#qz-pfp-grid');
    statusEl = modalEl.querySelector('#qz-pfp-status');
    modalEl.querySelector('.qz-pfp-close').addEventListener('click', close);
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) close(); });
    modalEl.querySelector('#qz-pfp-save').addEventListener('click', onSave);
    modalEl.querySelector('#qz-pfp-buy').addEventListener('click', onBuy);
  }

  function setStatus(msg, ok) {
    statusEl.textContent = msg || '';
    statusEl.classList.toggle('ok', !!ok);
  }

  let selectedId = null;
  let currentEquippedId = null;

  function renderGrid(catalog) {
    const rows = Object.values(catalog).sort((a, b) => a.sort_order - b.sort_order);
    gridEl.innerHTML = rows.map((row) => {
      const owned = row.unlock_type === 'free' || ownedIds.has(row.id);
      const locked = !owned;
      const priceHtml = row.unlock_type === 'purchase_points'
        ? '<div class="qz-pfp-price">' + (owned ? 'Owned' : Number(row.cost_quest_points).toLocaleString() + ' QP') + '</div>'
        : (row.unlock_type === 'achievement' ? '<div class="qz-pfp-price">' + (owned ? 'Owned' : 'Locked') + '</div>' : '');
      return '<div class="qz-pfp-cell">' +
        '<button type="button" class="qz-pfp-thumb-btn' + (locked ? ' locked' : '') + '" data-id="' + row.id + '" ' + (locked ? 'disabled' : '') + '>' +
          '<img src="' + urlFor(row.id) + '" alt="">' +
        '</button>' +
        '<div class="qz-pfp-name">' + escapeHtml(row.name) + '</div>' +
        priceHtml +
      '</div>';
    }).join('');
    Array.from(gridEl.querySelectorAll('.qz-pfp-thumb-btn')).forEach((btn) => {
      btn.addEventListener('click', () => selectId(btn.dataset.id));
    });
    highlightSelected();
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function highlightSelected() {
    Array.from(gridEl.querySelectorAll('.qz-pfp-thumb-btn')).forEach((btn) => {
      btn.classList.toggle('selected', btn.dataset.id === selectedId);
    });
  }

  function selectId(id) {
    selectedId = id;
    highlightSelected();
    setStatus('', false);
    const row = catalogById[id];
    const buyBtn = modalEl.querySelector('#qz-pfp-buy');
    const owned = row && (row.unlock_type === 'free' || ownedIds.has(id));
    if (row && row.unlock_type === 'purchase_points' && !owned) {
      buyBtn.hidden = false;
      buyBtn.textContent = 'Buy for ' + Number(row.cost_quest_points).toLocaleString() + ' QP';
      buyBtn.className = 'qz-pfp-btn buy';
    } else {
      buyBtn.hidden = true;
    }
  }

  async function onBuy() {
    if (!selectedId || !window.QZAuth || !window.QZAuth.client) return;
    const buyBtn = modalEl.querySelector('#qz-pfp-buy');
    buyBtn.disabled = true;
    setStatus('Purchasing…', false);
    try {
      const { error } = await window.QZAuth.client.rpc('purchase_profile_picture', { p_picture_id: selectedId });
      if (error) throw error;
      ownedIds.add(selectedId);
      setStatus('Purchased!', true);
      renderGrid(catalogById);
      selectId(selectedId);
    } catch (err) {
      setStatus((err && err.message) || 'Could not complete the purchase.', false);
    } finally {
      buyBtn.disabled = false;
    }
  }

  async function onSave() {
    if (!selectedId || !window.QZAuth || !window.QZAuth.client) return;
    if (selectedId === currentEquippedId) { close(); return; }
    const saveBtn = modalEl.querySelector('#qz-pfp-save');
    saveBtn.disabled = true;
    setStatus('Saving…', false);
    try {
      const { error } = await window.QZAuth.client.rpc('equip_profile_picture', { p_picture_id: selectedId });
      if (error) throw error;
      if (window.qzToast) window.qzToast('Profile picture updated!');
      setTimeout(() => { close(); location.reload(); }, 500);
    } catch (err) {
      setStatus((err && err.message) || 'Could not save your profile picture.', false);
      saveBtn.disabled = false;
    }
  }

  async function open() {
    if (!window.QZAuth || !window.QZAuth.client) return;
    build();
    modalEl.classList.add('show');
    setStatus('Loading…', false);
    gridEl.innerHTML = '';
    const [catalog, profile] = await Promise.all([
      loadCatalog(),
      window.QZAuth.getProfile()
    ]);
    const { data: ownedRows } = await window.QZAuth.client.rpc('get_owned_profile_pictures');
    ownedIds = new Set((ownedRows || []).map((r) => r.profile_picture_id));
    currentEquippedId = (profile && profile.equipped_profile_picture_id) || 'default';
    selectedId = currentEquippedId;
    setStatus('', false);
    renderGrid(catalog);
  }

  function close() {
    if (modalEl) modalEl.classList.remove('show');
  }

  window.QZProfilePicture = { ready, urlFor, imgHtml, open, close };
})();
