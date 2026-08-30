// Self-check for the DTM tile math and residual correction. Run: node web/test_terrain.mjs
import assert from 'node:assert';
import { lngLatToWebMerc, tileCoord, sampleElevation, tilesForLine, correctedProfile, offsetCorrectedProfile, TILE_LOD, TILE_PX } from './terrain.js';

// Reference point (Route Twisk hillside example) and reference values hand-computed
// during the investigation (docs/PLAN_TERRAIN_PROFILE.md) against the live service.
const lat=22.3881, lng=114.1039;
const { x, y } = lngLatToWebMerc(lng, lat);
assert(Math.abs(x - 12701988.0) < 1, `webmerc x off: ${x}`);
assert(Math.abs(y - 2558185.5) < 1, `webmerc y off: ${y}`);

const tc = tileCoord(lng, lat, 15);
assert.strictEqual(tc.row, 14292, `tile row: ${tc.row}`);
assert.strictEqual(tc.col, 26769, `tile col: ${tc.col}`);
assert(tc.px>=0 && tc.px<TILE_PX && tc.py>=0 && tc.py<TILE_PX, 'pixel offset within tile bounds');

// ---- bilinear sampling -----------------------------------------------------
// A synthetic tile: elevation = px (so exact interpolation is easy to check by
// hand). Esri elevation tiles decode to (TILE_PX+1)^2 samples — post-based,
// corners of 256 cells — confirmed against the live service (width===257).
const STRIDE = TILE_PX+1;
const tile = new Float32Array(STRIDE*STRIDE);
for (let py=0; py<STRIDE; py++) for (let px=0; px<STRIDE; px++) tile[py*STRIDE+px]=px;
const getter = (lod,row,col) => (row===tc.row && col===tc.col) ? tile : null;
const v = sampleElevation(getter, lng, lat, 15);
assert(Math.abs(v - tc.px) < 1e-6, `bilinear sample should equal px for a px-ramp tile: got ${v}, want ${tc.px}`);
assert.strictEqual(sampleElevation((lod,row,col)=>null, lng, lat, 15), null, 'missing tile -> null, not a crash');

// ---- tilesForLine -----------------------------------------------------------
// A short line inside one ~1223 m tile at LOD 15 should stay in a single tile
// (reference point sits mid-tile north-south, py≈66 of 256 — plenty of room).
const short = tilesForLine(lng, lat, lng, lat+0.0005, 15);
assert.strictEqual(short.length, 1, `short line should touch one tile, got ${short.length}`);
// A long line (~2 tile-spans) must touch more than one.
const long = tilesForLine(lng, lat, lng+0.03, lat, 15);
assert(long.length >= 2, `long line should touch multiple tiles, got ${long.length}`);

// ---- terrain-shaped corrected profile ---------------------------------------
// Station distances/GL match the DTM shape below (no offset involved): the
// corrected surface must reproduce the surveyed GL EXACTLY at every station
// (queryDist includes both station distances), and follow the DTM's crest
// shape elsewhere rather than flattening to a straight line.
{
  const stationDist = [0, 70];
  const stationGL   = [187.35, 171.34];
  const queryDist = [0, 20, 35, 50, 70];
  const queryDtm  = [187.35, 186.0, 185.2, 178.0, 171.34];   // real hillside shape (crest mid-span)
  const corrected = correctedProfile(stationDist, stationGL, queryDist, queryDtm);
  assert(Math.abs(corrected[0] - 187.35) < 1e-9, 'corrected surface must hit the surveyed GL exactly at station 0');
  assert(Math.abs(corrected[4] - 171.34) < 1e-9, 'corrected surface must hit the surveyed GL exactly at station 1');
  const straightLineAt35 = 187.35 + (171.34-187.35)*(35/70);
  assert(corrected[2] > straightLineAt35 + 3, 'corrected surface should preserve the real mid-span crest, not flatten to a straight line');
}

