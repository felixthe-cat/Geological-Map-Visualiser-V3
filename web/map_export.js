// ================================================================
// GeoVisualise — export a Leaflet map view (basemap tiles + our own
// overlays) to a PNG the user can drop straight into a report.
//
// Why we redraw instead of screenshotting: a canvas can only be read back with
// toDataURL() if every image drawn into it came with CORS headers. Verified
// against the live servers: Google (mt1.google.com), Esri World Imagery and OSM
// all send `Access-Control-Allow-Origin: *`, so all three export as-is —
// whatever the user picked is what lands in the PNG, no substitution.
//
// `maxNativeZoom` is the deepest zoom a source actually holds imagery for.
// Beyond it a server returns a placeholder ("Map data not yet available" grey
// for Esri), so we fetch the deepest real tiles and scale them up, exactly as
// Leaflet does on screen.
// ================================================================

export const BASEMAPS = {
  'Google Hybrid': { url:'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
                     maxZoom:20, maxNativeZoom:20, attribution:'Google Hybrid' },
  'Satellite (Esri)': { url:'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                     maxZoom:20, maxNativeZoom:19, attribution:'Imagery © Esri, Maxar, Earthstar Geographics' },
  'OpenStreetMap': { url:'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
                     maxZoom:20, maxNativeZoom:19, attribution:'© OpenStreetMap contributors' },
  'Plain (no basemap)': { url:null, attribution:'' }
};

function loadImg(src){
  return new Promise(res=>{
    const im=new Image();
    im.crossOrigin='anonymous';
    im.onload=()=>res(im); im.onerror=()=>res(null);   // a missing tile just stays blank
    im.src=src;
  });
}

function tileUrl(tpl, x, y, z){
  return tpl.replace('{s}', 'abc'[(x+y)%3]).replace('{x}',x).replace('{y}',y).replace('{z}',z);
}

// Paint the basemap tiles covering the map's current view into `ctx`.
// When the view is zoomed past the source's real imagery, tiles are taken from
// its deepest available zoom and drawn scaled up — same as Leaflet on screen,
// and it avoids the servers' "no data" placeholder tiles.
async function drawTiles(map, ctx, tpl, maxNativeZoom){
  const pb = map.getPixelBounds(), z = map.getZoom();
  const zt = Math.min(z, maxNativeZoom==null ? z : maxNativeZoom);
  const ts = 256 * Math.pow(2, z - zt);          // screen px covered by one source tile
  const jobs = [];
  for (let tx=Math.floor(pb.min.x/ts); tx<=Math.floor(pb.max.x/ts); tx++)
    for (let ty=Math.floor(pb.min.y/ts); ty<=Math.floor(pb.max.y/ts); ty++)
      jobs.push({ tx, ty, px: tx*ts - pb.min.x, py: ty*ts - pb.min.y });
  const imgs = await Promise.all(jobs.map(j=>loadImg(tileUrl(tpl, j.tx, j.ty, zt))));
  jobs.forEach((j,i)=>{ if (imgs[i]) ctx.drawImage(imgs[i], j.px, j.py, ts, ts); });
  return imgs.filter(Boolean).length + '/' + jobs.length;
}

/**
 * @param map        Leaflet map to export (current view = exported extent)
 * @param opts.name        download filename
 * @param opts.basemap     key of BASEMAPS currently shown ('' / 'Plain…' = none)
 * @param opts.title       optional title drawn top-left
 * @param opts.draw        (ctx, project) => void — paint overlays; `project`
 *                         turns [lat,lng] into [x,y] canvas pixels
 * @returns {Promise<string>} a short status message
 */
export async function exportMapPNG(map, opts={}){
  const size = map.getSize();
  const scale = 2;                                    // 2× for print-quality output
  const cv = document.createElement('canvas');
  cv.width = size.x*scale; cv.height = size.y*scale;
  const ctx = cv.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,size.x,size.y);

  // Export the base map the user actually chose — no substitution.
  const bm = BASEMAPS[opts.basemap] || null;
  let note = '';
  if (bm && bm.url){
    const got = await drawTiles(map, ctx, bm.url, bm.maxNativeZoom);
    const [ok, all] = got.split('/').map(Number);
    if (ok < all) note = ` (${all-ok} of ${all} ${opts.basemap} tiles did not load)`;
  }

  const project = ll => { const p = map.latLngToContainerPoint(L.latLng(ll[0], ll[1])); return [p.x, p.y]; };
  if (opts.draw) opts.draw(ctx, project);

  // frame + title + attribution, so the image stands alone in a report
  ctx.strokeStyle='#1a1a0f'; ctx.lineWidth=1.5; ctx.strokeRect(.75,.75,size.x-1.5,size.y-1.5);
  if (opts.title){
    ctx.font='700 14px Outfit, sans-serif';
    const w = ctx.measureText(opts.title).width + 16;
    ctx.fillStyle='rgba(255,255,255,.88)'; ctx.fillRect(8,8,w,24);
    ctx.strokeStyle='#1a1a0f'; ctx.lineWidth=1; ctx.strokeRect(8.5,8.5,w,24);
    ctx.fillStyle='#1a1a0f'; ctx.fillText(opts.title, 16, 25);
  }
  const attr = (bm && bm.attribution) || '';
  if (attr){
    ctx.font='9px Outfit, sans-serif';
    const w = ctx.measureText(attr).width + 8;
    ctx.fillStyle='rgba(255,255,255,.8)'; ctx.fillRect(size.x-w-4, size.y-16, w, 12);
    ctx.fillStyle='#333'; ctx.fillText(attr, size.x-w, size.y-7);
  }

  let url;
  try { url = cv.toDataURL('image/png'); }
  catch { return 'Export failed: the base map blocked canvas read-back. Switch the base map (or pick “Plain”) and retry.'; }
  const a=document.createElement('a'); a.download=opts.name||'map.png'; a.href=url;
  document.body.appendChild(a); a.click(); a.remove();
  return '✓ Image exported ('+cv.width+'×'+cv.height+' px, '+(opts.basemap||'no base map')+').'+note;
}

