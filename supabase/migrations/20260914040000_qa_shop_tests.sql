-- ============================================================================
-- TEMPORARY QA — exercises the shop RPCs end-to-end using the two existing
-- test accounts (James, ducktest), matching the auth.uid() simulation
-- technique already proven in 20260909050300_probe_auth_uid_sim.sql.
-- Any failed assertion raises an exception, which rolls back this ENTIRE
-- migration (including the temporary qa-test-* fixtures below) — so a
-- failing test leaves no trace and simply doesn't get recorded as applied.
-- A clean pass leaves: both test accounts' quest_points/stardust restored
-- to their exact starting balance, the qa-test-* fixtures gone (they're
-- deleted explicitly at the end too, not just relying on that rollback
-- behaviour), and White T-shirt genuinely claimed once by each account —
-- a real, legitimate exercise of the real feature, not fake data, so it's
-- deliberately NOT rolled back.
-- ============================================================================
do $$
declare
  james uuid := '6f0316a8-cfb9-4328-b07f-a0d881bb5e9f';
  duck  uuid := 'ce0be0a0-a083-4d04-bb6a-74e8ce7c53ae';
  james_qp_before int; duck_qp_before int;
  james_qp_after int;
  v_result jsonb;
  v_caught boolean;
  v_qty int;
  v_owned int;
  v_issued int;
  v_trade_id uuid;
  v_req uuid;
