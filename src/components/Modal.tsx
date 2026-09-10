import { useCallback, useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** 'sm' for a form, 'lg' for settings. */
  size?: 'sm' | 'md' | 'lg';
  /** Extra description read out under the title. */
  description?: string;
}

/**
 * Elements a keyboard can reach.
 *
 * Deliberately not '*' with a tabindex check: a div with tabindex="-1" is
 * focusable by script but must not be a Tab stop, and the wrapper below uses
 * exactly that trick.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * One dialog, so the accessibility work is done once.
 *
 * Every dialog in the app went through the same three mistakes: no focus trap,
 * so Tab walked into the page behind it; no Esc; and focus dropped to the top
 * of the document on close, which sends a keyboard user back to the start of
 * the app after every action. All three are handled here, so a new dialog
 * cannot forget them.
 */
export function Modal({ title, onClose, children, size = 'sm', description }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  // Whatever had focus when this opened, so it can get it back.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    // The first field, or the dialog itself when there is nothing to type in.
    // Focusing the dialog rather than the close button means a screen reader
    // reads the title first instead of announcing "sluiten".
    const first = dialog.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialog).focus();

    return () => {
      // The element can be gone by now (a dialog that removed its own
      // trigger), hence the isConnected check.
      const target = returnFocusRef.current;
      if (target?.isConnected) {
        target.focus();
      }
    };
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const dialog = dialogRef.current;
      if (!dialog) {
        return;
      }

      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        // A hidden element still matches the selector but cannot take focus,
        // and landing on one makes Tab look broken.
        (element) => element.offsetParent !== null || element === document.activeElement,
      );

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];
      if (!firstElement || !lastElement) {
        return;
      }

      // Wrap around, which is what makes it a trap rather than a suggestion.
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    },
    [onClose],
  );

  const width =
    size === 'lg' ? 'max-w-3xl' : size === 'md' ? 'max-w-lg' : 'max-w-sm';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      {/*
       * The scrim is a button so a click outside closes the dialog, and it
       * carries an aria-label because it is the only unlabelled control in
       * here. It sits before the dialog in the DOM so the trap does not have
       * to exclude it — it is not inside the dialog, so Tab never reaches it.
       */}
      <button
        type="button"
        aria-label="Sluiten"
        onClick={onClose}
        className="absolute inset-0 bg-scrim"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`relative flex max-h-full w-full ${width} flex-col overflow-hidden rounded-xl border border-subtle bg-raised shadow-lg`}
      >
        <div className="flex items-start gap-2 border-b border-subtle px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-md font-semibold text-primary">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-0.5 text-xs leading-snug text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Sluiten"
            className="-mr-2 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-primary"
          >
            <span aria-hidden="true" className="text-lg leading-none">
              ×
            </span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
