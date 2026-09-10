# DEVLOG

Newest entry at the top. Append only — never rewrite or reorder earlier entries.

---

### 2026-09-10 20:31 — Site map base maps, marker visibility, ground-surface default

**Goal:** "the AGS stratigraphy available point is too transparent… the Open Street Map isn't
working… please do offset correction as the default."

**Changed:**
- `web/sitemap.js` — `initSiteMap()` builds its layer control from the shared `BASEMAPS`
  table in `map_export.js` instead of defining two tile layers inline. `plotResults()`
  result markers and `drawCoverage()` coverage points/cells restyled for contrast.
- `web/builder.html` — `#sec-ground` now defaults to `dtm-offset`, listed first.
- `web/builder.js` — the two `sec-ground` fallback strings match the new default.

**Worked:** Reproduced the OSM fault live before touching it — at zoom 20 the layer added
zero tiles and left Google's in the pane. After the fix, production serves z19 OSM tiles
upscaled, 0 broken, no leftover Google. Ground default confirmed `dtm-offset` with the real
correction note (not the "still loading" fallback). All five Node self-checks pass.

**Dead ends:** First suspected the OSM tile server or its subdomain pattern — probed
`a.tile.openstreetmap.org` directly and it returned a valid 256×256 tile, so the source was
fine. Then tested at the default zoom 11, where switching layers works perfectly. Only
setting the view to zoom 20 first exposed it. Leaflet refuses to render a tile layer whose
`maxZoom` sits below the map's current zoom and does so **silently** — no error, no failed
request, nothing in the console. Reading the two layer definitions side by side, both look
correct; the bug is only visible in the tile pane at high zoom.

**Open:** Defaulting to the DTM surface means the first cross-section render always hits the
Lands Department tile service. It degrades correctly (interpolated surface first, upgrade on
arrival) but has not been tested against a service outage. `dtm-fit` is retained for
comparison — see ADR-1.

---

### 2026-08-30 18:25 — Seven cross-section features

**Goal:** Extrapolate past the end boreholes; correct the ground surface for borehole offset;
title-based export filenames; drawable proposed-structure annotations; manual borehole
selection; a hover level readout; and save the whole setup to the project/cloud.

**Changed:**
- `web/section_geom.js` — `interpolateSeries()`/`interpolateHorizons()` take an `extrap`
  argument (`'hold'` | `'linear'`).
- `web/terrain.js` — new `offsetCorrectedProfile()`: corrects the on-line DTM by each
  borehole's own collar-minus-DTM difference rather than forcing the line through collars.
- `web/builder.js` — annotation store/editor/drag, `toggleSectionBorehole()`, hover readout,
  `exportStem()` for `TITLE_TYPE_DATE` filenames, `sectionSettings()`/`projectExtras()`,
  `prefetchDtmTiles()` replacing the per-line prefetch.
- `web/project_csv.js` — `#GEOVIS` header bumped to `v:2`, carrying `section`, `excluded`
  and `annots`.
- `web/builder.html`, `web/style.css` — new controls, annotation editor, hover tooltip.
- `web/test_section_geom.mjs`, `web/test_terrain.mjs`, `web/test_project_csv.mjs` — cases for
  extrapolation, the offset correction, and the extended save format.

**Worked:** All five self-checks pass. Verified in-browser end to end, including a full
save → page reload → reload-project cycle that restored every control, the deselected
borehole and the annotation. On the example site the offset-corrected surface differs from
the previous forced-through-collars surface by up to 6.5 m.

**Dead ends:** Extrapolating layer *elevations* directly was never attempted — the existing
thickness-based stacking already clamps at zero, so continuing a trend can pinch a band out
but not invert it. A regression test now covers that at ±400 m outside the borehole range.

**Open:** Annotations are not clipped to the plot area — corners typed far outside the
section draw outside it. Cloud save still requires the three Supabase setup steps in
`docs/PLAN_ACCOUNTS_SUPABASE.md` §3; no live sign-in has ever been exercised.
