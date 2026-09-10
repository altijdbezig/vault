# Migraties van de upgrade, en wat er live getest moet worden

## Uitgangspunt: wat er op 10-09-2026 werkelijk in productie stond

Supabase-project `umrpixulwailfchjnmqn`, regio `eu-central-1`, free plan.
Aangeleverd na uitlezen; niet door mij bij de database opgevraagd.

### Policies

| Tabel | Commando | Naam |
| --- | --- | --- |
| `channel_members` | INSERT | kanaalleden toevoegen |
| `channel_members` | DELETE | kanaal verlaten |
| `channel_members` | SELECT | leden zien kanaalleden |
| `channel_members` | UPDATE | eigen leesstatus bijwerken |
| `channels` | INSERT | kanaal aanmaken |
| `channels` | DELETE | maker of servereigenaar verwijdert kanaal |
| `channels` | SELECT | leden zien hun kanaal |
| `messages` | INSERT | leden sturen berichten |
| `messages` | SELECT | leden lezen berichten |
| `messages` | UPDATE | eigen bericht bewerken — `using` **én** `with check` op `sender_id = auth.uid()` |
| `profiles` | INSERT | eigen profiel aanmaken |
| `profiles` | SELECT | profielen zijn leesbaar |
| `profiles` | UPDATE | eigen profiel bewerken |
| `server_members` | INSERT | jezelf toevoegen aan server |
| `server_members` | DELETE | jezelf verwijderen uit server |
| `server_members` | SELECT | leden zien ledenlijst |
| `servers` | INSERT | server aanmaken |
| `servers` | DELETE | eigenaar verwijdert server |
| `servers` | SELECT | leden zien hun server |
| `servers` | UPDATE | eigenaar bewerkt server |

`channels` en `server_members` hebben dus **geen** UPDATE-policy. Dat waren de
enige twee gaten.

### Kolommen

| Tabel | Kolommen |
| --- | --- |
| `profiles` | id, username, display_name, avatar_url, public_key, key_fingerprint, created_at |
| `servers` | id, name, icon_url, owner_id, created_at |
| `server_members` | server_id, user_id, role, joined_at |
| `channels` | id, server_id, type, name, created_by (default `auth.uid()`), created_at |
| `channel_members` | channel_id, user_id, joined_at, last_read_at |
| `messages` | id, channel_id, sender_id (default `auth.uid()`), ciphertext, created_at, edited_at, deleted_at |

### Realtime

Publicatie `supabase_realtime` bevat `messages` en `channel_members`, met
`pubinsert`, `pubupdate` en `pubdelete` alle drie op true. Replica identity
staat op default: alleen de primary key.

Gevolgen om te kennen:

- Bij een UPDATE komt de volledige nieuwe rij mee, dus het filter
  `channel_id=eq.<id>` werkt ook voor UPDATE. Bewerken en verwijderen van een
  bericht komen daarom gewoon binnen; hier hoeft niets ingesteld te worden.
- Bij een echte DELETE komt alleen de primary key mee, en dan matcht dat filter
  nooit. Voor `messages` maakt dat niets uit: verwijderen is hier een UPDATE
  (`deleted_at` plus lege ciphertext), geen DELETE.
- Voor `message_reactions` werkt DELETE juist wél, doordat de primary key daar
  `(message_id, user_id, emoji)` is — precies de velden die de client nodig
  heeft om te weten welke reactie weg moet. Zou die tabel ooit een losse
  `id`-kolom als primary key krijgen, dan is dat stuk.
- `REPLICA IDENTITY FULL` is nergens nodig, en zou bij elke bewerking de vorige
  ciphertext nog een keer over de socket sturen.

---

## Wat dat betekende voor deze migraties

Ze zijn oorspronkelijk **blind geschreven**, zonder toegang tot het schema.
Vijf aannames bleken onjuist, één klopte:

| Aanname | Werkelijkheid |
| --- | --- |
| `messages` heeft geen update-policy | Heeft er wél een, mét `with check` |
| `channels` heeft geen delete-policy | Heeft er wél een |
| `profiles` heeft geen update-policy | Heeft er wél een |
| `profiles` mist display_name / avatar_url / created_at | Alle drie bestaan al |
| `servers` mist icon_url | Bestaat al |
| `channel_members` DELETE staat alleen de eigen rij toe | Klopte |

