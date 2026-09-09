-- ============================================================================
-- Fix: a stack decrement that lands exactly on zero was attempted as an
-- UPDATE ... SET quantity = 0 (violating player_item_stacks'
-- quantity > 0 CHECK immediately, since Postgres validates a CHECK at
-- the end of the statement that violates it — a later DELETE never got
-- a chance to run) instead of deleting the row outright when the
-- resulting quantity would be <= 0. Found by the trade test suite:
-- trading away an item down to a giver's last unit failed with
-- "violates check constraint player_item_stacks_quantity_positive".
-- Same latent bug existed in equip_item()'s decrement. Fixed in both.
-- ============================================================================

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
  v_cur_qty int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if public.is_banned(v_uid) then raise exception 'This account is banned.'; end if;

  select * into v_def from public.item_definitions where item_id = p_item_id;
  if v_def.item_id is null then raise exception 'Unknown item.'; end if;
  if v_def.equipment_slot is null or v_def.equipment_slot != p_slot then
    raise exception 'This item does not go in that slot.';
  end if;

  if v_def.instancing_mode = 'stack' then
    select quantity into v_cur_qty from public.player_item_stacks
      where user_id = v_uid and item_id = p_item_id for update;
    if v_cur_qty is null or v_cur_qty < 1 then raise exception 'You do not own that item.'; end if;
    if v_cur_qty = 1 then
      delete from public.player_item_stacks where user_id = v_uid and item_id = p_item_id;
    else
      update public.player_item_stacks set quantity = quantity - 1, updated_at = now()
        where user_id = v_uid and item_id = p_item_id;
    end if;
  elsif v_def.instancing_mode = 'instance' then
    select instance_id into v_instance_id from public.item_instances
      where item_id = p_item_id and owner_id = v_uid limit 1;
    if v_instance_id is null then raise exception 'You do not own that item.'; end if;
  else
    if not exists (select 1 from public.inventory_items where user_id = v_uid and item_id = p_item_id) then
      raise exception 'You do not own that item.';
    end if;
  end if;

  perform public.unequip_item(p_slot);

  insert into public.equipped_items (user_id, slot, item_id, instance_id)
    values (v_uid, p_slot, p_item_id, v_instance_id)
    on conflict (user_id, slot) do update set item_id = excluded.item_id, instance_id = excluded.instance_id;

  insert into public.economy_transactions (event_type, user_id, item_id, instance_id)
    values ('equip', v_uid, p_item_id, v_instance_id);
end;
$$;
grant execute on function public.equip_item(text, text) to authenticated;

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

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    insert into public.trade_items (trade_id, side, item_id, instance_id, quantity)
      values (p_trade_id, 'recipient', v_item->>'item_id', nullif(v_item->>'instance_id', '')::uuid, nullif(v_item->>'quantity', '')::int);
  end loop;
  for v_cur in select * from jsonb_array_elements(coalesce(p_currency, '[]'::jsonb)) loop
    insert into public.trade_currency (trade_id, side, currency_type, amount)
      values (p_trade_id, 'recipient', v_cur->>'currency_type', (v_cur->>'amount')::int);
  end loop;

  if v_trade.initiator_id::text < v_trade.recipient_id::text then
    v_first := v_trade.initiator_id; v_second := v_trade.recipient_id;
  else
    v_first := v_trade.recipient_id; v_second := v_trade.initiator_id;
  end if;
  perform 1 from public.profiles where id = v_first for update;
  perform 1 from public.profiles where id = v_second for update;

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

  for v_row in select * from public.trade_items where trade_id = p_trade_id loop
    v_giver := case when v_row.side = 'initiator' then v_trade.initiator_id else v_trade.recipient_id end;
    v_receiver := case when v_row.side = 'initiator' then v_trade.recipient_id else v_trade.initiator_id end;
    select * into v_def from public.item_definitions where item_id = v_row.item_id;

    if v_def.instancing_mode = 'stack' then
      select quantity into v_owned_qty from public.player_item_stacks where user_id = v_giver and item_id = v_row.item_id;
      if v_owned_qty - v_row.quantity <= 0 then
        delete from public.player_item_stacks where user_id = v_giver and item_id = v_row.item_id;
      else
        update public.player_item_stacks set quantity = quantity - v_row.quantity, updated_at = now()
          where user_id = v_giver and item_id = v_row.item_id;
      end if;
      insert into public.player_item_stacks (user_id, item_id, quantity) values (v_receiver, v_row.item_id, v_row.quantity)
        on conflict (user_id, item_id) do update set quantity = player_item_stacks.quantity + excluded.quantity, updated_at = now();
    elsif v_def.instancing_mode = 'instance' then
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
