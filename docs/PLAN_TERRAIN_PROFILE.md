# Plan — real ground surface on the cross-section (terrain profile)

> Status: **investigated, not built.** Feasibility confirmed by live tests against the
> Lands Department DTM on 2026-08-01. No code written yet.

## 1. The problem, stated precisely

The cross-section's top surface (`curves[0]` in `interpolateHorizons`) is the borehole
ground levels interpolated between stations. Between two boreholes it is a straight line
(or a PCHIP curve), which asserts that the ground goes directly from one collar to the
next. On a hillside that is simply false — there can be a crest, a gully, a batter or a
platform edge between them, and the section draws none of it.

Two separate errors compound:

1. **Offset** — a borehole is projected onto the section line from up to `tol` metres away
   (now disclosed in the diagram, commit `28ebb25`). Its *collar level* belongs to where
   the hole actually is, not to the point on the line where it is drawn. On a slope of
   1:2, a 20 m offset is a 10 m elevation error at that station.
2. **Interpolation** — even with zero offset, the ground between two collars is unknown
   and currently assumed monotonic.

### Measured magnitude (real data, this site)

Sampling the LandsD 5 m DTM along lines over the worked-example hillside (Route Twisk,
Tsuen Wan) and comparing against the straight line the app draws today:

| Borehole spacing | Max error vs straight line | RMS error |
|---|---|---|
| 70 m (DH 6 → DH 5, actual example holes) | **4.5 m** | 2.9 m |
| 100 m | 11.2 m | 5.1 m |
| 200 m | 11.4 m | 6.5 m |
| 400 m | 13.9 m | 7.1 m |
| 800 m | **32.0 m** | 22.1 m |

Even between two *adjacent holes on the worked example*, 70 m apart, the drawn ground
surface is 4.5 m out at mid-span. This is not a cosmetic issue — it changes apparent
overburden thickness and therefore apparent founding depth.

## 2. Data source — confirmed available and usable

**Lands Department 5 m Digital Terrain Model**, served as a cached ArcGIS elevation
image service.

| Property | Value | How confirmed |
|---|---|---|
| Endpoint | `tiles.arcgis.com/tiles/6j1KwZfY2fZrfNMR/arcgis/rest/services/HK_DTM/ImageServer` | fetched `?f=json` |
| Capabilities | `Image, TilesOnly` — **no `identify`/`getSamples`** | service JSON |
| Tile format | LERC, 257×257, `F32`, `esriImageServiceDataTypeElevation` | service JSON |
| Tile scheme | Web Mercator (wkid 102100), 20 LODs, standard Esri origin | service JSON |
| Native resolution | LOD 15 = 4.777 m/px ≈ the 5 m source grid | LOD table |
| CORS | `Access-Control-Allow-Origin` reflects our Vercel origin | `curl -H Origin:` |
| Tile size on wire | ~60 KB for a 1223 m × 1223 m tile | live fetch, 61,741 bytes |
| **Vertical datum** | **already mPD** — no conversion needed | see validation below |
| Licence | data.gov.hk open licence, attribution required | data.gov.hk |
| Accuracy (stated) | ±5 m | data.gov.hk |

### Datum validation (the thing that had to be checked)

Sampled the DTM bilinearly at the four surveyed collar positions of the worked example:

| Hole | DTM (m) | Surveyed GL (mPD) | Diff |
|---|---|---|---|
| DH 3 | 176.60 | 178.57 | −1.97 |
| DH 4 | 177.77 | 176.28 | +1.49 |
| DH 5 | 172.48 | 171.34 | +1.14 |
| DH 6 | 189.82 | 187.35 | +2.47 |

**Mean bias +0.78 m, RMSE 1.84 m, max 2.47 m** — inside the stated ±5 m and with no
systematic offset. This confirms the service is in Hong Kong Principal Datum, the same
datum as the borehole GLs. No geoid/ellipsoid correction is required.

### ⚠ The caveat that governs the whole design

data.gov.hk states, verbatim:

