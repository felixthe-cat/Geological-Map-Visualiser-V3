"""
src/map_view.py
---------------
Generates interactive Folium / Leaflet site maps for the Geological Map Visualiser.

Basemap layers (switchable via layer control):
  - Google Hybrid  (satellite imagery + road/building/place labels)  <- default
  - Google Satellite  (imagery only)
  - ESRI World Terrain Base  (hillshaded terrain -- reveals HK topography)
  - ESRI Reference Labels  (transparent overlay of roads + place names)
  - OpenStreetMap

Borehole markers:
  - Blue circles  : session boreholes (from loaded AGS/CSV file)
  - Grey circles  : CSDI database boreholes (from bounding-box search)

Plugins bundled:
  - MeasureControl  (distance / area measurement tool)
  - MousePosition   (live WGS84 cursor coordinates, bottom-left)
  - MiniMap         (inset overview, bottom-right)
  - LayerControl    (basemap switcher, top-right)
"""

from __future__ import annotations

import numpy as np
import pandas as pd

try:
    import folium
    from folium.plugins import MeasureControl, MousePosition, MiniMap
    HAS_FOLIUM = True
except ImportError:
    HAS_FOLIUM = False


# ---------------------------------------------------------------------------
# Coordinate conversion: HK1980 (EPSG:2326) → WGS84 (EPSG:4326)
# ---------------------------------------------------------------------------

def hk1980_to_wgs84(easting: float, northing: float) -> tuple[float, float]:
    """
    Convert HK1980 Grid (EPSG:2326) coordinates to WGS84 latitude / longitude.

    Tries pyproj first for sub-metre accuracy.  Falls back to a linear
    approximation anchored on Victoria Harbour — accurate to ±20 m across
    Hong Kong Island and Kowloon, which is sufficient for map-pin display.

    Returns:
        (latitude, longitude) in WGS84 decimal degrees.
    """
    try:
        from pyproj import Transformer
        tf = Transformer.from_crs("EPSG:2326", "EPSG:4326", always_xy=True)
        lon, lat = tf.transform(float(easting), float(northing))
        return float(lat), float(lon)
    except Exception:
        # Linear approximation coefficients derived from HK corner benchmarks
        lat = 22.3964 + (northing - 821784.0) * 9.0085e-6
        lon = 114.1095 + (easting  - 833000.0) * 1.0243e-5
        return float(lat), float(lon)


# ---------------------------------------------------------------------------
# Colour helper
# ---------------------------------------------------------------------------

# Stratum colours matching export.py COLOR_HEX_PALETTE (index-matched)
_BH_FILL    = '#00b4db'   # blue  -- session boreholes
_BH_BORDER  = '#1e3c72'
_CSDI_FILL  = '#94a3b8'   # slate -- CSDI database boreholes
_CSDI_BORDER = '#475569'


# ---------------------------------------------------------------------------
# Main map generation
# ---------------------------------------------------------------------------

