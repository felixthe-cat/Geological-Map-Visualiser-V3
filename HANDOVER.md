# Handover Note — 2026-08-05

> Read `SOUL.md` first per CLAUDE.md. This note replaces the 2026-07-26 note and carries
> forward its still-open items (see "Known gaps" below — items 1–10 from before are mostly
> unchanged; a few are updated/superseded, marked as such).

## What this project is (unchanged)

Free, open-source 2D/3D geological modelling tool for Hong Kong ground-investigation data.
- **Vercel** (`web/`) — static JS frontend: landing page + 2D Builder. No build step, no
  `package.json` — plain files served as-is.
  Live at **https://geological-map-visualiser.vercel.app**
- **Hugging Face Space** (`app.py` + `src/`) — Gradio backend: CEDD AGS open-data fetch/parse
  and (admin-gated) GemPy 3D. Live at **https://ferxxxxx-geological-map-visualiser-v3.hf.space**

The 2D Builder has **5 tabs**: 1 Site Map · 2 Borehole Log · 3 Cross-Section ·
4 Rock Contour · 5 3D via Hugging Face (admin-gated).

## Deploy mechanics — CHANGED this session

- GitHub `main` → `origin/main`. A GitHub push only updates the Vercel **Preview**, never
  Production — this had bitten two sessions in a row (user reported "I pushed but can't see
  it"). **Fixed at the source**: `.claude/auto_push.ps1` (the Stop hook that already
  auto-commits/pushes every session) now also runs `vercel --prod --yes` itself, every
  session, unconditionally. You should no longer need to remember to do this manually — but
  if the user ever again reports "pushed but not visible," check that step is still in the
  hook before anything else.
- Hugging Face: branch `hf-deploy`, `git checkout main -- app.py src/`, commit,
  `git push space hf-deploy:main`, then poll
  `https://huggingface.co/api/spaces/ferxxxxx/Geological-Map-Visualiser-V3/runtime`
  for `"stage":"RUNNING"`. Not touched this session (no backend changes made).

## What changed this session (in the order the user asked for it)

### 1. Cross-section offset disclosure (commit `28ebb25`)
A borehole projected onto the section line from some distance away has its log drawn at a
position on the line that isn't really where it was logged. Added:
- `web/section_geom.js` — `sectionStations()` now returns each station's perpendicular
  distance (`perp`) from the line, not just its along-line distance.
- `web/builder.js` — the section diagram labels each borehole with its offset
  ("14.2 m off-line"), coloured grey/amber/red by how much of the chosen **Distance
  tolerance** it's using (>50%/>85%), and dashes the borehole's log-column outline at
  amber/red severity. New "Show offset from line" toggle, on by default.
- `web/test_section_geom.mjs` extended.

### 2. Real terrain ground surface (commits `7ad7a1a`, `ae63b5a`)
The section's ground line between boreholes was pure interpolation — could miss a real
crest/gully on a hillside. Investigated feasibility live against the LandsD 5 m DTM
(`docs/PLAN_TERRAIN_PROFILE.md`), then built it:
- **New `web/terrain.js`** (pure, Node-testable) — Web Mercator tile math, bilinear LERC
  tile sampling, and `correctedProfile()`: adds the DTM's own local shape on top of the
  usual borehole-interpolated surface, so it still passes **exactly** through every
  surveyed collar (proven pixel-exact in browser testing, including for a 46 m-offset
  borehole — see the regression test in `web/test_terrain.mjs`, added after a real bug
  where a naive "residual" approach was off by 13.8 m right at an offset collar).
- `web/builder.js` — LERC decoder + DTM tile fetch/cache (lazy-loaded, only when used),
  wired into `renderSection`. New "Ground surface" dropdown: **Interpolated between
  boreholes** (default, unchanged behaviour) / **LandsD 5 m DTM fitted to collars**
  (recommended) / **LandsD 5 m DTM raw** (comparison — not fitted, will disagree with
  borehole GLs by design; the on-screen note now explains why).
