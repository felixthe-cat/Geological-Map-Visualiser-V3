# Handover Note — 2026-07-26 (late session)

> Read `SOUL.md` first per CLAUDE.md. This note replaces the earlier 2026-07-26 notes and
> carries forward their still-open items. This session was short (one feature); most of the
> "what changed" section below is inherited unchanged from the prior handover — only the new
> "Example dataset" entry is new work from this session.

## What this project is (unchanged)

Free, open-source 2D/3D geological modelling tool for Hong Kong ground-investigation data.
- **Vercel** (`web/`) — static JS frontend: landing page + 2D Builder.
  Live at **https://geological-map-visualiser.vercel.app**
- **Hugging Face Space** (`app.py` + `src/`) — Gradio backend: CEDD AGS open-data fetch/parse
  and (admin-gated) GemPy 3D. Live at **https://ferxxxxx-geological-map-visualiser-v3.hf.space**

The 2D Builder has **5 tabs**: 1 Site Map · 2 Borehole Log · 3 Cross-Section ·
4 Rock Contour · 5 3D via Hugging Face (admin-gated).

## Deploy mechanics (unchanged)

- GitHub `main` → `origin/main`. **A GitHub push only updates the Vercel Preview** —
  always run `vercel --prod --yes` from the repo root afterwards.
- Hugging Face: branch `hf-deploy`, `git checkout main -- app.py src/`, commit,
  `git push space hf-deploy:main`, then poll
  `https://huggingface.co/api/spaces/ferxxxxx/Geological-Map-Visualiser-V3/runtime`
  for `"stage":"RUNNING"`.
- `.claude/auto_push.ps1` (Stop hook) auto-commits/pushes and syncs the Space.

## What changed this session

**New work (this session): example dataset picker (commit `cabace2`)**
The user supplied two photographed tables from a published site-investigation report
(station schedule + stratigraphy summary) and asked for them as a loadable example under
Import/export CSV. Delivered:
- `web/examples.js` — one example, `hillside-tuff`: 4 real drillholes (DH 3–DH 6) near Route
  Twisk, Tsuen Wan (HK1980 ≈ E829000/N827500), GL +171 to +187 mPD, fill/concrete over
  colluvium over an undivided "Grade V to IV rock" band over Grade III+ rock (tuff breccia /
  siltstone), rockhead +148.91 to +164.41 mPD. Stored as project CSV so grades, coordinates
  and GL survive the load.
- Two transcription decisions recorded in the file: (1) the source report does **not** split
  Grade V from Grade IV, so that band is kept undivided with no grade numeral rather than
  inventing a split — correctly, this means it does NOT count as rockhead; (2) "Grade III or
  better" is tagged `III` so the Rock Contour tab reproduces the report's own rockhead levels
  exactly.
- `web/test_examples.mjs` independently re-transcribes the source table and asserts every
  level/thickness/coordinate/rock-type/end-of-hole against the parsed CSV, layer contiguity,
  and that computed rockhead equals the published Grade III top level.
- UI: dropdown + "Load example" button + description, at the top of the Import/export CSV
  panel (`web/builder.html`); wiring in `web/builder.js` loads via `loadProjectCSV`, drops the
  CSV into the textarea too, and jumps to the Borehole Log tab.
- Verified end to end (13/13 browser checks incl. round-trip export/re-import) on both
  localhost and production; contour tab reproduces rockhead 148.91–164.41 mPD exactly, matching
  the source table.

**Everything below is inherited from the prior session, unchanged and still live** — see the
git log (`afef3ad` through `7861430`) for the actual diffs. Summarized so this note is
self-contained:

1. **Borehole log rendering** — mPD axis in its own lane, label/legend column sized to content.
2. **AGS download is the ORIGINAL CEDD file** — new `/fetch_raw_ags` endpoint, CRC-verified
   against CEDD's own central directory (`test_raw_ags.py` at repo root). Derived AGS4 export
   deleted.
3. **Project CSV round trip** — moved to `web/project_csv.js`, proper RFC4180 quoting, verified
   lossless (`web/test_project_csv.mjs`).
4. Removed the old fake "load sample" datasets (superseded this session by the real example).
5. "Trial pits only" → **"Boreholes only (exclude trial pits)"**.
6. Site-plan PNG export with base-map switch (Google Hybrid / Esri / OSM), `web/map_export.js`.
7. Esri removed from the Site Map tab's layer control (kept elsewhere, since it's the only
   exportable satellite source at some HK zoom levels).
8. New **Rock Contour** tab — `web/contour.js` + `web/test_contour.mjs`: rockhead contours
   (IDW/nearest, marching squares), engineering-drawing style, "rock N.E." for unproved holes.
9. Cross-section interpolation: linear / monotone cubic (PCHIP) / nearest neighbour —
   `web/section_geom.js`, horizons interpolated as thicknesses so bands can't cross.
10. Export-fidelity fix: basemap substitution (thought to be a CORS workaround) removed —
    Google/Esri/OSM all send `ACAO: *`; `maxNativeZoom` added per source instead.
11. Full QA audit fixes: horizontal scroll on mobile/tablet, CLS 0.287→0.002, dead `app.js`
    load on the landing page, admin-gate badges no longer injected post-paint (3D locked in
    markup), blank-bbox-reads-as-0 bug, `NaN` in section polygons from tied station distances
    (`mergeTies`), duplicate-report deduplication, Lighthouse a11y 92→100 / BP 93→96 / SEO
    91→100.
