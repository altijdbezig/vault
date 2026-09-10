import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { PrivateKey } from 'openpgp';
import { KeyLockedError } from './errors';
import { readLockedPrivateKey } from './keys';

const DB_NAME = 'vault';
/**
 * Version 2 adds the trust store.
 *
 * The upgrade is additive and guarded, so a browser holding a version 1
 * database keeps its stored private key: losing that would mean losing every
 * message on that device, which is the one thing a schema change here must
 * never do.
 */
const DB_VERSION = 2;
const STORE_NAME = 'keys';
const TRUST_STORE = 'trust';

interface StoredKey {
  userId: string;
  /** Armored private key, still encrypted with the user's passphrase. */
  privateKeyArmored: string;
  savedAt: number;
}

/**
 * A fingerprint somebody confirmed by hand.
 *
 * Local only, and it stays that way. Putting this on the server would mean the
 * server decides who you trust, and the whole point of comparing a fingerprint
 * out of band is that no server is involved in the answer.
 */
export interface TrustRecord {
  /** ownerId:subjectId, so two accounts in one browser stay separate. */
  id: string;
  /** The signed-in user who made this decision. */
  ownerId: string;
  /** The person whose key was verified. */
  subjectId: string;
  /** The fingerprint as it was at the moment of verifying. */
  fingerprint: string;
  verifiedAt: number;
}

interface VaultDB extends DBSchema {
  [STORE_NAME]: {
    key: string;
    value: StoredKey;
  };
  [TRUST_STORE]: {
    key: string;
    value: TrustRecord;
    indexes: { 'by-owner': string };
  };
}

let dbPromise: Promise<IDBPDatabase<VaultDB>> | null = null;

function getDB(): Promise<IDBPDatabase<VaultDB>> {
  // IndexedDB only, never localStorage or sessionStorage: those are plain
  // strings in a synchronous, easily scraped store.
  dbPromise ??= openDB<VaultDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
      }
      if (!db.objectStoreNames.contains(TRUST_STORE)) {
        const store = db.createObjectStore(TRUST_STORE, { keyPath: 'id' });
        // Indexed by owner so listing "everyone I verified" is one range
        // query rather than a full scan filtered in JavaScript.
        store.createIndex('by-owner', 'ownerId');
      }
    },
  });
  return dbPromise;
}

/**
 * Stores the passphrase-encrypted private key for a user.
 *
 * Only ever pass the armored key straight from generateKeyPair(). Refuses
 * anything that is not passphrase-protected, so an unlocked key can never end
 * up on disk by accident.
 */
export async function saveEncryptedPrivateKey(userId: string, armored: string): Promise<void> {
  const key = await readLockedPrivateKey(armored);
  if (key.isDecrypted()) {
    throw new Error(
      'Weigering: deze privésleutel is niet met een passphrase versleuteld en ' +
        'mag niet worden opgeslagen.',
    );
  }

  const db = await getDB();
  await db.put(STORE_NAME, { userId, privateKeyArmored: armored, savedAt: Date.now() });
}

/** Returns the stored encrypted private key, or null if this device has none. */
export async function loadEncryptedPrivateKey(userId: string): Promise<string | null> {
  const db = await getDB();
  const record = await db.get(STORE_NAME, userId);
  return record?.privateKeyArmored ?? null;
}

/** Removes the stored key. After this, messages on this device are unreadable. */
export async function clearStoredKey(userId: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NAME, userId);
}

/* ---------------------------------------------------------------------------
 * Trust: fingerprints the user confirmed by hand.
 * ------------------------------------------------------------------------- */

function trustId(ownerId: string, subjectId: string): string {
  return `${ownerId}:${subjectId}`;
}

/**
 * Records that the user compared a fingerprint and it matched.
 *
 * Stores the fingerprint, not just a flag. That is the entire point: a flag
 * would say "trusted" forever, while the stored value lets the next render
 * notice that the key has changed since, which is the one security signal in
 * this app that actually catches an attack.
 */
export async function setVerifiedFingerprint(
  ownerId: string,
  subjectId: string,
  fingerprint: string,
): Promise<void> {
  const db = await getDB();
  await db.put(TRUST_STORE, {
    id: trustId(ownerId, subjectId),
    ownerId,
    subjectId,
    fingerprint: fingerprint.toLowerCase(),
    verifiedAt: Date.now(),
  });
}

/** Forgets a verification, so the contact goes back to unverified. */
export async function clearVerifiedFingerprint(
  ownerId: string,
  subjectId: string,
): Promise<void> {
  const db = await getDB();
  await db.delete(TRUST_STORE, trustId(ownerId, subjectId));
}

/** Everything this user has verified on this device. */
export async function listVerifiedFingerprints(ownerId: string): Promise<TrustRecord[]> {
  const db = await getDB();
  return await db.getAllFromIndex(TRUST_STORE, 'by-owner', ownerId);
}

/* ---------------------------------------------------------------------------
 * Session: the unlocked key lives in memory and nowhere else.
 *
 * Never log this key, not even in development: no console.log of the key
 * object, no key in an error message, no key in React state that shows up in
 * devtools. Components should call getUnlockedKey() when they need it.
 * ------------------------------------------------------------------------- */

let unlockedKey: PrivateKey | null = null;

export function setUnlockedKey(key: PrivateKey): void {
  unlockedKey = key;
}

/** @throws {KeyLockedError} when the session is locked. */
export function getUnlockedKey(): PrivateKey {
  if (unlockedKey === null) {
    throw new KeyLockedError();
  }
  return unlockedKey;
}

export function lockSession(): void {
  unlockedKey = null;
}

export function isUnlocked(): boolean {
  return unlockedKey !== null;
}

// Drop the key when the tab goes away. Guarded so the module also loads in
// non-browser environments (tests now, native later).
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', lockSession);
}
