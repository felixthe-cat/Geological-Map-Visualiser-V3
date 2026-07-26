// ================================================================
// GeoVisualise — 2D Borehole Log & Cross-Section builder
// Editable, Subcores-style borehole entry with live log preview.
// Ships the same dataset to the GemPy Hugging Face Space (two-way pipeline).
// ================================================================

import { sectionStations, interpolateHorizons } from './section_geom.js';
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

let _mapLibs=null;
function ensureMapLibs(){ return _mapLibs || (_mapLibs=import('./sitemap.js').then(m=>m.ensureMapLibs())); }
let _mapExport=null;
function mapExport(){ return _mapExport || (_mapExport=import('./map_export.js')); }

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
  secBhLayer=secLabelLayer=secLinePoly=secHandleA=secHandleB=secBoundaryRect=null;
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
  updateSection();
}

function drawSectionLine(){
  const {a,b}=sectionLine;
  if (!secLinePoly){
    secLinePoly=L.polyline([a,b],{color:'#d33',weight:3}).addTo(secMap);
    const mk=ll=>L.marker(ll,{draggable:true,
      icon:L.divIcon({className:'sec-handle',iconSize:[16,16],iconAnchor:[8,8]})}).addTo(secMap);
    secHandleA=mk(a); secHandleB=mk(b);
    secHandleA.on('drag',onHandleDrag); secHandleB.on('drag',onHandleDrag);
  } else {
    secLinePoly.setLatLngs([a,b]); secHandleA.setLatLng(a); secHandleB.setLatLng(b);
  }
}
function onHandleDrag(){
  const a=secHandleA.getLatLng(), b=secHandleB.getLatLng();
  sectionLine={ a:[a.lat,a.lng], b:[b.lat,b.lng] };
  secLinePoly.setLatLngs([sectionLine.a, sectionLine.b]);
  updateSection();   // live redraw of the cross-section as the line moves
}

