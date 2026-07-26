// ================================================================
// GeoVisualise — Site Map (client-side)
// Leaflet map + draw-rectangle -> auto-filled bbox coords ->
// bbox search against the pre-downloaded CSDI borehole index.
// Replaces the Folium/Hugging Face map so it renders instantly.
// ================================================================

const CDN = {
  leafletCss : 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  leafletJs  : 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  drawCss    : 'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css',
  drawJs     : 'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js',
  proj4      : 'https://cdn.jsdelivr.net/npm/proj4@2.11.0/dist/proj4.js'
};

// Hong Kong 1980 Grid System (EPSG:2326)
const HK1980 =
  '+proj=tmerc +lat_0=22.31213333333334 +lon_0=114.1785555555556 +k=1 ' +
  '+x_0=836694.05 +y_0=819069.8 +ellps=intl ' +
  '+towgs84=-162.619,-276.959,-161.764,0.067753,-2.243649,-1.158827,-1.094246 ' +
  '+units=m +no_defs';

const BOREHOLE_INDEX = 'data/boreholes.csv';
const AGS_REPNOS_URL = 'data/ags_repnos.json';              // report numbers that have digital AGS
const HF_SPACE = 'ferxxxxx/Geological-Map-Visualiser-V3';   // stratigraphy backend (CEDD AGS)
// Import caps, set from measured scaling (see the benchmark in the session notes:
// 9-layer holes, worst interaction = section/contour redraw on a 1440x900 desktop)
//   300 -> ~115 ms   500 -> ~240 ms   800 -> ~380 ms
//  1000 -> ~840 ms  1500 -> ~1.7 s   2000 -> everything over 800 ms
// Real sites (CSDI index, AGS stations per 500 m box): median 10, p95 128,
// p99 258, busiest in Hong Kong 653 — so 1000 covers every real site with room
// to spare, and beyond it the tool stops feeling instant.
const MAX_IMPORT = 1000;          // hard cap on boreholes pushed to the builder
const SOFT_IMPORT = 500;          // above this, warn that redraws get slower
const MAX_PLOT = 1500;            // markers drawn on the site map

let AGS_SET = null;   // Set of REPNOs that have AGS data

async function ensureAgsSet(){
  if (AGS_SET) return AGS_SET;
  try {
    const r = await fetch(AGS_REPNOS_URL);
    AGS_SET = new Set((await r.json()).map(String));
  } catch { AGS_SET = new Set(); }
  return AGS_SET;
}

// status shown right below the "Load into 2D Builder" button
function setLoadStatus(msg, cls){
  const el = document.getElementById('load-status');
  if (!el) return;
  el.style.display = 'block'; el.className = 'status ' + (cls || ''); el.textContent = msg;
}
const toast = {
  show(m){ window.GeoToast && window.GeoToast.show(m); },
  hide(){ window.GeoToast && window.GeoToast.hide(); }
};

let map = null, drawnLayer = null, resultLayer = null;
let INDEX = null;              // [{repno,statno,stattype,lat,lon,e,n,gl,depth}]
let lastResults = [];
let lastRepnos = [];           // CEDD report numbers behind that load (for the original-AGS download)
let lastBounds = null;         // {latMin,latMax,lngMin,lngMax,eMin,eMax,nMin,nMax} of the drawn rectangle
let onLoadTo2D = null;

// Boreholes carry far more information than trial pits — list/select them first.
// STATTYPE 'TP' is the CSDI trial-pit code; everything else (DH, RC, RCG, GCOP, ...) sorts first.
function isTrialPit(b){ return (b.stattype||'').trim().toUpperCase() === 'TP'; }
function boreholesFirst(a, b){
  const ta = isTrialPit(a), tb = isTrialPit(b);
  if (ta !== tb) return ta ? 1 : -1;
  return (a.statno||'').localeCompare(b.statno||'', undefined, {numeric:true});
}

// ---- asset loading ---------------------------------------------------
function loadCss(href){
  return new Promise(res=>{
    if ([...document.styleSheets].some(s=>s.href===href)) return res();
    const l=document.createElement('link'); l.rel='stylesheet'; l.href=href;
    l.onload=res; l.onerror=res; document.head.appendChild(l);
  });
}
function loadJs(src){
  return new Promise((res,rej)=>{
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s=document.createElement('script'); s.src=src;
    s.onload=res; s.onerror=()=>rej(new Error('Failed to load '+src));
    document.head.appendChild(s);
  });
}

function setStatus(msg, cls){
  const el = document.getElementById('map-status');
  if (!el) return;
  el.style.display='block'; el.className='status '+(cls||''); el.textContent=msg;
}

