import { beforeAll, describe, expect, it } from 'vitest';
import { decryptMessage, encryptMessage } from '../encrypt';
import { KeyLockedError, MissingSelfKeyError, NotARecipientError } from '../errors';
import { readLockedPrivateKey } from '../keys';
import { makeIdentity } from './helpers';
import type { TestIdentity } from './helpers';

describe('encryptMessage / decryptMessage', () => {
  const plaintext = 'Hallo Vault, dit is een geheim bericht.';

  let benjamin: TestIdentity;
  let jayden: TestIdentity;
  let carla: TestIdentity;
  let stranger: TestIdentity;
  let members: string[];
  let ciphertext: string;

  beforeAll(async () => {
    [benjamin, jayden, carla, stranger] = await Promise.all([
      makeIdentity('benjamin'),
      makeIdentity('jayden'),
      makeIdentity('carla'),
      makeIdentity('stranger'),
    ]);

    members = [benjamin.publicKeyArmored, jayden.publicKeyArmored, carla.publicKeyArmored];
    ciphertext = await encryptMessage({
      plaintext,
      recipientPublicKeys: members,
      signingKey: benjamin.privateKey,
    });
  });

  it('produces an armored PGP message that does not contain the plaintext', () => {
    expect(ciphertext).toContain('BEGIN PGP MESSAGE');
    expect(ciphertext).not.toContain('geheim bericht');
  });

  it('can be decrypted by every channel member, sender included', async () => {
    for (const member of [benjamin, jayden, carla]) {
      const result = await decryptMessage({
        ciphertext,
        privateKey: member.privateKey,
        senderPublicKey: benjamin.publicKeyArmored,
      });

      expect(result.plaintext).toBe(plaintext);
      expect(result.signatureValid).toBe(true);
    }
  });

  it('throws NotARecipientError for someone outside the channel', async () => {
    await expect(
      decryptMessage({ ciphertext, privateKey: stranger.privateKey }),
    ).rejects.toThrow(NotARecipientError);
  });

  it('throws MissingSelfKeyError when the sender is not in the recipient list', async () => {
    await expect(
      encryptMessage({
        plaintext,
        recipientPublicKeys: [jayden.publicKeyArmored, carla.publicKeyArmored],
        signingKey: benjamin.privateKey,
      }),
    ).rejects.toThrow(MissingSelfKeyError);
  });

  it('throws KeyLockedError when signing with a locked key', async () => {
    const locked = await readLockedPrivateKey(benjamin.privateKeyArmored);

    await expect(
      encryptMessage({ plaintext, recipientPublicKeys: members, signingKey: locked }),
    ).rejects.toThrow(KeyLockedError);
  });

  describe('signature verification', () => {
    it('reports signatureValid: false but still returns the plaintext for the wrong sender key', async () => {
      const result = await decryptMessage({
        ciphertext,
        privateKey: jayden.privateKey,
        senderPublicKey: carla.publicKeyArmored,
      });

      expect(result.plaintext).toBe(plaintext);
      expect(result.signatureValid).toBe(false);
    });

    it('reports signatureValid: null when no sender key is supplied', async () => {
      const result = await decryptMessage({ ciphertext, privateKey: jayden.privateKey });

      expect(result.plaintext).toBe(plaintext);
      expect(result.signatureValid).toBeNull();
    });
  });
});
