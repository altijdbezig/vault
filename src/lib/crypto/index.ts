/** Public surface of the crypto layer. Nothing outside lib/crypto may import openpgp directly. */

export {
  generateKeyPair,
  getFingerprint,
  readLockedPrivateKey,
  readPublicKey,
  unlockPrivateKey,
} from './keys';
export type { GeneratedKeyPair, GenerateKeyPairOptions } from './keys';

export { decryptMessage, encryptMessage } from './encrypt';
export type { DecryptedMessage, DecryptMessageOptions, EncryptMessageOptions } from './encrypt';

export { decryptFile, encryptFile } from './files';
export type { DecryptedFile, DecryptFileOptions, EncryptFileOptions } from './files';

export {
  clearStoredKey,
  getUnlockedKey,
  isUnlocked,
  loadEncryptedPrivateKey,
  lockSession,
  saveEncryptedPrivateKey,
  setUnlockedKey,
} from './storage';

export {
  KeyLockedError,
  MissingSelfKeyError,
  NotARecipientError,
  VaultCryptoError,
  WrongPassphraseError,
} from './errors';

export type { PrivateKey, PublicKey } from 'openpgp';