// Load Leaflet (+ draw + proj4) once and register the HK1980 projection.
// Shared with builder.js so the cross-section satellite map reuses the same libs.
export async function ensureMapLibs(){
  await Promise.all([loadCss(CDN.leafletCss), loadCss(CDN.drawCss)]);
  await loadJs(CDN.leafletJs);
  await Promise.all([loadJs(CDN.drawJs), loadJs(CDN.proj4)]);
  proj4.defs('HK1980', HK1980);
}

// ---- borehole index --------------------------------------------------
async function ensureIndex(){
  if (INDEX) return INDEX;
  setStatus('Loading borehole index (first use only)…','busy');
  const r = await fetch(BOREHOLE_INDEX);
  if (!r.ok) throw new Error('Could not load '+BOREHOLE_INDEX+' ('+r.status+')');
  const text = await r.text();
  const lines = text.split('\n');
  const out = [];
  for (let i=1;i<lines.length;i++){
    const L=lines[i]; if(!L) continue;
    const p=L.split(',');
    if (p.length<9) continue;
    out.push({ repno:p[0], statno:p[1], stattype:p[2], lat:+p[3], lon:+p[4],
               e:p[5]===''?null:+p[5], n:p[6]===''?null:+p[6],
               gl:p[7]===''?null:+p[7], depth:p[8]===''?null:+p[8] });
  }
  INDEX = out;
  setStatus(`Borehole index ready — ${out.length.toLocaleString()} CSDI boreholes available offline.`,'ok');
  return INDEX;
}

// ---- coordinate helpers ---------------------------------------------
function toHK1980(lon, lat){
  // proj4(from, to, coords) — returns [easting, northing]
  const [e,n] = proj4('EPSG:4326', 'HK1980', [lon, lat]);
  return { e, n };
}

function fillBboxFields(bounds){
  const sw = bounds.getSouthWest(), ne = bounds.getNorthEast();
  // WGS84
  document.getElementById('bb-lat-min').value = sw.lat.toFixed(6);
  document.getElementById('bb-lat-max').value = ne.lat.toFixed(6);
  document.getElementById('bb-lng-min').value = sw.lng.toFixed(6);
  document.getElementById('bb-lng-max').value = ne.lng.toFixed(6);
  // HK1980 — convert both corners
  const a = toHK1980(sw.lng, sw.lat), b = toHK1980(ne.lng, ne.lat);
  const eMin=Math.min(a.e,b.e), eMax=Math.max(a.e,b.e), nMin=Math.min(a.n,b.n), nMax=Math.max(a.n,b.n);
  document.getElementById('bb-e-min').value = eMin.toFixed(1);
  document.getElementById('bb-e-max').value = eMax.toFixed(1);
  document.getElementById('bb-n-min').value = nMin.toFixed(1);
  document.getElementById('bb-n-max').value = nMax.toFixed(1);
  lastBounds = { latMin:sw.lat, latMax:ne.lat, lngMin:sw.lng, lngMax:ne.lng, eMin, eMax, nMin, nMax };
}

// ---- search ----------------------------------------------------------
// An empty <input type=number> reads as '' and `+'' === 0`, which is a finite
// number — so a blank box used to "search" lat/lng 0,0 and report 0 boreholes
// instead of telling the user to draw a rectangle. Treat blank as missing.
function readCoord(id){
  const el=document.getElementById(id);
  const raw=(el && el.value || '').trim();
  return raw === '' ? NaN : +raw;
}
async function searchBbox(){
  const latMin=readCoord('bb-lat-min');
  const latMax=readCoord('bb-lat-max');
  const lngMin=readCoord('bb-lng-min');
  const lngMax=readCoord('bb-lng-max');
  if (![latMin,latMax,lngMin,lngMax].every(Number.isFinite)){
    setStatus('Draw a rectangle on the map first (or type a full bounding box — all four values).','err'); return;
  }
  if (latMin>=latMax || lngMin>=lngMax){
    setStatus('That bounding box is empty — each “min” must be smaller than its “max”.','err'); return;
  }
  try {
    const [idx, agsSet] = await Promise.all([ensureIndex(), ensureAgsSet()]);
    const hits = idx.filter(b => b.lat>=latMin && b.lat<=latMax && b.lon>=lngMin && b.lon<=lngMax);
    for (const b of hits) b.hasAGS = agsSet.has(String(b.repno));
    hits.sort(boreholesFirst);          // boreholes before trial pits (task: TP carries far less info)
    lastResults = hits;
    const nAgs = hits.filter(b=>b.hasAGS).length;
    renderResults(hits);
    plotResults(hits);
    setStatus(`Found ${hits.length.toLocaleString()} borehole(s) — ${nAgs.toLocaleString()} with AGS stratigraphy (green), ${(hits.length-nAgs).toLocaleString()} location-only.`, hits.length?'ok':'err');
  } catch(e){ setStatus('Search failed: '+e.message,'err'); }
}

