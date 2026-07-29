// Verifies the bundled example datasets against the numbers published in their
// source report — a transcription typo cannot ship silently.
// Run:  node web/test_examples.mjs
import assert from 'node:assert/strict';
import { EXAMPLES, exampleById } from './examples.js';
import { projectCSVToState } from './project_csv.js';
import { rockheadPoints } from './contour.js';

// ---- the source report's own table, transcribed independently of examples.js
// (levels in mPD, thicknesses in m, exactly as printed)
const PUBLISHED = {
  'DH 3': { gl:178.57, e:829001.64, n:827502.52, fillBase:176.97, fillTh:1.60,
            collBase:null, collTh:null, gv4:[176.97,164.41], gv4Th:12.56,
            rockhead:164.41, eoh:163.56, rock:'TUFF BRECCIA' },
  'DH 4': { gl:176.28, e:829015.24, n:827503.60, fillBase:174.98, fillTh:1.30,
            collBase:172.78, collTh:2.20, gv4:[172.78,156.06], gv4Th:16.72,
            rockhead:156.06, eoh:150.25, rock:'TUFF BRECCIA' },
  'DH 5': { gl:171.34, e:829036.19, n:827484.26, fillBase:169.04, fillTh:2.30,
            collBase:164.59, collTh:4.45, gv4:[164.59,148.91], gv4Th:15.68,
            rockhead:148.91, eoh:143.35, rock:'SILTSTONE / Coarse ash TUFF' },
  'DH 6': { gl:187.35, e:829002.50, n:827546.00, fillBase:187.25, fillTh:0.10,
            collBase:185.35, collTh:1.90, gv4:[185.35,150.76], gv4Th:34.59,
            rockhead:150.76, eoh:145.59, rock:'TUFF BRECCIA' },
};
const near = (a, b, tol=0.005) => Math.abs(a-b) <= tol;

// every example must at least parse and be non-empty
assert.ok(EXAMPLES.length >= 1);
for (const ex of EXAMPLES){
  assert.ok(ex.id && ex.name && ex.csv, 'example missing id/name/csv');
  assert.equal(exampleById(ex.id), ex, 'exampleById lookup broken');
  const st = projectCSVToState(ex.csv);
  assert.ok(st.boreholes.length > 0, ex.id+': no boreholes parsed');
  for (const bh of st.boreholes){
    assert.ok(Number.isFinite(bh.x) && Number.isFinite(bh.y) && Number.isFinite(bh.gl),
      `${ex.id}/${bh.id}: bad coordinates`);
    // layers must be contiguous from ground level down — no gaps, no overlaps
    let d = 0;
    for (const l of bh.layers){
      assert.ok(near(l.top, d), `${bh.id}: layer starts at ${l.top}, expected ${d}`);
      assert.ok(l.base > l.top, `${bh.id}: layer ${l.surface} has no thickness`);
      d = l.base;
    }
  }
}

// ---- the hillside example must reproduce its source table exactly ----------
const { boreholes } = projectCSVToState(exampleById('hillside-tuff').csv);
assert.equal(boreholes.length, 4);
for (const bh of boreholes){
  const p = PUBLISHED[bh.id];
  assert.ok(p, 'unexpected borehole '+bh.id);
  assert.ok(near(bh.gl, p.gl) && near(bh.x, p.e) && near(bh.y, p.n),
    `${bh.id}: location/GL differs from the report`);
  const lvl = depth => +(bh.gl - depth).toFixed(2);      // depth -> mPD

  const fill = bh.layers[0];
  assert.equal(fill.surface, 'Fill / Concrete');
  assert.ok(near(lvl(fill.base), p.fillBase), `${bh.id}: fill base ${lvl(fill.base)} != ${p.fillBase}`);
  assert.ok(near(fill.base-fill.top, p.fillTh), `${bh.id}: fill thickness`);

  const coll = bh.layers.find(l=>l.surface==='Colluvium');
  if (p.collBase == null) assert.equal(coll, undefined, bh.id+': report shows no colluvium');
  else {
    assert.ok(near(lvl(coll.base), p.collBase), `${bh.id}: colluvium base`);
    assert.ok(near(coll.base-coll.top, p.collTh), `${bh.id}: colluvium thickness`);
  }

  const gv4 = bh.layers.find(l=>l.surface.startsWith('Grade V to IV'));
  assert.ok(near(lvl(gv4.top), p.gv4[0]) && near(lvl(gv4.base), p.gv4[1]),
    `${bh.id}: Grade V-IV band ${lvl(gv4.top)}..${lvl(gv4.base)} != ${p.gv4.join('..')}`);
  assert.ok(near(gv4.base-gv4.top, p.gv4Th), `${bh.id}: Grade V-IV thickness`);
  // the report does not split V from IV, so the band carries no grade numeral
  assert.equal(gv4.grade, '', bh.id+': undivided V-IV band must not claim a grade');

  const rock = bh.layers[bh.layers.length-1];
  assert.equal(rock.grade, 'III', bh.id+': rock band must be tagged Grade III');
  assert.ok(rock.surface.includes(p.rock), `${bh.id}: rock type "${rock.surface}" missing "${p.rock}"`);
  assert.ok(near(lvl(rock.top), p.rockhead), `${bh.id}: rockhead ${lvl(rock.top)} != ${p.rockhead}`);
  assert.ok(near(lvl(rock.base), p.eoh), `${bh.id}: end of hole ${lvl(rock.base)} != ${p.eoh}`);
}

// rockhead as the app computes it must equal the report's published levels
const { points, missing } = rockheadPoints(boreholes, 'III');
assert.equal(missing.length, 0, 'every hole in this example proves rock');
assert.equal(points.length, 4);
for (const pt of points)
  assert.ok(near(pt.z, PUBLISHED[pt.id].rockhead),
    `${pt.id}: computed rockhead ${pt.z} != published ${PUBLISHED[pt.id].rockhead}`);
// …and it is enough holes for the Rock Contour tab (needs 3+)
assert.ok(points.length >= 3);

console.log('examples.js OK — transcription matches the source report '+
  `(${boreholes.length} drillholes, rockhead ${Math.min(...points.map(p=>p.z)).toFixed(2)} to `+
  `${Math.max(...points.map(p=>p.z)).toFixed(2)} mPD)`);
