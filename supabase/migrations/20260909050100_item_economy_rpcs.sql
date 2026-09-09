-- ============================================================================
-- Quest Zone — item economy RPCs (purchase, equip/unequip, trading)
-- ============================================================================
-- Every function here is SECURITY DEFINER and is the ONLY way its
-- corresponding tables (from 20260909050000_item_economy_foundation.sql)
-- are ever written — there is no direct client insert/update/delete policy
-- on item_definitions, player_item_stacks, item_instances,
-- economy_transactions, economy_requests, trades, trade_items, or
-- trade_currency. A modified browser client can call these functions with
-- different ARGUMENTS, but every argument is independently re-validated
-- against real database state inside the function — never trusted.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- purchase_item() — the one entry point for buying ANY item, regardless of
-- instancing_mode. Handles currency deduction, stock/edition limits, and
-- idempotent retries all in one atomic call.
--
-- Concurrency safety ("two buyers, one last copy"): `select ... for update`
-- on the item_definitions row makes every concurrent purchase_item() call
-- for the SAME item_id queue up and execute one at a time — the second
-- buyer's transaction only proceeds once the first has fully committed
-- (issued_count already incremented), so it correctly sees "out of stock"
-- instead of racing past the edition_size check. This is a real Postgres
-- row lock, not an application-level check.
-- ----------------------------------------------------------------------------
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
  if v_def.item_id is null or not v_def.active then
    raise exception 'This item is not available.';
  end if;
  if v_def.shop_price is null then
    raise exception 'This item is not purchasable.';
  end if;
  if v_def.instancing_mode != 'stack' and p_quantity != 1 then
    raise exception 'This item can only be purchased one at a time.';
  end if;

  if v_def.instancing_mode = 'simple' and exists (
    select 1 from public.inventory_items where user_id = v_uid and item_id = p_item_id
  ) then
    raise exception 'You already own this item.';
  end if;

  if v_def.stock_type = 'limited' and v_def.issued_count + p_quantity > v_def.edition_size then
    raise exception 'Out of stock.';
  end if;

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

  if v_def.instancing_mode = 'instance' then
    v_serial := v_def.issued_count + 1;
    insert into public.item_instances (item_id, serial_number, owner_id)
      values (p_item_id, v_serial, v_uid)
      returning instance_id into v_instance_id;
    update public.item_definitions set issued_count = issued_count + 1 where item_id = p_item_id;
    insert into public.economy_transactions (event_type, user_id, item_id, instance_id, currency_type, currency_amount, request_id, detail)
      values ('mint_instance', v_uid, p_item_id, v_instance_id, v_def.currency_type, v_total_cost, p_request_id,
              jsonb_build_object('serial_number', v_serial, 'edition_size', v_def.edition_size));
    v_result := jsonb_build_object('item_id', p_item_id, 'instance_id', v_instance_id, 'serial_number', v_serial, 'edition_size', v_def.edition_size);
  elsif v_def.instancing_mode = 'stack' then
    insert into public.player_item_stacks (user_id, item_id, quantity) values (v_uid, p_item_id, p_quantity)
      on conflict (user_id, item_id) do update set quantity = player_item_stacks.quantity + excluded.quantity, updated_at = now();
    insert into public.economy_transactions (event_type, user_id, item_id, quantity, currency_type, currency_amount, request_id)
      values ('purchase', v_uid, p_item_id, p_quantity, v_def.currency_type, v_total_cost, p_request_id);
    v_result := jsonb_build_object('item_id', p_item_id, 'quantity_purchased', p_quantity);
  else
    insert into public.inventory_items (user_id, item_id) values (v_uid, p_item_id)
      on conflict (user_id, item_id) do nothing;
    insert into public.economy_transactions (event_type, user_id, item_id, currency_type, currency_amount, request_id)
      values ('purchase', v_uid, p_item_id, v_def.currency_type, v_total_cost, p_request_id);
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

