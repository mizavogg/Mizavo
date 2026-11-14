/* Mizavo — the shared database connection.
   The project address and publishable key are safe in a web page:
   the database's own rules decide what each logged-in user can see or change. */
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  'https://puhnuwstlujkvevsromj.supabase.co',
  'sb_publishable_hu0RB8qzJWkgLMXkVh7tgg_GrV5EpA9'
);

/** Call a database function. Throws an Error with the database's message if it fails. */
export async function rpc<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Start Twitch login; Twitch sends the browser back to this same page. */
export async function loginWithTwitch(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'twitch',
    // channel:bot = "allow Mizavo's chat bot in your chat", so the server can read answers (trusted scoring, Nov 14)
    options: { redirectTo: window.location.origin + window.location.pathname, scopes: 'channel:bot' },
  });
  if (error) throw new Error(error.message);
}
