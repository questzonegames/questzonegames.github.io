-- ============================================================================
-- Quest Zone — Shop: extends the EXISTING item economy foundation
-- (20260909050000_item_economy_foundation.sql /
--  20260909050100_item_economy_rpcs.sql) rather than replacing it.
-- ============================================================================
-- What already existed before this migration (unchanged, reused as-is):
--   item_definitions, player_item_stacks, item_instances,
--   economy_transactions, economy_requests, trades/trade_items/
--   trade_currency, purchase_item()/equip_item()/unequip_item()/
--   propose_trade()/accept_trade()/cancel_trade().
--
-- What this migration adds, and why each piece is needed for a real shop:
--   PART 1 — two pre-existing RLS gaps that predate the shop and would
--            otherwise let a modified client bypass EVERY protection this
--            migration adds (see each part's own comment for the exploit).
--   PART 2 — item_definitions gets a numeric_id (permanent, sequential —
--            see spec), a purchase_type ('quest_points'|'stardust'|'free'),
--            and per-player ownership limits (max owned, lifetime claims).
--   PART 3 — get_owned_quantity(): ONE authoritative function for "how many
--            of item X does player Y own right now", counting inventory +
--            stacks + instances + whatever's currently equipped.
--   PART 4 — purchase_item() is replaced (same name/signature — no frontend
--            break) to add free-claim support and enforce the new limits.
--   PART 5 — get_shop_items(): one round-trip for the whole shop grid,
--            already joined against the calling player's own ownership.
--   PART 6 — achievements get an OPTIONAL quest_points reward, reusing the
--            achievement system's existing idempotency guarantee (its own
--            primary key) rather than building a second one.
-- ============================================================================

