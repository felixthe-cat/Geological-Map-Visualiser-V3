// ================================================================
// GeoVisualise — 2D Borehole Log & Cross-Section builder
// Editable, Subcores-style borehole entry with live log preview.
// Ships the same dataset to the GemPy Hugging Face Space (two-way pipeline).
// ================================================================

import { sectionStations } from './section_geom.js';

const HF_SPACE = 'ferxxxxx/Geological-Map-Visualiser-V3';
const HF_URL   = 'https://ferxxxxx-geological-map-visualiser-v3.hf.space';
document.getElementById('hf-open').href = HF_URL;

// ---- sample datasets (CSV) ------------------------------------------
const SAMPLES = {
  simple: `borehole_id,x,y,surface,top_depth,base_depth,ground_level
BH-1,840000,820000,Soil,0,5,15
BH-1,840000,820000,Clay,5,15,15
BH-1,840000,820000,Bedrock,15,20,15
BH-2,840100,820050,Soil,0,8,12
BH-2,840100,820050,Clay,8,18,12
BH-2,840100,820050,Bedrock,18,25,12
BH-3,840200,820100,Soil,0,4,18
BH-3,840200,820100,Clay,4,12,18
BH-3,840200,820100,Bedrock,12,30,18`,
  hk: `borehole_id,x,y,surface,top_depth,base_depth,ground_level
BH-A,835000,817000,Fill,0,3,28
BH-A,835000,817000,CDG,3,14,28
BH-A,835000,817000,HDG,14,22,28
BH-A,835000,817000,Granite,22,32,28
BH-B,835080,817030,Fill,0,2,25
BH-B,835080,817030,CDG,2,11,25
BH-B,835080,817030,HDG,11,20,25
BH-B,835080,817030,Granite,20,30,25
BH-C,835160,817070,Fill,0,4,31
BH-C,835160,817070,CDG,4,18,31
BH-C,835160,817070,HDG,18,25,31
BH-C,835160,817070,Granite,25,36,31`,
  pinch: `borehole_id,x,y,surface,top_depth,base_depth,ground_level
BH-1,840000,820000,Fill,0,3,20
BH-1,840000,820000,Colluvium,3,9,20
BH-1,840000,820000,CDG,9,20,20
BH-2,840120,820000,Fill,0,4,18
BH-2,840120,820000,CDG,4,19,18
BH-3,840240,820000,Fill,0,2,22
BH-3,840240,820000,Colluvium,2,12,22
BH-3,840240,820000,CDG,12,26,22`
};

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
function stateToCSV(){
  let out='borehole_id,x,y,surface,top_depth,base_depth,ground_level\n';
  for (const bh of state.boreholes)
    for (const l of bh.layers)
      out += `${bh.id},${bh.x},${bh.y},${l.surface},${l.top},${l.base},${bh.gl}\n`;
  return out;
}
function csvToState(text){
  const lines = text.trim().split(/\r?\n/).filter(l=>l.trim());
  if (!lines.length) throw new Error('No data.');
  const header = lines[0].split(',').map(s=>s.trim().toLowerCase());
  const ix = n => header.indexOf(n);
  const need = ['borehole_id','x','y','surface','top_depth','base_depth','ground_level'];
  for (const c of need) if (ix(c)<0) throw new Error('Missing column: '+c);
  const map = {};
  for (let i=1;i<lines.length;i++){
    const p = lines[i].split(',');
    if (p.length < 7) continue;
    const id = p[ix('borehole_id')].trim();
    if (!map[id]) map[id] = { id, x:+p[ix('x')], y:+p[ix('y')], gl:+p[ix('ground_level')], layers:[] };
    map[id].layers.push({ surface:p[ix('surface')].trim(), top:+p[ix('top_depth')], base:+p[ix('base_depth')] });
  }
  const arr = Object.values(map);
  arr.forEach(bh=>bh.layers.sort((a,b)=>a.top-b.top));
  if (!arr.length) throw new Error('No boreholes parsed.');
  state.boreholes = arr; state.activeIdx = 0;
}

