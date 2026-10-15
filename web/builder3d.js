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

import { blockHoles, makeModel, buildBlock, sliceRuns, sliceLine, polyArea, defaultBase } from './block3d.js';
import { projectCSVToState, stateToProjectCSV } from './project_csv.js';
import { EXAMPLES } from './examples.js';
import { sectionRegions, toDXF, layerName } from './cad_export.js';
import { sampleElevation, tileCoord } from './terrain.js';
import { fetchDtmTile, dtmTileGetter } from './dtm_tiles.js';
import { classColour } from './strata.js';

const $ = id => document.getElementById(id);
const LANDSD_3D = 'https://data.map.gov.hk/api/3d-data/3dtiles/f2/tileset.json';
const THREE_LIBS = 'https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/';
const HANDOFF_KEY = 'geovis_3d_handoff';

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
}
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
    if (v==='handoff'){ const h=readHandoff(); openProject(h.csv, h.cloudId, 'the 2D builder'); }
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
  if (b.top) document.querySelector(`input[name=top][value=${b.top==='bh'?'bh':'dtm'}]`).checked=true;
  $('base').value = Number.isFinite(b.base) ? b.base : '';
  if (b.detail) $('detail').value=String(b.detail);
  $('use-tp').checked = !!b.useTP;
  if (b.vex) $('vex').value=b.vex;
  if (b.meshOn!=null) $('mesh-on').checked=!!b.meshOn;
  if (b.meshOp!=null) $('mesh-op').value=b.meshOp;
  $('mesh-dz').value = Number.isFinite(b.meshDz) ? b.meshDz : 0;
  meshLevelled = Number.isFinite(b.meshDz);
  const s=b.slice||{};
  $('sl-on').checked=!!s.on; $('sl-flip').checked=!!s.flip;
  if (s.az!=null) $('sl-az').value=s.az;
  if (s.off!=null) $('sl-off').value=s.off;
  syncLabels();
}
function block3dSettings(){
  const base=$('base').value.trim();
  return { boundary, top:topMode(), base: base===''?null:+base, detail:+$('detail').value,
    useTP:$('use-tp').checked, vex:vex(), meshOn:$('mesh-on').checked, meshOp:+$('mesh-op').value,
    meshDz: meshLevelled ? +$('mesh-dz').value : null,
    slice:{ on:$('sl-on').checked, az:+$('sl-az').value, off:+$('sl-off').value, flip:$('sl-flip').checked } };
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
}

// ---- site map -----------------------------------------------------------------------------
let map=null, holesLayer=null, bdLayer=null, slLayer=null;
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
  holesLayer=L.layerGroup().addTo(map); bdLayer=L.layerGroup().addTo(map); slLayer=L.layerGroup().addTo(map);
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
function dtmAt(e,n){
  const [lat,lng]=toLL(e,n);
  const z=sampleElevation(dtmTileGetter, lng, lat);
  return Number.isFinite(z) && z>-50 ? z : null;     // no-data cells come back as huge negatives
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
      if (!await prefetchDtm()){ top='bh'; msg=' Ground model unavailable here — used borehole ground levels instead.'; }
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
    d.innerHTML=`<input type="checkbox" checked data-k="${i}" style="width:auto"><span class="sw" style="background:${model.colour[k]}"></span>${model.label[k]}`;
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
  const el=$('view3d');
  const renderer=new THREE.WebGLRenderer({ antialias:true, alpha:true })   // alpha: the CSS sky gradient shows through;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.localClippingEnabled=true;
  el.prepend(renderer.domElement);
  const scene=new THREE.Scene();
  const camera=new THREE.PerspectiveCamera(45, 1, 0.5, 30000);
  const controls=new OrbitControls(camera, renderer.domElement);
  controls.enableDamping=true; controls.screenSpacePanning=true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a60, 1.7));
  const sun=new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(-400, 800, 500); scene.add(sun);
  const world=new THREE.Group(); scene.add(world);
  const blockG=new THREE.Group(), capG=new THREE.Group(), holeG=new THREE.Group();
  world.add(blockG, capG, holeG);
  const clip=new THREE.Plane(new THREE.Vector3(1,0,0), 0);
  T={ THREE, renderer, scene, camera, controls, world, blockG, capG, holeG, clip, tiles:null };
  const resize=()=>{
    const w=el.clientWidth, h=el.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h); camera.aspect=w/h; camera.updateProjectionMatrix();
    if (T.tiles) T.tiles.setResolutionFromRenderer(camera, renderer);
  };
  new ResizeObserver(resize).observe(el); resize();
  renderer.setAnimationLoop(()=>{
    if (!el.clientWidth) return;                    // tab hidden: don't render or stream tiles
    controls.update();
    camera.updateMatrixWorld();
    if (T.tiles && T.tiles.group.visible) T.tiles.update();
    renderer.render(scene, camera);
  });
  return T;
}
function disposeGroup(g){
  for (const o of [...g.children]){ g.remove(o); o.geometry?.dispose(); o.material?.dispose?.(); }
}
function clearScene(){ if (T){ disposeGroup(T.blockG); disposeGroup(T.capG); disposeGroup(T.holeG); } }

