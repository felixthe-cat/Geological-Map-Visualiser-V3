"""
src/ags_open_data.py
--------------------
On-demand stratigraphy fetch from the CEDD GEO Open Data AGS archive.

The archive is a single ~600 MB ZIP-of-ZIPs published monthly:

    https://www.ginfo.cedd.gov.hk/geoopendata/Data/GI/GI_AGS.zip
        GI_AGS/<REPNO>.zip
            <report>/<something>.ags        (AGS3 or AGS4)

Instead of downloading the whole thing, we read the ZIP central directory
once (~2.3 MB) to map REPNO -> byte offset, then HTTP-Range fetch just the
report(s) we need (a few KB each), unzip in memory and parse the LOCA/HOLE
(location) and GEOL (stratigraphy) groups.

REPNO is exactly the key already present in the CSDI borehole-location index,
and the AGS LOCA_ID / HOLE_ID equals the station id (statno) in that index —
so a borehole picked on the map maps straight to its logged strata.

Public API:
    get_stratigraphy(repnos) -> {repno: {station_id: {x,y,gl,layers:[{surface,top,base}]}}}
"""

from __future__ import annotations

import csv
import io
import zipfile
import zlib
from typing import Iterable

import requests

AGS_ZIP_URL = "https://www.ginfo.cedd.gov.hk/geoopendata/Data/GI/GI_AGS.zip"
REQUEST_TIMEOUT = 120

# module-level caches (per process)
_manifest: dict[str, tuple[int, int, int]] | None = None   # repno -> (offset, csize, method)
_manifest_tag: str | None = None                           # Last-Modified of the zip when built
_report_cache: dict[str, dict] = {}                        # repno -> parsed stratigraphy


# ── ZIP central-directory manifest ─────────────────────────────────────────

def _zip_version() -> tuple[int, str]:
    """HEAD the archive -> (total_size, last_modified_tag)."""
    r = requests.head(AGS_ZIP_URL, timeout=REQUEST_TIMEOUT, allow_redirects=True)
    r.raise_for_status()
    return int(r.headers["Content-Length"]), r.headers.get("Last-Modified", "")


def _fetch_range(start: int, end: int) -> bytes:
    r = requests.get(AGS_ZIP_URL, headers={"Range": f"bytes={start}-{end}"}, timeout=REQUEST_TIMEOUT)
    r.raise_for_status()
    return r.content


def build_manifest(force: bool = False) -> dict[str, tuple[int, int, int]]:
    """Map REPNO -> (localHeaderOffset, compressedSize, method) from the ZIP
    central directory. Cached until the archive's Last-Modified changes."""
    global _manifest, _manifest_tag
    total, tag = _zip_version()
    if _manifest is not None and _manifest_tag == tag and not force:
        return _manifest

    # End Of Central Directory lives in the last bytes (no zip comment here)
    eocd_buf = _fetch_range(max(0, total - 65536), total - 1)
    e = eocd_buf.rfind(b"PK\x05\x06")
    if e < 0:
        raise RuntimeError("EOCD record not found in GI_AGS.zip tail")
    cd_size = int.from_bytes(eocd_buf[e + 12:e + 16], "little")
    cd_offset = int.from_bytes(eocd_buf[e + 16:e + 20], "little")

    cd = _fetch_range(cd_offset, cd_offset + cd_size - 1)
    manifest: dict[str, tuple[int, int, int]] = {}
    sig = b"PK\x01\x02"
    i = 0
    while True:
        j = cd.find(sig, i)
        if j < 0:
            break
        method = int.from_bytes(cd[j + 10:j + 12], "little")
        csize = int.from_bytes(cd[j + 20:j + 24], "little")
        fnlen = int.from_bytes(cd[j + 28:j + 30], "little")
        lho = int.from_bytes(cd[j + 42:j + 46], "little")
        name = cd[j + 46:j + 46 + fnlen].decode("utf-8", "replace")
        if name.lower().endswith(".zip"):
            repno = name.split("/")[-1][:-4]
            manifest[repno] = (lho, csize, method)
        i = j + 4

    _manifest, _manifest_tag = manifest, tag
    _report_cache.clear()
    return manifest


# ── per-report fetch + AGS parse ───────────────────────────────────────────

def _fetch_report_zip(repno: str, manifest: dict) -> zipfile.ZipFile:
    lho, csize, method = manifest[repno]
    # local file header (30 bytes) + name + extra, then csize bytes of data
    buf = _fetch_range(lho, lho + 30 + csize + 4096)
    if buf[:4] != b"PK\x03\x04":
        raise RuntimeError(f"bad local header for report {repno}")
    lfnlen = int.from_bytes(buf[26:28], "little")
    lexlen = int.from_bytes(buf[28:30], "little")
    start = 30 + lfnlen + lexlen
    comp = buf[start:start + csize]
    inner = zlib.decompress(comp, -15) if method == 8 else comp
    return zipfile.ZipFile(io.BytesIO(inner))


