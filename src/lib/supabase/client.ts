import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Supabase-configuratie ontbreekt. Zet VITE_SUPABASE_URL en ' +
      'VITE_SUPABASE_ANON_KEY in .env (zie .env.example).',
  );
}

/**
 * The one and only Supabase client.
 *
 * Never call createClient() anywhere else: a second instance means a second
 * auth state, and the two will disagree about who is signed in.
 */
export const supabase = createClient(url, anonKey);
