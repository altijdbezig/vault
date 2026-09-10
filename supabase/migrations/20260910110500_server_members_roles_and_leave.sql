-- Rollen beheren, leden verwijderen, en zelf vertrekken.

-- ---------------------------------------------------------------------------
-- Rol wijzigen: alleen de eigenaar
-- ---------------------------------------------------------------------------

-- Admin aanwijzen of terugzetten naar member. Een admin kan dit niet: dan kan
-- een admin zichzelf tot owner promoveren en is het verschil tussen de twee
-- rollen weg.
drop policy if exists "eigenaar wijzigt rollen" on public.server_members;
create policy "eigenaar wijzigt rollen"
  on public.server_members for update
  to authenticated
  using (public.is_server_owner(server_id))
  with check (public.is_server_owner(server_id));

-- ---------------------------------------------------------------------------
-- Vertrekken en verwijderd worden
-- ---------------------------------------------------------------------------

-- Twee gevallen: je eigen rij (vertrekken) of de eigenaar die iemand
-- verwijdert. Extra permissive policy; een bestaande policy die alleen
-- "user_id = auth.uid()" toestaat blijft staan en wordt met OR gecombineerd.
drop policy if exists "vertrekken of verwijderd worden" on public.server_members;
create policy "vertrekken of verwijderd worden"
  on public.server_members for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_server_owner(server_id)
  );

-- ---------------------------------------------------------------------------
-- De laatste eigenaar kan niet weg
-- ---------------------------------------------------------------------------

-- Dit is het verschil tussen "de eigenaar moet eerst overdragen" als
-- UI-tekst en als regel. Een server zonder eigenaar is niet te repareren
-- vanuit de app: niemand kan dan nog kanalen beheren, leden verwijderen of de
-- server opruimen. Een trigger, geen policy, want een policy kan niet naar de
-- rest van de tabel kijken zonder recursie.
--
-- Let op wat hier NIET gebeurt: de trigger blokkeert het verwijderen van de
-- server zelf niet. Die gaat via cascade op servers en dat mag — de eigenaar
-- gooit dan bewust alles weg.
create or replace function public.guard_last_server_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_was_owner boolean;
  v_remaining integer;
begin
  v_was_owner := old.role = 'owner';

  -- Bij een update is het alleen een probleem als de rol van owner af gaat.
  if tg_op = 'UPDATE' and (not v_was_owner or new.role = 'owner') then
    return new;
  end if;

  if not v_was_owner then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  select count(*) into v_remaining
  from public.server_members sm
  where sm.server_id = old.server_id
    and sm.role = 'owner'
    and sm.user_id <> old.user_id;

  if v_remaining = 0 then
    raise exception 'Deze server zou zonder eigenaar achterblijven. Draag het eigendom eerst over of verwijder de server.'
      using errcode = 'P0001';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end;
$$;

drop trigger if exists server_members_guard_last_owner on public.server_members;
create trigger server_members_guard_last_owner
  before update or delete on public.server_members
  for each row
  execute function public.guard_last_server_owner();

-- ---------------------------------------------------------------------------
-- Uit de kanalen van een server gehaald worden
-- ---------------------------------------------------------------------------

-- Vertrekken uit een server moet ook de channel_members-rijen van die server
-- opruimen, anders blijf je berichten ontvangen uit kanalen van een server
-- waar je niet meer in zit.
--
-- Je eigen rijen kon je al verwijderen. Wat er ontbrak is de eigenaar die
-- iemand verwijdert: die moet ook diens kanaallidmaatschappen weghalen, en de
-- bestaande policy staat alleen de eigen rij toe. Dit is dus een extra
-- permissive policy naast de bestaande.
--
-- Alleen voor serverkanalen. Een groep is geen server en heeft geen eigenaar
-- die er iemand uit kan zetten.
drop policy if exists "eigenaar verwijdert kanaallidmaatschap" on public.channel_members;
create policy "eigenaar verwijdert kanaallidmaatschap"
  on public.channel_members for delete
  to authenticated
  using (
    exists (
      select 1
      from public.channels c
      where c.id = channel_members.channel_id
        and c.server_id is not null
        and public.is_server_owner(c.server_id)
    )
  );
