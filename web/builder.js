// ================================================================
// GeoVisualise — 2D Borehole Log & Cross-Section builder
// Editable, Subcores-style borehole entry with live log preview.
// Ships the same dataset to the GemPy Hugging Face Space (two-way pipeline).
// ================================================================

import { sectionStations, interpolateHorizons, boxToPts, ptsToBox, resizeFromCorner, cutPolygon } from './section_geom.js';
import { tileCoord, sampleElevation, tilesForLine, correctedProfile, idwDelta, TILE_LOD } from './terrain.js';
import { stateToProjectCSV, projectCSVToState, csvToBoreholes } from './project_csv.js';

const HF_SPACE = 'ferxxxxx/Geological-Map-Visualiser-V3';
const HF_URL   = 'https://ferxxxxx-geological-map-visualiser-v3.hf.space';
document.getElementById('hf-open').href = HF_URL;

// ---- stratum colours -------------------------------------------------
const PALETTE = {
  fill:'#c9b98f', 'made ground':'#c9b98f', topsoil:'#7a5c33', soil:'#caa460',
  colluvium:'#b98c46', alluvium:'#d9c56b', marine:'#8fb0a8', clay:'#9c7b4d',
  silt:'#a89968', sand:'#e0c56e', gravel:'#b7a06a',
  cdg:'#d8a24a', hdg:'#b5762e', mdg:'#8f5a24', sdg:'#6f4620',
  granite:'#8a8f98', bedrock:'#6b7079', rock:'#6b7079', tuff:'#7d838c'
};
function colourFor(surface){
  const k = (surface||'').trim().toLowerCase();
  if (PALETTE[k]) return PALETTE[k];
  let h=0; for (const c of k) h = (h*31 + c.charCodeAt(0)) % 360;
  return `hsl(${h},45%,58%)`;
}

// ---- decomposition grade (GeoGuide 3, Table 4) ----------------------
// Imported layers carry a `grade` tag from the backend, e.g. "V (CDG)".
// The cross-section groups & colours by grade *numeral* (all Grade V rock is
// one band regardless of lithology); transported soils (no grade) fall back
// to their material name & colour.
const GRADE_LABEL = { VI:'Grade VI · Residual Soil', V:'Grade V · Completely Decomposed',
  IV:'Grade IV · Highly Decomposed', III:'Grade III · Moderately Decomposed',
  II:'Grade II · Slightly Decomposed', I:'Grade I · Fresh Rock' };
const GRADE_COLOUR = { VI:'#a9743a', V:'#d8a24a', IV:'#c07d2e', III:'#9a6a2c',
  II:'#8a8f98', I:'#5b6068' };
function gradeRoman(grade){ const m=/^(VI|IV|III|II|V|I)\b/.exec((grade||'').trim()); return m?m[1]:''; }
function classKey(l){ const r=gradeRoman(l.grade); return r ? ('G'+r) : (l.surface||''); }
function classLabel(l){ const r=gradeRoman(l.grade); return r ? GRADE_LABEL[r] : (l.surface||'(unnamed)'); }
function classColour(l){ const r=gradeRoman(l.grade); return r ? GRADE_COLOUR[r] : colourFor(l.surface); }

// ---- STATE (source of truth) ----------------------------------------
// state.boreholes = [{id,x,y,gl, layers:[{surface,top,base}]}]  (top/base = depth below GL)
let state = { boreholes: [], activeIdx: 0, mode: 'depth', sitePlan: null };
// Derived (consumed by renderers)
let BH = {}; let STRAT = [];                 // STRAT = ordered class keys (grade or surface)
let STRAT_LABEL = {}, STRAT_COLOUR = {};     // class key -> legend label / colour

function active(){ return state.boreholes[state.activeIdx]; }

function syncDerived(){
  BH = {};
  const sumTop = {}, cntTop = {};
  STRAT_LABEL = {}; STRAT_COLOUR = {};
  for (const bh of state.boreholes){
    BH[bh.id] = { x:bh.x, y:bh.y, gl:bh.gl,
      layers: bh.layers.map(l=>({surface:l.surface, top:l.top, base:l.base, grade:l.grade||''})) };
    for (const l of bh.layers){
      const k = classKey(l);
      sumTop[k] = (sumTop[k]||0) + l.top;
      cntTop[k] = (cntTop[k]||0) + 1;
      STRAT_LABEL[k] = classLabel(l);
      STRAT_COLOUR[k] = classColour(l);
    }
  }
  STRAT = Object.keys(sumTop).sort((a,b)=> sumTop[a]/cntTop[a] - sumTop[b]/cntTop[b]);
}

// ---- CSV <-> state ---------------------------------------------------
// Format logic lives in project_csv.js (pure, quoting-correct, Node-tested by
// web/test_project_csv.mjs — the save/resume round trip is verified lossless).
function stateToCSV(){
  let out='borehole_id,x,y,surface,top_depth,base_depth,ground_level\n';
  for (const bh of state.boreholes)
    for (const l of bh.layers)
      out += `${bh.id},${bh.x},${bh.y},${l.surface},${l.top},${l.base},${bh.gl}\n`;
  return out;
}
function csvToState(text){
  state.boreholes = csvToBoreholes(text); state.activeIdx = 0;
}
function loadProjectCSV(text){
  const p = projectCSVToState(text);
  state.boreholes = p.boreholes; state.activeIdx = 0;
  if (p.mode) state.mode = p.mode;
  sectionLine = p.sectionLine || null;
  state.sitePlan = p.bounds
    ? { bounds:p.bounds, boreholes: p.boreholes.map(b=>({id:b.id,x:b.x,y:b.y,imported:true})) }
    : null;
  // The rest of the cross-section setup: option controls, manually deselected
  // boreholes and annotations. Absent from a v1 / legacy file, in which case the
  // controls keep whatever they are currently set to and both lists reset.
  secExcluded = new Set(Array.isArray(p.excluded) ? p.excluded : []);
  secAnnots   = Array.isArray(p.annots) ? p.annots.map(normAnnot).filter(Boolean) : [];
  applySectionSettings(p.section);
  renderAnnotList();
}
function downloadText(name, text){
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(text);
  a.download=name; document.body.appendChild(a); a.click(); a.remove();
}

// ==== INPUT UI ========================================================

// depth<->elevation display helpers (task 8)
// canonical storage is depth-below-GL; elevation view = gl - depth
function dispVal(depth){
  const gl = active().gl;
  return state.mode === 'elevation' ? (gl - depth) : depth;
}
function toDepth(val){
  const gl = active().gl;
  return state.mode === 'elevation' ? (gl - val) : val;
}

