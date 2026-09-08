import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

export function Field({ label, hint, ...props }: FieldProps) {
  const id = useId();

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-ink-300">
        {label}
      </label>
      {/* text-base on a phone: anything under 16px makes iOS zoom the whole
          page the moment the field takes focus. */}
      <input
        id={id}
        {...props}
        className="min-h-11 rounded border border-ink-700 bg-ink-900 px-3 py-2 text-base text-ink-100 outline-none placeholder:text-ink-500 focus:border-accent-500 sm:text-sm"
      />
      {hint ? <p className="text-xs text-ink-500">{hint}</p> : null}
    </div>
  );
}
