# Vault

End-to-end versleutelde chatapp. De structuur van Discord (servers, kanalen,
rollen), de snelheid en UX van Telegram, en PGP als echte
end-to-end-encryptielaag.

React 18 + TypeScript + Vite, TailwindCSS, Supabase voor auth/database/realtime,
OpenPGP.js voor alle crypto.

- `CLAUDE.md` — de ontwerpregels en de bouwvolgorde. Begin daar.
- `DEPLOY.md` — deployen, environment variables, Supabase-instellingen.
- `docs/migraties-en-rls-tests.md` — schemawijzigingen en wat er per tabel live
  getest moet worden.
- `docs/wachtwoord-wijzigen-plan.md` — waarom wachtwoord wijzigen nog niet
  bestaat en wat het vraagt.

## Aan de praat krijgen

```bash
npm install
cp .env.example .env   # vul je eigen Supabase-project in
npm run dev
```

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest, watch
npm run ci          # vitest run
npm run build       # typecheck + tests + vite build
```

---

## Wat dit kost

Vault is opgezet zodat de server je berichten niet kan lezen. Dat is geen
instelling die aan of uit kan: het is de vorm van het hele systeem. Er hangt
een prijs aan, en die is echt. Lees dit voordat je hem in gebruik neemt.

### Je wachtwoord kwijt is je berichten kwijt

Je wachtwoord is twee dingen tegelijk: het wachtwoord van je account, en de
passphrase waarmee je privésleutel versleuteld op je apparaat staat. Supabase
kent alleen de hash van het eerste. De passphrase zelf verlaat je browser
nooit.

Gevolg: **er is geen wachtwoordherstel en er kan geen wachtwoordherstel
komen.** Niet omdat het niet gebouwd is, maar omdat er niets is om mee te
herstellen. Een noodluik voor ons zou ook een noodluik voor iemand anders zijn.

Wat je wel kunt doen: exporteer je sleutel (Instellingen → Sleutel) en bewaar
dat bestand ergens waar je erbij kunt en niemand anders. Met dat bestand plus
je wachtwoord kom je op elk apparaat weer bij je berichten. Zonder een van de
twee niet.

### Je publieke sleutel staat vast — sleutel kwijt is een nieuw account

De database weigert een wijziging van `profiles.public_key` en
`profiles.key_fingerprint`. Dat is een RLS-policy plus de functie
`profile_key_unchanged`; zie migratie `20260910110700`.

Dat is er met opzet, en het is de reden dat sleutelverificatie iets betekent.
Zonder dat slot kan iemand zijn publieke sleutel verwisselen, versleutelt
iedereen vanaf dat moment stil naar de nieuwe sleutel, en merkt niemand het.
Precies de aanval waarvoor je vingerafdrukken vergelijkt.

Maar het betekent ook dit, en dit is de kant die je moet kennen:

> **Ben je je privésleutel kwijt — geen back-upbestand, geen apparaat waar hij
> nog op staat — dan is dat account definitief onbruikbaar.** Je kunt geen
> nieuwe sleutel op je bestaande account zetten. Je maakt een nieuw account,
> met een nieuwe gebruikersnaam, en begint met een leeg gesprek. Je oude
> berichten blijven versleuteld op de server staan en niemand kan ze nog
> openen, jij ook niet.

**Ook met volledige databasetoegang is dit niet te repareren.** Je kunt de rij
met de hand aanpassen, maar dat helpt niet: er is geen privésleutel meer die bij
welke publieke sleutel dan ook hoort. Een nieuwe publieke sleutel plaatsen maakt
de oude berichten niet leesbaar — die zijn versleuteld voor de oude sleutel — en
het maakt de vingerafdrukwaarschuwing bij al je contacten stil, wat het enige
signaal is dat een echte aanval kan betrappen.

Er is dus geen herstelpad. Dat is een keuze, niet een tekortkoming.

Sleutelrotatie is een echte feature met een eigen ontwerp (oude berichten
blijven aan de oude sleutel hangen, iedereen moet opnieuw verifiëren, de
waarschuwing moet afgaan en dan bewust gedoofd worden). Die is er nog niet, en
tot die er is staat dit op slot.

### Nieuwe leden kunnen oudere berichten niet lezen

Een bericht wordt versleuteld voor de leden van dat moment. Wie later
binnenkomt, was er niet bij en kan het niet openen. Dat is correct gedrag, geen
bug, en het is niet achteraf te veranderen zonder de berichten opnieuw te
versleutelen — wat betekent dat iemand ze eerst zou moeten kunnen lezen.

### Zoeken werkt alleen in wat je al hebt

De server heeft alleen ciphertext, dus er is geen zoekindex en die kan er niet
komen. Zoeken gaat door de berichten die in dit tabblad al ontsleuteld zijn. De
zoekbalk zegt hoeveel dat er zijn en biedt de knop om meer geschiedenis te
laden.

### Wat de server wél weet

Niet: de inhoud van je berichten, je bestandsnamen, je privésleutel. Wel: wie
in welk kanaal zit, wanneer er berichten langskomen en hoe groot ze zijn, en
welke emoji je onder een bericht zet. Dat is metadata die nodig is om berichten
af te leveren. Avatars en servericonen staan onversleuteld in een publieke map,
omdat ze moeten laden voor iedereen die je naam ziet.

Instellingen → Privacy zegt hetzelfde in de app zelf.
