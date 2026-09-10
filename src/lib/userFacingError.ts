/**
 * The base class for errors whose message is written for the user to read.
 *
 * This exists because the alternative did not work. describeError used to hold
 * a list of classes it recognised, and every class introduced after that list
 * was written threw a carefully worded Dutch sentence that got replaced with
 * "Er ging iets mis" -- because nobody remembered to add it. A list that has
 * to be updated in a second file is a list that falls behind.
 *
 * Extending this says: somebody wrote this sentence for a person, and it may
 * be shown as is.
 *
 * The rule that makes it safe is the inverse. An error that is NOT a
 * UserFacingError never has its message displayed, so a Postgres constraint
 * name, a Supabase stack detail or a library's English internals cannot end up
 * in the interface. That is also why this module imports nothing: every layer
 * of the app can extend it without dragging a dependency along, and
 * describeError can recognise all of them by importing only this.
 */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    // new.target rather than a hardcoded string, so every subclass gets its
    // own name without repeating it.
    this.name = new.target.name;
  }
}
