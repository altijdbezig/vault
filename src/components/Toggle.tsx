import { useId } from 'react';

interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * A switch for one setting.
 *
 * A real checkbox with a styled label, not a div with a click handler. Space
 * toggles it, a screen reader announces it as a checkbox with a state, and the
 * label is wired up rather than sitting next to it -- all of which come free
 * with the element and all of which have to be rebuilt by hand otherwise.
 */
export function Toggle({ label, description, checked, onChange, disabled }: ToggleProps) {
  const id = useId();
  const descriptionId = useId();

  return (
    <div className="flex items-start gap-3">
      <label
        htmlFor={id}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
          checked ? 'bg-accent' : 'bg-strong'
        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={description ? descriptionId : undefined}
          onChange={(event) => onChange(event.target.checked)}
          className="sr-only"
        />
        <span
          aria-hidden="true"
          className={`absolute h-4 w-4 rounded-full bg-raised shadow-sm transition-[left] ${
            checked ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </label>

      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="cursor-pointer text-sm text-primary">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-xs leading-relaxed text-muted">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
