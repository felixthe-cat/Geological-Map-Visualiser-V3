// ================================================================
// GeoVisualise — 2D Borehole Log & Cross-Section builder
// Editable, Subcores-style borehole entry with live log preview.
// Ships the same dataset to the GemPy Hugging Face Space (two-way pipeline).
// ================================================================

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

// ---- STATE (source of truth) ----------------------------------------
// state.boreholes = [{id,x,y,gl, layers:[{surface,top,base}]}]  (top/base = depth below GL)
let state = { boreholes: [], activeIdx: 0, mode: 'depth' };
// Derived (consumed by renderers)
let BH = {}; let STRAT = [];

function active(){ return state.boreholes[state.activeIdx]; }

function syncDerived(){
  BH = {};
  const sumTop = {}, cntTop = {};
  for (const bh of state.boreholes){
    BH[bh.id] = { x:bh.x, y:bh.y, gl:bh.gl,
      layers: bh.layers.map(l=>({surface:l.surface, top:l.top, base:l.base})) };
    for (const l of bh.layers){
      sumTop[l.surface] = (sumTop[l.surface]||0) + l.top;
      cntTop[l.surface] = (cntTop[l.surface]||0) + 1;
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
      `<td><span class="swatch" style="background:${colourFor(l.surface)}"></span>`+
        `<input type="text" data-i="${i}" data-f="surface" value="${escapeHtml(l.surface)}" style="width:calc(100% - 20px)"></td>`+
      `<td class="act"><span class="rm" data-rm="${i}" title="Remove">✕</span></td>`;
    body.appendChild(tr);
  });
}
function round(v){ return Math.round(v*100)/100; }
function escapeHtml(s){ return (s||'').replace(/"/g,'&quot;'); }

function refreshInput(){ renderBhSelect(); renderMeta(); renderLayerTable(); }

// ---- edit handlers ---------------------------------------------------
function commit(){ syncDerived(); refreshSelectors(); renderLogLive(); }

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

function renderLog(id){
  const box = document.getElementById('log-viz');
  box.innerHTML='';
  const bh = BH[id];
  if (!bh || !bh.layers.length){ box.innerHTML='<p class="hint" style="padding:10px">Add layers to see the log.</p>'; return; }
  const showElev = document.getElementById('log-elev').checked;
  const maxDepth = Math.max(...bh.layers.map(l=>l.base));
  if (!(maxDepth>0)){ box.innerHTML='<p class="hint" style="padding:10px">Layer depths must be positive.</p>'; return; }

  const mL=58, mR=showElev?70:20, mT=76, mB=24, colW=90;
  const pxPerM = Math.max(6, Math.min(20, 320/maxDepth)), plotH = maxDepth*pxPerM;
  const W = mL+colW+mR+150, H = mT+plotH+mB;
  const svg = el('svg',{width:W,height:H,viewBox:`0 0 ${W} ${H}`,'font-family':'Outfit,sans-serif'});
  svg.appendChild(el('rect',{x:0,y:0,width:W,height:H,fill:'#fffdf8'}));
  svg.appendChild(el('text',{x:mL,y:24,'font-size':16,'font-weight':700,fill:'#1e3c12'},`Borehole ${id}`));
  svg.appendChild(el('text',{x:mL,y:42,'font-size':11,fill:'#6b6250'},
    `GL ${(+bh.gl).toFixed(2)} mPD   ·   E ${bh.x}  N ${bh.y}   ·   depth ${maxDepth} m`));
  svg.appendChild(el('line',{x1:mL,y1:mT-8,x2:W-8,y2:mT-8,stroke:'#c8bda8'}));

  const yOf = d => mT + d*pxPerM;
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
    const midY=(y0+y1)/2, lx=mL+colW+(showElev?46:8);
    svg.appendChild(el('line',{x1:mL+colW,y1:midY,x2:lx,y2:midY,stroke:'#b0a68f','stroke-width':.6}));
    svg.appendChild(el('rect',{x:lx,y:midY-5,width:10,height:10,fill:c,stroke:'#3d3529','stroke-width':.6}));
    svg.appendChild(el('text',{x:lx+15,y:midY-1,'font-size':11,'font-weight':600,fill:'#1a1a0f'},l.surface||'(unnamed)'));
    svg.appendChild(el('text',{x:lx+15,y:midY+11,'font-size':9.5,fill:'#6b6250'},`${l.top}–${l.base} m`));
  }
  svg.appendChild(el('rect',{x:mL,y:mT,width:colW,height:plotH,fill:'none',stroke:'#3d3529'}));
  box.appendChild(svg);
}
function renderLogLive(){ const bh=active(); if(bh) renderLog(bh.id); }

function renderSection(ids, vex){
  const box = document.getElementById('sec-viz');
  box.innerHTML='';
  ids = ids.filter(id=>BH[id] && BH[id].layers.length);
  if (ids.length < 2){ box.innerHTML='<p class="hint" style="padding:10px">Select 2+ boreholes (with layers).</p>'; return; }

  const dist=[0];
  for (let i=1;i<ids.length;i++){ const a=BH[ids[i-1]], b=BH[ids[i]]; dist.push(dist[i-1]+Math.hypot(b.x-a.x,b.y-a.y)); }
  let total = dist[dist.length-1];
  if (total===0){ dist.forEach((_,i)=>dist[i]=i); total=ids.length-1; }

  let eMin=Infinity, eMax=-Infinity;
  for (const id of ids){ const bh=BH[id]; eMax=Math.max(eMax,bh.gl); for (const l of bh.layers) eMin=Math.min(eMin,bh.gl-l.base); }
  const eRange=(eMax-eMin)||1;

  const mL=56, mR=20, mT=56, mB=40, plotW=Math.max(520,total*0.9);
  const xPxPerM=plotW/total, yPxPerM=xPxPerM*vex, plotH=eRange*yPxPerM;
  const W=mL+plotW+mR, H=mT+plotH+mB;
  const svg=el('svg',{width:W,height:H,viewBox:`0 0 ${W} ${H}`,'font-family':'Outfit,sans-serif'});
  svg.appendChild(el('rect',{x:0,y:0,width:W,height:H,fill:'#fffdf8'}));
  const X=d=>mL+d*xPxPerM, Y=e=>mT+(eMax-e)*yPxPerM, elevAt=(id,d)=>BH[id].gl-d;

  svg.appendChild(el('text',{x:mL,y:24,'font-size':15,'font-weight':700,fill:'#1e3c12'},`Cross-section: ${ids.join(' – ')}`));
  svg.appendChild(el('text',{x:mL,y:40,'font-size':11,fill:'#6b6250'},`Vertical exaggeration ${vex}×`));

  const estep=niceStep(eRange), e0=Math.ceil(eMin/estep)*estep;
  for (let e=e0; e<=eMax+0.001; e+=estep){
    const y=Y(e);
    svg.appendChild(el('line',{x1:mL-4,y1:y,x2:W-mR,y2:y,stroke:'#eae1cf'}));
    svg.appendChild(el('line',{x1:mL-4,y1:y,x2:mL,y2:y,stroke:'#6b6250'}));
    svg.appendChild(el('text',{x:mL-7,y:y+3,'font-size':10,'text-anchor':'end',fill:'#6b6250'},e.toFixed(0)));
  }
  svg.appendChild(el('text',{x:mL-46,y:mT-10,'font-size':10,'font-weight':600,fill:'#6b6250'},'mPD'));

  const layerOf=(id,s)=>BH[id].layers.find(l=>l.surface===s)||null;
  for (const s of STRAT){
    const c=colourFor(s);
    for (let i=0;i<ids.length-1;i++){
      const la=layerOf(ids[i],s), lb=layerOf(ids[i+1],s);
      if (!la||!lb) continue;
      const xa=X(dist[i]), xb=X(dist[i+1]);
      const pts=[[xa,Y(elevAt(ids[i],la.top))],[xb,Y(elevAt(ids[i+1],lb.top))],
                 [xb,Y(elevAt(ids[i+1],lb.base))],[xa,Y(elevAt(ids[i],la.base))]].map(p=>p.join(',')).join(' ');
      svg.appendChild(el('polygon',{points:pts,fill:c,opacity:.85,stroke:c,'stroke-width':.5}));
    }
  }
  let gpts=''; ids.forEach((id,i)=>{ gpts+=`${X(dist[i])},${Y(BH[id].gl)} `; });
  svg.appendChild(el('polyline',{points:gpts.trim(),fill:'none',stroke:'#3d3529','stroke-width':1.4}));

  ids.forEach((id,i)=>{
    const bh=BH[id], x=X(dist[i]), w=8;
    for (const l of bh.layers){
      const y0=Y(elevAt(id,l.top)), y1=Y(elevAt(id,l.base));
      svg.appendChild(el('rect',{x:x-w/2,y:y0,width:w,height:Math.max(0,y1-y0),fill:colourFor(l.surface),stroke:'#1a1a0f','stroke-width':.8}));
    }
    svg.appendChild(el('line',{x1:x,y1:mT+plotH,x2:x,y2:mT+plotH+6,stroke:'#6b6250'}));
    svg.appendChild(el('text',{x:x,y:mT+plotH+18,'font-size':10,'font-weight':600,'text-anchor':'middle',fill:'#1e3c12'},id));
    svg.appendChild(el('text',{x:x,y:mT+plotH+30,'font-size':9,'text-anchor':'middle',fill:'#6b6250'},`${dist[i].toFixed(0)} m`));
  });
  let ly=mT+8;
  STRAT.forEach(s=>{
    svg.appendChild(el('rect',{x:W-mR-96,y:ly-8,width:10,height:10,fill:colourFor(s),stroke:'#3d3529','stroke-width':.6}));
    svg.appendChild(el('text',{x:W-mR-82,y:ly,'font-size':10,fill:'#1a1a0f'},s)); ly+=15;
  });
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
  }
}

