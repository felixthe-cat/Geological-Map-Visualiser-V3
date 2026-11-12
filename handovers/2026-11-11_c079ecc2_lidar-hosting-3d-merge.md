# Handover — session c079ecc2 (2026-11-11)

## What this session was for

Continued from session c779fc23. Hosted the CEDD 0.5 m LiDAR inside the free tiers, then
fixed and extended the 3D block builder: display bugs, white buildings, roads and bridges,
a full screenshot test sweep, the merge of the 3D builder into the 2D builder as one tab,
and a new "How It's Done" page.

## What changed

**LiDAR hosting**
- `tools/lidar_ags_sheets.mjs`, `tools/lidar_pack.mjs`, `tools/lidar_upload.mjs` (new).
- `web/lidar_tile.js`: `.hkdt` packed format (`packGrid`, `unpackGrid`, `sheetName`).
- `web/builder3d.js`: `fetchHostedLidar` auto-loads 0.5 m sheets from Supabase bucket `lidar`.
- Only ground within 200 m of AGS boreholes is kept: 1,680 sheets, 0.778 GB (ADR-14).
- `.vercelignore` and `.gitignore` keep `LIDAR Survey Files/` (21 GB) out of deploys and git.

**3D display fixes** (`web/builder3d.js`, ADR-17)
- Layers use fixed depth offsets, never slope-scaled. This fixed soil colours showing
  through the terrain and through section cut faces.
- Buildings trimmed to the boundary (`clipToPoly` in `web/block3d.js`), drawn only inside
  the block (ADR-16; a 100 m context ring was tried and rejected by the user).
- `addPrism` + `prismCaps`: solid white face where a cut slices a building or bridge.
- Boreholes hidden by default and clipped with the block.
- Photo map depth margin (`PHOTO_BIAS`); options reset per dataset (`applyOptions`).

**Roads and bridges** (ADR-19)
- `setInfra`: Highways Dept structure + footbridge outlines, deck level from the Lands Dept
  5 m DTM (`deckLevel`); Lands Dept road centre lines widened by `ROAD_W` (`ribbon`).

**Merge into the 2D builder** (ADR-18)
- `web/builder.html` tab "5 · 3D Terrain Block & Section" holds `builder3d.html?embed=1`
  in an iframe. `web/builder.js` `open3d` hands over the project; `window.geo3d`
  {open, settings} and `postMessage` (ready / height / scroll) on the 3D side.
- Embed mode stacks block, section + export, boundary map; no inner tabs.

**New page**
- `web/how.html` ("How It's Done"), linked from `index.html`, `builder.html`, `builder3d.html`.

**Docs**
- `docs/qa/3D_BUILDER_QA.md` + `docs/qa/img/` (test report with before/after pictures).
- `docs/DECISIONS.md` ADR-14 to ADR-19; `docs/DEVLOG.md`; `docs/UX_CHANGELOG.md`.

Last feature commit: `68475ea`. Everything is pushed to `origin/main`.

## Deploy / run state

- **Vercel production:** deployed after `68475ea`. Verified by fetching live files:
  `/how` returns 200, `/builder` has the single 3D tab, `builder3d.js` has `setInfra`,
  `prismCaps`, `addPrism`, `block3d.js` has `ribbon`.
- **Supabase Storage:** bucket `lidar` holds 1,681 files, 0.778 GB of the 1 GB free tier
  (checked by SQL on `storage.objects`). Public read works.
- **Not verified live:** the 3D tab itself. It is behind the admin gate and the admin
  password was not entered. All 3D testing was on `localhost:5510` (launch config `web3d`),
  which reads the same public Supabase and government data.
- All 9 web self-checks pass (`node web/test_*.mjs`).

## Open questions / waiting on the user

- User should sign in as admin and click tab 5 on the live site once.
- SLOPE/W product link on `how.html` returned 403 to a script (bot block); needs a manual click.
- Road widths are assumed by road type; bridge deck levels are good to a few metres;
  footbridges unchecked; no piers. Better data (Lands Dept 3D-BIT00 infrastructure models,
  iB1000 road polygons) is file-download only and would need hosting like the LiDAR.