- `web/section_geom.js` — `interpolateHorizons()` gained an optional `topOverride` param.
  **Important, and now documented in the UI**: strata layer *thicknesses* are always
  interpolated between boreholes the same way regardless of ground-surface mode — only
  what the layer stack hangs from changes. The note under the dropdown says this explicitly
  now (the user asked for it after noticing the DTM-raw mode's layers looked "different").
- Two real bugs caught and fixed via testing against the live service (not assumed away):
  Esri elevation tiles decode to 257×257 samples, not 256×256 as documented; and the first
  correction-math design didn't account for borehole offset from the line. Both are written
  up in `web/terrain.js` comments and `docs/PLAN_TERRAIN_PROFILE.md`.

### 3. "Include beyond A/B" (this session, same commit range)
Boreholes just past either end of the drawn section line were dropped outright. New slider
next to Distance tolerance (0–300 m) that widens the *along-line* acceptance margin without
touching the perpendicular corridor — a hole off to the side still gets excluded.
- `web/section_geom.js` — `sectionStations()` gained an `extension` param.
- `web/builder.js` — the section's distance axis now expands to fit any extended station
  (A and B stay correctly marked at their true positions); DTM tile prefetch was extended
  to cover the wider span too, or an extended borehole under a DTM mode would hang on
  "still loading" forever.
- Verified live: a borehole pulled in from *before* A and one pulled in from *after* B both
  render correctly; default-mode output stays byte-identical to pre-change baseline.

### 4. Cross-section geotech features — PLANNED ONLY, not built (this session)
User asked for a plan (SPT track, RQD track, φ′/c′ as a test register not design
parameters, data-completeness panel, PDF report output) — see
`docs/PLAN_GEOTECH_FEATURES.md`. Deliberately not started; the user's own prior instruction
to pause this roadmap (see Known gaps #1) still stands unless they now say to begin it.

### 5. Cloud accounts — Supabase auth + saved projects (this session, commit `2ed5cdd`)
User asked: verify whether Supabase was connected, and if not, build Google sign-in +
per-user saved projects (including cross-sections).
- **Verification result: Supabase was NOT connected.** No code referenced it. `.env.local`
  had a Supabase `DATABASE_URL`, but it's a stale leftover from a **different** Vercel
  project (`group-expense-tracker`), confirmed via its `NEXT_PUBLIC_APP_URL` and via
  `vercel env ls` on the actual live project (empty). Not used — wiring to it would have
  mixed this app's data into the wrong project's database. It's gitignored/untracked;
  worth deleting to avoid future confusion, but that's the user's call.
- **Built, code-complete, verified dormant:**
  - `docs/supabase_schema.sql` — `projects` table, Row Level Security policies
    (owner-only), `updated_at` trigger. Not yet run anywhere (needs the user's Supabase
    project to exist first).
  - `web/supabase_config.js` — the two settings (URL + anon key) the user fills in.
    **Currently blank on purpose.**
  - `web/cloud.js` — auth + project CRUD, lazy-loads supabase-js from CDN only when
    configured. Every function is safe to call unconfigured (returns null/[]/throws a
    clear "not configured" error rather than crashing).
  - `web/auth_ui.js` — shared header sign-in control (avatar, name, sign out, My projects
    link).
  - `web/account.html` — sign-in page + full project list (open/rename/delete), and the
    OAuth redirect target.
  - `web/builder.html` + `builder.js` — header control, and a "My account" block inside
    Import/export CSV (project picker, Save to my account, Save over current).
  - `web/index.html` — "My projects" nav link, hidden until configured.
  - **Key design choice**: a saved cloud project is the *same* project-CSV blob the
    existing Download/Load buttons already produce (`web/project_csv.js`) — no second
    format to keep in sync, and it already round-trips the cross-section line losslessly
    (`web/test_project_csv.mjs` guards it).
- **Verified in-browser, twice**: once with blank config (cloud UI fully hidden, **zero**
  supabase.co network calls, zero console errors, section output byte-identical to
  baseline) and once with placeholder credentials temporarily injected (full signed-out UI
  renders correctly everywhere, supabase-js loads from CDN with the right API surface),
  then the placeholders were removed before committing.
- **What's NOT done**: the three setup steps that need the user's own Google/Supabase
  logins — create the Supabase project + run the schema, create a Google OAuth client,
  connect the two and paste credentials into `supabase_config.js`. Full walkthrough with
  exact redirect URLs etc. is in `docs/PLAN_ACCOUNTS_SUPABASE.md` §3. **No live
  end-to-end test of sign-in/save/reload has happened yet** — can't, until those steps are
  done.

## Deploy state (verified this session, just now)

- **`main` @ `2ed5cdd`**, working tree clean, matches `origin/main` exactly.
- **Vercel production confirmed live** (fetched just now, not assumed): `terrain.js`,
  `cloud.js`, `account.html` (redirects 308→200), all serve 200. `builder` HTML contains
  both `sec-ext` (extension slider) and `cloud-block`. Production `supabase_config.js`
  correctly shows blank `SUPABASE_URL`/`SUPABASE_ANON_KEY` — accounts feature is live but
  dormant, exactly as intended.
- **HF Space**: not touched this session — not re-verified now, re-check if it's been a
  while and something backend-related is being touched.
- **All 5 Node self-checks pass right now**: `test_contour.mjs`, `test_examples.mjs`,
  `test_project_csv.mjs`, `test_section_geom.mjs`, `test_terrain.mjs`.

## Known gaps / open questions

1. **Cloud accounts need the user to complete 3 setup steps before they do anything.** See
   `docs/PLAN_ACCOUNTS_SUPABASE.md` §3 (Supabase project + schema, Google OAuth client,
   connect + paste credentials). **Ask whether this has been done** before assuming the
   feature is usable — if it has, the good first move is a live end-to-end test (sign in,
   save a project, reopen in a fresh session/browser).
2. **The geotechnical feature roadmap (SPT/RQD/groundwater/φ′-c′) is now fully planned**
   (`docs/PLAN_GEOTECH_FEATURES.md`) but still **explicitly deliberately not started** — the
   user's earlier "stop with the feature plan for now" still stands. Ask before beginning
   Phase 1 (backend group parsing + completeness panel).
3. **Terrain feature open items** (from `docs/PLAN_TERRAIN_PROFILE.md` §7, not yet acted
   on): vegetation-canopy bias is only first-order corrected near boreholes; elevated
   structures (bridges) crossing the line would appear as spikes; no boundary-draw
   tile pre-warm or project-CSV persistence of the sampled profile yet (both additive,
   don't block current use).
4. **The Playwright test harnesses are STILL not committed** — scratchpad-only, flagged
   across three consecutive handovers now with no action. If it comes up again, just commit
   them under `tests/` rather than flagging a fourth time.
5. **Admin gate is not real security** — client-side SHA-256 only. Unchanged.
6. **3D-from-map button is still a stub.**
7. **`src/ingest_ags.py`** still doesn't share the classification logic `ags_open_data.py`
   uses (incl. the fill-clast fix). Unchanged.
8. **Project CSV is a homegrown format** (`#GEOVIS {json}` header + 9 columns) — now also
   the cloud-save format (by design, see above). Only this tool reads it.
9. **Stale `.env.local`** holds a different project's Supabase `DATABASE_URL`. Gitignored,
   unused, harmless, but worth deleting — offer to, don't just do it.
10. Contour callout drop-at-high-density, Esri z19 cap, single example dataset — all
    unchanged from before, see prior handover if detail is needed.

## If continuing, good first moves

- Don't trust this note over the repo: `git log --oneline -8`, `git status`, and re-check
  the live URLs before assuming anything is still true — this note itself was written after
  doing exactly that.
- Re-run the five Node self-checks (seconds) before touching classification, interpolation,
  contouring, terrain, project CSV, or the example dataset.
- **If the user mentions cloud accounts / sign-in / Supabase**: ask whether the 3 setup
  steps in `docs/PLAN_ACCOUNTS_SUPABASE.md` §3 are done. If yes, do a live end-to-end
  verification before saying it works — nothing has actually exercised real
  sign-in/save/reload yet, only the dormant-vs-wired-up UI paths.
- If touching the cross-section renderer, note the axis math now supports out-of-range
  station distances (`dMin`/`dMax`/`plotSpan` in `renderSection`) — read that before
  assuming `X(d)` starts at `mL`.
- If you touch `classify_layer()`, read `docs/AGS_CLASSIFICATION.md` first, and keep the
  clast/FILL guards **above** the decomposition rule.
- Ask before starting the geotechnical feature roadmap (item 2 above) — planned, still
  parked.
