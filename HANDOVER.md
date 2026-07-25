# Handover Note — 2026-07-25

> Read `SOUL.md` first per CLAUDE.md's instruction. This file picks up from there with
> where things actually stand after the last few sessions of work.

## What this project is

Free, open-source 3D/2D geological modelling tool for Hong Kong ground-investigation data.
Two live surfaces:
- **Vercel** (`web/`) — static JS frontend: landing page, 2D log/cross-section builder, site map.
  Live at **https://geological-map-visualiser.vercel.app**
- **Hugging Face Space** (`app.py` + `src/`) — Gradio app running GemPy for heavy 3D modelling.
  Live at **https://ferxxxxx-geological-map-visualiser-v3.hf.space**

Architecture decision (see `COMPETITOR_ANALYSIS.md`): keep light/instant features (2D log,
cross-section, site map, borehole entry) in the Vercel/JS layer; keep HF Spaces as the
specialist heavy-compute backend for GemPy 3D. Don't move GemPy off HF — it needs a
persistent Python process that Vercel serverless can't provide.

## Deploy mechanics (important — two separate deploy targets)

- **GitHub**: `main` is the working branch, pushed to `origin/main`.
- **Hugging Face**: separate branch `hf-deploy`, pushed to remote `space` (`git push space hf-deploy:main`).
  Workflow used repeatedly this session:
  ```bash
  git checkout hf-deploy
  git checkout main -- app.py src/ags_open_data.py   # cherry-pick just the backend files
  git commit -m "sync: ..."
  git push space hf-deploy:main
  git checkout main
  ```
  Then poll `https://huggingface.co/api/spaces/ferxxxxx/Geological-Map-Visualiser-V3/runtime`
  for `"stage":"RUNNING"` before trusting the new endpoint.
- **Vercel**: `vercel --prod --yes` from repo root (project links both root `.vercel/` and
  `web/.vercel/` to the same project). Aliases to the URL above automatically.
- **Always verify live after deploying** — don't trust the push. This session's pattern:
  call the HF Gradio endpoint directly via `@gradio/client` in the browser console, or
  curl the Vercel URL, before declaring done.

## What's built and verified working (as of commit `1c6e920`)

### Web frontend (`web/`)
- `index.html` — landing page: hero + description, two buttons (2D Builder / 3D Viewer).
  The old inline HF iframe was removed from here.
- `viewer.html` — the HF 3D iframe now lives on its own subpage.
- `builder.html` + `builder.js` — the 2D tool, 4 tabs in this order:
  **1 Site Map → 2 Borehole Log → 3 Cross-Section → 4 3D via Hugging Face**.
  - Subcores-style borehole entry: per-borehole metadata + editable layer table.
  - New layer's "From" defaults to previous layer's "To".
  - Live log preview, depth/elevation (mPD) toggle.
  - Cross-section uses a **horizon-based interpolation algorithm** (see `buildHorizons()` /
    `renderSection()`) that mathematically guarantees layer bands never cross between
    boreholes, even when local weathering-grade order fluctuates. Verified 0/248 crossing
    violations on real data.
  - Site Plan panel (SVG) on the Cross-Section tab: drawn boundary + borehole positions +
    current section line.
  - "Send to Hugging Face" ships the same dataset to `build_model_csv` for 3D.
- `sitemap.js` — Leaflet map, lazy-loaded (Leaflet + Leaflet.draw + proj4 from CDN).
  - Draw-rectangle auto-fills WGS84 + HK1980 (EPSG:2326) bounding box fields.
  - Searches a **pre-downloaded, bundled CSDI borehole index** (`web/data/boreholes.csv`,
    80,000 rows, no live sync needed).
  - Colours boreholes green (AGS stratigraphy available) vs grey (location-only), using
    `web/data/ags_repnos.json` (23,827 report numbers with digital AGS).
  - "Load into 2D Builder" fetches **real logged stratigraphy** on demand from HF
    (`/fetch_stratigraphy` endpoint) and only imports boreholes that actually have layers.
  - Boreholes sorted before trial pits (CSDI `STATTYPE`) everywhere.
- `web/data/boreholes.csv` / `ags_repnos.json` — static, regenerate from
  `data/gi_spatial_index.sqlite` (see regen snippet in prior session — a Python one-liner
  exporting `SELECT repno,statno,stattype,lat,lon,e,n,gl,depth FROM boreholes`) whenever
  the CSDI sync is refreshed. Not automated — manual regen + redeploy.

