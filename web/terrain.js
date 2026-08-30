// Pure geometry + sampling for the Lands Department 5 m Digital Terrain Model,
// served as cached LERC elevation tiles (Web Mercator, standard Esri tile grid).
// See docs/PLAN_TERRAIN_PROFILE.md for the investigation behind this file —
// confirmed live: tiles are CORS-enabled, decode cleanly, and are already in
// mPD (RMSE 1.84 m against four surveyed collar levels, no datum offset).
//
// Kept dependency-free (like section_geom.js) so it runs under Node for the
// self-check. Tile fetching/decoding (network + wasm) lives in builder.js —
// this module only does the math, given tiles it's handed.
import { interpolateSeries } from './section_geom.js';

const R = 6378137;                 // Web Mercator sphere radius (m)
const ORIGIN = Math.PI * R;        // 20037508.342789244 — standard Esri tile origin
export const TILE_LOD = 15;        // ~4.78 m/px — matches the DTM's native 5 m grid
export const TILE_PX = 256;        // tile span in cells — governs col/row/px/py math
// Esri elevation tiles decode to (TILE_PX+1)^2 samples, not TILE_PX^2: it's a
// post-based grid (samples at cell CORNERS), so 256 cells need 257 posts per
// side. Confirmed against the live service: `lerc.decode(tile).width === 257`.
const TILE_STRIDE = TILE_PX + 1;

export function lngLatToWebMerc(lng, lat){
  const x = lng * ORIGIN / 180;
  const y = Math.log(Math.tan((90+lat)*Math.PI/360)) / (Math.PI/180) * ORIGIN / 180;
  return { x, y };
}

function lodResolution(lod){ return (2*ORIGIN) / (TILE_PX * Math.pow(2, lod)); }

/** Tile row/col and the fractional pixel position within it, for one lng/lat. */
export function tileCoord(lng, lat, lod=TILE_LOD){
  const { x, y } = lngLatToWebMerc(lng, lat);
  const res = lodResolution(lod), span = TILE_PX*res;
  const col = Math.floor((x+ORIGIN)/span), row = Math.floor((ORIGIN-y)/span);
  const px = ((x+ORIGIN)-col*span)/res, py = ((ORIGIN-y)-row*span)/res;
  return { lod, row, col, px, py };
}

/**
 * Bilinear-sample elevation at one lng/lat. `tileGetter(lod,row,col)` must
 * return the decoded Float32Array(257*257) (`lerc.decode(tile).pixels[0]`),
 * row-major, or null/undefined if that tile isn't loaded — in which case
 * this returns null (caller decides fallback).
 * ponytail: samples within a single tile only, so a point in the last pixel
 * row/col of a tile is clamped rather than blended with its neighbour tile.
 * At 4.78 m/px that's sub-pixel error — not worth a cross-tile fetch.
 */
export function sampleElevation(tileGetter, lng, lat, lod=TILE_LOD){
  const { row, col, px, py } = tileCoord(lng, lat, lod);
  const arr = tileGetter(lod, row, col);
  if (!arr) return null;
  const x0 = Math.min(Math.floor(px), TILE_PX-1), y0 = Math.min(Math.floor(py), TILE_PX-1);
  const dx = px-x0, dy = py-y0;
  const at = (x,y) => arr[y*TILE_STRIDE+x];
  return at(x0,y0)*(1-dx)*(1-dy) + at(x0+1,y0)*dx*(1-dy)
       + at(x0,y0+1)*(1-dx)*dy   + at(x0+1,y0+1)*dx*dy;
}

/**
 * Every distinct tile a straight line between two lng/lat points crosses, so
 * the caller can prefetch them all before sampling. Walks the line in
 * Web-Mercator space at half-tile-span steps — coarse, but a missed corner
 * tile just means one extra sample falls back to null, not a wrong answer.
 */
export function tilesForLine(lngA, latA, lngB, latB, lod=TILE_LOD){
  const res = lodResolution(lod), span = TILE_PX*res;
  const a = lngLatToWebMerc(lngA, latA), b = lngLatToWebMerc(lngB, latB);
  const lineLen = Math.hypot(b.x-a.x, b.y-a.y);
  const n = Math.max(1, Math.ceil(lineLen/(span*0.5)));
  const seen = new Map();
  for (let i=0; i<=n; i++){
    const t = i/n, x = a.x+(b.x-a.x)*t, y = a.y+(b.y-a.y)*t;
    const col = Math.floor((x+ORIGIN)/span), row = Math.floor((ORIGIN-y)/span);
    seen.set(`${row}/${col}`, { lod, row, col });
  }
  return [...seen.values()];
}

