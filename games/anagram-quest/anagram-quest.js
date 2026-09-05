// ===== Anagram Quest — game logic =====
// Single-player, 5-round word game. State machine:
//   LOBBY -> LETTER_SELECTION -> ACTIVE_ROUND -> ROUND_RESULT -> (repeat x4)
//   -> BONUS_ROUND (round 5, reuses ACTIVE_ROUND/ROUND_RESULT screens) -> GAME_OVER
//
// LETTER_SELECTION: 10s to pick V/C; generatedRack (state.rack) is
// immutable the instant a letter lands in it — no Backspace exists on that
// screen. Reaching 9 letters manually stops the countdown immediately;
// letting it expire auto-fills the rest (see autoFillRack), preserving
// every letter already picked.
//
// ACTIVE_ROUND (rounds 1-4): 30s (NORMAL_ROUND_SECONDS) to build a word.
// Submitting only ever checks MECHANICAL rules (length, and — by
// construction — only-rack-letters) and neutrally says "WORD SUBMITTED";
// it never reveals whether the word is real, so nothing here can be
// brute-forced. Submitting again simply replaces the latest candidate.
// Real validity (isValidAnagramQuestWord: English dictionary OR a real
// country/city, see geo-data.js) is decided once, at endRound(), against
// only the LATEST submission. Round 5 is the one exception: it still
// validates immediately and can end the round early.
//
// XP: Anagram Quest trains the "Intelligence" skill (see supabase/
// migrations/20260905020000_intelligence_skill.sql) at exactly 1 XP per
// point of the game's final score — awarded once per completed game,
// through the same award_xp() RPC every other game uses (Space Snake
// included), following the shared OSRS-style level formula in
// supabase/schema.sql. Nothing about the formula or the RPC is special-
// cased for this game; only GAME_KEY and the per-run XP amount are.
(function () {
  const GAME_KEY = 'intelligence';
  const TOTAL_ROUNDS = 5;
  const NORMAL_ROUND_SECONDS = 30; // Rounds 1-4 word-building timer (was 40s)
  const VC_SELECT_TIME_SECONDS = 10; // separate, shorter countdown for letter selection (rounds 1-4) — unchanged
  const MIN_WORD_LEN = 4;
  const MAX_WORD_LEN = 9;
  const RACK_SIZE = 9;
  const VOWELS = 'AEIOU';
  const isVowelLetter = (ch) => VOWELS.indexOf(ch) !== -1;

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
  // The ONE centralized word validator — every place in this file that
  // needs to know "does this word count" (Rounds 1-4 at round end, Round 5
  // immediately) calls this, never isValidEnglishWord alone, so English
  // dictionary words, real countries and real cities are always judged
  // identically everywhere.
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
    currentRound: 0,
    rack: [],            // [{ letter, used }]
    currentWord: [],      // array of rack-tile refs, in selection order
    // Rounds 1-4: the LATEST mechanically-allowed submission (right length,
    // built only from rack tiles) — NOT necessarily a real word. Validity
    // is deliberately not known/shown until the round ends (see submitWord
    // and endRound) so a player can't brute-force by watching for a "valid"
    // reaction. Round 5 still validates immediately, per spec.
    submittedWord: null,
    roundScores: [0, 0, 0, 0, 0],
    totalScore: 0,
    timeRemaining: NORMAL_ROUND_SECONDS,
    timerId: null,
    bonusWord: null,
    bonusSolved: false,
    selecting: false,     // true while V/C picks are still being made (round timer not started)
    profile: null,        // { id, username, ... } or null for a guest
    highScore: 0,
    gamesPlayed: 0
    // Intelligence level/XP is intentionally NOT cached here — the lobby's
    // skill card (assets/js/skill-card.js) always fetches it fresh from
    // public.game_progress itself, the same way profile/skills.html does,
    // so there is exactly one source of truth and no stale duplicate.
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
    const lobbyName = document.getElementById('lobby-username');
    if (lobbyHs) lobbyHs.textContent = state.highScore;
    if (lobbyGp) lobbyGp.textContent = state.gamesPlayed;
    if (lobbyName) lobbyName.textContent = state.profile ? state.profile.username : 'Guest';
    // Only actually re-fetch/re-mount the skill card while the lobby is the
    // visible screen — updateFooterStats() also runs on every in-round
    // transition, and there's no point re-querying game_progress then.
    if (!screens.LOBBY.classList.contains('hidden')) mountIntelligenceCard();
  }

  // Same reusable component + same public.games/public.game_progress read
  // as Profile -> Skills — see assets/js/skill-card.js. Always re-fetches
  // fresh (never reuses a cached level), so it can never show a stale
  // value after XP was just awarded.
  // Generic — used for the lobby's own card AND the mid-game/post-round
  // slots (see items 6/7: those replace what used to be a circular avatar
  // placeholder). Every call site is this ONE function; there is no second
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
  function mountIntelligenceCard() { mountSkillCard('lobby-skillcard-slot'); }

  // ================= player avatar (lobby only) =================
  // Real, currently-equipped Quest Zone avatar — same renderer
  // (assets/js/avatar-viewer.js) and same equipped_items/
  // avatar_customization tables as Profile/Inventory. basePathPrefix:'../'
  // because this page lives one directory deeper than profile/*.html,
  // which is what avatar-viewer.js's asset paths assume by default;
  // staticFront:true because this is a small, still, front-facing circle
  // next to the username, not the full turntable viewer. No separate
  // Anagram Quest avatar state exists anywhere — every value below comes
  // straight from the same tables Profile/Inventory read.
  let qzAvatar = null;
  async function loadPlayerAvatar() {
    const container = document.getElementById('lobby-avatar-3d');
    if (!container || !window.QZAvatarViewer) return;
    if (!qzAvatar) qzAvatar = window.QZAvatarViewer.mount(container, { basePathPrefix: '../', staticFront: true });
    if (!qzAvatar || !state.profile || !window.QZAuth || !window.QZAuth.client) return;
    try {
      const client = window.QZAuth.client;
      const [{ data: equipped }, { data: custom }] = await Promise.all([
        client.from('equipped_items').select('slot,item_id').eq('user_id', state.profile.id),
        client.from('avatar_customization').select('gender,skin_colour,hair_style,hair_colour').eq('user_id', state.profile.id).maybeSingle()
      ]);
      const catalogById = {};
      (window.QZ_ITEM_CATALOG || []).forEach((it) => { catalogById[it.id] = it; });
      const items = {};
      (equipped || []).forEach((row) => { if (row.item_id && catalogById[row.item_id]) items[row.slot] = catalogById[row.item_id]; });
      qzAvatar.setAvatarEquipment(items);
      if (custom) {
        qzAvatar.setBaseAppearance(custom.gender, custom.skin_colour);
        qzAvatar.setHairstyle(custom.hair_style, custom.hair_colour);
      }
    } catch (err) {
      console.warn('Anagram Quest: could not load player avatar', err);
    }
  }

  // ================= account load/save =================
  async function loadAccountData() {
    if (!window.QZAuth || !window.QZAuth.client) { await loadPlayerAvatar(); updateFooterStats(); return; }
    try {
      const profile = await window.QZAuth.getProfile();
      state.profile = profile;
      if (!profile) { await loadPlayerAvatar(); updateFooterStats(); return; }

      const client = window.QZAuth.client;
      const { data: statsRow } = await client
        .from('game_stats').select('high_score,games_played')
        .eq('user_id', profile.id).eq('game_key', GAME_KEY).maybeSingle();
      state.highScore = (statsRow && statsRow.high_score) || 0;
      state.gamesPlayed = (statsRow && statsRow.games_played) || 0;
      await loadPlayerAvatar();
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

  // Intelligence XP: exactly 1 XP per point of this run's final score, via
  // the same award_xp() every game shares — it caps the total and
  // recalculates level server-side; a tampered client can only ever ask
  // to "add this run's score" as XP, never set the stored value directly.
  async function awardIntelligenceXp(finalScore) {
    if (!window.QZAuth || !window.QZAuth.client || !state.profile || finalScore <= 0) return;
    try {
      const { data, error } = await window.QZAuth.client.rpc('award_xp', {
        p_game_key: GAME_KEY,
        p_xp_to_add: finalScore
      });
      if (error) { console.warn('Anagram Quest: could not save XP', error); return; }
      const row = Array.isArray(data) ? data[0] : data;
      if (row && window.QZXp) {
        // `lvl` is derived straight from the RPC's own fresh response, not
        // from any cached state — the lobby skill card will independently
        // pick up the same new level next time it mounts (updateFooterStats
        // below re-mounts it).
        const lvl = window.QZXp.displayLevel(row.xp);
        goXpLine.textContent = '+' + finalScore.toLocaleString() + ' Intelligence XP (Level ' +
          lvl.base + (lvl.isVirtual ? ' · Virtual ' + lvl.virtual : '') + ')';
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
    mountSkillCard('sel-skillcard-slot'); // center HUD slot — Intelligence, NOT the avatar (see item 6)
  }

  // Wall-clock deadline, same pattern as the 30-second round timer — self-
  // corrects instantly if the tab was throttled/backgrounded instead of
  // leaving the countdown frozen.
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
  // every letter already picked), then go straight into the 30-second
  // word round.
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
  // status: true (green — bonus round correct), false (red — rejected/
  // invalid), or 'neutral' (cyan — a normal-round submission was accepted
  // MECHANICALLY; deliberately says nothing about whether it will score).
  function setMsg(text, status) {
    activeMsg.textContent = text || ' ';
    activeMsg.classList.toggle('ok', status === true);
    activeMsg.classList.toggle('neutral', status === 'neutral');
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

    // Round 5 is explicitly exempt from the hidden-validation rule below
    // (item 37) — it still validates and can end the round immediately.
    if (isBonusRound()) {
      if (word.length !== RACK_SIZE) { setMsg('You must use all 9 letters.', false); playSound('invalid'); return; }
      if (!isValidAnagramQuestWord(word)) { setMsg('Not accepted.', false); playSound('invalid'); return; }
      // exact-anagram check: must use precisely the rack's letters (this
      // also transparently accepts an alternate genuine 9-letter word — or
      // a real 9-letter place name — made from the same letters, per spec,
      // since it's a pure multiset compare)
      const rackSorted = state.rack.map((t) => t.letter).sort().join('');
      if (word.toUpperCase().split('').sort().join('') !== rackSorted) {
        setMsg('Not accepted.', false); playSound('invalid'); return;
      }
      setMsg('Correct!', true);
      playSound('valid');
      fireEvent('bonus-round-solved', { word, timeRemaining: state.timeRemaining });
      endRound(word);
      return;
    }

    // Rounds 1-4: only mechanical rules are enforced HERE (length, and —
    // by construction, since currentWord can only ever contain clicked
    // rack tiles — using only available rack letters). Whether the word is
    // actually real is judged only once, at endRound(), so nothing at
    // submit time can be used to brute-force the dictionary/geo data (see
    // items 23-24). Submitting again before the timer ends simply replaces
    // this as the latest candidate (items 25-26) — an older word, valid or
    // not, is never preserved once a newer one is submitted.
    if (word.length < MIN_WORD_LEN) { setMsg('Word must be at least ' + MIN_WORD_LEN + ' letters.', false); playSound('invalid'); return; }

    state.submittedWord = word;
    updateLockedLabel();
    setMsg('WORD SUBMITTED', 'neutral');
    playSound('valid');
    fireEvent('word-submitted', { word, round: state.currentRound });
  }
  activeSubmitBtn.addEventListener('click', submitWord);

  // Driven by a wall-clock deadline rather than "subtract 1 each tick" —
  // a backgrounded/inactive browser tab throttles or entirely pauses
  // setInterval (commonly clamped to once a minute or less), which would
  // otherwise leave the displayed timer frozen indefinitely instead of
  // catching up the moment the tab's ticks resume.
  function startTimer() {
    state.roundDeadline = Date.now() + NORMAL_ROUND_SECONDS * 1000;
    state.timeRemaining = NORMAL_ROUND_SECONDS;
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
    const pct = Math.max(0, (state.timeRemaining / NORMAL_ROUND_SECONDS) * 100);
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
      activeRoundSub.textContent = 'Build the longest word you can — English words + real cities/countries.';
    }
    updateFooterStats();
    showScreen('ACTIVE');
    startTimer();
    mountSkillCard('active-skillcard-slot'); // center HUD slot — Intelligence, NOT the avatar (see item 6)
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
    // Every genuine 9-letter dictionary word this exact rack can spell —
    // guaranteed to include `answer` itself, but may include more. ANY of
    // these counts as correct (see submitWord's bonus branch) and ALL of
    // them are shown on the result screen afterwards, win or lose.
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
  const resultTimeLeft = document.getElementById('result-timeleft');
  const resultAnswers = document.getElementById('result-answers');
  const resultAnswersLabel = document.getElementById('result-answers-label');
  const resultAnswersList = document.getElementById('result-answers-list');
  const nextRoundBtn = document.getElementById('btn-next-round');

  function endRound(bonusCorrectWord) {
    clearInterval(state.timerId);
    const roundIndex = state.currentRound - 1;
    const bonus = isBonusRound();
    let word, points, valid;

    if (bonus) {
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
      // Validity is decided HERE, for the very first time — never at
      // submit time (items 23-26). Only the LATEST submission is judged;
      // an earlier valid word the player has since overwritten is not
      // resurrected just because the new one turned out invalid.
      word = state.submittedWord;
      valid = !!word && isValidAnagramQuestWord(word);
      points = valid ? word.length : 0;
    }

    state.roundScores[roundIndex] = points;
    state.totalScore += points;

    // ---- word line + exactly one success/failure icon ----
    if (word) {
      resultLabel.textContent = 'You submitted a ' + word.length + ' letter word:';
      resultWord.textContent = word.toUpperCase();
    } else {
      resultLabel.textContent = 'NO WORD SUBMITTED';
      resultWord.textContent = '';
    }
    resultIcon.className = valid ? 'tick' : 'cross';
    resultIcon.innerHTML = valid ? '&#10003;' : '&#10060;';
    // "not accepted" only when a word actually WAS submitted and judged
    // invalid — true no-submission stays blank (its "NO WORD SUBMITTED"
    // label above already says everything that case needs).
    resultSubtext.textContent = valid ? 'That word is correct!' : (word && !bonus ? 'That word was not accepted.' : '');

    resultPointsLabel.textContent = 'Points earned:';
    resultPoints.textContent = points + (points === 1 ? ' POINT' : ' POINTS');
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

    updateFooterStats();
    showScreen('RESULT');
    mountSkillCard('result-skillcard-slot'); // center HUD slot — Intelligence, NOT the avatar (see item 7)
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
  const goXpLine = document.getElementById('go-xp-line');

  async function finishGame() {
    const finalScore = state.totalScore;
    goName.textContent = state.profile ? state.profile.username : 'Guest';
    goScore.textContent = finalScore;
    goScore2.textContent = finalScore;
    goXpLine.textContent = state.profile ? ' ' : 'Sign in to save your score and earn Intelligence XP.';
    showScreen('GAMEOVER');
    playSound('game-over');
    fireEvent('game-completed', { score: finalScore });
    // both are per-completed-game, exactly once, here — never per round
    await Promise.all([
      saveGameResult(finalScore),
      awardIntelligenceXp(finalScore)
    ]);
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
    if (document.hidden) return;
    if (!screens.ACTIVE.classList.contains('hidden') && state.roundDeadline) {
      state.timeRemaining = Math.max(0, Math.ceil((state.roundDeadline - Date.now()) / 1000));
      updateTimerUi();
      if (state.timeRemaining <= 0) { clearInterval(state.timerId); endRound(null); }
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
