// Self-check for the LiDAR DTM tile reader. Run: node web/test_lidar_tile.mjs
// Optional: pass the path of a real CEDD tile to check it too:
//   node web/test_lidar_tile.mjs "C:/…/11NW10D(e836n821,e837n822).tif"
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { parseDtmTiff, sampleGrid, gridBounds } from './lidar_tile.js';

const near=(a,b,t=1e-6)=>Math.abs(a-b)<=t;

// Build a small GeoTIFF the way CEDD does: float32, uncompressed, in tiles (or strips).
// Level of cell (col,row) = 100 + col + 10*row, one cell is no-data.
function makeTiff({ w=6, h=5, tile=4, le=true, strips=false }={}){
  const val=(c,r)=>(c===5 && r===0) ? -9999 : 100+c+10*r;
  const blocks=[];
  if (strips) for (let r=0;r<h;r+=2) blocks.push({ bw:w, bh:Math.min(2,h-r), ox:0, oy:r });
  else for (let oy=0;oy<h;oy+=tile) for (let ox=0;ox<w;ox+=tile) blocks.push({ bw:tile, bh:tile, ox, oy });
  const entries=[], extra=[];                                // extra: values too big for an entry
  const add=(tag,type,vals)=>entries.push({ tag, type, vals });
  add(256,3,[w]); add(257,3,[h]); add(258,3,[32]); add(259,3,[1]); add(277,3,[1]); add(339,3,[3]);
  if (strips){ add(278,3,[2]); add(273,4,blocks.map(()=>0)); }
  else { add(322,3,[tile]); add(323,3,[tile]); add(324,4,blocks.map(()=>0)); }
  add(33550,12,[0.5,0.5,0]); add(33922,12,[0,0,0, 836750,822200,0]);
  add(42113,2,[...'-9999\0'].map(ch=>ch.charCodeAt(0)));
  const SIZE={ 2:1, 3:2, 4:4, 12:8 };
  let at=8+2+12*entries.length+4;
  for (const e of entries){ e.bytes=SIZE[e.type]*e.vals.length; if (e.bytes>4){ e.at=at; at+=e.bytes; } }
  for (const b of blocks){ b.at=at; at+=4*b.bw*b.bh; }
  const buf=new ArrayBuffer(at), dv=new DataView(buf);
  dv.setUint16(0, le?0x4949:0x4d4d, true); dv.setUint16(2,42,le); dv.setUint32(4,8,le);
  dv.setUint16(8, entries.length, le);
  const put=(p,type,v)=>type===3 ? dv.setUint16(p,v,le) : type===4 ? dv.setUint32(p,v,le) : type===12 ? dv.setFloat64(p,v,le) : dv.setUint8(p,v);
  entries.forEach((e,i)=>{
    const p=10+12*i;
    dv.setUint16(p,e.tag,le); dv.setUint16(p+2,e.type,le); dv.setUint32(p+4,e.vals.length,le);
    const vals=(e.tag===324 || e.tag===273) ? blocks.map(b=>b.at) : e.vals;
    if (e.bytes>4){ dv.setUint32(p+8,e.at,le); vals.forEach((v,k)=>put(e.at+SIZE[e.type]*k, e.type, v)); }
    else vals.forEach((v,k)=>put(p+8+SIZE[e.type]*k, e.type, v));
  });
  for (const b of blocks) for (let r=0;r<b.bh;r++) for (let c=0;c<b.bw;c++)
    dv.setFloat32(b.at+4*(r*b.bw+c), (b.ox+c<w && b.oy+r<h) ? val(b.ox+c, b.oy+r) : 0, le);   // 0 = tile padding
  return buf;
}

for (const opt of [{}, { le:false }, { strips:true }, { strips:true, le:false }]){
  const g=parseDtmTiff(makeTiff(opt));
  assert.deepStrictEqual([g.w,g.h,g.dx,g.dy,g.x0,g.y0,g.nodata], [6,5,0.5,0.5,836750,822200,-9999]);
  assert.deepStrictEqual(gridBounds(g), [836750, 822197.5, 836753, 822200]);
  for (let r=0;r<5;r++) for (let c=0;c<6;c++)                // every cell landed in the right place
    assert.strictEqual(g.data[r*6+c], (c===5 && r===0) ? -9999 : 100+c+10*r);
  const at=(c,r)=>sampleGrid(g, 836750+(c+0.5)*0.5, 822200-(r+0.5)*0.5);   // centre of cell (c,r)
  assert.ok(near(at(2,3), 132));
  assert.ok(near(at(2.5,3.5), 137.5));                       // halfway between four cells
  assert.ok(near(sampleGrid(g, 836750.01, 822197.51), 140)); // outer half-cell holds the edge value
  assert.strictEqual(sampleGrid(g, 836749.9, 822199), null); // off the tile
  assert.strictEqual(sampleGrid(g, 836754, 822199), null);
  assert.strictEqual(at(4.5,0), null);                       // touches the no-data cell
}
assert.throws(()=>parseDtmTiff(new ArrayBuffer(64)), /Not a TIFF/);

// A real tile, when a path is given
const real=process.argv[2];
if (real){
  const f=readFileSync(real), g=parseDtmTiff(f.buffer.slice(f.byteOffset, f.byteOffset+f.byteLength));
  let lo=Infinity, hi=-Infinity, bad=0;
  for (const v of g.data){ if (v===g.nodata){ bad++; continue; } if (v<lo) lo=v; if (v>hi) hi=v; }
  assert.ok(g.w>0 && g.dx===0.5 && lo>-100 && hi<1000, 'levels should look like mPD');
  console.log(`real tile: ${g.w}×${g.h} cells of ${g.dx} m, E ${gridBounds(g)[0]}–${gridBounds(g)[2]}, N ${gridBounds(g)[1]}–${gridBounds(g)[3]}, `+
    `levels ${lo.toFixed(2)} to ${hi.toFixed(2)} mPD, ${bad} no-data cell(s)`);
}
console.log('test_lidar_tile: all checks passed');
