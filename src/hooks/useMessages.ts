import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  decryptMessage,
  encryptMessage,
  getUnlockedKey,
  KeyLockedError,
  MissingSelfKeyError,
  NotARecipientError,
} from '../lib/crypto';
import { getPublicKeysForChannel } from '../lib/supabase/profiles';
import { fetchMessages, sendMessage, subscribeToChannel } from '../lib/supabase/messages';
import type { ChannelMemberKey, MessageRow } from '../types';
import { useAuth } from './useAuth';

export type MessageStatus = 'sent' | 'pending' | 'failed';

export interface DisplayMessage {
  /** Message id, or a local id while the insert is still in flight. */
  id: string;
  senderId: string;
  senderName: string;
  createdAt: string;
  status: MessageStatus;
  /** Decrypted text, or null while decrypting or when unreadable. */
  text: string | null;
  /** true/false after verification, null when the sender key is unknown. */
  signatureValid: boolean | null;
  /** This message was never encrypted to us: from before we joined. */
  unreadable: boolean;
}

interface DecryptedEntry {
  text: string | null;
  signatureValid: boolean | null;
  unreadable: boolean;
}

interface PendingMessage {
  localId: string;
  plaintext: string;
  createdAt: string;
  status: 'pending' | 'failed';
}

export interface UseMessagesResult {
  messages: DisplayMessage[];
  members: ChannelMemberKey[];
  /** Members we cannot encrypt to, because their profile has no public key. */
  membersWithoutKey: ChannelMemberKey[];
  loading: boolean;
  /** Set when something went wrong that the user should see. */
  error: string | null;
  send(plaintext: string): Promise<void>;
  retry(localId: string): Promise<void>;
  dismiss(localId: string): void;
}

/** Decrypt in small batches so a channel of 50 messages cannot freeze the UI. */
const DECRYPT_BATCH_SIZE = 5;

function byCreatedAt(a: MessageRow, b: MessageRow): number {
  if (a.created_at === b.created_at) {
    return a.id < b.id ? -1 : 1;
  }
  return a.created_at < b.created_at ? -1 : 1;
}

/** Merges rows into the list, dropping duplicates by id. */
function mergeRows(current: MessageRow[], incoming: MessageRow[]): MessageRow[] {
  const byId = new Map(current.map((row) => [row.id, row]));
  let changed = false;

  for (const row of incoming) {
    if (!byId.has(row.id)) {
      byId.set(row.id, row);
      changed = true;
    }
  }

  return changed ? [...byId.values()].sort(byCreatedAt) : current;
}

