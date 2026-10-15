// ================================================================
// GeoVisualise — 3D soil block geometry (pure, Node-testable).
//
// Turns boreholes + a site-boundary polygon into the triangles of a layered
// block, and samples the same model along any vertical slice line.
//
// Model (kept identical to the 2D cross-section so the two always agree):
//   • strata in one global order: mean top depth, shallowest first
//   • per borehole, horizons step only DOWN; a stratum not logged = 0 thick
//   • ground = LandsD DTM or IDW of collar levels (user's choice); then each
//     stratum's THICKNESS is IDW-interpolated and hung from the ground,
//     clamped ≥ 0, so a stratum pinches out between holes rather than inverting
//   • the deepest stratum continues down to the block base
//
// All plan coordinates are HK1980 metres (x = E, y = N); levels are mPD.
// Self-check:  node web/test_block3d.mjs
// ================================================================

import { idwDelta } from './terrain.js';
import { classKey, classLabel, classColour } from './strata.js';

// ---- model -----------------------------------------------------------------

/** Holes usable for the block: logged, located. */
export function blockHoles(boreholes){
  return (boreholes||[]).filter(b => b.layers && b.layers.length &&
    Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.gl));
}

/** Global stratum order — same rule as builder.js syncDerived(). */
export function stratOrder(holes){
  const sum={}, cnt={}, label={}, colour={};
  for (const bh of holes) for (const l of bh.layers){
    const k=classKey(l);
    sum[k]=(sum[k]||0)+l.top; cnt[k]=(cnt[k]||0)+1;
    label[k]=classLabel(l); colour[k]=classColour(l);
  }
  const keys=Object.keys(sum).sort((a,b)=>sum[a]/cnt[a]-sum[b]/cnt[b]);
  return { keys, label, colour };
}

/** Horizon elevations for one hole — same rule as builder.js buildHorizons(). */
export function holeHorizons(bh, keys){
  const h=[bh.gl];
  for (const s of keys){
    const top=h[h.length-1];
    const m=bh.layers.filter(l=>classKey(l)===s);
    const deepest=m.length ? Math.max(...m.map(l=>l.base)) : null;
    h.push(deepest!=null ? Math.min(bh.gl-deepest, top) : top);
  }
  return h;
}

/** Default block base: 5 m below the deepest logged level. */
export function defaultBase(holes){
  return Math.floor(Math.min(...holes.map(b=>b.gl-Math.max(0,...b.layers.map(l=>l.base)))) - 5);
}

/**
 * @param holes   blockHoles(...)
 * @param opts    { top:'bh'|'dtm', dtmAt:(x,y)=>mPD|null, base:mPD, power }
 * @returns { keys, label, colour, base, at(x,y) -> Float64Array(nS+1) }
 *          at()[0] = ground, at()[k+1] = base of stratum k, at()[nS] = block base
 */
export function makeModel(holes, opts={}){
  const { top='bh', dtmAt=null, power=2 } = opts;
  const { keys, label, colour } = stratOrder(holes);
  const nS=keys.length;
  const base = Number.isFinite(opts.base) ? opts.base : defaultBase(holes);
  const H=holes.map(b=>holeHorizons(b, keys));
  const gl=holes.map(b=>({ e:b.x, n:b.y, delta:b.gl }));
  const th=keys.map((_,k)=>holes.map((b,i)=>({ e:b.x, n:b.y, delta:Math.max(0, H[i][k]-H[i][k+1]) })));
  function at(x, y){
    const out=new Float64Array(nS+1);
    let g = top==='dtm' && dtmAt ? dtmAt(x,y) : null;
    if (!Number.isFinite(g)) g = idwDelta(gl, x, y, power);
    out[0]=Math.max(g, base);
    for (let k=0;k<nS-1;k++) out[k+1]=Math.max(base, out[k]-Math.max(0, idwDelta(th[k], x, y, power)));
    out[nS]=base;
    return out;
  }
  return { keys, label, colour, base, at };
}

// ---- 2D polygon helpers -----------------------------------------------------

export function polyArea(p){
  let a=0;
  for (let i=0;i<p.length;i++){ const q=p[i], r=p[(i+1)%p.length]; a+=q[0]*r[1]-r[0]*q[1]; }
  return a/2;
}

