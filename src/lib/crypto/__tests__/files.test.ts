import { beforeAll, describe, expect, it } from 'vitest';
import { decryptFile, encryptFile } from '../files';
import { KeyLockedError, MissingSelfKeyError, NotARecipientError } from '../errors';
import { readLockedPrivateKey } from '../keys';
import { makeIdentity } from './helpers';
import type { TestIdentity } from './helpers';

let alice: TestIdentity;
let bob: TestIdentity;
let outsider: TestIdentity;

beforeAll(async () => {
  [alice, bob, outsider] = await Promise.all([
    makeIdentity('benjamin'),
    makeIdentity('jayden'),
    makeIdentity('buitenstaander'),
  ]);
});

/** A byte pattern that is not valid text, so nothing can quietly stringify it. */
function binaryFixture(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = (index * 31 + 7) % 256;
  }
  return bytes;
}

describe('encryptFile en decryptFile', () => {
  it('geeft precies dezelfde bytes terug', async () => {
    const original = binaryFixture(5000);

    const ciphertext = await encryptFile({
      bytes: original,
      recipientPublicKeys: [alice.publicKeyArmored, bob.publicKeyArmored],
      signingKey: alice.privateKey,
    });

    const result = await decryptFile({
      bytes: ciphertext,
      privateKey: bob.privateKey,
      senderPublicKey: alice.publicKeyArmored,
    });

    expect(result.bytes).toEqual(original);
    expect(result.signatureValid).toBe(true);
  });

  it('levert binaire output, geen armored tekst', async () => {
    // Armoring is base64 en kost ongeveer een derde extra. Op een bijlage van
    // 10 MB is dat ruim 3 MB die versleuteld, geüpload, opgeslagen en weer
    // gedownload wordt zonder dat iemand het leest.
    const original = binaryFixture(2048);

    const ciphertext = await encryptFile({
      bytes: original,
      recipientPublicKeys: [alice.publicKeyArmored],
      signingKey: alice.privateKey,
    });

    expect(ciphertext).toBeInstanceOf(Uint8Array);
    const asText = new TextDecoder().decode(ciphertext.slice(0, 40));
    expect(asText).not.toContain('BEGIN PGP');
    // Ruime marge, maar ver onder de 1.33x van armored plus header.
    expect(ciphertext.byteLength).toBeLessThan(original.byteLength * 1.2);
  });

  it('houdt een leeg bestand leeg', async () => {
    const ciphertext = await encryptFile({
      bytes: new Uint8Array(0),
      recipientPublicKeys: [alice.publicKeyArmored],
      signingKey: alice.privateKey,
    });

    const result = await decryptFile({ bytes: ciphertext, privateKey: alice.privateKey });

    expect(result.bytes.byteLength).toBe(0);
  });

  it('weigert te versleutelen zonder de eigen sleutel in de lijst', async () => {
    // Een bestand dat je zelf niet meer kunt openen is een bestand dat je kwijt
    // bent. Zelfde regel als bij een bericht.
    await expect(
      encryptFile({
        bytes: binaryFixture(16),
        recipientPublicKeys: [bob.publicKeyArmored],
        signingKey: alice.privateKey,
      }),
    ).rejects.toThrow(MissingSelfKeyError);
  });

  it('weigert te versleutelen met een vergrendelde sleutel', async () => {
    const locked = await readLockedPrivateKey(alice.privateKeyArmored);

    await expect(
      encryptFile({
        bytes: binaryFixture(16),
        recipientPublicKeys: [alice.publicKeyArmored],
        signingKey: locked,
      }),
    ).rejects.toThrow(KeyLockedError);
  });

  it('weigert te ontsleutelen met een vergrendelde sleutel', async () => {
    const ciphertext = await encryptFile({
      bytes: binaryFixture(16),
      recipientPublicKeys: [alice.publicKeyArmored],
      signingKey: alice.privateKey,
    });
    const locked = await readLockedPrivateKey(alice.privateKeyArmored);

    await expect(decryptFile({ bytes: ciphertext, privateKey: locked })).rejects.toThrow(
      KeyLockedError,
    );
  });

  it('gooit NotARecipientError voor iemand die geen ontvanger was', async () => {
    // Dit is het geval van een bijlage die verstuurd is voordat je in het
    // kanaal zat. Correct gedrag, geen bug — en de UI zegt dat ook zo.
    const ciphertext = await encryptFile({
      bytes: binaryFixture(64),
      recipientPublicKeys: [alice.publicKeyArmored, bob.publicKeyArmored],
      signingKey: alice.privateKey,
    });

    await expect(
      decryptFile({ bytes: ciphertext, privateKey: outsider.privateKey }),
    ).rejects.toThrow(NotARecipientError);
  });

  it('meldt een handtekening van de verkeerde afzender als ongeldig', async () => {
    const ciphertext = await encryptFile({
      bytes: binaryFixture(64),
      recipientPublicKeys: [alice.publicKeyArmored, bob.publicKeyArmored],
      signingKey: alice.privateKey,
    });

    // Bob controleert tegen de sleutel van een derde: klopt niet.
    const result = await decryptFile({
      bytes: ciphertext,
      privateKey: bob.privateKey,
      senderPublicKey: outsider.publicKeyArmored,
    });

    // De bytes komen wel terug: weigeren te tonen wat de lezer toch al heeft
    // is geen bescherming. De waarschuwing is het signaal.
    expect(result.bytes.byteLength).toBe(64);
    expect(result.signatureValid).toBe(false);
  });

  it('geeft null voor de handtekening als er geen afzendersleutel bekend is', async () => {
    const ciphertext = await encryptFile({
      bytes: binaryFixture(32),
      recipientPublicKeys: [alice.publicKeyArmored],
      signingKey: alice.privateKey,
    });

    const result = await decryptFile({ bytes: ciphertext, privateKey: alice.privateKey });

    // null is "niet gecontroleerd" en dat is iets anders dan false.
    expect(result.signatureValid).toBeNull();
  });

  it('ontdubbelt ontvangers op fingerprint', async () => {
    // Een lid dat twee keer in de ledenlijst staat mag geen tweede
    // PKESK-pakket opleveren.
    const once = await encryptFile({
      bytes: binaryFixture(32),
      recipientPublicKeys: [alice.publicKeyArmored],
      signingKey: alice.privateKey,
    });
    const twice = await encryptFile({
      bytes: binaryFixture(32),
      recipientPublicKeys: [alice.publicKeyArmored, alice.publicKeyArmored],
      signingKey: alice.privateKey,
    });

    // Niet byte-identiek (nieuwe sessiesleutel per bericht), maar wel dezelfde
    // lengte: één ontvanger, één wrapped session key.
    expect(twice.byteLength).toBe(once.byteLength);
  });
});
