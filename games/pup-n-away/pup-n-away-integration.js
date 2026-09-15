// ===== Pup N Away — Quest Zone integration =====
//
// Every call here goes through the EXISTING Quest Zone auth/profile
// client (window.QZAuth) and EXISTING secure RPC pattern — no separate
// login, account, currency or inventory system. Score/games-played use
// the same record_game_result() every other game already uses (GAME_KEY
// = 'pup-n-away'); the extra Pup N Away-specific stats (level reached,
// bones, bounces, playtime) use the dedicated
// record_pup_n_away_progress() RPC added in
// supabase/migrations/20260915010000_pup_n_away_stats.sql — same
// SECURITY DEFINER, server-validated, delta-only pattern, never a raw
// client-submitted total.
//
// Deliberately NEVER calls award_xp() — 'pup-n-away' has no registered
// skill/games-table row, and game_progress XP feeds straight into the
// site-wide total_level() with no such filter, so awarding it here
// would silently inflate Total Level with no approved reward rule
// behind it (the brief explicitly disallows this). Score/stats are
// still fully tracked via the two calls above; wiring up a real reward
// later is a one-line addition once a rule is approved.
(function () {
  const GAME_KEY = window.PNA_CONFIG.GAME_KEY;

  function createIntegration() {
    let profile = null;
    let signedIn = false;

    async function init() {
      if (!window.QZAuth || !window.QZAuth.client) return { signedIn: false };
      const session = await window.QZAuth.getSession();
      if (!session) return { signedIn: false };
      profile = await window.QZAuth.getProfile();
      signedIn = !!profile;
      return { signedIn, profile };
    }

    async function gameStarted() {
      if (!signedIn || !window.QZAuth.client) return;
      try { await window.QZAuth.client.rpc('record_pup_n_away_game_started'); }
      catch (err) { console.warn('[Pup N Away] could not record game start', err); }
    }

    // Called once per completed RUN (game over or final level cleared),
    // matching every other game's "save on Game Over, not per-round"
    // rule — score/high-score/games-played through the shared RPC.
    async function saveScoreResult(finalScore) {
      if (!signedIn || !window.QZAuth.client) return null;
      try {
        const { data, error } = await window.QZAuth.client.rpc('record_game_result', {
          p_game_key: GAME_KEY,
          p_score: Math.round(finalScore)
        });
        if (error) { console.warn('[Pup N Away] could not save score', error); return null; }
        return Array.isArray(data) ? data[0] : data;
      } catch (err) { console.warn('[Pup N Away] could not save score', err); return null; }
    }

    // Delta-only progress checkpoint — safe to call multiple times per
    // run (e.g. once per level complete, once at game over).
    async function recordProgress({ levelReached, bonesCollected, bounces, playtimeSeconds, completed }) {
      if (!signedIn || !window.QZAuth.client) return null;
      try {
        const { data, error } = await window.QZAuth.client.rpc('record_pup_n_away_progress', {
          p_level_reached: levelReached || 0,
          p_bones_collected: bonesCollected || 0,
          p_bounces: bounces || 0,
          p_playtime_seconds: Math.round(playtimeSeconds || 0),
          p_completed: !!completed
        });
        if (error) { console.warn('[Pup N Away] could not save progress', error); return null; }
        return Array.isArray(data) ? data[0] : data;
      } catch (err) { console.warn('[Pup N Away] could not save progress', err); return null; }
    }

    return { init, gameStarted, saveScoreResult, recordProgress, get signedIn() { return signedIn; }, get profile() { return profile; } };
  }

  window.PNA_Integration = { createIntegration };
})();
