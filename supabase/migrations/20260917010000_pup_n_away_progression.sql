-- ============================================================================
-- Pup N Away — act progression (highest unlocked act, completed acts)
-- ============================================================================
-- Same secure pattern as pup_n_away_stats (see
-- 20260915010000_pup_n_away_stats.sql): a SECURITY DEFINER function is the
-- ONLY way this table is ever written, no client insert/update/delete
-- policy exists, and the client never gets to submit "I unlocked act 4"
-- directly — the RPC only ever advances highest_unlocked_act by exactly
-- one, and only when the act the player claims to have just finished
-- actually IS their current highest unlocked act (so a tampered client
-- replaying/guessing act numbers can't skip ahead).
--
-- Deliberately a SEPARATE table, not a generic cross-game "levels" system
-- — Pup N Away is the only game on the site with acts, so this stays
-- scoped to it, matching every other Pup N Away table.
-- ============================================================================
create table if not exists public.pup_n_away_progression (
  user_id uuid primary key references auth.users(id) on delete cascade,
  highest_unlocked_act int not null default 1,
  completed_acts jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint pna_progression_act_positive check (highest_unlocked_act >= 1)
);
alter table public.pup_n_away_progression enable row level security;
drop policy if exists "pna_progression_select_own_or_admin" on public.pup_n_away_progression;
create policy "pna_progression_select_own_or_admin"
  on public.pup_n_away_progression for select
  using (auth.uid() = user_id or public.is_admin());
-- no insert/update/delete policy — the RPC below is the only path in.

-- Called once when a player completes the FINAL level of their current
-- highest-unlocked act. p_completed_act must equal the player's current
-- highest_unlocked_act (or the row doesn't exist yet, meaning act 1) —
-- anything else is silently ignored rather than trusted, so replaying
-- this call or passing an arbitrary act number can never unlock ahead
-- of legitimate progress or "unlock" the same act repeatedly beyond
-- recording it once in completed_acts.
create or replace function public.record_pup_n_away_act_complete(
  p_completed_act int
)
returns table (
  highest_unlocked_act int, completed_acts jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_current int;
  v_completed jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if public.is_banned(v_uid) then raise exception 'This account is banned.'; end if;
  if p_completed_act is null or p_completed_act < 1 then raise exception 'Invalid act'; end if;

  select pna.highest_unlocked_act, pna.completed_acts
    into v_current, v_completed
    from public.pup_n_away_progression pna
    where pna.user_id = v_uid;

  if v_current is null then
    v_current := 1;
    v_completed := '[]'::jsonb;
  end if;

  -- Only accept completion of the player's actual current act — blocks
  -- both replay-unlocking a future act and re-processing an act already
  -- marked complete.
  if p_completed_act = v_current then
    if not (v_completed @> to_jsonb(p_completed_act)) then
      v_completed := v_completed || to_jsonb(p_completed_act);
    end if;
    v_current := v_current + 1;

    insert into public.pup_n_away_progression (user_id, highest_unlocked_act, completed_acts)
      values (v_uid, v_current, v_completed)
      on conflict (user_id) do update
        set highest_unlocked_act = v_current,
            completed_acts = v_completed,
            updated_at = now();
  end if;

  return query
    select pna.highest_unlocked_act, pna.completed_acts
    from public.pup_n_away_progression pna
    where pna.user_id = v_uid;
end;
$$;
grant execute on function public.record_pup_n_away_act_complete(int) to authenticated;
revoke execute on function public.record_pup_n_away_act_complete(int) from public, anon;