-- ----------------------------------------------------------------------------
-- equip_item() / unequip_item() — replace inventory.js's old DIRECT writes
-- to equipped_items (see PART 4 of the previous migration, which revoked
-- those policies). For a stack-mode item, equipping/unequipping now moves
-- ONE unit between player_item_stacks and the slot atomically — a client
-- can no longer equip an item it doesn't actually have a unit of, or
-- desync the stack count from what's really equipped.
-- ----------------------------------------------------------------------------
create or replace function public.unequip_item(p_slot text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.equipped_items%rowtype;
  v_def public.item_definitions%rowtype;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  select * into v_row from public.equipped_items where user_id = v_uid and slot = p_slot;
  if v_row.user_id is null then return; end if; -- nothing equipped there — silent no-op

  select * into v_def from public.item_definitions where item_id = v_row.item_id;
  if v_def.instancing_mode = 'stack' then
    insert into public.player_item_stacks (user_id, item_id, quantity) values (v_uid, v_row.item_id, 1)
      on conflict (user_id, item_id) do update set quantity = player_item_stacks.quantity + 1, updated_at = now();
  end if;
  -- simple/instance modes: ownership (inventory_items / item_instances.owner_id)
  -- was never moved by equipping in the first place, nothing to restore.

  delete from public.equipped_items where user_id = v_uid and slot = p_slot;
  insert into public.economy_transactions (event_type, user_id, item_id, instance_id)
    values ('unequip', v_uid, v_row.item_id, v_row.instance_id);
end;
$$;
grant execute on function public.unequip_item(text) to authenticated;

create or replace function public.equip_item(p_slot text, p_item_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_def public.item_definitions%rowtype;
  v_instance_id uuid := null;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if public.is_banned(v_uid) then raise exception 'This account is banned.'; end if;

  select * into v_def from public.item_definitions where item_id = p_item_id;
  if v_def.item_id is null then raise exception 'Unknown item.'; end if;
  if v_def.equipment_slot is null or v_def.equipment_slot != p_slot then
    raise exception 'This item does not go in that slot.';
  end if;

  if v_def.instancing_mode = 'stack' then
    update public.player_item_stacks set quantity = quantity - 1, updated_at = now()
      where user_id = v_uid and item_id = p_item_id and quantity > 0;
    if not found then raise exception 'You do not own that item.'; end if;
    delete from public.player_item_stacks where user_id = v_uid and item_id = p_item_id and quantity <= 0;
  elsif v_def.instancing_mode = 'instance' then
    select instance_id into v_instance_id from public.item_instances
      where item_id = p_item_id and owner_id = v_uid limit 1;
    if v_instance_id is null then raise exception 'You do not own that item.'; end if;
  else
    if not exists (select 1 from public.inventory_items where user_id = v_uid and item_id = p_item_id) then
      raise exception 'You do not own that item.';
    end if;
  end if;

  perform public.unequip_item(p_slot); -- returns whatever was previously in this slot first

  insert into public.equipped_items (user_id, slot, item_id, instance_id)
    values (v_uid, p_slot, p_item_id, v_instance_id)
    on conflict (user_id, slot) do update set item_id = excluded.item_id, instance_id = excluded.instance_id;

  insert into public.economy_transactions (event_type, user_id, item_id, instance_id)
    values ('equip', v_uid, p_item_id, v_instance_id);
end;
$$;
grant execute on function public.equip_item(text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- propose_trade() — initiator creates a pending trade with their own offer
-- attached. Light validation only (existence, recipient real) — the
-- AUTHORITATIVE check happens in accept_trade below, per spec rule 16:
-- never trust state from when an item was first placed in the trade.
-- ----------------------------------------------------------------------------
create or replace function public.propose_trade(p_recipient uuid, p_items jsonb default '[]'::jsonb, p_currency jsonb default '[]'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trade_id uuid;
  v_item jsonb;
  v_cur jsonb;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if public.is_banned(v_uid) then raise exception 'This account is banned.'; end if;
  if p_recipient is null or p_recipient = v_uid then raise exception 'Invalid trade recipient.'; end if;
  if not exists (select 1 from public.profiles where id = p_recipient) then
    raise exception 'That player does not exist.';
  end if;

  insert into public.trades (initiator_id, recipient_id) values (v_uid, p_recipient)
    returning trade_id into v_trade_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into public.trade_items (trade_id, side, item_id, instance_id, quantity)
      values (v_trade_id, 'initiator', v_item->>'item_id', nullif(v_item->>'instance_id', '')::uuid, nullif(v_item->>'quantity', '')::int);
  end loop;
  for v_cur in select * from jsonb_array_elements(coalesce(p_currency, '[]'::jsonb)) loop
    insert into public.trade_currency (trade_id, side, currency_type, amount)
      values (v_trade_id, 'initiator', v_cur->>'currency_type', (v_cur->>'amount')::int);
  end loop;

  return v_trade_id;
end;
$$;
grant execute on function public.propose_trade(uuid, jsonb, jsonb) to authenticated;

create or replace function public.cancel_trade(p_trade_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trade public.trades%rowtype;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  select * into v_trade from public.trades where trade_id = p_trade_id for update;
  if v_trade.trade_id is null then raise exception 'Trade not found.'; end if;
  if v_trade.initiator_id != v_uid and v_trade.recipient_id != v_uid then raise exception 'Not your trade.'; end if;
  if v_trade.status != 'pending' then raise exception 'This trade is no longer pending.'; end if;

  update public.trades set status = 'cancelled' where trade_id = p_trade_id;
  insert into public.economy_transactions (event_type, user_id, counterparty_id, detail)
    values ('trade_cancelled', v_uid,
            case when v_trade.initiator_id = v_uid then v_trade.recipient_id else v_trade.initiator_id end,
            jsonb_build_object('trade_id', p_trade_id));
end;
$$;
grant execute on function public.cancel_trade(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- accept_trade() — the recipient supplies their own offer AND settles the
-- ENTIRE trade in this one call. Everything below either all happens or
-- none of it does (a single Postgres transaction — any `raise exception`
-- rolls back every change made so far in this call, including the
-- recipient's own just-inserted trade_items/trade_currency rows).
--
-- Deadlock avoidance: every row this function locks (the two profiles
-- rows, every distinct item_definitions row involved) is locked in a
-- fixed, sorted order — never "whichever side happens first" — so two
-- concurrent trades can never lock each other's rows in opposite order
-- and deadlock.
-- ----------------------------------------------------------------------------
create or replace function public.accept_trade(p_trade_id uuid, p_items jsonb default '[]'::jsonb, p_currency jsonb default '[]'::jsonb, p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trade public.trades%rowtype;
  v_item jsonb;
  v_cur jsonb;
  v_cached jsonb;
  v_result jsonb;
  v_row record;
  v_giver uuid;
  v_receiver uuid;
  v_def public.item_definitions%rowtype;
  v_owned_qty int;
  v_first uuid;
  v_second uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if public.is_banned(v_uid) then raise exception 'This account is banned.'; end if;

  if p_request_id is not null then
    select result into v_cached from public.economy_requests
      where request_id = p_request_id and user_id = v_uid and operation = 'accept_trade';
    if v_cached is not null then return v_cached; end if;
  end if;

  select * into v_trade from public.trades where trade_id = p_trade_id for update;
  if v_trade.trade_id is null then raise exception 'Trade not found.'; end if;
  if v_trade.recipient_id != v_uid then raise exception 'Only the recipient can accept this trade.'; end if;
  if v_trade.status != 'pending' then raise exception 'This trade is no longer pending.'; end if;

  -- attach the recipient's offer now, at accept time
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into public.trade_items (trade_id, side, item_id, instance_id, quantity)
      values (p_trade_id, 'recipient', v_item->>'item_id', nullif(v_item->>'instance_id', '')::uuid, nullif(v_item->>'quantity', '')::int);
  end loop;
  for v_cur in select * from jsonb_array_elements(coalesce(p_currency, '[]'::jsonb)) loop
    insert into public.trade_currency (trade_id, side, currency_type, amount)
      values (p_trade_id, 'recipient', v_cur->>'currency_type', (v_cur->>'amount')::int);
  end loop;

  -- lock both players' profile rows in a FIXED order (sorted by uuid text)
  -- regardless of who's initiator/recipient here, so a trade A<->B and a
  -- trade B<->A running concurrently can't deadlock on the profiles table
  if v_trade.initiator_id::text < v_trade.recipient_id::text then
    v_first := v_trade.initiator_id; v_second := v_trade.recipient_id;
  else
    v_first := v_trade.recipient_id; v_second := v_trade.initiator_id;
  end if;
  perform 1 from public.profiles where id = v_first for update;
  perform 1 from public.profiles where id = v_second for update;

  -- lock every distinct item_definitions row this trade touches, sorted,
  -- same deadlock-avoidance reasoning as above — this also doubles as the
  -- authoritative TRADEABILITY check (rule 7/8: reject untradeable items
  -- server-side, unconditionally)
  for v_def in
    select d.* from public.item_definitions d
    where d.item_id in (select distinct item_id from public.trade_items where trade_id = p_trade_id)
    order by d.item_id
    for update
  loop
    if not v_def.tradeable then
      raise exception 'Item "%" is untradeable and cannot be part of a trade.', v_def.name;
    end if;
  end loop;

  -- REVALIDATE every offered item against CURRENT ownership — never trust
  -- whatever was true when propose_trade/this call's own inserts happened
  -- a moment ago; another operation could have changed things since.
  for v_row in select * from public.trade_items where trade_id = p_trade_id loop
    v_giver := case when v_row.side = 'initiator' then v_trade.initiator_id else v_trade.recipient_id end;
    select * into v_def from public.item_definitions where item_id = v_row.item_id;

    if v_def.instancing_mode = 'stack' then
      select quantity into v_owned_qty from public.player_item_stacks
        where user_id = v_giver and item_id = v_row.item_id for update;
      if v_owned_qty is null or v_owned_qty < v_row.quantity then
        raise exception 'Insufficient quantity of "%" to complete this trade.', v_def.name;
      end if;
    elsif v_def.instancing_mode = 'instance' then
      if not exists (
        select 1 from public.item_instances
        where instance_id = v_row.instance_id and item_id = v_row.item_id and owner_id = v_giver
        for update
      ) then
        raise exception 'Item instance no longer owned by the offering player — trade cancelled.';
      end if;
    else
      if not exists (select 1 from public.inventory_items where user_id = v_giver and item_id = v_row.item_id) then
        raise exception 'Item "%" no longer owned by the offering player.', v_def.name;
      end if;
    end if;
  end loop;

  -- REVALIDATE currency balances
  for v_row in
    select side, currency_type, sum(amount) as total from public.trade_currency
    where trade_id = p_trade_id group by side, currency_type
  loop
    v_giver := case when v_row.side = 'initiator' then v_trade.initiator_id else v_trade.recipient_id end;
    if v_row.currency_type = 'quest_points' then
      if (select quest_points from public.profiles where id = v_giver) < v_row.total then
        raise exception 'Insufficient Quest Points to complete this trade.';
      end if;
    else
      if (select stardust from public.profiles where id = v_giver) < v_row.total then
        raise exception 'Insufficient Stardust to complete this trade.';
      end if;
    end if;
  end loop;

  -- Every check passed — now actually move everything. Nothing above this
  -- line wrote any ownership change; everything below is unconditional
  -- once reached, and if ANY of it somehow still failed, the whole
  -- function's exception would roll back all of it together.
  for v_row in select * from public.trade_items where trade_id = p_trade_id loop
    v_giver := case when v_row.side = 'initiator' then v_trade.initiator_id else v_trade.recipient_id end;
    v_receiver := case when v_row.side = 'initiator' then v_trade.recipient_id else v_trade.initiator_id end;
    select * into v_def from public.item_definitions where item_id = v_row.item_id;

    if v_def.instancing_mode = 'stack' then
      update public.player_item_stacks set quantity = quantity - v_row.quantity, updated_at = now()
        where user_id = v_giver and item_id = v_row.item_id;
      delete from public.player_item_stacks where user_id = v_giver and item_id = v_row.item_id and quantity <= 0;
      insert into public.player_item_stacks (user_id, item_id, quantity) values (v_receiver, v_row.item_id, v_row.quantity)
        on conflict (user_id, item_id) do update set quantity = player_item_stacks.quantity + excluded.quantity, updated_at = now();
    elsif v_def.instancing_mode = 'instance' then
      -- moves the SAME row — instance_id and serial_number are untouched,
      -- only owner_id changes (rule 8: transfer, never recreate)
      update public.item_instances set owner_id = v_receiver where instance_id = v_row.instance_id;
    else
      delete from public.inventory_items where user_id = v_giver and item_id = v_row.item_id;
      insert into public.inventory_items (user_id, item_id) values (v_receiver, v_row.item_id)
        on conflict (user_id, item_id) do nothing;
    end if;

    insert into public.economy_transactions (event_type, user_id, counterparty_id, item_id, instance_id, quantity, detail)
      values ('trade_settled', v_giver, v_receiver, v_row.item_id, v_row.instance_id, v_row.quantity, jsonb_build_object('trade_id', p_trade_id, 'direction', 'sent'));
    insert into public.economy_transactions (event_type, user_id, counterparty_id, item_id, instance_id, quantity, detail)
      values ('trade_settled', v_receiver, v_giver, v_row.item_id, v_row.instance_id, v_row.quantity, jsonb_build_object('trade_id', p_trade_id, 'direction', 'received'));
  end loop;

  for v_row in select * from public.trade_currency where trade_id = p_trade_id loop
    v_giver := case when v_row.side = 'initiator' then v_trade.initiator_id else v_trade.recipient_id end;
    v_receiver := case when v_row.side = 'initiator' then v_trade.recipient_id else v_trade.initiator_id end;
    if v_row.currency_type = 'quest_points' then
      update public.profiles set quest_points = quest_points - v_row.amount where id = v_giver;
      update public.profiles set quest_points = quest_points + v_row.amount where id = v_receiver;
    else
      update public.profiles set stardust = stardust - v_row.amount where id = v_giver;
      update public.profiles set stardust = stardust + v_row.amount where id = v_receiver;
    end if;
    insert into public.economy_transactions (event_type, user_id, counterparty_id, currency_type, currency_amount, detail)
      values ('trade_settled', v_giver, v_receiver, v_row.currency_type, v_row.amount, jsonb_build_object('trade_id', p_trade_id, 'direction', 'sent'));
  end loop;

  update public.trades set status = 'completed', completed_at = now() where trade_id = p_trade_id;

  v_result := jsonb_build_object('trade_id', p_trade_id, 'status', 'completed');
  if p_request_id is not null then
    insert into public.economy_requests (request_id, user_id, operation, result)
      values (p_request_id, v_uid, 'accept_trade', v_result);
  end if;
  return v_result;
end;
$$;
grant execute on function public.accept_trade(uuid, jsonb, jsonb, uuid) to authenticated;
