# DEVLOG

Newest entry at the top. Append only — never rewrite or reorder earlier entries.

---

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
