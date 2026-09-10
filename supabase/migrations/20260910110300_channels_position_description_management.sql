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
-- with check herhaalt de using-voorwaarde plus een extra slot op server_id.
-- Zonder dat slot kan een admin een kanaal uit zijn server verplaatsen naar
-- een server waar hij niets te zoeken heeft, of naar server_id null waarmee
-- het kanaal in de gesprekkenlijst van alle leden opduikt.
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
-- created_by mag ook, voor het geval een net aangemaakt serverkanaal moet
-- worden teruggedraaid door de maker (createChannel doet dat al bij een
-- mislukte channel_members-insert, en leunt nu niet meer op een policy die er
-- misschien niet is).
drop policy if exists "beheerders verwijderen kanalen" on public.channels;
create policy "beheerders verwijderen kanalen"
  on public.channels for delete
  to authenticated
  using (
    created_by = auth.uid()
    or (server_id is not null and public.is_server_admin(server_id))
  );
