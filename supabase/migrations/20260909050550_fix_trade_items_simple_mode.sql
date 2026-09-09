-- Fix: trade_items_exactly_one_kind didn't account for a SIMPLE-mode item
-- offer (neither an instance_id nor a quantity applies — "the item" is
-- unambiguous, ownership is binary) — discovered by the trade test suite
-- attempting to offer qa-test-b (untradeable, but simple-mode) in a trade.
alter table public.trade_items drop constraint if exists trade_items_exactly_one_kind;
alter table public.trade_items add constraint trade_items_valid_kind check (
  (instance_id is not null and quantity is null) or
  (instance_id is null and quantity is not null and quantity > 0) or
  (instance_id is null and quantity is null)
);
