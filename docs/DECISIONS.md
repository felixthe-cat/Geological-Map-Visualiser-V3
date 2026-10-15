# DECISIONS

Architecture decision records. Append only.

---

### ADR-1: Correct the section ground surface by each borehole's own DTM difference, not by forcing it through the collar

**Context**
A borehole is rarely on the section line; it is projected onto it. The existing
`correctedProfile()` made the drawn ground line pass exactly through every surveyed collar
level. For an off-line borehole that pins the ground *on the line* to a level measured
*somewhere else* — comparing two different points of ground.

**Options considered**
1. *Keep forcing the line through each collar.* Reassuring — the ground line always meets the
   log rectangle. But the further off-line a borehole sits, the more it drags the on-line
   surface to an elevation that was never measured there. On the test site this moved the
   surface by up to 6.5 m.
2. *Correct by the local DTM difference* (`offsetCorrectedProfile`). Take
   `collarGL − DTM(at that borehole's true position)`, interpolate that difference along the
   line, add it to the DTM sampled on the line. Drawback: the ground line no longer touches
   an off-line borehole's collar, which looks wrong until the reason is understood.
3. *Raw DTM, no correction.* Honest terrain shape, but carries the model's datum bias and
   vegetation canopy, and disagrees with every surveyed level.

**Chosen + why**
Option 2, and as of 2026-09-10 it is the default. The difference is a property of the
*terrain model's error at that spot* (datum bias, canopy, survey-vs-model), which travels to
nearby ground; the elevation itself does not. Option 1's gap is not a discrepancy to hide —
it is real information, so the on-screen note states the maximum gap explicitly and the log
rectangle stays at the true surveyed level. Options 1 and 3 are retained as selectable modes
so the three can be compared on any site.

**Reversible?** Cheap — one `<option selected>` and a fallback string.

---

### ADR-2: Store annotation rectangles as four corner points, not centre/size/rotation

**Context**
Proposed-structure outlines on the cross-section must be both draggable and typeable to exact
coordinates, in chainage (m from A) and level (mPD).

**Options considered**
1. *Store `{centre, width, height, angle}`.* Compact, and rotation is trivial. But the user
   asked to type the four corners directly — which would need an inverse solve on every
   keystroke, and any quadrilateral that is not a true rectangle cannot be represented at all.
2. *Store four corner points.* Typing a corner is a direct write, dragging is four additions,
   and a corner nudged off-square simply stays where it was put. Drawback: rotation is no
   longer a stored field, so the rotate box has to be derived from the points each render.

**Chosen + why**
Option 2. Centre/width/height/rotation survives as a one-way helper that *writes into* the
corners, so both entry styles work and the typed corners are always authoritative. Deriving
the rotate box back out is four lines of trigonometry.

**Reversible?** Costly once projects are saved — the corner array is in the saved file format.

---

### ADR-3: Extend the existing `#GEOVIS` project header rather than add a settings format

**Context**
Saving "the entire project setting" meant persisting the cross-section option controls, the
manually deselected boreholes and the annotations — none of which are borehole data.

**Options considered**
1. *A second file / second database column for settings.* Clean separation. But the cloud
   save already reuses the project-CSV blob verbatim, so a second format means a second
   writer, a second parser and a second thing to keep in sync with it.
2. *Extend the `#GEOVIS` JSON header to `v:2` with `section`, `excluded`, `annots`.* One
   format, one round-trip test, and the cloud path inherits it for free. Drawback: the header
   line grows, and a v2 file opened by an older build would silently drop the new keys.

**Chosen + why**
Option 2. The parser already tolerates missing keys (v1 and legacy 7-column files return
`null` for all three), so the compatibility risk runs one way only and is covered by a test.

**Reversible?** Cheap — additive keys; older readers ignore them.

---

### ADR-4: A dedicated sign-in page, rather than a sign-in card inside the projects page

**Context**
`account.html` already contained a working signed-out state: a card with a "Sign in with
Google" button. The ask was for a Google auth page modelled on the IFU app's login screen,
which is a full-viewport layout (hero panel + content sheet), not a card in a list page.

