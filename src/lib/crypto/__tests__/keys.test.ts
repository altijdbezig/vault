import { beforeAll, describe, expect, it } from 'vitest';
import { WrongPassphraseError } from '../errors';
import { generateKeyPair, getFingerprint, readPublicKey, unlockPrivateKey } from '../keys';
import type { GeneratedKeyPair } from '../keys';

describe('generateKeyPair', () => {
  let pair: GeneratedKeyPair;

  beforeAll(async () => {
    pair = await generateKeyPair({ username: 'benjamin', passphrase: 'correct horse battery' });
  });

  it('returns an armored public and private key', () => {
    expect(pair.publicKeyArmored).toContain('BEGIN PGP PUBLIC KEY BLOCK');
    expect(pair.privateKeyArmored).toContain('BEGIN PGP PRIVATE KEY BLOCK');
  });

  it('returns a lowercase hex fingerprint matching the public key', async () => {
    expect(pair.fingerprint).toMatch(/^[0-9a-f]+$/);
    expect(getFingerprint(await readPublicKey(pair.publicKeyArmored))).toBe(pair.fingerprint);
  });

  it('uses curve25519, not RSA', async () => {
    const key = await readPublicKey(pair.publicKeyArmored);
    expect(key.getAlgorithmInfo().algorithm).toBe('ed25519');
  });

  it('puts the username but no email in the user ID', async () => {
    const key = await readPublicKey(pair.publicKeyArmored);
    const userIDs = key.getUserIDs();

    expect(userIDs).toEqual(['benjamin']);
    expect(userIDs.join()).not.toContain('@');
  });

  it('stores the private key encrypted with the passphrase', async () => {
    const { readLockedPrivateKey } = await import('../keys');
    const locked = await readLockedPrivateKey(pair.privateKeyArmored);

    expect(locked.isDecrypted()).toBe(false);
  });
});

describe('unlockPrivateKey', () => {
  it('unlocks with the right passphrase', async () => {
    const pair = await generateKeyPair({ username: 'jayden', passphrase: 'juiste-passphrase' });
    const key = await unlockPrivateKey(pair.privateKeyArmored, 'juiste-passphrase');

    expect(key.isDecrypted()).toBe(true);
    expect(getFingerprint(key)).toBe(pair.fingerprint);
  });

  it('throws WrongPassphraseError on the wrong passphrase', async () => {
    const pair = await generateKeyPair({ username: 'jayden', passphrase: 'juiste-passphrase' });

    await expect(unlockPrivateKey(pair.privateKeyArmored, 'fout')).rejects.toThrow(
      WrongPassphraseError,
    );
  });
});
