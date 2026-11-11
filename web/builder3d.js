// ================================================================
// GeoVisualise — 3D Block builder (builder3d.html)
//
// Same dataset as the 2D builder → a layered soil block inside a drawn site
// boundary, under the live Lands Department 3D photo-mesh. A vertical slice
// plane cuts both; the slice exports as DXF for GeoStudio / PLAXIS 2D.
//
// Geometry is in block3d.js (pure, Node-tested). This file is UI + three.js.
// Plan / decisions: docs/PLAN_3D_BLOCK.md.
//
// Scene frame: x = E − E0, y = mPD − ZREF, z = −(N − N0), metres, origin at the
// boundary's bbox centre. Vertical exaggeration = world.scale.y, so the block,
// the photo-mesh and the boreholes all stretch together.
// ================================================================

import { blockHoles, makeModel, buildBlock, sliceRuns, sliceLine, polyArea, defaultBase, pointInPoly,
         ringsToShapes, sliceFromPose, clipToPoly, ribbon } from './block3d.js';
import { projectCSVToState, stateToProjectCSV } from './project_csv.js';
import { EXAMPLES } from './examples.js';
import { sectionRegions, toDXF, layerName } from './cad_export.js';
import { sampleElevation, tileCoord } from './terrain.js';
import { fetchDtmTile, dtmTileGetter } from './dtm_tiles.js';
import { classColour } from './strata.js';
import { footprint, lineSpans, earthworks } from './structure.js';
import { parseDtmTiff, sampleGrid, gridBounds, unpackGrid, sheetName, SHEET } from './lidar_tile.js';
import { SUPABASE_URL } from './supabase_config.js';

const $ = id => document.getElementById(id);
const LANDSD_3D = 'https://data.map.gov.hk/api/3d-data/3dtiles/f2/tileset.json';
const THREE_LIBS = 'https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/';
const HANDOFF_KEY = 'geovis_3d_handoff';
// ?embed=1: shown inside the 2D builder's "3D" tabs (an iframe). The 2D builder owns the dataset
// and the saving; this page gets the project through window.geo3d and reports its height back.
const EMBED = new URLSearchParams(location.search).has('embed');
// Lands Dept "Building" layer on the CSDI portal: outlines + BaseHeight / TopHeight (mPD).
// No key; sends CORS headers for the Vercel origin and for localhost.
// Highways Dept structure outlines (bridges / flyovers, footbridges) and Lands Dept road centre
// lines, same portal. None carries a level or a width: see setInfra().
const CSDI = 'https://portal.csdi.gov.hk/server/rest/services/common/';
const STRUCT_URLS = ['hyd_rcd_1632360050986_38630', 'hyd_rcd_1632360512481_74705'].map(s=>CSDI+s+'/FeatureServer/0/query');
const ROAD_URL = CSDI+'landsd_rcd_1637310758814_80061/FeatureServer/0/query';
// Typical carriageway widths (m) by Lands Dept street type: an assumption, the data has centre lines only.
const ROAD_W = { 'Highway':14, 'Main Road':11, 'Secondary Road':7.3, 'Restricted Road':5, 'Track':3 };   // 'Tunnel' is underground: not drawn
const BLD_URL = 'https://portal.csdi.gov.hk/server/rest/services/common/landsd_rcd_1637211194312_35158/FeatureServer/0/query';
// White-model palette (site-model-viewer-style skill): sage ground, chalk buildings.
const LOOK = { terrain:'#7f9f73', contour:'vec3(0.25,0.32,0.23)', building:'#f1f1ea', structure:'#c96f3b', edge:'#40554e' };   // contour = #40523b for the shader
const CONTOUR_M = 2;

// ---- state -----------------------------------------------------------------
let proj = null;        // projectCSVToState() result of the open dataset
let cloudId = null;     // saved dataset it came from (for "Save changes")
let cloud = null;       // cloud.js, when accounts are configured
let boundary = null;    // [[E,N]] HK1980, counter-clockwise
let model = null, block = null, runs = [], slice = null;
let O = null;           // {e,n,z} scene origin (E0, N0, ZREF)

function note(id, msg, cls){
  const el=$(id); if (!el) return;
  el.style.display=msg?'block':'none'; el.className='status '+(cls||''); el.textContent=msg||'';
  tellHeight();
}
// Embedded in the 2D builder: say how tall this page now is, so its frame can match (set in boot()).
let tellHeight=()=>{};
const topMode = () => document.querySelector('input[name=top]:checked').value;
const vex = () => +$('vex').value;

// ---- HK1980 <-> WGS84 (proj4 comes with the shared map libs) ----------------
const toLL = (e,n) => { const [lng,lat]=proj4('HK1980','WGS84',[e,n]); return [lat,lng]; };
const fromLL = (lat,lng) => proj4('WGS84','HK1980',[lng,lat]);

// ---- dataset ---------------------------------------------------------------------
function readHandoff(){
  try { return JSON.parse(localStorage.getItem(HANDOFF_KEY)||'null'); } catch { return null; }
}
async function fillDatasets(){
  const sel=$('ds-select'); sel.innerHTML='';
  if (readHandoff()) sel.appendChild(new Option('Current project from the 2D builder', 'handoff'));
  if (cloud){
    const rows = await cloud.listProjects().catch(()=>[]);
    if (rows.length){
      const g=document.createElement('optgroup'); g.label='My saved datasets';
      for (const r of rows) g.appendChild(new Option(`${r.name} — ${cloud.whenLabel(r.updated_at)}`, 'cloud:'+r.id));
      sel.appendChild(g);
    }
  }
  const g=document.createElement('optgroup'); g.label='Example datasets';
  for (const ex of EXAMPLES) g.appendChild(new Option(ex.name, 'ex:'+ex.id));
  sel.appendChild(g);
}
async function loadSelected(){
  const v=$('ds-select').value;
  try {
    if (v==='handoff'){ const h=readHandoff(); openProject(h.csv, h.cloudId, 'the project from the 2D builder'); }
    else if (v.startsWith('cloud:')){
      note('ds-note','Opening…');
      const row=await cloud.getProject(v.slice(6));
      if (!row) throw new Error('Could not open that dataset.');
      openProject(row.csv, row.id, `“${row.name}”`);
    } else {
      const ex=EXAMPLES.find(e=>e.id===v.slice(3));
      openProject(ex.csv, null, ex.name);
    }
  } catch(err){ note('ds-note','✗ '+(err?.message||err),'err'); }
}
function openProject(csv, id, from){
  proj = projectCSVToState(csv);
  cloudId = id || null;
  $('save-cloud').disabled = !(cloud && cloudId);
  const b = proj.block3d || {};
  boundary = Array.isArray(b.boundary) && b.boundary.length>=3 ? b.boundary : null;
  applyOptions(b);
  model = block = null; runs = [];
  clearScene();
  const n = proj.boreholes.length;
  note('ds-note', `✓ Opened ${from} — ${n} hole(s)`+(boundary?' and a saved boundary.':'. Now draw the site boundary.'),'ok');
  drawMap(true);
  updateBoundaryInfo();
}

// ---- options <-> saved block3d -------------------------------------------------------
function applyOptions(b){
  // A dataset with no saved value gets the default, not whatever the last dataset left behind.
  document.querySelector(`input[name=top][value=${b.top==='bh'?'bh':'dtm'}]`).checked=true;
  $('base').value = Number.isFinite(b.base) ? b.base : '';
  $('detail').value=String(b.detail || 120);
  $('use-tp').checked = !!b.useTP;
  $('vex').value=b.vex || 1;
  $('mesh-on').checked=!!b.meshOn;
  $('terr-on').checked=b.terrOn ?? true;
  $('bld-on').checked=b.bldOn ?? true;
  $('infra-on').checked=b.infraOn ?? true;
  $('holes-on').checked=!!b.holesOn;
  $('mesh-flat').checked=b.meshFlat ?? true;
  $('mesh-op').value=b.meshOp ?? 1;
  $('mesh-dz').value = Number.isFinite(b.meshDz) ? b.meshDz : 0;
  meshLevelled = Number.isFinite(b.meshDz);
  const s=b.slice||{};
  $('sl-on').checked=!!s.on; $('sl-flip').checked=!!s.flip;
  $('sl-az').value=s.az ?? 90;
  $('sl-off').value=s.off ?? 0;
  const st=b.structure||{};
  $('st-on').checked=!!st.on; $('st-form').style.display=st.on?'':'none';
  for (const id of ST_IDS) $(id).value=st[id.slice(3)] ?? (id==='st-rot' ? 0 : '');
  syncLabels();
}
const ST_IDS=['st-e','st-n','st-len','st-wid','st-rot','st-found','st-height'];
function block3dSettings(){
  const base=$('base').value.trim();
  return { boundary, top:topMode(), base: base===''?null:+base, detail:+$('detail').value,
    useTP:$('use-tp').checked, vex:vex(), terrOn:$('terr-on').checked, bldOn:$('bld-on').checked, infraOn:$('infra-on').checked, holesOn:$('holes-on').checked, meshOn:$('mesh-on').checked, meshFlat:$('mesh-flat').checked, meshOp:+$('mesh-op').value,
    meshDz: meshLevelled ? +$('mesh-dz').value : null,
    slice:{ on:$('sl-on').checked, az:+$('sl-az').value, off:+$('sl-off').value, flip:$('sl-flip').checked },
    structure:{ on:$('st-on').checked, ...Object.fromEntries(ST_IDS.map(id=>[id.slice(3), $(id).value===''?null:+$(id).value])) } };
}
function projectCSV(){
  const state={ boreholes:proj.boreholes, mode:proj.mode||'depth', sitePlan: proj.bounds ? { bounds:proj.bounds } : null };
  return stateToProjectCSV(state, proj.sectionLine,
    { section:proj.section, excluded:proj.excluded||[], annots:proj.annots||[], block3d:block3dSettings() });
}
function syncLabels(){
  $('vex-val').textContent=vex()+'×';
  $('mesh-op-val').textContent=Math.round(+$('mesh-op').value*100)+'%';
  $('sl-az-val').textContent=$('sl-az').value+'°';
  $('sl-off-val').textContent=(+$('sl-off').value).toFixed(1)+' m';
  $('st-rot-val').textContent=$('st-rot').value+'°';
}