> "It shows the topography of terrain (including non-ground information such as elevated
> roads and bridges) in 5-metre raster grid with an accuracy of ±5m. **If land area is
> covered by vegetation, the terrain will be depicted by the height of vegetation.**"

So this "DTM" is **not bare-earth** — on a vegetated HK hillside (exactly our use case) it
returns canopy top, which can be several metres high, and it includes bridge decks and
flyovers. It must never be presented to the user as surveyed ground level.

This single fact drives the recommended approach below.

## 3. Recommended approach — residual-corrected drape

Do **not** replace the borehole-interpolated surface with the DTM. Do **not** show them as
two independent lines and leave the user to reconcile them. Instead:

1. Sample the DTM along the section line at ~1 m spacing (or 1 px, whichever is coarser).
2. At each *station*, compute the residual `r_i = DTM(collar) − surveyed GL_i`.
   This residual absorbs vegetation bias, DTM error, and the ±5 m tolerance, **as measured
   at that specific spot**.
3. Interpolate `r` along the line with the existing `interpolateSeries` (PCHIP is the right
   choice here — smooth, no overshoot).
4. Draw `groundSurface(d) = DTM(d) − r(d)`.

This yields a surface that:

- **passes exactly through every surveyed collar level** — the best data on site is
  honoured, not averaged away;
- **follows the real shape of the ground in between** — the crest/gully the user is
  worried about now appears;
- **self-cancels the vegetation bias** to first order, because the bias is estimated at the
  boreholes and carried between them, rather than assumed zero.

Outside the outermost boreholes there is no residual to interpolate; hold the end residual
constant (consistent with how `interpolateSeries` already clamps) and **mark that reach as
extrapolated** in the drawing.

### Why not the alternatives

| Alternative | Why rejected |
|---|---|
| Draw the raw DTM as the ground surface | Puts canopy/bridge decks on a geotechnical section, and disagrees with surveyed collars by up to 2.5 m at the collars themselves. Indefensible in a submission. |
| Draw both DTM and borehole surface as two lines | Honest, but leaves an unresolved contradiction on the drawing and makes the strata bands ambiguous — which surface do they hang from? |
| Use the borehole surface, ignore terrain | The status quo; 4.5–32 m wrong (§1). |
| 50 cm 2020 DTM/DSM from HK Geodata Store | Better data (see §7) but bulk tile download, no tiled API, and a much larger integration. Right upgrade later, wrong first step. |

## 4. Where the fetch happens

The user proposed extracting terrain when the site boundary rectangle is drawn. That is a
good *trigger* but the wrong *scope* on its own, because the section line can be dragged
outside the boundary. Recommended:

- **Primary:** fetch on demand for whatever tiles the current section line crosses, with an
  in-memory tile cache keyed by `{lod}/{row}/{col}`. A 1 km line touches 1–3 tiles ≈ 60–180 KB,
  fetched once and reused for every subsequent drag in that area. This is what makes
  live-dragging feel instant.
