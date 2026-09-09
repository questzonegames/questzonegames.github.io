# Quest Zone — Audio Plan

**Status: planning only.** No audio files exist in the project yet, no
third-party audio has been sourced, and no sound is wired into any live
game. This document exists so that when sounds are ready to add, there's
already an agreed folder, filename, and trigger for every one of them —
see `assets/audio/README.md` for the physical folder layout this plan
maps onto.

The game code already calls a `playSound(name)` / `window.QZSound.play(name)`
hook at several points (see "Already wired in code" below) — those calls
are currently safe no-ops (`if (window.QZSound && window.QZSound.play)`)
waiting for a real `QZSound` module and real files. Building that
`QZSound` module and adding files is future work, not part of this plan.

---

## 1. Anagram Quest — full sound list

Intensity is relative to a normal player's system volume, not an absolute
dB value: **Subtle** = barely-there texture (UI micro-feedback), **Medium**
= clearly audible but not attention-grabbing, **Strong** = meant to be
noticed and feel rewarding/urgent.

### Global (shared across Quest Zone, not just this game)

These live in `assets/audio/global/` because other games will want the
exact same sounds — Anagram Quest should call the shared file, not get
its own copy.

| Sound | Filename | Folder | Plays when | Intensity | Length |
|---|---|---|---|---|---|
| General button hover | `button-hover.mp3` | `global/ui/` | Mouse enters any `.btn`-style button, site-wide | Subtle | 80–150ms |
| General button click | `button-click.mp3` | `global/ui/` | Any generic button press that doesn't have its own dedicated sound | Medium | 100–200ms |
| Menu open | `menu-open.mp3` | `global/ui/` | A panel/accordion/modal expands (e.g. a "How to Play" section) | Subtle | 150–250ms |
| Menu close | `menu-close.mp3` | `global/ui/` | Same, collapsing | Subtle | 150–250ms |
| Achievement / unlock | `achievement-unlock.mp3` | `global/notifications/` | Any achievement toast, site-wide | Strong | 800ms–1.5s |
| Level up | `level-up.mp3` | `global/notifications/` | Any skill (Intelligence, etc.) crosses a level, any game | Strong | 1–2s |
| New personal best | `new-personal-best.mp3` | `global/notifications/` | A new high score is recorded, any game | Strong | 1–1.5s |
| Lobby background music | `lobby-loop.mp3` | `global/music/` | Quest Zone arcade/lobby screens | Subtle (loop) | 1–3 min, seamless loop |

### Anagram Quest — UI (`assets/audio/games/anagram-quest/ui/`)

| Sound | Filename | Plays when | Intensity | Length |
|---|---|---|---|---|
| Start Game | `start-game.mp3` | "START GAME" pressed on the lobby | Medium | 300–500ms |
| Back | `back.mp3` | Any "← BACK" button (difficulty select → lobby, etc.) | Subtle | 150–250ms |
| Easy selected | `difficulty-easy.mp3` | Easy card pressed on Choose Your Difficulty | Medium | 300–500ms |
| Medium selected | `difficulty-medium.mp3` | Medium card pressed | Medium | 300–500ms |
| Hard selected | `difficulty-hard.mp3` | Hard card pressed | Medium–Strong | 400–600ms |
| Difficulty locked (denied) | `difficulty-locked.mp3` | *(new — see §2)* Player clicks/hovers a still-locked Medium/Hard card | Subtle | 200–300ms |

### Anagram Quest — Letters (`assets/audio/games/anagram-quest/letters/`)

| Sound | Filename | Plays when | Intensity | Length | Wired? |
|---|---|---|---|---|---|
| Letter picked (V/C) | `letter-pick.mp3` | Rounds 1–4: player presses the Vowel or Consonant button | Subtle | 80–150ms | ✅ `playSound('letter-pick')` |
| Tile selected | `tile-select.mp3` | Player taps a rack letter to add it to their answer | Subtle | 80–150ms | ✅ `playSound('tile-click')` |
| Backspace | `backspace.mp3` | Last letter removed from the current answer | Subtle | 100–150ms | ✅ `playSound('backspace')` |

### Anagram Quest — Gameplay (`assets/audio/games/anagram-quest/gameplay/`)

