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
