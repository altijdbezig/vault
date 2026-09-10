import type { PrivateKey, PublicKey } from 'openpgp';
import { KeyLockedError, MissingSelfKeyError, NotARecipientError } from './errors';
import { getFingerprint, readPublicKey } from './keys';
import { loadOpenPGP } from './openpgp';

export interface EncryptFileOptions {
  bytes: Uint8Array;
  /** Armored public keys of ALL current channel members, sender included. */
  recipientPublicKeys: string[];
  /** The sender's unlocked private key. */
  signingKey: PrivateKey;
}

export interface DecryptFileOptions {
  bytes: Uint8Array;
  privateKey: PrivateKey;
  /** Armored public key of the sender, for signature verification. */
  senderPublicKey?: string;
}

export interface DecryptedFile {
  bytes: Uint8Array;
  /**
   * true  = signed by senderPublicKey.
   * false = signature missing or not made by that key.
   * null  = not checked, because no senderPublicKey was supplied.
   */
  signatureValid: boolean | null;
}

/**
 * Encrypts a file for every current member of a channel and signs it.
 *
 * Binary output, not armored, and that is the one interesting decision here.
 * Armoring is base64 with line breaks, so it adds about a third to the size —
 * on a 10 MB attachment that is over 3 MB of pointless bytes to encrypt,
 * upload, store and download again. Nothing reads this by eye, so there is no
 * reason to pay for the encoding. Messages stay armored because they end up in
 * a text column.
 *
 * Same rules as a message otherwise: signed always, and refuse when the
 * sender's own key is missing from the recipient list, because a file you
 * cannot open yourself is a file you have lost.
 */
export async function encryptFile(opts: EncryptFileOptions): Promise<Uint8Array> {
  if (!opts.signingKey.isDecrypted()) {
    throw new KeyLockedError();
  }

  const { createMessage, encrypt } = await loadOpenPGP();
  const parsedKeys = await Promise.all(opts.recipientPublicKeys.map(readPublicKey));

  const keysByFingerprint = new Map<string, PublicKey>();
  for (const key of parsedKeys) {
    keysByFingerprint.set(getFingerprint(key), key);
  }

  if (!keysByFingerprint.has(getFingerprint(opts.signingKey))) {
    throw new MissingSelfKeyError();
  }

  return await encrypt({
    message: await createMessage({ binary: opts.bytes }),
    encryptionKeys: [...keysByFingerprint.values()],
    signingKeys: [opts.signingKey],
    format: 'binary',
  });
}

/**
 * Decrypts a file and, when a sender key is supplied, verifies its signature.
 *
 * A bad signature does not block the download: the bytes come back with
 * signatureValid false so the UI can warn. Same choice as for messages —
 * refusing to show something the reader can already see nothing of is not a
 * protection, it is a guess about what they should do with it.
 *
 * @throws {NotARecipientError} if the file was not encrypted to this key.
 * @throws {KeyLockedError} if the private key is still locked.
 */
export async function decryptFile(opts: DecryptFileOptions): Promise<DecryptedFile> {
  if (!opts.privateKey.isDecrypted()) {
    throw new KeyLockedError();
  }

  const { decrypt, readMessage } = await loadOpenPGP();
  const message = await readMessage({ binaryMessage: opts.bytes });
  const verificationKeys = opts.senderPublicKey
    ? [await readPublicKey(opts.senderPublicKey)]
    : undefined;

  let result;
  try {
    result = await decrypt({
      message,
      decryptionKeys: opts.privateKey,
      verificationKeys,
      format: 'binary',
    });
  } catch (error) {
    if (isNotARecipientError(error)) {
      throw new NotARecipientError();
    }
    throw error;
  }

  // Every `verified` promise must be settled, also when the outcome is
  // unused: an unhandled rejection would otherwise surface as a console error.
  const verdicts = await Promise.all(
    result.signatures.map((signature) => signature.verified.then(() => true, () => false)),
  );

  return {
    bytes: result.data,
    signatureValid: verificationKeys ? verdicts.some(Boolean) : null,
  };
}

/**
 * Distinguishes "this key is not a recipient" from real corruption.
 *
 * Duplicated from encrypt.ts rather than shared, because it matches on library
 * error strings: if OpenPGP ever changes them, the message path and the file
 * path should be able to be fixed and tested one at a time.
 */
function isNotARecipientError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message.includes('No decryption key packets found') ||
    error.message.includes('Session key decryption failed')
  );
}
