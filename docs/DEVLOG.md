# DEVLOG

Newest entry at the top. Append only — never rewrite or reorder earlier entries.

---

### 2026-11-11 23:50 — Feature video for the talk (HyperFrames)
**Goal:** "Yes, build video" — the approved storyboard: site map → example data → log → section → contours → export, no 3D, no music.
**Changed:** `videos/shots/record_app.py` drives the live builder and records it with Chrome's screencast (sharp JPEG frames) plus an event log of every mouse move, click, chapter and the on-screen box of each panel. `videos/shots/gen_demo.py` bakes that log into `videos/feature-video/compositions/demo.html` (camera punch-ins, oversized cursor, chapter chips, labels). `videos/feature-video/` = HyperFrames project: `title.html`, `demo.html`, `endcard.html`, `index.html` (122.8 s). All gitignored.
**Worked:** `hyperframes check` passes (0 errors). Snapshots reviewed across all beats. The cursor, labels, hover readout, extrapolation option and contours all read clearly.
**Dead ends:** Playwright's own video is low bitrate, so CDP screencast was used instead. The example picker is hidden on the Site Map tab, so the log tab must open first. Guessing camera framing from frames failed once the page scrolled; logging `getBoundingClientRect` at each step fixed it. A logged rect taken before a control was scrolled into view falls back to the next click's position.
**Open:** delivery render was still running when this entry was written; the MP4 has not yet been copied into `videos/presentation/assets/features.mp4` or checked in the deck. Film is silent on purpose (`film_silent` warning).

---

### 2026-11-11 16:30 — 3D display bugs, full 3D test sweep, 3D merged into the 2D builder tabs
**Goal:** fix soil colours showing through the terrain and through section cuts, trim edge buildings, hide boreholes by default, test every 3D feature with screenshots, and make the 3D builder tabs 5 and 6 of the 2D builder.
**Changed:**
- `web/builder3d.js`: layer meshes use a fixed depth offset (`polygonOffsetFactor:0`, units k+1) instead of a slope-scaled one; terrain skin has none. Buildings are trimmed with `clipToPoly`, wound outwards, lit on the outside and flat grey on the inside (`LOOK.buildingCut`). Borehole sticks take the clipping plane. Photo map gets a fixed depth margin (`PHOTO_BIAS`, `photoUnits`, `biasBuildings`). `applyOptions` resets every option to its default; `holesOn` is saved. `EMBED` mode (`?embed=1`) exposes `window.geo3d` {open, show, settings} and posts `ready` / `tab` messages. Localhost-only `window.__geo3d` test hook.
- `web/block3d.js`: `clipToConvex`, `isConvex`, `clipToPoly`. `web/test_block3d.mjs`: checks for them.
- `web/builder3d.html`: boreholes off by default; `.solo` blocks (dataset picker, save) and the header are hidden in embed mode.
- `web/builder.html`: tabs "5 · 3D Terrain Block" and "6 · 3D Cross-Section" (admin-locked like the other 3D features) sharing one iframe pane; header "3D Block" link removed.
- `web/builder.js`: `open3d`, message listener, `sent3d` / `pending3d`; `projectExtras` takes live 3D settings from the iframe; 3D tabs use the full-width layout.
- `docs/qa/3D_BUILDER_QA.md` + `docs/qa/img/` (30 pictures): the test report. `docs/DECISIONS.md`: ADR-17, ADR-18.
**Worked:** before/after screenshots for each bug on a 30-hole, 7-layer test site (see the QA report). Tabs 5/6 build the block from the 2D project, keep it when switching tabs, and their settings land in the 2D builder's saved CSV. All 9 web self-checks pass.
**Dead ends:**
- A 0.4 m photo-map depth margin still left stripes on steep ground; 2 m cleared them, which then needed buildings biased in front of the photo.
- The first attempt at an inline shell heredoc for the merge edit failed to parse; the edit was run from a script file instead.
- Options leaking between datasets was found by accident: a test build silently used "borehole ground levels" from the dataset opened before it.
**Open:** mouse-dragging the slice handle, hand-drawing a boundary, and cloud "Save changes" were not exercised. Live 3D pages are admin-only, so the check was on localhost. The embedded 3D page keeps its own inner tabs, so there are two tab rows on tabs 5 and 6. Home-page links still open the standalone `builder3d.html`.

---

### 2026-11-11 22:40 — Presentation page for the talk
**Goal:** "an HTML page ... on how I made this geological map visualizer ... with Claude Motion incorporated", 15–20 min, English, focus on how it is built, 3D held back.
**Changed:** `videos/presentation/index.html` (13-slide click-driven deck, speaker notes on N, GSAP motion); `videos/presentation/assets/` (local GSAP + fonts, compressed screenshots from `videos/shots/`, `terrain.jpg`, `bh.js` = 1-in-5 of the station index projected onto the terrain mosaic, `qr.svg`). Folder is gitignored, so nothing is deployed. `.claude/launch.json`: `presentation` preview server (port 5520).
**Worked:** every slide stepped through in the browser pane at 1600×900; only console error is the expected 404 for the not-yet-made `assets/features.mp4`. Figures re-checked live: WFS `numberMatched` 331,223; `GI_AGS.zip` 637 MB (Last-Modified 3 Nov 2026); CSDI CSW 1,163 records; 35,326 of 80,000 indexed stations have AGS.
**Dead ends:** "Claude Motion" is a claude.ai Team/Enterprise template, not available from Claude Code, so motion is hand-coded. First layout centred the 1920×1080 stage with CSS grid, which mis-placed it once scaled; fixed with absolute centring + translate.
**Open:** feature video (HyperFrames) waits for storyboard approval. Index still holds only the first 80,000 of 331,223 stations (user chose not to fix). Log loading still depends on the Hugging Face helper.

