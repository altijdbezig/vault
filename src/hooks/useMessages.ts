import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  decryptFile,
  decryptMessage,
  encryptFile,
  encryptMessage,
  getUnlockedKey,
  KeyLockedError,
  MissingSelfKeyError,
  NotARecipientError,
} from '../lib/crypto';
import {
  attachmentPath,
  downloadAttachment,
  MAX_ATTACHMENT_BYTES,
  removeAttachments,
  uploadAttachment,
} from '../lib/supabase/attachments';
import { decodePayload, encodePayload } from '../lib/messagePayload';
import type { AttachmentMeta } from '../lib/messagePayload';
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
import { UserFacingError } from '../lib/userFacingError';
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
  /**
   * Files that came with this message.
   *
   * The metadata (filename, size, type) lives inside the encrypted payload,
   * not in a column: a filename is content. See lib/messagePayload.ts.
   */
  attachments: AttachmentMeta[];
}

interface DecryptedEntry {
  text: string | null;
  signatureValid: boolean | null;
  unreadable: boolean;
  /** Attachment metadata from inside the encrypted payload. */
  attachments: AttachmentMeta[];
}

interface PendingMessage {
  localId: string;
  plaintext: string;
  createdAt: string;
  status: 'pending' | 'failed';
  /** Kept so a retry answers the same message the first attempt did. */
  replyToId: string | null;
  /**
   * Attachments that were already encrypted and uploaded.
   *
   * Kept on the pending row so a retry re-uses them instead of encrypting and
   * uploading the same file a second time. Only the insert failed; the bytes
   * are already in the bucket.
   */
  attachments: AttachmentMeta[];
}

/** What the upload of one message's attachments is doing right now. */
export interface AttachmentProgress {
  /** 1-based index of the file being worked on. */
  current: number;
  total: number;
  /** The name of that file, so the line says something concrete. */
  name: string;
  stage: 'encrypting' | 'uploading';
}

