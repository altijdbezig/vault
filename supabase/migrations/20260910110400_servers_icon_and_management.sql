-- Serverinstellingen: naam, icoon, verwijderen.

-- icon_url BESTAAT AL in productie (nagekeken 10-09-2026). Deze regel doet
-- daar dus niets; hij blijft staan zodat een verse database dezelfde vorm
-- krijgt, en omdat "if not exists" hem gratis maakt.
--
-- Het icoon is een URL naar de publieke avatars-bucket, geen bytes in de
-- database. Zelfde afweging als bij een profielavatar: iedereen die de server
-- ziet moet hem kunnen laden, dus versleutelen kan niet en heeft ook geen
-- zin — een servericoon is geen gespreksinhoud.
alter table public.servers
  add column if not exists icon_url text;

-- ---------------------------------------------------------------------------
-- Naam en icoon wijzigen: owner of admin
-- ---------------------------------------------------------------------------

-- LET OP: dit VERVANGT de bestaande policy.
--
-- Productie heeft al "eigenaar bewerkt server". Zou deze ernaast komen, dan
-- combineert Postgres ze met OR en mag "eigenaar OF admin" zonder dat één van
-- beide regels dat zegt. Sectie 4.1 vraagt die uitbreiding (naam en icoon door
-- owner of admin), dus hij hoort erin — in één regel.
--
-- Wat behouden blijft: de eigenaar, via owner_id = auth.uid(). Dat is
-- vermoedelijk precies wat de bestaande policy controleert, en het staat er
-- expliciet bij zodat een eigenaar zonder server_members-rij er niet buiten
-- valt. Wat erbij komt: admins, via is_server_admin.
--
-- owner_id wordt hier NIET in de with check vastgezet, en dat is met opzet.
-- De voor de hand liggende versie,
--
--   with check (owner_id = (select owner_id from public.servers where ...))
--
-- is een subquery op public.servers binnen een policy op public.servers. Dat
-- is exact de oneindige recursie waar CLAUDE.md voor waarschuwt. Het slot op
-- owner_id staat daarom in de trigger hieronder, die buiten RLS om werkt.
drop policy if exists "eigenaar bewerkt server" on public.servers;
drop policy if exists "beheerders wijzigen de server" on public.servers;
create policy "eigenaar bewerkt server"
  on public.servers for update
  to authenticated
  using (owner_id = auth.uid() or public.is_server_admin(id))
  with check (owner_id = auth.uid() or public.is_server_admin(id));

-- Zonder dit kan een admin owner_id op zichzelf zetten en de server
-- overnemen. Eigendom overdragen mag wel, maar alleen door de zittende
-- eigenaar — dat is wat 4.5 nodig heeft om te kunnen vertrekken.
create or replace function public.guard_server_owner_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.owner_id is distinct from old.owner_id
     and not public.is_server_owner(old.id) then
    raise exception 'Alleen de eigenaar kan het eigendom van een server overdragen.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists servers_guard_owner_id on public.servers;
create trigger servers_guard_owner_id
  before update on public.servers
  for each row
  execute function public.guard_server_owner_id();

-- ---------------------------------------------------------------------------
-- Verwijderen: alleen de eigenaar
-- ---------------------------------------------------------------------------

-- Hier staat met opzet geen policy meer.
--
-- Productie heeft al "eigenaar verwijdert server", en dat is exact de grens
-- die deze migratie wilde: alleen de eigenaar. Een eigen versie ernaast zou
-- twee permissive delete-policies op dezelfde tabel geven met dezelfde
-- uitkomst — geen extra rechten, maar wel twee plekken om te lezen en een
-- tweede definitie van "eigenaar" (server_members.role naast
-- servers.owner_id) die uit elkaar kan lopen.
--
-- De regel die eronder ligt blijft: de client laat de naam overtypen voordat
-- hij deleteServer aanroept, maar dat is een rem in de UI en geen beveiliging.
-- De policy in productie is de echte grens.
--
-- Deze drop staat er wel, zodat een database waar mijn versie al op stond
-- weer op één policy uitkomt.
drop policy if exists "eigenaar verwijdert de server" on public.servers;
