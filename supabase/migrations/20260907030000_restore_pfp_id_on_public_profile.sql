-- ============================================================================
-- Fix-forward: 20260907020000_hide_currencies_from_public_profile.sql's
-- first push accidentally dropped equipped_profile_picture_id from
-- get_public_player_profile() along with quest_points — only quest_points
-- was meant to go. That file has since been corrected to match what's
-- below (so a fresh install gets it right first try); this migration
-- exists purely to bring an already-migrated remote database back in
-- sync with it, since `supabase db push` tracks migrations by filename,
-- not by re-diffing content of one already marked applied.
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
