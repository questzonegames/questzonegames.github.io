-- ============================================================================
-- Test Sword — a genuine globally-limited item, for testing the "only N
-- ever made" shop mechanic end-to-end (buy it down to 0, confirm it greys
-- out and never restocks, confirm each copy gets its own permanent serial
-- number).
-- ============================================================================
-- instancing_mode='instance' is exactly what item_instances/serial_number
-- was built for (see 20260909050000_item_economy_foundation.sql PART 3):
-- purchase_item() already mints a real, permanent serial_number (1, 2, ...)
-- per copy the moment it's bought, unique per (item_id, serial_number) —
-- the first buyer gets "#1 of 2", the second "#2 of 2", and the database
-- itself (a UNIQUE constraint, not application code) guarantees neither
-- number can ever be issued twice, so a bug or a race could never produce
-- two different "#1 of 2"s.
--
-- max_owned_per_player and lifetime_limit are BOTH left null (no per-
-- player cap) — a single account may buy more than one copy, exactly as
-- requested; the edition_size=2 ⇒ issued_count cap is what actually stops
-- it once both copies are gone, for anyone.
--
-- Not granted to any account — this migration only creates the catalog
-- row, nothing else.
insert into public.item_definitions (
  item_id, name, description, equipment_slot, tradeable, instancing_mode,
  stock_type, active, purchase_type, currency_type, shop_price,
  edition_size, max_owned_per_player, lifetime_limit, slot_category, display_order
) values (
  'test-sword', 'Test Sword', 'A test item for the limited-stock shop mechanic — only 2 will ever exist.',
  'mainHand', false, 'instance',
  'limited', true, 'free', null, null,
  2, null, null, 'mainHand', 1
)
on conflict (item_id) do nothing;