/**
 * The terrain-shaped ground surface (see PLAN §3, revised): the baseline is
 * the SAME straight/smooth surface the app already draws between boreholes
 * (interpolating their surveyed GL); on top of that we add the DTM's own
 * local wiggle relative to ITS OWN trend through those same station
 * distances — i.e. "how much higher/lower does the real ground get between
 * the boreholes than a straight line would suggest", sampled from the DTM.
 *
 * This — not "DTM minus a per-borehole residual" — is deliberate: a borehole
 * offset from the section line (see the offset disclosure feature) has its
 * OWN true-position DTM sample, which is a DIFFERENT ground point than the
 * DTM sampled ON the line near it. Correcting the on-line DTM by an offset
 * borehole's own residual doesn't cancel — it can swing wildly right next to
 * an off-line station (this was caught by a real 46 m-offset borehole in
 * testing: the naive residual version was off by 13.8 m at that collar).
 * The baseline+bump form sidesteps that entirely: bump(stationDist[i]) is
 * always exactly 0 by construction (interpolateSeries honours its own input
 * exactly), so corrected(stationDist[i]) === baseline(stationDist[i]) ===
 * stationGL[i] regardless of any borehole's offset from the line.
 * @param stationDist  distances along the section line of each borehole
 * @param stationGL    surveyed ground level of each borehole
 * @param queryDist    distances along the line to evaluate the surface at
 *                     (should include every value in stationDist, so the
 *                     collar-exactness above isn't left to grid-alignment luck)
 * @param queryDtm     DTM elevation sampled along the line at queryDist
 * @param method       interpolation method for both the baseline and the
 *                     DTM's own per-station trend (default 'mono': smooth,
 *                     no overshoot — appropriate for a physical ground surface)
 */
export function correctedProfile(stationDist, stationGL, queryDist, queryDtm, method='mono'){
  const baseline = interpolateSeries(stationDist, stationGL, queryDist, method);
  const dtmAtStations = interpolateSeries(queryDist, queryDtm, stationDist, method);
  const dtmBaseline = interpolateSeries(stationDist, dtmAtStations, queryDist, method);
  return queryDist.map((_,i) => baseline[i] + (queryDtm[i]-dtmBaseline[i]));
}

/**
 * Offset-aware ground surface — the apples-to-apples correction.
 *
 * `correctedProfile` above forces the section's ground line through each
 * borehole's surveyed collar level. That is only right for a borehole that
 * actually sits ON the line: an offset borehole was logged somewhere else, so
 * pinning the on-line ground to its collar level compares two different
 * points of ground.
 *
 * This version instead measures, at each borehole's OWN true position, how far
 * the surveyed collar level sits above/below what the LandsD DTM reads there:
 *     delta_i = collarGL_i − DTM(borehole_i's true easting/northing)
 * That delta is a property of the DTM itself at that spot (datum bias, canopy
 * height, survey-vs-model difference) — not of the ground's shape. Interpolating
 * delta along the line and adding it to the DTM sampled ON the line therefore
 * corrects the DTM by like for like, and leaves the real terrain shape (crest,
 * gully, cut slope) between boreholes intact.
 *
 * Consequence, and it is intended: at an OFF-line borehole the drawn ground
 * line will NOT equal that borehole's collar level — the line's ground there is
 * a different point of ground. The log rectangle is still drawn at the true
 * surveyed level, so the gap between the two is visible and honest.
 *
 * @param stationDist  distance along the line of each borehole's projection
 * @param stationGL    surveyed collar level (mPD) of each borehole
 * @param stationDtm   DTM elevation sampled at each borehole's TRUE position
 *                     (null entries are dropped — that hole just doesn't
 *                     contribute a delta)
 * @param queryDist    distances along the line to evaluate at
 * @param queryDtm     DTM sampled ON the line at queryDist
 * @param method       interpolation method for the delta series
 */
export function offsetCorrectedProfile(stationDist, stationGL, stationDtm, queryDist, queryDtm, method='mono'){
  const d=[], v=[];
  for (let i=0;i<stationDist.length;i++){
    if (stationDtm[i]==null || !Number.isFinite(stationDtm[i])) continue;
    d.push(stationDist[i]); v.push(stationGL[i]-stationDtm[i]);
  }
  if (!d.length) return queryDtm.slice();               // no usable delta: raw DTM
  const delta = interpolateSeries(d, v, queryDist, method);
  return queryDist.map((_,i)=> queryDtm[i] + delta[i]);
}