// ---- project CSV (full round-trip: boreholes + grade + kind + site boundary
//      + section line) so a session can be saved and resumed later -----------
function sanitize(s){ return String(s==null?'':s).replace(/[,\r\n]/g,' ').trim(); }
function stateToProjectCSV(){
  const meta = { v:1, mode:state.mode,
    bounds:(state.sitePlan && state.sitePlan.bounds) || null,
    sectionLine: sectionLine || null };
  let out = '#GEOVIS '+JSON.stringify(meta)+'\n';
  out += 'borehole_id,x,y,ground_level,kind,surface,top_depth,base_depth,grade\n';
  for (const bh of state.boreholes)
    for (const l of bh.layers)
      out += [sanitize(bh.id),bh.x,bh.y,bh.gl,bh.kind||'BH',sanitize(l.surface),l.top,l.base,sanitize(l.grade||'')].join(',')+'\n';
  return out;
}
function projectCSVToState(text){
  const lines = text.split(/\r?\n/).filter(l=>l.length);
  if (!lines.length) throw new Error('Empty file.');
  let i=0, meta=null;
  if (lines[0].startsWith('#GEOVIS')){ try{ meta=JSON.parse(lines[0].slice(lines[0].indexOf('{'))); }catch{} i=1; }
  const header = lines[i].split(',').map(s=>s.trim().toLowerCase()); i++;
  const ix = n => header.indexOf(n);
  if (ix('kind')<0 && ix('grade')<0){ csvToState(text); return; }   // legacy 7-col CSV
  const map = {};
  for (; i<lines.length; i++){
    const p = lines[i].split(','); if (p.length < 8) continue;
    const id = (p[ix('borehole_id')]||'').trim(); if (!id) continue;
    if (!map[id]) map[id] = { id, x:+p[ix('x')], y:+p[ix('y')], gl:+p[ix('ground_level')],
      kind:(ix('kind')>=0?(p[ix('kind')]||'').trim():'')||'BH', layers:[] };
    map[id].layers.push({ surface:(p[ix('surface')]||'').trim(), top:+p[ix('top_depth')],
      base:+p[ix('base_depth')], grade:(ix('grade')>=0?(p[ix('grade')]||'').trim():'') });
  }
  const arr = Object.values(map);
  arr.forEach(bh=>bh.layers.sort((a,b)=>a.top-b.top));
  if (!arr.length) throw new Error('No boreholes parsed.');
  state.boreholes = arr; state.activeIdx = 0;
  if (meta){
    if (meta.mode) state.mode = meta.mode;
    sectionLine = meta.sectionLine || null;
    state.sitePlan = meta.bounds ? { bounds:meta.bounds, boreholes: arr.map(b=>({id:b.id,x:b.x,y:b.y,imported:true})) } : null;
  }
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
function sectionActive(){ return document.querySelector('.tabpane[data-pane="section"]').classList.contains('active'); }
function commit(){ syncDerived(); renderLogLive(); if (sectionActive() && secMap) updateSection(); }

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

  const mL=58, mR=showElev?70:20, mT=76, mB=24, colW=90;
  const pxPerM = Math.max(6, Math.min(20, 320/maxDepth)), plotH = maxDepth*pxPerM;
  const yOf = d => mT + d*pxPerM;
  const lx = mL+colW+(showElev?46:8);

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

  const rightW = legendMode ? 220 : 170;
  const W = mL+colW+mR+rightW;
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
    if (showElev) svg.appendChild(el('text',{x:mL+colW+8,y:y+3,'font-size':10,fill:'#6b6250'},(bh.gl-d).toFixed(1)));
  }
  svg.appendChild(el('text',{x:mL-40,y:mT-14,'font-size':10,'font-weight':600,fill:'#6b6250'},'Depth (m)'));
  if (showElev) svg.appendChild(el('text',{x:mL+colW+8,y:mT-14,'font-size':10,'font-weight':600,fill:'#6b6250'},'mPD'));

  for (const l of bh.layers){
    const y0=yOf(l.top), y1=yOf(l.base), c=colourFor(l.surface);
    svg.appendChild(el('rect',{x:mL,y:y0,width:colW,height:Math.max(0,y1-y0),fill:c,stroke:'#3d3529','stroke-width':.7}));
  }

  if (legendMode){
    // consolidated legend beside the log (top) instead of crowded inline labels
    const gx=mL+colW+20; let gy=mT+4;
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

// ---- Cross-section site map (Leaflet satellite) + draggable section line ----
// The cross-section is defined by a draggable line drawn on a satellite map.
// Boreholes are projected onto the line (within a corridor either side),
// ordered by their position along it, and the section redraws live as the
// line is moved / rotated / resized. Reuses Leaflet + proj4 from sitemap.js.
let secMap=null, secBhLayer=null, secLinePoly=null, secHandleA=null, secHandleB=null, secBoundaryRect=null;
let sectionLine=null;   // {a:[lat,lng], b:[lat,lng]}

let _mapLibs=null;
function ensureMapLibs(){ return _mapLibs || (_mapLibs=import('./sitemap.js').then(m=>m.ensureMapLibs())); }

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
  secBhLayer=secLinePoly=secHandleA=secHandleB=secBoundaryRect=null;
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
  await ensureMapLibs();

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
    L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',{maxZoom:20,attribution:'Google Hybrid'}).addTo(secMap);
    secBhLayer=L.layerGroup().addTo(secMap);
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
  if (!secMap || !sectionLine) return;
  const A=toEN(...sectionLine.a), B=toEN(...sectionLine.b);
  const lineLen=Math.hypot(B.e-A.e, B.n-A.n);
  const allHoles=sectionHoles();
  const tpOnly = document.getElementById('sec-tp-only')?.checked;
  const secHoles = tpOnly ? allHoles.filter(b=>(b.kind||'BH')==='TP') : allHoles;
  const corridor = +document.getElementById('sec-tol').value;   // task 5: distance tolerance (m)
  const { stations, inSet } = sectionStations(A, B, secHoles, corridor);
  secBhLayer.clearLayers();
  for (const bh of allHoles){
    const inSec=inSet.has(bh.id);
    L.circleMarker(toLL(bh.x,bh.y),{radius:inSec?6:4,color:'#1a1a0f',weight:1,
      fillColor:inSec?'#2f5a1e':'#a8a196',fillOpacity:.9})
      .bindTooltip(bh.id).addTo(secBhLayer);
  }
  renderSection(stations, +document.getElementById('sec-vex').value, lineLen);
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

  // coloured grade bands (interpolated between adjacent boreholes)
  const horizonsByHole = {}; ids.forEach(id=>{ horizonsByHole[id]=buildHorizons(id); });
  for (let k=0;k<STRAT.length;k++){
    const c=STRAT_COLOUR[STRAT[k]] || colourFor(STRAT[k]);
    for (let i=0;i<ids.length-1;i++){
      const hA=horizonsByHole[ids[i]], hB=horizonsByHole[ids[i+1]];
      const topA=hA[k], baseA=hA[k+1], topB=hB[k], baseB=hB[k+1];
      if (topA===baseA && topB===baseB) continue;
      const xa=X(dist[i]), xb=X(dist[i+1]);
      const pts=[[xa,Y(topA)],[xb,Y(topB)],[xb,Y(baseB)],[xa,Y(baseA)]].map(p=>p.join(',')).join(' ');
      svg.appendChild(el('polygon',{points:pts,fill:c,opacity:.85,stroke:c,'stroke-width':.5,'data-cls':STRAT[k]}));
    }
  }
  let gpts=''; ids.forEach((id,i)=>{ gpts+=`${X(dist[i])},${Y(BH[id].gl)} `; });
  svg.appendChild(el('polyline',{points:gpts.trim(),fill:'none',stroke:'#3d3529','stroke-width':1.4}));

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
  renderLogLive();
}

