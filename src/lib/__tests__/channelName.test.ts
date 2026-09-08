import { describe, expect, it } from 'vitest';
import {
  EmptyChannelNameError,
  normalizeChannelName,
  requireChannelName,
} from '../channelName';

describe('normalizeChannelName', () => {
  it('strips the hash the user typed along with the one the UI draws', () => {
    expect(normalizeChannelName('#leden')).toBe('leden');
    expect(normalizeChannelName('###leden')).toBe('leden');
    expect(normalizeChannelName('# leden')).toBe('leden');
  });

  it('trims, lowercases and turns spaces into dashes', () => {
    expect(normalizeChannelName('  Algemeen  ')).toBe('algemeen');
    expect(normalizeChannelName('Nieuwe Leden')).toBe('nieuwe-leden');
    expect(normalizeChannelName('#  Vault   HQ ')).toBe('vault-hq');
  });

  it('collapses runs of dashes and never starts or ends with one', () => {
    expect(normalizeChannelName('-random-')).toBe('random');
    expect(normalizeChannelName('een -- twee')).toBe('een-twee');
  });

  it('leaves an already normalised name alone', () => {
    expect(normalizeChannelName('nieuwe-leden')).toBe('nieuwe-leden');
    // Idempotent: the cleanup migration relies on this.
    expect(normalizeChannelName(normalizeChannelName('# Nieuwe  Leden'))).toBe('nieuwe-leden');
  });

  it('returns an empty string when nothing usable is left', () => {
    expect(normalizeChannelName('')).toBe('');
    expect(normalizeChannelName('   ')).toBe('');
    expect(normalizeChannelName('#')).toBe('');
    expect(normalizeChannelName('# ##  ')).toBe('');
  });
});

describe('requireChannelName', () => {
  it('returns the normalised name', () => {
    expect(requireChannelName('# Nieuwe Leden')).toBe('nieuwe-leden');
  });

  it('refuses a name that normalises to nothing', () => {
    expect(() => requireChannelName('#')).toThrow(EmptyChannelNameError);
    expect(() => requireChannelName('   ')).toThrow(EmptyChannelNameError);
  });
});
