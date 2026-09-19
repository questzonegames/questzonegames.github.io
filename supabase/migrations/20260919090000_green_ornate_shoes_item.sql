-- ============================================================================
-- Green Ornate Shoes — an admin-only, gift-only, split-parts boots item.
-- Same rules and security shape as Green Ornate Suit Top/Bottoms (see
-- 20260919070000/20260919080000), but a split-parts item like Doggy
-- Slippers: ONE item_id, ONE inventory_items row, TWO independently
-- rigged view layers (left/right). Nothing about how left/right work is
-- new — that mechanism (avatar_rig_items' own `part` column, primary
-- keyed (body_type, slot, item_id, direction, part) — see
-- 20260909060000_avatar_rig_split_parts.sql) already exists purely to
-- support exactly this. This migration only adds the catalog row; the
-- left/right split itself is entirely driven by assets/js/inventory-data.js's
-- `parts`/`views.left`/`views.right` on this one item_id, read generically
-- by setAvatarEquipment (avatar-viewer.js) — no new code anywhere.
-- ============================================================================
-- purchase_type is left null (its column default) — the one thing that
-- hides an item from the shop entirely (get_shop_items() filters on
-- `purchase_type is not null`; purchase_item() itself also refuses a
-- null purchase_type outright). There is no separate "category" column
-- on item_definitions — admin-only items are excluded from the shop by
-- this one column, not a category enum.
--
-- The ONLY way this item ever reaches a player's inventory is an admin
-- using the existing admin_grant_item(p_recipient, p_item_id) RPC (see
-- 20260903042739_admin_inventory_gifting.sql) via
-- profile/admin-inventory.html's grant flow — that RPC re-checks
-- is_admin() itself, server-side, inside a SECURITY DEFINER function,
-- and is entirely generic (not specific to any one item_id OR to
-- whether an item happens to be split-parts — it only ever touches
-- inventory_items, which has no concept of "parts" at all; the split
-- is purely a rendering detail on top of ONE ownership row, exactly
-- like Doggy Slippers). A second grant attempt is already turned into a
-- clean "This account already owns that item." error by inventory_items'
-- own primary key (user_id, item_id) — instancing_mode='simple' means
-- that primary key IS the one-copy-per-player guarantee, for the whole
-- item (both shoes together), never per-part.
--
-- tradeable=false is enforced independently by accept_trade() (see
-- 20260909050700_fix_stack_zero_quantity_bug.sql), which rejects any
-- trade containing an untradeable item — checked once per item_id, so a
-- split-parts item is blocked as a whole, never per-shoe. There is no
-- separate normal-user-to-user gifting system in this codebase at all
-- (only trade and admin-grant ever move an item between accounts), so
-- there is no second surface to lock down.
--
-- Granting is already permanently audited without further change:
-- admin_grant_item() inserts into inventory_items, which has had
-- granted_by (the admin's uid) and acquired_at (the timestamp) columns
-- since 20260903042739_admin_inventory_gifting.sql — that one row,
-- keyed by (user_id = recipient, item_id), IS the audit record for the
-- whole item, both shoes included.
insert into public.item_definitions (
  item_id, name, description, equipment_slot, tradeable, instancing_mode,
  stock_type, active, purchase_type, currency_type, shop_price,
  max_owned_per_player, lifetime_limit, slot_category, display_order
) values (
  'green-ornate-shoes', 'Green Ornate Shoes', 'Ornate green and gold dress shoes. Admin-gifted only.',
  'boots', false, 'simple',
  'unlimited', true, null, null, null,
  1, 1, 'boots', 0
)
on conflict (item_id) do nothing;
