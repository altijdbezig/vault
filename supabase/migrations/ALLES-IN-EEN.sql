-- =====================================================================
-- Vault: alle migraties van de upgrade, in volgorde, in een blok.
--
-- Dit bestand is niets anders dan de losse migraties uit deze map achter
-- elkaar geplakt, in bestandsnaamvolgorde. Het staat er zodat je alles in een
-- keer in de SQL-editor kunt draaien; de losse bestanden blijven de bron.
--
-- Alles hieronder is herhaalbaar: kolommen komen met "if not exists", policies
-- en functies worden vervangen, en tabellen worden alleen aangemaakt als ze er
-- nog niet zijn. Twee keer draaien kan dus geen kwaad.
--
-- BELANGRIJK, en het verschil met de eerste versie van dit bestand: vijf
-- policies VERVANGEN een bestaande policy in productie in plaats van ernaast
-- te komen staan. Permissive policies combineren met OR, dus twee policies
-- voor dezelfde tabel en hetzelfde commando betekent dat de ruimste van de
-- twee bepaalt wat mag — en bij profiles en messages zou dat de bescherming
-- stilzwijgend uitzetten. Elk van die vijf begint daarom met een
-- "drop policy if exists" op de EXACTE naam uit productie:
--
--   messages         UPDATE  "eigen bericht bewerken"
--   channels         DELETE  "maker of servereigenaar verwijdert kanaal"
--   profiles         UPDATE  "eigen profiel bewerken"
--   servers          UPDATE  "eigenaar bewerkt server"
--   server_members   DELETE  "jezelf verwijderen uit server"
--   channel_members  DELETE  "kanaal verlaten"
--
-- Elke vervanger houdt de bestaande beperking aan en zet er alleen bij wat
-- nodig was. Wat er per stuk verandert staat in het commentaar erboven.
--
-- Draai dit in een transactie als je dat prettig vindt, maar het hoeft niet:
-- de stappen zijn onafhankelijk en een halve run is met een tweede run recht
-- te trekken.
--
-- Wat er per tabel live getest moet worden staat in
-- docs/migraties-en-rls-tests.md.
-- =====================================================================

-- =====================================================================
-- 20260910110000_helper_functions_roles_and_visibility.sql
-- =====================================================================

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

-- =====================================================================
-- 20260910110100_message_reactions.sql
-- =====================================================================

-- Emoji-reacties.
--
-- Reacties zijn metadata, geen inhoud: "wie zette welke emoji onder welk
-- bericht". De server weet al wie er in een kanaal zit en wanneer er iets
-- gestuurd is, dus dit voegt niets toe aan wat hij al kan zien. Daarom
-- onversleuteld — versleutelen zou betekenen dat je per lid een kopie van
-- elke reactie opslaat, en dat kost meer dan het oplevert.
--
-- De emoji zelf staat als tekst in de kolom. Dat is bewust: een reactie is
-- geen berichtinhoud en niemand typt er een geheim in. Als dat ooit anders
-- voelt, is het antwoord "geen reacties", niet "versleutelde reacties".

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  -- Default auth.uid(), net als messages.sender_id en channels.created_by.
  -- Zonder default moet de client zijn eigen id meesturen en faalt de insert
  -- op NOT NULL voordat de policy er iets over kan zeggen.
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  -- Eén persoon, één keer dezelfde emoji per bericht. Dit is ook wat het
  -- togglen mogelijk maakt: insert = aan, delete = uit, en een dubbele klik
  -- kan geen twee rijen maken.
  primary key (message_id, user_id, emoji),
  -- Een emoji is kort. Deze grens is er zodat de kolom geen vrije tekstopslag
  -- wordt waar iemand een bericht in kwijt kan.
  constraint message_reactions_emoji_length check (char_length(emoji) between 1 and 32)
);

create index if not exists message_reactions_message_id_idx
  on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

-- Lezen: als je het bericht mag zien, mag je de reacties eronder zien.
drop policy if exists "kanaalleden zien reacties" on public.message_reactions;
create policy "kanaalleden zien reacties"
  on public.message_reactions for select
  to authenticated
  using (public.is_message_visible(message_id));

