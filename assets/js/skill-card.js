// ===== Quest Zone — shared Intelligence/skill card component =====
//
// One reusable "skill box" (icon + name + level, OSRS-style hover tooltip
// showing Current Level / Current XP / XP Remaining) used by BOTH
// profile/skills.html and the Anagram Quest lobby, so there is exactly one
// implementation of the look, the tooltip, and the data query — never a
// second hand-copied version that can drift out of sync.
//
// Every consumer reads the same source tables (public.games +
// public.game_progress) for the same game_key, so two pages showing the
// same skill always show the same number — there is no separate "lobby
// level" cached anywhere.
(function () {
  let stylesInjected = false;
  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
.qz-skillcard-box {
  position: relative;
  min-height: 92px;
  border-radius: 10px;
  border: 1.5px solid rgba(110,150,220,0.35);
  background: linear-gradient(180deg, rgba(14,20,38,0.85), rgba(6,10,20,0.9));
  padding: 8px 10px;
  display: flex; align-items: center;
  cursor: default;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  font-family: 'Exo 2', sans-serif;
}
.qz-skillcard-box:hover { border-color: #7cc4ff; box-shadow: 0 0 14px rgba(90,160,255,0.35); }
.qz-skillcard-box .qz-skillcard-id { display: flex; align-items: center; gap: 10px; min-width: 0; }
.qz-skillcard-box .qz-skillcard-id img { width: 68px; height: 68px; object-fit: contain; flex-shrink: 0; }
.qz-skillcard-box .qz-skillcard-name {
  font-family: 'Orbitron', sans-serif; font-weight: 700; font-size: 12px;
  letter-spacing: 0.03em; text-transform: uppercase; color: #eaf3ff;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.qz-skillcard-box .qz-skillcard-level {
  position: absolute; right: 10px; bottom: 6px;
  font-family: 'Orbitron', sans-serif; font-weight: 900; font-size: 26px; color: #ffcf4d;
}
.qz-skillcard-box .qz-skillcard-level .qz-skillcard-of99 { color: #9fb3d6; font-weight: 700; font-size: 18px; }

#qz-skillcard-tooltip {
  position: fixed; z-index: 9999; pointer-events: none;
  background: rgba(6,10,20,0.96); border: 1.5px solid #7cc4ff;
  border-radius: 8px; padding: 10px 13px; font-size: 12.5px; line-height: 1.7;
  box-shadow: 0 4px 18px rgba(0,0,0,0.6), 0 0 14px rgba(90,160,255,0.3);
  white-space: nowrap; opacity: 0; transform: translateY(4px);
  transition: opacity 0.1s ease, transform 0.1s ease;
  font-family: 'Exo 2', sans-serif; color: #eaf3ff;
}
#qz-skillcard-tooltip.show { opacity: 1; transform: translateY(0); }
#qz-skillcard-tooltip .t-name { font-family: 'Orbitron', sans-serif; font-weight: 900; color: #ffcf4d; margin-bottom: 4px; }
#qz-skillcard-tooltip .t-row span:first-child { color: #9fb3d6; margin-right: 8px; }

/* ---- "full" variant: icon + level + XP progress bar + caption. Used by
   the Anagram Quest lobby's Intelligence widget (mountFull) — a richer
   sibling of the compact .qz-skillcard-box above, sharing the same data
   fetch and the same hover tooltip, never a second implementation of
   either. Built so a page can drop more than one of these into the same
   slot side by side once a game awards XP in multiple skills (see
   .qz-skillcard-full-row below) without any redesign. ---- */
.qz-skillcard-full-row { display: flex; flex-direction: column; gap: 10px; }
.qz-skillcard-full {
  position: relative;
  display: flex; align-items: center; gap: 16px;
  border-radius: 14px; border: 1.5px solid rgba(255,207,77,0.35);
  background: linear-gradient(180deg, rgba(22,28,48,0.85), rgba(6,10,20,0.92));
  padding: 14px 16px;
  box-shadow: inset 0 0 20px rgba(255,200,80,0.06);
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
  cursor: default;
  font-family: 'Exo 2', sans-serif;
}
.qz-skillcard-full:hover { border-color: #ffcf4d; box-shadow: 0 0 18px rgba(255,207,77,0.3), inset 0 0 20px rgba(255,200,80,0.08); }
.qz-skillcard-full-icon { flex-shrink: 0; width: 60px; height: 60px; display: flex; align-items: center; justify-content: center; }
.qz-skillcard-full-icon img { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 0 10px rgba(255,150,60,0.5)); }
.qz-skillcard-full-body { flex: 1; min-width: 0; }
.qz-skillcard-full-toprow { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 7px; }
.qz-skillcard-full-name { font-family: 'Orbitron', sans-serif; font-weight: 900; font-size: 12.5px; letter-spacing: 0.06em; color: #eaf3ff; text-transform: uppercase; }
.qz-skillcard-full-level { font-family: 'Orbitron', sans-serif; font-weight: 900; font-size: 15px; color: #ffcf4d; white-space: nowrap; }
.qz-skillcard-full-level .qz-skillcard-full-of99 { color: #9fb3d6; font-weight: 700; font-size: 12px; }
.qz-skillcard-full-bar { height: 8px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; border: 1px solid rgba(255,255,255,0.08); }
.qz-skillcard-full-fill { height: 100%; background: linear-gradient(90deg,#e0a020,#ffcf4d); box-shadow: 0 0 8px rgba(255,207,77,0.6); transition: width 0.3s ease; }
.qz-skillcard-full-caption { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 11px; color: #9fb3d6; }
.qz-skillcard-full-info {
  width: 15px; height: 15px; border-radius: 50%; flex-shrink: 0;
  border: 1px solid #6fe3ff; color: #6fe3ff; font-size: 10px; font-style: italic;
  font-family: Georgia, serif; display: flex; align-items: center; justify-content: center;
}
    `;
    document.head.appendChild(style);
  }

  // ---- one shared tooltip element for every card on the page ----
  let tooltipEl = null;
  function getTooltip() {
    if (!tooltipEl) {
      tooltipEl = document.createElement('div');
      tooltipEl.id = 'qz-skillcard-tooltip';
      document.body.appendChild(tooltipEl);
    }
    return tooltipEl;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function showTooltip(e, skill) {
    const tooltip = getTooltip();
    const xpForNext = window.QZXp ? window.QZXp.xpForLevel(skill.level + 1) : null;
    const remaining = xpForNext === null ? null : Math.max(0, xpForNext - skill.xp);
    tooltip.innerHTML =
      '<div class="t-name">' + escapeHtml(skill.name) + '</div>' +
      '<div class="t-row"><span>Current Level:</span>' + skill.level + '/99</div>' +
      '<div class="t-row"><span>Current XP:</span>' + skill.xp.toLocaleString() + '</div>' +
      '<div class="t-row"><span>XP Remaining:</span>' + (remaining === null ? '—' : remaining.toLocaleString()) + '</div>';
    tooltip.classList.add('show');
    positionTooltip(e);
  }
  function positionTooltip(e) {
    const tooltip = getTooltip();
    const pad = 16;
    let x = e.clientX + pad, y = e.clientY + pad;
    const rect = tooltip.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - 8) x = e.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = e.clientY - rect.height - pad;
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }
  function hideTooltip() { getTooltip().classList.remove('show'); }

  // ---- box element for one real skill (icon + name + level + tooltip) ----
  function createBox(skill) {
    injectStyles();
    const box = document.createElement('div');
    box.className = 'qz-skillcard-box';
    // A skill with no real icon yet renders as level-only, same as an
    // un-branded Total Level Game slot — only skills with real art show
    // their name (matches the Skills page's original behaviour).
    box.innerHTML =
      (skill.iconSrc
        ? '<div class="qz-skillcard-id"><img src="' + skill.iconSrc + '" alt=""><span class="qz-skillcard-name">' + escapeHtml(skill.name) + '</span></div>'
        : '') +
      '<span class="qz-skillcard-level">' + skill.level + '<span class="qz-skillcard-of99">/99</span></span>';
    box.addEventListener('mouseenter', (e) => showTooltip(e, skill));
    box.addEventListener('mousemove', positionTooltip);
    box.addEventListener('mouseleave', hideTooltip);
    return box;
  }

  // ---- "full" box: icon + name/level row + XP progress bar + caption
  // (+ small decorative info dot). Same hover tooltip as the compact box
  // — hovering anywhere on the card reveals Current Level/Current XP/XP
  // Remaining, exactly like createBox() does; there is no second tooltip
  // implementation. opts.caption is a short line under the bar, e.g.
  // "Solve words to earn Intelligence XP" — purely presentational, never
  // read back. ----
  function createFullBox(skill, opts) {
    injectStyles();
    const caption = (opts && opts.caption) || '';
    const box = document.createElement('div');
    box.className = 'qz-skillcard-full';
    const lvl = window.QZXp ? window.QZXp.displayLevel(skill.xp) : { base: skill.level, virtual: skill.level, isVirtual: false };
    const base = lvl.base;
    let pct = 100;
    if (window.QZXp && base < 99) {
      const curFloor = window.QZXp.xpForLevel(base);
      const nextFloor = window.QZXp.xpForLevel(base + 1);
      const span = nextFloor - curFloor;
      pct = span > 0 ? Math.max(0, Math.min(100, ((skill.xp - curFloor) / span) * 100)) : 100;
    }
    const levelLabel = lvl.isVirtual
      ? base + ' <span class="qz-skillcard-full-of99">(Virtual ' + lvl.virtual + ')</span>'
      : base + '<span class="qz-skillcard-full-of99">/99</span>';
    box.innerHTML =
      (skill.iconSrc ? '<div class="qz-skillcard-full-icon"><img src="' + skill.iconSrc + '" alt=""></div>' : '') +
      '<div class="qz-skillcard-full-body">' +
        '<div class="qz-skillcard-full-toprow">' +
          '<span class="qz-skillcard-full-name">' + escapeHtml(skill.name) + '</span>' +
          '<span class="qz-skillcard-full-level">LEVEL ' + levelLabel + '</span>' +
        '</div>' +
        '<div class="qz-skillcard-full-bar"><div class="qz-skillcard-full-fill" style="width:' + pct + '%"></div></div>' +
        (caption
          ? '<div class="qz-skillcard-full-caption">' + escapeHtml(caption) + '<span class="qz-skillcard-full-info">i</span></div>'
          : '') +
      '</div>';
    box.addEventListener('mouseenter', (e) => showTooltip(e, skill));
    box.addEventListener('mousemove', positionTooltip);
    box.addEventListener('mouseleave', hideTooltip);
    return box;
  }

  // ---- shared data fetch: same public.games + public.game_progress read
  // every consumer of a given game_key uses, so no page carries its own
  // cached/duplicated copy of the level ----
  async function fetchSkill(client, userId, gameKey, fallbackName) {
    if (!client) return { game_key: gameKey, name: fallbackName || gameKey, xp: 0, level: 1 };
    const gamesReq = client.from('games').select('game_key,name').eq('game_key', gameKey).maybeSingle();
    const progressReq = userId
      ? client.from('game_progress').select('xp,level').eq('user_id', userId).eq('game_key', gameKey).maybeSingle()
      : Promise.resolve({ data: null });
    const [{ data: game }, { data: progress }] = await Promise.all([gamesReq, progressReq]);
    return {
      game_key: gameKey,
      name: (game && game.name) || fallbackName || gameKey,
      xp: (progress && progress.xp) || 0,
      level: (progress && progress.level) || 1
    };
  }

  // ---- mount: fetch + render one skill card into `container`, replacing
  // whatever was there. Safe to call again any time the account/skill data
  // might have changed (e.g. re-entering the lobby after a completed game)
  // — it always re-fetches fresh rather than reusing a stale cached value.
  async function mount(container, opts) {
    if (!container) return;
    injectStyles();
    const { client, userId, gameKey, iconSrc, fallbackName } = opts || {};
    try {
      const skill = await fetchSkill(client, userId, gameKey, fallbackName);
      skill.iconSrc = iconSrc;
      container.innerHTML = '';
      container.appendChild(createBox(skill));
    } catch (err) {
      console.warn('QZSkillCard: could not load skill data', err);
      // safe fallback while data is unavailable — never crash the host page
      container.innerHTML = '';
      container.appendChild(createBox({ game_key: gameKey, name: fallbackName || gameKey, xp: 0, level: 1, iconSrc }));
    }
  }

  // ---- mountFull: same fetch/refresh contract as mount(), but renders
  // the richer createFullBox() instead. opts adds `caption` (see above);
  // everything else (client/userId/gameKey/iconSrc/fallbackName) is
  // identical to mount(). A future multi-skill game can append more than
  // one full box into the same container (wrap it in a
  // .qz-skillcard-full-row) without touching this function. ----
  async function mountFull(container, opts) {
    if (!container) return;
    injectStyles();
    const { client, userId, gameKey, iconSrc, fallbackName, caption } = opts || {};
    try {
      const skill = await fetchSkill(client, userId, gameKey, fallbackName);
      skill.iconSrc = iconSrc;
      container.innerHTML = '';
      container.appendChild(createFullBox(skill, { caption }));
    } catch (err) {
      console.warn('QZSkillCard: could not load skill data (full)', err);
      container.innerHTML = '';
      container.appendChild(createFullBox({ game_key: gameKey, name: fallbackName || gameKey, xp: 0, level: 1, iconSrc }, { caption }));
    }
  }

  window.QZSkillCard = { injectStyles, createBox, createFullBox, fetchSkill, mount, mountFull };
})();