// ---- site map -----------------------------------------------------------------------------
let map=null, holesLayer=null, bdLayer=null, slLayer=null, stLayer=null;
async function initMap(){
  const { ensureMapLibs } = await import('./sitemap.js');
  await ensureMapLibs();
  const { BASEMAPS } = await import('./map_export.js');
  map = L.map('map', { maxZoom:20 }).setView([22.33, 114.15], 11);
  const layers={};
  for (const [name, bm] of Object.entries(BASEMAPS)) if (bm.url)
    layers[name]=L.tileLayer(bm.url, { maxZoom:bm.maxZoom, maxNativeZoom:bm.maxNativeZoom, attribution:bm.attribution });
  layers['Google Hybrid'].addTo(map);
  L.control.layers(layers).addTo(map);
  holesLayer=L.layerGroup().addTo(map); bdLayer=L.layerGroup().addTo(map); slLayer=L.layerGroup().addTo(map); stLayer=L.layerGroup().addTo(map);
}
function usedHoles(){
  if (!proj) return [];
  return blockHoles(proj.boreholes).filter(b => $('use-tp').checked || (b.kind||'BH')!=='TP');
}
function drawMap(fit){
  if (!map || !proj) return;
  holesLayer.clearLayers(); bdLayer.clearLayers();
  const used=new Set(usedHoles());
  for (const b of proj.boreholes){
    if (!Number.isFinite(b.x)) continue;
    L.circleMarker(toLL(b.x,b.y), { radius:5, color:'#1a1a0f', weight:1.5,
      fillColor: used.has(b) ? '#9ac845' : '#9a9a9a', fillOpacity:1 })
      .bindTooltip(`${b.id}${(b.kind||'BH')==='TP'?' (trial pit)':''} · GL ${b.gl} mPD`).addTo(holesLayer);
  }
  if (boundary) L.polygon(boundary.map(p=>toLL(p[0],p[1])), { color:'#e07b1a', weight:2.5, fillOpacity:.08 }).addTo(bdLayer);
  drawSliceOnMap();
  if (fit){
    const pts = (boundary||proj.boreholes.filter(b=>Number.isFinite(b.x)).map(b=>[b.x,b.y])).map(p=>toLL(p[0],p[1]));
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom:19 });
  }
}
function drawSliceOnMap(){
  if (!slLayer) return;
  slLayer.clearLayers();
  if (!boundary || !$('sl-on').checked) return;
  const s=sliceLine(boundary, +$('sl-az').value, +$('sl-off').value);
  const a=toLL(s.A.e,s.A.n), b=toLL(s.B.e,s.B.n);
  L.polyline([a,b], { color:'#c0262d', weight:3, dashArray:'8 5' }).addTo(slLayer);
  L.marker(a, { icon:L.divIcon({ className:'', html:'<b style="color:#c0262d;font-size:14px;text-shadow:0 0 3px #fff">A</b>' }) }).addTo(slLayer);
  L.marker(b, { icon:L.divIcon({ className:'', html:'<b style="color:#c0262d;font-size:14px;text-shadow:0 0 3px #fff">B</b>' }) }).addTo(slLayer);
}
function setBoundary(pts){
  if (polyArea(pts)<0) pts=[...pts].reverse();
  boundary=pts.map(p=>[+p[0].toFixed(3), +p[1].toFixed(3)]);
  model=block=null; runs=[];
  clearScene();
  drawMap(false); updateBoundaryInfo();
}
function updateBoundaryInfo(){
  if (!boundary){ $('bd-info').textContent='No boundary yet.'; return; }
  const xs=boundary.map(p=>p[0]), ys=boundary.map(p=>p[1]);
  const half=Math.hypot(Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys))/2;
  $('sl-off').min=(-half).toFixed(1); $('sl-off').max=half.toFixed(1);
  const inside=usedHoles().length;
  $('bd-info').textContent=`${boundary.length} corners · ${Math.round(Math.abs(polyArea(boundary))).toLocaleString()} m² · ${inside} hole(s) used`;
}
function startDraw(){
  if (!map) return;
  showTab('map');
  const d=new L.Draw.Polygon(map, { shapeOptions:{ color:'#e07b1a', weight:2.5 }, showArea:false });
  map.once(L.Draw.Event.CREATED, e => setBoundary(e.layer.getLatLngs()[0].map(ll=>fromLL(ll.lat, ll.lng))));
  d.enable();
}
function fitBoundary(){
  const h=usedHoles(); if (!h.length){ note('ds-note','Load a dataset with logged boreholes first.','err'); return; }
  const xs=h.map(b=>b.x), ys=h.map(b=>b.y);
  const pad=Math.max(10, 0.1*Math.max(Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys)));
  const x0=Math.min(...xs)-pad, x1=Math.max(...xs)+pad, y0=Math.min(...ys)-pad, y1=Math.max(...ys)+pad;
  setBoundary([[x0,y0],[x1,y0],[x1,y1],[x0,y1]]);
}

// ---- DTM sampling over the boundary ------------------------------------------------------------
async function prefetchDtm(){
  const xs=boundary.map(p=>p[0]), ys=boundary.map(p=>p[1]);
  const corners=[[Math.min(...xs),Math.min(...ys)],[Math.max(...xs),Math.max(...ys)]].map(([e,n])=>{ const [la,ln]=toLL(e,n); return tileCoord(ln,la); });
  const r0=Math.min(corners[0].row,corners[1].row), r1=Math.max(corners[0].row,corners[1].row);
  const c0=Math.min(corners[0].col,corners[1].col), c1=Math.max(corners[0].col,corners[1].col);
  // ponytail: a site spanning more than 6×6 tiles (~7 km) is not a site; refuse rather than fetch hundreds
  if ((r1-r0+1)*(c1-c0+1) > 36) throw new Error('Boundary too large for the ground model (over ~7 km across).');
  const jobs=[];
  for (let r=r0;r<=r1;r++) for (let c=c0;c<=c1;c++) jobs.push(fetchDtmTile(corners[0].lod, r, c));
  const got=await Promise.all(jobs);
  return got.some(Boolean);
}
// 0.5 m LiDAR tiles the user loaded from disk (CEDD has no live feed for them: the
// portal is order-and-download). They are held in memory for this visit only.
let lidar=[];
async function loadLidar(files){
  let ok=0; const bad=[];
  for (const f of files){
    try {
      // A wrong or damaged file must not take the page down: report it and carry on with the rest.
      const g=parseDtmTiff(await f.arrayBuffer());
      lidar=lidar.filter(o=>o.x0!==g.x0 || o.y0!==g.y0);      // same sheet loaded twice: keep the new one
      lidar.push(g); ok++;
    } catch(err){ bad.push(`${f.name}: ${err?.message||err}`); }
  }
  const b=lidar.map(gridBounds);
  const cover=lidar.length ? ` Covers E ${Math.min(...b.map(v=>v[0]))}–${Math.max(...b.map(v=>v[2]))}, N ${Math.min(...b.map(v=>v[1]))}–${Math.max(...b.map(v=>v[3]))}.` : '';
  note('lidar-note', (ok ? `✓ ${lidar.length} LiDAR tile(s) loaded.${cover}` : '')+(bad.length ? ' ✗ '+bad.join(' · ') : ''), bad.length && !ok ? 'err' : 'ok');
  if (ok && model) build();                                   // already built: redo it on the finer ground
}
// The same LiDAR, packed by tools/lidar_pack.mjs and hosted, fetched by sheet for the boundary.
// ponytail: one public folder + index.json; a missing index (not uploaded yet) just means "no hosted LiDAR".
// ?lidar=<folder or URL> points at another copy (local testing before an upload).
const LIDAR_BASE=new URLSearchParams(location.search).get('lidar') || `${SUPABASE_URL}/storage/v1/object/public/lidar`;
let lidarIndex;                                               // Promise<Set of sheet names>
const hosted=new Map();                                       // sheet name -> grid (or null when it failed)
async function fetchHostedLidar(){
  lidarIndex ??= fetch(`${LIDAR_BASE}/index.json`).then(r=>r.ok ? r.json() : { sheets:[] })
    .then(j=>new Set(j.sheets)).catch(()=>new Set());          // offline / not hosted: carry on without it
  const have=await lidarIndex;
  const xs=boundary.map(p=>p[0]), ys=boundary.map(p=>p[1]), want=new Set();
  for (let e=Math.min(...xs); e<Math.max(...xs)+SHEET.w; e+=SHEET.w)
    for (let n=Math.min(...ys); n<Math.max(...ys)+SHEET.h; n+=SHEET.h){
      const name=sheetName(Math.min(e,Math.max(...xs)), Math.min(n,Math.max(...ys)));
      if (have.has(name) && !hosted.has(name)) want.add(name);
    }
  if (want.size>36) return;                                   // same ~7 km cap as the 5 m model
  await Promise.all([...want].map(async name=>{
    try { hosted.set(name, await unpackGrid(await (await fetch(`${LIDAR_BASE}/${name}`)).arrayBuffer())); }
    catch(err){ console.warn('[lidar]', name, err); hosted.set(name, null); }   // one bad sheet: 5 m model there
  }));
}
const allLidar=()=>[...lidar, ...[...hosted.values()].filter(Boolean)];   // the user's own files win
function dtm5At(e,n){
  const [lat,lng]=toLL(e,n);
  const z=sampleElevation(dtmTileGetter, lng, lat);
  return Number.isFinite(z) && z>-50 ? z : null;     // no-data cells come back as huge negatives
}
function dtmAt(e,n){
  for (const g of allLidar()){ const z=sampleGrid(g, e, n); if (z!=null) return z; }   // outside the tiles: fall back to 5 m
  return dtm5At(e,n);
}

// ---- build -------------------------------------------------------------------------------------------
async function build(){
  if (!proj){ note('build-note','Load a dataset first.','err'); return; }
  if (!boundary){ note('build-note','Draw the site boundary first (step 2).','err'); return; }
  const holes=usedHoles();
  if (!holes.length){ note('build-note','No logged boreholes to build from.','err'); return; }
  $('build').disabled=true;
  try {
    let top=topMode(), msg='';
    if (top==='dtm'){
      note('build-note','Fetching the Lands Dept ground model…');
      const [ok5]=await Promise.all([prefetchDtm(), fetchHostedLidar()]);
      const L=allLidar(), cell=Math.min(...L.map(g=>g.dx));
      if (!ok5 && !L.length){ top='bh'; msg=' Ground model unavailable here — used borehole ground levels instead.'; }
      else if (L.length){
        const hit=boundary.filter(p=>L.some(g=>sampleGrid(g, p[0], p[1])!=null)).length;
        msg = hit===boundary.length ? ` Ground: ${cell} m LiDAR (CEDD 2020).`
            : hit ? ` Ground: ${cell} m LiDAR where it reaches, the 5 m model elsewhere.`
            : lidar.length ? ' Your LiDAR tiles do not reach this boundary — used the 5 m model.' : '';
      }
    }
    note('build-note','Building the block…');
    await new Promise(r=>setTimeout(r,20));            // let the message paint
    const baseIn=$('base').value.trim();
    model=makeModel(holes, { top, dtmAt, base: baseIn==='' ? defaultBase(holes) : +baseIn });
    block=buildBlock(model, boundary, { maxCells:+$('detail').value });
    const xs=boundary.map(p=>p[0]), ys=boundary.map(p=>p[1]);
    const e0=(Math.min(...xs)+Math.max(...xs))/2, n0=(Math.min(...ys)+Math.max(...ys))/2;
    O={ e:e0, n:n0, z:Math.round(model.at(e0,n0)[0]) };
    renderLegend();
    await showBlock();
    note('build-note',`✓ ${model.keys.length} layer(s), ${(block.tris.length/3).toLocaleString()} triangles, base ${model.base} mPD.`+msg,'ok');
    showTab('block');
  } catch(err){ console.error(err); note('build-note','✗ '+(err?.message||err),'err'); }
  finally { $('build').disabled=false; }
}
function renderLegend(){
  const el=$('legend'); el.innerHTML='';
  model.keys.forEach((k,i)=>{
    const d=document.createElement('div');
    d.innerHTML=`<input type="checkbox" checked data-k="${i}" style="width:auto"><span class="sw" style="background:${model.colour[k]}"></span>${esc(model.label[k])}`;
    d.querySelector('input').addEventListener('change', e=>{
      const m=T && T.blockG.children.find(o=>o.userData.k===i); if (m) m.visible=e.target.checked;
    });
    el.appendChild(d);
  });
}