-- Schrijven: alleen je eigen reactie, en alleen op een bericht dat je mag
-- zien. Zonder de tweede voorwaarde kan iemand reacties hangen onder een
-- bericht in een kanaal waar hij niet in zit — hij ziet het bericht niet,
-- maar de leden zien wel zijn emoji.
--
-- Kip-en-ei-controle: de client doet hier bewust GEEN .select() achteraan
-- (zie toggleReaction in src/lib/supabase/reactions.ts), dus er hoeft niets
-- teruggelezen te worden. Mocht dat ooit veranderen: de select-policy
-- hierboven staat het toe, want lidmaatschap verandert niet door de insert.
drop policy if exists "eigen reactie toevoegen" on public.message_reactions;
create policy "eigen reactie toevoegen"
  on public.message_reactions for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and public.is_message_visible(message_id)
  );

-- Verwijderen: alleen je eigen reactie. Geen moderatie op reacties van
-- anderen — dat is een aparte beslissing en die is niet genomen.
drop policy if exists "eigen reactie weghalen" on public.message_reactions;
create policy "eigen reactie weghalen"
  on public.message_reactions for delete
  to authenticated
  using (user_id = auth.uid());

-- Geen update-policy. Een reactie wijzigen bestaat niet: je haalt hem weg en
-- zet een andere.

-- Realtime, zodat een reactie van iemand anders meteen verschijnt.
--
-- Dit is wel nodig: de publicatie supabase_realtime bevat (nagekeken
-- 10-09-2026) alleen messages en channel_members, niet message_reactions.
--
-- Replica identity blijft op default, dus op de primary key — en dat werkt
-- hier alleen doordat de primary key (message_id, user_id, emoji) is. Bij een
-- DELETE stuurt Postgres namelijk alleen de key-kolommen mee in `old`, en dat
-- zijn hier precies de drie velden die de client nodig heeft om te weten welke
-- reactie weg moet. Zou de tabel ooit een losse id-kolom als primary key
-- krijgen, dan komt er bij een DELETE alleen die id mee en werkt het weghalen
-- van een reactie niet meer zonder REPLICA IDENTITY FULL.
--
-- Idempotent gemaakt: opnieuw toevoegen van een tabel die al in de
-- publicatie zit is een error, geen no-op.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end
$$;

-- =====================================================================
-- 20260910110200_messages_reply_edit_delete.sql
-- =====================================================================

-- Antwoorden, bewerken en verwijderen.

-- ---------------------------------------------------------------------------
-- Antwoorden
-- ---------------------------------------------------------------------------

-- on delete set null, niet cascade. Een antwoord is een eigen bericht met
-- eigen inhoud; als het origineel hard verdwijnt (bijvoorbeeld omdat een
-- account wordt opgeruimd) moet het antwoord blijven staan. De UI valt dan
-- terug op "origineel niet meer beschikbaar".
alter table public.messages
  add column if not exists reply_to_id uuid references public.messages(id) on delete set null;

-- Voor het ophalen van de previews van een pagina berichten in één query.
create index if not exists messages_reply_to_id_idx
  on public.messages (reply_to_id);

-- ---------------------------------------------------------------------------
-- Bewerken
-- ---------------------------------------------------------------------------

-- Zou al moeten bestaan; if not exists zodat deze migratie ook draait op een
-- database waar hij ontbreekt.
alter table public.messages
  add column if not exists edited_at timestamptz;