### Backend (`app.py`, `src/`)
- `src/ags_open_data.py` — **the important new module**. Reads the CEDD GI_AGS.zip archive
  (~600 MB, `https://www.ginfo.cedd.gov.hk/geoopendata/Data/GI/GI_AGS.zip`) via its ZIP
  central directory (fetched once, ~2.3 MB) to map REPNO → byte offset, then HTTP-Range
  fetches individual report zips on demand (KB, not the whole archive). Parses both AGS3
  and AGS4 formats.
  - **Classification fix**: uses `GEOL_GEO2` (origin/weathering-grade code — verified
    against real AGS `GEOL_DESC` text) instead of `GEOL_LEG` (grading-only code like
    `SANDZG`). Maps to clean labels: `Fill`, `Alluvium`, `Marine Deposit`, `Colluvium`,
    `Residual Soil`, `Completely/Highly/Moderately/Slightly Decomposed Granite`, etc.
  - Merges contiguous same-label layers (fixes AGS logs with many consecutive
    sample-interval rows for the same material).
  - Self-check: `python -m src.ags_open_data` (asserts on classification + merge logic).
- `app.py` exposes three stable Gradio API endpoints (all deployed, all live):
  - `build_model` — the original file-upload → GemPy 3D pipeline, given a stable `api_name`.
  - `build_model_csv` — headless CSV-text-in → GLB-out (avoids a Gradio 6.x `gr.File`
    upload-validation quirk that rejects API-client file uploads).
  - `fetch_stratigraphy` — takes a JSON array of REPNOs, returns classified/merged
    stratigraphy per borehole. This is what `sitemap.js` calls.

### Data files
- `data/gi_spatial_index.sqlite` — 80,000-row CSDI borehole location index (14 MB, **not
  committed to git** — local only, source for the web/data/*.csv exports).
- `web/data/boreholes.csv` (5 MB) and `web/data/ags_repnos.json` (190 KB) — **are**
  committed, these are what the live site actually reads.

## Known gaps / things NOT done

1. **`MAX_IMPORT = 40`** in `sitemap.js` caps how many boreholes get pulled into the 2D
   builder per search. User was told this could be raised if needed — not yet asked for.
2. **3D-from-map button is a stub** ("Send to 3D Builder (not built)") — intentionally left
   as a prototype placeholder per explicit user request. Natural next step: reuse the same
   `fetchStratigraphy()` result and hand it to `build_model_csv` instead of `/build_model`
   file path.
3. **CSDI AGS coverage is ~34%** of the location index (older reports are scanned-PDF only,
   no digital AGS). This is a real data limitation, not a bug — surfaced honestly in the UI
   via green/grey borehole colouring rather than hidden.
4. **`src/ingest_ags.py`** (the original direct-file-upload AGS parser used by the main
   Gradio 3D pipeline) was **deliberately not touched** — the GEOL_GEO2 classification fix
   only applies to the new `ags_open_data.py` / `fetch_stratigraphy` path. If the user wants
   consistent classification when uploading their own AGS file directly to the 3D tab too,
   that's a follow-up task, not yet done.
5. Duplicate-report edge case observed but not fixed: CSDI sometimes lists the same
   physical station under two different REPNOs (e.g. "BH 3" under both 62076 and 62077) —
   currently harmless (both get fetched, whichever resolves with layers wins), but not
   deliberately deduplicated.
6. Cross-section only re-renders on tab-click/selector-change, not on every layer edit made
   while already on that tab — pre-existing behaviour, not something introduced or fixed
   this session.

## Reference docs already in the repo
- `COMPETITOR_ANALYSIS.md` — Subcores competitor analysis + the Vercel/HF architecture
  reasoning (why GemPy stays on HF).
- `PROJECT.md` — original project pitch/overview.
- `IMPLEMENTATION_PLAN.md` — older, partially stale; the solid/interface toggle feature
  it describes as "proposed" is already implemented in `app.py`/`export.py`.
- `SOUL.md` — the actual agent system prompt for this project (CLAUDE.md just points here).

## If continuing, good first moves
- Confirm current live state with a quick smoke test (curl the Vercel URL + call
  `/fetch_stratigraphy` on the HF Space) before assuming anything from this note is still
  accurate — deploys can go stale.
- Check `git log --oneline -15` and `git status` to see if anything changed since
  commit `1c6e920`.
