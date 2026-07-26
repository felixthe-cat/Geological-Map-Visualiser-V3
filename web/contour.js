// ================================================================
// GeoVisualise — rockhead contouring (pure, Node-testable).
//
// Rockhead ("rock level") = the elevation of the top of the shallowest layer
// classified at or better than a chosen decomposition grade. HK practice
// normally takes Grade III (moderately decomposed) as the top of *rock*; some
// reports want Grade II. Both are offered.
//
// Pipeline:  boreholes -> rockheadPoints -> gridInterp -> contourLines
// All coordinates are HK1980 metres (E/N); the caller converts to lat/lng.
//
// Self-check:  node web/test_contour.mjs
// ================================================================

const GRADE_RANK = { VI:6, V:5, IV:4, III:3, II:2, I:1 };   // lower = harder rock
function gradeRoman(grade){ const m=/^(VI|IV|III|II|V|I)\b/.exec((grade||'').trim()); return m?m[1]:''; }

/**
 * Rockhead elevation per borehole.
 * @param boreholes [{id,x,y,gl,layers:[{top,base,grade}]}]
 * @param maxGrade  'III' (default) or 'II' — the weakest grade counted as rock
 * @returns {points:[{id,x,y,z,depth}], missing:[{id,x,y,gl,depth}]}
 *          `missing` = boreholes where rock was never proved (annotated on the
 *          plan as "rock not encountered", never silently interpolated away).
 */
export function rockheadPoints(boreholes, maxGrade='III'){
  const limit = GRADE_RANK[maxGrade] || 3;
  const points=[], missing=[];
  for (const bh of boreholes||[]){
    if (!Number.isFinite(bh.x) || !Number.isFinite(bh.y) || !Number.isFinite(bh.gl)) continue;
    let top=null;
    for (const l of (bh.layers||[])){
      const r = GRADE_RANK[gradeRoman(l.grade)];
      if (r && r<=limit && Number.isFinite(l.top)){ if (top===null || l.top<top) top=l.top; }
    }
    if (top===null){
      const deepest = (bh.layers||[]).reduce((m,l)=>Math.max(m, +l.base||0), 0);
      missing.push({ id:bh.id, x:bh.x, y:bh.y, gl:bh.gl, depth:deepest });
    } else {
      points.push({ id:bh.id, x:bh.x, y:bh.y, z:bh.gl-top, depth:top });
    }
  }
  return { points, missing };
}

/**
 * Interpolate a regular grid of rockhead elevation.
 * @param method 'idw'      — inverse-distance weighting (smooth, default).
 *               'nearest'  — nearest neighbour (blocky Thiessen polygons; shows
 *                            the raw data honestly with no invented gradients).
 * @returns {x0,y0,cell,nx,ny,z:Float64Array}  z[j*nx+i], null-free
 */
export function gridInterp(points, opts={}){
  const { method='idw', power=2, n=90, padFrac=0.08, bounds=null } = opts;
  if (!points.length) throw new Error('No rockhead points.');
  let xMin,xMax,yMin,yMax;
  if (bounds){ ({xMin,xMax,yMin,yMax}=bounds); }
  else {
    xMin=Math.min(...points.map(p=>p.x)); xMax=Math.max(...points.map(p=>p.x));
    yMin=Math.min(...points.map(p=>p.y)); yMax=Math.max(...points.map(p=>p.y));
  }
  const spanX=(xMax-xMin)||10, spanY=(yMax-yMin)||10;
  const pad=Math.max(spanX,spanY)*padFrac;
  xMin-=pad; xMax+=pad; yMin-=pad; yMax+=pad;
  const cell=Math.max(spanX+2*pad, spanY+2*pad)/n;
  const nx=Math.max(2,Math.ceil((xMax-xMin)/cell)+1), ny=Math.max(2,Math.ceil((yMax-yMin)/cell)+1);
  const z=new Float64Array(nx*ny);
  for (let j=0;j<ny;j++) for (let i=0;i<nx;i++){
    const gx=xMin+i*cell, gy=yMin+j*cell;
    let num=0, den=0, best=Infinity, bestZ=points[0].z, exact=null;
    for (const p of points){
      const d2=(p.x-gx)**2 + (p.y-gy)**2;
      if (d2<1e-6){ exact=p.z; break; }
      if (d2<best){ best=d2; bestZ=p.z; }
      const w=1/Math.pow(d2, power/2);
      num+=w*p.z; den+=w;
    }
    z[j*nx+i] = exact!=null ? exact : (method==='nearest' ? bestZ : num/den);
  }
  return { x0:xMin, y0:yMin, cell, nx, ny, z };
}

