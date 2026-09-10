import { describe, expect, it } from 'vitest';
import { decodePayload, encodePayload, formatBytes, isImage } from '../messagePayload';
import type { AttachmentMeta } from '../messagePayload';

/**
 * The envelope prefix, written out again rather than imported.
 *
 * On purpose: if somebody changes the marker in messagePayload.ts, this suite
 * has to fail. Importing the constant would only prove that encode and decode
 * agree with each other, not that the format still matches what is sitting in
 * messages that were already sent.
 *
 * Built with fromCharCode so no control character ends up in the source.
 */
const SOH = String.fromCharCode(1);
const PREFIX = `${SOH}vault/1${SOH}`;

const FILE: AttachmentMeta = {
  path: 'channel-1/abc',
  name: 'kwartaalcijfers.xlsx',
  size: 4096,
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

describe('encodePayload', () => {
  it('laat een bericht zonder bijlagen gewoon tekst', () => {
    // Belangrijk voor compatibiliteit: elk bericht dat ooit verstuurd is, en
    // elk bericht zonder bijlage dat nog verstuurd wordt, is een kale string.
    expect(encodePayload({ text: 'hallo', attachments: [] })).toBe('hallo');
  });

  it('maakt een envelope zodra er een bijlage is', () => {
    const encoded = encodePayload({ text: 'zie bijlage', attachments: [FILE] });

    expect(encoded).not.toBe('zie bijlage');
    expect(encoded.startsWith(PREFIX)).toBe(true);
  });
});

describe('decodePayload', () => {
  it('leest een envelope terug', () => {
    const payload = { text: 'zie bijlage', attachments: [FILE] };

    expect(decodePayload(encodePayload(payload))).toEqual(payload);
  });

  it('leest een oud bericht zonder envelope als tekst', () => {
    expect(decodePayload('gewoon een bericht')).toEqual({
      text: 'gewoon een bericht',
      attachments: [],
    });
  });

  it('behoudt de bestandsnaam, want die zit in de versleutelde payload', () => {
    // Dit is de hele reden dat de metadata niet in een kolom staat:
    // "kwartaalcijfers.xlsx" zegt de server net zoveel als het halve bericht.
    const decoded = decodePayload(encodePayload({ text: '', attachments: [FILE] }));

    expect(decoded.attachments[0]?.name).toBe('kwartaalcijfers.xlsx');
  });

  it('staat een bericht met alleen een bijlage toe', () => {
    const decoded = decodePayload(encodePayload({ text: '', attachments: [FILE] }));

    expect(decoded.text).toBe('');
    expect(decoded.attachments).toHaveLength(1);
  });

  /*
   * Alles hieronder gaat over invoer van een andere client.
   *
   * Deze string komt uit een ontsleuteling, dus hij is authentiek — maar hij
   * kan van een nieuwere versie van Vault komen of onderweg beschadigd zijn.
   * Het resultaat moet dan "een bericht met wat tekst" zijn en nooit een
   * exception halverwege een gesprek.
   */
  describe('bij rare invoer', () => {
    it('valt terug op de ruwe inhoud bij kapotte JSON', () => {
      const decoded = decodePayload(`${PREFIX}{niet echt json`);

      expect(decoded.attachments).toEqual([]);
      // De lezer ziet nog wat er stond, in plaats van een leeg bericht.
      expect(decoded.text).toBe('{niet echt json');
    });

    it('negeert een bijlage waarin een veld ontbreekt', () => {
      const broken =
        PREFIX + JSON.stringify({ text: 'hoi', attachments: [{ path: 'p', name: 'n' }] });

      expect(decodePayload(broken)).toEqual({ text: 'hoi', attachments: [] });
    });

    it('negeert een bijlage met een verkeerd type voor size', () => {
      const broken =
        PREFIX + JSON.stringify({ text: 'hoi', attachments: [{ ...FILE, size: '4096' }] });

      expect(decodePayload(broken).attachments).toEqual([]);
    });

    it('houdt de geldige bijlagen als er een kapot is', () => {
      const mixed =
        PREFIX + JSON.stringify({ text: 'twee bestanden', attachments: [FILE, { path: 'x' }] });

      expect(decodePayload(mixed).attachments).toHaveLength(1);
    });

    it('geeft een lege tekst als text geen string is', () => {
      const broken = PREFIX + JSON.stringify({ text: 42, attachments: [] });

      expect(decodePayload(broken).text).toBe('');
    });

    it('valt terug bij JSON die geen object is', () => {
      expect(decodePayload(`${PREFIX}"gewoon een string"`).attachments).toEqual([]);
      expect(decodePayload(`${PREFIX}null`).text).toBe('null');
    });

    it('ziet een bericht dat op JSON lijkt niet als envelope', () => {
      // Zonder de control-tekens zou dit als envelope gelezen worden, en dan
      // verdwijnt het bericht van iemand die een JSON-snippet stuurt.
      const typed = '{"text":"ik plak hier json","attachments":[]}';

      expect(decodePayload(typed)).toEqual({ text: typed, attachments: [] });
    });

    it('ziet een los control-teken of een andere versie niet als envelope', () => {
      expect(decodePayload(SOH).text).toBe(SOH);
      expect(decodePayload(`${SOH}vault/2${SOH}{}`).text).toBe(`${SOH}vault/2${SOH}{}`);
    });
  });
});

describe('formatBytes', () => {
  it('kiest een eenheid die te lezen is', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 kB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('isImage', () => {
  it('herkent afbeeldingen aan het mimetype uit de payload', () => {
    expect(isImage('image/png')).toBe(true);
    expect(isImage('image/svg+xml')).toBe(true);
    expect(isImage('application/pdf')).toBe(false);
    // Wat Storage ziet is altijd octet-stream; dat mag nooit als afbeelding
    // gelden, anders probeert de browser ciphertext te renderen.
    expect(isImage('application/octet-stream')).toBe(false);
  });
});