# ── geotechnical classification ────────────────────────────────────────────
# AGS's GEOL_LEG is a *grading* code (e.g. "SANDCZG" = clayey silty sandy
# GRAVEL) — it says nothing about origin or weathering grade, so the same
# material (e.g. Completely Decomposed Granite) ends up split across many
# differently-named grading variants (SANDZG, GRAV, GRANITE, ...).
#
# GEOL_GEO2 is the actual origin / weathering-grade code used in HK GEO
# practice (verified against real CEDD AGS files): FILL, COL(luvium),
# ALL+suffix (Alluvium), RS (Residual Soil), MD (Marine Deposit, exact),
# and <grade prefix><rock suffix> for rock, e.g. CDG/HDG/MDG/SDG (granite),
# CDT/HDT/MDT/SDT (tuff), SDQZ (quartzite). We classify GEOL_GEO2 into a
# clean, ungraded label and use it in preference to GEOL_LEG.
_ORIGIN_EXACT = {
    "FILL": "Fill", "ASPHALT": "Made Ground (Asphalt)", "CONCRETE": "Made Ground (Concrete)",
    "COL": "Colluvium", "COLLUVIUM": "Colluvium",
    "RS": "Residual Soil", "RESIDUAL": "Residual Soil",
    "MD": "Marine Deposit", "MARINE": "Marine Deposit",
}
_GRADE_PREFIX = {  # 2-letter weathering-grade prefix -> (grade numeral, label)
    "CD": ("V", "Completely Decomposed"),
    "HD": ("IV", "Highly Decomposed"),
    "MD": ("III", "Moderately Decomposed"),   # only used when a rock suffix follows; bare "MD" = Marine Deposit
    "SD": ("II", "Slightly Decomposed"),
}
_ROCK_SUFFIX = {"G": "Granite", "T": "Tuff", "QZ": "Quartzite", "V": "Volcanics", "M": "Metasediment", "R": "Rock"}


def classify_geo2(code: str | None) -> str | None:
    """Map a GEOL_GEO2 origin/weathering code to a clean group label, or
    None if the code is empty/unrecognised (caller should fall back)."""
    if not code:
        return None
    c = code.strip().upper()
    if not c:
        return None
    if c in _ORIGIN_EXACT:
        return _ORIGIN_EXACT[c]
    if c.startswith("ALL"):                      # ALLG, ALLS, ALL... -> Alluvium (drop grading suffix)
        return "Alluvium"
    if c.startswith("MAD"):                      # MADC etc. -> Marine Deposit (verified: "MADC" = disturbed Marine Deposit Clay)
        return "Marine Deposit"
    if len(c) > 2 and c[:2] in _GRADE_PREFIX:     # CDG, HDT, SDQZ, ...
        grade, label = _GRADE_PREFIX[c[:2]]
        rock = _ROCK_SUFFIX.get(c[2:], c[2:].title())
        return f"{label} {rock} (Grade {grade})"
    if c in _ROCK_SUFFIX:                         # bare rock code with no grade prefix -> fresh rock
        return f"Fresh {_ROCK_SUFFIX[c]} (Grade I)"
    return None


def classify_surface(geo2: str | None, leg: str | None, geol: str | None) -> str:
    """Best available classified label for one GEOL row: prefer a recognised
    GEOL_GEO2 origin/grade code, then the raw GEO2 code as-is, then fall
    back to the grading-only GEOL_LEG/GEOL_GEOL code."""
    classified = classify_geo2(geo2)
    if classified:
        return classified
    if geo2 and geo2.strip():
        return geo2.strip()
    return (leg or geol or "").strip()


# ── decomposition grade (GeoGuide 3, Table 4) ───────────────────────────────
# GEOL_GEO2 is often blank in older AGS3 reports, but the material description
# (GEOL_DESC) reliably states the weathering/decomposition grade in words —
# "completely decomposed GRANITE", "highly decomposed", "(ALLUVIUM)" etc. We
# read the description when GEO2 is missing so the same grading code (SANDZG,
# SILTCS…) is correctly split into its real grade/origin. We return BOTH a
# clean material name AND a grade tag; transported soils get no rock grade.
_DESC_DECOMP = [                    # priority by earliest mention in the text
    ("residual soil",        "VI"),
    ("completely decomposed", "V"),
    ("highly decomposed",    "IV"),
    ("moderately decomposed", "III"),
    ("slightly decomposed",  "II"),
]
_DESC_ROCK = [("granite", "Granite"), ("tuff", "Tuff"), ("rhyolite", "Rhyolite"),
              ("volcanic", "Volcanics"), ("quartz", "Quartzite"), ("sandstone", "Sandstone"),
              ("siltstone", "Siltstone"), ("mudstone", "Mudstone"), ("marble", "Marble"),
              ("breccia", "Breccia")]