-- LET OP: dit VERVANGT de bestaande policy, hij komt er niet naast.
--
-- Productie heeft al een update-policy op messages, "eigen bericht bewerken",
-- met using en with check op sender_id = auth.uid(). Een tweede permissive
-- policy ernaast zou met OR gecombineerd worden, en dan bepaalt de ruimste
-- van de twee wat mag. Twee policies voor hetzelfde commando betekent dus dat
-- niemand meer uit één regel kan lezen wat de grens is.
--
-- Deze policy houdt de bestaande beperking (sender_id = auth.uid() aan beide
-- kanten) volledig aan en voegt er één voorwaarde aan toe: je moet nog lid
-- zijn van het kanaal. Dat is een VERSMALLING ten opzichte van productie —
-- wie een kanaal verlaten heeft, kan zijn oude berichten daar niet meer
-- bewerken of verwijderen. Bewust: het is ook wat voorkomt dat een bericht
-- naar een kanaal geschoven wordt waar de afzender niet in zit.
--
-- Drie dingen om te weten:
--
-- 1. RLS werkt per rij, niet per kolom. Deze policy staat dus toe dat de
--    afzender ciphertext, edited_at en deleted_at aanpast. Dat is precies wat
--    bewerken en soft-deleten nodig hebben, maar het betekent ook dat de
--    server niet kan garanderen dat een "bewerking" echt een bewerking was.
--    Dat hoeft ook niet: de inhoud is toch ondoorzichtig voor de server, en
--    de PGP-handtekening in de nieuwe ciphertext is wat authorschap bewijst.
--
-- 2. sender_id staat in zowel using als with check. Zonder de with check kan
--    de afzender sender_id op iemand anders zetten en het bericht daarmee aan
--    een ander toeschrijven. De handtekening zou dan niet meer kloppen, maar
--    de rij is dan al vervuild.
--
-- 3. channel_id wordt NIET vastgezet op zijn oude waarde. Een with check kan
--    niet naar de vorige waarde van een rij kijken, dus dit kan alleen met een
--    trigger. Wat de regel hieronder wel afdwingt: het doelkanaal moet een
--    kanaal zijn waar je zelf lid van bent. Een bericht verplaatsen tussen
--    twee kanalen waar je beide in zit, blijft dus mogelijk. Genoteerd in
--    docs/migraties-en-rls-tests.md; niet gebouwd, want er is geen scherm dat
--    het doet en een trigger toevoegen was niet gevraagd.
drop policy if exists "eigen bericht bewerken" on public.messages;
drop policy if exists "afzender bewerkt eigen bericht" on public.messages;
create policy "eigen bericht bewerken"
  on public.messages for update
  to authenticated
  using (sender_id = auth.uid() and public.is_channel_member(channel_id))
  with check (sender_id = auth.uid() and public.is_channel_member(channel_id));

-- ---------------------------------------------------------------------------
-- Verwijderen
-- ---------------------------------------------------------------------------

-- Verwijderen is een UPDATE, geen DELETE: deleted_at wordt gezet en
-- ciphertext wordt leeggemaakt. Twee redenen om de rij te laten staan:
--
-- - Antwoorden en reacties verwijzen ernaar. Een harde delete zou die met
--   cascade meesleuren of met set null stukmaken.
-- - De plek in het gesprek blijft zichtbaar als "bericht verwijderd", zoals
--   in Telegram en Discord. Een gat in de geschiedenis leest als een bug.
--
-- Waarom de ciphertext leeg moet: een verborgen bericht is geen verwijderd
-- bericht. Zolang de ciphertext er staat kan elk lid dat hem al had (of via
-- de API opnieuw ophaalt) hem gewoon blijven ontsleutelen. Het leegmaken
-- gebeurt in de client, in dezelfde update die deleted_at zet — zie
-- deleteMessage in src/lib/supabase/messages.ts.
--
-- Dit is geen belofte dat het bericht bij de ontvanger van diens scherm
-- verdwijnt als hij het al ontsleuteld heeft. Die belofte kan niemand doen.

-- Een index op deleted_at is niet nodig: er wordt altijd op channel_id +
-- created_at gepagineerd en deleted_at is daarbinnen een goedkope filter.

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

-- Hier hoeft niets te gebeuren, en dat is nagekeken (10-09-2026): de
-- publicatie supabase_realtime bevat messages al, met pubinsert, pubupdate en
-- pubdelete alle drie op true. Bewerken en verwijderen komen als UPDATE binnen
-- en worden dus doorgegeven.
--
-- Replica identity staat op default, dus op de primary key. Gevolg:
--
-- - Bij een UPDATE komt de volledige nieuwe rij mee in `new`. Het filter
--   channel_id=eq.<id> in subscribeToChannel werkt daarom ook voor UPDATE.
-- - Bij een echte DELETE zou `old` alleen de id bevatten, en zou dat filter
--   dus nooit matchen. Niet relevant voor messages: verwijderen is hier een
--   UPDATE (deleted_at + lege ciphertext), geen DELETE.
--
-- REPLICA IDENTITY FULL is niet nodig en niet wenselijk: dat zou bij elke
-- bewerking de vorige ciphertext nog een keer over de socket sturen.

