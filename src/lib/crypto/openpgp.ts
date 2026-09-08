/**
 * Lazy loader for OpenPGP.js.
 *
 * The library is ~350 KB minified. Loading it statically would put it in the
 * entry chunk, so the sign-in screen would download the whole crypto stack
 * before anyone has typed a password. Every entry point in this layer is async
 * anyway, so awaiting the import here costs nothing in practice: it is fetched
 * on the first keygen, unlock, encrypt or decrypt, and cached after that.
 */
type OpenPGP = typeof import('openpgp');

let modulePromise: Promise<OpenPGP> | null = null;

export function loadOpenPGP(): Promise<OpenPGP> {
  modulePromise ??= import('openpgp');
  return modulePromise;
}
