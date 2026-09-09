# Quest Zone — Item Economy Architecture

How items, ownership, stock, trading, and currency work, server-side.
Written so a future Claude Code session (or a human) can read this file
and understand the design without re-deriving it from the migrations.

Supabase/Postgres is authoritative for everything in this document. The
browser client can display data and *request* an action; it never decides
whether that action is valid.

## 1. Two kinds of "what an item is" data — kept deliberately separate

- **Visual/art data** — icon, equip-slot art, avatar rig anchor — lives in
  **code**: `assets/js/inventory-data.js` (`window.QZ_ITEM_CATALOG`). Never
  duplicated into the database.
- **Economy data** — tradeable, stackable, stock, price — lives in
  **Supabase**: `item_definitions`. This is the part a modified client
  would try to lie about, so it has to be server-side.

Both are keyed by the same `item_id` (text, e.g. `'admin-crown'`,
`'doggy-slippers'`) — join them by that key when you need both a display
name/icon and its economy rules.

## 2. `item_definitions` — the DB-side catalog

```
item_id            text primary key
name                text
description          text
equipment_slot        text            -- null = not equippable
tradeable             boolean
instancing_mode        text            -- 'simple' | 'stack' | 'instance'
stock_type             text            -- 'unlimited' | 'limited'
edition_size            int             -- required iff stock_type='limited'
issued_count             int             -- how many of a limited edition exist so far
discontinued              boolean         -- independent of stock_type, see #6
shop_price                 int             -- null = not purchasable via purchase_item()
currency_type                text            -- 'quest_points' | 'stardust'
active                       boolean         -- visible/purchasable
is_test                       boolean         -- QA fixtures only
created_at                     timestamptz
```

`instancing_mode` decides which ownership table governs the item — this is
the fork in the "item definition → stackable ownership OR unique instance"
diagram:

| instancing_mode | ownership table          | meaning |
|---|---|---|
| `simple`  | `inventory_items` (existing) | own it or don't — no quantity, no serial |
| `stack`   | `player_item_stacks` (new)   | own a *quantity* of it |
| `instance`| `item_instances` (new)       | own specific serialized copies, each individually identifiable |

Constraints enforce the valid combinations from the spec (see the CHECKs
on the table): `instance` mode always implies `stock_type='limited'`;
`limited` always requires an `edition_size`; `issued_count` can never
exceed `edition_size` (enforced at the row level, not just in the minting
function). `tradeable` and `discontinued` are separate booleans from
`stock_type`/`instancing_mode` — every combination the spec lists
(unlimited+tradeable, limited+untradeable, discontinued+tradeable, etc.)
is representable.

No client insert/update/delete policy exists on this table at all —
creating or changing an item only ever happens via a migration (see §11).

## 3. Stackable ownership — `player_item_stacks`

```
user_id, item_id  (composite primary key)
quantity           int, CHECK (quantity > 0)
updated_at          timestamptz
```

`quantity` reaching zero **deletes the row** — it's never left at 0.
"Owns none" and "never owned" must look identical to every reader, and
the `> 0` CHECK means Postgres itself refuses a stray write that would
leave a zero or negative row, independent of whether the application code
that produced it has a bug. (A real bug of exactly this shape — an
UPDATE that tried to *set* quantity to 0 before a follow-up DELETE — was
caught by the test suite; see §12. Fix: check whether the result would be
`<= 0` *before* deciding UPDATE vs DELETE, never UPDATE through zero.)

## 4. Unique serialized ownership — `item_instances`

```
instance_id  uuid primary key default gen_random_uuid()   -- the REAL database identity
item_id       text references item_definitions
serial_number  int, CHECK (serial_number > 0)
owner_id        uuid references auth.users, nullable
created_at       timestamptz
UNIQUE (item_id, serial_number)
```

Per your explicit design note: **the serial number a player sees
("#4/10") is not the row's real identity.** `instance_id` is — a
permanent, immutable UUID generated once and never reused. `serial_number`
is only meaningful paired with the definition's `edition_size`. Trading or
granting a limited item **updates `owner_id` on this exact row** — it is
never deleted and recreated, so both the UUID and the serial survive every
transfer forever (verified in the test suite: same `instance_id`, same
`serial_number`, only `owner_id` changed, after a trade).

Two independent, Postgres-enforced guarantees, not application logic:
- `PRIMARY KEY (instance_id)` — global uniqueness of the row itself.
- `UNIQUE (item_id, serial_number)` — "#4/10" can only ever exist once for
  that edition.