---

### 2026-11-11 13:00 — LiDAR uploaded to Supabase Storage
**Goal:** "The key is in .env.local now, please upload".
**Changed:** no repo files. Supabase Storage bucket `lidar` (public) now holds 1,680 `.hkdt` sheets + `index.json`, uploaded by `tools/lidar_upload.mjs` with `SUPABASE_SERVICE_ROLE_KEY` from `.env.local`.
**Worked:** the uploader reported 1,681 files / 0.778 GB, 0 failures. A SQL check on `storage.objects` gives `lidar` 1,681 files, 0.778 GB (free tier 1 GB). Public `index.json` and `38_45.hkdt` return 200 with `Access-Control-Allow-Origin: *`. A hillside build with the default (Supabase) source fetched both and reported "Ground: 0.5 m LiDAR (CEDD 2020)".
**Dead ends:** the build could not be tested on the live Vercel page: `/builder3d` is behind the admin gate, and the admin password was not entered. It was tested instead on the same code served from localhost, which reads the same public Supabase URL.
**Open:** egress is unmeasured. Each 3D build downloads ~0.8 MB per sheet, against 5 GB/month free egress (~6,000 sheet loads).

---

### 2026-11-11 12:30 — Buildings only inside the block (reverts the 100 m ring)
**Goal:** "It should only show the buildings that are within that block of terrain. When we cut sections through the terrain, the building should disappear alongside the terrain itself."
**Changed:** `web/builder3d.js` restored to its 228de76 state: `setBuildings` draws only buildings whose centre is inside the boundary; `CONTEXT_M`, `contextGround` and `prefetchDtm(pad)` removed. `web/builder3d.html`: label "Existing buildings (white blocks)", and its tooltip says they are cut away with the ground. `docs/DECISIONS.md`: ADR-16 supersedes ADR-15.
**Worked:** local test with a boundary 110 m around the hillside holes (passed in as a 2D-builder handoff): 13 buildings, all on the block. With the slice on and flipped, the large building disappears with its half of the ground. This works because building materials share the block's clipping plane. All 9 web self-checks pass.
**Dead ends:** the 100 m context ring (fa9da20). The user saw buildings floating outside the block as unintended.
**Open:** a building straddling the boundary is drawn whole, so it can overhang the block edge by a few metres.

---

### 2026-11-11 11:10 — Deploy + check of the white context buildings
**Goal:** "include the existing buildings onto the 3D model … plain white texture like architectural models".
**Changed:** no code beyond commit fa9da20 (`web/builder3d.js` `setBuildings` / `contextGround` / `prefetchDtm(pad)`, `web/builder3d.html` label). `docs/DECISIONS.md`: ADR-15.
**Worked:** Vercel production deploy; live `builder3d.js` contains `contextGround` and live `/builder3d` shows the new label. Local hillside build: 13 buildings, block sides still visible through the ground sheet.
**Dead ends:** the first local re-test still showed "No mapped buildings inside this boundary": the browser served the cached old `builder3d.js`. Fixed by re-fetching it with `cache:'reload'` before reloading. The only console error left is the 400 from the not-yet-uploaded `lidar/index.json`, which the page already handles.
**Open:** LiDAR upload still waits for `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`. Ring LiDAR only covers the boundary's own sheets; the rest of the ring uses the 5 m model. The ring is a fixed 100 m.

---

### 2026-11-11 — Existing buildings around the 3D block
**Goal:** show existing buildings as plain white blocks in the 3D model.
**Found:** white blocks already existed, but only for buildings whose centre is inside the boundary. "Box around boreholes" hugs the holes, so the hillside example showed none (19 buildings lie within 100 m).
**Changed:** `web/builder3d.js` `setBuildings` now asks the Lands Dept building layer for the boundary box + 100 m (`CONTEXT_M`). Outside buildings stand on `dtmAt` ground (LiDAR, else 5 m); a faint see-through ground sheet (`contextGround`) sits under them so the block's coloured sides stay visible. `prefetchDtm(pad)` fetches the 5 m tiles for the ring. Checkbox label updated in `builder3d.html`.
**Worked:** hillside example draws 13 buildings (was 0), no new console errors; all 9 web self-checks pass.

---

### 2026-11-11 — Keep LiDAR out of Vercel deploys
**Goal:** deploy the hosted-LiDAR change without uploading the 21 GB download folder.
**Changed:**
- `.vercelignore` (new): excludes `LIDAR Survey Files` and `web/lidar_local`.
- `docs/DECISIONS.md`: ADR-14 (0.5 m within 200 m of AGS holes, Supabase Storage). `docs/UX_CHANGELOG.md`: one line.
**Worked:** `vercel --prod --yes` succeeded after the ignore file; live `builder3d.js` contains `fetchHostedLidar`, live `/builder3d` shows the new hint.
**Dead ends:** first deploy failed opening a `.tif` in `LIDAR Survey Files` — the CLI does not use `.gitignore`; nothing was uploaded.
**Open:** tile upload still waits for `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`; live LiDAR fetch unverified until then.

