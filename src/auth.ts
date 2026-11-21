import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;
let configurationError: string | null = null;
if (supabaseUrl && supabaseAnonKey) {
  try {
    client = createClient(supabaseUrl, supabaseAnonKey);
  } catch {
    configurationError = "Supabase configuration is invalid.";
  }
}

export const supabase = client;
export const authConfigured = Boolean(supabase);

export async function signInWithPassword(email: string, password: string): Promise<void> {
  if (!supabase) {
    throw new Error(configurationError ?? "Sign-in is not configured. See the setup guide.");
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signInWithGoogle(): Promise<void> {
  if (!supabase) {
    throw new Error(configurationError ?? "Sign-in is not configured. See the setup guide.");
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  });
  if (error) throw error;
}