// ==== wiring ==========================================================
function refreshSelectors(){
  const secSel=document.getElementById('sec-bh');
  const prev=new Set([...secSel.selectedOptions].map(o=>o.value));
  const ids=Object.keys(BH);
  // keep prior selection only if it still overlaps the current boreholes; else select all
  const keepPrev = prev.size && ids.some(id=>prev.has(id));
  secSel.innerHTML='';
  ids.forEach(id=>{
    const o=new Option(id,id);
    o.selected = keepPrev ? prev.has(id) : true;
    secSel.appendChild(o);
  });
}
function selectedSectionIds(){ return [...document.getElementById('sec-bh').selectedOptions].map(o=>o.value); }
function renderSectionFromUI(){ renderSection(selectedSectionIds(), +document.getElementById('sec-vex').value); }

document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.tabpane').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  document.querySelector(`.tabpane[data-pane="${t.dataset.tab}"]`).classList.add('active');
  if (t.dataset.tab==='section') renderSectionFromUI();
  if (t.dataset.tab==='log') renderLogLive();
  if (t.dataset.tab==='map') openSiteMap();
}));

// ---- Site Map (lazy-loaded module) ----------------------------------
let siteMapReady = false;
async function openSiteMap(){
  try {
    const { initSiteMap } = await import('./sitemap.js');
    await initSiteMap({
      onLoadTo2D(boreholes){
        state.boreholes = boreholes;
        state.activeIdx = 0;
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
document.getElementById('log-png').addEventListener('click', ()=>exportPNG(document.querySelector('#log-viz svg'),'borehole_log.png'));
document.getElementById('sec-bh').addEventListener('change', renderSectionFromUI);
document.getElementById('sec-vex').addEventListener('input', e=>{ document.getElementById('sec-vex-val').textContent=e.target.value+'×'; renderSectionFromUI(); });
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

// ---- external API: load boreholes pushed from the sitemap (task 4, future) ----
window.GeoBuilder = {
  loadBoreholes(arr){ // arr of {id,x,y,gl,layers:[{surface,top,base}]}
    if (Array.isArray(arr) && arr.length){ state.boreholes=arr; state.activeIdx=0; refreshInput(); commit(); }
  },
  loadCSV(text){ document.getElementById('csv').value=text; importCSV(); }
};

// boot with the simple sample
csvToState(SAMPLES.simple);
syncDerived();
refreshInput();
refreshSelectors();
renderLogLive();
