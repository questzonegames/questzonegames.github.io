-- ============================================================================
-- Admin Inventory — a full-catalog "bank" only admins can see, letting them
-- grant themselves or any other player any item (including future ones,
-- automatically — it's driven by the item catalog, not a per-account list),
-- return items to it, and gift items to other players. Paired with a
-- site-wide "you received an item" notification the recipient sees the
-- next time they're not mid-game.
-- ============================================================================

alter table public.inventory_items add column if not exists granted_by uuid references auth.users(id) on delete set null;
alter table public.inventory_items add column if not exists notified_at timestamptz;

-- ----------------------------------------------------------------------------
-- username_for_id() — lets a player who was gifted an item resolve the
-- granting admin's username for the "gifted by ___" notification, without
-- being able to read that admin's whole profiles row (which own-or-admin
-- RLS would otherwise block for a non-admin looking at someone else's row).
-- Low-sensitivity by design: usernames are already effectively public
-- (shown on pinned achievements, unique at signup) — this just resolves
-- one further, same as email_for_username resolves a name to an email pre-
-- login.
-- ----------------------------------------------------------------------------
create or replace function public.username_for_id(p_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select username from public.profiles where id = p_id;
$$;

grant execute on function public.username_for_id(uuid) to authenticated, anon;

-- ----------------------------------------------------------------------------
-- admin_grant_item() — the only way an item enters someone's inventory now.
-- Records who granted it (auth.uid()) so the recipient's "you received
-- this" popup can say who gifted it — self-grants (an admin stocking their
-- own account from the Admin Inventory) still record granted_by = the
-- admin themselves; the client only shows "gifted by ___" when that
-- differs from the recipient, so granting to yourself reads as a plain
-- pickup, not a self-congratulatory gift message.
-- ----------------------------------------------------------------------------
create or replace function public.admin_grant_item(p_recipient uuid, p_item_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;

  insert into public.inventory_items (user_id, item_id, granted_by)
  values (p_recipient, p_item_id, auth.uid());

exception
  when unique_violation then
    raise exception 'This account already owns that item.';
end;
$$;

grant execute on function public.admin_grant_item(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- mark_item_seen() — lets a signed-in player mark their OWN item's "you
-- received this" popup as shown, so it doesn't show again. Deliberately a
-- narrow function rather than a general inventory_items UPDATE policy —
-- the only thing this can ever change is notified_at, and only on the
-- caller's own row.
-- ----------------------------------------------------------------------------
create or replace function public.mark_item_seen(p_item_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.inventory_items
    set notified_at = now()
    where user_id = auth.uid() and item_id = p_item_id and notified_at is null;
$$;

grant execute on function public.mark_item_seen(text) to authenticated;
