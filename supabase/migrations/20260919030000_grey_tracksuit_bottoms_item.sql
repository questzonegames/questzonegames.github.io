-- ============================================================================
-- Grey Tracksuit Bottoms — the next real shop item, same shape as White
-- T-shirt (see 20260914030000_white_tshirt_item.sql).
-- ============================================================================
-- item_id='grey-tracksuit-bottoms' is the stable slug/primary key. numeric_id
-- is left to its column default (nextval on item_definitions_numeric_id_seq)
-- — not hardcoded here, same reasoning as White T-shirt's migration: the
-- exact value is confirmed after this migration runs, never assumed, so a
-- re-run against a database where the sequence already advanced for some
-- other reason can never silently collide with an existing item.
--
-- display_order=0 — same tier as admin-crown/doggy-slippers/white-tshirt
-- (all 0); within a tier the catalog RPC's own `order by display_order,
-- numeric_id` falls back to numeric_id, and this item's numeric_id will be
-- higher than white-tshirt's (3) and lower than test-sword's (whose
-- display_order is 1, a tier below this one), so it lands immediately
-- after White T-shirt and before Test Sword in the shop grid without
-- needing to renumber any existing item.
--
-- instancing_mode='simple', max_owned_per_player=1, lifetime_limit=1 —
-- identical belt-and-suspenders duplicate-ownership protection as White
-- T-shirt: simple mode's own inventory_items primary key plus
-- max_owned_per_player both block a second copy via purchase_item()'s
-- server-side checks (see 20260914050000_fix_shop_notify_and_cleanup.sql),
-- and lifetime_limit additionally blocks a second claim via the permanent
-- economy_transactions ledger even if it were ever removed from inventory
-- by some other means. tradeable=false is enforced independently by
-- accept_trade() (see 20260909050700_fix_stack_zero_quantity_bug.sql),
-- which rejects any trade containing an untradeable item — no item-specific
-- code needed, that check is keyed off this row's own tradeable column.
insert into public.item_definitions (
  item_id, name, description, equipment_slot, tradeable, instancing_mode,
  stock_type, active, purchase_type, currency_type, shop_price,
  max_owned_per_player, lifetime_limit, slot_category, display_order
) values (
  'grey-tracksuit-bottoms', 'Grey Tracksuit Bottoms', 'A comfy pair of grey tracksuit bottoms. Everyone gets one.',
  'legs', false, 'simple',
  'unlimited', true, 'free', null, null,
  1, 1, 'legs', 0
)
on conflict (item_id) do nothing;
