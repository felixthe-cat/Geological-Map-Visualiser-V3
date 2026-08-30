// Pure geometry for the draggable cross-section line.
// Projects boreholes onto the A→B line (HK1980 metres), keeps those within a
// corridor either side, and orders them by distance along the line. Kept
// dependency-free so it runs under Node for the self-check (test_section_geom.mjs).
// @param extension  how far beyond A and B (metres, along the line's own
//   direction) a borehole may still project and count — lets a hole just
//   "behind" either end help the interpolation instead of being dropped the
//   instant it's outside the drawn segment. 0 = only between A and B (plus
//   the small fp-rounding margin below).
export function sectionStations(A, B, holes, corridor, extension=0){
  const dx=B.e-A.e, dy=B.n-A.n, len=Math.hypot(dx,dy);
  // half-width either side of the line (m). Caller may pass an explicit
  // tolerance (slider); otherwise scale with line length.
  if (!(corridor > 0)) corridor = Math.max(30, len*0.4);
  const stations=[], inSet=new Set();
  if (len>=1){
    // small margin so boreholes on the endpoints survive floating-point
    // round-trip error, and ones just past an end still count; `extension`
    // (metres) widens that margin deliberately, expressed as a fraction of
    // the line length since t is fractional (0=A, 1=B).
    const tMargin = 0.02 + Math.max(0, extension)/len;
    for (const bh of holes){
      const t=((bh.x-A.e)*dx + (bh.y-A.n)*dy)/(len*len);        // 0..1 along the line
      const perp=Math.abs((bh.x-A.e)*dy - (bh.y-A.n)*dx)/len;   // distance from the line
      if (t>=-tMargin && t<=1+tMargin && perp<=corridor){ stations.push({id:bh.id, dist:t*len, perp}); inSet.add(bh.id); }
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

/**
 * Interpolate the series (xs, ys) at each query x in `xq`.
 * @param extrap  what to do OUTSIDE [xs[0], xs[n-1]]:
 *   'hold'   — hold the end value flat (default; every drawn point is still
 *              defensible as "the nearest borehole's own value").
 *   'linear' — continue the trend of the outermost pair of stations. Honest
 *              only over a short run; the caller must say it's extrapolated.
 */
export function interpolateSeries(xs, ys, xq, method='linear', extrap='hold'){
  [xs, ys] = mergeTies(xs, ys);
  const n=xs.length;
  if (n===0) return xq.map(()=>0);
  if (n===1) return xq.map(()=>ys[0]);
  // End slopes for 'linear' extrapolation. For 'mono' the PCHIP end tangent is
  // the natural continuation of the fitted curve; otherwise use the raw secant
  // through the outermost two stations.
  const mEnd = (method==='mono') ? pchipTangents(xs, ys) : null;
  const slopeLo = extrap==='linear'
    ? (mEnd ? mEnd[0]   : (ys[1]-ys[0])/(xs[1]-xs[0])) : 0;
  const slopeHi = extrap==='linear'
    ? (mEnd ? mEnd[n-1] : (ys[n-1]-ys[n-2])/(xs[n-1]-xs[n-2])) : 0;
  const m = method==='mono' ? (mEnd || pchipTangents(xs, ys)) : null;
  return xq.map(x=>{
    if (x<=xs[0])   return ys[0]   + slopeLo*(x-xs[0]);
    if (x>=xs[n-1]) return ys[n-1] + slopeHi*(x-xs[n-1]);
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
 * @param extrap       'hold' (default) or 'linear' — see interpolateSeries()
 * @returns curves[k][q] = elevation of horizon k at xq[q]
 */
export function interpolateHorizons(xs, horizons, xq, method='linear', topOverride=null, extrap='hold'){
  const nH = horizons[0].length;
  const top = topOverride || interpolateSeries(xs, horizons.map(h=>h[0]), xq, method, extrap);
  const curves = [top];
  const running = top.slice();
  for (let k=1;k<nH;k++){
    // Thicknesses are extrapolated too, but clamped at 0 below — a trend
    // continued far enough always eventually drives a thickness negative, and
    // a band that pinches out is the right answer there, not an inverted one.
    const th = interpolateSeries(xs, horizons.map(h=>Math.max(0, h[k-1]-h[k])), xq, method, extrap);
    for (let q=0;q<xq.length;q++) running[q] -= Math.max(0, th[q]);
    curves.push(running.slice());
  }
  return curves;
}