_DESC_ORIGIN = [("marine", "Marine Deposit"), ("alluvi", "Alluvium"), ("colluvi", "Colluvium")]
_ROCK_LETTER = {"Granite": "G", "Tuff": "T", "Quartzite": "QZ", "Volcanics": "V",
                "Rhyolite": "R", "Sandstone": "SS", "Siltstone": "SLT", "Mudstone": "MD",
                "Marble": "MB", "Breccia": "BR", "Syenite": "SY", "Rock": "R"}
_DECOMP_LABEL = {"V": "Completely Decomposed", "IV": "Highly Decomposed",
                 "III": "Moderately Decomposed", "II": "Slightly Decomposed"}
_DECOMP_PREFIX = {"V": "C", "IV": "H", "III": "M", "II": "S"}

# Rock-material strength terms (GEO/BS5930) → decomposition grade, used only
# when the description names a rock but omits the "… decomposed" phrase.
# Most-specific first so "extremely weak" beats "weak", etc.
_DESC_STRENGTH = [
    ("extremely weak", "V"), ("very weak", "IV"), ("moderately weak", "III"),
    ("moderately strong", "III"), ("extremely strong", "I"), ("very strong", "I"),
    ("weak", "IV"), ("strong", "II"),
]
# rock words extended for strength/lithology detection (superset of _DESC_ROCK)
_DESC_ROCK2 = _DESC_ROCK + [("syenite", "Syenite"), ("dolerite", "Dolerite"),
                            ("basalt", "Basalt"), ("schist", "Schist"), ("gneiss", "Gneiss")]
# Grading-code roots that denote a granular SOIL fabric (weathered-rock or
# superficial). A bare one of these with no other signal defaults to CDG (V).
_SOIL_ROOTS = ("SAND", "SILT", "CLAY", "GRAV", "CBBL", "BLDR")


def _grade_tag(roman: str, rock: str) -> str:
    if roman == "VI":
        return "VI (RS)"
    if roman == "I":
        return "I (Fresh)"
    return f"{roman} ({_DECOMP_PREFIX[roman]}D{_ROCK_LETTER.get(rock, 'R')})"


def _rock_in(desc: str) -> str:
    for kw, name in _DESC_ROCK2:
        if kw in desc:
            return name
    return "Rock"