function renderResults(hits){
  const box=document.getElementById('map-results');
  const nAgs = hits.filter(b=>b.hasAGS).length;
  document.getElementById('map-count').textContent = hits.length ? `${nAgs} with AGS / ${hits.length} found` : '';
  if (!hits.length){ box.innerHTML='<p class="hint">No boreholes in this area.</p>'; return; }
  const show=hits.slice(0,200);
  let html='<table class="mini"><tr><th>Station</th><th>Type</th><th>Report</th><th>AGS</th><th>E</th><th>N</th><th>GL</th><th>Depth</th></tr>';
  for (const b of show)
    html+=`<tr class="${b.hasAGS?'has-ags':'no-ags'}"><td>${b.statno||''}</td><td>${b.stattype||''}</td><td>${b.repno||''}</td>`+
          `<td>${b.hasAGS?'✔ yes':'—'}</td><td>${b.e??''}</td><td>${b.n??''}</td><td>${b.gl??''}</td><td>${b.depth??''}</td></tr>`;
  html+='</table>';
  if (hits.length>show.length) html+=`<p class="hint">Showing first ${show.length} of ${hits.length}.</p>`;
  box.innerHTML=html;
}

function plotResults(hits){
  if (!resultLayer) return;
  resultLayer.clearLayers();
  const cap = hits.slice(0, MAX_PLOT);   // keep panning snappy on dense areas
  for (const b of cap){
    // Before loading we only know a report exists (hasAGS). After loading we
    // know whether THIS station has a real geological log (hasLog) — green then
    // means "has a log"; AGS points that are trial-pit/CPT-only go grey.
    const green = (b.hasLog !== undefined) ? b.hasLog : b.hasAGS;
    const style = green
      ? {radius:4, color:'#1e3c12', weight:1, fillColor:'#3f9b46', fillOpacity:.9}
      : {radius:3, color:'#6b6250', weight:1, fillColor:'#a8a196', fillOpacity:.7};
    const note = (b.hasLog === false)
      ? 'AGS report exists but no geological log (trial pit / CPT)'
      : (green ? '<b style="color:#2f5a1e">Geological log available</b>' : 'Location only (no AGS)');
    L.circleMarker([b.lat,b.lon], style)
      .bindPopup(`<b>${b.statno||'(no id)'}</b><br>Report ${b.repno||'-'}<br>${note}<br>`+
                 `E ${b.e??'-'} N ${b.n??'-'}<br>GL ${b.gl??'-'} mPD · depth ${b.depth??'-'} m`)
      .addTo(resultLayer);
  }
}

// ---- stratigraphy from CEDD AGS open data (via HF Space) -------------
async function fetchStratigraphy(repnos){
  const { Client } = await import('https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js');
  const app = await Client.connect(HF_SPACE);
  const res = await app.predict('/fetch_stratigraphy', [JSON.stringify(repnos)]);
  return JSON.parse((res.data && res.data[0]) || '{}');
}

