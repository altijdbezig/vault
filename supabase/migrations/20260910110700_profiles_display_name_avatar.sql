-- Weergavenaam en avatar.
--
-- Zouden al moeten bestaan; if not exists zodat deze migratie ook draait op
-- een database waar ze ontbreken.
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists avatar_url text;

-- created_at is nodig voor "lid sinds" op de profielkaart. Default now() geeft
-- bestaande rijen het moment van de migratie in plaats van hun echte
-- aanmaakmoment — dat is niet mooi maar wel eerlijker dan null, en het is
-- alleen een label.
alter table public.profiles add column if not exists created_at timestamptz not null default now();

-- Een lege string is geen weergavenaam. Null betekent "gebruik de
-- gebruikersnaam", en dat onderscheid moet in de database staan, anders moet
-- elke lezer het opnieuw verzinnen.
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
      and p.public_key = p_public_key
      and p.key_fingerprint = p_fingerprint
  );
$$;

revoke execute on function public.profile_key_unchanged(uuid, text, text) from public, anon;
grant execute on function public.profile_key_unchanged(uuid, text, text) to authenticated;

drop policy if exists "eigen profiel bijwerken" on public.profiles;
create policy "eigen profiel bijwerken"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and public.profile_key_unchanged(id, public_key, key_fingerprint)
  );
