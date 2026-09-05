// ===== Anagram Quest — static game data =====
// Kept separate from anagram-quest.js so the word lists/weights can be
// tuned without touching game logic.
(function () {
  // Round 5 bonus rack always comes from one of these — every entry is a
  // genuine, reasonably common 9-letter word, and deliberately singular/
  // base-form (an adjective, an uncountable noun, or a proper noun that
  // doesn't pluralize) — NEVER an obvious plural (no "HOSPITALS",
  // "CAMPFIRES", etc.) per the anti-brute-force design: curated by hand
  // rather than a blanket "reject anything ending in S" rule, since some
  // perfectly singular words legitimately end in S (DANGEROUS, HAPPINESS,
  // QUIETNESS below all do). The last 8 are real, singular country names
  // instead of ordinary dictionary words — both count identically as far
  // as validation/scoring is concerned (see isValidAnagramQuestWord in
  // anagram-quest.js). Every plain-English entry here is verified present
  // in data/dictionary.txt, since the shared validator is what actually
  // accepts the player's answer; the country names are verified against
  // geo-data.js instead.
  const BONUS_WORDS = [
    'ADVENTURE','BUTTERFLY','DANGEROUS','BEAUTIFUL','TELEPHONE','NEWSPAPER',
    'CHOCOLATE','DISCOVERY','ASTRONAUT','SPACESHIP','METEORITE','UNIVERSAL',
    'FURNITURE','KNOWLEDGE','EDUCATION','FANTASTIC','GENERATOR','HAPPINESS',
    'KILOMETER','LIGHTNING','MAGNITUDE','QUIETNESS','SATELLITE','TELESCOPE',
    'UNDERWEAR','WATERFALL','EXCELLENT','YESTERDAY','ZOOLOGIST','GRASSLAND',
    'HAMBURGER','JELLYFISH','MOONLIGHT','NIGHTMARE','OVERBOARD','SNOWSTORM',
    'VEGETABLE','YOUNGSTER','BUTTERCUP','GEOGRAPHY','HURRICANE',
    'MAURITIUS','LITHUANIA','GUATEMALA','NICARAGUA','VENEZUELA','ARGENTINA',
    'AUSTRALIA','SINGAPORE'
  ];

  // Relative weights (not percentages — just proportional) modelling real
  // English letter frequency, so V/C presses tend to produce a playable
  // rack instead of a uniformly-random one. The player still fully
  // controls the vowel/consonant ratio via which button they press.
  const VOWEL_WEIGHTS = { A: 9, E: 12, I: 9, O: 8, U: 3 };
  const CONSONANT_WEIGHTS = {
    T: 9, N: 8, R: 8, S: 8, L: 5, D: 5, C: 4, M: 4, P: 4, H: 4,
    B: 2, F: 2, G: 3, W: 2, Y: 2, V: 1, K: 1, J: 1, X: 1, Q: 1, Z: 1
  };

  function weightedPick(table) {
    const entries = Object.entries(table);
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let r = Math.random() * total;
    for (const [letter, w] of entries) {
      r -= w;
      if (r <= 0) return letter;
    }
    return entries[entries.length - 1][0];
  }

  window.QZAnagramData = {
    BONUS_WORDS,
    randomVowel: () => weightedPick(VOWEL_WEIGHTS),
    randomConsonant: () => weightedPick(CONSONANT_WEIGHTS)
  };
})();
