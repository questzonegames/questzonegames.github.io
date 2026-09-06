-- ============================================================================
-- Profile Pictures — replaces the live-avatar-render approach in every
-- small circular badge across the site (Players search, and any future
-- highscores/game-lobby row) with a plain, chosen 2D picture.
--
-- Why: mounting a live avatar-viewer instance into a tiny circle (scaled
-- up via CSS) threw off items positioned in real pixels against that
-- tiny container's own size — a crown that sat correctly on the full
-- profile page came out visibly offset in the small circle. A picked
-- static picture can never have that problem: it's just an image.
--
-- Same catalog-table shape as public.games/public.achievements: a public,
-- read-only reference table of every picture that exists, plus a per-
-- account ownership table for the ones that have to be unlocked/bought.
-- Free pictures need no ownership row at all — "free" IS the unlock.
-- ============================================================================

create table if not exists public.profile_pictures (
  id text primary key,
  name text not null,
  image_path text not null,
  unlock_type text not null check (unlock_type in ('free', 'purchase_points', 'achievement')),
  cost_quest_points int check (cost_quest_points is null or cost_quest_points > 0),
  requirement_achievement_id text references public.achievements(achievement_id) on delete set null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint profile_pictures_cost_matches_type check (
    (unlock_type = 'purchase_points' and cost_quest_points is not null)
    or (unlock_type != 'purchase_points' and cost_quest_points is null)
  ),
  constraint profile_pictures_requirement_matches_type check (
    (unlock_type = 'achievement' and requirement_achievement_id is not null)
    or (unlock_type != 'achievement' and requirement_achievement_id is null)
  )
);
alter table public.profile_pictures enable row level security;

-- Public reference data, exactly like games/achievements — every visitor's
-- browser needs the full catalog (image paths, prices) to render the
-- gallery and to show what's already-equipped on ANY player's public
-- profile, not just their own.
drop policy if exists "profile_pictures_select_all" on public.profile_pictures;
create policy "profile_pictures_select_all"
  on public.profile_pictures for select
  using (true);
-- No insert/update/delete policy — the catalog only grows via a migration
-- (new pictures are added as real image files land in the repo), same as
-- public.games/public.achievements.

-- ----------------------------------------------------------------------------
-- owned_profile_pictures — per-account unlock record for anything that
-- ISN'T free. Own-or-admin select only (matches every other per-account
-- ownership table in this schema); no client-writable policy at all — the
-- RPCs below are the only way a row appears here.
-- ----------------------------------------------------------------------------
create table if not exists public.owned_profile_pictures (
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_picture_id text not null references public.profile_pictures(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, profile_picture_id)
);
alter table public.owned_profile_pictures enable row level security;

drop policy if exists "owned_profile_pictures_select_own_or_admin" on public.owned_profile_pictures;
create policy "owned_profile_pictures_select_own_or_admin"
  on public.owned_profile_pictures for select
  using (auth.uid() = user_id or public.is_admin());

alter table public.profiles add column if not exists equipped_profile_picture_id text references public.profile_pictures(id) on delete set null;