**Options considered**
1. *Restyle the existing card in `account.html`.* No new file, no new route, and the
   redirect plumbing already worked. But the IFU layout is full-bleed and vertically
   centred — dropping it inside a page that also has a site header, an `<h1>`, an
   explanatory paragraph and a project list would either break that page's structure or
   water the design down to something that is not really the template asked for. It also
   leaves the sign-in screen reachable only via a page whose whole purpose assumes you are
   already signed in.
2. *A dedicated `web/login.html`.* Matches the template properly, is linkable from the
   landing nav and from anywhere else later, and takes a `?next=` destination so any page
   can send a visitor to sign in and get them back. Drawback: a second file that has to
   stay visually in step with the rest of the site, and a second place auth can break.

**Chosen + why**
Option 2 — but with the duplication removed rather than accepted: `account.html`'s own
sign-in card was **deleted**, and it now redirects signed-out visitors to `login.html`.
So the count of sign-in screens stayed at one; it just moved to a page shaped for the job.
That is what makes option 2's main drawback not apply.

**Reversible?** Cheap — the page is self-contained and the only inbound links are the
landing nav and one redirect in `account.html`.

---

### ADR-5: One dataset picker for built-in examples and the user's own saved projects

**Context**
Before this change the borehole panel had two lists doing nearly the same job: an
"Example dataset" dropdown with a Load button, and a separate "My account" block with its
own dropdown, Open, Save and Save-over buttons. The ask was to let users save their own
work "as one of the examples … to choose and load next time".

**Options considered**
1. *Keep them separate, add save/rename/delete to the account block.* Smallest diff, and
   the two lists stay independently stylable. But the user then has to know which of two
   dropdowns holds the thing they want, and the two Load paths drift — they already had
   slightly different status messages and neither reset the other's state.
2. *One picker, two groups.* Values namespaced `ex:<id>` / `cloud:<uuid>`, rendered as
   `<optgroup>`s. One Load button, one code path, one status line. Cost: the picker has to
   cope with the two sources resolving asynchronously in either order.

**Chosen + why**
Option 2. What makes it cheap is that a built-in example and a saved dataset are *already
the same artefact* — both are a project CSV produced by `project_csv.js`, the format
`test_project_csv.mjs` guards. There was never a reason for two loaders; there were two
only because the cloud feature was added later, beside the examples instead of into them.
Merging removed four controls rather than adding any.

The async ordering was handled explicitly rather than by luck: whichever of the two
finishes second must not steal the selection from the first (see the `hadSelection` guard
in `builder.js`).

**Reversible?** Yes, but it would mean re-adding the removed controls. The namespaced
values are the only thing another caller would depend on.

---

### ADR-6: Ground-surface correction uses every borehole on the site, spread by inverse-distance weighting

**Context**
ADR-1's `dtm-offset` surface interpolated the collar-vs-DTM difference along the line between
the boreholes *in the section*. Widening the distance tolerance pulled in more boreholes and
so changed the ground line — the terrain shouldn't depend on which logs are drawn.

**Options considered**
1. *One site-wide constant* (median difference). Perfectly stable, but ignores local canopy /
   platform effects; an on-line borehole no longer meets the ground line.
2. *Inverse-distance weighting in plan over all boreholes* (`idwDelta`). Stable, keeps local
   variation, exact at a borehole on the line. Chosen.
3. *Kriging / fitted trend surface.* Smoother with an error estimate, but a lot of machinery
   for sites of tens of holes.
4. *Fixed calibration radius around the line.* Still depends on where the line is drawn.

**Decision**
Option 2. Deselected boreholes and holes outside the corridor still contribute: the ground is a
property of the site, not of the drawing.

**Consequences**
DTM tiles are now fetched for every borehole position, not just those in the section.
`offsetCorrectedProfile` is kept (tested) but unused.

**Reversible?** Cheap — one function call in `renderSection`; the old along-line version is still in `terrain.js`.

---

### ADR-7: Export the section to SLOPE/W and PLAXIS as one DXF file

**Context**
Users want the drawn geological section inside GeoStudio SLOPE/W and PLAXIS 2D without
redrawing it. The site is a static browser app: it can only hand over a file.

