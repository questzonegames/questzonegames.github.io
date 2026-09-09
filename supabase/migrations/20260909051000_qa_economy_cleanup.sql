-- ============================================================================
-- Cleanup: remove every temporary QA fixture/test record created while
-- verifying the item economy foundation. Nothing here touches real
-- production data — every deletion is scoped to the qa-test-* item_ids,
-- the qa_test_results scratch table, or exact-restoring the two test
-- accounts' Quest Points to their pre-test balances (both were 0 before
-- testing began, confirmed at the time).
-- ============================================================================

-- economy_transactions / economy_requests / trades referencing qa-test-*
-- items are deleted first (FK dependencies), then ownership rows, then
-- the item_instances/item_definitions themselves.
delete from public.economy_transactions where item_id like 'qa-test-%';
delete from public.economy_requests where operation in ('purchase_item','accept_trade')
  and (result->>'item_id') like 'qa-test-%';
delete from public.trade_currency where trade_id in (
  select trade_id from public.trade_items where item_id like 'qa-test-%'
);
delete from public.trade_items where item_id like 'qa-test-%';
delete from public.trades where trade_id not in (select trade_id from public.trade_items); -- now-empty trade headers

delete from public.equipped_items where item_id like 'qa-test-%';
delete from public.player_item_stacks where item_id like 'qa-test-%';
delete from public.item_instances where item_id like 'qa-test-%';
delete from public.inventory_items where item_id like 'qa-test-%';
delete from public.item_definitions where item_id like 'qa-test-%';

-- restore the two test accounts' Quest Points to their exact pre-test
-- balance (both were 0 immediately before the 500-point top-up)
update public.profiles set quest_points = 0 where id = '6f0316a8-cfb9-4328-b07f-a0d881bb5e9f'; -- James
update public.profiles set quest_points = 0 where id = 'ce0be0a0-a083-4d04-bb6a-74e8ce7c53ae'; -- ducktest

drop table if exists public.qa_test_results;
