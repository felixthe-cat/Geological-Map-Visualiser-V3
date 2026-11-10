# Handover: 3D white model, LiDAR tiles, off Hugging Face (session c779fc23, 2026-11-10 → 11)

## What this session was for

Resumed the 3D Block builder (note fa302799). The user then asked for a calm "architectural
card model" look for `builder3d` (skill `site-model-viewer-style`): sage terrain with 2 m
contours, plain white buildings, geology on the block sides and the cut, and a cut you can drag
and turn in 3D. Then: load the CEDD 2020 0.5 m LiDAR ground model, size up hosting it on the
free tiers, and remove the remaining Hugging Face 3D pieces. User's choices along the way:
- reuse `builder3d` (no new page); geology from boreholes; vertical cut only;
- buildings from the Lands Dept building outlines (not recoloured photo mesh);
- 0.5 m LiDAR wanted (portal is order-and-download → built a file loader);
- move **only the 3D parts** off HF; **keep the 2D → 3D hand-off** (no site map search in 3D).

## What changed

All committed and pushed to `origin/main` (6be6dd8 … 7dc301f).

| Commit | Files | What |
|---|---|---|
| 6be6dd8 | `web/builder3d.js`, `builder3d.html`, `block3d.js`, `test_block3d.mjs` | Orthographic camera, sky + warm sun + shadows, north arrow, "concept model" tag; sage terrain skin with 2 m contours **drawn in its fragment shader**; `setBuildings()` extrudes CSDI "Building" FeatureServer outlines (`BaseHeight`/`TopHeight`) as chalk blocks + edge lines; two `TransformControls` (arrow = move, ring = turn) driving the sliders via `sliceFromPose()`; photo map now off by default. Helpers `ringsToShapes()`, `sliceFromPose()` + tests |
| 1590b88 | `web/lidar_tile.js` (new), `test_lidar_tile.mjs` (new), `builder3d.*` | Reads CEDD "RASTER-DTM" GeoTIFF (uncompressed float32, 128 px tiles, 1500×1200 cells of 0.5 m); file picker (multiple .tif), `dtmAt()` tries LiDAR first then the 5 m model; "Very fine" detail (300) |
| b834ed9 | `web/builder.html/.js`, `index.html`, `vercel.json`; deleted `viewer.html`, `app.js` | Removed old HF iframe viewer, the "5 · 3D via Hugging Face" tab and `sendToHF`; home page 3D links → `builder3d.html`; redirects `/viewer(.html)` → `/builder3d` |
| 7dc301f | `docs/DEVLOG.md` | Correction: GitHub push block is resolved |

Docs: `DEVLOG.md` entries for each, `DECISIONS.md` ADR-12 (buildings from outlines) and ADR-13
(5 m kept, LiDAR via file loader — partly superseded by 1590b88), `UX_CHANGELOG.md` lines.

Key facts:
- CSDI building layer: `portal.csdi.gov.hk/server/rest/services/common/landsd_rcd_1637211194312_35158/FeatureServer/0/query`, no key, CORS ok for Vercel and localhost.
- Contours as separate lines lost the depth fight with the polygon-offset skin in ortho view; the shader approach fixed it.
- The two gizmos overlap: the one not being dragged is disabled during a drag.
- LiDAR sheet grid is aligned to E 800000 / N 800000 in 750 × 600 m steps. Test tile `11NW10D` = E 836750–837500, N 821600–822200, 17.6–98.5 mPD.
- CEDD tiles are only available through `sdportal.cedd.gov.hk` (captcha + order). Terms allow redistribution with credit.

## Deploy / run state

- **Live** at https://geological-map-visualiser.vercel.app (`vercel --prod --yes` after each change). Verified by fetching the live JS/HTML for the new code, plus `/viewer` → 308 → `/builder3d`. The live pages were **not clicked through**; the preview was (hillside example, a 200 m box, buildings, handles, LiDAR tile).
- 9 Node self-checks pass (`web/test_*.mjs`; `test_lidar_tile.mjs` optionally takes a real tile path).
- **GitHub push works** (`workflow` scope granted; `origin/main` = local). Earlier "still blocked" warnings were wrong.
- Preview server `web3d` (python http.server, port 5510) may still be running.

## Open questions / waiting on the user

1. **LiDAR hosting choice** (asked, unanswered). Estimates: hilly tiles with 3+ AGS drillholes = 555 tiles ≈ 0.87 GB compressed at 0.5 m (fits the 1 GB free tier, just); all tiles with AGS at 1 m ≈ 1,631 tiles ≈ 0.65 GB. As downloaded, a tile is 7.9 MB; 1 cm-rounded deltas compressed ≈ 1.6 MB (measured on one tile only). Free limits: Vercel Blob 1 GB / 10 GB transfer; Supabase 1 GB / 5 GB egress / 50 MB per file; Supabase Pro $25 → 100 GB. Needs a PC-side conversion script before any upload.
2. **AGS loading still uses the HF Space** (`web/sitemap.js`: `fetch_stratigraphy`, `fetch_raw_ags`) by the user's choice. CEDD's `GI_AGS.zip` sends no CORS header, so moving it needs a Vercel function (Python could reuse `src/ags_open_data.py`).
3. LiDAR tiles aren't remembered between visits or saved with the project.
4. Contours look speckled on rough, nearly flat LiDAR ground sitting on a contour level.
5. Carried from fa302799: DXF import into GeoStudio/PLAXIS untested; cloud "Save changes" from the 3D page untested; Revit/IFC and PLAXIS 3D deferred.
6. Security: the `space` git remote contains a Hugging Face token in plain text; suggested the user rotate it. Not acted on.
7. `SOUL.md` still describes the old GemPy/Gradio stack.

## Good first moves

- [ ] `git log --oneline -6`; `for f in web/test_*.mjs; do node "$f"; done`.
- [ ] Preview `.claude/launch.json` "web3d" → `/builder3d.html`, `localStorage.geovis_admin='1'`. Load the example → "Box around boreholes" → Build; tick "Cut the block" and drag the arrow/ring.
- [ ] Ask the user for the LiDAR hosting choice (item 1) before writing the conversion script.
- [ ] Session counts/scripts were in the scratchpad (not kept): per-sheet AGS counts came from the CSDI Borehole_Location FeatureServer (`cedd_rcd_1636517845149_16420`, 331,223 stations) joined with the `GI_AGS.zip` manifest (23,953 reports); hilliness from the HK_DTM LOD 12 tiles.

## Related sessions

- `handovers/2026-10-15_fa302799_3d-block-builder.md`: built `builder3d` (block, photo mesh, slice, DXF). This session continues it.
- `handovers/2026-09-24_legacy_previous-note.md`: project overview and deploy mechanics.