// ---- three.js scene -------------------------------------------------------------------------------
let T=null, meshLevelled=false;
async function ensure3D(){
  if (T) return T;
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const { TransformControls } = await import('three/addons/controls/TransformControls.js');
  const el=$('view3d');
  const renderer=new THREE.WebGLRenderer({ antialias:true, alpha:true });   // alpha: the CSS sky gradient shows through
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.localClippingEnabled=true;
  renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  el.prepend(renderer.domElement);
  const scene=new THREE.Scene();
  // Orthographic: no perspective distortion, so the top view is a true plan.
  // The frustum is sized in resize() from T.half (half the view height, m).
  const camera=new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30000);
  const controls=new OrbitControls(camera, renderer.domElement);
  controls.enableDamping=true; controls.screenSpacePanning=true;
  // white sky with an olive bounce off the ground, and a warm low sun with soft shadows
  scene.add(new THREE.HemisphereLight('#ffffff', '#747e61', 1.7));
  const sun=new THREE.DirectionalLight('#fff7e7', 2.1); sun.castShadow=true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias=-0.00012; sun.shadow.normalBias=0.12;
  scene.add(sun);
  const world=new THREE.Group(); scene.add(world);
  const blockG=new THREE.Group(), capG=new THREE.Group(), holeG=new THREE.Group(), terrG=new THREE.Group(), bldG=new THREE.Group(), infraG=new THREE.Group(), structG=new THREE.Group();
  world.add(blockG, capG, holeG, terrG, bldG, infraG, structG);
  const clip=new THREE.Plane(new THREE.Vector3(1,0,0), 0);
  // Slice handle: an arrow to push the cut along, a ring to turn it. Both drive the
  // same invisible object; onHandle() turns its pose back into the two sliders.
  const handle=new THREE.Object3D(); scene.add(handle);
  const gizmos=['translate','rotate'].map(mode=>{
    const tc=new TransformControls(camera, renderer.domElement);
    tc.setMode(mode); tc.setSpace('local'); tc.setSize(0.9); tc.attach(handle);
    tc.showZ=false; tc[mode==='translate' ? 'showY' : 'showX']=false;   // arrow = local X (the cut's normal), ring = vertical axis
    tc.addEventListener('dragging-changed', e=>{
      controls.enabled=!e.value; T.dragging=e.value;
      for (const o of T.gizmos) if (o!==tc) o.enabled=!e.value;         // arrow and ring overlap: only the one grabbed first moves
      if (e.value) T.flip0=$('sl-flip').checked; else updateSlice();    // on release: snap the handle to the slider values
    });
    tc.addEventListener('objectChange', onHandle);
    const helper=tc.getHelper(); helper.visible=false; tc.enabled=false; scene.add(helper);
    return tc;
  });
  T={ THREE, renderer, scene, camera, controls, sun, world, blockG, capG, holeG, terrG, bldG, infraG, structG, clip, handle, gizmos,
      half:100, span:100, topY:0, dragging:false, flip0:false, tiles:null };
  const resize=()=>{
    const w=el.clientWidth, h=el.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h);
    camera.left=-T.half*w/h; camera.right=T.half*w/h; camera.top=T.half; camera.bottom=-T.half; camera.updateProjectionMatrix();
    if (T.tiles) T.tiles.setResolutionFromRenderer(camera, renderer);
  };
  T.resize=resize;
  new ResizeObserver(resize).observe(el); resize();
  renderer.setAnimationLoop(()=>{
    if (!el.clientWidth) return;                    // tab hidden: don't render or stream tiles
    controls.update();
    $('north').style.transform=`rotate(${controls.getAzimuthalAngle()}rad)`;   // scene north is -z
    camera.updateMatrixWorld();
    if (T.tiles && T.tiles.group.visible) T.tiles.update();
    renderer.render(scene, camera);
  });
  return T;
}
// Local testing only: lets a test script reach the scene (camera, groups) from the console.
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__geo3d=()=>T;
function disposeGroup(g){
  for (const o of [...g.children]){ g.remove(o); o.geometry?.dispose(); o.material?.dispose?.(); }
}
function clearScene(){ if (T){ for (const g of [T.blockG, T.capG, T.holeG, T.terrG, T.bldG, T.infraG, T.structG]) disposeGroup(g); bldKey=infraKey=null; prisms=[]; decks=[]; } }

const P = (e,n,z) => [e-O.e, z-O.z, -(n-O.n)];      // HK1980 + mPD -> scene

