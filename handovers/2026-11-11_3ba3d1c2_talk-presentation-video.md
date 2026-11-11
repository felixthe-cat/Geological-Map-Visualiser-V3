# Handover — 2026-11-11 · session 3ba3d1c2 · talk presentation + feature video

## What this session was for
Felix is giving a 15–20 min talk (English) to friends and peers, mostly civil and geotechnical
engineers plus some students, on **how GeoVisualise was built**. The talk covers the
government inputs, what the site produces, its uses in later design stages, how to build
something similar, and what else CSDI offers. Engineering principles get only a short slot.
He asked for an HTML page with coded motion, plus a feature walkthrough video (HyperFrames).
**3D is deliberately left out** until he finishes building it; then it should be added to both.

## What changed
All deliverables are in **gitignored** folders: nothing was deployed, and nothing is backed up in git.
- `videos/presentation/index.html` — 13-slide, click-driven deck (GSAP, local fonts, works offline).
  Keys: → / PageDown / Space next, ← back, N speaker notes, F full screen, `#n` in the URL jumps to slide n.
  On slide 9, "next" plays or pauses the video, and S skips it. Assets are in `videos/presentation/assets/`
  (screens, `terrain.jpg`, `bh.js` = 1 in 5 of the station index projected onto the terrain, `qr.svg`, `features.mp4`).
- `videos/feature-video/` — HyperFrames project (CLI pinned at 0.9.33): `compositions/title.html`, `demo.html`,
  `endcard.html`. Render: `renders/features.mp4` (122.8 s, 1080p30, silent on purpose).
- `videos/shots/record_app.py` — drives the **live** builder and records it with Chrome's own
  screencast, plus `rec/events.json` (mouse, clicks, chapters, on-screen panel boxes).
  `videos/shots/gen_demo.py` bakes that log into `demo.html` (camera, cursor, labels).
  To re-record: run record_app.py, re-encode `rec/rec.mp4` with tpad (see the DEVLOG entry),
  copy it to `feature-video/assets/`, run gen_demo.py, then check and render.
- `.claude/launch.json` (gitignored): `presentation` preview server on port 5520.
- Docs (tracked; the auto-push hook commits them): `docs/DEVLOG.md` entries 22:40, 23:50 and 00:00;
  `docs/DECISIONS.md` ADR-17 (an offline HTML deck, not a slides product).

## Deploy / run state
- No site changes. The deck and video were verified in the browser pane: every slide renders,
  and the video loads (1920 wide, 122.8 s), plays and pauses.
- Not verified: the real projector, the clicker, and running with Wi-Fi off.
- Figures on the slides were checked live on 7–11 Nov 2026: CSDI WFS 331,223 stations;
  GI_AGS.zip 637 MB (updated 3 Nov); CSDI catalogue 1,163 records; 35,326 of the 80,000
  indexed stations have AGS.

## Open questions / waiting on user
1. Felix to review the deck and video, and send comments.
2. **Add 3D** to the deck (slide 13 currently says "3D block builder — in progress") and to the
   video once he says 3D is finished. Note: commit ef6cbc0 merged the 3D builder into the
   2D builder's tabs, and the recording shows the 3D tabs as "Coming soon".
3. The site index holds only the first 80,000 of the 331,223 stations. **Felix chose not to fix it.**
   The speaker notes for slide 5 have a line ready in case anyone asks.
4. Loading AGS logs from the map still depends on the Hugging Face helper (no CORS from CEDD's
   server). It did not respond on 7 Nov. Don't demo that step live.
5. While this note was written, another session had uncommitted 3D changes in
   `web/block3d.js`, `web/builder3d.*` and `web/test_block3d.mjs`. They are **not** from this session.

## Good first moves
- `python -m http.server 5520 -d videos/presentation` (or the `presentation` launch entry), then open `#1`.
- For a video edit: change `gen_demo.py` or the compositions, run `npx hyperframes@0.9.33 check` in
  `videos/feature-video`, take snapshots, render to `renders/features.mp4`, then copy it to the deck's assets.
- Keep label text ≥ 28 px (the check's type floor). Keep the film silent unless Felix asks for sound.

## Related sessions
- [c779fc23 — 3D white model / LiDAR](2026-11-11_c779fc23_white-model-lidar.md): the 3D work the deck is waiting on.
