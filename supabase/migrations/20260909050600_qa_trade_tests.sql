-- ============================================================================
-- TEMPORARY QA: trade tests, run as James <-> ducktest via a simulated
-- authenticated session (set_config('request.jwt.claims', ...)). Results
-- are recorded into a temporary qa_test_results table (queryable
-- afterward) rather than raised as fatal errors, so one failing
-- assertion can never roll back and hide evidence of what the earlier
-- steps in this same script actually did.
-- ============================================================================
create table if not exists public.qa_test_results (
  id bigint generated always as identity primary key,
  test_name text not null,
  passed boolean not null,
  detail text,
  created_at timestamptz not null default now()
);

do $$
declare
  james uuid := '6f0316a8-cfb9-4328-b07f-a0d881bb5e9f';
  duck  uuid := 'ce0be0a0-a083-4d04-bb6a-74e8ce7c53ae';
  v_trade uuid;
  v_serial1_instance uuid;
  v_serial2_instance uuid;
  v_result jsonb;
  v_qty int;
  v_owner uuid;
  v_caught boolean;
  v_errmsg text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', james::text, 'role','authenticated')::text, true);

  select instance_id into v_serial1_instance from public.item_instances where item_id = 'qa-test-c' and serial_number = 1;
  select instance_id into v_serial2_instance from public.item_instances where item_id = 'qa-test-c' and serial_number = 2;
  if v_serial1_instance is null or v_serial2_instance is null then
    insert into public.qa_test_results (test_name, passed, detail) values ('SETUP', false, 'serial #1/#2 of qa-test-c not found — earlier purchase test must run first');
    return;
  end if;

  -- ---- TEST: untradeable item cannot be traded ----
  select public.propose_trade(duck, jsonb_build_array(jsonb_build_object('item_id','qa-test-b')), '[]'::jsonb) into v_trade;
  perform set_config('request.jwt.claims', json_build_object('sub', duck::text, 'role','authenticated')::text, true);
  v_caught := false; v_errmsg := null;
  begin
    perform public.accept_trade(v_trade, '[]'::jsonb, '[]'::jsonb, null);
  exception when others then
    v_caught := true; v_errmsg := sqlerrm;
  end;
  insert into public.qa_test_results (test_name, passed, detail) values (
    'untradeable rejected by accept_trade', v_caught and position('untradeable' in v_errmsg) > 0, coalesce(v_errmsg, 'NOT REJECTED')
  );
  insert into public.qa_test_results (test_name, passed, detail) values (
    'qa-test-b still owned by James after rejected trade',
    exists (select 1 from public.inventory_items where user_id = james and item_id = 'qa-test-b'),
    'james owns: ' || exists (select 1 from public.inventory_items where user_id = james and item_id = 'qa-test-b')::text
  );
  insert into public.qa_test_results (test_name, passed, detail) values (
    'qa-test-b did NOT reach ducktest',
    not exists (select 1 from public.inventory_items where user_id = duck and item_id = 'qa-test-b'),
    'duck owns: ' || exists (select 1 from public.inventory_items where user_id = duck and item_id = 'qa-test-b')::text
  );

  -- ---- TEST: stackable trade — James sends 6 of qa-test-a to ducktest ----
  perform set_config('request.jwt.claims', json_build_object('sub', james::text, 'role','authenticated')::text, true);
  select public.propose_trade(duck, jsonb_build_array(jsonb_build_object('item_id','qa-test-a','quantity',6)), '[]'::jsonb) into v_trade;
  perform set_config('request.jwt.claims', json_build_object('sub', duck::text, 'role','authenticated')::text, true);
  v_caught := false; v_errmsg := null;
  begin
    select public.accept_trade(v_trade, '[]'::jsonb, '[]'::jsonb, null) into v_result;
  exception when others then
    v_caught := true; v_errmsg := sqlerrm;
  end;
  select quantity into v_qty from public.player_item_stacks where user_id = james and item_id = 'qa-test-a';
  insert into public.qa_test_results (test_name, passed, detail) values (
    'stackable trade: James 10 -> 4', coalesce(v_qty,0) = 4, coalesce(v_errmsg, 'james qty=' || coalesce(v_qty,0)::text)
  );
  select quantity into v_qty from public.player_item_stacks where user_id = duck and item_id = 'qa-test-a';
  insert into public.qa_test_results (test_name, passed, detail) values (
    'stackable trade: ducktest 0 -> 6', coalesce(v_qty,0) = 6, 'duck qty=' || coalesce(v_qty,0)::text
  );

  -- ---- TEST: second stackable trade — stacks MERGE not duplicate ----
  perform set_config('request.jwt.claims', json_build_object('sub', james::text, 'role','authenticated')::text, true);
  select public.propose_trade(duck, jsonb_build_array(jsonb_build_object('item_id','qa-test-a','quantity',4)), '[]'::jsonb) into v_trade;
  perform set_config('request.jwt.claims', json_build_object('sub', duck::text, 'role','authenticated')::text, true);
  begin
    perform public.accept_trade(v_trade, '[]'::jsonb, '[]'::jsonb, null);
  exception when others then
    insert into public.qa_test_results (test_name, passed, detail) values ('second stackable trade executed', false, sqlerrm);
  end;
  insert into public.qa_test_results (test_name, passed, detail) values (
    'James stack row deleted at zero (not left at 0)',
    not exists (select 1 from public.player_item_stacks where user_id = james and item_id = 'qa-test-a'),
    'exists=' || exists (select 1 from public.player_item_stacks where user_id = james and item_id = 'qa-test-a')::text
  );
  select quantity into v_qty from public.player_item_stacks where user_id = duck and item_id = 'qa-test-a';
  insert into public.qa_test_results (test_name, passed, detail) values (
    'ducktest merged into ONE stack of 10', v_qty = 10, 'qty=' || coalesce(v_qty,0)::text
  );
  insert into public.qa_test_results (test_name, passed, detail) values (
    'ducktest has exactly one row for qa-test-a',
    (select count(*) from public.player_item_stacks where user_id = duck and item_id = 'qa-test-a') = 1,
    'rows=' || (select count(*) from public.player_item_stacks where user_id = duck and item_id = 'qa-test-a')::text
  );

  -- ---- TEST: unique instance transfer ----
  perform set_config('request.jwt.claims', json_build_object('sub', james::text, 'role','authenticated')::text, true);
  select public.propose_trade(duck, jsonb_build_array(jsonb_build_object('item_id','qa-test-c','instance_id',v_serial1_instance::text)), '[]'::jsonb) into v_trade;
  perform set_config('request.jwt.claims', json_build_object('sub', duck::text, 'role','authenticated')::text, true);
  begin
    perform public.accept_trade(v_trade, '[]'::jsonb, '[]'::jsonb, null);
  exception when others then
    insert into public.qa_test_results (test_name, passed, detail) values ('instance trade executed', false, sqlerrm);
  end;
  select owner_id into v_owner from public.item_instances where instance_id = v_serial1_instance;
  insert into public.qa_test_results (test_name, passed, detail) values (
    'instance #1 owner is now ducktest', v_owner = duck, 'owner=' || coalesce(v_owner::text,'null')
  );
  insert into public.qa_test_results (test_name, passed, detail) values (
    'instance #1 kept same instance_id + serial (moved, not recreated)',
    exists (select 1 from public.item_instances where instance_id = v_serial1_instance and item_id = 'qa-test-c' and serial_number = 1),
    'instance_id=' || v_serial1_instance::text
  );

  -- ---- TEST: trade atomicity — impossible currency leg rolls back the WHOLE trade ----
  perform set_config('request.jwt.claims', json_build_object('sub', james::text, 'role','authenticated')::text, true);
  select public.propose_trade(duck, jsonb_build_array(jsonb_build_object('item_id','qa-test-c','instance_id',v_serial2_instance::text)), '[]'::jsonb) into v_trade;
  perform set_config('request.jwt.claims', json_build_object('sub', duck::text, 'role','authenticated')::text, true);
  v_caught := false;
  begin
    perform public.accept_trade(v_trade, '[]'::jsonb, jsonb_build_array(jsonb_build_object('currency_type','quest_points','amount',999999999)), null);
  exception when others then
    v_caught := true;
  end;
  insert into public.qa_test_results (test_name, passed, detail) values (
    'impossible currency leg rejected the WHOLE trade', v_caught, 'caught=' || v_caught::text
  );
  select owner_id into v_owner from public.item_instances where instance_id = v_serial2_instance;
  insert into public.qa_test_results (test_name, passed, detail) values (
    'instance #2 still owned by James (nothing moved)', v_owner = james, 'owner=' || coalesce(v_owner::text,'null')
  );

  insert into public.qa_test_results (test_name, passed, detail) values ('ALL TRADE TESTS RAN', true, 'see rows above for pass/fail');
end $$;