// ---- regression: an OFFSET borehole must not blow up the surface near it ---
// This is the exact bug caught live: a borehole far off the section line (its
// own DTM sample is a genuinely different ground point than the DTM sampled
// ON the line nearby) must not make the corrected surface swing wildly right
// next to it. Reproduces the real worked-example case: DH3 and DH6 project to
// almost the same distance along the line (6.64 m apart by only 0.86 m) but
// DH6 sits 46 m off the line, so a naive "DTM(true collar) − GL" residual
// swung from −1.97 to +2.47 across that 0.86 m gap — a near-vertical jump
// that, sampled a few centimetres off a station, was 13.8 m wrong.
{
  const stationDist = [6.64, 7.50, 20.24, 41.19];
  const stationGL   = [178.57, 187.35, 176.28, 171.34];        // DH3, DH6, DH4, DH5
  // Dense on-line query grid that does NOT land exactly on the station
  // distances (the real bug trigger) — smooth DTM profile ON THE LINE,
  // unrelated to DH6's own (off-line, much higher) true elevation.
  const queryDist = Array.from({length:200}, (_,i)=>6.64 + (41.19-6.64)*i/199);
  const queryDtm  = queryDist.map(d => 180 + 3*Math.sin(d/6));   // smooth, no cliff
  const corrected = correctedProfile(stationDist, stationGL, queryDist, queryDtm);
  // nearest query index to each station distance
  stationDist.forEach((sd,i)=>{
    let best=0, bd=Infinity;
    queryDist.forEach((d,q)=>{ const dd=Math.abs(d-sd); if(dd<bd){bd=dd;best=q;} });
    assert(Math.abs(corrected[best]-stationGL[i]) < 0.5,
      `corrected surface near station ${i} (${bd.toFixed(3)} m off-grid) should stay close to its GL ${stationGL[i]}, got ${corrected[best].toFixed(2)}`);
  });
}


// ---- offsetCorrectedProfile: the apples-to-apples ground surface ------------
// The correction must be "surveyed collar minus DTM AT THAT BOREHOLE", applied
// to the DTM sampled ON the line — NOT "force the line through the collar".
{
  const stationDist=[0,100,200];
  const stationGL  =[50,52,49];
  // The DTM reads a constant 2 m high at all three boreholes' own positions
  const stationDtm =[52,54,51];
  const queryDist=Array.from({length:41},(_,i)=>i*5);
  const queryDtm =queryDist.map(d=>45+5*Math.sin(d/25));       // real shape on the line
  const out=offsetCorrectedProfile(stationDist, stationGL, stationDtm, queryDist, queryDtm);
  // A uniform -2 m bias must come out as exactly the line DTM shifted by -2 m,
  // with the terrain's own shape untouched.
  out.forEach((v,i)=>assert(Math.abs(v-(queryDtm[i]-2))<1e-9,
    `uniform bias should shift the line DTM by -2 m at d=${queryDist[i]}: got ${v}`));

  // A borehole with no DTM cover simply contributes no correction.
  const gappy=offsetCorrectedProfile(stationDist, stationGL, [52,null,51], queryDist, queryDtm);
  assert(gappy.every(Number.isFinite), 'a null station DTM sample must not poison the profile');
  // …and with NO station cover at all it falls back to the raw DTM.
  const none=offsetCorrectedProfile(stationDist, stationGL, [null,null,null], queryDist, queryDtm);
  none.forEach((v,i)=>assert(v===queryDtm[i], 'no usable delta must fall back to the raw DTM'));
}
// Deliberate difference from correctedProfile: at an OFF-line borehole the
// surface does NOT get forced back to that borehole's collar level.
{
  const out=offsetCorrectedProfile([0,100],[50,80],[52,52],[0,50,100],[52,52,52]);
  assert(Math.abs(out[1]-(52+(-2+28)/2))<1e-9,
    'the delta itself is what gets interpolated along the line, got '+out[1]);
}

console.log('ok — terrain tile math + residual & offset correction checks pass');
