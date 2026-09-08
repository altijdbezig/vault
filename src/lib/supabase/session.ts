import { supabase } from './client';

/**
 * The signed-in user's id.
 *
 * Read from the session rather than passed in, so no caller can accidentally
 * act on behalf of someone else. Throws when there is no session: every query
 * in this layer needs one, and RLS would refuse anyway.
 */
export async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw error;
  }
  const id = data.session?.user.id;
  if (!id) {
    throw new Error('Geen actieve sessie.');
  }
  return id;
}
