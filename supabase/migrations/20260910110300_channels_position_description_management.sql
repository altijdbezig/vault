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
