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
