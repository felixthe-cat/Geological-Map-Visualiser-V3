# Geological Map Visualiser V2 — Implementation Plan & Agent Hand-off Note

**Date:** 2026-06-01
**Owner:** Felix
**Status:** Approved scope, ready for execution
**This document is the canonical brief.** An agentic AI should be able to execute v1 from this file alone.

---

## 1. Goal (one sentence)

A free, web-hosted tool where a user uploads borehole data (Hong Kong **AGS** files from CEDD's open-data portal), the server builds a 3D geological model with **GemPy**, and the user views it in the browser and downloads it as a **GLB** 3D file.

---

## 2. Decisions locked in (from discussion)

| Decision | Choice | Consequence |
|---|---|---|
| Core modelling engine | **GemPy** (open source, Python) | Must run **server-side**; cannot run in browser. This is why the previous pure-HTML/JS attempt failed. |
| Hosting | **Free tier** — Hugging Face Spaces (CPU, ~16 GB RAM) | Accept cold starts + a modelling-resolution cap. $0 cost. |
| v1 functionality | **Upload → model → export** only | No data-library browser, no map picker, no accounts in v1. |
| Audience (v1) | **Single user / demo** | No login, no database, no multi-tenant concerns. |
| Primary input | **HK AGS files** (user downloads from CEDD, uploads to app) | Parse with `python-ags4`. Also accept a simple CSV as fallback. |
| Export format | **GLB** (glTF binary) | Web-viewable, single file, simple. Offer VTK + PNG as secondary. |
| App framework | **Gradio** (single Python app), NOT FastAPI+React | Smallest path: upload widget + native `Model3D` (GLB) viewer + download, all in one file. |

---

## 3. Why these choices (rationale for the executor)

- **GemPy vs LoopStructural:** GemPy chosen for larger community, better docs, and built-in `gempy.structural_elements_from_borehole_set` for borehole import. LoopStructural is a valid alternative if GemPy install proves painful.
- **Gradio vs FastAPI+React:** For a single-user demo the data flow is one synchronous request (file in → GLB out). Gradio's `gr.Model3D` component renders GLB natively and provides the download button for free. A React SPA + API split adds auth/CORS/build tooling we don't need yet. Keep FastAPI+React on the shelf for the scaling milestone (see §8).
- **Hugging Face Spaces vs Render/Railway free:** GemPy's dependency stack (`gempy`, `gempy_engine`, PyTorch) needs RAM. HF free CPU Spaces provide enough; Render free (512 MB) does not.
- **GLB vs VTK/OBJ:** GLB is one self-contained binary that `gr.Model3D`, `<model-viewer>`, and three.js all display directly. Simplest "see it + download it" path the user asked for.

---

## 4. The AGS data — verified facts the executor needs

- CEDD publishes Ground Investigation (GI) + Lab Test (LT) records as **AGS files**, free, at:
  - Data portal: https://data.gov.hk/en-data/dataset/hk-cedd-csu-cedd-gi-lt
  - Spatial portal (station locations): https://portal.csdi.gov.hk/
  - Geotechnical Information Infrastructure: https://ginfo.cedd.gov.hk/
- **AGS** is a structured text format. The groups we care about:
  - `LOCA` — borehole location: `LOCA_ID`, `LOCA_NATE` (easting), `LOCA_NATN` (northing), `LOCA_GL` (ground level / collar elevation), `LOCA_FDEP` (final depth).
  - `GEOL` — geology layers per borehole: `LOCA_ID`, `GEOL_TOP` (depth to top), `GEOL_BASE` (depth to base), `GEOL_LEG` / `GEOL_GEOL` (geology/legend code = the formation label).
- Parse with **`python-ags4`** (`from python_ags4 import AGS4; tables, headings = AGS4.AGS4_to_dataframe(path)`). Returns each group as a pandas DataFrame.
- **Coverage caveat:** public-works sites only; not every location in HK. This is why AGS is a *supplement*, and why v1 still centres on user upload.

### Critical modelling caveat (do not skip)
GemPy needs **surface/interface points** AND **at least one orientation** (dip/azimuth) per stratigraphic series. AGS `GEOL` gives interface points only — **no orientations**. v1 mitigation: inject a **default near-horizontal orientation** (dip ≈ 0–5°) per series, or compute a best-fit orientation from the interface points across boreholes. Document this assumption in the UI ("assumes sub-horizontal layering unless orientation data provided"). This is the single most likely source of "the model looks wrong."

---

## 5. Data pipeline (the heart of v1)

```
AGS file (or CSV)
   │  python-ags4  →  LOCA + GEOL DataFrames
   ▼
Convert depths → absolute elevation:
   z = LOCA_GL − GEOL_TOP   (collar elevation minus depth)
   ▼
Build GemPy surface_points table:
   columns: X (LOCA_NATE), Y (LOCA_NATN), Z (computed), surface (GEOL_LEG)
   ▼
Inject default orientations (one per series, sub-horizontal)   ← see §4 caveat
   ▼
gempy.create_geomodel(...)  +  set extent from data bounding box
   ▼
gempy.compute_model(...)   (resolution capped for free tier, e.g. 50³)
   ▼
Extract surfaces (PyVista mesh)  →  export GLB
   ▼
Return GLB path to Gradio Model3D viewer + download button
```

**CSV fallback schema** (for users without AGS): a single CSV with columns
`borehole_id, x, y, surface, top_depth, base_depth, ground_level`
— the app derives the same surface_points table. Ship `examples/sample_boreholes.csv` and one real downloaded `examples/sample.ags`.

---

## 6. Repository layout

```
Geological Map Visualiser V2/
├── app.py                  # Gradio app: UI + orchestration (entry point)
├── src/
│   ├── ingest_ags.py       # AGS → LOCA/GEOL DataFrames (python-ags4)
│   ├── ingest_csv.py       # CSV → DataFrame (fallback)
│   ├── to_surface_points.py# DataFrames → GemPy surface_points + orientations
│   ├── model.py            # build + compute GemPy GeoModel
│   └── export.py           # PyVista mesh → GLB / VTK / PNG
├── examples/
│   ├── sample_boreholes.csv
│   └── sample.ags          # one real CEDD AGS file, committed for testing
├── tests/
│   ├── test_ingest_ags.py
│   ├── test_to_surface_points.py
│   └── test_model_smoke.py # end-to-end: sample.ags → GLB exists & non-empty
├── requirements.txt
├── Dockerfile              # for HF Spaces (pin GemPy + deps)
├── README.md               # usage + "where to get AGS data" links
└── IMPLEMENTATION_PLAN.md  # this file
```

---

## 7. Execution phases (build order, each independently testable)

**Phase 0 — Environment**
- Create `.venv`, pin Python 3.11 (GemPy compatibility).
- `requirements.txt`: `gempy`, `gempy_engine`, `python-ags4`, `pandas`, `pyvista`, `gradio`, `trimesh` (GLB export helper).
- Verify `import gempy` works and a trivial built-in GemPy example computes. **Gate: do not proceed until GemPy computes locally.**

**Phase 1 — AGS ingestion** (`ingest_ags.py` + test)
- Parse `examples/sample.ags`, return LOCA + GEOL DataFrames. Test against known row counts.

**Phase 2 — Transform** (`to_surface_points.py` + test)
- Compute elevation, build surface_points table, inject default orientations. Test the elevation math and that ≥1 orientation per surface exists.

**Phase 3 — Model + export** (`model.py`, `export.py` + smoke test)
- Build/compute GemPy model at capped resolution; export GLB. Smoke test asserts a non-empty `.glb` is produced from `sample.ags`.

**Phase 4 — Gradio app** (`app.py`)
- Upload (AGS or CSV) → run pipeline → show in `gr.Model3D` → download GLB. Format radio for GLB/VTK/PNG. Show the sub-horizontal assumption notice.

**Phase 5 — Deploy**
- `Dockerfile` for HF Spaces; push; confirm cold-start works within free RAM; tune resolution cap if it OOMs or times out.

**Phase 6 — Docs**
- README: how to download an AGS file from data.gov.hk, how to use the app, CSV schema, known limitations.

---

## 8. Explicitly OUT of scope for v1 (future milestones)

- Built-in HK AGS data-library browser (download/cache CEDD datasets server-side). → v2
- Map-based location picker pulling nearby boreholes (CSDI portal). → v2/v3
- User accounts, saved projects, history (needs DB + auth). → when going truly public
- FastAPI + React split, job queue, async compute for concurrent users. → scaling milestone
- Real orientation/structural input (faults, folds) beyond sub-horizontal default.

---

## 9. Known risks / watch-items for the executor

1. **GemPy install friction** on Windows — prefer building/testing the model layer in the Docker image (Linux) early; the HF Space is Linux anyway.
2. **Orientation assumption** (§4) — flat default can produce geologically wrong dips. Surface it in the UI; revisit in v2.
3. **Free-tier OOM / timeout** — keep model resolution low (start 50³), bound the data extent, and consider limiting borehole count in v1.
4. **CRS** — HK AGS uses HK1980 Grid (metres), so X/Y/Z are already metric and consistent; no reprojection needed for v1, but note it.
5. **GLB from GemPy** — GemPy outputs PyVista/VTK; convert via PyVista→`trimesh`→GLB. Validate the export actually loads in a glTF viewer.

---

## 10. Definition of done (v1)

- [ ] User uploads `sample.ags` on the hosted HF Space and sees a 3D model in-browser.
- [ ] User downloads a working `.glb` that opens in an external glTF viewer.
- [ ] CSV fallback path works with `sample_boreholes.csv`.
- [ ] Smoke test green in CI/local: `sample.ags → non-empty .glb`.
- [ ] README explains where to get AGS data and the sub-horizontal limitation.

---

## Appendix A — Source references

- GemPy: https://www.gempy.org/ · https://github.com/gempy-project/gempy
- GemPy borehole import example: https://docs.gempy.org/examples/real/mik.html
- LoopStructural (alternative): https://github.com/Loop3D/LoopStructural
- CEDD AGS open data: https://data.gov.hk/en-data/dataset/hk-cedd-csu-cedd-gi-lt
- CSDI spatial portal: https://portal.csdi.gov.hk/
- python-ags4 usage: https://www.geotechpython.com/automation/python-code-to-validate-ags4-file/
- Gradio Model3D component: https://www.gradio.app/docs/model3d
- Hugging Face Spaces (free hosting): https://huggingface.co/docs/hub/spaces