-- =====================================================================
-- 20260910110300_channels_position_description_management.sql
-- =====================================================================

-- Kanaalbeheer: ordenen, omschrijving, hernoemen, verwijderen.

-- Sorteersleutel voor slepen. Default 0, zodat bestaande kanalen allemaal op
-- dezelfde waarde staan en de lijst daarna op (position, created_at) sorteert
-- — de bestaande volgorde blijft dus staan tot iemand iets versleept.
alter table public.channels
  add column if not exists position integer not null default 0;

-- Omschrijving in de header. Vrije tekst, onversleuteld: het is een label van
-- het kanaal, geen gespreksinhoud, en het staat naast de kanaalnaam die ook
-- onversleuteld is.
alter table public.channels
  add column if not exists description text;

create index if not exists channels_server_id_position_idx
  on public.channels (server_id, position);

-- ---------------------------------------------------------------------------
-- Wijzigen
-- ---------------------------------------------------------------------------

-- Twee gevallen in één policy, want het is één tabel:
--
-- - Serverkanaal (server_id gevuld): owner of admin. Dat is de rolgrens uit
--   sectie 4.3, en hij hoort hier te staan en niet alleen in de client —
--   anders is "admins kunnen kanalen hernoemen" een UI-afspraak in plaats van
--   een regel.
-- - Groep of DM (server_id null): elk lid. Een groep heeft geen rollen, en de
--   naam van een groep is iets wat de deelnemers samen bepalen.
--
-- Productie heeft (nagekeken 10-09-2026) GEEN update-policy op channels, dus
-- deze komt niet naast iets anders te staan: hij is de enige, en zonder hem
-- kan er niets hernoemd, van omschrijving voorzien of versleept worden.
--
-- with check herhaalt de using-voorwaarde. Wat dat wel doet: het doelkanaal
-- moet na de wijziging nog steeds een kanaal zijn waar je beheerder van bent.
-- Wat het niet doet: server_id vastzetten op de oude waarde — een with check
-- kan niet naar de vorige waarde kijken. Een admin van server A kan een kanaal
-- dus niet naar server B verplaatsen (daar is hij geen admin) en niet naar
-- server_id null (dan valt hij in de else-tak en is hij geen kanaallid van een
-- kanaal dat hij net uit zijn server haalt) — maar dat leunt op die twee
-- toevalligheden en niet op een expliciete regel. Genoteerd in
-- docs/migraties-en-rls-tests.md als iets om live te proberen.
drop policy if exists "beheerders wijzigen kanalen" on public.channels;
create policy "beheerders wijzigen kanalen"
  on public.channels for update
  to authenticated
  using (
    case
      when server_id is not null then public.is_server_admin(server_id)
      else public.is_channel_member(id)
    end
  )
  with check (
    case
      when server_id is not null then public.is_server_admin(server_id)
      else public.is_channel_member(id)
    end
  );

-- ---------------------------------------------------------------------------
-- Verwijderen
-- ---------------------------------------------------------------------------

-- Hier is de grens strenger dan bij wijzigen: een kanaal verwijderen gooit
-- alle berichten erin weg en dat is onomkeerbaar.
--
-- - Serverkanaal: owner of admin.
-- - Groep: niet via deze weg. Een groep verlaat je (channel_members delete op
--   je eigen rij); de laatste die weggaat laat een kanaal zonder leden achter
--   en dat is voor niemand meer zichtbaar. Een groep die een deelnemer voor
--   iedereen kan wissen is een ander soort feature en die is niet gevraagd.
--
-- LET OP: dit VERVANGT de bestaande policy.
--
-- Productie heeft al "maker of servereigenaar verwijdert kanaal". Zou deze
-- ernaast komen te staan, dan combineert Postgres ze met OR en is het
-- resultaat "maker OF eigenaar OF admin" zonder dat één van de twee dat zegt.
-- Dat is precies de uitbreiding die sectie 4.3 vraagt, maar hij hoort in één
-- regel te staan waar je hem kunt lezen.
--
-- Wat er behouden blijft: de maker (created_by = auth.uid()) en de eigenaar.
-- is_server_admin dekt de eigenaar, want die heeft role = 'owner' in
-- server_members; owner_id op servers wordt daarnaast gecontroleerd zodat een
-- eigenaar die om welke reden dan ook geen server_members-rij heeft er niet
-- buiten valt.
--
-- Wat erbij komt: admins.
--
-- created_by blijft nodig voor het terugdraaien van een net aangemaakt
-- serverkanaal waarvan de channel_members-insert faalde (zie createChannel).
drop policy if exists "maker of servereigenaar verwijdert kanaal" on public.channels;
drop policy if exists "beheerders verwijderen kanalen" on public.channels;
create policy "maker of servereigenaar verwijdert kanaal"
  on public.channels for delete
  to authenticated
  using (
    created_by = auth.uid()
    or (
      server_id is not null
      and (
        public.is_server_admin(server_id)
        or exists (
          select 1
          from public.servers s
          where s.id = channels.server_id
            and s.owner_id = auth.uid()
        )
      )
    )
  );

