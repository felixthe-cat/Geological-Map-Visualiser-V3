# Plan — geotechnical data features (SPT, rock quality, strength tests, reporting)

> Status: **plan only, nothing built.** This roadmap was previously parked at the user's
> request; this document is the design work for when it resumes.
>
> Two goals govern every decision below:
> **(1)** help the user carry out foundation design, and
> **(2)** help the user compile a report on the geotechnical condition of their site.

## 0. The governing principle

> **The app presents measurements. The engineer derives parameters.**

Every feature here is a *data presentation* feature. None of them produce a design value.
This is not timidity — it is what makes the tool usable on a real submission. A tool that
prints "φ′ = 34°" has made an engineering judgement it cannot justify, cannot caveat, and
cannot be held to. A tool that prints the four triaxial tests that value would have come
from is something an engineer can actually cite.

Three rules follow, and they apply throughout:

1. **Never interpolate a point measurement between boreholes.** SPT N, RQD and triaxial
   results are properties of a specific spot in a variable material. The existing strata
   bands are interpolated because a *boundary* is a surface; a blow count is not.
2. **Never aggregate across a stratum without showing the spread.** If a mean is shown at
   all, the individual values and the count must be shown next to it.
3. **Never silently normalise.** No energy correction, no overburden correction, no
   peak-vs-critical-state assumption. Show what was measured, label it precisely, and let
   the user apply their own corrections.

## 1. Data availability (measured across 60 random CEDD reports)

| AGS group | Contents | Reports containing it |
|---|---|---|
| `GEOL` | stratigraphy | ~100% (already used) |
| `CORE` | TCR / SCR / **RQD** | **47%** |
| `TRIG` | c′ / φ′ / cᵤ triaxial | 37% |
| `CLSS` | classification / Atterberg | 37% |
| `GRAD` | particle size | 33% |
| `ISPT` | **SPT N** | 30% |
| `POBS` | groundwater observations | 25% |

Two things worth noting before sequencing the work:

- **`CORE` is the most available quantitative dataset, not `ISPT`.** RQD is also directly
  required for rock socket design under GEO Publication 1/2006. It deserves to be in the
  first phase alongside SPT, not after it.
- Everything here comes from **one** backend change (§7), so the marginal cost of each
  additional group is small once the first lands.

## 2. Feature A — SPT N-value track

**Why it matters:** N is the parameter GEO Publication 1/2006 *Foundation Design and
Construction* and BD's *Code of Practice for Foundations* actually use for pile design in
saprolites (CDG/CDV). For most HK sites it is the single most decision-relevant number in
the ground investigation.

### On the borehole log
A narrow track beside the strata column: N on the x-axis (0–100+, log or clipped linear),
depth on the y-axis, one marker per test. Markers coloured by the stratum they fall in, so
the correlation between grade and N is visible at a glance.

### On the cross-section
Annotate N at each station — a small vertical scatter at the station's x position. **Do not
contour it, do not interpolate it, do not shade between stations.** The visual language
must make it obvious these are discrete points, unlike the strata bands behind them.

### The traps, and how to handle each

| Trap | Handling |
|---|---|
| **Raw N vs N₆₀** | Energy ratio (`ISPT_ENRG` where present) is usually absent. Label the axis **"SPT N (uncorrected, as reported)"**. If energy ratio *is* present, show it in the tooltip — never apply it. |
| **Overburden correction (C_N)** | A design choice, not a data property. Do not offer it. |
| **Refusal notation** | HK reports very commonly record `100/50mm`, `50/25mm` etc. in `ISPT_REP`. This is **refusal, not a number**. Parse it as a refusal marker and draw it as a distinct symbol (e.g. a right-pointing arrow at the axis limit) with the raw string in the tooltip. Never coerce to an integer — treating `100/50mm` as N=100 understates it and as N=50 is simply wrong. |
| **Seating vs main blows** | `ISPT_SEAT` + `ISPT_MAIN`. N is the main blows only. Where the split is available, show it in the tooltip so the user can audit our arithmetic. |
| **SPT vs SPT-C (cone)** | `ISPT_TYPE` distinguishes them. Cone results are **not** interchangeable with the standard split-spoon N. Different marker shape, and a filter to show/hide. |

