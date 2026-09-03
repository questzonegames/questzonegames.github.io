// ===== Quest Zone — Inventory / Armory page controller =====
//
// Single source of truth for what an account owns and has equipped is
// Supabase now (inventory_items / equipped_items, both RLS-scoped to
// auth.uid() — see supabase/schema.sql), not localStorage. Worn
// Equipment, the Inventory grid, and the avatar's on-body art are all
// just renders of whatever those two tables currently say for the
// logged-in account; nothing here keeps a separate copy, and nothing
// renders at all until a real session is confirmed.
//
// window.QZ_ITEM_CATALOG (assets/js/inventory-data.js) is reference data
// only — every item that CAN exist, not what this account owns.
(function () {
  const PAGE_SIZE = 6;

  const SLOTS = window.QZ_EQUIPMENT_SLOTS || [];
  const CATALOG = window.QZ_ITEM_CATALOG || [];
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

  const catalogById = {};
  CATALOG.forEach((it) => { catalogById[it.id] = it; });

  let client = null;
  let uid = null;                 // the SIGNED-IN account's own id — always the caller, never the viewed account
  let viewUserId = null;          // whose inventory is being shown — uid, unless adminReadOnly
  let viewUsername = null;        // that account's username, ONLY set in admin view — named explicitly in the
                                   // remove-item confirmation so it's never ambiguous which account is affected
  let adminReadOnly = false;      // true when an admin is viewing someone else's inventory (view-only)
  let isAdminSelf = false;        // true when the signed-in account is an admin viewing THEIR OWN inventory —
                                   // offers "RETURN TO ADMIN INVENTORY" alongside the normal equip/unequip
  let ownedIds = new Set();       // item ids this account owns (inventory_items)
  let acquiredAtById = {};        // item id -> inventory_items.acquired_at (ISO string)
  let equipped = {};              // slotKey -> itemId, ONLY for slots with a row (equipped_items)
  let activeFilter = 'all';
  let searchTerm = '';
  let currentPage = 1;
  let avatar = null;

  function ownedItems() {
    return CATALOG.filter((it) => ownedIds.has(it.id));
  }

  // "8:37 PM on 03/09/2026" — UK date order, UTC, 12-hour clock. Reads
  // the actual acquired_at stored on the inventory row, not "now".
  function formatAcquired(isoString) {
    if (!isoString) return null;
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return null;
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const year = d.getUTCFullYear();
    let hours = d.getUTCHours();
    const minutes = String(d.getUTCMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    if (hours === 0) hours = 12;
    return hours + ':' + minutes + ' ' + ampm + ' on ' + day + '/' + month + '/' + year;
  }
  function isEquipped(itemId) {
    return Object.keys(equipped).some((slot) => equipped[slot] === itemId);
  }
  function equippedItemFor(slotKey) {
    const id = equipped[slotKey];
    return id ? catalogById[id] : null;
  }
  function expandedEquipped() {
    const out = {};
    SLOTS.forEach((s) => { out[s.key] = equippedItemFor(s.key); });
    return out;
  }

  async function equip(itemId) {
    if (adminReadOnly) return; // admin viewing someone else's inventory — view only, no write path yet
    const item = catalogById[itemId];
    if (!item || !ownedIds.has(itemId) || !client) return;
    const { error } = await client
      .from('equipped_items')
      .upsert({ user_id: uid, slot: item.slot, item_id: itemId }, { onConflict: 'user_id,slot' });
    if (error) { console.warn('Quest Zone: could not equip', error); return; }
    equipped[item.slot] = itemId;
    renderAll();
  }
  async function unequip(slotKey) {
    if (adminReadOnly) return;
    if (!equipped[slotKey] || !client) return;
    const { error } = await client
      .from('equipped_items')
      .delete()
      .eq('user_id', uid)
      .eq('slot', slotKey);
    if (error) { console.warn('Quest Zone: could not unequip', error); return; }
    delete equipped[slotKey];
    renderAll();
  }

  // Admin-only: remove an item from the VIEWED account (viewUserId), not
  // the signed-in admin's own inventory. Goes through
  // admin_delete_inventory_item — SECURITY DEFINER, re-checks is_admin()
  // itself — so this is only ever reachable in adminReadOnly mode anyway
  // (no menu entry offers it otherwise), and would be rejected by the
  // database even if called directly by a non-admin.
  async function adminDeleteItem(item) {
    if (!adminReadOnly || !client) return;
    // Names the account explicitly (not just "this account") so which
    // inventory is about to be touched is never ambiguous before an
    // irreversible delete — the account itself is also verified server-
    // side by admin_delete_inventory_item's own p_user parameter, this is
    // just making sure the ADMIN clicking confirm sees it plainly too.
    if (!window.confirm('Remove "' + item.name + '" from ' + (viewUsername || 'this account') + '’s inventory? This cannot be undone.')) return;
    const { error } = await client.rpc('admin_delete_inventory_item', { p_user: viewUserId, p_item_id: item.id });
    if (error) { window.alert('Could not remove item: ' + error.message); return; }
    ownedIds.delete(item.id);
    delete acquiredAtById[item.id];
    Object.keys(equipped).forEach((slot) => { if (equipped[slot] === item.id) delete equipped[slot]; });
    renderAll();
    if (window.qzToast) window.qzToast('Removed "' + item.name + '" from ' + (viewUsername || 'this account') + '’s inventory.');
  }

  // Admin-only, self-view: send an item from your OWN inventory back to
  // the shared Admin Inventory bank — same admin_delete_inventory_item()
  // function as adminDeleteItem above, just targeting your own uid instead
  // of a viewed account's id. Nothing "moves" server-side beyond deleting
  // your own row — the item was never anything but a catalog entry to
  // begin with, so removing your copy of it IS returning it to the bank.
  async function returnToAdminInventory(item) {
    if (!isAdminSelf || !client) return;
    if (!window.confirm('Return "' + item.name + '" to the Admin Inventory? You can send it back to yourself any time.')) return;
    const { error } = await client.rpc('admin_delete_inventory_item', { p_user: uid, p_item_id: item.id });
    if (error) { window.alert('Could not return item: ' + error.message); return; }
    ownedIds.delete(item.id);
    delete acquiredAtById[item.id];
    delete equipped[item.slot];
    renderAll();
    if (window.qzToast) window.qzToast('Returned "' + item.name + '" to the Admin Inventory.');
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
      if (a.danger) btn.className = 'danger';
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
          const actions = adminReadOnly
            ? [
                { label: 'EXAMINE', onClick: () => openExamine(item, e.clientX, e.clientY) },
                { label: 'REMOVE ITEM', danger: true, onClick: () => adminDeleteItem(item) }
              ]
            : [
                { label: 'UNEQUIP', onClick: () => unequip(slotDef.key) },
                { label: 'EXAMINE', onClick: () => openExamine(item, e.clientX, e.clientY) }
              ].concat(isAdminSelf ? [{ label: 'RETURN TO ADMIN INVENTORY', danger: true, onClick: () => returnToAdminInventory(item) }] : []);
          openMenu(e.clientX, e.clientY, actions);
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
    return ownedItems().filter((item) => (activeFilter === 'all' || item.slot === activeFilter) && itemMatchesSearch(item, searchTerm));
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

  // total page count for the pagination UI. Kept at a minimum of 5 so the
  // "Page 1-5 ..." control is always there the way a much fuller inventory
  // will actually need — the extra pages just render as empty cells
  // rather than being hidden entirely when an account owns little or
  // nothing yet.
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
      const slotLabel = (SLOT_LABEL[item.slot] || item.slot) + ' Slot';
      const acquired = formatAcquired(acquiredAtById[item.id]);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'inv-card' + (equippedNow ? ' equipped' : '');
      card.title = item.name + '\n' + slotLabel + (acquired ? '\nDate acquired: ' + acquired : '');
      const thumb = item.views ? '<img src="' + item.views.front + '" alt="">' : item.icon;
      card.innerHTML =
        '<span class="inv-card-icon">' + thumb + '</span>' +
        '<span class="inv-card-name">' + item.name + '</span>' +
        '<span class="inv-card-slot">' + slotLabel + '</span>' +
        (equippedNow ? '<span class="inv-card-tag">Equipped</span>' : '');

      card.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const actions = adminReadOnly
          ? [
              { label: 'EXAMINE', onClick: () => openExamine(item, e.clientX, e.clientY) },
              { label: 'REMOVE ITEM', danger: true, onClick: () => adminDeleteItem(item) }
            ]
          : (equippedNow
              ? [
                  { label: 'UNEQUIP', onClick: () => unequip(item.slot) },
                  { label: 'EXAMINE', onClick: () => openExamine(item, e.clientX, e.clientY) }
                ]
              : [
                  { label: 'EQUIP', onClick: () => equip(item.id) },
                  { label: 'EXAMINE', onClick: () => openExamine(item, e.clientX, e.clientY) }
                ]
            ).concat(isAdminSelf ? [{ label: 'RETURN TO ADMIN INVENTORY', danger: true, onClick: () => returnToAdminInventory(item) }] : []);
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

  // ---------------- gating + data load ----------------
  function setState(html) {
    const stateEl = document.getElementById('inventory-state');
    const gridEl = document.getElementById('armory-grid');
    if (stateEl) { stateEl.innerHTML = html; stateEl.hidden = false; }
    if (gridEl) gridEl.hidden = true;
  }

  async function loadAccountData() {
    // Explicit .eq(user_id) rather than relying on RLS to implicitly scope
    // to "just my rows" — correct either way for a normal self-view, but
    // required once an admin can also be the caller: without it, an
    // admin's unfiltered select would come back with EVERY account's rows
    // (RLS lets admins see all of them), not just the one being viewed.
    const [invRes, eqRes] = await Promise.all([
      client.from('inventory_items').select('item_id,acquired_at').eq('user_id', viewUserId),
      client.from('equipped_items').select('slot,item_id').eq('user_id', viewUserId)
    ]);
    if (invRes.error) { setState('<div class="icon">⚠️</div>Could not load your inventory: ' + invRes.error.message); return false; }
    if (eqRes.error) { setState('<div class="icon">⚠️</div>Could not load your equipment: ' + eqRes.error.message); return false; }

    ownedIds = new Set((invRes.data || []).map((r) => r.item_id));
    acquiredAtById = {};
    (invRes.data || []).forEach((r) => { acquiredAtById[r.item_id] = r.acquired_at; });
    equipped = {};
    (eqRes.data || []).forEach((r) => { if (r.item_id) equipped[r.slot] = r.item_id; });
    return true;
  }

  function mountAvatar() {
    const avatarContainer = document.getElementById('armory-avatar-3d');
    if (avatarContainer && window.QZAvatarViewer) {
      avatar = window.QZAvatarViewer.mount(avatarContainer);
      window.qzAvatar = avatar;
    }
    const arrowLeft = document.getElementById('armory-arrow-left');
    const arrowRight = document.getElementById('armory-arrow-right');
    if (arrowLeft) arrowLeft.addEventListener('click', () => window.qzAvatar && window.qzAvatar.prev());
    if (arrowRight) arrowRight.addEventListener('click', () => window.qzAvatar && window.qzAvatar.next());

    window.addEventListener('pageshow', (e) => {
      if (e.persisted && avatarContainer && window.QZAvatarViewer && !avatarContainer.querySelector('img')) {
        avatar = window.QZAvatarViewer.mount(avatarContainer);
        window.qzAvatar = avatar;
        if (avatar) avatar.setAvatarEquipment(expandedEquipped());
      }
    });
  }

  async function init() {
    if (!window.QZAuth || !window.QZAuth.configured) {
      setState('<div class="icon">⚠️</div>Accounts aren’t configured on this deployment yet.');
      return;
    }
    const session = await window.QZAuth.getSession();
    if (!session) {
      setState('<div class="icon">🔒</div>Log in to view your Inventory.<br><br><a class="btn btn-chrome-blue" href="../login.html">Log In</a>');
      return;
    }

    client = window.QZAuth.client;
    uid = session.user.id;
    viewUserId = uid;

    const profile = await window.QZAuth.getProfile();
    const nameEl = document.getElementById('armory-username');

    // ?admin_view=<user id> — an admin viewing someone else's inventory,
    // read-only. Real enforcement is RLS: the profiles lookup below only
    // ever returns a row because "profiles_select_own_or_admin" allows it
    // for an admin caller — a non-admin who forges this URL gets zero
    // rows and lands on the same blocked state as "account not found",
    // no matter what the is_admin check right above it says.
    const params = new URLSearchParams(location.search);
    const targetId = params.get('admin_view');
    if (targetId) {
      if (!profile || !profile.is_admin) {
        setState('<div class="icon">🚫</div>This view is only available to Quest Zone administrators.');
        return;
      }
      const { data: targetProfile, error: profErr } = await client.from('profiles').select('username').eq('id', targetId).single();
      if (profErr || !targetProfile) {
        setState('<div class="icon">⚠️</div>That account could not be found.');
        return;
      }
      viewUserId = targetId;
      viewUsername = targetProfile.username;
      adminReadOnly = true;
      if (nameEl) nameEl.textContent = targetProfile.username;

      const banner = document.getElementById('admin-view-banner');
      const bannerName = document.getElementById('admin-view-username');
      if (bannerName) bannerName.textContent = targetProfile.username;
      if (banner) banner.hidden = false;

      const backBtn = document.getElementById('armory-back-btn');
      if (backBtn) backBtn.setAttribute('href', 'index.html?admin_view=' + encodeURIComponent(targetId));
    } else if (nameEl && profile) {
      nameEl.textContent = profile.username;
      isAdminSelf = !!profile.is_admin;
    }

    const ok = await loadAccountData();
    if (!ok) return;

    mountAvatar();

    const searchInput = document.getElementById('inventory-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        searchTerm = searchInput.value;
        currentPage = 1;
        renderGrid();
        renderPagination();
      });
    }

    renderFilters();
    renderAll();

    const stateEl = document.getElementById('inventory-state');
    const gridEl = document.getElementById('armory-grid');
    if (stateEl) stateEl.hidden = true;
    if (gridEl) gridEl.hidden = false;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
