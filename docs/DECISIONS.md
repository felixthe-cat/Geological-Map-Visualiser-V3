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
