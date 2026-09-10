# Migraties van de upgrade, en wat er live getest moet worden

Deze migraties zijn **blind geschreven**. Het Supabase-project van Vault stond
niet op het account waar ik bij kon, dus ik heb het schema niet kunnen
uitlezen. Gevolgen voor hoe ze geschreven zijn:

- Kolommen komen erbij met `add column if not exists`, ook de kolommen waarvan
  jij zei dat ze al bestaan (`edited_at`, `display_name`, `avatar_url`). Draait
  dus ook als ze er al zijn.
- Policies worden **alleen toegevoegd**, nooit een bestaande gedropt waarvan ik
  de naam niet ken. Permissive policies worden met OR gecombineerd, dus dit kan
  alleen rechten toevoegen. `drop policy if exists` staat er alleen op de
  namen die ik zelf introduceer, voor idempotentie.
- Wat een policy niet kan (naar de vorige waarde van een rij kijken) staat in
  een trigger.

Draai ze in bestandsvolgorde. Ze zijn los van elkaar herhaalbaar, dus twee keer
draaien kan geen kwaad.

`supabase/migrations/ALLES-IN-EEN.sql` is precies deze negen bestanden achter
elkaar geplakt, voor als je alles in een keer in de SQL-editor wilt draaien. De
losse bestanden blijven de bron; dat bestand is alleen een gemak.

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

- [ ] A bewerkt zijn eigen bericht. B ziet de nieuwe tekst en "(bewerkt)"
      zonder te herladen (dit is een UPDATE over realtime — controleer in het
      dashboard dat Realtime op `messages` ook UPDATE doorgeeft, niet alleen
      INSERT).
- [ ] B probeert een bericht van A te bewerken. Moet een 403 geven.
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

- [ ] A zet een weergavenaam en avatar. B ziet ze.
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
  kan dus in principe `created_at` of `channel_id` van zijn eigen bericht
  aanpassen. RLS kan geen kolommen afbakenen; alleen een trigger kan dat. Voor
  nu is de PGP-handtekening wat authorschap bewijst, en die overleeft geen
  gerommel met de inhoud.