Het gevaar zat niet in de kolommen maar in de policies. **Permissive policies
combineren met OR**, dus een nieuwe policy naast een bestaande betekent dat de
ruimste van de twee bepaalt wat mag. Bij `profiles` zou dat het slot op de
publieke sleutel stilzwijgend hebben uitgezet: geen foutmelding, niets dat
kapot lijkt.

Daarom **vervangen** zes policies nu de bestaande in plaats van ernaast te
komen staan. Elk begint met een `drop policy if exists` op de exacte naam uit
de tabel hierboven, en houdt de bestaande beperking aan:

| Tabel | Commando | Behouden | Erbij |
| --- | --- | --- | --- |
| `messages` | UPDATE | `sender_id = auth.uid()` op beide kanten | `is_channel_member(channel_id)` — een versmalling |
| `channels` | DELETE | maker, eigenaar | admins |
| `profiles` | UPDATE | alleen je eigen rij | public_key en key_fingerprint op slot |
| `servers` | UPDATE | eigenaar | admins |
| `server_members` | DELETE | je eigen rij | eigenaar mag anderen verwijderen |
| `channel_members` | DELETE | je eigen rij | eigenaar mag anderen verwijderen |

Voor `servers` DELETE staat er nu **geen** eigen policy meer. Die in productie
is al exact de grens die deze migratie wilde, en een tweede zou alleen een
tweede definitie van "eigenaar" introduceren (`server_members.role` naast
`servers.owner_id`) die uit elkaar kan lopen.

Verder:

- Kolommen komen nog steeds met `add column if not exists`, ook de vijf die al
  bestaan. Ze doen daar niets en houden een verse database in dezelfde vorm.
- Wat een policy niet kan (naar de vorige waarde van een rij kijken) staat in
  een trigger.

Draai ze in bestandsvolgorde. Ze zijn los van elkaar herhaalbaar, dus twee keer
draaien kan geen kwaad.

`supabase/migrations/ALLES-IN-EEN.sql` is precies deze negen bestanden achter
elkaar geplakt, voor als je alles in een keer in de SQL-editor wilt draaien. De
losse bestanden blijven de bron; dat bestand is alleen een gemak.

### Twee dingen om vóór het draaien te weten

**1. De constraint op display_name kan falen.**
`profiles_display_name_not_blank` weigert een lege string. Staat er al een rij
met `display_name = ''` in plaats van `null`, dan faalt de ALTER. De client
stuurt altijd `null`, dus dit kan alleen van een oude of met de hand gezette
rij komen. Repareren:

```sql
update public.profiles set display_name = null where btrim(display_name) = '';
```

**2. Van de policies op `storage.objects` heb ik geen lijst.**
De aangeleverde inventarisatie dekt de zes tabellen in `public`, niet
`storage.objects`. Migratie `20260910110800` zet daar zeven policies neer met
`drop policy if exists` op mijn eigen namen. Bestaan er al policies op die
tabel met andere namen — bijvoorbeeld van een eerdere avatar-poging, want
`profiles.avatar_url` bestond al — dan komen de mijne ernaast te staan en
geldt dezelfde OR-regel. **Controleer dit vóór of direct na het draaien:**

```sql
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;
```

Staat er iets tussen dat ruimer is dan "eigen map" voor `avatars` of
"kanaallid" voor `attachments`, dan is dat het echte plafond en niet wat mijn
policies zeggen.

---

## Wat er per tabel live getest moet worden

Ga er niet van uit dat een policy werkt omdat hij logisch leest. Dit is de
lijst die ik zou aflopen, met twee accounts (A en B) en één server.

### `message_reactions`

- [ ] A reageert op een bericht in een kanaal waar B ook in zit. B ziet de
      reactie verschijnen zonder te herladen (realtime).
- [ ] A klikt dezelfde emoji nog een keer. De reactie verdwijnt, en er
      ontstaat geen tweede rij.
- [ ] B probeert de reactie van A weg te halen. Moet falen — de delete-policy
      staat alleen `user_id = auth.uid()` toe.
- [ ] **De belangrijkste:** B haalt met een REST-call rechtstreeks een reactie
      op een bericht uit een kanaal waar hij *niet* in zit. Moet leeg
      terugkomen. Dit test `is_message_visible`.
- [ ] B probeert met een REST-call een reactie te *plaatsen* op een bericht uit
      een kanaal waar hij niet in zit. Moet een 403 geven.

### `messages` (`reply_to_id`, bewerken, verwijderen)

