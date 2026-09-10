# Deployen van Vault

Vault is een pure client-app. De enige backend is Supabase; op Vercel draait
alleen een statische build. Er zijn geen serverless functions of API-routes, en
die moeten er ook niet komen — alles wat de server zou kunnen zien is per
ontwerp ciphertext.

Vercel-project: **vault** (persoonlijk account, Hobby-plan).

---

## 1. Environment variables

Twee variabelen, allebei nodig:

| Variabele | Waar te vinden |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase → Project Settings → Data API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase → Project Settings → API Keys → anon / publishable |

Zet ze in het Vercel-dashboard onder **Settings → Environment Variables**, en
vink alle drie de omgevingen aan: **Production, Preview én Development**.
Vercel leest je lokale `.env` niet. Ontbreekt er één, dan stopt de app direct
bij het opstarten met "Supabase-configuratie ontbreekt".

Lokaal draaien doe je met een eigen `.env` in de root, zie `.env.example`.

### De anon key is publiek

Vite bakt elke `VITE_`-variabele letterlijk in de JavaScript-bundel. De anon key
is dus voor iedereen leesbaar die de app opent. **Dat hoort zo.** De beveiliging
zit in RLS op de database: zonder geldige sessie geeft die key nergens toegang
toe. Ga hem niet verstoppen achter een proxy of een edge function — dat kost
werk, breekt de app en maakt niets veiliger.

### Nooit de service_role key

De `service_role` key omzeilt RLS volledig. Die hoort in geen enkele omgeving
van dit project, ook niet in Preview, ook niet tijdelijk om iets te debuggen.
Komt hij ooit in een `VITE_`-variabele terecht, dan staat hij in de bundel en
kan iedereen alle rijen van alle gebruikers lezen en schrijven.

---

## 2. Supabase-instellingen die je met de hand moet doen

In Supabase → **Authentication → URL Configuration**:

- **Site URL**: de productie-URL van Vercel, bijvoorbeeld
  `https://vault.vercel.app`.
- **Redirect URLs**: hier moeten alle URL's in staan waar auth vandaan mag
  komen. Voeg minimaal toe:
  - `http://localhost:5173/**` (lokale dev)
  - je productie-URL
  - een wildcard voor previews, zie de waarschuwing hieronder

Verder:

- **E-mailbevestiging staat uit.** Dat is een bewuste keuze: `signUp()` geeft
  meteen een sessie terug, waarna de client het keypair genereert en het profiel
  aanmaakt. Zet je bevestiging aan, dan is er na signup geen sessie en breekt
  die hele flow.
- **Realtime staat goed en hoeft niet met de hand aangepast** (nagekeken
  10-09-2026). De publicatie `supabase_realtime` bevat `messages` en
  `channel_members`, met `pubinsert`, `pubupdate` én `pubdelete` alle drie op
  true. Bewerken en verwijderen van een bericht komen als UPDATE binnen en
  worden dus doorgegeven; daar is geen handmatige stap voor nodig.
  `message_reactions` zit er nog niet in en wordt door migratie
  `20260910110100` zelf aan de publicatie toegevoegd.

  Wat je wel moet weten als je hier later aan sleutelt: **replica identity
  staat op default**, dus op de primary key. Bij een UPDATE komt de volledige
  nieuwe rij mee, dus het filter `channel_id=eq.<id>` werkt ook voor UPDATE.
  Bij een echte DELETE komt alleen de primary key mee, en dan matcht dat filter
  nooit. Voor `messages` maakt dat niets uit, want verwijderen is hier een
  UPDATE (`deleted_at` + lege ciphertext) en geen DELETE. Voor
  `message_reactions` werkt DELETE juist wél, omdat de primary key daar
  `(message_id, user_id, emoji)` is — precies de velden die de client nodig
  heeft. `REPLICA IDENTITY FULL` is nergens nodig en zou bij elke bewerking de
  vorige ciphertext nog een keer over de socket sturen.
- Er is geen database-trigger die `profiles` vult, en die moet er ook niet
  komen: de public key bestaat alleen in de browser, dus alleen de client kan
  die rij correct aanmaken.

### Storage-buckets

