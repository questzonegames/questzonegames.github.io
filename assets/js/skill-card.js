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

  window.QZSkillCard = { injectStyles, createBox, fetchSkill, mount };
})();