Public SELECT policy (like `pinned_achievements`) — an item's owner is
meaningful information other players may see (e.g. a future public
"who owns Santa Hat #4/10" view). Nothing sensitive lives on this row.

## 5. `equipped_items` (existing table, extended)

Added a nullable `instance_id` column (referencing `item_instances`) —
set only when the equipped item is instance-mode, so a future "which
exact serial is equipped" view has it. `item_id` still always identifies
the item definition, for every mode, so existing display code keeps
working unchanged.

**Direct client writes to this table were revoked in this work** —
`equipped_insert_own`/`equipped_update_own`/`equipped_delete_own` are
gone. Equip/unequip now goes through `equip_item()`/`unequip_item()` (see
§7) for every item, not just the new stack/instance ones. This was
already a real gap for stackable items (a stack's quantity has to move
atomically with the equip — a bare client UPDATE can never do that
safely) and closing it for `simple`-mode items too (Admin Crown, Doggy
Slippers) costs nothing — same operation, just server-verified now.
`assets/js/inventory.js`'s `equip()`/`unequip()` were updated to call the
RPCs instead of writing the table directly; behaviour is unchanged from
the player's point of view (verified: Admin Crown and Doggy Slippers
still equip/unequip correctly).

## 6. Discontinued vs stock type — independent

`discontinued` is a plain boolean on `item_definitions`, unrelated to
`stock_type`/`instancing_mode`. A discontinued item can still be owned,
equipped, examined, and — if `tradeable=true` — traded; discontinuing
just means `active=false` so `purchase_item()` no longer sells it (see
the `not v_def.active` check). Setting `discontinued=true` on a
`stock_type='limited'` item after its `edition_size` is fully issued is
the normal "this edition is retired" state; setting it on an
`unlimited` item just means "no longer sold, existing copies unaffected."

## 7. RPCs — the only way any of this is ever written

Every function below is `SECURITY DEFINER`. There is **no** direct client
INSERT/UPDATE/DELETE policy on `item_definitions`, `player_item_stacks`,
`item_instances`, `economy_transactions`, `economy_requests`, `trades`,
`trade_items`, or `trade_currency` — a modified browser client can call
these functions with different *arguments*, but every argument is
independently re-validated against real database state inside the
function, never trusted.

### `purchase_item(p_item_id, p_quantity default 1, p_request_id default null)`

One entry point for buying *any* item, regardless of `instancing_mode`.

1. Idempotency check (`p_request_id` — see §9).
2. `SELECT ... FOR UPDATE` locks the `item_definitions` row — **this lock
   is what makes "two buyers, one last copy" resolve correctly**: every
   concurrent `purchase_item()` call for the *same* `item_id` queues here
   and runs one at a time. The second buyer's check only happens after
   the first has fully committed its `issued_count` increment, so it
   correctly sees "out of stock" instead of racing past the edition-size
   check. Verified under real concurrent load in the test suite (§12).
3. Validates: item active, purchasable, quantity rules, not already owned
   (simple mode), stock available (limited mode) — **before** touching
   currency.
4. Deducts currency (`quest_points` or `stardust`, whichever
   `currency_type` says), via the exact same `SELECT ... FOR UPDATE` /
   `UPDATE ... SET x = x - cost` pattern `purchase_profile_picture()`
   already used — nothing new invented here, matching the codebase's
   existing convention for a safe currency spend.
5. Grants the item — mints the next serial (`instance` mode), merges into
   the stack (`stack` mode), or inserts an `inventory_items` row (`simple`
   mode).
6. Records an `economy_transactions` row and (if `p_request_id` given) an
   `economy_requests` row.

### `equip_item(p_slot, p_item_id)` / `unequip_item(p_slot)`

Move exactly one unit between ownership and the slot, atomically, for
whichever `instancing_mode` the item is. `equip_item` unequips whatever
was previously in that slot first (returning it correctly) before
equipping the new item.

### `propose_trade(p_recipient, p_items, p_currency)` / `accept_trade(p_trade_id, p_items, p_currency, p_request_id)` / `cancel_trade(p_trade_id)`

See §8.

## 8. Trading

Minimal but real two-party model — **not** a full trade-window UI (none
is built yet; see §14). `propose_trade` creates a `pending` trade with
the initiator's offer attached (light validation only — existence,
recipient is real). `accept_trade` is where everything that matters
happens, in one atomic call:

