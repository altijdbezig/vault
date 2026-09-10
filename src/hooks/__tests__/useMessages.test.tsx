import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrivateKey } from 'openpgp';
import {
  decryptMessage,
  encryptMessage,
  generateKeyPair,
  lockSession,
  setUnlockedKey,
  unlockPrivateKey,
} from '../../lib/crypto';
import { MESSAGE_PAGE_SIZE } from '../../lib/supabase/messages';
import type { ChannelMemberKey, MessageRow } from '../../types';
import { useMessages } from '../useMessages';

const mocks = vi.hoisted(() => ({
  fetchMessages: vi.fn(),
  fetchMessagesSince: vi.fn(),
  fetchMessagesByIds: vi.fn(),
  sendMessage: vi.fn(),
  updateMessage: vi.fn(),
  deleteMessage: vi.fn(),
  subscribeToChannel: vi.fn(),
  getPublicKeysForChannel: vi.fn(),
  lock: vi.fn(),
}));

vi.mock('../../lib/supabase/messages', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchMessages: mocks.fetchMessages,
  fetchMessagesSince: mocks.fetchMessagesSince,
  fetchMessagesByIds: mocks.fetchMessagesByIds,
  sendMessage: mocks.sendMessage,
  updateMessage: mocks.updateMessage,
  deleteMessage: mocks.deleteMessage,
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
/** Emits a realtime UPDATE (an edit or a deletion) into the hook under test. */
let emitUpdate: (row: MessageRow) => void = () => {};
/** Reports a realtime connection change to the hook under test. */
let emitStatus: (status: 'connected' | 'disconnected') => void = () => {};
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
    edited_at: null,
    deleted_at: null,
    reply_to_id: null,
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
    {
      userId: alice.userId,
      username: alice.username,
      publicKey: alice.publicKey,
      fingerprint: null,
      displayName: null,
      avatarUrl: null,
    },
    {
      userId: bob.userId,
      username: bob.username,
      publicKey: bob.publicKey,
      fingerprint: null,
      displayName: null,
      avatarUrl: null,
    },
  ];
});

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  lockSession();
  setUnlockedKey(alice.privateKey);

  unsubscribe = vi.fn();
  mocks.subscribeToChannel.mockImplementation(
    (
      _channelId: string,
      onInsert: (row: MessageRow) => void,
      onStatus?: (status: 'connected' | 'disconnected') => void,
      onUpdate?: (row: MessageRow) => void,
    ) => {
      emit = onInsert;
      emitStatus = onStatus ?? (() => {});
      emitUpdate = onUpdate ?? (() => {});
      return unsubscribe;
    },
  );
  mocks.fetchMessages.mockResolvedValue([]);
  mocks.fetchMessagesSince.mockResolvedValue([]);
  mocks.fetchMessagesByIds.mockResolvedValue([]);
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
        edited_at: null,
        deleted_at: null,
        reply_to_id: null,
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

