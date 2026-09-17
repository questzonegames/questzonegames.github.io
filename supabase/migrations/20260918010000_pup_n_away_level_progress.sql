-- ============================================================================
-- Pup N Away — per-level completion tracking (sequential unlock/replay)
-- ============================================================================
-- Separate from pup_n_away_stats.highest_level_reached (which tracks the
-- furthest level a player has ever REACHED, including one they died in —
-- see 20260915010000_pup_n_away_stats.sql) because the Level Select screen
-- needs the stricter, different fact "which levels has this player
-- actually COMPLETED", to gate whether the next level card is unlocked and
-- whether a level shows a completed/replayable indicator. Reusing
-- highest_level_reached for that would incorrectly unlock a level the
-- player only died in without finishing the one before it.
--
-- Same secure pattern as every other Pup N Away table: a SECURITY DEFINER
-- RPC is the only way this table is ever written, no client insert/
-- update/delete policy exists, and the level id is checked against a
-- fixed known-level allowlist (not trusted verbatim from the client).
-- ============================================================================
create table if not exists public.pup_n_away_level_completions (
  user_id uuid not null references auth.users(id) on delete cascade,
  level_id text not null,
  best_score int not null default 0,
  best_time_ms int not null default 0,
  times_completed int not null default 0,
  first_completed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, level_id),
  constraint pna_level_completions_non_negative check (
    best_score >= 0 and best_time_ms >= 0 and times_completed >= 0
  )
);
alter table public.pup_n_away_level_completions enable row level security;
drop policy if exists "pna_level_completions_select_own_or_admin" on public.pup_n_away_level_completions;
create policy "pna_level_completions_select_own_or_admin"
  on public.pup_n_away_level_completions for select
  using (auth.uid() = user_id or public.is_admin());
-- no insert/update/delete policy — the RPC below is the only path in.

-- p_level_id is checked against the game's real level ids (kept in sync
-- with the LEVELS manifest in pup-n-away-config.js) rather than trusted
-- as an arbitrary client string — this only ever needs updating here
-- when a new level is actually added to that manifest, same as every
-- other server-side content allowlist on the site.
create or replace function public.record_pup_n_away_level_complete(
  p_level_id text, p_score int default 0, p_time_ms int default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_score int := greatest(0, least(coalesce(p_score, 0), 999999));
  v_time int := greatest(0, least(coalesce(p_time_ms, 0), 3600000));
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if public.is_banned(v_uid) then raise exception 'This account is banned.'; end if;
  if p_level_id is null or p_level_id not in ('dream-bedroom', 'back-garden', 'house-rooftop') then
    raise exception 'Unknown level.';
  end if;

  insert into public.pup_n_away_level_completions (user_id, level_id, best_score, best_time_ms, times_completed)
    values (v_uid, p_level_id, v_score, v_time, 1)
    on conflict (user_id, level_id) do update
      set best_score = greatest(public.pup_n_away_level_completions.best_score, v_score),
          best_time_ms = case
            when public.pup_n_away_level_completions.best_time_ms <= 0 then v_time
            else least(public.pup_n_away_level_completions.best_time_ms, v_time)
          end,
          times_completed = public.pup_n_away_level_completions.times_completed + 1,
          updated_at = now();
end;
$$;
grant execute on function public.record_pup_n_away_level_complete(text, int, int) to authenticated;
revoke execute on function public.record_pup_n_away_level_complete(text, int, int) from public, anon;
