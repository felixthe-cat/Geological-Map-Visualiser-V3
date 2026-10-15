# Plan — 3D Block Builder (`builder3d.html`)

Status: **proposed 2026-10-15, awaiting user go-ahead.**

## Goal

A second builder page, structured like the 2D builder, that turns the same borehole
dataset into a 3D soil block inside a user-drawn site boundary, sitting under the
Lands Department 3D photo-mesh. The block can be orbited / panned / zoomed and cut with a
draggable vertical slice plane that also cuts the photo-mesh. The slice exports as DXF
for GeoStudio (SLOPE/W etc.) and PLAXIS 2D.

## User decisions (2026-10-15)

| Question | Answer |
|---|---|
| Where | New page `web/builder3d.html`, sharing datasets / saved projects with the 2D builder |
| Soil top | **User choice on the page**: (1) LandsD bare-earth DTM, or (2) the boreholes' own ground levels, interpolated |
| Revit | Skipped for now (IFC export is the route when wanted) |
| Access | Admin-only (existing `admin.js` gate) |
| PLAXIS | 2D only (DXF from the slice) — default, not asked |
| Old 3D viewer | GemPy / Hugging Face viewer left untouched |

## Findings that shape the build

- **LandsD 3D tiles** (`https://data.map.gov.hk/api/3d-data/3dtiles/f2/`): checked
  2026-10-15 — `tileset.json`, sub-tilesets and `.b3dm` tiles all return 200 **without a
  key**, and the server sends `Access-Control-Allow-Origin` for
  `geological-map-visualiser.vercel.app`. So the browser can stream them directly — no
  proxy, no key in the page. (Infographic-Production baked the tiles only because the
  Artifact host blocks other origins.) Localhost origin needs checking at build time; if
  blocked, a tiny `web/api/` pass-through for dev only.
- Tiles are Cesium 3D Tiles (b3dm + KTX2 textures, ECEF). Rendered with
  `3d-tiles-renderer` (NASA-AMMOS, three.js) + three's KTX2 loader, all from CDN.
- Photo-mesh heights are ellipsoidal, not mPD. Infographic-Production levelled its mesh
  against borehole ground levels. Here: auto-level by comparing the mesh to the DTM at the
  boundary centre (one raycast per borehole, median offset). Shown to the user.
- **Bare-earth DTM** already used by the 2D builder (`HK_DTM` LERC tiles, `terrain.js`).
  Reuse the fetch/decode/sample code.
- **Interpolation** reuses the 2D builder's logic so the 3D block and the 2D section agree:
  global strata order (`STRAT`, by mean top depth), per-borehole horizons
  (`buildHorizons`), and "top surface, then each thickness, clamped at ≥ 0" (as
  `interpolateHorizons`). Spatial interpolation = IDW from `contour.js gridInterp`.
  A stratum missing from a borehole = zero thickness there, so it pinches out between holes.

## Page structure (tabs, like the 2D builder)

1. **Site Map** — Leaflet map (shared `ensureMapLibs`, `BASEMAPS`). Shows the dataset's
   boreholes. Draw / edit the **site boundary polygon** (leaflet-draw, already loaded).
   Dataset sources: "Open in 3D" hand-off from the 2D builder, built-in examples, saved
   cloud projects, project CSV file.
2. **3D Block** — three.js scene:
   - Soil block: one closed solid per stratum inside the boundary, coloured like the 2D
     legend; per-layer show/hide.
   - Options: soil top = DTM / boreholes; block base level (default: deepest borehole
     base − 5 m); grid resolution; vertical exaggeration.
   - Photo-mesh around and over the site, with opacity slider and on/off.
   - Slice plane: position + angle sliders, or drag its line on a small plan inset. Cuts
     both the block and the photo-mesh (three.js clipping planes), with a capped cut face
     that shows the layers.
3. **Section & Export** — 2D drawing of the current slice (chainage vs mPD), legend.
   Exports: **DXF** (existing `cad_export.js toDXF` — GeoStudio, PLAXIS 2D), PNG.
   "Open this section in the 2D builder" is a possible later add.

Save: boundary + slice + 3D options go into the project CSV `#GEOVIS` header (v3,
backwards-compatible) so cloud saves carry them.

## Files

| File | What |
|---|---|
| `web/builder3d.html` | Page, tabs, admin gate |
| `web/builder3d.js` | UI, map, three.js scene, tiles, exports |
| `web/block3d.js` | Pure geometry (Node-testable): horizon grids, polygon clipping, block meshes, section along a line |
| `web/test_block3d.mjs` | Self-check for `block3d.js` |
| `web/project_csv.js` | Header v3: `boundary`, `slice`, `block` fields |
| `web/builder.js` / `builder.html` | "Open in 3D" button (admin only) |

## Geometry method (block3d.js)

- Local frame: HK1980 E/N minus boundary centroid; mPD up.
- Horizon grids: per stratum boundary, IDW grid over the boundary's bbox.
- Soil top: DTM sampled at grid nodes, or IDW of borehole GLs. With the DTM option,
  layer *thicknesses* are interpolated and hung from the DTM (same idea as the 2D
  `dtm-offset` / topOverride path).
- Clean boundary edges: each grid cell is clipped to the boundary polygon
  (Sutherland–Hodgman with the convex cell as the clip window), then triangulated
  (three's earcut). Side walls follow the densified boundary.
- Section: sample all horizons along the slice line, limited to where the line is inside
  the boundary (`section_geom.cutPolygon`), then `cad_export.sectionRegions` → DXF.

## Risks / unknowns

- 3d-tiles-renderer + KTX2 from CDN in a no-build site: needs an import map; versions
  pinned.
- Photo-mesh ↔ mPD alignment is approximate (DTM is ±5 m class; ENU vs HK1980 grid
  rotation < 0.5 m over a few hundred metres).
- Large boundaries × fine grids → many triangles; grid capped (e.g. 150 × 150).
- Photo-mesh tree canopy sits above the soil top; that's expected (bare-earth vs surface).

## Not in this build

Revit / IFC, PLAXIS 3D solids, editing logs on the 3D page (edit in the 2D builder).
