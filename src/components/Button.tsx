import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * Four weights, and the order matters.
 *
 * primary is the accent and there is at most one per screen. secondary is a
 * filled but quiet button for the second choice in a dialog. ghost is
 * borderless, for things in a toolbar. danger is the only one that is not
 * filled by default: a red block reads as an error message, and a destructive
 * action should be findable without shouting until you hover it.
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-on hover:bg-accent-hover',
  secondary: 'bg-overlay text-primary border border-subtle hover:bg-hover hover:border-strong',
  ghost: 'bg-transparent text-secondary hover:bg-hover hover:text-primary',
  danger: 'bg-transparent text-danger hover:bg-danger-soft',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Fills the width of its container. */
  block?: boolean;
}

export function Button({
  variant = 'primary',
  block = false,
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      // An explicit default: a <button> inside a <form> submits unless told
      // otherwise, and every dialog in this app has a form in it.
      type={type}
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        VARIANTS[variant]
      } ${block ? 'w-full' : ''} ${className}`}
    />
  );
}
