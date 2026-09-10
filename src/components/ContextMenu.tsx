import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Draws it in the danger colour, for destructive entries. */
  danger?: boolean;
  /** A glyph in front. Decorative; the label is what gets read out. */
  icon?: string;
}

interface ContextMenuProps {
  items: MenuItem[];
  /** Where the pointer was, in viewport coordinates. */
  x: number;
  y: number;
  onClose: () => void;
  /** Read out as the menu's name. */
  label: string;
}

/** Room to leave between the menu and the edge of the window. */
const MARGIN = 8;

/**
 * A right-click menu.
 *
 * Fixed positioning against the viewport, because the alternative — placing it
 * inside the scrolling message list — means it slides away with the
 * conversation the moment a new message arrives.
 *
 * Keyboard behaviour is the part worth being careful about: this opens without
 * a click for anyone using a menu key, so it has arrow keys, Home/End, Enter
 * and Escape, and it takes focus when it opens and gives it back when it
 * closes. A right-click menu that a keyboard cannot reach is a set of actions
 * that only exist for mouse users.
 */
export function ContextMenu({ items, x, y, onClose, label }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const [active, setActive] = useState(0);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    menuRef.current?.focus();

    return () => {
      const target = returnFocusRef.current;
      if (target?.isConnected) {
        target.focus();
      }
    };
  }, []);

  // Flip the menu when it would hang off the screen. useLayoutEffect so the
  // correction happens before the browser paints; in a plain useEffect the
  // menu visibly jumps.
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) {
      return;
    }

    const box = element.getBoundingClientRect();
    let left = x;
    let top = y;

    if (left + box.width > window.innerWidth - MARGIN) {
      left = Math.max(MARGIN, window.innerWidth - box.width - MARGIN);
    }
    if (top + box.height > window.innerHeight - MARGIN) {
      top = Math.max(MARGIN, y - box.height);
    }

    setPosition({ left, top });
  }, [x, y]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent): void {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        onClose();
      }
    }

    // A menu that stays behind while the page scrolls under it points at the
    // wrong message.
    function onScroll(): void {
      onClose();
    }

    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [onClose]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    switch (event.key) {
      case 'Escape':
        event.stopPropagation();
        onClose();
        return;
      case 'ArrowDown':
        event.preventDefault();
        setActive((current) => (current + 1) % items.length);
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((current) => (current - 1 + items.length) % items.length);
        return;
      case 'Home':
        event.preventDefault();
        setActive(0);
        return;
      case 'End':
        event.preventDefault();
        setActive(items.length - 1);
        return;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const item = items[active];
        if (item) {
          item.onSelect();
          onClose();
        }
        return;
      }
      default:
        return;
    }
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={{ left: position.left, top: position.top }}
      className="fixed z-50 min-w-44 overflow-hidden rounded-lg border border-subtle bg-overlay py-1 shadow-lg"
    >
      {items.map((item, index) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          // tabIndex -1 on all of them: focus stays on the menu container and
          // the arrow keys move a highlight, which is how a menu is supposed
          // to behave. Tabbing through the items would be a toolbar.
          tabIndex={-1}
          onMouseEnter={() => setActive(index)}
          onClick={() => {
            item.onSelect();
            onClose();
          }}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors ${
            item.danger ? 'text-danger' : 'text-secondary'
          } ${
            index === active
              ? item.danger
                ? 'bg-danger-soft'
                : 'bg-hover text-primary'
              : ''
          }`}
        >
          {item.icon ? (
            <span aria-hidden="true" className="w-4 text-center text-xs">
              {item.icon}
            </span>
          ) : null}
          {item.label}
        </button>
      ))}
    </div>
  );
}