- [ ] **Eerst, en dit is de belangrijkste controle van de hele ronde:** staat
      er precies EEN update-policy op `messages`, en heeft die een `with
      check`? Twee permissive policies worden met OR gecombineerd en dan geldt
      de ruimste.

      `select policyname, cmd, qual, with_check from pg_policies where tablename = 'messages';`

- [ ] A bewerkt zijn eigen bericht. B ziet de nieuwe tekst en "(bewerkt)"
      zonder te herladen. Dat `pubupdate` aanstaat is geverifieerd op
      10-09-2026, dus hier hoeft niets ingesteld te worden; werkt het toch
      niet, dan is de publicatie niet de oorzaak.
- [ ] B probeert een bericht van A te bewerken. Moet een 403 geven.
- [ ] A verlaat een kanaal en probeert daarna een oud bericht van zichzelf
      daar te bewerken. Moet nu falen: dat is de versmalling die deze migratie
      toevoegt.
- [ ] A verwijdert zijn bericht. Controleer **in de database** dat
      `ciphertext` echt leeg is en niet alleen `deleted_at` gezet is.
- [ ] Een antwoord op een verwijderd bericht laat "origineel niet meer
      beschikbaar" zien in plaats van een lege preview.
- [ ] Een antwoord op een bericht uit een ander kanaal is niet te maken via de
      UI; via een REST-call wél, en dat is bekend — zie "Bekende gaten".

### `channels` (`position`, `description`, hernoemen, verwijderen)

- [ ] Een admin hernoemt een kanaal, zet een omschrijving en versleept de
      volgorde. Een gewoon lid ziet de wijziging maar kan hem niet maken.
- [ ] Een gewoon lid probeert via een REST-call `position` te wijzigen. Moet
      een 403 geven.
- [ ] **De val:** een admin probeert `server_id` van een kanaal te veranderen
      naar een andere server, of naar `null`. Moet een 403 geven — anders
      duikt het kanaal op in de gesprekkenlijst van alle leden.
- [ ] Een groepslid hernoemt de groep. Moet lukken (geen rollen in een groep).
- [ ] Een groepslid probeert de groep te *verwijderen*. Moet falen, tenzij hij
      de maker is.

### `servers` (`icon_url`, wijzigen, verwijderen)

- [ ] Een admin wijzigt naam en icoon. Lukt.
- [ ] **De val:** een admin probeert via een REST-call `owner_id` op zichzelf
      te zetten. Moet falen op de trigger `servers_guard_owner_id`, met de
      Nederlandse foutmelding.
- [ ] De eigenaar draagt eigendom over aan B. Lukt. Daarna kan A het niet meer
      terugdraaien.
- [ ] Een admin probeert de server te verwijderen. Moet falen. De eigenaar kan
      het wel.

### `server_members` (rollen, vertrekken, verwijderen)

- [ ] De eigenaar maakt B admin. B kan daarna een kanaal aanmaken.
- [ ] B (admin) probeert zichzelf owner te maken. Moet een 403 geven.
- [ ] **De val:** de eigenaar probeert zichzelf te verwijderen of naar
      `member` te zetten terwijl hij de enige eigenaar is. Moet falen op de
      trigger `server_members_guard_last_owner`.
- [ ] De eigenaar verwijdert B uit de server. Controleer dat B daarna ook uit
      `channel_members` van álle kanalen van die server weg is — dit test de
      extra policy "eigenaar verwijdert kanaallidmaatschap".
- [ ] B verlaat zelf een server. Zelfde controle op `channel_members`.
- [ ] B ontvangt na vertrek geen realtime berichten meer uit die kanalen.

### `server_invites`

- [ ] **De belangrijkste test van deze hele migratie:** B (ingelogd, geen lid
      van de server) doet `GET /rest/v1/server_invites?select=*`. Moet **leeg**
      terugkomen. Zou dit codes teruggeven, dan is elke server van iedereen.
- [ ] A (admin) maakt een invite met `max_uses = 1`. B wisselt hem in via
      `redeem_server_invite` en komt in de server plus in alle kanalen.
- [ ] B klikt de link nog een keer. Geen fout voor de gebruiker, en `uses`
      blijft 1 — een dubbele tap mag een invite van één gebruik niet opmaken.
- [ ] Een derde account probeert dezelfde code. Moet "al opgebruikt" geven.
- [ ] Een invite met `expires_at` in het verleden geeft "verlopen".
- [ ] Een verzonnen code geeft "bestaat niet" en geen 500.
- [ ] Een gewoon lid (geen admin) probeert een invite aan te maken. Moet een
      403 geven.

