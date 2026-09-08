import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { TextDecoder, TextEncoder } from 'node:util';

// jsdom ships a Crypto object without SubtleCrypto, which OpenPGP needs.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

// jsdom runs in its own JS realm, so its Uint8Array is not the Uint8Array that
// Node's TextEncoder and WebCrypto produce. OpenPGP checks with `instanceof`
// and would reject its own buffers. Line everything up on Node's realm.
const nodeTypedArray = new TextEncoder().encode('').constructor as Uint8ArrayConstructor;

Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder, configurable: true });
Object.defineProperty(globalThis, 'Uint8Array', { value: nodeTypedArray, configurable: true });
Object.defineProperty(globalThis, 'ArrayBuffer', {
  value: new nodeTypedArray(0).buffer.constructor,
  configurable: true,
});

/**
 * jsdom ships a matchMedia that answers "no" to everything, so every
 * breakpoint in the app would read as the narrowest one. This evaluates the
 * two kinds of query the app actually asks: a min-width against
 * window.innerWidth, and pointer type. Tests change window.innerWidth and
 * dispatch a resize to move between layouts.
 */
function evaluate(query: string): boolean {
  const minWidth = /\(min-width:\s*(\d+)px\)/.exec(query);
  if (minWidth?.[1]) {
    return window.innerWidth >= Number(minWidth[1]);
  }
  if (query.includes('pointer: coarse')) {
    return Boolean((globalThis as { __coarsePointer?: boolean }).__coarsePointer);
  }
  return false;
}

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string): MediaQueryList => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const list = {
      media: query,
      matches: evaluate(query),
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    } as unknown as MediaQueryList;

    window.addEventListener('resize', () => {
      const matches = evaluate(query);
      if (matches === list.matches) {
        return;
      }
      Object.defineProperty(list, 'matches', { configurable: true, value: matches });
      for (const listener of listeners) {
        listener({ matches, media: query } as MediaQueryListEvent);
      }
    });

    return list;
  },
});