export function useMessages(channelId: string | null): UseMessagesResult {
  const { user, lock } = useAuth();
  const currentUserId = user?.id ?? null;

  const [rows, setRows] = useState<MessageRow[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [members, setMembers] = useState<ChannelMemberKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Decrypted text is cached by message id: decrypting on every render would
  // be both slow and pointless, the ciphertext never changes.
  const decryptedRef = useRef(new Map<string, DecryptedEntry>());
  const startedRef = useRef(new Set<string>());
  const [decryptedVersion, setDecryptedVersion] = useState(0);

  const membersRef = useRef<ChannelMemberKey[]>([]);
  membersRef.current = members;

  useEffect(() => {
    decryptedRef.current = new Map();
    startedRef.current = new Set();
    setRows([]);
    setPending([]);
    setMembers([]);
    setError(null);

    if (!channelId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    let cancelled = false;
    let ready = false;
    const buffered: MessageRow[] = [];

    // Subscribe BEFORE fetching. The other way around leaves a gap: anything
    // inserted between the fetch and the subscription would be lost until the
    // next reload. Rows arriving before the fetch lands are buffered.
    const unsubscribe = subscribeToChannel(channelId, (row) => {
      if (cancelled) {
        return;
      }
      if (ready) {
        setRows((current) => mergeRows(current, [row]));
      } else {
        buffered.push(row);
      }
    });

    void (async () => {
      try {
        const [fetched, channelMembers] = await Promise.all([
          fetchMessages(channelId),
          getPublicKeysForChannel(channelId),
        ]);
        if (cancelled) {
          return;
        }

        setMembers(channelMembers);
        membersRef.current = channelMembers;
        ready = true;
        // Duplicates between the buffer and the fetch are removed by id.
        setRows((current) => mergeRows(current, [...fetched, ...buffered]));
      } catch (caught) {
        if (!cancelled) {
          console.error('Kon berichten niet laden:', caught);
          setError('Berichten konden niet geladen worden.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [channelId]);

  const decryptRow = useCallback(
    async (row: MessageRow): Promise<DecryptedEntry> => {
      const sender = membersRef.current.find((member) => member.userId === row.sender_id);

      try {
        const result = await decryptMessage({
          ciphertext: row.ciphertext,
          privateKey: getUnlockedKey(),
          senderPublicKey: sender?.publicKey ?? undefined,
        });
        return {
          text: result.plaintext,
          signatureValid: result.signatureValid,
          unreadable: false,
        };
      } catch (caught) {
        if (caught instanceof NotARecipientError) {
          // Expected for anything sent before we joined this channel.
          return { text: null, signatureValid: null, unreadable: true };
        }
        if (caught instanceof KeyLockedError) {
          lock();
          return { text: null, signatureValid: null, unreadable: true };
        }
        // Log the error, never the ciphertext or the plaintext.
        console.error('Ontsleutelen mislukt voor bericht', row.id, caught);
        return { text: null, signatureValid: null, unreadable: true };
      }
    },
    [lock],
  );

  useEffect(() => {
    const todo = rows.filter((row) => !startedRef.current.has(row.id));
    if (todo.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      for (let index = 0; index < todo.length; index += DECRYPT_BATCH_SIZE) {
        if (cancelled) {
          return;
        }

        const batch = todo.slice(index, index + DECRYPT_BATCH_SIZE);
        await Promise.all(
          batch.map(async (row) => {
            startedRef.current.add(row.id);
            decryptedRef.current.set(row.id, await decryptRow(row));
          }),
        );

        if (cancelled) {
          return;
        }
        setDecryptedVersion((version) => version + 1);
        // Hand the browser a frame before chewing through the next batch.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rows, decryptRow]);

  /** Encrypts to every current member and inserts the row. */
  const deliver = useCallback(
    async (localId: string, plaintext: string): Promise<void> => {
      if (!channelId) {
        return;
      }

      try {
        // Always re-read the member list. A cached list would silently exclude
        // anyone who joined since, leaving them unable to read this message.
        const channelMembers = await getPublicKeysForChannel(channelId);
        setMembers(channelMembers);
        membersRef.current = channelMembers;

        // A member whose profile has no public key cannot be encrypted to.
        // Skip them here rather than letting encryptMessage fail on the whole
        // message; the UI shows who is being left out.
        const recipients = channelMembers.filter(
          (member): member is ChannelMemberKey & { publicKey: string } => member.publicKey !== null,
        );

        if (currentUserId && !recipients.some((member) => member.userId === currentUserId)) {
          throw new MissingSelfKeyError();
        }

        // Scaling limit: OpenPGP wraps the session key once per recipient, so
        // the ciphertext grows linearly with the number of members. Fine for a
        // DM or a small channel; a channel with hundreds of members will need
        // a different approach (sender keys, or per-channel key rotation).
        const ciphertext = await encryptMessage({
          plaintext,
          recipientPublicKeys: recipients.map((member) => member.publicKey),
          signingKey: getUnlockedKey(),
        });

        const row = await sendMessage(channelId, ciphertext);

        // We already know this plaintext, so skip a pointless decrypt round.
        decryptedRef.current.set(row.id, {
          text: plaintext,
          signatureValid: true,
          unreadable: false,
        });
        startedRef.current.add(row.id);
        setDecryptedVersion((version) => version + 1);

        // The realtime subscription delivers this same row again; mergeRows
        // drops the duplicate by id.
        setRows((current) => mergeRows(current, [row]));
        setPending((current) => current.filter((item) => item.localId !== localId));
      } catch (caught) {
        setPending((current) =>
          current.map((item) =>
            item.localId === localId ? { ...item, status: 'failed' } : item,
          ),
        );

        if (caught instanceof KeyLockedError) {
          setError('Je sleutel is vergrendeld. Ontgrendel om verder te praten.');
          lock();
          return;
        }
        if (caught instanceof MissingSelfKeyError) {
          // Not a user mistake: our own key is missing from the member list.
          console.error('Bug: eigen sleutel ontbreekt in de ledenlijst', caught);
          setError('Interne fout: je eigen sleutel ontbreekt in dit kanaal. Meld dit.');
          return;
        }
        console.error('Versturen mislukt:', caught);
        setError('Bericht kon niet verstuurd worden.');
      }
    },
    [channelId, currentUserId, lock],
  );

  const send = useCallback(
    async (plaintext: string): Promise<void> => {
      const trimmed = plaintext.trim();
      if (!trimmed || !channelId) {
        return;
      }

      setError(null);
      const localId = `local-${crypto.randomUUID()}`;
      // Optimistic: show it immediately, replace it when the insert returns.
      setPending((current) => [
        ...current,
        { localId, plaintext: trimmed, createdAt: new Date().toISOString(), status: 'pending' },
      ]);

      await deliver(localId, trimmed);
    },
    [channelId, deliver],
  );

  const retry = useCallback(
    async (localId: string): Promise<void> => {
      const item = pending.find((candidate) => candidate.localId === localId);
      if (!item) {
        return;
      }

      setError(null);
      setPending((current) =>
        current.map((candidate) =>
          candidate.localId === localId ? { ...candidate, status: 'pending' } : candidate,
        ),
      );
      await deliver(localId, item.plaintext);
    },
    [deliver, pending],
  );

  /** Drops a failed message the user does not want to retry. */
  const dismiss = useCallback((localId: string): void => {
    setPending((current) => current.filter((item) => item.localId !== localId));
  }, []);

  const messages = useMemo<DisplayMessage[]>(() => {
    const nameFor = (userId: string): string =>
      members.find((member) => member.userId === userId)?.username ?? 'onbekend';

    const sent: DisplayMessage[] = rows.map((row) => {
      const entry = decryptedRef.current.get(row.id);
      return {
        id: row.id,
        senderId: row.sender_id,
        senderName: nameFor(row.sender_id),
        createdAt: row.created_at,
        status: 'sent',
        text: entry?.text ?? null,
        signatureValid: entry?.signatureValid ?? null,
        unreadable: entry?.unreadable ?? false,
      };
    });

    const optimistic: DisplayMessage[] = pending.map((item) => ({
      id: item.localId,
      senderId: currentUserId ?? '',
      senderName: currentUserId ? nameFor(currentUserId) : 'jij',
      createdAt: item.createdAt,
      status: item.status,
      text: item.plaintext,
      signatureValid: null,
      unreadable: false,
    }));

    return [...sent, ...optimistic];
    // decryptedVersion is the signal that the cache changed; the ref itself
    // never changes identity.
  }, [rows, pending, members, currentUserId, decryptedVersion]);

  const membersWithoutKey = useMemo(
    () => members.filter((member) => member.publicKey === null),
    [members],
  );

  return { messages, members, membersWithoutKey, loading, error, send, retry, dismiss };
}