async function showBlock(){
  const { THREE, blockG, holeG, terrG, world, camera, controls, clip, sun }=await ensure3D();
  clearScene();
  world.scale.y=vex();
  const { xy, z, tris, ring, ringZ, nH }=block, V=xy.length/2, R=ring.length, nS=nH-1;
  const thick=(arr,v,k)=>arr[v*nH+k]-arr[v*nH+k+1] > 1e-3;
  for (let k=0;k<nS;k++){
    const pos=[], idx=[];
    for (let v=0; v<V; v++) pos.push(...P(xy[2*v], xy[2*v+1], z[v*nH+k]));
    for (let t=0;t<tris.length;t+=3){
      const a=tris[t], b=tris[t+1], c=tris[t+2];
      // where this layer is absent its top IS the next layer's top — skip, or the colours flicker
      if (thick(z,a,k) || thick(z,b,k) || thick(z,c,k)) idx.push(a,b,c);
    }
    for (let i=0;i<R;i++){                          // side walls between horizon k and k+1
      const j=(i+1)%R;
      if (!thick(ringZ,i,k) && !thick(ringZ,j,k)) continue;
      const s=pos.length/3;
      pos.push(...P(ring[i][0],ring[i][1],ringZ[i*nH+k]), ...P(ring[j][0],ring[j][1],ringZ[j*nH+k]),
               ...P(ring[j][0],ring[j][1],ringZ[j*nH+k+1]), ...P(ring[i][0],ring[i][1],ringZ[i*nH+k+1]));
      idx.push(s,s+1,s+2, s,s+2,s+3);
    }
    if (k===nS-1){                                  // block base
      const s=pos.length/3;
      for (let v=0; v<V; v++) pos.push(...P(xy[2*v], xy[2*v+1], z[v*nH+nS]));
      for (let t=0;t<tris.length;t+=3) idx.push(s+tris[t], s+tris[t+2], s+tris[t+1]);
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    g.computeVertexNormals();
    const m=new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color:new THREE.Color(cssColour(model.colour[model.keys[k]])),
      // Depth ties only (a pinched-out layer shares its top with the one below): push deeper layers
      // back by a fixed hair. NOT slope-scaled: a factor pulled steep or edge-on deep layers in front
      // of the terrain and of the cut face.
      side:THREE.DoubleSide, clippingPlanes:[clip], polygonOffset:true, polygonOffsetFactor:0, polygonOffsetUnits:k+1 }));
    m.userData.k=k;
    m.visible=!!$('legend').querySelector(`input[data-k="${k}"]`)?.checked;
    blockG.add(m);
  }
  // boreholes: one short cylinder per logged layer, coloured like the log
  for (const b of usedHoles()){
    for (const l of b.layers){
      const h=Math.max(0.05, l.base-l.top);
      const c=new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, h, 8),
        new THREE.MeshLambertMaterial({ color:new THREE.Color(cssColour(classColour(l))), clippingPlanes:[clip] }));
      c.position.set(...P(b.x, b.y, b.gl-(l.top+l.base)/2));
      holeG.add(c);
    }
  }
  holeG.visible=$('holes-on').checked;
  // terrain skin: the block's own top surface in one sage colour, so the top reads as
  // ground and only the sides / the cut show geology. 3 cm up + polygonOffset wins the z-fight.
  let zTop=-Infinity;
  const tp=[];
  for (let v=0; v<V; v++){ zTop=Math.max(zTop, z[v*nH]); tp.push(...P(xy[2*v], xy[2*v+1], z[v*nH]+0.03)); }
  T.topY=zTop-O.z;
  const tg=new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3)); tg.setIndex([...tris]);
  tg.computeVertexNormals();
  const skinMat=new THREE.MeshLambertMaterial({ color:LOOK.terrain, side:THREE.DoubleSide, flatShading:true,
    clippingPlanes:[clip] });   // 3 cm above the top layer is enough: the orthographic depth buffer is linear
  // Contours are drawn by the surface's own shader (darken the pixels within ~1 px of
  // every CONTOUR_M of level). Separate line geometry lost the depth fight against the
  // polygon-offset skin on steep ground; this cannot, and the lines stay 1 px wide at any zoom.
  const z0=O.z.toFixed(2), step=CONTOUR_M.toFixed(1);
  skinMat.onBeforeCompile=sh=>{
    sh.vertexShader=sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vH;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvH=position.y;');     // y = mPD − ZREF, before exaggeration
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vH;')
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float h=(vH+${z0})/${step};
        float d=abs(fract(h-0.5)-0.5)/fwidth(h);            // pixels to the nearest contour level
        gl_FragColor.rgb=mix(${LOOK.contour}, gl_FragColor.rgb, 0.35+0.65*smoothstep(0.5,1.5,d));`);
  };
  const skin=new THREE.Mesh(tg, skinMat);
  skin.receiveShadow=true;
  terrG.add(skin);
  terrG.visible=$('terr-on').checked;
  // camera: looking at the block from the south-west, a little above
  const xs=boundary.map(p=>p[0]), ys=boundary.map(p=>p[1]);
  const span=Math.max(40, Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys));
  const midZ=((O.z+model.base)/2-O.z)*vex();
  T.span=span; T.half=span*0.8; camera.zoom=1;
  controls.target.set(0, midZ, 0);
  camera.position.set(-span*2.8, midZ+span*3.2, span*3.6);   // orthographic: distance only has to clear the model
  camera.near=0.1; camera.far=span*30;
  T.resize();
  sun.position.set(-span*1.2, span*2.4, span*0.6);
  Object.assign(sun.shadow.camera, { left:-span*1.5, right:span*1.5, top:span*1.5, bottom:-span*1.5, near:1, far:span*8 });
  sun.shadow.camera.updateProjectionMatrix();
  updateSlice();
  setMesh();
  setBuildings();
  setInfra();
  updateStructure();
  $('exp-view').disabled=$('exp-glb').disabled=false;
}
// "hsl(…)" palette entries and hex both go through a canvas so THREE.Color gets plain hex
const _cx=document.createElement('canvas').getContext('2d');
function cssColour(c){ _cx.fillStyle='#000'; _cx.fillStyle=c; return _cx.fillStyle; }

// ---- white building blocks ---------------------------------------------------------------
// Outlines + roof levels from the Lands Dept building map, pushed up as plain chalk
// blocks (an architect's card model). Each outline is trimmed to the boundary, so a
// building on the edge is sliced flush with the block's side and nothing stands outside it.
let bldKey=null;                       // what the current blocks were built for
let prisms=[];                         // [{ rings:[outline, ...courtyards], base(e,n), top(e,n) }] of the drawn buildings
// One solid: a roof over the outline (courtyards cut out) and walls down to the base. `top` and
// `base` give the level at a point, so a sloping bridge deck is built by the same code as a flat roof.
// Outlines must be anticlockwise and courtyards clockwise: every face then points outwards.
function addPrism(pos, idx, rings, top, base){
  const { THREE }=T, all=rings.flat(), v2=r=>r.map(p=>new THREE.Vector2(p[0],p[1]));
  const s0=pos.length/3;
  for (const p of all) pos.push(...P(p[0],p[1],top(p[0],p[1])));
  for (const t of THREE.ShapeUtils.triangulateShape(v2(rings[0]), rings.slice(1).map(v2))){
    const up=polyArea(t.map(i=>all[i]))>0;                                               // anticlockwise from above = facing up
    idx.push(s0+t[0], s0+t[up?1:2], s0+t[up?2:1]);
  }
  for (const r of rings) for (let i=0;i<r.length;i++){                                     // walls (own corners -> crisp edges)
    const a=r[i], b=r[(i+1)%r.length], s=pos.length/3;
    pos.push(...P(a[0],a[1],top(a[0],a[1])), ...P(b[0],b[1],top(b[0],b[1])), ...P(b[0],b[1],base(b[0],b[1])), ...P(a[0],a[1],base(a[0],a[1])));
    idx.push(s,s+2,s+1, s,s+3,s+2);
  }
}
const wind=(r,s)=>Math.sign(polyArea(r))===s ? r : [...r].reverse();
async function setBuildings(){
  if (!T || !model || !boundary) return;
  const on=$('bld-on').checked;
  T.bldG.visible=on;
  const key=JSON.stringify(boundary)+model.base+topMode();
  if (!on || bldKey===key) return;
  bldKey=key;
  try {
    const xs=boundary.map(p=>p[0]), ys=boundary.map(p=>p[1]);
    const q=new URLSearchParams({ where:'1=1', geometryType:'esriGeometryEnvelope', inSR:2326, outSR:2326,
      geometry:[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)].join(','),
      spatialRel:'esriSpatialRelIntersects', outFields:'BaseHeight,TopHeight', f:'json' });
    // A slow or blocked government server must not hang the page: give up after 20 s.
    const res=await fetch(BLD_URL+'?'+q, { signal:AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const feats=(await res.json()).features||[];
    if (bldKey!==key) return;                              // boundary changed while waiting
    const { THREE, bldG, clip }=T;
    disposeGroup(bldG);
    prisms=[];
    const pos=[], idx=[]; let n=0;
    for (const f of feats){
      const top=f.attributes.TopHeight;
      if (!Number.isFinite(top) || !f.geometry?.rings) continue;
      for (const shape of ringsToShapes(f.geometry.rings)){
        const holes=shape.holes.flatMap(h=>clipToPoly(h, boundary)).map(h=>wind(h,-1));
        for (const outer of clipToPoly(shape.outer, boundary).map(o=>wind(o,1))){
          // foot: the lowest ground under the outline (or the surveyed base if lower), sunk 0.3 m so no gap shows on a slope
          const ground=outer.map(p=>model.at(p[0],p[1])[0]);
          const base=Math.min(...ground, Number.isFinite(f.attributes.BaseHeight) ? f.attributes.BaseHeight : Infinity)-0.3;
          if (top-base<1) continue;
          const mine=holes.filter(h=>pointInPoly(h[0][0], h[0][1], outer));   // a concave boundary gives several pieces
          addPrism(pos, idx, [outer, ...mine], ()=>top, ()=>base);
          prisms.push({ rings:[outer, ...mine], base:()=>base, top:()=>top });
          n++;
        }
      }
    }
    if (n){
      const g=new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
      g.computeVertexNormals();
      const m=new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color:LOOK.building, flatShading:true, clippingPlanes:[clip],
        polygonOffset:true, polygonOffsetFactor:0, polygonOffsetUnits:40 }));   // see biasBuildings()
      m.castShadow=true; m.receiveShadow=true;
      bldG.add(m);
      biasBuildings();
      bldG.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 25),
        new THREE.LineBasicMaterial({ color:LOOK.edge, transparent:true, opacity:0.55, clippingPlanes:[clip] })));
    }
    prismCaps();
    viewNote('bld', n ? `${n} building(s) drawn from the Lands Dept building map (outline + roof level).`
                      : 'No mapped buildings inside this boundary.');
  } catch(err){
    bldKey=null;                                             // let the next toggle retry
    console.error(err); viewNote('bld', '✗ Could not load the building outlines: '+(err?.message||err), true);
  }
}

// ---- roads and bridges -------------------------------------------------------------------
// Bridges, flyovers and footbridges: Highways Dept outlines. They carry no level, so the deck
// comes from the Lands Dept 5 m ground model, which (unlike the bare-earth LiDAR) includes
// elevated roads. Roads on the ground: Lands Dept centre lines widened to ROAD_W and laid on
// the block's ground. Everything is trimmed to the boundary, like the buildings.
const DECK_T=1.5, DECK_MIN=2, ROAD_UP=0.12;   // m: deck thickness; lower than this above ground it is drawn on the ground; road lift
let infraKey=null, decks=[];                   // decks: prisms of the drawn bridges, for the cut faces
async function esriQuery(url, box, outFields){
  const q=new URLSearchParams({ where:'1=1', geometryType:'esriGeometryEnvelope', inSR:2326, outSR:2326, geometry:box.join(','),
    spatialRel:'esriSpatialRelIntersects', outFields, f:'json' });
  const res=await fetch(url+'?'+q, { signal:AbortSignal.timeout(20000) });   // a slow government server must not hang the page
  if (!res.ok) throw new Error('HTTP '+res.status);
  return (await res.json()).features || [];
}
// Deck level under a structure outline. The 5 m model is coarse and blends deck with ground at
// the deck's edges, so each point takes the upper-quartile level of the samples within 12 m of it.
// ponytail: good to a few metres (the 5 m model is +/-5 m); a surveyed deck level would replace this.
function deckLevel(outer){
  const xs=outer.map(p=>p[0]), ys=outer.map(p=>p[1]), S=[];
  const add=(e,n)=>{ const z=dtm5At(e,n); if (z!=null) S.push([e,n,z]); };
  for (const p of outer) add(p[0],p[1]);
  for (let e=Math.min(...xs); e<=Math.max(...xs); e+=5) for (let n=Math.min(...ys); n<=Math.max(...ys); n+=5) if (pointInPoly(e,n,outer)) add(e,n);
  return (e,n)=>{
    let near=S.filter(s=>Math.hypot(s[0]-e, s[1]-n)<=12);
    if (!near.length) near=S;
    if (!near.length) return null;
    const z=near.map(s=>s[2]).sort((a,b)=>a-b);
    return z[Math.floor(0.75*(z.length-1))];
  };
}
async function setInfra(){
  if (!T || !model || !boundary) return;
  const on=$('infra-on').checked;
  T.infraG.visible=on;
  const key=JSON.stringify(boundary)+model.base+topMode();
  if (!on || infraKey===key) return;
  infraKey=key;
  try {
    const xs=boundary.map(p=>p[0]), ys=boundary.map(p=>p[1]);
    const box=[Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const [structs, fbs, roads]=await Promise.all([
      esriQuery(STRUCT_URLS[0], box, 'STR_NO'), esriQuery(STRUCT_URLS[1], box, 'STR_NO'), esriQuery(ROAD_URL, box, 'STREETTYPE'),
      prefetchDtm().catch(()=>false) ]);                       // the 5 m model, even when the block follows borehole levels
    if (infraKey!==key) return;                                // boundary changed while waiting
    const { THREE, infraG, clip }=T;
    disposeGroup(infraG); decks=[];
    const ground=(e,n)=>model.at(e,n)[0];
    // -- bridges
    const pos=[], idx=[], footprints=[]; let nB=0;
    for (const f of [...structs, ...fbs]){
      if (!f.geometry?.rings) continue;
      for (const shape of ringsToShapes(f.geometry.rings)){
        footprints.push(shape.outer);
        const deck=deckLevel(shape.outer);
        const holes=shape.holes.flatMap(h=>clipToPoly(h, boundary)).map(h=>wind(h,-1));
        for (const outer of clipToPoly(shape.outer, boundary).map(o=>wind(o,1))){
          // raised well clear of the ground: a slab at deck level. Otherwise a slab sitting on the ground.
          const top=(e,n)=>{ const g=ground(e,n), d=deck(e,n); return d!=null && d-g>=DECK_MIN ? d : g+0.3; };
          const base=(e,n)=>{ const g=ground(e,n), d=deck(e,n); return d!=null && d-g>=DECK_MIN ? d-DECK_T : g-0.3; };
          const mine=holes.filter(h=>pointInPoly(h[0][0], h[0][1], outer));
          addPrism(pos, idx, [outer, ...mine], top, base);
          decks.push({ rings:[outer, ...mine], top, base });
          nB++;
        }
      }
    }
    const lit=()=>new THREE.MeshLambertMaterial({ color:LOOK.building, flatShading:true, side:THREE.DoubleSide, clippingPlanes:[clip] });
    if (nB){
      const g=new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
      g.computeVertexNormals();
      const m=new THREE.Mesh(g, lit()); m.castShadow=true; m.receiveShadow=true;
      infraG.add(m, new THREE.LineSegments(new THREE.EdgesGeometry(g, 25),
        new THREE.LineBasicMaterial({ color:LOOK.edge, transparent:true, opacity:0.55, clippingPlanes:[clip] })));
    }
    // -- roads on the ground (a stretch that runs over a bridge is the bridge's, not the ground's)
    const rp=[], ri=[]; let nR=0;
    for (const f of roads){
      const w=ROAD_W[f.attributes.STREETTYPE];
      if (!w || !f.geometry?.paths) continue;
      let any=false;
      for (const path of f.geometry.paths) for (const quad of ribbon(path, w)){
        const ce=(quad[0][0]+quad[2][0])/2, cn=(quad[0][1]+quad[2][1])/2;
        if (footprints.some(o=>pointInPoly(ce, cn, o))) continue;
        for (const piece of clipToPoly(quad, boundary)){
          const s0=rp.length/3;
          for (const p of piece) rp.push(...P(p[0], p[1], ground(p[0],p[1])+ROAD_UP));
          for (let i=1;i+1<piece.length;i++) ri.push(s0, s0+i, s0+i+1);          // convex piece: a fan
          any=true;
        }
      }
      if (any) nR++;
    }
    if (ri.length){
      const g=new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); g.setIndex(ri);
      g.computeVertexNormals();
      // a flat strip across 0.5 m LiDAR ground dips under it here and there: let the road win depth ties within ~0.6 m
      const mat=lit(); mat.polygonOffset=true; mat.polygonOffsetFactor=0; mat.polygonOffsetUnits=photoUnits()*0.3;
      const m=new THREE.Mesh(g, mat); m.receiveShadow=true;
      infraG.add(m);
    }
    prismCaps();
    viewNote('infra', nR||nB ? `${nR} road(s) and ${nB} bridge / footbridge piece(s) drawn (Lands Dept centre lines at typical widths; Highways Dept structure outlines, deck level from the 5 m ground model).`
                             : 'No mapped roads or bridges inside this boundary.');
  } catch(err){
    infraKey=null;                                             // let the next toggle retry
    console.error(err); viewNote('infra', '✗ Could not load the roads and bridges: '+(err?.message||err), true);
  }
}
// The buildings and the roads each report under the 3D view: show both lines, not whichever came last.
const viewNotes={};
function viewNote(key, msg, bad){
  viewNotes[key]={ msg, bad };
  const all=Object.values(viewNotes);
  note('view-note', all.map(v=>v.msg).join(' '), all.some(v=>v.bad) ? 'err' : 'ok');
}

// A building is an empty shell. Where the section cut passes through one, close it with a
// solid white face: the cut line crosses the outline at an even number of points, and each
// pair in turn bounds a stretch that is inside the building (courtyards included, even-odd).
function prismCaps(){
  if (!T) return;
  const { THREE, capG }=T;
  for (const o of [...capG.children]) if (o.userData.prism){ capG.remove(o); o.geometry.dispose(); o.material.dispose(); }
  if (!slice || !$('sl-on').checked) return;
  const L=2*slice.half, A=[slice.A.e, slice.A.n], u=[(slice.B.e-slice.A.e)/L, (slice.B.n-slice.A.n)/L];
  const faces=(list, colour, units)=>{
    const pos=[], idx=[], edge=[];
    for (const { rings, base, top } of list) for (const [t0,t1] of lineSpans(rings, A, u)){
      const at=t=>[A[0]+u[0]*t, A[1]+u[1]*t], a=at(t0), b=at(t1);
      const q=[[a,top],[b,top],[b,base],[a,base]].map(([p,z])=>P(p[0], p[1], z(p[0],p[1])));
      const s0=pos.length/3;
      pos.push(...q.flat()); idx.push(s0,s0+1,s0+2, s0,s0+2,s0+3);
      for (let k=0;k<4;k++) edge.push(...q[k], ...q[(k+1)%4]);
    }
    if (!pos.length) return;
    const g=new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const m=new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color:colour, side:THREE.DoubleSide,
      polygonOffset:true, polygonOffsetFactor:0, polygonOffsetUnits:units }));
    const l=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(edge, 3)),
      new THREE.LineBasicMaterial({ color:LOOK.edge }));
    m.userData.prism=l.userData.prism=true;
    capG.add(m, l);
  };
  // Below ground a building's face is flush with the geology's own cut face: pushed back a hair, so the soil wins there.
  faces([...($('bld-on').checked ? prisms : []), ...($('infra-on').checked ? decks : [])], LOOK.building, 40);
  // The proposed structure is the opposite: it replaces the ground it is dug into, so it is pulled in front of the soil.
  const st=structure();
  if (st) faces([{ rings:[footprint(st)], top:()=>st.found+st.height, base:()=>st.found }], LOOK.structure, -40);
}

// ---- proposed structure ----------------------------------------------------------------------------------------
// A box the user places on the site (see structure.js). Drawn on the map, in the 3D view (cut with
// the block, like everything else), on the section, and costed as dig / fill against the ground model.
function structure(){
  if (!$('st-on').checked) return null;
  const s=Object.fromEntries(ST_IDS.map(id=>[id.slice(3), $(id).value===''?NaN:+$(id).value]));
  return Object.values(s).every(Number.isFinite) && s.len>0 && s.wid>0 && s.height>0 ? s : null;
}
// First switch-on: a sensible box in the middle of the site, founded 3 m into the ground there.
function defaultStructure(){
  if (!boundary) return;
  const xs=boundary.map(p=>p[0]), ys=boundary.map(p=>p[1]);
  const e=(Math.min(...xs)+Math.max(...xs))/2, n=(Math.min(...ys)+Math.max(...ys))/2;
  const span=Math.min(Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys));
  const g=model ? model.at(e,n)[0] : (usedHoles()[0]?.gl ?? 0);
  const set=(id,v)=>{ $(id).value=v; };
  set('st-e', e.toFixed(1)); set('st-n', n.toFixed(1));
  if ($('st-len').value==='') set('st-len', Math.max(6, Math.round(span*0.3)));
  if ($('st-wid').value==='') set('st-wid', Math.max(4, Math.round(span*0.18)));
  if ($('st-found').value==='') set('st-found', Math.round(g-3));
  if ($('st-height').value==='') set('st-height', 12);
}
function drawStructureOnMap(keepPin){
  if (!stLayer) return;
  const st=structure();
  for (const l of stLayer.getLayers()) if (!(keepPin && l.options.draggable)) stLayer.removeLayer(l);
  if (!st) return;
  L.polygon(footprint(st).map(p=>toLL(p[0],p[1])), { color:LOOK.structure, weight:2.5, fillColor:LOOK.structure, fillOpacity:.35 }).addTo(stLayer);
  if (keepPin) return;                                          // mid-drag: the pin is under the user's finger, leave it
  L.marker(toLL(st.e, st.n), { draggable:true, title:'Drag to move the proposed structure' })
    .on('drag', e=>{ const [x,y]=fromLL(e.latlng.lat, e.latlng.lng); $('st-e').value=x.toFixed(1); $('st-n').value=y.toFixed(1); updateStructure(true); })
    .on('dragend', ()=>updateStructure())
    .addTo(stLayer);
}
function drawStructure3D(){
  if (!T) return;
  const { THREE, structG, clip }=T;
  disposeGroup(structG);
  const st=structure();
  if (!st || !model) return;
  const fp=footprint(st), top=st.found+st.height, pos=[], idx=[];
  addPrism(pos, idx, [fp], ()=>top, ()=>st.found);
  const s0=pos.length/3;                                        // underside, so a box above the ground is closed
  for (const p of fp) pos.push(...P(p[0], p[1], st.found));
  idx.push(s0,s0+2,s0+1, s0,s0+3,s0+2);
  const g=new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.computeVertexNormals();
  const m=new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color:LOOK.structure, flatShading:true, side:THREE.DoubleSide, clippingPlanes:[clip] }));
  m.castShadow=true; m.receiveShadow=true;
  structG.add(m, new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), new THREE.LineBasicMaterial({ color:'#5c2b10', clippingPlanes:[clip] })));
  // Its outline on the ground, so a structure that is wholly below ground still shows where it is.
  const line=[];
  for (let i=0;i<4;i++){
    const a=fp[i], b=fp[(i+1)%4], n=Math.max(1, Math.ceil(Math.hypot(b[0]-a[0], b[1]-a[1])/2));
    for (let k=0;k<n;k++) for (const f of [k/n, (k+1)/n]){ const x=a[0]+(b[0]-a[0])*f, y=a[1]+(b[1]-a[1])*f; line.push(...P(x, y, model.at(x,y)[0]+0.4)); }
  }
  structG.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(line, 3)),
    new THREE.LineBasicMaterial({ color:LOOK.structure, clippingPlanes:[clip] })));
}
const m3=v=>Math.round(v).toLocaleString()+' m³';
function structureReport(){
  const out=$('st-out'), st=structure();
  out.style.display = $('st-on').checked ? 'block' : 'none';
  out.className='status';
  if (!$('st-on').checked){ tellHeight(); return; }
  if (!st){ out.textContent='Fill in every box above (length, width and height must be more than 0).'; tellHeight(); return; }
  if (!model){ out.textContent='Build the 3D block to see the ground under the structure and the earthworks.'; tellHeight(); return; }
  const w=earthworks(st, model.at, model.keys.length, (e,n)=>pointInPoly(e,n,boundary));
  if (!w.area){ out.className='status err'; out.textContent='The structure is outside the site boundary. Move it onto the site, or redraw the boundary around it.'; tellHeight(); return; }
  const sw=k=>`<span class="sw" style="background:${model.colour[k]}"></span>`;
  const row=(a,b)=>`<tr><td>${a}</td><td>${b}</td></tr>`;
  let h=`<table>`+
    row('Plan size', `${st.len} × ${st.wid} m = ${Math.round(st.len*st.wid).toLocaleString()} m²`)+
    row('Top level', `${(st.found+st.height).toFixed(1)} mPD`)+
    row('Existing ground under it', `${w.gMin.toFixed(1)} to ${w.gMax.toFixed(1)} mPD`)+
    row('<b>Dig out (excavation)</b>', `<b>${m3(w.cut)}</b>`)+
    row('<b>Fill up to founding level</b>', `<b>${m3(w.fill)}</b>`);
  if (w.cut>0.5){
    h+=`<tr><td colspan="2" class="h">Dug from each layer</td></tr>`;
    model.keys.forEach((k,i)=>{ if (w.cutByLayer[i]>0.5) h+=row(sw(k)+esc(model.label[k]), m3(w.cutByLayer[i])); });
  }
  h+=`<tr><td colspan="2" class="h">Ground at the founding level (${st.found} mPD)</td></tr>`;
  model.keys.forEach((k,i)=>{ if (w.atFound[i]>0.005) h+=row(sw(k)+esc(model.label[k]), Math.round(w.atFound[i]*100)+'%'); });
  if (w.atFound.air>0.005) h+=row('Above the ground (needs fill)', Math.round(w.atFound.air*100)+'%');
  h+=`</table><div class="hint" style="margin:6px 0 0">Volumes assume vertical sides straight below the footprint: no side slopes, working space or bulking.`+
    (w.covered<0.995 ? ` Only the ${Math.round(w.covered*100)}% of the footprint inside the site boundary is counted.` : '')+
    (w.belowBase ? ` The founding level is below the block's base (${model.base} mPD) in places; the deepest layer is assumed there.` : '')+`</div>`;
  out.innerHTML=h;
  tellHeight();
}
function updateStructure(dragging){
  syncLabels();
  $('st-form').style.display=$('st-on').checked ? '' : 'none';
  drawStructureOnMap(dragging===true);
  drawStructure3D();
  prismCaps();
  renderSection();
  structureReport();
}

