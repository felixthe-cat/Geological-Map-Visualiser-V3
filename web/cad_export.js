// Cross-section -> DXF, for import into GeoStudio SLOPE/W (File > Import, CAD
// drawing) and PLAXIS 2D (Structures mode > Import geometry, or the `import`
// command). Pure and dependency-free so it runs under Node (test_cad_export.mjs).
//
// Drawn at TRUE scale, no vertical exaggeration: x = chainage from A (m),
// y = level (mPD). One closed polyline per soil/rock band, on a layer named
// after the band, so each band arrives as one region / soil polygon.
//
// Finite-element programs need the regions to fit together exactly: two bands
// that touch must share the very same vertices along the boundary, and no
// region may have zero area. So:
//   • every band is built from the same sampled curves (band k's base IS band
//     k+1's top), simplified on ONE shared set of sample indices;
//   • a band is split wherever it pinches out to zero thickness, so a lens that
//     appears and disappears becomes its own closed piece, never a sliver.
//
// Format: DXF R12 (AC1009) ASCII — the oldest, most widely read flavour (no
// object handles needed). $INSUNITS = 6 (metres): PLAXIS reads it to scale the
// import (its manual says to set it); older readers just ignore it.

const EPS = 1e-3;                  // m — thinner than this counts as pinched out

// Indices of xq worth keeping: the ends, and anywhere ANY curve bends (or a band
// starts/stops). Shared by every curve, so shared boundaries stay identical.
function keptIndices(xq, curves, tol){
  const n = xq.length, keep = new Set([0, n-1]);
  for (let i=1; i<n-1; i++){
    for (let k=0; k<curves.length; k++){
      const c = curves[k];
      const t = (xq[i]-xq[i-1]) / ((xq[i+1]-xq[i-1]) || 1);
      if (Math.abs(c[i] - (c[i-1] + (c[i+1]-c[i-1])*t)) > tol){ keep.add(i); break; }
      // thickness switching between zero and non-zero = a pinch-out point
      if (k < curves.length-1){
        const th = j => curves[k][j]-curves[k+1][j] > EPS;
        if (th(i) !== th(i-1) || th(i) !== th(i+1)){ keep.add(i); break; }
      }
    }
  }
  return [...keep].sort((a,b)=>a-b);
}

/**
 * Closed outlines of every band, split at pinch-outs.
 * @param xq     chainages (m), ascending
 * @param curves curves[k][q] = level of horizon k at xq[q]; band k lies between
 *               curves[k] (top) and curves[k+1] (base)
 * @param names  names[k] = layer name for band k
 * @returns [{name, pts:[[x,y],...]}] — pts not repeated at the end (closed implicitly)
 */
export function sectionRegions(xq, curves, names, tol=0.01){
  const idx = keptIndices(xq, curves, tol);
  const out = [];
  for (let k=0; k<curves.length-1; k++){
    const top=curves[k], base=curves[k+1];
    const thick = i => top[i]-base[i] > EPS;
    let run=null;
    const flush = () => {
      if (!run) return;
      // extend one kept sample either side so the piece closes where it pinches
      const lo = Math.max(0, run[0]-1), hi = Math.min(idx.length-1, run[1]+1);
      const span = idx.slice(lo, hi+1);
      const pts = [];
      for (const i of span) pts.push([xq[i], top[i]]);
      for (const i of [...span].reverse()) pts.push([xq[i], base[i]]);
      // drop consecutive duplicates (a pinched end gives top==base there)
      const clean = pts.filter((p,j)=>{ const q=pts[(j+pts.length-1)%pts.length];
        return Math.abs(p[0]-q[0])>1e-9 || Math.abs(p[1]-q[1])>1e-9; });
      if (clean.length>=3 && Math.abs(area(clean))>1e-4) out.push({ name:names[k], pts:clean });
      run=null;
    };
    for (let j=0; j<idx.length; j++){
      // a stretch between two kept samples is "in" the band if either end is thick
      if (thick(idx[j])) run = run ? [run[0], j] : [j, j];
      else flush();
    }
    flush();
  }
  return out;
}

function area(pts){
  let a=0;
  for (let i=0;i<pts.length;i++){ const p=pts[i], q=pts[(i+1)%pts.length]; a+=p[0]*q[1]-q[0]*p[1]; }
  return a/2;
}

// DXF layer names: letters, digits, _ and - only (spaces and brackets upset
// some readers). "V (CDG)" -> "V_CDG".
export function layerName(s){
  return String(s||'LAYER').trim().replace(/[^A-Za-z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,31) || 'LAYER';
}

/**
 * @param regions  from sectionRegions()
 * @param extra    [{name, pts}] further closed outlines (e.g. proposed structures)
 * @returns DXF text
 */
export function toDXF(regions, extra=[]){
  const L = [];
  const g = (code, val) => { L.push(String(code)); L.push(String(val)); };
  const all = [...regions, ...extra];
  const layers = [...new Set(all.map(r=>r.name))];
  g(0,'SECTION'); g(2,'HEADER');
  g(9,'$ACADVER'); g(1,'AC1009');
  g(9,'$INSUNITS'); g(70,6);
  g(0,'ENDSEC');
  g(0,'SECTION'); g(2,'TABLES');
  g(0,'TABLE'); g(2,'LAYER'); g(70,layers.length);
  layers.forEach((n,i)=>{ g(0,'LAYER'); g(2,n); g(70,0); g(62,(i%254)+1); g(6,'CONTINUOUS'); });
  g(0,'ENDTAB');
  g(0,'ENDSEC');
  g(0,'SECTION'); g(2,'ENTITIES');
  for (const r of all){
    g(0,'POLYLINE'); g(8,r.name); g(66,1); g(10,0); g(20,0); g(30,0); g(70,1);   // 70=1: closed
    for (const [x,y] of r.pts){ g(0,'VERTEX'); g(8,r.name); g(10,+x.toFixed(4)); g(20,+y.toFixed(4)); g(30,0); }
    g(0,'SEQEND'); g(8,r.name);
  }
  g(0,'ENDSEC');
  g(0,'EOF');
  return L.join('\r\n')+'\r\n';
}