---

### 2026-11-11 — Hosted 0.5 m LiDAR for AGS areas (pack + auto-fetch)
**Goal:** host the user's 2,689 downloaded CEDD LiDAR tiles (21 GB) inside the free tiers, at 0.5 m, only where AGS boreholes exist.
**Changed:**
- `web/lidar_tile.js`: `.hkdt` packed format (`packGrid` / `unpackGrid`): 5 cm rounding, plane-predictor differences, gzip; `sheetName()` on the 750 × 600 m sheet grid; float-noise tolerance for 4 CEDD tiles (14NE15A–D).
- `tools/lidar_ags_sheets.mjs` (new): all 331k CSDI stations ∩ `web/data/ags_repnos.json` → 189,814 AGS holes on 1,969 sheets.
- `tools/lidar_pack.mjs` (new): packs only those sheets, blanks cells > 200 m from every AGS hole, `SHARD=k/n` for parallel runs.
- `tools/lidar_upload.mjs` (new): creates the public `lidar` bucket and uploads (needs `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`).
- `web/builder3d.js/.html`: on Build, fetches `index.json` + the sheets the boundary touches from Supabase Storage; own `.tif` files still win; `?lidar=<folder>` for local tests.
- `.gitignore`: `LIDAR Survey Files/` (the Stop hook runs `git add -A`) and `web/lidar_local`.
**Worked:** 1,680 sheets packed, 0.778 GB. Local preview (hillside example, box around boreholes) fetched index (22 KB) + one sheet (0.84 MB): "Ground: 0.5 m LiDAR (CEDD 2020)", no console errors. 9 self-checks pass.
**Dead ends:** whole HK at 0.5 m = 1.7 GB (too big); all AGS sheets uncropped ≈ 1.2 GB; `web/data/boreholes.csv` is only a sample (1,837 of 23,827 AGS reports), so the full CSDI layer was used.
**Open:** upload not done (needs the service_role key). 290 AGS sheets (4,345 holes, many likely marine) have no downloaded tile — list in `LIDAR Survey Files/missing_ags_sheets.csv`.

---

### 2026-11-11 00:02 — Admin gate: new password, local password file
**Goal:** change the admin password and keep the plain password in a local file that git never sees.
**Changed:**
- `web/admin.js`: `HASH` constant (line 10) replaced with the SHA-256 of the new password. Only the hash lives in the repo.
- `.gitignore`: added `admin_password.local.txt` (with a comment) so the local file is never staged.
- `admin_password.local.txt` (new, untracked, git-ignored): holds the plain password for the owner. Not in the repo.
**Worked:** `git check-ignore` matches the new file. Hashing the password read back from the file gives the same value as `HASH` in `admin.js`. `git status` shows only `.gitignore` and `web/admin.js` modified.
**Dead ends:** none.
**Open:** the old password no longer unlocks the admin gate. The change is not committed yet; the session Stop hook will stage and push `web/admin.js` and `.gitignore`. The gate is client-side only and is a deterrent, not real security (see `project_admin_gate` note).

---

### 2026-11-11 — Handover note for session c779fc23
**Goal:** write the session handover.
**Changed:**
- `handovers/2026-11-11_c779fc23_white-model-lidar.md` (new): white model, LiDAR loader, HF removal, open items.
- `HANDOVER.md`: new top row; header now says Hugging Face is used only for AGS log loading.
**Worked:** commit and push succeeded; `origin/main` = local.
**Dead ends:** none.
**Open:** as listed in the note (LiDAR hosting choice, AGS loading still on HF, untested DXF import and cloud save).

---

### 2026-11-11 — GitHub push: workflow-scope block resolved (correction)
**Goal:** user asked why they kept being told to re-authorise GitHub.
**Changed:** no code. Supersedes the "Open" item of the 2026-11-04 keep-alive entry (push blocked until the `workflow` scope is granted).
**Worked:** `gh auth status` shows the `workflow` scope and git pushes through `gh auth git-credential`; the remote-tracking log shows every push succeeding since 2026-11-10 23:53, and `origin/main` equals local `main`.
**Dead ends:** the assistant repeated "push still blocked" in two later summaries without re-testing; only one push (~23:45 on 2026-11-10) actually failed.
**Open:** none.

---

### 2026-11-11 — 3D moved off Hugging Face: old viewer page and HF tab removed
**Goal:** "migrate the 3D viewer off the Hugging Face page … function like the 2D viewer, except that we would see a 3D model", so users never wait for the Space to wake.
**Changed:**
- `web/viewer.html`, `web/app.js`: deleted (the page only embedded the HF Space in an iframe).
- `web/builder.html` / `web/builder.js`: removed the "3D Viewer ↗" header link, the "5 · 3D via Hugging Face" tab and its GemPy send code (`sendToHF`, `HF_SPACE`, `HF_URL`).
- `web/index.html`: the three 3D entries (nav, hero button, about card) now open `builder3d.html`; card text describes the 3D block.
- `web/vercel.json`: permanent redirects `/viewer` and `/viewer.html` → `/builder3d` for old bookmarks.
**Worked:** preview: 2D builder shows four tabs, header links are Home + 3D Block, tabs switch with no new errors; home page's three 3D links all go to `builder3d.html`.
**Dead ends:** none.
**Open:** by the user's choice, borehole-log loading and original-AGS download in `web/sitemap.js` still call the HF Space (`fetch_stratigraphy`, `fetch_raw_ags`), so the Site Map's "Load into 2D Builder" still waits for it to wake. CEDD's archive sends no CORS header, so moving that off HF needs a Vercel function, not browser code. The HF Space and `app.py` GemPy endpoints are left as they are.

