import type { PrivateKey } from 'openpgp';
import { generateKeyPair, unlockPrivateKey } from '../keys';

export interface TestIdentity {
  username: string;
  passphrase: string;
  publicKeyArmored: string;
  privateKeyArmored: string;
  fingerprint: string;
  /** Unlocked key, for encrypting and decrypting in tests. */
  privateKey: PrivateKey;
}

/** Creates a full identity: key pair plus the unlocked private key. */
export async function makeIdentity(username: string): Promise<TestIdentity> {
  const passphrase = `passphrase-${username}`;
  const pair = await generateKeyPair({ username, passphrase });
  const privateKey = await unlockPrivateKey(pair.privateKeyArmored, passphrase);

  return { username, passphrase, ...pair, privateKey };
}
