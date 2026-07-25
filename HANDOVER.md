# Handover Note — 2026-07-26

> Read `SOUL.md` first per CLAUDE.md's instruction. This file picks up from there with
> where things actually stand after this session's work (cross-section redesign +
> AGS classification overhaul + project save/resume + admin gate).

## What this project is

Free, open-source 3D/2D geological modelling tool for Hong Kong ground-investigation data.
Two live surfaces:
- **Vercel** (`web/`) — static JS frontend: landing page, 2D log/cross-section builder, site map.
  Live at **https://geological-map-visualiser.vercel.app**
- **Hugging Face Space** (`app.py` + `src/`) — Gradio app running GemPy for heavy 3D modelling.
  Live at **https://ferxxxxx-geological-map-visualiser-v3.hf.space**

Architecture decision unchanged: light/instant features (2D log, cross-section, site map,
borehole entry) live in the Vercel/JS layer; HF Spaces stays the specialist heavy-compute
backend for GemPy 3D.

## Deploy mechanics (unchanged, still the workflow used every commit this session)

- **GitHub**: `main` → `origin/main`. A GitHub push alone only updates the Vercel **Preview**.
- **Vercel production**: run `vercel --prod --yes` from repo root after every push — do not
  rely on the GitHub push alone.
- **Hugging Face**: separate branch `hf-deploy`, pushed to remote `space`:
  ```bash
  git checkout hf-deploy
  git checkout main -- app.py src/        # NOTE: now syncs ALL of src/, not just 1-2 files —
                                           # this was a real bug this session, see "Fixed" below
  git commit -m "sync: ..."
  git push space hf-deploy:main
  git checkout main
  ```
  Then poll `https://huggingface.co/api/spaces/ferxxxxx/Geological-Map-Visualiser-V3/runtime`
  for `"stage":"RUNNING"` before trusting the new endpoint.
- **Always verify live after deploying** — this session's pattern: drive the actual
  `https://geological-map-visualiser.vercel.app/builder` page via the browser tool (fill the
  bbox, click through the real UI, read back DOM state), and call the HF endpoint directly
  via `gradio_client` in Python, before declaring anything done.
- `.claude/auto_push.ps1` (the Stop hook) now uses `git add -A` (was `git add -u`) and syncs
  all of `src/` to HF — see "Fixed this session" below for why.

## Fixed this session (real bugs, not just features)

1. **Live production was broken at the start of this session** — `web/builder.js` imported
   `./section_geom.js`, but that file had never been committed (the old hook's `git add -u`
   only stages tracked files). Fixed: committed the file, deployed, verified. Also fixed the
   root cause — hook now uses `git add -A` and a `.gitignore` that excludes `/data/`,
   `scratch/`, `.claude/`, `.env*.local` so `-A` is safe.
2. **AGS3 headings that wrap across multiple lines** were being overwritten instead of
   accumulated, silently dropping key columns (`HOLE_ID`, `GEOL_TOP`/`BASE`) and making whole
   AGS3 reports parse to **zero** boreholes. This was the actual cause of "only a few of many
   AGS boreholes import" — not a hard data limitation. Fixed by accumulating wrapped heading
   lines and merging `<CONT>` continuation rows back into the record (so wrapped
   `GEOL_DESC` text is captured in full too).
3. **`MAX_IMPORT` in `sitemap.js`** raised from 40 → 300 (was silently capping imports on
   large sites).
4. **The auto-push hook only synced `app.py` + `src/map_view.py` to HF** — backend fixes to
   `src/ags_open_data.py` (the module that actually runs `/fetch_stratigraphy` on HF) were
   landing on GitHub but never reaching the Space. Now syncs all of `src/`.

## What's built and verified working (as of commit `b7ea2ef`)

### Web frontend (`web/`)
- `index.html` — landing page. 3D Viewer link/card now gated behind an **admin login**
  (see "Admin gate" below) — greyed out with a "Coming soon" badge for normal users.
