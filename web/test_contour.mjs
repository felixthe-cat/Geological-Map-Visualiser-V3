// Self-check for contour.js — run:  node web/test_contour.mjs
import assert from 'node:assert/strict';
import { rockheadPoints, gridInterp, contourLevels, contourLines, placeLabels } from './contour.js';

// ---- rockhead extraction -------------------------------------------------
const bhs = [
  { id:'BH-1', x:0,   y:0,   gl:20, layers:[
      {surface:'Fill',top:0,base:3,grade:''},
      {surface:'CDG', top:3,base:10,grade:'V (CDG)'},
      {surface:'HDG', top:10,base:14,grade:'IV (HDG)'},
      {surface:'MDG', top:14,base:20,grade:'III (MDG)'} ] },      // rockhead = 20-14 = 6
  { id:'BH-2', x:100, y:0,   gl:18, layers:[
      {surface:'CDG', top:0,base:8,grade:'V (CDG)'},
      {surface:'Granite',top:8,base:15,grade:'II (SDG)'} ] },      // rockhead = 18-8 = 10
  { id:'BH-3', x:0,   y:100, gl:25, layers:[
      {surface:'CDG', top:0,base:20,grade:'V (CDG)'} ] },          // rock not reached
];
const { points, missing } = rockheadPoints(bhs, 'III');
assert.equal(points.length, 2);
assert.equal(missing.length, 1);
assert.equal(missing[0].id, 'BH-3');
assert.equal(points.find(p=>p.id==='BH-1').z, 6);
assert.equal(points.find(p=>p.id==='BH-2').z, 10);

// Grade II definition drops BH-1's MDG layer -> its rockhead is unproved
const strict = rockheadPoints(bhs, 'II');
assert.equal(strict.points.length, 1);
assert.equal(strict.points[0].id, 'BH-2');

// ---- interpolation -------------------------------------------------------
// IDW must honour the data exactly at the borehole locations…
const g = gridInterp(points, { method:'idw', n:40 });
const at = (x,y)=>{ const i=Math.round((x-g.x0)/g.cell), j=Math.round((y-g.y0)/g.cell); return g.z[j*g.nx+i]; };
assert.ok(Math.abs(at(0,0)-6) < 0.35, 'IDW near BH-1: '+at(0,0));
assert.ok(Math.abs(at(100,0)-10) < 0.35, 'IDW near BH-2: '+at(100,0));
// …and stay inside the data range everywhere (no invented over/undershoot)
for (const v of g.z) assert.ok(v>=6-1e-9 && v<=10+1e-9, 'IDW out of range: '+v);

// Nearest neighbour is piecewise-constant: every cell equals one input value
const gn = gridInterp(points, { method:'nearest', n:30 });
for (const v of gn.z) assert.ok(v===6 || v===10, 'NN produced an interpolated value: '+v);

// ---- contouring ----------------------------------------------------------
// levels are clipped to the grid's own range (IDW only reaches 6/10 at the
// borehole nodes themselves, so the whole-metre levels inside are 7–9)
const levels = contourLevels(g, 1);
assert.deepEqual(levels, [7,8,9]);
const cs = contourLines(g, levels);
// every level must produce geometry, and every vertex must sit on the grid
assert.ok(cs.every(c=>c.lines.length>0), 'missing contour geometry');
for (const c of cs) for (const line of c.lines) for (const [x,y] of line){
  assert.ok(x>=g.x0-1e-6 && x<=g.x0+(g.nx-1)*g.cell+1e-6, 'vertex off grid');
  assert.ok(y>=g.y0-1e-6 && y<=g.y0+(g.ny-1)*g.cell+1e-6, 'vertex off grid');
}
// a contour on a monotonic surface should be one continuous line, not confetti
const l8 = cs.find(c=>c.level===8);
assert.ok(l8.lines.length <= 2, 'level 8 fragmented into '+l8.lines.length+' lines');
assert.ok(l8.lines[0].length > 5, 'level 8 line too short: '+l8.lines[0].length);

