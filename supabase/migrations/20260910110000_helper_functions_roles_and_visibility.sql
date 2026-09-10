-- Hulpfuncties voor de nieuwe policies.
--
-- Waarom SECURITY DEFINER: precies dezelfde reden als is_channel_member en
-- is_server_member. Een policy op tabel X die met een gewone subquery naar
-- tabel X kijkt geeft oneindige recursie, en een policy die naar een andere
-- tabel kijkt erft de RLS van die tabel — dan hangt het gedrag van de policy
-- af van de policy ernaast. SECURITY DEFINER maakt het antwoord expliciet.
--
-- Alle functies zijn STABLE (lezen alleen), hebben een vaste search_path
-- (anders kan een aanroeper met een eigen schema de functie omleiden) en
-- worden net als de bestaande helpers dichtgezet voor anon.

-- ---------------------------------------------------------------------------
-- Rollen in een server
-- ---------------------------------------------------------------------------

-- Owner of admin. Dit is de grens voor "kanaal aanmaken, hernoemen,
-- verwijderen" en voor "uitnodigingen beheren".
create or replace function public.is_server_admin(p_server_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.server_members sm
    where sm.server_id = p_server_id
      and sm.user_id = auth.uid()
      and sm.role in ('owner', 'admin')
  );
$$;

-- Alleen de eigenaar. Dit is de grens voor "server verwijderen", "admins
-- aanwijzen" en "leden verwijderen".
create or replace function public.is_server_owner(p_server_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.server_members sm
    where sm.server_id = p_server_id
      and sm.user_id = auth.uid()
      and sm.role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- Zichtbaarheid van een bericht
-- ---------------------------------------------------------------------------

-- Reacties hangen aan een message_id, niet aan een channel_id. Zonder deze
-- functie zou de policy op message_reactions een subquery op messages doen en
-- daarmee afhankelijk worden van de select-policy van messages. Nu staat er
-- precies één regel: je mag een reactie zien als je lid bent van het kanaal
-- waarin het bericht staat.
--
-- Let op: dit kijkt NIET naar deleted_at. Een verwijderd bericht houdt zijn
-- rij (soft delete) en de reacties eronder mogen mee verdwijnen in de UI,
-- maar de policy hoeft daar niet over te beslissen.
create or replace function public.is_message_visible(p_message_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.messages m
    where m.id = p_message_id
      and public.is_channel_member(m.channel_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- Grants, in dezelfde vorm als 20260908123707_lock_down_helper_functions.sql
-- ---------------------------------------------------------------------------

revoke execute on function public.is_server_admin(uuid) from public, anon;
revoke execute on function public.is_server_owner(uuid) from public, anon;
revoke execute on function public.is_message_visible(uuid) from public, anon;

grant execute on function public.is_server_admin(uuid) to authenticated;
grant execute on function public.is_server_owner(uuid) to authenticated;
grant execute on function public.is_message_visible(uuid) to authenticated;
