import { EmptyChannelNameError } from './channelName';
import { KeyMismatchError, NoStoredKeyError } from '../hooks/useAuth';
import { VaultCryptoError, WrongPassphraseError } from './crypto';
import { UsernameTakenError } from './supabase/errors';

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
 * Anything we do not recognise gets a generic message plus a console.error, so
 * the real cause stays debuggable without leaking it into the interface.
 */
export function describeError(error: unknown): string {
  if (error instanceof WrongPassphraseError) {
    return 'Het wachtwoord klopt niet.';
  }

  if (
    error instanceof UsernameTakenError ||
    error instanceof EmptyChannelNameError ||
    error instanceof KeyMismatchError ||
    error instanceof NoStoredKeyError ||
    error instanceof VaultCryptoError
  ) {
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
