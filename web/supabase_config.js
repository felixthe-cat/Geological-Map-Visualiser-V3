// Supabase connection settings for GeoVisualise accounts.
//
// ─────────────────────────────────────────────────────────────────────────────
// FILL THESE IN to switch cloud accounts ON. While they are blank, the whole
// accounts feature stays dormant: no sign-in button appears, no network calls
// are made, and the app behaves exactly as it does today. That is deliberate —
// the site is live, so an unconfigured deploy must not break it.
//
// Get both values from: Supabase Dashboard → your project → Settings → API
//   URL      = "Project URL"        e.g. https://abcdefghijk.supabase.co
//   ANON_KEY = "anon" / "public" key (the long JWT, NOT the service_role key)
//
// The anon key is PUBLIC by design — it ships in the browser in every
// client-side Supabase app, and Row Level Security (docs/supabase_schema.sql)
// is what actually protects the data. Never put the service_role key here:
// it bypasses RLS entirely and would expose every user's projects.
// ─────────────────────────────────────────────────────────────────────────────
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

/** True once both settings are present — every cloud code path checks this. */
export function isConfigured(){
  return !!(SUPABASE_URL && SUPABASE_ANON_KEY);
}
