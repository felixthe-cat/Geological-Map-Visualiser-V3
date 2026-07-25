// Round-trip verification for the project CSV (save → reload loses nothing).
// Run:  node web/test_project_csv.mjs
import assert from 'node:assert/strict';
import { stateToProjectCSV, projectCSVToState, csvToBoreholes, splitCSVLine } from './project_csv.js';

// A state exercising every awkward case: trial pits, grades, negative/decimal
// elevations, a description containing a comma AND a quote, an id with a space.
const state = {
  mode: 'elevation',
  sitePlan: { bounds:{ latMin:22.306412, latMax:22.311633, lngMin:114.159939, lngMax:114.166977,
                       eMin:834000.1, eMax:834800.2, nMin:818000.3, nMax:818900.4 } },
  boreholes: [
    { id:'BH 1', x:836694.05, y:819069.8, gl:12.34, kind:'BH', layers:[
      { surface:'Fill', top:0, base:2.5, grade:'' },
      { surface:'Completely decomposed granite, silty SAND (12" core)', top:2.5, base:18.75, grade:'V (CDG)' },
      { surface:'Granite', top:18.75, base:25, grade:'II (SDG)' } ] },
    { id:'TP-2', x:836700.5, y:819100.25, gl:-3.5, kind:'TP', layers:[
      { surface:'Made Ground (Concrete)', top:0, base:1.2, grade:'' } ] },
  ]
};
const sectionLine = { a:[22.30700, 114.16000], b:[22.31100, 114.16600] };

// ---- exact round trip ------------------------------------------------------
const csv = stateToProjectCSV(state, sectionLine);
const back = projectCSVToState(csv);

assert.equal(back.mode, state.mode);
assert.deepEqual(back.bounds, state.sitePlan.bounds);
assert.deepEqual(back.sectionLine, sectionLine);
assert.equal(back.boreholes.length, state.boreholes.length);
state.boreholes.forEach((bh, i) => {
  const b = back.boreholes[i];
  for (const f of ['id','x','y','gl','kind']) assert.deepEqual(b[f], bh[f], `${bh.id}.${f}`);
  assert.equal(b.layers.length, bh.layers.length, bh.id+' layer count');
  bh.layers.forEach((l, k) => {
    for (const f of ['surface','top','base','grade'])
      assert.deepEqual(b.layers[k][f], l[f], `${bh.id} layer ${k}.${f}: got ${JSON.stringify(b.layers[k][f])}`);
  });
});

// re-exporting the reloaded state must produce byte-identical CSV (idempotent)
assert.equal(stateToProjectCSV({ mode:back.mode, sitePlan:{bounds:back.bounds}, boreholes:back.boreholes },
  back.sectionLine), csv, 'second export differs from the first');

// ---- the awkward field really survived -------------------------------------
const desc = back.boreholes[0].layers[1].surface;
assert.ok(desc.includes(','), 'comma lost from the description');
assert.ok(desc.includes('"'), 'quote lost from the description');
assert.equal(desc, state.boreholes[0].layers[1].surface);
assert.equal(back.boreholes[0].id, 'BH 1', 'space in the borehole id lost');
assert.equal(back.boreholes[1].kind, 'TP', 'trial-pit kind lost');
assert.equal(back.boreholes[1].gl, -3.5, 'negative ground level lost');

// ---- no boundary / no section line (a hand-typed project) ------------------
const bare = projectCSVToState(stateToProjectCSV({ mode:'depth', sitePlan:null,
  boreholes:[{ id:'A', x:1, y:2, gl:3, kind:'BH', layers:[{surface:'Fill',top:0,base:1,grade:''}] }] }, null));
assert.equal(bare.bounds, null);
assert.equal(bare.sectionLine, null);
assert.equal(bare.mode, 'depth');

// ---- legacy 7-column CSV still imports (no #GEOVIS header) -----------------
const legacy = `borehole_id,x,y,surface,top_depth,base_depth,ground_level
BH-1,840000,820000,Soil,0,5,15
BH-1,840000,820000,Rock,5,20,15`;
const l1 = projectCSVToState(legacy);
assert.equal(l1.boreholes.length, 1);
assert.equal(l1.boreholes[0].layers.length, 2);
assert.equal(l1.boreholes[0].kind, 'BH');
assert.equal(csvToBoreholes(legacy)[0].gl, 15);

// ---- quoted-field splitter edge cases -------------------------------------
assert.deepEqual(splitCSVLine('a,"b,c","say ""hi""",'), ['a','b,c','say "hi"','']);

// ---- layers are re-sorted by depth, not by file order ---------------------
const shuffled = projectCSVToState(
  '#GEOVIS {"v":1}\nborehole_id,x,y,ground_level,kind,surface,top_depth,base_depth,grade\n'+
  'B,0,0,10,BH,Lower,5,9,\nB,0,0,10,BH,Upper,0,5,\n');
assert.deepEqual(shuffled.boreholes[0].layers.map(l=>l.surface), ['Upper','Lower']);

console.log('project_csv.js OK — full save/resume round trip is lossless (incl. commas, quotes, TP kind, grades, boundary, section line)');
