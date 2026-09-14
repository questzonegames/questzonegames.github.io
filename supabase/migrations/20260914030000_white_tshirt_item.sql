-- ============================================================================
-- White T-shirt — the one new shop item for this update.
-- ============================================================================
-- item_id='white-tshirt' is the stable slug (see 20260914010000's PART 2
-- comment on why the real, referenced-everywhere primary key stays text).
-- numeric_id is left to its column default (nextval on
-- item_definitions_numeric_id_seq) — the next value after the existing
-- two real items (admin-crown=1, doggy-slippers=2), so this becomes 3.
-- Not hardcoded here on purpose: that would risk silently reusing a
-- number if this migration were ever re-run against a database where the
-- sequence had already advanced for some other reason. The exact value
-- assigned is confirmed after this migration runs — see the final report.
--
-- instancing_mode='simple' — own one or none, uses the existing
-- inventory_items table exactly like admin-crown/doggy-slippers already
-- do. Combined with max_owned_per_player=1 AND lifetime_limit=1 (belt and
-- suspenders: simple mode already only allows 0-or-1 via
-- inventory_items' own primary key + purchase_item's own-instance check;
-- lifetime_limit additionally blocks a second claim via the permanent
-- economy_transactions ledger even if the shirt is later removed from
-- inventory by some other means, e.g. a future admin action or trade to
-- an untradeable... N/A here since it's untradeable anyway).
insert into public.item_definitions (
  item_id, name, description, equipment_slot, tradeable, instancing_mode,
  stock_type, active, purchase_type, currency_type, shop_price,
  max_owned_per_player, lifetime_limit, slot_category, display_order
) values (
  'white-tshirt', 'White T-shirt', 'A plain white t-shirt. Everyone gets one.',
  'body', false, 'simple',
  'unlimited', true, 'free', null, null,
  1, 1, 'body', 0
)
on conflict (item_id) do nothing;
