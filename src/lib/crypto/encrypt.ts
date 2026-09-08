import { createMessage, decrypt, encrypt, readMessage } from 'openpgp';
import type { PrivateKey, PublicKey } from 'openpgp';
import { KeyLockedError, MissingSelfKeyError, NotARecipientError } from './errors';
import { getFingerprint, readPublicKey } from './keys';

export interface EncryptMessageOptions {
  plaintext: string;
  /** Armored public keys of ALL current channel members, sender included. */
  recipientPublicKeys: string[];
  /** The sender's unlocked private key. */
  signingKey: PrivateKey;
}

export interface DecryptMessageOptions {
  ciphertext: string;
  /** The reader's unlocked private key. */
  privateKey: PrivateKey;
  /** Armored public key of the sender, for signature verification. */
  senderPublicKey?: string;
}

export interface DecryptedMessage {
  plaintext: string;
  /**
   * true  = signed by senderPublicKey.
   * false = signature missing or not made by that key. Show a warning.
   * null  = not checked, because no senderPublicKey was supplied.
   */
  signatureValid: boolean | null;
}

/**
 * Encrypts a message to every current member of a channel and signs it.
 *
 * Signing is mandatory. messages.sender_id comes from the server and only says
 * who inserted the row; the PGP signature inside the ciphertext is the only
 * real proof of authorship. Without it a compromised server could attribute a
 * message to somebody else.
 *
 * OpenPGP handles the hybrid encryption (session key per message, wrapped for
 * each recipient key) itself. Do not add an AES layer around this.
 */
export async function encryptMessage(opts: EncryptMessageOptions): Promise<string> {
  if (!opts.signingKey.isDecrypted()) {
    throw new KeyLockedError();
  }

  const parsedKeys = await Promise.all(opts.recipientPublicKeys.map(readPublicKey));

  // Deduplicate by fingerprint: a member listed twice should not produce two
  // identical PKESK packets.
  const keysByFingerprint = new Map<string, PublicKey>();
  for (const key of parsedKeys) {
    keysByFingerprint.set(getFingerprint(key), key);
  }

  // The sender must be able to read their own message back. If their key is
  // missing from the member list, the message would be unreadable to them
  // forever, so refuse to encrypt rather than lose the message.
  if (!keysByFingerprint.has(getFingerprint(opts.signingKey))) {
    throw new MissingSelfKeyError();
  }

  return await encrypt({
    message: await createMessage({ text: opts.plaintext }),
    encryptionKeys: [...keysByFingerprint.values()],
    signingKeys: [opts.signingKey],
    format: 'armored',
  });
}

/**
 * Decrypts a message and, when a sender key is supplied, verifies its signature.
 *
 * A bad signature never blocks reading: the plaintext is returned with
 * signatureValid: false so the UI can render the message with a warning.
 *
 * @throws {NotARecipientError} if the message was not encrypted to this key.
 * @throws {KeyLockedError} if the private key is still locked.
 */
export async function decryptMessage(opts: DecryptMessageOptions): Promise<DecryptedMessage> {
  if (!opts.privateKey.isDecrypted()) {
    throw new KeyLockedError();
  }

  const message = await readMessage({ armoredMessage: opts.ciphertext });
  const verificationKeys = opts.senderPublicKey
    ? [await readPublicKey(opts.senderPublicKey)]
    : undefined;

  let result;
  try {
    result = await decrypt({
      message,
      decryptionKeys: opts.privateKey,
      verificationKeys,
    });
  } catch (error) {
    if (isNotARecipientError(error)) {
      throw new NotARecipientError();
    }
    throw error;
  }

  // Every `verified` promise must be settled, also when we do not use the
  // outcome: an unhandled rejection would otherwise surface as a console error.
  const verdicts = await Promise.all(
    result.signatures.map((signature) => signature.verified.then(() => true, () => false)),
  );

  return {
    plaintext: result.data,
    // No sender key supplied means we did not check anything.
    signatureValid: verificationKeys ? verdicts.some(Boolean) : null,
  };
}

/**
 * Distinguishes "this key is not a recipient" from real corruption.
 *
 * OpenPGP.js reports both as a plain Error, so we have to match on the message.
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