// ---- export the 3D view ------------------------------------------------------------------------------------------
function exportView(){
  if (!T) return;
  const { renderer, scene, camera, gizmos }=T;
  const shown=gizmos.map(g=>g.getHelper().visible);
  gizmos.forEach(g=>{ g.getHelper().visible=false; });          // the slice handle is a control, not part of the picture
  renderer.render(scene, camera);                               // the canvas only holds a frame until the browser next paints: read it now
  // the 3D canvas is see-through (the page's sky colour shows behind it): paint it onto a solid background for the file
  const src=renderer.domElement, c=document.createElement('canvas'); c.width=src.width; c.height=src.height;
  const g=c.getContext('2d'); g.fillStyle='#e9ece4'; g.fillRect(0,0,c.width,c.height); g.drawImage(src,0,0);
  c.toBlob(b=>download(`block3d_view_${new Date().toISOString().slice(0,10)}.png`, b));
  gizmos.forEach((g,i)=>{ g.getHelper().visible=shown[i]; });
}
async function exportGLB(){
  if (!T || !model) return;
  try {
    const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
    const { THREE }=T;
    // The whole block at true scale (no vertical exaggeration, no cut: the cut is a view setting). Metres; y is up;
    // the origin is the site centre at ground level. The photo map is not included.
    const root=new THREE.Group(); root.name='GeoVisualise block';
    for (const [name, g] of [['geology', T.blockG], ['terrain', T.terrG], ['buildings', T.bldG], ['roads_bridges', T.infraG], ['proposed_structure', T.structG], ['boreholes', T.holeG]])
      if (g.visible && g.children.length){ const c=g.clone(); c.name=name; root.add(c); }
    const buf=await new GLTFExporter().parseAsync(root, { binary:true, onlyVisible:true });
    download(`block3d_${new Date().toISOString().slice(0,10)}.glb`, new Blob([buf], { type:'model/gltf-binary' }));
  } catch(err){ console.error(err); viewNote('export', '✗ Could not write the 3D model: '+(err?.message||err), true); }
}