def generate_site_map(
    loca_df:  pd.DataFrame | None = None,
    geol_df:  pd.DataFrame | None = None,
    csdi_df:  pd.DataFrame | None = None,
) -> str:
    """
    Build an interactive Folium map centred on the active project boreholes.
    If no data is loaded the map opens centred on Victoria Harbour, HK.

    Args:
        loca_df:  LOCA DataFrame -- columns: LOCA_ID, LOCA_NATE, LOCA_NATN, LOCA_GL
        geol_df:  GEOL DataFrame -- columns: LOCA_ID, GEOL_TOP, GEOL_BASE, surface
        csdi_df:  DataFrame from csdi_client.query_bbox_*() -- columns include
                  statno, e_coord, n_coord, lat, lon, grdlevel, depth, stattype

    Returns:
        HTML string for embedding in a Gradio gr.HTML component.
    """
    if not HAS_FOLIUM:
        return (
            "<div style='padding:2rem;text-align:center;font-family:sans-serif;"
            "color:#ef4444;background:#fef2f2;border-radius:8px;'>"
            "⚠️ <b>folium</b> is not installed.<br>"
            "Run: <code>pip install folium pyproj</code></div>"
        )

    # ------------------------------------------------------------------ #
    #  1. Determine map centre & zoom from borehole data                  #
    # ------------------------------------------------------------------ #
    DEFAULT_CENTER = [22.3193, 114.1694]   # Victoria Harbour
    DEFAULT_ZOOM   = 11

    center     = DEFAULT_CENTER
    zoom       = DEFAULT_ZOOM
    bh_markers = []

    if loca_df is not None and not loca_df.empty:
        lats, lons = [], []
        for _, row in loca_df.iterrows():
            lat, lon = hk1980_to_wgs84(row["LOCA_NATE"], row["LOCA_NATN"])
            lats.append(lat)
            lons.append(lon)

        if lats:
            center = [float(np.mean(lats)), float(np.mean(lons))]
            span   = max(
                abs(max(lats) - min(lats)),
                abs(max(lons) - min(lons)),
            )
            if   span < 0.0005: zoom = 19
            elif span < 0.002:  zoom = 17
            elif span < 0.005:  zoom = 16
            elif span < 0.015:  zoom = 15
            elif span < 0.04:   zoom = 14
            else:               zoom = 13

            for i, (_, row) in enumerate(loca_df.iterrows()):
                n_layers = 0
                if geol_df is not None and not geol_df.empty:
                    n_layers = int((geol_df["LOCA_ID"] == row["LOCA_ID"]).sum())
                bh_markers.append(
                    {
                        "lat":      lats[i],
                        "lon":      lons[i],
                        "bh_id":    str(row["LOCA_ID"]),
                        "easting":  float(row["LOCA_NATE"]),
                        "northing": float(row["LOCA_NATN"]),
                        "rl":       float(row["LOCA_GL"]),
                        "n_layers": n_layers,
                    }
                )

    # ------------------------------------------------------------------ #
    #  2. Create Folium map                                               #
    # ------------------------------------------------------------------ #
    m = folium.Map(
        location=center,
        zoom_start=zoom,
        tiles=None,          # custom tiles added below
        prefer_canvas=True,
    )

    # ------------------------------------------------------------------ #
    #  3. Basemap tile layers                                             #
    # ------------------------------------------------------------------ #

    # ① Google Hybrid: satellite imagery + road, building & place labels (DEFAULT)
    folium.TileLayer(
        tiles=(
            "https://mt1.google.com/vt/lyrs=y"
            "&x={x}&y={y}&z={z}"
        ),
        attr="Map data © <a href='https://www.google.com/maps'>Google</a>",
        name="🛰️ Google Hybrid (Satellite + Streets)",
        overlay=False,
        control=True,
        show=True,
        max_zoom=21,
    ).add_to(m)

    # ② Google Satellite only (no labels)
    folium.TileLayer(
        tiles=(
            "https://mt1.google.com/vt/lyrs=s"
            "&x={x}&y={y}&z={z}"
        ),
        attr="Map data © <a href='https://www.google.com/maps'>Google</a>",
        name="📷 Google Satellite (No Labels)",
        overlay=False,
        control=True,
        show=False,
        max_zoom=21,
    ).add_to(m)

    # ③ ESRI World Terrain Base (hillshaded elevation — great for HK topography)
    folium.TileLayer(
        tiles=(
            "https://server.arcgisonline.com/ArcGIS/rest/services/"
            "World_Terrain_Base/MapServer/tile/{z}/{y}/{x}"
        ),
        attr=(
            "Sources: Esri, USGS, NOAA"
        ),
        name="🏔️ ESRI Terrain (Hillshaded)",
        overlay=False,
        control=True,
        show=False,
        max_zoom=13,
    ).add_to(m)

    # ④ ESRI Reference Labels — transparent overlay (roads + place names)
    #    Designed to sit on top of ESRI Terrain to restore labels
    folium.TileLayer(
        tiles=(
            "https://server.arcgisonline.com/ArcGIS/rest/services/"
            "Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}"
        ),
        attr="Esri",
        name="🏷️ ESRI Reference Labels (overlay)",
        overlay=True,      # overlay, not a base layer — stack on terrain
        control=True,
        show=False,
    ).add_to(m)

    # ⑤ OpenStreetMap (streets + buildings, no satellite)
    folium.TileLayer(
        tiles="OpenStreetMap",
        name="🗺️ OpenStreetMap",
        overlay=False,
        control=True,
        show=False,
    ).add_to(m)

    # ------------------------------------------------------------------ #
    #  4. Borehole markers                                                #
    # ------------------------------------------------------------------ #
    if bh_markers:
        bh_group = folium.FeatureGroup(name="🔵 Borehole Locations", show=True)

        for bm in bh_markers:
            popup_html = f"""
            <div style="font-family:'Outfit',Arial,sans-serif;min-width:205px;
                        border-radius:8px;overflow:hidden;
                        box-shadow:0 4px 16px rgba(0,0,0,0.18);">
                <div style="background:linear-gradient(135deg,#1e3c72,#2a5298);
                            color:white;padding:9px 13px;
                            font-weight:700;font-size:13px;letter-spacing:0.3px;">
                    🔵 &nbsp;{bm['bh_id']}
                </div>
                <div style="padding:10px 14px;background:#f8fafc;
                            border:1px solid #e2e8f0;border-top:none;">
                    <table style="width:100%;font-size:12px;border-collapse:collapse;">
                        <tr>
                            <td style="color:#64748b;padding:3px 0;width:105px;">
                                Easting (HK1980)
                            </td>
                            <td style="font-weight:600;color:#1e293b;">
                                {bm['easting']:,.0f} m
                            </td>
                        </tr>
                        <tr>
                            <td style="color:#64748b;padding:3px 0;">
                                Northing (HK1980)
                            </td>
                            <td style="font-weight:600;color:#1e293b;">
                                {bm['northing']:,.0f} m
                            </td>
                        </tr>
                        <tr>
                            <td style="color:#64748b;padding:3px 0;">Collar RL</td>
                            <td style="font-weight:600;color:#1e293b;">
                                {bm['rl']:.2f} mPD
                            </td>
                        </tr>
                        <tr>
                            <td style="color:#64748b;padding:3px 0;">Strata Layers</td>
                            <td style="font-weight:600;color:#1e293b;">
                                {bm['n_layers']}
                            </td>
                        </tr>
                    </table>
                </div>
            </div>
            """

            folium.CircleMarker(
                location=[bm["lat"], bm["lon"]],
                radius=10,
                color=_BH_BORDER,
                fill=True,
                fill_color=_BH_FILL,
                fill_opacity=0.9,
                weight=2.5,
                popup=folium.Popup(popup_html, max_width=240),
                tooltip=folium.Tooltip(
                    (
                        f"<b style='font-family:Outfit,Arial,sans-serif;'>"
                        f"{bm['bh_id']}</b>"
                        f"<span style='color:#64748b;font-size:11px;font-family:Outfit,Arial,sans-serif;'>"
                        f" &nbsp;|&nbsp; RL: {bm['rl']:.1f} mPD"
                        f" &nbsp;|&nbsp; {bm['n_layers']} layers</span>"
                    ),
                ),
            ).add_to(bh_group)

            # Floating BH ID label (white-outlined text, visible on both dark/light tiles)
            folium.Marker(
                location=[bm["lat"], bm["lon"]],
                icon=folium.DivIcon(
                    html=(
                        f'<div style="'
                        f'font-family:Outfit,Arial,sans-serif;'
                        f'font-size:10px;font-weight:700;color:{_BH_BORDER};'
                        f'white-space:nowrap;'
                        f'margin-top:-21px;margin-left:14px;'
                        f'text-shadow:'
                        f'  -1px -1px 0 white,'
                        f'   1px -1px 0 white,'
                        f'  -1px  1px 0 white,'
                        f'   1px  1px 0 white,'
                        f'  0 0 4px white;'
                        f'">{bm["bh_id"]}</div>'
                    ),
                    icon_size=(120, 22),
                    icon_anchor=(0, 0),
                ),
            ).add_to(bh_group)

        bh_group.add_to(m)

    # ------------------------------------------------------------------ #
    #  5. CSDI database borehole markers (grey dots from bbox search)     #
    # ------------------------------------------------------------------ #
    if csdi_df is not None and not csdi_df.empty:
        # Cap at 3000 markers to keep the browser responsive
        display_df = csdi_df.head(3000)
        n_total    = len(csdi_df)
        n_shown    = len(display_df)

        csdi_label = (
            f"⚪ CSDI Boreholes ({n_shown:,}"
            + (f" of {n_total:,}" if n_total > n_shown else "")
            + ")"
        )
        csdi_group = folium.FeatureGroup(name=csdi_label, show=True)

        for _, row in display_df.iterrows():
            lat_c = row.get("lat")
            lon_c = row.get("lon")
            if lat_c is None or lon_c is None or pd.isna(lat_c) or pd.isna(lon_c):
                continue

            stat_no   = row.get("statno", "–")
            stat_type = row.get("stattype", "–")
            rep_no    = row.get("repno", "–")
            rl        = row.get("grdlevel")
            depth     = row.get("depth")
            e_c       = row.get("e_coord")
            n_c       = row.get("n_coord")

            rl_str    = f"{float(rl):.2f} mPD" if rl is not None and not pd.isna(float(rl)) else "–"
            dep_str   = f"{float(depth):.1f} m"  if depth is not None and not pd.isna(float(depth)) else "–"
            e_str     = f"{float(e_c):,.0f}"     if e_c is not None and not pd.isna(float(e_c)) else "–"
            n_str     = f"{float(n_c):,.0f}"     if n_c is not None and not pd.isna(float(n_c)) else "–"

            popup_html = f"""
            <div style="font-family:'Outfit',Arial,sans-serif;min-width:210px;
                        border-radius:8px;overflow:hidden;
                        box-shadow:0 4px 16px rgba(0,0,0,0.18);">
                <div style="background:linear-gradient(135deg,#475569,#64748b);
                            color:white;padding:9px 13px;
                            font-weight:700;font-size:13px;letter-spacing:0.3px;">
                    ⚪ &nbsp;{stat_no} &nbsp;<span style="font-weight:400;font-size:11px;opacity:0.85;">[{stat_type}]</span>
                </div>
                <div style="padding:10px 14px;background:#f8fafc;
                            border:1px solid #e2e8f0;border-top:none;">
                    <table style="width:100%;font-size:12px;border-collapse:collapse;">
                        <tr><td style="color:#64748b;padding:2px 0;width:110px;">Report No</td>
                            <td style="font-weight:600;color:#1e293b;">{rep_no}</td></tr>
                        <tr><td style="color:#64748b;padding:2px 0;">Easting (HK1980)</td>
                            <td style="font-weight:600;color:#1e293b;">{e_str} m</td></tr>
                        <tr><td style="color:#64748b;padding:2px 0;">Northing (HK1980)</td>
                            <td style="font-weight:600;color:#1e293b;">{n_str} m</td></tr>
                        <tr><td style="color:#64748b;padding:2px 0;">Collar RL</td>
                            <td style="font-weight:600;color:#1e293b;">{rl_str}</td></tr>
                        <tr><td style="color:#64748b;padding:2px 0;">Total Depth</td>
                            <td style="font-weight:600;color:#1e293b;">{dep_str}</td></tr>
                    </table>
                </div>
            </div>
            """

            folium.CircleMarker(
                location=[float(lat_c), float(lon_c)],
                radius=5,
                color=_CSDI_BORDER,
                fill=True,
                fill_color=_CSDI_FILL,
                fill_opacity=0.75,
                weight=1.5,
                popup=folium.Popup(popup_html, max_width=240),
                tooltip=folium.Tooltip(
                    f"<b style='font-family:Outfit,Arial,sans-serif;'>{stat_no}</b>"
                    f"<span style='color:#64748b;font-size:11px;font-family:Outfit,Arial,sans-serif;'>"
                    f" &nbsp;|&nbsp; {stat_type} &nbsp;|&nbsp; Depth: {dep_str}</span>"
                ),
            ).add_to(csdi_group)

        csdi_group.add_to(m)

    # Distance / area measurement tool (top-left)
    MeasureControl(
        position="topleft",
        primary_length_unit="meters",
        secondary_length_unit="kilometers",
        primary_area_unit="sqmeters",
        secondary_area_unit="hectares",
    ).add_to(m)

    # Live cursor coordinates (bottom-left)
    MousePosition(
        position="bottomleft",
        separator=" | ",
        prefix="WGS84: ",
        lat_formatter="function(num){return L.Util.formatNum(num, 5);}",
        lng_formatter="function(num){return L.Util.formatNum(num, 5);}",
    ).add_to(m)

    # Inset mini-map (bottom-right)
    MiniMap(
        toggle_display=True,
        position="bottomright",
        zoom_level_offset=-6,
        minimized=False,
    ).add_to(m)

    # Layer control — MUST be added last so all layers are registered
    folium.LayerControl(position="topright", collapsed=False).add_to(m)

    # ------------------------------------------------------------------ #
    #  6. Return embeddable HTML                                          #
    # ------------------------------------------------------------------ #
    # Wrap in a full-height container so the iframe fills the Gradio panel
    raw_html = m._repr_html_()
    return (
        f'<div style="width:100%;height:600px;border-radius:12px;overflow:hidden;'
        f'border:1px solid #e2e8f0;box-shadow:0 4px 20px rgba(0,0,0,0.1);">'
        f'{raw_html}'
        f'</div>'
    )
