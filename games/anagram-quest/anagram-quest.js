// ===== Anagram Quest — game logic =====
// Single-player, 5-round word game. State machine:
//   LOBBY -> LETTER_SELECTION -> ACTIVE_ROUND -> ROUND_RESULT -> (repeat x4)
//   -> BONUS_ROUND (round 5, reuses ACTIVE_ROUND/ROUND_RESULT screens) -> GAME_OVER
//
// XP is intentionally NOT implemented anywhere in this file — level is
// read-only (whatever the account's game_progress row already has), and
// nothing here ever calls award_xp(). See supabase/migrations/
// 20260905010000_anagram_quest.sql for the account-side plumbing.
(function () {
  const GAME_KEY = 'anagram-quest';
  const TOTAL_ROUNDS = 5;
  const ROUND_TIME_SECONDS = 40;
  const MIN_WORD_LEN = 4;
  const MAX_WORD_LEN = 9;
  const RACK_SIZE = 9;

  // Centralised bonus-round scoring — tune balance here, nowhere else.
  const BONUS_BASE_POINTS = 10;
  const BONUS_SPEED_INTERVAL = 5;  // seconds
  const BONUS_SPEED_POINTS = 1;    // awarded per full interval of time left

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

  // ================= state =================
  const state = {
    screen: 'LOBBY',
    currentRound: 0,
    rack: [],            // [{ letter, used }]
    currentWord: [],      // array of rack-tile refs, in selection order
    submittedWord: null,  // last VALID submitted word string, or null
    roundScores: [0, 0, 0, 0, 0],
    totalScore: 0,
    timeRemaining: ROUND_TIME_SECONDS,
    timerId: null,
    bonusWord: null,
    bonusSolved: false,
    selecting: false,     // true while V/C picks are still being made (round timer not started)
    profile: null,        // { id, username, ... } or null for a guest
    level: 1,
    highScore: 0,
    gamesPlayed: 0
  };

  // ================= DOM =================
  const screens = {
    LOBBY: document.getElementById('screen-lobby'),
    SELECT: document.getElementById('screen-select'),
    ACTIVE: document.getElementById('screen-active'),
    RESULT: document.getElementById('screen-result'),
    GAMEOVER: document.getElementById('screen-gameover')
  };
  function showScreen(key) {
    Object.values(screens).forEach((el) => el.classList.add('hidden'));
    screens[key].classList.remove('hidden');
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
    const lobbyLvl = document.getElementById('lobby-level');
    const lobbyName = document.getElementById('lobby-username');
    if (lobbyHs) lobbyHs.textContent = state.highScore;
    if (lobbyGp) lobbyGp.textContent = state.gamesPlayed;
    if (lobbyLvl) lobbyLvl.textContent = state.level + '/99';
    if (lobbyName) lobbyName.textContent = state.profile ? state.profile.username : 'Guest';
  }

  // ================= account load/save =================
  async function loadAccountData() {
    if (!window.QZAuth || !window.QZAuth.client) { updateFooterStats(); return; }
    try {
      const profile = await window.QZAuth.getProfile();
      state.profile = profile;
      if (!profile) { updateFooterStats(); return; }

      const client = window.QZAuth.client;
      const [{ data: progressRow }, { data: statsRow }] = await Promise.all([
        client.from('game_progress').select('level').eq('user_id', profile.id).eq('game_key', GAME_KEY).maybeSingle(),
        client.from('game_stats').select('high_score,games_played').eq('user_id', profile.id).eq('game_key', GAME_KEY).maybeSingle()
      ]);
      state.level = (progressRow && progressRow.level) || 1;
      state.highScore = (statsRow && statsRow.high_score) || 0;
      state.gamesPlayed = (statsRow && statsRow.games_played) || 0;
    } catch (err) {
      console.warn('Anagram Quest: could not load account data', err);
    }
    updateFooterStats();
  }

  // Called once per COMPLETED game (Game Over), never per round. Score is
  // still computed entirely client-side (no per-round server replay), but
  // the write itself only ever happens through record_game_result() — see
  // the migration — so a tampered client can't PATCH an arbitrary value in.
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

  // ================= letter selection (rounds 1-4) =================
  const selSlotsEl = document.getElementById('sel-slots');
  const selTilesEl = document.getElementById('sel-tiles');
  const selRoundNumEl = document.getElementById('sel-round-num');
  const btnVowel = document.getElementById('btn-vowel');
  const btnConsonant = document.getElementById('btn-consonant');
  const selBackspaceBtn = document.getElementById('sel-backspace');

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
  }

  function pressVC(type) {
    if (!state.selecting || state.rack.length >= RACK_SIZE) return;
    const letter = type === 'V' ? window.QZAnagramData.randomVowel() : window.QZAnagramData.randomConsonant();
    state.rack.push({ letter, used: false });
    playSound('letter-pick');
    renderSelectSlots();
    if (state.rack.length >= RACK_SIZE) {
      state.selecting = false;
      btnVowel.disabled = true;
      btnConsonant.disabled = true;
      setTimeout(() => startActiveRound(), 350); // brief glow/pause before play begins
    }
  }
  btnVowel.addEventListener('click', () => pressVC('V'));
  btnConsonant.addEventListener('click', () => pressVC('C'));
  selBackspaceBtn.addEventListener('click', () => {
    if (state.selecting && state.rack.length > 0) { state.rack.pop(); renderSelectSlots(); }
  });

  // ================= active round (build + submit) =================
  const activeSlotsEl = document.getElementById('active-slots');
  const activeTilesEl = document.getElementById('active-tiles');
  const activeRoundLabel = document.getElementById('active-round-label');
  const activeRoundSub = document.getElementById('active-round-sub');
  const activeMsg = document.getElementById('active-msg');
  const activeLocked = document.getElementById('active-locked');
  const activeSubmitBtn = document.getElementById('active-submit');
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
  function setMsg(text, ok) {
    activeMsg.textContent = text || ' ';
    activeMsg.classList.toggle('ok', !!ok);
  }
  function updateLockedLabel() {
    activeLocked.textContent = state.submittedWord ? ('Current answer: ' + state.submittedWord) : ' ';
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

  function submitWord() {
    const word = currentWordString();

    if (isBonusRound()) {
      if (word.length !== RACK_SIZE) { setMsg('You must use all 9 letters.', false); playSound('invalid'); return; }
      if (!isValidEnglishWord(word)) { setMsg('Not a valid English word.', false); playSound('invalid'); return; }
      // exact-anagram check: must use precisely the rack's letters (this
      // also transparently accepts an alternate genuine 9-letter word made
      // from the same letters, per spec, since it's a pure multiset compare)
      const rackSorted = state.rack.map((t) => t.letter).sort().join('');
      if (word.toUpperCase().split('').sort().join('') !== rackSorted) {
        setMsg('Not a valid English word.', false); playSound('invalid'); return;
      }
      setMsg('Correct!', true);
      playSound('valid');
      fireEvent('bonus-round-solved', { word, timeRemaining: state.timeRemaining });
      endRound(word);
      return;
    }

    if (word.length < MIN_WORD_LEN) { setMsg('Word must be at least ' + MIN_WORD_LEN + ' letters.', false); playSound('invalid'); return; }
    if (!isValidEnglishWord(word)) { setMsg('Not a valid English word.', false); playSound('invalid'); return; }

    state.submittedWord = word;
    updateLockedLabel();
    setMsg('Saved as your current answer.', true);
    playSound('valid');
    if (word.length >= 8) fireEvent('long-word', { word });
    fireEvent('valid-word-submitted', { word, round: state.currentRound });
  }
  activeSubmitBtn.addEventListener('click', submitWord);

  // Driven by a wall-clock deadline rather than "subtract 1 each tick" —
  // a backgrounded/inactive browser tab throttles or entirely pauses
  // setInterval (commonly clamped to once a minute or less), which would
  // otherwise leave the displayed timer frozen indefinitely instead of
  // catching up the moment the tab's ticks resume.
  function startTimer() {
    state.roundDeadline = Date.now() + ROUND_TIME_SECONDS * 1000;
    state.timeRemaining = ROUND_TIME_SECONDS;
    state.warnedThisRound = false;
    updateTimerUi();
    clearInterval(state.timerId);
    state.timerId = setInterval(() => {
      state.timeRemaining = Math.max(0, Math.ceil((state.roundDeadline - Date.now()) / 1000));
      updateTimerUi();
      if (state.timeRemaining <= 10 && !state.warnedThisRound) { state.warnedThisRound = true; playSound('timer-warning'); }
      if (state.timeRemaining <= 0) { clearInterval(state.timerId); endRound(null); }
    }, 250);
  }
  function updateTimerUi() {
    const pct = Math.max(0, (state.timeRemaining / ROUND_TIME_SECONDS) * 100);
    timerRing.style.setProperty('--pct', pct);
    timerRing.classList.toggle('warn', state.timeRemaining <= 10);
    timerNum.textContent = Math.max(0, state.timeRemaining);
    timerText.textContent = Math.max(0, state.timeRemaining);
  }

  function startActiveRound() {
    state.currentWord = [];
    state.submittedWord = null;
    state.bonusSolved = false;
    setMsg('', false);
    updateLockedLabel();
    renderActiveTiles();
    renderActiveSlots();
    if (isBonusRound()) {
      activeRoundLabel.textContent = 'Round 5 of 5';
      activeRoundSub.textContent = 'FIND THE NINE LETTER WORD';
    } else {
      activeRoundLabel.textContent = 'Round ' + state.currentRound + ' of 5';
      activeRoundSub.textContent = 'Build the longest valid English word you can.';
    }
    updateFooterStats();
    showScreen('ACTIVE');
    startTimer();
  }

  function startBonusRound() {
    state.currentRound = 5;
    const words = window.QZAnagramData.BONUS_WORDS;
    const answer = words[Math.floor(Math.random() * words.length)];
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
    startActiveRound();
  }

  // ================= round result =================
  const resultLabel = document.getElementById('result-label');
  const resultWord = document.getElementById('result-word');
  const resultIcon = document.getElementById('result-icon');
  const resultPointsLabel = document.getElementById('result-points-label');
  const resultPoints = document.getElementById('result-points');
  const resultTimeLeft = document.getElementById('result-timeleft');
  const nextRoundBtn = document.getElementById('btn-next-round');

  function endRound(bonusCorrectWord) {
    clearInterval(state.timerId);
    const roundIndex = state.currentRound - 1;
    let word, points, valid;

    if (isBonusRound()) {
      if (bonusCorrectWord) {
        valid = true;
        word = bonusCorrectWord;
        const speedBonus = Math.floor(state.timeRemaining / BONUS_SPEED_INTERVAL) * BONUS_SPEED_POINTS;
        points = BONUS_BASE_POINTS + speedBonus;
      } else {
        valid = false;
        word = state.submittedWord || null;
        points = 0;
      }
    } else {
      word = state.submittedWord;
      valid = !!word;
      points = valid ? word.length : 0;
    }

    state.roundScores[roundIndex] = points;
    state.totalScore += points;

    if (word) {
      resultLabel.textContent = 'You submitted a ' + word.length + ' letter word:';
      resultWord.innerHTML = '<span>' + word.toUpperCase() + '</span>';
    } else {
      resultLabel.textContent = 'Time’s up — no valid word was submitted.';
      resultWord.innerHTML = '<span>—</span>';
    }
    const icon = document.createElement('span');
    icon.className = valid ? 'tick' : 'cross';
    icon.innerHTML = valid ? '&#10003;' : '&#10060;';
    resultWord.appendChild(icon);

    resultPointsLabel.textContent = valid ? 'Points earned:' : 'Points earned:';
    resultPoints.textContent = points + (points === 1 ? ' POINT' : ' POINTS');
    resultTimeLeft.textContent = Math.max(0, state.timeRemaining);
    nextRoundBtn.textContent = isBonusRound() ? 'SEE FINAL SCORE' : 'NEXT ROUND';
    updateFooterStats();
    showScreen('RESULT');
  }

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

  async function finishGame() {
    const finalScore = state.totalScore;
    goName.textContent = state.profile ? state.profile.username : 'Guest';
    goScore.textContent = finalScore;
    goScore2.textContent = finalScore;
    showScreen('GAMEOVER');
    playSound('game-over');
    fireEvent('game-completed', { score: finalScore });
    await saveGameResult(finalScore); // increments games played exactly once, here, per completed game
    goGamesPlayed.textContent = state.gamesPlayed;
    updateFooterStats();
  }

  document.getElementById('btn-back-lobby').addEventListener('click', () => {
    showScreen('LOBBY');
    updateFooterStats();
  });

  // ================= lobby wiring =================
  document.getElementById('btn-start-game').addEventListener('click', async () => {
    await loadDictionary();
    state.totalScore = 0;
    state.roundScores = [0, 0, 0, 0, 0];
    startLetterSelection(1);
  });
  document.getElementById('btn-achievements').addEventListener('click', () => {
    // Anagram Quest's own scoped achievements page (achievements.html,
    // same folder) — not the site-wide profile/achievements.html — so
    // this only ever shows Anagram Quest's own list, with its own
    // "Back to Game" instead of "Back to Profile".
    window.location.href = 'achievements.html';
  });
  // #btn-leaderboards uses data-coming-soon (see site.js) — no listener needed here.

  // ================= keyboard support =================
  document.addEventListener('keydown', (e) => {
    if (screens.ACTIVE.classList.contains('hidden')) return;
    if (e.key === 'Backspace') { e.preventDefault(); backspace(); return; }
    if (e.key === 'Enter') { e.preventDefault(); submitWord(); return; }
    const key = e.key.toUpperCase();
    if (key.length === 1 && key >= 'A' && key <= 'Z') {
      const idx = state.rack.findIndex((t) => !t.used && t.letter === key);
      if (idx >= 0) selectTile(idx);
    }
  });

  // Catch the round up immediately on regaining focus, rather than waiting
  // for the next (possibly still-throttled) interval tick.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || screens.ACTIVE.classList.contains('hidden') || !state.roundDeadline) return;
    state.timeRemaining = Math.max(0, Math.ceil((state.roundDeadline - Date.now()) / 1000));
    updateTimerUi();
    if (state.timeRemaining <= 0) { clearInterval(state.timerId); endRound(null); }
  });

  // ================= init =================
  loadAccountData();
  loadDictionary();
})();
