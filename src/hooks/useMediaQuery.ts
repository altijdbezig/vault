import { useEffect, useState } from 'react';

/**
 * Subscribes to a CSS media query.
 *
 * Layout itself is done in CSS; this is only for the handful of decisions that
 * cannot be, like whether opening a server should jump straight into its first
 * channel.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    const list = window.matchMedia(query);
    const update = (event: MediaQueryListEvent): void => {
      setMatches(event.matches);
    };

    setMatches(list.matches);
    list.addEventListener('change', update);

    return () => {
      list.removeEventListener('change', update);
    };
  }, [query]);

  return matches;
}

/** Tailwind's md breakpoint: from here on, three columns fit side by side. */
export function useIsWideScreen(): boolean {
  return useMediaQuery('(min-width: 768px)');
}

/**
 * True on a device driven by a finger rather than a mouse.
 *
 * Used for the Enter key: on an on-screen keyboard Enter is the only way to
 * start a new line, so it must not send. A narrow desktop window is still a
 * desktop, which is why this is not the layout breakpoint.
 */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
