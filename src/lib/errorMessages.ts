import { UserFacingError } from './userFacingError';
import { WrongPassphraseError } from './crypto';

/** Supabase auth messages are English and terse; translate the ones users hit. */
const SUPABASE_MESSAGES: [needle: string, dutch: string][] = [
  ['Invalid login credentials', 'E-mailadres of wachtwoord klopt niet.'],
  ['User already registered', 'Er bestaat al een account met dit e-mailadres.'],
  ['Password should be at least', 'Dit wachtwoord is te kort.'],
  ['Unable to validate email address', 'Dit e-mailadres is ongeldig.'],
  ['For security purposes', 'Te veel pogingen. Wacht even en probeer opnieuw.'],
];

/**
 * Turns any thrown value into something we can show the user.
 *
 * The rule is a single instanceof check: an error that extends
 * UserFacingError has a message somebody wrote for a person, so it is shown as
 * is. Everything else gets a generic sentence plus a console.error, which
 * keeps a Postgres constraint name or a library's English internals out of the
 * interface while leaving the real cause debuggable.
 *
 * This used to be a list of known classes here, and it fell behind: half a
 * dozen classes with careful Dutch messages were being reported as "Er ging
 * iets mis" because nobody remembered to add them. It also meant this module
 * imported most of the data layer, so any test that mocked one of those
 * modules had to re-export its error classes. Both problems went away with the
 * base class -- see lib/userFacingError.ts.
 */
export function describeError(error: unknown): string {
  // Ahead of the general case: the class message explains what a passphrase
  // is for, which is right on the unlock screen and too much when you have
  // simply mistyped it.
  if (error instanceof WrongPassphraseError) {
    return 'Het wachtwoord klopt niet.';
  }

  if (error instanceof UserFacingError) {
    return error.message;
  }

  if (error instanceof Error) {
    const match = SUPABASE_MESSAGES.find(([needle]) => error.message.includes(needle));
    if (match) {
      return match[1];
    }
  }

  console.error('Onverwachte fout:', error);
  return 'Er ging iets mis. Probeer het opnieuw.';
}
