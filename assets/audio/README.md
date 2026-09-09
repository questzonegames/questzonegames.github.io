# Quest Zone — Audio Folder Structure

This tree exists so game audio has one obvious, consistent home before any
sound files are added. Nothing in here plays yet — see
`docs/AUDIO_PLAN.md` for the full sound list, sourcing options, and status.

## Layout

```
assets/audio/
├── global/                  Quest Zone-wide sounds, shared by every game
│   ├── ui/                  Generic button hover/click, menu open/close —
│   │                        anything the site chrome itself plays
│   ├── notifications/       Achievement unlocks, level-ups, toasts — any
│   │                        cross-game reward/alert sound
│   └── music/                Lobby/arcade/profile background music
│
└── games/
    └── anagram-quest/       Everything specific to this one game only
        ├── ui/               In-game buttons: Start, Back, difficulty picks
        ├── letters/          Letter tile interactions (pick, backspace)
        ├── gameplay/         Word submit, valid/invalid, round start/end
        ├── timer/            Ticking, low-time warning
        ├── xp/               XP gain, XP bar fill, level-up
        ├── rewards/          9-letter word, personal best, achievements
        └── music/             Anagram Quest's own gameplay music, if
                               different from the shared lobby track
```

Add a new `games/<game-key>/` sibling (mirroring the same sub-folders
that make sense for that game) when the next game needs audio — never mix
one game's sounds into another's folder, and never drop a loose file
directly into `games/` or `global/` without a sub-folder.

## Naming convention

`lowercase-kebab-case.ext`, named after **what it is**, not where it's
used — e.g. `letter-pick.mp3`, `round-start.mp3`, `level-up.mp3`. Keep the
same base name across formats if more than one is ever needed (e.g. an
`.mp3` fallback next to an `.ogg`).

Every planned filename is listed in `docs/AUDIO_PLAN.md` — check there
before naming a new file so game code and assets agree.

## Format expectations (once files are added)

- **Sound effects**: short `.mp3` or `.ogg`, mono where possible, trimmed
  to silence at both ends, loudness-matched against the other effects in
  the same folder (see `docs/AUDIO_PLAN.md`'s "Audacity" notes).
- **Music**: `.mp3` or `.ogg`, seamlessly loopable where the plan calls
  for a loop, kept as a separate file from any stinger/one-shot variant.

## `.gitkeep`

Each empty leaf folder holds a `.gitkeep` so the structure survives in
git before any real audio exists. Delete a folder's `.gitkeep` once it
holds a real file.