/** Nice contour levels covering the grid at `interval` m, aligned to the interval. */
export function contourLevels(grid, interval){
  let lo=Infinity, hi=-Infinity;
  for (const v of grid.z){ if(v<lo) lo=v; if(v>hi) hi=v; }
  const out=[];
  for (let l=Math.ceil(lo/interval)*interval; l<=hi; l+=interval) out.push(+l.toFixed(6));
  return out;
}

// Marching squares: one level -> stitched polylines in grid coordinates (metres).
// ponytail: segment-stitching by rounded endpoint key — adequate for the ~90×90
// grids here; swap for a topology-aware tracer only if grids get much larger.
function levelSegments(grid, level){
  const {x0,y0,cell,nx,ny,z}=grid;
  const segs=[];
  const ip=(za,zb,a,b)=>{ const t=(level-za)/(zb-za); return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t]; };
  for (let j=0;j<ny-1;j++) for (let i=0;i<nx-1;i++){
    const z00=z[j*nx+i], z10=z[j*nx+i+1], z11=z[(j+1)*nx+i+1], z01=z[(j+1)*nx+i];
    const p00=[x0+i*cell, y0+j*cell], p10=[x0+(i+1)*cell, y0+j*cell],
          p11=[x0+(i+1)*cell, y0+(j+1)*cell], p01=[x0+i*cell, y0+(j+1)*cell];
    // crossings on the four cell edges (bottom, right, top, left)
    const pts=[];
    if ((z00<level)!==(z10<level)) pts.push(ip(z00,z10,p00,p10));
    if ((z10<level)!==(z11<level)) pts.push(ip(z10,z11,p10,p11));
    if ((z11<level)!==(z01<level)) pts.push(ip(z11,z01,p11,p01));
    if ((z01<level)!==(z00<level)) pts.push(ip(z01,z00,p01,p00));
    if (pts.length===2) segs.push([pts[0],pts[1]]);
    else if (pts.length===4){ segs.push([pts[0],pts[1]]); segs.push([pts[2],pts[3]]); }
  }
  return segs;
}
function stitch(segs, tol){
  const key=p=>`${Math.round(p[0]/tol)},${Math.round(p[1]/tol)}`;
  const used=new Array(segs.length).fill(false);
  const byKey=new Map();
  segs.forEach((s,i)=>{ for (const p of s){ const k=key(p); if(!byKey.has(k)) byKey.set(k,[]); byKey.get(k).push(i); } });
  const lines=[];
  for (let i=0;i<segs.length;i++){
    if (used[i]) continue;
    used[i]=true;
    const line=[segs[i][0], segs[i][1]];
    for (const dir of [0,1]){                 // extend backwards, then forwards
      for(;;){
        const end = dir ? line[line.length-1] : line[0];
        const cands = byKey.get(key(end))||[];
        const nxt = cands.find(k=>!used[k]);
        if (nxt==null) break;
        used[nxt]=true;
        const s=segs[nxt];
        const add = key(s[0])===key(end) ? s[1] : s[0];
        if (dir) line.push(add); else line.unshift(add);
      }
    }
    lines.push(line);
  }
  return lines;
}

/** @returns [{level, lines:[[ [x,y], ... ]]}] in HK1980 metres */
export function contourLines(grid, levels){
  return levels.map(level=>({ level, lines: stitch(levelSegments(grid, level), grid.cell/4)
    .filter(l=>l.length>=2) }));
}

