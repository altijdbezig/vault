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

-- De afzender mag zijn eigen bericht wijzigen zolang hij nog lid is van het
-- kanaal. Twee dingen om te weten:
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
-- Dit is een extra permissive policy, geen vervanging: bestaande policies op
-- messages worden niet aangeraakt. Permissive policies worden met OR
-- gecombineerd, dus dit kan alleen rechten toevoegen, nooit wegnemen.
drop policy if exists "afzender bewerkt eigen bericht" on public.messages;
create policy "afzender bewerkt eigen bericht"
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

-- messages staat al in de publicatie voor INSERT. Bewerken en verwijderen
-- komen als UPDATE binnen; controleer in het dashboard dat Realtime op
-- messages ook UPDATE doorgeeft (de toggle zet normaal alle events aan).
--
-- replica identity blijft op de default (primary key). De UPDATE-payload
-- bevat dan een complete `new`, en `old` alleen de id. De client gebruikt
-- alleen `new`, dus REPLICA IDENTITY FULL is niet nodig — dat zou wel elke
-- oude ciphertext nog een keer over de socket sturen.
