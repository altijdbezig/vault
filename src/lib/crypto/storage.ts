import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { PrivateKey } from 'openpgp';
import { KeyLockedError } from './errors';
import { readLockedPrivateKey } from './keys';

const DB_NAME = 'vault';
const DB_VERSION = 1;
const STORE_NAME = 'keys';

interface StoredKey {
  userId: string;
  /** Armored private key, still encrypted with the user's passphrase. */
  privateKeyArmored: string;
  savedAt: number;
}

interface VaultDB extends DBSchema {
  [STORE_NAME]: {
    key: string;
    value: StoredKey;
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
