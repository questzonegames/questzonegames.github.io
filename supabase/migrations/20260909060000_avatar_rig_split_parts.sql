-- ============================================================================
-- Avatar Rig — LEFT_FOOT/RIGHT_FOOT/LEFT_HAND/RIGHT_HAND anchors, and a
-- `part` column on avatar_rig_items so ONE item (one item_id, one
-- equipped_items row, one equip/unequip action) can carry TWO
-- independently positioned pieces of art — a left boot and a right boot,
-- or a left glove and a right glove — each calibrated separately in the
-- Avatar Rig editor, per direction, exactly like the Admin Crown's single
-- piece already is.
--
-- Nothing here changes how any EXISTING item renders — Admin Crown (and
-- any future single-piece item) keeps using part='single', unaffected.
-- No boots/gloves item ships split art yet (none has been supplied) —
-- this is the capability, ready for when real left/right boot or glove
-- art exists; see ITEM_ECONOMY_ARCHITECTURE.md's sibling doc,
-- docs/avatar-equipment.md, for how to actually add one.
-- ============================================================================

-- ---- 1. new anchor types ----
alter table public.avatar_rig_anchors drop constraint if exists avatar_rig_anchors_anchor_type_check;
alter table public.avatar_rig_anchors add constraint avatar_rig_anchors_anchor_type_check
  check (anchor_type in ('above_head','skull','forehead','neck','left_foot','right_foot','left_hand','right_hand'));

alter table public.avatar_rig_items drop constraint if exists avatar_rig_items_anchor_type_check;
alter table public.avatar_rig_items add constraint avatar_rig_items_anchor_type_check
  check (anchor_type in ('above_head','skull','forehead','neck','left_foot','right_foot','left_hand','right_hand'));

-- ---- 2. `part` — which piece of a (possibly multi-piece) item this row
-- calibrates. 'single' (default) is every existing row and every item
-- that only ever has one piece of art — completely unaffected. 'left'/
-- 'right' let a boots/gloves item have two independently-positioned rows
-- per direction instead of one.
alter table public.avatar_rig_items add column if not exists part text not null default 'single'
  check (part in ('single','left','right'));
alter table public.avatar_rig_items drop constraint if exists avatar_rig_items_pkey;
alter table public.avatar_rig_items add primary key (body_type, slot, item_id, direction, part);

