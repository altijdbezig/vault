-- Serverinstellingen: naam, icoon, verwijderen.

-- Het icoon is een URL naar de publieke avatars-bucket, geen bytes in de
-- database. Zelfde afweging als bij een profielavatar: iedereen die de server
-- ziet moet hem kunnen laden, dus versleutelen kan niet en heeft ook geen
-- zin — een servericoon is geen gespreksinhoud.
alter table public.servers
  add column if not exists icon_url text;

-- ---------------------------------------------------------------------------
-- Naam en icoon wijzigen: owner of admin
-- ---------------------------------------------------------------------------

-- owner_id wordt hier NIET in de with check gecontroleerd, en dat is met
-- opzet. De voor de hand liggende versie,
--
--   with check (owner_id = (select owner_id from public.servers where ...))
--
-- is een subquery op public.servers binnen een policy op public.servers. Dat
-- is exact de oneindige recursie waar CLAUDE.md voor waarschuwt. Het slot op
-- owner_id staat daarom in een trigger, die buiten RLS om werkt.
drop policy if exists "beheerders wijzigen de server" on public.servers;
create policy "beheerders wijzigen de server"
  on public.servers for update
  to authenticated
  using (public.is_server_admin(id))
  with check (public.is_server_admin(id));

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

-- De client laat de naam overtypen voordat hij dit aanroept, maar dat is een
-- rem in de UI en geen beveiliging — deze policy is de echte grens.
drop policy if exists "eigenaar verwijdert de server" on public.servers;
create policy "eigenaar verwijdert de server"
  on public.servers for delete
  to authenticated
  using (public.is_server_owner(id));
