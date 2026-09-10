import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeError } from '../errorMessages';
import { EmptyChannelNameError } from '../channelName';
import { NotARecipientError, WrongPassphraseError } from '../crypto';
import { UserFacingError } from '../userFacingError';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('describeError', () => {
  it('toont de tekst van een UserFacingError zoals hij is', () => {
    const message = 'Kies minstens één andere deelnemer voor de groep.';

    expect(describeError(new UserFacingError(message))).toBe(message);
  });

  it('toont ook de tekst van een subklasse verderop in de boom', () => {
    // NotARecipientError erft via VaultCryptoError. Deze keten is precies wat
    // de basisklasse moet opvangen zonder dat iemand hem ergens opsomt.
    const error = new NotARecipientError();

    expect(describeError(error)).toBe(error.message);
  });

  it('geeft een kortere tekst voor een verkeerd wachtwoord', () => {
    // De klasse legt uit wat een passphrase doet; dat is te veel als je hem
    // gewoon verkeerd hebt getypt.
    expect(describeError(new WrongPassphraseError())).toBe('Het wachtwoord klopt niet.');
  });

  it('vertaalt de Supabase-meldingen die gebruikers echt tegenkomen', () => {
    expect(describeError(new Error('Invalid login credentials'))).toBe(
      'E-mailadres of wachtwoord klopt niet.',
    );
    expect(describeError(new Error('User already registered'))).toBe(
      'Er bestaat al een account met dit e-mailadres.',
    );
  });

  /*
   * Dit is de regel die het geheel veilig maakt.
   *
   * Alles dat geen UserFacingError is, wordt NIET getoond. Zonder die grens
   * belandt de eerste constraint-naam of Engelse bibliotheektekst die een
   * catch-blok haalt in de interface.
   */
  it('toont de tekst van een onbekende fout niet', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = describeError(
      new Error('duplicate key value violates unique constraint "profiles_pkey"'),
    );

    expect(result).toBe('Er ging iets mis. Probeer het opnieuw.');
    expect(result).not.toContain('profiles_pkey');
    // Wel gelogd, zodat de echte oorzaak te vinden blijft.
    expect(errors).toHaveBeenCalled();
  });

  it('overleeft een geworpen waarde die geen Error is', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(describeError('gewoon een string')).toBe('Er ging iets mis. Probeer het opnieuw.');
    expect(describeError(null)).toBe('Er ging iets mis. Probeer het opnieuw.');
    expect(describeError(undefined)).toBe('Er ging iets mis. Probeer het opnieuw.');
  });

  it('geeft elke klasse zijn eigen naam, zonder die te herhalen', () => {
    // new.target in de basisklasse, zodat een subklasse zijn naam niet nog
    // een keer hoeft op te schrijven.
    expect(new EmptyChannelNameError().name).toBe('EmptyChannelNameError');
    expect(new NotARecipientError().name).toBe('NotARecipientError');
  });
});
