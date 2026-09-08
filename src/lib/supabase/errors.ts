/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505';

/** The username is already taken by another account. */
export class UsernameTakenError extends Error {
  constructor() {
    super('Die gebruikersnaam is al bezet. Kies een andere.');
    this.name = 'UsernameTakenError';
  }
}

/** True for a Postgres unique constraint violation coming back from PostgREST. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === UNIQUE_VIOLATION
  );
}
