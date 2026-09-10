# Accounts & saved projects (Supabase + Google OAuth)

> Status: **code complete and verified, dormant until configured.** The three
> setup steps in §3 need your Google/Supabase accounts — I can't create accounts
> or handle credentials, so those are yours to do. Everything else is built.

## 1. Verification result — Supabase was NOT connected

Asked whether Supabase was already wired to the site. It was not. Evidence:

| Check | Result |
|---|---|
| `supabase` in any `.js` / `.html` / `.py` | **Zero hits** except one aspirational line in `COMPETITOR_ANALYSIS.md` ("only if commercialising") |
| Env vars on the live Vercel project | `vercel env ls` → **"No Environment Variables found"** |
| `.env.local` on disk | Contains a Supabase `DATABASE_URL` — but its `NEXT_PUBLIC_APP_URL` is `group-expense-tracker-…vercel.app`. It is a **stale June leftover pulled from a different Vercel project**, not this one. Untracked by git (correctly gitignored). |
| Frontend architecture | No `package.json`, no build step — a pure static site |

Two things follow, and both shaped the design:

1. **That Supabase database belongs to a different project of yours.** Wiring this
   site to it would have put geological projects in the expense tracker's database.
   Not used.
2. **A `DATABASE_URL` is useless here anyway.** A Postgres connection string needs a
   server process to hold it; this site is static files on a CDN. The correct
   integration is the Supabase **JS client** (public anon key + Row Level Security),
   which is what's built.

## 2. What was built

| File | Purpose |
|---|---|
| `docs/supabase_schema.sql` | `projects` table + **RLS policies** + `updated_at` trigger. Run once. |
| `web/supabase_config.js` | The two settings you fill in. Blank = feature dormant. |
| `web/cloud.js` | Auth + project CRUD. Lazy-loads supabase-js from CDN. Every function safe to call when unconfigured. |
| `web/auth_ui.js` | Shared header sign-in / account control. |
| `web/account.html` | Sign-in page + full project list (open / rename / delete). OAuth redirect target. |
| `web/builder.html` + `builder.js` | Header control, and a **My account** block inside *Import/export CSV* with a project picker, *Save to my account*, and *Save over current*. |
| `web/index.html` | "My projects" nav link (hidden until configured). |

### Key design decision — reuse the existing project format

A saved cloud project stores **the same project-CSV blob** that *Download project CSV*
already produces (`web/project_csv.js`). That format already round-trips the whole
workspace losslessly — boreholes, trial pits, grades, site boundary **and the
cross-section line** — and `web/test_project_csv.mjs` already guards it.

So there is no second serialisation to keep in sync, and your cross-sections are saved
by construction rather than as a separate feature. A small `meta` JSON column holds
just a summary (borehole count, has-section) so the picker can label rows without
downloading every CSV.

### Safety: dormant by default

The site is live, so an unconfigured deploy must not change or break it. Verified in
the browser with the settings blank:

- Cloud block `display:none`, header auth slot empty, landing nav link hidden
- **No supabase-js download and no `supabase.co` request** — only the 0.5 KB local config file
- Zero console errors
- Cross-section output **byte-identical** to the pre-change baseline (11,149 chars)

Then verified again with placeholder credentials injected: header button, cloud block,
signed-out panel and the account page all render correctly, supabase-js loads from CDN
and exposes the exact APIs used. Placeholders were then removed.

## 3. The three steps only you can do

I can't create accounts or enter credentials — these need your Google and Supabase
logins.

### Step 1 — Create the Supabase project and run the schema
1. Create a project at <https://supabase.com/dashboard> (region: **Southeast Asia
   (Singapore)** is closest to HK).
2. SQL Editor → New query → paste all of `docs/supabase_schema.sql` → Run.
3. Settings → API → copy **Project URL** and the **anon / public** key.

> Copy the **anon** key, never `service_role`. `service_role` bypasses RLS and would
> expose every user's projects if it shipped in the frontend.

### Step 2 — Create the Google OAuth client

**What you are collecting:** exactly two strings — a **Client ID** and a **Client
secret**. Nothing from Google Cloud goes into this repository; both are pasted into
Supabase in Step 3, and Supabase does the talking to Google. There is no Google SDK
and no Google API key in this codebase.

Google renamed this area in 2025. If the left-hand menu shows **Google Auth Platform**,
use the names in brackets; older projects still show *APIs & Services → OAuth consent
screen*, which is the same thing.

**2a. Project**
1. <https://console.cloud.google.com/> → project picker (top bar) → **New project**.
2. Name it e.g. `geovisualise`. No organisation needed. Create, then make sure the
   picker shows it before continuing — the commonest mistake here is configuring the
   wrong project.

**2b. Branding — what the consent screen says**
*Google Auth Platform → Branding* (old: *OAuth consent screen*).
- **App name** — what users see on the Google prompt: "GeoVisualise".
- **User support email** — your own address is fine.
- **App logo** — optional. Uploading one triggers a brand-verification review, so
  leave it empty unless you want that.
- **Application home page / privacy policy / terms** — only required once you upload
  a logo or request sensitive scopes. Leave blank for now.
- **Authorised domains** — add `supabase.co` and `vercel.app`. (Only needed if you
  fill in the home-page/privacy URLs above; harmless either way.)
- **Developer contact email** — your own.