- 290 AGS sheets (4,345 holes) have no LiDAR tile, mostly near the airport and Sai Kung:
  see `LIDAR Survey Files/missing_ags_sheets.csv` (local, git-ignored).
- Supabase egress is unmeasured: about 0.8 MB per LiDAR sheet against 5 GB a month.
- Not exercised: mouse-dragging the slice handle, hand-drawing a boundary, cloud "Save changes".
- Home page links still open the standalone `builder3d.html`.
- Carried from c779fc23: 3D features stay admin-locked until the user decides to release them.

## Good first moves

1. Read `docs/qa/3D_BUILDER_QA.md` for what was tested and how.
2. `git log --oneline -8` and `git status` to confirm the tree is clean.
3. For any 3D work, start the `web3d` preview and use the localhost-only hook
   `window.__geo3d()` to reach the scene from the console.
4. Test data lives in the browser's localStorage on localhost (`qa_csv`, `qa_plain`,
   `qa_road`); it is throwaway and can be regenerated (30 made-up holes, seed 7).

---

## Update — 2026-11-12 (same session, later work)

### What was added
- **Proposed structure** (tab 5, "Proposed structure" panel): `web/structure.js` (`footprint`, `lineSpans`, `earthworks`) + `web/test_structure.mjs`; wired in `web/builder3d.js` (`structure`, `drawStructureOnMap`, `drawStructure3D`, `structureReport`, `updateStructure`). Shows on the map, 3D block, cut face, section SVG and DXF (`PROPOSED_STRUCTURE` layer); saved in the project settings under `structure`. ADR-21.
- **3D exports:** `exportView` (PNG with solid background) and `exportGLB` (GLTFExporter).
- **"Stopped early" rule** (ADR-20): `interpolateHorizons(..., last)` in `web/section_geom.js` and `makeModel` in `web/block3d.js`. A borehole only counts for layers it drilled through.
- **`isMaterial`** in `web/strata.js`: "No Recovery", "Wash Boring" etc. stay on the log but are not joined up as layers.
- **2D section:** label rows with leader lines, legend clear of the B end (`web/builder.js`).
- **Rock contour:** interval picks itself until the user chooses; 10 m option.
- **Site map:** typed HK1980 or lat/lng box sets the search area (`typedBbox` in `web/sitemap.js`); dead "Send to 3D Builder" button removed.
- **Landing page:** one builder link, accurate text, third card, honest footer; 17 dead CSS rules removed from `web/style.css`.
- **Docs:** `docs/qa/SITE_AUDIT.md` + `docs/qa/img2/`; `web/how.html` updated for the new features.

Commits: `487cdfe` (structure, exports, site-map fix), `31d09a7` (audit fixes and report). Both pushed.

### Deploy / run state (12 Nov)
- Vercel production deployed after `31d09a7`; live files checked by fetch (`isMaterial`, `last=null`, `typedBbox`, `LANES=6`, new landing text, no `viewer-iframe` CSS).
- The Hugging Face log helper worked on 12 Nov: 171 boreholes loaded in 12 s for E 833300-833700, N 820800-821200.
- Live 3D tab still not clicked through (admin-only). All testing on `localhost:5510`.
- All 10 web self-checks pass.

### Open / waiting on the user
- **Presentation + video update is NOT started.** A task card "Update talk deck + feature video for 3D" (task_bf90d048) was proposed with a full brief; it expires about 19 Nov if not started. The "offer" card type ended this session twice, so do not use it here.
- Not exercised: mouse dragging (section line ends, slice handle, structure pin), phone-width builder layout, saving to an account.
- Left as they are: "Unclassified" AGS layers; one site-wide layer order; one very deep borehole sets the block base unless a base level is typed.
- Dig/fill volumes assume vertical sides; no batter or working space.

### Good first moves (added)
- Read `docs/qa/SITE_AUDIT.md` before touching the 2D section or the layer model.
- For the presentation job, start from the task card's brief or from `handovers/2026-11-11_3ba3d1c2_talk-presentation-video.md`.

## Related sessions

- [c779fc23 — white model + LiDAR tile loader](2026-11-11_c779fc23_white-model-lidar.md) (this session continued from it)
- [fa302799 — 3D Block builder](2026-10-15_fa302799_3d-block-builder.md)
