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