- `builder.html` + `builder.js` — 4 tabs: **1 Site Map → 2 Borehole Log → 3 Cross-Section →
  4 3D via Hugging Face** (tab 4 also admin-gated).
  - **Cross-Section tab redesigned this session**: the old static SVG site plan was replaced
    with a live **Leaflet satellite map** (`renderSitePlan()`), showing the site boundary
    (thick yellow dashed rectangle, `maxBounds` ≈50% larger than the drawn site) and a
    **draggable red section line** with two handles (`drawSectionLine()`/`onHandleDrag()`).
    Dragging live-updates which boreholes are included (`sectionStations()` in
    `web/section_geom.js` — pure, Node-testable projection/corridor logic;
    `web/test_section_geom.mjs` is its self-check) and re-renders the section.
  - **Cross-section diagram (`renderSection()`)**: grouped/coloured by **decomposition
    grade** (not raw stratum name) via `classKey()`/`classColour()`/`classLabel()`; a
    collapsible **options panel** (`#sec-options`) above it holds: custom title (live-updates),
    vertical exaggeration, distance-tolerance slider, show/hide logs, show/hide names,
    trial-pits-only filter. Hover a band/log-strip/legend entry highlights that class and dims
    the rest. A/B markers on the diagram match the section-line ends on the map. Regular
    x-axis (distance) added alongside the existing y-axis (elevation). The **legend only
    lists grade classes currently present** in the section — updates live as boreholes
    enter/leave while dragging.
  - **Borehole Log tab**: de-cluttered label placement (leader lines, no overlap on thin
    layers) + a **Labels: inline/legend** toggle button next to Export PNG.
  - **Panel collapse**: "⟨ Collapse" button top-right of the data-entry panel; when
    collapsed, a floating `⟩` button (top-left, fixed position) re-expands it. Applies on
    any tab (not just Cross-Section).
  - **Project save/resume** (new "Save / resume project" section under Import/export CSV):
    "⬇ Download project CSV" exports all boreholes/trial pits **with decomposition grade,
    kind (BH/TP), site boundary, and the current section line** in one CSV (`#GEOVIS {...}`
    JSON header line + a 9-column CSV body — see `stateToProjectCSV()`/`projectCSVToState()`
    in `builder.js`). A drag-and-drop zone (`#proj-drop`) + "Load project into 2D Builder"
    button restores everything, including re-drawing the site boundary and section line.
- `sitemap.js`:
  - `MAX_IMPORT` now 300 (was 40).
  - After loading, AGS points that turned out to have **no geological log** (trial pit /
    CPT / plate-load stations) are recoloured grey on the map (previously stayed green just
    because the *report* had AGS). The status text under the map now reports the breakdown:
    "N with a geological log (green). M AGS point(s) with no solid/rock log — trial pit / CPT
    (now grey). K location-only."
  - **"⬇ Download extracted data (AGS)"** button at the bottom of the Site Map tab —
    regenerates a minimal valid **AGS4** file (LOCA + GEOL groups) from whatever was loaded
    into the 2D Builder (classified stratum + grade). This is NOT the original CEDD AGS
    file byte-for-byte — it's our re-derived data. Flagged to the user as a known limitation;
    they haven't asked for the original-file variant yet.
  - Exports `ensureMapLibs()` (Leaflet/Draw/proj4 loader) so `builder.js` can reuse the same
    CDN libs for the satellite section map without a second load.
- `admin.js` (new) — client-side admin gate. `window.GeoAdmin = {isAdmin, tryLogin, logout}`.
  Stores only a **SHA-256 hash** of the password (not the plaintext) in the source; sets
  `localStorage['geovis_admin']='1'` on success. **Not real security** — a determined user
  can bypass a client-side check. Elements tagged `data-lock3d` (3D Viewer link/card on
  `index.html`, viewer link + HF tab on `builder.html`) get `.locked3d` (greyed,
  non-clickable) + a "Coming soon" badge unless admin. Admin button is bottom-right of the
  landing page. **The plaintext admin password was given to Felix directly in chat, not
  stored in any repo file or memory** — if it needs rotating, regenerate the SHA-256 and
  replace `HASH` in `admin.js`.

