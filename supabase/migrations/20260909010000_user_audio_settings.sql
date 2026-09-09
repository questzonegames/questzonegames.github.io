-- ============================================================================
-- Per-user, per-game Music/Sound volume settings
-- ============================================================================
-- Anagram Quest's Music/Sound popovers (see wireAudioControls()/AQMusic in
-- games/anagram-quest/anagram-quest.js) already remember a player's volume
-- choice locally via localStorage, which is enough for a guest — but a
-- signed-in player expects that setting to follow them to another browser/
-- device too, and to be independent per game (e.g. Anagram Quest at 10%,
-- some future game at 50%). This table is that account-level sync layer,
-- generic across every game on the site, not just this one.
--
-- Unlike every scored/competitive table in this schema (game_stats,
-- anagram_quest_stats, etc.), a volume preference is not something a
-- tampered client could "cheat" by writing directly, so this is the one
-- place a client is allowed to read AND write its own row straight
-- through RLS with no RPC/security-definer function in between.
-- ============================================================================

create table if not exists public.user_audio_settings (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_key text not null, -- e.g. 'anagram-quest' — the game's own slug, NOT a skill key like anagram-quest.js's GAME_KEY ('intelligence'), since audio settings are per-game even if two games happened to share a skill
  music_volume int not null default 70 check (music_volume between 0 and 100),
  sfx_volume int not null default 70 check (sfx_volume between 0 and 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_key)
);
alter table public.user_audio_settings enable row level security;

drop policy if exists "user_audio_settings_own_row" on public.user_audio_settings;
create policy "user_audio_settings_own_row"
  on public.user_audio_settings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on public.user_audio_settings to authenticated;
