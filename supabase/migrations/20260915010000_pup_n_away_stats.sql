-- ============================================================================
-- Pup N Away — per-player stats, same secure pattern as every other game
-- (game_stats/record_game_result, game_progress/award_xp): a SECURITY
-- DEFINER function is the ONLY way this table is ever written, no client
-- insert/update/delete policy exists, and every increment is a small,
-- capped delta from THIS call — never a client-submitted absolute total.
--
-- Deliberately a SEPARATE table from game_stats, not a new duplicate
-- account/currency/inventory system: game_stats already covers
-- high_score/games_played generically (record_game_result is reused
-- as-is for those two, via GAME_KEY='pup-n-away') — this table only
-- adds the extra fields the brief asked for that game_stats doesn't
-- have (highest level reached, total bones, total bounces, playtime).
--
-- No Quest Points/Stardust/items/XP are touched anywhere here — award_xp
-- is deliberately NEVER called for 'pup-n-away' (it has no real
-- registered skill in the `games` table, and game_progress.level feeds
-- directly into total_level() site-wide with no such filter — calling
-- it would silently inflate a player's Total Level with no approved
-- reward rule behind it, which the brief explicitly disallows).
-- ============================================================================
create table if not exists public.pup_n_away_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  games_started int not null default 0,
  games_completed int not null default 0,
  highest_level_reached int not null default 0,
  total_bones_collected int not null default 0,
  total_bounces int not null default 0,
  total_playtime_seconds int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pna_stats_non_negative check (
    games_started >= 0 and games_completed >= 0 and highest_level_reached >= 0
    and total_bones_collected >= 0 and total_bounces >= 0 and total_playtime_seconds >= 0
  )
);
alter table public.pup_n_away_stats enable row level security;
drop policy if exists "pna_stats_select_own_or_admin" on public.pup_n_away_stats;
create policy "pna_stats_select_own_or_admin"
  on public.pup_n_away_stats for select
  using (auth.uid() = user_id or public.is_admin());
-- no insert/update/delete policy — both RPCs below are the only path in.

create or replace function public.record_pup_n_away_game_started()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if public.is_banned(v_uid) then raise exception 'This account is banned.'; end if;

  insert into public.pup_n_away_stats (user_id, games_started)
    values (v_uid, 1)
    on conflict (user_id) do update
      set games_started = public.pup_n_away_stats.games_started + 1,
          updated_at = now();
end;
$$;
grant execute on function public.record_pup_n_away_game_started() to authenticated;
revoke execute on function public.record_pup_n_away_game_started() from public, anon;

-- Called at natural checkpoints (level complete, game over, leaving the
-- game) with the DELTA earned since the last call — never a running
-- total the client keeps track of itself. Each delta is capped to a
-- generous but sane per-call ceiling (mirrors award_xp's own per-call
-- cap pattern) so a single call can only ever move each stat by a
-- believable amount, regardless of what a modified client sends.
create or replace function public.record_pup_n_away_progress(
  p_level_reached int default null,
  p_bones_collected int default 0,
  p_bounces int default 0,
  p_playtime_seconds int default 0,
  p_completed boolean default false
)
returns table (
  games_completed int, highest_level_reached int,
  total_bones_collected int, total_bounces int, total_playtime_seconds int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_bones int := greatest(0, least(coalesce(p_bones_collected, 0), 50));
  v_bounces int := greatest(0, least(coalesce(p_bounces, 0), 1000));
  v_playtime int := greatest(0, least(coalesce(p_playtime_seconds, 0), 3600));
  v_level int := greatest(0, least(coalesce(p_level_reached, 0), 9999));
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if public.is_banned(v_uid) then raise exception 'This account is banned.'; end if;

  insert into public.pup_n_away_stats (user_id, highest_level_reached, total_bones_collected, total_bounces, total_playtime_seconds, games_completed)
    values (v_uid, v_level, v_bones, v_bounces, v_playtime, case when p_completed then 1 else 0 end)
    on conflict (user_id) do update
      set highest_level_reached = greatest(public.pup_n_away_stats.highest_level_reached, v_level),
          total_bones_collected = public.pup_n_away_stats.total_bones_collected + v_bones,
          total_bounces = public.pup_n_away_stats.total_bounces + v_bounces,
          total_playtime_seconds = public.pup_n_away_stats.total_playtime_seconds + v_playtime,
          games_completed = public.pup_n_away_stats.games_completed + (case when p_completed then 1 else 0 end),
          updated_at = now();

  return query
    select gc.games_completed, gc.highest_level_reached, gc.total_bones_collected, gc.total_bounces, gc.total_playtime_seconds
    from public.pup_n_away_stats gc
    where gc.user_id = v_uid;
end;
$$;
grant execute on function public.record_pup_n_away_progress(int, int, int, int, boolean) to authenticated;
revoke execute on function public.record_pup_n_away_progress(int, int, int, int, boolean) from public, anon;
