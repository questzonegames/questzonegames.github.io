// ===== Pup N Away — level manager =====
//
// Thin wrapper around PNA_CONFIG.LEVELS — the engine never branches on
// a level id, filename or index directly outside this module. Every
// level identifies its own act/positionInAct (see pup-n-away-config.js)
// so act boundaries are read from that metadata, never assumed from
// array order or a hardcoded "3 levels per act" rule.
(function () {
  const LEVELS = window.PNA_CONFIG.LEVELS;

  function levelsInAct(actNumber) {
    return LEVELS.filter((l) => l.act === actNumber);
  }
  function isFinalLevelOfAct(level) {
    const act = levelsInAct(level.act);
    return level.positionInAct >= act.length;
  }
  function firstLevelIndexOfAct(actNumber) {
    return LEVELS.findIndex((l) => l.act === actNumber && l.positionInAct === 1);
  }
  function highestAct() {
    return LEVELS.reduce((max, l) => Math.max(max, l.act), 1);
  }

  function createLevelManager() {
    let index = 0;

    function current() { return LEVELS[index]; }
    function currentNumber() { return index + 1; }
    function totalLevels() { return LEVELS.length; }
    function isLastLevel() { return index >= LEVELS.length - 1; }
    function advance() { if (!isLastLevel()) index++; return current(); }
    function reset() { index = 0; return current(); }
    function backgroundKey(level) { return 'backgrounds.' + level.background; }

    // Jumps to the first level of a given act (e.g. restarting the
    // current act after Game Over) — falls back to level 0 if that act
    // somehow doesn't exist rather than throwing.
    function goToActStart(actNumber) {
      const i = firstLevelIndexOfAct(actNumber);
      index = i >= 0 ? i : 0;
      return current();
    }

    // Used by Level Select (pick any unlocked level directly) and by
    // the Lobby's "resume at next incomplete level" logic — both jump
    // straight to a specific level rather than always starting/
    // advancing sequentially.
    function goToIndex(i) {
      if (i >= 0 && i < LEVELS.length) index = i;
      return current();
    }
    function goToLevelId(levelId) {
      const i = LEVELS.findIndex((l) => l.id === levelId);
      return goToIndex(i >= 0 ? i : 0);
    }
    function all() { return LEVELS; }

    return {
      current, currentNumber, totalLevels, isLastLevel, advance, reset, backgroundKey,
      goToActStart, goToIndex, goToLevelId, all,
      isFinalLevelOfAct: () => isFinalLevelOfAct(current()),
      nextActExists: () => LEVELS.some((l) => l.act === current().act + 1),
      highestAct
    };
  }

  window.PNA_Levels = { createLevelManager };
})();
