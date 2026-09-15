// ===== Pup N Away — level manager =====
//
// Thin wrapper around PNA_CONFIG.LEVELS — the engine never branches on
// a level id, filename or index directly outside this module.
(function () {
  const LEVELS = window.PNA_CONFIG.LEVELS;

  function createLevelManager() {
    let index = 0;

    function current() { return LEVELS[index]; }
    function currentNumber() { return index + 1; }
    function totalLevels() { return LEVELS.length; }
    function isLastLevel() { return index >= LEVELS.length - 1; }
    function advance() { if (!isLastLevel()) index++; return current(); }
    function reset() { index = 0; return current(); }
    function backgroundKey(level) { return 'backgrounds.' + level.background; }

    return { current, currentNumber, totalLevels, isLastLevel, advance, reset, backgroundKey };
  }

  window.PNA_Levels = { createLevelManager };
})();