| Sound | Filename | Plays when | Intensity | Length | Wired? |
|---|---|---|---|---|---|
| Countdown tick | `countdown-tick.mp3` | *(new — see §2)* Each of the intro screen's "3…2…1" beats | Subtle | 100–200ms | — |
| Countdown GO | `countdown-go.mp3` | *(new)* Intro screen shows "GO!", handing off to Round 1 | Medium | 300–500ms | — |
| Round start | `round-start.mp3` | Rounds 1–4 begin (after the intro, and after each "NEXT ROUND") | Medium | 300–500ms | — |
| Final round start | `final-round-start.mp3` | Round 5 (the 9-letter bonus round) begins | Strong | 500ms–1s | — |
| Word submitted | `word-submit.mp3` | "LOCK IN" pressed | Medium | 200–400ms | — |
| Valid word | `word-valid.mp3` | Round result: the submitted word was accepted | Medium–Strong | 400–700ms | — |
| Invalid word / no word | `word-invalid.mp3` | Round result: rejected word, or clock ran out with nothing entered | Medium | 400–700ms | — |
| Final round failed | `final-round-fail.mp3` | Round 5's clock runs out with no valid 9-letter word found | Medium | 400–700ms | — |
| Game over | `game-over.mp3` | Game Over screen appears | Medium–Strong | 500ms–1s | ✅ `playSound('game-over')` |

### Anagram Quest — Timer (`assets/audio/games/anagram-quest/timer/`)

| Sound | Filename | Plays when | Intensity | Length | Wired? |
|---|---|---|---|---|---|
| Timer tick | `timer-tick.mp3` | Once per second **only** once the low-time warning has fired (constant ticking every round would be fatiguing) | Very subtle | <100ms | — |
| Low-time warning | `timer-warning.mp3` | Timer crosses its warning threshold | Medium | 300–500ms | ✅ `playSound('timer-warning')` |

### Anagram Quest — XP (`assets/audio/games/anagram-quest/xp/`)

| Sound | Filename | Plays when | Intensity | Length |
|---|---|---|---|---|
| XP gaining | `xp-gain.mp3` | The Game Over screen's points→XP number starts counting up | Subtle–Medium | 300–600ms (or looped/sustained for the count-up duration) |
| XP bar finishing | `xp-bar-fill.mp3` | The Intelligence bar finishes animating to its new value | Medium | 300–500ms |

