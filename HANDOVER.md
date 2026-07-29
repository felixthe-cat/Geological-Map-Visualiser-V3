# Handover Note — 2026-07-26 (evening session)

> Read `SOUL.md` first per CLAUDE.md. This note replaces the earlier 2026-07-26 one and
> carries forward its still-open items. Everything below was verified against the live
> sites, not just pushed — see "Deploy state".

## What this project is (unchanged)

Free, open-source 2D/3D geological modelling tool for Hong Kong ground-investigation data.
- **Vercel** (`web/`) — static JS frontend: landing page + 2D Builder.
  Live at **https://geological-map-visualiser.vercel.app**
- **Hugging Face Space** (`app.py` + `src/`) — Gradio backend: CEDD AGS open-data fetch/parse
  and (admin-gated) GemPy 3D. Live at **https://ferxxxxx-geological-map-visualiser-v3.hf.space**

The 2D Builder now has **5 tabs**: 1 Site Map · 2 Borehole Log · 3 Cross-Section ·
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

Roughly in the order the user asked for it.

### 1. Borehole log rendering (`web/builder.js` `renderLog`)
mPD axis got its own 60 px lane with ticks; the label/legend column is now **sized to its
longest text** instead of a fixed width, so nothing is clipped and the legend can't collide
with the mPD numbers.

### 2. AGS download is now the ORIGINAL CEDD file (`src/ags_open_data.py`, `app.py`, `web/sitemap.js`)
New `/fetch_raw_ags` endpoint returns CEDD's `GI_AGS/<REPNO>.zip` bytes untouched (one report
→ that zip; several → a `ZIP_STORED` container). The derived AGS4 exporter was **deleted**.
`build_manifest()` now also records CRC-32 + uncompressed size from CEDD's own central
directory, and `fetch_report_bytes()` verifies both — that's the proof of byte-fidelity, since
there is no per-report URL to diff against (`GI_AGS/<REPNO>.zip` 404s; only the 635 MB archive
exists). **`test_raw_ags.py`** (repo root, needs network) checks outer CRC, inner member CRCs,
fetch determinism, and that the multi-report container preserves every byte.

### 3. Project CSV round trip (`web/project_csv.js` + `web/test_project_csv.mjs`)
Format logic moved out of `builder.js` into a pure module with proper RFC4180 quoting — the
old writer stripped commas/newlines out of stratum descriptions, which **was** losing data.
Round trip verified lossless end-to-end (export → drop → load → re-export is byte-identical).

### 4. Removed the "load sample" datasets. The app boots with one blank borehole.

### 5. "Trial pits only" → **"Boreholes only (exclude trial pits)"** on the cross-section.

### 6. Site-plan image export + base maps (`web/map_export.js`)
"⬇ Export site plan (PNG)" draws basemap + site boundary + red A–B line + boreholes at 2×.
Base map switches between Google Hybrid / Satellite (Esri) / OpenStreetMap.

### 7. Esri removed from the Site Map tab's layer control.

### 8. New **Rock Contour** tab (`web/contour.js` + `web/test_contour.mjs`)
Rockhead contours from the loaded logs: rock = top of the shallowest layer at Grade III (or
II) or better; IDW or nearest-neighbour interpolation; marching squares; engineering-drawing
style (thin black lines, heavier labelled index contours, borehole callouts, optional plain
white base). Boreholes that never proved rock are marked "rock N.E." and **excluded** from the
interpolation. PNG export included.

### 9. Cross-section interpolation options (`web/section_geom.js`)
Linear (default) / **monotone cubic (PCHIP)** / nearest neighbour. Horizons are interpolated
as *top surface + thicknesses*, so bands can pinch out but **never cross** — asserted in
`web/test_section_geom.mjs` against a pinched-out stratum. (Assessment of the Gemini
suggestions: both are appropriate; a *natural* cubic spline would not be, because it
overshoots and can invent rock above ground.)

### Then: export fidelity fix
The grey "Map data not yet available" export was **Esri's placeholder tile**: the exporter
silently substituted Esri for Google, and Esri has no imagery at z19–20 over the reference
site. Re-measured against the live servers — Google, Esri and OSM **all** send
`Access-Control-Allow-Origin: *`, so the CORS limitation the substitution was built around
does not exist. Substitution removed; `maxNativeZoom` added per source (Esri/OSM 19,
Google 20) for both live layers and the exporter.

### Then: full QA audit (Playwright, 3 breakpoints + 37 interaction checks) and its fixes
- **Horizontal page scroll on tablet/mobile** (docWidth 913 vs 390): a long caption in `.row`
  with `flex:0 0 auto` couldn't wrap and a grid track's min-content floor propagated it to the
  whole page. Fixed with caption flex rules, `.wrap>.panel{min-width:0}`, wrapping header and
  tab bar.
