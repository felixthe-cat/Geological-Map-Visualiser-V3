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


def _add_record(cur, head, row, loca, geol):
    if not head or not cur:
        return
    rec = dict(zip(head, row))
    g = cur.upper()
    pid = (rec.get("LOCA_ID") or rec.get("HOLE_ID") or "").strip()
    if not pid:
        return
    if g in ("LOCA", "HOLE"):                       # location group (AGS4 / AGS3)
        try:
            loca[pid] = (
                float(rec.get("LOCA_NATE") or rec.get("HOLE_NATE")),
                float(rec.get("LOCA_NATN") or rec.get("HOLE_NATN")),
                float(rec.get("LOCA_GL")  or rec.get("HOLE_GL")),
            )
        except (TypeError, ValueError):
            pass
    elif g == "GEOL":                               # stratigraphy group
        surface = (rec.get("GEOL_LEG") or rec.get("GEOL_GEOL") or rec.get("GEOL_GEO2") or "").strip()
        try:
            geol.append((pid, float(rec["GEOL_TOP"]), float(rec["GEOL_BASE"]), surface))
        except (KeyError, TypeError, ValueError):
            pass


def parse_ags_any(text: str):
    """Tolerant parser handling BOTH AGS4 (GROUP/HEADING/DATA) and AGS3
    (**GROUP / *HEADING / bare data rows). Returns (loca, geol):
        loca = {id: (nate, natn, gl)}
        geol = [(id, top, base, surface), ...]
    """
    loca: dict[str, tuple] = {}
    geol: list[tuple] = []
    cur = None
    head = None
    for row in csv.reader(io.StringIO(text)):
        if not row or all(c == "" for c in row):
            continue
        c0 = row[0].strip()
        # AGS4 markers
        if c0 == "GROUP":
            cur = row[1].strip() if len(row) > 1 else None
            head = None
            continue
        if c0 == "HEADING":
            head = [h.strip() for h in row]
            continue
        if c0 in ("UNIT", "TYPE"):
            continue
        if c0 == "DATA":
            _add_record(cur, head, row, loca, geol)
            continue
        # AGS3 markers
        if c0.startswith("**"):
            cur = c0.lstrip("*").strip()
            head = None
            continue
        if c0.startswith("*"):
            head = [h.lstrip("*").strip() for h in row]
            continue
        if c0.startswith("<"):          # <UNITS>, <CONT> …
            continue
        # AGS3 data row (values only)
        if head:
            _add_record(cur, head, row, loca, geol)
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
    for pid, top, base, surface in geol:
        layers_by_id.setdefault(pid, []).append({"surface": surface, "top": top, "base": base})
    for lst in layers_by_id.values():
        lst.sort(key=lambda l: l["top"])

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
    l4, g4 = parse_ags_any(ags4)
    l3, g3 = parse_ags_any(ags3)
    assert l4["BH1"] == (800000.0, 820000.0, 15.0), l4
    assert len(g4) == 2 and g4[0][3] == "FILL", g4
    assert l3["BH2"] == (801000.0, 821000.0, 20.0), l3
    assert len(g3) == 2 and g3[1][3] == "HDG", g3
    print("ags_open_data.demo OK (AGS3 + AGS4 parse)")


if __name__ == "__main__":
    demo()
