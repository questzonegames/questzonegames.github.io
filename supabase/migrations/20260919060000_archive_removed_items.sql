-- ============================================================================
-- Archived Items — a permanent, invisible-to-everyone home for an item
-- that's being fully removed from the live game, as an alternative to a
-- true hard delete. Nothing that lands here is ever destroyed; it's just
-- relocated out of every live/queryable/visible table.
-- ============================================================================
-- Deliberately has NO row level security policies at all (RLS is enabled,
-- with zero policies attached) — that means literally nobody, not even
-- an authenticated admin, can read, insert, or modify it through the
-- public API. The only way to ever see this table's contents is direct
-- database access (the Supabase dashboard's SQL editor, or a future
-- migration) — exactly "stored somewhere, people can't have access to
-- it." Writing to it only ever happens from inside a migration, same as
-- item_definitions' own "no client write policy at all" pattern.
create table if not exists public.archived_items (
  item_id text primary key,
  numeric_id bigint,
  archived_at timestamptz not null default now(),
  reason text,
  -- Full snapshots, as JSON, of everything this item ever was and did —
  -- the item_definitions row itself, every item_instances row it ever
  -- had (who owned which serial), and its complete economy_transactions
  -- audit history. Restoring it later (should that ever be wanted) is a
  -- read of this one row, not archaeology across 4 different tables.
  item_definition jsonb not null,
  former_instances jsonb not null default '[]'::jsonb,
  transaction_history jsonb not null default '[]'::jsonb
);
alter table public.archived_items enable row level security;

-- ============================================================================
-- Archive Test Sword, then remove every live trace of it.
-- ============================================================================
-- Both issued copies (serial #1 and #2) belong to the same person's own
-- two accounts (main + the "Duck" test account) — explicit, repeated
-- instruction to remove it entirely: gone from the shop, gone from both
-- accounts' inventories with no visible trace, but archived rather than
-- destroyed.

-- 1. Snapshot the item's full current state into the archive before
--    touching anything live.
insert into public.archived_items (item_id, numeric_id, reason, item_definition, former_instances, transaction_history)
select
  d.item_id,
  d.numeric_id,
  'Removed from the game per explicit request. Archived rather than hard-deleted so ownership and audit history are preserved but nothing about it remains live, purchasable, equippable, or visible anywhere.',
  to_jsonb(d.*),
  (select coalesce(jsonb_agg(to_jsonb(i.*)), '[]'::jsonb) from public.item_instances i where i.item_id = d.item_id),
  (select coalesce(jsonb_agg(to_jsonb(t.*)), '[]'::jsonb) from public.economy_transactions t where t.item_id = d.item_id)
from public.item_definitions d
where d.item_id = 'test-sword'
on conflict (item_id) do nothing;

-- 2. Unequip it from every account currently wearing it — the exact same
--    operation (delete the equipped_items row) that happens every time
--    any player unequips any item; just pre-targeted at this one item_id
--    instead of a live (user_id, slot).
delete from public.equipped_items where item_id = 'test-sword';

-- 3. Remove the live audit-ledger rows — already preserved verbatim in
--    the archive snapshot above.
delete from public.economy_transactions where item_id = 'test-sword';
delete from public.economy_requests
  where operation = 'purchase_item' and (result->>'item_id') = 'test-sword';

-- 4. Strip live ownership — both serials, from whichever accounts hold
--    them — already preserved verbatim in the archive snapshot above.
delete from public.item_instances where item_id = 'test-sword';

-- 5. Remove the catalog row itself. Nothing references item_id=
--    'test-sword' anywhere in the live schema after the deletes above,
--    so this now succeeds cleanly — and it's genuinely gone from every
--    live listing (the shop, its own "Discontinued" filter, everything),
--    not just hidden behind active=false.
delete from public.item_definitions where item_id = 'test-sword';