---

### 2026-11-10 23:58 — 3D Block builder: load CEDD 0.5 m LiDAR tiles from disk
**Goal:** use the 0.5 m LiDAR ground model as the terrain; the user downloaded one RASTER-DTM tile to try.
**Changed:**
- `web/lidar_tile.js` (new) + `web/test_lidar_tile.mjs` (new): `parseDtmTiff()` reads the CEDD tile (classic TIFF, uncompressed float32, 128 px tiles or strips, GeoTIFF tiepoint + pixel scale, no-data tag); `sampleGrid()` bilinear lookup; `gridBounds()`.
- `web/builder3d.js`: `loadLidar()` keeps parsed tiles in memory; `dtmAt()` tries them first and falls back to the 5 m model; the build note says which ground was used.
- `web/builder3d.html`: file picker (multiple `.tif`), CEDD credit line, "Very fine" detail option (300 cells).
**Worked:** the real tile `11NW10D` parses to 1500 × 1200 cells of 0.5 m, E 836750–837500, N 821600–822200, 17.6 to 98.5 mPD, no gaps. In the preview a 200 m block on that tile showed platforms and cut slopes the 5 m model smooths away; a junk `.tif` was reported and skipped. 9 self-check scripts pass.
**Dead ends:** none. Chose a ~60-line reader over geotiff.js because the tiles are one fixed, uncompressed flavour and a pure function can be tested in Node.
**Open:** tiles are not remembered between visits and are not saved with the project. Supersedes the "terrain is still the 5 m model" item in the entry below and the "add the file loader later" part of ADR-13. The contour shader looks speckled on rough, nearly flat LiDAR ground that sits on a contour level.

---

