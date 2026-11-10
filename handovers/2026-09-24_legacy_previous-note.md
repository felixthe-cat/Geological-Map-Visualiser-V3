# Handover Note — 2026-09-24

> Read `SOUL.md` first per CLAUDE.md. This note replaces the 2026-08-05 note and carries
> forward its still-open items (see "Known gaps").
>
> **Scope warning for the next session:** the tail of the conversation that produced this
> note drifted into a *different* project (PLAXIS Automation). None of that belongs here and
> none of it is recorded below. If you see PLAXIS, raft settlement, NotebookLM ingest or
> SAP2000 mentioned anywhere in this repo's context, it is not this project's work.

## What this project is (unchanged)

Free, open-source 2D/3D geological modelling tool for Hong Kong ground-investigation data.
- **Vercel** (`web/`) — static JS frontend, no build step. Live at
  **https://geological-map-visualiser.vercel.app**
- **Hugging Face Space** (`app.py` + `src/`) — Gradio backend for CEDD AGS fetch/parse and
  admin-gated GemPy 3D. **The user has stopped this Space for now** — the landing page no
  longer advertises it (see 2026-09-10 below).
- **Supabase** (new, now live) — Google sign-in + per-user saved datasets.

Builder tabs: 1 Site Map · 2 Borehole Log · 3 Cross-Section · 4 Rock Contour · 5 3D (admin-gated).

## Deploy mechanics

- Git: commit to `main`, push to `origin`. A push only updates the Vercel **Preview**;
  production needs `vercel --prod --yes` from the repo root. The Stop hook
  `.claude/auto_push.ps1` does `git add -A` + commit + push + `vercel --prod` every session.
  - **Consequence: anything not gitignored gets committed and pushed automatically.** That
    nearly published a Google client secret this session (see Security below).
- `vercel` runs from **PowerShell**; a session-start hook claimed the CLI was not installed,
  but `vercel --prod --yes` worked from PowerShell every time it was run this period.
- Hugging Face: not touched since before 2026-08-05.

## What changed since the last note (chronological)

### 2026-08-30 — seven cross-section features (commit `479d73b`)
All in `web/builder.js` / `builder.html` / `style.css` unless noted:
1. **Extrapolation to section ends** — "Beyond the end boreholes": blank / hold flat /
   continue trend. `web/section_geom.js` `interpolateSeries(..., extrap)`. Grey dotted line
   marks where data stops.
2. **Offset-corrected ground surface** — new mode `dtm-offset`: `delta = collar GL − DTM at
   the borehole's own position`, interpolated along the line and added to the on-line DTM.
   `web/terrain.js` `offsetCorrectedProfile()`. The line deliberately does **not** pass
   through an off-line collar. (ADR-1)
3. **Export filenames** `TITLE_TYPE_DATE` via `exportStem()` — site plan + cross-section PNG.
4. **Rotatable rectangle annotations** — stored as 4 corners in (chainage m, level mPD);
   drag to move, or type corners, or centre/size/angle helper. (ADR-2)
5. **Click a borehole on the site plan to deselect it** (goes grey; `secExcluded`).
6. **Hover readout** — dotted vertical line + every layer's top level/thickness.
7. **Save everything** — project CSV `#GEOVIS` header now v2: section options, deselected
   boreholes, annotations. `web/project_csv.js`. (ADR-3)

### 2026-09-10 — site map fixes + landing page (commits `4b1d0de`, `d20d568`)
- **OpenStreetMap blank above zoom 19** on the Site Map — root cause: hand-rolled layer with
  `maxZoom:19` and no `maxNativeZoom`. `web/sitemap.js` now builds its layers from the
  shared `BASEMAPS` table in `map_export.js` (also adds Esri satellite there).
- AGS-stratigraphy dots made solid with dark outlines (were 55% transparent, no stroke).
- **`dtm-offset` is now the default** ground-surface mode.
- Landing page (`web/index.html`): removed About, Docs, the round cube-icon nav button, and
  both "Powered by GemPy & Hugging Face" lines.
- **New `web/login.html`** — IFU-app login template, in this site's own palette; reuses the
  landing contour artwork. `account.html` no longer has its own sign-in card; it redirects
  signed-out visitors to `login.html`. (ADR-4)
- `docs/DEVLOG.md`, `DECISIONS.md`, `UX_CHANGELOG.md` started (commit `8af79a3`).

### 2026-09-23 — Supabase switched on + saved datasets (commit `533989b`)
- Supabase project **`ylxyovcujybqodjesbvo`** ("Geological-Map-Visualiser", Singapore).
  The `projects` table **did not exist** — `docs/supabase_schema.sql` had never been run.
  Applied as migration `create_projects_with_owner_only_rls` (4 owner-only RLS policies,
  `touch_updated_at` trigger with pinned `search_path`).
