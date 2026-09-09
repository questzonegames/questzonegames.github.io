-- ============================================================================
-- Quest Zone — server-authoritative item economy foundation
-- ============================================================================
-- Adds: item_definitions (the real, DB-side catalog — economy metadata,
-- NOT visual/art data, which stays in assets/js/inventory-data.js exactly
-- as before), player_item_stacks (quantity-based ownership for stackable
-- items), item_instances (unique serialized ownership for limited items),
-- economy_transactions (append-only audit ledger), economy_requests
-- (idempotency keys for purchases/trades), trades/trade_items/
-- trade_currency (player-to-player trade backend).
--
-- Existing inventory_items/equipped_items are REUSED, not replaced —
-- they keep working exactly as before for simple, non-stackable,
-- non-limited items (Admin Crown, Doggy Slippers), see PART 1.
--
-- Full design rationale + how to add a new item: see
-- ITEM_ECONOMY_ARCHITECTURE.md at the repo root.
-- ============================================================================

-- ============================================================================
-- PART 1 — item_definitions: the DB-side item catalog
-- ============================================================================
-- Deliberately separate from assets/js/inventory-data.js (QZ_ITEM_CATALOG),
-- which stays the source of truth for purely visual data (icon, equip-slot
-- art, avatar rig anchor) — nothing here duplicates that. This table is
-- the source of truth for ECONOMY properties: whether an item can be
-- traded, whether it stacks, how its stock works, and its shop price.
-- Those properties MUST be server-side, since they're exactly what a
-- modified client would try to lie about.
--
-- instancing_mode decides which of the two ownership tables (below)
-- governs this item:
--   'simple' — own it or don't; uses the EXISTING inventory_items table,
--              unchanged. For today's non-stackable, non-limited items
--              (Admin Crown, Doggy Slippers) — zero behaviour change.
--   'stack'  — quantity-based ownership; uses NEW player_item_stacks.
--   'instance' — individually serialized ownership; uses NEW
--              item_instances. Always implies stock_type = 'limited'
--              (a serial number only means something against a fixed
--              edition size).
create table if not exists public.item_definitions (
  item_id text primary key,
  name text not null,
  description text,
  equipment_slot text,               -- null = not equippable (a currency-only or purely cosmetic item)
  tradeable boolean not null default false,
  instancing_mode text not null default 'simple'
    check (instancing_mode in ('simple', 'stack', 'instance')),
  stock_type text not null default 'unlimited'
    check (stock_type in ('unlimited', 'limited')),
  edition_size int,                  -- required for stock_type='limited', null otherwise
  issued_count int not null default 0, -- how many of a limited edition have been minted so far
  discontinued boolean not null default false, -- independent of stock_type — see architecture doc
  shop_price int check (shop_price is null or shop_price > 0),
  currency_type text check (currency_type in ('quest_points', 'stardust')),
  active boolean not null default true, -- purchasable/visible; discontinued items can stay active=true (still ownable/tradeable, just not the original shop source — see doc)
  is_test boolean not null default false, -- temporary QA fixtures only, see cleanup migration
  created_at timestamptz not null default now(),
  constraint item_definitions_limited_needs_edition_size
    check (stock_type != 'limited' or edition_size is not null),
  constraint item_definitions_unlimited_no_edition_size
    check (stock_type = 'unlimited' or instancing_mode = 'instance'),
  constraint item_definitions_instance_mode_is_limited
    check (instancing_mode != 'instance' or stock_type = 'limited'),
  constraint item_definitions_issued_within_edition
    check (edition_size is null or issued_count <= edition_size),
  constraint item_definitions_shop_price_needs_currency
    check ((shop_price is null) = (currency_type is null))
);
alter table public.item_definitions enable row level security;
drop policy if exists "item_definitions_select_all" on public.item_definitions;
create policy "item_definitions_select_all" on public.item_definitions for select using (true);
-- No client insert/update/delete policy at all, deliberately — creating or
-- changing an item definition (price, stock, tradeability) only ever
-- happens through migrations or a future admin RPC, never a direct client
-- write; see rule "the backend must independently reject" throughout the
-- spec this migration implements.

-- Backfill definitions for the two items that already exist as plain
-- code-catalog + inventory_items rows — same behaviour as today (owned
-- via inventory_items, not purchasable, not tradeable, not stackable).
insert into public.item_definitions (item_id, name, equipment_slot, tradeable, instancing_mode, stock_type, active)
values
  ('admin-crown', 'Admin Crown', 'head', false, 'simple', 'unlimited', true),
  ('doggy-slippers', 'Doggy Slippers', 'boots', false, 'simple', 'unlimited', true)
on conflict (item_id) do nothing;

