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

    // Signed-out players just don't have act progress saved anywhere
    // (same as every other Pup N Away stat) — highestUnlockedAct stays
    // at 1 for the session, matching a fresh account's starting state.
    async function getProgression() {
      if (!signedIn || !window.QZAuth.client) return { highestUnlockedAct: 1, completedActs: [] };
      try {
        const { data, error } = await window.QZAuth.client
          .from('pup_n_away_progression').select('highest_unlocked_act,completed_acts')
          .eq('user_id', profile.id).maybeSingle();
        if (error) { console.warn('[Pup N Away] could not load act progression', error); return { highestUnlockedAct: 1, completedActs: [] }; }
        if (!data) return { highestUnlockedAct: 1, completedActs: [] };
        return { highestUnlockedAct: data.highest_unlocked_act, completedActs: data.completed_acts || [] };
      } catch (err) {
        console.warn('[Pup N Away] could not load act progression', err);
        return { highestUnlockedAct: 1, completedActs: [] };
      }
    }

    // Called once when the player finishes the FINAL level of their
    // current act — see record_pup_n_away_act_complete() in
    // 20260917010000_pup_n_away_progression.sql for why the server,
    // not this call, is what actually decides whether the unlock is
    // legitimate (it only ever advances by one, and only from the
    // player's real current act).
    async function recordActComplete(actNumber) {
      if (!signedIn || !window.QZAuth.client) return null;
      try {
        const { data, error } = await window.QZAuth.client.rpc('record_pup_n_away_act_complete', {
          p_completed_act: actNumber
        });
        if (error) { console.warn('[Pup N Away] could not save act completion', error); return null; }
        const row = Array.isArray(data) ? data[0] : data;
        return row ? { highestUnlockedAct: row.highest_unlocked_act, completedActs: row.completed_acts || [] } : null;
      } catch (err) { console.warn('[Pup N Away] could not save act completion', err); return null; }
    }

    // Which levels (by id) this player has actually COMPLETED — powers
    // Level Select's sequential unlock/replay logic. Deliberately a
    // separate, stricter fact from pup_n_away_stats.highest_level_reached
    // (see 20260918010000_pup_n_away_level_progress.sql) — reaching a
    // level by dying in it does not count as completing it.
    async function getLevelCompletions() {
      if (!signedIn || !window.QZAuth.client) return [];
      try {
        const { data, error } = await window.QZAuth.client
          .from('pup_n_away_level_completions').select('level_id')
          .eq('user_id', profile.id);
        if (error) { console.warn('[Pup N Away] could not load level completions', error); return []; }
        return (data || []).map((r) => r.level_id);
      } catch (err) {
        console.warn('[Pup N Away] could not load level completions', err);
        return [];
      }
    }

    // Called once per level actually completed (see completeLevel() in
    // pup-n-away.js) — independent of, and in addition to, the existing
    // recordActComplete() call that only fires on an act's final level.
    async function recordLevelComplete(levelId, score, timeMs) {
      if (!signedIn || !window.QZAuth.client) return;
      try {
        const { error } = await window.QZAuth.client.rpc('record_pup_n_away_level_complete', {
          p_level_id: levelId, p_score: Math.round(score || 0), p_time_ms: Math.round(timeMs || 0)
        });
        if (error) console.warn('[Pup N Away] could not save level completion', error);
      } catch (err) { console.warn('[Pup N Away] could not save level completion', err); }
    }

    // ---------------------------------------------------------------
    // Equipment (basket cosmetics) — reuses the EXISTING, already-secure
    // Quest Zone inventory_items/equipped_items tables and equip_item()
    // RPC (the same ones the avatar equipment screen uses), scoped to
    // the 'pnaBasket' slot (see PNA_CONFIG.EQUIPMENT_SLOT). No separate
    // ownership system. PNA_CONFIG.EQUIPMENT_CATALOG is empty today (no
    // basket skins have been supplied yet), so both calls below
    // correctly resolve to nothing owned/equipped rather than any
    // invented item — see that catalog's own comment for how to add a
    // real one later.
    // ---------------------------------------------------------------
    async function getOwnedEquipment() {
      const catalog = window.PNA_CONFIG.EQUIPMENT_CATALOG;
      if (!signedIn || !window.QZAuth.client || !catalog.length) return [];
      try {
        const ids = catalog.map((it) => it.id);
        const { data, error } = await window.QZAuth.client
          .from('inventory_items').select('item_id')
          .eq('user_id', profile.id).in('item_id', ids);
        if (error) { console.warn('[Pup N Away] could not load owned equipment', error); return []; }
        const owned = new Set((data || []).map((r) => r.item_id));
        return catalog.filter((it) => owned.has(it.id));
      } catch (err) {
        console.warn('[Pup N Away] could not load owned equipment', err);
        return [];
      }
    }

    async function getEquippedBasket() {
      if (!signedIn || !window.QZAuth.client) return null;
      try {
        const { data, error } = await window.QZAuth.client
          .from('equipped_items').select('item_id')
          .eq('user_id', profile.id).eq('slot', window.PNA_CONFIG.EQUIPMENT_SLOT).maybeSingle();
        if (error) { console.warn('[Pup N Away] could not load equipped basket', error); return null; }
        return data ? data.item_id : null;
      } catch (err) {
        console.warn('[Pup N Away] could not load equipped basket', err);
        return null;
      }
    }

    // Server-side equip_item() re-validates ownership and slot itself
    // (see supabase/migrations/20260909050100_item_economy_rpcs.sql) —
    // this call can never equip an item the player doesn't actually own,
    // regardless of what the client sends.
    async function equipBasket(itemId) {
      if (!signedIn || !window.QZAuth.client) return false;
      try {
        const { error } = await window.QZAuth.client.rpc('equip_item', {
          p_slot: window.PNA_CONFIG.EQUIPMENT_SLOT, p_item_id: itemId
        });
        if (error) { console.warn('[Pup N Away] could not equip item', error); return false; }
        return true;
      } catch (err) { console.warn('[Pup N Away] could not equip item', err); return false; }
    }

    return {
      init, gameStarted, saveScoreResult, recordProgress, getProgression, recordActComplete,
      getLevelCompletions, recordLevelComplete,
      getOwnedEquipment, getEquippedBasket, equipBasket,
      get signedIn() { return signedIn; }, get profile() { return profile; }
    };
  }

  window.PNA_Integration = { createIntegration };
})();