- **CLS 0.287 → 0.002**: the markup rendered the two-column layout and the deferred module
  then switched to the Site-Map (full-width) layout. Markup now ships in the boot state.
- `index.html` loaded `app.js` (viewer.html's iframe controller) and threw on every visit.
- The admin gate injected "Coming soon" badges after paint (layout shift + a window where the
  locked 3D links were live). 3D features now ship **locked in the markup**; admin unlocks.
- **Blank bbox fields read as 0** (`+'' === 0` is finite) so an empty search silently reported
  "0 boreholes" at lat/lng 0,0. Blank is now missing; `min >= max` rejected.
- `<polygon> points: NaN` console errors: two boreholes projecting to the **same distance**
  along the section line gave a 0/0 PCHIP slope. Tied stations are merged to their mean
  (`mergeTies` in `section_geom.js`), regression-tested.
- **Duplicate reports** (CEDD publishes some GI twice, e.g. 62076/62077) loaded the same
  borehole twice and drew doubled callouts. Same id + same position merges; same id at a
  different position is tagged `[REPNO]`.
- Lighthouse: perf 79→82, **a11y 92→100, best-practices 93→96, SEO 91→100**. Added preconnect
  for tile/CDN origins + Leaflet preload (LCP 5.2 s → 4.6 s), inline SVG favicon (killed the
  only console error, a 404), `for` on 15 labels, darkened `--gold` #b8860b → #8a6508 for
  contrast, meta descriptions.

### Then: fill clasts misread as rockhead (commit `afef3ad`)
**This one matters geotechnically.** The contour plan exposed 28 stations "proving rock" at
0.1–0.25 m depth (+5.5 mPD) in reclaimed Yau Ma Tei. In `classify_layer()` the description
decomposition rule ran *before* the origin markers, so reclamation fill logged as
`GEOL_LEG=FILL, "...gravel OF moderately decomposed rock fragments..."` was promoted to Grade
III rock. Two narrow guards above the decomposition rule: `LEG=FILL`/`(FILL)` ⇒ Fill, full
stop; and clast phrases (`<clast noun> of <decomp/strength term>`) are blanked before matching.
Genuine rock masses unaffected (asserted). Reference site: false shallow rockheads 28 → 0,
rock level range −48.43..+5.78 → −48.43..−23.35 mPD. Also added **"Boreholes only"** to the
contour tab (default on) — a trial pit meeting Grade III at 1–3 m is a boulder, not rockhead.

### Then: callout de-clutter + two new plan features
- `placeLabels()` in `contour.js`: each callout takes the nearest free slot (12 directions,
  radii to 230 px) around its symbol with a **leader line**, dodging contour labels and other
  symbols; contour index labels slide along their own line and are dropped where there's no
  room; anything unplaceable becomes a hover tooltip and is counted in the UI.
- **Borehole picker map on the Log tab** — every borehole with coordinates, labelled; clicking
  one drives the data-entry panel, the log diagram and the dropdown (and vice versa).
- **Borehole names on the cross-section site plan**, included in the PNG export at exactly the
  previewed positions. Both use one shared `placePointLabels()` helper.
- Placement is **synchronous on purpose**: the async version raced itself (clear → await →
  add) and drew three copies of every name on zoom/moveend.

### Then: import limit raised 300 → 1000, measured (`web/sitemap.js`)
Benchmarked with synthetic 9-layer boreholes; worst interaction (section/contour redraw) on a
1440×900 desktop: **300 → ~115 ms, 500 → ~240 ms, 800 → ~380 ms, 1000 → ~840 ms,
1500 → ~1.7 s, 2000 → everything >800 ms**. Heap 29 MB → 68 MB over that range; no errors.
Sized against reality: AGS stations per 500 m box in the CSDI index are median 10, p95 128,
p99 258, **busiest in HK 653** (a 1 km box reaches 1,420). Backend is not the limit either —
`/fetch_stratigraphy` returns 40 reports / 853 stations in 7.4 s. So `MAX_IMPORT` 300 → **1000**,
site-map markers 800 → 1500, raw-AGS report cap 50 → 200. Truncation used to be **silent** and
is now reported before and after the fetch, with a warning over 500.
Verified on HK's densest 500 m box: 655 stations → **421 boreholes** loaded, section redraw
90 ms. 1 km worst case caps cleanly at 1,000 requested → 659 loaded.

### Then: `Set map center and zoom first.` (commit `5f950c7`)
Each render awaits (`setBase`, dynamic import) between constructing a Leaflet map and fitting
its bounds; on a big site that window let a re-entrant draw project against a view-less map.
View is now set before the first await, plus a `hasView(map)` guard (public `getCenter()`) on
every draw entry point.

### Finally: three site-map/section usability features (commit `7861430`)
- **"Show AGS data coverage (whole territory)"** — shades all of HK by AGS borehole density so
  a site can be picked deliberately. 35,326 AGS stations is far too many markers, so it
  aggregates into 500 m cells (1,207 of them) and switches to individual stations at zoom 15+,
  on a **canvas** renderer, culled to the view. Paints in ~0.6 s.
- **"Show boreholes without AGS data"** toggle for the search results (map + table).
- **A/B section-line coordinate boxes** (HK1980 E/N), live in both directions: type to move the
  line; drag a handle or **drag the line body** (new — translates both ends) and the numbers
  follow. Length + grid bearing shown alongside.

## Deploy state (verified at the end of this session, not just pushed)

- **`main` @ `7861430`**, working tree clean, pushed to `origin/main`.
- **Vercel production live and confirmed**: `/builder` serves `id="map-coverage"`,
  `id="sec-ae"`, `id="lp-base"`, the `4 · Rock Contour` tab, and `MAX_IMPORT = 1000`.
- **HF Space `RUNNING`** (cpu-basic). `hf-deploy` @ `ef5ea48`; `app.py` and
  `src/ags_open_data.py` are **in sync with `main`** (checked by diff). Both endpoints
  answered live: `/fetch_raw_ags` → `71936.zip` in 9.1 s, `/fetch_stratigraphy` → 14 stations
  in 2.6 s.
- **Tests green**: `python -m src.ags_open_data`, `node web/test_section_geom.mjs`,
  `node web/test_contour.mjs`, `node web/test_project_csv.mjs`.
- Last full browser runs: **37/37** interaction checks, **15/15** log-plan/name checks,
  **14/14** coverage/no-AGS/A-B checks, all three breakpoints with no console errors.

## Known gaps / open questions

1. **The user has explicitly paused the feature roadmap.** SPT / RQD / groundwater / φ′-c′ were
   researched and planned in detail this session, then the user said *"stop with the feature
   plan for now — the current feature set is sufficient"*. **Do not start it unless asked.**
   The research, if it's ever wanted: across 60 random CEDD reports, ISPT (SPT N) is in 30% of
   reports, CORE (TCR/SCR/RQD) 47%, TRIG (c′/φ′/cu) 37%, CLSS 37%, GRAD 33%, POBS (groundwater)
   25% — and all four reference-site reports have ISPT + CORE.
2. **The Playwright harnesses are NOT committed** — they live in this session's scratchpad
   (`audit_visual.py`, `audit_functional.py` 37 checks, `bench_scale.py`, `test_logplan.py`,
   `test_new3.py`, `test_dense.py`) and will be lost. Offer to commit them under `tests/` if
   the user wants the audit repeatable.
3. **Admin gate is not real security** — client-side SHA-256 only. Unchanged.
4. **3D-from-map button is still a stub** ("Send to 3D Builder (not built)").
5. **`src/ingest_ags.py`** (direct-upload AGS parser for the 3D pipeline) still does **not**
   use the new classification logic — only `ags_open_data.py` / `fetch_stratigraphy` does.
   The fill-clast fix therefore does not apply to user-uploaded AGS files.
6. **Project CSV is a homegrown format** (`#GEOVIS {json}` header + 9 columns). Not AGS. Now
   correctly quoted and round-trip tested, but only this tool reads it.
7. **Contour callouts are dropped when they can't fit** (hover tooltip + a count in the UI).
   At ~300 boreholes most are hidden; that's a display limit, not a bug.
8. Esri imagery stops at z19 over some HK sites (handled by `maxNativeZoom`; no longer visible
   to users, but remember it if another basemap is added).
9. Resolved this session (were open before): `Topsoil`, `Superficial Deposit`, `No Recovery`,
   `Wash Boring`, `Made Ground` **are** accepted as valid non-grade materials — user confirmed.
   Duplicate stations across repeated reports are now deduplicated.

## If continuing, good first moves

- Don't trust this note over the repo: `git log --oneline -8`, `git status`, and re-check the
  live URLs before assuming anything is still true.
- Re-run the four self-checks above (seconds) before touching classification, interpolation,
  contouring or the project CSV.
- Reference test site: bbox lat 22.306412–22.311633, lng 114.159939–114.166977 (reports
  71936/62077/62076/66636) → expect ~142 stations found, ~39 boreholes loaded after dedupe.
  For stress testing, HK's densest box is E834000–834500 / N840000–840500
  (lat 22.499611–22.504127, lng 114.154833–114.159692) → ~421 boreholes.
- If you touch `classify_layer()`, read `docs/AGS_CLASSIFICATION.md` first, and keep the
  clast/FILL guards **above** the decomposition rule.
- Ask before starting the geotechnical feature roadmap (item 1) — it is deliberately parked.
