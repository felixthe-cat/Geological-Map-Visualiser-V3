"""
src/csdi_client.py
------------------
CSDI WFS client — downloads the HK Government Ground Investigation (GI)
borehole spatial index and stores it in a local SQLite database.

WFS service details (confirmed via GetCapabilities):
  URL:    https://portal.csdi.gov.hk/server/services/common/
          cedd_rcd_1636517845149_16420/MapServer/WFSServer
  Layer:  csdi:Borehole_Location
  Fields: REPNO, STATNO, STATTYPE, E_COORD, N_COORD (HK1980),
          SDATE, EDATE, GRDLEVEL, GRDUNIT, DEPTH
  Max page: 10,000 features (ArcGIS WFS, startIndex = OBJECTID offset)

Public API:
  sync_spatial_index(db_path, page_size, progress_cb) -> int
  count_local(db_path)                                -> int
  get_last_sync(db_path)                              -> str | None
  query_bbox_hk1980(db_path, e_min, n_min, e_max, n_max) -> pd.DataFrame
  query_bbox_wgs84(db_path, sw_lat, sw_lng, ne_lat, ne_lng) -> pd.DataFrame
"""

from __future__ import annotations

import json
import sqlite3
import time
from datetime import datetime
from typing import Callable

import pandas as pd
import requests

# ── WFS constants ──────────────────────────────────────────────────────────
WFS_URL = (
    "https://portal.csdi.gov.hk/server/services/common/"
    "cedd_rcd_1636517845149_16420/MapServer/WFSServer"
)
WFS_LAYER    = "csdi:Borehole_Location"
WFS_CRS      = "EPSG:4326"           # GeoJSON lon/lat geometry
DEFAULT_PAGE = 2_000                  # conservative; server allows 10,000
REQUEST_TIMEOUT = 60                  # seconds per page request


# ── SQLite helpers ─────────────────────────────────────────────────────────

