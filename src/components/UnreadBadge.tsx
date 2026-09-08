/** Caps the number so a long-neglected channel cannot stretch the row. */
const MAX_SHOWN = 99;

export function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) {
    return null;
  }

  return (
    <span
      aria-label={`${count} ongelezen`}
      className="shrink-0 rounded-full bg-accent-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
    >
      {count > MAX_SHOWN ? `${MAX_SHOWN}+` : count}
    </span>
  );
}
