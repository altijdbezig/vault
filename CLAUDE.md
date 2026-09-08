# Vault

End-to-end versleutelde chatapp.

Vault combineert de structuur van Discord (servers, kanalen, rollen) met de
snelheid en UX van Telegram, en gebruikt PGP als echte end-to-end-encryptielaag.

**Team:** Benjamin van Hemert en Jayden. Twee developers die parallel werken.

**Doel:** een werkende web-MVP. Native volgt later, dus er mag geen web-only
lock-in in de businesslogica zitten.

---

## Stack

| Onderdeel | Keuze |
| --- | --- |
| Frontend | React 18 + TypeScript + Vite |
| Styling | TailwindCSS |
| Backend | Supabase (auth, Postgres, realtime) |
| Crypto | OpenPGP.js — voor alle crypto |

Bewuste beperkingen:

- **Geen state-library** (Redux/Zustand) tot het aantoonbaar nodig is.
- **Geen UI-component-library.** We bouwen componenten zelf.

---

## Architectuur

### Eén abstractie voor alles: de tabel `channels`

Dit is de belangrijkste ontwerpregel van het project.

| `type` | `server_id` | Leden |
| --- | --- | --- |
| `'dm'` | `null` | exact 2 leden |
| `'group'` | `null` | 3+ leden |
| `'text'` | gevuld | hoort bij een server |

DM's, groepen en serverkanalen delen dus **dezelfde code, dezelfde queries en
dezelfde UI**.

> Bouw ze **NOOIT** als losse features.

### Database

Tabellen:

- `profiles`
- `servers`
- `server_members`
- `channels`
- `channel_members`
- `messages`

RLS staat op **alle** tabellen aan.

Membership-checks lopen via de `SECURITY DEFINER` functies:

- `is_channel_member(uuid)`
- `is_server_member(uuid)`

Nooit via een directe subquery op dezelfde tabel — dat geeft oneindige recursie
in policies.

Realtime staat aan op `messages` en `channel_members`.

---

## Crypto-model

Dit zijn de hardste regels van het project.

1. **De private key verlaat NOOIT de browser.** Niet loggen, niet naar Supabase
   sturen, niet in state stoppen die ergens gepersisteerd wordt.
2. Het **keypair wordt in de client gegenereerd bij signup**. De public key gaat
   naar `profiles.public_key` (armored) plus `profiles.key_fingerprint`.
3. De **private key wordt versleuteld met de passphrase** van de gebruiker en
   opgeslagen in **IndexedDB**. Niet in localStorage.
4. Berichten worden versleuteld met `openpgp.encrypt()`, waarbij
   `encryptionKeys` de public keys van **alle huidige kanaalleden** bevat.
   OpenPGP regelt de hybride encryptie zelf — bouw geen eigen AES-laag eromheen.
5. De server slaat **uitsluitend ciphertext** op, in `messages.ciphertext`.

### Bewuste gevolgen

Niet oplossen, wel duidelijk communiceren in de UI:

- **Nieuwe leden kunnen oudere berichten niet lezen.** Dat is correct gedrag.
- **Passphrase kwijt betekent berichten definitief kwijt.** Geen reset mogelijk.
- **Serverside search is onmogelijk.** Alleen client-side zoeken in al
  ontsleutelde berichten.

---

## Bouwvolgorde

Ga niet aan een fase beginnen voordat de vorige werkt.

**Fase 1 — Auth en keys**
Supabase auth, signup met PGP keygen, public key naar `profiles`, encrypted
private key naar IndexedDB, login die de key ontgrendelt.

**Fase 2 — Eén werkende DM tussen twee accounts**
Versturen, opslaan, realtime ontvangen, ontsleutelen, weergeven.
Dit is het risicopunt van het hele project.

**Fase 3 — Servers en kanalen**
Erbovenop gebouwd. Hergebruikt vrijwel alle code uit fase 2.

**Fase 4 — Rest**
Groepen, unread counts, presence, key-export.

---

## Taakverdeling

| Persoon | Verantwoordelijkheid |
| --- | --- |
| Persoon A | **Cryptolaag** — keygen, encrypt/decrypt, IndexedDB key storage |
| Persoon B | **Datalaag** — Supabase queries, realtime subscriptions, RLS testen |

Het raakvlak is alleen de `messages`-tabel. UI doen we daarna samen.

---

## Bestandsstructuur

```
src/
  lib/
    crypto/     keys.ts, encrypt.ts, storage.ts
    supabase/   client.ts, channels.ts, messages.ts, profiles.ts
  hooks/
  components/
  pages/
  types/
```

---

## Conventies

- TypeScript **strict mode** aan. Geen `any`.
- Alle Supabase-calls in `lib/supabase/`, nooit direct in componenten.
- Alle crypto in `lib/crypto/`, nooit direct in componenten.
- Commit messages in het **Engels**.
- Code en comments in het **Engels**.
- Documentatie en CLAUDE.md in het **Nederlands**.
- Secrets via `.env`, met een `.env.example` in de repo.

---

## Wat niet te doen

- **Geen plaintext berichten opslaan** — ook niet tijdelijk of voor debugging.
- **Geen key-escrow, backdoor of "admin kan meelezen"-functionaliteit.**
- **Geen features toevoegen die niet in de bouwvolgorde staan.**
