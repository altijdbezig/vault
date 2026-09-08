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
