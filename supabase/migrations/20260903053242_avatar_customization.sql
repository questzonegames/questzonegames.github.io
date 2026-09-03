-- ============================================================================
-- Avatar customization — gender, hairstyle, beard, and colours for each,
-- persisted per account. Only "default"/"none" options exist as real
-- assets today (see assets/js/character-data.js) — this table exists so
-- a choice is saved and shown correctly the instant more options become
-- real, with no further schema change needed then, just new rows in the
-- client-side options list plus the matching image files.
-- ============================================================================

create table if not exists public.avatar_customization (
  user_id uuid primary key references auth.users(id) on delete cascade,
  gender text not null default 'male',
  hair_style text not null default 'default',
  hair_colour text not null default 'default',
  beard_style text not null default 'none',
  beard_colour text not null default 'default',
  skin_colour text not null default 'default',
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'avatar_customization_gender_check'
  ) then
    alter table public.avatar_customization
      add constraint avatar_customization_gender_check check (gender in ('male', 'female'));
  end if;
end $$;

alter table public.avatar_customization enable row level security;

-- Same visibility as equipped_items/inventory_items — own account or an
-- admin (e.g. viewing it through the Admin Zone). Not public-read: there's
-- no "view any player's profile" page for the general public yet, only
-- your own and admin-view.
drop policy if exists "avatar_custom_select_own_or_admin" on public.avatar_customization;
create policy "avatar_custom_select_own_or_admin"
  on public.avatar_customization for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "avatar_custom_insert_own" on public.avatar_customization;
create policy "avatar_custom_insert_own"
  on public.avatar_customization for insert
  with check (auth.uid() = user_id and not public.is_banned());

drop policy if exists "avatar_custom_update_own" on public.avatar_customization;
create policy "avatar_custom_update_own"
  on public.avatar_customization for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and not public.is_banned());

-- ----------------------------------------------------------------------------
-- Seed a default customization row the moment a fresh account is created,
-- same as profiles/game_progress — nothing to initialize manually.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, new.raw_user_meta_data->>'username');

  insert into public.game_progress (user_id, game_key, xp, level)
  select new.id, g.game_key, 0, 1
  from public.games g;

  insert into public.avatar_customization (user_id)
  values (new.id);

  return new;
exception
  when unique_violation then
    raise exception 'That username is already taken.';
end;
$$;