// ---- Lands Dept 3D photo-mesh ----------------------------------------------------------------------------
async function ensureTiles(){
  if (T.tiles) return T.tiles;
  const { THREE, renderer, camera, world, clip }=T;
  const { TilesRenderer } = await import('3d-tiles-renderer/three');
  const { GLTFExtensionsPlugin } = await import('3d-tiles-renderer/three/plugins');
  const { KTX2Loader } = await import('three/addons/loaders/KTX2Loader.js');
  const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
  const tiles=new TilesRenderer(LANDSD_3D);
  // LandsD tile names contain '+', which the server reads as a space unless escaped (404s otherwise)
  tiles.registerPlugin({ name:'LANDSD_PLUS', preprocessURL: url => url.replace(/\+/g, '%2B') });
  const ktx=new KTX2Loader().setTranscoderPath(THREE_LIBS+'basis/').detectSupport(renderer);
  tiles.registerPlugin(new GLTFExtensionsPlugin({ ktxLoader:ktx,
    dracoLoader: new DRACOLoader().setDecoderPath(THREE_LIBS+'draco/gltf/'),
    plugins:[ parser => new KTX2ImagePlugin(parser, ktx) ] }));
  tiles.errorTarget=6;
  tiles.setCamera(camera); tiles.setResolutionFromRenderer(camera, renderer);
  tiles.group.matrixAutoUpdate=false;
  tiles.addEventListener('load-model', ({ scene })=>{ styleMesh(scene); flattenTile(scene); });
  tiles.addEventListener('tiles-load-end', ()=>{ if (!meshLevelled) autoLevel(); });
  tiles.addEventListener('load-error', e=>console.warn('[3d tiles]', e.url, e.error));
  world.add(tiles.group);
  T.tiles=tiles;
  return tiles;
}
// LandsD photo-mesh textures are KTX2 images referenced WITHOUT the KHR_texture_basisu
// extension (image.mimeType 'image/ktx2' straight on the texture source), so three's
// GLTFLoader hands them to the browser's image decoder and they come out blank.
// This glTF loader plugin routes those images through the KTX2 loader instead.
class KTX2ImagePlugin {
  constructor(parser, ktx){ this.parser=parser; this.ktx=ktx; this.name='LANDSD_KTX2_IMAGE'; }
  loadTexture(i){
    const json=this.parser.json, src=json.textures[i].source;
    if (json.images[src]?.mimeType!=='image/ktx2') return null;
    return this.parser.loadTextureImage(i, src, this.ktx);
  }
}
const photoUnits=()=>-Math.round(PHOTO_BIAS/((T.camera.far-T.camera.near)/2**24));
// Buildings normally lose depth ties (a trimmed wall is flush with the block's side below ground:
// the soil wins). Under the photo map they must instead stay in front of the photo's margin.
function biasBuildings(){
  const photo=$('mesh-on').checked;
  for (const o of T.bldG.children) if (o.material.polygonOffset){ o.material.polygonOffsetUnits=photo ? photoUnits()*1.5 : 40; }
}
function styleMesh(root){
  const op=+$('mesh-op').value;
  root.traverse(o=>{
    if (!o.material) return;
    // the tiles ask for KHR_materials_unlit (the photo already has the light baked in);
    // swap any lit material for an unlit one, or our scene lights darken it twice
    if (!o.material.isMeshBasicMaterial){
      const old=o.material;
      o.material=new T.THREE.MeshBasicMaterial({ map:old.map, alphaTest:old.alphaTest, side:old.side });
      old.dispose();
    }
    // The photo's triangles are metres wide, the LiDAR ground under it is 0.5 m: laid flat it dips
    // under the terrain in stripes. Let it win depth ties within ~PHOTO_BIAS m (a fixed amount, not
    // slope-scaled; the orthographic depth buffer is linear, 2^24 steps from near to far).
    const units=photoUnits();
    for (const m of [].concat(o.material)){
      m.clippingPlanes=[T.clip]; m.transparent=op<1; m.opacity=op; m.depthWrite=op>=1;
      m.polygonOffset=true; m.polygonOffsetFactor=0; m.polygonOffsetUnits=units; m.needsUpdate=true;
    }
  });
}
// ---- tree / building removal --------------------------------------------------------------
// The photo-mesh is one skin over ground, trees and roofs. Inside the boundary every
// vertex is laid on the block's own ground surface (+5 cm, so the photo drapes over the
// block top instead of fighting it). Outside, anything more than TREE_H above that
// ground is lowered: fully within CLEAR m of the boundary, fading out over TAPER m.
// Originals are kept, so switching it off or re-levelling starts from the real mesh.
const TREE_H=2, CLEAR=10, TAPER=20, PHOTO_BIAS=2;   // m — calibration knobs (same idea as Infographic-Production)
function distToPoly(x, y, poly){
  let best=Infinity;
  for (let i=0;i<poly.length;i++){
    const [ax,ay]=poly[i], [bx,by]=poly[(i+1)%poly.length], dx=bx-ax, dy=by-ay;
    const t=Math.max(0, Math.min(1, ((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)));
    best=Math.min(best, Math.hypot(x-ax-t*dx, y-ay-t*dy));
  }
  return best;
}
function flattenTile(root, on=$('mesh-flat').checked){
  if (!T || !O) return;
  on = on && !!model && !!boundary;
  const { THREE }=T;
  const xs=boundary ? boundary.map(p=>p[0]-O.e) : [0], zs=boundary ? boundary.map(p=>-(p[1]-O.n)) : [0];
  const R=CLEAR+TAPER, x0=Math.min(...xs)-R, x1=Math.max(...xs)+R, z0=Math.min(...zs)-R, z1=Math.max(...zs)+R;
  const ground=new Map();                                  // 1 m cache: model.at() is IDW (+ DTM lookup)
  const groundAt=(e,n)=>{ const k=Math.round(e)+','+Math.round(n);
    let g=ground.get(k); if (g===undefined){ g=model.at(e,n)[0]; ground.set(k,g); } return g; };
  const v=new THREE.Vector3();
  root.traverse(o=>{
    if (!o.isMesh) return;
    const g=o.geometry, pos=g.attributes.position;
    if (!g.userData.orig){ if (!on) return; g.userData.orig=pos.array.slice(); }
    pos.array.set(g.userData.orig);
    if (on){
      // mesh-local -> world-local (x = E−E0, y = mPD−ZREF, z = −(N−N0)), unaffected by exaggeration
      const L=new THREE.Matrix4();
      for (let n=o; n; n=n.parent){ if (n.matrixAutoUpdate) n.updateMatrix(); L.premultiply(n.matrix); if (n===root) break; }
      L.premultiply(T.tiles.group.matrix);
      const Li=L.clone().invert();
      for (let i=0;i<pos.count;i++){
        v.fromBufferAttribute(pos, i).applyMatrix4(L);
        if (v.x<x0 || v.x>x1 || v.z<z0 || v.z>z1) continue;   // cheap reject: far from the site
        const e=v.x+O.e, n=O.n-v.z, h=v.y+O.z, gr=groundAt(e,n);
        let h2=h;
        if (pointInPoly(e, n, boundary)) h2=gr+0.05;
        else if (h-gr>TREE_H){
          const d=distToPoly(e, n, boundary);
          const f=d<CLEAR ? 1 : d<R ? 1-(d-CLEAR)/TAPER : 0;
          h2=h-(h-gr)*f;
        }
        if (h2===h) continue;
        v.y=h2-O.z; v.applyMatrix4(Li);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
    }
    pos.needsUpdate=true; g.computeBoundingBox(); g.computeBoundingSphere();
  });
}
// ECEF -> scene, via local east/north/up at the origin; `dz` turns ellipsoid height into mPD.
function setTilesFrame(){
  if (!T?.tiles || !O) return;
  const [lat,lng]=toLL(O.e,O.n), la=lat*Math.PI/180, lo=lng*Math.PI/180;
  const A=6378137, F=1/298.257223563, E2=F*(2-F), N=A/Math.sqrt(1-E2*Math.sin(la)**2);
  const ox=N*Math.cos(la)*Math.cos(lo), oy=N*Math.cos(la)*Math.sin(lo), oz=N*(1-E2)*Math.sin(la);
  const sl=Math.sin(la), cl=Math.cos(la), so=Math.sin(lo), co=Math.cos(lo);
  const R=[[-so, co, 0], [cl*co, cl*so, sl], [sl*co, sl*so, -cl]];   // rows: east, up, −north
  const t=R.map(r=>-(r[0]*ox+r[1]*oy+r[2]*oz));
  t[1]+= +$('mesh-dz').value - O.z;
  T.tiles.group.matrix.set(...R[0], t[0], ...R[1], t[1], ...R[2], t[2], 0,0,0,1);
  T.tiles.group.matrixWorldNeedsUpdate=true;
  T.tiles.forEachLoadedModel(s=>flattenTile(s));      // heights moved: redo the tree removal
  // ponytail: ENU about the site, not the HK1980 grid — grid convergence here is
  // ~0.03°, i.e. under 0.2 m over 300 m. Rotate by it if sites get kilometres wide.
}
async function setMesh(){
  if (!T || !O) return;
  const on=$('mesh-on').checked;
  biasBuildings();
  if (!on){ if (T.tiles) T.tiles.group.visible=false; return; }
  try {
    const tiles=await ensureTiles();
    tiles.group.visible=true;
    setTilesFrame();
    tiles.forEachLoadedModel(s=>styleMesh(s));
  } catch(err){ console.error(err); note('view-note','✗ Could not load the Lands Dept 3D map: '+(err?.message||err),'err'); }
}
// Line the mesh up with the ground: drop rays at each borehole and on a grid over the
// site, and compare with the collar level (boreholes) / bare-earth DTM (grid). The
// photo-mesh is the TOP of trees and roofs, so most hits are too high; take the 85th
// percentile of (ground − hit), i.e. the hits that landed on open ground.
function autoLevel(){
  if (!T?.tiles || !O || !boundary) return;
  const { THREE, world }=T;
  T.tiles.forEachLoadedModel(s=>flattenTile(s, false));   // level against the real mesh, not our flattened one
  world.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(); ray.firstHitOnly=true;
  const targets=usedHoles().slice(0,30).map(b=>({ e:b.x, n:b.y, z:b.gl }));
  const xs=boundary.map(p=>p[0]), ys=boundary.map(p=>p[1]), pad=30;
  for (let i=0;i<=6;i++) for (let j=0;j<=6;j++){
    const e=Math.min(...xs)-pad+(Math.max(...xs)-Math.min(...xs)+2*pad)*i/6;
    const n=Math.min(...ys)-pad+(Math.max(...ys)-Math.min(...ys)+2*pad)*j/6;
    const z=dtmAt(e,n); if (z!=null) targets.push({ e, n, z });
  }
  const d=[];
  for (const t of targets){
    const [x,,zz]=P(t.e,t.n,0);
    ray.set(new THREE.Vector3(x, 1e4, zz), new THREE.Vector3(0,-1,0));
    const hit=ray.intersectObject(T.tiles.group, true)[0];
    if (hit) d.push(t.z-(hit.point.y/vex()+O.z));
  }
  if (!d.length){ setTilesFrame(); return; }
  d.sort((a,b)=>a-b);
  const med=d[Math.floor(0.85*(d.length-1))];
  $('mesh-dz').value=(+$('mesh-dz').value+med).toFixed(2);
  meshLevelled=true;
  setTilesFrame();
  note('view-note',`Photo map lined up with ${d.length} ground point(s): moved ${med>=0?'up':'down'} ${Math.abs(med).toFixed(2)} m. `+
    ($('mesh-flat').checked ? 'Trees and buildings over the site are laid flat on the ground.' : 'Tree tops and roofs sit above the soil top.'),'ok');
}

// ---- slice ------------------------------------------------------------------------------------------------------
function updateSlice(){
  drawSliceOnMap();
  if (!model || !boundary){ runs=[]; renderSection(); return; }
  const on=$('sl-on').checked;
  slice=sliceLine(boundary, +$('sl-az').value, +$('sl-off').value);
  runs = on ? sliceRuns(model, boundary, slice.A, slice.B, Math.max(0.5, block.cell/2)) : [];
  if (T){
    const { THREE, clip, capG, blockG }=T;
    // keep the side the normal points to (or the other one when flipped)
    const s=$('sl-flip').checked ? -1 : 1;
    const [nx,ny]=slice.normal;
    const [px,,pz]=P((slice.A.e+slice.B.e)/2, (slice.A.n+slice.B.n)/2, 0);
    clip.normal.set(s*nx, 0, -s*ny);
    clip.constant=-(clip.normal.x*px + clip.normal.z*pz);
    if (!on) clip.set(new THREE.Vector3(0,1,0), 1e9);          // nothing clipped
    for (const g of T.gizmos){ g.enabled=on; g.getHelper().visible=on; }
    if (!T.dragging){                                          // mid-drag the handle leads; otherwise it follows the sliders
      T.handle.position.set(px, (T.topY+2)*vex(), pz);
      T.handle.rotation.set(0, -(+$('sl-az').value)*Math.PI/180, 0);   // local X -> the cut's normal
    }
    disposeGroup(capG);
    const ux=(slice.B.e-slice.A.e)/(2*slice.half), uy=(slice.B.n-slice.A.n)/(2*slice.half);
    for (const r of runs) for (const reg of sectionRegions(r.xq, r.curves, model.keys)){
      const k=model.keys.indexOf(reg.name);
      const shape=reg.pts.map(([c,zz])=>new THREE.Vector2(c,zz));
      const pos=[]; for (const [c,zz] of reg.pts) pos.push(...P(slice.A.e+ux*c, slice.A.n+uy*c, zz));
      const g=new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
      g.setIndex(THREE.ShapeUtils.triangulateShape(shape, []).flat());
      const m=new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color:new THREE.Color(cssColour(model.colour[reg.name])), side:THREE.DoubleSide }));
      m.userData.k=k;
      m.visible=blockG.children.find(o=>o.userData.k===k)?.visible ?? true;
      capG.add(m);
      const edge=new THREE.LineLoop(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos,3)),
        new THREE.LineBasicMaterial({ color:0x1a1a0f }));
      capG.add(edge);
    }
  }
  prismCaps();
  renderSection();
}

