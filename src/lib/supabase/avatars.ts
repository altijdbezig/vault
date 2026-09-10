import { supabase } from './client';
import { currentUserId } from './session';

/**
 * Avatars and server icons, in a public bucket.
 *
 * The one thing in Vault that is deliberately not encrypted, and the UI says
 * so where you upload one. An avatar has to load for everybody who sees your
 * name, including people you have never shared a channel with, so there is no
 * key it could be encrypted to. Encrypting it to "everyone" is not encryption.
 *
 * What that means in practice: treat an avatar as public. Not a photo of
 * something private, not a screenshot with a whiteboard behind it.
 */

const BUCKET = 'avatars';

/** 2 MB, matching the bucket. An avatar is displayed at 128 pixels. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** What the bucket accepts. Anything else is refused before it is uploaded. */
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export class AvatarRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AvatarRejectedError';
  }
}

function extensionFor(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'bin';
  }
}

/**
 * Uploads an avatar and returns its public URL.
 *
 * The filename is random rather than fixed, and the previous one is removed
 * afterwards. A fixed name like <uid>/avatar.png would keep the same URL
 * forever, which means every browser and CDN that has seen the old picture
 * goes on showing it. A new name per upload makes cache busting automatic.
 *
 * The path starts with the user id because that is what the storage policy
 * checks: foldername(name)[1] = auth.uid(). Uploading anywhere else is a 403,
 * which is the point.
 */
export async function uploadAvatar(file: File): Promise<string> {
  if (file.size > MAX_AVATAR_BYTES) {
    throw new AvatarRejectedError('Kies een afbeelding van maximaal 2 MB.');
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new AvatarRejectedError('Kies een PNG, JPEG, WebP of GIF.');
  }

  const me = await currentUserId();
  const path = `${me}/${crypto.randomUUID()}.${extensionFor(file.type)}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    throw error;
  }

  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Removes an avatar that is no longer referenced.
 *
 * Best effort, and callers should not fail on it: an orphaned public image is
 * untidy, not dangerous. Takes the public URL because that is what the profile
 * row holds, and derives the storage path from it.
 */
export async function removeAvatar(publicUrl: string): Promise<void> {
  const path = storagePathFromPublicUrl(publicUrl);
  if (!path) {
    return;
  }

  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) {
    throw error;
  }
}

/**
 * Pulls the storage path back out of a public URL.
 *
 * Public URLs look like .../storage/v1/object/public/avatars/<uid>/<file>.
 * Returns null for anything that is not one of ours, so a hand-edited profile
 * row cannot make this delete something unrelated.
 */
export function storagePathFromPublicUrl(publicUrl: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const at = publicUrl.indexOf(marker);
  if (at === -1) {
    return null;
  }

  const path = publicUrl.slice(at + marker.length);
  // A path traversal in a stored URL should not turn into a delete outside
  // the bucket. Storage would refuse it anyway; refusing here is cheaper.
  return path === '' || path.includes('..') ? null : path;
}
