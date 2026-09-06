-- ============================================================================
-- Public player profile: stop exposing Quest Points.
-- ============================================================================
-- get_public_player_profile() (see 20260906060000_players_search_and_
-- public_profiles.sql) used to return quest_points so profile/index.html's
-- public-view branch could show it as a public stat. Quest Points and
-- Stardust are both account currencies, and neither should be visible to
-- another player through Players search / a public profile link — only
-- the account owner, on their own private profile, sees either balance
-- (see 20260907010000_stardust_currency.sql, which never added stardust
-- here in the first place).
--
-- Everything else about the function is untouched — equipped_profile_
-- picture_id (added by 20260906090000_profile_pictures.sql) stays, this
-- only removes quest_points.
--
-- Return type changes -> drop and recreate, same as every other RPC
-- signature change in this schema.
-- ============================================================================

drop function if exists public.get_public_player_profile(text);

create or replace function public.get_public_player_profile(p_username text)
returns table (
  user_id uuid,
  username text,
  is_banned boolean,
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
    return; -- empty result set = "not found" to the caller
  end if;

  return query
  select
    p.id,
    p.username,
    (p.banned_until is not null and p.banned_until > now()) as is_banned,
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
