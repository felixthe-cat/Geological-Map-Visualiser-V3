// ================================================================
// GeoVisualise — proposed structure (pure, Node-testable).
//
// A structure is a box: a rectangle in plan, turned to any bearing, from a
// founding level up to founding + height.
//   { e, n }      centre, HK1980 metres
//   len, wid      plan size, metres (len runs along the bearing)
//   rot           bearing of the long side, degrees clockwise from north
//   found         founding level, mPD (the underside)
//   height        metres above the founding level
//
// Self-check:  node web/test_structure.mjs
// ================================================================

/** The four plan corners, anticlockwise. */
export function footprint(s){
  const r=s.rot*Math.PI/180, ax=Math.sin(r), ay=Math.cos(r);      // unit vector along the long side
  const bx=ay, by=-ax;                                            // 90 degrees clockwise of it
  const h=s.len/2, w=s.wid/2;
  return [[-h,-w],[-h,w],[h,w],[h,-w]].map(([a,b])=>[s.e+a*ax+b*bx, s.n+a*ay+b*by]);
}

/**
 * Stretches of a straight line that lie inside a shape (outline + holes), by the even-odd
 * rule: sort the crossings and pair them up.
 * @param rings  [outline, ...holes], each [[x,y]…]
 * @param A      [x,y] a point on the line; `u` its unit direction
 * @returns [[t0,t1]…] distances along the line from A
 */
export function lineSpans(rings, A, u){
  const ts=[];
  for (const r of rings) for (let i=0;i<r.length;i++){
    const a=r[i], b=r[(i+1)%r.length];
    const da=(a[0]-A[0])*u[1]-(a[1]-A[1])*u[0], db=(b[0]-A[0])*u[1]-(b[1]-A[1])*u[0];   // signed distance from the line
    if ((da>0)===(db>0)) continue;
    const f=da/(da-db), x=a[0]+f*(b[0]-a[0]), y=a[1]+f*(b[1]-a[1]);
    ts.push((x-A[0])*u[0]+(y-A[1])*u[1]);
  }
  ts.sort((p,q)=>p-q);
  const out=[];
  for (let i=0;i+1<ts.length;i+=2) if (ts[i+1]-ts[i]>=0.01) out.push([ts[i], ts[i+1]]);
  return out;
}

/**
 * Earthworks for the box, with vertical sides straight down (or up) from the footprint.
 * The footprint is sampled on a grid; each sample is a column of ground.
 * @param s      the structure
 * @param at     (e,n) -> horizons, top of each layer from the ground down, last = model base
 * @param nLayers number of layers (horizons.length - 1)
 * @param inside optional (e,n) -> bool: only count ground inside the site boundary
 * @returns {
 *   area          plan area counted, m2
 *   cut, fill     m3: ground above the founding level to dig out / gap below it to fill
 *   cutByLayer    m3 dug from each layer
 *   atFound       share (0-1) of the footprint founded on each layer; .air = founding level above ground
 *   gMin,gMax,gMean  existing ground level under the footprint, mPD
 *   belowBase     true if the founding level is below the model's base somewhere
 *   covered       share of the footprint that is inside the site (1 = all of it)
 * }
 * ponytail: vertical cut faces, no side slopes or working space; add batter if tender quantities are wanted.
 */
export function earthworks(s, at, nLayers, inside=null, n=48){
  const r=s.rot*Math.PI/180, ax=Math.sin(r), ay=Math.cos(r), bx=ay, by=-ax;
  const na=Math.max(2, Math.min(n, Math.ceil(s.len))), nb=Math.max(2, Math.min(n, Math.ceil(s.wid)));   // ~1 m cells, capped
  const dA=(s.len/na)*(s.wid/nb);
  const cutByLayer=new Array(nLayers).fill(0), share=new Array(nLayers).fill(0);
  let cut=0, fill=0, air=0, cnt=0, gSum=0, gMin=Infinity, gMax=-Infinity, belowBase=false;
  for (let i=0;i<na;i++) for (let j=0;j<nb;j++){
    const a=-s.len/2+(i+0.5)*s.len/na, b=-s.wid/2+(j+0.5)*s.wid/nb;
    const e=s.e+a*ax+b*bx, nn=s.n+a*ay+b*by;
    if (inside && !inside(e,nn)) continue;
    const h=at(e,nn), g=h[0];
    cnt++; gSum+=g; gMin=Math.min(gMin,g); gMax=Math.max(gMax,g);
    if (s.found>=g){ fill+=(s.found-g)*dA; air++; continue; }
    cut+=(g-s.found)*dA;
    let hit=false;
    for (let k=0;k<nLayers;k++){
      const top=h[k], base=h[k+1];
      cutByLayer[k]+=Math.max(0, top-Math.max(base, s.found))*dA;
      if (!hit && s.found<top && s.found>=base){ share[k]++; hit=true; }
    }
    if (!hit){ share[nLayers-1]++; belowBase=true; }         // deeper than the model goes: the deepest layer is assumed
  }
  const total=na*nb;
  return { area:cnt*dA, cut, fill, cutByLayer, atFound:Object.assign(share.map(v=>cnt?v/cnt:0), { air: cnt?air/cnt:0 }),
    gMin: cnt?gMin:null, gMax: cnt?gMax:null, gMean: cnt?gSum/cnt:null, belowBase, covered:cnt/total };
}