def _get_conn(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS boreholes (
        objectid  INTEGER PRIMARY KEY,
        repno     TEXT,
        statno    TEXT,
        stattype  TEXT,
        e_coord   REAL,
        n_coord   REAL,
        lat       REAL,
        lon       REAL,
        sdate     TEXT,
        edate     TEXT,
        grdlevel  REAL,
        grdunit   TEXT,
        depth     REAL
    );
    CREATE INDEX IF NOT EXISTS idx_easting  ON boreholes (e_coord);
    CREATE INDEX IF NOT EXISTS idx_northing ON boreholes (n_coord);
    CREATE INDEX IF NOT EXISTS idx_lat      ON boreholes (lat);
    CREATE INDEX IF NOT EXISTS idx_lon      ON boreholes (lon);
    CREATE TABLE IF NOT EXISTS sync_log (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        synced_at TEXT NOT NULL,
        n_total   INTEGER NOT NULL
    );
    """)
    conn.commit()


# ── WFS fetch ──────────────────────────────────────────────────────────────

def _fetch_page(session: requests.Session, start_index: int, page_size: int) -> list[dict]:
    """Fetch one page of WFS features; returns list of GeoJSON feature dicts."""
    params = {
        "service":    "WFS",
        "version":    "2.0.0",
        "request":    "GetFeature",
        "typeNames":  WFS_LAYER,
        "outputFormat": "GEOJSON",
        "srsName":    WFS_CRS,
        "count":      page_size,
        "startIndex": start_index,
    }
    resp = session.get(WFS_URL, params=params, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    return data.get("features", [])


def _feature_to_row(feat: dict) -> dict | None:
    """Extract a database row dict from a GeoJSON feature."""
    props = feat.get("properties", {})
    geom  = feat.get("geometry", {})

    objectid = props.get("OBJECTID")
    if objectid is None:
        return None

    # WGS84 coordinates from GeoJSON geometry (lon, lat order)
    coords = geom.get("coordinates", [None, None])
    lon = coords[0] if len(coords) >= 2 else None
    lat = coords[1] if len(coords) >= 2 else None

    def _float(v):
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    return {
        "objectid": int(objectid),
        "repno":    props.get("REPNO"),
        "statno":   props.get("STATNO"),
        "stattype": props.get("STATTYPE"),
        "e_coord":  _float(props.get("E_COORD")),
        "n_coord":  _float(props.get("N_COORD")),
        "lat":      _float(lat),
        "lon":      _float(lon),
        "sdate":    props.get("SDATE"),
        "edate":    props.get("EDATE"),
        "grdlevel": _float(props.get("GRDLEVEL")),
        "grdunit":  props.get("GRDUNIT"),
        "depth":    _float(props.get("DEPTH")),
    }


# ── Public: sync ───────────────────────────────────────────────────────────

def sync_spatial_index(
    db_path: str,
    page_size: int = DEFAULT_PAGE,
    progress_cb: Callable[[str], None] | None = None,
) -> tuple[int, str]:
    """
    Download all HK GI borehole locations from the CSDI WFS and upsert
    them into the local SQLite database at *db_path*.

    Args:
        db_path:     Path to SQLite file (created if it does not exist).
        page_size:   Features per WFS request (default 2,000).
        progress_cb: Optional callback(message: str) for progress updates.

    Returns:
        (n_total, message) — total records upserted and a status string.
    """
    import os; os.makedirs(os.path.dirname(db_path) if os.path.dirname(db_path) else ".", exist_ok=True)

    def _log(msg: str) -> None:
        if progress_cb:
            progress_cb(msg)

    conn = _get_conn(db_path)
    _ensure_schema(conn)

    session    = requests.Session()
    start_idx  = 0
    n_total    = 0
    page_num   = 0
    t0         = time.time()

    _log("Connecting to CSDI WFS …")

    UPSERT = """
    INSERT INTO boreholes
        (objectid, repno, statno, stattype, e_coord, n_coord,
         lat, lon, sdate, edate, grdlevel, grdunit, depth)
    VALUES
        (:objectid, :repno, :statno, :stattype, :e_coord, :n_coord,
         :lat, :lon, :sdate, :edate, :grdlevel, :grdunit, :depth)
    ON CONFLICT(objectid) DO UPDATE SET
        repno=excluded.repno, statno=excluded.statno,
        stattype=excluded.stattype,
        e_coord=excluded.e_coord, n_coord=excluded.n_coord,
        lat=excluded.lat, lon=excluded.lon,
        sdate=excluded.sdate, edate=excluded.edate,
        grdlevel=excluded.grdlevel, grdunit=excluded.grdunit,
        depth=excluded.depth
    """

    while True:
        page_num += 1
        _log(f"Downloading page {page_num} (records {start_idx}–{start_idx + page_size - 1}) …")

        try:
            features = _fetch_page(session, start_idx, page_size)
        except requests.RequestException as exc:
            msg = f"Network error on page {page_num}: {exc}"
            _log(msg)
            return n_total, msg

        if not features:
            break   # no more data

        rows = [r for f in features if (r := _feature_to_row(f)) is not None]
        if rows:
            conn.executemany(UPSERT, rows)
            conn.commit()
            n_total += len(rows)

        elapsed = time.time() - t0
        _log(f"  … {n_total:,} records so far ({elapsed:.0f}s elapsed)")

        if len(features) < page_size:
            break   # last page (partial)

        start_idx += page_size

    # Record sync timestamp
    conn.execute(
        "INSERT INTO sync_log (synced_at, n_total) VALUES (?, ?)",
        (datetime.now().isoformat(timespec="seconds"), n_total),
    )
    conn.commit()
    conn.close()

    elapsed = time.time() - t0
    msg = f"Sync complete: {n_total:,} boreholes stored in {elapsed:.1f}s"
    _log(msg)
    return n_total, msg


# ── Public: count / last-sync ──────────────────────────────────────────────

def count_local(db_path: str) -> int:
    """Return number of borehole records in the local database."""
    try:
        conn = _get_conn(db_path)
        _ensure_schema(conn)
        n = conn.execute("SELECT COUNT(*) FROM boreholes").fetchone()[0]
        conn.close()
        return n
    except Exception:
        return 0


def get_last_sync(db_path: str) -> str | None:
    """Return the ISO timestamp of the most recent successful sync, or None."""
    try:
        conn = _get_conn(db_path)
        _ensure_schema(conn)
        row = conn.execute(
            "SELECT synced_at, n_total FROM sync_log ORDER BY id DESC LIMIT 1"
        ).fetchone()
        conn.close()
        if row:
            return f"{row[0]}  ({row[1]:,} records)"
        return None
    except Exception:
        return None


# ── Public: spatial queries ────────────────────────────────────────────────

_COLUMNS_OUT = [
    "objectid", "repno", "statno", "stattype",
    "e_coord", "n_coord", "lat", "lon",
    "sdate", "edate", "grdlevel", "grdunit", "depth",
]

_QUERY_HK1980 = """
SELECT {cols}
FROM   boreholes
WHERE  e_coord BETWEEN :e_min AND :e_max
  AND  n_coord BETWEEN :n_min AND :n_max
ORDER  BY statno
""".format(cols=", ".join(_COLUMNS_OUT))

_QUERY_WGS84 = """
SELECT {cols}
FROM   boreholes
WHERE  lat BETWEEN :lat_min AND :lat_max
  AND  lon BETWEEN :lon_min AND :lon_max
ORDER  BY statno
""".format(cols=", ".join(_COLUMNS_OUT))


def query_bbox_hk1980(
    db_path: str,
    e_min: float, n_min: float,
    e_max: float, n_max: float,
) -> pd.DataFrame:
    """
    Return all boreholes within the given HK1980 bounding box.

    Args:
        db_path:  Path to SQLite file.
        e_min/e_max: Easting bounds (metres, HK1980).
        n_min/n_max: Northing bounds (metres, HK1980).

    Returns:
        DataFrame with columns: objectid, repno, statno, stattype,
        e_coord, n_coord, lat, lon, sdate, edate, grdlevel, grdunit, depth.
        Empty DataFrame if no match or database not yet synced.
    """
    try:
        conn = _get_conn(db_path)
        _ensure_schema(conn)
        df = pd.read_sql_query(
            _QUERY_HK1980,
            conn,
            params={"e_min": e_min, "n_min": n_min, "e_max": e_max, "n_max": n_max},
        )
        conn.close()
        return df
    except Exception as exc:
        return pd.DataFrame(columns=_COLUMNS_OUT)


def query_bbox_wgs84(
    db_path: str,
    sw_lat: float, sw_lng: float,
    ne_lat: float, ne_lng: float,
) -> pd.DataFrame:
    """
    Return all boreholes within the given WGS84 bounding box.

    Args:
        db_path:  Path to SQLite file.
        sw_lat/sw_lng: South-West corner (WGS84 decimal degrees).
        ne_lat/ne_lng: North-East corner (WGS84 decimal degrees).

    Returns:
        DataFrame — same schema as query_bbox_hk1980().
    """
    try:
        conn = _get_conn(db_path)
        _ensure_schema(conn)
        df = pd.read_sql_query(
            _QUERY_WGS84,
            conn,
            params={
                "lat_min": sw_lat, "lat_max": ne_lat,
                "lon_min": sw_lng, "lon_max": ne_lng,
            },
        )
        conn.close()
        return df
    except Exception:
        return pd.DataFrame(columns=_COLUMNS_OUT)
