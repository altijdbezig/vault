import 'fake-indexeddb/auto';

import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearVerifiedFingerprint,
  listVerifiedFingerprints,
  loadEncryptedPrivateKey,
  saveEncryptedPrivateKey,
  setVerifiedFingerprint,
} from '../storage';
import { generateKeyPair } from '../keys';

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const CAROL = '33333333-3333-4333-8333-333333333333';

const FINGERPRINT_A = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
const FINGERPRINT_B = 'ffff6666aaaa7777bbbb8888cccc9999dddd0000';

beforeEach(async () => {
  // fake-indexeddb keeps state between tests in a file, so start each one from
  // a known set.
  for (const owner of [ALICE, BOB]) {
    for (const record of await listVerifiedFingerprints(owner)) {
      await clearVerifiedFingerprint(owner, record.subjectId);
    }
  }
});

describe('geverifieerde vingerafdrukken', () => {
  it('bewaart en leest een verificatie terug', async () => {
    await setVerifiedFingerprint(ALICE, BOB, FINGERPRINT_A);

    const stored = await listVerifiedFingerprints(ALICE);

    expect(stored).toHaveLength(1);
    expect(stored[0]?.subjectId).toBe(BOB);
    expect(stored[0]?.fingerprint).toBe(FINGERPRINT_A);
    expect(typeof stored[0]?.verifiedAt).toBe('number');
  });

  /*
   * Dit is de hele reden dat de vingerafdruk wordt opgeslagen en niet alleen
   * een vlaggetje "vertrouwd".
   *
   * Met een vlaggetje zou iemand die zijn publieke sleutel verwisselt
   * vertrouwd blijven. Door de waarde te bewaren kan de UI zien dat hij
   * veranderd is, en dat is het enige signaal in deze app dat een echte
   * aanval kan betrappen.
   */
  it('bewaart de waarde, zodat een wijziging later zichtbaar is', async () => {
    await setVerifiedFingerprint(ALICE, BOB, FINGERPRINT_A);

    const stored = await listVerifiedFingerprints(ALICE);

    expect(stored[0]?.fingerprint).not.toBe(FINGERPRINT_B);
    expect(stored[0]?.fingerprint).toBe(FINGERPRINT_A);
  });

  it('overschrijft een eerdere verificatie van dezelfde persoon', async () => {
    await setVerifiedFingerprint(ALICE, BOB, FINGERPRINT_A);
    await setVerifiedFingerprint(ALICE, BOB, FINGERPRINT_B);

    const stored = await listVerifiedFingerprints(ALICE);

    expect(stored).toHaveLength(1);
    expect(stored[0]?.fingerprint).toBe(FINGERPRINT_B);
  });

  it('normaliseert naar kleine letters', async () => {
    await setVerifiedFingerprint(ALICE, BOB, FINGERPRINT_A.toUpperCase());

    const stored = await listVerifiedFingerprints(ALICE);

    expect(stored[0]?.fingerprint).toBe(FINGERPRINT_A);
  });

  it('houdt de beslissingen van twee accounts in dezelfde browser gescheiden', async () => {
    // Twee mensen op één laptop mogen elkaars vertrouwensbeslissingen niet
    // erven: wie A vertrouwt zegt niets over wie B vertrouwt.
    await setVerifiedFingerprint(ALICE, CAROL, FINGERPRINT_A);
    await setVerifiedFingerprint(BOB, CAROL, FINGERPRINT_B);

    const forAlice = await listVerifiedFingerprints(ALICE);
    const forBob = await listVerifiedFingerprints(BOB);

    expect(forAlice).toHaveLength(1);
    expect(forBob).toHaveLength(1);
    expect(forAlice[0]?.fingerprint).toBe(FINGERPRINT_A);
    expect(forBob[0]?.fingerprint).toBe(FINGERPRINT_B);
  });

  it('trekt een verificatie in zonder de rest aan te raken', async () => {
    await setVerifiedFingerprint(ALICE, BOB, FINGERPRINT_A);
    await setVerifiedFingerprint(ALICE, CAROL, FINGERPRINT_B);

    await clearVerifiedFingerprint(ALICE, BOB);

    const stored = await listVerifiedFingerprints(ALICE);
    expect(stored.map((record) => record.subjectId)).toEqual([CAROL]);
  });

  it('geeft een lege lijst voor iemand die nog niets verifieerde', async () => {
    expect(await listVerifiedFingerprints(CAROL)).toEqual([]);
  });

  /*
   * De schemamigratie van versie 1 naar 2 mag de opgeslagen privésleutel niet
   * kwijtraken. Zou dat gebeuren, dan verliest iedereen die de app bijwerkt
   * elk bericht op dat apparaat.
   */
  it('laat de opgeslagen privesleutel intact naast de trust-store', async () => {
    const pair = await generateKeyPair({ username: 'benjamin', passphrase: 'wachtwoord' });
    await saveEncryptedPrivateKey(ALICE, pair.privateKeyArmored);

    await setVerifiedFingerprint(ALICE, BOB, FINGERPRINT_A);

    expect(await loadEncryptedPrivateKey(ALICE)).toBe(pair.privateKeyArmored);
  });
});
