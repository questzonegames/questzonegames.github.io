// ===== Pup N Away — audio manager =====
//
// Real supplied audio (Pup-N-Away/sounds/) is wired in below:
//   boing 1.wav    -> basketBounce (the basket-bounce "boing")
//   white.wav      -> boneCollected / finalBoneCollected (picking up a Dream Bone)
//   lobby music.wav -> lobby background music (title screen only)
//   powerup.wav    -> powerup (wired and ready, but there is no power-up
//                     pickup in the game yet — nothing calls it)
// Every other hook below still points at a documented-but-not-yet-
// supplied path; a missing file just means that sound silently doesn't
// play (logged once in dev mode), never a crash. Drop a real file at
// any of those paths and it starts working with no other code changes.
(function () {
  const SOUND_PATHS = {
    basketBounce: '../../assets/audio/pup-n-away/basket-bounce.wav',
    wallBounce: '../../assets/audio/pup-n-away/wall-bounce.mp3',
    boneCollected: '../../assets/audio/pup-n-away/bone-collected.wav',
    finalBoneCollected: '../../assets/audio/pup-n-away/bone-collected.wav',
    powerup: '../../assets/audio/pup-n-away/powerup.wav',
    lostLife: '../../assets/audio/pup-n-away/lost-life.mp3',
    levelComplete: '../../assets/audio/pup-n-away/level-complete.mp3',
    gameOver: '../../assets/audio/pup-n-away/game-over.mp3',
    buttonHover: '../../assets/audio/pup-n-away/button-hover.mp3',
    buttonClick: '../../assets/audio/pup-n-away/button-click.mp3',
    snoring: '../../assets/audio/pup-n-away/snoring.mp3',
    dreamTransition: '../../assets/audio/pup-n-away/dream-transition.mp3'
  };
  const MUSIC_PATHS = {
    background: '../../assets/audio/pup-n-away/music-background.mp3',
    lobby: '../../assets/audio/pup-n-away/music-lobby.wav'
  };

  function createAudioManager() {
    const cache = {};          // cloneable one-shot sounds (may overlap)
    const exclusiveCache = {}; // single-instance sounds that cut themselves off and restart
    const musicEls = {};       // named looping tracks (background, lobby)
    let musicVolume = 0.5;
    let sfxVolume = 0.7;
    let muted = false;
    let unlocked = false; // browser autoplay rules — audio only starts after a real user gesture

    function makeElement(path, name) {
      const el = new Audio(path);
      el.preload = 'auto';
      el.addEventListener('error', () => {
        if (window.PNA_DEV_MODE) console.warn('[Pup N Away] audio hook "' + name + '" has no file yet at ' + path + ' (this is expected until real audio is supplied)');
      }, { once: true });
      return el;
    }

    function getSound(name) {
      if (cache[name] !== undefined) return cache[name];
      const path = SOUND_PATHS[name];
      if (!path) { cache[name] = null; return null; }
      cache[name] = makeElement(path, name);
      return cache[name];
    }

    function getExclusiveSound(name) {
      if (exclusiveCache[name] !== undefined) return exclusiveCache[name];
      const path = SOUND_PATHS[name];
      if (!path) { exclusiveCache[name] = null; return null; }
      exclusiveCache[name] = makeElement(path, name);
      return exclusiveCache[name];
    }

    // play(name): fires a one-shot sound as a fresh clone each time, so
    // rapid separate triggers (e.g. two bones collected close together)
    // can overlap naturally.
    //
    // play(name, { restart: true }): plays through ONE persistent
    // element instead. If it's still playing when triggered again, the
    // sound is cut off and restarted from the top rather than layering
    // a second copy on top of the first — this is what keeps the
    // basket's "boing" a single clean hit even while being bounced off
    // rapid-fire in a corner (boing, boing, boing — never a stacked/
    // echoing mess).
    function play(name, opts) {
      if (muted || !unlocked) return;
      try {
        if (opts && opts.restart) {
          const el = getExclusiveSound(name);
          if (!el) return;
          el.volume = sfxVolume;
          el.currentTime = 0;
          el.play().catch(() => {});
          return;
        }
        const el = getSound(name);
        if (!el) return;
        const inst = el.cloneNode(true);
        inst.volume = sfxVolume;
        inst.play().catch(() => {});
      } catch (_) { /* missing/broken file — silently skip, never crash gameplay */ }
    }

    function unlockOnFirstGesture() {
      if (unlocked) return;
      unlocked = true;
    }

    function playMusic(name) {
      if (!unlocked) return;
      if (!musicEls[name]) {
        const path = MUSIC_PATHS[name];
        if (!path) return;
        const el = makeElement(path, name);
        el.loop = true;
        musicEls[name] = el;
      }
      const el = musicEls[name];
      el.volume = muted ? 0 : musicVolume;
      el.play().catch(() => {});
    }
    function stopMusicTrack(name) {
      const el = musicEls[name];
      if (el) el.pause();
    }

    // Gameplay background music (during PLAYING).
    function startMusic() { playMusic('background'); }
    function stopMusic() { stopMusicTrack('background'); }

    // Lobby music — the title screen only.
    function startLobbyMusic() { playMusic('lobby'); }
    function stopLobbyMusic() { stopMusicTrack('lobby'); }

    function setMusicVolume(v) {
      musicVolume = Math.max(0, Math.min(1, v));
      Object.values(musicEls).forEach((el) => { el.volume = muted ? 0 : musicVolume; });
    }
    function setSfxVolume(v) { sfxVolume = Math.max(0, Math.min(1, v)); }
    function setMuted(v) {
      muted = !!v;
      Object.values(musicEls).forEach((el) => { el.volume = muted ? 0 : musicVolume; });
    }
    function toggleMuted() { setMuted(!muted); return muted; }

    return {
      play, startMusic, stopMusic, startLobbyMusic, stopLobbyMusic,
      setMusicVolume, setSfxVolume, setMuted, toggleMuted,
      unlockOnFirstGesture,
      get muted() { return muted; },
      get unlocked() { return unlocked; },
      get musicVolume() { return musicVolume; },
      get sfxVolume() { return sfxVolume; }
    };
  }

  window.PNA_Audio = { createAudioManager, SOUND_PATHS, MUSIC_PATHS };
})();
