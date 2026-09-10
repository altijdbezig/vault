import { describe, expect, it } from 'vitest';
import { inviteLinkFor, inviteTokenFromInput, serverIdFromInvite } from '../invite';

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

/*
 * Sinds er echte uitnodigingen zijn, kan een /join-link twee dingen bevatten.
 * Het verschil is niet cosmetisch: een code gaat via redeem_server_invite (dat
 * verval en gebruik controleert), een server-id via joinServer (dat geen van
 * beide doet). Ze verwisselen betekent een uitnodiging die haar limiet negeert.
 */
describe('inviteTokenFromInput', () => {
  it('herkent een server-id in een volledige link', () => {
    expect(inviteTokenFromInput(`https://vault.example/join/${SERVER_ID}`)).toEqual({
      kind: 'serverId',
      value: SERVER_ID,
    });
  });

  it('herkent een kaal server-id', () => {
    expect(inviteTokenFromInput(SERVER_ID)).toEqual({
      kind: 'serverId',
      value: SERVER_ID,
    });
  });

  it('herkent een uitnodigingscode in een link', () => {
    expect(inviteTokenFromInput('https://vault.example/join/a1b2c3d4e5')).toEqual({
      kind: 'code',
      value: 'a1b2c3d4e5',
    });
  });

  it('herkent een kale code', () => {
    expect(inviteTokenFromInput('a1b2c3d4e5')).toEqual({
      kind: 'code',
      value: 'a1b2c3d4e5',
    });
  });

  it('maakt een code kleine letters, zodat overtypen met caps blijft werken', () => {
    expect(inviteTokenFromInput('A1B2C3D4E5')).toEqual({
      kind: 'code',
      value: 'a1b2c3d4e5',
    });
  });

  it('leest een uuid als server-id en niet als code', () => {
    // Een uuid zonder streepjes is 32 hex-tekens en past ook op het
    // codepatroon. De specifiekere vorm gaat daarom eerst, anders wordt een
    // oude link ingewisseld als een code die niet bestaat.
    const token = inviteTokenFromInput(SERVER_ID);

    expect(token?.kind).toBe('serverId');
  });

  it('weigert iets dat geen van beide is', () => {
    expect(inviteTokenFromInput('srv-2')).toBeNull();
    expect(inviteTokenFromInput('kort')).toBeNull();
    expect(inviteTokenFromInput('')).toBeNull();
    expect(inviteTokenFromInput('https://vault.example/dm/abc')).toBeNull();
  });

  it('weigert een code met tekens die de database niet toestaat', () => {
    // De CHECK-constraint op server_invites staat alleen [a-z0-9] toe. Lokaal
    // afkeuren geeft een nette melding in plaats van een databasefout.
    expect(inviteTokenFromInput('abc_def123')).toBeNull();
    expect(inviteTokenFromInput('abc-def123')).toBeNull();
  });
});