-- ============================================================================
-- PART 2 — player_item_stacks: quantity-based ownership (stackable items)
-- ============================================================================
create table if not exists public.player_item_stacks (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null references public.item_definitions(item_id),
  quantity int not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id),
  constraint player_item_stacks_quantity_positive check (quantity > 0)
  -- quantity reaching 0 DELETES the row (see the RPCs below) rather than
  -- storing a zero — "owns 0 of an item" and "never owned it" should look
  -- identical to every reader, and a positive-only CHECK constraint means
  -- Postgres itself refuses a client-forged UPDATE ... SET quantity = -5
  -- even if RLS somehow had a hole, not just application code.
);
alter table public.player_item_stacks enable row level security;
create index if not exists player_item_stacks_user_idx on public.player_item_stacks(user_id);
drop policy if exists "player_item_stacks_select_own_or_admin" on public.player_item_stacks;
create policy "player_item_stacks_select_own_or_admin"
  on public.player_item_stacks for select
  using (auth.uid() = user_id or public.is_admin());
-- No client insert/update/delete — every change goes through
-- purchase_item/equip_item/unequip_item/accept_trade below.

-- ============================================================================
-- PART 3 — item_instances: unique serialized ownership (limited items)
-- ============================================================================
-- The instance_id (UUID) is the item's real, permanent database identity —
-- generated once, never reused, never changes. serial_number is what a
-- player sees ("#4/10") and is only meaningful together with the
-- definition's edition_size. Trading or granting a limited item MOVES this
-- exact row (updates owner_id) — it is never deleted and recreated, so the
-- instance_id and serial_number both survive every transfer forever.
create table if not exists public.item_instances (
  instance_id uuid primary key default gen_random_uuid(),
  item_id text not null references public.item_definitions(item_id),
  serial_number int not null check (serial_number > 0),
  owner_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint item_instances_unique_serial_per_edition unique (item_id, serial_number)
  -- This UNIQUE constraint is the actual, Postgres-enforced guarantee that
  -- "#4/10" can only ever exist once for a given item — not application
  -- logic, a real constraint that survives a bug, a race, or a forged
  -- request. instance_id's own PRIMARY KEY is the second, independent
  -- guarantee (global uniqueness of the row itself, regardless of serial).
);
alter table public.item_instances enable row level security;
create index if not exists item_instances_owner_idx on public.item_instances(owner_id);
create index if not exists item_instances_item_idx on public.item_instances(item_id);
drop policy if exists "item_instances_select_own_or_admin_or_public_meta" on public.item_instances;
-- Public select — an item's OWNER is meaningful information other players
-- need too (e.g. seeing who owns Santa Hat #4/10 on a future public
-- examine/leaderboard view), same reasoning pinned_achievements already
-- uses for public-select. Nothing sensitive (no currency, no email) lives
-- on this row.
create policy "item_instances_select_all"
  on public.item_instances for select using (true);
-- No client insert/update/delete — minting and transfer only ever happen
-- inside purchase_item/accept_trade below, under a row lock on the owning
-- item_definitions row (see PART 6) that makes "two buyers, one last
-- copy" resolve to exactly one winner.

-- ============================================================================
-- PART 4 — equipped_items: extend for stack/instance items
-- ============================================================================
-- item_id keeps meaning "which item definition is in this slot" for every
-- mode (so existing display code that reads equipped_items.item_id to look
-- up the JS catalog entry keeps working unchanged); instance_id is
-- ADDITIONALLY set only when the equipped item is instance-mode, so a
-- future "which exact serial is equipped" view has it available.
alter table public.equipped_items add column if not exists instance_id uuid references public.item_instances(instance_id) on delete set null;

-- Direct client writes to equipped_items are revoked as of this migration
-- — equip/unequip now goes through equip_item()/unequip_item() below for
-- EVERY item (simple, stack, or instance mode), not just the new ones.
-- This was already a real gap for stackable items (a stack's quantity must
-- move atomically with the equip, which a bare client UPDATE/INSERT can
-- never do safely) and closing it for simple-mode items too costs nothing
-- (equip_item's simple-mode branch is exactly the old direct-write logic,
-- just now server-verified) while matching the spec's "sensitive
-- mutations only through approved secure functions" rule uniformly rather
-- than leaving one item mode as an exception.
drop policy if exists "equipped_insert_own" on public.equipped_items;
drop policy if exists "equipped_update_own" on public.equipped_items;
drop policy if exists "equipped_delete_own" on public.equipped_items;
-- select policy (equipped_select_own_or_admin) is untouched — still fine,
-- reading your own equipped items was never the risk.

-- ============================================================================
-- PART 5 — economy_transactions: append-only audit ledger
-- ============================================================================
-- NOT current-state — current ownership is always player_item_stacks /
-- item_instances / inventory_items. This is history: what happened, when,
-- to investigate a dispute or a suspected exploit. Every economy-mutating
-- RPC below inserts at least one row here before returning.
create table if not exists public.economy_transactions (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  event_type text not null check (event_type in (
    'purchase', 'mint_instance', 'trade_settled', 'trade_cancelled',
    'equip', 'unequip', 'admin_grant'
  )),
  user_id uuid references auth.users(id) on delete set null,
  counterparty_id uuid references auth.users(id) on delete set null, -- the other side of a trade, if any
  item_id text references public.item_definitions(item_id),
  instance_id uuid references public.item_instances(instance_id),
  quantity int,
  currency_type text check (currency_type is null or currency_type in ('quest_points', 'stardust')),
  currency_amount int,
  request_id uuid,       -- the idempotency key that produced this row, if any (see PART 7)
  detail jsonb           -- free-form extra context (e.g. trade_id, serial_number at time of event)
);
alter table public.economy_transactions enable row level security;
create index if not exists economy_transactions_user_idx on public.economy_transactions(user_id, created_at desc);
create index if not exists economy_transactions_item_idx on public.economy_transactions(item_id, created_at desc);
drop policy if exists "economy_transactions_select_own_or_admin" on public.economy_transactions;
create policy "economy_transactions_select_own_or_admin"
  on public.economy_transactions for select
  using (auth.uid() = user_id or auth.uid() = counterparty_id or public.is_admin());
