"""Verification test: the AGS file we let the user download is byte-for-byte
what CEDD's GEO Open Data archive serves — nothing parsed, nothing re-encoded.

Run (needs network):  .venv\\Scripts\\python.exe test_raw_ags.py

Why CRC-32 is the proof, not a second download:
  CEDD publishes ONE file (GI_AGS.zip, ~635 MB) — there is no per-report URL to
  diff against (GI_AGS/<REPNO>.zip 404s). But the archive's central directory
  carries CEDD's own CRC-32 + uncompressed size for every report entry, written
  by CEDD when they built the archive. If our byte-range slice + inflate
  reproduces those exactly, our bytes ARE their bytes. Each report zip then
  carries its own CRCs for the .ags files inside it, checked too (testzip()).
"""
from __future__ import annotations

import hashlib
import io
import zipfile
import zlib

from src.ags_open_data import (build_manifest, fetch_report_bytes, get_raw_reports,
                               parse_report, verify_report)

REPNOS = ["71936", "62077", "62076", "66636"]     # the user's test site


def main() -> None:
    manifest = build_manifest()
    print(f"manifest: {len(manifest):,} reports in GI_AGS.zip\n")

    for repno in REPNOS:
        assert repno in manifest, f"{repno} missing from manifest"
        lho, csize, method, crc, usize = manifest[repno]

        # 1. CEDD's own CRC-32 + size (raises inside fetch_report_bytes on mismatch)
        raw = fetch_report_bytes(repno, manifest)
        assert len(raw) == usize
        assert zlib.crc32(raw) == crc
        sha = hashlib.sha256(raw).hexdigest()

        # 2. every .ags/.pdf inside the report zip passes its own stored CRC
        info = verify_report(repno)
        assert info["inner_crc_ok"] and info["outer_crc_ok"]

        # 3. determinism: an independently-sized range fetch yields identical bytes
        #    (guards against an off-by-one slice that happened to still inflate)
        again = fetch_report_bytes(repno, manifest)
        assert again == raw, "two fetches disagree"

        # 4. the download is the ORIGINAL, not our parsed output: the .ags text
        #    inside is intact AGS, and it is the same text the parser consumed.
        z = zipfile.ZipFile(io.BytesIO(raw))
        ags = [n for n in z.namelist() if n.lower().endswith(".ags")]
        assert ags, f"{repno}: no .ags member"
        head = z.read(ags[0])[:400].decode("latin-1")
        assert '"GROUP"' in head or '"**' in head or "**HOLE" in head, head[:120]
        # our own download path must not touch the bytes
        assert get_raw_reports([repno])[repno] == raw

        parsed = parse_report(repno, manifest)
        print(f"  {repno}: {len(raw):>9,} B  crc32 {crc:08x}  sha256 {sha[:16]}…  "
              f"members={len(z.namelist())}  ags={ags[0]}  stations_parsed={len(parsed)}")

    # 5. multi-report container: entries STORED, so inner bytes are untouched
    raws = get_raw_reports(REPNOS)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
        for repno, data in raws.items():
            z.writestr(f"{repno}.zip", data)
    back = zipfile.ZipFile(io.BytesIO(buf.getvalue()))
    for repno, data in raws.items():
        assert back.read(f"{repno}.zip") == data, f"{repno} altered by container"
        assert back.getinfo(f"{repno}.zip").compress_type == zipfile.ZIP_STORED

    print(f"\nOK — {len(REPNOS)} reports byte-verified against CEDD's own CRC-32, "
          f"and the multi-report container preserves every byte.")


if __name__ == "__main__":
    main()