-- ----------------------------------------------------------------------------
-- equip_profile_picture() — the ONLY way equipped_profile_picture_id
-- changes. p_picture_id = null clears it back to the default silhouette.
-- Re-checks ownership server-side (never trusts the client's own "you can
-- pick this" UI state) — free pictures need no ownership row; anything
-- else must have a matching owned_profile_pictures row already.
-- ----------------------------------------------------------------------------
create or replace function public.equip_profile_picture(p_picture_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_unlock_type text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_picture_id is null then
    update public.profiles set equipped_profile_picture_id = null where id = v_uid;
    return;
  end if;

  select unlock_type into v_unlock_type
  from public.profile_pictures
  where id = p_picture_id and is_active;

  if v_unlock_type is null then
    raise exception 'Unknown or inactive profile picture.';
  end if;

  if v_unlock_type != 'free' then
    if not exists (
      select 1 from public.owned_profile_pictures
      where user_id = v_uid and profile_picture_id = p_picture_id
    ) then
      raise exception 'You have not unlocked this profile picture yet.';
    end if;
  end if;

  update public.profiles set equipped_profile_picture_id = p_picture_id where id = v_uid;
end;
$$;

grant execute on function public.equip_profile_picture(text) to authenticated;

-- ----------------------------------------------------------------------------
-- purchase_profile_picture() — spends quest_points, grants ownership.
-- Does NOT auto-equip (equip_profile_picture is a separate, deliberate
-- step) — a player might buy several before picking one. Atomic: the
-- points deduction and the ownership grant happen in the same statement
-- set, so a failure partway through can't charge points without granting
-- the picture (or the reverse).
-- ----------------------------------------------------------------------------
create or replace function public.purchase_profile_picture(p_picture_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_unlock_type text;
  v_cost int;
  v_points int;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select unlock_type, cost_quest_points into v_unlock_type, v_cost
  from public.profile_pictures
  where id = p_picture_id and is_active;

  if v_unlock_type is null then
    raise exception 'Unknown or inactive profile picture.';
  end if;
  if v_unlock_type != 'purchase_points' then
    raise exception 'This profile picture is not purchasable with Quest Points.';
  end if;

  if exists (
    select 1 from public.owned_profile_pictures
    where user_id = v_uid and profile_picture_id = p_picture_id
  ) then
    raise exception 'You already own this profile picture.';
  end if;

  select quest_points into v_points from public.profiles where id = v_uid for update;
  if v_points is null or v_points < v_cost then
    raise exception 'Not enough Quest Points.';
  end if;

  update public.profiles set quest_points = quest_points - v_cost where id = v_uid;
  insert into public.owned_profile_pictures (user_id, profile_picture_id) values (v_uid, p_picture_id);
end;
$$;

grant execute on function public.purchase_profile_picture(text) to authenticated;

-- ----------------------------------------------------------------------------
-- get_owned_profile_pictures() — the gallery needs to know which non-free
-- pictures the CALLER already owns (own row only — owned_profile_pictures'
-- RLS already allows this, this RPC just returns a plain id list instead
-- of the client needing a second round-trip query shape).
-- ----------------------------------------------------------------------------
create or replace function public.get_owned_profile_pictures()
returns table (profile_picture_id text)
language sql
security definer
stable
set search_path = public
as $$
  select profile_picture_id from public.owned_profile_pictures where user_id = auth.uid();
$$;

grant execute on function public.get_owned_profile_pictures() to authenticated;

-- ----------------------------------------------------------------------------
-- Extend the two Players RPCs to also return equipped_profile_picture_id,
-- so a search result / public profile can show it instead of falling back
-- to the default silhouette. Return type changes -> drop and recreate,
-- same as every other RPC signature change in this schema.
-- ----------------------------------------------------------------------------
drop function if exists public.search_public_players(text, int, int);

create or replace function public.search_public_players(p_query text, p_limit int default 20, p_offset int default 0)
returns table (
  user_id uuid,
  username text,
  is_banned boolean,
  avatar_gender text,
  avatar_skin_colour text,
  avatar_hair_style text,
  avatar_hair_colour text,
  equipped_items jsonb,
  equipped_profile_picture_id text,
  total_count bigint
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_q text := lower(trim(coalesce(p_query, '')));
begin
  if v_q = '' then
    return;
  end if;

  return query
  with matches as (
    select
      p.id as uid,
      p.username as uname,
      (p.banned_until is not null and p.banned_until > now()) as banned,
      ac.gender as gender,
      ac.skin_colour as skin_colour,
      ac.hair_style as hair_style,
      ac.hair_colour as hair_colour,
      coalesce(
        (select jsonb_agg(jsonb_build_object('slot', e.slot, 'item_id', e.item_id))
         from public.equipped_items e
         where e.user_id = p.id),
        '[]'::jsonb
      ) as items,
      p.equipped_profile_picture_id as pfp,
      (position(v_q in lower(p.username)) = 1) as is_prefix
    from public.profiles p
    left join public.avatar_customization ac on ac.user_id = p.id
    where not p.banned_permanently
      and not p.is_hidden
      and (not p.is_test_account or public.is_admin())
      and position(v_q in lower(p.username)) > 0
  )
  select uid, uname, banned, gender, skin_colour, hair_style, hair_colour, items, pfp,
    count(*) over () as total_count
  from matches
  order by is_prefix desc, uname asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

grant execute on function public.search_public_players(text, int, int) to anon, authenticated;

drop function if exists public.get_public_player_profile(text);

create or replace function public.get_public_player_profile(p_username text)
returns table (
  user_id uuid,
  username text,
  is_banned boolean,
  quest_points integer,
  avatar_gender text,
  avatar_skin_colour text,
  avatar_hair_style text,
  avatar_hair_colour text,
  equipped_items jsonb,
  equipped_profile_picture_id text
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select p.id into v_user_id
  from public.profiles p
  where lower(p.username) = lower(trim(coalesce(p_username, '')))
    and not p.banned_permanently
    and not p.is_hidden
    and (not p.is_test_account or public.is_admin());

  if v_user_id is null then
    return;
  end if;

  return query
  select
    p.id,
    p.username,
    (p.banned_until is not null and p.banned_until > now()) as is_banned,
    p.quest_points,
    ac.gender,
    ac.skin_colour,
    ac.hair_style,
    ac.hair_colour,
    coalesce(
      (select jsonb_agg(jsonb_build_object('slot', e.slot, 'item_id', e.item_id))
       from public.equipped_items e
       where e.user_id = p.id),
      '[]'::jsonb
    ) as equipped_items,
    p.equipped_profile_picture_id
  from public.profiles p
  left join public.avatar_customization ac on ac.user_id = p.id
  where p.id = v_user_id;
end;
$$;

grant execute on function public.get_public_player_profile(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Seed data — a handful of free starter pictures (assets/img/profile-
-- pictures/*.svg, simple placeholder badges) so the whole equip/gallery
-- flow is real and testable immediately, plus one purchasable example to
-- prove the Quest Points economy path works end to end. Swap/add real art
-- later purely by inserting more rows here — nothing else needs to change.
-- ----------------------------------------------------------------------------
insert into public.profile_pictures (id, name, image_path, unlock_type, cost_quest_points, sort_order) values
  ('default',      'Default',      'assets/img/profile-pictures/default.svg',      'free', null, 0),
  ('star-badge',    'Star',         'assets/img/profile-pictures/star-badge.svg',    'free', null, 1),
  ('rocket-badge',  'Rocket',       'assets/img/profile-pictures/rocket-badge.svg',  'free', null, 2),
  ('shield-badge',  'Shield',       'assets/img/profile-pictures/shield-badge.svg',  'free', null, 3),
  ('crown-badge',   'Golden Crown', 'assets/img/profile-pictures/crown-badge.svg',   'purchase_points', 500, 4)
on conflict (id) do nothing;