*Field names above are AGS4; the AGS3 equivalents differ and must be verified against real
reports — the existing parser already handles both dialects and the same pattern applies.*

## 3. Feature B — rock quality (TCR / SCR / RQD)

**Why it matters:** RQD drives rock mass classification and rock socket capacity. It is
also the most widely available quantitative dataset (47%). It pairs naturally with the
existing rockhead work in the Rock Contour tab.

- A second track on the log: TCR / SCR / RQD as stacked or overlaid percentage bars per
  core run (`CORE_TOP`→`CORE_BOT`, `CORE_PREC` / `CORE_SREC` / `CORE_RQD`).
- Because these are *run averages over an interval*, not point values, they should be drawn
  as **bars spanning the run**, never as a point-and-line series. The visual difference
  from the SPT track is deliberate and meaningful.
- Optional: annotate the existing rockhead contour with the RQD of the first run below
  rockhead — high value for foundation design, near-zero extra work once parsed.
- Caveat to surface: RQD depends on core diameter and drilling quality. Show `CORE_DIAM`.

## 4. Feature C — φ′ / c′ as a *test register*, not design parameters

This is the feature with the greatest potential to do harm, and the design must reflect
that.

**The data reality:** `TRIG` appears in ~37% of reports but is *sparse within* them —
roughly 37 tests against thousands of `GEOL` rows. Values are test-condition dependent
(`TRIG_TYPE`, `TRIG_COND`: CU/CD/UU), and AGS does not reliably record peak vs critical
state, nor the stress range tested.

**Therefore — build this:**

- A **table** of tests: depth · stratum · grade · test type · condition · cᵤ / c′ / φ′ ·
  cell pressure. Sortable, filterable by stratum, exportable to CSV.
- Optionally a **φ′-vs-depth scatter coloured by grade**, which is genuinely useful for
  spotting whether a horizon behaves consistently.

**Explicitly do not build:**

- ❌ Auto-averaging per stratum
- ❌ Spatial interpolation of strength
- ❌ A pre-filled "design parameter" box
- ❌ Any single headline number per stratum

> Averaging four triaxials across a CDG horizon and printing "φ′ = 34°" would be the most
> dangerous feature in the app. It hides the test conditions, the sample count, the scatter
> and the depth range behind a number that looks authoritative and is not.

If a summary is ever added, it must be `n`, range, and the individual points — never a
lone central value.

## 5. Feature D — groundwater (`POBS`)

Lowest availability (25%) but disproportionately important: groundwater level governs
effective stress and therefore almost every foundation calculation.

- Piezometer readings are a **time series**, not a single level. Show the range observed
  and the reading dates; never a single "the water table is at X".
- Distinguish water *strikes during drilling* (a transient observation) from *piezometer
  readings* (a monitored level). These are routinely conflated and they mean different
  things.
- On the section, a dashed line per station rather than a continuous interpolated water
  table — same discipline as SPT.

## 6. Feature E — data completeness panel

Cheap, and it sets honest expectations before the user invests time. Per loaded site:
percentage of holes carrying SPT / CORE / TRIG / POBS / CLSS / GRAD, with counts.

Two functions:
1. Tells the user immediately whether this site can support the analysis they have in mind.
2. Explains empty tracks, pre-empting "why is the SPT panel blank" — the answer is the data
   does not exist, not that the tool is broken.

Roughly an hour's work once the parser returns the groups. Should ship **in the same phase
as the first data feature**, not after — it is what makes a sparse result legible instead
of looking like a bug.

## 7. Backend change — the shared prerequisite

