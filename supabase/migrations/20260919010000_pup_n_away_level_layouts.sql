-- ============================================================================
-- Pup N Away — admin Level Editor layout storage (draft/published/archived)
-- ============================================================================
-- Stores versioned object placement (dog spawn, basket spawn, dream bones)
-- for each level, separate from the read-only tuning fields (background,
-- gravity, bounceSpeed) that stay hardcoded in the LEVELS manifest in
-- pup-n-away-config.js. A level with no 'published' row here plays exactly
-- as before, from that static manifest — this table only ever OVERRIDES
-- object positions, it never replaces the level system.
--
-- Same secure pattern as every other admin-write Pup N Away/site table:
-- every write goes through a SECURITY DEFINER RPC that re-checks
-- public.is_admin() itself (never trusts a client-supplied role), and RLS
-- has no client insert/update/delete policy at all — only SELECT, and only
-- 'published' rows are visible to non-admins (a draft/archived row is
-- admin-eyes-only). p_level_id is checked against the same real-level
-- allowlist as record_pup_n_away_level_complete() in
-- 20260918010000_pup_n_away_level_progress.sql, kept in sync with LEVELS.
-- ============================================================================
create table if not exists public.pup_n_away_level_layouts (
  id bigint generated always as identity primary key,
  level_id text not null,
  version int not null,
  status text not null check (status in ('draft', 'published', 'archived')),
  objects jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  constraint pna_level_layouts_objects_is_array check (jsonb_typeof(objects) = 'array'),
  unique (level_id, version)
);

-- Only one active draft and one active published row per level — publish
-- archives the previous published row rather than deleting it, so version
-- history (and rollback) is preserved.
create unique index if not exists pna_level_layouts_one_draft_per_level
  on public.pup_n_away_level_layouts (level_id) where (status = 'draft');
create unique index if not exists pna_level_layouts_one_published_per_level
  on public.pup_n_away_level_layouts (level_id) where (status = 'published');

alter table public.pup_n_away_level_layouts enable row level security;
drop policy if exists "pna_level_layouts_select_published_or_admin" on public.pup_n_away_level_layouts;
create policy "pna_level_layouts_select_published_or_admin"
  on public.pup_n_away_level_layouts for select
  using (status = 'published' or public.is_admin());
-- no insert/update/delete policy — the RPCs below are the only path in.

-- Convenience read for normal gameplay: the single current published
-- layout per level, if one exists. Readable by the same rule as the base
-- table (RLS on the underlying table still applies through the view).
create or replace view public.pup_n_away_published_level_layouts as
  select level_id, version, objects, published_at
  from public.pup_n_away_level_layouts
  where status = 'published';
grant select on public.pup_n_away_published_level_layouts to authenticated, anon;

create or replace function public.pna_level_layouts_check_level_id(p_level_id text)
returns void
language plpgsql
as $$
begin
  if p_level_id is null or p_level_id not in ('dream-bedroom', 'back-garden', 'house-rooftop') then
    raise exception 'Unknown level.';
  end if;
end;
$$;

-- Structural + gameplay-invariant validation shared by publish and
-- restore. Deliberately conservative: exactly one dog_spawn, exactly one
-- basket_spawn, at least one dream_bone, unique instanceIds, no NaN/
-- Infinity/negative coordinates. This is a safety net, not full schema
-- validation — the editor UI is expected to keep data well-formed; this
-- exists so a publish can never leave normal players with an unplayable
-- level even if the client sent something malformed.
create or replace function public.pna_level_layouts_validate_objects(p_objects jsonb)
returns void
language plpgsql
as $$
declare
  v_count_dog int;
  v_count_basket int;
  v_count_bone int;
  v_count_total int;
  v_count_distinct_ids int;
  v_bad_coords int;
begin
  if p_objects is null or jsonb_typeof(p_objects) <> 'array' then
    raise exception 'Level layout must be a JSON array of objects.';
  end if;

  select count(*) into v_count_total from jsonb_array_elements(p_objects);
  select count(*) into v_count_dog from jsonb_array_elements(p_objects) o where o->>'assetType' = 'dog_spawn';
  select count(*) into v_count_basket from jsonb_array_elements(p_objects) o where o->>'assetType' = 'basket_spawn';
  select count(*) into v_count_bone from jsonb_array_elements(p_objects) o where o->>'assetType' = 'dream_bone';
  select count(distinct o->>'instanceId') into v_count_distinct_ids from jsonb_array_elements(p_objects) o;

  if v_count_dog <> 1 then raise exception 'Level must have exactly one dog spawn (has %).', v_count_dog; end if;
  if v_count_basket <> 1 then raise exception 'Level must have exactly one basket spawn (has %).', v_count_basket; end if;
  if v_count_bone < 1 then raise exception 'Level must have at least one Dream Bone.'; end if;
  if v_count_distinct_ids <> v_count_total then raise exception 'Every object must have a unique instanceId.'; end if;

  select count(*) into v_bad_coords
    from jsonb_array_elements(p_objects) o
    where o->>'instanceId' is null
       or o->>'assetType' is null
       or (o->>'x') is null or (o->>'x')::text !~ '^-?[0-9]+(\.[0-9]+)?$'
       or (o->>'y') is null or (o->>'y')::text !~ '^-?[0-9]+(\.[0-9]+)?$';
  if v_bad_coords > 0 then
    raise exception 'One or more objects have missing or invalid coordinates.';
  end if;
