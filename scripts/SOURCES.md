# Anagram Quest dictionary — sources and licensing

Every word list that feeds `games/anagram-quest/data/dictionary.txt` is
documented here: what it is, its exact license, why that license permits
embedding it in this repo, and where the vendored copy came from. No source
is added to the build without an entry here first (see the project rule in
the build request this file was created from — no scraping proprietary
dictionaries like Oxford/Cambridge/Collins/Merriam-Webster).

## 1. ENABLE1 (base layer, already in the repo before this doc existed)

- **What**: "Enhanced North American Benchmark LExicon", a ~104k-word list
  compiled by Alan Beale for word-game use.
- **License**: Public domain. The ENABLE package's own release notice: *"The
  ENABLE master word list, WORD.LST, is herewith formally released into the
  Public Domain... Game designers may feel free to incorporate the WORD.LST
  into their games."*
- **Used as**: `games/anagram-quest/data/dictionary.txt`'s starting point
  (added in commit `23a9bc2`, already pre-filtered to 4-9 letters). Kept as
  an input to every rebuild, not replaced.

## 2. SCOWL-derived `en-GB` Hunspell dictionary (added by this rebuild)

- **What**: A British English ("-ise" spelling) Hunspell dictionary,
  generated from **SCOWL** (Spell Checker Oriented Word Lists, aka the
  English Speller Database) at size level 60. SCOWL's own documentation
  states its size-60/80 British lists already fold in several of the other
  sources this project's spec named as worth investigating — **UKACD** (the
  UK Advanced Cryptics Dictionary), **12Dicts**, and the public-domain
  **MWords/Moby** package — so pulling this one file gets several
  recommended sources' contributions at once, each already vetted by SCOWL's
  maintainer.
- **License chain** (all confirmed permissive/redistributable):
  - SCOWL itself: copyright Kevin Atkinson 2000-2018, *"Permission to use,
    copy, modify, distribute and sell these word lists... for any purpose is
    hereby granted without fee, provided that the above copyright notice
    appears in all copies."* (MIT-like.)
  - ENABLE (folded into SCOWL's 80 level): Public domain, as above.
  - 12Dicts (folded into several SCOWL levels): Public domain (Alan Beale).
  - UKACD (folded into SCOWL's 80 level): *"Copyright (c) J Ross Beresford
    1993-1999... if [UKACD] is used in a software package or redistributed
    in any form, the copyright notice must be prominently displayed and the
    text of this document must be included verbatim... There are no other
    restrictions: I would like to see the list distributed as widely as
    possible."* — freeware, attribution required (satisfied by this file).
  - MWords/Moby (folded into several SCOWL levels): *"The Moby lexicon
    project... has been placed into the public domain. Use, sell, rework,
    excerpt and use in any way on any platform."*
- **Redistribution package used**: [`wooorm/dictionaries`](https://github.com/wooorm/dictionaries),
  an npm-ecosystem mirror that repackages the official Hunspell dictionaries
  as plain `.dic`/`.aff` files (no proprietary repackaging, same data,
  easier to parse than the SCOWL build toolchain itself).
  - Fetched from: `dictionaries/en-GB/{index.dic,index.aff,license,readme.md}`
  - Commit: `836d7c2032167880e639a1fe522748733e528c2d`
  - Fetched: 2026-09-08
- **Vendored copy**: `scripts/dictionary-sources/en-GB/` (kept in this repo
  so the build is reproducible offline and the license/readme travel with
  the data). `readme.md` there is the upstream SCOWL build's own README,
  reproduced verbatim (it's short and is itself the license documentation).

## Explicitly not used

- **Oxford/Cambridge/Collins/Merriam-Webster** — proprietary, no bulk-scrape
  license. Used only as manual reference when spot-checking an individual
  questionable word (e.g. confirming "mega" and "google" as legitimate
  standalone dictionary entries before trusting the automated source).
- **dwyl/english-words** — public domain but an uncurated scrape (heavy on
  American spelling and junk entries, no British-specific handling).
- **wordfreq** — frequency data, not a word list; also discontinued by its
  author in 2024. Not needed for a pure inclusion/exclusion dictionary.

## How the build applies these

See `scripts/build-anagram-dictionary.pl` for the full pipeline. In short:
union ENABLE1 + the fully affix-expanded en-GB word list (plurals, verb
conjugations, comparatives/superlatives all expanded from the `.aff` rules,
not just base forms) → drop anything outside 4-9 letters or non-alphabetic
→ drop anything in `manual-invalid-words.json` → add back anything in
`manual-valid-words.json` (which always wins, even over a later rebuild) →
write `games/anagram-quest/data/dictionary.txt`.

Proper nouns are excluded by construction, not a hand-maintained blocklist:
Hunspell dictionaries capitalise proper-noun entries (`London`, `Google`) so
they can still be spell-checked, while a genuine common-word homograph stays
lowercase (`google` the verb, `french` the culinary verb) — so the build
simply skips any source entry that doesn't start with a lowercase letter.

## Re-running the build

```bash
perl scripts/build-anagram-dictionary.pl
```

Prints a full statistics report (per-length counts, sources, duplicates
removed, manual adds/blocks) every run. To add a source, document its
license here first, vendor it under `scripts/dictionary-sources/`, then wire
it into the Perl script — never add a source to the build before it has an
entry in this file.