describe('server channels', () => {
  /**
   * A server channel is the same abstraction as a DM, but its member list can
   * change. These two cases are what that costs.
   */
  it('skips members without a public key and reports who they are', async () => {
    const halfCreatedProfile: ChannelMemberKey = {
      userId: 'user-d',
      username: 'zonder-sleutel',
      publicKey: null,
      fingerprint: null,
      displayName: null,
      avatarUrl: null,
    };
    mocks.getPublicKeysForChannel.mockResolvedValue([
      ...members,
      {
        userId: carol.userId,
        username: carol.username,
        publicKey: carol.publicKey,
        fingerprint: null,
        displayName: null,
        avatarUrl: null,
      },
      halfCreatedProfile,
    ]);
    mocks.sendMessage.mockImplementation(async (channelId: string, ciphertext: string) => ({
      id: 'm-sent',
      channel_id: channelId,
      sender_id: alice.userId,
      ciphertext,
      created_at: '2026-09-08T11:00:00.000Z',
      deleted_at: null,
    }));

    const { result } = renderHook(() => useMessages(CHANNEL_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    // The UI has to be able to name them; silently dropping them is not ok.
    expect(result.current.membersWithoutKey.map((member) => member.username)).toEqual([
      'zonder-sleutel',
    ]);

    await act(async () => {
      await result.current.send('bericht aan het kanaal');
    });

    // The send still goes through for everyone who does have a key.
    await waitFor(() => expect(result.current.messages[0]?.status).toBe('sent'));
    expect(result.current.error).toBeNull();

    const ciphertext = mocks.sendMessage.mock.calls[0]?.[1] as string;
    const readableByCarol = await decryptMessage({
      ciphertext,
      privateKey: carol.privateKey,
    });
    expect(readableByCarol.plaintext).toBe('bericht aan het kanaal');
  });

  it('shows a placeholder for messages sent before a member joined', async () => {
    // Carol is the newcomer: she is in the channel now, but the first message
    // was encrypted before she was.
    const beforeCarol = await makeRow(
      'm1',
      alice,
      'gesprek van voor haar tijd',
      [alice, bob],
      '2026-09-08T08:00:00.000Z',
    );
    const afterCarol = await makeRow(
      'm2',
      alice,
      'welkom carol',
      [alice, bob, carol],
      '2026-09-08T09:00:00.000Z',
    );

    mocks.fetchMessages.mockResolvedValue([beforeCarol, afterCarol]);
    mocks.getPublicKeysForChannel.mockResolvedValue([
      ...members,
      {
        userId: carol.userId,
        username: carol.username,
        publicKey: carol.publicKey,
        fingerprint: null,
        displayName: null,
        avatarUrl: null,
      },
    ]);
    setUnlockedKey(carol.privateKey);

    const { result } = renderHook(() => useMessages(CHANNEL_ID));

    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    await waitFor(() => expect(result.current.messages[1]?.text).toBe('welkom carol'));

    // Not an error, not a crash: exactly the designed behaviour.
    expect(result.current.messages[0]?.unreadable).toBe(true);
    expect(result.current.messages[0]?.text).toBeNull();
    expect(result.current.error).toBeNull();
  });
});

describe('loading older messages', () => {
  /** A full first page, so the hook knows there is more behind it. */
  async function fullFirstPage(): Promise<MessageRow[]> {
    const rows: MessageRow[] = [];
    for (let index = 0; index < MESSAGE_PAGE_SIZE; index += 1) {
      rows.push(
        await makeRow(
          `recent-${index}`,
          bob,
          `recent ${index}`,
          [alice, bob],
          // 10:00 onwards, one minute apart, so the order is unambiguous.
          new Date(Date.UTC(2026, 8, 8, 10, index)).toISOString(),
        ),
      );
    }
    return rows;
  }

  it('pages back with the oldest message as the cursor and keeps no duplicates', async () => {
    const firstPage = await fullFirstPage();
    const older = await makeRow('older-1', bob, 'van eerder', [alice, bob], '2026-09-08T08:00:00.000Z');

    mocks.fetchMessages.mockResolvedValueOnce(firstPage);
    const { result } = renderHook(() => useMessages(CHANNEL_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.messages).toHaveLength(MESSAGE_PAGE_SIZE));
    expect(result.current.reachedStart).toBe(false);

    // The previous page overlaps with what we already hold: a real server does
    // this whenever a message arrives between the two requests.
    mocks.fetchMessages.mockResolvedValueOnce([older, ...firstPage.slice(0, 3)]);

    await act(async () => {
      await result.current.loadOlder();
    });

    expect(mocks.fetchMessages).toHaveBeenLastCalledWith(CHANNEL_ID, {
      before: firstPage[0]?.created_at,
    });

    // One extra message, not four: the overlap was deduplicated by id.
    await waitFor(() => expect(result.current.messages).toHaveLength(MESSAGE_PAGE_SIZE + 1));
    const ids = result.current.messages.map((message) => message.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Oldest first, and decrypted like everything else.
    expect(ids[0]).toBe('older-1');
    await waitFor(() => expect(result.current.messages[0]?.text).toBe('van eerder'));
  });

  it('reports the start of the channel when a short first page comes back', async () => {
    mocks.fetchMessages.mockResolvedValue([
      await makeRow('m1', bob, 'het enige bericht', [alice, bob]),
    ]);

    const { result } = renderHook(() => useMessages(CHANNEL_ID));

    await waitFor(() => expect(result.current.reachedStart).toBe(true));

    // Nothing to page back to, so nothing is asked for.
    mocks.fetchMessages.mockClear();
    await act(async () => {
      await result.current.loadOlder();
    });
    expect(mocks.fetchMessages).not.toHaveBeenCalled();
  });

  it('reports the start once a short page comes back from paging', async () => {
    mocks.fetchMessages.mockResolvedValueOnce(await fullFirstPage());
    const { result } = renderHook(() => useMessages(CHANNEL_ID));
    await waitFor(() => expect(result.current.messages).toHaveLength(MESSAGE_PAGE_SIZE));

    mocks.fetchMessages.mockResolvedValueOnce([
      await makeRow('older-1', bob, 'de eerste', [alice, bob], '2026-09-08T08:00:00.000Z'),
    ]);

    await act(async () => {
      await result.current.loadOlder();
    });

    await waitFor(() => expect(result.current.reachedStart).toBe(true));
  });

  it('ignores a second request while one is still in flight', async () => {
    mocks.fetchMessages.mockResolvedValueOnce(await fullFirstPage());
    const { result } = renderHook(() => useMessages(CHANNEL_ID));
    await waitFor(() => expect(result.current.messages).toHaveLength(MESSAGE_PAGE_SIZE));

    let release: (rows: MessageRow[]) => void = () => {};
    mocks.fetchMessages.mockReturnValueOnce(
      new Promise<MessageRow[]>((resolve) => {
        release = resolve;
      }),
    );

    await act(async () => {
      // A scroll handler fires many times per second; only one request may go.
      const first = result.current.loadOlder();
      const second = result.current.loadOlder();
      release([]);
      await Promise.all([first, second]);
    });

    expect(mocks.fetchMessages).toHaveBeenCalledTimes(2);
  });
});

describe('losing and regaining the realtime connection', () => {
  it('reports the connection as down and back up', async () => {
    const { result } = renderHook(() => useMessages(CHANNEL_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.connected).toBe(true);

    await act(async () => {
      emitStatus('disconnected');
    });
    expect(result.current.connected).toBe(false);

    await act(async () => {
      emitStatus('connected');
    });
    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it('fetches what it missed on reconnect and merges it without duplicates', async () => {
    const onScreen = await makeRow('m1', bob, 'voor de storing', [alice, bob], '2026-09-08T10:00:00.000Z');
    mocks.fetchMessages.mockResolvedValueOnce([onScreen]);

    const { result } = renderHook(() => useMessages(CHANNEL_ID));
    await waitFor(() => expect(result.current.messages[0]?.text).toBe('voor de storing'));

    const missed = await makeRow('m2', bob, 'tijdens de storing', [alice, bob], '2026-09-08T10:05:00.000Z');
    // The catch-up query overlaps with what is already on screen, and the
    // subscription redelivers one of them too. Neither may duplicate.
    mocks.fetchMessagesSince.mockResolvedValueOnce([onScreen, missed]);

    await act(async () => {
      emitStatus('disconnected');
    });
    await act(async () => {
      emitStatus('connected');
    });
    await act(async () => {
      emit(missed);
    });

    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(mocks.fetchMessagesSince).toHaveBeenCalledWith(CHANNEL_ID, onScreen.created_at);
    await waitFor(() =>
      expect(result.current.messages.map((message) => message.text)).toEqual([
        'voor de storing',
        'tijdens de storing',
      ]),
    );
    const ids = result.current.messages.map((message) => message.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not catch up when the first subscribe succeeds', async () => {
    const { result } = renderHook(() => useMessages(CHANNEL_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mocks.fetchMessages.mockClear();
    mocks.fetchMessagesSince.mockClear();
    await act(async () => {
      emitStatus('connected');
    });

    // Nothing was missed, so nothing is refetched.
    expect(mocks.fetchMessages).not.toHaveBeenCalled();
    expect(mocks.fetchMessagesSince).not.toHaveBeenCalled();
  });
});

/*
 * Bewerken.
 *
 * De vraag die hier bewaakt wordt is niet "wordt updateMessage aangeroepen"
 * maar "wordt de nieuwe tekst opnieuw versleuteld, en voor wie". Een bewerking
 * die de oude ciphertext laat staan of die versleutelt voor de leden van toen
 * is stiller stuk dan een bewerking die faalt.
 */
describe('editing a message', () => {
  it('re-encrypts the new text for the members as they are now', async () => {
    const own = await makeRow('m1', alice, 'typfout', [alice, bob]);
    mocks.fetchMessages.mockResolvedValue([own]);

    const { result } = renderHook(() => useMessages(CHANNEL_ID));
    await waitFor(() => expect(result.current.messages[0]?.text).toBe('typfout'));

    // Carol is er sinds het oorspronkelijke bericht bij gekomen.
    mocks.getPublicKeysForChannel.mockResolvedValue([
      ...members,
      {
        userId: carol.userId,
        username: carol.username,
        publicKey: carol.publicKey,
        fingerprint: null,
        displayName: null,
        avatarUrl: null,
      },
    ]);

    let stored = '';
    mocks.updateMessage.mockImplementation(async (_id: string, ciphertext: string) => {
      stored = ciphertext;
      return { ...own, ciphertext, edited_at: '2026-09-08T12:00:00.000Z' };
    });

    await act(async () => {
      await result.current.edit('m1', 'geen typfout meer');
    });

    // De opgeslagen ciphertext is nieuw, en niet de oude.
    expect(stored).not.toBe(own.ciphertext);
    expect(stored).toContain('BEGIN PGP MESSAGE');

    // Carol kan hem lezen, dus er is versleuteld voor de huidige ledenlijst.
    const forCarol = await decryptMessage({
      ciphertext: stored,
      privateKey: carol.privateKey,
      senderPublicKey: alice.publicKey,
    });
    expect(forCarol.plaintext).toBe('geen typfout meer');
    expect(forCarol.signatureValid).toBe(true);
  });

  it('shows the new text and the edited stamp without decrypting again', async () => {
    const own = await makeRow('m1', alice, 'eerst', [alice, bob]);
    mocks.fetchMessages.mockResolvedValue([own]);

    const { result } = renderHook(() => useMessages(CHANNEL_ID));
    await waitFor(() => expect(result.current.messages[0]?.text).toBe('eerst'));

    mocks.updateMessage.mockImplementation(async (_id: string, ciphertext: string) => ({
      ...own,
      ciphertext,
      edited_at: '2026-09-08T12:00:00.000Z',
    }));

    await act(async () => {
      await result.current.edit('m1', 'daarna');
    });

    await waitFor(() => {
      expect(result.current.messages[0]?.text).toBe('daarna');
      expect(result.current.messages[0]?.editedAt).toBe('2026-09-08T12:00:00.000Z');
    });
  });

  it('ignores an empty edit instead of storing a blank message', async () => {
    const own = await makeRow('m1', alice, 'blijft staan', [alice, bob]);
    mocks.fetchMessages.mockResolvedValue([own]);

    const { result } = renderHook(() => useMessages(CHANNEL_ID));
    await waitFor(() => expect(result.current.messages[0]?.text).toBe('blijft staan'));

    await act(async () => {
      await result.current.edit('m1', '   ');
    });

    expect(mocks.updateMessage).not.toHaveBeenCalled();
    expect(result.current.messages[0]?.text).toBe('blijft staan');
  });

  it('picks up an edit from somebody else over realtime and drops the cache', async () => {
    const theirs = await makeRow('m1', bob, 'oude tekst', [alice, bob]);
    mocks.fetchMessages.mockResolvedValue([theirs]);

    const { result } = renderHook(() => useMessages(CHANNEL_ID));
    await waitFor(() => expect(result.current.messages[0]?.text).toBe('oude tekst'));

    const edited = {
      ...theirs,
      ciphertext: await encryptMessage({
        plaintext: 'nieuwe tekst',
        recipientPublicKeys: [alice.publicKey, bob.publicKey],
        signingKey: bob.privateKey,
      }),
      edited_at: '2026-09-08T12:00:00.000Z',
    };

    await act(async () => {
      emitUpdate(edited);
    });

    // Zonder het wissen van de cache zou hier nog "oude tekst" staan met een
    // "(bewerkt)"-label eronder, en dat is erger dan geen bewerkingen.
    await waitFor(() => expect(result.current.messages[0]?.text).toBe('nieuwe tekst'));
    expect(result.current.messages[0]?.editedAt).toBe('2026-09-08T12:00:00.000Z');
  });
});

describe('deleting a message', () => {
  it('leaves a tombstone in place instead of a gap', async () => {
    const own = await makeRow('m1', alice, 'weg hiermee', [alice, bob]);
    const other = await makeRow('m2', bob, 'blijft', [alice, bob], '2026-09-08T10:05:00.000Z');
    mocks.fetchMessages.mockResolvedValue([own, other]);

    const { result } = renderHook(() => useMessages(CHANNEL_ID));
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    mocks.deleteMessage.mockResolvedValue({
      ...own,
      ciphertext: '',
      deleted_at: '2026-09-08T12:00:00.000Z',
    });

    await act(async () => {
      await result.current.remove('m1');
    });

    await waitFor(() => {
      // Nog steeds twee rijen: het bericht verdwijnt niet uit het gesprek.
      expect(result.current.messages).toHaveLength(2);
      expect(result.current.messages[0]?.deleted).toBe(true);
      // En de tekst is weg, ook uit de lokale cache.
      expect(result.current.messages[0]?.text).toBeNull();
    });
    expect(result.current.messages[1]?.text).toBe('blijft');
  });

  it('never hands an empty ciphertext to the crypto layer', async () => {
    // Een verwijderd bericht heeft geen ciphertext meer. OpenPGP zou daarop
    // gooien, en dat zou als een ontsleutelfout in de console belanden bij
    // elke keer dat het gesprek geladen wordt.
    const tombstone: MessageRow = {
      id: 'm-verwijderd',
      channel_id: CHANNEL_ID,
      sender_id: bob.userId,
      ciphertext: '',
      created_at: '2026-09-08T10:00:00.000Z',
      edited_at: null,
      deleted_at: '2026-09-08T11:00:00.000Z',
      reply_to_id: null,
    };
    mocks.fetchMessages.mockResolvedValue([tombstone]);

    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useMessages(CHANNEL_ID));

    await waitFor(() => expect(result.current.messages[0]?.deleted).toBe(true));
    expect(result.current.messages[0]?.unreadable).toBe(false);
    expect(errors).not.toHaveBeenCalled();

    errors.mockRestore();
  });
});

describe('replies', () => {
  it('passes the reply target to the insert and keeps it on a retry', async () => {
    const { result } = renderHook(() => useMessages(CHANNEL_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    mocks.sendMessage.mockRejectedValueOnce(new Error('netwerk weg'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
      await result.current.send('antwoordje', 'm-origineel');
    });

    expect(mocks.sendMessage).toHaveBeenLastCalledWith(
      CHANNEL_ID,
      expect.stringContaining('BEGIN PGP MESSAGE'),
      'm-origineel',
    );

    const failed = result.current.messages.find((message) => message.status === 'failed');
    expect(failed).toBeDefined();

    mocks.sendMessage.mockImplementation(
      async (channelId: string, ciphertext: string, replyToId: string | null) => ({
        id: 'm-nieuw',
        channel_id: channelId,
        sender_id: alice.userId,
        ciphertext,
        created_at: '2026-09-08T11:00:00.000Z',
        edited_at: null,
        deleted_at: null,
        reply_to_id: replyToId,
      }),
    );

    await act(async () => {
      await result.current.retry(failed?.id ?? '');
    });

    // Een tweede poging antwoordt op hetzelfde bericht als de eerste.
    expect(mocks.sendMessage).toHaveBeenLastCalledWith(
      CHANNEL_ID,
      expect.any(String),
      'm-origineel',
    );
    errors.mockRestore();
  });

  it('fetches the original when it is not in the loaded page, and decrypts it', async () => {
    const original = await makeRow(
      'm-oud',
      bob,
      'de oorspronkelijke vraag',
      [alice, bob],
      '2026-09-01T10:00:00.000Z',
    );
    const answer: MessageRow = {
      ...(await makeRow('m-nieuw', alice, 'het antwoord', [alice, bob], '2026-09-08T10:00:00.000Z')),
      reply_to_id: 'm-oud',
    };

    mocks.fetchMessages.mockResolvedValue([answer]);
    mocks.fetchMessagesByIds.mockResolvedValue([original]);

    const { result } = renderHook(() => useMessages(CHANNEL_ID));

    await waitFor(() =>
      expect(result.current.messages[0]?.replyTo?.text).toBe('de oorspronkelijke vraag'),
    );
    expect(mocks.fetchMessagesByIds).toHaveBeenCalledWith(['m-oud']);
    expect(result.current.messages[0]?.replyTo?.senderName).toBe(bob.username);
    // Het origineel zelf hoort niet in het gesprek te verschijnen.
    expect(result.current.messages).toHaveLength(1);
  });

  it('does not fetch the original when it is already on screen', async () => {
    const original = await makeRow('m-1', bob, 'vraag', [alice, bob], '2026-09-08T10:00:00.000Z');
    const answer: MessageRow = {
      ...(await makeRow('m-2', alice, 'antwoord', [alice, bob], '2026-09-08T10:01:00.000Z')),
      reply_to_id: 'm-1',
    };
    mocks.fetchMessages.mockResolvedValue([original, answer]);

    const { result } = renderHook(() => useMessages(CHANNEL_ID));

    await waitFor(() => expect(result.current.messages[1]?.replyTo?.text).toBe('vraag'));
    expect(mocks.fetchMessagesByIds).not.toHaveBeenCalled();
  });

  it('marks the preview as deleted when the original was removed', async () => {
    const tombstone: MessageRow = {
      id: 'm-oud',
      channel_id: CHANNEL_ID,
      sender_id: bob.userId,
      ciphertext: '',
      created_at: '2026-09-01T10:00:00.000Z',
      edited_at: null,
      deleted_at: '2026-09-02T10:00:00.000Z',
      reply_to_id: null,
    };
    const answer: MessageRow = {
      ...(await makeRow('m-nieuw', alice, 'antwoord', [alice, bob])),
      reply_to_id: 'm-oud',
    };

    mocks.fetchMessages.mockResolvedValue([answer]);
    mocks.fetchMessagesByIds.mockResolvedValue([tombstone]);

    const { result } = renderHook(() => useMessages(CHANNEL_ID));

    await waitFor(() => expect(result.current.messages[0]?.replyTo?.deleted).toBe(true));
    // Verwijderd is iets anders dan onvindbaar, en dat verschil moet zichtbaar
    // blijven: het eerste is een keuze van de afzender, het tweede een gat.
    expect(result.current.messages[0]?.replyTo?.missing).toBe(false);
  });
});
