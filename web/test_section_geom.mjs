// Self-check for the cross-section projection. Run: node web/test_section_geom.mjs
import assert from 'node:assert';
import { sectionStations } from './section_geom.js';

// A→B along the x-axis, 0..100 m. C sits on it, D is 500 m off to the side.
const holes = [
  { id:'A', x:0,   y:0   },
  { id:'B', x:50,  y:5   },   // 5 m off the line — inside the 40 m corridor
  { id:'C', x:100, y:0   },   // exactly on the far endpoint
  { id:'D', x:150, y:500 },   // far past the end and way off to the side
];
const { stations, inSet } = sectionStations({e:0,n:0}, {e:100,n:0}, holes);

assert.deepStrictEqual(stations.map(s=>s.id), ['A','B','C'], 'D must be excluded; A/B/C ordered along the line');
assert(inSet.has('A') && inSet.has('C'), 'endpoint boreholes must not be dropped by fp round-trip');
assert(!inSet.has('D'), 'borehole outside the corridor must be excluded');
assert(Math.abs(stations[1].dist - 50) < 1e-9, 'B projects to 50 m along the line');

// Degenerate (zero-length) line yields nothing to draw.
assert.strictEqual(sectionStations({e:0,n:0}, {e:0,n:0}, holes).stations.length, 0, 'zero-length line -> no stations');

console.log('ok — section projection checks pass');