// planar surface sanity: z = x/10 -> the 5 m contour is a straight vertical line
const plane = [ {id:'a',x:0,y:0,z:0}, {id:'b',x:100,y:0,z:10},
                {id:'c',x:0,y:100,z:0}, {id:'d',x:100,y:100,z:10} ];
const gp = gridInterp(plane, { method:'idw', n:60, padFrac:0 });
const c5 = contourLines(gp, [5])[0];
const xs = c5.lines.flat().map(p=>p[0]);
assert.ok(Math.max(...xs)-Math.min(...xs) < 12, 'planar 5 m contour not straight: '+(Math.max(...xs)-Math.min(...xs)));

// ---- label de-clutter ------------------------------------------------------
const hit = (a,b) => a.x < b.x+b.w && b.x < a.x+a.w && a.y < b.y+b.h && b.y < a.y+a.h;

// 6 callouts on nearly the same spot — the collision case from the site plan
const cluster = Array.from({length:6},(_,i)=>({ key:'BH-'+i, x:200+i*6, y:200+i*4, w:96, h:22 }));
const placed = placeLabels(cluster);
assert.equal(placed.length, 6);
for (let i=0;i<placed.length;i++){
  for (let j=i+1;j<placed.length;j++)
    assert.ok(!hit(placed[i].box, placed[j].box),
      `callout ${placed[i].key} still overlaps ${placed[j].key}`);
  // every callout must stay tethered: a leader line back to its own point
  const p=placed[i];
  assert.ok(p.leader, p.key+' has no leader line');
  assert.deepEqual(p.leader[0], [p.x, p.y], p.key+' leader must start at the borehole');
  // and stay reasonably close to it
  assert.ok(Math.hypot(p.dx, p.dy) < 220, p.key+' pushed too far: '+Math.hypot(p.dx,p.dy).toFixed(0));
}

// callouts must dodge fixed obstacles (contour labels / borehole symbols) too
const obstacles = [{x:210,y:190,w:40,h:14}, {x:150,y:230,w:60,h:14}];
const dodged = placeLabels([{key:'A',x:200,y:200,w:90,h:22}], { obstacles });
for (const o of obstacles) assert.ok(!hit(dodged[0].box, o), 'callout sits on an obstacle');

// an isolated point should get the nearest slot (immediately east) and no detour
const lone = placeLabels([{key:'L',x:500,y:500,w:80,h:20}])[0];
assert.ok(lone.placed && Math.abs(lone.dx-9) < 1e-9 && Math.abs(lone.dy+10) < 1e-9,
  'isolated callout should take the closest slot, got '+JSON.stringify(lone));

// 55 callouts on a real-site-sized canvas (the CEDD test site) must all be
// placed cleanly — this is the case that beat the first, 80px-radius version
const many = Array.from({length:55},(_,i)=>({ key:'B'+i, w:104, h:24,
  x: 120 + (i%9)*90 + (i%3)*13, y: 90 + Math.floor(i/9)*95 + (i%4)*11 }));
const manyPlaced = placeLabels(many, { bounds:{x:0,y:0,w:1500,h:800} });
const kept = manyPlaced.filter(p=>p.placed);
assert.ok(kept.length >= 50, `only ${kept.length}/55 dense callouts placed`);
for (let i=0;i<kept.length;i++) for (let j=i+1;j<kept.length;j++)
  assert.ok(!hit(kept[i].box, kept[j].box), `dense: ${kept[i].key} overlaps ${kept[j].key}`);
// dropped ones are reported, never silently drawn on top of something
assert.ok(manyPlaced.filter(p=>!p.placed).every(p=>p.leader===null));
// nothing may be placed outside the given bounds
for (const p of kept)
  assert.ok(p.box.x>=0 && p.box.y>=0 && p.box.x+p.box.w<=1500 && p.box.y+p.box.h<=800,
    p.key+' placed outside the canvas');

console.log('contour.js OK — rockhead extraction, IDW/nearest interpolation, marching-squares contours, label de-clutter');
