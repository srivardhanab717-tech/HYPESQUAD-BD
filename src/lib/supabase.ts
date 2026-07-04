import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/env';

let supabaseClient: SupabaseClient | null = null;

/**
 * Get the Supabase client initialized with the service role key.
 * Service role bypasses RLS — used for server-side operations.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(config.supabase.url, config.supabase.serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return supabaseClient;
}

/**
 * Create a Supabase client scoped to a specific user's JWT.
 * This client respects RLS policies for the authenticated user.
 */
export function getSupabaseClientForUser(userJwt: string): SupabaseClient {
  return createClient(config.supabase.url, config.supabase.anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${userJwt}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