// ---- export to builders ---------------------------------------------
async function loadInto2D(){
  if (!lastResults.length){ setLoadStatus('Search an area first.','err'); return; }
  // Only boreholes that actually have AGS data (green) are exported.
  const agsHits = lastResults.filter(b => b.hasAGS);
  if (!agsHits.length){
    setLoadStatus('No boreholes with AGS data in this area. Draw over some green boreholes and search again.','err');
    return;
  }
  const picked = agsHits.slice(0, MAX_IMPORT);
  const clipped = agsHits.length - picked.length;
  const repnos = [...new Set(picked.map(b=>String(b.repno)).filter(Boolean))];
  if (clipped){
    setLoadStatus(`This area has ${agsHits.length.toLocaleString()} boreholes with AGS data — `+
      `loading the first ${MAX_IMPORT.toLocaleString()}. Draw a smaller area to pick a different subset.`,'busy');
  }

  toast.show(`Fetching stratigraphy for ${picked.length} borehole(s)…`);
  setLoadStatus(`Fetching logged stratigraphy for ${repnos.length} report(s) from CEDD AGS open data… (this can take a few seconds)`,'busy');
  let strat = {};
  try {
    strat = await fetchStratigraphy(repnos);
  } catch(e){
    toast.hide();
    setLoadStatus('Stratigraphy fetch failed: '+(e?.message||e)+'. Please retry.','err');
    return;
  }

  // per-report lookup, plus a whitespace/case-normalized index so CSDI station
  // ids like "BH 1" still match AGS ids logged as "BH  1" / "bh1".
  const normKey = s => String(s||'').replace(/\s+/g,' ').trim().toUpperCase();
  const normIndex = {};
  for (const [rep, stations] of Object.entries(strat)){
    const m = {}; for (const k in stations) m[normKey(k)] = stations[k];
    normIndex[rep] = m;
  }

  const boreholes = [];
  let skipped = 0, duplicates = 0;
  // CEDD sometimes publishes the same GI report under two REPNOs (62076/62077 on
  // the reference test site), so the same physical borehole can arrive twice.
  // Same id AND same position (<1 m) => one hole, keep the first. Same id but a
  // different position => genuinely different holes that share a name, so tag
  // the later one with its report number rather than dropping data.
  const seen = new Map();     // id -> {x,y}
  picked.forEach((b,i)=>{
    const base = (b.statno || b.repno || `CSDI-${i+1}`).toString().trim() || `CSDI-${i+1}`;
    const rep = strat[String(b.repno)];
    const hit = rep ? (rep[base] || rep[String(b.statno).trim()] || (normIndex[String(b.repno)]||{})[normKey(base)]) : null;
    const layers = (hit && Array.isArray(hit.layers) ? hit.layers : [])
      .map(L=>({ surface:L.surface||'?', top:+L.top, base:+L.base, grade:L.grade||'' }))
      .filter(L=>Number.isFinite(L.top) && Number.isFinite(L.base));
    if (!layers.length){ skipped++; return; }          // no logged strata → don't export
    const x = Number.isFinite(hit.x) ? hit.x : (b.e ?? 0);
    const y = Number.isFinite(hit.y) ? hit.y : (b.n ?? 0);
    let id = base;
    const prev = seen.get(id);
    if (prev){
      if (Math.hypot(prev.x - x, prev.y - y) < 1){ duplicates++; return; }
      id = `${base} [${b.repno}]`;
    }
    seen.set(id, {x, y});
    boreholes.push({
      id, x, y,
      gl: Number.isFinite(hit.gl) ? hit.gl : (b.gl ?? 0),
      kind: isTrialPit(b) ? 'TP' : 'BH',
      layers
    });
  });

  toast.hide();
  if (!boreholes.length){
    setLoadStatus('The AGS reports here contain no geological logs (e.g. CPT/penetration tests only). Nothing to load.','err');
    return;
  }
  const importedIds = new Set(boreholes.map(b=>b.id));
  // Mark which mapped stations actually have a log, then recolour the map so
  // AGS points without a geological log (trial pit / CPT) go grey too.
  for (const b of lastResults){
    if (b.hasAGS) b.hasLog = importedIds.has((b.statno||b.repno||'').toString().trim());
  }
  plotResults(lastResults);

  const greenCount = lastResults.filter(b=>b.hasAGS).length;
  const noLog = greenCount - boreholes.length;
  const locOnly = lastResults.length - greenCount;
  setStatus(`${boreholes.length} borehole(s) with a geological log (green). `+
            `${noLog} AGS point(s) with no solid/rock log — trial pit / CPT (now grey). `+
            `${locOnly} location-only.`, 'ok');

  const sitePlan = {
    bounds: lastBounds,
    boreholes: lastResults.map(b=>({
      id: (b.statno||b.repno||'').toString().trim(), x:b.e, y:b.n,
      imported: importedIds.has((b.statno||b.repno||'').toString().trim())
    }))
  };
  lastRepnos = Object.keys(strat).length ? Object.keys(strat) : repnos;
  const dlBtn = document.getElementById('map-download-ags');
  if (dlBtn){ dlBtn.disabled = false; dlBtn.title = `Download the original CEDD AGS file(s) for ${lastRepnos.length} report(s)`; }

  if (onLoadTo2D) onLoadTo2D(boreholes, sitePlan);
  setLoadStatus(`Loaded ${boreholes.length} borehole(s) with real logged stratigraphy into the 2D Builder`+
                (skipped ? ` (${skipped} with no geological log skipped)` : '')+
                (duplicates ? ` (${duplicates} duplicate station(s) from repeated reports merged)` : '')+
                (clipped ? ` — ${clipped} more were beyond the ${MAX_IMPORT.toLocaleString()}-borehole limit` : '')+'.'+
                (boreholes.length > SOFT_IMPORT
                  ? `
That is a lot of boreholes: the cross-section and contour redraws will take a moment `+
                    `each. Draw a tighter area if you want it instant.` : ''),'ok');
}