Currently `src/ags_open_data.py` dispatches only `LOCA`/`HOLE`, `GEOL` and `WETH`
(see the group dispatch around `src/ags_open_data.py:495`). Every feature above needs the
same one change: extend that dispatch to also collect `ISPT`, `CORE`, `TRIG`, `POBS`
(and later `CLSS`, `GRAD`), and return them keyed by hole id.

Notes:
- The AGS3/AGS4 dialect handling and `<CONT>` continuation logic already exist and should
  be reused, not duplicated.
- Keep the raw reported strings alongside parsed numbers (essential for SPT refusal, and
  good practice everywhere else).
- This enlarges the `fetch_stratigraphy` payload. Consider returning the extra groups only
  on request so existing loads do not get slower.
- **`src/ingest_ags.py` remains a separate, stale parser** (known gap #5 in the handover) —
  decide whether to converge them before adding more divergence.

## 8. Feature F — report output (PDF)

This is what turns the tool from a viewer into something that goes into a submission, and
it is the feature that most directly serves goal (2).

- **Multi-borehole log sheets** and a **cross-section**, at **A3/A4**, as **PDF** — vector,
  not a rasterised PNG dropped into a page.
- **Title block** (project, site, drawn/checked, date, revision), **scale bar**, **north
  arrow**, **legend**, sheet numbering.
- **True scale.** A section at "1:500 H, 1:100 V" must actually measure correctly on paper.
  This is the difference between a picture and a drawing, and it is a hard requirement for
  submission use.
- Data provenance block: CEDD report numbers, AGS file dates, and — once terrain lands —
  the LandsD DTM attribution (see `PLAN_TERRAIN_PROFILE.md` §7.6).
- Should state clearly what is *measured* vs *interpolated* — with the offset disclosure
  already built (commit `28ebb25`) and the terrain work planned, the drawing has real
  provenance to show.

Implementation note: the existing exports build SVG (`el()` in `web/builder.js`), which is
already vector. A vector SVG→PDF path (e.g. `svg2pdf.js` + `jsPDF`, lazily loaded like the
other deps) preserves that, whereas canvas rasterisation throws it away. Worth prototyping
before committing to a library.

## 9. Suggested sequencing

| Phase | Contents | Rationale |
|---|---|---|
| **1** | Backend group parsing (§7) + **completeness panel** (§6) | One change unlocks everything; the panel makes sparse data legible immediately and is verifiable on its own. |
| **2** | **SPT track** (§2) + **RQD track** (§3) | The two highest-value, highest-availability datasets for foundation design. Same rendering pattern, so the second is cheap after the first. |
| **3** | **Triaxial register** (§4) + **groundwater** (§5) | Table-based, lower risk, and benefits from the display conventions established in phase 2. |
| **4** | **PDF report output** (§8) | Wants the other content to exist first, so the sheets have something to carry. |

Terrain (`PLAN_TERRAIN_PROFILE.md`) is independent of all of this and can proceed in
parallel — it touches the section's *surface*, these features touch its *contents*.

## 10. Testing expectations

Consistent with the existing Node self-check convention (`web/test_*.mjs`):

- **SPT refusal parsing** needs its own test with real HK notation (`100/50mm`, `50/25mm`,
  `>100`, blank, and a plain integer). This is the highest-risk parsing in the whole plan.
- **Unit/dialect handling** across AGS3 and AGS4 fixtures.
- A test asserting **no interpolation** occurs for point measurements — i.e. the number of
  rendered SPT markers equals the number of tests, at exactly the station x-positions.
- The completeness panel percentages against a fixture with known gaps.

## 11. Open questions for the user

1. **Which comes first — terrain or this roadmap?** They are independent; terrain has a
   confirmed data source and a smaller blast radius.
2. **Is PDF output wanted at A3, A4, or both?** Affects the layout engine choice.
3. **Should the triaxial register be admin-gated initially**, given the misuse risk, until
   the presentation has been reviewed by someone who signs off on foundation designs?
4. **Converge `ingest_ags.py` with `ags_open_data.py`** before or after this work?
