/**
 * What a decrypted message actually contains.
 *
 * Until attachments existed, the plaintext of a message was the message. Now
 * it may also carry a list of attachments, and that list has to live inside
 * the encrypted payload: a filename is content. "kwartaalcijfers-q3.xlsx" in a
 * database column would tell the server as much as half the message would.
 *
 * So the plaintext is either a bare string, exactly as before, or an envelope.
 * Two consequences worth spelling out:
 *
 * - Every message ever sent before this change still decodes, as a plain text
 *   message with no attachments. No migration, no version column.
 * - The envelope has to be impossible to type by accident, or a message that
 *   happens to be valid JSON would be read as one. Hence the U+0001 prefix:
 *   there is no keyboard, paste or IME that produces a start-of-heading
 *   control character in a chat box.
 */

export interface AttachmentMeta {
  /** Path in the attachments bucket: <channel_id>/<random>. */
  path: string;
  /** The original filename, as chosen by the sender. */
  name: string;
  /** Size of the plaintext in bytes, for the label before downloading. */
  size: number;
  /** The original mime type. Storage only ever sees octet-stream. */
  mimeType: string;
  /** Pixel size for images, so the layout does not jump while decrypting. */
  width?: number;
  height?: number;
}

export interface MessagePayload {
  text: string;
  attachments: AttachmentMeta[];
}

/**
 * The envelope marker.
 *
 * U+0001 on both sides rather than one, so a message that begins with the
 * control character alone (a paste from something strange) does not get as far
 * as JSON.parse.
 *
 * Written as an escape rather than the literal character: a raw control byte
 * in a source file makes diffs unreadable and makes git treat the file as
 * binary.
 */
const ENVELOPE = '\u0001vault/1\u0001';

/** Encodes a payload. Stays a bare string when there is nothing to add. */
export function encodePayload(payload: MessagePayload): string {
  if (payload.attachments.length === 0) {
    return payload.text;
  }
  return ENVELOPE + JSON.stringify(payload);
}

function isAttachment(value: unknown): value is AttachmentMeta {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['path'] === 'string' &&
    typeof candidate['name'] === 'string' &&
    typeof candidate['size'] === 'number' &&
    typeof candidate['mimeType'] === 'string'
  );
}

/**
 * Decodes a decrypted plaintext.
 *
 * Every field is checked rather than trusted, because this is the output of
 * decrypting something another client produced. A future version of Vault, or
 * a corrupted payload, must degrade to "a message with some text" and never
 * to a crash halfway down a conversation. Anything unparseable falls back to
 * showing the raw plaintext, which is the honest thing: the reader sees what
 * was sent, even if we cannot interpret it.
 */
export function decodePayload(plaintext: string): MessagePayload {
  if (!plaintext.startsWith(ENVELOPE)) {
    return { text: plaintext, attachments: [] };
  }

  const body = plaintext.slice(ENVELOPE.length);

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { text: body, attachments: [] };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { text: body, attachments: [] };
  }

  const candidate = parsed as Record<string, unknown>;
  const text = typeof candidate['text'] === 'string' ? candidate['text'] : '';
  const rawAttachments = candidate['attachments'];

  return {
    text,
    attachments: Array.isArray(rawAttachments) ? rawAttachments.filter(isAttachment) : [],
  };
}

/** A size a person can read. Binary units, because Storage counts in those. */
export function formatBytes(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(0)} kB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Images get a thumbnail and a lightbox; everything else gets a download row. */
export function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}