function renderBhSelect(){
  const sel = document.getElementById('bh-select');
  sel.innerHTML='';
  state.boreholes.forEach((bh,i)=>{
    const o = new Option(bh.id || `(bh ${i+1})`, i);
    if (i===state.activeIdx) o.selected=true;
    sel.appendChild(o);
  });
}
function renderMeta(){
  const bh = active();
  document.getElementById('m-id').value = bh.id;
  document.getElementById('m-gl').value = bh.gl;
  document.getElementById('m-x').value  = bh.x;
  document.getElementById('m-y').value  = bh.y;
}
function renderLayerTable(){
  const bh = active();
  const body = document.getElementById('layer-body');
  body.innerHTML='';
  // header labels reflect mode (task 8)
  document.getElementById('th-top').textContent  = state.mode==='elevation' ? 'Top (mPD)'  : 'From (m)';
  document.getElementById('th-base').textContent = state.mode==='elevation' ? 'Base (mPD)' : 'To (m)';
  bh.layers.forEach((l,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td class="num"><input type="number" step="0.1" data-i="${i}" data-f="top"  value="${round(dispVal(l.top))}"></td>`+
      `<td class="num"><input type="number" step="0.1" data-i="${i}" data-f="base" value="${round(dispVal(l.base))}"></td>`+
      `<td><span class="swatch" style="background:${classColour(l)}"></span>`+
        `<input type="text" data-i="${i}" data-f="surface" value="${escapeHtml(l.surface)}" style="width:calc(100% - 20px)"></td>`+
      `<td class="grade" title="Decomposition grade (GeoGuide 3, Table 4)">${escapeHtml(l.grade||'—')}</td>`+
      `<td class="act"><span class="rm" data-rm="${i}" title="Remove">✕</span></td>`;
    body.appendChild(tr);
  });
}
function round(v){ return Math.round(v*100)/100; }
function escapeHtml(s){ return (s||'').replace(/"/g,'&quot;'); }

function refreshInput(){ renderBhSelect(); renderMeta(); renderLayerTable(); }

// ---- edit handlers ---------------------------------------------------
function paneActive(name){ return document.querySelector(`.tabpane[data-pane="${name}"]`).classList.contains('active'); }
function sectionActive(){ return paneActive('section'); }
function commit(){
  syncDerived(); renderLogLive();
  if (sectionActive() && secMap) updateSection();
  if (paneActive('contour')) renderContour();
  if (paneActive('log')) renderLogPlan();
}

function onMetaChange(){
  const bh = active();
  const oldId = bh.id;
  bh.id = document.getElementById('m-id').value.trim() || bh.id;
  bh.gl = +document.getElementById('m-gl').value || 0;
  bh.x  = +document.getElementById('m-x').value || 0;
  bh.y  = +document.getElementById('m-y').value || 0;
  if (bh.id!==oldId) renderBhSelect();
  // GL change shifts elevation display; re-render table if in elevation mode
  if (state.mode==='elevation') renderLayerTable();
  commit();
}
function onLayerInput(e){
  const t = e.target; if (t.dataset.i==null) return;
  const i = +t.dataset.i, f = t.dataset.f, bh = active();
  if (f==='surface'){ bh.layers[i].surface = t.value; }
  else { bh.layers[i][f] = toDepth(+t.value); }
  // keep swatch colour in sync live
  if (f==='surface'){ const sw=t.parentElement.querySelector('.swatch'); if(sw) sw.style.background=colourFor(t.value); }
  commit();
}
function addLayer(){
  const bh = active();
  const prevBase = bh.layers.length ? bh.layers[bh.layers.length-1].base : 0; // task 6: default top = prev base
  bh.layers.push({ surface:'', top:prevBase, base:prevBase });
  renderLayerTable(); commit();
  // focus the new stratum name
  const inputs = document.querySelectorAll('#layer-body tr:last-child input[data-f="surface"]');
  if (inputs.length) inputs[0].focus();
}
function removeLayer(i){ active().layers.splice(i,1); renderLayerTable(); commit(); }

function addBorehole(){
  const n = state.boreholes.length+1;
  state.boreholes.push({ id:`BH-${n}`, x:840000, y:820000, gl:10, layers:[] });
  state.activeIdx = state.boreholes.length-1;
  refreshInput(); commit();
}
function delBorehole(){
  if (state.boreholes.length<=1){ alert('At least one borehole is required.'); return; }
  state.boreholes.splice(state.activeIdx,1);
  state.activeIdx = Math.max(0, state.activeIdx-1);
  refreshInput(); commit();
}
function setMode(mode){
  state.mode = mode;
  document.querySelectorAll('#mode-toggle button').forEach(b=>b.classList.toggle('on', b.dataset.mode===mode));
  renderLayerTable();
}

// ==== SVG renderers (consume BH / STRAT) ==============================
const NS = 'http://www.w3.org/2000/svg';
function el(tag, attrs, text){
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  return e;
}
function niceStep(range){
  const raw = range/6, p = Math.pow(10, Math.floor(Math.log10(raw||1)));
  const n = raw/p; return (n<1.5?1:n<3?2:n<7?5:10)*p;
}

let logLabelsMode = 'inline';   // 'inline' (de-cluttered leader labels) | 'legend'
function renderLog(id){
  const box = document.getElementById('log-viz');
  box.innerHTML='';
  const bh = BH[id];
  if (!bh || !bh.layers.length){ box.innerHTML='<p class="hint" style="padding:10px">Add layers to see the log.</p>'; return; }
  const showElev = document.getElementById('log-elev').checked;
  const legendMode = logLabelsMode === 'legend';
  const maxDepth = Math.max(...bh.layers.map(l=>l.base));
  if (!(maxDepth>0)){ box.innerHTML='<p class="hint" style="padding:10px">Layer depths must be positive.</p>'; return; }

  const mL=58, mT=76, mB=24, colW=90;
  const pxPerM = Math.max(6, Math.min(20, 320/maxDepth)), plotH = maxDepth*pxPerM;
  const yOf = d => mT + d*pxPerM;
  // gutters: log column → mPD axis → labels/legend. The mPD numbers get their
  // own 60 px lane so they can never collide with the labels beside them.
  const mpdX = mL+colW+14;
  const lx = mL+colW+(showElev?78:18);

  // Pre-compute de-cluttered label slots (inline mode): each label keeps its
  // height and is pushed down so it never overlaps the one above — a leader
  // line links it back to its (possibly thin) layer. This is why thin layers
  // no longer collide.
  let items=[], labelsBottom=mT;
  if (!legendMode){
    items = bh.layers.map(l=>{ const y0=yOf(l.top), y1=yOf(l.base); return {l,y0,y1,mid:(y0+y1)/2,h:l.grade?36:26}; });
    let last=mT-100;
    for (const it of items){ it.ty=Math.max(it.mid-it.h/2, last+3); last=it.ty+it.h; }
    labelsBottom=last;
  }

  // uniques for legend mode
  let uniq=[];
  if (legendMode){
    const seen=new Set();
    for (const l of bh.layers){ const k=(l.surface||'')+'|'+(l.grade||''); if(!seen.has(k)){ seen.add(k); uniq.push(l); } }
  }

  // Size the right-hand label/legend lane to the longest text it must hold, so
  // nothing is clipped (task 1: the log used to cut off legend text & labels).
  const labelTexts = legendMode
    ? uniq.map(l=>(l.surface||'(unnamed)')+(l.grade?`  ·  Grade ${l.grade}`:''))
    : bh.layers.map(l=>l.surface||'(unnamed)');
  const maxChars = labelTexts.reduce((m,t)=>Math.max(m,t.length),0);
  const rightW = Math.max(160, Math.min(460, maxChars*6.1+40));
  const W = lx+rightW+14;
  const H = Math.max(mT+plotH+mB, (legendMode ? mT+uniq.length*18+mB : labelsBottom+mB));
  const svg = el('svg',{width:W,height:H,viewBox:`0 0 ${W} ${H}`,'font-family':'Outfit,sans-serif'});
  svg.appendChild(el('rect',{x:0,y:0,width:W,height:H,fill:'#fffdf8'}));
  svg.appendChild(el('text',{x:mL,y:24,'font-size':16,'font-weight':700,fill:'#1e3c12'},`Borehole ${id}`));
  svg.appendChild(el('text',{x:mL,y:42,'font-size':11,fill:'#6b6250'},
    `GL ${(+bh.gl).toFixed(2)} mPD   ·   E ${bh.x}  N ${bh.y}   ·   depth ${maxDepth} m`));
  svg.appendChild(el('line',{x1:mL,y1:mT-8,x2:W-8,y2:mT-8,stroke:'#c8bda8'}));

  const step = niceStep(maxDepth);
  for (let d=0; d<=maxDepth+0.001; d+=step){
    const y=yOf(d);
    svg.appendChild(el('line',{x1:mL-4,y1:y,x2:mL,y2:y,stroke:'#6b6250'}));
    svg.appendChild(el('text',{x:mL-7,y:y+3,'font-size':10,'text-anchor':'end',fill:'#6b6250'},d.toFixed(0)));
    if (showElev){
      svg.appendChild(el('line',{x1:mL+colW,y1:y,x2:mL+colW+6,y2:y,stroke:'#6b6250'}));
      svg.appendChild(el('text',{x:mpdX,y:y+3,'font-size':10,fill:'#6b6250'},(bh.gl-d).toFixed(1)));
    }
  }
  svg.appendChild(el('text',{x:mL-40,y:mT-14,'font-size':10,'font-weight':600,fill:'#6b6250'},'Depth (m)'));
  if (showElev) svg.appendChild(el('text',{x:mpdX,y:mT-14,'font-size':10,'font-weight':600,fill:'#6b6250'},'mPD'));

  for (const l of bh.layers){
    const y0=yOf(l.top), y1=yOf(l.base), c=colourFor(l.surface);
    svg.appendChild(el('rect',{x:mL,y:y0,width:colW,height:Math.max(0,y1-y0),fill:c,stroke:'#3d3529','stroke-width':.7}));
  }

  if (legendMode){
    // consolidated legend beside the log (top) instead of crowded inline labels,
    // clear of the mPD axis lane
    const gx=lx; let gy=mT+4;
    svg.appendChild(el('text',{x:gx,y:gy,'font-size':11,'font-weight':700,fill:'#1e3c12'},'Legend')); gy+=16;
    for (const l of uniq){
      svg.appendChild(el('rect',{x:gx,y:gy-9,width:11,height:11,fill:colourFor(l.surface),stroke:'#3d3529','stroke-width':.6}));
      const txt=(l.surface||'(unnamed)')+(l.grade?`  ·  Grade ${l.grade}`:'');
      svg.appendChild(el('text',{x:gx+16,y:gy,'font-size':10,fill:'#1a1a0f'},txt)); gy+=18;
    }
  } else {
    for (const it of items){
      const l=it.l, c=colourFor(l.surface), ly=it.ty, cy=ly+it.h/2;
      svg.appendChild(el('polyline',{points:`${mL+colW},${it.mid} ${lx-4},${it.mid} ${lx-4},${cy} ${lx},${cy}`,fill:'none',stroke:'#b0a68f','stroke-width':.6}));
      svg.appendChild(el('rect',{x:lx,y:cy-5,width:10,height:10,fill:c,stroke:'#3d3529','stroke-width':.6}));
      svg.appendChild(el('text',{x:lx+15,y:ly+9,'font-size':11,'font-weight':600,fill:'#1a1a0f'},l.surface||'(unnamed)'));
      svg.appendChild(el('text',{x:lx+15,y:ly+20,'font-size':9.5,fill:'#6b6250'},`${l.top}–${l.base} m`));
      if (l.grade) svg.appendChild(el('text',{x:lx+15,y:ly+31,'font-size':9.5,'font-weight':600,fill:'#2f5a1e'},`Grade ${l.grade}`));
    }
  }
  svg.appendChild(el('rect',{x:mL,y:mT,width:colW,height:plotH,fill:'none',stroke:'#3d3529'}));
  box.appendChild(svg);
}
function renderLogLive(){ const bh=active(); if(bh) renderLog(bh.id); }

// ==== BOREHOLE LOG site map (pick a borehole) ================================
// A plan of every borehole with coordinates, each labelled with its id. Clicking
// one makes it the active borehole, so the data-entry panel and the log diagram
// jump to it — the way to walk a site hole by hole.
let lpMap=null, lpLayer=null, lpLabels=null;

function logPlanHoles(){
  return state.boreholes
    .map((b,i)=>({ b, i }))
    .filter(({b})=>Number.isFinite(b.x) && Number.isFinite(b.y) && (b.x||b.y));
}

async function renderLogPlan(){
  const box=document.getElementById('logplan-viz');
  if (!box) return;
  const holes=logPlanHoles();
  if (!holes.length){
    if (lpMap){ lpMap.remove(); lpMap=null; lpLayer=lpLabels=null; }
    box.innerHTML='<p class="hint" style="padding:8px">No borehole coordinates yet — load a site from the Site Map tab, or type an Easting/Northing in the panel on the left.</p>';
    return;
  }
  await ensureMapLibs(); await ensurePlacer();
  if (!lpMap){
    box.innerHTML=''; box.style.padding='0';
    lpMap=L.map(box,{zoomControl:true});
    lpLayer=L.layerGroup().addTo(lpMap);
    lpLabels=L.layerGroup().addTo(lpMap);
    lpMap.fitBounds(L.latLngBounds(holes.map(({b})=>toLL(b.x,b.y))).pad(0.3));
    await setBase(lpMap, 'lp', document.getElementById('lp-base').value);
    // labels are placed in screen pixels, so re-solve them after any view change
    lpMap.on('zoomend moveend', ()=>drawLogPlanMarkers());
  }
  setTimeout(()=>lpMap.invalidateSize(),60);
  drawLogPlanMarkers();
}

function drawLogPlanMarkers(){
  if (!lpMap || !hasView(lpMap)) return;
  const holes=logPlanHoles();
  lpLayer.clearLayers(); lpLabels.clearLayers();
  for (const {b,i} of holes){
    const active = i===state.activeIdx;
    const nLayers = b.layers.length;
    L.circleMarker(toLL(b.x,b.y), {radius:active?8:5, color:active?'#1e3c12':'#1a1a0f',
        weight:active?2.5:1.2, fillColor:active?'#3f9b46':(nLayers?'#e8e2d2':'#a8a196'), fillOpacity:1})
      .bindTooltip(`<b>${esc(b.id)}</b><br>${nLayers} layer(s) · GL ${b.gl} mPD`+
                   (active?'<br><i>shown below</i>':'<br>click to view'), {direction:'top'})
      .on('click', ()=>selectBorehole(i))
      .addTo(lpLayer);
  }
  const note=document.getElementById('lp-crowd');
  if (document.getElementById('lp-names').checked){
    const { dropped } = placePointLabels(lpMap, lpLabels,
      holes.map(({b})=>({ id:b.id, ll:toLL(b.x,b.y), text:b.id })));
    if (note) note.textContent = dropped
      ? `${dropped} name(s) hidden — zoom in to place them (hover a symbol to identify it).` : '';
  } else if (note) note.textContent='';
}

// Clicking a borehole on any plan makes it the one being edited & drawn.
function selectBorehole(i){
  if (i==null || i<0 || i>=state.boreholes.length) return;
  state.activeIdx=i;
  refreshInput();
  renderLogLive();
  drawLogPlanMarkers();     // move the highlight
}

// ---- Cross-section site map (Leaflet satellite) + draggable section line ----
// The cross-section is defined by a draggable line drawn on a satellite map.
// Boreholes are projected onto the line (within a corridor either side),
// ordered by their position along it, and the section redraws live as the
// line is moved / rotated / resized. Reuses Leaflet + proj4 from sitemap.js.
let secMap=null, secBhLayer=null, secLabelLayer=null, secLinePoly=null, secHandleA=null,
    secHandleB=null, secBoundaryRect=null;
let sectionLine=null;   // {a:[lat,lng], b:[lat,lng]}
let secPlanNames=[];    // solved label layout for the site-plan PNG export
// Boreholes the user has manually taken OUT of this section by clicking them on
// the site plan. They stay on the plan (grey, like any hole outside the
// corridor) but contribute nothing to the drawn section.
let secExcluded=new Set();
// Proposed-structure rectangles, two kinds in one list (one list = one save key):
//  • drawn on the section — SECTION coordinates, so they survive a redraw, a
//    zoom and a save: {label, colour, pts:[[chainage_m, level_mPD] ×4]}
//  • drawn on the site plan — a footprint in HK1980 metres plus its levels:
//    {kind:'plan', label, colour, en:[[e,n] ×4], top, depth}; the section shows
//    it wherever the section line cuts the footprint.
let secAnnots=[];
let secDrawMode=null;     // null | 'section' | 'plan' — armed by the Draw buttons
let secStructLayer=null;  // Leaflet layer holding the plan footprints
// Plot extent of the last drawn section, so "add a rectangle" can drop a new
// one somewhere visible instead of at (0,0).
let secPlotRange=null;   // {dMin,dMax,eMin,eMax}

let _mapLibs=null;
function ensureMapLibs(){ return _mapLibs || (_mapLibs=import('./sitemap.js').then(m=>m.ensureMapLibs())); }
let _mapExport=null;
function mapExport(){ return _mapExport || (_mapExport=import('./map_export.js')); }

// ---- LandsD 5 m DTM (terrain ground surface — see docs/PLAN_TERRAIN_PROFILE.md) ----
// LERC decoder is only fetched (117 KB wasm + 14 KB JS) the first time a
// "Ground surface" mode other than "interpolated" is actually used.
let _lerc=null;
function ensureLerc(){
  return _lerc || (_lerc=import('https://unpkg.com/lerc@4.0.4/LercDecode.es.js').then(async m=>{ await m.load(); return m; }));
}
const DTM_TILE_URL='https://tiles.arcgis.com/tiles/6j1KwZfY2fZrfNMR/arcgis/rest/services/HK_DTM/ImageServer/tile';
const dtmTileCache=new Map();      // "lod/row/col" -> Float32Array(256*256) | null (fetch failed)
function dtmTileGetter(lod,row,col){ return dtmTileCache.get(`${lod}/${row}/${col}`) || null; }
async function fetchDtmTile(lod,row,col){
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
function prefetchDtmTiles(tiles, onReady){
  const want=[...new Map(tiles.map(t=>[`${t.lod}/${t.row}/${t.col}`,t])).values()]
    .filter(t=>!dtmTileCache.has(`${t.lod}/${t.row}/${t.col}`));
  if (!want.length) return;
  Promise.all(want.map(t=>fetchDtmTile(t.lod,t.row,t.col))).then(onReady);
}

// Swappable base map for the site plan / contour plan (task 6). `key` namespaces
// the remembered layer so the two maps can show different basemaps at once.
const _baseLayers={};
async function setBase(map, key, name){
  const { BASEMAPS } = await mapExport();
  const bm = BASEMAPS[name];
  if (_baseLayers[key]){ map.removeLayer(_baseLayers[key]); _baseLayers[key]=null; }
  // maxNativeZoom lets Leaflet upscale the deepest real tiles instead of asking
  // for zooms the source has no imagery for (Esri returns grey placeholders).
  if (bm && bm.url) _baseLayers[key]=L.tileLayer(bm.url,
    {maxZoom:bm.maxZoom||20, maxNativeZoom:bm.maxNativeZoom, attribution:bm.attribution}).addTo(map);
  if (_baseLayers[key]) _baseLayers[key].bringToBack();
}

// A Leaflet map has no projection until a view is set, and every render path
// below awaits (setBase, dynamic import) between creating the map and fitting
// it — long enough for a re-entrant call to try to project a point and throw
// "Set map center and zoom first.". Every draw checks first.
function hasView(map){ try { map.getCenter(); return true; } catch { return false; } }

// ---- de-cluttered point labels on a Leaflet map ----------------------------
// Shared by the Borehole-Log site map and the cross-section site plan: borehole
// ids are placed in the nearest free slot around each symbol with a leader line
// back to it, so two holes a few metres apart never get swapped or overprinted
// labels. Same placer as the rock-contour callouts (placeLabels in contour.js).
// Returns the solved pixel layout so a PNG export can reproduce it exactly.
const BHLABEL_FONT='600 11px Outfit, sans-serif';
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// The placer is loaded once up front so label drawing is SYNCHRONOUS: an async
// version raced itself (clear-then-await-then-add), stacking three copies of
// every name when the map fired zoomend/moveend while a placement was pending.
let _placeLabels=null;
async function ensurePlacer(){
  if (!_placeLabels) _placeLabels=(await import('./contour.js')).placeLabels;
  return _placeLabels;
}
function placePointLabels(map, group, items, opts={}){
  const placeLabels = _placeLabels;
  if (!placeLabels || !hasView(map)) return { layout:[], dropped:items.length };
  const font = opts.font || BHLABEL_FONT;
  const size = map.getSize();
  const px = ll => { const p=map.latLngToContainerPoint(L.latLng(ll[0],ll[1])); return [p.x,p.y]; };
  const toLLp = ([x,y]) => { const g=map.containerPointToLatLng(L.point(x,y)); return [g.lat,g.lng]; };
  // every symbol is an obstacle, so a label never buries another borehole
  const symbols = items.map(it=>{ const [x,y]=px(it.ll); return {x:x-8, y:y-8, w:16, h:16}; });
  const anchors = items.map((it,i)=>{
    const [x,y]=px(it.ll);
    return { key:i, x, y, w:textWidth(it.text, font)+7, h:15 };
  });
  const placed = placeLabels(anchors, { obstacles:symbols,
    bounds:{x:2, y:2, w:size.x-4, h:size.y-4} });
  const byKey = new Map(placed.map(p=>[p.key,p]));
  const layout=[];
  items.forEach((it,i)=>{
    const p=byKey.get(i);
    if (!p || !p.placed) return;         // no room: the symbol keeps its tooltip
    if (p.leader) L.polyline([toLLp(p.leader[0]), toLLp(p.leader[1])],
      {color:opts.leaderColour||'#1a1a0f', weight:0.8, opacity:.85, interactive:false}).addTo(group);
    L.marker(it.ll,{interactive:false, icon:L.divIcon({className:opts.className||'bh-label',
      html:esc(it.text), iconSize:[p.box.w, p.box.h], iconAnchor:[-p.dx, -p.dy]})}).addTo(group);
    const [x,y]=px(it.ll);
    layout.push({ ll:it.ll, text:it.text, dx:p.dx, dy:p.dy,
                  leader:p.leader ? [p.leader[1][0]-x, p.leader[1][1]-y] : null });
  });
  return { layout, dropped: items.length - layout.length };
}

function toLL(e,n){ const r=proj4('HK1980','EPSG:4326',[e,n]); return [r[1], r[0]]; }   // -> [lat,lng]
function toEN(lat,lng){ const r=proj4('EPSG:4326','HK1980',[lng,lat]); return {e:r[0], n:r[1]}; }
function sectionHoles(){ return state.boreholes.filter(b=>b.layers.length && Number.isFinite(b.x) && Number.isFinite(b.y)); }
// Collar GL minus DTM at every borehole's own position, for the site-wide
// ground correction. Deliberately ignores the corridor AND manual deselection:
// the ground surface is a property of the site, not of which logs are drawn.
function siteDeltas(){
  const pts=[]; let missing=0;
  for (const b of sectionHoles()){
    if (!Number.isFinite(b.gl)) continue;
    const [la,ln]=toLL(b.x,b.y);
    const z=sampleElevation(dtmTileGetter, ln, la);
    if (z==null) { missing++; continue; }
    pts.push({ e:b.x, n:b.y, delta:b.gl-z });
  }
  return { pts, missing };
}

// Default line = the two farthest-apart boreholes (a sensible full-site section).
// ponytail: O(n²) farthest-pair scan — fine for the tens of boreholes handled here.
function defaultLine(holes){
  let best=[holes[0],holes[holes.length-1]], bd=-1;
  for (let i=0;i<holes.length;i++) for (let j=i+1;j<holes.length;j++){
    const d=Math.hypot(holes[i].x-holes[j].x, holes[i].y-holes[j].y);
    if (d>bd){ bd=d; best=[holes[i],holes[j]]; }
  }
  return { a:toLL(best[0].x,best[0].y), b:toLL(best[1].x,best[1].y) };
}

function destroySecMap(){
  if (secMap){ secMap.remove(); secMap=null; }
  secBhLayer=secLabelLayer=secLinePoly=secHandleA=secHandleB=secBoundaryRect=secStructLayer=null;
  secPlanNames=[];
}

async function renderSitePlan(){
  const box = document.getElementById('siteplan-viz');
  if (!box) return;
  const holes = sectionHoles();
  if (holes.length < 2){
    destroySecMap();
    box.innerHTML='<p class="hint" style="padding:8px">Load boreholes from the Site Map tab, or add 2+ boreholes with coordinates, to define a cross-section.</p>';
    return;
  }
  await ensureMapLibs(); await ensurePlacer();

  // View bounds ≈50% larger than the site boundary (or the borehole spread).
  const lls = holes.map(b=>toLL(b.x,b.y));
  const sp = state.sitePlan;
  let latMin,latMax,lngMin,lngMax;
  if (sp && sp.bounds && Number.isFinite(sp.bounds.latMin)){
    ({latMin,latMax,lngMin,lngMax} = sp.bounds);
  } else {
    latMin=Math.min(...lls.map(p=>p[0])); latMax=Math.max(...lls.map(p=>p[0]));
    lngMin=Math.min(...lls.map(p=>p[1])); lngMax=Math.max(...lls.map(p=>p[1]));
  }
  const dLat=(latMax-latMin)*0.25||0.0008, dLng=(lngMax-lngMin)*0.25||0.0008;
  const expanded=[[latMin-dLat,lngMin-dLng],[latMax+dLat,lngMax+dLng]];

  if (!secMap){
    box.innerHTML=''; box.style.padding='0';
    secMap=L.map(box,{zoomControl:true});
    secBhLayer=L.layerGroup().addTo(secMap);
    secLabelLayer=L.layerGroup().addTo(secMap);
    secMap.fitBounds(expanded);
    await setBase(secMap, 'sp', document.getElementById('sp-base').value);
    // borehole-name placement is solved in screen pixels: re-solve on view change
    secMap.on('zoomend moveend', ()=>drawPlanNames());
    secMap.on('mousedown', startPlanDraw);
  }
  secMap.setMaxBounds(expanded);
  secMap.fitBounds(expanded);
  setTimeout(()=>secMap.invalidateSize(),60);

  // reference site-boundary rectangle (thick & bright so it reads clearly on satellite)
  if (secBoundaryRect){ secMap.removeLayer(secBoundaryRect); secBoundaryRect=null; }
  if (sp && sp.bounds && Number.isFinite(sp.bounds.latMin)){
    secBoundaryRect=L.rectangle([[sp.bounds.latMin,sp.bounds.lngMin],[sp.bounds.latMax,sp.bounds.lngMax]],
      {color:'#ffd24a',weight:4,opacity:1,dashArray:'10,6',fill:false}).addTo(secMap);
  }

  if (!sectionLine) sectionLine=defaultLine(holes);
  drawSectionLine();
  drawPlanStructs();
  updateSection();
}

function drawSectionLine(){
  const {a,b}=sectionLine;
  if (!secLinePoly){
    secLinePoly=L.polyline([a,b],{color:'#d33',weight:3, interactive:true}).addTo(secMap);
    const mk=ll=>L.marker(ll,{draggable:true,
      icon:L.divIcon({className:'sec-handle',iconSize:[16,16],iconAnchor:[8,8]})}).addTo(secMap);
    secHandleA=mk(a); secHandleB=mk(b);
    secHandleA.on('drag',onHandleDrag); secHandleB.on('drag',onHandleDrag);
    enableLineDrag();
  } else {
    secLinePoly.setLatLngs([a,b]); secHandleA.setLatLng(a); secHandleB.setLatLng(b);
  }
  syncAbFields();
}

// Drag the line itself to translate the whole section (the handles move each end).
function enableLineDrag(){
  let from=null;
  secLinePoly.on('mousedown', e=>{
    from=e.latlng;
    secMap.dragging.disable();
    secMap.on('mousemove', onMove);
    secMap.once('mouseup', ()=>{ secMap.off('mousemove', onMove); secMap.dragging.enable(); from=null; });
    L.DomEvent.stop(e);
  });
  function onMove(e){
    if (!from) return;
    const dLat=e.latlng.lat-from.lat, dLng=e.latlng.lng-from.lng;
    from=e.latlng;
    sectionLine={ a:[sectionLine.a[0]+dLat, sectionLine.a[1]+dLng],
                  b:[sectionLine.b[0]+dLat, sectionLine.b[1]+dLng] };
    secLinePoly.setLatLngs([sectionLine.a, sectionLine.b]);
    secHandleA.setLatLng(sectionLine.a); secHandleB.setLatLng(sectionLine.b);
    syncAbFields();
    updateSection();
  }
}

function onHandleDrag(){
  const a=secHandleA.getLatLng(), b=secHandleB.getLatLng();
  sectionLine={ a:[a.lat,a.lng], b:[b.lat,b.lng] };
  secLinePoly.setLatLngs([sectionLine.a, sectionLine.b]);
  syncAbFields();
  updateSection();   // live redraw of the cross-section as the line moves
}

// ---- A/B coordinate fields (two-way with the map) --------------------------
// The section line is stored as lat/lng but HK engineers work in HK1980 grid
// metres, so the boxes are E/N. `_abTyping` stops the map's own updates from
// re-writing the box under the user's cursor mid-edit.
let _abTyping=false;
function syncAbFields(){
  if (_abTyping || !sectionLine) return;
  const A=toEN(...sectionLine.a), B=toEN(...sectionLine.b);
  const set=(id,v)=>{ const el=document.getElementById(id); if (el && document.activeElement!==el) el.value=v.toFixed(1); };
  set('sec-ae',A.e); set('sec-an',A.n); set('sec-be',B.e); set('sec-bn',B.n);
  const info=document.getElementById('sec-ab-info');
  if (info){
    const len=Math.hypot(B.e-A.e, B.n-A.n);
    let brg=(Math.atan2(B.e-A.e, B.n-A.n)*180/Math.PI)%360; if (brg<0) brg+=360;
    info.textContent=`length ${len.toFixed(1)} m · bearing ${brg.toFixed(1)}° (grid north)`;
  }
}
// typed coordinates -> move the line (live, on every keystroke)
function abFieldsToLine(){
  const v=id=>{ const raw=(document.getElementById(id).value||'').trim(); return raw===''?NaN:+raw; };
  const ae=v('sec-ae'), an=v('sec-an'), be=v('sec-be'), bn=v('sec-bn');
  if (![ae,an,be,bn].every(Number.isFinite)) return;          // mid-typing / blank
  if (Math.hypot(be-ae, bn-an) < 1) return;                   // degenerate line
  _abTyping=true;
  sectionLine={ a:toLL(ae,an), b:toLL(be,bn) };
  if (secLinePoly){
    secLinePoly.setLatLngs([sectionLine.a, sectionLine.b]);
    secHandleA.setLatLng(sectionLine.a); secHandleB.setLatLng(sectionLine.b);
  }
  updateSection();
  _abTyping=false;
  syncAbFields();                                             // refresh length/bearing
}

// Project boreholes onto the current line, pick those within a corridor,
// order by distance along the line, then redraw the section.
function updateSection(){
  if (!secMap || !sectionLine || !hasView(secMap)) return;
  const A=toEN(...sectionLine.a), B=toEN(...sectionLine.b);
  const lineLen=Math.hypot(B.e-A.e, B.n-A.n);
  const allHoles=sectionHoles();
  const bhOnly = document.getElementById('sec-bh-only')?.checked;
  // Manual deselection is applied BEFORE the corridor test, so a deselected hole
  // is simply not a candidate — it can't come back by widening the tolerance.
  const secHoles = (bhOnly ? allHoles.filter(b=>(b.kind||'BH')!=='TP') : allHoles)
    .filter(b=>!secExcluded.has(b.id));
  const corridor = +document.getElementById('sec-tol').value;   // task 5: distance tolerance (m)
  const extension = +document.getElementById('sec-ext')?.value || 0;   // include boreholes behind A/B
  const { stations, inSet } = sectionStations(A, B, secHoles, corridor, extension);
  secBhLayer.clearLayers();
  for (const bh of allHoles){
    const inSec=inSet.has(bh.id), off=secExcluded.has(bh.id);
    // Same grey as any hole outside the corridor — a deselected borehole reads
    // exactly like an excluded one, which is what it now is.
    L.circleMarker(toLL(bh.x,bh.y),{radius:inSec?6:4,color:'#1a1a0f',weight:1,
      fillColor:inSec?'#2f5a1e':'#a8a196',fillOpacity:.9})
      .bindTooltip(off ? `${bh.id} — deselected (click to put back in)`
                       : `${bh.id} (click to leave out of the section)`)
      .on('click', ev=>{ L.DomEvent.stop(ev); toggleSectionBorehole(bh.id); })
      .addTo(secBhLayer);
  }
  updateExcludedNote(allHoles);
  drawPlanNames(allHoles);
  const groundMode = document.getElementById('sec-ground')?.value || 'dtm-offset';
  if (groundMode!=='interp' && lineLen>=1){
    // Prefetch tiles for the EXTENDED span, not just the drawn A-B segment —
    // a borehole pulled in by "Include beyond A/B" needs terrain out there
    // too, or it's stuck showing "still loading" forever (nothing ever asks
    // for those tiles otherwise).
    const tExt = extension/lineLen;
    const extA = { e:A.e-(B.e-A.e)*tExt, n:A.n-(B.n-A.n)*tExt };
    const extB = { e:B.e+(B.e-A.e)*tExt, n:B.n+(B.n-A.n)*tExt };
    const [aLat,aLng]=toLL(extA.e,extA.n), [bLat,bLng]=toLL(extB.e,extB.n);
    const tiles = tilesForLine(aLng, aLat, bLng, bLat, TILE_LOD);
    // The offset-corrected surface samples the DTM at EVERY borehole's own
    // position (not just those in the section — see siteDeltas), which can sit
    // in tiles the line never crosses.
    if (groundMode==='dtm-offset')
      for (const b of allHoles){
        const [la,ln]=toLL(b.x,b.y);
        tiles.push(tileCoord(ln, la, TILE_LOD));
      }
    // Redraw is fire-and-forget: renders now with whatever tiles are already
    // cached (falling back to the interpolated surface if none are), then
    // re-fires once the DTM tiles finish loading.
    prefetchDtmTiles(tiles, updateSection);
  }
  renderSection(stations, +document.getElementById('sec-vex').value, lineLen, A, B);
}

// Click a borehole on the site plan to take it out of / put it back into the
// section. Kept as a set of ids (not a flag on the borehole) so it survives a
// re-import of the same site, and so it saves as one short list.
function toggleSectionBorehole(id){
  if (secExcluded.has(id)) secExcluded.delete(id); else secExcluded.add(id);
  updateSection();
}
function updateExcludedNote(allHoles){
  const note=document.getElementById('sec-excluded-note');
  if (!note) return;
  const live=(allHoles||sectionHoles()).filter(b=>secExcluded.has(b.id)).map(b=>b.id);
  note.textContent = live.length ? `Deselected: ${live.join(', ')}` : '';
  const btn=document.getElementById('sec-inc-reset');
  if (btn) btn.disabled = !live.length;
}

// Borehole names on the site plan (task 2). De-cluttered with leader lines so
// closely-spaced holes can't be confused, and the solved layout is kept so the
// PNG export puts the names exactly where the preview shows them.
function drawPlanNames(holes){
  if (!secMap || !secLabelLayer || !hasView(secMap)) return;
  secLabelLayer.clearLayers();
  secPlanNames=[];
  const note=document.getElementById('sp-crowd');
  if (!document.getElementById('sp-names')?.checked){ if (note) note.textContent=''; return; }
  const list=(holes||sectionHoles()).map(b=>({ id:b.id, ll:toLL(b.x,b.y), text:b.id }));
  const { layout, dropped } = placePointLabels(secMap, secLabelLayer, list);
  secPlanNames=layout;
  if (note) note.textContent = dropped
    ? `${dropped} name(s) hidden to keep the plan readable — zoom in to place them.` : '';
}

// Build monotonic horizon boundaries for one borehole, in the GLOBAL
// stratigraphic order (STRAT, shallowest-first). horizons[k] = elevation of
// the boundary ABOVE stratum k; horizons[k+1] = boundary below it (0-thickness
// if that stratum isn't logged here). Because horizons only ever step DOWN as
// k increases, and linear interpolation of two non-increasing sequences stays
// non-increasing at every point in between, bands for different strata can
// never swap order / cross when interpolated between two boreholes — even if
// a borehole's own logged sequence is locally out of the usual order.
function buildHorizons(id){
  const bh = BH[id];
  const horizons = [bh.gl];
  for (const s of STRAT){
    const top = horizons[horizons.length-1];
    // deepest base among all layers of this class (grade numeral or surface),
    // so several bands that share a grade collapse to one envelope
    const matched = bh.layers.filter(l=>classKey(l)===s);
    const deepestBase = matched.length ? Math.max(...matched.map(l=>l.base)) : null;
    horizons.push(deepestBase!=null ? Math.min(bh.gl - deepestBase, top) : top);
  }
  return horizons;
}

// stations = [{id, dist}] ordered by distance along the section line (dist
// measured from end A). lineLen = full A→B length in metres (0 = degenerate).
function renderSection(stations, vex, lineLen, A, B){
  const box = document.getElementById('sec-viz');
  box.innerHTML='';
  stations = (stations||[]).filter(s=>BH[s.id] && BH[s.id].layers.length);
  if (stations.length < 2){ box.innerHTML='<p class="hint" style="padding:10px">Drag the section line over at least 2 boreholes (widen the distance tolerance if needed).</p>'; return; }

  const ids = stations.map(s=>s.id);
  // dist can now be <0 (before A) or >lineLen (past B) — "Include beyond A/B"
  // (sec-ext) lets a station project outside the drawn segment and still
  // count. dMin/dMax always cover the drawn line's own 0..lineLen too, so A
  // and B stay on the plot even when nothing sits near an end.
  let dist, dMin, dMax;
  if (lineLen>=1){
    dist=stations.map(s=>s.dist);                     // A at 0, B at lineLen
    dMin=Math.min(0, ...dist); dMax=Math.max(lineLen, ...dist);
  } else {
    const d0=stations[0].dist; dist=stations.map(s=>s.dist-d0);
    let span=dist[dist.length-1]||(ids.length-1);
    if (span===0){ dist=dist.map((_,i)=>i); span=ids.length-1; }
    dMin=0; dMax=span;
  }
  const plotSpan = (dMax-dMin) || 1;

  const showLogs   = document.getElementById('sec-show-logs')?.checked ?? true;
  const showNames  = document.getElementById('sec-show-names')?.checked ?? true;
  const showOffset = document.getElementById('sec-show-offset')?.checked ?? true;
  const titleTxt  = (document.getElementById('sec-title')?.value || '').trim() || 'Cross-section A–B';
  // Perpendicular distance of each borehole from the A–B line (task: offset
  // honesty). A borehole off the line is PROJECTED onto it — its log is real,
  // but the ground between it and the line may not be, so the further off it
  // sits relative to the chosen tolerance, the less its projected position
  // should be trusted. Flagged at >50%/>85% of the tolerance rather than a
  // fixed metre value, since "close" is relative to how wide a corridor the
  // user chose to include.
  const corridor = +document.getElementById('sec-tol')?.value || 100;
  const perp = stations.map(s=>s.perp||0);
  const offsetSeverity = p => p > corridor*0.85 ? 'high' : p > corridor*0.5 ? 'med' : 'low';

  // Container width (independent of elevation range) is needed up front so the
  // query-point spacing below can be chosen — and so a terrain top surface can
  // be sampled — before the elevation axis (which the terrain surface can
  // extend) is finalised.
  const legendW=205, mL=56, mR=20+legendW;
  const avail=(box.clientWidth ? box.clientWidth : 900) - 24;
  const plotW=Math.max(480, avail - mL - mR);

  // coloured grade bands, interpolated between boreholes by the chosen method
  // (task 9). Horizons are interpolated as top-surface + thicknesses, so bands
  // can pinch out but never cross — see interpolateHorizons().
  const method = document.getElementById('sec-interp')?.value || 'linear';
  const groundMode = document.getElementById('sec-ground')?.value || 'dtm-offset';
  const horizons = ids.map(id=>buildHorizons(id));
  // Sample every ~3 px for linear/nearest fidelity, smooth cubic curves, AND
  // whenever a terrain ground surface is in play — the DTM has real shape
  // between boreholes even where the strata bands are drawn as straight lines,
  // and a 2-point "linear" xq would flatten it back to a straight line too.
  // ---- how far the drawn bands run -----------------------------------------
  // 'off' (default) stops the bands at the outermost borehole: nothing was
  // logged past it, so nothing is drawn there. 'hold'/'linear' continue them to
  // the section's own ends (A/B, or wherever "Include beyond A/B" reaches) —
  // useful for showing a proposed structure that sits past the last hole, but
  // that stretch is an assumption, not data, and is labelled as such below.
  const extrapMode = document.getElementById('sec-extrap')?.value || 'off';
  const extrap = extrapMode==='linear' ? 'linear' : 'hold';
  const qLo = extrapMode==='off' ? dist[0] : Math.min(dMin, dist[0]);
  const qHi = extrapMode==='off' ? dist[dist.length-1] : Math.max(dMax, dist[dist.length-1]);
  const nQ = (method==='linear' && groundMode==='interp') ? 0 : Math.max(ids.length, Math.round(plotW/3));
  let xq = nQ ? Array.from({length:nQ+1},(_,i)=>qLo+(qHi-qLo)*i/nQ) : [qLo, ...dist, qHi];
  // Terrain modes must reproduce each collar's GL EXACTLY (see terrain.js
  // correctedProfile) — that only holds where a query point exactly equals a
  // station's distance, so merge the stations' own distances into the grid
  // rather than rely on luck. (Cheap: at most a few extra points.)
  xq = [...new Set([...xq, ...dist])].sort((a,b)=>a-b);

  // ---- ground surface: interpolated between boreholes, or terrain-derived ----
  // See docs/PLAN_TERRAIN_PROFILE.md. "dtm-fit" adds the DTM's own local shape
  // on top of the usual borehole-interpolated surface (correctedProfile), so
  // it still passes exactly through every surveyed collar; "dtm-raw" shows
  // the DTM as-is for comparison, with a strong caveat since it can include
  // vegetation canopy / bridge decks.
  // Strata layers are ALWAYS built the same way regardless of ground-surface
  // mode: each stratum's THICKNESS at each borehole (never its raw elevation)
  // is interpolated between boreholes, then the layers are stacked downward
  // from whichever top surface is selected below. So the layer geometry
  // itself never changes — only what it hangs from does. See the layer note
  // set for every mode below (sec-ground-note).
  const LAYER_NOTE = ' Soil/rock layers themselves are unchanged by this: each stratum’s thickness at each borehole is interpolated between boreholes as before, then stacked down from this surface — the layers are not re-derived from the DTM.';
  let topOverride=null, groundNote='';
  if (groundMode==='interp'){
    groundNote = 'Ground surface: interpolated between each borehole’s own surveyed ground level.'+LAYER_NOTE;
  } else if (A && B && lineLen>=1){
    // t deliberately allowed outside [0,1] — a station included via "Include
    // beyond A/B" projects to d<0 or d>lineLen, and this just extrapolates
    // along the same line bearing to sample the DTM out there too.
    const pointLL = d => { const t=d/lineLen; return toLL(A.e+(B.e-A.e)*t, A.n+(B.n-A.n)*t); };
    const dtmAt = d => { const [lat,lng]=pointLL(d); return sampleElevation(dtmTileGetter, lng, lat); };
    const queryDtm = xq.map(dtmAt);
    if (queryDtm.every(v=>v!=null)){
      if (groundMode==='dtm-raw'){
        topOverride = queryDtm;
        groundNote = 'Ground surface: LandsD 5 m DTM, raw — includes vegetation canopy height and elevated structures where present (±5 m stated accuracy). Not fitted to the boreholes, so it will disagree with each borehole’s own collar level (and its log rectangle, which is always drawn at the true surveyed level).'+LAYER_NOTE;
      } else if (groundMode==='dtm-offset'){
        // Collar-vs-DTM difference measured at EVERY borehole on the site (not
        // only those drawn), spread in plan and read off along the line — so the
        // ground line no longer shifts when the distance tolerance pulls more
        // boreholes into the section. See terrain.js idwDelta.
        const { pts, missing } = siteDeltas();
        if (!pts.length){
          groundNote = 'Terrain tiles for the borehole positions are still loading — showing the interpolated surface for now.';
        } else {
          topOverride = xq.map((d,q)=>{ const t=d/lineLen;
            return queryDtm[q] + idwDelta(pts, A.e+(B.e-A.e)*t, A.n+(B.n-A.n)*t); });
          const worst = ids.map((id,i)=>Math.abs(topOverride[xq.indexOf(dist[i])] - BH[id].gl));
          const maxGap = worst.length ? Math.max(...worst) : 0;
          groundNote = `Ground surface: LandsD 5 m DTM sampled along the section line, corrected by the difference between surveyed collar level and DTM measured at all ${pts.length} boreholes on the site (weighted by distance in plan) — so it stays the same whichever boreholes are included in the section. `
            + (missing ? `(${missing} borehole(s) had no DTM cover and contribute no correction.) ` : '')
            + `An off-line borehole was logged somewhere else, so the ground line will NOT pass exactly through its collar — here up to ${maxGap.toFixed(1)} m apart. Its log rectangle is still drawn at the true surveyed level.`
            + LAYER_NOTE;
        }
      } else {
        topOverride = correctedProfile(dist, ids.map(id=>BH[id].gl), xq, queryDtm);
        groundNote = 'Ground surface: LandsD 5 m DTM shape, forced to pass exactly through each borehole’s surveyed ground level — the shape between them follows real terrain instead of a straight/smooth guess.'+LAYER_NOTE;
      }
    } else {
      groundNote = 'Terrain tiles still loading for this line — showing the interpolated surface for now.';
    }
  }
  if (extrapMode!=='off'){
    groundNote += (groundNote?' ':'')
      + (extrapMode==='linear'
          ? 'Beyond the outermost borehole the layers are continued on the trend of the last two boreholes out to the section ends — an extrapolation, not logged data.'
          : 'Beyond the outermost borehole the layers are held flat at that borehole’s own values out to the section ends — an extrapolation, not logged data.');
  }
  const groundNoteEl = document.getElementById('sec-ground-note');
  if (groundNoteEl) groundNoteEl.textContent = groundNote;

  // Plan-drawn structures the section line actually passes through, clipped to
  // the plotted chainage range.
  const planCuts = (A && B && lineLen>=1) ? secAnnots.map(a=>{
    if (a.kind!=='plan') return null;
    const c=cutPolygon(A, B, a.en); if (!c) return null;
    const lo=Math.max(c[0],dMin), hi=Math.min(c[1],dMax);
    return hi>lo ? {a, lo, hi} : null;
  }).filter(Boolean) : [];
  let eMin=Infinity, eMax=-Infinity;
  for (const {a} of planCuts){ eMax=Math.max(eMax,a.top); eMin=Math.min(eMin,a.top-a.depth); }
  for (const id of ids){ const bh=BH[id]; eMax=Math.max(eMax,bh.gl); for (const l of bh.layers) eMin=Math.min(eMin,bh.gl-l.base); }
  if (topOverride) for (const v of topOverride){ eMax=Math.max(eMax,v); eMin=Math.min(eMin,v); }
  const eRange=(eMax-eMin)||1;
  secPlotRange={dMin,dMax,eMin,eMax};

  // classes actually present in the CURRENTLY-included boreholes — the legend
  // reflects only these, so it updates live as the section line is dragged and
  // boreholes (and their soil/rock types) enter or leave the section. (task 12)
  const present = new Set();
  for (const id of ids) for (const l of BH[id].layers) present.add(classKey(l));
  const activeStrat = STRAT.filter(s=>present.has(s));

  // Elevation axis + canvas sizing now that eRange (possibly widened by the
  // terrain surface above) is known.
  const mT=56, mB=showNames?66:44;
  const xPxPerM=plotW/plotSpan, yPxPerM=xPxPerM*vex, plotH=eRange*yPxPerM;
  const W=mL+plotW+mR, H=mT+plotH+mB;
  const svg=el('svg',{width:W,height:H,viewBox:`0 0 ${W} ${H}`,'font-family':'Outfit,sans-serif'});
  svg.appendChild(el('rect',{x:0,y:0,width:W,height:H,fill:'#fffdf8'}));
  // X is offset by dMin so a station pulled in from before A (negative dist)
  // still lands inside the plot instead of off its left edge.
  const X=d=>mL+(d-dMin)*xPxPerM, Y=e=>mT+(eMax-e)*yPxPerM, elevAt=(id,d)=>BH[id].gl-d;
  const bMarkerD = lineLen>=1 ? lineLen : dMax;     // B's own position — see A/B markers below

  svg.appendChild(el('text',{x:mL,y:24,'font-size':15,'font-weight':700,fill:'#1e3c12'},titleTxt));
  svg.appendChild(el('text',{x:mL,y:40,'font-size':11,fill:'#6b6250'},`Vertical exaggeration ${vex}×  ·  length ${bMarkerD.toFixed(0)} m`));

  // Y grid (elevation)
  const estep=niceStep(eRange), e0=Math.ceil(eMin/estep)*estep;
  for (let e=e0; e<=eMax+0.001; e+=estep){
    const y=Y(e);
    svg.appendChild(el('line',{x1:mL,y1:y,x2:mL+plotW,y2:y,stroke:'#eae1cf'}));
    svg.appendChild(el('line',{x1:mL-4,y1:y,x2:mL,y2:y,stroke:'#6b6250'}));
    svg.appendChild(el('text',{x:mL-7,y:y+3,'font-size':10,'text-anchor':'end',fill:'#6b6250'},e.toFixed(0)));
  }
  svg.appendChild(el('text',{x:mL-46,y:mT-10,'font-size':10,'font-weight':600,fill:'#6b6250'},'mPD'));

  // X grid (distance along the line, A=0) — task 8. Starts from the first
  // nice step at/below dMin so labels stay meaningful (and negative) for any
  // stretch pulled in from before A by "Include beyond A/B".
  const xstep=niceStep(plotSpan), yAxis=mT+plotH;
  for (let d=Math.ceil(dMin/xstep)*xstep; d<=dMax+0.001; d+=xstep){
    const x=X(d);
    svg.appendChild(el('line',{x1:x,y1:mT,x2:x,y2:yAxis,stroke:'#f0e8d6'}));
    svg.appendChild(el('line',{x1:x,y1:yAxis,x2:x,y2:yAxis+4,stroke:'#6b6250'}));
    svg.appendChild(el('text',{x:x,y:yAxis+15,'font-size':9.5,'text-anchor':'middle',fill:'#6b6250'},d.toFixed(0)));
  }
  svg.appendChild(el('text',{x:mL+plotW/2,y:H-4,'font-size':10,'font-weight':600,'text-anchor':'middle',fill:'#6b6250'},'Distance along section (m)'));

  const curves = interpolateHorizons(dist, horizons, xq, method, topOverride, extrap);
  for (let k=0;k<STRAT.length;k++){
    const c=STRAT_COLOUR[STRAT[k]] || colourFor(STRAT[k]);
    const top=curves[k], base=curves[k+1];
    if (top.every((v,q)=>v===base[q])) continue;                     // absent everywhere
    const fwd=xq.map((d,q)=>`${X(d)},${Y(top[q])}`);
    const rev=xq.map((d,q)=>`${X(d)},${Y(base[q])}`).reverse();
    svg.appendChild(el('polygon',{points:fwd.concat(rev).join(' '),fill:c,opacity:.85,
      stroke:c,'stroke-width':.5,'data-cls':STRAT[k]}));
  }
  svg.appendChild(el('polyline',{points:xq.map((d,q)=>`${X(d)},${Y(curves[0][q])}`).join(' '),
    fill:'none',stroke:'#3d3529','stroke-width':1.4}));

  const OFFSET_COLOUR={low:'#6b6250', med:'#b8860b', high:'#b02a2a'};
  ids.forEach((id,i)=>{
    const bh=BH[id], x=X(dist[i]), w=8, sev=offsetSeverity(perp[i]);
    if (showLogs) for (const l of bh.layers){                      // task 6: toggle borehole logs
      const y0=Y(elevAt(id,l.top)), y1=Y(elevAt(id,l.base));
      // off-line boreholes are dashed, not solid — the log itself is real data,
      // but its horizontal position on THIS section is a projection, and the
      // dash says so at a glance without needing the legend read first.
      const rectAttrs={x:x-w/2,y:y0,width:w,height:Math.max(0,y1-y0),fill:classColour(l),
        stroke:'#1a1a0f','stroke-width':.8,'data-cls':classKey(l)};
      if (sev!=='low') rectAttrs['stroke-dasharray']='2,1.5';
      svg.appendChild(el('rect',rectAttrs));
    }
    if (showNames){                                                // task 6: toggle borehole names
      svg.appendChild(el('line',{x1:x,y1:yAxis,x2:x,y2:yAxis+6,stroke:'#6b6250'}));
      svg.appendChild(el('text',{x:x,y:yAxis+30,'font-size':10,'font-weight':600,'text-anchor':'middle',fill:'#1e3c12'},id));
      if (showOffset && perp[i]>0.05){                              // offset from the section line
        svg.appendChild(el('text',{x:x,y:yAxis+43,'font-size':9,'text-anchor':'middle',fill:OFFSET_COLOUR[sev]},
          `${perp[i].toFixed(1)} m off-line`));
      }
    }
  });

  // A / B end markers matching the section line on the map — task 9
  [[X(0),'A','start'],[X(bMarkerD),'B','end']].forEach(([x,lab])=>{
    svg.appendChild(el('line',{x1:x,y1:mT,x2:x,y2:yAxis,stroke:'#d33','stroke-width':1.2,'stroke-dasharray':'4,3'}));
    svg.appendChild(el('circle',{cx:x,cy:mT-10,r:9,fill:'#d33'}));
    svg.appendChild(el('text',{x:x,y:mT-6,'font-size':11,'font-weight':700,'text-anchor':'middle',fill:'#fff'},lab));
  });


  // ---- where the data stops -----------------------------------------------
  if (extrapMode!=='off' && (dist[0]>dMin+0.5 || dist[dist.length-1]<dMax-0.5)){
    for (const d of [dist[0], dist[dist.length-1]]){
      const x=X(d);
      svg.appendChild(el('line',{x1:x,y1:mT,x2:x,y2:yAxis,stroke:'#8a7f68',
        'stroke-width':1,'stroke-dasharray':'2,4'}));
    }
    svg.appendChild(el('text',{x:mL+plotW,y:mT-14,'font-size':9.5,'text-anchor':'end',fill:'#8a7f68'},
      'dotted grey = last borehole; beyond it the layers are extrapolated'));
  }

  // ---- annotations: proposed-structure outlines ---------------------------
  // Stored in real section coordinates (chainage m, level mPD), so a rotated
  // rectangle is a true rectangle ON THE GROUND. Under vertical exaggeration it
  // therefore draws as a parallelogram — deliberate: the shape means metres,
  // not pixels.
  const ptStr = pts => pts.map(([d,e])=>`${X(d)},${Y(e)}`).join(' ');
  // mouse position -> section metres (the SVG may be scaled down by CSS)
  const toSec = ev => { const r=svg.getBoundingClientRect(), k=W/(r.width||W);
    return [dMin+((ev.clientX-r.left)*k-mL)/xPxPerM, eMax-((ev.clientY-r.top)*k-mT)/yPxPerM]; };
  const dragWith = (onMove, onUp) => {
    const up=()=>{ window.removeEventListener('mousemove',onMove);
                   window.removeEventListener('mouseup',up); onUp(); };
    window.addEventListener('mousemove',onMove); window.addEventListener('mouseup',up);
  };

  // plan-drawn structures, where the line cuts them (edited on the plan, not here)
  for (const {a, lo, hi} of planCuts){
    const col=a.colour||'#1f5fa8';
    const pts=[[lo,a.top],[hi,a.top],[hi,a.top-a.depth],[lo,a.top-a.depth]];
    const poly=el('polygon',{points:ptStr(pts), fill:col, 'fill-opacity':.22, stroke:col, 'stroke-width':2});
    const tip=document.createElementNS('http://www.w3.org/2000/svg','title');
    tip.textContent=`${a.label||'Structure'} — drawn on the site plan; edit it there`;
    poly.appendChild(tip);
    svg.appendChild(poly);
    if ((a.label||'').trim())
      svg.appendChild(el('text',{x:X((lo+hi)/2), y:Y(a.top-a.depth/2)+3, 'font-size':11, 'font-weight':700,
        'text-anchor':'middle', fill:col, 'pointer-events':'none'}, a.label.trim()));
  }

  // section-drawn rectangles. Stored in real section coordinates (chainage m,
  // level mPD), so a rotated rectangle is a true rectangle ON THE GROUND and
  // draws as a parallelogram under vertical exaggeration — deliberate.
  secAnnots.forEach((an, ai)=>{
    if (an.kind==='plan' || !Array.isArray(an.pts) || an.pts.length<3) return;
    const col = an.colour || '#1e3c12';
    const g=el('g',{'data-annot':ai});
    const poly=el('polygon',{points:'', fill:col, 'fill-opacity':.16,
      stroke:col, 'stroke-width':1.8, 'stroke-dasharray':'7,4', style:'cursor:move'});
    g.appendChild(poly);
    const txt = (an.label||'').trim() ? el('text',{'font-size':11, 'font-weight':700,
      'text-anchor':'middle', fill:col, 'pointer-events':'none'}, an.label.trim()) : null;
    if (txt) g.appendChild(txt);
    // white corner squares = resize handles (left out of the PNG export)
    const handles=an.pts.map(()=>{ const h=el('rect',{width:9,height:9,fill:'#fff',stroke:col,
      'stroke-width':1.5,class:'annot-handle',style:'cursor:nwse-resize'}); g.appendChild(h); return h; });
    // During a drag only this shape's own nodes move; the full redraw and the
    // number boxes catch up on mouse-up.
    const refresh=()=>{
      poly.setAttribute('points', ptStr(an.pts));
      const b=ptsToBox(an.pts);
      if (txt){ txt.setAttribute('x', X(b.cx)); txt.setAttribute('y', Y(b.cy)+3); }
      an.pts.forEach(([d,e],k)=>{ handles[k].setAttribute('x',X(d)-4.5); handles[k].setAttribute('y',Y(e)-4.5); });
    };
    refresh();
    poly.addEventListener('mousedown', ev=>{
      if (secDrawMode) return;
      ev.preventDefault(); ev.stopPropagation();
      const p0=toSec(ev), orig=an.pts.map(pt=>pt.slice());
      dragWith(e2=>{ const p=toSec(e2);
        an.pts=orig.map(([d,e])=>[d+p[0]-p0[0], e+p[1]-p0[1]]); refresh(); }, renderAnnotList);
    });
    // resize from the drag-start shape each time, so the corner being dragged
    // stays under the cursor even if the box flips past its opposite corner
    handles.forEach((h,k)=>h.addEventListener('mousedown', ev=>{
      if (secDrawMode) return;
      ev.preventDefault(); ev.stopPropagation();
      const orig=an.pts.map(pt=>pt.slice());
      dragWith(e2=>{ an.pts=resizeFromCorner(orig, k, toSec(e2)); refresh(); },
               ()=>{ renderAnnotList(); updateSection(); });
    }));
    svg.appendChild(g);
  });

  // "Draw on section" armed: drag out a new box (a plain click drops a default one)
  if (secDrawMode==='section'){
    svg.style.cursor='crosshair';
    svg.addEventListener('mousedown', ev=>{
      ev.preventDefault();
      const p0=toSec(ev), c0=[ev.clientX, ev.clientY], col='#b02a2a';
      const ghost=el('polygon',{fill:col,'fill-opacity':.12,stroke:col,'stroke-width':1.5,'stroke-dasharray':'4,3'});
      svg.appendChild(ghost);
      const box=(a,b)=>{ const [d0,d1]=[a[0],b[0]].sort((x,y)=>x-y), [e0,e1]=[a[1],b[1]].sort((x,y)=>x-y);
        return [[d0,e0],[d1,e0],[d1,e1],[d0,e1]]; };
      let p1=p0, moved=false;
      dragWith(e2=>{ p1=toSec(e2); moved = moved || Math.hypot(e2.clientX-c0[0], e2.clientY-c0[1])>4;
                     ghost.setAttribute('points', ptStr(box(p0,p1))); },
        ()=>{
          const pts = moved ? box(p0,p1)
            : boxToPts(p0[0], p0[1], Math.max(5,plotSpan*0.2), Math.max(2,eRange*0.18), 0);
          secAnnots.push({ label:'Proposed structure', colour:col, pts });
          setDrawMode(null); renderAnnotList();
        });
    });
  }

  // legend (by decomposition grade / material), in the right-hand gutter —
  // only the classes present in the current section (updates live on drag)
  const lx=W-mR+8;
  svg.appendChild(el('rect',{x:lx-6,y:mT-6,width:legendW-6,height:Math.max(1,activeStrat.length)*16+22,
    fill:'#fffdf8',opacity:.92,stroke:'#c8bda8','stroke-width':.8,rx:6}));
  svg.appendChild(el('text',{x:lx,y:mT+8,'font-size':10,'font-weight':700,fill:'#1e3c12'},'Decomposition grade'));
  let ly=mT+24;
  activeStrat.forEach(s=>{
    const g=el('g',{'data-cls':s,style:'cursor:default'});
    g.appendChild(el('rect',{x:lx,y:ly-8,width:11,height:11,fill:STRAT_COLOUR[s]||colourFor(s),stroke:'#3d3529','stroke-width':.6}));
    g.appendChild(el('text',{x:lx+16,y:ly+1,'font-size':10,fill:'#1a1a0f'},STRAT_LABEL[s]||s));
    svg.appendChild(g); ly+=16;
  });

  // hover interactivity — highlight one class, dim the rest — task 5
  const clsEls=[...svg.querySelectorAll('[data-cls]')];
  svg.addEventListener('mouseover', e=>{
    const t=e.target.closest('[data-cls]'); if(!t) return;
    const c=t.getAttribute('data-cls');
    clsEls.forEach(n=>n.classList.toggle('dimmed', n.getAttribute('data-cls')!==c));
  });
  svg.addEventListener('mouseleave', ()=> clsEls.forEach(n=>n.classList.remove('dimmed')));
  box.appendChild(svg);

  // ---- hover: vertical dotted line + every layer's level at that chainage ---
  // A cross-section is read at chainages, not at boreholes: this gives the
  // interpolated level of every boundary directly under the cursor, which is
  // what a foundation level is actually checked against.
  if (document.getElementById('sec-hover')?.checked){
    const hv=el('line',{x1:mL,y1:mT,x2:mL,y2:yAxis,stroke:'#1a1a0f','stroke-width':1,
      'stroke-dasharray':'4,4', opacity:0, 'pointer-events':'none'});
    svg.appendChild(hv);
    const tip=document.createElement('div'); tip.className='sec-tip'; box.appendChild(tip);
    // read a curve (sampled at xq) off at an arbitrary distance
    const at=(arr,d)=>{
      if (d<=xq[0]) return arr[0];
      if (d>=xq[xq.length-1]) return arr[arr.length-1];
      let i=0; while (i<xq.length-2 && xq[i+1]<d) i++;
      const h=xq[i+1]-xq[i];
      return h ? arr[i]+(arr[i+1]-arr[i])*(d-xq[i])/h : arr[i];
    };
    svg.addEventListener('mousemove', ev=>{
      const r=svg.getBoundingClientRect(), scale=W/(r.width||W);
      const sx=(ev.clientX-r.left)*scale;
      const d=dMin+(sx-mL)/xPxPerM;
      if (sx<mL || sx>mL+plotW || d<xq[0]-1e-9 || d>xq[xq.length-1]+1e-9){
        hv.setAttribute('opacity',0); tip.style.display='none'; return;
      }
      const x=X(d);
      hv.setAttribute('x1',x); hv.setAttribute('x2',x); hv.setAttribute('opacity',.8);
      let html=`<b>Chainage ${d.toFixed(1)} m from A</b>`
        + `<div>Ground surface<span class="lv">${at(curves[0],d).toFixed(2)} mPD</span></div>`;
      let rows=0;
      for (let j=0;j<STRAT.length;j++){
        const t=at(curves[j],d), b=at(curves[j+1],d);
        if (t-b < 0.01) continue;                       // stratum absent at this chainage
        rows++;
        html += `<div><span class="sw" style="background:${STRAT_COLOUR[STRAT[j]]||colourFor(STRAT[j])}"></span>`
              + `${esc(STRAT_LABEL[STRAT[j]]||STRAT[j])}`
              + `<span class="lv">top ${t.toFixed(2)} · ${(t-b).toFixed(2)} m</span></div>`;
      }
      if (rows) html += `<div>Base of logged ground<span class="lv">${at(curves[curves.length-1],d).toFixed(2)} mPD</span></div>`;
      tip.innerHTML=html;
      tip.style.display='block';
      const bb=box.getBoundingClientRect(), tw=tip.offsetWidth||210;
      tip.style.left=Math.min(Math.max(4, ev.clientX-bb.left+14), Math.max(4, box.clientWidth-tw-6))+'px';
      tip.style.top =Math.max(4, ev.clientY-bb.top-10)+'px';
    });
    svg.addEventListener('mouseleave', ()=>{ hv.setAttribute('opacity',0); tip.style.display='none'; });
  }
}


// ==== proposed-structure annotations: editor + drawing modes =================
// Section rectangles are four corners (chainage m from A, level mPD); plan
// footprints are four corners in HK1980 metres plus top level and depth. The
// corner maths (boxToPts/ptsToBox/resizeFromCorner/cutPolygon) lives in
// section_geom.js so it is Node-tested.
function normAnnot(a){
  if (!a) return null;
  if (a.kind==='plan')
    return Array.isArray(a.en) && a.en.length===4
      ? { kind:'plan', label:a.label||'', colour:a.colour||'#1f5fa8',
          en:a.en.map(p=>[+p[0], +p[1]]), top:+a.top||0, depth:Math.max(0,+a.depth||0) }
      : null;
  return Array.isArray(a.pts) && a.pts.length>=3
    ? { label:a.label||'', colour:a.colour||'#b02a2a', pts:a.pts.map(pt=>[+pt[0], +pt[1]]) }
    : null;
}

// Ground level at a plan position, from the same corrected-DTM model the
// section uses; nearest borehole's collar if the DTM tile isn't loaded yet.
function groundAt(e, n){
  const [la,ln]=toLL(e,n);
  const z=sampleElevation(dtmTileGetter, ln, la);
  if (z!=null) return z + idwDelta(siteDeltas().pts, e, n);
  let best=null, bd=Infinity;
  for (const b of sectionHoles()){ const d=Math.hypot(b.x-e, b.y-n);
    if (d<bd && Number.isFinite(b.gl)){ bd=d; best=b; } }
  return best ? best.gl : 0;
}

// Arm / disarm a drawing mode. Plan mode freezes map panning so the drag draws
// instead of scrolling the map.
function setDrawMode(mode){
  secDrawMode = secDrawMode===mode ? null : mode;
  const bs=document.getElementById('sec-annot-draw'), bp=document.getElementById('sec-annot-plan');
  if (bs) bs.classList.toggle('armed', secDrawMode==='section');
  if (bp) bp.classList.toggle('armed', secDrawMode==='plan');
  const hint=document.getElementById('sec-annot-mode');
  if (hint) hint.textContent = secDrawMode==='section' ? 'Drag a box on the cross-section below (Esc to cancel).'
    : secDrawMode==='plan' ? 'Drag a box on the site plan above (Esc to cancel).' : '';
  if (secMap){
    secMap.dragging[secDrawMode==='plan' ? 'disable' : 'enable']();
    secMap.getContainer().style.cursor = secDrawMode==='plan' ? 'crosshair' : '';
  }
  if (secMap) updateSection();              // section picks up / drops the crosshair
}

function startPlanDraw(ev){
  if (secDrawMode!=='plan') return;
  const s0=toEN(ev.latlng.lat, ev.latlng.lng);
  const ghost=L.rectangle([ev.latlng, ev.latlng],{color:'#1f5fa8',weight:2,dashArray:'4,3',fillOpacity:.1}).addTo(secMap);
  const c0=ev.containerPoint;
  let s1=s0, moved=false;
  const mv=e=>{ s1=toEN(e.latlng.lat, e.latlng.lng);
    moved = moved || e.containerPoint.distanceTo(c0)>4;
    ghost.setBounds([ev.latlng, e.latlng]); };
  secMap.on('mousemove', mv);
  secMap.once('mouseup', ()=>{
    secMap.off('mousemove', mv); secMap.removeLayer(ghost);
    const en = moved
      ? boxToPts((s0.e+s1.e)/2, (s0.n+s1.n)/2, Math.max(0.5,Math.abs(s1.e-s0.e)), Math.max(0.5,Math.abs(s1.n-s0.n)), 0)
      : boxToPts(s0.e, s0.n, 10, 10, 0);
    const c=ptsToBox(en);
    secAnnots.push({ kind:'plan', label:'Proposed structure', colour:'#1f5fa8', en,
                     top:round(groundAt(c.cx, c.cy)), depth:3 });
    setDrawMode(null); drawPlanStructs(); renderAnnotList();
  });
}

// Footprints on the site plan: drag the shape to move it, drag a white corner
// square to resize it (the opposite corner stays put).
function drawPlanStructs(){
  if (!secMap) return;
  if (!secStructLayer) secStructLayer=L.layerGroup().addTo(secMap);
  secStructLayer.clearLayers();
  secAnnots.forEach(a=>{
    if (a.kind!=='plan') return;
    const lls=()=>a.en.map(([e,n])=>toLL(e,n));
    const poly=L.polygon(lls(),{color:a.colour||'#1f5fa8',weight:2.5,fillOpacity:.22})
      .bindTooltip(`${esc(a.label||'Structure')} — drag to move`).addTo(secStructLayer);
    const handles=a.en.map(p=>L.marker(toLL(...p),{draggable:true,
      icon:L.divIcon({className:'struct-handle',iconSize:[10,10],iconAnchor:[5,5]})}).addTo(secStructLayer));
    const refresh=()=>{ poly.setLatLngs(lls()); a.en.forEach((p,k)=>handles[k].setLatLng(toLL(...p))); updateSection(); };
    handles.forEach((h,k)=>{
      let orig=null;
      h.on('dragstart', ()=>{ orig=a.en.map(p=>p.slice()); });
      h.on('drag', e=>{ const p=toEN(e.latlng.lat, e.latlng.lng);
        a.en=resizeFromCorner(orig, k, [p.e, p.n]); refresh(); });
      h.on('dragend', renderAnnotList);
    });
    poly.on('mousedown', ev=>{
      if (secDrawMode) return;
      L.DomEvent.stop(ev);
      const p0=toEN(ev.latlng.lat, ev.latlng.lng), orig=a.en.map(p=>p.slice());
      secMap.dragging.disable();
      const mv=e=>{ const p=toEN(e.latlng.lat, e.latlng.lng);
        a.en=orig.map(([x,y])=>[x+p.e-p0.e, y+p.n-p0.n]); refresh(); };
      secMap.on('mousemove', mv);
      secMap.once('mouseup', ()=>{ secMap.off('mousemove', mv); secMap.dragging.enable(); renderAnnotList(); });
    });
  });
}

// One labelled number box: caption sits directly above its own input, so a
// value can never be read as belonging to its neighbour.
const attrEsc = v => esc(v).replace(/"/g,'&quot;');
const fld = (caption, attrs, value, tip, step='0.1') =>
  `<label class="fld" title="${attrEsc(tip||caption)}"><span>${caption}</span>`+
  `<input type="number" step="${step}" ${attrs} value="${round(value)}"></label>`;

function sectionAnnotRow(a, i){
  const b=ptsToBox(a.pts), rotated=Math.abs(b.ang)>0.05;
  // corner k as stored: 0 bottom-left, 1 bottom-right, 2 top-right, 3 top-left
  const corner=(k, name)=>`<div class="corner"><b>${name}</b>`+
    fld('Chainage (m)', `data-i="${i}" data-pt="${k}" data-c="0"`, a.pts[k][0], 'Distance along the section from end A, in metres')+
    fld('Level (mPD)',  `data-i="${i}" data-pt="${k}" data-c="1"`, a.pts[k][1], 'Elevation in metres above Principal Datum')+`</div>`;
  return `<div class="annot-row">
    <div class="row" style="gap:6px;align-items:center">
      <input type="text" data-i="${i}" data-f="label" value="${attrEsc(a.label||'')}" placeholder="Label" style="width:170px">
      <input type="color" data-i="${i}" data-f="colour" value="${attrEsc(a.colour||'#b02a2a')}" style="width:40px;padding:1px">
      <span class="annot-tag">Drawn on the section</span>
      <button class="ghost" type="button" data-i="${i}" data-act="del">Delete</button>
    </div>
    <div class="annot-sub">Corners — laid out as they sit on the drawing${rotated?' (before rotation)':''}</div>
    <div class="corner-grid">${corner(3,'Top-left')}${corner(2,'Top-right')}${corner(0,'Bottom-left')}${corner(1,'Bottom-right')}</div>
    <div class="annot-sub">…or set it by centre, size and rotation</div>
    <div class="fld-row">
      ${fld('Centre chainage (m)', `data-i="${i}" data-b="cx"`, b.cx, 'Chainage of the centre, metres from A')}
      ${fld('Centre level (mPD)',  `data-i="${i}" data-b="cy"`, b.cy)}
      ${fld('Width (m)',           `data-i="${i}" data-b="w"`,  b.w, 'Horizontal size before rotation')}
      ${fld('Height (m)',          `data-i="${i}" data-b="h"`,  b.h, 'Vertical size before rotation')}
      ${fld('Rotation (°)',        `data-i="${i}" data-b="ang"`, b.ang, 'Degrees, anticlockwise', '0.5')}
      <button class="ghost" type="button" data-i="${i}" data-act="box">Apply</button>
    </div>
  </div>`;
}

function planAnnotRow(a, i){
  const b=ptsToBox(a.en);
  let cut='Not cut by the current section line.';
  if (sectionLine){
    const c=cutPolygon(toEN(...sectionLine.a), toEN(...sectionLine.b), a.en);
    if (c) cut=`Cut by the section from chainage ${c[0].toFixed(1)} m to ${c[1].toFixed(1)} m.`;
  }
  return `<div class="annot-row">
    <div class="row" style="gap:6px;align-items:center">
      <input type="text" data-i="${i}" data-f="label" value="${attrEsc(a.label||'')}" placeholder="Label" style="width:170px">
      <input type="color" data-i="${i}" data-f="colour" value="${attrEsc(a.colour||'#1f5fa8')}" style="width:40px;padding:1px">
      <span class="annot-tag plan">Drawn on the site plan</span>
      <button class="ghost" type="button" data-i="${i}" data-act="del">Delete</button>
    </div>
    <div class="annot-sub">Levels</div>
    <div class="fld-row">
      ${fld('Top level (mPD)', `data-i="${i}" data-f="top"`, a.top, 'Level the structure sits at — e.g. the ground level it is placed on')}
      <button class="ghost" type="button" data-i="${i}" data-act="ground" title="Set the top to the ground level at the footprint's centre">Use ground level</button>
      ${fld('Depth (m)', `data-i="${i}" data-f="depth"`, a.depth, 'How deep the structure goes below its top level')}
      ${fld('Founding level (mPD)', `data-i="${i}" data-f="found"`, a.top-a.depth, 'Level of the underside — top level minus depth')}
    </div>
    <div class="annot-sub">Footprint (HK1980 grid) — or drag it and its corner squares on the plan</div>
    <div class="fld-row">
      ${fld('Centre easting', `data-i="${i}" data-b="cx"`, b.cx)}
      ${fld('Centre northing', `data-i="${i}" data-b="cy"`, b.cy)}
      ${fld('Length (m)', `data-i="${i}" data-b="w"`, b.w, 'Side along the rotation direction')}
      ${fld('Width (m)',  `data-i="${i}" data-b="h"`, b.h, 'Side at right angles to it')}
      ${fld('Rotation (°)', `data-i="${i}" data-b="ang"`, b.ang, 'Degrees anticlockwise from grid east', '0.5')}
      <button class="ghost" type="button" data-i="${i}" data-act="box">Apply</button>
    </div>
    <div class="hint" style="margin-top:4px">${cut}</div>
  </div>`;
}

function renderAnnotList(){
  const box=document.getElementById('sec-annot-list');
  if (!box) return;
  box.innerHTML = secAnnots.length
    ? secAnnots.map((a,i)=> a.kind==='plan' ? planAnnotRow(a,i) : sectionAnnotRow(a,i)).join('')
    : '<p class="hint" style="margin:2px 0 0">No structures yet — choose a Draw button, then drag a box.</p>';
}

function wireAnnotEditor(){
  const list=document.getElementById('sec-annot-list');
  if (!list) return;
  document.getElementById('sec-annot-draw').addEventListener('click', ()=>setDrawMode('section'));
  document.getElementById('sec-annot-plan').addEventListener('click', ()=>setDrawMode('plan'));
  window.addEventListener('keydown', e=>{ if (e.key==='Escape' && secDrawMode) setDrawMode(secDrawMode); });
  // Boxes edit in place and redraw the section, but must NOT re-render the
  // editor itself — the box under the cursor would be replaced mid-keystroke.
  list.addEventListener('input', e=>{
    const t=e.target, i=+t.dataset.i, a=secAnnots[i]; if (!a) return;
    const f=t.dataset.f, v=+t.value;
    const setSib=(name,val)=>{ const s=t.closest('.annot-row').querySelector(`[data-f="${name}"]`); if (s) s.value=round(val); };
    if (f==='label') a.label=t.value;
    else if (f==='colour') a.colour=t.value;
    else if (f==='top'||f==='depth'||f==='found'){
      if (!Number.isFinite(v)) return;
      if (f==='top') a.top=v;                       // keeps depth, founding level follows
      else if (f==='depth') a.depth=Math.max(0,v);
      else a.depth=Math.max(0, a.top-v);            // founding level typed: depth follows
      if (f!=='depth') setSib('depth', a.depth);
      if (f!=='found') setSib('found', a.top-a.depth);
    }
    else if (t.dataset.pt!=null){
      if (!Number.isFinite(v)) return;
      a.pts[+t.dataset.pt][+t.dataset.c]=v;
    } else return;                                  // centre/size/angle: wait for Apply
    if (a.kind==='plan') drawPlanStructs();
    if (secMap) updateSection();
  });
  list.addEventListener('click', e=>{
    const t=e.target.closest('button'); if (!t) return;
    const i=+t.dataset.i, a=secAnnots[i]; if (!a) return;
    if (t.dataset.act==='del') secAnnots.splice(i,1);
    else if (t.dataset.act==='ground'){ const c=ptsToBox(a.en); a.top=round(groundAt(c.cx, c.cy)); }
    else if (t.dataset.act==='box'){
      const row=t.closest('.annot-row');
      const g=k=>+row.querySelector(`[data-b="${k}"]`).value;
      const [cx,cy,w,h,ang]=['cx','cy','w','h','ang'].map(g);
      if (![cx,cy,w,h,ang].every(Number.isFinite) || w<=0 || h<=0) return;
      a[a.kind==='plan' ? 'en' : 'pts']=boxToPts(cx,cy,w,h,ang);
    } else return;
    renderAnnotList(); drawPlanStructs();
    if (secMap) updateSection();
  });
  renderAnnotList();
}

// ==== download file naming: TITLE_TYPE_DATE ================================
// The cross-section title on the Options tab names every image the project
// produces, so a folder of exports sorts by job rather than by
// "cross_section (3).png".
function exportStem(kind){
  const raw=(document.getElementById('sec-title')?.value||'').trim() || 'Cross-section A-B';
  const safe = v => v.replace(/[\\/:*?"<>|\r\n]+/g,' ').trim().replace(/\s+/g,'-').replace(/-{2,}/g,'-');
  return `${safe(raw)}_${kind}_${new Date().toISOString().slice(0,10)}`;
}

// ==== whole-project settings (saved into the project file / cloud row) ======
// Everything on the Cross-Section tab that isn't already in the borehole data:
// the option controls, the manually deselected boreholes and the annotations.
// The section line and the site boundary already ride along in the #GEOVIS
// header, so a saved project now restores the whole tab, not just the data.
const SEC_VALUE_IDS = ['sec-title','sec-vex','sec-tol','sec-ext','sec-interp',
                       'sec-ground','sec-extrap','sp-base'];
const SEC_CHECK_IDS = ['sec-show-logs','sec-show-names','sec-show-offset',
                       'sec-bh-only','sec-hover','sp-names'];
function sectionSettings(){
  const o={};
  for (const id of SEC_VALUE_IDS){ const e=document.getElementById(id); if (e) o[id]=e.value; }
  for (const id of SEC_CHECK_IDS){ const e=document.getElementById(id); if (e) o[id]=e.checked; }
  return o;
}
function applySectionSettings(o){
  if (!o) return;
  for (const id of SEC_VALUE_IDS){
    const e=document.getElementById(id);
    if (e && o[id]!=null) e.value=o[id];
  }
  for (const id of SEC_CHECK_IDS){
    const e=document.getElementById(id);
    if (e && o[id]!=null) e.checked=!!o[id];
  }
  // the three sliders each print their own value next to them
  const lab=(id,suffix)=>{ const e=document.getElementById(id), v=document.getElementById(id+'-val');
    if (e && v) v.textContent=e.value+suffix; };
  lab('sec-vex','×'); lab('sec-tol',' m'); lab('sec-ext',' m');
}
/** The extras half of a saved project — see stateToProjectCSV(). */
function projectExtras(){
  return { section: sectionSettings(), excluded:[...secExcluded], annots: secAnnots };
}

// ---- site-plan image export (task 6) --------------------------------------
// Exports the plan exactly as framed on screen — basemap + site boundary +
// section line (A/B) + boreholes — as a report-ready PNG.
function setSpStatus(msg, cls){
  const s=document.getElementById('sp-status');
  s.style.display='block'; s.className='status '+(cls||''); s.textContent=msg;
}
async function exportSitePlan(){
  if (!secMap){ setSpStatus('Load boreholes first — there is no site plan to export yet.','err'); return; }
  const { exportMapPNG, paintPolyline, paintMarker, paintText,
          paintPixelLine, paintPixelText } = await mapExport();
  const sp=state.sitePlan, holes=sectionHoles();
  const names=secPlanNames;                     // solved against the current view
  // Must match what the preview shows: same corridor, same "include beyond
  // A/B" margin, and the same manually deselected holes left out.
  const inSet = sectionLine
    ? sectionStations(toEN(...sectionLine.a), toEN(...sectionLine.b),
        holes.filter(b=>!secExcluded.has(b.id)),
        +document.getElementById('sec-tol').value,
        +document.getElementById('sec-ext').value || 0).inSet
    : new Set();
  setSpStatus('Rendering image…','busy');
  const msg = await exportMapPNG(secMap, {
    name:exportStem('Site-Plan')+'.png',
    basemap:document.getElementById('sp-base').value,
    title:(document.getElementById('sec-title').value||'').trim() || 'Site plan',
    draw(ctx, project){
      if (sp && sp.bounds && Number.isFinite(sp.bounds.latMin)){
        const {latMin,latMax,lngMin,lngMax}=sp.bounds;
        paintPolyline(ctx, project, [[latMin,lngMin],[latMin,lngMax],[latMax,lngMax],[latMax,lngMin]],
          {color:'#e0a800',weight:3,dash:[10,6],close:true});
      }
      for (const a of secAnnots) if (a.kind==='plan')
        paintPolyline(ctx, project, a.en.map(([e,n])=>toLL(e,n)), {color:a.colour||'#1f5fa8',weight:2.5,close:true});
      if (sectionLine){
        paintPolyline(ctx, project, [sectionLine.a, sectionLine.b], {color:'#d33',weight:3});
        paintText(ctx, project, sectionLine.a, 'A', {font:'700 15px Outfit, sans-serif',color:'#d33'});
        paintText(ctx, project, sectionLine.b, 'B', {font:'700 15px Outfit, sans-serif',color:'#d33'});
      }
      for (const bh of holes){
        const on=inSet.has(bh.id);
        paintMarker(ctx, project, toLL(bh.x,bh.y), null,
          {radius:on?5:4, fill:on?'#2f5a1e':'#a8a196'});
      }
      // borehole names in the de-cluttered positions the preview is showing
      for (const n of names){
        const [x,y]=project(n.ll);
        if (n.leader) paintPixelLine(ctx, [x,y], [x+n.leader[0], y+n.leader[1]], {weight:0.8});
        paintPixelText(ctx, x+n.dx+3, y+n.dy+11, n.text,
          {font:BHLABEL_FONT, color:'#fff', halo:'#000'});
      }
    }
  });
  setSpStatus(msg, msg.startsWith('✓')?'ok':'err');
}

// ==== ROCK CONTOUR PLAN (task 8) ===========================================
// Plan view of interpolated rockhead level, styled like an engineering drawing:
// thin black contours, thicker labelled index contours, borehole callouts.
let ctrMap=null, ctrLayer=null, ctrLabelLayer=null, ctrCache=null;
function setCtrStatus(msg, cls){
  const s=document.getElementById('ctr-status');
  s.style.display='block'; s.className='status '+(cls||''); s.textContent=msg;
}
const ctrOpt = id => document.getElementById(id);

async function renderContour(){
  const box=document.getElementById('contour-viz');
  // Trial pits are excluded by default: they bottom out in a few metres, so a
  // "Grade III" layer in a TP is usually a boulder or obstruction rather than
  // rockhead, and mixing them with boreholes puts spurious highs in the surface.
  const bhOnly = ctrOpt('ctr-bh-only').checked;
  const holes = sectionHoles().filter(b=>!bhOnly || (b.kind||'BH')!=='TP');
  const { rockheadPoints, gridInterp, contourLevels, contourLines } = await import('./contour.js');
  const maxGrade = ctrOpt('ctr-grade').value;
  const { points, missing } = rockheadPoints(holes, maxGrade);
  if (points.length < 3){
    if (ctrMap){ ctrMap.remove(); ctrMap=null; ctrLayer=null; }
    box.innerHTML='<p class="hint" style="padding:10px">At least 3 boreholes proving rock (Grade '+maxGrade+
      ' or better) are needed to contour rockhead. Currently '+points.length+
      ' of '+holes.length+' loaded borehole(s) reach rock — load a site from the Site Map tab, '+
      'or relax the rock definition below.</p>';
    ctrCache=null;
    setCtrStatus(`${points.length} borehole(s) prove rock, ${missing.length} do not — not enough to contour.`,'err');
    return;
  }
  await ensureMapLibs();

  const interval=+ctrOpt('ctr-int').value;
  const grid=gridInterp(points, { method:ctrOpt('ctr-method').value, n:90 });
  const levels=contourLevels(grid, interval);
  const contours=contourLines(grid, levels);
  // Index contours (heavier + labelled) every 5th interval, as on a survey
  // drawing — but on a shallow site that would label nothing, so fall back to
  // labelling every contour when there are few of them.
  const idxStep = levels.length > 6 ? interval*5 : interval;
  const isIndex = lvl => Math.abs(lvl/idxStep - Math.round(lvl/idxStep)) < 1e-6;

  if (!ctrMap){
    box.innerHTML=''; box.style.padding='0';
    ctrMap=L.map(box,{zoomControl:true});
    ctrLayer=L.layerGroup().addTo(ctrMap);
    ctrLabelLayer=L.layerGroup().addTo(ctrMap);
    ctrMap.fitBounds(L.latLngBounds(points.map(p=>toLL(p.x,p.y))).pad(0.35));
    await setBase(ctrMap, 'ctr', ctrOpt('ctr-base').value);
    // callout placement is solved in screen pixels, so redo it whenever the
    // view changes (the contour geometry itself is zoom-independent)
    ctrMap.on('zoomend moveend', ()=>{ if (ctrCache) layoutCtrLabels(); });
  }
  setTimeout(()=>ctrMap.invalidateSize(),60);
  ctrLayer.clearLayers();

  const sp=state.sitePlan;
  if (ctrOpt('ctr-boundary').checked && sp && sp.bounds && Number.isFinite(sp.bounds.latMin)){
    const {latMin,latMax,lngMin,lngMax}=sp.bounds;
    L.rectangle([[latMin,lngMin],[latMax,lngMax]],
      {color:'#000',weight:1.6,dashArray:'12,5',fill:false}).addTo(ctrLayer);
  }
  const ctrLabels=[];                       // {ll, text} — contour index labels
  for (const c of contours){
    const idx=isIndex(c.level);
    for (const line of c.lines){
      const lls=line.map(([x,y])=>toLL(x,y));
      L.polyline(lls,{color:'#000',weight:idx?1.7:0.7,opacity:1})
        .bindTooltip(c.level.toFixed(1)+' mPD',{sticky:true}).addTo(ctrLayer);
      // keep the whole line so the label can slide along it to dodge others
      if (idx && line.length>6)
        ctrLabels.push({ lls, text:c.level.toFixed(interval<1?1:0) });
    }
  }
  // borehole symbols (the callout text is placed separately, de-cluttered)
  const callouts=[];                        // {ll, lines[], dashed}
  for (const p of points){
    const ll=toLL(p.x,p.y);
    L.circleMarker(ll,{radius:4,color:'#000',weight:1.6,fillColor:'#fff',fillOpacity:1}).addTo(ctrLayer);
    callouts.push({ key:p.id, ll, lines:[p.id, 'RL '+p.z.toFixed(2)] });
  }
  for (const m of missing){
    const ll=toLL(m.x,m.y);
    L.circleMarker(ll,{radius:4,color:'#666',weight:1.4,fillColor:'#fff',fillOpacity:1,dashArray:'2,2'}).addTo(ctrLayer);
    callouts.push({ key:m.id, ll, lines:[m.id, `rock N.E. (${m.depth.toFixed(1)} m)`], dashed:true });
  }

  const zs=points.map(p=>p.z);
  ctrCache={ points, missing, contours, isIndex, interval, ctrLabels, callouts, layout:null };
  layoutCtrLabels();
  setCtrStatus(`${points.length} ${bhOnly?'borehole':'location'}(s) proved rock (Grade ${maxGrade} or better): rock level `+
    `${Math.min(...zs).toFixed(2)} to ${Math.max(...zs).toFixed(2)} mPD. `+
    `${missing.length} borehole(s) did not reach rock (marked “rock N.E.”, excluded from the interpolation). `+
    `Contours every ${interval} m; index contours labelled.`,'ok');
}

// ---- callout de-clutter (leader lines) -------------------------------------
// Borehole callouts on a tight site sat on top of each other (and on the contour
// labels). Placement is solved in screen pixels by placeLabels() in contour.js:
// each callout takes the nearest free slot around its borehole and keeps a
// leader line back to it. The solved layout is reused verbatim by the PNG export
// so the image matches the preview.
const CALLOUT_FONT='600 10px Outfit, sans-serif', CTRLABEL_FONT='700 10px Outfit, sans-serif';
let _measureCtx=null;
function textWidth(text, font){
  if (!_measureCtx) _measureCtx=document.createElement('canvas').getContext('2d');
  _measureCtx.font=font;
  return _measureCtx.measureText(text).width;
}

async function layoutCtrLabels(){
  if (!ctrMap || !ctrCache || !hasView(ctrMap)) return;
  const { placeLabels, overlaps } = await import('./contour.js');
  const showLabels=ctrOpt('ctr-labels').checked, showBh=ctrOpt('ctr-bh').checked;
  ctrLabelLayer.clearLayers();
  const px = ll => { const p=ctrMap.latLngToContainerPoint(L.latLng(ll[0],ll[1])); return [p.x,p.y]; };
  const toLLp = ([x,y]) => { const g=ctrMap.containerPointToLatLng(L.point(x,y)); return [g.lat,g.lng]; };
  const size = ctrMap.getSize();
  const onScreen = b => b.x>-10 && b.y>-10 && b.x+b.w<size.x+10 && b.y+b.h<size.y+10;

  // Contour index labels are centred ON their line. A label may slide to another
  // vertex of the same line to dodge one already placed; if the line has no free
  // spot the label is dropped (normal survey practice — not every segment of a
  // contour is annotated). Placed first, they become obstacles for the callouts.
  const obstacles=[], ctrLabelBoxes=[];
  if (showLabels){
    for (const cl of ctrCache.ctrLabels){
      const n=cl.lls.length, w=textWidth(cl.text, CTRLABEL_FONT)+6, h=13;
      const cands=[0.5,0.35,0.65,0.2,0.8].map(f=>Math.min(n-1,Math.max(0,Math.floor(n*f))));
      let chosen=null;
      for (const i of cands){
        const [x,y]=px(cl.lls[i]);
        const box={x:x-w/2, y:y-h/2, w, h};
        if (!onScreen(box)) continue;
        if (!obstacles.some(b=>overlaps(box,b))){ chosen={ll:cl.lls[i], box}; break; }
      }
      if (!chosen) continue;
      obstacles.push(chosen.box);
      ctrLabelBoxes.push({ ll:chosen.ll, text:cl.text, box:chosen.box });
      L.marker(chosen.ll,{interactive:false, icon:L.divIcon({className:'ctr-label',
        html:cl.text, iconSize:[w,h], iconAnchor:[w/2,h/2]})}).addTo(ctrLabelLayer);
    }
  }
  // borehole symbols are obstacles too — never bury another hole's marker
  const symbols = ctrCache.callouts.map(c=>{ const [x,y]=px(c.ll); return {x:x-7,y:y-7,w:14,h:14}; });

  let layout=[], dropped=0;
  if (showBh){
    // keyed by index, not borehole id — two holes sharing a name must still get
    // their own slot rather than being drawn on top of each other
    const anchors = ctrCache.callouts.map((c,i)=>{
      const [x,y]=px(c.ll);
      const w=Math.max(...c.lines.map(t=>textWidth(t, CALLOUT_FONT)))+6;
      return { key:i, x, y, w, h:24 };
    });
    const placed = placeLabels(anchors, { obstacles: obstacles.concat(symbols),
      bounds:{x:4, y:4, w:size.x-8, h:size.y-8} });
    const byKey = new Map(placed.map(p=>[p.key,p]));
    ctrCache.callouts.forEach((c,ci)=>{
      const p = byKey.get(ci);
      const [x,y]=px(c.ll);
      // No free slot on the drawing: keep the symbol and put the text in a hover
      // tooltip rather than overprinting a contour or another callout.
      if (!p || !p.placed){
        L.circleMarker(c.ll,{radius:6, opacity:0, fillOpacity:0})
          .bindTooltip(c.lines.join(' · ')).addTo(ctrLabelLayer);
        dropped++;
        return;
      }
      if (p.leader){                        // draw the leader first, under the text
        L.polyline([toLLp(p.leader[0]), toLLp(p.leader[1])],
          {color:'#000', weight:0.6, opacity:.85, interactive:false}).addTo(ctrLabelLayer);
      }
      L.marker(c.ll,{interactive:false, icon:L.divIcon({className:'ctr-bh',
        html:c.lines.join('<br>'), iconSize:[p.box.w, p.box.h], iconAnchor:[-p.dx, -p.dy]})})
        .addTo(ctrLabelLayer);
      layout.push({ ll:c.ll, lines:c.lines, dx:p.dx, dy:p.dy,
                    leader:p.leader ? [p.leader[1][0]-x, p.leader[1][1]-y] : null });
    });
  }
  ctrCache.layout = { callouts:layout, ctrLabels:ctrLabelBoxes.map(b=>({ll:b.ll, text:b.text})) };
  ctrCache.dropped = dropped;
  const note = document.getElementById('ctr-crowd');
  if (note) note.textContent = dropped
    ? `${dropped} borehole callout(s) hidden to keep the drawing readable — hover the symbol, or zoom in to place them.`
    : '';
}

async function exportContour(){
  if (!ctrMap || !ctrCache){ setCtrStatus('Nothing to export yet.','err'); return; }
  const { exportMapPNG, paintPolyline, paintMarker, paintText,
          paintPixelLine, paintPixelText } = await mapExport();
  const { points, missing, contours, isIndex, interval } = ctrCache;
  await layoutCtrLabels();                     // solve against the current view
  const layout = ctrCache.layout || { callouts:[], ctrLabels:[] };
  const sp=state.sitePlan;
  setCtrStatus('Rendering image…','busy');
  const msg = await exportMapPNG(ctrMap, {
    name:`rock_contour_plan_${new Date().toISOString().slice(0,10)}.png`,
    basemap:ctrOpt('ctr-base').value,
    title:`Rockhead contour plan — ${interval} m interval (mPD)`,
    draw(ctx, project){
      if (ctrOpt('ctr-boundary').checked && sp && sp.bounds && Number.isFinite(sp.bounds.latMin)){
        const {latMin,latMax,lngMin,lngMax}=sp.bounds;
        paintPolyline(ctx,project,[[latMin,lngMin],[latMin,lngMax],[latMax,lngMax],[latMax,lngMin]],
          {color:'#000',weight:1.6,dash:[12,5],close:true});
      }
      for (const c of contours) for (const line of c.lines)
        paintPolyline(ctx, project, line.map(([x,y])=>toLL(x,y)),
          {color:'#000', weight:isIndex(c.level)?1.7:0.7});
      // contour index labels — centred on their line, same as the preview
      for (const cl of layout.ctrLabels)
        paintText(ctx, project, cl.ll, cl.text, {font:CTRLABEL_FONT, align:'center'});
      // borehole symbols, then the de-cluttered callouts + leader lines, using
      // the exact pixel layout the preview is showing
      for (const p of points) paintMarker(ctx, project, toLL(p.x,p.y), null,
        {radius:4, fill:'#fff', stroke:'#000', weight:1.6});
      for (const m of missing) paintMarker(ctx, project, toLL(m.x,m.y), null,
        {radius:4, fill:'#fff', stroke:'#666', weight:1.4});
      for (const c of layout.callouts){
        const [x,y]=project(c.ll);
        if (c.leader) paintPixelLine(ctx, [x,y], [x+c.leader[0], y+c.leader[1]], {weight:0.6});
        // +10/+21: text baselines for the two 11 px lines inside the 24 px box
        c.lines.forEach((t,i)=> paintPixelText(ctx, x+c.dx+3, y+c.dy+10+i*11, t, {font:CALLOUT_FONT}));
      }
    }
  });
  setCtrStatus(msg, msg.startsWith('✓')?'ok':'err');
}

// ---- PNG export ------------------------------------------------------
function exportPNG(svgEl, name){
  if (!svgEl) return;
  const clone=svgEl.cloneNode(true);                 // editing handles aren't part of the drawing
  clone.querySelectorAll('.annot-handle').forEach(n=>n.remove());
  const xml=new XMLSerializer().serializeToString(clone);
  const svg64='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(xml)));
  const img=new Image();
  img.onload=()=>{
    const scale=2, cv=document.createElement('canvas');
    cv.width=svgEl.width.baseVal.value*scale; cv.height=svgEl.height.baseVal.value*scale;
    const ctx=cv.getContext('2d'); ctx.scale(scale,scale); ctx.drawImage(img,0,0);
    const a=document.createElement('a'); a.download=name; a.href=cv.toDataURL('image/png'); a.click();
  };
  img.src=svg64;
}

// ---- HUGGING FACE PIPELINE ------------------------------------------
function setStatus(msg,cls){ const s=document.getElementById('hf-status'); s.style.display='block'; s.className='status '+cls; s.textContent=msg; }
async function sendToHF(){
  setStatus('Connecting to Hugging Face Space…','busy');
  showToast('Running 3D model on Hugging Face…');
  try {
    const mod=await import('https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js');
    const { Client, handle_file }=mod;
    const app=await Client.connect(HF_SPACE);
    setStatus('Connected. Sending borehole dataset and running GemPy…','busy');
    const csv=stateToCSV();
    const res_=+document.getElementById('hf-res').value, dip_=+document.getElementById('hf-dip').value, az_=+document.getElementById('hf-az').value;
    let res;
    try { res=await app.predict('/build_model_csv',[csv,res_,dip_,az_]); }
    catch { const file=handle_file(new File([csv],'boreholes.csv',{type:'text/csv'}));
      const args=[file,res_,dip_,az_,'Interface Separation Surfaces',1,1,true,true,false,false,'X',50];
      try { res=await app.predict('/build_model',args); } catch { res=await app.predict('/generate_model',args); } }
    setStatus('✓ Hugging Face received the data and built the model. Open the Space to view/download the 3D result.','ok');
    console.log('[HF] result',res);
  } catch(err){
    setStatus('Pipeline reached Hugging Face but returned: '+(err?.message||err)+'\n(If the Space was asleep it may need a moment — retry.)','err');
    console.error('[HF]',err);
  } finally {
    hideToast();
  }
}

// ==== wiring ==========================================================
function renderSectionFromUI(){ renderSitePlan(); }

// The borehole-entry panel (left) is only relevant to the Log / Cross-Section /
// 3D tabs — hide it on the Site Map tab and give the map full width.
let panelCollapsed = false;
function currentTab(){ const t=document.querySelector('.tab.active'); return t?t.dataset.tab:'map'; }
function applyTabLayout(tab){
  const hideEntry = (tab === 'map') || panelCollapsed;
  document.getElementById('entry-panel').style.display = hideEntry ? 'none' : '';
  const wrap = document.getElementById('wrap');
  wrap.classList.toggle('map-mode', tab === 'map');
  wrap.classList.toggle('entry-collapsed', panelCollapsed && tab !== 'map');
  const exp = document.getElementById('panel-expand');
  if (exp) exp.classList.toggle('show', panelCollapsed && tab !== 'map');
}
function setPanelCollapsed(flag){
  panelCollapsed = flag;
  applyTabLayout(currentTab());
  // let the layout reflow, then resize the map & redraw the section to fit the new width
  if (secMap){ setTimeout(()=>{ secMap.invalidateSize(); if (sectionActive()) updateSection(); }, 80); }
  if (ctrMap){ setTimeout(()=>ctrMap.invalidateSize(), 80); }
  if (lpMap){ setTimeout(()=>{ lpMap.invalidateSize(); drawLogPlanMarkers(); }, 80); }
  renderLogLive();
}

document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.tabpane').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  document.querySelector(`.tabpane[data-pane="${t.dataset.tab}"]`).classList.add('active');
  applyTabLayout(t.dataset.tab);
  if (t.dataset.tab==='section') renderSectionFromUI();
  if (t.dataset.tab==='log'){ renderLogLive(); renderLogPlan(); }
  if (t.dataset.tab==='map') openSiteMap();
  if (t.dataset.tab==='contour') renderContour();
}));

// ---- global loading toast (bottom-right), shared with sitemap.js ----------
const _toastEl = document.getElementById('toast');
const _toastMsg = document.getElementById('toast-msg');
function showToast(msg){ _toastMsg.textContent = msg; _toastEl.classList.add('show'); }
function hideToast(){ _toastEl.classList.remove('show'); }
window.GeoToast = { show: showToast, hide: hideToast };

// ---- Site Map (lazy-loaded module) ----------------------------------
let siteMapReady = false;
async function openSiteMap(){
  try {
    const { initSiteMap } = await import('./sitemap.js');
    await initSiteMap({
      onLoadTo2D(boreholes, sitePlan){
        state.boreholes = boreholes;
        state.activeIdx = 0;
        state.sitePlan = sitePlan || null;
        sectionLine = null;   // fresh site → recompute default section line on next view
        secExcluded.clear(); secAnnots=[]; renderAnnotList(); drawPlanStructs();   // and its annotations/deselections
        refreshInput(); commit();
        // jump back to the log tab so the user sees what landed
        document.querySelector('.tab[data-tab="log"]').click();
      }
    });
    siteMapReady = true;
  } catch(e){
    const s=document.getElementById('map-status');
    if (s){ s.style.display='block'; s.className='status err'; s.textContent='Map failed to load: '+e.message; }
    console.error('[sitemap]', e);
  }
}

// borehole manager
document.getElementById('bh-select').addEventListener('change', e=>selectBorehole(+e.target.value));
document.getElementById('bh-add').addEventListener('click', addBorehole);
document.getElementById('bh-del').addEventListener('click', delBorehole);
['m-id','m-gl','m-x','m-y'].forEach(id=>document.getElementById(id).addEventListener('input', onMetaChange));

// layers
document.getElementById('layer-body').addEventListener('input', onLayerInput);
document.getElementById('layer-body').addEventListener('click', e=>{ if(e.target.dataset.rm!=null) removeLayer(+e.target.dataset.rm); });
document.getElementById('layer-add').addEventListener('click', addLayer);
document.querySelectorAll('#mode-toggle button').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));

// log / section / CSV
document.getElementById('log-elev').addEventListener('change', renderLogLive);
document.getElementById('log-labels').addEventListener('click', e=>{
  logLabelsMode = logLabelsMode==='inline' ? 'legend' : 'inline';
  e.target.textContent = 'Labels: '+logLabelsMode;
  renderLogLive();
});
document.getElementById('log-png').addEventListener('click', ()=>exportPNG(document.querySelector('#log-viz svg'),'borehole_log.png'));
document.getElementById('sec-vex').addEventListener('input', e=>{ document.getElementById('sec-vex-val').textContent=e.target.value+'×'; if (secMap) updateSection(); });
document.getElementById('sec-tol').addEventListener('input', e=>{ document.getElementById('sec-tol-val').textContent=e.target.value+' m'; if (secMap) updateSection(); });
document.getElementById('sec-ext').addEventListener('input', e=>{ document.getElementById('sec-ext-val').textContent=e.target.value+' m'; if (secMap) updateSection(); });
document.getElementById('sec-title').addEventListener('input', ()=>{ if (secMap) updateSection(); });
['sec-show-logs','sec-show-names','sec-show-offset','sec-bh-only','sec-interp','sec-ground',
 'sec-extrap','sec-hover'].forEach(id=>
  document.getElementById(id).addEventListener('change', ()=>{ if (secMap) updateSection(); }));
document.getElementById('sec-inc-reset').addEventListener('click', ()=>{
  secExcluded.clear(); if (secMap) updateSection(); else updateExcludedNote();
});
wireAnnotEditor();
document.getElementById('panel-collapse').addEventListener('click', ()=>setPanelCollapsed(true));
document.getElementById('panel-expand').addEventListener('click', ()=>setPanelCollapsed(false));
document.getElementById('sec-png').addEventListener('click', ()=>exportPNG(document.querySelector('#sec-viz svg'), exportStem('Cross-Section')+'.png'));

// site plan base map + names + image export (tasks 6 & 2)
document.getElementById('sp-base').addEventListener('change', e=>{
  if (secMap) setBase(secMap, 'sp', e.target.value);
});
document.getElementById('sp-names').addEventListener('change', ()=>drawPlanNames());
// A/B coordinate boxes: live in both directions (task 4)
['sec-ae','sec-an','sec-be','sec-bn'].forEach(id=>
  document.getElementById(id).addEventListener('input', abFieldsToLine));
document.getElementById('sp-export').addEventListener('click', exportSitePlan);

// borehole-log site map: base map, name toggle (task 1)
document.getElementById('lp-base').addEventListener('change', e=>{
  if (lpMap) setBase(lpMap, 'lp', e.target.value);
});
document.getElementById('lp-names').addEventListener('change', drawLogPlanMarkers);

// rock contour plan (task 8)
['ctr-grade','ctr-method','ctr-int','ctr-labels','ctr-bh','ctr-bh-only','ctr-boundary'].forEach(id=>
  document.getElementById(id).addEventListener('change', renderContour));
document.getElementById('ctr-base').addEventListener('change', e=>{
  if (ctrMap) setBase(ctrMap, 'ctr', e.target.value);
});
document.getElementById('ctr-export').addEventListener('click', exportContour);
document.getElementById('hf-send').addEventListener('click', sendToHF);

function importCSV(){
  try { csvToState(document.getElementById('csv').value); document.getElementById('parse-info').textContent='✓ imported';
    refreshInput(); commit(); }
  catch(err){ document.getElementById('parse-info').textContent='✗ '+err.message; }
}
document.getElementById('csv-import').addEventListener('click', importCSV);
document.getElementById('csv-export').addEventListener('click', ()=>{ document.getElementById('csv').value=stateToCSV(); document.getElementById('parse-info').textContent='✓ exported to textbox'; });

// ==== DATASETS: built-in examples + the user's own saved datasets ==========
// One picker, two groups. A built-in example and a saved dataset are the SAME
// thing on disk — a project CSV (project_csv.js) — so they load through exactly
// one code path and the "does the cloud format match the file format?" question
// can never come up. Values are namespaced `ex:<id>` / `cloud:<uuid>` so the
// picker can tell them apart without a parallel lookup table.
let DS_EXAMPLES = [];      // built-in, from examples.js
let dsCloudRows = [];      // the signed-in user's saved rows (no csv — see listProjects)
let dsOpenId    = null;    // id of the saved dataset currently open, for "Save changes"
let dsCloud     = null;    // the cloud module, once accounts are configured
let dsSignedIn  = false;

const dsEl = id => document.getElementById(id);
function dsNote(msg){ const n=dsEl('example-note'); if (n) n.textContent = msg || ''; }

/** Rebuild the picker, keeping the current choice where possible. */
function renderDatasetPicker(selectValue){
  const sel = dsEl('example-select');
  if (!sel) return;
  const keep = selectValue || sel.value;
  sel.innerHTML = '';

  if (dsCloudRows.length){
    const g = document.createElement('optgroup');
    g.label = 'My saved datasets';
    for (const r of dsCloudRows){
      const m = r.meta || {};
      const bits = [];
      if (m.boreholes != null) bits.push(`${m.boreholes} BH`);
      if (m.trialPits) bits.push(`${m.trialPits} TP`);
      if (m.hasSection) bits.push('section');
      const detail = bits.length ? ` (${bits.join(', ')})` : '';
      g.appendChild(new Option(`${r.name}${detail} — ${dsCloud.whenLabel(r.updated_at)}`,
                               'cloud:'+r.id));
    }
    sel.appendChild(g);
  }

  const g2 = document.createElement('optgroup');
  g2.label = 'Example datasets';
  for (const ex of DS_EXAMPLES) g2.appendChild(new Option(ex.name, 'ex:'+ex.id));
  sel.appendChild(g2);

  if (keep && [...sel.options].some(o=>o.value===keep)) sel.value = keep;
  syncDatasetButtons();
}

/** Rename/Delete/Save-changes only make sense on one of YOUR saved datasets. */
function syncDatasetButtons(){
  const sel = dsEl('example-select');
  const isCloud = !!sel && sel.value.startsWith('cloud:');
  const set = (id, on) => { const b=dsEl(id); if (b) b.disabled = !on; };
  set('ds-rename', isCloud);
  set('ds-delete', isCloud);
  // "Save changes" overwrites the dataset that is actually OPEN, which is not
  // necessarily the one highlighted in the picker.
  set('ds-update', !!dsOpenId);
  const actions = dsEl('ds-actions');
  if (actions) actions.style.display = dsSignedIn ? '' : 'none';
}

/** Load whichever dataset is selected — example or saved, same path. */
async function loadSelectedDataset(){
  const sel = dsEl('example-select');
  const val = sel ? sel.value : '';
  if (!val){ dsNote('Nothing selected.'); return; }
  try {
    if (val.startsWith('cloud:')){
      const id = val.slice(6);
      dsNote('Opening…');
      const row = await dsCloud.getProject(id);
      if (!row){ dsNote('✗ Could not open that dataset.'); return; }
      loadProjectCSV(row.csv);
      setMode(state.mode);
      dsEl('csv').value = row.csv;
      refreshInput(); commit();
      dsOpenId = row.id;
      dsNote(`✓ Opened “${row.name}” — ${state.boreholes.length} borehole(s).`);
    } else {
      const ex = DS_EXAMPLES.find(e=>e.id === val.slice(3));
      if (!ex){ dsNote('✗ That example is no longer available.'); return; }
      loadProjectCSV(ex.csv);
      setMode(state.mode);
      dsEl('csv').value = ex.csv;
      refreshInput(); commit();
      dsOpenId = null;                       // an example is not yours to overwrite
      dsNote(`✓ Loaded ${state.boreholes.length} drillhole(s) — ${ex.name}`);
    }
    syncDatasetButtons();
    document.querySelector('.tab[data-tab="log"]').click();
  } catch(err){ dsNote('✗ '+(err?.message||err)); }
}

async function refreshDatasetList(selectId){
  if (!dsCloud || !dsSignedIn){ dsCloudRows=[]; renderDatasetPicker(); return; }
  dsCloudRows = await dsCloud.listProjects();
  renderDatasetPicker(selectId ? 'cloud:'+selectId : undefined);
}

async function saveAsNewDataset(){
  if (!state.boreholes.length || !state.boreholes.some(b=>b.layers.length)){
    dsNote('Nothing to save yet — load or enter some boreholes first.'); return;
  }
  const name = prompt('Name this dataset', `Site ${new Date().toISOString().slice(0,10)}`);
  if (!name || !name.trim()) return;
  const btn = dsEl('ds-save'); btn.disabled = true; dsNote('Saving…');
  try {
    const row = await dsCloud.createProject(
      name, stateToProjectCSV(state, sectionLine, projectExtras()),
      dsCloud.summarise(state, sectionLine));
    dsOpenId = row.id;
    await refreshDatasetList(row.id);
    dsNote(`✓ Saved “${row.name}”. It is now in the picker above.`);
  } catch(err){ dsNote('✗ Save failed: '+(err?.message||err)); }
  btn.disabled = false;
}

async function saveChangesToDataset(){
  if (!dsOpenId) return;
  const btn = dsEl('ds-update'); btn.disabled = true; dsNote('Saving…');
  try {
    await dsCloud.updateProject(dsOpenId, stateToProjectCSV(state, sectionLine, projectExtras()),
                                dsCloud.summarise(state, sectionLine));
    await refreshDatasetList(dsOpenId);
    dsNote('✓ Saved over the open dataset.');
  } catch(err){ dsNote('✗ Save failed: '+(err?.message||err)); }
  syncDatasetButtons();
}

async function renameSelectedDataset(){
  const sel = dsEl('example-select');
  if (!sel.value.startsWith('cloud:')) return;
  const id = sel.value.slice(6);
  const row = dsCloudRows.find(r=>r.id===id);
  const next = prompt('Rename dataset', row ? row.name : '');
  if (!next || !next.trim() || (row && next === row.name)) return;
  try {
    await dsCloud.renameProject(id, next);
    await refreshDatasetList(id);
    dsNote(`✓ Renamed to “${next.trim()}”.`);
  } catch(err){ dsNote('✗ Rename failed: '+(err?.message||err)); }
}

async function deleteSelectedDataset(){
  const sel = dsEl('example-select');
  if (!sel.value.startsWith('cloud:')) return;
  const id = sel.value.slice(6);
  const row = dsCloudRows.find(r=>r.id===id);
  const nm = row ? row.name : 'this dataset';
  if (!confirm(`Delete “${nm}”? This cannot be undone.`)) return;
  try {
    await dsCloud.deleteProject(id);
    if (dsOpenId === id) dsOpenId = null;    // it is gone; nothing left to overwrite
    await refreshDatasetList();
    dsNote(`✓ Deleted “${nm}”.`);
  } catch(err){ dsNote('✗ Delete failed: '+(err?.message||err)); }
}

// Built-in examples load immediately; saved datasets join the same picker as
// soon as auth resolves (see initCloud below).
(async ()=>{
  const { EXAMPLES } = await import('./examples.js');
  DS_EXAMPLES = EXAMPLES;
  const sel = dsEl('example-select');
  // This module and initCloud both finish asynchronously, in either order. Only
  // default to the first example if the picker is still empty — otherwise the
  // user's own datasets have already loaded and arriving second must not yank
  // the selection off them.
  const hadSelection = !!sel.value;
  renderDatasetPicker(hadSelection ? undefined : 'ex:'+(EXAMPLES[0]?.id || ''));
  const showNote = ()=>{
    syncDatasetButtons();
    if (sel.value.startsWith('ex:')){
      const ex = DS_EXAMPLES.find(e=>e.id===sel.value.slice(3));
      dsNote(ex ? ex.note : '');
    } else dsNote('');
  };
  sel.addEventListener('change', showNote);
  showNote();
  dsEl('example-load').addEventListener('click', loadSelectedDataset);
  dsEl('ds-save').addEventListener('click', ()=>saveAsNewDataset());
  dsEl('ds-update').addEventListener('click', ()=>saveChangesToDataset());
  dsEl('ds-rename').addEventListener('click', ()=>renameSelectedDataset());
  dsEl('ds-delete').addEventListener('click', ()=>deleteSelectedDataset());
})();

// ---- project save / resume (tasks 5 & 6) ----------------------------
document.getElementById('proj-export').addEventListener('click', ()=>{
  const stamp=new Date().toISOString().slice(0,10);
  downloadText(`geovis_project_${stamp}.csv`, stateToProjectCSV(state, sectionLine, projectExtras()));
});
let _projText='';
const _projInfo=document.getElementById('proj-info');
const _projLoad=document.getElementById('proj-load');
function acceptProjectFile(file){
  if (!file) return;
  const r=new FileReader();
  r.onload=()=>{ _projText=r.result; _projLoad.disabled=false; _projInfo.textContent=`Ready: ${file.name} — press “Load project”.`; };
  r.onerror=()=>{ _projInfo.textContent='Could not read file.'; };
  r.readAsText(file);
}
const _drop=document.getElementById('proj-drop');
_drop.addEventListener('click', ()=>document.getElementById('proj-file').click());
document.getElementById('proj-file').addEventListener('change', e=>acceptProjectFile(e.target.files[0]));
['dragenter','dragover'].forEach(ev=>_drop.addEventListener(ev, e=>{ e.preventDefault(); _drop.classList.add('over'); }));
['dragleave','drop'].forEach(ev=>_drop.addEventListener(ev, e=>{ e.preventDefault(); _drop.classList.remove('over'); }));
_drop.addEventListener('drop', e=>{ const f=e.dataTransfer.files[0]; if(f) acceptProjectFile(f); });
_projLoad.addEventListener('click', ()=>{
  try{
    loadProjectCSV(_projText);
    setMode(state.mode);                 // sync depth/elevation toggle
    refreshInput(); commit();
    _projInfo.textContent=`✓ Loaded ${state.boreholes.length} borehole(s)`+(state.sitePlan?' + site boundary':'')+'.';
    document.querySelector('.tab[data-tab="log"]').click();
  }catch(err){ _projInfo.textContent='✗ '+err.message; }
});

// ---- cloud accounts: save/open projects against a Google sign-in -----------
// Reuses the SAME project-CSV blob the file save/resume above produces, so the
// cloud copy can never drift from the local format (and test_project_csv.mjs
// already guards that round trip). Entirely inert when Supabase isn't
// configured — the whole block stays display:none and no network call is made.
// ---- cloud accounts: sign-in, and feeding the dataset picker --------------
// The project list itself lives in the dataset picker above; this block only
// handles signing in and telling that picker who is signed in. Entirely inert
// when Supabase is unconfigured — the block stays display:none and nothing is
// fetched.
(async function initCloud(){
  const cloud = await import('./cloud.js');
  if (!cloud.isConfigured()) return;          // unconfigured deploy: leave the UI hidden
  dsCloud = cloud;

  const { mountAuthControl } = await import('./auth_ui.js');
  const $ = id => document.getElementById(id);
  const out=$('cloud-signedout'), inn=$('cloud-signedin'), info=$('cloud-info');

  $('cloud-block').style.display='';
  mountAuthControl($('auth-slot'), { onLight:false });
  $('cloud-signin').addEventListener('click', async e=>{
    e.target.disabled=true;
    try{ await cloud.signInWithGoogle(); }
    catch(err){ info.textContent='✗ '+(err?.message||err); e.target.disabled=false; }
  });

  cloud.onAuthChange(async user=>{
    dsSignedIn = !!user;
    out.style.display = user ? 'none' : '';
    inn.style.display = user ? '' : 'none';
    if (!user){ dsOpenId=null; info.textContent=''; await refreshDatasetList(); return; }

    // ?project=<id> — deep link from account.html "Open →"
    const deepLink = new URLSearchParams(location.search).get('project');
    await refreshDatasetList(deepLink || undefined);
    if (deepLink){
      history.replaceState({}, '', location.pathname);   // don't re-open on refresh
      const sel=$('example-select');
      if ([...sel.options].some(o=>o.value==='cloud:'+deepLink)){
        sel.value='cloud:'+deepLink;
        loadSelectedDataset();
      }
    }
  });
})();

// ---- external API: load boreholes pushed from the sitemap (task 4, future) ----
window.GeoBuilder = {
  loadBoreholes(arr){ // arr of {id,x,y,gl,layers:[{surface,top,base}]}
    if (Array.isArray(arr) && arr.length){ state.boreholes=arr; state.activeIdx=0; refreshInput(); commit(); }
  },
  loadCSV(text){ document.getElementById('csv').value=text; importCSV(); }
};

// boot empty (one blank borehole to type into), opening on the Site Map (step 1)
state.boreholes = [{ id:'BH-1', x:836694, y:819070, gl:10, kind:'BH', layers:[] }];
syncDerived();
refreshInput();
renderLogLive();
applyTabLayout('map');
openSiteMap();
