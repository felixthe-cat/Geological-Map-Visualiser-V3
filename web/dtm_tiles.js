// LandsD 5 m DTM elevation tiles (Esri HK_DTM, LERC) — fetch, decode, cache.
// Shared by the 2D builder (terrain ground surface) and the 3D block builder.
// The pure sampling math lives in terrain.js.
// ---- LandsD 5 m DTM (terrain ground surface — see docs/PLAN_TERRAIN_PROFILE.md) ----
// LERC decoder is only fetched (117 KB wasm + 14 KB JS) the first time a
// "Ground surface" mode other than "interpolated" is actually used.
let _lerc=null;
function ensureLerc(){
  return _lerc || (_lerc=import('https://unpkg.com/lerc@4.0.4/LercDecode.es.js').then(async m=>{ await m.load(); return m; }));
}
const DTM_TILE_URL='https://tiles.arcgis.com/tiles/6j1KwZfY2fZrfNMR/arcgis/rest/services/HK_DTM/ImageServer/tile';
const dtmTileCache=new Map();      // "lod/row/col" -> Float32Array(256*256) | null (fetch failed)
export function dtmTileGetter(lod,row,col){ return dtmTileCache.get(`${lod}/${row}/${col}`) || null; }
export async function fetchDtmTile(lod,row,col){
  const key=`${lod}/${row}/${col}`;
  if (dtmTileCache.has(key)) return dtmTileCache.get(key);
  let arr=null;
  try {
    const lerc=await ensureLerc();
    const res=await fetch(`${DTM_TILE_URL}/${lod}/${row}/${col}`);
    if (res.ok) arr=lerc.decode(await res.arrayBuffer()).pixels[0];
  } catch {}
  dtmTileCache.set(key, arr);
  return arr;
}
// Fetch every tile in `tiles` that isn't cached yet, then invoke `onReady` (a
// redraw) once done — so a first-time drag renders with today's interpolated
// surface immediately, then upgrades to terrain a moment later rather than
// blocking the drag. One call per redraw (not one per tile) so the redraw
// fires once, not once per outstanding tile.
export function prefetchDtmTiles(tiles, onReady){
  const want=[...new Map(tiles.map(t=>[`${t.lod}/${t.row}/${t.col}`,t])).values()]
    .filter(t=>!dtmTileCache.has(`${t.lod}/${t.row}/${t.col}`));
  if (!want.length) return;
  Promise.all(want.map(t=>fetchDtmTile(t.lod,t.row,t.col))).then(onReady);
}
