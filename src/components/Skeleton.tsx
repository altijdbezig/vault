interface SkeletonProps {
  /** Tailwind sizing for one bar. */
  className?: string;
}

/**
 * One grey bar with a shimmer.
 *
 * The animation lives in index.css as .vault-skeleton so it exists once, and
 * so prefers-reduced-motion can flatten it there instead of in every caller.
 *
 * aria-hidden: a screen reader gets nothing useful out of a placeholder. The
 * lists that use these carry their own aria-busy, which is what actually
 * announces "this is still loading".
 */
export function Skeleton({ className = 'h-3 w-full' }: SkeletonProps) {
  return <span aria-hidden="true" className={`vault-skeleton block ${className}`} />;
}

interface SkeletonListProps {
  /** How many rows to draw. Match the real list so nothing jumps. */
  rows?: number;
  /** Extra classes on the wrapper. */
  className?: string;
}

/**
 * A stand-in for a list of channels or members.
 *
 * The widths vary per row on purpose: bars of identical length read as a
 * loading bar, varying ones read as text that has not arrived yet.
 */
export function SkeletonList({ rows = 5, className = '' }: SkeletonListProps) {
  const widths = ['w-3/5', 'w-4/5', 'w-2/5', 'w-3/4', 'w-1/2', 'w-2/3'];

  return (
    <div aria-busy="true" className={`flex flex-col gap-1 ${className}`}>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="flex min-h-11 items-center px-2">
          <Skeleton className={`h-3 ${widths[index % widths.length] ?? 'w-3/5'}`} />
        </span>
      ))}
    </div>
  );
}

/**
 * A stand-in for a conversation.
 *
 * Alternating an avatar-sized square with two text bars, so the shape of what
 * is coming is recognisable before it lands.
 */
export function SkeletonMessages({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="flex flex-1 flex-col gap-4 p-4">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className={index % 3 === 0 ? 'h-3 w-4/5' : 'h-3 w-3/5'} />
          </div>
        </div>
      ))}
    </div>
  );
}