export function pointInPoly(x, y, poly){   // ray casting
  let c=false;
  for (let i=0, j=poly.length-1; i<poly.length; j=i++){
    const [xi,yi]=poly[i], [xj,yj]=poly[j];
    if ((yi>y)!==(yj>y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) c=!c;
  }
  return c;
}

/** Sutherland–Hodgman: clip any polygon by an axis-aligned rectangle (convex window). */
export function clipToRect(poly, x0, y0, x1, y1){
  const edges=[
    [p=>p[0]>=x0, (a,b)=>{ const t=(x0-a[0])/(b[0]-a[0]); return [x0, a[1]+t*(b[1]-a[1])]; }],
    [p=>p[0]<=x1, (a,b)=>{ const t=(x1-a[0])/(b[0]-a[0]); return [x1, a[1]+t*(b[1]-a[1])]; }],
    [p=>p[1]>=y0, (a,b)=>{ const t=(y0-a[1])/(b[1]-a[1]); return [a[0]+t*(b[0]-a[0]), y0]; }],
    [p=>p[1]<=y1, (a,b)=>{ const t=(y1-a[1])/(b[1]-a[1]); return [a[0]+t*(b[0]-a[0]), y1]; }],
  ];
  let out=poly;
  for (const [inside, cut] of edges){
    const src=out; out=[];
    for (let i=0;i<src.length;i++){
      const a=src[(i+src.length-1)%src.length], b=src[i];
      const ia=inside(a), ib=inside(b);
      if (ib){ if (!ia) out.push(cut(a,b)); out.push(b); }
      else if (ia) out.push(cut(a,b));
    }
    if (!out.length) return out;
  }
  return out;
}

/**
 * Ear clipping. Returns index triples into `pts`.
 * ponytail: O(n³) worst case — fine for the few-vertex pieces a cell clip
 * produces; use earcut if this is ever fed whole large polygons.
 */
export function triangulate(pts){
  const n=pts.length; if (n<3) return [];
  let idx=[...Array(n).keys()];
  if (polyArea(pts)<0) idx.reverse();
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const inTri=(p,a,b,c)=>cross(a,b,p)>1e-12 && cross(b,c,p)>1e-12 && cross(c,a,p)>1e-12;
  const tris=[];
  let guard=0;
  while (idx.length>3 && guard++<10*n){
    let done=false;
    for (let i=0;i<idx.length && !done;i++){
      const ia=idx[(i+idx.length-1)%idx.length], ib=idx[i], ic=idx[(i+1)%idx.length];
      const a=pts[ia], b=pts[ib], c=pts[ic], cr=cross(a,b,c);
      if (Math.abs(cr)<1e-12){ idx.splice(i,1); done=true; break; }   // collinear: drop, no area lost
      if (cr<0) continue;                                              // reflex
      if (idx.some(j=>j!==ia && j!==ib && j!==ic && inTri(pts[j],a,b,c))) continue;
      tris.push([ia,ib,ic]); idx.splice(i,1); done=true;
    }
    if (!done) break;
  }
  if (idx.length===3 && Math.abs(cross(pts[idx[0]],pts[idx[1]],pts[idx[2]]))>1e-12) tris.push(idx);
  return tris;
}

/** Boundary ring with no edge longer than `step` (for the block's side walls). */
export function densify(poly, step){
  const out=[];
  for (let i=0;i<poly.length;i++){
    const a=poly[i], b=poly[(i+1)%poly.length];
    const m=Math.max(1, Math.ceil(Math.hypot(b[0]-a[0], b[1]-a[1])/step));
    for (let j=0;j<m;j++) out.push([a[0]+(b[0]-a[0])*j/m, a[1]+(b[1]-a[1])*j/m]);
  }
  return out;
}

// ---- block -------------------------------------------------------------------

/**
 * Triangulate the boundary on a regular grid (each cell clipped to the
 * boundary, so the edge is exact, not stair-stepped) and evaluate every
 * horizon at every vertex.
 * @returns { nH, xy:Float64Array(2V), z:Float64Array(V*nH) (z[v*nH+k]),
 *            tris:Uint32Array, ring:[[x,y]], ringZ:Float64Array(R*nH), cell }
 */
export function buildBlock(model, poly, opts={}){
  if (polyArea(poly)<0) poly=[...poly].reverse();
  const xs=poly.map(p=>p[0]), ys=poly.map(p=>p[1]);
  const xMin=Math.min(...xs), xMax=Math.max(...xs), yMin=Math.min(...ys), yMax=Math.max(...ys);
  const maxCells=opts.maxCells||120;
  const cell=opts.cell || Math.max(xMax-xMin, yMax-yMin)/maxCells;
  const nH=model.keys.length+1;
  const vkey=new Map(), xy=[], z=[], tris=[];
  const vid=(x,y)=>{
    const k=x.toFixed(3)+','+y.toFixed(3);
    let v=vkey.get(k);
    if (v===undefined){ v=xy.length/2; vkey.set(k,v); xy.push(x,y); z.push(...model.at(x,y)); }
    return v;
  };
  const full=cell*cell*(1-1e-9);
  const nx=Math.ceil((xMax-xMin)/cell), ny=Math.ceil((yMax-yMin)/cell);
  for (let j=0;j<ny;j++){
    for (let i=0;i<nx;i++){
      const x0=xMin+i*cell, y0=yMin+j*cell, x1=xMin+(i+1)*cell, y1=yMin+(j+1)*cell;
      const piece=clipToRect(poly, x0, y0, x1, y1);
      if (piece.length<3) continue;
      const a=polyArea(piece);
      if (a<1e-9) continue;
      if (a>=full){                         // whole cell inside: two triangles
        const p=[vid(x0,y0),vid(x1,y0),vid(x1,y1),vid(x0,y1)];
        tris.push(p[0],p[1],p[2], p[0],p[2],p[3]);
      } else {
        const ids=piece.map(p=>vid(p[0],p[1]));
        for (const t of triangulate(piece)) tris.push(ids[t[0]], ids[t[1]], ids[t[2]]);
      }
    }
  }
  const ring=densify(poly, cell);
  const ringZ=[];
  for (const [x,y] of ring) ringZ.push(...model.at(x,y));
  return { nH, cell, xy:Float64Array.from(xy), z:Float64Array.from(z), tris:Uint32Array.from(tris),
           ring, ringZ:Float64Array.from(ringZ) };
}

// ---- slice ---------------------------------------------------------------------

/**
 * Sample the model along the vertical plane through A→B, only where that line
 * is inside the boundary (a concave boundary can give several pieces).
 * @param A,B   {e,n}
 * @returns [{ from, to, xq:[chainage from A], curves:[horizon][q] }]
 */
export function sliceRuns(model, poly, A, B, step=1){
  const dx=B.e-A.e, dy=B.n-A.n, len=Math.hypot(dx,dy);
  if (len<1e-9) return [];
  const ux=dx/len, uy=dy/len;
  const side=p=>(p[0]-A.e)*uy-(p[1]-A.n)*ux;
  const hits=[];
  for (let i=0;i<poly.length;i++){
    const p=poly[i], q=poly[(i+1)%poly.length], sp=side(p), sq=side(q);
    if ((sp<=0&&sq>0)||(sp>0&&sq<=0)){
      const t=sp/(sp-sq), x=p[0]+(q[0]-p[0])*t, y=p[1]+(q[1]-p[1])*t;
      hits.push((x-A.e)*ux+(y-A.n)*uy);
    }
  }
  hits.sort((a,b)=>a-b);
  const runs=[];
  const nH=model.keys.length+1;
  for (let i=0;i+1<hits.length;i++){
    const lo=hits[i], hi=hits[i+1];
    if (hi-lo<1e-6) continue;
    const mid=(lo+hi)/2;
    if (!pointInPoly(A.e+ux*mid, A.n+uy*mid, poly)) continue;
    const m=Math.max(2, Math.ceil((hi-lo)/step)+1);
    const xq=[], curves=Array.from({length:nH}, ()=>[]);
    for (let j=0;j<m;j++){
      const c=lo+(hi-lo)*j/(m-1);
      const h=model.at(A.e+ux*c, A.n+uy*c);
      xq.push(c);
      for (let k=0;k<nH;k++) curves[k].push(h[k]);
    }
    runs.push({ from:lo, to:hi, xq, curves });
  }
  return runs;
}

/** End points of a slice through the boundary's bbox: centre offset `off` (m) along the
 *  normal, at azimuth `az` (degrees clockwise from north). */
export function sliceLine(poly, az, off){
  const xs=poly.map(p=>p[0]), ys=poly.map(p=>p[1]);
  const cx=(Math.min(...xs)+Math.max(...xs))/2, cy=(Math.min(...ys)+Math.max(...ys))/2;
  const half=Math.hypot(Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys))/2+1;
  const r=az*Math.PI/180, ux=Math.sin(r), uy=Math.cos(r);    // along the line
  const nx=uy, ny=-ux;                                       // normal (to the right)
  const mx=cx+nx*off, my=cy+ny*off;
  return { A:{ e:mx-ux*half, n:my-uy*half }, B:{ e:mx+ux*half, n:my+uy*half },
           normal:[nx,ny], half };
}
