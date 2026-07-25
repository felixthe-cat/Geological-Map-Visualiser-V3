// Pure geometry for the draggable cross-section line.
// Projects boreholes onto the A→B line (HK1980 metres), keeps those within a
// corridor either side, and orders them by distance along the line. Kept
// dependency-free so it runs under Node for the self-check (test_section_geom.mjs).
export function sectionStations(A, B, holes){
  const dx=B.e-A.e, dy=B.n-A.n, len=Math.hypot(dx,dy);
  const corridor=Math.max(30, len*0.4);          // half-width either side (m)
  const stations=[], inSet=new Set();
  if (len>=1){
    for (const bh of holes){
      const t=((bh.x-A.e)*dx + (bh.y-A.n)*dy)/(len*len);        // 0..1 along the line
      const perp=Math.abs((bh.x-A.e)*dy - (bh.y-A.n)*dx)/len;   // distance from the line
      // small margin so boreholes on the endpoints survive floating-point
      // round-trip error, and ones just past an end still count
      if (t>=-0.02 && t<=1.02 && perp<=corridor){ stations.push({id:bh.id, dist:t*len}); inSet.add(bh.id); }
    }
    stations.sort((p,q)=>p.dist-q.dist);
  }
  return { stations, inSet };
}