### `profiles` (weergavenaam, avatar, bijwerken)

- [ ] **Eerst:** staat er precies EEN update-policy op `profiles`? Staan er
      twee, dan doet het slot op de publieke sleutel niets.

      `select policyname, cmd, qual, with_check from pg_policies where tablename = 'profiles';`

- [ ] A zet een weergavenaam en avatar. B ziet ze.
- [ ] A heeft een weergavenaam en zet die weer leeg. Moet lukken (de client
      stuurt `null`, niet een lege string).
- [ ] **De belangrijkste:** A probeert via een REST-call zijn eigen
      `public_key` of `key_fingerprint` te wijzigen. Moet een 403 geven op
      `profile_key_unchanged`. Dit is het slot dat sleutelverificatie zinvol
      houdt.
- [ ] A probeert het profiel van B te wijzigen. Moet een 403 geven.
- [ ] Een lege weergavenaam wordt geweigerd door
      `profiles_display_name_not_blank` (de client stuurt `null`, geen lege
      string).

### Storage: `avatars`

- [ ] A uploadt een avatar naar `<eigen-uid>/avatar.png`. Lukt.
- [ ] A probeert te uploaden naar `<uid-van-B>/avatar.png`. Moet een 403 geven.
- [ ] Een uitgelogde bezoeker kan de avatar-URL van A opvragen. Moet lukken —
      de bucket is publiek en dat is de bedoeling.
- [ ] Een bestand van 3 MB wordt geweigerd (limiet 2 MB).
- [ ] Een tekstbestand wordt geweigerd (alleen image-mimetypes).

### Storage: `attachments`

- [ ] A stuurt een bijlage in een kanaal met B erin. B kan hem downloaden en
      ontsleutelen.
- [ ] **De belangrijkste:** C (ingelogd, geen lid van dat kanaal) probeert het
      pad rechtstreeks te downloaden. Moet een 403 geven. Dit test
      `attachment_channel_id` plus `is_channel_member`.
- [ ] Een upload naar een pad dat géén kanaal-uuid als eerste map heeft
      (bijvoorbeeld `hallo/x.pgp`) geeft een nette 403 en geen 500. Dit is
      waarom `attachment_channel_id` eerst met een regex controleert voordat
      hij cast.
- [ ] Een upload met mimetype `image/png` wordt geweigerd. Alleen
      `application/octet-stream` mag erin — dat is het vangnet tegen een
      plaintext-upload.
- [ ] B probeert de bijlage van A te verwijderen. Moet falen (`owner`-check).

---

## Bekende gaten, bewust niet dichtgezet

- **`reply_to_id` wordt niet gecontroleerd tegen `channel_id`.** Via de UI kan
  het niet, maar een REST-call kan een antwoord in kanaal X laten verwijzen
  naar een bericht in kanaal Y. Het lekt niets — de verwijzing is alleen een
  id, en de preview wordt pas gerenderd als de lezer het originele bericht
  zelf mag ophalen, wat RLS afdwingt. Netjes zou een constraint-trigger zijn
  die beide `channel_id`'s vergelijkt. Genoteerd, niet gebouwd.
- **Een verweesde bijlage blijft in Storage staan** als het bericht verwijderd
  wordt maar de `remove()`-call faalt. Versleuteld, dus geen leak, maar wel
  ruimte die niemand opruimt. Een periodieke opruimtaak zou dit oplossen; die
  is er niet.
- **De update-policy op `messages` staat per rij, niet per kolom.** De afzender
  kan dus in principe `created_at` van zijn eigen bericht aanpassen. RLS kan
  geen kolommen afbakenen; alleen een trigger kan dat. Voor nu is de
  PGP-handtekening wat authorschap bewijst, en die overleeft geen gerommel met
  de inhoud.
- **`channel_id` wordt niet op zijn oude waarde vastgezet.** De `with check`
  eist wel dat je lid bent van het doelkanaal, dus een bericht kan niet in een
  kanaal belanden waar de afzender niet in zit. Maar verplaatsen tussen twee
  kanalen waar hij beide in zit, kan via een REST-call. Een `with check` kan
  niet naar de vorige waarde van een rij kijken, dus dit dichtzetten vraagt een
  trigger. Genoteerd, niet gebouwd: geen scherm doet het, en een extra trigger
  was niet gevraagd.
- **Van `storage.objects` is de bestaande policy-lijst onbekend.** Zie de
  controlequery in de inleiding hierboven.