### Backend (`app.py`, `src/`)
- `src/ags_open_data.py` — significantly overhauled this session. `classify_layer()` is now
  the core function (returns `(surface_label, grade_label)` per GEOL row); grade format is
  e.g. `"V (CDG)"`, `"IV (HDG)"`, `"VI (RS)"`, `"I (Fresh)"`. Decision order (see
  `docs/AGS_CLASSIFICATION.md` for full detail + tables):
  1. `GEOL_GEO2` grade code (authoritative) → 2. `GEOL_GEO2` origin code → 3. Description
  decomposition word ("completely/highly/moderately/slightly decomposed", handles the
  "completley" typo) → 4. Description special/origin markers (topsoil, shell→Marine,
  asphalt/concrete/shotcrete→Made Ground, brick/rubble→Fill, diamict→Superficial Deposit,
  alluvium/colluvium) → 5. Rock **strength term** when a rock is named but "decomposed" isn't
  (extremely weak→V, weak→IV, moderately weak/strong→III, strong→II, very/extremely strong→I)
  → 6. **`WETH` group join by depth** (authoritative weathering grade when nothing else
  resolved it — new this session, `_weth_grade_at()`) → 7. Quaternary (`GEOL_GEOL='Q'`) with
  no other signal → "Superficial Deposit" → 8. **Option-A default**: a bare granular grading
  code (SAND/SILT/CLAY/GRAV/CBBL/BLDR…) with zero other signal defaults to **CDG Grade V**
  (`guess_bare_grade()`) — confirmed by the user as the desired behaviour for HK
  weathered-granite terrain.
  - Also captures **AGS3 `<CONT>` continuation rows** now (merged back into the record before
    classification), so wrapped `GEOL_DESC` text isn't lost.
  - Result: 0 raw grading codes left on the user's test site (was previously showing
    `SANDZG`/`SILTS` etc. unclassified); ~1 unclassifiable row per 3,800 across a broad
    60-report sweep (a genuine note-only row with no material).
  - Self-check: `python -m src.ags_open_data` — extensive asserts covering AGS3/AGS4 parsing,
    wrapped headings, WETH join, strength terms, special materials, option-A default.
- `app.py` — three Gradio endpoints unchanged (`build_model`, `build_model_csv`,
  `fetch_stratigraphy`).

### New reference doc
- **`docs/AGS_CLASSIFICATION.md`** — explains, for a human reviewer: where the AGS fields
  come from, the GeoGuide 3 Table 4 grade table, the full classification decision order, and
  worked examples. Written this session at the user's request so they can audit the logic.

### Data files (unchanged)
- `data/gi_spatial_index.sqlite` — local only, not committed (now enforced via `.gitignore`).
- `web/data/boreholes.csv` / `ags_repnos.json` — committed, live site reads these.

## Known gaps / open questions — ASK THE USER, don't assume

1. **Pending confirmation from the user** (asked at the end of this session, not yet
   answered): is it OK that `Topsoil`, `Superficial Deposit`, `No Recovery`, `Wash Boring`,
   and `Made Ground` are treated as valid non-grade materials (alongside Fill/Alluvium/
   Marine Deposit/Colluvium/Concrete/Asphalt that the user explicitly named)? Don't assume
   yes — check the transcript / ask again if it's been a while.
2. **AGS download (task 4) is re-derived data, not the original file.** If the user later
   wants the byte-for-byte original CEDD AGS report(s) instead of/alongside our regenerated
   AGS4, that needs a new backend endpoint (fetch + zip the original report files) — not
   built.
3. **Admin gate is NOT real security** — purely a UX deterrent for hiding half-built 3D
   features from casual visitors. If the user ever wants genuine access control, that's a
   different (server-side) piece of work.
4. **3D-from-map button is still a stub** ("Send to 3D Builder (not built)") — unchanged
   from before, still an intentional placeholder.
5. **`src/ingest_ags.py`** (the direct-file-upload AGS parser for the main 3D pipeline) still
   has NOT been updated with the new classification logic — only the `ags_open_data.py` /
   `fetch_stratigraphy` path (used by the site map) has it. Follow-up task if the user wants
   consistent grading when uploading their own AGS file to the 3D tab.
6. **Duplicate-report edge case** (same station under two REPNOs) still not deduplicated —
   harmless, not fixed, not asked for.
7. The **project CSV format is a new, homegrown format** (`#GEOVIS {json}` header + 9-column
   body) — not AGS, not a standard. It's only readable by this tool's own import. Fine for
   its stated purpose (save/resume a session) but don't confuse it with the AGS download.

## Reference docs already in the repo
- `COMPETITOR_ANALYSIS.md`, `PROJECT.md`, `IMPLEMENTATION_PLAN.md` (older, partially stale)
- `docs/AGS_CLASSIFICATION.md` — **new this session**, read this before touching
  `classify_layer()` / `guess_bare_grade()` again.
- `SOUL.md` — the actual agent system prompt (CLAUDE.md just points here).

## If continuing, good first moves
- Re-verify live state before assuming this note is still accurate — curl the Vercel URL,
  poll the HF Space `/runtime` endpoint, and if touching AGS classification, re-run
  `python -m src.ags_open_data` plus the bbox check against reports `71936/62077/62076/66636`
  (the user's test site — lat 22.306412–22.311633, lng 114.159939–114.166977, expect 55
  boreholes with logs of 133 "green" AGS points).
- Check `git log --oneline -15` and `git status` — last known-good commit this session was
  `b7ea2ef`, working tree clean.
- Resolve open question #1 above before making further changes to the allowed-non-grade list.