end;
$$;

create or replace function public.admin_get_pup_n_away_level_editor_data(p_level_id text)
returns table (version int, status text, objects jsonb, created_at timestamptz, published_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  perform public.pna_level_layouts_check_level_id(p_level_id);
  return query
    select l.version, l.status, l.objects, l.created_at, l.published_at
    from public.pup_n_away_level_layouts l
    where l.level_id = p_level_id and l.status in ('draft', 'published')
    order by (l.status = 'draft') desc;
end;
$$;
grant execute on function public.admin_get_pup_n_away_level_editor_data(text) to authenticated;
revoke execute on function public.admin_get_pup_n_away_level_editor_data(text) from public, anon;

create or replace function public.admin_list_pup_n_away_level_versions(p_level_id text)
returns table (version int, status text, created_at timestamptz, published_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  perform public.pna_level_layouts_check_level_id(p_level_id);
  return query
    select l.version, l.status, l.created_at, l.published_at
    from public.pup_n_away_level_layouts l
    where l.level_id = p_level_id and l.status <> 'draft'
    order by l.version desc;
end;
$$;
grant execute on function public.admin_list_pup_n_away_level_versions(text) to authenticated;
revoke execute on function public.admin_list_pup_n_away_level_versions(text) from public, anon;

create or replace function public.admin_save_pup_n_away_level_draft(p_level_id text, p_objects jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  perform public.pna_level_layouts_check_level_id(p_level_id);
  if p_objects is null or jsonb_typeof(p_objects) <> 'array' then
    raise exception 'Level layout must be a JSON array of objects.';
  end if;

  insert into public.pup_n_away_level_layouts (level_id, version, status, objects, created_by)
    values (p_level_id, 0, 'draft', p_objects, v_uid)
  on conflict (level_id) where (status = 'draft')
    do update set objects = excluded.objects, created_by = v_uid, created_at = now();
end;
$$;
grant execute on function public.admin_save_pup_n_away_level_draft(text, jsonb) to authenticated;
revoke execute on function public.admin_save_pup_n_away_level_draft(text, jsonb) from public, anon;

create or replace function public.admin_publish_pup_n_away_level(p_level_id text, p_objects jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_next_version int;
begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  perform public.pna_level_layouts_check_level_id(p_level_id);
  perform public.pna_level_layouts_validate_objects(p_objects);

  select coalesce(max(version), 0) + 1 into v_next_version
    from public.pup_n_away_level_layouts where level_id = p_level_id;

  update public.pup_n_away_level_layouts
    set status = 'archived'
    where level_id = p_level_id and status = 'published';

  insert into public.pup_n_away_level_layouts
      (level_id, version, status, objects, created_by, published_at)
    values (p_level_id, v_next_version, 'published', p_objects, v_uid, now());

  -- Keep the draft in sync with what was just published, so the editor
  -- shows "no unsaved changes" immediately after a publish.
  insert into public.pup_n_away_level_layouts (level_id, version, status, objects, created_by)
    values (p_level_id, 0, 'draft', p_objects, v_uid)
  on conflict (level_id) where (status = 'draft')
    do update set objects = excluded.objects, created_by = v_uid, created_at = now();

  return v_next_version;
end;
$$;
grant execute on function public.admin_publish_pup_n_away_level(text, jsonb) to authenticated;
revoke execute on function public.admin_publish_pup_n_away_level(text, jsonb) from public, anon;

-- Rollback: re-publishes an old (published or archived) version's objects
-- as a brand-new version, rather than mutating history in place, so the
-- full version list always reads chronologically and nothing is lost.
create or replace function public.admin_restore_pup_n_away_level_version(p_level_id text, p_version int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_objects jsonb;
begin
  if not public.is_admin() then raise exception 'Admin access required.'; end if;
  perform public.pna_level_layouts_check_level_id(p_level_id);

  select objects into v_objects
    from public.pup_n_away_level_layouts
    where level_id = p_level_id and version = p_version;
  if v_objects is null then raise exception 'That version does not exist.'; end if;

  return public.admin_publish_pup_n_away_level(p_level_id, v_objects);
end;
$$;
grant execute on function public.admin_restore_pup_n_away_level_version(text, int) to authenticated;
revoke execute on function public.admin_restore_pup_n_away_level_version(text, int) from public, anon;