Twee buckets, met tegengestelde regels. Migratie
`20260910110800_storage_avatars_attachments.sql` maakt ze aan en zet de
policies; dit is wat je in het dashboard terug hoort te zien.

| Bucket | Publiek | Limiet | Mimetypes |
| --- | --- | --- | --- |
| `avatars` | **ja** | 2 MB | `image/png`, `image/jpeg`, `image/webp`, `image/gif` |
| `attachments` | **nee** | 12 MB | alleen `application/octet-stream` |

- `avatars` is met opzet publiek. Een avatar moet laden voor iedereen die je
  naam ziet, dus er is geen sleutel om hem mee te versleutelen. De UI zegt dat
  ook waar je er een uploadt.
- `attachments` bevat **uitsluitend ciphertext**. Het bestand wordt in de
  browser versleuteld en pas daarna geüpload. Dat de bucket alleen
  `application/octet-stream` aanneemt is een vangnet: zou er ooit per ongeluk
  een plaintext `image/png` of `application/pdf` heen gestuurd worden, dan
  weigert Storage het bestand in plaats van het stil te bewaren. Verruim die
  lijst dus niet.
- De 12 MB op `attachments` is ruimer dan de 10 MB die de client toestaat. Dat
  verschil is marge voor de PGP-framing eromheen.

### Waarschuwing: preview-deploys hebben een eigen URL

Elke push naar een branch geeft een preview-deploy op een unieke URL
(`vault-<hash>-<account>.vercel.app`). Staat die URL niet in de Supabase
redirect-allowlist, dan werkt inloggen op die preview niet — je krijgt een
redirect-fout of komt terug op een lege sessie.

Twee opties:

1. Zet een wildcard in Redirect URLs, bijvoorbeeld
   `https://vault-*-<jouw-account>.vercel.app/**`. Handig, maar het vertrouwt
   elke preview-URL van dit account.
2. Voeg per keer de concrete preview-URL toe. Veiliger, meer werk.

Voor twee developers is optie 1 werkbaar. Weet wel wat je aanzet.

---

## 3. Een preview-deploy testen

```bash
git checkout -b mijn-feature
git push -u origin mijn-feature
```

Vercel bouwt automatisch en zet de preview-URL in de PR. Daarna:

1. Controleer of die URL in de Supabase redirect-allowlist staat.
2. Maak een testaccount aan. Let op: dat account komt in **dezelfde** database
   als productie — er is maar één Supabase-project. Gebruik herkenbare
   gebruikersnamen zoals `test-benjamin`.
3. Test de drie auth-toestanden: signup, refresh (je hoort op het
   unlock-scherm te komen, niet op login), en uitloggen.
4. Test een DM tussen twee accounts in twee verschillende browsers. Twee
   tabbladen in dezelfde browser delen IndexedDB niet per profiel, dus gebruik
   een incognitovenster of een tweede browser.

Lokaal een productiebuild bekijken:

```bash
npm run build
npm run preview
```

---

## 4. Build

Het build-script draait eerst de typecheck en de tests:

```
"build": "npm run typecheck && vitest run && vite build"
```

Een kapotte typecheck of een gevallen test breekt de deploy. Dat is de
bedoeling: liever geen deploy dan een deploy waarin de cryptolaag stuk is.

De testsuite draait in twee vitest-projecten (`crypto` op node, `ui` op jsdom)
en heeft geen browser, netwerk of Supabase-verbinding nodig — alle
Supabase-calls zijn in de tests gemockt. Er is dus niets dat op Vercel anders
zou moeten werken dan lokaal.

### Controlepunt bij elke deploy: klopt de grootte van de entry-chunk?

**Een groene build is geen bewijs dat de app werkt.** Ontbreken de
`VITE_`-variabelen op Vercel, dan slaagt de build gewoon en levert hij een dode
app op — zonder waarschuwing, zonder foutmelding in de log.

