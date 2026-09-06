-- ============================================================================
-- Avatar Rig Editor — canonical, admin-editable avatar calibration data.
--
-- This is the ONE place item placement (Admin Crown today, any future
-- head/necklace/body/legs/boots/gloves/back/mainHand/offHand/accessory item
-- tomorrow) and the base rig anchors (SKULL/ABOVE_HEAD/FOREHEAD/NECK per
-- direction) live. assets/js/avatar-viewer.js (the REAL renderer every
-- player sees) reads these same rows — the admin editor and the live game
-- are not two systems that can drift, they're one reader (the editor UI)
-- and one writer (the admin RPCs below) of the same tables.
--
-- Security model, same controlled-write-path convention as the rest of this
-- schema (admin_ban_user, admin_grant_item, admin_set_test_account, etc):
--   - RLS SELECT is public (`using (true)`) — every visitor's browser needs
--     to read this to render ANY player wearing the item correctly, not
--     just admins. This data was already effectively public (it's baked
--     into PNG pixels/CSS today) — nothing sensitive lives here.
--   - There is NO insert/update/delete RLS policy on either table at all —
--     direct table writes are impossible for every role including admins.
--     The only way to change a row is through a SECURITY DEFINER RPC that
--     re-checks is_admin() itself, so a normal user who deletes the admin
--     button from dev tools and calls the same RPC by hand gets
--     "Not authorized." from the database, not a client-side check that
--     can be skipped. See CLAUDE.md/SECURITY.md for this project's
--     standing rule on that pattern.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- avatar_rig_anchors — the base rig (SKULL, ABOVE_HEAD, FOREHEAD, NECK today;
-- more anchor types later use the same shape) per body type + direction.
-- Seeded below from the values already measured directly off the bald base's
-- own alpha channel (see assets/js/avatar-rig.js / docs/avatar-equipment.md)
-- — not invented here.
-- ----------------------------------------------------------------------------
create table if not exists public.avatar_rig_anchors (
  body_type text not null default 'male',
  direction text not null check (direction in ('front','right','back','left')),
  anchor_type text not null check (anchor_type in ('above_head','skull','forehead','neck')),
  canvas_w int not null check (canvas_w > 0),
  canvas_h int not null check (canvas_h > 0),
  center_x_pct numeric not null check (center_x_pct between 0 and 100),
  y_pct numeric not null check (y_pct between -20 and 120),
  width_pct numeric not null check (width_pct between 0 and 200),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (body_type, direction, anchor_type)
);
alter table public.avatar_rig_anchors enable row level security;

drop policy if exists "avatar_rig_anchors_select_public" on public.avatar_rig_anchors;
create policy "avatar_rig_anchors_select_public"
  on public.avatar_rig_anchors for select
  using (true);
-- deliberately no insert/update/delete policy — see header comment.

-- ----------------------------------------------------------------------------
-- avatar_rig_items — per-item, per-direction calibration: how far an item
-- sits from its assigned anchor (offset_x/offset_y, in that direction's own
-- canvas-pixel units — same units avatar_rig_anchors.canvas_w/h use), how
-- big relative to the anchor's own width_pct (scale = 1.0 means "rendered
-- width equals the anchor's reference width exactly"), and rotation in
-- degrees. anchor_type is stored per item+direction (not hardcoded per
-- item) because SKULL vs FOREHEAD vs ABOVE_HEAD is a per-item design choice
-- the admin makes in the editor, matching the "generic reusable anchors,
-- not item-specific ones" rule.
-- ----------------------------------------------------------------------------
create table if not exists public.avatar_rig_items (
  body_type text not null default 'male',
  slot text not null check (slot in ('head','necklace','body','legs','boots','gloves','back','mainHand','offHand','accessory')),
  item_id text not null,
  direction text not null check (direction in ('front','right','back','left')),
  anchor_type text not null check (anchor_type in ('above_head','skull','forehead','neck')),
  offset_x numeric not null default 0 check (offset_x between -2000 and 2000),
  offset_y numeric not null default 0 check (offset_y between -2000 and 2000),
  scale numeric not null default 1 check (scale between 0.05 and 5),
  rotation numeric not null default 0 check (rotation between -180 and 180),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (body_type, slot, item_id, direction)
);
alter table public.avatar_rig_items enable row level security;

drop policy if exists "avatar_rig_items_select_public" on public.avatar_rig_items;
create policy "avatar_rig_items_select_public"
  on public.avatar_rig_items for select
  using (true);
