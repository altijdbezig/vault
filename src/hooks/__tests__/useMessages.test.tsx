import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrivateKey } from 'openpgp';
import {
  encryptMessage,
  generateKeyPair,
  lockSession,
  setUnlockedKey,
  unlockPrivateKey,
} from '../../lib/crypto';
import type { ChannelMemberKey, MessageRow } from '../../types';
import { useMessages } from '../useMessages';

const mocks = vi.hoisted(() => ({
  fetchMessages: vi.fn(),
  sendMessage: vi.fn(),
  subscribeToChannel: vi.fn(),
  getPublicKeysForChannel: vi.fn(),
  lock: vi.fn(),
}));

vi.mock('../../lib/supabase/messages', () => ({
  fetchMessages: mocks.fetchMessages,
  sendMessage: mocks.sendMessage,
  subscribeToChannel: mocks.subscribeToChannel,
}));

vi.mock('../../lib/supabase/profiles', () => ({
  getPublicKeysForChannel: mocks.getPublicKeysForChannel,
}));

vi.mock('../useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-a' }, lock: mocks.lock }),
}));

const CHANNEL_ID = 'channel-1';
const PASSWORD = 'wachtwoord';

interface Identity {
  userId: string;
  username: string;
  publicKey: string;
  privateKey: PrivateKey;
}

let alice: Identity;
let bob: Identity;
let carol: Identity;
let members: ChannelMemberKey[];

/** Emits a realtime INSERT into the hook under test. */
let emit: (row: MessageRow) => void = () => {};
let unsubscribe = vi.fn();

async function makeIdentity(userId: string, username: string): Promise<Identity> {
  const pair = await generateKeyPair({ username, passphrase: PASSWORD });
  return {
    userId,
    username,
    publicKey: pair.publicKeyArmored,
    privateKey: await unlockPrivateKey(pair.privateKeyArmored, PASSWORD),
  };
}

/** Builds a stored row the way the sender would have written it. */
async function makeRow(
  id: string,
  sender: Identity,
  plaintext: string,
  recipients: Identity[],
  createdAt = '2026-09-08T10:00:00.000Z',
): Promise<MessageRow> {
  return {
    id,
    channel_id: CHANNEL_ID,
    sender_id: sender.userId,
    created_at: createdAt,
    deleted_at: null,
    ciphertext: await encryptMessage({
      plaintext,
      recipientPublicKeys: recipients.map((identity) => identity.publicKey),
      signingKey: sender.privateKey,
    }),
  };
}

beforeAll(async () => {
  [alice, bob, carol] = await Promise.all([
    makeIdentity('user-a', 'benjamin'),
    makeIdentity('user-b', 'jayden'),
    makeIdentity('user-c', 'buitenstaander'),
  ]);
  members = [
    { userId: alice.userId, username: alice.username, publicKey: alice.publicKey },
    { userId: bob.userId, username: bob.username, publicKey: bob.publicKey },
  ];
});

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  lockSession();
  setUnlockedKey(alice.privateKey);

  unsubscribe = vi.fn();
  mocks.subscribeToChannel.mockImplementation(
    (_channelId: string, onInsert: (row: MessageRow) => void) => {
      emit = onInsert;
      return unsubscribe;
    },
  );
  mocks.fetchMessages.mockResolvedValue([]);
  mocks.getPublicKeysForChannel.mockResolvedValue(members);
});

