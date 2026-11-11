// Self-check for structure.js:  node web/test_structure.mjs
import assert from 'node:assert/strict';
import { footprint, lineSpans, earthworks } from './structure.js';
const near=(a,b,t=1e-6)=>Math.abs(a-b)<=t;
const area=p=>p.reduce((s,q,i)=>{ const r=p[(i+1)%p.length]; return s+q[0]*r[1]-r[0]*q[1]; },0)/2;

// --- footprint: size, winding, rotation ---
const S={ e:100, n:200, len:20, wid:10, rot:0, found:5, height:12 };
let f=footprint(S);
assert.ok(near(area(f), 200));                                   // anticlockwise, 20 x 10
assert.ok(near(Math.max(...f.map(p=>p[1]))-Math.min(...f.map(p=>p[1])), 20));   // rot 0: long side runs north
f=footprint({ ...S, rot:90 });
assert.ok(near(Math.max(...f.map(p=>p[0]))-Math.min(...f.map(p=>p[0])), 20));   // rot 90: long side runs east
f=footprint({ ...S, rot:45 });
assert.ok(near(area(f), 200) && near(Math.max(...f.map(p=>p[0]))-Math.min(...f.map(p=>p[0])), 30/Math.SQRT2*1, 1e-6)); // (20+10)/sqrt2

// --- lineSpans: a line through a square with a courtyard ---
const sq=(x,y,w)=>[[x,y],[x+w,y],[x+w,y+w],[x,y+w]];
assert.deepEqual(lineSpans([sq(0,0,10)], [-5,5], [1,0]).map(s=>s.map(Math.round)), [[5,15]]);
assert.deepEqual(lineSpans([sq(0,0,10), sq(4,4,2)], [-5,5], [1,0]).map(s=>s.map(Math.round)), [[5,9],[11,15]]);
assert.equal(lineSpans([sq(0,0,10)], [-5,20], [1,0]).length, 0);  // misses

// --- earthworks on flat ground at +10 mPD: two layers, 3 m of fill over rock to 0 mPD ---
const flat=()=>[10, 7, 0];
let w=earthworks(S, flat, 2);                                     // founding +5: dig 5 m over 200 m2
assert.ok(near(w.cut, 1000) && near(w.fill, 0) && near(w.area, 200));
assert.ok(near(w.cutByLayer[0], 600) && near(w.cutByLayer[1], 400));    // 3 m of layer 1, 2 m of layer 2
assert.ok(near(w.atFound[1], 1) && near(w.atFound.air, 0) && !w.belowBase);
w=earthworks({ ...S, found:12 }, flat, 2);                        // founding +12: 2 m above ground
assert.ok(near(w.fill, 400) && near(w.cut, 0) && near(w.atFound.air, 1));
w=earthworks({ ...S, found:-3 }, flat, 2);                        // deeper than the model
assert.ok(w.belowBase && near(w.cut, 2600));
// --- sloping ground (rises 1 m per m eastwards, +10 at the centre): cut and fill balance at founding +10 ---
w=earthworks({ ...S, rot:90, found:10 }, (e)=>[10+(e-100), -50], 1);
assert.ok(near(w.cut, w.fill, 1e-6) && w.cut>0 && near(w.gMean, 10));
// --- only the part inside the site is counted ---
w=earthworks(S, flat, 2, (e)=>e>=100);
assert.ok(near(w.covered, 0.5) && near(w.cut, 500));

console.log('test_structure: all checks passed');