const P = (e,n,z) => [e-O.e, z-O.z, -(n-O.n)];      // HK1980 + mPD -> scene

async function showBlock(){
  const { THREE, blockG, holeG, world, camera, controls, clip }=await ensure3D();
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
      side:THREE.DoubleSide, clippingPlanes:[clip], polygonOffset:true, polygonOffsetFactor:-k, polygonOffsetUnits:-k }));
    m.userData.k=k;
    m.visible=!!$('legend').querySelector(`input[data-k="${k}"]`)?.checked;
    blockG.add(m);
  }
  // boreholes: one short cylinder per logged layer, coloured like the log
  for (const b of usedHoles()){
    for (const l of b.layers){
      const h=Math.max(0.05, l.base-l.top);
      const c=new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, h, 8),
        new THREE.MeshLambertMaterial({ color:new THREE.Color(cssColour(classColour(l))) }));
      c.position.set(...P(b.x, b.y, b.gl-(l.top+l.base)/2));
      holeG.add(c);
    }
  }
  holeG.visible=$('holes-on').checked;
  // camera: looking at the block from the south-west, a little above
  const xs=boundary.map(p=>p[0]), ys=boundary.map(p=>p[1]);
  const span=Math.max(40, Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys));
  const midZ=((O.z+model.base)/2-O.z)*vex();
  controls.target.set(0, midZ, 0);
  camera.position.set(-span*0.7, midZ+span*0.8, span*0.9);
  camera.near=Math.max(0.5, span/500); camera.far=span*60; camera.updateProjectionMatrix();
  updateSlice();
  setMesh();
}
// "hsl(…)" palette entries and hex both go through a canvas so THREE.Color gets plain hex
const _cx=document.createElement('canvas').getContext('2d');
function cssColour(c){ _cx.fillStyle='#000'; _cx.fillStyle=c; return _cx.fillStyle; }

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
  tiles.addEventListener('load-model', ({ scene })=>styleMesh(scene));
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
function styleMesh(root){
  const op=+$('mesh-op').value;
  root.traverse(o=>{
    if (!o.material) return;
    for (const m of [].concat(o.material)){
      m.clippingPlanes=[T.clip]; m.transparent=op<1; m.opacity=op; m.depthWrite=op>=1; m.needsUpdate=true;
    }
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
  // ponytail: ENU about the site, not the HK1980 grid — grid convergence here is
  // ~0.03°, i.e. under 0.2 m over 300 m. Rotate by it if sites get kilometres wide.
}
async function setMesh(){
  if (!T || !O) return;
  const on=$('mesh-on').checked;
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
  if (!d.length) return;
  d.sort((a,b)=>a-b);
  const med=d[Math.floor(0.85*(d.length-1))];
  $('mesh-dz').value=(+$('mesh-dz').value+med).toFixed(2);
  meshLevelled=true;
  setTilesFrame();
  note('view-note',`Photo map lined up with ${d.length} ground point(s): moved ${med>=0?'up':'down'} ${Math.abs(med).toFixed(2)} m. `+
    'Tree tops and roofs still sit above the soil top — that is expected.','ok');
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
  renderSection();
}

// ---- section tab ------------------------------------------------------------------------------------------------
function renderSection(){
  const svg=$('sec-svg');
  const has=runs.length>0;
  svg.style.display=has?'':'none'; $('sec-empty').style.display=has?'none':'';
  $('exp-dxf').disabled=$('exp-png').disabled=!has;
  if (!has) return;
  const ve=vex();
  const xMin=Math.min(...runs.map(r=>r.from)), xMax=Math.max(...runs.map(r=>r.to));
  const zMax=Math.max(...runs.flatMap(r=>r.curves[0])), zMin=model.base;
  const W=1000, pad={l:60,r:20,t:30,b:40}, sx=(W-pad.l-pad.r)/((xMax-xMin)||1);
  const H=Math.min(900, Math.max(220, (zMax-zMin)*sx*ve+pad.t+pad.b));
  const sz=(H-pad.t-pad.b)/((zMax-zMin)||1);
  const X=c=>pad.l+(c-xMin)*sx, Y=z=>pad.t+(zMax-z)*sz;
  let s=`<rect width="${W}" height="${H}" fill="#fff"/>`;
  for (const r of runs) for (const reg of sectionRegions(r.xq, r.curves, model.keys))
    s+=`<polygon points="${reg.pts.map(([c,z])=>X(c).toFixed(1)+','+Y(z).toFixed(1)).join(' ')}" fill="${model.colour[reg.name]}" stroke="#1a1a0f" stroke-width=".7"/>`;
  // axes: level every "nice" step, chainage every "nice" step
  const nice=span=>{ const r=span/6, p=10**Math.floor(Math.log10(r)); return [1,2,5,10].map(m=>m*p).find(v=>v>=r); };
  const zs=nice(zMax-zMin), cs=nice(xMax-xMin);
  s+=`<g font-size="11" fill="#3d3529" font-family="sans-serif">`;
  for (let z=Math.ceil(zMin/zs)*zs; z<=zMax; z+=zs)
    s+=`<line x1="${pad.l-4}" x2="${W-pad.r}" y1="${Y(z)}" y2="${Y(z)}" stroke="#000" stroke-opacity=".08"/><text x="${pad.l-6}" y="${Y(z)+4}" text-anchor="end">${z}</text>`;
  for (let c=Math.ceil(xMin/cs)*cs; c<=xMax; c+=cs)
    s+=`<text x="${X(c)}" y="${H-pad.b+16}" text-anchor="middle">${Math.round(c)}</text>`;
  s+=`<text x="${pad.l}" y="${H-6}">Chainage from A (m)</text><text x="12" y="${pad.t-12}">mPD</text>`;
  s+=`<text x="${pad.l}" y="${pad.t-12}" font-weight="bold" fill="#c0262d">A</text><text x="${W-pad.r}" y="${pad.t-12}" text-anchor="end" font-weight="bold" fill="#c0262d">B</text>`;
  s+=`<text x="${W/2}" y="${pad.t-12}" text-anchor="middle">Slice ${$('sl-az').value}° from north · vertical exaggeration ${ve}×</text></g>`;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML=s;
}
function stem(){ return `section3d_${$('sl-az').value}deg_${new Date().toISOString().slice(0,10)}`; }
function download(name, blob){
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
}
function exportDXF(){
  const regions=runs.flatMap(r=>sectionRegions(r.xq, r.curves, model.keys))
    .map(reg=>({ name:layerName(model.label[reg.name]), pts:reg.pts }));
  download(stem()+'.dxf', new Blob([toDXF(regions)], { type:'application/dxf' }));
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
$('bd-draw').addEventListener('click', startDraw);
$('bd-fit').addEventListener('click', fitBoundary);
$('build').addEventListener('click', build);
$('use-tp').addEventListener('change', ()=>{ drawMap(false); updateBoundaryInfo(); });
$('vex').addEventListener('input', ()=>{
  syncLabels();
  if (T && model){ T.world.scale.y=vex(); renderSection(); }
});
$('mesh-on').addEventListener('change', setMesh);
$('mesh-op').addEventListener('input', ()=>{ syncLabels(); if (T?.tiles) T.tiles.forEachLoadedModel(s=>styleMesh(s)); });
$('mesh-dz').addEventListener('change', ()=>{ meshLevelled=true; setTilesFrame(); });
$('mesh-level').addEventListener('click', autoLevel);
$('holes-on').addEventListener('change', e=>{ if (T) T.holeG.visible=e.target.checked; });
for (const id of ['sl-on','sl-az','sl-off','sl-flip'])
  $(id).addEventListener(id==='sl-az'||id==='sl-off' ? 'input' : 'change', ()=>{ syncLabels(); updateSlice(); });
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
  try {
    const c=await import('./cloud.js');
    if (c.isConfigured()){
      cloud=c;
      const { mountAuthControl } = await import('./auth_ui.js');
      mountAuthControl($('auth-slot'), { onLight:false });
    }
  } catch {}
  await initMap();
  await fillDatasets();
  if ($('ds-select').value) await loadSelected();
})();
window.__b3d={ get map(){return map;}, get T(){return T;}, get model(){return model;}, get block(){return block;} };   // DEBUG-REMOVE
