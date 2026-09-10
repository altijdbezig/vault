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
import {
  deleteMessage,
  fetchMessages,
  fetchMessagesByIds,
  fetchMessagesSince,
  MESSAGE_PAGE_SIZE,
  sendMessage,
  subscribeToChannel,
  updateMessage,
} from '../lib/supabase/messages';
import type { ChannelMemberKey, MessageRow } from '../types';
import { useAuth } from './useAuth';

export type MessageStatus = 'sent' | 'pending' | 'failed';

/** The message a reply points at, as far as we can resolve it. */
export interface ReplyPreview {
  id: string;
  senderName: string;
  /** Decrypted text, or null while decrypting or when unreadable. */
  text: string | null;
  /** The original was deleted by its sender. */
  deleted: boolean;
  /** The original could not be fetched at all (gone, or another channel). */
  missing: boolean;
}

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
  /** When the sender last edited it, for the "(bewerkt)" label. */
  editedAt: string | null;
  /** Deleted by its sender. The ciphertext is gone; only a tombstone is left. */
  deleted: boolean;
  /** The message this one answers, resolved for display. Null when it is not a reply. */
  replyTo: ReplyPreview | null;
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
  /** Kept so a retry answers the same message the first attempt did. */
  replyToId: string | null;
}

export interface UseMessagesResult {
  messages: DisplayMessage[];
  members: ChannelMemberKey[];
  /** Members we cannot encrypt to, because their profile has no public key. */
  membersWithoutKey: ChannelMemberKey[];
  loading: boolean;
  /** True while a page of older messages is on its way in. */
  loadingOlder: boolean;
  /** True once we have seen the very first message of the channel. */
  reachedStart: boolean;
  /** False while the realtime socket is down, so the UI can say so. */
  connected: boolean;
  /** Set when something went wrong that the user should see. */
  error: string | null;
  /** Fetches the page before the oldest message we hold. */
  loadOlder(): Promise<void>;
  /** Sends a message, optionally as a reply to another one. */
  send(plaintext: string, replyToId?: string | null): Promise<void>;
  retry(localId: string): Promise<void>;
  dismiss(localId: string): void;
  /** Re-encrypts your own message for the current members and stores it. */
  edit(messageId: string, plaintext: string): Promise<void>;
  /** Soft-deletes your own message and blanks its ciphertext. */
  remove(messageId: string): Promise<void>;
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

/**
 * Replaces one row in place, for an edit or a deletion.
 *
 * Separate from mergeRows, which ignores ids it already has. That is the right
 * behaviour for an insert arriving twice (our own send, then the realtime echo)
 * and the wrong behaviour for an update, where the whole point is that the
 * content changed. Keeping them apart means neither has to guess which case it
 * is looking at.
 *
 * A row we do not have is ignored rather than appended: an edit to a message
 * from before the loaded window should not make that message appear halfway up
 * the conversation.
 */
function replaceRow(current: MessageRow[], row: MessageRow): MessageRow[] {
  const index = current.findIndex((candidate) => candidate.id === row.id);
  if (index === -1) {
    return current;
  }

  const next = [...current];
  next[index] = row;
  return next;
}

export function useMessages(channelId: string | null): UseMessagesResult {
  const { user, lock } = useAuth();
  const currentUserId = user?.id ?? null;

  const [rows, setRows] = useState<MessageRow[]>([]);
  /**
   * Messages that are only here because a loaded message replies to them.
   *
   * Kept apart from `rows` on purpose: a parent can sit far above the loaded
   * window, and putting it in `rows` would make it appear halfway up the
   * conversation as if it had just been sent.
   */
  const [parents, setParents] = useState<Record<string, MessageRow>>({});
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [members, setMembers] = useState<ChannelMemberKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
  const [connected, setConnected] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Guards the paging request against a scroll handler that fires many times
  // per second. A ref, not the state above: state updates land too late.
  const loadingOlderRef = useRef(false);

  // Decrypted text is cached by message id: decrypting on every render would
  // be both slow and pointless, the ciphertext never changes.
  const decryptedRef = useRef(new Map<string, DecryptedEntry>());
  const startedRef = useRef(new Set<string>());
  /** Reply parents already asked for, so a missing one is not retried forever. */
  const attemptedParentsRef = useRef(new Set<string>());
  const [decryptedVersion, setDecryptedVersion] = useState(0);

  const membersRef = useRef<ChannelMemberKey[]>([]);
  membersRef.current = members;

  // Read by the reconnect handler, which is created once per channel and
  // would otherwise catch up from whatever the newest message was on mount.
  const rowsRef = useRef<MessageRow[]>([]);
  rowsRef.current = rows;

  useEffect(() => {
    decryptedRef.current = new Map();
    startedRef.current = new Set();
    attemptedParentsRef.current = new Set();
    setRows([]);
    setParents({});
    setPending([]);
    setMembers([]);
    setError(null);
    setLoadingOlder(false);
    setReachedStart(false);
    setConnected(true);
    loadingOlderRef.current = false;

    if (!channelId) {
      setLoading(false);
      return;
    }

    setLoading(true);

    let cancelled = false;
    let ready = false;
    const buffered: MessageRow[] = [];

    // True once the socket has dropped at least once, so a first successful
    // subscribe does not trigger a pointless catch-up.
    let wasDisconnected = false;

    /**
     * Fetches whatever arrived while the socket was down.
     *
     * Merged by id like everything else, so a message that both the catch-up
     * and the subscription delivered appears once. The page is not reloaded:
     * that would throw away the decrypted messages already on screen and make
     * the user unlock nothing but re-decrypt everything.
     */
    async function catchUp(): Promise<void> {
      if (cancelled || !ready || !channelId) {
        return;
      }
      const newest = rowsRef.current[rowsRef.current.length - 1];
      try {
        const missed = newest
          ? await fetchMessagesSince(channelId, newest.created_at)
          : await fetchMessages(channelId);
        if (!cancelled && missed.length > 0) {
          setRows((current) => mergeRows(current, missed));
        }
      } catch (caught) {
        console.error('Kon gemiste berichten niet ophalen:', caught);
      }
    }

    // Subscribe BEFORE fetching. The other way around leaves a gap: anything
    // inserted between the fetch and the subscription would be lost until the
    // next reload. Rows arriving before the fetch lands are buffered.
    /**
     * An edit or a deletion came in for a message we hold.
     *
     * The cached plaintext has to go with it, or the old text stays on screen
     * under a "(bewerkt)" label — which is worse than not supporting edits.
     * Dropping it from both maps is what puts the row back in the decrypt
     * queue below.
     */
    function applyUpdate(row: MessageRow): void {
      if (cancelled) {
        return;
      }
      decryptedRef.current.delete(row.id);
      startedRef.current.delete(row.id);
      setRows((current) => replaceRow(current, row));
      setParents((current) =>
        // Also update it as a reply parent, so a preview of an edited message
        // shows the edit rather than the version from when it was fetched.
        current[row.id] ? { ...current, [row.id]: row } : current,
      );
    }

    const unsubscribe = subscribeToChannel(
      channelId,
      (row) => {
        if (cancelled) {
          return;
        }
        if (ready) {
          setRows((current) => mergeRows(current, [row]));
        } else {
          buffered.push(row);
        }
      },
      (status) => {
        if (cancelled) {
          return;
        }
        setConnected(status === 'connected');

        if (status === 'disconnected') {
          wasDisconnected = true;
          return;
        }
        if (wasDisconnected) {
          wasDisconnected = false;
          void catchUp();
        }
      },
      applyUpdate,
    );

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
        // A short first page means there is nothing older to page back to.
        if (fetched.length < MESSAGE_PAGE_SIZE) {
          setReachedStart(true);
        }
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
      // A deleted message has no ciphertext left (see deleteMessage). Handing
      // an empty string to OpenPGP would throw, and the tombstone does not
      // need a decrypt to be rendered.
      if (row.deleted_at !== null || row.ciphertext === '') {
        return { text: null, signatureValid: null, unreadable: false };
      }

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
    // Reply parents are decrypted through the same queue and the same cache.
    // A parent that also happens to be on screen is therefore decrypted once,
    // not twice, because startedRef is keyed by message id.
    const todo = [...rows, ...Object.values(parents)].filter(
      (row) => !startedRef.current.has(row.id),
    );
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
  }, [rows, parents, decryptRow]);

  /**
   * Fetches the messages that loaded messages reply to.
   *
   * Only the ones that are not already on screen: in a normal conversation the
   * original is usually a few lines up, and then there is nothing to fetch.
   * Ids that come back empty (deleted for good, or from a channel RLS will not
   * show us) stay in attemptedParentsRef so this does not retry them forever.
   */
  useEffect(() => {
    if (!channelId) {
      return;
    }

    const have = new Set(rows.map((row) => row.id));
    const wanted = rows
      .map((row) => row.reply_to_id)
      .filter((id): id is string => id !== null && !have.has(id))
      .filter((id) => !attemptedParentsRef.current.has(id));

    if (wanted.length === 0) {
      return;
    }

    for (const id of wanted) {
      attemptedParentsRef.current.add(id);
    }

    let cancelled = false;

    void (async () => {
      try {
        const fetched = await fetchMessagesByIds(wanted);
        if (cancelled || fetched.length === 0) {
          return;
        }
        setParents((current) => {
          const next = { ...current };
          for (const row of fetched) {
            next[row.id] = row;
          }
          return next;
        });
      } catch (caught) {
        // A missing preview is a line of grey text, not an error screen.
        console.error('Kon originele berichten voor antwoorden niet laden:', caught);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [channelId, rows]);

  /**
   * Loads the page of messages before the oldest one we hold.
   *
   * mergeRows deduplicates by id, so a page that overlaps with what is already
   * on screen cannot produce a second copy of anything. The decrypt effect
   * picks the new rows up on its own and works through them in the same
   * batches as the first page.
   */
  const loadOlder = useCallback(async (): Promise<void> => {
    const oldest = rows[0];
    if (!channelId || !oldest || reachedStart || loadingOlderRef.current) {
      return;
    }

    loadingOlderRef.current = true;
    setLoadingOlder(true);

    try {
      const older = await fetchMessages(channelId, { before: oldest.created_at });
      if (older.length < MESSAGE_PAGE_SIZE) {
        setReachedStart(true);
      }
      setRows((current) => mergeRows(current, older));
    } catch (caught) {
      console.error('Kon oudere berichten niet laden:', caught);
      setError('Oudere berichten konden niet geladen worden.');
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [channelId, reachedStart, rows]);

  /**
   * Encrypts plaintext for every member who has a key.
   *
   * Shared by sending and editing, because the recipient set is decided the
   * same way in both cases: whoever is in the channel right now. Editing a
   * message therefore re-encrypts it for the current members, not the members
   * it was originally sent to.
   */
  const encryptForChannel = useCallback(
    async (channel: string, plaintext: string): Promise<string> => {
      // Always re-read the member list. A cached list would silently exclude
      // anyone who joined since, leaving them unable to read this message.
      const channelMembers = await getPublicKeysForChannel(channel);
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
      return await encryptMessage({
        plaintext,
        recipientPublicKeys: recipients.map((member) => member.publicKey),
        signingKey: getUnlockedKey(),
      });
    },
    [currentUserId],
  );

  /** Encrypts to every current member and inserts the row. */
  const deliver = useCallback(
    async (localId: string, plaintext: string, replyToId: string | null): Promise<void> => {
      if (!channelId) {
        return;
      }

      try {
        const ciphertext = await encryptForChannel(channelId, plaintext);
        const row = await sendMessage(channelId, ciphertext, replyToId);

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
    [channelId, encryptForChannel, lock],
  );

  const send = useCallback(
    async (plaintext: string, replyToId: string | null = null): Promise<void> => {
      const trimmed = plaintext.trim();
      if (!trimmed || !channelId) {
        return;
      }

      setError(null);
      const localId = `local-${crypto.randomUUID()}`;
      // Optimistic: show it immediately, replace it when the insert returns.
      setPending((current) => [
        ...current,
        {
          localId,
          plaintext: trimmed,
          createdAt: new Date().toISOString(),
          status: 'pending',
          replyToId,
        },
      ]);

      await deliver(localId, trimmed, replyToId);
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
      await deliver(localId, item.plaintext, item.replyToId);
    },
    [deliver, pending],
  );

  /** Drops a failed message the user does not want to retry. */
  const dismiss = useCallback((localId: string): void => {
    setPending((current) => current.filter((item) => item.localId !== localId));
  }, []);

  /**
   * Re-encrypts one of your own messages and replaces the stored ciphertext.
   *
   * The recipient set is whoever is in the channel now, which is not
   * necessarily who the original was encrypted for. Anyone who has left keeps
   * whatever copy they already decrypted; there is no way around that and no
   * point pretending otherwise.
   *
   * RLS is what actually enforces "your own message" — the update policy
   * requires sender_id = auth.uid(). The UI only offers the option on your own
   * messages, which is a convenience, not the check.
   */
  const edit = useCallback(
    async (messageId: string, plaintext: string): Promise<void> => {
      const trimmed = plaintext.trim();
      if (!channelId || trimmed === '') {
        return;
      }

      setError(null);

      try {
        const ciphertext = await encryptForChannel(channelId, trimmed);
        const row = await updateMessage(messageId, ciphertext);

        // The plaintext is already known, so skip a decrypt round. signature
        // valid: we just signed it.
        decryptedRef.current.set(row.id, {
          text: trimmed,
          signatureValid: true,
          unreadable: false,
        });
        startedRef.current.add(row.id);
        setDecryptedVersion((version) => version + 1);
        setRows((current) => replaceRow(current, row));
      } catch (caught) {
        if (caught instanceof KeyLockedError) {
          setError('Je sleutel is vergrendeld. Ontgrendel om verder te praten.');
          lock();
          return;
        }
        console.error('Bewerken mislukt:', caught);
        setError('Bericht kon niet bewerkt worden.');
      }
    },
    [channelId, encryptForChannel, lock],
  );

  /**
   * Deletes one of your own messages.
   *
   * The row survives and the ciphertext is blanked; see deleteMessage for why
   * both halves are needed. The cached plaintext is dropped here as well,
   * otherwise the text stays on your own screen under a tombstone.
   */
  const remove = useCallback(async (messageId: string): Promise<void> => {
    setError(null);

    try {
      const row = await deleteMessage(messageId);

      decryptedRef.current.delete(row.id);
      startedRef.current.add(row.id);
      setDecryptedVersion((version) => version + 1);
      setRows((current) => replaceRow(current, row));
    } catch (caught) {
      console.error('Verwijderen mislukt:', caught);
      setError('Bericht kon niet verwijderd worden.');
    }
  }, []);

  const messages = useMemo<DisplayMessage[]>(() => {
    const nameFor = (userId: string): string =>
      members.find((member) => member.userId === userId)?.username ?? 'onbekend';

    /**
     * Resolves the preview line above a reply.
     *
     * Three outcomes, and they need to look different: the original is here
     * and readable, the original was deleted, or we could not get it at all
     * (it points outside this channel, or the fetch has not landed yet). A
     * single "onbekend bericht" for all three would hide a deletion behind
     * what looks like a loading state.
     */
    const previewFor = (replyToId: string | null): ReplyPreview | null => {
      if (replyToId === null) {
        return null;
      }

      const parent =
        rows.find((row) => row.id === replyToId) ?? parents[replyToId] ?? null;

      if (!parent) {
        return {
          id: replyToId,
          senderName: 'onbekend',
          text: null,
          deleted: false,
          missing: !attemptedParentsRef.current.has(replyToId) ? false : true,
        };
      }

      const entry = decryptedRef.current.get(parent.id);
      return {
        id: parent.id,
        senderName: nameFor(parent.sender_id),
        text: entry?.text ?? null,
        deleted: parent.deleted_at !== null,
        missing: false,
      };
    };

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
        editedAt: row.edited_at ?? null,
        deleted: row.deleted_at !== null,
        replyTo: previewFor(row.reply_to_id ?? null),
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
      editedAt: null,
      deleted: false,
      replyTo: previewFor(item.replyToId),
    }));

    return [...sent, ...optimistic];
    // decryptedVersion is the signal that the cache changed; the ref itself
    // never changes identity.
  }, [rows, parents, pending, members, currentUserId, decryptedVersion]);

  const membersWithoutKey = useMemo(
    () => members.filter((member) => member.publicKey === null),
    [members],
  );

  return {
    messages,
    members,
    membersWithoutKey,
    loading,
    loadingOlder,
    reachedStart,
    connected,
    error,
    loadOlder,
    send,
    retry,
    dismiss,
    edit,
    remove,
  };
}
