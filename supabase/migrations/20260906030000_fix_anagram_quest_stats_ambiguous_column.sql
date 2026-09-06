-- ============================================================================
-- Fix: record_anagram_quest_difficulty_result() column-ambiguity error
-- ============================================================================
-- `returns table (easy_high_score int, ...)` implicitly declares a
-- PL/pgSQL variable named `easy_high_score` (etc.) for every OUT column —
-- and this table's actual columns happen to share those exact names. Every
-- UPDATE's bare `easy_high_score` (etc.) reference was therefore ambiguous
-- between "the OUT variable" and "the table column" (Postgres error
-- 42702), which silently failed every single call — verified live: the
-- Anagram Quest lobby's per-difficulty stats stayed at 0/0 after a real
-- completed game, and the console showed exactly this error. Fixed by
-- qualifying every read with a table alias (`t.easy_high_score`, not the
-- bare name) in each UPDATE — the same function, same signature, same
-- RPC name, just qualified. Nothing else about the migration this
-- replaces changes.
-- ============================================================================
create or replace function public.record_anagram_quest_difficulty_result(
  p_difficulty text,
  p_score int,
  p_nine_letter_count int
)
returns table (
  easy_high_score int, medium_high_score int, hard_high_score int,
  easy_nine_count int, medium_nine_count int, hard_nine_count int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_score int := greatest(0, least(coalesce(p_score, 0), 100000));
  v_nine int := greatest(0, least(coalesce(p_nine_letter_count, 0), 5));
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if public.is_banned(v_uid) then
    raise exception 'This account is banned.';
  end if;
  if p_difficulty not in ('EASY', 'MEDIUM', 'HARD') then
    raise exception 'Invalid difficulty: %', p_difficulty;
  end if;

  insert into public.anagram_quest_stats (user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  if p_difficulty = 'EASY' then
    update public.anagram_quest_stats t
      set easy_high_score = greatest(t.easy_high_score, v_score),
          easy_nine_count = t.easy_nine_count + v_nine,
          updated_at = now()
      where t.user_id = v_uid;
  elsif p_difficulty = 'MEDIUM' then
    update public.anagram_quest_stats t
      set medium_high_score = greatest(t.medium_high_score, v_score),
          medium_nine_count = t.medium_nine_count + v_nine,
          updated_at = now()
      where t.user_id = v_uid;
  else
    update public.anagram_quest_stats t
      set hard_high_score = greatest(t.hard_high_score, v_score),
          hard_nine_count = t.hard_nine_count + v_nine,
          updated_at = now()
      where t.user_id = v_uid;
  end if;

  return query
    select gs.easy_high_score, gs.medium_high_score, gs.hard_high_score,
           gs.easy_nine_count, gs.medium_nine_count, gs.hard_nine_count
    from public.anagram_quest_stats gs
    where gs.user_id = v_uid;
end;
$$;

grant execute on function public.record_anagram_quest_difficulty_result(text, int, int) to authenticated;