-- =====================================================================
-- 20260910110400_servers_icon_and_management.sql
-- =====================================================================

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

-- =====================================================================
-- 20260910110500_server_members_roles_and_leave.sql
-- =====================================================================

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

-- =====================================================================
-- 20260910110600_server_invites.sql
-- =====================================================================

-- Echte uitnodigingen: een korte code, optioneel met vervaldatum en maximum.

create table if not exists public.server_invites (
  -- De code is de sleutel. Kort genoeg om door te bellen, lang genoeg om niet
  -- te raden: 10 tekens uit een alfabet van 32 is ~50 bits.
  code text primary key,
  server_id uuid not null references public.servers(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Null = geen vervaldatum.
  expires_at timestamptz,
  -- Null = onbeperkt gebruik.
  max_uses integer,
  uses integer not null default 0,
  created_at timestamptz not null default now(),
  constraint server_invites_code_shape check (code ~ '^[a-z0-9]{6,32}$'),
  constraint server_invites_max_uses_positive check (max_uses is null or max_uses > 0)
);

create index if not exists server_invites_server_id_idx
  on public.server_invites (server_id);

alter table public.server_invites enable row level security;

-- ---------------------------------------------------------------------------
-- Lezen: ALLEEN beheerders. Dit is het belangrijkste stuk van deze migratie.
-- ---------------------------------------------------------------------------

-- De verleiding is een policy als "iedereen die is ingelogd mag een invite
-- lezen", zodat de client code -> server_id kan opzoeken. Dat werkt, en het
-- is fout: PostgREST past de policy per rij toe, maar het filter komt van de
-- client. Een ingelogde gebruiker vraagt dan simpelweg
--
--   GET /rest/v1/server_invites?select=*
--
-- en krijgt elke geldige uitnodigingscode van elke server terug. Eén request
-- en je zit in alle servers.
--
-- Daarom: lezen mag alleen als beheerder van die server (voor het
-- beheerscherm), en het inwisselen gaat via redeem_server_invite() hieronder.
drop policy if exists "beheerders zien uitnodigingen" on public.server_invites;
create policy "beheerders zien uitnodigingen"
  on public.server_invites for select
  to authenticated
  using (public.is_server_admin(server_id));

-- Aanmaken: beheerders, en alleen op eigen naam.
--
-- Kip-en-ei-controle: de client doet .insert().select() om de code terug te
-- krijgen en te kunnen tonen. Dat kan hier, want de select-policy hangt aan
-- is_server_admin(server_id) en dat was al waar voordat de rij bestond. Geen
-- 403 zoals bij channels in 20260908140321.
drop policy if exists "beheerders maken uitnodigingen" on public.server_invites;
create policy "beheerders maken uitnodigingen"
  on public.server_invites for insert
  to authenticated
  with check (
    public.is_server_admin(server_id)
    and created_by = auth.uid()
  );

-- Intrekken: beheerders.
drop policy if exists "beheerders trekken uitnodigingen in" on public.server_invites;
create policy "beheerders trekken uitnodigingen in"
  on public.server_invites for delete
  to authenticated
  using (public.is_server_admin(server_id));

-- Geen update-policy. `uses` wordt alleen door redeem_server_invite()
-- bijgewerkt, en die functie is SECURITY DEFINER en gaat dus om RLS heen. Een
-- update-policy zou betekenen dat een beheerder de teller kan terugzetten, en
-- dat is een feature die niemand gevraagd heeft.

-- ---------------------------------------------------------------------------
-- Inwisselen
-- ---------------------------------------------------------------------------

-- Alles in één functie, want het is één handeling die niet half mag lukken:
-- code valideren, lid worden van de server, lid worden van de kanalen, teller
-- bijwerken. Zou de client dit in vier requests doen, dan is er geen enkele
-- garantie dat hij bij request twee nog bestaat.
--
-- SECURITY DEFINER is hier onvermijdelijk: de aanroeper mag de invite-rij
-- juist NIET lezen (zie hierboven). De functie geeft daarom ook niets van de
-- rij terug behalve het server_id dat de gebruiker daarna toch al ziet.
--
-- Wat deze functie NIET doet: oudere berichten leesbaar maken. Die zijn
-- versleuteld voor de leden van toen. Dat is bewust en staat zo in CLAUDE.md.
create or replace function public.redeem_server_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite public.server_invites;
  v_uid uuid := auth.uid();
  v_added integer;
begin
  if v_uid is null then
    raise exception 'Niet ingelogd.' using errcode = '42501';
  end if;

  -- for update: twee mensen die tegelijk de laatste plek pakken moeten niet
  -- allebei binnenkomen.
  select * into v_invite
  from public.server_invites
  where code = lower(btrim(p_code))
  for update;

  if not found then
    raise exception 'Deze uitnodiging bestaat niet.' using errcode = 'P0002';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'Deze uitnodiging is verlopen.' using errcode = 'P0003';
  end if;

  if v_invite.max_uses is not null and v_invite.uses >= v_invite.max_uses then
    raise exception 'Deze uitnodiging is al opgebruikt.' using errcode = 'P0004';
  end if;

  -- where not exists in plaats van on conflict: dat werkt ook als er geen
  -- unieke constraint op (server_id, user_id) blijkt te staan.
  insert into public.server_members (server_id, user_id, role)
  select v_invite.server_id, v_uid, 'member'
  where not exists (
    select 1 from public.server_members sm
    where sm.server_id = v_invite.server_id and sm.user_id = v_uid
  );
  get diagnostics v_added = row_count;

  -- Serverlidmaatschap alleen is niet genoeg: berichten en ledensleutels
  -- hangen aan channel_members.
  insert into public.channel_members (channel_id, user_id)
  select c.id, v_uid
  from public.channels c
  where c.server_id = v_invite.server_id
    and not exists (
      select 1 from public.channel_members cm
      where cm.channel_id = c.id and cm.user_id = v_uid
    );

  -- Alleen tellen als er echt iemand bij kwam. Twee keer op dezelfde link
  -- klikken hoort geen gebruik te kosten, anders is een invite met max_uses 1
  -- opgebruikt door een dubbele tap.
  if v_added > 0 then
    update public.server_invites
    set uses = uses + 1
    where code = v_invite.code;
  end if;

  return v_invite.server_id;
end;
$$;

-- Zelfde dichtzetten als de andere helpers: anon heeft hier niets te zoeken.
revoke execute on function public.redeem_server_invite(text) from public, anon;
grant execute on function public.redeem_server_invite(text) to authenticated;

-- =====================================================================
-- 20260910110700_profiles_display_name_avatar.sql
-- =====================================================================

-- Weergavenaam en avatar.
--
-- display_name, avatar_url EN created_at BESTAAN AL in productie (nagekeken
-- 10-09-2026). Deze drie regels doen daar dus niets. Ze blijven staan zodat
-- een verse database dezelfde vorm krijgt, en "if not exists" maakt ze gratis.
--
-- Wat deze migratie wél toevoegt is alles hieronder: de functie
-- profile_key_unchanged en de update-policy die de publieke sleutel op slot
-- zet.
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();

-- Een lege string is geen weergavenaam. Null betekent "gebruik de
-- gebruikersnaam", en dat onderscheid moet in de database staan, anders moet
-- elke lezer het opnieuw verzinnen.
--
-- LET OP bij het draaien: als er in productie al een rij staat met
-- display_name = '' (een lege string in plaats van null), dan faalt deze
-- ALTER. Repareer die rij dan eerst:
--
--   update public.profiles set display_name = null where btrim(display_name) = '';
--
-- De client stuurt altijd null en nooit een lege string, dus dit kan alleen
-- van een oude of met de hand gezette rij komen.
alter table public.profiles drop constraint if exists profiles_display_name_not_blank;
alter table public.profiles add constraint profiles_display_name_not_blank
  check (display_name is null or btrim(display_name) <> '');

-- Je eigen profiel bijwerken.
--
-- with check sluit de sleutelkolommen op. Dit is het belangrijkste stuk:
-- zonder deze regel kan een gebruiker zijn eigen public_key en
-- key_fingerprint overschrijven. Dat lijkt onschuldig ("het is mijn eigen
-- rij") maar het is precies de aanval die sleutelverificatie moet opvangen:
-- iemand wisselt zijn publieke sleutel, de anderen versleutelen vanaf dat
-- moment naar de nieuwe sleutel, en wie het vinkje uit 3.4 niet controleert
-- merkt er niets van.
--
-- Sleutelrotatie is een echte feature met een eigen ontwerp (oude berichten
-- blijven aan de oude sleutel hangen, de fingerprint-waarschuwing moet
-- afgaan, iedereen moet opnieuw verifiëren). Tot die er is: op slot.
--
-- De subquery gaat via een SECURITY DEFINER functie en niet rechtstreeks,
-- want een policy op public.profiles die zelf public.profiles leest is de
-- recursieval uit CLAUDE.md.
create or replace function public.profile_key_unchanged(
  p_id uuid,
  p_public_key text,
  p_fingerprint text
)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_id
      -- is not distinct from, niet =. Een half aangemaakt profiel kan
      -- public_key null hebben (de code rekent daar op: zie
      -- ChannelMemberKey.publicKey), en null = null levert null op, geen true.
      -- Met = zou zo iemand zijn weergavenaam nooit meer kunnen opslaan, en de
      -- foutmelding zou een 403 zijn die niets uitlegt.
      and p.public_key is not distinct from p_public_key
      and p.key_fingerprint is not distinct from p_fingerprint
  );
$$;

revoke execute on function public.profile_key_unchanged(uuid, text, text) from public, anon;
grant execute on function public.profile_key_unchanged(uuid, text, text) to authenticated;

-- LET OP: dit VERVANGT de bestaande policy, en dit is de belangrijkste van
-- de hele correctieronde.
--
-- Productie heeft al "eigen profiel bewerken", die je eigen rij toestaat.
-- Zou deze policy ernaast komen te staan, dan combineert Postgres ze met OR
-- en is het resultaat gewoon "id = auth.uid()" — het slot op de publieke
-- sleutel doet dan NIETS, zonder foutmelding en zonder dat er iets kapot
-- lijkt. Dat is precies het scenario waar sleutelverificatie voor bestaat:
-- iemand verwisselt zijn publieke sleutel, iedereen versleutelt vanaf dat
-- moment stil naar de nieuwe, en niemand merkt het.
--
-- Wat behouden blijft: alleen je eigen rij. Wat erbij komt: public_key en
-- key_fingerprint mogen niet mee veranderen.
--
-- De client raakt die twee kolommen nooit aan (updateProfile bouwt zijn patch
-- alleen uit display_name en avatar_url, en de enige plek waar public_key
-- geschreven wordt is de INSERT bij signup, die hier los van staat).
drop policy if exists "eigen profiel bewerken" on public.profiles;
drop policy if exists "eigen profiel bijwerken" on public.profiles;
create policy "eigen profiel bewerken"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and public.profile_key_unchanged(id, public_key, key_fingerprint)
  );

