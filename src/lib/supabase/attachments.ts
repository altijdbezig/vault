import { supabase } from './client';

/**
 * Encrypted attachments in Supabase Storage.
 *
 * Nothing in this module knows what a file contains. It takes bytes that are
 * already ciphertext (see lib/crypto/files.ts), puts them in a bucket, and
 * hands them back. The encrypt and decrypt steps happen a layer up, in
 * useMessages, for the same reason sendMessage never sees plaintext.
 *
 * The bucket is private and its policies check channel membership through the
 * first path segment, so the layout below is not cosmetic: the path is what
 * authorisation is derived from.
 */

const BUCKET = 'attachments';

/**
 * The biggest file we accept, measured on the plaintext.
 *
 * The bucket itself allows 12 MB to leave room for PGP framing; this is the
 * limit the user is told about. Ten megabytes of ciphertext also has to be
 * held in memory twice while decrypting, and on a phone that is already
 * generous.
 */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * The mime type every attachment is stored as.
 *
 * Always this, whatever the file actually was. The real type travels inside
 * the encrypted payload. Two reasons: the bucket only accepts this type, which
 * is the backstop against a plaintext upload slipping through; and a bucket
 * full of objects labelled image/png, application/pdf and video/mp4 tells the
 * server what kind of conversation this is, which is exactly the metadata this
 * design is trying not to hand over.
 */
const STORED_MIME = 'application/octet-stream';

/** The path an upload goes to. The channel id has to come first; see above. */
export function attachmentPath(channelId: string): string {
  return `${channelId}/${crypto.randomUUID()}`;
}

/**
 * Uploads already-encrypted bytes.
 *
 * upsert is off: every path is a fresh uuid, so a collision would mean
 * something has gone wrong, and silently overwriting somebody else's
 * attachment is not the way to find that out.
 */
export async function uploadAttachment(path: string, ciphertext: Uint8Array): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, ciphertext, {
    contentType: STORED_MIME,
    upsert: false,
  });

  if (error) {
    throw error;
  }
}

/** Downloads the ciphertext of an attachment. */
export async function downloadAttachment(path: string): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);

  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error('Bijlage niet gevonden.');
  }

  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Removes an attachment.
 *
 * Called when the message carrying it is deleted. The policy only allows the
 * uploader to do this, so a failure here is not something the reader can fix
 * and is not worth an error message — but it does leave a file behind that
 * nobody will clean up. See the known gaps in docs/migraties-en-rls-tests.md.
 */
export async function removeAttachments(paths: string[]): Promise<void> {
  if (paths.length === 0) {
    return;
  }

  const { error } = await supabase.storage.from(BUCKET).remove(paths);

  if (error) {
    throw error;
  }
}
