-- ============================================================================
-- Tidy up item_definitions.numeric_id — close the gap left by deleted QA
-- test fixtures, and move Test Sword (the one real item with "Test" in
-- its name) into a separate negative range reserved for test items, so
-- it's out of the real sequential count entirely.
-- ============================================================================
-- numeric_id is a secondary, purely informational/display identifier —
-- confirmed via a full codebase search that no client-side code ever
-- reads it, and no other table has a foreign key to it (every real
-- reference, everywhere, is item_id, the text slug). It's only used as
-- an ORDER BY tiebreaker in admin_get_shop_catalog. Changing its value
-- is therefore purely cosmetic — it cannot affect ownership, equipping,
-- the shop, or any RPC's behaviour beyond display order.
--
-- Before this migration: admin-crown=1, doggy-slippers=2, white-tshirt=3
-- (already sequential, untouched), grey-tracksuit-bottoms=10, test-sword=9
-- — the 4-8 gap was burned by now-deleted QA fixtures (qa-test-stack,
-- qa-test-limited, qa-test-simple-onepp; see 20260914040000_qa_shop_tests.sql),
-- and test-sword ended up ahead of grey-tracksuit-bottoms purely because
-- it was created first, not because of any real ordering intent.
--
-- After this migration: admin-crown=1, doggy-slippers=2, white-tshirt=3,
-- grey-tracksuit-bottoms=4 — a clean, gap-free run for every real item.
-- test-sword=-100 — the first entry in a separate negative range for
-- test/QA-flavoured items (-100, -101, -102, ... counting down), entirely
-- outside the real sequence so it can never again cause a gap in it.
--
-- The real sequence itself is reset so the NEXT genuinely new item
-- automatically continues at 5, with no manual numeric_id needed (same
-- as every item migration so far) — see setval below.
-- ============================================================================

update public.item_definitions set numeric_id = 4 where item_id = 'grey-tracksuit-bottoms';
update public.item_definitions set numeric_id = -100 where item_id = 'test-sword';

-- next nextval() on this sequence returns 5, continuing the real,
-- gap-free run exactly where grey-tracksuit-bottoms now leaves off.
select setval('public.item_definitions_numeric_id_seq', 5, false);
