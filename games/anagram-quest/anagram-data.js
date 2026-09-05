// ===== Anagram Quest — static game data =====
// Kept separate from anagram-quest.js so the word lists/weights can be
// tuned without touching game logic.
(function () {
  // Round 5 bonus rack always comes from one of these — every entry is a
  // genuine, reasonably common 9-letter English word (hand-picked, not a
  // random slice of the full dictionary, which is full of obscure 9-letter
  // entries that would make an unfair/unrecognisable bonus round). Each one
  // is also verified present in data/dictionary.txt, since the shared
  // validator is what actually accepts the player's answer.
  const BONUS_WORDS = [
    'ADVENTURE','BUTTERFLY','FOOTBALLS','BASEBALLS','MOUNTAINS','DANGEROUS',
    'BEAUTIFUL','HOSPITALS','TELEPHONE','UMBRELLAS','VACATIONS','AIRPLANES',
    'NEWSPAPER','CHOCOLATE','PAINTINGS','CAMPFIRES','DISCOVERY','AUDIENCES',
    'ASTRONAUT','SPACESHIP','METEORITE','UNIVERSAL','ASTEROIDS','FURNITURE',
    'KEYBOARDS','KNOWLEDGE','DIRECTORS','LANGUAGES','QUESTIONS','MEDICINES',
    'EDUCATION','FANTASTIC','GENERATOR','HAPPINESS','KILOMETER','LIGHTNING',
    'MAGNITUDE','NECKLACES','OBSTACLES','QUIETNESS','SATELLITE','TELESCOPE',
    'UNDERWEAR','VOLCANOES','WATERFALL','EXCELLENT','YESTERDAY','ZOOLOGIST',
    'BACKYARDS','DAYDREAMS','FIREWORKS','GRASSLAND','HAMBURGER','JELLYFISH',
    'KANGAROOS','MOONLIGHT','NIGHTMARE','OVERBOARD','RAINCOATS','SNOWSTORM',
    'VEGETABLE','YOUNGSTER','ZEPPELINS','BUTTERCUP','DINOSAURS','ELECTRONS',
    'FRAGMENTS','GEOGRAPHY','HURRICANE','MUSICIANS','NOTEBOOKS','COMPUTERS',
    'BIRTHDAYS'
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
