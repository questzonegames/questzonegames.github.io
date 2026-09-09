-- ============================================================================
-- Achievement item rewards — generic support for an achievement granting
-- one or more real inventory items the moment it's unlocked, plus the
-- first achievement to use it: "Welcome to Your Profile" (renamed from
-- "Welcome to Quest Zone", re-triggered on a first real Profile-page
-- visit instead of every login) awarding Doggy Slippers.
-- ============================================================================

-- ---- 1. generic reward support on the catalog ----
-- An array (not a single column) so one achievement can eventually award
-- several items without another migration later — every current
-- achievement leaves this null (no reward), unaffected. Item IDs here are
-- NOT foreign-keyed to a database items table on purpose: the item
-- catalog itself is reference data that lives in code (assets/js/
-- inventory-data.js — see its own header comment), exactly like
-- inventory_items.item_id already isn't FK'd to anything for the same
-- reason. Keeping that split means adding a new item is a code change
-- (reviewable, versioned, deployable independently of the database) while
-- who owns/earned what stays real per-account Supabase data.
alter table public.achievements add column if not exists reward_item_ids text[];

-- ---- 2. grant reward item(s) the moment an achievement is FIRST unlocked
-- ---- (idempotent — see below) ----
-- Same signature as the function already live after this session's two
-- prior bugfixes (see 20260909020200_fix_unlock_achievement_out_param_
-- shadowing.sql) — only the body changes, adding the reward grant.
create or replace function public.unlock_achievement(p_achievement_id text)
returns table (newly_unlocked boolean, unlocked_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ach public.achievements%rowtype;
  v_already boolean;
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if public.is_banned(v_uid) then
    raise exception 'This account is banned.';
  end if;

  select * into v_ach from public.achievements ach where ach.achievement_id = p_achievement_id;
  if v_ach.achievement_id is null then
    raise exception 'Unknown achievement: %', p_achievement_id;
  end if;

  select exists(
    select 1 from public.unlocked_achievements ua
    where ua.user_id = v_uid and ua.achievement_id = p_achievement_id
  ) into v_already;
  if v_already then
    select ua.unlocked_at into v_at from public.unlocked_achievements ua
      where ua.user_id = v_uid and ua.achievement_id = p_achievement_id;
    return query select false, v_at;
    return;
  end if;

  if v_ach.requirement_type is not null and not public.achievement_requirement_met(v_uid, p_achievement_id) then
    return query select false, null::timestamptz;
    return;
  end if;

  insert into public.unlocked_achievements (user_id, achievement_id)
    values (v_uid, p_achievement_id)
    on conflict (user_id, achievement_id) do nothing
    returning unlocked_achievements.unlocked_at into v_at;

  if v_at is null then
    -- lost a race with a concurrent call — treat exactly like "already had
    -- it" (reward, if any, was already granted by whichever call won)
    select ua.unlocked_at into v_at from public.unlocked_achievements ua
      where ua.user_id = v_uid and ua.achievement_id = p_achievement_id;
    return query select false, v_at;
    return;
  end if;

  -- Reward grant — only ever reached once per account per achievement,
  -- since every path above already returns early on any unlock that
  -- isn't genuinely brand new. inventory_items' own primary key
  -- (user_id, item_id) is the actual duplicate-proofing: "on conflict do
  -- nothing" makes this safe even under a concurrent double-call, a
  -- retried request, or (hypothetically) the same item being listed as a
  -- reward on two different achievements — an account can only ever hold
  -- one row for a given item id no matter how many times this runs.
  -- granted_by is left null (unlike admin_grant_item's admin-attributed
  -- grants) — assets/js/item-notify.js's "you received an item" popup
  -- already reads a null granted_by as a plain, non-gifted pickup.
  if v_ach.reward_item_ids is not null then
    insert into public.inventory_items (user_id, item_id)
    select v_uid, item_id from unnest(v_ach.reward_item_ids) as item_id
    on conflict (user_id, item_id) do nothing;
  end if;

  return query select true, v_at;
end;
$$;
grant execute on function public.unlock_achievement(text) to authenticated;

-- ---- 3. rename misc_first_login -> welcome_to_your_profile ----
-- Re-triggered on a first real Profile-page visit (see profile/index.html)
-- instead of on every getProfile() call (which fired on login and on
-- basically every other page too — see assets/js/qz-auth.js, whose call
-- to the old id is removed in this same change). Upserted by id, then
-- any already-unlocked/pinned rows under the OLD id are carried over to
-- the new one rather than losing a returning player's progress — an
-- achievement rename shouldn't re-lock something already earned.
insert into public.achievements
  (achievement_id, name, description, icon, tier, sort_order, category, game_key, requirement_type, requirement_game_key, requirement_value, reward_item_ids)
values
  ('welcome_to_your_profile', 'Welcome to Your Profile', 'Visit your own Profile page for the first time.', '👋', 'bronze', 300, 'misc', null, null, null, null, array['doggy-slippers'])
on conflict (achievement_id) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  tier = excluded.tier,
  sort_order = excluded.sort_order,
  category = excluded.category,
  reward_item_ids = excluded.reward_item_ids;

update public.unlocked_achievements ua
  set achievement_id = 'welcome_to_your_profile'
  where ua.achievement_id = 'misc_first_login'
  and not exists (
    select 1 from public.unlocked_achievements u2
    where u2.user_id = ua.user_id and u2.achievement_id = 'welcome_to_your_profile'
  );
-- any leftover rows under the old id (only possible if an account
-- somehow already had both) are just stale duplicates now — safe to drop
delete from public.unlocked_achievements where achievement_id = 'misc_first_login';

update public.pinned_achievements set achievement_id = 'welcome_to_your_profile' where achievement_id = 'misc_first_login';

delete from public.achievements where achievement_id = 'misc_first_login';
