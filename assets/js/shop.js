// ===== Quest Zone — Shop page =====
//
// Everything shown here (price, purchase type, owned quantity, remaining
// stock) comes straight from Supabase's get_shop_items() RPC — nothing is
// computed or trusted client-side. Every purchase goes through the
// server-authoritative purchase_item() RPC (see
// supabase/migrations/20260914010000_shop_economy_extensions.sql and
// .../20260909050100_item_economy_rpcs.sql) with a fresh idempotency key
// per click; the item is never shown as owned until that call actually
// succeeds.
(function () {
  const SLOTS = [
    { key: 'all', label: 'All' },
    { key: 'head', label: 'Head' },
    { key: 'necklace', label: 'Necklace' },
    { key: 'body', label: 'Body' },
    { key: 'legs', label: 'Legs' },
    { key: 'boots', label: 'Boots' },
    { key: 'accessory', label: 'Accessory' },
    { key: 'gloves', label: 'Gloves' },
    { key: 'offHand', label: 'Off-hand' },
    { key: 'mainHand', label: 'Main hand' },
    { key: 'back', label: 'Back' }
  ];
  // Independent second row — combines (AND) with the slot row above,
  // same two-row pattern as the Achievements page's category + tier
  // rows. "Limited Edition" = still has copies left; "Discontinued" = a
  // limited item that's been fully bought out — it moves itself from one
  // filter to the other automatically the moment issued_count reaches
  // edition_size (both are just a filter over the one live sold_out flag
  // from get_shop_items(), nothing separate to keep in sync).
  const STATUS_FILTERS = [
    { key: 'owned', label: 'Owned', test: (it) => it.owned_quantity > 0 },
    { key: 'limited', label: 'Limited Edition', test: (it) => it.stock_type === 'limited' && !it.sold_out },
    { key: 'discontinued', label: 'Discontinued', test: (it) => it.stock_type === 'limited' && it.sold_out }
  ];
  const PAGE_SIZE = 12;

  const slotFilterEl = document.getElementById('shop-filters');
  const statusFilterEl = document.getElementById('shop-status-filters');
  const searchEl = document.getElementById('shop-search');
  const grid = document.getElementById('shop-grid');
  const pagEl = document.getElementById('shop-pagination');
  const qpValueEl = document.getElementById('shop-qp-value');
  const stardustValueEl = document.getElementById('shop-stardust-value');
  const banner = document.getElementById('shop-status-banner');
  const toastEl = document.getElementById('shop-toast');

  let activeSlot = 'all';
  let activeStatus = null; // null, or one of STATUS_FILTERS' keys
  let searchTerm = '';
  let currentPage = 1;
  let items = [];
  let signedIn = false;
  let toastTimer;

  function showToast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', !!isError);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }

  function showBanner(msg, isError) {
    banner.textContent = msg;
    banner.classList.toggle('error', !!isError);
    banner.classList.add('show');
  }

  function findItemCatalogEntry(itemId) {
    const catalog = window.QZ_ITEM_CATALOG || [];
    return catalog.find((it) => it.id === itemId) || null;
  }

  function cardPreviewHtml(row) {
    const cat = findItemCatalogEntry(row.item_id);
    if (cat && cat.iconImage) return '<img src="' + cat.iconImage + '" alt="">';
    if (cat && cat.views && cat.views.front) return '<img src="' + cat.views.front + '" alt="">';
    if (cat && cat.icon) return cat.icon;
    // clean, honest placeholder — never fabricated art for an item that
    // doesn't have real art yet (see White T-shirt: no `views` on
    // purpose in inventory-data.js until real art exists)
    return '📦';
  }

  function slotLabel(slot) {
    const found = SLOTS.find((c) => c.key === slot);
    return found ? found.label : (slot || '—');
  }

  // ---------------- purchase confirmation popup ----------------
  // Same visual language as item-notify.js's "you received a gift" card
  // (icon tile, Orbitron title, name, meta line) but a separate, self-
  // contained popup — deliberately NOT the same one: that one is for
  // surprise grants (achievements, admin gifts) and purchase_item()
  // already marks a shop purchase as "seen" so it never double-fires (see
  // 20260914050000_fix_shop_notify_and_cleanup.sql). This one is shown
  // synchronously, right here, the instant a purchase actually succeeds —
  // closed only by its own Continue button (center, not a corner ✕), and
  // closing it never blocks buying again straight after.
  let purchaseModalEl;
  function buildPurchaseModal() {
    if (purchaseModalEl) return;
    purchaseModalEl = document.createElement('div');
    purchaseModalEl.className = 'shop-purchase-backdrop';
    purchaseModalEl.setAttribute('aria-hidden', 'true');
    purchaseModalEl.innerHTML =
      '<div class="shop-purchase-card" role="dialog" aria-modal="true">' +
        '<div class="shop-purchase-icon"></div>' +
        '<div class="shop-purchase-title"></div>' +
        '<div class="shop-purchase-name"></div>' +
        '<div class="shop-purchase-meta"></div>' +
        '<button type="button" class="shop-purchase-continue">Continue</button>' +
      '</div>';
    document.body.appendChild(purchaseModalEl);
    purchaseModalEl.querySelector('.shop-purchase-continue').addEventListener('click', closePurchaseModal);
    purchaseModalEl.addEventListener('click', (e) => { if (e.target === purchaseModalEl) closePurchaseModal(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && purchaseModalEl.classList.contains('show')) closePurchaseModal();
    });
  }
  function closePurchaseModal() {
    if (!purchaseModalEl) return;
    purchaseModalEl.classList.remove('show');
    purchaseModalEl.setAttribute('aria-hidden', 'true');
  }
  function showPurchaseModal(row, resultData) {
    buildPurchaseModal();
    purchaseModalEl.querySelector('.shop-purchase-icon').innerHTML = cardPreviewHtml(row);
    purchaseModalEl.querySelector('.shop-purchase-title').textContent =
      row.purchase_type === 'free' ? '🎉 Congratulations!' : '🎉 Purchase Successful!';
    purchaseModalEl.querySelector('.shop-purchase-name').textContent = row.name;
    let meta = row.purchase_type === 'free' ? 'You claimed this item.' : 'You purchased this item.';
    if (resultData && resultData.serial_number != null) {
      meta += '\nSerial #' + resultData.serial_number + (resultData.edition_size ? ' of ' + resultData.edition_size : '');
    } else if (row.purchase_type !== 'free') {
      meta += '\n' + Number(row.shop_price).toLocaleString() + (row.purchase_type === 'stardust' ? ' Stardust' : ' Quest Points') + ' spent';
    }
    const metaEl = purchaseModalEl.querySelector('.shop-purchase-meta');
    metaEl.textContent = meta;
    metaEl.style.whiteSpace = 'pre-line';
    purchaseModalEl.setAttribute('aria-hidden', 'false');
    setTimeout(() => purchaseModalEl.classList.add('show'), 20);
  }

  // Items matching every filter EXCEPT the slot row — used to count how
  // many each slot chip would show if picked, without that slot's own
  // filter masking its own count.
  function itemsForSlotCount() {
    return items.filter((it) => {
      if (activeStatus) {
        const sf = STATUS_FILTERS.find((s) => s.key === activeStatus);
        if (sf && !sf.test(it)) return false;
      }
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        if (!(it.name.toLowerCase().includes(q) || (it.description || '').toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }
  function itemsForStatusCount() {
    return items.filter((it) => {
      if (activeSlot !== 'all' && it.equipment_slot !== activeSlot) return false;
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        if (!(it.name.toLowerCase().includes(q) || (it.description || '').toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }

  function renderSlotFilters() {
    slotFilterEl.innerHTML = '';
    const pool = itemsForSlotCount();
    SLOTS.forEach((slot) => {
      const count = slot.key === 'all' ? pool.length : pool.filter((it) => it.equipment_slot === slot.key).length;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shop-filter' + (slot.key === activeSlot ? ' active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', slot.key === activeSlot ? 'true' : 'false');
      btn.innerHTML = '<span>' + slot.label + '</span><span class="cnt">' + count + '</span>';
      btn.addEventListener('click', () => {
        activeSlot = slot.key;
        currentPage = 1;
        renderAll();
      });
      slotFilterEl.appendChild(btn);
    });
  }

  function renderStatusFilters() {
    statusFilterEl.innerHTML = '';
    const pool = itemsForStatusCount();
    STATUS_FILTERS.forEach((sf) => {
      const count = pool.filter(sf.test).length;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'shop-filter' + (sf.key === activeStatus ? ' active' : '');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', sf.key === activeStatus ? 'true' : 'false');
      btn.innerHTML = '<span>' + sf.label + '</span><span class="cnt">' + count + '</span>';
      btn.addEventListener('click', () => {
        // click the already-active chip again to clear it, same toggle
        // behaviour as the Achievements page's tier row
        activeStatus = (activeStatus === sf.key) ? null : sf.key;
        currentPage = 1;
        renderAll();
      });
      statusFilterEl.appendChild(btn);
    });
  }

  function buttonStateFor(row) {
    if (!signedIn) return { label: 'Login to Purchase', disabled: true, cls: '' };
    if (row.sold_out) return { label: 'Sold Out', disabled: true, cls: '' };
    const maxedOwned = row.max_owned_per_player != null && row.owned_quantity >= row.max_owned_per_player;
    const maxedLifetime = row.lifetime_limit != null && row.lifetime_claimed >= row.lifetime_limit;
    if (maxedOwned || maxedLifetime) {
      return { label: row.purchase_type === 'free' ? 'Already Owned' : 'Already Owned', disabled: true, cls: '' };
    }
    if (row.purchase_type === 'free') return { label: 'Claim Free', disabled: false, cls: 'free' };
    if (row.purchase_type === 'quest_points') return { label: 'Buy for ' + Number(row.shop_price).toLocaleString() + ' QP', disabled: false, cls: '' };
    if (row.purchase_type === 'stardust') return { label: 'Buy for ' + Number(row.shop_price).toLocaleString() + ' Stardust', disabled: false, cls: 'stardust' };
    return { label: 'Unavailable', disabled: true, cls: '' };
  }

  function renderCard(row) {
    const card = document.createElement('div');
    card.className = 'shop-card';
    const state = buttonStateFor(row);
    const maxedOwned = row.max_owned_per_player != null && row.owned_quantity >= row.max_owned_per_player;
    if (maxedOwned || row.sold_out) card.classList.add('owned-max');

    const ownedLine = row.owned_quantity > 0 ? '<span class="shop-card-owned">Owned ×' + row.owned_quantity + '</span>' : '<span>' + slotLabel(row.equipment_slot) + '</span>';
    const stockLine = row.stock_type === 'limited'
      ? '<div class="shop-card-stock">' + (row.remaining_stock > 0 ? row.remaining_stock + ' left of ' + row.edition_size : 'Sold out') + '</div>'
      : '';
    const tradeLine = row.tradeable ? '' : '';

    let priceHtml;
    if (row.purchase_type === 'free') {
      priceHtml = '<span class="price-free">FREE</span>';
    } else if (row.purchase_type === 'quest_points') {
      priceHtml = '<img class="price-icon" src="assets/img/currency/quest-points.png" alt=""><span class="price-value">' + Number(row.shop_price).toLocaleString() + '</span>';
    } else if (row.purchase_type === 'stardust') {
      priceHtml = '<img class="price-icon" src="assets/img/currency/stardust.png" alt=""><span class="price-value">' + Number(row.shop_price).toLocaleString() + '</span>';
    } else {
      priceHtml = '';
    }

    card.innerHTML =
      '<div class="shop-card-preview">' + cardPreviewHtml(row) + '</div>' +
      '<div class="shop-card-body">' +
        '<div class="shop-card-name">' + row.name + '</div>' +
        '<div class="shop-card-meta">' + ownedLine + (row.tradeable ? '<span title="Can be traded">⇄ Tradeable</span>' : '') + '</div>' +
        stockLine +
        '<div class="shop-price-row">' + priceHtml + '</div>' +
        '<button type="button" class="shop-buy-btn ' + state.cls + '"' + (state.disabled ? ' disabled' : '') + '>' + state.label + '</button>' +
      '</div>';

    const buyBtn = card.querySelector('.shop-buy-btn');
    if (!state.disabled) {
      buyBtn.addEventListener('click', () => handlePurchase(row, buyBtn));
    }
    return card;
  }

  function filteredItems() {
    return items.filter((it) => {
      if (activeSlot !== 'all' && it.equipment_slot !== activeSlot) return false;
      if (activeStatus) {
        const sf = STATUS_FILTERS.find((s) => s.key === activeStatus);
        if (sf && !sf.test(it)) return false;
      }
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        if (!(it.name.toLowerCase().includes(q) || (it.description || '').toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }

  function totalPageCount(list) {
    return Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  }

  function renderGrid() {
    const filtered = filteredItems();
    const totalPages = totalPageCount(filtered);
    if (currentPage > totalPages) currentPage = totalPages;
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = filtered.slice(start, start + PAGE_SIZE);

    grid.innerHTML = '';
    if (pageItems.length === 0) {
      grid.innerHTML = '<div class="shop-empty">No items match — try a different filter or search.</div>';
    } else {
      pageItems.forEach((row) => grid.appendChild(renderCard(row)));
    }
    renderPagination(totalPages);
  }

  function pageButton(p) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'shop-page' + (p === currentPage ? ' active' : '');
    btn.textContent = String(p);
    btn.addEventListener('click', () => { currentPage = p; renderGrid(); window.scrollTo({ top: grid.offsetTop - 90, behavior: 'smooth' }); });
    return btn;
  }

  function renderPagination(totalPages) {
    pagEl.innerHTML = '';
    if (totalPages <= 1) return;
    const prev = document.createElement('button');
    prev.type = 'button'; prev.className = 'shop-page'; prev.textContent = '‹'; prev.disabled = currentPage === 1;
    prev.addEventListener('click', () => { currentPage = Math.max(1, currentPage - 1); renderGrid(); });
    pagEl.appendChild(prev);

    for (let p = 1; p <= totalPages; p++) pagEl.appendChild(pageButton(p));

    const next = document.createElement('button');
    next.type = 'button'; next.className = 'shop-page'; next.textContent = '›'; next.disabled = currentPage === totalPages;
    next.addEventListener('click', () => { currentPage = Math.min(totalPages, currentPage + 1); renderGrid(); });
    pagEl.appendChild(next);
  }

  function renderAll() {
    renderSlotFilters();
    renderStatusFilters();
    renderGrid();
  }

  async function loadShopItems() {
    const client = window.QZAuth && window.QZAuth.client;
    if (!client) {
      grid.innerHTML = '<div class="shop-empty">The shop isn’t configured on this deployment yet.</div>';
      return;
    }
    const { data, error } = await client.rpc('get_shop_items');
    if (error) {
      showBanner('Couldn’t load the shop right now — please try again shortly.', true);
      grid.innerHTML = '<div class="shop-empty">Failed to load items.</div>';
      return;
    }
    items = data || [];
    renderAll();
  }

  async function loadWallet() {
    const profile = window.QZAuth ? await window.QZAuth.getProfile() : null;
    signedIn = !!profile;
    if (profile) {
      qpValueEl.textContent = Number(profile.quest_points || 0).toLocaleString();
      stardustValueEl.textContent = Number(profile.stardust || 0).toLocaleString();
    } else {
      qpValueEl.textContent = '0';
      stardustValueEl.textContent = '0';
    }
    qpValueEl.classList.remove('loading');
    stardustValueEl.classList.remove('loading');
  }

  async function refreshAll() {
    // loadWallet must resolve FIRST — loadShopItems' renderGrid() reads
    // `signedIn`, and running both in parallel raced the two, so a
    // freshly-loaded, already-signed-in page could render every card
    // stuck on "Login to Purchase" (the button state computed before
    // loadWallet had actually set `signedIn = true`).
    await loadWallet();
    await loadShopItems();
  }

  async function handlePurchase(row, buyBtn) {
    const client = window.QZAuth.client;
    buyBtn.disabled = true;
    buyBtn.classList.add('loading');
    const requestId = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : null;
    try {
      const { data, error } = await client.rpc('purchase_item', {
        p_item_id: row.item_id,
        p_quantity: 1,
        p_request_id: requestId
      });
      if (error) throw error;
      // never grant visually before the server confirms — refresh from
      // real Supabase state only AFTER the RPC has actually returned
      await refreshAll();
      showPurchaseModal(row, data);
    } catch (err) {
      showToast((err && err.message) ? err.message : 'That purchase didn’t go through.', true);
      buyBtn.disabled = false;
      buyBtn.classList.remove('loading');
    }
  }

  let searchDebounce = null;
  searchEl.addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchTerm = e.target.value.trim();
      currentPage = 1;
      renderAll();
    }, 150);
  });

  document.addEventListener('DOMContentLoaded', () => {
    refreshAll();
  });
})();