Dat komt zo. `src/lib/supabase/client.ts` gooit bij het laden van de module als
`VITE_SUPABASE_URL` of `VITE_SUPABASE_ANON_KEY` ontbreekt. Vite vult die
variabelen tijdens de build letterlijk in, dus zonder waarden wordt het
`if (!undefined || !undefined) throw`. De bundler ziet dan een module die altijd
gooit, gooit alles erachter weg als dode code, en schudt zo de complete
Supabase-client uit de bundel. Resultaat: exit 0, en een app die bij het openen
meteen stukloopt.

Het verschil is aan één getal te zien in de build-log:

| entry-chunk | betekenis |
| --- | --- |
| **~586 kB** | goed — de Supabase-client zit erin |
| **~186 kB** | fout — env-vars ontbraken, de client is eruit geschud |

Kijk dus na elke deploy naar de regel `dist/assets/index-*.js` in de build-log.
Zit die rond de 186 kB, ga dan niet in de code zoeken: de variabelen staan niet
(of niet voor alle drie de omgevingen) in **Settings → Environment Variables**.
Zie sectie 1.

Hetzelfde is aan de gedeployde site te zien: haal `/assets/index-*.js` op en
zoek er een tabelnaam in, bijvoorbeeld `message_reactions`. Tabelnamen zijn
stringliteralen en worden niet geminificeerd, dus staan ze er niet in, dan
draait er iets anders dan je denkt.

### Bundelgroottes

OpenPGP.js is met afstand het grootste onderdeel en wordt daarom apart geladen:
pas bij de eerste keygen, unlock, encrypt of decrypt. Het inlogscherm downloadt
hem niet.

| Bestand | Rauw | Gzip |
| --- | --- | --- |
| `index.js` (entry) | 585.50 kB | 166.78 kB |
| `openpgp.min.js` (lazy) | 387.50 kB | 129.38 kB |
| `index.css` | 36.23 kB | 8.33 kB |
| highlight.js (15 lazy chunks) | ~74 kB | ~28 kB |
| Inter + JetBrains Mono (woff2) | — | ~100 kB aan losse assets |

De entry-chunk is grotendeels React plus de Supabase-client met realtime. Wil je
daar later nog vanaf, dan is de realtime-client de volgende kandidaat om lui te
laden.

Twee dingen die bewust **niet** in de entry zitten:

- **OpenPGP.js**, pas geladen bij de eerste keygen, unlock, encrypt of decrypt.
- **highlight.js**, pas geladen bij het eerste codeblok in een bericht. De core
  plus veertien talen staan in aparte chunks; het inlogscherm haalt er geen
  enkele op.

De fonts zijn losse woff2-bestanden met een `unicode-range`, dus een browser
haalt alleen de subset op die hij nodig heeft (in de praktijk latin: ~48 kB voor
Inter, ~21 kB per gewicht voor JetBrains Mono). Geen Google Fonts CDN, zie
sectie 5.

---

## 5. Wat we bewust niet doen

**Geen externe fonts.** Inter en JetBrains Mono komen uit `@fontsource`,
gebundeld door Vite. Een privacy-app die bij elke paginalading het IP-adres van
de lezer naar een CDN van Google stuurt, is een privacy-app die niet oplet.

**Geen Vercel Analytics of Speed Insights.** Beide injecteren een script op elke
pagina. In Vault staat de ontsleutelde plaintext van berichten in het DOM; een
third-party script daar bijzetten ondermijnt precies datgene waarvoor deze app
bestaat. Ook niet "tijdelijk voor de launch".

**Geen server-side routes of API-functies.** Vault praat alleen met Supabase.
Elke serverfunctie is een plek waar per ongeluk plaintext of een sleutel langs
kan komen.

**Nog geen Content-Security-Policy.** Die staat bewust niet in `vercel.json`.
OpenPGP en Vite stellen in dev andere eisen dan in productie, en een
half-kloppende CSP breekt de crypto stilletjes — je merkt het pas als een
bericht niet meer ontsleutelt. Dit is een aparte taak: eerst opstellen, dan in
report-only draaien, en pas daarna afdwingen.

**Geen `X-Frame-Options` weglaten.** Die staat op `DENY` in `vercel.json`. Kan
iemand Vault in een iframe laden, dan kan hij clickjacking uitvoeren op het
unlock-scherm en de gebruiker zijn wachtwoord laten invoeren in een venster dat
hij niet ziet.