12. **Fill clasts misread as rockhead** (`afef3ad`) — geotechnically significant fix: reclamation
    fill described as "...gravel OF moderately decomposed rock fragments..." was being promoted
    to Grade III rock. Two guards added above the decomposition rule in `classify_layer()`.
13. Callout de-clutter (`placeLabels()` in `contour.js`, shared `placePointLabels()` helper),
    borehole picker map on the Log tab, borehole names on the cross-section site plan.
14. Import limit raised 300 → **1000**, measured against real scaling data and CSDI density
    stats; truncation now reported instead of silent.
15. Fixed `"Set map center and zoom first."` on dense loads (`hasView()` guard + view-before-await
    ordering).
16. AGS coverage layer (whole-territory density shading), "show boreholes without AGS" toggle,
    A/B coordinate boxes for the section line (live both directions, including whole-line drag).

## Deploy state (verified this session)

- **`main` @ `cabace2`**, working tree clean, pushed to `origin/main`.
- **Vercel production confirmed live**: `/builder` serves `id="example-select"` and
  `id="example-load"`; `examples.js` is served and contains `hillside-tuff`.
- **HF Space**: not touched this session (no backend changes needed for the example feature).
  Last verified `RUNNING` and in sync with `main`'s `app.py`/`src/` in the prior session — not
  re-checked now; re-verify before relying on it if it's been a while.
- **Tests green just now**: `node web/test_examples.mjs`, `node web/test_contour.mjs`,
  `node web/test_section_geom.mjs`, `node web/test_project_csv.mjs` all pass.
- Last full example-flow browser run: **13/13** checks on both localhost and production
  (load → metadata → log diagram → picker map → cross-section → rock contour rockhead levels
  match the source table exactly → export/re-import round trip), no console errors.

## Known gaps / open questions

1. **The user has explicitly paused the geotechnical feature roadmap** (SPT / RQD /
   groundwater / φ′-c′ tables). Researched and planned in a prior session, then the user said
   *"stop with the feature plan for now — the current feature set is sufficient."*
   **Do not start it unless asked.** If it's ever revisited: across 60 random CEDD reports,
   ISPT (SPT N) is in 30% of reports, CORE (TCR/SCR/RQD) 47%, TRIG (c′/φ′/cu) 37%, CLSS 37%,
   GRAD 33%, POBS (groundwater) 25%.
2. **The Playwright test harnesses are NOT committed** — they live in this session's scratchpad
   directory (`audit_visual.py`, `audit_functional.py`, `bench_scale.py`, `test_logplan.py`,
   `test_new3.py`, `test_dense.py`, `test_example_ui.py`) and will be lost when the scratchpad
   is cleared. Offer to commit them under `tests/` if the user wants the audits repeatable —
   this has now been flagged across two consecutive handovers without action.
3. **Admin gate is not real security** — client-side SHA-256 only. Unchanged.
4. **3D-from-map button is still a stub** ("Send to 3D Builder (not built)").
5. **`src/ingest_ags.py`** (direct-upload AGS parser for the 3D pipeline) still does **not**
   use the current classification logic (including the fill-clast fix) — only
   `ags_open_data.py` / `fetch_stratigraphy` does.
6. **Project CSV is a homegrown format** (`#GEOVIS {json}` header + 9 columns). Not AGS.
   Correctly quoted and round-trip tested, but only this tool reads it.
7. **Contour callouts are dropped when they can't fit** (hover tooltip + a count in the UI) —
   a display limit at high density, not a bug.
8. Esri imagery stops at z19 over some HK sites (handled via `maxNativeZoom`; remember it if a
   new basemap source is ever added).
9. **The example dataset has no "Residual Soil" layer** — the source table's Residual Soil
   column was empty for all 4 holes. If the user later supplies drillholes that do have
   residual soil, extend `web/examples.js` (and its test) rather than editing the existing
   entry's numbers.
10. Only one example exists (`hillside-tuff`). The picker UI (`EXAMPLES` array + dropdown) is
    built to take more without changes — adding one is just another entry + a test block in
    `test_examples.mjs`.

## If continuing, good first moves

- Don't trust this note over the repo: `git log --oneline -8`, `git status`, and re-check the
  live URLs before assuming anything is still true.
- Re-run the four Node self-checks (seconds) before touching classification, interpolation,
  contouring, project CSV, or the example dataset.
- Reference AGS test site: bbox lat 22.306412–22.311633, lng 114.159939–114.166977 (reports
  71936/62077/62076/66636) → expect ~142 stations found, ~39 boreholes loaded after dedupe.
  Densest HK site for stress testing: E834000–834500 / N840000–840500
  (lat 22.499611–22.504127, lng 114.154833–114.159692) → ~421 boreholes.
- The new built-in example (no network needed): open Import/export CSV & examples on the Log
  tab, pick "Hillside drillholes DH 3–DH 6", click Load example.
- If you touch `classify_layer()`, read `docs/AGS_CLASSIFICATION.md` first, and keep the
  clast/FILL guards **above** the decomposition rule.
- Ask before starting the geotechnical feature roadmap (item 1 above) — deliberately parked.
- Consider committing the scratchpad test scripts (item 2 above) if the user wants a repeatable
  regression suite going forward — it's been useful every session so far.
