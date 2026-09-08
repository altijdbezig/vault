-- Eenmalige opruiming van kanaalnamen.
--
-- Gebruikers typten de # mee ("#leden"), waardoor de UI "# #leden" toonde.
-- Dit past dezelfde normalisatie toe als normalizeChannelName() in
-- src/lib/channelName.ts: leidende #'en eraf, trimmen, kleine letters,
-- spaties worden streepjes, geen dubbele of omsluitende streepjes.
--
-- Idempotent: normaliseren van een al genormaliseerde naam levert precies
-- dezelfde naam op, en de where-clause raakt die rijen dus niet meer aan.
-- Rijen waar niets van overblijft (een naam die alleen uit # of spaties
-- bestond) blijven staan: een lege kanaalnaam is erger dan een lelijke.

with normalized as (
  select
    id,
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(btrim(regexp_replace(name, '^[#\s]+', ''))),
          '\s+', '-', 'g'
        ),
        '-{2,}', '-', 'g'
      ),
      '(^-+)|(-+$)', '', 'g'
    ) as clean
  from public.channels
  where name is not null
)
update public.channels as c
set name = n.clean
from normalized as n
where c.id = n.id
  and n.clean <> ''
  and n.clean is distinct from c.name;
