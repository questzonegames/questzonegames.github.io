-- Test fixture correction: QA Test A needs an equipment_slot to exercise
-- the "equip one from a stack, quantity decrements/increments" test.
update public.item_definitions set equipment_slot = 'body' where item_id = 'qa-test-a' and is_test;