-- =====================================================================
-- 20260910110800_storage_avatars_attachments.sql
-- =====================================================================

-- Twee Storage-buckets met tegengestelde regels.
--
-- avatars     : publiek leesbaar, plaintext plaatjes. Een avatar is een label,
--               geen gespreksinhoud, en hij moet door iedereen die je naam
--               ziet te laden zijn. Versleutelen kan dus niet en heeft geen
--               zin. De UI zegt dit letterlijk bij het uploaden.
-- attachments : privaat, uitsluitend ciphertext. Het bestand wordt in de
--               browser met OpenPGP versleuteld voor alle kanaalleden en pas
--               daarna geüpload. Supabase krijgt bytes te zien die hij niet
--               kan lezen.

-- ---------------------------------------------------------------------------
-- Buckets
-- ---------------------------------------------------------------------------

-- Kan ook met de hand in het dashboard; dit is dezelfde handeling in SQL,
-- zodat er niets te onthouden valt bij een nieuwe omgeving.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152, -- 2 MB. Een avatar wordt op 128px getoond.
  array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments',
  'attachments',
  false,
  12582912, -- 12 MB. De client staat 10 MB plaintext toe; binaire PGP-output
            -- is ongeveer even groot, dit is de marge.
  -- Dit is een vangnet, geen sierlijstje: alleen ondoorzichtige bytes mogen
  -- hier naar binnen. Zou er ooit per ongeluk een plaintext image/png of
  -- application/pdf geüpload worden, dan weigert Storage het bestand in
  -- plaats van het stil te bewaren.
  array['application/octet-stream']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- avatars: publiek lezen, eigen map schrijven
