-- ============================================================================
-- Ornate Green Suit Bottoms — an admin-only, gift-only legs item. Same
-- rules and security shape as Green Ornate Suit Top (see
-- 20260919070000_green_ornate_suit_top_item.sql) but a wholly separate
-- item: own item_id, own numeric_id, own asset, own avatar_rig_items row
-- (slot='legs' vs 'body'), own inventory_items/equipped_items rows.
-- Nothing about the suit top's record is shared or reused here — only
-- the underlying RPCs/policies (admin_grant_item, is_admin, the
-- tradeable check in accept_trade) are the same shared infrastructure
-- every item already goes through.
-- ============================================================================
-- purchase_type is left null (its column default) — the one thing that
-- hides an item from the shop entirely (get_shop_items() filters on
-- `purchase_type is not null`; purchase_item() itself also refuses a
-- null purchase_type outright before any other check runs). There is no
-- separate "category" column on item_definitions — admin-only items are
-- excluded from the shop by this one column, not a category enum.
--
-- The ONLY way this item ever reaches a player's inventory is an admin
-- using the existing admin_grant_item(p_recipient, p_item_id) RPC (see
-- 20260903042739_admin_inventory_gifting.sql) via
-- profile/admin-inventory.html's grant flow — that RPC re-checks
-- is_admin() itself, server-side, inside a SECURITY DEFINER function,
-- and is entirely generic (not specific to any one item_id), so no RPC
-- change was needed. A second grant attempt is already turned into a
-- clean "This account already owns that item." error by inventory_items'
-- own primary key (user_id, item_id) — instancing_mode='simple' means
-- that primary key IS the one-copy-per-player guarantee.
--
-- tradeable=false is enforced independently by accept_trade() (see
-- 20260909050700_fix_stack_zero_quantity_bug.sql), which rejects any
-- trade containing an untradeable item — no item-specific code needed.
-- There is no separate normal-user-to-user gifting system in this
-- codebase at all (only trade and admin-grant ever move an item between
-- accounts), so there is no second surface to lock down.
--
-- Granting is already permanently audited without further change:
-- admin_grant_item() inserts into inventory_items, which has had
-- granted_by (the admin's uid) and acquired_at (the timestamp) columns
-- since 20260903042739_admin_inventory_gifting.sql — that row, keyed by
-- (user_id = recipient, item_id), IS the audit record.
insert into public.item_definitions (
  item_id, name, description, equipment_slot, tradeable, instancing_mode,
  stock_type, active, purchase_type, currency_type, shop_price,
  max_owned_per_player, lifetime_limit, slot_category, display_order
) values (
  'ornate-green-suit-bottoms', 'Ornate Green Suit Bottoms', 'Ornate green and gold suit trousers. Admin-gifted only.',
  'legs', false, 'simple',
  'unlimited', true, null, null, null,
  1, 1, 'legs', 0
)
on conflict (item_id) do nothing;