**Options considered**
1. *Native project files.* A GeoStudio `.gsz` is a zip of XML, but a hand-built one can't be
   solved (no mesh — Geostudio Automation error-book #6). A PLAXIS `.p2dx` is binary, so it can't
   be written from a browser.
2. *Scripts that rebuild the model* (gsi / plxscripting). They carry materials too, but need
   Python, licences and the remote-scripting setup on the user's PC.
3. *DXF.* Both programs import it natively; no script needed. But no materials are carried.
   Chosen.
4. *1:1 PNG for tracing.* Works everywhere, but every boundary has to be redrawn by hand.

**Chosen + why**
DXF R12, one closed polyline per band, metres. It's the only format both programs read with no
setup. PLAXIS import was proven (15/15 polygons, meshed).

**Reversible?** Cheap — one self-contained module (`cad_export.js`). Scripts (option 2) can be
added later alongside it.

### ADR-8: Thin far-off holes with a "nearer hole wins" rule, not distance weighting

**Context**
The distance tolerance is a yes/no corridor. Widening it puts a hole 80 m off the line on equal
footing with one on the line, and straight lines between them zig-zag the horizons.

**Options considered**
1. *Nearer hole wins.* Drop a hole when its foot on the line is closer to a nearer, kept hole
   than to the hole itself. Drawback: an all-or-nothing choice — a dropped hole contributes
   nothing, even where it would agree with its neighbours.
2. *Inverse-distance weighting by true 2D distance.* Every point is a blend. Drawback: an
   off-line hole is no longer honoured, and the drawn logs stop matching the horizons.
3. *Slice a plan-view surface* (grid interpolation, as for rockhead contours). Drawback: the
   section becomes a model output that is hard to defend on a drawing.

**Chosen + why**
Option 1. It keeps the existing practice: real logs, straight lines between them. It needs no
new parameter, and the tolerance becomes a safe ceiling. A checkbox turns it off.

**Reversible?** Cheap — one checkbox, saved per project.


### ADR-9: Stream the LandsD 3D photo-mesh live in the 3D Block builder, not a baked copy

**Context**
The 3D Block builder needs the Lands Department 3D Visualisation Map as its ground skin, for
any site in Hong Kong. Infographic-Production baked a 520 m square of it offline.

**Options considered**
1. *Stream the Cesium 3D Tiles live* (`3d-tiles-renderer` on three.js). Drawback: the page
   depends on a government server, and depends on that server keeping its key-free, CORS-open
   access (checked 2026-10-15: no key needed, and our origin is allowed).
2. *Bake per site offline* (Infographic-Production's crawler). Drawback: it only works for
   sites someone has pre-processed, so it can't work for a site drawn in the browser.
3. *A server-side relay that holds a key.* Drawback: a moving part that turned out to be
   unnecessary, and it pays for all the tile traffic.

**Chosen + why**
Option 1. It is the only one that works for any site, and nothing has to run on our side.
Two quirks needed fixes. Tile names contain `+`, which must be sent as `%2B`. Textures are
KTX2 images without the `KHR_texture_basisu` tag, so a small glTF plugin routes them to the
KTX2 loader.

**Reversible?** Cheap — the mesh is one optional layer (`ensureTiles()` in `builder3d.js`).
If LandsD adds a key, put a relay in `web/api/`.

### ADR-10: The 3D block uses the 2D section's layer rules, with IDW across the plan

**Context**
The 3D block and the 2D cross-section must agree. Otherwise one of them is wrong on a drawing.

**Options considered**
1. *Reuse the 2D rules.* Global stratum order, horizons that only step down, and
   "ground, then each thickness ≥ 0". Spread across the plan by inverse-distance weighting
   (IDW, an average weighted by closeness). Drawback: IDW makes bullseyes around isolated
   holes and gives no error estimate.
2. *Implicit modelling (GemPy).* Drawback: it needs the Python backend, which the user has
   stopped, and its surfaces don't honour the logs exactly.
3. *Kriging.* Drawback: a fitted variogram per layer is not defensible with 4–20 holes.

**Chosen + why**
Option 1. It honours every log exactly at the hole (checked: DH 3 matches its log to the cm).
A missing stratum pinches out instead of inverting. The deepest stratum is carried down to the
block base.

**Reversible?** Cheap — swap the interpolator inside `makeModel()` in `block3d.js`.