*(Level-up itself reuses the global `level-up.mp3` above — no
Anagram-Quest-specific copy needed unless it should sound different from
every other game's level-up.)*

### Anagram Quest — Rewards (`assets/audio/games/anagram-quest/rewards/`)

| Sound | Filename | Plays when | Intensity | Length |
|---|---|---|---|---|
| Successful 9-letter word | `nine-letter-success.mp3` | Round 5 result: the full 9-letter word was found | Strong | 600ms–1.2s |

*(New personal best and achievement/unlock reuse the global versions
above by default — add a game-specific variant here later only if a
louder/more Anagram-Quest-flavoured version is wanted.)*

### Anagram Quest — Music (`assets/audio/games/anagram-quest/music/`)

| Sound | Filename | Plays when | Intensity | Length |
|---|---|---|---|---|
| Gameplay background music | `gameplay-loop.mp3` | Difficulty select through Game Over, if it should differ from the lobby track | Subtle (loop) | 1–3 min, seamless loop |

---

## 2. Other interactions worth sound (found while inspecting the game)

Beyond the requested list, reading through `anagram-quest.js` surfaced a
few more moments that would benefit from a sound once this system exists:

- **Locked difficulty click/hover** — Medium/Hard are greyed out and
  disabled below their unlock level (`applyDifficultyLocks()`); a soft
  "denied" sound on hover or attempted click reinforces that it's locked,
  not broken.
- **Countdown beats (3…2…1…GO)** — `playIntro()` already drives a
  700ms-per-beat countdown; each number change and the final "GO!" are
  natural, currently-silent sound cues (added to the Gameplay table
  above).
- **"How to Play" / rules accordion** — the guidebook-style expandable
  sections (`head.addEventListener('click', ...)`) toggle open/closed and
  can reuse the global `menu-open`/`menu-close` sounds rather than
  needing their own.
- **Vowel/Consonant buttons disabling mid-round** — no sound needed here,
  just flagging that `letter-pick.mp3` already covers the only audible
  moment in that flow.

---

## 3. Free Audio Options

Research only — nothing below has been downloaded, signed up for, or
committed to. **Quest Zone may be monetised later**, so licensing is
called out explicitly wherever "free" doesn't automatically mean
"free for commercial use."

### Royalty-free sound-effect libraries (e.g. Zapsplat, Pixabay Audio, Mixkit)

- **Quality**: Generally high — professionally recorded/designed SFX.
- **Ease of use**: Very easy — searchable, downloadable, often
  pre-categorized (UI, impacts, whooshes, etc.).
- **Commercial licensing**: **Varies by site and by account tier.**
  Zapsplat's free tier requires attribution and/or a free account, and
  its standard license historically excludes some commercial/broadcast
  uses without a paid plan — this needs checking per-file at the time of
  download, not assumed. Pixabay's and Mixkit's own licenses are broader
  (typically allow commercial use without attribution) but still need
  reading per site, since terms change.
- **Genuinely free?**: Mixkit and Pixabay: yes, for their stated terms.
  Zapsplat: free tier exists but with more restrictions than the paid
  tier — read the fine print before using anything from it commercially.
- **Good for a browser game?**: Yes — files are typically short, clean
  WAV/MP3, easy to trim and normalize.

### CC0 / public-domain sound libraries (e.g. Freesound.org filtered to CC0, OpenGameArt audio)

- **Quality**: Inconsistent — ranges from professional to amateur
  recordings, since anyone can upload. Needs auditioning per file.
- **Ease of use**: Freesound's search/filter is good once you know to
  filter by license (CC0 specifically, not just "Creative Commons" —
  some Freesound content is CC-BY, which requires attribution, or
  non-commercial, which would block monetisation).
- **Commercial licensing**: **CC0 is the safest possible license** — it
  places the work in the public domain, no attribution or restriction of
  any kind, explicitly safe for commercial use. This is the gold
  standard for a project that may monetise later, but only for files
  actually tagged CC0 — always double-check the exact license on each
  individual sound, not just the site's general reputation.
- **Genuinely free?**: Yes, permanently — CC0 can't be revoked.
- **Good for a browser game?**: Yes, once auditioned/cleaned — expect to
  spend time in Audacity trimming and normalizing since quality varies.

### Free AI sound-effect generators (e.g. ElevenLabs' sound effects tool, other emerging tools)

- **Quality**: Improving fast, but still hit-or-miss for precise,
  game-specific short SFX (a "letter click" or "tile pop" is a small,
  exacting target for a generative model tuned for general sound design).
- **Ease of use**: Very easy — text prompt in, sound out, no recording
  equipment or editing skill needed.
- **Commercial licensing**: **Varies significantly by tool and by
  pricing tier** — some explicitly grant commercial rights on outputs
  even on a free tier, others only grant commercial rights on paid
  plans, and terms are actively changing across the industry. This is
  the category needing the most careful, current license-reading before
  any commercial use — nothing here should be assumed safe without
  checking the specific tool's current terms at the time of use.
- **Genuinely free?**: Usually a limited free tier (a monthly credit
  allowance), not unlimited.
- **Good for a browser game?**: Reasonable for one-off "flavour" sounds
  (a whoosh, a magical chime) where an imperfect match is fine; less
  reliable for a large batch of very specific, consistent UI sounds.

### Sounds generated locally with the Web Audio API (synthesized in code, e.g. by Claude Code)

- **Quality**: Best suited to simple, short, electronic-style sounds —
  beeps, blips, clicks, tones. Can sound genuinely good for UI feedback
  (many real games use synthesized UI clicks); not a substitute for
  organic sounds like impacts, whooshes, or crowd/ambience.
- **Ease of use**: No external tool or download at all — the sound is
  generated by JavaScript at runtime or baked to a file by a script.
  Iteration is fast once the pattern is set up (adjust a frequency/
  envelope, reload).
- **Commercial licensing**: **No licensing issue whatsoever** — code you
  (or Claude Code) write generating raw audio is 100% original, no
  third-party rights involved anywhere in the chain.
- **Genuinely free?**: Completely, permanently.
- **Good for a browser game?**: Excellent for exactly the kind of small,
  frequent UI/feedback sounds this plan lists a lot of — letter clicks,
  backspace, button hover, tile select. Not the right tool for music or
  rich reward "fanfare" sounds.

### Free music libraries (e.g. Kevin MacLeod/incompetech, Pixabay Music, YouTube Audio Library, freepd.com)

- **Quality**: Ranges from genuinely professional (a lot of
  incompetech's catalogue is used in shipped commercial games and video)
  to generic stock-music feel — worth auditioning several before picking
  a loop.
- **Ease of use**: Straightforward browsing/downloading; loop-friendliness
  varies per track and sometimes needs a manual loop-point edit in
  Audacity.
- **Commercial licensing**: **This is the category to be most careful
  with for monetisation.** incompetech's tracks are CC-BY (free
  commercial use, but attribution is *required*, typically in credits).
  YouTube Audio Library has some tracks that are fully free-use and
  others still requiring attribution — check per track. freepd.com is
  explicitly public-domain (CC0-equivalent), which is the safest option
  if avoiding an attribution requirement is a priority.
- **Genuinely free?**: Yes across all four, but "free" ≠ "attribution-free"
  — that distinction matters more for music than for short SFX, since
  a whole track's license terms are more likely to be scrutinised.
- **Good for a browser game?**: Yes — the main practical work is finding
  a track that actually loops cleanly, which usually means editing it.

### Creating/editing sounds in Audacity

- **Quality**: Depends entirely on the source material fed into it —
  Audacity itself is a capable free, open-source editor (trim, fade,
  normalize, EQ, pitch-shift, generate basic tones/noise).
- **Ease of use**: A real learning curve for anything beyond
  trim/normalize/fade, but those three operations (which is most of what
  this project needs — cleaning up library/CC0 downloads) are quick to
  learn.
- **Commercial licensing**: **No issue** — Audacity is free, open-source
  software (GPL), and editing a sound you already have the rights to
  doesn't change those rights.
- **Genuinely free?**: Completely — no tiers, no account, no watermark.
- **Good for a browser game?**: Essential, actually — regardless of
  which source(s) above are used, Audacity is the tool that normalizes
  everything to a consistent loudness, trims dead air so clicks feel
  instant, and exports at a sensible file size/format for the web.

---

## 4. Recommended free workflow for Quest Zone

Given the monetisation intent, the safest and most practical mix is:

1. **CC0 / public-domain libraries first** for anything organic —
   swishes, impacts, unlock/reward fanfares, ambience. Filter
   specifically to CC0 (not just "Creative Commons") every time, since
   that's the only tier of license that's unconditionally safe to
   monetise later with zero attribution burden.
2. **Web Audio API / Claude-generated tones** for the high-frequency,
   tiny UI sounds — letter picks, tile selects, backspace, button hover.
   These are simple enough to synthesize well, it sidesteps licensing
   entirely, and it avoids burning through a sound library's better
   content on sounds that don't need real-world texture.
3. **Audacity** as the finishing step for everything from step 1 — trim,
   normalize loudness so nothing in the same folder jumps out louder
   than its neighbours, and export at a consistent format.
4. **Music**: pick specifically from a source whose license is confirmed
   commercial-safe at the time of picking — a CC0 library (freepd.com or
   similarly-licensed) is the simplest choice since it avoids an
   attribution requirement; a CC-BY track (incompetech, etc.) is also
   fine for commercial use but obligates a visible credit somewhere on
   the site. Don't assume any library default tier is commercial-safe
   without checking that specific track's license — "free to download"
   and "free to monetise with" are not always the same thing.

This keeps the entire audio budget at $0 while avoiding the two real
risks for a site that may monetise later: a library tier whose license
turns out to be non-commercial, and forgetting a required attribution
credit for a track that turns out not to be CC0.

No sourcing, downloading, or generating happens until you've chosen a
specific library and given the go-ahead — this section is only the
comparison you asked for.
