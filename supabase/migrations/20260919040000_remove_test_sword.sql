-- ============================================================================
-- Remove Test Sword from the game — discontinued, not deleted.
-- ============================================================================
-- A true row delete was considered and rejected: item_instances and
-- economy_transactions both reference this item_id with a RESTRICT (no
-- ON DELETE clause) foreign key, so removing the item_definitions row
-- outright would require first deleting economy_transactions' 2
-- mint_instance audit rows for this item — permanently erasing history
-- for a real second player's account (edition_size=2, both copies were
-- genuinely sold), not test/QA data. See
-- 20260909051000_qa_economy_cleanup.sql for the one precedent of doing
-- that in this repo, which was explicitly scoped to known-test accounts
-- only ("nothing here touches real production data") — that guarantee
-- doesn't hold here.
--
-- discontinued=true + active=false is this schema's own documented,
-- non-destructive removal mechanism (see ITEM_ECONOMY_ARCHITECTURE.md
-- §6): purchase_item() already refuses a discontinued/inactive item
-- ("This item is not available."), so it can never be bought or claimed
-- again and disappears from the shop's default view — while the 2
-- players who already own a copy keep theirs, exactly as owned items
-- from a retired edition should behave, and the audit ledger stays
-- intact for both of them.
-- ============================================================================

update public.item_definitions
  set active = false, discontinued = true
  where item_id = 'test-sword';
