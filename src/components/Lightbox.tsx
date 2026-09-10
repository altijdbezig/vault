import { useEffect, useRef } from 'react';

interface LightboxProps {
  /** An object URL for the already-decrypted image. */
  url: string;
  name: string;
  onClose: () => void;
  onSave: () => void;
}

/**
 * A decrypted image, full size.
 *
 * Not built on Modal: this is a viewer rather than a form, so it needs the
 * whole viewport instead of a panel, and its only controls are close and save.
 * It does take the same three accessibility duties with it — Escape, focus
 * moved in and handed back — because those are not optional just because there
 * is nothing to fill in.
 */
export function Lightbox({ url, name, onClose, onSave }: LightboxProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    }

    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const target = returnFocusRef.current;
      if (target?.isConnected) {
        target.focus();
      }
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name}
      className="fixed inset-0 z-50 flex flex-col bg-scrim"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-xs text-primary">{name}</p>
        <button
          type="button"
          onClick={onSave}
          className="rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-hover"
        >
          Opslaan
        </button>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Sluiten"
          className="flex h-9 w-9 items-center justify-center rounded-md text-primary transition-colors hover:bg-hover"
        >
          <span aria-hidden="true" className="text-lg leading-none">
            ×
          </span>
        </button>
      </div>

      {/*
       * The backdrop closes on click, and the image stops the click from
       * reaching it. A button rather than a div with onClick so it is
       * reachable without a pointer, with the label the screen reader needs.
       */}
      <button
        type="button"
        aria-label="Afbeelding sluiten"
        onClick={onClose}
        className="flex min-h-0 flex-1 cursor-zoom-out items-center justify-center p-4"
      >
        <img
          src={url}
          alt={name}
          onClick={(event) => event.stopPropagation()}
          className="max-h-full max-w-full cursor-default object-contain"
        />
      </button>
    </div>
  );
}
