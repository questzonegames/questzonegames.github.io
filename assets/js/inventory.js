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

  const itemsById = {};
  ITEMS.forEach((it) => { itemsById[it.id] = it; });

  let equipped = loadEquipped();
  let activeFilter = 'all';
  let searchTerm = '';
  let currentPage = 1;
  let avatar = null;

  function loadEquipped() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return Object.assign({}, window.QZ_DEFAULT_EQUIPPED || {});
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
      '<div class="qz-examine-icon">' + item.icon + '</div>' +
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
      tile.className = 'worn-slot' + (item ? ' filled' : '') + (slotDef.key === 'head' || slotDef.key === 'accessory' ? ' worn-slot-solo' : '');
      tile.dataset.slot = slotDef.key;

      const iconEl = document.createElement('div');
      iconEl.className = 'worn-slot-icon';
      iconEl.textContent = item ? item.icon : '';
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

  function renderGrid() {
    const root = document.getElementById('inventory-grid');
    if (!root) return;
    const items = filteredItems();
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;
    const pageItems = items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    root.innerHTML = '';
    if (pageItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'inv-empty';
      empty.textContent = 'No items match.';
      root.appendChild(empty);
      return;
    }

    pageItems.forEach((item) => {
      const equippedNow = isEquipped(item.id);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'inv-card' + (equippedNow ? ' equipped' : '');
      card.title = item.name + '\n' + (SLOT_LABEL[item.slot] || item.slot);
      card.innerHTML =
        '<span class="inv-card-icon">' + item.icon + '</span>' +
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
    });
  }

  function renderPagination() {
    const root = document.getElementById('inventory-pagination');
    if (!root) return;
    const items = filteredItems();
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    root.innerHTML = '';

    const shown = Math.min(5, totalPages);
    for (let p = 1; p <= shown; p++) {
      root.appendChild(pageButton(p, totalPages));
    }
    if (totalPages > 5) {
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
