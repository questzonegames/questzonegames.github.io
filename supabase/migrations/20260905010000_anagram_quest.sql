-- ============================================================================
-- Anagram Quest — Total Level Game slot 02
-- ============================================================================
-- Renaming the placeholder slot cascades into every account's existing
-- game_progress row via game_progress_game_key_fkey (on update cascade),
-- so this alone is enough for Anagram Quest's level to already exist per
-- account, start at 1 (whatever the placeholder row already held), and
-- count toward total_level() — no XP is awarded by this game yet, so the
-- level simply stays at whatever it already was until XP is wired up
-- later (award_xp() already works for any game_key with zero changes here).
update public.games
   set game_key = 'anagram-quest', name = 'Anagram Quest'
 where game_key = 'total-level-2';

-- ----------------------------------------------------------------------------
-- game_stats — high score + games played, per (user, game). Generic across
-- games on purpose (same shape game_progress uses for xp/level) so the next
-- game that needs a persisted high score/play count reuses this table
-- instead of getting its own bespoke one.
-- ----------------------------------------------------------------------------
create table if not exists public.game_stats (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_key text not null references public.games(game_key) on update cascade on delete cascade,
  high_score int not null default 0,
  games_played int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, game_key)
);
alter table public.game_stats enable row level security;

drop policy if exists "game_stats_select_own_or_admin" on public.game_stats;
create policy "game_stats_select_own_or_admin"
  on public.game_stats for select
  using (auth.uid() = user_id or public.is_admin());

-- deliberately no insert/update policy for clients — same reasoning as
-- game_progress: the only way these change is record_game_result() below,
-- so nobody can PATCH their own high score via the REST API directly.

-- ----------------------------------------------------------------------------
-- record_game_result() — the ONLY way game_stats changes. Called once per
-- completed game (not per round). Always increments games_played by 1;
-- raises high_score only if the new score beats it. p_score is clamped to
-- a sane range so a tampered client can't write an absurd value straight
-- into the leaderboard/high-score column — this is a coarse backstop, not
-- full server-side replay validation (each game still computes its own
-- score client-side), but it matches what every other write path in this
-- schema already does: no raw client UPDATE reaches the table at all.
-- ----------------------------------------------------------------------------
create or replace function public.record_game_result(p_game_key text, p_score int)
returns table (high_score int, games_played int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_score int := greatest(0, least(coalesce(p_score, 0), 100000));
begin
  insert into public.game_stats (user_id, game_key, high_score, games_played)
  values (auth.uid(), p_game_key, v_score, 1)
  on conflict (user_id, game_key) do update
    set high_score = greatest(public.game_stats.high_score, excluded.high_score),
        games_played = public.game_stats.games_played + 1,
        updated_at = now();

  return query
    select gs.high_score, gs.games_played
    from public.game_stats gs
    where gs.user_id = auth.uid() and gs.game_key = p_game_key;
end;
$$;

grant execute on function public.record_game_result(text, int) to authenticated;