// The 3D handle was dragged: read its pose back into the direction / position sliders.
function onHandle(){
  const { THREE, handle }=T;
  handle.position.y=(T.topY+2)*vex();
  const x=new THREE.Vector3(1,0,0).applyQuaternion(handle.quaternion);
  const s=sliceFromPose(boundary, x.x, -x.z, handle.position.x+O.e, O.n-handle.position.z);
  $('sl-az').value=s.az; $('sl-off').value=s.off;
  $('sl-flip').checked = T.flip0 !== s.wrapped;                // turned past 0/180 deg: keep the same side
  syncLabels(); updateSlice();
}

// Put the camera square-on to the cut face, on the side that was cut away.
function lookAtCut(){
  if (!T || !slice || !$('sl-on').checked) return;
  showTab('block');
  const { camera, controls, clip }=T;
  const [mx,,mz]=P((slice.A.e+slice.B.e)/2, (slice.A.n+slice.B.n)/2, 0);
  const midY=((O.z+model.base)/2-O.z)*vex(), d=T.span*4;
  controls.target.set(mx, midY, mz);
  camera.position.set(mx-clip.normal.x*d, midY+d*0.25, mz-clip.normal.z*d);
  camera.zoom=T.half/(slice.half*1.15); camera.updateProjectionMatrix();
}

