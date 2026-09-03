// ===== Quest Zone — "you received an item" notification =====
//
// Shows a celebratory popup for any inventory_items row the signed-in
// player hasn't been shown yet (notified_at is null) — self-contained
// (injects its own <style>, unlike most of this site's page-local CSS)
// since it's meant to run unmodified on every page rather than being
// duplicated into each one.
//
// When to check:
//   - Automatically once on every page load (DOMContentLoaded) — this is
//     "somewhere else on the website", and for a game page specifically
//     it fires BEFORE play starts (script runs on load, not mid-game).
//   - window.QZItemNotify.checkNow() — call this right after a game
//     round ends (see games/space-snake/index.html's gameOver()) so a
//     gift lands the moment a round finishes, not just on next navigation.
// Never called during active gameplay itself — nothing here polls.
//
// Several unseen items queue up and show one at a time, each marked seen
// (via mark_item_seen()) only once its own popup is dismissed — so a
// closed tab / interrupted session just picks the queue back up next time
// rather than silently marking things seen it was never shown.
(function () {
  let queue = [];
  let showing = false;
  let currentRow = null;
  let backdropEl;
  let checked = false;

  function injectStyles() {
    if (document.getElementById('qz-itemnotify-style')) return;
    const style = document.createElement('style');
    style.id = 'qz-itemnotify-style';
    style.textContent =
      '.qz-itemnotify-backdrop{position:fixed;inset:0;z-index:900;display:none;align-items:center;justify-content:center;' +
      'padding:16px;background:rgba(4,7,14,0.75);backdrop-filter:blur(3px);}' +
      '.qz-itemnotify-backdrop.show{display:flex;}' +
      '.qz-itemnotify-card{position:relative;width:100%;max-width:340px;text-align:center;padding:28px 24px 24px;' +
      'border-radius:14px;border:1.5px solid rgba(140,195,255,0.45);' +
      'background:linear-gradient(165deg,#101a30 0%,#060b16 100%);' +
      'box-shadow:0 20px 60px rgba(0,0,0,0.6),0 0 40px rgba(90,180,255,0.3);' +
      'font-family:"Exo 2",sans-serif;color:#e8ecff;' +
      'transform:scale(0.92);opacity:0;transition:transform 0.25s ease,opacity 0.25s ease;}' +
      '.qz-itemnotify-backdrop.show .qz-itemnotify-card{transform:scale(1);opacity:1;}' +
      '.qz-itemnotify-icon{width:88px;height:88px;margin:0 auto 14px;border-radius:12px;' +
      'background:radial-gradient(circle at 50% 35%,rgba(90,180,255,0.25),rgba(6,10,20,0.9));' +
      'display:flex;align-items:center;justify-content:center;overflow:hidden;' +
      'box-shadow:0 0 24px rgba(90,180,255,0.35);}' +
      '.qz-itemnotify-icon img{max-width:78%;max-height:78%;object-fit:contain;' +
      'filter:drop-shadow(0 0 10px rgba(255,210,90,0.5));}' +
      '.qz-itemnotify-title{font-family:"Orbitron",sans-serif;font-weight:800;font-size:14px;' +
      'letter-spacing:0.04em;color:#8fd2ff;margin-bottom:8px;text-shadow:0 0 12px rgba(90,180,255,0.5);}' +
      '.qz-itemnotify-name{font-family:"Orbitron",sans-serif;font-weight:700;font-size:19px;color:#fff;margin-bottom:8px;}' +
      '.qz-itemnotify-meta{font-size:12px;color:#a9b1d6;line-height:1.6;margin-bottom:20px;}' +
      '.qz-itemnotify-close{padding:10px 26px;border-radius:9px;border:1.5px solid rgba(150,200,255,0.5);' +
      'background:linear-gradient(180deg,#3b6fe0 0%,#1c3a8f 100%);color:#fff;' +
      'font-family:"Orbitron",sans-serif;font-size:11.5px;letter-spacing:0.05em;cursor:pointer;}' +
      '.qz-itemnotify-close:hover{filter:brightness(1.15);}';
    document.head.appendChild(style);
  }

  function build() {
    if (backdropEl) return;
    injectStyles();
    backdropEl = document.createElement('div');
    backdropEl.className = 'qz-itemnotify-backdrop';
    backdropEl.setAttribute('aria-hidden', 'true');
    backdropEl.innerHTML =
      '<div class="qz-itemnotify-card" role="dialog" aria-modal="true">' +
        '<div class="qz-itemnotify-icon"><img alt=""></div>' +
        '<div class="qz-itemnotify-title"></div>' +
        '<div class="qz-itemnotify-name"></div>' +
        '<div class="qz-itemnotify-meta"></div>' +
        '<button type="button" class="qz-itemnotify-close">Nice!</button>' +
      '</div>';
    document.body.appendChild(backdropEl);
    backdropEl.querySelector('.qz-itemnotify-close').addEventListener('click', dismiss);
    backdropEl.addEventListener('click', (e) => { if (e.target === backdropEl) dismiss(); });
  }

  // "8:37 PM on 03/09/2026" — same UK/UTC/12-hour convention used
  // everywhere else on the site (see inventory.js's formatAcquired).
  function formatUk(isoString) {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const day = String(d.getUTCDate()).padStart(2, '0');
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const year = d.getUTCFullYear();
    let hours = d.getUTCHours();
    const minutes = String(d.getUTCMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12; if (hours === 0) hours = 12;
    return hours + ':' + minutes + ' ' + ampm + ' on ' + day + '/' + month + '/' + year;
  }

  function catalogItem(itemId) {
    return (window.QZ_ITEM_CATALOG || []).find((i) => i.id === itemId) || null;
  }

  function showNext() {
    if (showing || !queue.length) return;
    const entry = queue.shift();
    currentRow = entry.row;
    showing = true;
    build();

    const item = catalogItem(entry.row.item_id);
    const titleEl = backdropEl.querySelector('.qz-itemnotify-title');
    const nameEl = backdropEl.querySelector('.qz-itemnotify-name');
    const metaEl = backdropEl.querySelector('.qz-itemnotify-meta');
    const img = backdropEl.querySelector('.qz-itemnotify-icon img');

    titleEl.textContent = entry.gifterName ? '🎁 You were gifted an item!' : '🎉 You received an item!';
    nameEl.textContent = item ? item.name : entry.row.item_id;
    let meta = 'Acquired: ' + formatUk(entry.row.acquired_at);
    if (entry.gifterName) meta += '\nGifted by an admin: ' + entry.gifterName;
    metaEl.textContent = meta;
    metaEl.style.whiteSpace = 'pre-line';
    img.src = item && item.views ? item.views.front : '';
    img.style.display = item ? '' : 'none';
    if (!item) backdropEl.querySelector('.qz-itemnotify-icon').textContent = '🎁';

    backdropEl.setAttribute('aria-hidden', 'false');
    // requestAnimationFrame only fires once the tab is actually painting —
    // it can be suspended indefinitely in a backgrounded/inactive tab, which
    // would leave the popup permanently invisible for anyone who, say,
    // opened this in a background tab. setTimeout still reliably fires
    // there; the class is only split from element-creation at all so the
    // CSS transition actually animates instead of jumping straight to its
    // end state.
    setTimeout(() => backdropEl.classList.add('show'), 20);
  }

  async function dismiss() {
    if (!showing || !currentRow) return;
    const row = currentRow;
    backdropEl.classList.remove('show');
    backdropEl.setAttribute('aria-hidden', 'true');
    showing = false;
    currentRow = null;
    if (window.QZAuth && window.QZAuth.client) {
      // Supabase's query/rpc builder is only "thenable" (implements .then),
      // not a real Promise — chaining .catch() directly on it throws
      // synchronously ("...catch is not a function") instead of catching
      // anything, which silently skipped this call entirely every time.
      // Caught by testing the actual dismiss flow end-to-end, not just the
      // RPC in isolation.
      try {
        await window.QZAuth.client.rpc('mark_item_seen', { p_item_id: row.item_id });
      } catch (_) { /* not fatal — the popup just may reappear next check */ }
    }
    setTimeout(showNext, 300);
  }

  async function checkNow() {
    if (showing) return; // don't stack a second check while one's already displaying
    if (!window.QZAuth || !window.QZAuth.client) return;
    const session = await window.QZAuth.getSession();
    if (!session) return;

    const { data, error } = await window.QZAuth.client
      .from('inventory_items')
      .select('item_id, acquired_at, granted_by')
      .eq('user_id', session.user.id)
      .is('notified_at', null)
      .order('acquired_at', { ascending: true });
    if (error || !data || !data.length) return;

    const alreadyQueued = new Set(queue.map((e) => e.row.item_id));
    for (const row of data) {
      if (alreadyQueued.has(row.item_id)) continue;
      let gifterName = null;
      if (row.granted_by && row.granted_by !== session.user.id) {
        try {
          const nameRes = await window.QZAuth.client.rpc('username_for_id', { p_id: row.granted_by });
          gifterName = nameRes.data || null;
        } catch (_) { /* fall back to a plain "you received an item" message below */ }
      }
      queue.push({ row, gifterName });
    }
    showNext();
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && showing) dismiss(); });

  function runOnLoad() {
    if (checked) return;
    checked = true;
    checkNow();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', runOnLoad);
  else runOnLoad();

  window.QZItemNotify = { checkNow };
})();
