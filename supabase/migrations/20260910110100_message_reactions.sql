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
