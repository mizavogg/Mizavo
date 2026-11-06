/* Mizavo — supabase.js
   One shared connection to the database, for any page that needs it.
   The project address and publishable key are safe in a web page:
   the database's own rules decide what each logged-in user can see or change. */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const supabase = createClient(
  'https://puhnuwstlujkvevsromj.supabase.co',
  'sb_publishable_hu0RB8qzJWkgLMXkVh7tgg_GrV5EpA9'
);
