# AGS → Decomposition-Grade Classification

How the site map's "Load into 2D Builder" turns raw CEDD **AGS** ground-investigation
files into clean stratum names **and** a GeoGuide 3 decomposition grade for every layer.

All of this logic lives in [`src/ags_open_data.py`](../src/ags_open_data.py)
(`classify_layer`, `guess_bare_grade`, and the WETH join inside `parse_ags_any`).

---

## 1. Where the data comes from

The CEDD GEO Open Data archive `GI_AGS.zip` is a ZIP-of-ZIPs — one inner zip per
report (`REPNO`), each containing one or more `.ags` files (AGS3 or AGS4). Each
`.ags` file is a set of **groups** (tables). We read three of them:

| Group | What it gives us |
|-------|------------------|
| `LOCA` / `HOLE` | borehole location (easting `NATE`, northing `NATN`, ground level `GL`) |
| `GEOL` | the stratigraphy: each row is a layer with `GEOL_TOP`, `GEOL_BASE`, and material fields |
| `WETH` | weathering grade by depth (`WETH_TOP`, `WETH_BASE`, `WETH_GRAD`) — authoritative grade |

The material fields on a `GEOL` row, in order of usefulness:

| Field | Meaning | Reliability for grade |
|-------|---------|-----------------------|
| `GEOL_GEO2` | Origin / weathering-grade code (e.g. `CDG`, `HDG`, `FILL`, `MADC`) | **Authoritative** when present |
| `GEOL_DESC` | Free-text description ("completely decomposed GRANITE", "(ALLUVIUM)") | **Reliable** – the grade/origin is stated in words |
| `GEOL_LEG` | Grading code (`SANDZG`, `SILTCS`, `GRANITE`) — grain-size fabric only | Weak – same code appears at many grades |
| `GEOL_GEOL` | Stratum era: `Q` = Quaternary (superficial soil), `L` = in-situ (weathered rock) | Context only |

> **Why `GEOL_LEG` alone is not enough** — `SANDZG` (silty sandy) shows up as
> completely-decomposed granite in one row and as alluvium in the next. The grade
> lives in `GEOL_GEO2` or the description, not the grading code.

---

## 2. The decomposition grades (GeoGuide 3, Table 4)

| Grade | Term | Rock tag (granite) |
|:-----:|------|--------------------|
| **VI** | Residual Soil | RS |
| **V**  | Completely Decomposed | CDG |
| **IV** | Highly Decomposed | HDG |
| **III**| Moderately Decomposed | MDG |
| **II** | Slightly Decomposed | SDG |
| **I**  | Fresh | — |

The tag's last letter is the lithology: `G` granite, `T` tuff, `QZ` quartzite,
`R` rhyolite / unknown rock, etc. So `IV (HDT)` = Highly Decomposed Tuff.

**Allowed non-grade materials** (transported soils, made ground, and drilling
artefacts — these legitimately have *no* rock decomposition grade):

`Fill` · `Made Ground (Concrete)` · `Made Ground (Asphalt)` · `Alluvium` ·
`Marine Deposit` · `Colluvium` · `Topsoil` · `Superficial Deposit` ·
`Residual Soil` (= Grade VI) · `No Recovery` · `Wash Boring`

Everything **else** must resolve to a grade I–VI.

---

## 3. The conversion / decision order

For each `GEOL` row we take the **first** signal that resolves, in this order:

1. **`GEOL_GEO2` grade code** — `CD`/`HD`/`MD`/`SD` + rock suffix →
   `CDG`=V, `HDG`=IV, `MDG`=III, `SDG`=II (and `…T` tuff, `…QZ` quartzite …).
   Bare rock code (e.g. `G`) → Fresh (I).
2. **`GEOL_GEO2` origin code** — `FILL`→Fill, `RS`→Residual Soil (VI),
   `MD`/`MAD…`→Marine Deposit, `ALL…`→Alluvium, `COL`→Colluvium.
3. **Description decomposition word** — "completely / highly / moderately /
   slightly decomposed" (+ lithology word) → V / IV / III / II. "residual soil" → VI.
   (Earliest-mentioned wins; the misspelling "completley" is handled.)
4. **Description special / origin markers** — "topsoil"→Topsoil, "shell"/"marine"→Marine
   Deposit, "asphalt"/"concrete"/"shotcrete"→Made Ground, "brick"/"rubble"/"(fill"→Fill,
   "diamict"→Superficial Deposit, "alluvi…"→Alluvium, "colluvi…"→Colluvium.
5. **Rock strength term** (when the description names a rock but omits "decomposed") —
   BS 5930 / GEO strength → grade:

   | Strength term | Grade |
   |---------------|:-----:|
   | extremely weak | V |
   | very weak / weak | IV |
   | moderately weak / moderately strong | III |
   | strong | II |
   | very strong / extremely strong | I |

6. **`WETH` group** — if still ungraded and not an allowed soil, look up the
   `WETH_GRAD` (I–VI, or arabic 1–6) covering that layer's depth. *Authoritative.*
7. **Option A default** — a bare granular grading code (`SAND…`, `SILT…`, `CLAY…`,
   `GRAV…`, `CBBL…`, `BLDR…`) with **no** other signal defaults to **CDG (Grade V)**
   — the overwhelmingly likely case in Hong Kong weathered-granite terrain.
   A bare rock name with no grade → Fresh (I).
8. **`GEOL_GEOL = Q`** superficial with no other signal → `Superficial Deposit` (no grade).

Steps 6–8 are applied in `parse_ags_any` (they need the WETH group / whole record);
steps 1–5 are in `classify_layer`.

### Result on the sample site (reports 71936, 62076, 62077, 66636)

396 layers → **0** left as a raw code. Across a 60-report sweep (~3,800 layers) only
**1** row stays "Unclassified" (a genuine note row with no material at all).

---

## 4. Worked examples

| GEO2 | LEG | GEOL | DESC (excerpt) | → Stratum | Grade |
|------|-----|------|----------------|-----------|:-----:|
| `CDG` | `SANDZG` | L | — | Completely Decomposed Granite | V (CDG) |
| — | `SANDZG` | L | "completely decomposed … GRANITE" | Completely Decomposed Granite | V (CDG) |
| — | `SANDZ` | — | "extremely weak … GRANITE" | Completely Decomposed Granite | V (CDG) |
| — | `GRANITE` | L | "strong, pinkish grey GRANITE" | Slightly Decomposed Granite | II (SDG) |
| — | `SILTS` | Q | "sandy SILT. (TOPSOIL)" | Topsoil | — |
| — | `SANDZ` | — | "silty SAND. (DIAMICT DEPOSIT)" | Superficial Deposit | — |
| — | `BLANK` | — | — | No Recovery | — |
| — | `SANDZG` | L | *(no GEO2 / desc / WETH)* | Completely Decomposed Granite *(Option A default)* | V (CDG) |

---

## 5. Caveats

- **Option A is a heuristic.** Bare granular codes with no description/GEO2/WETH are
  *assumed* CDG. Correct for the vast majority of HK granite sites, but if you work a
  site on tuff or sediments, spot-check those layers.
- **"…Rock (Grade III)"** appears when the grade is known but the lithology word
  wrapped onto a description continuation line we couldn't recover — the **grade is
  still correct**, only the rock name is generic.
- The cross-section groups and colours by **grade numeral**, so `MDG` and `MDR`
  (both Grade III) share one band.