-- ---------------------------------------------------------------------------

-- Het pad is <user_id>/<bestandsnaam>. foldername(name)[1] is dus het
-- user_id, en dat is wat een gebruiker aan zijn eigen map bindt. Zonder deze
-- vergelijking kan iedereen de avatar van iedereen overschrijven.
drop policy if exists "avatars zijn publiek leesbaar" on storage.objects;
create policy "avatars zijn publiek leesbaar"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "eigen avatar uploaden" on storage.objects;
create policy "eigen avatar uploaden"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "eigen avatar overschrijven" on storage.objects;
create policy "eigen avatar overschrijven"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "eigen avatar verwijderen" on storage.objects;
create policy "eigen avatar verwijderen"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- attachments: alleen kanaalleden
-- ---------------------------------------------------------------------------

-- Het pad is <channel_id>/<random>.pgp. De eerste map is dus het kanaal, en
-- daarmee valt lidmaatschap te controleren met de bestaande helper.
--
-- De cast naar uuid moet wel eerst gecontroleerd worden. Een pad als
-- "hallo/bestand.pgp" zou anders een invalid-input-syntax error geven in het
-- midden van een policy-evaluatie, en dat is een 500 in plaats van een nette
-- weigering. Deze functie geeft null bij een pad dat geen kanaal-id is, en
-- is_channel_member(null) is false.
create or replace function public.attachment_channel_id(p_name text)
returns uuid
language sql
immutable
set search_path = public, storage, pg_temp
as $$
  select case
    when (storage.foldername(p_name))[1] ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(p_name))[1])::uuid
    else null
  end;
