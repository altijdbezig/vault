import { decryptKey, generateKey, readKey, readPrivateKey } from 'openpgp';
import type { PrivateKey, PublicKey } from 'openpgp';
import { WrongPassphraseError } from './errors';

export interface GenerateKeyPairOptions {
  username: string;
  passphrase: string;
}

export interface GeneratedKeyPair {
  /** Armored public key, safe to upload to profiles.public_key. */
  publicKeyArmored: string;
  /** Armored private key, encrypted with the user's passphrase by OpenPGP. */
  privateKeyArmored: string;
  /** Lowercase hex fingerprint, for profiles.key_fingerprint. */
  fingerprint: string;
}

/**
 * Generates a new PGP key pair in the browser.
 *
 * The private key returned here is already encrypted with the passphrase by
 * OpenPGP itself. Do not wrap it in another encryption layer: store it as is.
 *
 * The user ID carries only the username. We deliberately leave out the email
 * address, since a public key is handed out to everyone in a channel and would
 * otherwise leak the user's email as metadata.
 */
export async function generateKeyPair(opts: GenerateKeyPairOptions): Promise<GeneratedKeyPair> {
  const { publicKey, privateKey } = await generateKey({
    // OpenPGP.js v6: 'curve25519' is the modern Ed25519/X25519 key type.
    // (In v5 this was type: 'ecc' + curve: 'curve25519'; that curve name is
    // now 'curve25519Legacy'.) ECC over RSA: RSA keygen is far too slow in a
    // browser tab.
    type: 'curve25519',
    userIDs: [{ name: opts.username }],
    passphrase: opts.passphrase,
    format: 'armored',
  });

  const parsedPublicKey = await readPublicKey(publicKey);

  return {
    publicKeyArmored: publicKey,
    privateKeyArmored: privateKey,
    fingerprint: getFingerprint(parsedPublicKey),
  };
}

/**
 * Decrypts a stored private key with the user's passphrase.
 *
 * The result only ever belongs in memory (see storage.setUnlockedKey). Never
 * persist, log or send the returned key anywhere.
 *
 * @throws {WrongPassphraseError} if the passphrase does not unlock the key.
 */
export async function unlockPrivateKey(
  privateKeyArmored: string,
  passphrase: string,
): Promise<PrivateKey> {
  const lockedKey = await readPrivateKey({ armoredKey: privateKeyArmored });

  try {
    return await decryptKey({ privateKey: lockedKey, passphrase });
  } catch {
    // Swallow the OpenPGP error on purpose: the UI should not have to parse
    // English library messages, and the original error is not worth surfacing.
    throw new WrongPassphraseError();
  }
}

/**
 * Parses an armored public key.
 *
 * Any secret key material in the input is stripped, so this can safely be
 * pointed at whatever came back from the server.
 */
export async function readPublicKey(armored: string): Promise<PublicKey> {
  const key = await readKey({ armoredKey: armored });
  return key.toPublic();
}

/** Returns the key's fingerprint as lowercase hex. */
export function getFingerprint(key: PublicKey | PrivateKey): string {
  return key.getFingerprint().toLowerCase();
}

/** Reads a private key without unlocking it (still passphrase-encrypted). */
export async function readLockedPrivateKey(armored: string): Promise<PrivateKey> {
  return await readPrivateKey({ armoredKey: armored });
}
