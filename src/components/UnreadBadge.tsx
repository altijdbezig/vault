/** Caps the number so a long-neglected channel cannot stretch the row. */
const MAX_SHOWN = 99;

interface UnreadBadgeProps {
  count: number;
  /**
   * True when one of those unread messages names you.
   *
   * A different colour, not just a bigger number: "twelve unread" and "twelve
   * unread, one of which is addressed to you" are different enough to deserve
   * different treatment at a glance. The mention colour is the danger red,
   * the only colour in the palette that pulls harder than the accent.
   */
  mention?: boolean;
}

export function UnreadBadge({ count, mention = false }: UnreadBadgeProps) {
  if (count <= 0) {
    return null;
  }

  const shown = count > MAX_SHOWN ? `${MAX_SHOWN}+` : String(count);

  return (
    <span
      aria-label={mention ? `${count} ongelezen, je wordt genoemd` : `${count} ongelezen`}
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-2xs font-semibold leading-none ${
        mention ? 'bg-danger text-danger-on' : 'bg-accent text-accent-on'
      }`}
    >
      {shown}
    </span>
  );
}