- **Secondary (the user's idea, kept):** when the boundary is drawn, pre-warm the cache for
  the tiles covering it, so the first section drag has nothing to wait for. A typical
  500 m site is 1–4 tiles.
- **Persistence:** store the *sampled profile* (not the tiles) in the project CSV so a saved
  project reopens with its terrain intact and no network. Tiles stay in memory only.

Whole-territory pre-bundling is not viable: HK at LOD 15 is ~1,350 tiles ≈ 80 MB, against
the current 5.4 MB `web/data/` payload.

## 5. Decoding LERC in the browser

Esri's decoder is on the CDNs the app already preconnects to:

| File | Size |
|---|---|
| `lerc@4.0.4/LercDecode.min.js` | 14.1 KB |
| `lerc@4.0.4/lerc-wasm.wasm` | 117.6 KB |

Loaded lazily (dynamic `import()`) only when terrain is first switched on, matching the
existing `ensureMapLibs()` / `mapExport()` pattern — so users who never enable terrain pay
nothing. Consistent with the current CDN-based dependency approach (Leaflet, proj4).

Verified end to end in this investigation: tile fetched → LERC decoded (`code 0`,
257×257 `float32`) → values 83–348 m over the example tile, i.e. genuine hillside relief.

## 6. Proposed build order

Each step is independently shippable and independently verifiable.

1. **`web/terrain.js` — pure, testable core.** Web-Mercator ⇄ tile math, bilinear sample,
   residual-correction. Takes an injected tile-fetcher so it runs under Node.
   Self-check `web/test_terrain.mjs`: assert tile/pixel math against the hand-computed
   values in this document, assert the corrected surface passes exactly through the four
   worked-example collar levels, assert clamping outside the end stations.
2. **Tile client + cache.** Fetch, LERC-decode, cache by tile key; concurrency cap; graceful
   offline/failure path that falls back to today's behaviour with a visible note.
3. **Section rendering.** Draw the corrected ground surface; hang the strata bands from it
   instead of from the interpolated collar line. Dash the extrapolated end reaches.
4. **UI.** A "Ground surface" control in Cross-section options with three states:
   `Interpolated between boreholes (current)` / `LandsD 5 m DTM, fitted to collars
   (recommended)` / `DTM raw (comparison)`. Default to current until validated, then flip.
   Attribution line on the diagram and in the PNG export.
5. **Boundary pre-warm** and **project-CSV persistence** of the sampled profile.

## 7. Open questions / risks

1. **Vegetation bias is only first-order corrected.** If a section runs from a paved
   platform onto dense hillside vegetation, the residual changes character between the two
   stations and PCHIP will smooth across that transition. Consider flagging reaches where
   the DTM-minus-corrected surface exceeds, say, 3 m as "canopy likely" rather than silently
   drawing it.
2. **Elevated structures.** A flyover crossing the section line becomes a spike in the
   ground surface. A median filter over the sampled profile would remove it — but it would
   also flatten genuine sharp features like a retaining wall or a cut face. Recommend
   *detecting* and annotating spikes rather than filtering them away.
3. **Accuracy claim.** The DTM is ±5 m; our residual correction makes it far better *near
   boreholes* and leaves it at roughly ±5 m far from any. The drawing should not imply
   uniform accuracy — consider shading confidence by distance to the nearest station.
4. **Upgrade path.** The 2020 50 cm DTM/DSM in HK1980 grid (HK Geodata Store) is an order of
   magnitude better and would largely resolve (1) and (2), since a true DSM/DTM *pair*
   lets canopy height be computed rather than guessed. No tiled API — needs bulk download
   and our own tiling, so it is a later phase, not phase 1.
5. **Offset correction for collars.** Once terrain exists, a borehole's collar could
   optionally be plotted at *its own* DTM elevation rather than the section line's — making
   the offset error in §1.1 visible as a vertical tick. Worth prototyping only after the
   surface itself lands.
6. **Licence attribution** must appear on exported PNG/PDF, not just on screen.

## 8. Verification plan

- Node self-check as in step 1 (no network; fixture tile committed).
- Against the worked example: corrected surface must reproduce 178.57 / 176.28 / 171.34 /
  187.35 mPD exactly at the four collars.
- Visual: the DH 6 → DH 5 line must show the 4.5 m mid-span crest that the straight line
  currently misses.
- Regression: with terrain disabled, the section must be byte-identical to today's output.

## 9. References

- [Digital Terrain Model (DTM) — DATA.GOV.HK](https://data.gov.hk/en-data/dataset/hk-landsd-openmap-5m-grid-dtm)
- [CSDI Portal DTM dataset](https://portal.csdi.gov.hk/csdi-webpage/dataset/landsd_rcd_1638158088368_93806)
- [Lands Department — Open Data (Geospatial)](https://www.landsd.gov.hk/en/spatial-data/open-data.html)
- [HK_DTM ImageServer](https://tiles.arcgis.com/tiles/6j1KwZfY2fZrfNMR/arcgis/rest/services/HK_DTM/ImageServer)
- [Hong Kong elevation data guide — GPXZ](https://www.gpxz.io/blog/hong-kong-dem-guide) (50 cm 2020 products)