-- ============================================================================
-- PART 1 — close two pre-existing gaps in profiles / inventory_items RLS
-- ============================================================================
-- Both of these predate the shop and neither is used by any current
-- frontend code (verified: no `.insert(...)` into inventory_items anywhere
-- in assets/js/**, and no direct `.update({ quest_points | stardust })`
-- anywhere either — every legitimate currency/inventory change already
-- goes through a SECURITY DEFINER function, which is unaffected by RLS on
-- the tables it writes). Leaving either open would make every lock,
-- limit, and idempotency check the shop RPCs below perform pointless — a
-- modified client could just skip purchase_item() entirely.

-- 1a. profiles_update_own already pins is_admin/banned_permanently/
-- banned_until so a self-UPDATE can't change them (see schema.sql) — it
-- never pinned quest_points/stardust, meaning
-- `supabase.from('profiles').update({ quest_points: 999999 })` currently
-- SUCCEEDS for a player updating their own row. Extend the same guard to
-- both currency columns; every other self-editable field (username,
-- equipped_profile_picture_id, audio settings, etc.) is untouched.
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and is_admin = (select is_admin from public.profiles where id = auth.uid())
    and banned_permanently = (select banned_permanently from public.profiles where id = auth.uid())
    and banned_until is not distinct from (select banned_until from public.profiles where id = auth.uid())
    and quest_points = (select quest_points from public.profiles where id = auth.uid())
    and stardust = (select stardust from public.profiles where id = auth.uid())
  );

-- 1b. inventory_items still has client insert/delete policies from before
-- the item economy existed — `supabase.from('inventory_items').insert({
-- user_id: me, item_id: 'admin-crown' })` currently SUCCEEDS. Every real
-- grant path (unlock_achievement, admin_grant_item, purchase_item, trade
-- settlement) is a SECURITY DEFINER function and writes this table
-- regardless of these policies, so dropping the client-facing ones costs
-- nothing legitimate.
drop policy if exists "inventory_insert_own" on public.inventory_items;
drop policy if exists "inventory_delete_own" on public.inventory_items;
-- inventory_select_own_or_admin is untouched — reading your own inventory
-- was never the risk.

-- ============================================================================
-- PART 2 — item_definitions: shop-facing columns
-- ============================================================================
-- numeric_id: item_id (text) stays the REAL primary key everywhere (every
-- other table already references it — inventory_items, player_item_stacks,
-- item_instances, equipped_items, economy_transactions, trade_items,
-- achievements.reward_item_ids). Renumbering/replacing it would touch
-- every one of those and everything in assets/js/inventory-data.js that
-- keys off it — exactly the "duplicate/second catalogue" and "renumber
-- existing items" the spec says not to do. Instead: item_id IS the stable
-- slug the spec separately asks for, and numeric_id is an ADDITIONAL,
-- permanent, sequential display number layered on top — generated once
-- per row, never reassigned, never reused.
alter table public.item_definitions add column if not exists numeric_id bigint;
create sequence if not exists public.item_definitions_numeric_id_seq;
-- Backfill existing rows in a stable, deterministic order (creation order)
-- so today's two real items get 1 and 2 — this is the "repair the
-- sequence safely before inserting" step the spec asks for, done once,
-- here, before the White T-shirt (next migration) ever asks for a number.
update public.item_definitions
  set numeric_id = nextval('public.item_definitions_numeric_id_seq')
  where numeric_id is null;
alter table public.item_definitions alter column numeric_id set not null;
alter table public.item_definitions alter column numeric_id set default nextval('public.item_definitions_numeric_id_seq');
alter sequence public.item_definitions_numeric_id_seq owned by public.item_definitions.numeric_id;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'item_definitions_numeric_id_key') then
    alter table public.item_definitions add constraint item_definitions_numeric_id_key unique (numeric_id);
  end if;
end $$;

-- purchase_type: what the SHOP shows/charges — separate from currency_type
-- (which stays meaningful for trade_currency /
-- economy_transactions.currency_type, both of which only ever mean real
-- money-like balances, never "free"). A NULL purchase_type means "not
-- obtainable through the shop at all" (admin-crown, doggy-slippers — both
-- achievement/admin-only, unchanged) and is how get_shop_items() (PART 5)
-- filters the grid down to exactly the items meant to be shop-visible,
-- without disturbing either existing item's current behaviour.
alter table public.item_definitions add column if not exists purchase_type text
  check (purchase_type in ('quest_points', 'stardust', 'free'));
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'item_definitions_purchase_type_matches_currency') then
    alter table public.item_definitions add constraint item_definitions_purchase_type_matches_currency check (
      (purchase_type is null and currency_type is null)
      or (purchase_type = 'free' and currency_type is null and shop_price is null)
      or (purchase_type in ('quest_points', 'stardust') and currency_type = purchase_type)
    );
  end if;
end $$;
-- Backfill: both existing items were never shop-purchasable (no
-- shop_price was ever set for them) — stays exactly that way.
update public.item_definitions set purchase_type = null where purchase_type is null;

-- Per-player ownership limits — null means "no limit", so every existing
-- item (which had no such concept before) is completely unaffected.
alter table public.item_definitions add column if not exists max_owned_per_player int
  check (max_owned_per_player is null or max_owned_per_player > 0);
alter table public.item_definitions add column if not exists lifetime_limit int
  check (lifetime_limit is null or lifetime_limit > 0);

-- Display metadata the shop grid needs — all optional, all additive.
alter table public.item_definitions add column if not exists slot_category text; -- mirrors equipment_slot but explicit/stable even for non-equippable future items
alter table public.item_definitions add column if not exists image_ref text;     -- placeholder-safe: null just means "no shop image yet", frontend falls back to a generic placeholder tile
alter table public.item_definitions add column if not exists display_order int not null default 0;
alter table public.item_definitions add column if not exists updated_at timestamptz not null default now();
update public.item_definitions set slot_category = equipment_slot where slot_category is null;

comment on column public.item_definitions.numeric_id is 'Permanent, sequential, additional numeric identifier. item_id (text) remains the real primary key and stable slug used by every other table — numeric_id never replaces or renumbers it.';
comment on column public.item_definitions.purchase_type is 'What the shop charges: quest_points | stardust | free | null (null = not sold in the shop at all, e.g. achievement-only items).';

-- ============================================================================
-- PART 3 — get_owned_quantity(): the ONE authoritative ownership count
-- ============================================================================
-- Counts inventory_items (simple mode: 0 or 1) + player_item_stacks.quantity
-- (stack mode) + item_instances owned (instance mode) — PLUS whatever is
-- currently sitting in equipped_items, since equip_item() only actually
-- moves ownership OUT of player_item_stacks for stack-mode items (simple/
-- instance mode ownership never moves on equip — see equip_item()/
-- unequip_item() comments in 20260909050100_item_economy_rpcs.sql). This
-- is exactly the "equipped copies must count toward ownership" rule the
-- spec requires, computed once here instead of re-implemented per caller.
create or replace function public.get_owned_quantity(p_user uuid, p_item_id text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select count(*)::int from public.inventory_items where user_id = p_user and item_id = p_item_id), 0)
    + coalesce((select quantity from public.player_item_stacks where user_id = p_user and item_id = p_item_id), 0)
    + coalesce((select count(*)::int from public.item_instances where owner_id = p_user and item_id = p_item_id), 0)
    + coalesce((
        select count(*)::int from public.equipped_items e
        join public.item_definitions d on d.item_id = e.item_id
        where e.user_id = p_user and e.item_id = p_item_id and d.instancing_mode = 'stack'
        -- simple/instance mode: equipping never moved the row out of
        -- inventory_items/item_instances in the first place, so counting
        -- equipped_items here too would double-count those two modes.
        -- Only stack-mode items are actually "removed" from the stack
        -- table while equipped.
      ), 0);
$$;
grant execute on function public.get_owned_quantity(uuid, text) to authenticated;
revoke execute on function public.get_owned_quantity(uuid, text) from public, anon;

-- lifetime_claimed_count(): how many times a player has EVER purchased/
-- claimed a given item, independent of whether they still own it —
-- counts the append-only economy_transactions ledger (which purchase_item
-- already writes to on every successful purchase/claim/mint), not current
-- ownership, so removing an item (trade, admin delete) can never reset a
-- lifetime limit.
create or replace function public.lifetime_claimed_count(p_user uuid, p_item_id text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.economy_transactions
  where user_id = p_user and item_id = p_item_id
    and event_type in ('purchase', 'mint_instance');
$$;
grant execute on function public.lifetime_claimed_count(uuid, text) to authenticated;
revoke execute on function public.lifetime_claimed_count(uuid, text) from public, anon;

-- ============================================================================
-- PART 4 — purchase_item(): same name/signature, extended in place
-- ============================================================================
-- Every existing check (auth, ban, active, quantity, stock lock,
-- idempotency, concurrency-safe row lock on item_definitions) is
-- unchanged. Added: free-claim support (purchase_type='free' skips all
-- currency handling), max_owned_per_player enforcement (via
-- get_owned_quantity — includes equipped copies), lifetime_limit
-- enforcement (via lifetime_claimed_count — survives the item leaving
-- inventory). instancing_mode='simple' items' own-instance check is now
-- driven by get_owned_quantity() too instead of a bare inventory_items
-- exists-check, so it also correctly blocks a second purchase while the
-- one copy is equipped.
create or replace function public.purchase_item(p_item_id text, p_quantity int default 1, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_def public.item_definitions%rowtype;
  v_balance int;
  v_total_cost int;
  v_serial int;
  v_instance_id uuid;
  v_cached jsonb;
  v_result jsonb;
  v_owned int;
  v_lifetime int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if public.is_banned(v_uid) then raise exception 'This account is banned.'; end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'Invalid quantity.'; end if;

  if p_request_id is not null then
    select result into v_cached from public.economy_requests
      where request_id = p_request_id and user_id = v_uid and operation = 'purchase_item';
    if v_cached is not null then
      return v_cached; -- exact same request already processed — hand back the same result, do nothing else
    end if;
  end if;

  select * into v_def from public.item_definitions where item_id = p_item_id for update;
  if v_def.item_id is null or not v_def.active or v_def.discontinued then
    raise exception 'This item is not available.';
  end if;
  if v_def.purchase_type is null then
    raise exception 'This item is not purchasable.';
  end if;
  if v_def.instancing_mode != 'stack' and p_quantity != 1 then
    raise exception 'This item can only be purchased one at a time.';
  end if;

  -- lifetime claim limit — checked FIRST and against the permanent ledger,
  -- not current ownership, so it still blocks a second claim even if the
  -- player no longer has the item.
  if v_def.lifetime_limit is not null then
    v_lifetime := public.lifetime_claimed_count(v_uid, p_item_id);
    if v_lifetime + p_quantity > v_def.lifetime_limit then
      raise exception 'You have already claimed the maximum number of this item.';
    end if;
  end if;

  -- max-owned-at-once limit — includes equipped copies (get_owned_quantity)
  if v_def.max_owned_per_player is not null then
    v_owned := public.get_owned_quantity(v_uid, p_item_id);
    if v_owned + p_quantity > v_def.max_owned_per_player then
      raise exception 'You already own the maximum number of this item.';
    end if;
  end if;

  -- simple-mode items are additionally "own one or none" by construction
  -- (inventory_items' own primary key), independent of max_owned_per_player
  -- being set — this is the exact "already own it" guard purchase_item
  -- always had, now equipped-aware via get_owned_quantity.
  if v_def.instancing_mode = 'simple' and public.get_owned_quantity(v_uid, p_item_id) > 0 then
    raise exception 'You already own this item.';
  end if;

  if v_def.stock_type = 'limited' and v_def.issued_count + p_quantity > v_def.edition_size then
    raise exception 'Out of stock.';
  end if;

  if v_def.purchase_type = 'free' then
    v_total_cost := 0;
  else
    v_total_cost := v_def.shop_price * p_quantity;
    if v_def.currency_type = 'quest_points' then
      select quest_points into v_balance from public.profiles where id = v_uid for update;
    else
      select stardust into v_balance from public.profiles where id = v_uid for update;
    end if;
    if v_balance is null or v_balance < v_total_cost then
      raise exception 'Not enough %.', v_def.currency_type;
    end if;
    if v_def.currency_type = 'quest_points' then
      update public.profiles set quest_points = quest_points - v_total_cost where id = v_uid;
    else
      update public.profiles set stardust = stardust - v_total_cost where id = v_uid;
    end if;
  end if;

  if v_def.instancing_mode = 'instance' then
    v_serial := v_def.issued_count + 1;
    insert into public.item_instances (item_id, serial_number, owner_id)
      values (p_item_id, v_serial, v_uid)
      returning instance_id into v_instance_id;
    update public.item_definitions set issued_count = issued_count + 1 where item_id = p_item_id;
    insert into public.economy_transactions (event_type, user_id, item_id, instance_id, currency_type, currency_amount, request_id, detail)
      values ('mint_instance', v_uid, p_item_id, v_instance_id,
              case when v_def.purchase_type = 'free' then null else v_def.currency_type end,
              v_total_cost, p_request_id,
              jsonb_build_object('serial_number', v_serial, 'edition_size', v_def.edition_size));
    v_result := jsonb_build_object('item_id', p_item_id, 'instance_id', v_instance_id, 'serial_number', v_serial, 'edition_size', v_def.edition_size);
  elsif v_def.instancing_mode = 'stack' then
    insert into public.player_item_stacks (user_id, item_id, quantity) values (v_uid, p_item_id, p_quantity)
      on conflict (user_id, item_id) do update set quantity = player_item_stacks.quantity + excluded.quantity, updated_at = now();
    insert into public.economy_transactions (event_type, user_id, item_id, quantity, currency_type, currency_amount, request_id)
      values ('purchase', v_uid, p_item_id, p_quantity,
              case when v_def.purchase_type = 'free' then null else v_def.currency_type end, v_total_cost, p_request_id);
    v_result := jsonb_build_object('item_id', p_item_id, 'quantity_purchased', p_quantity);
  else
    insert into public.inventory_items (user_id, item_id) values (v_uid, p_item_id)
      on conflict (user_id, item_id) do nothing;
    insert into public.economy_transactions (event_type, user_id, item_id, currency_type, currency_amount, request_id)
      values ('purchase', v_uid, p_item_id,
              case when v_def.purchase_type = 'free' then null else v_def.currency_type end, v_total_cost, p_request_id);
    v_result := jsonb_build_object('item_id', p_item_id, 'quantity_purchased', 1);
  end if;

  if p_request_id is not null then
    insert into public.economy_requests (request_id, user_id, operation, result)
      values (p_request_id, v_uid, 'purchase_item', v_result);
  end if;

  return v_result;
end;
$$;
grant execute on function public.purchase_item(text, int, uuid) to authenticated;
revoke execute on function public.purchase_item(text, int, uuid) from public, anon;

-- ============================================================================
-- PART 5 — get_shop_items(): one call for the whole shop grid
-- ============================================================================
-- Returns only items with a non-null purchase_type (i.e. actually meant to
-- be shop-visible) that are active and not discontinued, already joined
-- against the CALLING player's own ownership/claim state — the frontend
-- never separately queries per-item ownership for the grid. Safe to call
-- signed-out too (auth.uid() is null -> every "own_*" field is just 0/false).
create or replace function public.get_shop_items()
returns table (
  item_id text,
  numeric_id bigint,
  name text,
  description text,
  equipment_slot text,
  purchase_type text,
  currency_type text,
  shop_price int,
  tradeable boolean,
  instancing_mode text,
  stock_type text,
  edition_size int,
  issued_count int,
  remaining_stock int,
  max_owned_per_player int,
  lifetime_limit int,
  image_ref text,
  display_order int,
  owned_quantity int,
  lifetime_claimed int,
  sold_out boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    d.item_id, d.numeric_id, d.name, d.description, d.equipment_slot,
    d.purchase_type, d.currency_type, d.shop_price, d.tradeable,
    d.instancing_mode, d.stock_type, d.edition_size, d.issued_count,
    case when d.stock_type = 'limited' then greatest(d.edition_size - d.issued_count, 0) else null end as remaining_stock,
    d.max_owned_per_player, d.lifetime_limit, d.image_ref, d.display_order,
    coalesce(public.get_owned_quantity(auth.uid(), d.item_id), 0) as owned_quantity,
    coalesce(public.lifetime_claimed_count(auth.uid(), d.item_id), 0) as lifetime_claimed,
    (d.stock_type = 'limited' and d.issued_count >= d.edition_size) as sold_out
  from public.item_definitions d
  where d.purchase_type is not null and d.active and not d.discontinued
  order by d.display_order, d.numeric_id;
$$;
grant execute on function public.get_shop_items() to authenticated, anon;
revoke execute on function public.get_shop_items() from public;

-- ============================================================================
-- PART 6 — achievements: optional Quest Points reward (foundation only —
-- every existing achievement defaults to 0, i.e. no behaviour change; real
-- values are a product decision, not a database one — see final report)
-- ============================================================================
alter table public.achievements add column if not exists reward_quest_points int not null default 0
  check (reward_quest_points >= 0);

alter table public.economy_transactions drop constraint if exists economy_transactions_event_type_check;
alter table public.economy_transactions add constraint economy_transactions_event_type_check check (event_type in (
  'purchase', 'mint_instance', 'trade_settled', 'trade_cancelled',
  'equip', 'unequip', 'admin_grant', 'achievement_reward'
));

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

  -- Reward grant — only ever reached once per account per achievement, see
  -- unlocked_achievements' own primary key.
  if v_ach.reward_item_ids is not null then
    insert into public.inventory_items (user_id, item_id)
    select v_uid, item_id from unnest(v_ach.reward_item_ids) as item_id
    on conflict (user_id, item_id) do nothing;
  end if;
  if v_ach.reward_quest_points > 0 then
    update public.profiles set quest_points = quest_points + v_ach.reward_quest_points where id = v_uid;
    insert into public.economy_transactions (event_type, user_id, currency_type, currency_amount, detail)
      values ('achievement_reward', v_uid, 'quest_points', v_ach.reward_quest_points,
              jsonb_build_object('achievement_id', p_achievement_id));
  end if;

  return query select true, v_at;
end;
$$;
grant execute on function public.unlock_achievement(text) to authenticated;
revoke execute on function public.unlock_achievement(text) from public, anon;
