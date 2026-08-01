// Self-check for the cross-section projection. Run: node web/test_section_geom.mjs
import assert from 'node:assert';
import { sectionStations, interpolateSeries, interpolateHorizons } from './section_geom.js';

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
assert(Math.abs(stations[1].perp - 5) < 1e-9, 'B is 5 m off the line — perpendicular offset carried through');
assert(Math.abs(stations[0].perp - 0) < 1e-9, 'A sits exactly on the line — zero offset');

// Explicit tolerance narrows the corridor: B (5 m off) drops out at tol=3 m.
const tight = sectionStations({e:0,n:0}, {e:100,n:0}, holes, 3);
assert.deepStrictEqual(tight.stations.map(s=>s.id), ['A','C'], 'tol=3m excludes B (5m off the line)');

// Degenerate (zero-length) line yields nothing to draw.
assert.strictEqual(sectionStations({e:0,n:0}, {e:0,n:0}, holes).stations.length, 0, 'zero-length line -> no stations');

// ---- interpolation methods ------------------------------------------------
const xs = [0, 100, 200, 300];
const ys = [10, 12,  4,   6];
const xq = Array.from({length:61}, (_,i)=>i*5);

for (const method of ['linear','mono','nearest']){
  const v = interpolateSeries(xs, ys, xq, method);
  // every method must pass exactly through the logged boreholes
  xs.forEach((x,i)=>assert(Math.abs(v[xq.indexOf(x)] - ys[i]) < 1e-9, method+' must honour the data at x='+x));
  // and never leave the data range (no invented peaks/troughs)
  assert(Math.min(...v) >= Math.min(...ys)-1e-9 && Math.max(...v) <= Math.max(...ys)+1e-9,
    method+' overshot the data range');
}
// linear is exactly the midpoint; nearest holds the left value until halfway
assert(Math.abs(interpolateSeries(xs,ys,[50],'linear')[0] - 11) < 1e-9);
assert.strictEqual(interpolateSeries(xs,ys,[49],'nearest')[0], 10);
assert.strictEqual(interpolateSeries(xs,ys,[51],'nearest')[0], 12);
// mono is smooth: it leaves the local max (x=100) flat, so at x=125 it still
// sits well above the straight line, and it is symmetric about the midpoint.
const mono125 = interpolateSeries(xs,ys,[125],'mono')[0];
assert(mono125 > interpolateSeries(xs,ys,[125],'linear')[0] + 0.5, 'mono should curve away from linear');
assert(Math.abs(interpolateSeries(xs,ys,[150],'mono')[0] - 8) < 1e-9, 'mono is flat-ended at a local max');

// stacked horizons must never cross, whatever the method — BH2 has a pinched-out
// middle stratum (zero thickness), the classic case that makes splines invert.
const horizons = [[20, 15,  9, 2], [18, 12, 12, 5], [25, 20, 11, 0]];
for (const method of ['linear','mono','nearest']){
  const curves = interpolateHorizons([0,100,200], horizons, xq.filter(x=>x<=200), method);
  for (let k=0;k<curves.length-1;k++)
    for (let q=0;q<curves[k].length;q++)
      assert(curves[k][q] >= curves[k+1][q] - 1e-9,
        `${method}: horizon ${k} crossed below ${k+1} at q=${q}`);
  // and still honour each borehole's own logged horizons
  horizons.forEach((h,s)=>h.forEach((e,k)=>
    assert(Math.abs(curves[k][s*20] - e) < 1e-9, `${method}: horizon ${k} wrong at station ${s}`)));
}

// Two boreholes projecting to the SAME distance along the line must not produce
// NaN/Infinity — the 0/0 slope case that showed up as "<polygon> points: NaN".
const tieX = [0, 100, 100, 200];
for (const method of ['linear','mono','nearest']){
  for (const tieY of [[10, 8, 8, 4],      // equal values at the tie -> 0/0
                      [10, 8, 6, 4],      // different values -> ±Infinity slope
                      [10, 10, 10, 10]]){ // completely flat
    const v = interpolateSeries(tieX, tieY, xq.concat([100, 99.999, 100.001]), method);
    assert(v.every(Number.isFinite), `${method} produced a non-finite value for ties ${tieY}: `+
      v.filter(x=>!Number.isFinite(x)).slice(0,3));
  }
}
// and the stacked-horizon path with tied stations stays finite AND ordered
const tiedH = [[20,15,9,2],[18,12,12,5],[18,12,12,5],[25,20,11,0]];
for (const method of ['linear','mono','nearest']){
  const curves = interpolateHorizons([0,100,100,200], tiedH, xq.concat([100]), method);
  for (let k=0;k<curves.length;k++){
    assert(curves[k].every(Number.isFinite), `${method}: NaN in tied horizon ${k}`);
    if (k<curves.length-1) for (let q=0;q<curves[k].length;q++)
      assert(curves[k][q] >= curves[k+1][q] - 1e-9, `${method}: tied horizons crossed at q=${q}`);
  }
}

console.log('ok — section projection + interpolation checks pass (incl. tied stations)');
