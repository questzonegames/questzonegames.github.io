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
// LETTER_SELECTION: difficulty-specific seconds to pick V/C
// (state.difficultyConfig.selectSeconds — Easy 15s, Medium 15s, Hard 10s);
// generatedRack
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
  // selectSeconds: the V/C letter-selection countdown (Rounds 1-4 only —
  // Round 5's rack is dealt directly, no selection phase). Matches the
  // Rules panel's own "Rounds" text exactly (see index.html) — normalRoundSeconds
  // is the separate word-BUILDING timer that starts once selection ends.
  const DIFFICULTIES = {
    EASY: { key: 'EASY', label: 'EASY', selectSeconds: 15, normalRoundSeconds: 40, round5Seconds: 30, xpPerPoint: 20, cssClass: 'easy', unlockLevel: 1 },
    MEDIUM: { key: 'MEDIUM', label: 'MEDIUM', selectSeconds: 15, normalRoundSeconds: 25, round5Seconds: 30, xpPerPoint: 60, cssClass: 'medium', unlockLevel: 5 },
    HARD: { key: 'HARD', label: 'HARD', selectSeconds: 10, normalRoundSeconds: 10, round5Seconds: 20, xpPerPoint: 180, cssClass: 'hard', unlockLevel: 40 }
  };

  // ---- sound engine (Anagram-Quest-only — NOT a site-wide QZSound
  // module; see docs/AUDIO_PLAN.md) ----
  // Every sound below is synthesized live with the Web Audio API — no
  // audio files, nothing third-party, nothing to license. Scoped to this
  // game only, on purpose (per the balancing spec: "only the Anagram
  // Quest ones, not the global/site-wide ones, no background music").
  // Design notes carried over from the auditioning tool:
  //  - Only 'sine'/'triangle' oscillators anywhere — no square/sawtooth,
  //    which read as harsh/buzzy.
  //  - Every letter/tile/button sound is built from aqClick() — a very
  //    short filtered-noise "tick" layered with a soft round tone
  //    underneath, for a tactile, physical feel rather than an
  //    electronic blip.
  //  - Melodic hits use happy major/pentatonic intervals, even for
  //    "invalid" moments (a gentle soft dip, never a dissonant buzzer).
  const AQSound = (function () {
    let ctx = null, master = null;
    // Persisted 0-1 SFX volume, set by the Sound popover (see
    // wireAudioControls()) — read up front so the very first sound ever
    // played already respects whatever the player set last time, not a
    // hardcoded default that then jumps.
    let currentVolume = (function () {
      try {
        const saved = localStorage.getItem('aq-sfx-volume');
        if (saved !== null) return Math.max(0, Math.min(100, parseInt(saved, 10))) / 100;
      } catch (e) {}
      return 0.6;
    })();
    function getCtx() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = currentVolume;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    function setVolume(v) {
      currentVolume = Math.max(0, Math.min(1, v));
      if (master) master.gain.value = currentVolume;
    }
    function envelope(g, t0, { attack = 0.006, decay = 0.08, sustain = 0.4, release = 0.09, duration = 0.2, peak = 1 }) {
      g.gain.cancelScheduledValues(t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + attack);
      const sustainLevel = Math.max(peak * sustain, 0.0001);
      g.gain.exponentialRampToValueAtTime(sustainLevel, t0 + attack + decay);
      const relStart = Math.max(t0 + attack + decay, t0 + duration - release);
      g.gain.setValueAtTime(sustainLevel, relStart);
      g.gain.exponentialRampToValueAtTime(0.0001, relStart + release);
    }
    function tone(opts) {
      const c = getCtx(); if (!c) return;
      const { freq = 440, freqEnd = null, type = 'sine', duration = 0.16, volume = 0.24, delay = 0, filterFreq = 3800, filterQ = 0.6, attack = 0.008 } = opts;
      const t0 = c.currentTime + delay;
      const osc = c.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + duration);
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = filterFreq; f.Q.value = filterQ;
      const g = c.createGain();
      envelope(g, t0, { duration, peak: volume, attack, decay: duration * 0.3, sustain: 0.45, release: duration * 0.4 });
      osc.connect(f).connect(g).connect(master);
      osc.start(t0);
      osc.stop(t0 + duration + 0.08);
    }
    function noiseBurst(opts) {
      const c = getCtx(); if (!c) return;
      const { duration = 0.05, volume = 0.2, filterFreq = 1800, filterQ = 1.3, delay = 0 } = opts;
      const t0 = c.currentTime + delay;
      const size = Math.max(1, Math.floor(c.sampleRate * duration));
      const buffer = c.createBuffer(1, size, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
      const src = c.createBufferSource();
      src.buffer = buffer;
      const f = c.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = filterFreq; f.Q.value = filterQ;
      const g = c.createGain();
      envelope(g, t0, { duration, peak: volume, attack: 0.002, decay: duration * 0.4, sustain: 0.2, release: duration * 0.4 });
      src.connect(f).connect(g).connect(master);
      src.start(t0);
      src.stop(t0 + duration + 0.03);
    }
    // The tactile building block: a soft physical "click" (filtered-noise
    // transient) plus a short, quiet round tone underneath (the "body").
    function aqClick(opts) {
      const { clickFreq = 1900, bodyFreq = 550, clickDuration = 0.028, bodyDuration = null, volume = 0.2, delay = 0 } = opts || {};
      noiseBurst({ duration: clickDuration, volume: volume * 0.85, filterFreq: clickFreq, filterQ: 1.5, delay });
      tone({ freq: bodyFreq, type: 'sine', duration: bodyDuration || clickDuration * 2.6, volume: volume * 0.55, delay, filterFreq: 3200, attack: 0.003 });
    }
    function arpeggio(freqs, opts) {
      const { type = 'triangle', noteDur = 0.14, gap = 0.1, volume = 0.24, delay = 0, filterFreq = 3800 } = opts || {};
      freqs.forEach((f, i) => tone({ freq: f, type, duration: noteDur, volume, delay: delay + i * gap, filterFreq }));
    }
    const N = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88,
                C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, C6: 1046.5, D6: 1174.66, E6: 1318.51 };

    const RECIPES = {
      'start-game': () => { aqClick({ clickFreq: 2000, bodyFreq: 500, clickDuration: 0.02, volume: 0.16 }); arpeggio([N.C5, N.E5, N.G5], { noteDur: 0.13, gap: 0.09, volume: 0.22, delay: 0.02 }); },
      'back': () => { aqClick({ clickFreq: 1800, bodyFreq: 480, clickDuration: 0.02, volume: 0.15 }); tone({ freq: N.E5, freqEnd: N.C5, duration: 0.14, volume: 0.14, delay: 0.01 }); },
      'difficulty-easy': () => { aqClick({ clickFreq: 2100, bodyFreq: 520, clickDuration: 0.02, volume: 0.15 }); arpeggio([N.C5, N.E5], { noteDur: 0.15, gap: 0.1, volume: 0.22, delay: 0.02 }); },
      'difficulty-medium': () => { aqClick({ clickFreq: 2000, bodyFreq: 460, clickDuration: 0.022, volume: 0.16 }); arpeggio([N.A4, N.C5, N.E5], { noteDur: 0.13, gap: 0.09, volume: 0.22, delay: 0.02 }); },
      'difficulty-hard': () => { aqClick({ clickFreq: 1700, bodyFreq: 300, clickDuration: 0.026, volume: 0.2 }); tone({ freq: 165, duration: 0.32, volume: 0.16, delay: 0.01, filterFreq: 900 }); arpeggio([N.E4, N.G4, N.C5], { noteDur: 0.13, gap: 0.09, volume: 0.22, delay: 0.06 }); },
      'difficulty-locked': () => { aqClick({ clickFreq: 1200, bodyFreq: 340, clickDuration: 0.022, volume: 0.16 }); aqClick({ clickFreq: 1000, bodyFreq: 260, clickDuration: 0.022, volume: 0.14, delay: 0.1 }); },
      'letter-pick': () => aqClick({ clickFreq: 2600, bodyFreq: 1000, clickDuration: 0.016, bodyDuration: 0.05, volume: 0.17 }),
      'tile-click': () => aqClick({ clickFreq: 2200, bodyFreq: 820, clickDuration: 0.018, bodyDuration: 0.06, volume: 0.18 }),
      'backspace': () => aqClick({ clickFreq: 1700, bodyFreq: 420, clickDuration: 0.024, bodyDuration: 0.08, volume: 0.17 }),
      'countdown-tick': () => aqClick({ clickFreq: 2400, bodyFreq: 780, clickDuration: 0.014, bodyDuration: 0.04, volume: 0.16 }),
      'countdown-go': () => { aqClick({ clickFreq: 2000, bodyFreq: 500, clickDuration: 0.02, volume: 0.17 }); arpeggio([N.G4, N.C5], { noteDur: 0.15, gap: 0.1, volume: 0.24, delay: 0.02 }); },
      'round-start': () => tone({ freq: N.A4, freqEnd: N.E5, duration: 0.28, volume: 0.2 }),
      'final-round-start': () => { tone({ freq: 175, duration: 0.5, volume: 0.16, filterFreq: 900 }); arpeggio([N.C4, N.E4, N.G4, N.C5, N.E5], { noteDur: 0.11, gap: 0.075, volume: 0.24, delay: 0.05 }); },
      'word-submit': () => aqClick({ clickFreq: 1600, bodyFreq: 440, clickDuration: 0.026, bodyDuration: 0.13, volume: 0.2 }),
      'word-valid': () => arpeggio([N.C5, N.E5, N.G5], { noteDur: 0.16, gap: 0.11, volume: 0.24 }),
      'word-invalid': () => { tone({ freq: N.A4, duration: 0.18, volume: 0.16 }); tone({ freq: N.F4, duration: 0.24, volume: 0.16, delay: 0.14 }); },
      'final-round-fail': () => { tone({ freq: N.G4, duration: 0.2, volume: 0.17 }); tone({ freq: N.D4, duration: 0.32, volume: 0.16, delay: 0.16 }); },
      'game-over': () => arpeggio([N.G4, N.E4, N.C4], { noteDur: 0.2, gap: 0.14, volume: 0.22 }),
      'timer-tick': () => aqClick({ clickFreq: 2000, bodyFreq: 900, clickDuration: 0.012, bodyDuration: 0.02, volume: 0.11 }),
      'timer-warning': () => { tone({ freq: N.E5, type: 'triangle', duration: 0.12, volume: 0.2 }); tone({ freq: N.E5, type: 'triangle', duration: 0.12, volume: 0.2, delay: 0.17 }); },
      'xp-gain': () => { arpeggio([N.C5, N.D5, N.E5, N.G5, N.A5, N.C6], { noteDur: 0.075, gap: 0.052, volume: 0.19 }); tone({ freq: N.C6, duration: 0.3, volume: 0.1, delay: 0.26 }); },
      'xp-bar-fill': () => { tone({ freq: N.A4, freqEnd: N.A5, duration: 0.3, volume: 0.18 }); tone({ freq: N.C6, type: 'triangle', duration: 0.3, volume: 0.16, delay: 0.26 }); },
      'nine-letter-success': () => { arpeggio([N.C5, N.E5, N.G5, N.C6], { noteDur: 0.12, gap: 0.085, volume: 0.24 }); arpeggio([N.E6, N.C6, N.G5], { type: 'sine', noteDur: 0.09, gap: 0.06, volume: 0.13, delay: 0.42 }); },
    };

    return {
      play(name) {
        const recipe = RECIPES[name];
        if (recipe) recipe();
      },
      setVolume,
      getVolume() { return currentVolume; }
    };
  })();

  // ---- sound hooks — Anagram Quest's own synthesized sounds only (see
  // AQSound above); NOT the site-wide QZSound module referenced by
  // docs/AUDIO_PLAN.md's global/ sounds, which stays unimplemented on
  // purpose until other games need it too. ----
  function playSound(name) {
    AQSound.play(name);
  }

  // ---- lobby/difficulty-select background music ----
  // A real recorded track (assets/audio/games/anagram-quest/music/
  // lobby-loop.wav, user-supplied), NOT synthesized like AQSound above —
  // plays only on the Lobby and Choose Your Difficulty screens, 3s fade
  // in whenever it starts and 3s fade out the moment either screen is
  // left (see the showScreen() hook below). Nowhere else in the game has
  // music, on purpose. Volume is driven live by the Music popover slider
  // (see wireAudioControls()).
  const AQMusic = (function () {
    const el = document.getElementById('aq-lobby-music');
    const NOOP = { ensurePlaying() {}, fadeOutAndStop() {}, setVolumePct() {} };
    if (!el) return NOOP; // markup not present — never let a missing <audio> tag break the game
    const FADE_MS = 5000; // 5s fade in/out, per explicit request — "so it feels nice", not a harsh jump straight to full volume

    let targetVolume = (function () {
      try {
        const saved = localStorage.getItem('aq-music-volume');
        if (saved !== null) return Math.max(0, Math.min(100, parseInt(saved, 10))) / 100;
      } catch (e) {}
      return 0.7;
    })();
    let fadeTimer = null;
    let wantsPlaying = false; // true while the current screen is LOBBY/DIFFICULTY, independent of whether playback has actually managed to start yet (autoplay policy)
    let unlockBound = false;

    function clearFade() { if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null; } }

    // setInterval, deliberately NOT requestAnimationFrame — rAF is fully
    // suspended while its tab/window isn't the visible, focused one, which
    // would silently freeze a fade mid-ramp (e.g. the player alt-tabs away
    // right as it starts) and then jump straight to the target volume the
    // instant they come back, which is exactly the "harsh, no fade" feeling
    // this exists to avoid. setInterval keeps ticking (throttled, not
    // stopped) in a backgrounded tab, so the ramp still completes close to
    // on schedule either way.
    function fadeTo(target, ms, onDone) {
      clearFade();
      const start = el.volume;
      const startTime = performance.now();
      if (ms <= 0 || start === target) {
        el.volume = target;
        if (onDone) onDone();
        return;
      }
      fadeTimer = setInterval(() => {
        const t = Math.min(1, (performance.now() - startTime) / ms);
        el.volume = start + (target - start) * t;
        if (t >= 1) { clearFade(); if (onDone) onDone(); }
      }, 40);
    }

    function bindUnlockOnce() {
      if (unlockBound) return;
      unlockBound = true;
      const retry = () => {
        document.removeEventListener('pointerdown', retry);
        document.removeEventListener('keydown', retry);
        unlockBound = false;
        if (wantsPlaying) ensurePlaying();
      };
      // Browsers block audio autoplay until the very first user gesture
      // anywhere on the page — this fires that retry the instant one
      // happens, so the very first click/keypress (even one unrelated to
      // Anagram Quest, e.g. dismissing something else) starts the music
      // rather than leaving it permanently silent for that visit.
      document.addEventListener('pointerdown', retry, { once: true });
      document.addEventListener('keydown', retry, { once: true });
    }

    function ensurePlaying() {
      wantsPlaying = true;
      if (!el.paused) { fadeTo(targetVolume, FADE_MS); return; }
      loopFadeStarted = false;
      el.volume = 0;
      let playResult;
      try { playResult = el.play(); } catch (e) { bindUnlockOnce(); return; }
      if (playResult && playResult.then) {
        playResult.then(() => fadeTo(targetVolume, FADE_MS)).catch(() => bindUnlockOnce());
      } else {
        fadeTo(targetVolume, FADE_MS);
      }
    }

    function fadeOutAndStop() {
      wantsPlaying = false;
      if (el.paused) return;
      fadeTo(0, FADE_MS, () => { if (!wantsPlaying) el.pause(); });
    }

    function setVolumePct(pct) {
      targetVolume = Math.max(0, Math.min(100, pct)) / 100;
      // A manual slider drag should feel immediate, not fade — fading is
      // only for the screen-transition start/stop moments above.
      if (!el.paused) { clearFade(); el.volume = targetVolume; }
    }

    // ---- looping, but breathing rather than a hard cut ----
    // The <audio> tag deliberately has NO "loop" attribute (that would
    // jump straight back to 0 with a click/discontinuity and never fire
    // 'ended' at all). Instead: once within one fade-length of the
    // track's own end, fade out to silence right as it finishes: then on
    // 'ended', jump back to the start and fade back in — so every repeat
    // feels like a deliberate stop/start, not a seam.
    let loopFadeStarted = false;
    el.addEventListener('timeupdate', () => {
      if (!wantsPlaying || el.paused || !isFinite(el.duration) || loopFadeStarted) return;
      const remainingMs = (el.duration - el.currentTime) * 1000;
      if (remainingMs <= FADE_MS) {
        loopFadeStarted = true;
        fadeTo(0, Math.max(0, remainingMs));
      }
    });
    el.addEventListener('ended', () => {
      loopFadeStarted = false;
      if (!wantsPlaying) return;
      el.currentTime = 0;
      el.volume = 0;
      const p = el.play();
      if (p && p.then) p.then(() => fadeTo(targetVolume, FADE_MS)).catch(() => bindUnlockOnce());
      else fadeTo(targetVolume, FADE_MS);
    });

    return { ensurePlaying, fadeOutAndStop, setVolumePct };
  })();

  // ---- Music/Sound preference storage — localStorage (instant, works
  // signed out) + Supabase account sync (signed in only) ----
  // A guest's setting lives only in this browser's localStorage. A
  // signed-in player's setting is ALSO synced to
  // public.user_audio_settings (see supabase/migrations/
  // 20260909010000_user_audio_settings.sql), keyed by (user, game) so it
  // follows them to another device/browser and stays independent per
  // game. localStorage is still written for a signed-in player too —
  // it's what applies instantly on this page load, before the account
  // fetch below has had time to resolve.
  const AUDIO_GAME_SLUG = 'anagram-quest'; // this game's own slug — deliberately NOT GAME_KEY ('intelligence', a skill key), since a future game could share that skill but must never share its volume setting
  const AQAudioPrefs = (function () {
    function loadLocalPct(key, fallback) {
      try {
        const saved = localStorage.getItem(key);
        if (saved !== null) return Math.max(0, Math.min(100, parseInt(saved, 10)));
      } catch (e) {}
      return fallback;
    }
    function saveLocalPct(key, pct) {
      try { localStorage.setItem(key, String(pct)); } catch (e) {}
    }

    let sfxPct = loadLocalPct('aq-sfx-volume', 60);
    let musicPct = loadLocalPct('aq-music-volume', 70);
    AQSound.setVolume(sfxPct / 100); // applied immediately so the very first sound respects it, same as before this refactor

    let saveTimer = null;
    function debouncedAccountSave() {
      if (!window.QZAuth || !window.QZAuth.client || !state.profile) return;
      clearTimeout(saveTimer);
      // A slider fires many 'input' events per drag — debounce the network
      // write so dragging doesn't spam upserts, without delaying the
      // instant local apply/localStorage save above.
      saveTimer = setTimeout(() => {
        window.QZAuth.client
          .from('user_audio_settings')
          .upsert({ user_id: state.profile.id, game_key: AUDIO_GAME_SLUG, music_volume: musicPct, sfx_volume: sfxPct, updated_at: new Date().toISOString() }, { onConflict: 'user_id,game_key' })
          .then(({ error }) => { if (error) console.warn('Anagram Quest: could not save audio settings', error); });
      }, 500);
    }

    function setSfxPct(pct) {
      sfxPct = Math.max(0, Math.min(100, pct));
      AQSound.setVolume(sfxPct / 100);
      saveLocalPct('aq-sfx-volume', sfxPct);
      debouncedAccountSave();
    }
    function setMusicPct(pct) {
      musicPct = Math.max(0, Math.min(100, pct));
      AQMusic.setVolumePct(musicPct);
      saveLocalPct('aq-music-volume', musicPct);
      debouncedAccountSave();
    }

    // Called once from loadAccountData() as soon as a profile is known —
    // pulls this player's saved row (if any) and lets it override
    // whatever localStorage/defaults already applied on this page load.
    // If the player has never saved a setting for this game before (a
    // first-time sign-in, or a brand new game), their current local
    // values are written up as that row's starting point instead of
    // silently leaving the account with no row at all.
    async function loadFromAccount(client, userId) {
      if (!client || !userId) return;
      try {
        const { data, error } = await client
          .from('user_audio_settings').select('music_volume,sfx_volume')
          .eq('user_id', userId).eq('game_key', AUDIO_GAME_SLUG).maybeSingle();
        if (error) { console.warn('Anagram Quest: could not load audio settings', error); return; }
        if (data) {
          if (typeof data.sfx_volume === 'number') { sfxPct = data.sfx_volume; AQSound.setVolume(sfxPct / 100); saveLocalPct('aq-sfx-volume', sfxPct); }
          if (typeof data.music_volume === 'number') { musicPct = data.music_volume; AQMusic.setVolumePct(musicPct); saveLocalPct('aq-music-volume', musicPct); }
        } else {
          await client.from('user_audio_settings')
            .upsert({ user_id: userId, game_key: AUDIO_GAME_SLUG, music_volume: musicPct, sfx_volume: sfxPct }, { onConflict: 'user_id,game_key' });
        }
      } catch (err) {
        console.warn('Anagram Quest: could not load audio settings', err);
      }
    }

    return {
      getSfxPct: () => sfxPct,
      getMusicPct: () => musicPct,
      setSfxPct,
      setMusicPct,
      loadFromAccount
    };
  })();

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

  // ================= first names (Rounds 1-4 only) =================
  // A SEPARATE set from dictSet, on purpose — see isValidAnagramQuestWord()
  // below and scripts/build-anagram-names.pl/SOURCES.md for how it's built.
  // Rounds 1-4 accept dictSet OR nameSet; Round 5 (the bonus 9-letter round)
  // accepts dictSet only — nameSet is never even consulted there, so a
  // 9-letter first name can never surface as a Round 5 answer no matter
  // what's in this file.
  let nameSet = null;
  let nameLoading = null;
  function loadFirstNames() {
    if (nameLoading) return nameLoading;
    nameLoading = fetch('data/first-names.txt')
      .then((r) => r.text())
      .then((text) => {
        nameSet = new Set(text.split(/\r?\n/).map((w) => w.trim()).filter(Boolean));
      })
      .catch((err) => {
        console.error('Anagram Quest: failed to load first-names list', err);
        nameSet = new Set();
      });
    return nameLoading;
  }
  function isValidFirstName(word) {
    if (!nameSet) return false;
    if (typeof word !== 'string') return false;
    if (!/^[A-Za-z]+$/.test(word)) return false;
    return nameSet.has(word.toLowerCase());
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
  //
  // allowNames gates the separate first-name set (see isValidFirstName()
  // above) — the ONLY caller that ever passes true is judgeAndEndRound()'s
  // non-bonus (Rounds 1-4) branch. Round 5 (isBonusRound()) always passes
  // false, so a first name can never score there no matter what's in
  // first-names.txt — this parameter is the entire enforcement of that
  // rule, in one place, rather than scattered round checks.
  function isValidAnagramQuestWord(word, allowNames) {
    return isValidEnglishWord(word) ||
      (window.QZAnagramGeo && (window.QZAnagramGeo.isCountryName(word) || window.QZAnagramGeo.isCityName(word))) ||
      (allowNames === true && isValidFirstName(word));
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
    // Every achievement unlocked since selectDifficulty() started THIS
    // game (see the document-level 'qz-achievement-unlocked' listener
    // near the bottom of this file) — collected silently through every
    // round, then shown as a batch of banners on the Game Over screen
    // only (see showUnlockedAchievementsOnGameOver()), never mid-round.
    unlockedThisGame: [],
    trackingAchievementUnlocks: false,
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
    // Lobby music: playing (fading in) on Lobby/Choose Your Difficulty
    // only, faded out and stopped everywhere else — see AQMusic above.
    // This one hook covers every path in/out of those two screens (Start
    // Game, Back, and Game Over's Back to Lobby all just call
    // showScreen() already), so nothing else needs to know about music.
    if (key === 'LOBBY' || key === 'DIFFICULTY') AQMusic.ensurePlaying();
    else AQMusic.fadeOutAndStop();
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
      AQAudioPrefs.loadFromAccount(client, profile.id); // not awaited — applies live volume as soon as it resolves, doesn't block anything else here
      const { data: statsRow } = await client
        .from('game_stats').select('high_score,games_played')
        .eq('user_id', profile.id).eq('game_key', GAME_KEY).maybeSingle();
      state.highScore = (statsRow && statsRow.high_score) || 0;
      state.gamesPlayed = (statsRow && statsRow.games_played) || 0;
      await loadDifficultyStats();
      await loadIntelligenceLevel();
      // Catches this account up on any achievement it already qualifies
      // for by real, already-recorded stats (level, games played, high
      // score, ...) the moment the lobby loads — not awaited, since
      // nothing on this screen depends on it finishing; it just needs to
      // run. Covers "reached Level 25 before this achievement existed" /
      // "played 10+ games already" without needing a fresh game first.
      if (window.QZAchievements) window.QZAchievements.checkStatAchievements();
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
    const seconds = state.difficultyConfig.selectSeconds;
    state.selSecondsTotal = seconds;
    state.selDeadline = Date.now() + seconds * 1000;
    updateSelTimerUi(seconds);
    clearInterval(state.selTimerId);
    state.selTimerId = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((state.selDeadline - Date.now()) / 1000));
      updateSelTimerUi(remaining);
      if (remaining <= 0) { onSelTimerExpired(); }
    }, 250);
  }
  function updateSelTimerUi(remaining) {
    const total = state.selSecondsTotal || 1;
    const pct = Math.max(0, (remaining / total) * 100);
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
    state.lastTickSecond = null; // last second a 'timer-tick' played for — only ticks once per second, and only after the warning fires
    updateTimerUi();
    clearInterval(state.timerId);
    state.timerId = setInterval(() => {
      state.timeRemaining = Math.max(0, Math.ceil((state.roundDeadline - Date.now()) / 1000));
      updateTimerUi();
      const warnAt = Math.min(10, state.roundSecondsTotal);
      if (state.timeRemaining <= warnAt && state.timeRemaining > 0 && !state.warnedThisRound) { state.warnedThisRound = true; playSound('timer-warning'); }
      if (state.warnedThisRound && state.timeRemaining > 0 && state.timeRemaining !== state.lastTickSecond) {
        state.lastTickSecond = state.timeRemaining;
        playSound('timer-tick');
      }
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
      playSound('final-round-start');
    } else {
      activeRoundLabel.textContent = 'Round ' + state.currentRound + ' of 5';
      activeRoundSub.textContent = 'Build the longest word you can — English words + real cities/countries.';
      activeLockInBtn.classList.remove('hidden');
      playSound('round-start');
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
      // Round 5 — allowNames is never passed (defaults to falsy), so
      // first-names.txt is never consulted here regardless of length.
      const rackSorted = state.rack.map((t) => t.letter).sort().join('');
      const correct = word.length === RACK_SIZE &&
        isValidAnagramQuestWord(word) &&
        word.toUpperCase().split('').sort().join('') === rackSorted;
      points = correct ? ROUND5_POINTS : 0;
    } else {
      // Rounds 1-4 — allowNames=true lets a recognised first name count.
      const realWord = word.length >= MIN_WORD_LEN && isValidAnagramQuestWord(word, true);
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

    // ---- outcome sound: a 9-letter solve always gets the bigger
    // celebration regardless of round, otherwise a plain valid/invalid
    // cue — except Round 5's own "ran out of time with nothing correct"
    // case, which gets its own gentler failure sound instead of the
    // ordinary invalid-word one. ----
    if (valid && word.length === 9) playSound('nine-letter-success');
    else if (bonus && !valid) playSound('final-round-fail');
    else playSound(valid ? 'word-valid' : 'word-invalid');

    // ---- achievement unlocks (see assets/js/qz-achievements.js) — every
    // call is unconditional and idempotent server-side, so no "have I
    // already got this" bookkeeping is needed here, just "did this exact
    // condition just happen". ----
    if (window.QZAchievements) {
      if (valid) window.QZAchievements.unlock('anagram_first_word');
      if (valid && word.length === 7) window.QZAchievements.unlock('anagram_first_7');
      if (valid && word.length === 8) window.QZAchievements.unlock('anagram_first_8');
      if (valid && word.length === 9) window.QZAchievements.unlock('anagram_first_9');
      if (bonus && valid) window.QZAchievements.unlock('anagram_first_final');
    }

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
    playSound('word-submit');
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

  // One spark-burst + banner per level actually crossed (see
  // runLevelProgression() below, which can call this several times in a
  // row for a multi-level game) — any still-showing instance is removed
  // first rather than skipping the call, so back-to-back level-ups each
  // get their own clean flash instead of the 2nd/3rd+ silently vanishing.
  function playLevelUpBurst(newLevel) {
    if (!goSkillBox) return;
    const oldBurst = goSkillBox.querySelector('.qz-levelup-burst');
    const oldBanner = goSkillBox.querySelector('.qz-levelup-banner');
    if (oldBurst) oldBurst.remove();
    if (oldBanner) oldBanner.remove();
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
    playSound('xp-gain');

    requestAnimationFrame(() => label.classList.add('sliding'));

    setTimeout(() => {
      label.remove();

      // gold pulse, then the bar begins its progression animation — see
      // runLevelProgression() for what happens next; this is the ONLY
      // place XP_SLIDE_MS's "wait for the drop to finish" rule is enforced.
      barEl.classList.add('qz-bar-pulse');
      setTimeout(() => barEl.classList.remove('qz-bar-pulse'), 520);

      setTimeout(() => {
        playSound('xp-bar-fill');
        runLevelProgression(goSkillPre.xp, newSkill.xp, fillEl, levelEl);
      }, 450); // let the pulse read on its own before the bar starts moving
    }, XP_SLIDE_MS);
  }

  // pct (0-100) of the way through `level`'s own span that `xp` sits at —
  // the ONE formula every segment below uses, so a level's span is always
  // computed the exact same way regardless of which segment it's for.
  function pctWithinLevel(xp, level) {
    const curFloor = window.QZXp.xpForLevel(level);
    const nextFloor = window.QZXp.xpForLevel(level + 1);
    const span = nextFloor - curFloor;
    return span > 0 ? Math.max(0, Math.min(100, ((xp - curFloor) / span) * 100)) : 100;
  }
  function setLevelLabel(levelEl, virtualLevel) {
    const base = Math.min(99, virtualLevel);
    const levelLabel = virtualLevel > 99
      ? base + ' <span class="qz-skillcard-full-of99">(Virtual ' + virtualLevel + ')</span>'
      : base + '<span class="qz-skillcard-full-of99">/99</span>';
    levelEl.innerHTML = 'LEVEL ' + levelLabel;
  }
  // Sets the fill bar's width, transitioning over `ms` (0 = instant, no
  // transition at all — used for the post-level-up reset, which must
  // never itself look like an animated backward move). Forces a reflow
  // before applying a new width so an instant reset immediately followed
  // by another animated fill (the very next segment) doesn't get
  // coalesced into one janky transition by the browser.
  function setBarWidth(fillEl, pct, ms, onDone) {
    fillEl.style.transition = ms > 0 ? ('width ' + (ms / 1000) + 's cubic-bezier(.2,.8,.2,1)') : 'none';
    void fillEl.offsetWidth; // force reflow — see comment above
    fillEl.style.width = pct + '%';
    if (onDone) { if (ms > 0) setTimeout(onDone, ms + 30); else onDone(); }
  }

  // The actual fix for "the bar looks like it's losing XP on a level-up":
  // uses the player's REAL start/end XP and QZXp's own level-threshold
  // formula (never a fabricated/percentage-only level-up) to work out
  // exactly which level boundaries this reward crosses, then animates
  // each one in turn — fill to 100%, pause, level-up feedback, instant
  // reset to 0%, repeat — ending on the exact final percentage. No level
  // boundary crossed at all just animates smoothly from the old
  // percentage to the new one, same as before this existed. Only ever
  // touches the bar's WIDTH/the level LABEL's text — never re-derives or
  // rewrites the underlying XP/level values themselves, which came
  // straight from award_xp()'s own server response before this ever runs.
  function runLevelProgression(startXp, endXp, fillEl, levelEl) {
    const startLevel = window.QZXp.levelForXp(startXp);
    const endLevel = window.QZXp.levelForXp(endXp);
    const startPct = pctWithinLevel(startXp, startLevel);
    const endPct = pctWithinLevel(endXp, endLevel);

    if (endLevel <= startLevel) {
      // no level crossed — the original single smooth-fill behaviour
      setBarWidth(fillEl, endPct, 1100);
      return;
    }

    const FILL_MS = 700;    // per-segment fill — quicker than the old single 1.1s animation since a multi-level game plays several of these back to back
    const PAUSE_MS = 220;   // brief pause once a segment hits 100%, before the level-up feedback plays
    const FEEDBACK_MS = 900; // matches the spark-burst/banner's own CSS animation length (see playLevelUpBurst) — removed exactly as they finish, not cut off mid-fade

    let level = startLevel;
    function nextSegment(isFirst) {
      const isLast = level === endLevel;
      const toPct = isLast ? endPct : 100;
      const ms = isFirst ? (startPct === toPct ? 0 : FILL_MS) : (isLast && toPct === 0 ? 0 : FILL_MS);
      setBarWidth(fillEl, toPct, ms, () => {
        if (isLast) return; // reached the true final percentage — stop, no further reset/bump
        setTimeout(() => {
          level += 1;
          playSound('level-up'); // no-op if that sound doesn't exist yet — see docs/AUDIO_PLAN.md
          playLevelUpBurst(Math.min(99, level));
          setLevelLabel(levelEl, level);
          setTimeout(() => {
            setBarWidth(fillEl, 0, 0); // instant — a reset is not a "move", so it must never be animated
            nextSegment(false);
          }, FEEDBACK_MS);
        }, PAUSE_MS);
      });
    }
    nextSegment(true);
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

    // ---- achievement unlocks ----
    // One explicit event id (first-game-completed has no stored stat to
    // check, so it's a plain trust-the-caller unlock — see
    // unlock_achievement()) PLUS a full re-check of every stat-based
    // achievement that exists (games played, high score, Intelligence
    // level, total level, ...) against this account's now-just-updated
    // real stats. That second part is deliberately generic rather than a
    // hand-picked id list: it's what makes "reached Level 25 mid-game"
    // or any future stat achievement unlock automatically, the moment
    // its real threshold is actually crossed, with nothing here needing
    // to know which achievements exist. Awaited (not fire-and-forget)
    // specifically so state.unlockedThisGame is fully populated before
    // the Game Over banner below reads it.
    if (window.QZAchievements) {
      await Promise.all([
        window.QZAchievements.unlock('anagram_first_game'),
        window.QZAchievements.checkStatAchievements()
      ]);
    }

    // ---- "Achievement Unlocked" banner — Game Over screen ONLY ----
    // state.unlockedThisGame was populated by the 'qz-achievement-
    // unlocked' listener (see near the top of this file) picking up
    // every unlock that actually happened since this game started
    // (selectDifficulty() below resets the list and starts tracking) —
    // covers both the per-round event unlocks (7/8/9-letter words, the
    // Final Round) AND the stat re-check just above, in one place,
    // deliberately never shown mid-round so it can't distract from
    // actual play.
    await showUnlockedAchievementsOnGameOver();
  }

  // Fetches display info (name/icon/tier) for whatever actually unlocked
  // this game and renders one small banner per achievement at the top of
  // the Game Over panel. Silently does nothing if nothing unlocked, or if
  // the achievements catalog can't be reached — this is a nice-to-have
  // celebration, never something that should be able to break Game Over.
  async function showUnlockedAchievementsOnGameOver() {
    const container = document.getElementById('go-achievement-banners');
    if (container) container.innerHTML = '';
    const ids = Array.from(new Set(
      state.unlockedThisGame.filter((u) => u && u.newlyUnlocked).map((u) => u.achievementId)
    ));
    state.trackingAchievementUnlocks = false; // stop collecting until the next game starts
    if (ids.length === 0 || !container || !window.QZAuth || !window.QZAuth.client) return;
    try {
      const { data, error } = await window.QZAuth.client
        .from('achievements')
        .select('achievement_id,name,icon,tier')
        .in('achievement_id', ids);
      if (error || !data || !data.length) return;
      data.forEach((a, i) => {
        const el = document.createElement('div');
        el.className = 'aq-achieve-banner';
        el.style.animationDelay = (i * 0.15) + 's';
        el.innerHTML =
          '<span class="aq-achieve-icon">' + (a.icon || '🏆') + '</span>' +
          '<div class="aq-achieve-text">' +
            '<span class="aq-achieve-label">Achievement Unlocked</span>' +
            '<span class="aq-achieve-name">' + escapeAqText(a.name) + '</span>' +
            '<span class="aq-achieve-tier">' + escapeAqText(a.tier || '') + '</span>' +
          '</div>';
        container.appendChild(el);
      });
      playSound('nine-letter-success'); // reuse the existing big celebratory cue — no dedicated achievement sound exists yet
    } catch (err) {
      console.warn('Anagram Quest: could not show unlocked achievements', err);
    }
  }
  function escapeAqText(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  document.getElementById('btn-back-lobby').addEventListener('click', () => {
    playSound('back');
    showScreen('LOBBY');
    updateFooterStats();
  });

  // ================= difficulty select + intro/countdown =================
  function selectDifficulty(key) {
    if (state.intelligenceLevel < DIFFICULTIES[key].unlockLevel) { playSound('difficulty-locked'); return; } // belt-and-suspenders — the button is already disabled/greyed for this
    playSound('difficulty-' + key.toLowerCase());
    state.difficulty = key;
    state.difficultyConfig = DIFFICULTIES[key];
    state.totalScore = 0;
    state.roundScores = [0, 0, 0, 0, 0];
    state.nineLetterCount = 0;
    state.unlockedThisGame = [];
    state.trackingAchievementUnlocks = true; // see the 'qz-achievement-unlocked' listener below — starts collecting fresh for this game only
    updateDifficultyChips();
    playIntro();
  }
  document.getElementById('btn-diff-easy').addEventListener('click', () => selectDifficulty('EASY'));
  document.getElementById('btn-diff-medium').addEventListener('click', () => selectDifficulty('MEDIUM'));
  document.getElementById('btn-diff-hard').addEventListener('click', () => selectDifficulty('HARD'));
  document.getElementById('btn-diff-back').addEventListener('click', () => { playSound('back'); showScreen('LOBBY'); });

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
      playSound('countdown-tick');
      state.introIntervalId = setInterval(() => {
        n -= 1;
        if (n > 0) {
          introCountdown.textContent = n;
          playSound('countdown-tick');
        } else if (n === 0) {
          introCountdown.textContent = 'GO!';
          playSound('countdown-go');
        } else {
          clearInterval(state.introIntervalId);
          startLetterSelection(1);
        }
      }, 700);
    }, 900);
  }

  // ================= lobby wiring =================
  document.getElementById('btn-start-game').addEventListener('click', async () => {
    playSound('start-game');
    await Promise.all([loadDictionary(), loadFirstNames()]);
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

  // ================= Music / Sound volume controls =================
  // Two icon buttons — Music and Sound — that live in TWO places in the
  // markup: the lobby's own icon row (.lobby-hero-right, alongside
  // Settings/Achievements) and .aq-global-audio-controls (a fixed
  // top-right pair shown on every OTHER screen, hidden on the lobby
  // since it has its own copy — see the CSS). Both sets of buttons share
  // ONE popover element (#aq-audio-popover) rather than duplicating
  // slider markup per screen; this just repositions/relabels it.
  //
  // Sound controls AQSound's real master volume (0-1) and takes effect
  // immediately on every sound already wired in this file. Music controls
  // AQMusic's real master volume the same way (see AQMusic above — the
  // Lobby/Choose Your Difficulty background track). Both settings are
  // owned by AQAudioPrefs (also above), which mirrors them to
  // localStorage instantly and, for a signed-in player, to
  // public.user_audio_settings so they follow the account across
  // devices/browsers, independently per game.
  function wireAudioControls() {
    const popover = document.getElementById('aq-audio-popover');
    if (!popover) return; // markup not present (shouldn't happen, but never throw over a UI nicety)
    const titleEl = document.getElementById('aq-audio-popover-title');
    const sliderEl = document.getElementById('aq-audio-popover-slider');
    const valueEl = document.getElementById('aq-audio-popover-value');
    const noteEl = document.getElementById('aq-audio-popover-note');
    const buttons = Array.from(document.querySelectorAll('[data-audio-popover]'));

    let openKind = null; // 'music' | 'sound' | null
    let openBtn = null;

    function closePopover() {
      popover.classList.remove('show');
      popover.setAttribute('aria-hidden', 'true');
      buttons.forEach((b) => b.setAttribute('aria-expanded', 'false'));
      openKind = null;
      openBtn = null;
    }

    function openPopover(kind, btn) {
      const isMusic = kind === 'music';
      titleEl.textContent = isMusic ? 'MUSIC' : 'SOUND';
      const pct = isMusic ? AQAudioPrefs.getMusicPct() : AQAudioPrefs.getSfxPct();
      sliderEl.value = pct;
      valueEl.textContent = pct;
      noteEl.textContent = isMusic
        ? 'Lobby/difficulty-select background music.'
        : 'Controls letter clicks, buttons, and every other in-game sound effect.';

      const rect = btn.getBoundingClientRect();
      popover.style.top = (rect.bottom + 8) + 'px';
      popover.style.right = (window.innerWidth - rect.right) + 'px';
      popover.style.left = 'auto';

      popover.classList.add('show');
      popover.setAttribute('aria-hidden', 'false');
      buttons.forEach((b) => b.setAttribute('aria-expanded', String(b === btn)));
      openKind = kind;
      openBtn = btn;
    }
    buttons.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const kind = btn.getAttribute('data-audio-popover');
        if (openKind === kind && openBtn === btn) { closePopover(); return; }
        openPopover(kind, btn);
      });
    });

    sliderEl.addEventListener('input', () => {
      const pct = parseInt(sliderEl.value, 10) || 0;
      valueEl.textContent = pct;
      if (openKind === 'sound') {
        AQAudioPrefs.setSfxPct(pct);
      } else if (openKind === 'music') {
        AQAudioPrefs.setMusicPct(pct);
      }
    });

    document.addEventListener('click', (e) => {
      if (!openKind) return;
      if (popover.contains(e.target)) return;
      if (buttons.some((b) => b.contains(e.target))) return;
      closePopover();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && openKind) closePopover();
    });
  }

  // Collects every achievement unlocked while state.trackingAchievementUnlocks
  // is true (set/cleared by selectDifficulty()/showUnlockedAchievementsOnGameOver())
  // — bound once, for the page's whole lifetime, regardless of how many
  // games get played in a row. See qz-achievements.js for where this
  // event actually gets fired.
  document.addEventListener('qz-achievement-unlocked', (e) => {
    if (state.trackingAchievementUnlocks) state.unlockedThisGame.push(e.detail);
  });

  // ================= init =================
  loadAccountData();
  loadDictionary();
  loadFirstNames();
  wireAudioControls();
  // The lobby is the screen already visible in the raw HTML on page
  // load (no showScreen('LOBBY') call happens this early) — so the
  // showScreen() hook above never fires for this very first appearance.
  // Kick the lobby music off explicitly here to cover that one case.
  AQMusic.ensurePlaying();
})();
