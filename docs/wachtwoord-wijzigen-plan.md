# Plan: wachtwoord wijzigen

Status: **plan, geen code.** De TODO in `useAuth.tsx` staat er niet voor niets.
Dit document beschrijft wat er moet gebeuren voordat er een scherm gebouwd mag
worden, en waarom dit lastiger is dan het lijkt.

## Waarom dit geen gewone wachtwoordwijziging is

In Vault is het wachtwoord twee dingen tegelijk:

1. Het accountwachtwoord bij Supabase (waarvan alleen de hash op de server
   staat).
2. De **passphrase van de PGP private key**, die versleuteld in IndexedDB
   staat.

`supabase.auth.updateUser({ password })` verandert alleen (1). De opgeslagen
private key blijft dan versleuteld met het **oude** wachtwoord. De gebruiker
logt daarna in met het nieuwe wachtwoord, Vault probeert daar de sleutel mee te
ontgrendelen, dat mislukt, en zonder back-upbestand is elk bericht ooit
definitief onleesbaar.

Dat is precies de reden dat er nu geen wachtwoord-wijzigscherm is.

## Wat er moet gebeuren

De volgorde is niet vrijblijvend.

1. **Oud wachtwoord opnieuw vragen.** Niet vertrouwen op de al ontgrendelde
   sleutel in het geheugen: we moeten bewijzen dat de gebruiker het oude
   wachtwoord kent, anders kan iemand met een openstaand tabblad het
   wachtwoord veranderen.
2. **De opgeslagen sleutel laden** met `loadEncryptedPrivateKey(userId)`. Dit
   is de armored, nog met het oude wachtwoord versleutelde key.
3. **Ontgrendelen met het oude wachtwoord** (`unlockPrivateKey`). Mislukt dit,
   dan stopt alles hier: oud wachtwoord fout.
4. **Opnieuw versleutelen met het nieuwe wachtwoord.** Hiervoor is een nieuwe
   functie nodig in `lib/crypto/keys.ts`, iets als
   `reencryptPrivateKey(armored, oldPassphrase, newPassphrase)`, die intern
   `decryptKey` en daarna `encryptKey` van OpenPGP gebruikt en weer armored
   teruggeeft. Deze functie hoort in `lib/crypto/`, niet in een component en
   niet in `useAuth`.
5. **Opslaan naast de oude**, niet eroverheen — zie de volgende paragraaf.
6. **Supabase-wachtwoord bijwerken.**
7. **Pas daarna de oude opgeslagen sleutel weggooien.**

## Het echte probleem: stap 5, 6 en 7 kunnen los van elkaar mislukken

Er is geen transactie over IndexedDB en Supabase heen. Twee manieren waarop het
misgaat:

- **Supabase gelukt, IndexedDB niet.** De gebruiker logt in met het nieuwe
  wachtwoord, de sleutel staat nog onder het oude. Onbruikbaar.
- **IndexedDB gelukt, Supabase niet.** De gebruiker logt in met het oude
  wachtwoord, de sleutel staat onder het nieuwe. Ook onbruikbaar.

De uitweg is niet "beter je best doen", maar **beide sleutels tegelijk laten
bestaan tot het zeker is**:

- Sla de nieuw versleutelde key op onder een aparte sleutel in IndexedDB
  (bijvoorbeeld `pending:<userId>`) en laat de bestaande staan.
- Werk daarna het Supabase-wachtwoord bij.
- Pas als dat gelukt is: `pending` wordt de echte, de oude wordt verwijderd.
- Wordt de wisseling halverwege afgebroken (tab dicht, browser gekilld), dan
  moet de ontgrendelcode bij een mislukte poging **ook de pending-sleutel
  proberen** en, als die wél opengaat, de wisseling alsnog afmaken.

Die herstelstap in `unlock` is het meeste werk en het meest te testen deel.
Zonder die stap is dit niet af.

## Andere apparaten

Dit is de consequentie die het makkelijkst over het hoofd wordt gezien.

De private key staat op **elk apparaat apart** in IndexedDB, versleuteld met de
passphrase van dat moment. Een wachtwoordwijziging op de telefoon raakt de
kopie op de laptop niet. Daar staat de sleutel nog onder het oude wachtwoord,
terwijl inloggen nu het nieuwe wachtwoord vraagt.

Dit is **niet** op te lossen door de sleutel ergens centraal te zetten: de
private key verlaat de browser niet, en dat blijft zo.

Wat wel kan, en wat gebouwd moet worden:

- Op het ontgrendelscherm, als het huidige wachtwoord de opgeslagen sleutel
  niet opent: een extra veld **"deze sleutel is nog van je vorige wachtwoord"**.
- De gebruiker vult het oude wachtwoord in, Vault ontgrendelt de lokale
  sleutel, versleutelt hem opnieuw met het nieuwe wachtwoord en slaat hem op.
- Daarna is dat apparaat weer in lijn.

Zonder dit scherm is de enige uitweg op het tweede apparaat: het
back-upbestand importeren — en dat bestand is óók nog met het oude wachtwoord
versleuteld.

## Het back-upbestand

Het geëxporteerde `.asc`-bestand is de private key zoals hij op dat moment
versleuteld was. Na een wachtwoordwijziging opent dat bestand dus alleen nog
met het **oude** wachtwoord.

Daarom hoort bij dit scherm verplicht:

- direct na een geslaagde wijziging een **nieuwe export aanbieden**, en
- in de tekst zeggen dat oude back-ups bij het oude wachtwoord horen en dat het
  verstandig is beide te bewaren tot de nieuwe export gecontroleerd is.

## Wat er níét moet gebeuren

- Geen kopie van de private key naar de server, ook niet "tijdelijk" en ook
  niet versleuteld. Dat is key-escrow en het staat in `CLAUDE.md` bij de dingen
  die we niet doen.
- Geen nieuw keypair genereren bij een wachtwoordwijziging. Dat lijkt de
  makkelijke uitweg, maar dan is de hele geschiedenis onleesbaar en moet ook
  `profiles.public_key` mee, terwijl anderen nog naar de oude sleutel
  versleutelen.
- Geen "wachtwoord vergeten"-stroom. Er is geen herstel, en die belofte doen we
  niet.

## Definition of done

Voordat dit scherm live mag:

- [ ] `reencryptPrivateKey` bestaat in `lib/crypto/` met tests, inclusief het
      geval "verkeerd oud wachtwoord".
- [ ] De pending/commit-wisseling in IndexedDB is geïmplementeerd en getest,
      inclusief het afgebroken-halverwege-geval.
- [ ] `unlock` probeert de pending-sleutel en maakt de wisseling af.
- [ ] Het ontgrendelscherm kan een sleutel van een vorig wachtwoord bijwerken.
- [ ] Na wijziging wordt een nieuwe export aangeboden.
- [ ] Handmatig getest met twee accounts op twee apparaten: wijzigen op
      apparaat A, daarna inloggen op apparaat B en de sleutel bijwerken, en
      controleren dat oude berichten nog leesbaar zijn.
