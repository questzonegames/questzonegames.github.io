// ===== Anagram Quest — game logic =====
// Single-player, 5-round word game. State machine:
//   LOBBY -> DIFFICULTY -> INTRO -> LETTER_SELECTION -> ACTIVE_ROUND ->
//   ROUND_RESULT -> (repeat x4) -> BONUS_ROUND (round 5, reuses
//   ACTIVE_ROUND/ROUND_RESULT screens) -> GAME_OVER
//
// DIFFICULTY: EASY / MEDIUM / HARD (see DIFFICULTIES below) — the ONE
// place a round's timer length and the Intelligence-XP-per-point
// multiplier are defined. The POINT SYSTEM itself (POINTS_BY_LENGTH,
// ROUND5_POINTS) is IDENTICAL across every difficulty, by design — only
// how much time you get to earn those points, and how much each point is
// worth in XP, changes. See docs-equivalent spec this was built from:
// harder difficulty = less time per round + a bigger XP-per-point
// multiplier, so skilled/fast play is rewarded on every difficulty, and
// higher difficulties are a genuine, deliberate risk/reward step up
// rather than a bigger dictionary or a different scoring table.
//
// LETTER_SELECTION: 10s to pick V/C (VC_SELECT_TIME_SECONDS — fixed for
// every difficulty, not part of the difficulty config); generatedRack
// (state.rack) is immutable the instant a letter lands in it — no
// Backspace exists on that screen. Reaching 9 letters manually stops the
// countdown immediately; letting it expire auto-fills the rest (see
// autoFillRack), preserving every letter already picked.
//
// ACTIVE_ROUND (rounds 1-4): a difficulty-specific number of seconds
// (state.difficultyConfig.normalRoundSeconds) to build a word. There is
// no "submit" step any more — whatever letters are sitting in the answer
// boxes (state.currentWord) at the instant the round ends (LOCK IN, or
// the timer reaching 0) is exactly what gets judged, by
// judgeAndEndRound(). Nothing before that ever reveals whether the
// in-progress word is valid, scores anything, or would earn XP — no
// colour feedback, no points preview, nothing — so nothing here can be
// brute-forced and a player can freely rebuild/shorten their answer right
// up to the deadline (e.g. build HOUSE, then backspace down to HOU, and
// if the clock hits 0 while it reads HOU, HOU is what's judged — HOUSE is
// never resurrected). LOCK IN (Rounds 1-4 only) ends the round instantly
// on demand, letting a confident/fast player bank more games per hour.
//
// BONUS_ROUND (round 5): the special 9-letter anagram round. Exactly the
// same "whatever's in the boxes when time hits 0" judging as Rounds 1-4 —
// but it has NO Lock In and NO way to end early at all, on purpose (see
// lockInRound()). This makes Round 5 a mandatory minimum amount of time
// per completed game, which is the whole point: it stops a player from
// farming XP/hour by rushing throwaway short words in Rounds 1-4,
// skipping/instant-ending Round 5, and requeuing as fast as possible.
//
// XP: Anagram Quest trains the "Intelligence" skill (see supabase/
// migrations/20260905020000_intelligence_skill.sql). The final score
// (sum of all 5 rounds' points, using the SAME point table on every
// difficulty) is converted to XP by multiplying by the chosen
// difficulty's xpPerPoint (20 / 60 / 180) exactly once, after Round 5
// ends — never per round — through the same award_xp() RPC every other
// game uses, following the shared OSRS-style level formula in
// supabase/schema.sql. Nothing about the formula or the RPC is special-
// cased for this game; only GAME_KEY and the per-run XP amount are.
(function () {
  const GAME_KEY = 'intelligence';
  const TOTAL_ROUNDS = 5;
  const VC_SELECT_TIME_SECONDS = 10; // separate, shorter countdown for letter selection — fixed across every difficulty, not part of DIFFICULTIES
  const MIN_WORD_LEN = 4;
  const MAX_WORD_LEN = 9;
  const RACK_SIZE = 9;
  const VOWELS = 'AEIOU';
  const isVowelLetter = (ch) => VOWELS.indexOf(ch) !== -1;

  // ---- shared point table — IDENTICAL across every difficulty. Only the
  // per-round timer and the XP paid per point (see DIFFICULTIES) change
  // with difficulty; the points a given word earns never do. 1-3 letter
  // words (and anything invalid) score 0 — deliberately absent from this
  // table so pointsForWord() falls through to its default. 7/8/9-letter
  // words are deliberately worth MORE than their letter count (10/12/18
  // instead of 7/8/9) so there's always a real incentive to keep hunting
  // for a longer word instead of locking in a safe 4-6 letter one. ----
  const POINTS_BY_LENGTH = { 4: 4, 5: 5, 6: 6, 7: 10, 8: 12, 9: 18 };
  function pointsForWord(len) { return POINTS_BY_LENGTH[len] || 0; }
  // Round 5's flat reward for a correct 9-letter solve — bigger than an
  // ordinary 9-letter word found during Rounds 1-4 (18), since Round 5 is
  // the harder, mandatory-full-duration showcase round. No speed bonus:
  // Round 5 can never end before the clock does (see lockInRound()), so
  // "time remaining at judgement" is always 0 and a speed bonus would
  // never pay out anyway — removed rather than kept as dead code.
  const ROUND5_POINTS = 30;

  // ---- difficulty configuration — the ONE place a round's seconds and
  // the XP-per-point multiplier are defined; nothing else in this file
  // hardcodes either. Adding a 4th difficulty means adding one entry here
  // plus one button in index.html's #screen-difficulty — everything else
  // (timers, scoring, XP conversion, Lock In behaviour) is already
  // difficulty-generic and picks it up automatically. cssClass matches
  // the .diff-btn/.diff-chip/.intro-diff modifier classes in index.html. ----
  // unlockLevel: the Intelligence level required to play this difficulty
  // (see applyDifficultyLocks()) -- Easy is available from level 1 (i.e.
  // to everyone, including a guest with no tracked level at all).
  const DIFFICULTIES = {
    EASY: { key: 'EASY', label: 'EASY', normalRoundSeconds: 30, round5Seconds: 30, xpPerPoint: 20, cssClass: 'easy', unlockLevel: 1 },
    MEDIUM: { key: 'MEDIUM', label: 'MEDIUM', normalRoundSeconds: 20, round5Seconds: 30, xpPerPoint: 60, cssClass: 'medium', unlockLevel: 5 },
    HARD: { key: 'HARD', label: 'HARD', normalRoundSeconds: 10, round5Seconds: 20, xpPerPoint: 180, cssClass: 'hard', unlockLevel: 40 }
  };

  // ---- sound hooks (no audio assets shipped yet — safe no-ops until a
  // project-wide sound system exists; call sites are already in place) ----
  function playSound(name) {
    if (window.QZSound && window.QZSound.play) window.QZSound.play(name);
  }
  // ---- achievement/event hooks (no Anagram Quest achievements exist yet —
  // see achievements.html, which already queries for them; these calls are
  // where future server-side triggers hang once some do) ----
  function fireEvent(name, payload) {
    if (window.QZAchievements && window.QZAchievements.notify) window.QZAchievements.notify(name, payload);
  }

  // ================= dictionary =================
  let dictSet = null;
  let dictLoading = null;
  function loadDictionary() {
    if (dictLoading) return dictLoading;
    dictLoading = fetch('data/dictionary.txt')
      .then((r) => r.text())
      .then((text) => {
        dictSet = new Set(text.split(/\r?\n/).map((w) => w.trim()).filter(Boolean));
      })
      .catch((err) => {
        console.error('Anagram Quest: failed to load dictionary', err);
        dictSet = new Set();
      });
    return dictLoading;
  }
  function isValidEnglishWord(word) {
    if (!dictSet) return false;
    if (typeof word !== 'string') return false;
    if (!/^[A-Za-z]+$/.test(word)) return false; // no spaces/punctuation/numbers/hyphens
    return dictSet.has(word.toLowerCase());
  }

  // ---- beta rejection log — audit trail only, never affects scoring ----
  // Logs every word a player actually submitted that the dictionary
  // rejected, so a legitimate missing word (like "mega" was) can be found
  // and added to games/anagram-quest/data/manual-valid-words.json instead
  // of guessing what players are hitting. Purely local (localStorage),
  // capped so it can't grow unbounded, and never read by anything that
  // decides validity — it's audit-only, matching the "do NOT automatically
  // make rejected words valid" rule this was built for.
  const REJECT_LOG_KEY = 'qzAnagramRejectLog';
  const REJECT_LOG_MAX = 200;
  function logRejectedWord(word) {
    try {
      const entry = {
        word: word.toUpperCase(),
        length: word.length,
        at: new Date().toISOString(),
        difficulty: state.difficulty,
        round: state.currentRound
      };
      const log = JSON.parse(localStorage.getItem(REJECT_LOG_KEY) || '[]');
      log.push(entry);
      while (log.length > REJECT_LOG_MAX) log.shift();
      localStorage.setItem(REJECT_LOG_KEY, JSON.stringify(log));
    } catch (err) {
      // localStorage unavailable/full — never let logging break the game
    }
  }
  window.QZAnagramRejectLog = {
    getAll: () => { try { return JSON.parse(localStorage.getItem(REJECT_LOG_KEY) || '[]'); } catch (err) { return []; } },
    clear: () => { try { localStorage.removeItem(REJECT_LOG_KEY); } catch (err) {} }
  };
  // The ONE centralized word validator — every place in this file that
  // needs to know "does this word count" (Rounds 1-4 and Round 5, both at
  // round end — see judgeAndEndRound) calls this, never isValidEnglishWord
  // alone, so English dictionary words, real countries and real cities
  // are always judged identically everywhere.
  function isValidAnagramQuestWord(word) {
    return isValidEnglishWord(word) ||
      (window.QZAnagramGeo && (window.QZAnagramGeo.isCountryName(word) || window.QZAnagramGeo.isCityName(word)));
  }
  function normalizedSignature(word) {
    return word.toUpperCase().split('').sort().join('');
  }
  // Round 5 accepts ANY genuine 9-letter word made from exactly the rack's
  // letters — an English dictionary word OR a real 9-letter country/city
  // name — not just the one word the rack was generated from. This finds
  // every one of them up front, once, when the bonus rack is created, so
  // both validation and the post-round "correct answer(s)" reveal use the
  // exact same list.
  function computeAnagramSolutions(rackLetters) {
    const target = rackLetters.slice().sort().join('').toUpperCase();
    const solutions = new Set();
    if (dictSet) {
      dictSet.forEach((w) => {
        if (w.length !== RACK_SIZE) return;
        if (normalizedSignature(w) === target) solutions.add(w.toUpperCase());
      });
    }
    if (window.QZAnagramGeo) {
      window.QZAnagramGeo.COUNTRIES.concat(window.QZAnagramGeo.CITIES).forEach((w) => {
        if (w.length !== RACK_SIZE) return;
        if (normalizedSignature(w) === target) solutions.add(w.toUpperCase());
      });
    }
    return Array.from(solutions).sort();
  }

  // ================= state =================
  const state = {
    screen: 'LOBBY',
    difficulty: null,        // 'EASY' | 'MEDIUM' | 'HARD' — set by selectDifficulty(), before the intro/countdown plays
    difficultyConfig: null,  // === DIFFICULTIES[state.difficulty]
    currentRound: 0,
    rack: [],            // [{ letter, used }]
    currentWord: [],      // array of rack-tile refs, in selection order — this IS the live "current answer"; there is no separate submitted/locked copy (see judgeAndEndRound)
    roundScores: [0, 0, 0, 0, 0],
    totalScore: 0,
    timeRemaining: 0,
    roundSecondsTotal: 0, // whatever seconds this round's timer started at (difficulty- and round5-dependent) — needed for the timer ring's percentage
    timerId: null,
    bonusWord: null,
    round5Solutions: null,
    nineLetterCount: 0,  // valid 9-letter solves THIS game (any round) — reset in selectDifficulty(), sent once to record_anagram_quest_difficulty_result() in finishGame()
    selecting: false,     // true while V/C picks are still being made (round timer not started)
    profile: null,        // { id, username, ... } or null for a guest
    highScore: 0,
    gamesPlayed: 0,
    // Per-difficulty high score + 9-letter-word count, keyed 'EASY' |
    // 'MEDIUM' | 'HARD' -> { highScore, nineCount } — this account only
    // (see loadDifficultyStats/renderDifficultyStats). null until loaded
    // (or for a guest, who has nothing to load).
    difficultyStats: null,
    // Intelligence level, kept ONLY for the difficulty-lock check below
    // (applyDifficultyLocks) — the lobby's own skill card (assets/js/
    // skill-card.js) still always fetches its own copy fresh from
    // public.game_progress rather than reading this, so there is still
    // exactly one source of truth for the level shown to the player;
    // this is a separate, gate-only read. Defaults to 1 (a brand-new
    // account's real level, and a guest's stand-in level, since a guest
    // has no game_progress row at all) so Medium/Hard start locked until
    // this loads for a real account.
    intelligenceLevel: 1
  };

  // ================= DOM =================
  const screens = {
    LOBBY: document.getElementById('screen-lobby'),
    DIFFICULTY: document.getElementById('screen-difficulty'),
    INTRO: document.getElementById('screen-intro'),
    SELECT: document.getElementById('screen-select'),
    ACTIVE: document.getElementById('screen-active'),
    RESULT: document.getElementById('screen-result'),
    GAMEOVER: document.getElementById('screen-gameover')
  };
  function showScreen(key) {
    // Preserve the player's scroll position across screen transitions.
    // All screens live in the same page and are just toggled hidden/
    // visible, so swapping to a screen with a different total height
    // otherwise makes the browser silently clamp scrollY back toward 0
    // — which reads as "it keeps jumping back to the top" every round.
    const prevScrollY = window.scrollY;
    Object.values(screens).forEach((el) => el.classList.add('hidden'));
    screens[key].classList.remove('hidden');
    // The lobby has its own hero header (orbital arc, big ANAGRAM QUEST
    // title, motto) built into #screen-lobby itself — the shared plain
    // .logo pill every other screen uses is hidden only while the lobby
    // is showing (see body.lobby-active in the CSS), never removed from
    // the DOM, so every other screen's header is completely unaffected.
    document.body.classList.toggle('lobby-active', key === 'LOBBY');
    requestAnimationFrame(() => window.scrollTo(0, prevScrollY));
  }

  function updateFooterStats() {
    ['sel', 'active', 'result'].forEach((prefix) => {
      const hs = document.getElementById(prefix + '-highscore');
      const gp = document.getElementById(prefix + '-gamesplayed');
      if (hs) hs.textContent = state.highScore;
      if (gp) gp.textContent = state.gamesPlayed;
    });
    const lobbyHs = document.getElementById('lobby-highscore');
    const lobbyGp = document.getElementById('lobby-gamesplayed');
    const lobbyName = document.getElementById('lobby-username');
    if (lobbyHs) lobbyHs.textContent = state.highScore;
    if (lobbyGp) lobbyGp.textContent = state.gamesPlayed;
    if (lobbyName) lobbyName.textContent = state.profile ? state.profile.username : 'Guest';
    // Only actually re-fetch/re-mount the skill card while the lobby is the
    // visible screen — updateFooterStats() also runs on every in-round
    // transition, and there's no point re-querying game_progress then.
    if (!screens.LOBBY.classList.contains('hidden')) { mountIntelligenceCard(); renderDifficultyStats(); }
    // Difficulty-SELECT screen's own Best Score/9-Letter Words values —
    // cheap textContent writes on always-present elements, so (unlike the
    // two calls above) there's no reason to gate this on which screen is
    // showing; it just stays in sync for whenever the player gets there.
    renderDifficultySelectStats();
  }

  // ---- lobby: per-difficulty high score + 9-letter-word count — THIS
  // account only (public.anagram_quest_stats' RLS is own-row-or-admin,
  // never public — see the migration). Rendered from whatever
  // state.difficultyStats currently holds; loadDifficultyStats() (account
  // load) and finishGame() (right after a completed game) are the only
  // two places that ever set it. ----
  // Card art per difficulty — the real easy.png/medium.png/hard.png HUD
  // panel assets (assets/img/anagram-quest/), used exactly as supplied
  // (never redrawn/recoloured — see .claude/rules/asset-integrity.md).
  // These assets have the EASY/MEDIUM/HARD title and the "Best Score"/
  // "9-Letter Words" labels baked into the artwork itself, so the only
  // live text left is the two yellow values — no name/label markup is
  // duplicated on top of what the art already shows. Cropped via the
  // .diff-card-art.<cssClass> --art-w/h/x/y CSS custom properties (same
  // technique as the Start Game button); the values are positioned via
  // --value-top/bottom + --div-x to land directly under each panel's own
  // baked label.
  const DIFF_CARD_ART = {
    easy: '../../assets/img/anagram-quest/easy.png',
    medium: '../../assets/img/anagram-quest/medium.png',
    hard: '../../assets/img/anagram-quest/hard.png'
  };
  function renderDifficultyStats() {
    const el = document.getElementById('lobby-diffstats-rows');
    if (!el) return;
    // Always show the three real difficulty cards, even signed out —
    // they're the permanent branding/layout for this part of the frame,
    // not just a data display, so a guest sees them with 0/0 rather than
    // the cards disappearing and leaving that side of the frame empty.
    const stats = state.profile ? (state.difficultyStats || {}) : {};
    el.innerHTML = ['EASY', 'MEDIUM', 'HARD'].map((key) => {
      const cfg = DIFFICULTIES[key];
      const s = stats[key] || { highScore: 0, nineCount: 0 };
      return '<div class="diff-card-art ' + cfg.cssClass + '">' +
        '<img class="diff-card-img" src="' + DIFF_CARD_ART[cfg.cssClass] + '" alt="' + cfg.label + ' difficulty">' +
        '<div class="diff-card-shimmer"></div>' +
        '<div class="diff-card-overlay">' +
          '<div class="diff-card-values-zone">' +
            '<div class="diff-card-stat-value left">' + s.highScore + '</div>' +
            '<div class="diff-card-stat-value right">' + s.nineCount + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // Difficulty-SELECT screen's Best Score/9-Letter Words values (see
  // #screen-difficulty in index.html) — same data as the lobby's cards
  // above (state.difficultyStats), just written into the static
  // #diffsel-<difficulty>-score/-nine elements already sitting inside
  // those buttons, rather than rebuilding the buttons' innerHTML (which
  // would risk detaching nothing here, since the click listeners are on
  // the buttons themselves and not re-created, but there's no need to
  // rebuild the DOM just to update two numbers). Guests / no stats yet
  // fall back to 0, matching the static HTML's own default.
  function renderDifficultySelectStats() {
    const stats = state.difficultyStats || {};
    ['EASY', 'MEDIUM', 'HARD'].forEach((key) => {
      const cfg = DIFFICULTIES[key];
      const s = stats[key] || { highScore: 0, nineCount: 0 };
      const scoreEl = document.getElementById('diffsel-' + cfg.cssClass + '-score');
      const nineEl = document.getElementById('diffsel-' + cfg.cssClass + '-nine');
      if (scoreEl) scoreEl.textContent = s.highScore;
      if (nineEl) nineEl.textContent = s.nineCount;
    });
  }

  // Reads this account's own row (or nothing, for a brand new player who's
  // never completed a game on any difficulty — every field defaults to 0,
  // same as game_stats/game_progress do elsewhere in this file).
  async function loadDifficultyStats() {
    if (!window.QZAuth || !window.QZAuth.client || !state.profile) { state.difficultyStats = null; return; }
    try {
      const { data } = await window.QZAuth.client
        .from('anagram_quest_stats')
        .select('easy_high_score,medium_high_score,hard_high_score,easy_nine_count,medium_nine_count,hard_nine_count')
        .eq('user_id', state.profile.id)
        .maybeSingle();
      state.difficultyStats = {
        EASY: { highScore: (data && data.easy_high_score) || 0, nineCount: (data && data.easy_nine_count) || 0 },
        MEDIUM: { highScore: (data && data.medium_high_score) || 0, nineCount: (data && data.medium_nine_count) || 0 },
        HARD: { highScore: (data && data.hard_high_score) || 0, nineCount: (data && data.hard_nine_count) || 0 }
      };
    } catch (err) {
      console.warn('Anagram Quest: could not load difficulty stats', err);
      state.difficultyStats = null;
    }
  }

  // Same reusable component + same public.games/public.game_progress read
  // as Profile -> Skills — see assets/js/skill-card.js. Always re-fetches
  // fresh (never reuses a cached level), so it can never show a stale
  // value after XP was just awarded.
  // Generic — used for the lobby's own card AND the mid-game/post-round
  // slots. Every call site is this ONE function; there is no second
  // hand-copied Intelligence display anywhere in this file.
  function mountSkillCard(containerId) {
    const slot = document.getElementById(containerId);
    if (!slot || !window.QZSkillCard) return;
    window.QZSkillCard.mount(slot, {
      client: window.QZAuth && window.QZAuth.client,
      userId: state.profile ? state.profile.id : null,
      gameKey: GAME_KEY,
      iconSrc: '../../assets/img/skills/intelligence.png',
      fallbackName: 'Intelligence'
    });
  }
  // Lobby-only rich variant (icon + level + XP progress bar + caption) —
  // see assets/js/skill-card.js's mountFull(). Every OTHER skill-card slot
  // in this file (sel/active/result HUD strips) still calls the plain
  // mountSkillCard() above/compact mount() — completely unaffected by the
  // lobby rehaul, on purpose.
  function mountIntelligenceCard() {
    const slot = document.getElementById('lobby-skillcard-slot');
    if (!slot || !window.QZSkillCard || !window.QZSkillCard.mountFull) return;
    window.QZSkillCard.mountFull(slot, {
      client: window.QZAuth && window.QZAuth.client,
      userId: state.profile ? state.profile.id : null,
      gameKey: GAME_KEY,
      iconSrc: '../../assets/img/skills/intelligence.png',
      fallbackName: 'Intelligence',
      caption: 'Solve words to earn Intelligence XP'
    });
  }

  // ---- difficulty badges — the small coloured pill shown on Select/
  // Active/Result/GameOver headers so the player always knows which
  // difficulty they're mid-game on. Set once per game (selectDifficulty),
  // never re-derived elsewhere. ----
  function updateDifficultyChips() {
    const cfg = state.difficultyConfig;
    if (!cfg) return;
    ['sel-diff-chip', 'active-diff-chip', 'result-diff-chip', 'go-diff-chip'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = cfg.label;
      el.className = 'diff-chip ' + cfg.cssClass;
    });
  }

  // ================= account load/save =================
  // No player avatar is loaded/mounted anywhere in this file — the lobby
  // rehaul (Anagram_Quest_Lobby_Rehaul_Brief.docx, section 6) explicitly
  // removes it. If a future screen in this file ever wants the real
  // equipped-avatar render back, copy the pattern from profile/index.html
  // or the game lobby of another Quest Zone game rather than re-adding it
  // here — this file intentionally carries none of that wiring any more.
  async function loadAccountData() {
    applyDifficultyLocks(); // render the level-1 default immediately — Medium/Hard start locked/grey for everyone until a real level (if any) loads below
    if (!window.QZAuth || !window.QZAuth.client) { updateFooterStats(); return; }
    try {
      const profile = await window.QZAuth.getProfile();
      state.profile = profile;
      if (!profile) { updateFooterStats(); return; }

      const client = window.QZAuth.client;
      const { data: statsRow } = await client
        .from('game_stats').select('high_score,games_played')
        .eq('user_id', profile.id).eq('game_key', GAME_KEY).maybeSingle();
      state.highScore = (statsRow && statsRow.high_score) || 0;
      state.gamesPlayed = (statsRow && statsRow.games_played) || 0;
      await loadDifficultyStats();
      await loadIntelligenceLevel();
    } catch (err) {
      console.warn('Anagram Quest: could not load account data', err);
    }
    updateFooterStats();
  }

  // Reads this account's real Intelligence level for the difficulty-lock
  // check only — see state.intelligenceLevel's own comment for why this
  // is a separate read from the lobby's skill-card widget rather than
  // reusing/caching its value. Same fetchSkill() shared data query
  // skill-card.js itself uses (public.games + public.game_progress), so
  // it can never disagree with what the widget displays.
  async function loadIntelligenceLevel() {
    if (!window.QZSkillCard || !state.profile) return;
    try {
      const skill = await window.QZSkillCard.fetchSkill(window.QZAuth.client, state.profile.id, GAME_KEY, 'Intelligence');
      state.intelligenceLevel = skill.level;
    } catch (err) {
      console.warn('Anagram Quest: could not load Intelligence level', err);
    } finally {
      applyDifficultyLocks();
    }
  }

  // ---- difficulty locks — Medium/Hard require an Intelligence level (see
  // DIFFICULTIES[key].unlockLevel above); Easy's own unlockLevel is 1, so
  // it's never locked. Greys the button out, swaps its timer/XP meta line
  // for a "Unlocks at Intelligence Level N" note, and disables it so it
  // can't be clicked (selectDifficulty() below also re-checks this itself,
  // in case anything ever calls it some other way). Re-run any time the
  // level might have changed: once with the level-1 default before
  // account data has loaded, again once the real level is known, and
  // again after this run's XP is awarded (awardIntelligenceXp) in case a
  // level-up just crossed a threshold.
  function applyDifficultyLocks() {
    ['EASY', 'MEDIUM', 'HARD'].forEach((key) => {
      const btn = document.getElementById('btn-diff-' + key.toLowerCase());
      if (!btn) return;
      const locked = state.intelligenceLevel < DIFFICULTIES[key].unlockLevel;
      btn.classList.toggle('locked', locked);
      btn.disabled = locked;
      btn.setAttribute('aria-disabled', locked ? 'true' : 'false');
    });
  }

  // Called once per COMPLETED game (Game Over), never per round. Score is
  // still computed entirely client-side (no per-round server replay), but
  // the write itself only ever happens through record_game_result() — see
  // the migration — so a tampered client can't PATCH an arbitrary value
  // in. p_score is POINTS (the shared, difficulty-independent scale), not
  // XP, so "high score" stays a fair, apples-to-apples measure of word-
  // finding skill regardless of which difficulty was played.
  async function saveGameResult(finalScore) {
    if (!window.QZAuth || !window.QZAuth.client || !state.profile) return;
    try {
      const { data, error } = await window.QZAuth.client.rpc('record_game_result', {
        p_game_key: GAME_KEY,
        p_score: finalScore
      });
      if (error) { console.warn('Anagram Quest: could not save result', error); return; }
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        state.highScore = row.high_score;
        state.gamesPlayed = row.games_played;
        updateFooterStats();
      }
    } catch (err) {
      console.warn('Anagram Quest: could not save result', err);
    }
  }

  // Intelligence XP: xpAmount is the FULLY-CONVERTED amount — this run's
  // total points times the chosen difficulty's xpPerPoint (see
  // finishGame) — computed once, client-side, exactly like every other
  // game's XP always has been. Awarded through the same shared award_xp()
  // RPC every game uses; it caps the total and recalculates level server-
  // side, and a tampered client can only ever ask to "add this amount",
  // never set the stored value directly. award_xp()'s own per-call ceiling
  // (2,000,000 — see supabase/migrations/20260905040000_security_
  // hardening.sql) comfortably covers the highest amount a single
  // completed game can ever produce here: Hard's maximum possible score is
  // 4*18 (a 9-letter word every one of Rounds 1-4) + 30 (Round 5) = 102
  // points, times 180 XP/point = 18,360 XP — nowhere close to the cap.
  async function awardIntelligenceXp(xpAmount) {
    if (!window.QZAuth || !window.QZAuth.client || !state.profile || xpAmount <= 0) return;
    try {
      const { data, error } = await window.QZAuth.client.rpc('award_xp', {
        p_game_key: GAME_KEY,
        p_xp_to_add: xpAmount
      });
      if (error) { console.warn('Anagram Quest: could not save XP', error); return; }
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        // Keep the difficulty-lock check current too — a level-up from
        // this run's XP should unlock Medium/Hard immediately the next
        // time the player opens the difficulty screen, not only after a
        // page refresh.
        state.intelligenceLevel = row.level;
        applyDifficultyLocks();
      }
      if (row && window.QZXp) {
        // The widget itself now shows the level/XP bar — animateXpGain()
        // flies the +XP label into it and eases it up to `row`'s fresh
        // value, so the lobby (updateFooterStats below re-mounts it) and
        // this screen always agree with the same server response, never a
        // client-derived guess.
        animateXpGain(xpAmount, row);
        updateFooterStats();
      }
    } catch (err) {
      console.warn('Anagram Quest: could not save XP', err);
    }
  }

  // ================= letter selection (rounds 1-4) =================
  // generatedRack (state.rack) is immutable once a letter lands in it —
  // there is no Backspace control anywhere on this screen, and nothing in
  // this section ever pops or replaces an existing entry, only pushes new
  // ones (manually via pressVC, or automatically via autoFillRack).
  const selSlotsEl = document.getElementById('sel-slots');
  const selTilesEl = document.getElementById('sel-tiles');
  const selRoundNumEl = document.getElementById('sel-round-num');
  const btnVowel = document.getElementById('btn-vowel');
  const btnConsonant = document.getElementById('btn-consonant');
  const selTimerRing = document.getElementById('sel-timer-ring');
  const selTimerNum = document.getElementById('sel-timer-num');
  const selTimerText = document.getElementById('sel-timer-text');

  function renderSelectSlots() {
    selSlotsEl.innerHTML = '';
    for (let i = 0; i < RACK_SIZE; i++) {
      const d = document.createElement('div');
      d.className = 'slot';
      selSlotsEl.appendChild(d);
    }
    selTilesEl.innerHTML = '';
    for (let i = 0; i < RACK_SIZE; i++) {
      const d = document.createElement('div');
      d.className = 'tile' + (i < state.rack.length ? ' pending' : '');
      d.textContent = i < state.rack.length ? state.rack[i].letter : '';
      selTilesEl.appendChild(d);
    }
  }

  function startLetterSelection(roundNum) {
    state.currentRound = roundNum;
    state.rack = [];
    state.selecting = true;
    selRoundNumEl.textContent = roundNum;
    btnVowel.disabled = false;
    btnConsonant.disabled = false;
    renderSelectSlots();
    updateFooterStats();
    showScreen('SELECT');
    startSelTimer();
    mountSkillCard('sel-skillcard-slot'); // center HUD slot — Intelligence, NOT the avatar
  }

  // Wall-clock deadline, same pattern as the round timer — self-corrects
  // instantly if the tab was throttled/backgrounded instead of leaving
  // the countdown frozen.
  function startSelTimer() {
    state.selDeadline = Date.now() + VC_SELECT_TIME_SECONDS * 1000;
    updateSelTimerUi(VC_SELECT_TIME_SECONDS);
    clearInterval(state.selTimerId);
    state.selTimerId = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((state.selDeadline - Date.now()) / 1000));
      updateSelTimerUi(remaining);
      if (remaining <= 0) { onSelTimerExpired(); }
    }, 250);
  }
  function updateSelTimerUi(remaining) {
    const pct = Math.max(0, (remaining / VC_SELECT_TIME_SECONDS) * 100);
    if (selTimerRing) selTimerRing.style.setProperty('--pct', pct);
    if (selTimerRing) selTimerRing.classList.toggle('warn', remaining <= 4);
    if (selTimerNum) selTimerNum.textContent = remaining;
    if (selTimerText) selTimerText.textContent = remaining;
  }
  // The 10 seconds ran out before all 9 letters were chosen manually —
  // stop the countdown immediately, auto-complete the rack (preserving
  // every letter already picked), then go straight into the word round.
  function onSelTimerExpired() {
    clearInterval(state.selTimerId);
    state.selTimerId = null;
    state.selecting = false;
    btnVowel.disabled = true;
    btnConsonant.disabled = true;
    autoFillRack();
    renderSelectSlots();
    startActiveRound();
  }

  // Preserves every letter the player already picked — only ever ADDS the
  // letters still missing, aiming for a 4-vowel/5-consonant or 3-vowel/
  // 6-consonant final rack (picked at random between the two whenever both
  // are still reachable), and always finishes at exactly RACK_SIZE letters.
  function autoFillRack() {
    const remaining = RACK_SIZE - state.rack.length;
    if (remaining <= 0) return;
    const vowels = state.rack.filter((t) => isVowelLetter(t.letter)).length;
    const consonants = state.rack.length - vowels;

    const targets = [{ v: 4, c: 5 }, { v: 3, c: 6 }];
    if (Math.random() < 0.5) targets.reverse();
    const chosen = targets.find((t) => t.v >= vowels && t.c >= consonants);

    let needV, needC;
    if (chosen) {
      needV = chosen.v - vowels;
      needC = chosen.c - consonants;
    } else {
      // Player's manual picks already overshoot both valid target ratios
      // (e.g. 7 consonants + 1 vowel before timeout) — never discard
      // anything already generated, just fill what's left with whichever
      // type keeps the rack furthest from being consonant/vowel-starved.
      const wantsMoreVowels = (4 - vowels) > 0 || (3 - vowels) > 0;
      needV = wantsMoreVowels ? Math.min(remaining, Math.max(4 - vowels, 3 - vowels, 0)) : 0;
      needC = remaining - needV;
    }

    const picks = [];
    for (let i = 0; i < needV; i++) picks.push('V');
    for (let i = 0; i < needC; i++) picks.push('C');
    while (picks.length < remaining) picks.push('C'); // safety pad, should never trigger
    picks.length = remaining;
    // shuffle so auto-filled letters don't visibly land as "all vowels
    // then all consonants" at the end of the rack
    for (let i = picks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [picks[i], picks[j]] = [picks[j], picks[i]];
    }
    picks.forEach((type) => {
      const letter = type === 'V' ? window.QZAnagramData.randomVowel() : window.QZAnagramData.randomConsonant();
      state.rack.push({ letter, used: false });
    });
  }

  function pressVC(type) {
    if (!state.selecting || state.rack.length >= RACK_SIZE) return;
    const letter = type === 'V' ? window.QZAnagramData.randomVowel() : window.QZAnagramData.randomConsonant();
    state.rack.push({ letter, used: false });
    playSound('letter-pick');
    renderSelectSlots();
    if (state.rack.length >= RACK_SIZE) {
      // manually finished before the 10s ran out — stop the countdown
      // immediately, no auto-fill needed, brief glow/pause before play begins
      clearInterval(state.selTimerId);
      state.selTimerId = null;
      state.selecting = false;
      btnVowel.disabled = true;
      btnConsonant.disabled = true;
      setTimeout(() => startActiveRound(), 350);
    }
  }
  btnVowel.addEventListener('click', () => pressVC('V'));
  btnConsonant.addEventListener('click', () => pressVC('C'));

  // ================= active round (build + lock in / timeout) =================
  const activeSlotsEl = document.getElementById('active-slots');
  const activeTilesEl = document.getElementById('active-tiles');
  const activeRoundLabel = document.getElementById('active-round-label');
  const activeRoundSub = document.getElementById('active-round-sub');
  const activeMsg = document.getElementById('active-msg');
  const activeLocked = document.getElementById('active-locked'); // repurposed as a plain rules reminder — see updateRoundHint()
  const activeLockInBtn = document.getElementById('active-lockin');
  const activeBackspaceBtn = document.getElementById('active-backspace');
  const timerRing = document.getElementById('active-timer-ring');
  const timerNum = document.getElementById('active-timer-num');
  const timerText = document.getElementById('active-timer-text');

  function isBonusRound() { return state.currentRound === 5; }

  function renderActiveTiles() {
    activeTilesEl.innerHTML = '';
    state.rack.forEach((tile, i) => {
      const d = document.createElement('div');
      d.className = 'tile' + (tile.used ? ' used' : '');
      d.textContent = tile.letter;
      d.addEventListener('click', () => selectTile(i));
      activeTilesEl.appendChild(d);
    });
  }
  function renderActiveSlots() {
    activeSlotsEl.innerHTML = '';
    const maxLen = isBonusRound() ? RACK_SIZE : MAX_WORD_LEN;
    for (let i = 0; i < maxLen; i++) {
      const d = document.createElement('div');
      const filled = state.currentWord[i];
      d.className = 'slot' + (filled ? ' filled' : '');
      d.textContent = filled ? filled.letter : '';
      activeSlotsEl.appendChild(d);
    }
  }
  // Rounds 1-4 AND Round 5 alike: NEVER reveals whether the in-progress
  // word is valid, what it would score, or what XP it's worth — see the
  // balancing spec's "no mid-round validity feedback" rule. This is only
  // ever used for a neutral rules reminder now, never a live judgement.
  function updateRoundHint() {
    activeLocked.textContent = isBonusRound()
      ? 'Round 5 cannot be skipped — the clock must run out.'
      : 'Press LOCK IN when you’re happy with your answer, or just let the clock run out.';
  }

  function selectTile(index) {
    const tile = state.rack[index];
    if (!tile || tile.used) return;
    const maxLen = isBonusRound() ? RACK_SIZE : MAX_WORD_LEN;
    if (state.currentWord.length >= maxLen) return;
    tile.used = true;
    state.currentWord.push(tile);
    playSound('tile-click');
    renderActiveTiles();
    renderActiveSlots();
  }
  function backspace() {
    const last = state.currentWord.pop();
    if (last) { last.used = false; playSound('backspace'); renderActiveTiles(); renderActiveSlots(); }
  }
  activeBackspaceBtn.addEventListener('click', backspace);

  function currentWordString() {
    return state.currentWord.map((t) => t.letter).join('');
  }

  // Driven by a wall-clock deadline rather than "subtract 1 each tick" —
  // a backgrounded/inactive browser tab throttles or entirely pauses
  // setInterval (commonly clamped to once a minute or less), which would
  // otherwise leave the displayed timer frozen indefinitely instead of
  // catching up the moment the tab's ticks resume. Duration is difficulty-
  // and round-dependent: Rounds 1-4 use difficultyConfig.normalRoundSeconds,
  // Round 5 uses difficultyConfig.round5Seconds — the ONE branch point
  // between the two anywhere in the timer/scoring code.
  function startTimer() {
    const seconds = isBonusRound() ? state.difficultyConfig.round5Seconds : state.difficultyConfig.normalRoundSeconds;
    state.roundSecondsTotal = seconds;
    state.roundDeadline = Date.now() + seconds * 1000;
    state.timeRemaining = seconds;
    state.warnedThisRound = false;
    updateTimerUi();
    clearInterval(state.timerId);
    state.timerId = setInterval(() => {
      state.timeRemaining = Math.max(0, Math.ceil((state.roundDeadline - Date.now()) / 1000));
      updateTimerUi();
      const warnAt = Math.min(10, state.roundSecondsTotal);
      if (state.timeRemaining <= warnAt && state.timeRemaining > 0 && !state.warnedThisRound) { state.warnedThisRound = true; playSound('timer-warning'); }
      if (state.timeRemaining <= 0) { clearInterval(state.timerId); judgeAndEndRound(); }
    }, 250);
  }
  function updateTimerUi() {
    const total = state.roundSecondsTotal || 1;
    const pct = Math.max(0, (state.timeRemaining / total) * 100);
    timerRing.style.setProperty('--pct', pct);
    timerRing.classList.toggle('warn', state.timeRemaining <= Math.min(10, total));
    timerNum.textContent = Math.max(0, state.timeRemaining);
    timerText.textContent = Math.max(0, state.timeRemaining);
  }

  function startActiveRound() {
    state.currentWord = [];
    activeMsg.textContent = ' '; // no mid-round feedback ever gets written here — see updateRoundHint/judgeAndEndRound
    updateRoundHint();
    renderActiveTiles();
    renderActiveSlots();
    if (isBonusRound()) {
      activeRoundLabel.textContent = 'Round 5 of 5';
      activeRoundSub.textContent = 'FIND THE NINE LETTER WORD — no early finish, the clock must run out.';
      activeLockInBtn.classList.add('hidden'); // NEVER available in Round 5 — see lockInRound()
    } else {
      activeRoundLabel.textContent = 'Round ' + state.currentRound + ' of 5';
      activeRoundSub.textContent = 'Build the longest word you can — English words + real cities/countries.';
      activeLockInBtn.classList.remove('hidden');
    }
    updateFooterStats();
    showScreen('ACTIVE');
    startTimer();
    mountSkillCard('active-skillcard-slot'); // center HUD slot — Intelligence, NOT the avatar
  }

  function startBonusRound() {
    state.currentRound = 5;
    const answer = window.QZAnagramData.pickBonusWord();
    let letters = answer.split('');
    // shuffle (Fisher-Yates), reshuffle on the vanishingly rare chance it
    // lands back on the original order
    do {
      for (let i = letters.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [letters[i], letters[j]] = [letters[j], letters[i]];
      }
    } while (letters.join('') === answer);
    state.bonusWord = answer;
    state.rack = letters.map((letter) => ({ letter, used: false }));
    // Every genuine 9-letter dictionary word this exact rack can spell —
    // guaranteed to include `answer` itself, but may include more. ANY of
    // these counts as correct (see judgeAndEndRound's bonus branch) and
    // ALL of them are shown on the result screen afterwards, win or lose.
    state.round5Solutions = computeAnagramSolutions(letters);
    startActiveRound();
  }

  // ================= round result =================
  const resultLabel = document.getElementById('result-label');
  const resultWord = document.getElementById('result-word');
  const resultIcon = document.getElementById('result-icon'); // ONE element, reused every round — never create another
  const resultSubtext = document.getElementById('result-subtext');
  const resultPointsLabel = document.getElementById('result-points-label');
  const resultPoints = document.getElementById('result-points');
  const resultTotalSoFar = document.getElementById('result-total-so-far');
  const resultTimeLeft = document.getElementById('result-timeleft');
  const resultAnswers = document.getElementById('result-answers');
  const resultAnswersLabel = document.getElementById('result-answers-label');
  const resultAnswersList = document.getElementById('result-answers-list');
  const nextRoundBtn = document.getElementById('btn-next-round');

  // The ONE place a round ends and is scored — reached either by LOCK IN
  // (Rounds 1-4 only) or by the timer hitting 0 (every round, including
  // Round 5, which can NEVER end any other way — see lockInRound(). This
  // makes Round 5 a mandatory minimum amount of time per completed game,
  // closing off farming it by rushing Rounds 1-4 then instantly skipping/
  // ending Round 5 and requeuing).
  //
  // Whatever is in the answer boxes AT THIS INSTANT (currentWordString())
  // is what's judged — never a separately-tracked "last submitted" word —
  // so a player who builds HOUSE, then backspaces down to HOU and lets
  // the clock run out, is judged on HOU. Nothing before this call has
  // ever revealed whether the in-progress word is valid or what it scores
  // (see updateRoundHint/activeMsg — neither is ever set to a validity
  // hint anywhere in this file).
  function judgeAndEndRound() {
    clearInterval(state.timerId);
    const roundIndex = state.currentRound - 1;
    const bonus = isBonusRound();
    const word = currentWordString();
    let points;

    if (bonus) {
      const rackSorted = state.rack.map((t) => t.letter).sort().join('');
      const correct = word.length === RACK_SIZE &&
        isValidAnagramQuestWord(word) &&
        word.toUpperCase().split('').sort().join('') === rackSorted;
      points = correct ? ROUND5_POINTS : 0;
    } else {
      const realWord = word.length >= MIN_WORD_LEN && isValidAnagramQuestWord(word);
      points = realWord ? pointsForWord(word.length) : 0;
    }
    // "valid" (the tick/cross + "that word is correct" wording) always
    // tracks whether the word actually scored anything — never a separate
    // notion of "is this a real word" — so a real-but-too-short word (a
    // valid 3-letter word, worth 0 by the shared point table) is shown
    // exactly the same as any other 0-point result, matching the point
    // table's intent precisely instead of contradicting it.
    const valid = points > 0;
    // Audit-only: a real attempt (4+ alphabetic letters — not an empty/
    // too-short submission) that scored nothing is exactly the "the
    // dictionary might be missing this" case worth logging. Never changes
    // `valid`/`points` above, which are already fully decided by this point.
    if (!valid && word.length >= MIN_WORD_LEN && /^[A-Za-z]+$/.test(word)) logRejectedWord(word);

    state.roundScores[roundIndex] = points;
    state.totalScore += points;
    // A valid 9-letter solve counts toward this difficulty's running
    // 9-letter-word counter — whether it happened in Rounds 1-4 (the
    // bonus-tier 18-point word) or Round 5 (the flat 30-point solve);
    // both are "found a 9-letter word" from the player's point of view.
    // Sent once, alongside the final score, in finishGame() — never per
    // round (same "award once" rule as XP).
    if (valid && word.length === 9) state.nineLetterCount += 1;

    // ---- word line + exactly one success/failure icon ----
    if (word) {
      resultLabel.textContent = 'Your answer (' + word.length + ' letter' + (word.length === 1 ? '' : 's') + '):';
      resultWord.textContent = word.toUpperCase();
    } else {
      resultLabel.textContent = 'NO WORD ENTERED';
      resultWord.textContent = '';
    }
    resultIcon.className = valid ? 'tick' : 'cross';
    resultIcon.innerHTML = valid ? '&#10003;' : '&#10060;';
    resultSubtext.textContent = valid ? 'That word is correct!' : (word ? 'That word was not accepted.' : '');

    resultPointsLabel.textContent = 'Points earned:';
    resultPoints.textContent = points + (points === 1 ? ' POINT' : ' POINTS');
    resultTotalSoFar.textContent = 'Total score so far: ' + state.totalScore + (state.totalScore === 1 ? ' point' : ' points');
    resultTimeLeft.textContent = Math.max(0, state.timeRemaining);
    nextRoundBtn.textContent = bonus ? 'SEE FINAL SCORE' : 'NEXT ROUND';

    // ---- Round 5 only: always reveal every valid 9-letter answer for
    // this exact rack, whether the player solved it, submitted something
    // wrong, or ran out of time ----
    if (bonus) {
      const solutions = state.round5Solutions && state.round5Solutions.length
        ? state.round5Solutions
        : (state.bonusWord ? [state.bonusWord] : []);
      resultAnswersLabel.textContent = solutions.length === 1 ? 'Correct answer:' : 'Correct answers:';
      resultAnswersList.textContent = solutions.join(', ');
      resultAnswers.classList.remove('hidden');
    } else {
      resultAnswers.classList.add('hidden');
      resultAnswersList.textContent = '';
    }

    fireEvent(bonus ? 'bonus-round-ended' : 'round-ended', { word, valid, points, round: state.currentRound, difficulty: state.difficulty });
    updateFooterStats();
    showScreen('RESULT');
    mountSkillCard('result-skillcard-slot'); // center HUD slot — Intelligence, NOT the avatar
  }

  // Early-finish for Rounds 1-4 only ("LOCK IN" — balancing spec item 4).
  // Round 5 has no early finish of any kind — see the button being hidden
  // in startActiveRound(), and this no-op guard as a second, independent
  // backstop in case anything else ever calls it while Round 5 is active.
  function lockInRound() {
    if (isBonusRound()) return;
    judgeAndEndRound();
  }
  activeLockInBtn.addEventListener('click', lockInRound);

  nextRoundBtn.addEventListener('click', () => {
    if (state.currentRound < 4) {
      startLetterSelection(state.currentRound + 1);
    } else if (state.currentRound === 4) {
      startBonusRound();
    } else {
      finishGame();
    }
  });

  // ================= game over =================
  const goName = document.getElementById('go-name');
  const goScore = document.getElementById('go-score');
  const goScore2 = document.getElementById('go-score2');
  const goGamesPlayed = document.getElementById('go-gamesplayed');
  const goXpLine = document.getElementById('go-xp-line');
  const goRoundEls = [1, 2, 3, 4, 5].map((n) => document.getElementById('go-r' + n));
  const goTotalPoints = document.getElementById('go-total-points');
  const goSkillcardSlot = document.getElementById('go-skillcard-slot');
  // Set by mountGameOverSkillCard() each game — the box + the pre-game
  // skill snapshot it was built from, so awardIntelligenceXp's response
  // (the only place the POST-game xp/level exists) has something to
  // animate from.
  let goSkillBox = null;
  let goSkillPre = null;

  // Mounted at the PRE-game level/XP (award_xp hasn't run yet at this
  // point in finishGame), using the exact same createFullBox() the lobby
  // uses — same look, same hover tooltip, just built by hand here (instead
  // of QZSkillCard.mountFull's own fetch+render) so this file keeps a
  // reference to the box and can animate its bar/level in place afterwards
  // rather than having a fresh mount() throw the old element away.
  async function mountGameOverSkillCard() {
    goSkillcardSlot.innerHTML = '';
    if (!window.QZSkillCard) { goSkillBox = null; goSkillPre = null; return; }
    const client = window.QZAuth && window.QZAuth.client;
    const userId = state.profile ? state.profile.id : null;
    goSkillPre = await window.QZSkillCard.fetchSkill(client, userId, GAME_KEY, 'Intelligence');
    goSkillPre.iconSrc = '../../assets/img/skills/intelligence.png';
    goSkillBox = window.QZSkillCard.createFullBox(goSkillPre, { caption: 'Solve words to earn Intelligence XP' });
    goSkillcardSlot.appendChild(goSkillBox);
  }

  // One spark-burst + banner per level gained THIS game, never per level —
  // called at most once from animateXpGain regardless of how many levels
  // the award crossed.
  function playLevelUpBurst(newLevel) {
    if (!goSkillBox || goSkillBox.querySelector('.qz-levelup-burst')) return; // never stack
    const burst = document.createElement('div');
    burst.className = 'qz-levelup-burst';
    const SPARK_COUNT = 14;
    for (let i = 0; i < SPARK_COUNT; i++) {
      const spark = document.createElement('span');
      spark.className = 'spark';
      const angle = (Math.PI * 2 * i) / SPARK_COUNT + Math.random() * 0.3;
      const dist = 46 + Math.random() * 34;
      spark.style.setProperty('--dx', (Math.cos(angle) * dist).toFixed(1) + 'px');
      spark.style.setProperty('--dy', (Math.sin(angle) * dist).toFixed(1) + 'px');
      spark.style.animationDelay = (Math.random() * 0.12).toFixed(2) + 's';
      burst.appendChild(spark);
    }
    const banner = document.createElement('div');
    banner.className = 'qz-levelup-banner';
    banner.textContent = 'LEVEL UP! Now Level ' + newLevel;
    goSkillBox.appendChild(burst);
    goSkillBox.appendChild(banner);
    setTimeout(() => { burst.remove(); banner.remove(); }, 1900);
  }

  // A "+N XP" label appears just off the widget's right edge (in line
  // with its icon), slides straight up the screen fading as it goes, and
  // is fully gone by the time it's level with Round 3 — roughly halfway
  // between the widget and that row. Only once it's faded out does the
  // bar pulse gold and fill across to the new value. `newSkill` is the
  // fresh {xp, level} award_xp() itself returned — never a value
  // re-derived client-side.
  const XP_SLIDE_MS = 1100;
  function animateXpGain(xpAmount, newSkill) {
    if (!goSkillBox || !goSkillPre || !window.QZXp) return;
    const fillEl = goSkillBox.querySelector('.qz-skillcard-full-fill');
    const barEl = goSkillBox.querySelector('.qz-skillcard-full-bar');
    const levelEl = goSkillBox.querySelector('.qz-skillcard-full-level');
    if (!fillEl || !barEl || !levelEl) return;

    const iconEl = goSkillBox.querySelector('.qz-skillcard-full-icon');
    const iconRect = (iconEl || goSkillBox).getBoundingClientRect();
    const widgetRect = goSkillBox.getBoundingClientRect();
    const round3Rect = goRoundEls[2] ? goRoundEls[2].getBoundingClientRect() : null;

    const startX = widgetRect.right + 14; // off the widget, not on it
    const startY = iconRect.top + iconRect.height / 2; // in line with the icon
    const round3Y = round3Rect ? round3Rect.top : widgetRect.top - 120;
    const midY = (widgetRect.top + round3Y) / 2; // fully faded by here
    const slideDist = Math.max(24, startY - midY); // px travelled upward

    const label = document.createElement('div');
    label.className = 'qz-xp-fly-label';
    label.style.setProperty('--qz-xp-slide-dist', -slideDist + 'px');
    label.textContent = '+' + xpAmount.toLocaleString() + ' XP';
    label.style.left = startX + 'px';
    label.style.top = startY + 'px';
    document.body.appendChild(label);

    requestAnimationFrame(() => label.classList.add('sliding'));

    setTimeout(() => {
      label.remove();

      // gold pulse, then the bar fills across to the new value
      barEl.classList.add('qz-bar-pulse');
      setTimeout(() => barEl.classList.remove('qz-bar-pulse'), 520);

      setTimeout(() => {
        const newLvl = window.QZXp.displayLevel(newSkill.xp);
        const base = newLvl.base;
        let pct = 100;
        if (base < 99) {
          const curFloor = window.QZXp.xpForLevel(base);
          const nextFloor = window.QZXp.xpForLevel(base + 1);
          const span = nextFloor - curFloor;
          pct = span > 0 ? Math.max(0, Math.min(100, ((newSkill.xp - curFloor) / span) * 100)) : 100;
        }
        const levelLabel = newLvl.isVirtual
          ? base + ' <span class="qz-skillcard-full-of99">(Virtual ' + newLvl.virtual + ')</span>'
          : base + '<span class="qz-skillcard-full-of99">/99</span>';

        fillEl.style.transition = 'width 1.1s cubic-bezier(.2,.8,.2,1)';
        fillEl.style.width = pct + '%';
        levelEl.innerHTML = 'LEVEL ' + levelLabel;

        const oldBase = window.QZXp.displayLevel(goSkillPre.xp).base;
        if (base > oldBase) playLevelUpBurst(base);
      }, 450); // let the pulse read on its own before the bar starts moving
    }, XP_SLIDE_MS);
  }

  // Called once per completed game, alongside saveGameResult/
  // awardIntelligenceXp — records THIS difficulty's high score and adds
  // this game's 9-letter-word count to that difficulty's running total.
  // Updates state.difficultyStats straight from the RPC's own fresh
  // response (same "never trust a stale local copy" pattern as
  // awardIntelligenceXp's level readback) so the lobby shows the correct
  // new numbers the instant the player backs out, with no extra re-fetch.
  async function saveDifficultyStats(difficulty, finalScore, nineLetterCount) {
    if (!window.QZAuth || !window.QZAuth.client || !state.profile) return;
    try {
      const { data, error } = await window.QZAuth.client.rpc('record_anagram_quest_difficulty_result', {
        p_difficulty: difficulty,
        p_score: finalScore,
        p_nine_letter_count: nineLetterCount
      });
      if (error) { console.warn('Anagram Quest: could not save difficulty stats', error); return; }
      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        state.difficultyStats = {
          EASY: { highScore: row.easy_high_score || 0, nineCount: row.easy_nine_count || 0 },
          MEDIUM: { highScore: row.medium_high_score || 0, nineCount: row.medium_nine_count || 0 },
          HARD: { highScore: row.hard_high_score || 0, nineCount: row.hard_nine_count || 0 }
        };
      }
    } catch (err) {
      console.warn('Anagram Quest: could not save difficulty stats', err);
    }
  }

  async function finishGame() {
    const finalScore = state.totalScore;
    const cfg = state.difficultyConfig;
    const xpEarned = finalScore * cfg.xpPerPoint;

    goName.textContent = state.profile ? state.profile.username : 'Guest';
    goRoundEls.forEach((el, i) => { if (el) el.textContent = state.roundScores[i]; });
    goTotalPoints.textContent = finalScore;
    goScore.textContent = finalScore;
    goScore2.textContent = finalScore;
    goXpLine.textContent = state.profile ? ' ' : 'Sign in to save your score and earn Intelligence XP.';
    showScreen('GAMEOVER');
    playSound('game-over');
    fireEvent('game-completed', { score: finalScore, difficulty: state.difficulty, xp: xpEarned, nineLetterCount: state.nineLetterCount });
    // Mounted at the PRE-game level/XP, before award_xp runs, so
    // animateXpGain() (inside awardIntelligenceXp below) has an accurate
    // "before" state to animate the bar up from.
    await mountGameOverSkillCard();
    // all three are per-completed-game, exactly once, here — never per round
    await Promise.all([
      saveGameResult(finalScore),
      awardIntelligenceXp(xpEarned),
      saveDifficultyStats(state.difficulty, finalScore, state.nineLetterCount)
    ]);
    goGamesPlayed.textContent = state.gamesPlayed;
    updateFooterStats();
  }

  document.getElementById('btn-back-lobby').addEventListener('click', () => {
    showScreen('LOBBY');
    updateFooterStats();
  });

  // ================= difficulty select + intro/countdown =================
  function selectDifficulty(key) {
    if (state.intelligenceLevel < DIFFICULTIES[key].unlockLevel) return; // belt-and-suspenders — the button is already disabled/greyed for this
    state.difficulty = key;
    state.difficultyConfig = DIFFICULTIES[key];
    state.totalScore = 0;
    state.roundScores = [0, 0, 0, 0, 0];
    state.nineLetterCount = 0;
    updateDifficultyChips();
    playIntro();
  }
  document.getElementById('btn-diff-easy').addEventListener('click', () => selectDifficulty('EASY'));
  document.getElementById('btn-diff-medium').addEventListener('click', () => selectDifficulty('MEDIUM'));
  document.getElementById('btn-diff-hard').addEventListener('click', () => selectDifficulty('HARD'));
  document.getElementById('btn-diff-back').addEventListener('click', () => showScreen('LOBBY'));

  const introDiffLabel = document.getElementById('intro-diff-label');
  const introStatus = document.getElementById('intro-status');
  const introCountdown = document.getElementById('intro-countdown');

  // Purely cosmetic pacing (balancing spec item 24) — no gameplay state
  // changes here beyond what selectDifficulty() already set; always ends
  // by handing off to startLetterSelection(1). ~3.7s total (900ms "GAME
  // STARTING" + 4 x 700ms for 3/2/1/GO), within the spec's 3-5s window.
  function playIntro() {
    const cfg = state.difficultyConfig;
    introDiffLabel.textContent = cfg.label;
    introDiffLabel.className = 'intro-diff ' + cfg.cssClass;
    introStatus.textContent = 'GAME STARTING';
    introCountdown.textContent = ' ';
    showScreen('INTRO');
    clearTimeout(state.introTimeoutId);
    clearInterval(state.introIntervalId);
    state.introTimeoutId = setTimeout(() => {
      introStatus.textContent = '';
      let n = 3;
      introCountdown.textContent = n;
      state.introIntervalId = setInterval(() => {
        n -= 1;
        if (n > 0) {
          introCountdown.textContent = n;
        } else if (n === 0) {
          introCountdown.textContent = 'GO!';
        } else {
          clearInterval(state.introIntervalId);
          startLetterSelection(1);
        }
      }, 700);
    }, 900);
  }

  // ================= lobby wiring =================
  document.getElementById('btn-start-game').addEventListener('click', async () => {
    await loadDictionary();
    showScreen('DIFFICULTY');
  });
  // Achievements is a plain <a href="achievements.html"> in the lobby's
  // top-right icon row now (Anagram Quest's own scoped achievements page,
  // same folder — not the site-wide profile/achievements.html) — no JS
  // click handler needed, the href does it directly.
  // #btn-leaderboards is now a plain <a href="../../highscores.html?skill=intelligence">
  // — the site-wide highscores page's own deep-link support (see
  // getRequestedSkillId()/init() in highscores.html) picks that query
  // param up and lands straight on the Intelligence leaderboard. No JS
  // click handler needed here either.

  // ---- Rules accordion (lobby only) — one category open at a time,
  // native <button>s so it's keyboard-operable for free, aria-expanded
  // kept in sync for screen readers. Purely a display toggle; nothing
  // here touches game state. ----
  const rulesAccordion = document.getElementById('rules-accordion');
  if (rulesAccordion) {
    rulesAccordion.querySelectorAll('.rule-acc-item').forEach((item) => {
      const head = item.querySelector('.rule-acc-head');
      head.addEventListener('click', () => {
        const wasOpen = item.classList.contains('open');
        rulesAccordion.querySelectorAll('.rule-acc-item').forEach((other) => {
          other.classList.remove('open');
          other.querySelector('.rule-acc-head').setAttribute('aria-expanded', 'false');
        });
        if (!wasOpen) {
          item.classList.add('open');
          head.setAttribute('aria-expanded', 'true');
        }
      });
    });
  }

  // ================= keyboard support =================
  document.addEventListener('keydown', (e) => {
    // Letter-selection screen (Rounds 1-4, before the round timer starts):
    // V/C on the keyboard press the on-screen Vowel/Consonant buttons —
    // lets a player build their whole rack without touching the mouse.
    // Scoped to this screen only, so it never fights with V/C as ordinary
    // rack letters once the round itself starts (handled below).
    if (!screens.SELECT.classList.contains('hidden')) {
      const key = e.key.toUpperCase();
      if (key === 'V' && !btnVowel.disabled) { e.preventDefault(); pressVC('V'); }
      else if (key === 'C' && !btnConsonant.disabled) { e.preventDefault(); pressVC('C'); }
      return;
    }

    if (screens.ACTIVE.classList.contains('hidden')) return;
    if (e.key === 'Backspace') { e.preventDefault(); backspace(); return; }
    if (e.key === 'Enter') { e.preventDefault(); lockInRound(); return; }
    // Once the round starts, V/C (like every other letter) only ever
    // selects a rack tile — same as any other key, no special-casing
    // needed: it already does nothing unless that letter is actually in
    // this round's rack.
    const key = e.key.toUpperCase();
    if (key.length === 1 && key >= 'A' && key <= 'Z') {
      const idx = state.rack.findIndex((t) => !t.used && t.letter === key);
      if (idx >= 0) selectTile(idx);
    }
  });

  // Catch the round up immediately on regaining focus, rather than waiting
  // for the next (possibly still-throttled) interval tick.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (!screens.ACTIVE.classList.contains('hidden') && state.roundDeadline) {
      state.timeRemaining = Math.max(0, Math.ceil((state.roundDeadline - Date.now()) / 1000));
      updateTimerUi();
      if (state.timeRemaining <= 0) { clearInterval(state.timerId); judgeAndEndRound(); }
    } else if (!screens.SELECT.classList.contains('hidden') && state.selDeadline && state.selecting) {
      const remaining = Math.max(0, Math.ceil((state.selDeadline - Date.now()) / 1000));
      updateSelTimerUi(remaining);
      if (remaining <= 0) onSelTimerExpired();
    }
  });

  // ================= init =================
  loadAccountData();
  loadDictionary();
})();
