// Self-check for the 3D block geometry. Run: node web/test_block3d.mjs
import assert from 'node:assert';
import { blockHoles, makeModel, buildBlock, sliceRuns, sliceLine, clipToRect, triangulate,
         polyArea, pointInPoly } from './block3d.js';
import { sectionRegions } from './cad_export.js';

const near=(a,b,t=1e-6)=>Math.abs(a-b)<=t;

// --- clipping + triangulation keep area exactly ---
const L=[[0,0],[10,0],[10,4],[4,4],[4,10],[0,10]];          // concave L, area 64
assert.ok(near(polyArea(L), 64));
assert.ok(near(polyArea(clipToRect(L, 2,2,6,6)), 12));      // 4×4 cell minus the 2×2 notch
const t=triangulate(L);
assert.strictEqual(t.length, 4);
assert.ok(near(t.reduce((s,[a,b,c])=>s+Math.abs(polyArea([L[a],L[b],L[c]])),0), 64));
assert.ok(pointInPoly(1,9,L) && !pointInPoly(8,8,L));

// --- model: two holes, a layer that pinches out ---
const holes=blockHoles([
  { id:'A', x:0,   y:0, gl:10, layers:[{surface:'Fill',top:0,base:2,grade:''},{surface:'CDG',top:2,base:10,grade:'V'}] },
  { id:'B', x:100, y:0, gl:20, layers:[{surface:'CDG',top:0,base:12,grade:'V'}] },
  { id:'N', x:50,  y:50, gl:5, layers:[] },                    // no log -> dropped
]);
assert.strictEqual(holes.length, 2);
const m=makeModel(holes, { top:'bh' });
assert.deepStrictEqual(m.keys, ['Fill','GV']);
assert.strictEqual(m.base, -5);                              // deepest logged level min(10-10, 20-12)=0, minus 5
const a=m.at(0,0), b=m.at(100,0);
assert.ok(near(a[0],10) && near(a[1],8) && near(a[2],-5));  // fill 2 m at A
assert.ok(near(b[0],20) && near(b[1],20));                   // no fill at B (0 thick)
const mid=m.at(50,0);
assert.ok(mid[0]>a[0] && mid[0]<b[0] && mid[1]<=mid[0]);    // monotone down
// DTM top wins where it has data, falls back to boreholes where it doesn't
const md=makeModel(holes, { top:'dtm', dtmAt:(x)=>x<50?30:null });
assert.ok(near(md.at(0,0)[0],30) && near(md.at(0,0)[1],28)); // thickness hung from DTM
assert.ok(near(md.at(100,0)[0],20));

// --- block over a concave boundary: triangle area == boundary area ---
const poly=[[0,-20],[100,-20],[100,20],[60,20],[60,0],[40,0],[40,20],[0,20]];   // U shape
const blk=buildBlock(m, poly, { maxCells:20 });
let area=0;
for (let i=0;i<blk.tris.length;i+=3){
  const p=[0,1,2].map(j=>[blk.xy[2*blk.tris[i+j]], blk.xy[2*blk.tris[i+j]+1]]);
  area+=Math.abs(polyArea(p));
}
assert.ok(near(area, Math.abs(polyArea(poly)), 1e-6), 'block area '+area);
for (let v=0; v<blk.xy.length/2; v++)                        // horizons never cross
  for (let k=1;k<blk.nH;k++) assert.ok(blk.z[v*blk.nH+k] <= blk.z[v*blk.nH+k-1]+1e-9);

// --- slice across the U: two separate pieces, ends on the boundary ---
const runs=sliceRuns(m, poly, {e:-10,n:10}, {e:110,n:10}, 2);
assert.strictEqual(runs.length, 2);
assert.ok(near(runs[0].from,10) && near(runs[0].to,50) && near(runs[1].from,70) && near(runs[1].to,110));
const regs=sectionRegions(runs[0].xq, runs[0].curves, m.keys);
assert.ok(regs.some(r=>r.name==='GV'));

// --- slice line through the bbox centre, north-south ---
const sl=sliceLine(poly, 0, 0);
assert.ok(near(sl.A.e,50) && near(sl.B.e,50) && sl.B.n>sl.A.n);

console.log('test_block3d: all checks passed');