document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.tabpane').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  document.querySelector(`.tabpane[data-pane="${t.dataset.tab}"]`).classList.add('active');
  applyTabLayout(t.dataset.tab);
  if (t.dataset.tab==='section') renderSectionFromUI();
  if (t.dataset.tab==='log') renderLogLive();
  if (t.dataset.tab==='map') openSiteMap();
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
document.getElementById('bh-select').addEventListener('change', e=>{ state.activeIdx=+e.target.value; refreshInput(); renderLogLive(); });
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
['sec-show-logs','sec-show-names','sec-tp-only'].forEach(id=>
  document.getElementById(id).addEventListener('change', ()=>{ if (secMap) updateSection(); }));
document.getElementById('panel-collapse').addEventListener('click', ()=>setPanelCollapsed(true));
document.getElementById('panel-expand').addEventListener('click', ()=>setPanelCollapsed(false));
document.getElementById('sec-png').addEventListener('click', ()=>exportPNG(document.querySelector('#sec-viz svg'),'cross_section.png'));
document.getElementById('hf-send').addEventListener('click', sendToHF);

document.getElementById('sample-select').addEventListener('change', e=>{
  if (SAMPLES[e.target.value]){ document.getElementById('csv').value=SAMPLES[e.target.value]; importCSV(); }
});
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
  downloadText(`geovis_project_${stamp}.csv`, stateToProjectCSV());
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
    projectCSVToState(_projText);
    setMode(state.mode);                 // sync depth/elevation toggle
    sectionLine = sectionLine;           // preserved from meta
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

// boot with the simple sample, opening on the Site Map (step 1)
csvToState(SAMPLES.simple);
syncDerived();
refreshInput();
renderLogLive();
applyTabLayout('map');
openSiteMap();
