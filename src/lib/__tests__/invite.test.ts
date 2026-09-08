import { describe, expect, it } from 'vitest';
import { inviteLinkFor, serverIdFromInvite } from '../invite';

const SERVER_ID = 'a5588fe5-3d0d-4737-a740-97dac98b98e1';

describe('inviteLinkFor', () => {
  it('builds a link on the current origin', () => {
    expect(inviteLinkFor(SERVER_ID, 'https://vault.example')).toBe(
      `https://vault.example/join/${SERVER_ID}`,
    );
  });

  it('does not double the slash when the origin has a trailing one', () => {
    expect(inviteLinkFor(SERVER_ID, 'https://vault.example/')).toBe(
      `https://vault.example/join/${SERVER_ID}`,
    );
  });
});

describe('serverIdFromInvite', () => {
  it('accepts a full invite link', () => {
    expect(serverIdFromInvite(`https://vault.example/join/${SERVER_ID}`)).toBe(SERVER_ID);
  });

  it('accepts a bare server id, which stays the fallback', () => {
    expect(serverIdFromInvite(SERVER_ID)).toBe(SERVER_ID);
  });

  it('survives the whitespace and casing that come with pasting', () => {
    expect(serverIdFromInvite(`  ${SERVER_ID.toUpperCase()}  `)).toBe(SERVER_ID);
    expect(serverIdFromInvite(` https://vault.example/join/${SERVER_ID}?x=1 `)).toBe(SERVER_ID);
  });

  it('refuses anything that is not an id, instead of passing it on', () => {
    expect(serverIdFromInvite('')).toBeNull();
    expect(serverIdFromInvite('https://vault.example/join/nope')).toBeNull();
    expect(serverIdFromInvite('kom er ook bij!')).toBeNull();
    expect(serverIdFromInvite('a5588fe5-3d0d-4737-a740')).toBeNull();
  });
});