-- ---- 3. seed the 4 new anchors × 4 directions, measured directly off
-- the bald base's own alpha channel (assets/img/avatar/avatar-<dir>.png),
-- the same row-by-row opaque-pixel-cluster method the head anchors used
-- — not eyeballed, not guessed. LEFT/RIGHT here are SCREEN position
-- within that direction's own image (whichever foot/fist cluster has
-- the smaller on-canvas X is "left"), not anatomical — this sidesteps
-- front/back mirroring confusion entirely, and is what an admin
-- dragging two markers on one image actually sees and expects: "left"
-- is always the one on the left of the picture they're looking at.
--
-- front (636x1514): two feet cleanly separate from y~1470-1490 (ground
-- contact at y=1504, before toe-splay breaks the clean single-cluster
-- read); two fists cleanly separate from y~760 down to y~886 (where the
-- fist silhouette ends into nothing, both hands hang free of the torso
-- the whole way at this pose). back (584x1514): feet separate to
-- y=1493 (ground); fists readable from ~800 to ~858 (they merge into
-- the leg/torso silhouette below that, sooner than front's pose gives).
--
-- right/left (302x1515, profile): the near and far foot silhouettes
-- OVERLAP into one merged shape at every row near the ground (no clean
-- alpha gap exists to split them, unlike front/back) — same for the
-- fist against the hip in profile. left_foot and right_foot (and
-- left_hand/right_hand) therefore share the SAME measured anchor in
-- these two directions; an admin still separates the two pieces
-- visually via each row's own offset_x/offset_y, same as any other
-- per-item calibration.
insert into public.avatar_rig_anchors (body_type, direction, anchor_type, canvas_w, canvas_h, center_x_pct, y_pct, width_pct) values
  ('male','front','left_foot',   636,1514, 19.97, 99.34, 16.35),
  ('male','front','right_foot',  636,1514, 81.05, 99.34, 16.19),
  ('male','front','left_hand',   636,1514, 10.53, 58.52, 14.15),
  ('male','front','right_hand',  636,1514, 89.15, 58.52, 14.47),
  ('male','back', 'left_foot',   584,1514, 20.55, 98.61, 20.89),
  ('male','back', 'right_foot',  584,1514, 78.77, 98.61, 20.89),
  ('male','back', 'left_hand',   584,1514, 11.22, 56.67, 15.58),
  ('male','back', 'right_hand',  584,1514, 88.70, 56.67, 15.41),
  ('male','right','left_foot',   302,1515, 48.20, 98.94, 73.20),
  ('male','right','right_foot',  302,1515, 48.20, 98.94, 73.20),
  ('male','right','left_hand',   302,1515, 48.50, 54.13, 61.90),
  ('male','right','right_hand',  302,1515, 48.50, 54.13, 61.90),
  ('male','left', 'left_foot',   302,1515, 51.65, 98.94, 73.50),
  ('male','left', 'right_foot',  302,1515, 51.65, 98.94, 73.50),
  ('male','left', 'left_hand',   302,1515, 51.16, 54.13, 61.90),
  ('male','left', 'right_hand',  302,1515, 51.16, 54.13, 61.90)
on conflict (body_type, direction, anchor_type) do nothing;

-- ---- 4. RPC updates — add p_part, defaulting to 'single' so every
-- existing call site (Admin Crown) is completely unaffected. Old
-- signatures are dropped first — adding a trailing parameter makes
-- Postgres treat CREATE OR REPLACE as a distinct overload rather than a
-- true replacement, which would leave both the old part-unaware version
-- and the new one callable side by side.
drop function if exists public.admin_save_avatar_rig_item(text, text, text, text, text, numeric, numeric, numeric, numeric);
drop function if exists public.admin_reset_avatar_rig_item_to_factory(text, text, text, text);

create or replace function public.admin_save_avatar_rig_item(
  p_body_type text, p_slot text, p_item_id text, p_direction text,
  p_anchor_type text, p_offset_x numeric, p_offset_y numeric,
  p_scale numeric, p_rotation numeric, p_part text default 'single'
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
    (body_type, slot, item_id, direction, part, anchor_type, offset_x, offset_y, scale, rotation, updated_at, updated_by)
  values
    (coalesce(p_body_type, 'male'), p_slot, p_item_id, p_direction, coalesce(p_part, 'single'), p_anchor_type, p_offset_x, p_offset_y, p_scale, p_rotation, now(), auth.uid())
  on conflict (body_type, slot, item_id, direction, part) do update set
    anchor_type = excluded.anchor_type,
    offset_x = excluded.offset_x,
    offset_y = excluded.offset_y,
    scale = excluded.scale,
    rotation = excluded.rotation,
    updated_at = now(),
    updated_by = auth.uid();

  insert into public.avatar_rig_audit_log (admin_id, action, body_type, slot, item_id, direction, detail)
  values (auth.uid(), 'save_item', p_body_type, p_slot, p_item_id, p_direction,
    jsonb_build_object('part', coalesce(p_part,'single'), 'anchorType', p_anchor_type, 'offsetX', p_offset_x, 'offsetY', p_offset_y, 'scale', p_scale, 'rotation', p_rotation));
end;
$$;
grant execute on function public.admin_save_avatar_rig_item(text, text, text, text, text, numeric, numeric, numeric, numeric, text) to authenticated;

create or replace function public.admin_reset_avatar_rig_item_to_factory(
  p_body_type text, p_slot text, p_item_id text, p_direction text default null, p_part text default null
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
      and (p_direction is null or direction = p_direction)
      and (p_part is null or part = p_part);

  insert into public.avatar_rig_audit_log (admin_id, action, body_type, slot, item_id, direction, detail)
  values (auth.uid(), 'reset_item_to_factory', p_body_type, p_slot, p_item_id, p_direction, jsonb_build_object('part', p_part));
end;
$$;
grant execute on function public.admin_reset_avatar_rig_item_to_factory(text, text, text, text, text) to authenticated;
