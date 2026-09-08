/**
 * Errors thrown by the crypto layer.
 *
 * Messages are in Dutch because they are meant to be shown to the user
 * directly. They must never contain key material or ciphertext.
 */

/** Base class for every error thrown by lib/crypto. */
export class VaultCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The supplied passphrase could not unlock the private key. */
export class WrongPassphraseError extends VaultCryptoError {
  constructor() {
    super('Onjuiste passphrase. De privésleutel kon niet worden ontgrendeld.');
  }
}

/** An operation needed the unlocked private key, but the session is locked. */
export class KeyLockedError extends VaultCryptoError {
  constructor() {
    super('Je sleutel is vergrendeld. Ontgrendel eerst je sleutel met je passphrase.');
  }
}

/**
 * This user was not among the recipients of the message.
 * Normal behaviour, not a bug: messages sent before you joined a channel were
 * never encrypted to your key and can never be read.
 */
export class NotARecipientError extends VaultCryptoError {
  constructor() {
    super(
      'Dit bericht is niet voor jou versleuteld. Het is waarschijnlijk verstuurd ' +
        'voordat je aan dit kanaal werd toegevoegd.',
    );
  }
}

/** The sender's own public key was missing from the recipient list. */
export class MissingSelfKeyError extends VaultCryptoError {
  constructor() {
    super(
      'Je eigen publieke sleutel ontbreekt in de ontvangerslijst. Zonder die ' +
        'sleutel zou je je eigen bericht daarna zelf niet meer kunnen lezen.',
    );
  }
}
