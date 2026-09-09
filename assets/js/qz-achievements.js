// ===== Quest Zone — shared Achievements module =====
//
// The ONE place tier styling lives (add a tier here, every page that uses
// QZ_ACHIEVEMENT_TIERS picks it up automatically — nothing else hardcodes
// tier colours), plus the reusable unlock entry point any game/page calls:
//
//   window.QZAchievements.unlock('anagram_first_word')
//
// which wraps the server-side public.unlock_achievement() RPC (see
// supabase/migrations/20260909020000_achievements_site_wide.sql) — never
// writes to unlocked_achievements directly, since that table has no client
// insert policy on purpose. Safe to call from anywhere, anytime, including
// signed-out (silently no-ops) and for an already-unlocked id (idempotent,
// resolves to {newlyUnlocked:false}).
//
// window.QZAchievements.notify(name, payload) is the pre-existing hook
// games/anagram-quest/anagram-quest.js already calls defensively
// (`if (window.QZAchievements && window.QZAchievements.notify)`) — this
// file is what makes that hook real. It's a thin pass-through to unlock()
// today (name IS the achievement id); kept as a separate method so a
// future event->achievement mapping table could sit here without any
// calling game code changing.
(function () {
  // Central tier registry — order matters (index = rank, used for the
  // "Tier" sort option). Add a tier here and it's immediately usable in
  // achievement rows' `tier` column, filterable, and correctly coloured
  // everywhere without touching any other file.
  const TIERS = {
    bronze:   { label: 'Bronze',   rank: 1, color: '#c98452', glow: 'rgba(201,132,82,0.45)',  bg: 'linear-gradient(165deg, rgba(90,55,30,0.55) 0%, rgba(20,12,8,0.7) 100%)' },
    silver:   { label: 'Silver',   rank: 2, color: '#c7d3e6', glow: 'rgba(199,211,230,0.5)',  bg: 'linear-gradient(165deg, rgba(70,80,95,0.55) 0%, rgba(14,16,20,0.7) 100%)' },
    gold:     { label: 'Gold',     rank: 3, color: '#ffcf4d', glow: 'rgba(255,207,77,0.55)',  bg: 'linear-gradient(165deg, rgba(100,75,10,0.55) 0%, rgba(20,14,4,0.7) 100%)' },
    platinum: { label: 'Platinum', rank: 4, color: '#8fe8e0', glow: 'rgba(143,232,224,0.55)', bg: 'linear-gradient(165deg, rgba(20,80,80,0.55) 0%, rgba(6,18,18,0.7) 100%)' },
    diamond:  { label: 'Diamond',  rank: 5, color: '#9fc3ff', glow: 'rgba(159,195,255,0.65)', bg: 'linear-gradient(165deg, rgba(30,55,120,0.55) 0%, rgba(8,12,26,0.7) 100%)' }
  };
  const DEFAULT_TIER = { label: 'Unranked', rank: 0, color: '#9fb3d6', glow: 'rgba(159,179,214,0.35)', bg: 'linear-gradient(165deg, rgba(40,48,64,0.5) 0%, rgba(10,12,18,0.7) 100%)' };
  function tierInfo(tierKey) {
    return TIERS[String(tierKey || '').toLowerCase()] || DEFAULT_TIER;
  }

  // Fire-and-collect: many "event" achievements (first word, first 7-
  // letter word, ...) get called unconditionally at the moment they
  // happen — unlock_achievement() is idempotent server-side, so no
  // client-side "have I already sent this" bookkeeping is needed here.
  async function unlock(achievementId) {
    if (!achievementId) return { achievementId, newlyUnlocked: false };
    if (!window.QZAuth || !window.QZAuth.client) return { achievementId, newlyUnlocked: false };
    try {
      const session = await window.QZAuth.getSession();
      if (!session) return { achievementId, newlyUnlocked: false }; // signed out — nothing to unlock against
      const { data, error } = await window.QZAuth.client.rpc('unlock_achievement', { p_achievement_id: achievementId });
      // No console.warn on error here on purpose — notify() (below) passes
      // through arbitrary game-event names, most of which are NOT real
      // achievement ids yet (no event->id mapping table exists), so an
      // "unknown achievement" RPC error is an expected, harmless, frequent
      // occurrence, not something worth logging every time.
      if (error) return { achievementId, newlyUnlocked: false };
      const row = Array.isArray(data) ? data[0] : data;
      const result = { achievementId, newlyUnlocked: !!(row && row.newly_unlocked), unlockedAt: row ? row.unlocked_at : null };
      if (result.newlyUnlocked) {
        // Future in-game "ACHIEVEMENT UNLOCKED" popup/sound hangs off this
        // exact event — nothing else needs to change to add one later.
        document.dispatchEvent(new CustomEvent('qz-achievement-unlocked', { detail: result }));
      }
      return result;
    } catch (err) {
      console.warn('QZAchievements: unlock() threw for', achievementId, err);
      return { achievementId, newlyUnlocked: false };
    }
  }

  // Re-checks EVERY stat-based achievement in the whole catalog against
  // this account's current real stats and unlocks whatever's actually
  // met. This is the "backtrack" / "catch me up" pass — deliberately
  // generic (queries requirement_type IS NOT NULL rather than a
  // hand-picked id list) so it stays correct as more stat achievements
  // get added later without any calling code changing. Two call sites
  // cover both halves of "retroactive, and stays live afterwards":
  //   - a page that shows achievements (profile/achievements.html) calls
  //     this on load, so simply opening it catches you up immediately;
  //   - a game calls this at its own load/lobby time (see
  //     games/anagram-quest/anagram-quest.js's loadAccountData()), so an
  //     account that already qualifies gets caught up the moment they
  //     next open that game, even before finishing another one.
  // unlock_achievement() itself still does the real verification server-
  // side per id — this just enumerates which ids are worth asking about.
  async function checkStatAchievements() {
    if (!window.QZAuth || !window.QZAuth.client) return [];
    try {
      const session = await window.QZAuth.getSession();
      if (!session) return [];
      const { data, error } = await window.QZAuth.client
        .from('achievements')
        .select('achievement_id')
        .not('requirement_type', 'is', null);
      if (error || !data) return [];
      return Promise.all(data.map((row) => unlock(row.achievement_id)));
    } catch (err) {
      console.warn('QZAchievements: checkStatAchievements() failed', err);
      return [];
    }
  }

  // Legacy/forward-compat alias — anagram-quest.js (and any future game)
  // already calls window.QZAchievements.notify(name, payload) defensively
  // at its own event points. `name` doubles as the achievement id for now
  // (payload is accepted, currently unused) — keeps calling code from
  // needing to know anything about the RPC underneath.
  function notify(name /*, payload */) {
    return unlock(name);
  }

  window.QZAchievements = { TIERS, tierInfo, unlock, notify, checkStatAchievements };
})();
