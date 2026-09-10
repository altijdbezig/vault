import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /**
   * Required, not optional.
   *
   * An icon button with no label is a button a screen reader announces as
   * "button". Making this part of the type means it cannot be forgotten, which
   * is the only way a rule like this survives more than a week.
   */
  label: string;
  children: ReactNode;
  /** Smaller hit area, for icons inside a message row. */
  size?: 'sm' | 'md';
  /** Draws it as active, for a toggle that is on. */
  active?: boolean;
}

export function IconButton({
  label,
  children,
  size = 'md',
  active = false,
  className = '',
  type = 'button',
  ...props
}: IconButtonProps) {
  const dimensions = size === 'sm' ? 'h-7 w-7 text-xs' : 'h-11 w-11 text-sm';

  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      {...props}
      className={`inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${dimensions} ${
        active ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-hover hover:text-primary'
      } ${className}`}
    >
      {/* The glyph itself is decorative: the label above is what is read. */}
      <span aria-hidden="true" className="leading-none">
        {children}
      </span>
    </button>
  );
}
