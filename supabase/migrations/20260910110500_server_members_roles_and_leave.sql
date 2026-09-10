-- Rollen beheren, leden verwijderen, en zelf vertrekken.

-- ---------------------------------------------------------------------------
-- Rol wijzigen: alleen de eigenaar
-- ---------------------------------------------------------------------------

-- Admin aanwijzen of terugzetten naar member. Een admin kan dit niet: dan kan
-- een admin zichzelf tot owner promoveren en is het verschil tussen de twee
-- rollen weg.
--
-- Productie heeft (nagekeken 10-09-2026) GEEN update-policy op
-- server_members, dus deze is de enige en komt niet naast iets anders. Zonder
-- hem kan er geen admin aangewezen worden en kan eigendom niet overgedragen.
drop policy if exists "eigenaar wijzigt rollen" on public.server_members;
create policy "eigenaar wijzigt rollen"
  on public.server_members for update
  to authenticated
  using (public.is_server_owner(server_id))
  with check (public.is_server_owner(server_id));

-- ---------------------------------------------------------------------------
-- Vertrekken en verwijderd worden
-- ---------------------------------------------------------------------------

-- LET OP: dit VERVANGT de bestaande policy.
--
-- Productie heeft al "jezelf verwijderen uit server", die alleen je eigen rij
-- toestaat. Zou deze ernaast komen, dan combineert Postgres ze met OR en mag
-- "eigen rij OF eigenaar" zonder dat één van beide regels dat zegt. Sectie 4.3
-- vraagt die uitbreiding (de eigenaar kan leden verwijderen), dus hij hoort
-- erin — in één regel.
--
-- Wat behouden blijft: je eigen rij, dus vertrekken kan iedereen. Wat erbij
-- komt: de eigenaar mag ook de rij van een ander weghalen. De eigenaar wordt
-- langs twee wegen erkend, zodat hij er niet buiten valt als owner_id en
-- server_members.role uit elkaar zouden lopen.
drop policy if exists "jezelf verwijderen uit server" on public.server_members;
drop policy if exists "vertrekken of verwijderd worden" on public.server_members;
create policy "jezelf verwijderen uit server"
  on public.server_members for delete
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_server_owner(server_id)
    or exists (
      select 1
      from public.servers s
      where s.id = server_members.server_id
        and s.owner_id = auth.uid()
    )
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
-- LET OP: dit VERVANGT de bestaande policy.
--
-- Dit is de enige tabel waar mijn oorspronkelijke aanname klopte: productie
-- heeft "kanaal verlaten", die alleen je eigen rij toestaat, en de eigenaar
-- kon dus niemand uit de kanalen van zijn server halen. Die uitbreiding is
-- nodig voor 4.3 en 4.5 — maar ook hier in één regel in plaats van twee
-- permissive policies naast elkaar.
--
-- Wat behouden blijft: je eigen rij, dus een groep verlaten en een server
-- verlaten blijven werken. Wat erbij komt: de eigenaar van de server waar het
-- kanaal bij hoort.
--
-- Alleen voor serverkanalen. Een groep is geen server en heeft geen eigenaar
-- die er iemand uit kan zetten.
drop policy if exists "kanaal verlaten" on public.channel_members;
drop policy if exists "eigenaar verwijdert kanaallidmaatschap" on public.channel_members;
create policy "kanaal verlaten"
  on public.channel_members for delete
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.channels c
      where c.id = channel_members.channel_id
        and c.server_id is not null
        and (
          public.is_server_owner(c.server_id)
          or exists (
            select 1
            from public.servers s
            where s.id = c.server_id
              and s.owner_id = auth.uid()
          )
        )
    )
  );
