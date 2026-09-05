# Quest Zone — Security Rules

These rules are permanent for this project. They apply to every future
change, not just the pass that first wrote this document.

## Architecture, in one paragraph

Quest Zone is a static site (GitHub Pages, no build step, no server, no
Node/npm) with Supabase (Postgres + Auth) as its only backend. Every page
is a self-contained HTML file that talks to Supabase directly from the
browser using the public anon/publishable key. There is no trusted
server-side code the project controls other than the Postgres database
itself — so **the database (RLS policies + `SECURITY DEFINER` RPC
functions) is the entire trust boundary.** Nothing else stands between a
motivated user and the raw API.

## Permanent laws

- **The browser is untrusted.** Anyone can read/edit the JavaScript, replay
  or modify network requests, or call any Supabase RPC directly — assume
  they will.
- **Every user input is untrusted until validated** — usernames, form
  fields, query strings, submitted words, scores, XP amounts, everything.
- **Database text is data, never executable code.** User-generated content
  (usernames, achievement text, etc.) must render as text — escape it
  before any `innerHTML`/`insertAdjacentHTML`, or use `.textContent`
  instead. Every current rendering site does this; keep it that way.
- **Secrets never go to the browser.** Only the Supabase anon/publishable
  key belongs in frontend code (`assets/js/qz-config.js`) — it is safe by
  design because RLS is the real gate, not the key. A service-role key,
  database password, or any other privileged credential must never be
  imported into a page, a client bundle, or committed anywhere in this
  repo.
- **Row Level Security is mandatory on every table** holding account data.
  Default deny; add narrow, explicit `auth.uid() = user_id`-style
  policies. `USING (true)` is only acceptable for genuinely public
  reference data (`games`, `achievements`) or a table that's explicitly
  meant to be world-readable (`pinned_achievements` — "pinning IS showing
  off").
- **Client-supplied user IDs are never trusted for ownership.** Every
  "act on my own account" RPC derives the account from `auth.uid()`
  inside the function, never from a parameter the client can set. Admin
  RPCs that DO take a target user ID also independently verify
  `is_admin()` first.
- **Admin/Owner status is verified inside the database, every time** —
  never trusted from a client-side flag, `localStorage`, or a hidden
  button. Every `admin_*` RPC starts with `if not public.is_admin() then
  raise exception 'Not authorized.'`. Hiding the Admin Zone button is a
  UX nicety, not a security control.
- **Client-supplied XP/score/inventory/achievements are never
  authoritative on their own.** The only way XP changes is `award_xp()`
  (adds, never sets, and is bounded — see below); the only way a high
  score/games-played changes is `record_game_result()` (clamped); the
  only way an admin can set an exact XP value is `admin_set_game_xp()`
  (admin-gated). There is deliberately no client insert/update RLS policy
  on `game_progress` or `game_stats` — the RPCs are the only door.
- **No route from public website input to this machine, this terminal, or
  this Git repository.** There is no server component here that could
  even offer one — keep it that way if one is ever added (no user input
  should ever reach `child_process`/`exec`/shell commands).
- **User data never automatically enters source control.** Nothing in
  this project writes database content into a file and commits it. If
  that's ever built (e.g. an export/backup tool), it must always be a
  deliberate, human-triggered action, never automatic.
- **New dependencies are third-party executable code.** This project has
  none today (no `package.json`) beyond one pinned CDN script (the
  official Supabase JS SDK, exact version, from `cdn.jsdelivr.net`). If a
  build step or npm dependency is ever introduced, review install scripts
  and keep the lockfile.
- **Security controls are never disabled just to make a feature work.**
  If something is insecure, fix it properly (a narrower policy, a real
  check) — don't turn off RLS, don't weaken a check, don't add a debug
  bypass "temporarily."

## Known, accepted limitation: game scoring is not server-replayed

Each game's actual rules (word validity, round timing, rack letters,
snake movement) run entirely client-side; there is no server-side replay
of a full game session. `award_xp()` and `record_game_result()` are
**coarse backstops** (a sane numeric range), not full anti-cheat — a
sufficiently motivated player could still submit a plausible-looking but
not-quite-real score within those bounds. Closing this completely would
mean moving each game's scoring logic into a trusted server context (a
Supabase Edge Function per game) — a real architectural change, not a
quick hardening fix, and intentionally out of scope for this pass. This
is a known, accepted tradeoff for a static-site-only architecture, not an
oversight.

## Where things live

- `supabase/schema.sql` — full current schema snapshot (safe to re-run).
- `supabase/migrations/*.sql` — the actual applied history; every change
  lands here first, then gets folded back into `schema.sql`.
- `assets/js/qz-auth.js` — the only place `supabase.auth` is called
  directly; every other file goes through `window.QZAuth`.
- `assets/js/qz-config.js` — the public Supabase URL + anon key. Nothing
  else belongs in this file.

## Before adding anything new

- A new **table**: enable RLS immediately, in the same migration that
  creates it. Write the narrowest policy that lets the real feature work.
- A new **privileged action** (anything that changes someone's XP,
  inventory, ban status, role, or another account's data): a
  `SECURITY DEFINER` function with an explicit authorization check as its
  first statement, called through `grant execute ... to authenticated`
  (or `anon` only if it genuinely must run pre-login) — never a broad
  `USING (true)` policy.
- A new **npm/CDN dependency**: state what it's for, whether it's the
  official package, and why existing code can't already do it, before
  installing/adding it.
- A new **numeric value from the client** (XP, score, quantity, etc.):
  give it an explicit sane range check, matching the pattern in
  `award_xp`/`record_game_result`/`admin_set_game_xp`.
