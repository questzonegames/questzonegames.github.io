-- Re-run of the trade test suite after the stack-zero-quantity fix, with
-- the test script's own bug fixed too: every read-assertion now runs
-- back in JAMES's (admin) simulated context, not whichever side last
-- called accept_trade — an assertion reading someone else's row while
-- simulated as a non-admin, non-owning user was silently RLS-filtered
-- to "not found" in the first run, which looked like data corruption
-- but was actually just the test script reading through the wrong
-- window. James is_admin()=true, so admin-context reads bypass RLS's
-- own-row restriction and see real state regardless of whose row it is.
truncate public.qa_test_results;

do $$
declare
  james uuid := '6f0316a8-cfb9-4328-b07f-a0d881bb5e9f';
  duck  uuid := 'ce0be0a0-a083-4d04-bb6a-74e8ce7c53ae';
  v_trade uuid;
  v_qty int;
  v_owner uuid;
  v_caught boolean;
begin
  perform set_config('role', 'authenticated', true);

  -- ---- second stackable trade: James sends his remaining 4, ducktest should merge to 10 ----
  perform set_config('request.jwt.claims', json_build_object('sub', james::text, 'role','authenticated')::text, true);
  select public.propose_trade(duck, jsonb_build_array(jsonb_build_object('item_id','qa-test-a','quantity',4)), '[]'::jsonb) into v_trade;
  perform set_config('request.jwt.claims', json_build_object('sub', duck::text, 'role','authenticated')::text, true);
  v_caught := false;
  begin
    perform public.accept_trade(v_trade, '[]'::jsonb, '[]'::jsonb, null);
  exception when others then
    v_caught := true;
    insert into public.qa_test_results (test_name, passed, detail) values ('second stackable trade executed', false, sqlerrm);
  end;
  if not v_caught then
    insert into public.qa_test_results (test_name, passed, detail) values ('second stackable trade executed', true, 'no exception');
  end if;

  -- back to admin context for reads
  perform set_config('request.jwt.claims', json_build_object('sub', james::text, 'role','authenticated')::text, true);
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

  -- ---- re-verify equip_item's own zero-quantity fix: buy 1 more of qa-test-a for James, equip it (only unit -> should DELETE not violate), unequip ----
  perform set_config('request.jwt.claims', json_build_object('sub', james::text, 'role','authenticated')::text, true);
  perform public.purchase_item('qa-test-a', 1, null);
  v_caught := false;
  begin
    perform public.equip_item('body', 'qa-test-a');
  exception when others then
    v_caught := true;
    insert into public.qa_test_results (test_name, passed, detail) values ('equip last unit of a stack (1->0)', false, sqlerrm);
  end;
  if not v_caught then
    insert into public.qa_test_results (test_name, passed, detail) values ('equip last unit of a stack (1->0)', true, 'no exception');
  end if;
  insert into public.qa_test_results (test_name, passed, detail) values (
    'stack row gone after equipping the only unit',
    not exists (select 1 from public.player_item_stacks where user_id = james and item_id = 'qa-test-a'),
    'exists=' || exists (select 1 from public.player_item_stacks where user_id = james and item_id = 'qa-test-a')::text
  );
  perform public.unequip_item('body');
  select quantity into v_qty from public.player_item_stacks where user_id = james and item_id = 'qa-test-a';
  insert into public.qa_test_results (test_name, passed, detail) values (
    'unequip restores stack to 1', v_qty = 1, 'qty=' || coalesce(v_qty,0)::text
  );

  raise notice 'RE-RUN COMPLETE';
end $$;
