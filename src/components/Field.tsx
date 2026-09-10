import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  /** Shown under the field, in the danger colour, and wired to aria-describedby. */
  error?: string | null;
}

export function Field({ label, hint, error, className = '', ...props }: FieldProps) {
  const id = useId();
  const hintId = useId();
  const errorId = useId();

  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        className="text-2xs font-semibold uppercase tracking-wider text-secondary"
      >
        {label}
      </label>
      {/* text-base on a phone: anything under 16px makes iOS zoom the whole
          page the moment the field takes focus. */}
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...props}
        className={`min-h-11 rounded-md border bg-inset px-3 py-2 text-base text-primary transition-colors outline-none placeholder:text-muted focus:border-accent sm:text-sm ${
          error ? 'border-danger' : 'border-subtle hover:border-strong'
        } ${className}`}
      />
      {hint ? (
        <p id={hintId} className="text-xs leading-snug text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs leading-snug text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
