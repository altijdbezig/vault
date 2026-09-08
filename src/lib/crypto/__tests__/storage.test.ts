import 'fake-indexeddb/auto';

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KeyLockedError } from '../errors';
import { generateKeyPair, getFingerprint } from '../keys';
import type { GeneratedKeyPair } from '../keys';
import {
  clearStoredKey,
  getUnlockedKey,
  isUnlocked,
  loadEncryptedPrivateKey,
  lockSession,
  saveEncryptedPrivateKey,
  setUnlockedKey,
} from '../storage';
import { makeIdentity } from './helpers';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('IndexedDB key storage', () => {
  let pair: GeneratedKeyPair;

  beforeAll(async () => {
    pair = await generateKeyPair({ username: 'benjamin', passphrase: 'opslag-passphrase' });
  });

  it('returns null when this device has no key for the user', async () => {
    expect(await loadEncryptedPrivateKey('onbekende-user')).toBeNull();
  });

  it('stores and reads back the encrypted private key', async () => {
    await saveEncryptedPrivateKey(USER_ID, pair.privateKeyArmored);

    expect(await loadEncryptedPrivateKey(USER_ID)).toBe(pair.privateKeyArmored);
  });

  it('overwrites an existing key for the same user', async () => {
    const newer = await generateKeyPair({ username: 'benjamin', passphrase: 'tweede' });
    await saveEncryptedPrivateKey(USER_ID, pair.privateKeyArmored);
    await saveEncryptedPrivateKey(USER_ID, newer.privateKeyArmored);

    expect(await loadEncryptedPrivateKey(USER_ID)).toBe(newer.privateKeyArmored);
  });

  it('clears the stored key', async () => {
    await saveEncryptedPrivateKey(USER_ID, pair.privateKeyArmored);
    await clearStoredKey(USER_ID);

    expect(await loadEncryptedPrivateKey(USER_ID)).toBeNull();
  });

  it('refuses to store a private key that is not passphrase-protected', async () => {
    const unprotected = await generateKeyPair({ username: 'onbeveiligd', passphrase: '' });

    await expect(saveEncryptedPrivateKey(USER_ID, unprotected.privateKeyArmored)).rejects.toThrow(
      /passphrase/i,
    );
  });
});

describe('session', () => {
  beforeEach(() => {
    lockSession();
  });

  it('starts locked', () => {
    expect(isUnlocked()).toBe(false);
    expect(() => getUnlockedKey()).toThrow(KeyLockedError);
  });

  it('hands out the key once unlocked', async () => {
    const identity = await makeIdentity('benjamin');
    setUnlockedKey(identity.privateKey);

    expect(isUnlocked()).toBe(true);
    expect(getFingerprint(getUnlockedKey())).toBe(identity.fingerprint);
  });

  it('drops the key on lockSession', async () => {
    const identity = await makeIdentity('benjamin');
    setUnlockedKey(identity.privateKey);
    lockSession();

    expect(isUnlocked()).toBe(false);
    expect(() => getUnlockedKey()).toThrow(KeyLockedError);
  });
});
