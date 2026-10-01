// Self-check for the DXF section export. Run: node web/test_cad_export.mjs
import assert from 'node:assert';
import { sectionRegions, toDXF, layerName } from './cad_export.js';

// Three horizons over 0..10 m: a 2 m band on top, and a lens below it that is
// absent at both ends and 1 m thick in the middle.
const xq = [0,1,2,3,4,5,6,7,8,9,10];
const g  = xq.map(()=>100);
const h1 = xq.map(()=>98);
const h2 = xq.map(x=> x>=3 && x<=7 ? 97 : 98);           // lens 3..7 m
const regs = sectionRegions(xq, [g,h1,h2], ['TOP','LENS']);

const top = regs.filter(r=>r.name==='TOP'), lens = regs.filter(r=>r.name==='LENS');
assert.equal(top.length, 1, 'one top band');
// straight runs are simplified (1, 4-6, 9 dropped); the lens's own corners (2,3,7,8)
// stay on every curve, so the boundary it shares with the top band matches exactly
assert.deepEqual(top[0].pts.map(p=>p[0]), [0,2,3,7,8,10,10,8,7,3,2,0]);
assert.equal(lens.length, 1, 'lens is one closed piece');
// the lens closes to points on the shared boundary — no zero-thickness sliver
for (const [x,y] of lens[0].pts) assert(x>=2 && x<=8 && y<=98 && y>=97, `lens point ${x},${y}`);
// every vertex on the lens's top edge is also a vertex of the top band (conforming)
const topSet = new Set(top[0].pts.map(p=>p.join()));
for (const p of lens[0].pts.filter(p=>p[1]===98)) assert(topSet.has(p.join()), `shared vertex ${p}`);

// a band that pinches out in the middle splits into two pieces
const m  = xq.map(x=> x===5 ? 98 : 97);
const two = sectionRegions(xq, [h1, m], ['MID']);
assert.equal(two.length, 2, 'pinch-out in the middle -> two pieces');

assert.equal(layerName('V (CDG)'), 'V_CDG');
assert.equal(layerName('Made Ground (Concrete)'), 'Made_Ground_Concrete');

const dxf = toDXF(regs);
assert(dxf.includes('$INSUNITS\r\n70\r\n6'), 'units = metres');
assert.equal((dxf.match(/\r\nPOLYLINE\r\n/g)||[]).length, regs.length, 'one polyline per region');
assert(dxf.trimEnd().endsWith('EOF'));
console.log('cad_export.js OK — regions conform, pinch-outs split, DXF well-formed');
