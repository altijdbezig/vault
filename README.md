# Vault

Een chatapp waarvan de server niets kan lezen.

Discord-structuur, Telegram-snelheid, PGP eronder. Servers, kanalen, groepen en
DM's — maar elk bericht wordt in je browser versleuteld voordat het vertrekt, en
pas in de browser van de ontvanger weer leesbaar. Wat er in de database staat is
ciphertext. Voor iedereen. Ook voor ons.

---

## Het idee

De meeste chatapps beloven privacy en bewaren ondertussen alles leesbaar op een
server. Vault draait dat om: de server is dom met opzet. Hij weet wie lid is van
welk kanaal en wanneer er iets gestuurd is, maar niet wát.

Dat is geen instelling die je aan kunt zetten. Het is de enige manier waarop de
app werkt.

### Hoe het werkt

Bij het aanmaken van een account genereert je browser een PGP-sleutelpaar
(Ed25519/X25519).

- De **publieke sleutel** gaat naar de server. Anderen hebben hem nodig om jou
  iets te kunnen sturen.
- De **privésleutel** blijft in je browser, versleuteld met je wachtwoord,
  opgeslagen in IndexedDB. Hij verlaat je apparaat nooit.

Bij het versturen haalt de app de publieke sleutels van alle kanaalleden op en
versleutelt het bericht voor allemaal tegelijk. OpenPGP regelt de hybride
encryptie: één versleutelde sessiesleutel per ontvanger, één keer de inhoud.

Elk bericht wordt ook ondertekend. `sender_id` in de database zegt alleen wie de
rij heeft ingevoegd — de handtekening is het enige echte bewijs van wie het
geschreven heeft.

---

## Wat dit kost

Echte end-to-end encryptie heeft consequenties. Dit zijn ze, en ze zijn bewust:

| | |
|---|---|
| **Wachtwoord kwijt** | Berichten kwijt. Er is geen reset, want je wachtwoord ontsleutelt je sleutel. Niemand kan dat overrulen. |
| **Nieuw apparaat** | Je moet je sleutel exporteren en meenemen. Daarom staat de exportknop meteen in beeld, niet weggestopt. |
| **Later toegevoegd aan een kanaal** | Oudere berichten blijven onleesbaar. Ze zijn nooit voor jou versleuteld geweest. |
| **Zoeken** | Alleen in wat je al geladen en ontsleuteld hebt. De server kan niet meezoeken. |
| **Notificaties** | Wel "nieuw bericht in #algemeen", nooit de tekst. |

Alles wat de server zou kunnen lezen, kan de server niet.

---

## Functies

**Gesprekken**
DM's, groepen en serverkanalen — allemaal hetzelfde onderliggende model, dus
overal dezelfde encryptie en dezelfde snelheid.

**Servers**
Kanalen, rollen (owner/admin/member), uitnodigingslinks, ledenlijst met
fingerprints.

**Realtime**
Berichten komen binnen zonder refresh. Ongelezen-tellers, online-status,
typen-indicator.

**Verificatie**
Elke gebruiker heeft een fingerprint in blokjes van vier. Vergelijk hem buiten
Vault om — via een gesprek, een telefoontje — en je weet zeker met wie je praat.
Verandert een fingerprint van iemand die je eerder verifieerde, dan krijg je een
waarschuwing. Dat is het belangrijkste beveiligingssignaal in de app.

**Mobiel**
Volledig responsive. Werkt op een telefoon zoals je verwacht.

---

## Stack

| Onderdeel | Keuze |
|---|---|
| Frontend | React 18 + TypeScript, strict mode |
| Build | Vite |
| Styling | Tailwind CSS v4 |
| Crypto | OpenPGP.js v6, lazy geladen |
| Backend | Supabase — Postgres, auth, realtime, storage |
| Hosting | Vercel |
| Tests | Vitest |

Geen server-side code. Geen API-routes. Geen analytics, trackers of externe
fonts. De enige backend is Supabase, en die ziet alleen ciphertext.

---

## Aan de slag

Je hebt Node 20+ nodig en een eigen Supabase-project.

```bash
git clone <repo>
cd vault
npm install
```

Maak een `.env` op basis van `.env.example`:

```
VITE_SUPABASE_URL=https://<jouw-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<jouw publishable key>
```

> De publishable key hoort publiek te zijn. Hij komt sowieso in de
> JavaScript-bundel terecht. De beveiliging zit volledig in Row Level Security,
> niet in het geheimhouden van deze sleutel. Voeg nooit een `service_role` key
> toe aan een `VITE_`-variabele — die omzeilt RLS.

Draai de migraties uit `supabase/migrations/` in volgorde, via de Supabase CLI
of de SQL Editor.

Zet in Supabase onder **Authentication → Providers → Email** de
e-mailbevestiging uit voor lokale ontwikkeling. Zonder sessie direct na signup
wordt de `profiles`-insert door RLS geweigerd.

```bash
npm run dev        # dev-server op :5173
npm run typecheck  # tsc --noEmit, strict
npm run ci         # alle tests
npm run build      # typecheck + tests + productiebuild
```

---

## Structuur

```
src/
  lib/
    crypto/      sleutelbeheer, encryptie, IndexedDB-opslag
    supabase/    alle databasecalls, nergens anders
  hooks/         auth, kanalen, berichten, presence
  components/
  pages/
  types/
supabase/
  migrations/    het volledige schema, in volgorde
```

Twee conventies die je niet moet breken:

1. **Crypto zit alleen in `lib/crypto/`.** Nooit een OpenPGP-aanroep in een
   component.
2. **Supabase-calls zitten alleen in `lib/supabase/`.** Componenten praten via
   hooks.

---

## Beveiliging

RLS staat aan op elke tabel. Je ziet alleen kanalen waar je lid van bent,
alleen berichten uit die kanalen, en alleen servers waar je bij hoort. Dat is
niet alleen zo bedoeld — het is per policy getest met accounts die er níet bij
horen.

De privésleutel staat nergens buiten je browser. Er is geen herstelmechanisme,
geen key-escrow en geen admin die kan meelezen. Dat is geen functie die nog moet
komen; het is een ontwerpbeslissing die niet terugdraaibaar is zonder de hele
belofte te breken.

Een lek gevonden? Open een issue zonder details en we nemen contact op.

---

## Roadmap

- [x] Sleutelgeneratie, export en import
- [x] DM's met end-to-end encryptie
- [x] Servers, kanalen en rollen
- [x] Groepen, ongelezen-tellers, presence
- [x] Mobiele layout
- [ ] Markdown, reacties en antwoorden
- [ ] Versleutelde bijlagen
- [ ] Sleutelverificatie met vertrouwde contacten
- [ ] Wachtwoord wijzigen met her-encryptie van de sleutel
- [ ] Meerdere apparaten zonder handmatige export

---

## Gemaakt door

Benjamin van Hemert en Jayden Simons.