1. Recipient's offer is attached now.
2. Both players' `profiles` rows are locked **in a fixed, sorted order**
   (by UUID text) — not "whichever side happens first" — so two
   concurrent trades between the same two accounts (in either direction)
   can never lock rows in opposite order and deadlock.
3. Every distinct `item_definitions` row this trade touches is locked, in
   sorted order, same reasoning — and this loop is also the
   **authoritative tradeability check**: any untradeable item anywhere in
   the trade aborts the whole thing immediately, server-side, no
   exceptions, regardless of what the UI would have allowed.
4. **Full re-validation** of every offered item and every currency amount
   against *current* database state — never whatever was true when
   `propose_trade` ran, per spec rule 16. An item sold or traded away in
   the meantime, or a balance spent elsewhere, is caught here.
5. Only once everything above has passed does any transfer actually
   happen — stack quantities move (and merge into an existing stack on
   the receiving side, verified), instance `owner_id`s move (same row,
   confirmed same `instance_id`/`serial_number` before and after), simple
   items move, currency moves both ways.
6. Trade marked `completed`, ledger rows written for every leg.

If *anything* fails at any point — an untradeable item, insufficient
quantity, insufficient currency — the **entire function raises an
exception**, and every change it made (including the recipient's own
just-inserted offer rows) rolls back together. Verified directly: a
trade offering a real, owned item plus an impossible currency amount
left the item exactly where it started (§12).

## 9. Idempotency — `economy_requests`

A client generates one fresh UUID per purchase/trade *attempt* (not per
retry) and passes it as `p_request_id`. If that exact request was already
processed — the response was lost to a dropped connection and the client
retried, or a double-click fired the handler twice — the RPC returns the
**original** cached result instead of executing again. Verified: calling
`purchase_item` twice with the same `p_request_id` charged currency and
granted the item exactly once (§12).

This is *why* disconnect/refresh/double-click/multi-tab can't duplicate a
purchase or trade: as long as the client reuses the same request id for
"this same logical attempt," a retried request is a safe no-op, not a
second execution. (Today's frontend doesn't generate/pass these ids yet
for the two RPCs it calls indirectly — see §14; the *mechanism* is built
and proven, wiring a real UI to always supply one is the remaining step.)

## 10. Audit ledger — `economy_transactions`

Append-only, insert-only-from-functions history — never current state
(current state is always `player_item_stacks`/`item_instances`/
`inventory_items`). Every purchase, mint, equip, unequip, and each leg of
a settled/cancelled trade gets a row: `event_type`, who, (counterparty for
trades), which item/instance, quantity, currency, the `request_id` that
produced it, and a free-form `detail` jsonb for extra context (e.g. a
trade's `trade_id`, a mint's serial number). Selectable by the account(s)
involved or an admin; never by anyone else, never editable by a player.

For a serialized item, its full provenance is reconstructable by querying
`economy_transactions where instance_id = X order by created_at` — mint,
then every trade leg it was ever part of, in order.

## 11. How to add a new item

**Unlimited item** (e.g. "Red T-shirt", stackable, tradeable, 100 Quest
Points):

```sql
insert into public.item_definitions
  (item_id, name, equipment_slot, tradeable, instancing_mode, stock_type, shop_price, currency_type, active)
values
  ('red-tshirt', 'Red T-shirt', 'body', true, 'stack', 'unlimited', 100, 'quest_points', true);
```

Also add its display entry (icon/art) to `assets/js/inventory-data.js` —
that part is unchanged from before this work.

**Limited/discontinued item** (e.g. "Santa Hat", exactly 10 copies,
tradeable):

```sql
insert into public.item_definitions
  (item_id, name, equipment_slot, tradeable, instancing_mode, stock_type, edition_size, shop_price, currency_type, active)
values
  ('santa-hat', 'Santa Hat', 'head', true, 'instance', 'limited', 10, 250, 'quest_points', true);
```

That's it — `purchase_item('santa-hat')` already knows to mint the next
serial, stop at #10, and reject an 11th; `accept_trade` already knows how
to move a specific serial without recreating it. Nothing about `purchase_item`,
`equip_item`, or `accept_trade` needs to change for a new item of a kind
that already exists (add art in `inventory-data.js` when ready; the
economy side needs nothing further).

## 12. Testing performed (temporary fixtures, all removed afterward)

