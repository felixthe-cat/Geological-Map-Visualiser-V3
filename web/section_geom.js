// Pure geometry for the draggable cross-section line.
// Projects boreholes onto the A→B line (HK1980 metres), keeps those within a
// corridor either side, and orders them by distance along the line. Kept
// dependency-free so it runs under Node for the self-check (test_section_geom.mjs).
export function sectionStations(A, B, holes, corridor){
  const dx=B.e-A.e, dy=B.n-A.n, len=Math.hypot(dx,dy);
  // half-width either side of the line (m). Caller may pass an explicit
  // tolerance (slider); otherwise scale with line length.
  if (!(corridor > 0)) corridor = Math.max(30, len*0.4);
  const stations=[], inSet=new Set();
  if (len>=1){
    for (const bh of holes){
      const t=((bh.x-A.e)*dx + (bh.y-A.n)*dy)/(len*len);        // 0..1 along the line
      const perp=Math.abs((bh.x-A.e)*dy - (bh.y-A.n)*dx)/len;   // distance from the line
      // small margin so boreholes on the endpoints survive floating-point
      // round-trip error, and ones just past an end still count
      if (t>=-0.02 && t<=1.02 && perp<=corridor){ stations.push({id:bh.id, dist:t*len, perp}); inSet.add(bh.id); }
    }
    stations.sort((p,q)=>p.dist-q.dist);
  }
  return { stations, inSet };
}

// ---- horizon interpolation between boreholes -------------------------------
// Three methods, all evaluated at arbitrary query distances along the section:
//   'linear'  — straight lines between logged boreholes (the classic hand-drawn
//               section; every point is defensible from the data).
//   'mono'    — monotone cubic (PCHIP, Fritsch–Carlson). Smooth, and unlike a
//               natural cubic spline it CANNOT overshoot past the neighbouring
//               logged values, so a smoothed horizon never invents a bulge
//               above ground or a spurious basin between two boreholes.
//   'nearest' — nearest neighbour: each borehole's log is held constant out to
//               the midpoint of the gap (a "no interpolation" honest view).
export const INTERP_METHODS = ['linear', 'mono', 'nearest'];

// Two boreholes can project to the SAME distance along the section line (they
// sit either side of it, or they are co-located). A zero-length interval makes
// every slope (y[i+1]-y[i])/0 either ±Infinity or — when the two values are
// equal, which is the common case for a stratum absent from both logs — 0/0 =
// NaN, which then poisons the whole curve. Collapse ties to one station holding
// the mean before interpolating.
function mergeTies(xs, ys, eps=1e-6){
  const ox=[], oy=[], n=[];
  for (let i=0;i<xs.length;i++){
    if (ox.length && xs[i]-ox[ox.length-1] <= eps){
      const j=oy.length-1; n[j]++; oy[j] += (ys[i]-oy[j])/n[j];      // running mean
    } else { ox.push(xs[i]); oy.push(ys[i]); n.push(1); }
  }
  return [ox, oy];
}

function pchipTangents(xs, ys){
  const n=xs.length, d=new Array(n-1), m=new Array(n);
  for (let i=0;i<n-1;i++) d[i]=(ys[i+1]-ys[i])/(xs[i+1]-xs[i]);
  m[0]=d[0]; m[n-1]=d[n-2];
  for (let i=1;i<n-1;i++){
    if (d[i-1]*d[i] <= 0) m[i]=0;                 // local extremum -> flat, no overshoot
    else {
      const w1=2*(xs[i+1]-xs[i])+(xs[i]-xs[i-1]), w2=(xs[i+1]-xs[i])+2*(xs[i]-xs[i-1]);
      m[i]=(w1+w2)/(w1/d[i-1] + w2/d[i]);         // weighted harmonic mean
    }
  }
  return m;
}

/** Interpolate the series (xs, ys) at each query x in `xq`. */
export function interpolateSeries(xs, ys, xq, method='linear'){
  [xs, ys] = mergeTies(xs, ys);
  const n=xs.length;
  if (n===0) return xq.map(()=>0);
  if (n===1) return xq.map(()=>ys[0]);
  const m = method==='mono' ? pchipTangents(xs, ys) : null;
  return xq.map(x=>{
    if (x<=xs[0]) return ys[0];
    if (x>=xs[n-1]) return ys[n-1];
    let i=0; while (i<n-2 && xs[i+1]<x) i++;
    const h=xs[i+1]-xs[i], t=(x-xs[i])/h;
    if (method==='nearest') return t<0.5 ? ys[i] : ys[i+1];
    if (method!=='mono') return ys[i]+(ys[i+1]-ys[i])*t;
    const t2=t*t, t3=t2*t;                           // cubic Hermite basis
    return (2*t3-3*t2+1)*ys[i] + (t3-2*t2+t)*h*m[i]
         + (-2*t3+3*t2)*ys[i+1] + (t3-t2)*h*m[i+1];
  });
}

/**
 * Interpolate a whole stack of horizons without ever letting two of them cross.
 * Trick: interpolate the top surface and each stratum THICKNESS separately.
 * Thicknesses are ≥0 at every borehole and none of the three methods overshoots
 * below the neighbouring values, so every interpolated thickness stays ≥0 —
 * i.e. bands can pinch out but never invert.
 * @param xs        station distances along the section
 * @param horizons  horizons[s] = [topElev, boundary1, boundary2, …] for station s
 *                  (non-increasing within each station)
 * @param xq        query distances
 * @param topOverride  optional precomputed top surface (e.g. terrain-derived,
 *                     see terrain.js) to hang the strata bands from instead
 *                     of the boreholes' own interpolated ground level
 * @returns curves[k][q] = elevation of horizon k at xq[q]
 */
export function interpolateHorizons(xs, horizons, xq, method='linear', topOverride=null){
  const nH = horizons[0].length;
  const top = topOverride || interpolateSeries(xs, horizons.map(h=>h[0]), xq, method);
  const curves = [top];
  const running = top.slice();
  for (let k=1;k<nH;k++){
    const th = interpolateSeries(xs, horizons.map(h=>Math.max(0, h[k-1]-h[k])), xq, method);
    for (let q=0;q<xq.length;q++) running[q] -= Math.max(0, th[q]);
    curves.push(running.slice());
  }
  return curves;
}
