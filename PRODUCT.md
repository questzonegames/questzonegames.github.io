# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing codebase: static HTML/CSS/vanilla JS (no frontend framework, no build step), hosted on GitHub Pages, with Supabase as the backend (Postgres + Auth + RLS-enforced RPCs for profiles, game progress, inventory, achievements, admin moderation). Games are self-contained pages under `games/<game-name>/`.

## Users

Players who grew up on early-2010s browser game hubs (Miniclip-era) and want that same "giant library of free, quick-to-play games" experience, but with modern persistent-account depth layered on top: an avatar, cosmetics, and long-term stat progression that survives across every game they play, not just a single session's high score.

## Product Purpose

Quest Zone is a hub of free, individually simple browser games (old-school Flash-arcade style: quizzes, word games, racing, fighting, farming/building, etc.) unified by one persistent MMORPG-style character layer. Playing any game feeds XP into a shared skill system, the same way exploring an MMO world would — except here "exploring the world" is replaced by "playing the games." Success looks like a player building up their account (levels, cosmetics, achievements) across many short, unrelated game sessions, coming back the way they'd return to level a character.

## Positioning

The mechanism a neighboring "games hub" site can't just copy: every game, however small, writes into one shared account-wide skill/level system (RuneScape-style skills, not simple per-game stats), and that system is genuinely used elsewhere on the site (highscores/leaderboards, avatar cosmetics gating, achievements). It's an MMORPG's account-progression layer with minigames standing in for the walk-around world, rather than a leaderboard bolted onto each game in isolation.

## Operating Context

- A player signs up, gets a profile + customizable avatar, then plays any game from the homepage hub.
- Each game is mapped to one or more skills; finishing a play session awards that skill's XP via a shared, server-validated `award_xp` path (never trusted from the client).
- Skills follow a RuneScape-style level curve (already implemented in `assets/js/qz-xp.js`), shown per-skill on the player's Skills page and rolled up into a Total Level shown site-wide.
- Confirmed skill mapping (established + intended; not all games/skills exist yet):
  - Quiz / general-knowledge / thinking games → **Intelligence** (live: Anagram Quest)
  - Driving / vehicle / racing games → **Driving** (not yet built)
  - Fighting games → **Strength** and **Defence** (not yet built)
  - Farming / crop-growing / building games → **Farming** and/or **Construction** (not yet built)
  - More skills are added as more game genres are added; the system is designed to grow, not a fixed final list.
- Highscores/leaderboards exist per-skill and overall (Total Level), RuneScape-style, plus player search and head-to-head compare.
- Cosmetics for the avatar are purchasable with either **Quest Points** (the in-game currency, earned by playing) or **real money** — confirmed dual-currency shop model. The Shop itself is a placeholder tab today ("coming soon"); the currency (Quest Points) and the avatar/inventory/equip system it will spend into already exist.
- Achievements exist and can be pinned to a player's public profile as a small curated showcase, distinct from the full achievements list.
- **Pets**, unlocked by leveling up (which skill/level thresholds unlock which pet is undecided), are a stated future feature — not yet designed or built. Record as an open capability, not a shipped one.
- Admins (currently just the site owner) can moderate accounts: temp/permanent ban, hide (cosmetic-only, reversible — excludes from Highscores/search but the account still logs in and plays normally), and permanently delete an account (frees the username for reuse).

## Capabilities and Constraints

- No pay-to-win implied or requested: real money is confirmed only as an alternate currency for **cosmetics**, not gameplay power. Treat any future monetization design as cosmetics-only unless the user says otherwise.
- The skill system must stay server-authoritative (RLS + `award_xp`/`record_game_result` RPC pattern) — client code only ever requests "add this XP", never sets a stored value directly. This is an existing, established constraint, not new.
- New skills (Driving, Strength, Defence, Farming, Construction, ...) are added to `public.games` + the skill-icon/registry pattern already used for Intelligence; no schema redesign implied.
- Pets: unlock condition, ownership model (cosmetic follower vs. functional), and UI surface are all undecided — do not invent specifics when this comes up; ask first.

## Brand Commitments

- Name: Quest Zone. Existing tagline: "Nostalgia Never Logged Off" — reinforces the early-2010s browser-game-hub positioning above; keep it consistent with any new copy.

## Evidence on Hand

- Live, working example of the skill-XP loop: Anagram Quest (`games/anagram-quest/`) → Intelligence skill.
- Existing account/profile system: `profile/index.html` (avatar, Quest Points, pinned achievements, Skills/Inventory/Achievements/Admin-Inventory/Avatar-Rig tiles).
- Existing Highscores system: `highscores.html` + `highscores/player.html` + `highscores/compare.html`, backed by `hiscores_overall`/`hiscores_skill`/`hiscores_player_stats` RPCs.
- Existing admin moderation tooling: `profile/admin.html` (ban temp/permanent, hide/unhide, delete account).
- No pets implementation exists yet anywhere in the codebase — confirmed absence, not an oversight to search harder for.

## Product Principles

1. Every game, no matter how small or old-school-arcade in feel, plugs into the one shared account/skill system — that shared spine is the product, not any single game.
2. Progression must always be earned through play (XP), never purchased; only cosmetics are for sale, and only for the avatar.
3. Nostalgia for simple, bite-sized browser games is the entry hook; long-term account progression (levels, cosmetics, achievements, pets) is the retention hook. Neither replaces the other.
4. Server-side is the source of truth for anything that affects standing (XP, levels, currency, ownership, ban/ban-visibility) — the client only ever requests changes, never asserts them.