def classify_layer(geo2, leg, geol, desc) -> tuple[str, str]:
    """Return (surface_label, grade_label) for one GEOL row.
    surface = clean material name; grade = GeoGuide 3 decomposition-grade tag
    (e.g. "V (CDG)", "IV (HDG)", "VI (RS)", "I (Fresh)") for weathered rock /
    residual soil, or "" for transported soils / made ground / special layers.

    Signal order: GEO2 code → description (decomposition word, then rock
    strength) → origin/made-ground/special markers → GEOL_GEOL='Q' superficial
    → option-A default (bare granular grading code → CDG Grade V)."""
    d = (desc or "").lower()
    g2 = (geo2 or "").strip().upper()
    geolc = (geol or "").strip().upper()      # GEOL_GEOL: 'Q'=Quaternary superficial, 'L'=in-situ

    # 1. Authoritative GEO2 rock-grade code (CDG/HDG/MDG/SDG/CDT/SDQZ…)
    if len(g2) > 2 and g2[:2] in _GRADE_PREFIX:
        roman, label = _GRADE_PREFIX[g2[:2]]
        rock = _ROCK_SUFFIX.get(g2[2:], g2[2:].title())
        return f"{label} {rock} (Grade {roman})", _grade_tag(roman, rock)
    if g2 in _ROCK_SUFFIX:                                  # bare rock code -> fresh
        return f"Fresh {_ROCK_SUFFIX[g2]} (Grade I)", "I (Fresh)"
    # 2. GEO2 origin codes
    if g2 in _ORIGIN_EXACT:
        surf = _ORIGIN_EXACT[g2]
        return surf, ("VI (RS)" if surf == "Residual Soil" else "")
    if g2.startswith("ALL"):
        return "Alluvium", ""
    if g2.startswith("MAD"):
        return "Marine Deposit", ""

    # 3. Description decomposition word (earliest-mentioned grade wins). Handle a
    #    common misspelling ("completley") seen in real logs.
    dd = d.replace("completley", "completely")
    pos, sel = None, None
    for kw, roman in _DESC_DECOMP:
        p = dd.find(kw)
        if p >= 0 and (pos is None or p < pos):
            pos, sel = p, roman
    if sel == "VI":
        rock = _rock_in(d)
        return (f"Residual Soil ({rock})" if rock != "Rock" else "Residual Soil"), "VI (RS)"
    if sel:
        rock = _rock_in(d)
        return f"{_DECOMP_LABEL[sel]} {rock} (Grade {sel})", _grade_tag(sel, rock)

    # 4. Special / made-ground / origin markers in the description
    if any(k in d for k in ("topsoil",)):
        return "Topsoil", ""
    if "shell" in d or "marine" in d:
        return "Marine Deposit", ""
    if "asphalt" in d:
        return "Made Ground (Asphalt)", ""
    if any(k in d for k in ("concrete", "shotcrete")):
        return "Made Ground (Concrete)", ""
    if any(k in d for k in ("brick", "rubble", "rubbish", "debris", "boulders (fill", "(fill")):
        return "Fill", ""
    if "diamict" in d:                       # poorly-sorted superficial deposit, not weathered rock
        return "Superficial Deposit", ""
    for kw, origin in _DESC_ORIGIN:
        if kw in d:
            return origin, ""

    # 5. Rock named in the description but no decomposition word → use strength
    rock = _rock_in(d)
    if rock != "Rock":
        for kw, roman in _DESC_STRENGTH:
            if kw in d:
                if roman == "I":
                    return f"Fresh {rock} (Grade I)", "I (Fresh)"
                return f"{_DECOMP_LABEL[roman]} {rock} (Grade {roman})", _grade_tag(roman, rock)
        if "fresh" in d:
            return f"Fresh {rock} (Grade I)", "I (Fresh)"

    # 6. Special GEOL_LEG markers (drilling artefacts, not strata)
    lg = (leg or "").strip().upper()
    if lg in ("BLANK", "NR", "NCR"):
        return "No Recovery", ""
    if lg in ("WASHING", "WASH") or "wash boring" in d:
        return "Wash Boring", ""
    if lg in ("SURFACE",):
        return "Made Ground (Concrete)", ""

    # 7. Recognised origin on GEOL_LEG / GEOL_GEOL
    lg2 = lg or geolc
    if lg2 in _ORIGIN_EXACT:
        surf = _ORIGIN_EXACT[lg2]
        return surf, ("VI (RS)" if surf == "Residual Soil" else "")

    # 8. Quaternary superficial deposit (GEOL_GEOL='Q') with no other signal —
    #    a transported soil, not weathered rock → no rock grade.
    if geolc == "Q":
        return "Superficial Deposit", ""

    # 9. nothing classified here — leave the raw code; the parser then tries the
    #    WETH grade for this depth, and only then the option-A guess (below).
    return ((leg or "").strip() or geolc or g2 or "Unclassified"), ""


def guess_bare_grade(leg, desc) -> tuple[str, str] | None:
    """Last-resort grade for a layer with a bare grading code and NO other
    signal (no GEO2, no description grade/strength, no WETH). Option A: in HK
    weathered-granite terrain a bare granular grading code is overwhelmingly
    completely decomposed granite → CDG (Grade V). A bare rock name → Fresh."""
    lg = (leg or "").strip().upper()
    if lg and lg[:4] in _SOIL_ROOTS:
        return "Completely Decomposed Granite (Grade V)", "V (CDG)"
    rock = _rock_in((desc or "").lower())
    if rock == "Rock" and lg[:4] in ("GRAN", "TUFF", "RHYO", "VOLC", "SYEN"):
        rock = {"GRAN": "Granite", "TUFF": "Tuff", "RHYO": "Rhyolite",
                "VOLC": "Volcanics", "SYEN": "Syenite"}[lg[:4]]
    if rock != "Rock":
        return f"Fresh {rock} (Grade I)", "I (Fresh)"
    return None


# Materials allowed to carry no decomposition grade (everything else must be graded).
_ALLOWED_NONGRADE = {"fill", "concrete", "asphalt", "marine deposit", "colluvium",
                     "alluvium", "made ground (concrete)", "made ground (asphalt)",
                     "made ground", "residual soil", "topsoil", "no recovery",
                     "wash boring", "superficial deposit"}
_ARABIC_ROMAN = {"1": "I", "2": "II", "3": "III", "4": "IV", "5": "V", "6": "VI"}


def _norm_roman(s: str | None) -> str:
    """Normalise a WETH_GRAD value ("V", "5", "IV/V", "V-VI"…) to a roman grade."""
    if not s:
        return ""
    t = str(s).strip().upper().replace("W", "")
    for sep in ("/", "-", " ", "TO"):
        if sep in t:
            t = t.split(sep)[0].strip()
    t = _ARABIC_ROMAN.get(t, t)
    return t if t in ("I", "II", "III", "IV", "V", "VI") else ""