### 2026-11-10 23:40 — 3D Block builder: white-model look, 2 m contours, white buildings, slice handles
**Goal:** "top surface be the terrain … with the buildings … plain white … sides the geological map … a cross-section plane the user can drag and rotate".
**Changed:**
- `web/builder3d.js`: orthographic camera, sky + warm sun with shadows, north arrow; a sage terrain skin over the block top with 2 m contours drawn in its shader; `setBuildings()` fetches Lands Dept building outlines (CSDI "Building" FeatureServer, `BaseHeight`/`TopHeight`) and extrudes them as chalk blocks with edge lines; two `TransformControls` on one handle (arrow = move the cut, ring = turn it) feeding the existing sliders through `onHandle()`.
- `web/builder3d.html`: two new layer toggles (terrain + contours, buildings), photo map now off by default, "concept model" tag, north arrow, hints.
- `web/block3d.js` (+ `test_block3d.mjs`): `ringsToShapes()` (Esri rings to outline + holes), `sliceFromPose()` (inverse of `sliceLine()`).
**Worked:** local preview on the hillside example with a 200 m box: contours visible, 8 buildings drawn, arrow drag moved the cut 10 → 60 m with direction unchanged, ring drag turned it 60 → 46°, "Face the cut" and the photo map still work. All 8 `web/test_*.mjs` pass.
**Dead ends:**
- Contours as separate line geometry 8 cm above the skin: invisible. The skin's polygon offset is slope-scaled, which in an orthographic view is metres on steep ground, so it beat the lines. Moved the contours into the skin's fragment shader.
- Arrow and ring picked up the same drag (the ring's hit area crosses the arrow). Fixed by disabling the other gizmo while one is dragging.
- CEDD 0.5 m LiDAR: `sdportal.cedd.gov.hk` is an order-and-download portal behind a captcha (LAS / TIFF tiles), with no tile service a browser can stream. Not wired in; see ADR-13.
**Open:** terrain is still the 5 m Lands Dept model. Buildings are flat-roofed extrusions, only those whose centre is inside the boundary. Not yet checked on the live site until deployed. Tone mapping from the style guide deliberately left off so layer colours match the legend.

---

### 2026-11-10 — Handover: HANDOVER.md turned into a per-session index
**Goal:** write the session handover for the 3D Block builder work.
**Changed:**
- `HANDOVER.md`: now an index table (one row per session note).
- `handovers/2026-10-15_fa302799_3d-block-builder.md` (new): this session's note.
- `handovers/2026-09-24_legacy_previous-note.md` (new): the old single-file note, moved unchanged.
**Worked:** checked that the live `builder3d.js` contains the tree-flattening fix, and that later sessions touched only the keep-alive and the docs.
**Dead ends:** none.
**Open:** the items listed in the new note (DXF import into GeoStudio/PLAXIS untested, cloud save from the 3D page untested, Revit/PLAXIS 3D deferred).

---

### 2026-11-04 — Keep-alive workflow: default branch switched to main
**Goal:** "Make main the default" so the GitHub scheduled ping can run.
**Changed:** GitHub repo setting only: default branch `master` → `main`. Supersedes the "default branch" item under Open in the 2026-10-31 keep-alive entry.
**Worked:** `gh repo view` reports `main` as default.
**Dead ends:** the auto-push hook had committed the workflow but its push was rejected: the stored GitHub login lacks the `workflow` scope, which GitHub requires to add or change files under `.github/workflows/`. Every push from `main` is blocked until that scope is granted.
**Open:** user must grant the `workflow` scope (`gh auth refresh`), then push `main` and do one manual test run of the workflow.

---

### 2026-10-31 18:30 — Random-timed Supabase keep-alive (GitHub Actions)
**Goal:** keep Supabase from pausing after 1 week idle, pinging at least twice a week at random times even when nobody uses the site.
**Changed:** `.github/workflows/supabase-keep-alive.yml` (new): runs Tue 03:17 and Fri 15:43 UTC, sleeps a random 0-4 h (scheduled runs only), then reads one row from `/rest/v1/projects` with the public anon key; `curl --fail --retry 3`, so a bad answer fails the run and GitHub emails. Has a manual "Run workflow" trigger.
**Worked:** the existing daily Vercel cron (`/api/keep-alive`) is confirmed firing: Supabase edge logs show its request at 04:07 UTC today. The workflow's ping command ran locally and returned OK; the YAML parses.
**Dead ends:** none.
**Open:** not yet run on GitHub. Scheduled workflows only run from the default branch (`master`), which is 75 commits behind `main`. Waiting on the user: make `main` the default, or copy the file to `master`. GitHub also disables schedules after 60 days without commits; the Vercel cron is the backstop for that.

---

### 2026-10-15 21:45 — Repaired the old "Lok Fu FWSR" cloud save
**Goal:** "set the 19 TP holes in the old Lok Fu FWSR save back to trial pits (copy them from the newer 20260928 save)".
**Changed:** no code. In the Supabase `projects` table, row "Lok Fu FWSR": the `kind` column went BH → TP on 50 CSV rows (19 holes), for every hole id that is TP in "20260928 Lok Fu FWSR"; `meta.trialPits` was 0 and is now 19. Supersedes the "not repaired" note in the entry below.
**Worked:** a preview query first (19 holes / 50 rows, no quoted ids). After the update: 19 TP + 21 BH = 40 holes, matching `meta`; CSV length unchanged.
**Dead ends:** none.
**Open:** KTP7 exists only in the newer save, so it was not added. Reverse by setting those 19 ids back to BH if ever needed.

---

### 2026-10-15 22:10 — 3D Block: remove trees and buildings from the photo map over the site
**Goal:** the LandsD photo-mesh includes trees, so the ground looked metres higher than the soil block's top.
**Changed:** `web/builder3d.js` `flattenTile()`: inside the boundary every mesh vertex is laid on the block's ground surface (+5 cm). Outside, vertices more than 2 m above it are lowered: fully within 10 m, fading out over 20 m. Original positions are kept, so the tick box, re-levelling and rebuilds start from the real mesh. Auto-level now raycasts the unflattened mesh. `web/builder3d.html`: "Remove trees & buildings over the site" tick box (on by default, saved with the project).
**Worked:** in the browser, at 4 points inside the boundary the photo map is within 0.1 m of the block top (before: canopy up to ~25 m above). Turning the tick box off restores the trees, and on removes them again. Block check passes.
**Dead ends:** none. One false alarm: a test read heights without dividing out the 1.5× vertical exaggeration.
**Open:** buildings inside the boundary are flattened too (deliberately, for a ground model). Outside the boundary the 2 m threshold leaves low shrubs. Tuning knobs: `TREE_H`, `CLEAR`, `TAPER`.

---

### 2026-10-15 21:55 — 3D Block builder built (builder3d.html)
**Goal:** a 3D viewer built like the 2D builder: LandsD 3D map, soil block inside a drawn boundary, draggable slice that also cuts the map, export to GeoStudio/PLAXIS.
**Changed:**
- `web/builder3d.html`, `web/builder3d.js` (new): admin-gated page. Datasets (2D hand-off, examples, cloud, file) → boundary (draw / box) → three.js block + live LandsD tiles → slice → section SVG, DXF, PNG; save to cloud or CSV.
- `web/block3d.js` + `web/test_block3d.mjs` (new): pure model / clipped-grid triangulation / slice sampling.
- `web/strata.js`, `web/dtm_tiles.js` (new): stratum colours and DTM tile fetching, moved out of `builder.js` so both pages share them.
- `web/project_csv.js`: `#GEOVIS` header carries `block3d`. `web/builder.js` keeps it through 2D saves, and adds the "3D Block ↗" link with a localStorage hand-off.
**Worked:** all 7 Node self-checks pass. In the browser (hillside example): block built in both soil-top modes; DH 3 horizons match the log exactly; photo-mesh textured; auto-level −1.07 m (the same as Infographic-Production's figure); slice cuts mesh + block with capped face; section tab + DXF enabled; L-shaped saved boundary restores; 2D builder loads with no console errors; hand-off works.
**Dead ends:** (1) Photo-mesh came out white: the textures are KTX2 images without `KHR_texture_basisu`, so GLTFLoader skipped them. Fixed with a small glTF plugin. (2) Median auto-level moved the mesh 12.6 m down, because rays hit tree canopy. Now uses the 85th percentile over a 7×7 DTM grid plus the boreholes.
**Open:** DXF not yet opened in GeoStudio/PLAXIS. Revit/IFC and PLAXIS 3D deferred. Auto-level varies by ~1 m with the boundary (DTM ±5 m class). Boreholes are not cut by the slice. Cloud "Save changes" from the 3D page is untested against the real DB.

---

### 2026-10-15 21:30 — Plan for a 3D Block builder (planning only)
**Goal:** a 3D viewer built like the 2D builder: LandsD 3D map, soil block inside a drawn boundary, draggable slice, export to GeoStudio/PLAXIS (Revit evaluated).
**Changed:** `docs/PLAN_3D_BLOCK.md` (new): the agreed scope, the user's answers, the geometry method, files to add, and the risks. No code was written.
**Worked:** checked live that the LandsD 3D tiles (tileset, sub-tilesets, `.b3dm`) return 200 without a key, and send CORS headers for the Vercel origin. So the browser can stream them directly.
**Dead ends:** none yet.
**Open:** waiting for the user's go-ahead. Revit (via IFC) and PLAXIS 3D are deferred. Whether the tiles' CORS rules allow localhost is not checked.

---

### 2026-10-15 21:20 — Trial pits saved as boreholes; "nearer hole wins" for wide tolerances
**Goal:** stop trial pits turning into boreholes after save/reload, and stop a wide distance tolerance pulling far-off holes into the section as noise.
**Changed:**
- `web/project_csv.js`: a missing or blank `kind` now parses as `null` (unknown), not `'BH'`; values upper-cased.
- `web/builder.js`: `importCSV()` fills an unknown kind from the hole already loaded under the same id; "Save changes" asks before overwriting a dataset with fewer trial pits than it had; new `sec-nearest` checkbox wired into the section, site-plan export and saved settings; left-out holes show why in their map tooltip.
- `web/section_geom.js`: `sectionStations(..., nearestWins)` drops a hole when its foot on the line is closer to an already-kept, nearer hole; returns `shadowed`.
- `web/builder.html`: the checkbox (on by default).
- Tests in `test_section_geom.mjs`, `test_project_csv.mjs`.
**Worked:** all 7 Node self-checks pass. In the browser: a 7-column re-import kept TP1 as a trial pit; toggling the rule switched the section between 5 and 3 holes, with the right tooltips; no console errors.
**Dead ends:** guessing TP from the hole name. In the CSDI index, about 6,750 holes named "TP…" are GCO probes, and about half of real trial pits are named "T.P.5" etc. Too unreliable.
**Root cause:** before 2026-10-01 the CSV text box exported/imported 7 columns, with no kind, and the parser defaulted to BH. The cloud save "Lok Fu FWSR" (24–28 Sep) has all 19 TPs stored as BH. It has not been repaired.
**Open:** the site-plan PNG export still ignores "Boreholes only" (an existing gap, untouched).

---

### 2026-10-10 14:55 — Supabase inactivity keep-alive automation
**Goal:** Supabase Free Tier pauses projects after 7 days of inactivity; create an automated system to query the database and keep it alive continuously.
**Changed:**
- `web/api/keep-alive.js` (new): Vercel Serverless Function that queries Supabase REST API (`/rest/v1/projects?select=id&limit=1`) with public `anon` key, returning JSON status and keeping the database alive.
- `web/vercel.json`: added `"crons"` schedule triggering `/api/keep-alive` daily at `04:00 UTC` (`0 4 * * *`). Runs natively on Vercel cloud with zero external dependencies and zero manual maintenance.
- `web/test_keep_alive.mjs` (new): self-check test validating that the keep-alive handler returns HTTP 200 and queries Supabase successfully.
**Worked:**
- Live deployment to Vercel verified in production: `https://geological-map-visualiser.vercel.app/api/keep-alive` returns HTTP 200 with `{ ok: true, message: 'Supabase keep-alive ping successful', ... }`.
- Local test `node web/test_keep_alive.mjs` passes.
- All 5 existing Node self-checks pass.
**Dead ends:** none.
**Open:** none.

---

### 2026-10-09 23:25 — 48 s promo video (HyperFrames)
**Goal:** a 30–60 s promo focused on "the 2D geological mapping, the cross-section function, its extraction of data from the CSDI on the borehole data in AGS format, the terrain of Hong Kong".
**Changed:** `videos/` (new, gitignored) — `shots/capture_app.py` (Playwright drives the live builder, saves screens); `terrain/fetch_dtm.mjs` + `shade.py` (LandsD DTM tiles → HK shaded relief); `terrain/music.py` (synthesised music bed); `geovisualise-promo/` (HyperFrames project, `index.html` = 7 scenes, `renders/video.mp4`). `.gitignore` — added `videos/`. `.claude/launch.json` — preview config.
**Worked:** `hyperframes check` passed; snapshots reviewed; render 1920×1080, 48.0 s, audio present (−19.5 dB mean). Logo-spacing fix verified on a frame from the MP4.
**Dead ends:** (1) `page.evaluate(map.setView(...))` threw "Execution context was destroyed" — it was returning the Leaflet map object; appending `; 0` fixed it. (2) DTM fills the sea with exactly 2.0 m, so the first relief render was all land; sea mask is now `z <= 2.0`. (3) Mid-task, every new process failed with 0xC0000142 until stray processes were cleared.
**Open:** Live "Load into 2D Builder" fails (503 — HF Space stopped), so log/section/contour scenes use the bundled example dataset. The user said "Landsat"; the app uses the LandsD 5 m DTM and the video says so.

### 2026-10-01 15:30 — DXF export for SLOPE/W and PLAXIS; AI formatting prompt
**Goal:** a download next to Export PNG that "could be directly imported into SlopeW and also Plaxis", tested in both; plus a ready-to-copy prompt so Gemini can format GI-report records for "Import CSV → table".
**Changed:** `web/cad_export.js` (new) — `sectionRegions` turns the drawn band curves into closed, non-overlapping outlines (shared vertices on shared boundaries, bands split at pinch-outs), `toDXF` writes DXF R12 with `$INSUNITS`=6 (metres), one layer per band. `web/test_cad_export.mjs` (new). `web/builder.js` — keeps the last section's curves (`secLastGeom`), `exportSectionDXF()`, Copy-prompt handler. `web/builder.html` — "Export DXF (SLOPE/W · PLAXIS)" button; collapsible AI prompt with Copy button under the CSV box. `tests/plaxis_dxf_import_check.py` (new) — imports a DXF into PLAXIS 2D V22 headless, checks polygon count + area, meshes.
**Worked:** Format research: PLAXIS V22 manual (`import` command, Reference §11.8) and GeoStudio 2025.2's own resource strings ("Import CAD Drawing", *.dwg/*.dxf). On the user's own data (13 holes incl. I-DH2/I-DH3, their section line): PLAXIS 15/15 polygons, area 10811.1 m² = DXF (so metres read right), meshed 5853 elements. ezdxf audit: 0 errors / 0 fixes; shapely: no self-crossing, no overlaps. The prompt's own example rows import cleanly.
**Dead ends:** (1) PLAXIS `import "polygons" "f.dxf" (1 1) (0 0)` — the manual's own example — fails "Invalid parameters" on V22; `1 1 (0 0)` is accepted but finds "no objects that can be imported as polygons". Closed POLYLINE *and* LWPOLYLINE both came in as lines only. Fix: `import "f.dxf" "ClosedPolylinesAsPolygons" True` (GUI: tick "Import closed polylines as polygons"). (2) The GeoStudio `gsi` API has no import call, and the user declined GUI control, so the GeoStudio import itself was not run. (3) Python text-mode reads turned CRLF into LF and broke a `split('
')`.
**Open:** GeoStudio File → Import of the DXF is **unverified in the app** — only checked with ezdxf/shapely. Regions arrive without materials in both programs (assign by layer name). Proposed structures are not exported.

### 2026-10-01 10:00 — Fix "Import CSV → table" rejecting the site's own CSV
**Goal:** "I am not able to add new borehole entries … it shows ✗ Missing column: borehole_id" — find why and test the function.
**Changed:** `web/builder.js` — `importCSV()` now reads the project format (`#GEOVIS` line + 9 columns) via `projectCSVToState`; a `#GEOVIS` paste loads the whole project, a plain table replaces only the boreholes. "Export table → CSV" now writes the same project format (`stateToProjectCSV`). Removed `csvToState`. `web/builder.html` — textbox label lists the 9 columns.
**Worked:** Root cause: opening a dataset or downloading the project gives the `#GEOVIS` format, but Import only read the old 7-column table, so it took the `#GEOVIS` line as the header row. Reproduced the exact error in Node with the user's data, then confirmed the new path parses it (I-DH2 / I-DH3 with kind and grade). In the browser: picker text imports; export → append a new borehole → import → it appears in the borehole list and survives re-export; header-less 9-column and old 7-column tables still import. No console errors; all Node self-checks pass.
**Dead ends:** First edit failed to match — `builder.js` has Windows line endings; patched with them normalised and restored. `stateToCSV` had to stay: the Hugging Face sender still uses the 7-column format.
**Open:** The user's I-DH2/I-DH3 rows themselves look valid; not loaded into their saved cloud dataset — they need to Import, then "Save changes".

### 2026-09-24 16:30 — Structure annotations reworked; ground surface made independent of tolerance
**Goal:** clearer rectangle inputs, drag-to-draw/resize, a plan-drawn structure mode, and a ground line that doesn't move when the distance tolerance changes.
**Changed:** `section_geom.js` gained `boxToPts`/`ptsToBox` (moved from builder), `resizeFromCorner`, `cutPolygon`; `terrain.js` gained `idwDelta`; `builder.js` annotation editor rewritten (named corners in a 2×2 grid, captioned fields, Draw on section / Draw on site plan modes, corner handles on both views); plan footprints saved in the same `annots` list with `kind:'plan'`. Section-editor CSS moved from `style.css` into `builder.html` — builder never loaded `style.css`, so the hover tooltip and annotation styles from 2026-08-30 had never applied.
**Worked:** in the preview, ground level at chainage 10/40/70 m is identical at tolerance 5, 30 and 200 m; drawing, resizing and founding-level ↔ depth linking all checked with scripted mouse events. All Node self-checks pass.
**Dead ends:** (1) First resize test asserted the opposite corner keeps its index — false once a drag flips the box past it; fixed by always resizing from the drag-start shape and asserting position, not index. (2) New editor CSS added to `style.css` had no effect — `builder.html` only uses its inline `<style>`; moved there.
**Open:** `offsetCorrectedProfile` in `terrain.js` is no longer called by the app (still tested). Plan footprints aren't exported to CAD/PLAXIS formats yet — see the export plan in chat.

### 2026-09-24 — Handover; Google sign-in confirmed working in production
**Goal:** "make the handover note for me" — this project only.
**Changed:** `HANDOVER.md` rewritten; `docs/UX_CHANGELOG.md` gained a line superseding the 2026-09-23 "not usable yet" entry.
**Worked:** Live checks, not assumptions: all five Node self-checks pass; `/`, `/builder`, `/login`, `/account` return 200; Supabase's Google authorize endpoint 302s to Google. The database holds 1 Google identity and 1 saved project — a real sign-in and save done by the user outside the session.
**Dead ends:** none.
**Open:** Where the user landed after signing in is unknown, so the Supabase Redirect URL allow-list is still unverified. Remaining items are listed in `HANDOVER.md`.

### 2026-09-23 14:05 — Supabase wired up; datasets merged into one picker

**Goal:** check the user's Supabase setup via the MCP plugin, switch accounts on, and let
each user save/load/rename/delete their own datasets from the borehole entry panel.

**Changed:**
- `.gitignore` — `.env` and `.env.*` now ignored. It was **not** ignored and held a real
  Google OAuth client secret; the session Stop hook runs `git add -A`, so the next commit
  would have pushed it to a public repo. Confirmed via `git log --all -- .env` that it had
  never been committed, so no rotation was needed.
- Supabase `ylxyovcujybqodjesbvo` — applied `create_projects_with_owner_only_rls`. The
  `projects` table did not exist; `docs/supabase_schema.sql` had never been run. Added
  `set search_path = ''` to `touch_updated_at`, which the original file lacked.
- `web/supabase_config.js` — real Project URL + anon key filled in. Accounts are now live.
- `web/builder.html` / `builder.js` — the examples dropdown and the cloud project list are
  now **one** picker with two optgroups (`ex:<id>` / `cloud:<uuid>` values), plus Save as
  new / Save changes / Rename / Delete. The old `cloud-list`/`cloud-open`/`cloud-save`/
  `cloud-update` controls are gone; `cloud-block` keeps only the sign-in prompt.

**Worked:** Full round trip verified against the real database, not a stub — created a
temporary confirmed user, signed in, built a project (title, 6x exaggeration, linear
extrapolation, an annotation, a deselected borehole), saved it, reloaded the page, reopened
it and confirmed every one of those came back. Rename, overwrite and delete all verified.
RLS checked directly over REST: anonymous select returns `[]`, anonymous insert returns 401.
Test user and its rows deleted afterwards; `auth.users` back to 1, `projects` back to 0.

**Dead ends:** Signup with an `@example.com` address is rejected by Supabase as invalid, and
a fresh signup has no session until the address is confirmed — had to set
`email_confirmed_at` by SQL before password sign-in would issue a token. `confirmed_at` is
a generated column on this Postgres 17 project and cannot be written.

**Open:** **Google is still not enabled in Supabase** — `/auth/v1/authorize?provider=google`
returns `"Unsupported provider: provider is not enabled"`. Everything else is ready and the
sign-in button is live, but no Google sign-in can succeed until the Client ID and secret are
pasted into Authentication -> Providers -> Google. Supabase's Redirect URL allow-list is also
unverified (not readable through the MCP). A leftover `boreholes` table from an earlier
experiment is still in `public`, unused by this app.

---

### 2026-09-10 21:48 — Landing-page trim + dedicated Google sign-in page

**Goal:** "remove the About and the Docs, the icon button at the very top, the writing
about that is powered by GemPy and hugging face… and I would like to add a Google Auth
page onto it," modelled on the IFU app's login screen.

**Changed:**
- `web/index.html` — dropped the About/Docs nav links and the circular cube icon button;
  removed both "Powered by GemPy / Hugging Face Spaces" claims (footer + 3D card); nav now
  shows *Sign in* when signed out and *My projects* when signed in, both still gated on
  `isConfigured()`.
- `web/login.html` — **new.** Hero panel + lifted content sheet + Google-branded button,
  following the IFU login spec but using this site's own palette and typefaces. Handles
  the unconfigured case, a `?next=` destination, and forwards straight through if a
  session already exists.
- `web/account.html` — no longer carries its own sign-in card; signed-out visitors are
  sent to `login.html`. Removes the second sign-in UI.
- `docs/PLAN_ACCOUNTS_SUPABASE.md` — Step 2 rewritten for Google's 2025 "Google Auth
  Platform" console with the old menu names in brackets, plus a failure-symptom table.

**Worked:** Verified locally in both states — blank config shows an honest "not switched
on" page with no Google button; with placeholder credentials injected, `isConfigured()`
flips and the Google button renders per Google's branding rules. Placeholders were removed
before commit and `web/supabase_config.js` confirmed byte-identical to committed. No
console errors on the landing page, login page or account page.

**Dead ends:** Considered `web/hero_globe.png` (an unused 900 KB AI-generated globe already
in the repo) for the login hero. Rejected on sight — electric blue/orange against a cream
and forest-green site, plus garbled fake text baked into the image. Reused the landing
page's own contour artwork instead: on-brand, and no bytes to download.

**Open:** Sign-in still cannot be tested end to end until the Supabase and Google Cloud
steps are done — no real OAuth round trip has ever run. The landing page keeps `#about`
as a section id even though the About nav link is gone; nothing links to it now.

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
