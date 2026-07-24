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
const HF_SPACE = 'ferxxxxx/Geological-Map-Visualiser-V3';   // stratigraphy backend (CEDD AGS)
const MAX_IMPORT = 40;                                       // boreholes pushed to the builder

let map = null, drawnLayer = null, resultLayer = null;
let INDEX = null;              // [{repno,statno,lat,lon,e,n,gl,depth}]
let lastResults = [];
let onLoadTo2D = null;

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
    if (p.length<8) continue;
    out.push({ repno:p[0], statno:p[1], lat:+p[2], lon:+p[3],
               e:p[4]===''?null:+p[4], n:p[5]===''?null:+p[5],
               gl:p[6]===''?null:+p[6], depth:p[7]===''?null:+p[7] });
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
  document.getElementById('bb-e-min').value = Math.min(a.e,b.e).toFixed(1);
  document.getElementById('bb-e-max').value = Math.max(a.e,b.e).toFixed(1);
  document.getElementById('bb-n-min').value = Math.min(a.n,b.n).toFixed(1);
  document.getElementById('bb-n-max').value = Math.max(a.n,b.n).toFixed(1);
}

// ---- search ----------------------------------------------------------
async function searchBbox(){
  const latMin=+document.getElementById('bb-lat-min').value;
  const latMax=+document.getElementById('bb-lat-max').value;
  const lngMin=+document.getElementById('bb-lng-min').value;
  const lngMax=+document.getElementById('bb-lng-max').value;
  if (![latMin,latMax,lngMin,lngMax].every(Number.isFinite)){
    setStatus('Draw a rectangle on the map first (or type a bounding box).','err'); return;
  }
  try {
    const idx = await ensureIndex();
    const hits = idx.filter(b => b.lat>=latMin && b.lat<=latMax && b.lon>=lngMin && b.lon<=lngMax);
    lastResults = hits;
    renderResults(hits);
    plotResults(hits);
    setStatus(`Found ${hits.length.toLocaleString()} borehole(s) in the drawn area.`, hits.length?'ok':'err');
  } catch(e){ setStatus('Search failed: '+e.message,'err'); }
}

function renderResults(hits){
  const box=document.getElementById('map-results');
  document.getElementById('map-count').textContent = hits.length ? `${hits.length} found` : '';
  if (!hits.length){ box.innerHTML='<p class="hint">No boreholes in this area.</p>'; return; }
  const show=hits.slice(0,200);
  let html='<table class="mini"><tr><th>Station</th><th>Report</th><th>E</th><th>N</th><th>GL</th><th>Depth</th></tr>';
  for (const b of show)
    html+=`<tr><td>${b.statno||''}</td><td>${b.repno||''}</td><td>${b.e??''}</td><td>${b.n??''}</td><td>${b.gl??''}</td><td>${b.depth??''}</td></tr>`;
  html+='</table>';
  if (hits.length>show.length) html+=`<p class="hint">Showing first ${show.length} of ${hits.length}.</p>`;
  box.innerHTML=html;
}

function plotResults(hits){
  if (!resultLayer) return;
  resultLayer.clearLayers();
  const cap = hits.slice(0, 800); // keep rendering snappy
  for (const b of cap){
    L.circleMarker([b.lat,b.lon], {radius:3, color:'#1e3c12', weight:1, fillColor:'#9ac845', fillOpacity:.85})
      .bindPopup(`<b>${b.statno||'(no id)'}</b><br>Report ${b.repno||'-'}<br>E ${b.e??'-'} N ${b.n??'-'}<br>GL ${b.gl??'-'} mPD · depth ${b.depth??'-'} m`)
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
  if (!lastResults.length){ setStatus('Search an area first.','err'); return; }
  const picked = lastResults.slice(0, MAX_IMPORT);
  const repnos = [...new Set(picked.map(b=>String(b.repno)).filter(Boolean))];

  setStatus(`Fetching logged stratigraphy for ${repnos.length} report(s) from CEDD AGS open data…`,'busy');
  let strat = {};
  try { strat = await fetchStratigraphy(repnos); }
  catch(e){ setStatus('Stratigraphy fetch failed ('+(e?.message||e)+'). Loading collars only.','err'); }

  let withStrata = 0;
  const boreholes = picked.map((b,i)=>{
    const id = (b.statno || b.repno || `CSDI-${i+1}`).toString().trim() || `CSDI-${i+1}`;
    const rep = strat[String(b.repno)];
    const hit = rep ? (rep[id] || rep[String(b.statno).trim()]) : null;
    let x = b.e ?? 0, y = b.n ?? 0, gl = b.gl ?? 0, layers = [];
    if (hit && Array.isArray(hit.layers) && hit.layers.length){
      layers = hit.layers.map(L=>({ surface:L.surface||'?', top:+L.top, base:+L.base }))
                         .filter(L=>Number.isFinite(L.top) && Number.isFinite(L.base));
      if (Number.isFinite(hit.x)) x = hit.x;      // prefer the logged collar values
      if (Number.isFinite(hit.y)) y = hit.y;
      if (Number.isFinite(hit.gl)) gl = hit.gl;
      if (layers.length) withStrata++;
    }
    return { id, x, y, gl, layers };
  });

  if (onLoadTo2D) onLoadTo2D(boreholes);
  const collarOnly = boreholes.length - withStrata;
  setStatus(`Loaded ${boreholes.length} borehole(s) into the 2D Builder — `+
            `${withStrata} with real logged stratigraphy from CEDD AGS`+
            (collarOnly ? `, ${collarOnly} collar-only (older reports have no digital AGS)` : '')+'.','ok');
}

// ---- init ------------------------------------------------------------
export async function initSiteMap(opts={}){
  onLoadTo2D = opts.onLoadTo2D || null;
  if (map) { setTimeout(()=>map.invalidateSize(), 50); return; }  // already built

  setStatus('Loading map…','busy');
  await Promise.all([loadCss(CDN.leafletCss), loadCss(CDN.drawCss)]);
  await loadJs(CDN.leafletJs);
  await Promise.all([loadJs(CDN.drawJs), loadJs(CDN.proj4)]);
  proj4.defs('HK1980', HK1980);

  map = L.map('map-canvas', { center:[22.3193,114.1694], zoom:11 });

  const google = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
    { maxZoom:20, attribution:'Google Hybrid' });
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom:19, attribution:'© OpenStreetMap' });
  const esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom:19, attribution:'© Esri' });
  google.addTo(map);
  L.control.layers({ 'Google Hybrid':google, 'OpenStreetMap':osm, 'Esri Imagery':esri }).addTo(map);

  drawnLayer = new L.FeatureGroup().addTo(map);
  resultLayer = new L.FeatureGroup().addTo(map);

  const drawControl = new L.Control.Draw({
    draw: { rectangle:{shapeOptions:{color:'#b8860b',weight:2}},
            polygon:false, polyline:false, circle:false, marker:false, circlemarker:false },
    edit: { featureGroup: drawnLayer, remove:true }
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
  document.getElementById('map-to-3d').addEventListener('click', ()=>{
    setStatus('3D export from the map is not built yet (prototype placeholder).','');
  });

  setTimeout(()=>map.invalidateSize(), 100);
  setStatus('Map ready. Use the ▭ rectangle tool (top-left) to select an area.','ok');
}

// exposed for tests
export const _internals = { searchBbox, fillBboxFields, ensureIndex, loadInto2D,
  getResults: ()=>lastResults, getMap: ()=>map };
