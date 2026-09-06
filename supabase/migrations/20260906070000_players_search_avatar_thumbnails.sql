-- ============================================================================
-- Players search — avatar thumbnails in results.
-- ============================================================================
-- search_public_players() originally returned just user_id/username/is_banned
-- — the client rendered a generic person-silhouette icon next to every
-- result instead of that account's real avatar. This adds the same avatar
-- showcase fields get_public_player_profile() already exposes (gender,
-- skin/hair, equipped items) so the Players results list can render each
-- account's actual front-facing avatar, the same way the profile page does.
--
-- Return type changes (new columns), so this must be dropped and recreated
-- rather than CREATE OR REPLACE'd, same as every other RPC signature change
-- in this schema (see 20260906050000_admin_hide_and_delete_accounts.sql).
--
-- Still READ-ONLY, still the same exclusion rules (permanently banned/
-- hidden/deleted never appear; test accounts stay admin-only) — this only
-- adds columns to an existing public, SECURITY DEFINER function.
-- ============================================================================

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
      (position(v_q in lower(p.username)) = 1) as is_prefix
    from public.profiles p
    left join public.avatar_customization ac on ac.user_id = p.id
    where not p.banned_permanently
      and not p.is_hidden
      and (not p.is_test_account or public.is_admin())
      and position(v_q in lower(p.username)) > 0
  )
  select uid, uname, banned, gender, skin_colour, hair_style, hair_colour, items,
    count(*) over () as total_count
  from matches
  order by is_prefix desc, uname asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

grant execute on function public.search_public_players(text, int, int) to anon, authenticated;
