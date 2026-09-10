import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { useVerification, VerificationProvider } from '../useVerification';
import type { TrustRecord } from '../../lib/crypto';

const mocks = vi.hoisted(() => ({
  listVerifiedFingerprints: vi.fn(),
  setVerifiedFingerprint: vi.fn(),
  clearVerifiedFingerprint: vi.fn(),
}));

vi.mock('../../lib/crypto', () => ({
  listVerifiedFingerprints: mocks.listVerifiedFingerprints,
  setVerifiedFingerprint: mocks.setVerifiedFingerprint,
  clearVerifiedFingerprint: mocks.clearVerifiedFingerprint,
}));

vi.mock('../useAuth', () => ({
  useAuth: () => ({ user: { id: 'me' } }),
}));

const BOB = 'user-b';
const FINGERPRINT = 'aaaa1111bbbb2222cccc3333dddd4444eeee5555';
const OTHER = 'ffff6666aaaa7777bbbb8888cccc9999dddd0000';

function record(subjectId: string, fingerprint: string): TrustRecord {
  return {
    id: `me:${subjectId}`,
    ownerId: 'me',
    subjectId,
    fingerprint,
    verifiedAt: 1_760_000_000_000,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  return <VerificationProvider>{children}</VerificationProvider>;
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listVerifiedFingerprints.mockResolvedValue([]);
  mocks.setVerifiedFingerprint.mockResolvedValue(undefined);
  mocks.clearVerifiedFingerprint.mockResolvedValue(undefined);
});

describe('statusFor', () => {
  it('geeft unverified voor iemand die nooit is vergeleken', async () => {
    const { result } = renderHook(() => useVerification(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.statusFor(BOB, FINGERPRINT)).toBe('unverified');
  });

  it('geeft verified als de vingerafdruk nog dezelfde is', async () => {
    mocks.listVerifiedFingerprints.mockResolvedValue([record(BOB, FINGERPRINT)]);

    const { result } = renderHook(() => useVerification(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.statusFor(BOB, FINGERPRINT)).toBe('verified');
  });

  /*
   * De belangrijkste regel in dit bestand.
   *
   * Dit is het enige signaal in Vault dat een echte aanval kan betrappen:
   * iemand verwisselt zijn publieke sleutel, en vanaf dat moment versleutelt
   * iedereen naar de nieuwe. Zonder deze vergelijking merkt niemand het.
   */
  it('geeft changed als de sleutel is verwisseld sinds het verifieren', async () => {
    mocks.listVerifiedFingerprints.mockResolvedValue([record(BOB, FINGERPRINT)]);

    const { result } = renderHook(() => useVerification(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.statusFor(BOB, OTHER)).toBe('changed');
  });

  it('is niet gevoelig voor hoofdletters in de huidige vingerafdruk', async () => {
    mocks.listVerifiedFingerprints.mockResolvedValue([record(BOB, FINGERPRINT)]);

    const { result } = renderHook(() => useVerification(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.statusFor(BOB, FINGERPRINT.toUpperCase())).toBe('verified');
  });

  it('geeft unverified en niet changed als er nog geen sleutel is', async () => {
    // Een half aangemaakt profiel heeft geen vingerafdruk. Dat is geen reden
    // voor een alarm; er is nog niets om over te alarmeren.
    mocks.listVerifiedFingerprints.mockResolvedValue([record(BOB, FINGERPRINT)]);

    const { result } = renderHook(() => useVerification(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.statusFor(BOB, null)).toBe('unverified');
  });

  it('leest als onverifieerd wanneer de opslag stuk is', async () => {
    // Falen in de veilige richting: liever te weinig vertrouwen claimen dan
    // te veel.
    mocks.listVerifiedFingerprints.mockRejectedValue(new Error('IndexedDB geblokkeerd'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useVerification(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.statusFor(BOB, FINGERPRINT)).toBe('unverified');
    errors.mockRestore();
  });
});

describe('verify en unverify', () => {
  it('slaat een verificatie op en toont die meteen', async () => {
    const { result } = renderHook(() => useVerification(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.verify(BOB, FINGERPRINT);
    });

    expect(mocks.setVerifiedFingerprint).toHaveBeenCalledWith('me', BOB, FINGERPRINT);
    expect(result.current.statusFor(BOB, FINGERPRINT)).toBe('verified');
  });

  it('trekt een verificatie in', async () => {
    mocks.listVerifiedFingerprints.mockResolvedValue([record(BOB, FINGERPRINT)]);

    const { result } = renderHook(() => useVerification(), { wrapper });
    await waitFor(() => expect(result.current.statusFor(BOB, FINGERPRINT)).toBe('verified'));

    await act(async () => {
      await result.current.unverify(BOB);
    });

    expect(mocks.clearVerifiedFingerprint).toHaveBeenCalledWith('me', BOB);
    expect(result.current.statusFor(BOB, FINGERPRINT)).toBe('unverified');
  });

  it('houdt de eerder geverifieerde waarde bij, om te kunnen vergelijken', async () => {
    mocks.listVerifiedFingerprints.mockResolvedValue([record(BOB, FINGERPRINT)]);

    const { result } = renderHook(() => useVerification(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // De profielkaart zet de oude naast de nieuwe, zodat de gebruiker ziet
    // wat er precies veranderd is.
    expect(result.current.verifiedFingerprint(BOB)).toBe(FINGERPRINT);
  });
});

describe('zonder provider', () => {
  it('leest alles als onverifieerd in plaats van te gooien', () => {
    // Een component die per ongeluk buiten de provider hangt mag nooit iets
    // als geverifieerd tonen.
    const { result } = renderHook(() => useVerification());

    expect(result.current.statusFor(BOB, FINGERPRINT)).toBe('unverified');
    expect(result.current.verifiedFingerprint(BOB)).toBeNull();
  });
});
