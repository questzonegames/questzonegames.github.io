// ===== Quest Zone — Inventory / Armory page controller =====
//
// Single source of truth for equipped items (`equipped`), persisted to
// localStorage so it survives reloads/navigation. Worn Equipment, the
// Inventory grid, and the avatar's loadout chips are all just renders of
// this one state object — nothing keeps its own separate copy.
//
// Data comes from window.QZ_INVENTORY / QZ_EQUIPMENT_SLOTS / QZ_DEFAULT_EQUIPPED
// (assets/js/inventory-data.js), a stand-in for a future profile.inventory /
// profile.equippedItems from real account data.
(function () {
  const STORAGE_KEY = 'qz_equipped_items';
  const PAGE_SIZE = 6;

  const SLOTS = window.QZ_EQUIPMENT_SLOTS || [];
  const ITEMS = window.QZ_INVENTORY || [];
  const SLOT_LABEL = {};
  SLOTS.forEach((s) => { SLOT_LABEL[s.key] = s.label; });

  // a few common real-world words for each slot, so "helmet" or "sword"
  // surfaces that whole category the way a player would expect, not just
  // items whose name happens to contain the word literally
  const SEARCH_SYNONYMS = {
    head: ['helmet', 'hat', 'cap', 'hood', 'visor'],
    necklace: ['pendant', 'amulet', 'chain', 'locket'],
    body: ['armor', 'armour', 'chest', 'jacket', 'coat', 'vest'],
    legs: ['pants', 'trousers', 'leggings'],
    boots: ['shoe', 'shoes', 'footwear'],
    gloves: ['gauntlets', 'mitts', 'hands'],
    back: ['cape', 'cloak', 'backpack'],
    mainHand: ['sword', 'weapon', 'blade', 'saber'],
    offHand: ['shield', 'buckler'],
    accessory: ['ring', 'badge', 'trinket', 'charm']
  };

  // simple, muted, monochrome placeholders for each empty equipment
  // slot — readable at a glance as "this slot holds this item type"
  // without looking like an actual equipped item
  const SLOT_SILHOUETTE = {
    head: '<path d="M12 3C8 3 5 6 5 10v3h14v-3c0-4-3-7-7-7z"/><rect x="4" y="13.3" width="16" height="2.4" rx="1"/>',
    necklace: '<path d="M6 4c0 5 3 8.5 6 8.5S18 9 18 4" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="15.3" r="2.6"/>',
    body: '<path d="M9 3l3 2.2L15 3l3 3-2 2v12H8V8L6 6z"/>',
    legs: '<path d="M7.2 3h9.6l-.6 8-1 10h-3l-.9-9h-.6l-.9 9h-3l-1-10z"/>',
    boots: '<path d="M9.5 3h5v8.5l4.2 2.8v3.2c0 .8-.7 1.5-1.5 1.5H9c-.8 0-1.5-.7-1.5-1.5V4.5C7.5 3.7 8.2 3 9.5 3z"/>',
    gloves: '<path d="M8.4 3.3h2.6V9h.9V4h2.6v5h.9V4.7h2.6V10l2.6 2.6v5.9c0 1.4-1.1 2.5-2.5 2.5h-6C10.6 21 9.5 19.9 9.5 18.5v-6.8L8.4 10.6z"/>',
    back: '<path d="M12 2.5l7.5 4.3-2.2 14.2H6.7L4.5 6.8z"/>',
    mainHand: '<rect x="11" y="2" width="2" height="12.5" rx="0.6"/><rect x="7" y="13.6" width="10" height="2.1" rx="0.6"/><rect x="10.3" y="16.1" width="3.4" height="6" rx="0.9"/>',
    offHand: '<path d="M12 2.3l7.2 3v6.2c0 5.1-3 8.9-7.2 11.2-4.2-2.3-7.2-6.1-7.2-11.2V5.3z"/>',
    accessory: '<circle cx="12" cy="14.5" r="6" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M9.3 8.2L12 3.6l2.7 4.6z"/>'
  };
  function silhouetteSVG(slotKey) {
    return '<svg class="worn-slot-empty-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + (SLOT_SILHOUETTE[slotKey] || '') + '</svg>';
  }

  const itemsById = {};
  ITEMS.forEach((it) => { itemsById[it.id] = it; });

  let equipped = loadEquipped();
  let activeFilter = 'all';
  let searchTerm = '';
  let currentPage = 1;
  let avatar = null;

  function loadEquipped() {
    let stored = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch (_) {}
    const base = Object.assign({}, window.QZ_DEFAULT_EQUIPPED || {});
    if (!stored) return base;
    // drop any stored id that no longer exists in the current catalog
    // (e.g. an older demo item id from before a data reset) instead of
    // leaving a dangling reference that renders nothing
    Object.keys(base).forEach((slotKey) => {
      const id = stored[slotKey];
      base[slotKey] = id && itemsById[id] ? id : null;
    });
    return base;
  }
  function saveEquipped() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(equipped)); } catch (_) {}
  }

  function isEquipped(itemId) {
    return Object.keys(equipped).some((slot) => equipped[slot] === itemId);
  }
  function equippedItemFor(slotKey) {
    const id = equipped[slotKey];
    return id ? itemsById[id] : null;
  }
  function expandedEquipped() {
    const out = {};
    SLOTS.forEach((s) => { out[s.key] = equippedItemFor(s.key); });
    return out;
  }

  function equip(itemId) {
    const item = itemsById[itemId];
    if (!item) return;
    equipped[item.slot] = itemId;
    saveEquipped();
    renderAll();
  }
  function unequip(slotKey) {
    if (!equipped[slotKey]) return;
    equipped[slotKey] = null;
    saveEquipped();
    renderAll();
  }

  // ---------------- context menu ----------------
  let menuEl = null;
  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
    document.removeEventListener('pointerdown', onOutsidePointer, true);
    document.removeEventListener('keydown', onMenuKey, true);
  }
  function onOutsidePointer(e) {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  }
  function onMenuKey(e) {
    if (e.key === 'Escape') closeMenu();
  }
  function openMenu(x, y, actions) {
    closeMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'qz-context-menu';
    actions.forEach((a) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = a.label;
      btn.addEventListener('click', () => { closeMenu(); a.onClick(); });
      menuEl.appendChild(btn);
    });
    document.body.appendChild(menuEl);

    const vw = window.innerWidth, vh = window.innerHeight;
    const rect = menuEl.getBoundingClientRect();
    const left = Math.min(x, vw - rect.width - 8);
    const top = Math.min(y, vh - rect.height - 8);
    menuEl.style.left = Math.max(8, left) + 'px';
    menuEl.style.top = Math.max(8, top) + 'px';

    setTimeout(() => {
      document.addEventListener('pointerdown', onOutsidePointer, true);
      document.addEventListener('keydown', onMenuKey, true);
    }, 0);
  }

  // ---------------- examine popover ----------------
  let examineEl = null;
  function closeExamine() {
    if (examineEl) { examineEl.remove(); examineEl = null; }
    document.removeEventListener('pointerdown', onOutsideExamine, true);
  }
  function onOutsideExamine(e) {
    if (examineEl && !examineEl.contains(e.target)) closeExamine();
  }
  function openExamine(item, x, y) {
    closeExamine();
    closeMenu();
    examineEl = document.createElement('div');
    examineEl.className = 'qz-examine';
    examineEl.innerHTML =
      '<div class="qz-examine-icon">' + (item.views ? '<img src="' + item.views.front + '" alt="">' : item.icon) + '</div>' +
      '<div class="qz-examine-name">' + item.name + '</div>' +
      '<div class="qz-examine-slot">' + (SLOT_LABEL[item.slot] || item.slot) + '</div>' +
      (isEquipped(item.id) ? '<div class="qz-examine-tag">Equipped</div>' : '');
    document.body.appendChild(examineEl);

    const vw = window.innerWidth, vh = window.innerHeight;
    const rect = examineEl.getBoundingClientRect();
    const left = Math.min(x, vw - rect.width - 8);
    const top = Math.min(y, vh - rect.height - 8);
    examineEl.style.left = Math.max(8, left) + 'px';
    examineEl.style.top = Math.max(8, top) + 'px';

    setTimeout(() => document.addEventListener('pointerdown', onOutsideExamine, true), 0);
  }

  // ---------------- rendering ----------------
  function renderWornEquipment() {
    const root = document.getElementById('worn-equipment');
    if (!root) return;
    root.innerHTML = '';
    SLOTS.forEach((slotDef) => {
      const item = equippedItemFor(slotDef.key);
      const tile = document.createElement('div');
      tile.className = 'worn-slot' + (item ? ' filled' : '');
      tile.dataset.slot = slotDef.key;

      const iconEl = document.createElement('div');
      iconEl.className = 'worn-slot-icon';
      if (item) {
        iconEl.innerHTML = item.views ? '<img src="' + item.views.front + '" alt="">' : item.icon;
      } else {
        iconEl.innerHTML = silhouetteSVG(slotDef.key);
      }
      tile.appendChild(iconEl);

      const labelEl = document.createElement('div');
      labelEl.className = 'worn-slot-label';
      labelEl.textContent = slotDef.label;
      tile.appendChild(labelEl);

      tile.title = item ? (item.name + '\n' + slotDef.label) : slotDef.label;

      if (item) {
        tile.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          openMenu(e.clientX, e.clientY, [
            { label: 'UNEQUIP', onClick: () => unequip(slotDef.key) },
            { label: 'EXAMINE', onClick: () => openExamine(item, e.clientX, e.clientY) }
          ]);
        });
      }

      root.appendChild(tile);
    });
  }

  function itemMatchesSearch(item, term) {
    if (!term) return true;
    const t = term.trim().toLowerCase();
    if (!t) return true;
    if (item.name.toLowerCase().includes(t)) return true;
    if (item.slot.toLowerCase().includes(t)) return true;
    if ((SLOT_LABEL[item.slot] || '').toLowerCase().includes(t)) return true;
    const synonyms = SEARCH_SYNONYMS[item.slot] || [];
    return synonyms.some((word) => word.includes(t) || t.includes(word));
  }

  function filteredItems() {
    return ITEMS.filter((item) => (activeFilter === 'all' || item.slot === activeFilter) && itemMatchesSearch(item, searchTerm));
  }

  function renderFilters() {
    const root = document.getElementById('inventory-filters');
    if (!root) return;
    root.innerHTML = '';
    const defs = [{ key: 'all', label: 'All' }].concat(SLOTS);
    defs.forEach((f) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'inv-filter' + (activeFilter === f.key ? ' active' : '');
      btn.textContent = f.label;
      btn.addEventListener('click', () => {
        activeFilter = f.key;
        currentPage = 1;
        renderFilters();
        renderGrid();
        renderPagination();
      });
      root.appendChild(btn);
    });
  }

  // total page count for the pagination UI. Kept at a minimum of 5 while
  // the demo catalog is tiny, matching the "Page 1-5 ..." control the
  // eventual, much larger real inventory will actually need — the extra
  // pages just render as empty cells rather than being hidden entirely.
  function totalPageCount(items) {
    return Math.max(5, Math.ceil(items.length / PAGE_SIZE));
  }

  function renderGrid() {
    const root = document.getElementById('inventory-grid');
    if (!root) return;
    const items = filteredItems();
    const totalPages = totalPageCount(items);
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageItems = items.slice(start, start + PAGE_SIZE);

    root.innerHTML = '';
    for (let i = 0; i < PAGE_SIZE; i++) {
      const item = pageItems[i];
      if (!item) {
        const empty = document.createElement('div');
        empty.className = 'inv-card inv-card-empty';
        root.appendChild(empty);
        continue;
      }

      const equippedNow = isEquipped(item.id);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'inv-card' + (equippedNow ? ' equipped' : '');
      card.title = item.name + '\n' + (SLOT_LABEL[item.slot] || item.slot);
      const thumb = item.views ? '<img src="' + item.views.front + '" alt="">' : item.icon;
      card.innerHTML =
        '<span class="inv-card-icon">' + thumb + '</span>' +
        '<span class="inv-card-name">' + item.name + '</span>' +
        '<span class="inv-card-slot">' + (SLOT_LABEL[item.slot] || item.slot) + '</span>' +
        (equippedNow ? '<span class="inv-card-tag">Equipped</span>' : '');

      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const actions = equippedNow
          ? [
              { label: 'UNEQUIP', onClick: () => unequip(item.slot) },
              { label: 'EXAMINE', onClick: () => openExamine(item, e.clientX, e.clientY) }
            ]
          : [
              { label: 'EQUIP', onClick: () => equip(item.id) },
              { label: 'EXAMINE', onClick: () => openExamine(item, e.clientX, e.clientY) }
            ];
        openMenu(e.clientX, e.clientY, actions);
      });
      // keyboard/touch equivalent of right-click, for reachability
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const rect = card.getBoundingClientRect();
          card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: rect.left + 12, clientY: rect.bottom }));
        }
      });

      root.appendChild(card);
    }
  }

  function renderPagination() {
    const root = document.getElementById('inventory-pagination');
    if (!root) return;
    const items = filteredItems();
    const totalPages = totalPageCount(items);
    root.innerHTML = '';

    const shown = Math.min(5, totalPages);
    for (let p = 1; p <= shown; p++) {
      root.appendChild(pageButton(p, totalPages));
    }
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'inv-page inv-page-more';
    more.textContent = '…';
    more.setAttribute('aria-label', 'Jump to page');
    more.addEventListener('click', () => openPageJump(totalPages));
    root.appendChild(more);

    if (currentPage > shown) {
      root.appendChild(pageButton(currentPage, totalPages));
    }
  }

  function pageButton(p, totalPages) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'inv-page' + (p === currentPage ? ' active' : '');
    btn.textContent = 'Page ' + p;
    btn.addEventListener('click', () => {
      currentPage = Math.min(Math.max(1, p), totalPages);
      renderGrid();
      renderPagination();
    });
    return btn;
  }

  function openPageJump(totalPages) {
    closeMenu();
    const wrap = document.createElement('div');
    wrap.className = 'qz-page-jump';
    wrap.innerHTML =
      '<label>Go to page (1–' + totalPages + ')</label>' +
      '<input type="number" min="1" max="' + totalPages + '" step="1">' +
      '<button type="button">Go</button>';
    document.body.appendChild(wrap);

    const moreBtn = document.querySelector('.inv-page-more');
    const anchor = moreBtn ? moreBtn.getBoundingClientRect() : { left: 100, bottom: 100 };
    const vw = window.innerWidth;
    const rect = wrap.getBoundingClientRect();
    wrap.style.left = Math.max(8, Math.min(anchor.left, vw - rect.width - 8)) + 'px';
    wrap.style.top = (anchor.bottom + 6) + 'px';

    const input = wrap.querySelector('input');
    const go = wrap.querySelector('button');
    input.focus();

    function commit() {
      const n = parseInt(input.value, 10);
      if (!isNaN(n) && n >= 1 && n <= totalPages) {
        currentPage = n;
        renderGrid();
        renderPagination();
      }
      cleanup();
    }
    function cleanup() {
      wrap.remove();
      document.removeEventListener('pointerdown', onOutside, true);
    }
    function onOutside(e) {
      if (!wrap.contains(e.target)) cleanup();
    }
    go.addEventListener('click', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') commit();
      if (e.key === 'Escape') cleanup();
    });
    setTimeout(() => document.addEventListener('pointerdown', onOutside, true), 0);
  }

  function renderAll() {
    renderWornEquipment();
    renderGrid();
    renderPagination();
    if (avatar) avatar.setAvatarEquipment(expandedEquipped());
  }

  // ---------------- init ----------------
  function init() {
    const searchInput = document.getElementById('inventory-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        searchTerm = searchInput.value;
        currentPage = 1;
        renderGrid();
        renderPagination();
      });
    }

    const avatarContainer = document.getElementById('armory-avatar-3d');
    if (avatarContainer && window.QZAvatarViewer) {
      avatar = window.QZAvatarViewer.mount(avatarContainer);
      window.qzAvatar = avatar;
    }

    const arrowLeft = document.getElementById('armory-arrow-left');
    const arrowRight = document.getElementById('armory-arrow-right');
    if (arrowLeft) arrowLeft.addEventListener('click', () => window.qzAvatar && window.qzAvatar.prev());
    if (arrowRight) arrowRight.addEventListener('click', () => window.qzAvatar && window.qzAvatar.next());

    renderFilters();
    renderAll();

    window.addEventListener('pageshow', (e) => {
      if (e.persisted && avatarContainer && window.QZAvatarViewer && !avatarContainer.querySelector('img')) {
        avatar = window.QZAvatarViewer.mount(avatarContainer);
        window.qzAvatar = avatar;
        renderAll();
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