describe('loading a channel', () => {
  it('subscribes before fetching, so nothing arriving in between is lost', async () => {
    let resolveFetch: (rows: MessageRow[]) => void = () => {};
    mocks.fetchMessages.mockReturnValue(
      new Promise<MessageRow[]>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const stored = await makeRow('m1', bob, 'oud bericht', [alice, bob], '2026-09-08T09:00:00.000Z');
    const inFlight = await makeRow(
      'm2',
      bob,
      'binnengekomen tijdens het laden',
      [alice, bob],
      '2026-09-08T09:30:00.000Z',
    );

    const { result } = renderHook(() => useMessages(CHANNEL_ID));

    // The subscription exists before the fetch has resolved: that is the whole
    // point. If it were the other way around this emit would go nowhere.
    expect(mocks.subscribeToChannel).toHaveBeenCalledTimes(1);
    expect(mocks.subscribeToChannel.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fetchMessages.mock.invocationCallOrder[0] ?? Infinity,
    );

    await act(async () => {
      emit(inFlight);
    });

    await act(async () => {
      resolveFetch([stored]);
    });

    await waitFor(() => {
      expect(result.current.messages.map((message) => message.text)).toEqual([
        'oud bericht',
        'binnengekomen tijdens het laden',
      ]);
    });
  });

  it('unsubscribes when the channel changes', async () => {
    const { rerender } = renderHook(({ id }: { id: string | null }) => useMessages(id), {
      initialProps: { id: CHANNEL_ID as string | null },
    });

    await waitFor(() => expect(mocks.subscribeToChannel).toHaveBeenCalled());
    rerender({ id: null });

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('deduplication', () => {
  it('keeps one copy when realtime delivers the same row twice', async () => {
    const row = await makeRow('m1', bob, 'hallo', [alice, bob]);
    const { result } = renderHook(() => useMessages(CHANNEL_ID));

    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      emit(row);
      emit(row);
    });

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    await waitFor(() => expect(result.current.messages[0]?.text).toBe('hallo'));
  });

  it('keeps one copy of a message we sent ourselves, echoed back by realtime', async () => {
    const { result } = renderHook(() => useMessages(CHANNEL_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let sentRow: MessageRow | null = null;
    mocks.sendMessage.mockImplementation(async (channelId: string, ciphertext: string) => {
      sentRow = {
        id: 'm-sent',
        channel_id: channelId,
        sender_id: alice.userId,
        ciphertext,
        created_at: '2026-09-08T11:00:00.000Z',
        deleted_at: null,
      };
      return sentRow;
    });

    await act(async () => {
      await result.current.send('mijn bericht');
    });

    // The server echoes our own insert back through the subscription.
    await act(async () => {
      if (sentRow) {
        emit(sentRow);
      }
    });

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(1);
    });
    expect(result.current.messages[0]?.text).toBe('mijn bericht');
    expect(result.current.messages[0]?.status).toBe('sent');
  });
});

describe('sending', () => {
  it('re-reads the member list and encrypts to everyone in it', async () => {
    const { result } = renderHook(() => useMessages(CHANNEL_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mocks.getPublicKeysForChannel.mockClear();
    mocks.sendMessage.mockImplementation(async (channelId: string, ciphertext: string) => ({
      id: 'm-sent',
      channel_id: channelId,
      sender_id: alice.userId,
      ciphertext,
      created_at: '2026-09-08T11:00:00.000Z',
      deleted_at: null,
    }));

    await act(async () => {
      await result.current.send('geheim');
    });

    // Fetched again at send time: a cached list could miss a new member.
    expect(mocks.getPublicKeysForChannel).toHaveBeenCalledWith(CHANNEL_ID);

    const ciphertext = mocks.sendMessage.mock.calls[0]?.[1] as string;
    expect(ciphertext).toContain('BEGIN PGP MESSAGE');
    expect(ciphertext).not.toContain('geheim');
  });

  it('marks a failed send as failed and can retry it', async () => {
    const { result } = renderHook(() => useMessages(CHANNEL_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mocks.sendMessage.mockRejectedValueOnce(new Error('netwerk stuk'));

    await act(async () => {
      await result.current.send('komt niet aan');
    });

    await waitFor(() => expect(result.current.messages[0]?.status).toBe('failed'));
    // Not silently dropped: the text is still on screen.
    expect(result.current.messages[0]?.text).toBe('komt niet aan');

    mocks.sendMessage.mockImplementation(async (channelId: string, ciphertext: string) => ({
      id: 'm-retry',
      channel_id: channelId,
      sender_id: alice.userId,
      ciphertext,
      created_at: '2026-09-08T11:05:00.000Z',
      deleted_at: null,
    }));

    const localId = result.current.messages[0]?.id ?? '';
    await act(async () => {
      await result.current.retry(localId);
    });

    await waitFor(() => expect(result.current.messages[0]?.status).toBe('sent'));
    expect(result.current.messages[0]?.text).toBe('komt niet aan');
  });
});

describe('decryption', () => {
  it('two key pairs can read each others messages', async () => {
    const fromBob = await makeRow('m1', bob, 'hoi van jayden', [alice, bob]);
    const fromAlice = await makeRow(
      'm2',
      alice,
      'hoi terug',
      [alice, bob],
      '2026-09-08T10:01:00.000Z',
    );
    mocks.fetchMessages.mockResolvedValue([fromBob, fromAlice]);

    // Alice reads both, and sees Bob's signature check out.
    const asAlice = renderHook(() => useMessages(CHANNEL_ID));
    await waitFor(() => {
      expect(asAlice.result.current.messages.map((message) => message.text)).toEqual([
        'hoi van jayden',
        'hoi terug',
      ]);
    });
    expect(asAlice.result.current.messages[0]?.signatureValid).toBe(true);
    cleanup();

    // Same ciphertext, Bob's key: also readable.
    setUnlockedKey(bob.privateKey);
    const asBob = renderHook(() => useMessages(CHANNEL_ID));
    await waitFor(() => {
      expect(asBob.result.current.messages.map((message) => message.text)).toEqual([
        'hoi van jayden',
        'hoi terug',
      ]);
    });
    expect(asBob.result.current.messages[1]?.signatureValid).toBe(true);
  });

  it('shows a placeholder for a message from before we joined, without breaking the list', async () => {
    // Encrypted to Carol only: this is what a message from before our
    // membership looks like.
    const beforeWeJoined = await makeRow(
      'm1',
      carol,
      'oud gesprek',
      [carol],
      '2026-09-08T08:00:00.000Z',
    );
    const readable = await makeRow('m2', bob, 'welkom', [alice, bob], '2026-09-08T09:00:00.000Z');
    mocks.fetchMessages.mockResolvedValue([beforeWeJoined, readable]);

    const { result } = renderHook(() => useMessages(CHANNEL_ID));

    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    await waitFor(() => expect(result.current.messages[1]?.text).toBe('welkom'));

    // Normal behaviour, not an error: unreadable, but the rest still renders.
    expect(result.current.messages[0]?.unreadable).toBe(true);
    expect(result.current.messages[0]?.text).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('flags a message whose signature does not match the sender', async () => {
    // Carol signs, but the row claims Bob sent it. sender_id comes from the
    // server; only the signature proves authorship.
    const forged = await makeRow('m1', carol, 'ik ben jayden', [alice, bob, carol]);
    mocks.fetchMessages.mockResolvedValue([{ ...forged, sender_id: bob.userId }]);

    const { result } = renderHook(() => useMessages(CHANNEL_ID));

    await waitFor(() => expect(result.current.messages[0]?.text).toBe('ik ben jayden'));
    expect(result.current.messages[0]?.signatureValid).toBe(false);
  });
});