Four temporary `item_definitions` rows (`qa-test-a`..`d`, `is_test=true`)
covering the four combinations the spec asked for (unlimited+stackable+
tradeable, unlimited+untradeable, limited×10+tradeable, limited×10+
untradeable), tested against two real accounts (an admin account and one
clearly-a-test account, `ducktest`) via a mix of real browser RPC calls
and a Postgres-side simulated-session technique
(`set_config('request.jwt.claims', ...)`) for the two-party trade tests.

All passed after fixes:

- Stackable purchase (buy 3, buy 5 more → 8), stack shows as one row.
- Equip decrements the stack by exactly 1, unequip restores it — **found
  and fixed a real bug**: decrementing to exactly zero via `UPDATE`
  violated the `quantity > 0` CHECK before a follow-up `DELETE` could
  run; fixed to delete outright instead of updating through zero (same
  bug existed in `accept_trade`'s stack-transfer path — fixed there too).
- Untradeable item: `accept_trade` rejects it server-side with a clear
  error; ownership provably unchanged on both sides afterward.
- Limited edition: minted serials #1–#9 in order; a two-way *simultaneous*
  purchase of the 10th and final copy resolved to **exactly one**
  success and one "Out of stock" — `issued_count` stayed at 10, never 11,
  and exactly 10 `item_instances` rows exist, no duplicate serial.
- Direct raw `INSERT` of a duplicate `#4/10` → rejected by the `UNIQUE`
  constraint itself (not application code).
- Direct raw `UPDATE ... quantity = -5` → rejected by the `CHECK`
  constraint itself.
- Direct raw `UPDATE ... issued_count = 11` on a 10-edition item →
  rejected by the `CHECK` constraint itself.
- Stackable trade: full-stack and partial-stack transfers, and confirmed
  stacks **merge** into the recipient's existing row rather than creating
  a second row for the same item.
- Unique-instance trade: transferred, confirmed the *same* `instance_id`
  and `serial_number` before and after (not recreated).
- Trade atomicity: a trade with one real item leg and one impossible
  currency leg was entirely rejected — the item never left its original
  owner.
- Idempotent purchase: same `request_id` sent twice → charged and granted
  exactly once, second call returned the cached result.
- Direct forged browser writes (inflate a stack quantity, steal an
  instance's `owner_id`, forge `inventory_items` ownership, write
  straight into the ledger, alter an item's price) — **every one silently
  affected zero rows**; real state confirmed unchanged after each attempt.

All temporary fixtures, ownership rows, and ledger entries for
`qa-test-*` items were deleted afterward; both test accounts' Quest
Points were restored to their exact pre-test balance (both were 0
before and after). Confirmed no real item (`admin-crown`,
`doggy-slippers`) or real account data was touched.

## 13. Security review notes

- Client-controlled quantities/prices/owner IDs: none — every mutating
  RPC re-derives these from the database, never trusts a client-supplied
  value for anything except *which* item/quantity/instance is being
  requested (the request itself), and every one of those is re-checked
  against real ownership/stock/balance before acting.
- Race conditions: handled via row locks (`FOR UPDATE`) on
  `item_definitions` (stock) and `profiles` (currency), in a fixed lock
  order across `accept_trade`'s two-party case to avoid deadlock.
- Replay/double-submit: `economy_requests` idempotency keys.
- RLS gaps: none found on the new tables — every mutation path was
  independently confirmed to reject a forged direct client write.
- No service-role key is used or exposed anywhere in this work; every
  RPC runs as `SECURITY DEFINER` under normal `authenticated` grants,
  same pattern the rest of this codebase already uses.

## 14. What is NOT built yet (read before promising a feature)

- **No trade-window UI.** `propose_trade`/`accept_trade` are real,
  tested, and safe to call, but no page lets a player build and see a
  trade offer yet. Building that is a frontend task on top of this
  foundation, not a backend one.
- **No shop UI for the new item types.** `purchase_item` is real and
  tested; no page calls it yet for a stack/instance item (the existing
  Admin Inventory/gifting flow is unrelated and untouched).
- **`purchase_item`/`accept_trade` aren't wired with real
  client-generated `request_id`s from any page yet** — the idempotency
  mechanism is built and proven (§12), but no frontend code currently
  generates and passes one. Do this when a real purchase/trade UI is
  built.
- **No admin item-creation UI** — new items are added via a migration
  (§11), same as `admin_grant_item`'s catalog always has been.
- No permanent production items were created by this work — `admin-crown`
  and `doggy-slippers` are the only real `item_definitions` rows, both
  backfilled with their existing (simple, untradeable, unlimited)
  behaviour, unchanged.