- `web/supabase_config.js` now holds the real Project URL + **anon** key (verified the JWT
  role is `anon`, not `service_role`).
- **One dataset picker** in the borehole panel ("Example & saved datasets"): built-in
  examples and the user's saved datasets as two optgroups (`ex:<id>` / `cloud:<uuid>`), with
  Save as new / Save changes / Rename / Delete. The old separate `cloud-list` UI was removed.
  (ADR-5)
- Verified end to end against the real DB with a temporary confirmed user (save → full
  reload → reopen restored title, exaggeration, extrapolation, annotation, deselected
  borehole; rename/overwrite/delete all worked). Anonymous REST read → `[]`, insert → 401.
  Temp user deleted afterwards.

### Security fix this period
- **`.env` was not gitignored** and held the real Google OAuth `CLIENT_ID`/`CLIENT_SECRET`.
  With the auto-commit hook, the next session end would have pushed it to a public repo.
  Fixed in `.gitignore` (`.env`, `.env.*`); `git log --all -- .env` confirmed it was never
  committed. **The code never reads that file** — the secret belongs only in the Supabase
  dashboard. The user can delete `.env` entirely.

## Current state (verified 2026-09-24, not assumed)

- `main` @ **`1282d4d`**, working tree clean, identical to `origin/main`.
- Live on Vercel: `/`, `/builder`, `/login`, `/account`, `/supabase_config.js` all 200; live
  config carries the Supabase project ref.
- Supabase Google provider **enabled** — `/auth/v1/authorize?provider=google` → 302 to
  accounts.google.com.
- Database right now: **1 user, 1 Google identity, 1 saved project.** So a real Google
  sign-in and a real save have happened — **done by the user themselves, outside this
  session; I did not observe it.** Whether they landed back on the right page is unknown.
- All 5 Node self-checks pass (`test_contour`, `test_examples`, `test_project_csv`,
  `test_section_geom`, `test_terrain`).

## Known gaps / open questions

**New this period**
1. ~~UX_CHANGELOG stale~~ — fixed at handover time with a superseding line.
2. **Supabase Redirect URL allow-list is unverified** (not readable via the MCP). If the
   site URL is missing, sign-in succeeds but lands on the home page instead of
   `account.html`. Ask the user where they landed after signing in.
3. **Google consent screen shows "ylxyovcujybqodjesbvo.supabase.co"** instead of
   "GeoVisualise". Fix is the App name under Google Auth Platform → Branding (no review
   needed as long as no logo is uploaded). Cosmetic.
4. Leftover **`public.boreholes`** table in Supabase from an earlier experiment — unused by
   this app, has RLS on. Offer to drop it; don't just drop it.
5. Security advisor warns "Leaked password protection disabled" — irrelevant while sign-in
   is Google-only.
6. `.env` (Google client ID/secret) is now ignored but still on disk and unused — offer to
   delete.
7. `web/hero_globe.png` — gitignored, unused, and off-brand (AI globe, garbled text). Was
   considered for the login hero and rejected.

**Carried forward from the 2026-08-05 note (still open)**
8. **Geotech feature roadmap** (SPT/RQD/groundwater/φ′-c′) — fully planned in
   `docs/PLAN_GEOTECH_FEATURES.md`, **deliberately parked** by the user. Ask before starting.
9. **Playwright test harnesses still not committed** — flagged across four handovers now.
   Previous note said: just commit them under `tests/` next time rather than flagging again.
   (Not done this period either; check whether they still exist in any scratchpad.)
10. Admin gate is client-side SHA-256 only — not real security.
11. 3D-from-map button is still a stub.
12. `src/ingest_ags.py` doesn't share `ags_open_data.py`'s classification logic.
13. Project CSV (`#GEOVIS` header) is a homegrown format — and is also the cloud save format.
14. Stale `.env.local` holds a *different* project's Supabase `DATABASE_URL` — unused.
15. Terrain open items (`docs/PLAN_TERRAIN_PROFILE.md` §7): canopy bias, bridge spikes, no
    profile persistence.

## If continuing, good first moves

- `git log --oneline -5` and `git status` — don't trust this note over the repo.
- Re-run the five Node self-checks (seconds) before touching interpolation, terrain,
  project CSV, examples or contouring.
- **Ask the user** how the Google sign-in went (item 2) and whether they want the app name,
  the `boreholes` table, `.env` and `.env.local` dealt with (items 3, 4, 6, 14).
- Before touching the cross-section renderer, note the axis supports stations outside
  0..lineLen (`dMin`/`dMax`/`plotSpan`) and extrapolated bands use `qLo`/`qHi`.
- Before touching the dataset picker, note two async sources feed it in either order —
  see the `hadSelection` guard in `builder.js`.
- Ask before starting the geotech roadmap (item 8).