// ---- section tab ------------------------------------------------------------------------------------------------
function renderSection(){
  setTimeout(tellHeight, 0);                      // the section appearing or going changes the page height
  const svg=$('sec-svg');
  const has=runs.length>0;
  svg.style.display=has?'':'none'; $('sec-empty').style.display=has?'none':'';
  $('exp-dxf').disabled=$('exp-png').disabled=!has;
  if (!has) return;
  const ve=vex();
  const xMin=Math.min(...runs.map(r=>r.from)), xMax=Math.max(...runs.map(r=>r.to));
  // the proposed structure where the cut passes through it: [chainage from, to]
  const st=structure(), L=2*slice.half;
  const stSpans=st ? lineSpans([footprint(st)], [slice.A.e, slice.A.n], [(slice.B.e-slice.A.e)/L, (slice.B.n-slice.A.n)/L])
    .map(([a,b])=>[Math.max(a,xMin), Math.min(b,xMax)]).filter(([a,b])=>b-a>0.01) : [];
  const stTop=st ? st.found+st.height : null;
  const zMax=Math.max(...runs.flatMap(r=>r.curves[0]), ...(stSpans.length ? [stTop] : [])), zMin=Math.min(model.base, ...(stSpans.length ? [st.found] : []));
  const nKey=model.keys.length+(stSpans.length ? 1 : 0);
  const W=1000, legendH=22*Math.ceil(nKey/2), pad={l:64,r:20,t:34,b:48+legendH}, sx=(W-pad.l-pad.r)/((xMax-xMin)||1);
  const H=Math.min(900, Math.max(220, (zMax-zMin)*sx*ve+pad.t+pad.b));
  const sz=(H-pad.t-pad.b)/((zMax-zMin)||1);
  const X=c=>pad.l+(c-xMin)*sx, Y=z=>pad.t+(zMax-z)*sz;
  let s=`<rect width="${W}" height="${H}" fill="#fff"/>`;
  for (const r of runs) for (const reg of sectionRegions(r.xq, r.curves, model.keys))
    s+=`<polygon points="${reg.pts.map(([c,z])=>X(c).toFixed(1)+','+Y(z).toFixed(1)).join(' ')}" fill="${model.colour[reg.name]}" stroke="#1a1a0f" stroke-width=".7"/>`;
  if (stSpans.length){
    s+=`<defs><pattern id="st-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="${LOOK.structure}" fill-opacity=".55"/><line x1="0" y1="0" x2="0" y2="8" stroke="#5c2b10" stroke-width="1.2"/></pattern></defs>`;
    for (const [a,b] of stSpans){
      const x=X(a), w=X(b)-X(a), y=Y(stTop), hgt=Y(st.found)-Y(stTop);
      s+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${hgt.toFixed(1)}" fill="url(#st-hatch)" stroke="#5c2b10" stroke-width="1.6"/>`;
      // founding level: a tick line and its value, kept inside the drawing
      const lx=Math.min(X(b)+6, W-pad.r-150);
      s+=`<line x1="${x.toFixed(1)}" x2="${(X(b)+4).toFixed(1)}" y1="${Y(st.found).toFixed(1)}" y2="${Y(st.found).toFixed(1)}" stroke="#5c2b10" stroke-width="1.6"/>`+
         `<text x="${lx.toFixed(1)}" y="${(Y(st.found)-5).toFixed(1)}" font-size="13" font-family="sans-serif" font-weight="bold" fill="#5c2b10" stroke="#fff" stroke-width="3" paint-order="stroke">founding ${st.found} mPD</text>`;
    }
  }
  // axes: level every "nice" step, chainage every "nice" step
  const nice=span=>{ const r=span/6, p=10**Math.floor(Math.log10(r)); return [1,2,5,10].map(m=>m*p).find(v=>v>=r); };
  const zs=nice(zMax-zMin), cs=nice(xMax-xMin);
  s+=`<g font-size="14" fill="#3d3529" font-family="sans-serif">`;
  for (let z=Math.ceil(zMin/zs)*zs; z<=zMax; z+=zs)
    s+=`<line x1="${pad.l-4}" x2="${W-pad.r}" y1="${Y(z)}" y2="${Y(z)}" stroke="#000" stroke-opacity=".08"/><text x="${pad.l-6}" y="${Y(z)+4}" text-anchor="end">${z}</text>`;
  for (let c=Math.ceil(xMin/cs)*cs; c<=xMax; c+=cs)
    s+=`<text x="${X(c)}" y="${H-pad.b+16}" text-anchor="middle">${Math.round(c)}</text>`;
  s+=`<text x="${pad.l}" y="${H-legendH-8}">Chainage from A (m)</text><text x="12" y="${pad.t-12}">mPD</text>`;
  model.keys.forEach((k,i)=>{                       // colour key, two columns
    const x=pad.l+(i%2)*440, y=H-legendH+4+Math.floor(i/2)*22;
    s+=`<rect x="${x}" y="${y}" width="14" height="14" fill="${model.colour[k]}" stroke="#3d3529"/><text x="${x+20}" y="${y+12}">${esc(model.label[k])}</text>`;
  });
  if (stSpans.length){
    const i=model.keys.length, x=pad.l+(i%2)*440, y=H-legendH+4+Math.floor(i/2)*22;
    s+=`<rect x="${x}" y="${y}" width="14" height="14" fill="url(#st-hatch)" stroke="#5c2b10"/><text x="${x+20}" y="${y+12}">Proposed structure (top ${stTop.toFixed(1)}, founding ${st.found} mPD)</text>`;
  }
  s+=`<text x="${pad.l}" y="${pad.t-12}" font-weight="bold" fill="#c0262d">A</text><text x="${W-pad.r}" y="${pad.t-12}" text-anchor="end" font-weight="bold" fill="#c0262d">B</text>`;
  s+=`<text x="${W/2}" y="${pad.t-12}" text-anchor="middle">Slice ${$('sl-az').value}° from north · vertical exaggeration ${ve}×</text></g>`;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML=s;
}
const esc=t=>String(t).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function stem(){ return `section3d_${$('sl-az').value}deg_${new Date().toISOString().slice(0,10)}`; }
function download(name, blob){
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
}
function exportDXF(){
  const regions=runs.flatMap(r=>sectionRegions(r.xq, r.curves, model.keys))
    .map(reg=>({ name:layerName(model.label[reg.name]), pts:reg.pts }));
  const st=structure(), L=2*slice.half;
  const extra=st ? lineSpans([footprint(st)], [slice.A.e, slice.A.n], [(slice.B.e-slice.A.e)/L, (slice.B.n-slice.A.n)/L])
    .map(([a,b])=>({ name:'PROPOSED_STRUCTURE', pts:[[a,st.found],[b,st.found],[b,st.found+st.height],[a,st.found+st.height]] })) : [];
  download(stem()+'.dxf', new Blob([toDXF(regions, extra)], { type:'application/dxf' }));
}
function exportPNG(){
  const svg=$('sec-svg'), vb=svg.viewBox.baseVal;
  const img=new Image();
  img.onload=()=>{
    const c=document.createElement('canvas'); c.width=vb.width*2; c.height=vb.height*2;
    const g=c.getContext('2d'); g.scale(2,2); g.drawImage(img,0,0);
    c.toBlob(b=>download(stem()+'.png', b));
  };
  img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));
}

// ---- save ------------------------------------------------------------------------------------------------------
async function saveCloud(){
  if (!cloud || !cloudId || !proj) return;
  try {
    const state={ boreholes:proj.boreholes };
    await cloud.updateProject(cloudId, projectCSV(), cloud.summarise(state, proj.sectionLine));
    note('save-note','✓ Saved boundary, slice and 3D settings to your dataset.','ok');
  } catch(err){ note('save-note','✗ '+(err?.message||err),'err'); }
}

// ---- tabs + wiring -------------------------------------------------------------------------------------------------
function showTab(name){
  if (EMBED){                                  // every pane is on show: just bring the one asked for into view
    if (name==='map' && map) setTimeout(()=>map.invalidateSize(), 0);
    if (name==='block' && !model && proj && boundary) build();
    const el=document.querySelector(`.tabpane[data-pane="${name}"]`), y=el.getBoundingClientRect().top;
    parent.postMessage({ geo3d:'scroll', y }, location.origin);
    return;
  }
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===name));
  document.querySelectorAll('.tabpane').forEach(p=>p.classList.toggle('active', p.dataset.pane===name));
  if (name==='map' && map) setTimeout(()=>map.invalidateSize(), 0);
  if (name==='block' && !model && proj && boundary) build();
}
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click', ()=>showTab(t.dataset.tab)));
$('ds-load').addEventListener('click', loadSelected);
$('ds-file').addEventListener('change', async e=>{
  const f=e.target.files[0]; if (!f) return;
  try { openProject(await f.text(), null, f.name); } catch(err){ note('ds-note','✗ '+(err?.message||err),'err'); }
  e.target.value='';
});
$('lidar-file').addEventListener('change', async e=>{ await loadLidar([...e.target.files]); e.target.value=''; });
$('bd-draw').addEventListener('click', startDraw);
$('bd-fit').addEventListener('click', fitBoundary);
$('build').addEventListener('click', build);
$('use-tp').addEventListener('change', ()=>{ drawMap(false); updateBoundaryInfo(); });
$('vex').addEventListener('input', ()=>{
  syncLabels();
  if (T && model){ T.world.scale.y=vex(); updateSlice(); }      // also re-seats the slice handle on the stretched block
});
$('mesh-on').addEventListener('change', setMesh);
$('terr-on').addEventListener('change', e=>{ if (T) T.terrG.visible=e.target.checked; });
$('bld-on').addEventListener('change', async ()=>{ await setBuildings(); prismCaps(); });
$('infra-on').addEventListener('change', async ()=>{ await setInfra(); prismCaps(); });
$('mesh-flat').addEventListener('change', ()=>{ if (T?.tiles) T.tiles.forEachLoadedModel(s=>flattenTile(s)); });
$('mesh-op').addEventListener('input', ()=>{ syncLabels(); if (T?.tiles) T.tiles.forEachLoadedModel(s=>styleMesh(s)); });
$('mesh-dz').addEventListener('change', ()=>{ meshLevelled=true; setTilesFrame(); });
$('mesh-level').addEventListener('click', autoLevel);
$('holes-on').addEventListener('change', e=>{ if (T) T.holeG.visible=e.target.checked; });
for (const id of ['sl-on','sl-az','sl-off','sl-flip'])
  $(id).addEventListener(id==='sl-az'||id==='sl-off' ? 'input' : 'change', ()=>{ syncLabels(); updateSlice(); });
$('sl-look').addEventListener('click', lookAtCut);
$('st-on').addEventListener('change', ()=>{ if ($('st-on').checked && $('st-e').value==='') defaultStructure(); updateStructure(); });
for (const id of ST_IDS) $(id).addEventListener('input', ()=>updateStructure());
$('st-centre').addEventListener('click', ()=>{ $('st-e').value=''; defaultStructure(); updateStructure(); });
$('st-place').addEventListener('click', ()=>{
  if (!map) return;
  showTab('map');
  map.getContainer().style.cursor='crosshair';
  note('build-note', 'Click the spot on the site map where the centre of the structure should go.');
  map.once('click', e=>{
    map.getContainer().style.cursor='';
    const [x,y]=fromLL(e.latlng.lat, e.latlng.lng);
    $('st-e').value=x.toFixed(1); $('st-n').value=y.toFixed(1);
    if ($('st-len').value==='') defaultStructure(), ($('st-e').value=x.toFixed(1)), ($('st-n').value=y.toFixed(1));
    note('build-note', '');
    updateStructure();
  });
});
$('exp-view').addEventListener('click', exportView);
$('exp-glb').addEventListener('click', exportGLB);
$('exp-dxf').addEventListener('click', exportDXF);
$('exp-png').addEventListener('click', exportPNG);
$('save-file').addEventListener('click', ()=>{
  if (!proj) return;
  download(`geovis_project_${new Date().toISOString().slice(0,10)}.csv`, new Blob([projectCSV()], { type:'text/csv' }));
});
$('save-cloud').addEventListener('click', saveCloud);

// ---- boot --------------------------------------------------------------------------------------------------------------
(async function boot(){
  if (!window.GeoAdmin.isAdmin()) return;
  syncLabels();
  if (!EMBED) try {
    const c=await import('./cloud.js');
    if (c.isConfigured()){
      cloud=c;
      const { mountAuthControl } = await import('./auth_ui.js');
      mountAuthControl($('auth-slot'), { onLight:false });
    }
  } catch {}
  await initMap();
  if (EMBED){
    document.querySelectorAll('.panel h3').forEach(h=>{ h.textContent=h.textContent.replace(/^\d+ · /, ''); });   // the step numbers belong to the 2D builder's tabs here
    window.geo3d={
      // Open the 2D builder's current project and go straight to a block: no boundary saved yet
      // means "box around the boreholes", so the 3D tab is never an empty page.
      async open(csv, id){
        try { openProject(csv, id, 'the project from the 2D builder'); }
        catch {
          // nothing to build from (no boreholes entered yet): say so instead of failing silently
          proj=null; boundary=null; model=block=null; runs=[]; clearScene();
          try { drawMap(false); updateBoundaryInfo(); } catch {}
          note('build-note','No boreholes yet. Load or enter boreholes in tabs 1 and 2 first, then come back to this tab.','err');
          tellHeight(); return;
        }
        if (!boundary && usedHoles().length) fitBoundary();
        if (boundary) await build();
        tellHeight();
      },
      settings: ()=>proj ? block3dSettings() : null,
    };
    // the frame is sized to this page, so there is one scrollbar (the 2D builder's), not two
    // A ResizeObserver alone is not enough: it only reports when the browser paints, and a frame that
    // is off screen is not painted. So the height is also sent after every status note and section redraw.
    tellHeight=()=>parent.postMessage({ geo3d:'height', h:document.body.scrollHeight }, location.origin);
    new ResizeObserver(tellHeight).observe(document.body);
    parent.postMessage({ geo3d:'ready' }, location.origin);
    return;
  }
  await fillDatasets();
  if ($('ds-select').value) await loadSelected();
})();