def _grade_from_roman(roman: str, rock_hint: str | None) -> tuple[str, str]:
    rock = _rock_in((rock_hint or "").lower())
    if roman == "VI":
        return (f"Residual Soil ({rock})" if rock != "Rock" else "Residual Soil"), "VI (RS)"
    if roman == "I":
        return f"Fresh {rock} (Grade I)", "I (Fresh)"
    return f"{_DECOMP_LABEL[roman]} {rock} (Grade {roman})", _grade_tag(roman, rock)


def _weth_grade_at(intervals, top, base):
    """Weathering grade covering a GEOL layer, by the WETH interval containing
    the layer midpoint (else the one with the largest depth overlap)."""
    mid = (top + base) / 2
    for t, b, r in intervals:
        if t <= mid <= b:
            return r
    best, best_ov = "", 0.0
    for t, b, r in intervals:
        ov = min(base, b) - max(top, t)
        if ov > best_ov:
            best, best_ov = r, ov
    return best


def merge_consecutive_layers(layers: list[dict], eps: float = 0.05) -> list[dict]:
    """Collapse adjacent layers (already sorted by top) that share the same
    classified surface and are contiguous (small gap/overlap tolerated) —
    fixes AGS logs that record one material as many sample-interval rows."""
    if not layers:
        return layers
    out = [dict(layers[0])]
    for L in layers[1:]:
        prev = out[-1]
        if (L["surface"] == prev["surface"] and L.get("grade") == prev.get("grade")
                and abs(L["top"] - prev["base"]) <= eps):
            prev["base"] = max(prev["base"], L["base"])
        else:
            out.append(dict(L))
    return out


def _add_record(cur, head, row, loca, geol_raw, weth_raw):
    """Handle one DATA/data row. Returns the record dict when it belongs to a
    group that accepts <CONT> continuation (GEOL/WETH), else None."""
    if not head or not cur:
        return None
    rec = dict(zip(head, row))
    g = cur.upper()
    pid = (rec.get("LOCA_ID") or rec.get("HOLE_ID") or "").strip()
    if not pid:
        return None
    if g in ("LOCA", "HOLE"):                       # location group (AGS4 / AGS3)
        try:
            loca[pid] = (
                float(rec.get("LOCA_NATE") or rec.get("HOLE_NATE")),
                float(rec.get("LOCA_NATN") or rec.get("HOLE_NATN")),
                float(rec.get("LOCA_GL")  or rec.get("HOLE_GL")),
            )
        except (TypeError, ValueError):
            pass
        return None
    if g == "GEOL":                                 # stratigraphy group — classify later
        geol_raw.append(rec)
        return rec
    if g == "WETH":                                 # weathering-grade group (authoritative grade by depth)
        weth_raw.append(rec)
        return rec
    return None