// Project boreholes onto the current line, pick those within a corridor,
// order by distance along the line, then redraw the section.
function updateSection(){
  if (!secMap || !sectionLine || !hasView(secMap)) return;
  const A=toEN(...sectionLine.a), B=toEN(...sectionLine.b);
  const lineLen=Math.hypot(B.e-A.e, B.n-A.n);
  const allHoles=sectionHoles();
  const bhOnly = document.getElementById('sec-bh-only')?.checked;
  const secHoles = bhOnly ? allHoles.filter(b=>(b.kind||'BH')!=='TP') : allHoles;
  const corridor = +document.getElementById('sec-tol').value;   // task 5: distance tolerance (m)
  const { stations, inSet } = sectionStations(A, B, secHoles, corridor);
  secBhLayer.clearLayers();
  for (const bh of allHoles){
    const inSec=inSet.has(bh.id);
    L.circleMarker(toLL(bh.x,bh.y),{radius:inSec?6:4,color:'#1a1a0f',weight:1,
      fillColor:inSec?'#2f5a1e':'#a8a196',fillOpacity:.9})
      .bindTooltip(bh.id).addTo(secBhLayer);
  }
  drawPlanNames(allHoles);
  renderSection(stations, +document.getElementById('sec-vex').value, lineLen);
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
function renderSection(stations, vex, lineLen){
  const box = document.getElementById('sec-viz');
  box.innerHTML='';
  stations = (stations||[]).filter(s=>BH[s.id] && BH[s.id].layers.length);
  if (stations.length < 2){ box.innerHTML='<p class="hint" style="padding:10px">Drag the section line over at least 2 boreholes (widen the distance tolerance if needed).</p>'; return; }

  const ids = stations.map(s=>s.id);
  let total, dist;
  if (lineLen>=1){ total=lineLen; dist=stations.map(s=>s.dist); }   // A at 0, B at lineLen
  else { const d0=stations[0].dist; dist=stations.map(s=>s.dist-d0); total=dist[dist.length-1]||(ids.length-1); if(total===0){ dist=dist.map((_,i)=>i); total=ids.length-1; } }

  const showLogs  = document.getElementById('sec-show-logs')?.checked ?? true;
  const showNames = document.getElementById('sec-show-names')?.checked ?? true;
  const titleTxt  = (document.getElementById('sec-title')?.value || '').trim() || 'Cross-section A–B';

  let eMin=Infinity, eMax=-Infinity;
  for (const id of ids){ const bh=BH[id]; eMax=Math.max(eMax,bh.gl); for (const l of bh.layers) eMin=Math.min(eMin,bh.gl-l.base); }
  const eRange=(eMax-eMin)||1;

  // classes actually present in the CURRENTLY-included boreholes — the legend
  // reflects only these, so it updates live as the section line is dragged and
  // boreholes (and their soil/rock types) enter or leave the section. (task 12)
  const present = new Set();
  for (const id of ids) for (const l of BH[id].layers) present.add(classKey(l));
  const activeStrat = STRAT.filter(s=>present.has(s));

  // Fill the available container width (grows when the panel is collapsed),
  // reserving a right-hand legend gutter and sensible margins.
  const legendW=205, mL=56, mR=20+legendW, mT=56, mB=showNames?66:44;
  const avail=(box.clientWidth ? box.clientWidth : 900) - 24;
  const plotW=Math.max(480, avail - mL - mR);
  const xPxPerM=plotW/total, yPxPerM=xPxPerM*vex, plotH=eRange*yPxPerM;
  const W=mL+plotW+mR, H=mT+plotH+mB;
  const svg=el('svg',{width:W,height:H,viewBox:`0 0 ${W} ${H}`,'font-family':'Outfit,sans-serif'});
  svg.appendChild(el('rect',{x:0,y:0,width:W,height:H,fill:'#fffdf8'}));
  const X=d=>mL+d*xPxPerM, Y=e=>mT+(eMax-e)*yPxPerM, elevAt=(id,d)=>BH[id].gl-d;

  svg.appendChild(el('text',{x:mL,y:24,'font-size':15,'font-weight':700,fill:'#1e3c12'},titleTxt));
  svg.appendChild(el('text',{x:mL,y:40,'font-size':11,fill:'#6b6250'},`Vertical exaggeration ${vex}×  ·  length ${total.toFixed(0)} m`));

  // Y grid (elevation)
  const estep=niceStep(eRange), e0=Math.ceil(eMin/estep)*estep;
  for (let e=e0; e<=eMax+0.001; e+=estep){
    const y=Y(e);
    svg.appendChild(el('line',{x1:mL,y1:y,x2:mL+plotW,y2:y,stroke:'#eae1cf'}));
    svg.appendChild(el('line',{x1:mL-4,y1:y,x2:mL,y2:y,stroke:'#6b6250'}));
    svg.appendChild(el('text',{x:mL-7,y:y+3,'font-size':10,'text-anchor':'end',fill:'#6b6250'},e.toFixed(0)));
  }
  svg.appendChild(el('text',{x:mL-46,y:mT-10,'font-size':10,'font-weight':600,fill:'#6b6250'},'mPD'));

  // X grid (distance along the line) — task 8
  const xstep=niceStep(total), yAxis=mT+plotH;
  for (let d=0; d<=total+0.001; d+=xstep){
    const x=X(d);
    svg.appendChild(el('line',{x1:x,y1:mT,x2:x,y2:yAxis,stroke:'#f0e8d6'}));
    svg.appendChild(el('line',{x1:x,y1:yAxis,x2:x,y2:yAxis+4,stroke:'#6b6250'}));
    svg.appendChild(el('text',{x:x,y:yAxis+15,'font-size':9.5,'text-anchor':'middle',fill:'#6b6250'},d.toFixed(0)));
  }
  svg.appendChild(el('text',{x:mL+plotW/2,y:H-4,'font-size':10,'font-weight':600,'text-anchor':'middle',fill:'#6b6250'},'Distance along section (m)'));

  // coloured grade bands, interpolated between boreholes by the chosen method
  // (task 9). Horizons are interpolated as top-surface + thicknesses, so bands
  // can pinch out but never cross — see interpolateHorizons().
  const method = document.getElementById('sec-interp')?.value || 'linear';
  const horizons = ids.map(id=>buildHorizons(id));
  // sample every ~3 px for linear/nearest fidelity and smooth cubic curves
  const nQ = method==='linear' ? 0 : Math.max(ids.length, Math.round(plotW/3));
  const xq = nQ ? Array.from({length:nQ+1},(_,i)=>dist[0]+(dist[dist.length-1]-dist[0])*i/nQ) : dist.slice();
  const curves = interpolateHorizons(dist, horizons, xq, method);
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

  ids.forEach((id,i)=>{
    const bh=BH[id], x=X(dist[i]), w=8;
    if (showLogs) for (const l of bh.layers){                      // task 6: toggle borehole logs
      const y0=Y(elevAt(id,l.top)), y1=Y(elevAt(id,l.base));
      svg.appendChild(el('rect',{x:x-w/2,y:y0,width:w,height:Math.max(0,y1-y0),fill:classColour(l),stroke:'#1a1a0f','stroke-width':.8,'data-cls':classKey(l)}));
    }
    if (showNames){                                                // task 6: toggle borehole names
      svg.appendChild(el('line',{x1:x,y1:yAxis,x2:x,y2:yAxis+6,stroke:'#6b6250'}));
      svg.appendChild(el('text',{x:x,y:yAxis+30,'font-size':10,'font-weight':600,'text-anchor':'middle',fill:'#1e3c12'},id));
    }
  });

  // A / B end markers matching the section line on the map — task 9
  [[X(0),'A','start'],[X(total),'B','end']].forEach(([x,lab])=>{
    svg.appendChild(el('line',{x1:x,y1:mT,x2:x,y2:yAxis,stroke:'#d33','stroke-width':1.2,'stroke-dasharray':'4,3'}));
    svg.appendChild(el('circle',{cx:x,cy:mT-10,r:9,fill:'#d33'}));
    svg.appendChild(el('text',{x:x,y:mT-6,'font-size':11,'font-weight':700,'text-anchor':'middle',fill:'#fff'},lab));
  });

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
  const inSet = sectionLine
    ? sectionStations(toEN(...sectionLine.a), toEN(...sectionLine.b), holes,
        +document.getElementById('sec-tol').value).inSet
    : new Set();
  setSpStatus('Rendering image…','busy');
  const msg = await exportMapPNG(secMap, {
    name:`site_plan_${new Date().toISOString().slice(0,10)}.png`,
    basemap:document.getElementById('sp-base').value,
    title:(document.getElementById('sec-title').value||'').trim() || 'Site plan',
    draw(ctx, project){
      if (sp && sp.bounds && Number.isFinite(sp.bounds.latMin)){
        const {latMin,latMax,lngMin,lngMax}=sp.bounds;
        paintPolyline(ctx, project, [[latMin,lngMin],[latMin,lngMax],[latMax,lngMax],[latMax,lngMin]],
          {color:'#e0a800',weight:3,dash:[10,6],close:true});
      }
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
  const xml=new XMLSerializer().serializeToString(svgEl);
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
document.getElementById('sec-title').addEventListener('input', ()=>{ if (secMap) updateSection(); });
['sec-show-logs','sec-show-names','sec-bh-only','sec-interp'].forEach(id=>
  document.getElementById(id).addEventListener('change', ()=>{ if (secMap) updateSection(); }));
document.getElementById('panel-collapse').addEventListener('click', ()=>setPanelCollapsed(true));
document.getElementById('panel-expand').addEventListener('click', ()=>setPanelCollapsed(false));
document.getElementById('sec-png').addEventListener('click', ()=>exportPNG(document.querySelector('#sec-viz svg'),'cross_section.png'));

// site plan base map + names + image export (tasks 6 & 2)
document.getElementById('sp-base').addEventListener('change', e=>{
  if (secMap) setBase(secMap, 'sp', e.target.value);
});
document.getElementById('sp-names').addEventListener('change', ()=>drawPlanNames());
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

// ---- project save / resume (tasks 5 & 6) ----------------------------
document.getElementById('proj-export').addEventListener('click', ()=>{
  const stamp=new Date().toISOString().slice(0,10);
  downloadText(`geovis_project_${stamp}.csv`, stateToProjectCSV(state, sectionLine));
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