-- No client insert/update/delete at all — an audit ledger a player could
-- edit isn't an audit ledger. Every insert happens from inside a
-- SECURITY DEFINER function, never directly.

-- ============================================================================
-- PART 6 — economy_requests: idempotency for purchases/trades
-- ============================================================================
-- A client generates a fresh UUID per purchase/trade ATTEMPT (not per
-- retry) and passes it as p_request_id. If that exact request_id was
-- already processed (e.g. the response was lost to a dropped connection
-- and the client retried), the RPC returns the ORIGINAL result again
-- instead of executing a second time — see purchase_item/accept_trade.
create table if not exists public.economy_requests (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.economy_requests enable row level security;
create index if not exists economy_requests_user_idx on public.economy_requests(user_id, created_at desc);
drop policy if exists "economy_requests_select_own_or_admin" on public.economy_requests;
create policy "economy_requests_select_own_or_admin"
  on public.economy_requests for select
  using (auth.uid() = user_id or public.is_admin());
-- No client insert/update/delete — written only by the RPCs themselves.

-- ============================================================================
-- PART 7 — trades / trade_items / trade_currency
-- ============================================================================
-- Minimal but real two-party trade model: the initiator proposes with
-- their own offer already attached; the recipient, in ONE call
-- (accept_trade), supplies their offer AND settles everything atomically.
-- No live back-and-forth negotiation UI is built on top of this yet (see
-- ITEM_ECONOMY_ARCHITECTURE.md) — this is the backend foundation the spec
-- asked for, sized to what's actually needed to prove atomic settlement,
-- not a full trade-window feature.
create table if not exists public.trades (
  trade_id uuid primary key default gen_random_uuid(),
  initiator_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint trades_not_self check (initiator_id != recipient_id)
);
alter table public.trades enable row level security;
create index if not exists trades_initiator_idx on public.trades(initiator_id, status);
create index if not exists trades_recipient_idx on public.trades(recipient_id, status);
drop policy if exists "trades_select_participant_or_admin" on public.trades;
create policy "trades_select_participant_or_admin"
  on public.trades for select
  using (auth.uid() = initiator_id or auth.uid() = recipient_id or public.is_admin());

create table if not exists public.trade_items (
  id bigint generated always as identity primary key,
  trade_id uuid not null references public.trades(trade_id) on delete cascade,
  side text not null check (side in ('initiator', 'recipient')),
  item_id text not null references public.item_definitions(item_id),
  instance_id uuid references public.item_instances(instance_id), -- set for instance-mode offers only
  quantity int,                                                    -- set for stack-mode offers only
  constraint trade_items_exactly_one_kind check (
    (instance_id is not null and quantity is null) or
    (instance_id is null and quantity is not null and quantity > 0)
  )
);
alter table public.trade_items enable row level security;
create index if not exists trade_items_trade_idx on public.trade_items(trade_id);
drop policy if exists "trade_items_select_participant_or_admin" on public.trade_items;
create policy "trade_items_select_participant_or_admin"
  on public.trade_items for select
  using (exists (
    select 1 from public.trades t where t.trade_id = trade_items.trade_id
      and (auth.uid() = t.initiator_id or auth.uid() = t.recipient_id or public.is_admin())
  ));

create table if not exists public.trade_currency (
  id bigint generated always as identity primary key,
  trade_id uuid not null references public.trades(trade_id) on delete cascade,
  side text not null check (side in ('initiator', 'recipient')),
  currency_type text not null check (currency_type in ('quest_points', 'stardust')),
  amount int not null check (amount > 0)
);
alter table public.trade_currency enable row level security;
create index if not exists trade_currency_trade_idx on public.trade_currency(trade_id);
drop policy if exists "trade_currency_select_participant_or_admin" on public.trade_currency;
create policy "trade_currency_select_participant_or_admin"
  on public.trade_currency for select
  using (exists (
    select 1 from public.trades t where t.trade_id = trade_currency.trade_id
      and (auth.uid() = t.initiator_id or auth.uid() = t.recipient_id or public.is_admin())
  ));
-- trades/trade_items/trade_currency all have NO client insert/update/
-- delete policy — propose_trade/accept_trade/cancel_trade (below) are the
-- only way any row in these three tables is ever written.
