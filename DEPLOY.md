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
- **Realtime** moet aanstaan op `messages` en `channel_members`.
- Er is geen database-trigger die `profiles` vult, en die moet er ook niet
  komen: de public key bestaat alleen in de browser, dus alleen de client kan
  die rij correct aanmaken.

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

### Bundelgroottes

OpenPGP.js is met afstand het grootste onderdeel en wordt daarom apart geladen:
pas bij de eerste keygen, unlock, encrypt of decrypt. Het inlogscherm downloadt
hem niet.

| Bestand | Rauw | Gzip |
| --- | --- | --- |
| `index.js` (entry) | 389.57 kB | 111.22 kB |
| `openpgp.min.js` (lazy) | 387.50 kB | 129.38 kB |
| `index.css` | 15.63 kB | 4.02 kB |

De entry-chunk is grotendeels React plus de Supabase-client met realtime. Wil je
daar later nog vanaf, dan is de realtime-client de volgende kandidaat om lui te
laden.

---

## 5. Wat we bewust niet doen

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
