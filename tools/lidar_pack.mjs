// Pack the CEDD 2020 LiDAR "RASTER-DTM" GeoTIFFs for the web (format: see web/lidar_tile.js).
//   node tools/lidar_pack.mjs "<folder with the .tif downloads>" "<output folder>" [step=2] [q=0.05] [sheets.json]
// step 1 = keep 0.5 m cells, 2 = average to 1 m. q = rounding step in metres.
// sheets.json (from tools/lidar_ags_sheets.mjs): pack only those sheets — the ones with AGS boreholes —
// and, with a radius R (m), blank everything farther than R from every AGS borehole (no-data packs to
// almost nothing; the page uses the 5 m model there). 200 m keeps all-Hong-Kong under 1 GB.
// SHARD=k/n packs every n-th sheet starting at k, so n copies can run side by side.
// Re-running skips sheets already packed, so it can be stopped and restarted.
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { parseDtmTiff, packGrid, gridSheetName, gridBounds, sheetName, SHEET } from '../web/lidar_tile.js';

const [src, out, step='2', q='0.05', only, radius]=process.argv.slice(2);
const sel=only ? JSON.parse(fs.readFileSync(only,'utf8')) : null;
const keep=sel ? new Set(sel.sheets) : null, R=+radius||0;
const [shard, shards]=(process.env.SHARD||'0/1').split('/').map(Number);
const near=new Map();                                         // sheet -> AGS holes on it
if (R) for (const [e,n] of sel.holes){ const s=sheetName(e,n); near.has(s) ? near.get(s).push([e,n]) : near.set(s,[[e,n]]); }

/** Blank (no-data) every cell farther than R from all AGS holes, judged on 10 m blocks. */
function cropToHoles(g){
  const B=10, [e0,, , n1]=gridBounds(g), bw=Math.ceil(g.w*g.dx/B), bh=Math.ceil(g.h*g.dy/B), ok=new Uint8Array(bw*bh);
  for (let de=-SHEET.w; de<=SHEET.w; de+=SHEET.w) for (let dn=-SHEET.h; dn<=SHEET.h; dn+=SHEET.h)   // R < one sheet: 3×3 sheets suffice
    for (const [e,n] of near.get(sheetName(e0+1+de+SHEET.w/2, n1-1+dn-SHEET.h/2))||[])
      for (let by=Math.max(0,Math.floor((n1-n-R)/B)); by<=Math.min(bh-1,Math.floor((n1-n+R)/B)); by++)
        for (let bx=Math.max(0,Math.floor((e-R-e0)/B)); bx<=Math.min(bw-1,Math.floor((e+R-e0)/B)); bx++){
          const x=e0+(bx+0.5)*B-e, y=n1-(by+0.5)*B-n; if (x*x+y*y<=R*R) ok[by*bw+bx]=1;
        }
  for (let r=0;r<g.h;r++) for (let c=0;c<g.w;c++)
    if (!ok[Math.floor(r*g.dy/B)*bw+Math.floor(c*g.dx/B)]) g.data[r*g.w+c]=g.nodata;
}
if (!src || !out){ console.error('usage: node tools/lidar_pack.mjs <tif folder> <out folder> [step] [q]'); process.exit(1); }
fs.mkdirSync(out, { recursive:true });
let tifs=[];
(function walk(d){ for (const f of fs.readdirSync(d, { withFileTypes:true }))
  f.isDirectory() ? walk(path.join(d, f.name)) : /\.tiff?$/i.test(f.name) && tifs.push(path.join(d, f.name)); })(src);

tifs.sort(); tifs=tifs.filter((_,i)=>i%shards===shard);
let done=0, skipped=0, bytes=0; const bad=[], seen=new Set();
for (const f of tifs){
  try {
    // A damaged or odd file must not stop a 2,700-file run: note it and go on.
    const b=fs.readFileSync(f), g=parseDtmTiff(b.buffer.slice(b.byteOffset, b.byteOffset+b.byteLength));
    const name=gridSheetName(g);
    if (!name) throw new Error('not on the 750 × 600 m sheet grid');
    if (keep && !keep.has(name)) continue;                   // no AGS boreholes on this sheet
    if (seen.has(name)){ skipped++; continue; }              // the same sheet was in two downloads
    seen.add(name);
    const dst=path.join(out, name);
    if (!fs.existsSync(dst)){ if (R) cropToHoles(g); fs.writeFileSync(dst, zlib.gzipSync(packGrid(g, { step:+step, q:+q }), { level:9 })); }
    bytes+=fs.statSync(dst).size; done++;
    if (done%100===0) console.log(`${done}/${tifs.length}  ${(bytes/1e9).toFixed(2)} GB so far`);
  } catch(err){ bad.push(`${path.basename(f)}: ${err.message}`); }
}
// one index for all shards: every packed sheet in the folder
const all=fs.readdirSync(out).filter(f=>f.endsWith('.hkdt')).sort();
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ step:+step, q:+q, cell:0.5*step, radius:R, sheets:all }));
console.log(`packed ${done} sheet(s), ${skipped} duplicate(s) skipped, ${(bytes/1e9).toFixed(3)} GB total`);
if (bad.length) console.log('problems:\n  '+bad.join('\n  '));