def parse_ags_any(text: str):
    """Tolerant parser handling BOTH AGS4 (GROUP/HEADING/DATA) and AGS3
    (**GROUP / *HEADING / bare data rows). Returns (loca, geol):
        loca = {id: (nate, natn, gl)}
        geol = [(id, top, base, surface, grade), ...]

    AGS3 long text fields (esp. GEOL_DESC) wrap across <CONT> rows; we merge
    those back into the record so the description — which is where the
    decomposition grade & lithology actually live — is classified in full.
    """
    loca: dict[str, tuple] = {}
    geol_raw: list[dict] = []
    weth_raw: list[dict] = []
    cur = None
    head = None
    cont = None            # current GEOL/WETH record that <CONT> rows append to
    for row in csv.reader(io.StringIO(text)):
        if not row or all(c == "" for c in row):
            continue
        c0 = row[0].strip()
        # AGS4 markers
        if c0 == "GROUP":
            cur = row[1].strip() if len(row) > 1 else None
            head = None; cont = None
            continue
        if c0 == "HEADING":
            head = [h.strip() for h in row]
            continue
        if c0 in ("UNIT", "TYPE"):
            continue
        if c0 == "DATA":
            cont = _add_record(cur, head, row, loca, geol_raw, weth_raw)
            continue
        # AGS3 data-value continuation: append each non-empty cell to its column
        if c0.upper() == "<CONT>":
            if cont is not None and head:
                for i, cell in enumerate(row):
                    if i > 0 and i < len(head) and cell.strip():
                        k = head[i]
                        cont[k] = ((cont.get(k) or "") + " " + cell.strip()).strip()
            continue
        # AGS3 markers
        if c0.startswith("**"):
            cur = c0.lstrip("*").strip()
            head = None; cont = None
            continue
        if c0.startswith("*"):
            # AGS3 headings wrap across several lines when they exceed the format's
            # line-length limit — every wrapped line also starts with "*". Accumulate
            # them instead of overwriting, or the key columns (HOLE_ID, GEOL_TOP…)
            # on the first line get lost and the whole group fails to parse.
            cols = [h.lstrip("*?").strip() for h in row]
            head = cols if head is None else head + cols
            continue
        if c0.startswith("<"):          # <UNITS>, <NOTE> … (not heading; <CONT> handled above)
            continue
        # AGS3 data row (values only)
        if head:
            cont = _add_record(cur, head, row, loca, geol_raw, weth_raw)

    # per-borehole weathering-grade intervals (authoritative grade by depth)
    weth_by_id: dict[str, list] = {}
    for rec in weth_raw:
        pid = (rec.get("LOCA_ID") or rec.get("HOLE_ID") or "").strip()
        r = _norm_roman(rec.get("WETH_GRAD"))
        try:
            t, b = float(rec["WETH_TOP"]), float(rec["WETH_BASE"])
        except (KeyError, TypeError, ValueError):
            continue
        if pid and r:
            weth_by_id.setdefault(pid, []).append((t, b, r))

    # classify GEOL rows now that wrapped descriptions are complete; for rows
    # that still have no grade (blank GEO2 + no description) fall back to the
    # WETH weathering grade covering that depth.
    geol: list[tuple] = []
    for rec in geol_raw:
        pid = (rec.get("LOCA_ID") or rec.get("HOLE_ID") or "").strip()
        if not pid:
            continue
        try:
            top, base = float(rec["GEOL_TOP"]), float(rec["GEOL_BASE"])
        except (KeyError, TypeError, ValueError):
            continue
        surface, grade = classify_layer(rec.get("GEOL_GEO2"), rec.get("GEOL_LEG"),
                                        rec.get("GEOL_GEOL"), rec.get("GEOL_DESC"))
        if not grade and surface.strip().lower() not in _ALLOWED_NONGRADE:
            r = _weth_grade_at(weth_by_id.get(pid, []), top, base)   # authoritative first
            if r:
                surface, grade = _grade_from_roman(r, rec.get("GEOL_LEG") or rec.get("GEOL_DESC"))
            else:                                                    # then the option-A guess
                g = guess_bare_grade(rec.get("GEOL_LEG"), rec.get("GEOL_DESC"))
                if g:
                    surface, grade = g
        geol.append((pid, top, base, surface, grade))
    return loca, geol


def parse_report(repno: str, manifest: dict) -> dict:
    """Fetch and parse one report -> {station_id: {x,y,gl,layers:[...]}}."""
    iz = _fetch_report_zip(repno, manifest)
    ags_names = [n for n in iz.namelist() if n.lower().endswith(".ags")]
    if not ags_names:
        return {}
    primary = [n for n in ags_names if "dis" not in n.lower()] or ags_names
    text = iz.read(primary[0]).decode("latin-1")
    loca, geol = parse_ags_any(text)

    layers_by_id: dict[str, list] = {}
    for pid, top, base, surface, grade in geol:
        layers_by_id.setdefault(pid, []).append({"surface": surface, "top": top, "base": base, "grade": grade})
    for pid, lst in layers_by_id.items():
        lst.sort(key=lambda l: l["top"])
        layers_by_id[pid] = merge_consecutive_layers(lst)

    out = {}
    for pid, (x, y, gl) in loca.items():
        out[pid] = {"x": x, "y": y, "gl": gl, "layers": layers_by_id.get(pid, [])}
    return out


def get_stratigraphy(repnos: Iterable[str]) -> dict[str, dict]:
    """Main entry: {repno: {station_id: {x,y,gl,layers}}} for available reports.
    Reports with no AGS data (old scanned-only, or missing) are simply omitted."""
    manifest = build_manifest()
    result: dict[str, dict] = {}
    for repno in dict.fromkeys(str(r).strip() for r in repnos):   # dedupe, keep order
        if not repno or repno not in manifest:
            continue
        if repno in _report_cache:
            result[repno] = _report_cache[repno]
            continue
        try:
            parsed = parse_report(repno, manifest)
        except Exception:
            parsed = {}
        _report_cache[repno] = parsed
        if parsed:
            result[repno] = parsed
    return result


# ── self-check ─────────────────────────────────────────────────────────────