// ---- label de-clutter (screen pixels) --------------------------------------
// Borehole callouts on a dense site overlap each other, the borehole symbols and
// the contour-level labels. Same idea as the borehole log's label placement:
// push each callout to the first free slot around its point and draw a leader
// line back to it, rather than letting boxes pile up.
//
// ponytail: greedy first-fit over a fixed ring of candidate slots — O(n²)
// overlap tests, fine for the ~10² callouts a site plan ever shows. A proper
// force-directed / simulated-annealing placer only earns its keep beyond that.
export function overlaps(a, b, pad=1){
  return a.x < b.x+b.w+pad && b.x < a.x+a.w+pad && a.y < b.y+b.h+pad && b.y < a.y+a.h+pad;
}
function overlapArea(a, b){
  const w = Math.min(a.x+a.w, b.x+b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y+a.h, b.y+b.h) - Math.max(a.y, b.y);
  return (w>0 && h>0) ? w*h : 0;
}

/**
 * @param anchors   [{key, x, y, w, h}] — point to label (px) + the label box size
 * @param obstacles [{x, y, w, h}] — boxes already on the drawing (contour labels,
 *                  borehole symbols) that callouts must dodge
 * @param radii     distances from the point to try, nearest first
 * @returns [{key, x, y, dx, dy, box, leader:[[x,y],[x,y]], placed}]
 *          `dx/dy` = box top-left relative to the point; `leader` = the line
 *          from the point to the nearest edge of the box (null when it touches).
 */
export function placeLabels(anchors, opts={}){
  // A dense site (50+ holes) needs to search well beyond the symbol: the whole
  // point of a leader line is that the text can sit some distance away.
  const { obstacles=[], radii=[9, 16, 26, 40, 58, 80, 110, 145, 185, 230],
          dirs=12, bounds=null } = opts;
  const taken = obstacles.slice();
  const out = [];
  // label the tightest-packed points first: they have the fewest free slots
  const density = a => anchors.reduce((n,b)=> n + ((b!==a && Math.hypot(b.x-a.x, b.y-a.y) < 70) ? 1 : 0), 0);
  const order = anchors.map(a=>({a, d:density(a)})).sort((p,q)=> q.d-p.d || p.a.y-q.a.y);
  const inBounds = b => !bounds ||
    (b.x >= bounds.x && b.y >= bounds.y && b.x+b.w <= bounds.x+bounds.w && b.y+b.h <= bounds.y+bounds.h);

  for (const { a } of order){
    let best=null, bestPen=Infinity, clean=null;
    for (const r of radii){
      for (let k=0; k<dirs && !clean; k++){
        // slot centres ring the point; east at k=0 reproduces the tight "text to
        // the right of the symbol" placement an uncrowded label should get
        const ang=(k/dirs)*2*Math.PI, c=Math.cos(ang), s=Math.sin(ang);
        const dx=c*(r + a.w/2) - a.w/2, dy=s*(r + a.h/2) - a.h/2;
        const box={ x:a.x+dx, y:a.y+dy, w:a.w, h:a.h };
        if (!inBounds(box)) continue;
        let pen=r*0.35;                      // prefer slots close to the point
        for (const t of taken) if (overlaps(box,t)) pen += overlapArea(box,t) + 40;
        if (pen < bestPen){ bestPen=pen; best={dx,dy,box}; }
        if (pen <= r*0.35+1e-9) clean=best;   // genuinely free slot — take it
      }
      if (clean) break;
    }
    if (!best) continue;                     // nowhere on the canvas at all
    // No free slot anywhere: drop the label rather than overprint the drawing.
    // The caller keeps the symbol (with a hover tooltip) and reports the count.
    if (!clean){
      out.push({ key:a.key, x:a.x, y:a.y, dx:best.dx, dy:best.dy, box:best.box,
                 leader:null, placed:false });
      continue;
    }
    taken.push(clean.box);
    // leader line: point -> nearest edge of the box (skip when the box touches it)
    const cx=Math.max(clean.box.x, Math.min(a.x, clean.box.x+clean.box.w));
    const cy=Math.max(clean.box.y, Math.min(a.y, clean.box.y+clean.box.h));
    const leader = Math.hypot(cx-a.x, cy-a.y) > 4 ? [[a.x,a.y],[cx,cy]] : null;
    out.push({ key:a.key, x:a.x, y:a.y, dx:clean.dx, dy:clean.dy, box:clean.box,
               leader, placed:true });
  }
  return out;
}
