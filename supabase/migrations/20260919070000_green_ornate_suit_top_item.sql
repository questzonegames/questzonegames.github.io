-- ============================================================================
-- Green Ornate Suit Top — an admin-only, gift-only body item. Same
-- economy shape as Admin Crown (see 20260909050000_item_economy_foundation.sql's
-- backfill insert), not White T-shirt/Grey Tracksuit Bottoms — those are
-- free self-claims through the shop; this one has NO shop presence and
-- NO self-claim path at all.
-- ============================================================================
-- purchase_type is left null (its column default) on purpose — that's
-- the ONLY thing that hides an item from the shop (get_shop_items()
-- filters on `purchase_type is not null`, see
-- 20260914010000_shop_economy_extensions.sql) and is also what
-- purchase_item() itself checks first ("This item is not purchasable.")
-- before any of its other logic runs. There is no separate "category"
-- concept on item_definitions to set — admin-only items are excluded
-- from the shop by this one column, not by a category enum.
--
-- The ONLY way this item ever reaches a player's inventory is an admin
-- using the existing admin_grant_item(p_recipient, p_item_id) RPC (see
-- 20260903042739_admin_inventory_gifting.sql) from
-- profile/admin-inventory.html's grant flow — that RPC already
-- re-checks is_admin() itself, server-side, inside a SECURITY DEFINER
-- function; nothing about it is specific to any one item_id, so no RPC
-- change was needed to support this item. It also already turns a
-- second grant attempt into a clean "This account already owns that
-- item." error (catching inventory_items' own primary key
-- unique_violation) rather than creating a duplicate row — this is
-- instancing_mode='simple', so that primary key (user_id, item_id) IS
-- the real one-copy-per-player guarantee, the same as Admin Crown and
-- Doggy Slippers already rely on.
--
-- tradeable=false is enforced independently by accept_trade() (see
-- 20260909050700_fix_stack_zero_quantity_bug.sql), which rejects any
-- trade containing an untradeable item — no item-specific code needed,
-- that check is keyed off this row's own tradeable column. There is no
-- separate normal-user-to-user gifting system in this codebase at all
-- (only trade and this admin-grant RPC ever move an item between
-- accounts), so there is no second surface to also lock down.
--
-- Granting itself is already permanently audited without any further
-- change: admin_grant_item() inserts into inventory_items, which has
-- had granted_by (the admin's uid) and acquired_at (the timestamp)
-- columns since 20260903042739_admin_inventory_gifting.sql — that row,
-- keyed by (user_id = recipient, item_id), IS the audit record: admin
-- id, recipient id, item id, and timestamp, all in one place, exactly
-- like every other admin-granted item today.
insert into public.item_definitions (
  item_id, name, description, equipment_slot, tradeable, instancing_mode,
  stock_type, active, purchase_type, currency_type, shop_price,
  max_owned_per_player, lifetime_limit, slot_category, display_order
) values (
  'green-ornate-suit-top', 'Green Ornate Suit Top', 'An ornate green and gold suit top. Admin-gifted only.',
  'body', false, 'simple',
  'unlimited', true, null, null, null,
  1, 1, 'body', 0
)
on conflict (item_id) do nothing;
