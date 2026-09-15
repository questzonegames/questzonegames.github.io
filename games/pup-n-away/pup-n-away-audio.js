// ===== Pup N Away — audio manager =====
//
// No audio assets were supplied anywhere in the asset folder. Per the
// brief ("do not download random copyrighted sounds... implement the
// audio manager and leave clearly named, documented asset paths ready
// for the future files"), every hook below is fully wired up and safe
// to call right now — a missing file just means that sound silently
// doesn't play (logged once in dev mode), never a crash. Drop a real
// file at any path in SOUND_PATHS/MUSIC_PATHS and it starts working
// with no other code changes.
(function () {
  const SOUND_PATHS = {
    basketBounce: '../../assets/audio/pup-n-away/basket-bounce.mp3',
    wallBounce: '../../assets/audio/pup-n-away/wall-bounce.mp3',
    boneCollected: '../../assets/audio/pup-n-away/bone-collected.mp3',
    finalBoneCollected: '../../assets/audio/pup-n-away/final-bone-collected.mp3',
    lostLife: '../../assets/audio/pup-n-away/lost-life.mp3',
    levelComplete: '../../assets/audio/pup-n-away/level-complete.mp3',
    gameOver: '../../assets/audio/pup-n-away/game-over.mp3',
    buttonHover: '../../assets/audio/pup-n-away/button-hover.mp3',
    buttonClick: '../../assets/audio/pup-n-away/button-click.mp3',
    snoring: '../../assets/audio/pup-n-away/snoring.mp3',
    dreamTransition: '../../assets/audio/pup-n-away/dream-transition.mp3'
  };
  const MUSIC_PATHS = {
    background: '../../assets/audio/pup-n-away/music-background.mp3'
  };

  function createAudioManager() {
    const cache = {};
    let musicEl = null;
    let musicVolume = 0.5;
    let sfxVolume = 0.7;
    let muted = false;
    let unlocked = false; // browser autoplay rules — audio only starts after a real user gesture

    function getSound(name) {
      if (cache[name] !== undefined) return cache[name];
      const path = SOUND_PATHS[name];
      if (!path) { cache[name] = null; return null; }
      const el = new Audio(path);
      el.preload = 'auto';
      el.addEventListener('error', () => {
        if (window.PNA_DEV_MODE) console.warn('[Pup N Away] audio hook "' + name + '" has no file yet at ' + path + ' (this is expected until real audio is supplied)');
      }, { once: true });
      cache[name] = el;
      return el;
    }

    function play(name) {
      if (muted || !unlocked) return;
      const el = getSound(name);
      if (!el) return;
      try {
        const inst = el.cloneNode(true); // allow overlapping triggers (e.g. rapid bounces)
        inst.volume = sfxVolume;
        inst.play().catch(() => {});
      } catch (_) { /* missing/broken file — silently skip, never crash gameplay */ }
    }

    function unlockOnFirstGesture() {
      if (unlocked) return;
      unlocked = true;
    }

    function startMusic() {
      if (!unlocked) return;
      if (!musicEl) {
        musicEl = new Audio(MUSIC_PATHS.background);
        musicEl.loop = true;
        musicEl.addEventListener('error', () => {
          if (window.PNA_DEV_MODE) console.warn('[Pup N Away] background music not supplied yet at ' + MUSIC_PATHS.background);
        }, { once: true });
      }
      musicEl.volume = muted ? 0 : musicVolume;
      musicEl.play().catch(() => {});
    }
    function stopMusic() {
      if (musicEl) musicEl.pause();
    }

    function setMusicVolume(v) { musicVolume = Math.max(0, Math.min(1, v)); if (musicEl) musicEl.volume = muted ? 0 : musicVolume; }
    function setSfxVolume(v) { sfxVolume = Math.max(0, Math.min(1, v)); }
    function setMuted(v) {
      muted = !!v;
      if (musicEl) musicEl.volume = muted ? 0 : musicVolume;
    }
    function toggleMuted() { setMuted(!muted); return muted; }

    return {
      play, startMusic, stopMusic,
      setMusicVolume, setSfxVolume, setMuted, toggleMuted,
      unlockOnFirstGesture,
      get muted() { return muted; },
      get musicVolume() { return musicVolume; },
      get sfxVolume() { return sfxVolume; }
    };
  }

  window.PNA_Audio = { createAudioManager, SOUND_PATHS, MUSIC_PATHS };
})();