**2c. Audience — who may sign in**
*Google Auth Platform → Audience* (old: the *User type* choice).
- Choose **External**. *Internal* only exists for Google Workspace organisations and
  would restrict sign-in to your own domain.
- The app starts in **Testing**: only addresses you list under **Test users** can sign
  in (100 max), and their sessions expire after 7 days.
- When you are ready for anyone to use it, press **Publish app**. **With the scopes
  below, no Google verification review is required** — the warning about verification
  only applies to sensitive or restricted scopes.

**2d. Data access — what you ask for**
*Google Auth Platform → Data access* (old: *Scopes*). Add only these three:

| Scope | Why | Google's tier |
|---|---|---|
| `openid` | proves who signed in | non-sensitive |
| `.../auth/userinfo.email` | your email, used as the account key | non-sensitive |
| `.../auth/userinfo.profile` | display name + avatar in the header | non-sensitive |

All three are non-sensitive, which is what keeps you out of the verification queue.
Do not add Drive, Gmail or Calendar scopes — the app never touches them.

**2e. Client — the two strings you actually need**
*Google Auth Platform → Clients → Create client* (old: *Credentials → Create
credentials → OAuth client ID*).
1. **Application type: Web application.** Not "Desktop", not "Single-Page App".
2. **Name:** anything, e.g. `geovisualise-web`. Users never see it.
3. **Authorised JavaScript origins** — leave empty. The browser never calls Google
   directly in this design; Supabase does.
4. **Authorised redirect URIs** — add exactly one, using your own Supabase project
   reference (Supabase → Settings → API → Project URL gives you the `<ref>`):
   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```
   It must match character for character — no trailing slash, `https` not `http`.
   A mismatch is the cause of nearly every `redirect_uri_mismatch` error.

   > Do **not** put the Vercel URL here. The site's own address goes in Supabase's
   > *URL Configuration* (Step 3), not in Google's.
5. **Create** → copy the **Client ID** and **Client secret**.

> The Client **secret** is a real credential. Paste it into Supabase and nowhere else —
> never into a file in this repository, and never into `web/supabase_config.js`, which
> ships to every visitor's browser.

### Step 3 — Connect the two, then fill in the config
1. Supabase → **Authentication → Providers → Google** → enable, paste the Client ID
   and Client secret → Save.
2. Supabase → **Authentication → URL Configuration**:
   - **Site URL:** `https://geological-map-visualiser.vercel.app`
   - **Redirect URLs:** add both
     ```
     https://geological-map-visualiser.vercel.app/**
     http://localhost:8080/**
     ```
     (the localhost entry is what lets sign-in work in local preview)
3. Edit `web/supabase_config.js` and paste in the Project URL and anon key.
   Only these two — the Google Client ID and secret never come near this file.

That's it — the sign-in page (`web/login.html`), the header control and the project
picker all switch themselves on automatically.

### If sign-in fails, in order of likelihood
| Symptom | Cause |
|---|---|
| `redirect_uri_mismatch` from Google | the URI in Google's client ≠ `https://<ref>.supabase.co/auth/v1/callback` |
| Signs in, then lands back signed-out | the site's URL is missing from Supabase → Authentication → URL Configuration → Redirect URLs |
| "Access blocked: app not verified" | the app is still in *Testing* and the address isn't a listed test user — add it, or press **Publish app** |
| Nothing happens, no redirect | `web/supabase_config.js` is still blank, or holds the wrong project URL | Tell me when
Steps 1–3 are done and I'll run a live end-to-end test (sign in, save a project, reopen
it in a fresh session).

## 4. How it behaves once on

- **Header** (landing / builder / account): *Sign in with Google* → after sign-in,
  name + avatar, *My projects*, *Sign out*.
- **2D Builder → Import/export CSV → My account:** pick a saved project and *Open*;
  *Save to my account* (prompts for a name); *Save over current* once a project is open.
- **account.html:** all projects with borehole/trial-pit counts, whether a cross-section
  is saved, and last-updated; *Open →* deep-links into the builder via `?project=<id>`.
- **Anonymous use is unchanged.** No sign-in required for anything that works today;
  the file-based *Download project CSV* stays as-is.

## 5. Deliberately not built (say the word if you want any)

- **Auto-save.** Current model is explicit save, which is predictable and avoids
  surprise overwrites. Auto-save needs conflict handling to be safe.
- **Sharing / collaboration.** RLS is strictly owner-only. Sharing means a
  `project_shares` table and wider policies — a real design task, not a toggle.
- **Migrating anonymous work on first sign-in.** Right now an anonymous session's work
  stays in the browser; you save it explicitly after signing in.
- **Other providers** (email/password, GitHub). Google only, as asked.
- **Storage limits / quotas.** Supabase free tier is 500 MB; a project CSV is a few KB,
  so this is thousands of projects away from mattering.

## 6. Risks worth knowing

1. **RLS is the only thing protecting user data.** If it were ever disabled, the public
   anon key would let anyone read every project. The schema enables it and defines
   owner-only policies for all four operations — don't disable it.
2. **Google consent screen in *Testing* mode** only admits listed test users, and
   refresh tokens expire after 7 days. Publish the app when you want real users.
3. **Redirect URL mismatch** is the usual first-time failure — the Google console URI
   must be the Supabase `/auth/v1/callback`, and the site origins go in Supabase's URL
   Configuration. They are two different lists.
4. **The stale `.env.local`** still holds another project's Supabase credentials. It's
   gitignored and unused, but worth deleting to avoid confusion later.