$$;

revoke execute on function public.attachment_channel_id(text) from public, anon;
grant execute on function public.attachment_channel_id(text) to authenticated;

drop policy if exists "kanaalleden lezen bijlagen" on storage.objects;
create policy "kanaalleden lezen bijlagen"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_channel_member(public.attachment_channel_id(name))
  );

-- Uploaden mag elk kanaallid, in de map van dat kanaal. Er staat geen
-- "en owner = auth.uid()" bij: het bestand is toch al versleuteld voor precies
-- de leden van dat kanaal, dus een upload in een andere map dan je eigen
-- kanaal is het enige wat tegengehouden hoeft te worden.
drop policy if exists "kanaalleden uploaden bijlagen" on storage.objects;
create policy "kanaalleden uploaden bijlagen"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and public.is_channel_member(public.attachment_channel_id(name))
  );

-- Verwijderen: alleen wat je zelf hebt geüpload. owner is de kolom die
-- Storage zelf vult met auth.uid().
--
-- Let op de consequentie: als een bericht met een bijlage verwijderd wordt,
-- maakt de client de ciphertext van het bericht leeg maar blijft het
-- bestand in Storage staan tot de uploader het weghaalt. Dat wordt gedaan in
-- deleteAttachment, maar als die call faalt blijft er een verweesd bestand
-- achter. Het is versleuteld voor de leden van toen, dus het lekt niets
-- nieuws — maar het is wel opruimwerk dat nog niemand doet.
drop policy if exists "eigen bijlage verwijderen" on storage.objects;
create policy "eigen bijlage verwijderen"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'attachments'
    and owner = auth.uid()
  );

-- Geen update-policy op attachments. Een bijlage overschrijven bestaat niet:
-- het pad is een random id en een nieuwe bijlage is een nieuw bestand.

