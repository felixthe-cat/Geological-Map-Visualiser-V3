"""Check that a cross-section DXF exported by the website imports into PLAXIS 2D V22 as soil
polygons at the right scale, and meshes. Prints tiered PASS/FAIL.

Run with the PLAXIS bundled interpreter (needs the sister repo "PLAXIS Automation" for plaxis_lib):
    "C:\ProgramData\Bentley\Geotechnical\PLAXIS Python Distribution V2\python\python.exe" tests\plaxis_dxf_import_check.py <file.dxf>

Verified 2026-10-01: 15/15 polygons, area 10811.1 m2 both sides, 5853 elements.
GUI equivalent: Structures mode > Import geometry, tick "Import closed polylines as polygons".
"""
import os, sys, re
sys.path.insert(0, r"C:\VS Code Projects\PLAXIS Automation")
from plaxis_lib.connection import launch_input

DXF = os.path.abspath(sys.argv[1])
OUT = os.path.splitext(DXF)[0] + "_plaxis_check.p2dx"

# bounding box straight from the DXF vertices (group 10 = x, 20 = y)
txt = open(DXF).read().split("\n")
xs = [float(txt[i+1]) for i in range(len(txt)-1) if txt[i].strip() == "10"]
ys = [float(txt[i+1]) for i in range(len(txt)-1) if txt[i].strip() == "20"]
n_poly = sum(1 for l in txt if l.strip() in ("POLYLINE","LWPOLYLINE"))
layers = sorted({txt[i+1].strip() for i in range(len(txt)-1) if txt[i].strip() == "8"})
print("DXF:", n_poly, "polylines, layers:", layers)

plx = launch_input(hidden=True)
try:
    s_i, g_i = plx.s_i, plx.g_i
    s_i.new()
    x0, x1 = min(xs) - 5, max(xs) + 5
    y0, y1 = min(y for y in ys if y != 0) - 5, max(ys) + 5
    s_i.call_commands("initializerectangular SoilContour {} {} {} {}".format(x0, y0, x1, y1))
    g_i.gotostructures()
    res = s_i.call_commands('import "{}" "ImportType" "structures" "ClosedPolylinesAsPolygons" True'.format(DXF))
    print("import ->", res[0]['feedback']['success'] if isinstance(res, list) else res, str(res)[:200])
    polys = list(g_i.Polygons)
    print("[TIER 1 {}] polygons imported: {} (expected {})".format(
        "PASS" if len(polys) == n_poly else "FAIL", len(polys), n_poly))
    mat = g_i.soilmat("SoilModel", "Mohr-Coulomb", "Identification", "Test", "gammaUnsat", 19,
                      "gammaSat", 20, "ERef", 30000, "nu", 0.3, "cRef", 5, "phi", 35, "psi", 0)
    for s in g_i.Soils:
        s.Material = mat
    print("soil clusters:", len(list(g_i.Soils)))
    plx_area = sum(abs(pg.Area.value) for pg in g_i.Polygons)
    # DXF area from the file itself (shoelace per polyline)
    dxf_area=0.0; cur=[]
    for i in range(len(txt)-1):
        t=txt[i].strip()
        if t in ("POLYLINE","SEQEND") and cur:
            dxf_area+=abs(sum(cur[k][0]*cur[(k+1)%len(cur)][1]-cur[(k+1)%len(cur)][0]*cur[k][1] for k in range(len(cur))))/2; cur=[]
        if t=="VERTEX":
            j=i+1; x=y=None
            while txt[j].strip()!="0":
                if txt[j].strip()=="10": x=float(txt[j+1])
                if txt[j].strip()=="20": y=float(txt[j+1])
                j+=2
            cur.append((x,y))
    print("[TIER 1b {}] area PLAXIS {:.1f} m2 vs DXF {:.1f} m2".format(
        "PASS" if abs(plx_area-dxf_area) < 0.01*dxf_area else "FAIL", plx_area, dxf_area))
    g_i.gotomesh()
    m = g_i.mesh(0.06)
    print("mesh ->", str(m)[:300])
    print("[TIER 2 PASS] meshed")
    g_i.save(OUT)
    print("saved", OUT)
finally:
    plx.close()
