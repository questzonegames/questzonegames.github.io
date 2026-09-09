-- TEMPORARY QA: prove the Postgres constraints themselves reject bad data,
-- independent of any application code — tested with a direct raw
-- INSERT/UPDATE as the table owner (bypassing RLS entirely on purpose,
-- since the point here is the CONSTRAINT, not RLS — RLS is proven
-- separately by the browser-session tests using the real anon/authenticated
-- client).
do $$
declare
  v_caught boolean;
begin
  -- duplicate serial number within the same edition
  v_caught := false;
  begin
    insert into public.item_instances (item_id, serial_number, owner_id)
      values ('qa-test-c', 4, '6f0316a8-cfb9-4328-b07f-a0d881bb5e9f');
  exception when unique_violation then
    v_caught := true;
  end;
  insert into public.qa_test_results (test_name, passed, detail) values (
    'UNIQUE(item_id, serial_number) rejects a duplicate #4/10', v_caught, 'caught=' || v_caught::text
  );

  -- negative / zero quantity direct write
  v_caught := false;
  begin
    update public.player_item_stacks set quantity = -5
      where user_id = 'ce0be0a0-a083-4d04-bb6a-74e8ce7c53ae' and item_id = 'qa-test-a';
  exception when check_violation then
    v_caught := true;
  end;
  insert into public.qa_test_results (test_name, passed, detail) values (
    'CHECK quantity > 0 rejects a direct negative write', v_caught, 'caught=' || v_caught::text
  );

  -- exceeding edition_size (issued_count > edition_size)
  v_caught := false;
  begin
    update public.item_definitions set issued_count = 11 where item_id = 'qa-test-c';
  exception when check_violation then
    v_caught := true;
  end;
  insert into public.qa_test_results (test_name, passed, detail) values (
    'CHECK issued_count <= edition_size rejects 11 for a 10-edition item', v_caught, 'caught=' || v_caught::text
  );
end $$;
