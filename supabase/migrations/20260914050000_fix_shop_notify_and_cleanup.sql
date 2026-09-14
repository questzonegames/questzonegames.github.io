-- ============================================================================
-- Fix: a shop purchase/claim was ALSO triggering item-notify.js's passive
-- "🎉 You received an item!" popup on the player's next page load — that
-- popup (see assets/js/item-notify.js) is meant for a SURPRISE grant
-- (achievement reward, admin gift), not something the player just
-- consciously bought/claimed in the shop, which already gets its own
-- immediate "Claimed!" toast on the Shop page itself. The popup fires for
-- any inventory_items row with notified_at still null — purchase_item()
-- never set it, so every simple-mode shop grant looked exactly like a
-- surprise gift the next time any page loaded.
-- ============================================================================
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
      return v_cached;
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

  if v_def.lifetime_limit is not null then
    v_lifetime := public.lifetime_claimed_count(v_uid, p_item_id);
    if v_lifetime + p_quantity > v_def.lifetime_limit then
      raise exception 'You have already claimed the maximum number of this item.';
    end if;
  end if;

  if v_def.max_owned_per_player is not null then
    v_owned := public.get_owned_quantity(v_uid, p_item_id);
    if v_owned + p_quantity > v_def.max_owned_per_player then
      raise exception 'You already own the maximum number of this item.';
    end if;
  end if;

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
    -- Mark it seen immediately — the player just consciously claimed this
    -- through the shop, which already showed its own "Claimed!" toast;
    -- item-notify.js's passive gift popup is for achievement/admin grants
    -- the player DIDN'T just click a button for.
    update public.inventory_items set notified_at = now()
      where user_id = v_uid and item_id = p_item_id and notified_at is null;
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
-- Cleanup: James's White T-shirt claim was granted during THIS session's
-- own SQL-level verification testing (see
-- 20260914040000_qa_shop_tests.sql's commit history) — a real row, but
-- not something James actually chose to claim through the real Shop UI.
-- Removing it (and its ledger entry, so the lifetime_limit doesn't block
-- a genuine future claim) so he can test the real claim flow himself,
-- exactly as intended.
-- ============================================================================
delete from public.economy_transactions
  where user_id = '6f0316a8-cfb9-4328-b07f-a0d881bb5e9f' and item_id = 'white-tshirt';
delete from public.inventory_items
  where user_id = '6f0316a8-cfb9-4328-b07f-a0d881bb5e9f' and item_id = 'white-tshirt';