/** A file the user picked, rejected before anything is encrypted. */
export class AttachmentTooLargeError extends UserFacingError {
  constructor(name: string) {
    super(`"${name}" is groter dan 10 MB en kan niet verstuurd worden.`);
  }
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
  /** Sends a message, optionally as a reply and optionally with files. */
  send(plaintext: string, replyToId?: string | null, files?: readonly File[]): Promise<void>;
  /** What the current upload is doing, or null when nothing is uploading. */
  attachmentProgress: AttachmentProgress | null;
  /**
   * Downloads and decrypts one attachment.
   *
   * Returns a Blob and not an object URL on purpose: creating the URL is a DOM
   * concern and revoking it belongs to whichever component rendered it. A hook
   * handing out URLs it cannot see the lifetime of is how you leak them.
   */
  loadAttachment(meta: AttachmentMeta, senderId: string): Promise<Blob>;
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
  const [attachmentProgress, setAttachmentProgress] = useState<AttachmentProgress | null>(null);

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
    setAttachmentProgress(null);
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
        return { text: null, signatureValid: null, unreadable: false, attachments: [] };
      }

      const sender = membersRef.current.find((member) => member.userId === row.sender_id);

      try {
        const result = await decryptMessage({
          ciphertext: row.ciphertext,
          privateKey: getUnlockedKey(),
          senderPublicKey: sender?.publicKey ?? undefined,
        });
        // The plaintext may be an envelope carrying attachment metadata. A
        // message from before attachments existed decodes as bare text.
        const payload = decodePayload(result.plaintext);
        return {
          text: payload.text,
          signatureValid: result.signatureValid,
          unreadable: false,
          attachments: payload.attachments,
        };
      } catch (caught) {
        if (caught instanceof NotARecipientError) {
          // Expected for anything sent before we joined this channel.
          return { text: null, signatureValid: null, unreadable: true, attachments: [] };
        }
        if (caught instanceof KeyLockedError) {
          lock();
          return { text: null, signatureValid: null, unreadable: true, attachments: [] };
        }
        // Log the error, never the ciphertext or the plaintext.
        console.error('Ontsleutelen mislukt voor bericht', row.id, caught);
        return { text: null, signatureValid: null, unreadable: true, attachments: [] };
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

  /**
   * Encrypts and uploads the files for one message.
   *
   * Sequentially, not in parallel. Encrypting three 10 MB files at once means
   * holding six copies in memory and starving the tab of a main thread, and
   * the progress line can then only say "busy". One at a time is slower on a
   * fast connection and survives a phone.
   */
  const prepareAttachments = useCallback(
    async (channel: string, files: readonly File[]): Promise<AttachmentMeta[]> => {
      const prepared: AttachmentMeta[] = [];
      const memberKeys = (await getPublicKeysForChannel(channel))
        .map((member) => member.publicKey)
        .filter((key): key is string => key !== null);

      for (const [index, file] of files.entries()) {
        setAttachmentProgress({
          current: index + 1,
          total: files.length,
          name: file.name,
          stage: 'encrypting',
        });

        const bytes = new Uint8Array(await file.arrayBuffer());
        const ciphertext = await encryptFile({
          bytes,
          recipientPublicKeys: memberKeys,
          signingKey: getUnlockedKey(),
        });

        setAttachmentProgress({
          current: index + 1,
          total: files.length,
          name: file.name,
          stage: 'uploading',
        });

        const path = attachmentPath(channel);
        await uploadAttachment(path, ciphertext);

        prepared.push({
          path,
          name: file.name,
          size: file.size,
          // An empty type happens with some file pickers; octet-stream is the
          // honest fallback and renders as a plain download row.
          mimeType: file.type || 'application/octet-stream',
        });
      }

      return prepared;
    },
    [],
  );

  /** Encrypts to every current member and inserts the row. */
  const deliver = useCallback(
    async (
      localId: string,
      plaintext: string,
      replyToId: string | null,
      files: readonly File[],
      alreadyUploaded: AttachmentMeta[],
    ): Promise<void> => {
      if (!channelId) {
        return;
      }

      try {
        // A retry re-uses what was already uploaded: only the insert failed,
        // and the bytes are in the bucket.
        const attachments =
          alreadyUploaded.length > 0
            ? alreadyUploaded
            : files.length > 0
              ? await prepareAttachments(channelId, files)
              : [];

        if (attachments.length > 0) {
          // Remember them on the pending row before the insert, so a failure
          // here does not re-upload on the next attempt.
          setPending((current) =>
            current.map((item) =>
              item.localId === localId ? { ...item, attachments } : item,
            ),
          );
        }

        setAttachmentProgress(null);

        const payload = encodePayload({ text: plaintext, attachments });
        const ciphertext = await encryptForChannel(channelId, payload);
        const row = await sendMessage(channelId, ciphertext, replyToId);

        // We already know this plaintext, so skip a pointless decrypt round.
        decryptedRef.current.set(row.id, {
          text: plaintext,
          signatureValid: true,
          unreadable: false,
          attachments,
        });
        startedRef.current.add(row.id);
        setDecryptedVersion((version) => version + 1);

        // The realtime subscription delivers this same row again; mergeRows
        // drops the duplicate by id.
        setRows((current) => mergeRows(current, [row]));
        setPending((current) => current.filter((item) => item.localId !== localId));
      } catch (caught) {
        setAttachmentProgress(null);
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
    [channelId, encryptForChannel, lock, prepareAttachments],
  );

  const send = useCallback(
    async (
      plaintext: string,
      replyToId: string | null = null,
      files: readonly File[] = [],
    ): Promise<void> => {
      const trimmed = plaintext.trim();
      // A message with only an attachment and no words is a normal thing to
      // send, so an empty text is fine as long as there is a file.
      if (!channelId || (trimmed === '' && files.length === 0)) {
        return;
      }

      // Checked before anything is encrypted: rejecting a 40 MB video after
      // spending twenty seconds encrypting it would be rude.
      const tooBig = files.find((file) => file.size > MAX_ATTACHMENT_BYTES);
      if (tooBig) {
        setError(new AttachmentTooLargeError(tooBig.name).message);
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
          attachments: [],
        },
      ]);

      await deliver(localId, trimmed, replyToId, files, []);
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
      // No files passed: anything that was uploaded is on the pending row
      // already, and anything that was not never got a File object we still
      // hold, so a retry after an encryption failure has to start over from
      // the picker. Rare enough to accept; silently sending the text without
      // the attachment would be worse.
      await deliver(localId, item.plaintext, item.replyToId, [], item.attachments);
    },
    [deliver, pending],
  );

  /**
   * Downloads and decrypts one attachment.
   *
   * Lives here rather than in the component that renders it, because it needs
   * the unlocked private key and crypto does not belong in components. The
   * Blob goes back up; making and revoking an object URL is the caller's job.
   */
  const loadAttachment = useCallback(
    async (meta: AttachmentMeta, senderId: string): Promise<Blob> => {
      const ciphertext = await downloadAttachment(meta.path);
      const sender = membersRef.current.find((member) => member.userId === senderId);

      const decrypted = await decryptFile({
        bytes: ciphertext,
        privateKey: getUnlockedKey(),
        senderPublicKey: sender?.publicKey ?? undefined,
      });

      // The real mime type comes from the encrypted payload, not from Storage,
      // which only ever saw octet-stream. This is what lets an image render as
      // an image instead of downloading as an unknown blob.
      //
      // BlobPart wants an ArrayBuffer; the decrypted bytes may be a view into
      // a larger buffer, so slice through the view rather than handing over
      // .buffer, which could carry neighbouring bytes.
      return new Blob([decrypted.bytes.slice().buffer as ArrayBuffer], {
        type: meta.mimeType,
      });
    },
    [],
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

      // Editing changes the words, not the files. The attachments have to be
      // carried into the new payload or they would drop off the message, and
      // the objects would stay in the bucket with nothing pointing at them.
      const attachments = decryptedRef.current.get(messageId)?.attachments ?? [];

      try {
        const payload = encodePayload({ text: trimmed, attachments });
        const ciphertext = await encryptForChannel(channelId, payload);
        const row = await updateMessage(messageId, ciphertext);

        // The plaintext is already known, so skip a decrypt round. signature
        // valid: we just signed it.
        decryptedRef.current.set(row.id, {
          text: trimmed,
          signatureValid: true,
          unreadable: false,
          attachments,
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

    // Read the paths before the cache entry is dropped: after the delete the
    // metadata is gone, and with it any way to find the files.
    const paths = decryptedRef.current.get(messageId)?.attachments.map((a) => a.path) ?? [];

    try {
      const row = await deleteMessage(messageId);

      if (paths.length > 0) {
        // Deliberately after the message update and deliberately not fatal.
        // Blanking the ciphertext is what makes the message unreadable; the
        // files are separate objects and their own removal can fail (only the
        // uploader may delete them). A leftover file is still encrypted for
        // the members of that channel, so it leaks nothing new -- it is
        // unreclaimed space, and it is written down as such in
        // docs/migraties-en-rls-tests.md.
        try {
          await removeAttachments(paths);
        } catch (caught) {
          console.error('Bijlagen van een verwijderd bericht bleven staan:', caught);
        }
      }

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
        attachments: entry?.attachments ?? [],
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
      attachments: item.attachments,
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
    attachmentProgress,
    loadAttachment,
  };
}