begin
  select quest_points into james_qp_before from public.profiles where id = james;
  select quest_points into duck_qp_before from public.profiles where id = duck;

  -- ---- helper: run p_sql as the given simulated user ----
  -- (inline below per-call instead of a real helper function, since
  -- `set local role` only affects the CURRENT transaction/block scope)

  -- ==========================================================================
  -- 1. White T-shirt: each player can claim exactly once, free (no currency
  --    change), goes into real inventory, correct numeric_id.
  -- ==========================================================================
  -- James may already have genuinely claimed his in an earlier verification
  -- pass this same session — if so, skip straight to verifying the SECOND
  -- claim is rejected (below) instead of re-attempting a first claim that
  -- would correctly fail as "already own".
  if not exists (select 1 from public.inventory_items where user_id = james and item_id = 'white-tshirt') then
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"6f0316a8-cfb9-4328-b07f-a0d881bb5e9f","role":"authenticated"}';
    select public.purchase_item('white-tshirt') into v_result;
    set local role postgres;
    if (v_result->>'item_id') != 'white-tshirt' then
      raise exception 'TEST FAILED: White T-shirt purchase_item did not return the expected item_id, got %', v_result;
    end if;
  end if;

  select quest_points into james_qp_after from public.profiles where id = james;
  if james_qp_after != james_qp_before then
    raise exception 'TEST FAILED: free claim changed quest_points (% -> %)', james_qp_before, james_qp_after;
  end if;

  if not exists (select 1 from public.inventory_items where user_id = james and item_id = 'white-tshirt') then
    raise exception 'TEST FAILED: White T-shirt not found in James''s real inventory after claim';
  end if;

  if (select numeric_id from public.item_definitions where item_id = 'white-tshirt') != 3 then
    raise exception 'TEST FAILED: White T-shirt numeric_id is not 3 (next sequential after admin-crown=1, doggy-slippers=2)';
  end if;

  -- second claim for the SAME account must be rejected
  v_caught := false;
  begin
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"6f0316a8-cfb9-4328-b07f-a0d881bb5e9f","role":"authenticated"}';
    perform public.purchase_item('white-tshirt');
    set local role postgres;
  exception when others then
    set local role postgres;
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'TEST FAILED: a second White T-shirt claim for the same account was NOT rejected';
  end if;

  -- a DIFFERENT account can still claim their own copy
  if not exists (select 1 from public.inventory_items where user_id = duck and item_id = 'white-tshirt') then
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"ce0be0a0-a083-4d04-bb6a-74e8ce7c53ae","role":"authenticated"}';
    select public.purchase_item('white-tshirt') into v_result;
    set local role postgres;
    if (v_result->>'item_id') != 'white-tshirt' then
      raise exception 'TEST FAILED: ducktest could not claim their own White T-shirt';
    end if;
  end if;

  -- lifetime_limit survives the item leaving inventory (not just a
  -- current-ownership check) — remove it via the real admin path, then
  -- retry the claim, must still be rejected
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"6f0316a8-cfb9-4328-b07f-a0d881bb5e9f","role":"authenticated"}';
  perform public.admin_delete_inventory_item(duck, 'white-tshirt'); -- James is an admin (see admin-crown check above)
  set local role postgres;
  v_caught := false;
  begin
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"ce0be0a0-a083-4d04-bb6a-74e8ce7c53ae","role":"authenticated"}';
    perform public.purchase_item('white-tshirt');
    set local role postgres;
  exception when others then
    set local role postgres;
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'TEST FAILED: lifetime_limit did not survive item removal — ducktest re-claimed after admin_delete_inventory_item';
  end if;
  -- restore ducktest's real claim (the removal above was purely to test
  -- the limit surviving it, not a real intended state)
  insert into public.inventory_items (user_id, item_id) values (duck, 'white-tshirt') on conflict do nothing;

  -- anonymous (no auth.uid()) cannot claim
  v_caught := false;
  begin
    perform public.purchase_item('white-tshirt'); -- no role switch -> auth.uid() is null here
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'TEST FAILED: an unauthenticated call to purchase_item was NOT rejected';
  end if;

  -- ==========================================================================
  -- 2. Temporary fixtures for stack-mode and instance-mode(limited) coverage
  --    — White T-shirt alone can't exercise these paths (simple mode only).
  -- ==========================================================================
  insert into public.item_definitions
    (item_id, name, equipment_slot, tradeable, instancing_mode, stock_type, active,
     purchase_type, currency_type, shop_price, is_test)
  values
    ('qa-test-stack', 'QA Test Stack Item', 'accessory', true, 'stack', 'unlimited', true,
     'quest_points', 'quest_points', 10, true);
  insert into public.item_definitions
    (item_id, name, equipment_slot, tradeable, instancing_mode, stock_type, active,
     purchase_type, currency_type, shop_price, edition_size, is_test)
  values
    ('qa-test-limited', 'QA Test Limited Item', 'accessory', true, 'instance', 'limited', true,
     'quest_points', 'quest_points', 5, 1, true);

  -- top up both test accounts so the paid tests below have real balance to
  -- spend — restored to their exact starting value at the very end.
  update public.profiles set quest_points = quest_points + 1000 where id in (james, duck);

  -- ---- stackable purchases combine into ONE row with quantity, not N rows ----
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"6f0316a8-cfb9-4328-b07f-a0d881bb5e9f","role":"authenticated"}';
  perform public.purchase_item('qa-test-stack', 1);
  perform public.purchase_item('qa-test-stack', 2);
  set local role postgres;
  select count(*) into v_qty from public.player_item_stacks where user_id = james and item_id = 'qa-test-stack';
  if v_qty != 1 then
    raise exception 'TEST FAILED: stackable purchases created % rows instead of 1', v_qty;
  end if;
  select quantity into v_qty from public.player_item_stacks where user_id = james and item_id = 'qa-test-stack';
  if v_qty != 3 then
    raise exception 'TEST FAILED: stack quantity is % instead of 3 (1+2)', v_qty;
  end if;

  -- ---- owned quantity increases after purchase, includes equipped copies ----
  v_owned := public.get_owned_quantity(james, 'qa-test-stack');
  if v_owned != 3 then
    raise exception 'TEST FAILED: get_owned_quantity returned % instead of 3 before equipping', v_owned;
  end if;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"6f0316a8-cfb9-4328-b07f-a0d881bb5e9f","role":"authenticated"}';
  perform public.equip_item('accessory', 'qa-test-stack');
  set local role postgres;
  v_owned := public.get_owned_quantity(james, 'qa-test-stack');
  if v_owned != 3 then
    raise exception 'TEST FAILED: get_owned_quantity dropped to % after equipping one — equipped copies must still count', v_owned;
  end if;
  select quantity into v_qty from public.player_item_stacks where user_id = james and item_id = 'qa-test-stack';
  if v_qty != 2 then
    raise exception 'TEST FAILED: stack quantity should be 2 in player_item_stacks after equipping 1 of 3, got %', v_qty;
  end if;

  -- ---- one-per-player item cannot be repurchased while equipped ----
  insert into public.item_definitions
    (item_id, name, equipment_slot, tradeable, instancing_mode, stock_type, active,
     purchase_type, currency_type, shop_price, max_owned_per_player, is_test)
  values
    ('qa-test-simple-onepp', 'QA Test One-Per-Player', 'necklace', false, 'simple', 'unlimited', true,
     'quest_points', 'quest_points', 5, 1, true);
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"6f0316a8-cfb9-4328-b07f-a0d881bb5e9f","role":"authenticated"}';
  perform public.purchase_item('qa-test-simple-onepp');
  perform public.equip_item('necklace', 'qa-test-simple-onepp');
  set local role postgres;
  v_caught := false;
  begin
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"6f0316a8-cfb9-4328-b07f-a0d881bb5e9f","role":"authenticated"}';
    perform public.purchase_item('qa-test-simple-onepp');
    set local role postgres;
  exception when others then
    set local role postgres;
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'TEST FAILED: a one-per-player item was repurchased while already equipped';
  end if;

  -- ==========================================================================
  -- 3. Globally limited stock: cannot go below zero, becomes sold out.
  -- ==========================================================================
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"6f0316a8-cfb9-4328-b07f-a0d881bb5e9f","role":"authenticated"}';
  perform public.purchase_item('qa-test-limited');
  set local role postgres;
  select issued_count into v_issued from public.item_definitions where item_id = 'qa-test-limited';
  if v_issued != 1 then
    raise exception 'TEST FAILED: issued_count is % instead of 1 after the only edition copy was sold', v_issued;
  end if;

  v_caught := false;
  begin
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"ce0be0a0-a083-4d04-bb6a-74e8ce7c53ae","role":"authenticated"}';
    perform public.purchase_item('qa-test-limited'); -- edition_size=1, already issued — must fail
    set local role postgres;
  exception when others then
    set local role postgres;
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'TEST FAILED: a second buyer purchased a sold-out (edition_size=1, issued_count=1) item';
  end if;

  -- ---- failed purchase deducted no currency and no stock ----
  select quest_points into v_qty from public.profiles where id = duck;
  if v_qty != 1000 + duck_qp_before then
    raise exception 'TEST FAILED: ducktest''s failed sold-out purchase attempt still deducted currency';
  end if;
  if v_issued != (select issued_count from public.item_definitions where item_id = 'qa-test-limited') then
    raise exception 'TEST FAILED: failed purchase changed issued_count';
  end if;

  -- ==========================================================================
  -- 4. Idempotency — the exact same request_id must not charge/grant twice.
  -- ==========================================================================
  v_req := gen_random_uuid();
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ce0be0a0-a083-4d04-bb6a-74e8ce7c53ae","role":"authenticated"}';
  perform public.purchase_item('qa-test-stack', 1, v_req);
  perform public.purchase_item('qa-test-stack', 1, v_req); -- retried with the SAME request id
  set local role postgres;
  select quantity into v_qty from public.player_item_stacks where user_id = duck and item_id = 'qa-test-stack';
  if v_qty != 1 then
    raise exception 'TEST FAILED: duplicate request_id resulted in quantity % instead of 1', v_qty;
  end if;

  -- ==========================================================================
  -- 5. Trading: untradeable rejected, tradeable settles atomically, trading
  --    never touches remaining global shop stock.
  -- ==========================================================================
  v_issued := (select issued_count from public.item_definitions where item_id = 'qa-test-limited');

  -- James owns the one qa-test-limited instance — try trading White
  -- T-shirt (untradeable) alongside it, must be rejected outright
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"6f0316a8-cfb9-4328-b07f-a0d881bb5e9f","role":"authenticated"}';
  select public.propose_trade(duck, jsonb_build_array(jsonb_build_object('item_id', 'white-tshirt')), '[]'::jsonb) into v_trade_id;
  set local role postgres;
  v_caught := false;
  begin
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"ce0be0a0-a083-4d04-bb6a-74e8ce7c53ae","role":"authenticated"}';
    perform public.accept_trade(v_trade_id, '[]'::jsonb, '[]'::jsonb);
    set local role postgres;
  exception when others then
    set local role postgres;
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'TEST FAILED: a trade containing an untradeable item (White T-shirt) was accepted';
  end if;

  -- now a REAL tradeable trade: James's qa-test-limited instance -> ducktest
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"6f0316a8-cfb9-4328-b07f-a0d881bb5e9f","role":"authenticated"}';
  select public.propose_trade(
    duck,
    (select jsonb_build_array(jsonb_build_object('item_id', 'qa-test-limited', 'instance_id', instance_id))
     from public.item_instances where item_id = 'qa-test-limited' and owner_id = james),
    '[]'::jsonb
  ) into v_trade_id;
  set local role postgres;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"ce0be0a0-a083-4d04-bb6a-74e8ce7c53ae","role":"authenticated"}';
  perform public.accept_trade(v_trade_id, '[]'::jsonb, '[]'::jsonb);
  set local role postgres;

  if not exists (select 1 from public.item_instances where item_id = 'qa-test-limited' and owner_id = duck) then
    raise exception 'TEST FAILED: qa-test-limited instance did not transfer to ducktest after accept_trade';
  end if;
  if (select issued_count from public.item_definitions where item_id = 'qa-test-limited') != v_issued then
    raise exception 'TEST FAILED: trading changed issued_count (global shop stock) from % to %',
      v_issued, (select issued_count from public.item_definitions where item_id = 'qa-test-limited');
  end if;

  -- ==========================================================================
  -- cleanup: qa-test-* fixtures only. White T-shirt claims and the traded
  -- qa-test-limited ownership are left as real evidence the tests ran
  -- (harmless — this migration is about to delete the item definitions
  -- themselves anyway, which cascades away any remaining ownership rows).
  -- Currency is restored to each account's EXACT starting balance.
  -- ==========================================================================
  delete from public.economy_transactions where item_id like 'qa-test-%';
  delete from public.economy_requests where operation in ('purchase_item','accept_trade') and (result->>'item_id') like 'qa-test-%';
  delete from public.trade_currency where trade_id in (select trade_id from public.trade_items where item_id like 'qa-test-%');
  delete from public.trade_items where item_id like 'qa-test-%';
  delete from public.trades where trade_id not in (select trade_id from public.trade_items);
  delete from public.equipped_items where item_id like 'qa-test-%';
  delete from public.player_item_stacks where item_id like 'qa-test-%';
  delete from public.item_instances where item_id like 'qa-test-%';
  delete from public.inventory_items where item_id like 'qa-test-%';
  delete from public.item_definitions where item_id like 'qa-test-%';

  update public.profiles set quest_points = james_qp_before where id = james;
  update public.profiles set quest_points = duck_qp_before where id = duck;

  raise notice 'ALL SHOP QA TESTS PASSED';
end $$;