// ---- ORIGINAL AGS download (unaltered CEDD file) ---------------------------
// The backend byte-range fetches the `GI_AGS/<REPNO>.zip` entries straight out
// of the GEO Open Data archive and verifies them against CEDD's own CRC-32
// before serving — nothing is parsed, classified or re-encoded on the way.
// One report -> that report's original .zip; several -> a STORED container zip
// holding the original .zip files. See test_raw_ags.py for the byte-level proof.
async function downloadAgs(){
  if (!lastRepnos.length){ setLoadStatus('Load boreholes into the 2D Builder first.','err'); return; }
  toast.show(`Fetching the original CEDD AGS file(s) for ${lastRepnos.length} report(s)…`);
  setLoadStatus(`Fetching ${lastRepnos.length} original AGS report file(s) from the CEDD archive…`,'busy');
  try {
    const { Client } = await import('https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js');
    const app = await Client.connect(HF_SPACE);
    const res = await app.predict('/fetch_raw_ags', [JSON.stringify(lastRepnos)]);
    const f = (res.data && res.data[0]) || {};
    const url = f.url || f.path || f;
    if (!url) throw new Error('backend returned no file');
    const name = f.orig_name || String(url).split('/').pop() || 'CEDD_AGS_original.zip';
    // fetch → blob so the browser saves it (a cross-origin <a download> would navigate)
    const blob = await (await fetch(url)).blob();
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob); a.download=name;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(a.href);
    setLoadStatus(`✓ Downloaded ${name} — the original CEDD AGS file(s), unaltered `+
                  `(CRC-verified against the archive).`,'ok');
  } catch(e){
    setLoadStatus('Original AGS download failed: '+(e?.message||e)+'. Please retry.','err');
  } finally { toast.hide(); }
}

// ---- init ------------------------------------------------------------
export async function initSiteMap(opts={}){
  onLoadTo2D = opts.onLoadTo2D || null;
  if (map) { setTimeout(()=>map.invalidateSize(), 50); return; }  // already built

  setStatus('Loading map…','busy');
  await ensureMapLibs();

  map = L.map('map-canvas', { center:[22.3193,114.1694], zoom:11 });

  const google = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    { maxZoom:20, attribution:'Google Hybrid' });
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom:19, attribution:'© OpenStreetMap' });
  google.addTo(map);
  L.control.layers({ 'Google Hybrid':google, 'OpenStreetMap':osm }).addTo(map);

  drawnLayer = new L.FeatureGroup().addTo(map);
  resultLayer = new L.FeatureGroup().addTo(map);

  const drawControl = new L.Control.Draw({
    draw: { rectangle:{shapeOptions:{color:'#b8860b',weight:2}},
            polygon:false, polyline:false, circle:false, marker:false, circlemarker:false },
    edit: false   // no edit/delete toolbar — just the rectangle tool (draw again to replace)
  });
  map.addControl(drawControl);

  // draw / edit / delete -> keep the coordinate fields in sync (task 2 fix)
  map.on(L.Draw.Event.CREATED, e=>{
    drawnLayer.clearLayers();
    drawnLayer.addLayer(e.layer);
    fillBboxFields(e.layer.getBounds());
    setStatus('Rectangle drawn — coordinates filled. Click “Search boreholes”.','ok');
  });
  map.on(L.Draw.Event.EDITED, e=>{
    e.layers.eachLayer(l=>fillBboxFields(l.getBounds()));
    setStatus('Rectangle updated — coordinates refreshed.','ok');
  });
  map.on(L.Draw.Event.DELETED, ()=>{
    ['bb-lat-min','bb-lat-max','bb-lng-min','bb-lng-max','bb-e-min','bb-e-max','bb-n-min','bb-n-max']
      .forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
    resultLayer.clearLayers();
    setStatus('Rectangle removed.','');
  });

  document.getElementById('map-search').addEventListener('click', searchBbox);
  document.getElementById('map-to-2d').addEventListener('click', loadInto2D);
  const _dl=document.getElementById('map-download-ags');
  if (_dl) _dl.addEventListener('click', downloadAgs);
  document.getElementById('map-to-3d').addEventListener('click', ()=>{
    setStatus('3D export from the map is not built yet (prototype placeholder).','');
  });

  setTimeout(()=>map.invalidateSize(), 100);
  setStatus('Map ready. Use the ▭ rectangle tool (top-left) to select an area.','ok');
}

// exposed for tests
export const _internals = { searchBbox, fillBboxFields, ensureIndex, loadInto2D,
  getResults: ()=>lastResults, getMap: ()=>map };
