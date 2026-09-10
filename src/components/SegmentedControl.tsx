interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  /** Read out as the group name, so it needs to say what is being chosen. */
  legend: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Hides the legend visually but keeps it for screen readers. */
  hideLegend?: boolean;
}

/**
 * A row of mutually exclusive choices.
 *
 * Radio inputs under the hood, not buttons. Three buttons with one of them
 * highlighted looks the same but behaves differently: a screen reader gets
 * "button, button, button" instead of "one of three", and the arrow keys do
 * not work. A fieldset of radios gives both for free, and the appearance is
 * entirely CSS on the label.
 */
export function SegmentedControl<T extends string>({
  legend,
  options,
  value,
  onChange,
  hideLegend = false,
}: SegmentedControlProps<T>) {
  return (
    <fieldset className="min-w-0">
      <legend
        className={
          hideLegend
            ? 'sr-only'
            : 'mb-1.5 text-2xs font-semibold uppercase tracking-wider text-secondary'
        }
      >
        {legend}
      </legend>

      <div className="flex gap-0.5 rounded-md border border-subtle bg-inset p-0.5">
        {options.map((option) => {
          const selected = option.value === value;

          return (
            <label
              key={option.value}
              className={`flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded px-2 text-center text-xs font-medium transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                selected
                  ? 'bg-accent text-accent-on'
                  : 'text-secondary hover:bg-hover hover:text-primary'
              }`}
            >
              <input
                type="radio"
                name={legend}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                // sr-only rather than hidden: a hidden input cannot take focus,
                // and then the arrow keys stop working too.
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
