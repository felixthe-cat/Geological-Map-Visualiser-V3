# Geological Map Visualiser V3

> **A free, open-source alternative to Leapfrog and RockWorks for 3D geological modelling — built with Python, GemPy, and Gradio.**

---

## The Problem I Was Trying to Solve

Working as a Civil Engineering graduate trainee in Hong Kong, I noticed a recurring friction point in geotechnical practice: the **gap between the raw ground investigation (GI) data and a meaningful 3D geological picture of a site**.

The Civil Engineering and Development Department (CEDD) publishes thousands of borehole records publicly through two portals:

- **[GEO-INFO (Geo Infra)](https://ginfo.cedd.gov.hk/)** — the primary geotechnical information portal for GI reports and borehole logs
- **[CSDI GeoPortal](https://portal.csdi.gov.hk/)** — the Common Spatial Data Infrastructure, which exposes borehole *locations* via an OGC WFS API

Every geotechnical assessment report and ground investigation report includes a written stratigraphic description and cross-section drawings. But producing an interactive, navigable **3D geological model** from those borehole logs requires proprietary software — Leapfrog, RockWorks, MOVE, or similar tools — that cost thousands of dollars per seat and are inaccessible to most engineers, students, and researchers.

**Geological Map Visualiser V3 bridges that gap.** Upload a CEDD AGS file or a simple CSV, and within seconds you have an interactive, browser-based 3D geological model you can rotate, slice, annotate, and export — at zero cost.

---

## Vision

The goal is a **lightweight, free, web-deployable tool** that any Hong Kong geotechnical engineer, graduate trainee, or student can use without installing anything. Long-term, this means:

- A live public deployment on Hugging Face Spaces (the Gradio app) fronted by a landing page hosted on Vercel
- Direct AGS download from CSDI with automatic model generation — select a bounding box on the map, click download, and the model computes
- AI-assisted layer interpretation: flag ambiguous stratigraphic contacts and suggest corrections
- Support for additional coordinate systems beyond HK1980

**What features would *you* add?** I am actively looking for input from both geotechnical engineers and AI builders — tell me what you think this tool should include next.

---

## Who This Is For

This tool sits at the intersection of two communities:

| Audience | What they get |
|---|---|
| **Geotechnical / Civil Engineers** | A free Leapfrog-like 3D model viewer for CEDD open data. Replaces manual cross-section sketching with an interactive 3D scene. |
| **AI / Full-Stack Builders** | A real-world example of combining scientific Python (GemPy, PyVista, Trimesh) with a modern web front-end (Gradio + custom HTML/JS), deployed as a Hugging Face Space. |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Landing Page                             │
│             (web/index.html + Vercel deployment)                │
│         Custom HTML/CSS/JS · Cormorant Garamond + Space Grotesk │
└──────────────────────────┬──────────────────────────────────────┘
                           │  iframe embed
┌──────────────────────────▼──────────────────────────────────────┐
│                     Gradio Web App (app.py)                      │
│                    localhost:7860 / HF Spaces                   │
│                                                                  │
│  ┌──────────────┐    ┌────────────────────────────────────────┐ │
│  │  Input Panel │    │        3D Viewer Panel                 │ │
│  │              │    │  model-viewer WebGL (GLB)              │ │
│  │  AGS / CSV   │    │  + Interactive legend                  │ │
│  │  upload      │    │  + Screenshot capture (JS → Python)    │ │
│  │  Sliders     │    │  + Downloads (GLB, VTK, PNG)           │ │
│  │  Toggles     │    └────────────────────────────────────────┘ │
│  └──────┬───────┘                                               │
│         │                                                       │
│  ┌──────▼──────────────────────────────────────────────────┐    │
│  │                  Processing Pipeline                     │    │
│  │                                                          │    │
│  │  ingest_ags.py / ingest_csv.py                          │    │
│  │      ↓ LOCA + GEOL DataFrames                           │    │
│  │  to_surface_points.py                                   │    │
│  │      ↓ Surface points + synthetic orientations          │    │
│  │  model.py (GemPy)                                       │    │
│  │      ↓ Computed GeoModel                                │    │
│  │  export.py (Trimesh + PyVista)                          │    │
│  │      ↓ .glb  .vtk.zip  .png                             │    │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                   Site Map Tab                           │    │
│  │  map_view.py (Folium + Leaflet)                         │    │
│  │  Google Hybrid / ESRI Terrain / OSM basemaps            │    │
│  │  CSDI Borehole Bounding Box Search                      │    │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │               CSDI Database (SQLite)                     │    │
│  │  csdi_client.py — WFS pagination → local SQLite index   │    │
│  │  data/gi_spatial_index.sqlite  (~15–30 MB)              │    │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Feature Breakdown & Tech Stack

Every feature maps to a specific technology choice. Here is what each library contributes and why it was chosen.

### 1 · 3D Geological Model — Implicit Interpolation

**Tech: [GemPy](https://www.gempy.org/)**

GemPy is the heart of the application. It implements **implicit structural geological modelling** using a co-kriging interpolation engine — the same mathematical approach used by commercial tools like Leapfrog.

Given a sparse set of borehole contact elevations (where one rock type transitions to another), GemPy interpolates a smooth 3D surface across the entire model domain. This means you can have just three boreholes and still get a plausible continuous geological model.

**Why GemPy over alternatives?**
- Open-source and Python-native
- Supports multiple surfaces and stratigraphic series
- Outputs voxel grids and isosurface meshes

**The key pipeline step** (`src/to_surface_points.py`):
Each borehole layer top elevation becomes a *surface contact point* in 3D space. Because boreholes don't record structural dip, synthetic sub-horizontal orientations are injected at each surface centroid — this tells GemPy that the strata are approximately flat, which is a valid assumption for Hong Kong weathered granite sequences.

```python
# Each surface gets one synthetic orientation at its centroid
{
    'X': mean_x, 'Y': mean_y, 'Z': mean_z,
    'dip': default_dip,        # configurable: 0°–10°
    'azimuth': default_azimuth,
    'polarity': 1.0            # normal stratigraphic sequence
}
```

---

### 2 · 3D Mesh Export & WebGL Rendering

**Tech: [Trimesh](https://trimsh.org/) + [PyVista](https://pyvista.org/) + Google's `<model-viewer>` WebComponent**

GemPy outputs mesh data in NumPy arrays. Getting those meshes into a browser required a multi-step conversion pipeline:

1. **PyVista** — clips meshes along a configurable plane (cross-section slicing), triangulates voxel surfaces, and generates topography contours
2. **Trimesh** — assembles the final GLB scene: geological surfaces, borehole cylinders, floor grid, coordinate axis, and elevation labels
3. **GLB export** — a single binary glTF file embedding all meshes, materials, and colours, loaded directly into the browser via `<model-viewer>`

**The critical coordinate rotation:**
GemPy and PyVista use a **Z-up** coordinate convention (Z is vertical). The `<model-viewer>` WebComponent uses **Y-up** (Y is vertical, which is standard in WebGL/glTF). Without correcting for this, the model would appear lying on its side. Every mesh is multiplied by this rotation matrix before export:

```python
# Rotate Z-up → Y-up (−90° around X-axis)
R = np.array([
    [1.0, 0.0,  0.0, 0.0],
    [0.0, 0.0,  1.0, 0.0],
    [0.0, -1.0, 0.0, 0.0],
    [0.0, 0.0,  0.0, 1.0]
])
```

**Two render modes:**
- **Interface Contacts** — thin isosurface meshes at stratigraphic boundaries (fast, lightweight)
- **Volumetric Solids** — filled voxel blocks per stratum, extracted via PyVista threshold on the lithology grid (heavier, but shows full 3D volume)

---

### 3 · Data Ingestion — AGS4 & CSV

**Tech: [python-ags4](https://github.com/open-geotechnical/python-ags4) + Pandas**

The AGS4 format is the standard digital exchange format for ground investigation data in Hong Kong and the UK. CEDD publishes all its GI records in this format. `python-ags4` parses the grouped table structure and normalises numeric columns.

The ingestor extracts two tables:
- **LOCA** — borehole collar location: Easting (HK1980), Northing, and Ground Level (mPD)
- **GEOL** — geological layers per borehole: top depth, base depth, and stratum code

A CSV fallback exists for users with custom data who don't use the AGS format.

---

### 4 · Interactive Site Map

**Tech: [Folium](https://python-visualization.github.io/folium/) + [pyproj](https://pyproj4.github.io/pyproj/) + Leaflet.js**

The Site Map tab renders borehole locations on a live interactive map. Key decisions:

- **Google Hybrid satellite** as the default basemap — the most useful layer for site identification in Hong Kong's dense urban environment
- **pyproj** for accurate HK1980 (EPSG:2326) → WGS84 coordinate conversion; a linear approximation fallback handles offline scenarios
- **Folium plugins** bundled in: MeasureControl (distance/area), MousePosition (live WGS84 cursor), MiniMap (overview)

Session boreholes (from your loaded file) appear as **blue circles**. CSDI database boreholes found in a bounding box search appear as **grey dots**.

---

### 5 · CSDI Government Borehole Database

**Tech: Python `requests` + SQLite (via `sqlite3`) + OGC WFS 2.0**

CEDD publishes all HK ground investigation borehole *locations* through the CSDI GeoPortal as an OGC WFS 2.0 service. The `csdi_client.py` module:

1. **Paginates** through the WFS (2,000 features per request) using `startIndex` until exhausted
2. **Upserts** each feature into a local SQLite database (`data/gi_spatial_index.sqlite`) — ~15–30 MB for all of Hong Kong
3. **Indexes** on both HK1980 Easting/Northing and WGS84 Lat/Lon for fast bounding-box queries
4. Exposes `query_bbox_hk1980()` and `query_bbox_wgs84()` for the Site Map tab's search feature

This means the borehole search works **fully offline** after the initial sync, with no rate limits.

---

### 6 · Landing Page

**Tech: Vanilla HTML + CSS + JavaScript · Hosted on Vercel (planned)**

The landing page (`web/index.html`, `web/style.css`, `web/app.js`) is a pure static site — no framework, no build step. It:

- Opens with a full-screen dark hero section featuring an **SVG terrain silhouette** with hand-drawn contour lines, rendered entirely in SVG path data
- Embeds the Gradio app in a full-width iframe in the app section
- Uses **Cormorant Garamond** (a geological serif) for display text and **Space Grotesk** for UI text
- Is designed to be deployed to Vercel as a static site with the Gradio app running separately on Hugging Face Spaces

---

### 7 · Gradio Web App Shell

**Tech: [Gradio](https://www.gradio.app/) 4.x with `gr.Blocks`**

Gradio provides the interactive UI layer that connects the Python processing pipeline to the browser without requiring a custom backend. Key patterns used:

- **`gr.State`** — caches the computed GemPy model in memory so visual parameter changes (opacity, Z-scale, layer visibility, clipping) re-export GLB files instantly without re-running the expensive interpolation
- **JS → Python callback** — the screenshot button uses a `js=` snippet to read the `<model-viewer>` canvas as a base64 PNG and push it into a hidden Gradio `Textbox`, which triggers a Python handler to decode and save the file
- **`gr.Accordion`** — collapses the parameter panels to keep the UI clean while exposing advanced controls

---

## Data Flow: End-to-End Pipeline

```
User uploads .ags or .csv
        ↓
ingest_ags.py / ingest_csv.py
    Parses AGS4 tables or CSV columns
    → loca_df (borehole collar positions)
    → geol_df (stratigraphic layers per borehole)
        ↓
to_surface_points.py
    Computes absolute Z elevation for each layer contact:
        Z = ground_level - top_depth
    Injects synthetic orientations at surface centroids
    → surface_points_df [X, Y, Z, surface]
    → orientations_df [X, Y, Z, dip, azimuth, polarity, surface]
        ↓
model.py  (GemPy)
    Auto-determines bounding box + 10% margins
    Infers depositional order by average Z elevation
    (youngest/shallowest surface first)
    Runs implicit interpolation on NumPy backend
    → GeoModel (voxel grid + isosurface meshes)
        ↓
export.py  (Trimesh + PyVista)
    Extracts meshes, centers on (0,0,0), applies Z-scale
    Optionally clips with a plane (cross-section)
    Adds: floor grid, coordinate labels, borehole cylinders, contours
    Rotates Z-up → Y-up for WebGL
    → geology_model_interfaces.glb  (interface surfaces)
    → geology_model_solids.glb      (volumetric strata)
    → geology_model_vtk.zip         (VTK meshes for desktop GIS)
    → geology_model_render.png      (isometric PyVista screenshot)
        ↓
Gradio <model-viewer> renders GLB in-browser
```

---

## Supported Input Data

### AGS4 Format (primary)
The standard format published by CEDD. Requires:
- `LOCA` group: `LOCA_ID`, `LOCA_NATE` (Easting), `LOCA_NATN` (Northing), `LOCA_GL` (ground level, mPD)
- `GEOL` group: `LOCA_ID`, `GEOL_TOP`, `GEOL_BASE`, `GEOL_LEG` or `GEOL_GEOL` (stratum code)

### CSV Format (fallback)
| Column | Description |
|---|---|
| `borehole_id` | Unique borehole name |
| `x` | Easting (HK1980, metres) |
| `y` | Northing (HK1980, metres) |
| `surface` | Stratum name (e.g. *Fill*, *Colluvium*, *CDG*, *HDG*, *Granite*) |
| `top_depth` | Depth to top of layer (metres) |
| `base_depth` | Depth to base of layer (metres) |
| `ground_level` | Borehole collar elevation (mPD) |

---

## Biggest Technical Challenges

### 1 · GemPy's Implicit Modelling Requires Orientations

Borehole logs only tell you *where* a contact is, not *which way it dips*. GemPy's co-kriging engine requires at least one orientation (dip direction) per surface to constrain the interpolation. Without it, the model underdetermines and produces nonsensical geometries.

The solution was to inject **synthetic sub-horizontal orientations** at the centroid of each surface's contact points — a geologically reasonable assumption for Hong Kong's horizontally-bedded weathered profiles. This is configurable via the dip/azimuth sliders.

### 2 · The Z-Up / Y-Up Coordinate Mismatch

Scientific Python libraries (NumPy, PyVista, GemPy) all use a Z-up world where the vertical axis is Z. The glTF/WebGL standard and `<model-viewer>` use Y-up. Missing this transformation produces a model lying flat on its back in the browser. Every mesh in the scene requires the 4×4 rotation matrix applied before GLB export.

### 3 · Building a 3D Text Label System from Scratch

PyVista and Trimesh have no native 3D text-in-mesh support suitable for GLB export. The grid coordinate labels (Easting, Northing, elevation ticks) are rendered as stroke-font cylinders — each character is decomposed into line segments, each segment becomes a thin `trimesh.creation.cylinder()`, and all are concatenated into the scene. This required implementing a minimal vector stroke font from scratch.

### 4 · CSDI WFS Pagination

The CEDD WFS service enforces a 10,000-feature cap per request. The total HK borehole dataset is significantly larger. The client uses `startIndex` offsetting to walk through pages of 2,000 features at a time, with retry logic and progress callbacks, until the server returns a partial page signalling the end of the dataset.

---

## How to Run Locally

**Requirements:** Python 3.10+ · Git

```bash
# 1. Clone the repo
git clone <repo-url>
cd "Geological Map Visualiser V3"

# 2. Create and activate virtual environment
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux

# 3. Install dependencies
pip install -r requirements.txt

# 4. Launch the Gradio app
python app.py
# → http://localhost:7860
```

**Try a sample dataset:** In the app, open the *Load Sample Dataset* dropdown and select any bundled demo without needing to upload a file.

**Sync the CSDI borehole database** (optional, ~2–5 min):
In the *Site Map* tab → *CSDI Borehole Database* → *Sync Now*. This downloads all HK borehole locations into `data/gi_spatial_index.sqlite`.

---

## Acquiring Real Hong Kong AGS Data

1. Visit the **[CSDI GeoPortal — CEDD GI Records](https://portal.csdi.gov.hk/geoportal/?datasetId=cedd_rcd_1636517845149_16420)**
2. Draw a bounding box over your site of interest
3. Download the `.ags` files for the boreholes in that area
4. Upload directly to the 3D Model Builder tab

Alternatively, use **[GEO-INFO](https://ginfo.cedd.gov.hk/)** to find specific GI report numbers and download their full AGS packages.

---

## Advice for Builders: Lessons From This Project

If you are building a similar tool — a scientific Python model served through a web UI with 3D visualisation — here are the patterns and pitfalls from building this:

**1. Cache your expensive computation, not your output.**
GemPy's interpolation takes 5–30 seconds. Everything else (GLB export, colour changes, clipping planes) runs in under a second. Storing the `GeoModel` object in `gr.State` means every visual tweak re-exports instantly without re-running interpolation. Design your state boundary around the expensive step.

**2. Understand your coordinate conventions before you write a single mesh.**
Z-up vs. Y-up is a one-line fix, but finding it costs hours of debugging a "sideways" model. Map your coordinate conventions to your rendering target *first*.

**3. Gradio `gr.Blocks` gives you enough control for a real product.**
Gradio is often dismissed as a prototyping tool, but with custom CSS, `gr.HTML` for dynamic legends, and `js=` callbacks for browser-side interactions, it can produce a genuinely polished user experience without a custom backend.

**4. Government open data APIs are under-exploited.**
The CSDI WFS API is a gold mine — thousands of borehole records, free, with a standard OGC interface. The same pattern (paginated WFS → local SQLite index → bbox query) works for any government spatial dataset worldwide.

**5. GLB is the right format for the web.**
VTK is excellent for desktop GIS. glTF/GLB is the right choice for the browser — it is a W3C standard, hardware-accelerated, supports PBR materials, and renders natively in `<model-viewer>` with zero custom WebGL code.

---

## Full Dependency List

| Library | Version | Role |
|---|---|---|
| `gradio` | latest | Web UI framework |
| `gempy` | latest | Implicit 3D geological modelling |
| `gempy_engine` | latest | GemPy interpolation backend |
| `pyvista` | latest | Mesh processing, clipping, PNG render |
| `trimesh` | latest | GLB scene assembly, mesh manipulation |
| `python-ags4` | latest | AGS4 file parsing |
| `pandas` | latest | Data wrangling |
| `numpy` | latest | Numerical computing |
| `scipy` | latest | Scientific utilities |
| `folium` | latest | Interactive Leaflet maps |
| `pyproj` | latest | Coordinate reference system transforms |
| `openpyxl` | latest | Excel output support |

---

## Version History

### V3 (current)
The version documented here. Full GemPy implicit interpolation pipeline, GLB export with custom scene assembly, Gradio `gr.Blocks` UI, Site Map with CSDI integration, and a standalone landing page.

---

### V1 & V2 — The Failed Attempts

Versions 1 and 2 were earlier attempts at the same idea that did not produce a usable result. They used a different interpolation approach — likely **SciPy's `griddata`** or a simple distance-weighted scheme — rather than GemPy's purpose-built co-kriging engine.

The failure modes were:
- **Incorrect interpolation geometry.** The 3D model did not interpolate correctly — geological layers produced physically implausible geometries that did not reflect the stratigraphic sequence recorded in the boreholes.
- **Display rendering issues.** The 3D model did not display correctly in the browser, appearing in wrong orientations or positions.

Switching to GemPy — a library built specifically for implicit geological modelling — resolved both problems. It enforces stratigraphic consistency through its structural frame and series system, and its output meshes are geometrically coherent by construction.

**The lesson:** for domain-specific problems, use domain-specific tools. SciPy is a powerful general toolkit, but the last 20% of correctness often requires a library that encodes domain knowledge.

---

*Built in Hong Kong · 2025–2026*
*Powered by GemPy, PyVista, Trimesh, Gradio, and CEDD open data*