// ---- overlay painters shared by the site plan & contour exports -------------
export function paintPolyline(ctx, project, lls, style={}){
  if (lls.length<2) return;
  ctx.save();
  ctx.strokeStyle=style.color||'#000'; ctx.lineWidth=style.weight||1;
  if (style.dash) ctx.setLineDash(style.dash);
  ctx.beginPath();
  lls.forEach((ll,i)=>{ const [x,y]=project(ll); i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
  if (style.close) ctx.closePath();
  ctx.stroke(); ctx.restore();
}
export function paintMarker(ctx, project, ll, label, style={}){
  const [x,y]=project(ll), r=style.radius||5;
  ctx.save();
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
  ctx.fillStyle=style.fill||'#2f5a1e'; ctx.fill();
  ctx.lineWidth=style.weight||1.2; ctx.strokeStyle=style.stroke||'#1a1a0f'; ctx.stroke();
  if (label){
    ctx.font=(style.font||'600 10px Outfit, sans-serif');
    ctx.lineWidth=3; ctx.strokeStyle='#fff'; ctx.strokeText(label, x+r+3, y+3);
    ctx.fillStyle=style.labelColour||'#1a1a0f'; ctx.fillText(label, x+r+3, y+3);
  }
  ctx.restore();
}
export function paintText(ctx, project, ll, text, style={}){
  const [x,y]=project(ll);
  ctx.save();
  ctx.font=style.font||'700 10px Outfit, sans-serif';
  ctx.textAlign=style.align||'center';
  ctx.lineWidth=3.5; ctx.strokeStyle=style.halo||'#fff'; ctx.strokeText(text,x,y);
  ctx.fillStyle=style.color||'#000'; ctx.fillText(text,x,y);
  ctx.restore();
}
