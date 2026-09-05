// ===== Quest Zone — shared Highscores logic =====
//
// Used by highscores.html, highscores/player.html, and
// highscores/compare.html — the ONE place the skill registry, rank-badge
// rendering, and HTML-escaping for the Highscores system live, so all
// three pages read the same real skill list from Supabase and render
// ranks identically. None of this ever fabricates data — the registry
// just describes WHICH skills to show a box for; every actual level/XP/
// rank value always comes from a hiscores_* RPC call in the page itself.
(function () {
  const REAL_SKILL_ICONS = { intelligence: 'assets/img/skills/intelligence.png' };

  function placeholderIconSvg() {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2l8 4.5v9L12 20l-8-4.5v-9L12 2z"/><circle cx="12" cy="11.5" r="2.2" fill="currentColor" stroke="none"/></svg>';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function rankBadgeHtml(rank) {
    if (rank === null || rank === undefined) return '<span style="color:var(--text-dim);">—</span>';
    if (rank === 1) return '<span class="hs-rank-badge gold">1</span>';
    if (rank === 2) return '<span class="hs-rank-badge silver">2</span>';
    if (rank === 3) return '<span class="hs-rank-badge bronze">3</span>';
    return String(rank);
  }

  // basePrefix: '' when called from highscores.html (root), '../' when
  // called from highscores/player.html or highscores/compare.html — only
  // affects where the Intelligence icon image is fetched from; the
  // Supabase query itself is identical either way.
  async function loadSkillRegistry(client, basePrefix) {
    const prefix = basePrefix || '';
    // "Total Level" (id stays 'overall' internally — every RPC/param name
    // keys off this id) is ranked by total level first, total XP as the
    // tiebreak — see hiscores_overall()/hiscores_player_stats() in
    // supabase/schema.sql. Renamed from "Overall" for clarity only; no
    // ranking behaviour changed.
    const registry = [{ id: 'overall', name: 'Total Level', iconHtml: '<span style="font-size:17px;">🏆</span>', real: true, placeholder: false }];
    try {
      if (client) {
        const { data: games } = await client.from('games').select('game_key,name,sort_order').order('sort_order', { ascending: true });
        (games || []).forEach((g) => {
          const iconSrc = REAL_SKILL_ICONS[g.game_key];
          registry.push({
            id: g.game_key,
            name: g.name,
            iconHtml: iconSrc ? '<img src="' + prefix + iconSrc + '" alt="">' : placeholderIconSvg(),
            real: true,
            placeholder: false
          });
        });
      }
    } catch (err) {
      console.warn('Highscores: could not load skill registry', err);
    }
    // Intelligence is Skill 1; Skill 2-24 are fixed placeholder slots, not
    // backed by any database row (24 skills total). Once a real skill
    // exists for one of these, it will already appear above from the
    // real-games loop instead — nothing here needs editing.
    for (let i = 2; i <= 24; i++) {
      registry.push({ id: 'skill-' + i, name: 'Skill ' + i, iconHtml: placeholderIconSvg(), real: false, placeholder: true });
    }
    return registry;
  }

  // ================= navigation URLs =================
  // Every link between the three Highscores pages is built here, once, so
  // the three pages can never point at each other with slightly different
  // (or wrong) relative paths. `basePrefix` is the same value already
  // passed to loadSkillRegistry(): '' from highscores.html (root), '../'
  // from highscores/player.html or highscores/compare.html.
  function playerUrl(basePrefix, username) {
    const inSubfolder = basePrefix === '../';
    return (inSubfolder ? '' : 'highscores/') + 'player.html?u=' + encodeURIComponent(username);
  }
  function compareUrl(basePrefix, usernameA, usernameB) {
    const inSubfolder = basePrefix === '../';
    return (inSubfolder ? '' : 'highscores/') + 'compare.html?a=' + encodeURIComponent(usernameA) + '&b=' + encodeURIComponent(usernameB);
  }
  // Links a skill's name back to its own ranking on the main Highscores
  // page (e.g. from a player's profile, or from Compare) — only ever built
  // for a REAL skill (never a Skill 2-24 placeholder, which has no ranking
  // to link to). `skillId` is always a known registry id, never raw user
  // input, so no extra validation is needed on the way out; highscores.html
  // still re-validates it against its own registry on the way in.
  function highscoresSkillUrl(basePrefix, skillId) {
    const inSubfolder = basePrefix === '../';
    return (inSubfolder ? '../' : '') + 'highscores.html?skill=' + encodeURIComponent(skillId);
  }

  // One name/skill cell, used by every hs-table on every page: an icon +
  // label, optionally wrapped in a link. Guarantees the exact same markup
  // (and therefore the exact same alignment) everywhere it appears.
  function nameCellHtml(iconHtml, label, href) {
    const inner = '<span class="hs-skill-icon-sm">' + iconHtml + '</span>' +
      (href ? '<a class="hs-row-link" href="' + href + '">' + escapeHtml(label) + '</a>' : escapeHtml(label));
    return '<span class="hs-name-cell">' + inner + '</span>';
  }

  window.QZHiscores = {
    loadSkillRegistry, escapeHtml, rankBadgeHtml, placeholderIconSvg, REAL_SKILL_ICONS,
    playerUrl, compareUrl, highscoresSkillUrl, nameCellHtml
  };
})();