def demo():
    ags4 = (
        '"GROUP","LOCA"\n'
        '"HEADING","LOCA_ID","LOCA_NATE","LOCA_NATN","LOCA_GL"\n'
        '"UNIT","","m","m","m"\n'
        '"DATA","BH1","800000","820000","15.0"\n'
        '"GROUP","GEOL"\n'
        '"HEADING","LOCA_ID","GEOL_TOP","GEOL_BASE","GEOL_LEG"\n'
        '"DATA","BH1","0.0","5.0","FILL"\n'
        '"DATA","BH1","5.0","12.0","CDG"\n'
    )
    ags3 = (
        '"**HOLE"\n'
        '"*HOLE_ID","*HOLE_NATE","*HOLE_NATN","*HOLE_GL"\n'
        '"<UNITS>","m","m","m"\n'
        '"BH2","801000","821000","20.0"\n'
        '"**GEOL"\n'
        '"*HOLE_ID","*GEOL_TOP","*GEOL_BASE","*GEOL_LEG"\n'
        '"<UNITS>","m","m",""\n'
        '"BH2","0.0","3.0","FILL"\n'
        '"BH2","3.0","9.0","HDG"\n'
    )
    # AGS3 with a HEADING that wraps across two lines (both start with "*").
    # The key columns (HOLE_ID, HOLE_GL) sit on the first line; without
    # accumulating the wrapped line the whole group silently fails to parse.
    ags3_wrapped = (
        '"**HOLE"\n'
        '"*HOLE_ID","*HOLE_TYPE","*HOLE_NATE","*HOLE_NATN"\n'
        '"*HOLE_GL","*HOLE_FDEP","*?HOLE_REM"\n'          # wrapped heading continuation
        '"<UNITS>","","m","m","m","m",""\n'
        '"B 1","RC","833678","822552","51.87","25.35","note"\n'
        '"**GEOL"\n'
        '"*HOLE_ID","*GEOL_TOP","*GEOL_BASE","*GEOL_LEG"\n'
        '"*GEOL_GEO2"\n'                                   # wrapped heading continuation
        '"<UNITS>","m","m","",""\n'
        '"B 1","0.0","4.0","FILL","FILL"\n'
        '"B 1","4.0","10.0","SANDZG","CDG"\n'
    )

    # AGS4 GEOL with blank GEO2 + no description, graded via the WETH group by depth
    ags_weth = (
        '"GROUP","GEOL"\n'
        '"HEADING","LOCA_ID","GEOL_TOP","GEOL_BASE","GEOL_LEG","GEOL_GEO2","GEOL_DESC"\n'
        '"DATA","BH9","10.0","18.0","SANDZG","",""\n'
        '"GROUP","WETH"\n'
        '"HEADING","LOCA_ID","WETH_TOP","WETH_BASE","WETH_GRAD"\n'
        '"DATA","BH9","8.0","20.0","V"\n'
    )

    l4, g4 = parse_ags_any(ags4)
    l3, g3 = parse_ags_any(ags3)
    lw, gw = parse_ags_any(ags3_wrapped)
    _, gwe = parse_ags_any(ags_weth)
    assert len(gwe) == 1 and gwe[0][4] == "V (CDR)", gwe   # WETH grade V, no lithology word -> Grade V Rock
    assert gwe[0][3] == "Completely Decomposed Rock (Grade V)", gwe

    # rock strength term (no "decomposed" word) -> grade
    assert classify_layer("", "SANDZ", "", "Extremely weak, spotted white, medium grained GRANITE") == (
        "Completely Decomposed Granite (Grade V)", "V (CDG)")
    assert classify_layer("", "GRANITE", "", "Strong, pinkish grey GRANITE. Joints tight") == (
        "Slightly Decomposed Granite (Grade II)", "II (SDG)")
    # special / superficial markers
    assert classify_layer("", "BLANK", "", "") == ("No Recovery", "")
    assert classify_layer("", "WASHING", "", "Wash boring.") == ("Wash Boring", "")
    assert classify_layer("", "SILTS", "Q", "Firm, dark grey, sandy SILT. (TOPSOIL)") == ("Topsoil", "")
    assert classify_layer("", "SILTSG", "Q", "Very sandy SILT with gravel") == ("Superficial Deposit", "")
    # option-A guess: bare granular grading code, no other signal -> CDG (V)
    assert guess_bare_grade("SANDZG", "") == ("Completely Decomposed Granite (Grade V)", "V (CDG)")
    assert guess_bare_grade("GRANITE", "") == ("Fresh Granite (Grade I)", "I (Fresh)")
    assert l4["BH1"] == (800000.0, 820000.0, 15.0), l4
    assert len(g4) == 2 and g4[0][3] == "Fill", g4          # LEG=FILL -> recognised origin "Fill"
    assert l3["BH2"] == (801000.0, 821000.0, 20.0), l3
    assert len(g3) == 2 and g3[1][3] == "HDG", g3
    # wrapped-heading AGS3: id + GL recovered, and GEO2 preferred over LEG
    assert lw["B 1"] == (833678.0, 822552.0, 51.87), lw
    assert len(gw) == 2 and gw[0][0] == "B 1", gw
    assert gw[1][3] == "Completely Decomposed Granite (Grade V)", gw   # GEOL_GEO2=CDG wins over LEG=SANDZG

    # decomposition grade from description text when GEOL_GEO2 is blank
    assert classify_layer("CDG", "SANDZG", "L", "") == (
        "Completely Decomposed Granite (Grade V)", "V (CDG)")                     # GEO2 authoritative
    assert classify_layer("", "SANDZG", "L", "completely decomposed medium grained GRANITE") == (
        "Completely Decomposed Granite (Grade V)", "V (CDG)")                     # from description
    assert classify_layer("", "GRAVS", "L", "highly decomposed medium grained GRANITE") == (
        "Highly Decomposed Granite (Grade IV)", "IV (HDG)")
    assert classify_layer("", "GRANITE", "L", "slightly decomposed medium grained GRANITE") == (
        "Slightly Decomposed Granite (Grade II)", "II (SDG)")
    assert classify_layer("", "SILTCS", "Q", "Firm, grey, sandy clayey SILT. (ALLUVIUM)") == (
        "Alluvium", "")                                                          # transported soil, no rock grade
    assert classify_layer("", "FILL", "Q", "Brown, sandy gravel") == ("Fill", "")  # LEG=FILL origin
    assert classify_layer("", "CLAYZ", "Q", "Stiff CLAY. (RESIDUAL SOIL)")[1] == "VI (RS)"

    # classification: verified against real CEDD AGS files (report 71936 BH3, report 73528)
    assert classify_geo2("FILL") == "Fill"
    assert classify_geo2("CDG") == "Completely Decomposed Granite (Grade V)"
    assert classify_geo2("HDG") == "Highly Decomposed Granite (Grade IV)"
    assert classify_geo2("MDG") == "Moderately Decomposed Granite (Grade III)"
    assert classify_geo2("SDG") == "Slightly Decomposed Granite (Grade II)"
    assert classify_geo2("CDT") == "Completely Decomposed Tuff (Grade V)"
    assert classify_geo2("SDQZ") == "Slightly Decomposed Quartzite (Grade II)"
    assert classify_geo2("ALLG") == "Alluvium" and classify_geo2("ALLS") == "Alluvium"
    assert classify_geo2("COL") == "Colluvium"
    assert classify_geo2("RS") == "Residual Soil"
    assert classify_geo2("MD") == "Marine Deposit"           # bare MD, not a grade prefix
    assert classify_geo2("MADC") == "Marine Deposit"         # verified: report 71936 BH4, "(Disturbed MARINE DEPOSIT)"
    assert classify_geo2("") is None and classify_geo2(None) is None
    # grading-code fallback (no GEO2) is NOT reclassified — surfaces as-is
    assert classify_surface(None, "SANDZG", "Q") == "SANDZG"
    assert classify_surface("CDG", "SANDZG", "Q") == "Completely Decomposed Granite (Grade V)"

    # merge: consecutive same-label layers collapse; non-contiguous ones don't
    merged = merge_consecutive_layers([
        {"surface": "Fill", "top": 0.0, "base": 2.0},
        {"surface": "Fill", "top": 2.0, "base": 12.9},
        {"surface": "Fill", "top": 12.9, "base": 26.0},
        {"surface": "Alluvium", "top": 26.0, "base": 28.9},
        {"surface": "Completely Decomposed Granite (Grade V)", "top": 28.9, "base": 40.7},
        {"surface": "Moderately Decomposed Granite (Grade III)", "top": 40.7, "base": 40.97},
        {"surface": "Highly Decomposed Granite (Grade IV)", "top": 40.97, "base": 42.9},
        {"surface": "Completely Decomposed Granite (Grade V)", "top": 42.9, "base": 44.66},
    ])
    assert [(m["surface"], m["top"], m["base"]) for m in merged] == [
        ("Fill", 0.0, 26.0), ("Alluvium", 26.0, 28.9),
        ("Completely Decomposed Granite (Grade V)", 28.9, 40.7),
        ("Moderately Decomposed Granite (Grade III)", 40.7, 40.97),
        ("Highly Decomposed Granite (Grade IV)", 40.97, 42.9),
        ("Completely Decomposed Granite (Grade V)", 42.9, 44.66),   # NOT merged with the first CDG block — not contiguous
    ], merged

    print("ags_open_data.demo OK (AGS3 + AGS4 parse, classification, merge)")


if __name__ == "__main__":
    demo()