-- deliberately no insert/update/delete policy — see header comment.

-- ----------------------------------------------------------------------------
-- avatar_rig_audit_log — a lightweight trail of who changed what, when.
-- Admin-readable only; written exclusively by the RPCs below (never
-- directly), same locked-down-table pattern as the two tables above.
-- ----------------------------------------------------------------------------
create table if not exists public.avatar_rig_audit_log (
  id bigint generated always as identity primary key,
  admin_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  body_type text,
  slot text,
  item_id text,
  direction text,
  detail jsonb,
  created_at timestamptz not null default now()
);
alter table public.avatar_rig_audit_log enable row level security;

drop policy if exists "avatar_rig_audit_log_select_admin" on public.avatar_rig_audit_log;
create policy "avatar_rig_audit_log_select_admin"
  on public.avatar_rig_audit_log for select
  using (public.is_admin());
-- no insert/update/delete policy — RPC-only, see header comment.

-- ----------------------------------------------------------------------------
-- admin_save_avatar_rig_item() — the ONLY way an item's calibration changes.
-- Upserts one (body_type, slot, item_id, direction) row. NaN/Infinity are
-- rejected for free by the `numeric` column type (unlike float, Postgres
-- numeric has no representation for either); the CHECK constraints above
-- reject absurd-but-finite values (a scale of 500x, a 10000px offset, a
-- 4000-degree rotation).
-- ----------------------------------------------------------------------------
create or replace function public.admin_save_avatar_rig_item(
  p_body_type text, p_slot text, p_item_id text, p_direction text,
  p_anchor_type text, p_offset_x numeric, p_offset_y numeric,
  p_scale numeric, p_rotation numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;
  if p_item_id is null or length(trim(p_item_id)) = 0 then
    raise exception 'Missing item id.';
  end if;

  insert into public.avatar_rig_items
    (body_type, slot, item_id, direction, anchor_type, offset_x, offset_y, scale, rotation, updated_at, updated_by)
  values
    (coalesce(p_body_type, 'male'), p_slot, p_item_id, p_direction, p_anchor_type, p_offset_x, p_offset_y, p_scale, p_rotation, now(), auth.uid())
  on conflict (body_type, slot, item_id, direction) do update set
    anchor_type = excluded.anchor_type,
    offset_x = excluded.offset_x,
    offset_y = excluded.offset_y,
    scale = excluded.scale,
    rotation = excluded.rotation,
    updated_at = now(),
    updated_by = auth.uid();

  insert into public.avatar_rig_audit_log (admin_id, action, body_type, slot, item_id, direction, detail)
  values (auth.uid(), 'save_item', p_body_type, p_slot, p_item_id, p_direction,
    jsonb_build_object('anchorType', p_anchor_type, 'offsetX', p_offset_x, 'offsetY', p_offset_y, 'scale', p_scale, 'rotation', p_rotation));
end;
$$;

grant execute on function public.admin_save_avatar_rig_item(text, text, text, text, text, numeric, numeric, numeric, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- admin_reset_avatar_rig_item_to_factory() — deletes the calibration row(s)
-- for an item, so it falls back to the built-in JS default transform (see
-- avatar-viewer.js). This is the STRONG "factory reset", separate from
-- "reset to last saved" (which needs no server call at all — the editor
-- just discards its local unsaved edits and re-shows whatever it last
-- fetched from these tables). p_direction = null resets all 4 directions
-- for that item at once (the "Reset Item" scope in the editor); a specific
-- direction resets only that one.
-- ----------------------------------------------------------------------------
create or replace function public.admin_reset_avatar_rig_item_to_factory(
  p_body_type text, p_slot text, p_item_id text, p_direction text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;

  delete from public.avatar_rig_items
    where body_type = coalesce(p_body_type, 'male')
      and slot = p_slot
      and item_id = p_item_id
      and (p_direction is null or direction = p_direction);

  insert into public.avatar_rig_audit_log (admin_id, action, body_type, slot, item_id, direction)
  values (auth.uid(), 'reset_item_to_factory', p_body_type, p_slot, p_item_id, p_direction);
end;
$$;

grant execute on function public.admin_reset_avatar_rig_item_to_factory(text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- admin_save_avatar_rig_anchor() — RIG ANCHOR mode: changes the underlying
-- body anchor itself (affects every item using that anchor type), not a
-- single item. Deliberately a separate function from
-- admin_save_avatar_rig_item so the two can never be called by mistake
-- from the wrong editor mode.
-- ----------------------------------------------------------------------------
create or replace function public.admin_save_avatar_rig_anchor(
  p_body_type text, p_direction text, p_anchor_type text,
  p_center_x_pct numeric, p_y_pct numeric, p_width_pct numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized.';
  end if;

  insert into public.avatar_rig_anchors
    (body_type, direction, anchor_type, canvas_w, canvas_h, center_x_pct, y_pct, width_pct, updated_at, updated_by)
  select
    coalesce(p_body_type, 'male'), p_direction, p_anchor_type,
    canvas_w, canvas_h, p_center_x_pct, p_y_pct, p_width_pct, now(), auth.uid()
  from public.avatar_rig_anchors
  where body_type = coalesce(p_body_type, 'male') and direction = p_direction and anchor_type = p_anchor_type
  on conflict (body_type, direction, anchor_type) do update set
    center_x_pct = excluded.center_x_pct,
    y_pct = excluded.y_pct,
    width_pct = excluded.width_pct,
    updated_at = now(),
    updated_by = auth.uid();

  if not found then
    raise exception 'Unknown anchor row — canvas_w/canvas_h must already exist for this body/direction/anchor.';
  end if;

  insert into public.avatar_rig_audit_log (admin_id, action, body_type, direction, detail)
  values (auth.uid(), 'save_anchor', p_body_type, p_direction,
    jsonb_build_object('anchorType', p_anchor_type, 'centerXPct', p_center_x_pct, 'yPct', p_y_pct, 'widthPct', p_width_pct));
end;
$$;

grant execute on function public.admin_save_avatar_rig_anchor(text, text, text, numeric, numeric, numeric) to authenticated;

-- ----------------------------------------------------------------------------
-- Seed data — the male body's 4 anchors × 4 directions, taken verbatim from
-- assets/js/avatar-rig.js's HEAD_ANCHORS (measured off the bald base's own
-- alpha channel earlier this project, not invented here), plus the Admin
-- Crown's current, already-fixed, already-visually-verified calibration —
-- so turning on the new live-rendering path changes nothing visually until
-- an admin actually adjusts something in the new editor.
-- ----------------------------------------------------------------------------
insert into public.avatar_rig_anchors (body_type, direction, anchor_type, canvas_w, canvas_h, center_x_pct, y_pct, width_pct) values
  ('male','front','above_head', 636,1514, 50.31, 0.66,  25.47),
  ('male','front','skull',      636,1514, 50.31, 6.66,  25.47),
  ('male','front','forehead',   636,1514, 50.31, 9.58,  32.23),
  ('male','front','neck',       636,1514, 50.31, 14.86, 17.61),
  ('male','back', 'above_head', 584,1514, 49.49, 0.66,  28.42),
  ('male','back', 'skull',      584,1514, 49.49, 6.66,  28.42),
  ('male','back', 'forehead',   584,1514, 49.49, 9.71,  34.25),
  ('male','back', 'neck',       584,1514, 49.49, 14.86, 18.49),
  ('male','right','above_head', 302,1515, 54.64, 0.66,  66.89),
  ('male','right','skull',      302,1515, 54.64, 7.26,  66.89),
  ('male','right','forehead',   302,1515, 54.64, 9.90,  66.89),
  ('male','right','neck',       302,1515, 54.64, 15.84, 53.64),
  ('male','left', 'above_head', 302,1515, 45.03, 0.66,  66.89),
  ('male','left', 'skull',      302,1515, 45.03, 7.26,  66.89),
  ('male','left', 'forehead',   302,1515, 45.03, 9.90,  66.89),
  ('male','left', 'neck',       302,1515, 45.03, 15.84, 53.64)
on conflict (body_type, direction, anchor_type) do nothing;

insert into public.avatar_rig_items (body_type, slot, item_id, direction, anchor_type, offset_x, offset_y, scale, rotation) values
  ('male','head','admin-crown','front', 'skull', 0,    11.2, 0.833, 0),
  ('male','head','admin-crown','back',  'skull', 0,    13.2, 0.831, 0),
  ('male','head','admin-crown','right', 'skull', 0,   -2.0,  0.619, 0),
  ('male','head','admin-crown','left',  'skull', 0,   -2.0,  0.619, 0)
on conflict (body_type, slot, item_id, direction) do nothing;
