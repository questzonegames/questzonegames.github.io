// ===== Quest Zone — OSRS XP/leveling formula =====
//
// Mirrors supabase/schema.sql's osrs_xp_for_level / osrs_level_for_xp
// exactly, for client-side display (tooltips, "+XP" toasts) without a
// round trip. The SERVER copy is the one that actually decides stored XP
// (via award_xp()) — this client copy never writes anything, it only
// formats what the server already returned.
//
//   for level L: cumulative XP = floor( (1/4) * sum_{n=1}^{L-1}
//                                        floor( n + 300 * 2^(n/7) ) )
//   level 2  = 83 XP
//   level 99 = 13,034,431 XP
//
// Levels keep extending past 99 with the same formula ("virtual levels");
// only the stored XP itself is capped (see XP_CAP).
(function () {
  const XP_CAP = 2147483647; // int32 max — Quest Zone's cap (higher than OSRS's real 200M)

  function xpForLevel(level) {
    if (level <= 1) return 0;
    let total = 0;
    for (let n = 1; n < level; n++) {
      total += Math.floor(n + 300 * Math.pow(2, n / 7));
    }
    return Math.floor(total / 4);
  }

  function levelForXp(xp) {
    let lvl = 1;
    while (xpForLevel(lvl + 1) <= xp) lvl++;
    return lvl;
  }

  // { base, virtual, isVirtual } — base is what's shown on the skill icon
  // (capped at 99), virtual is the real level the formula gives, isVirtual
  // is true once virtual > 99 (display as "99 (Virtual Level X)")
  function displayLevel(xp) {
    const virtual = levelForXp(xp);
    const base = Math.min(99, virtual);
    return { base, virtual, isVirtual: virtual > 99 };
  }

  window.QZXp = { XP_CAP, xpForLevel, levelForXp, displayLevel };
})();
