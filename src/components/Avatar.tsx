interface AvatarProps {
  /** Used for the fallback colour, so it must be stable per person. */
  userId: string;
  /** Display name if there is one, otherwise the username. */
  name: string;
  url?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Draws a ring, for the member you are looking at. */
  ring?: boolean;
}

/**
 * A colour per person, derived from their id.
 *
 * Deterministic on purpose: the same person is the same colour on every device
 * and after every reload, which is what makes an avatar useful for scanning a
 * list. A random colour per render would be worse than no colour.
 *
 * FNV-1a rather than a sum of char codes: two usernames that are anagrams of
 * each other would otherwise land on the same hue, and in a small team that
 * happens more often than you would think.
 */
function hashToHue(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    // Multiply by the FNV prime, kept in 32 bits by Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash) % 360;
}

/**
 * Two letters, from the first two words if there are two.
 *
 * "Benjamin van Hemert" gives BV and not BE: initials of words carry more
 * information than the start of one word. Falls back to the first two
 * characters for a single-word name.
 */
function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return '?';
  }
  if (words.length === 1) {
    return (words[0] ?? '').slice(0, 2).toUpperCase();
  }
  return ((words[0] ?? '').charAt(0) + (words[1] ?? '').charAt(0)).toUpperCase();
}

const SIZES = {
  xs: 'h-5 w-5 text-2xs',
  sm: 'h-7 w-7 text-2xs',
  md: 'h-9 w-9 text-xs',
  lg: 'h-16 w-16 text-lg',
} as const;

export function Avatar({ userId, name, url, size = 'md', ring = false }: AvatarProps) {
  const hue = hashToHue(userId);
  const dimensions = SIZES[size];

  // The fallback is drawn with a hue from the id and a fixed saturation and
  // lightness, chosen so the white text on top passes contrast on every hue.
  // Doing it in HSL keeps that guarantee; picking from a palette of hex codes
  // would need one contrast check per colour.
  const fallbackStyle = {
    backgroundColor: `hsl(${hue} 32% 34%)`,
  };

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-on-solid select-none ${dimensions} ${
        ring ? 'ring-2 ring-accent' : ''
      }`}
      style={url ? undefined : fallbackStyle}
    >
      {url ? (
        <img
          src={url}
          // The name is already next to the avatar everywhere it is used, so
          // repeating it here makes a screen reader say it twice. An empty alt
          // is the correct way to say "decorative".
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden="true">{initialsFor(name)}</span>
      )}
    </span>
  );
}
