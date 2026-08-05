// Cloud accounts + saved projects, on Supabase (auth + Postgres).
//
// Every entry point is safe to call when Supabase is unconfigured: it returns
// a null/empty result instead of throwing, so the app keeps working exactly as
// it does today for anonymous users. See web/supabase_config.js.
//
// A saved project stores the SAME project-CSV blob the Download/Load project
// CSV buttons already produce (project_csv.js) — no second serialisation to
// keep in sync, and the existing round-trip test already guards the format.
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from './supabase_config.js';

export { isConfigured };

// supabase-js is ~40 KB and only fetched once someone actually has accounts
// switched on — same lazy pattern as the Leaflet / LERC loads elsewhere.
let _clientPromise = null;
function client(){
  if (!isConfigured()) return Promise.resolve(null);
  if (!_clientPromise){
    _clientPromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
      .then(m => m.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,          // survive a reload
          autoRefreshToken: true,
          detectSessionInUrl: true,      // consume the #access_token= after OAuth redirect
        },
      }))
      .catch(err => { console.error('[cloud] supabase-js failed to load', err); return null; });
  }
  return _clientPromise;
}

// ---- auth ------------------------------------------------------------------

/** Current signed-in user, or null (also null when unconfigured/offline). */
export async function getUser(){
  const c = await client();
  if (!c) return null;
  try { const { data } = await c.auth.getUser(); return data?.user || null; }
  catch { return null; }
}

/**
 * Subscribe to sign-in/sign-out. Fires once immediately with the current user
 * so callers don't need a separate initial read. Returns an unsubscribe fn.
 */
export async function onAuthChange(cb){
  const c = await client();
  if (!c){ cb(null); return () => {}; }
  cb(await getUser());
  const { data } = c.auth.onAuthStateChange((_evt, session) => cb(session?.user || null));
  return () => data?.subscription?.unsubscribe?.();
}

/**
 * Start Google OAuth. Redirects away from the page; on return supabase-js
 * consumes the token from the URL (detectSessionInUrl) and the session is live.
 * @param redirectTo absolute URL to come back to (defaults to current page)
 */
export async function signInWithGoogle(redirectTo){
  const c = await client();
  if (!c) throw new Error('Cloud accounts are not configured.');
  const { error } = await c.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectTo || window.location.href.split('#')[0],
      // Ask Google for a refresh token + always show the picker, so switching
      // accounts works instead of silently reusing the last Google session.
      queryParams: { access_type: 'offline', prompt: 'select_account' },
    },
  });
  if (error) throw error;
}

export async function signOut(){
  const c = await client();
  if (c) await c.auth.signOut();
}

// ---- saved projects --------------------------------------------------------

/** Small summary shown in the picker without downloading every CSV. */
export function summarise(state, sectionLine){
  const holes = state?.boreholes || [];
  return {
    boreholes: holes.length,
    trialPits: holes.filter(b => (b.kind || 'BH') === 'TP').length,
    layers: holes.reduce((n, b) => n + ((b.layers && b.layers.length) || 0), 0),
    hasSection: !!sectionLine,
  };
}

/** Projects for the signed-in user, newest first. [] when signed out. */
export async function listProjects(){
  const c = await client();
  if (!c) return [];
  const { data, error } = await c
    .from('projects')
    .select('id,name,meta,created_at,updated_at')   // omit csv — can be large
    .order('updated_at', { ascending: false });
  if (error){ console.error('[cloud] listProjects', error); return []; }
  return data || [];
}

/** Full row including the CSV, for actually opening a project. */
export async function getProject(id){
  const c = await client();
  if (!c) return null;
  const { data, error } = await c.from('projects').select('*').eq('id', id).single();
  if (error){ console.error('[cloud] getProject', error); return null; }
  return data;
}

/**
 * Create a new saved project. user_id is set explicitly because the RLS
 * insert policy checks `auth.uid() = user_id` — the row is rejected without it.
 */
export async function createProject(name, csv, meta){
  const c = await client();
  if (!c) throw new Error('Cloud accounts are not configured.');
  const user = await getUser();
  if (!user) throw new Error('Sign in first.');
  const { data, error } = await c.from('projects')
    .insert({ user_id: user.id, name: name.trim(), csv, meta: meta || {} })
    .select('id,name,meta,created_at,updated_at').single();
  if (error) throw error;
  return data;
}

/** Overwrite an existing project (Save over…). updated_at is set by trigger. */
export async function updateProject(id, csv, meta){
  const c = await client();
  if (!c) throw new Error('Cloud accounts are not configured.');
  const { data, error } = await c.from('projects')
    .update({ csv, meta: meta || {} }).eq('id', id)
    .select('id,name,meta,created_at,updated_at').single();
  if (error) throw error;
  return data;
}

export async function renameProject(id, name){
  const c = await client();
  if (!c) throw new Error('Cloud accounts are not configured.');
  const { error } = await c.from('projects').update({ name: name.trim() }).eq('id', id);
  if (error) throw error;
}

export async function deleteProject(id){
  const c = await client();
  if (!c) throw new Error('Cloud accounts are not configured.');
  const { error } = await c.from('projects').delete().eq('id', id);
  if (error) throw error;
}

/** "3 minutes ago" / "12 Aug" — compact enough for the picker rows. */
export function whenLabel(iso){
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const d = new Date(t);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
