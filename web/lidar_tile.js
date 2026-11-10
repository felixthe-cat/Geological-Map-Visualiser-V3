// CEDD 2020 LiDAR ground model tiles ("RASTER-DTM" product from sdportal.cedd.gov.hk):
// one GeoTIFF per 1:1000 map sheet, 1500 × 1200 cells of 0.5 m, 32-bit float levels in
// mPD on the HK1980 grid, uncompressed, no-data = -9999.
//
// Pure (no DOM, no network) so Node can test it: node web/test_lidar_tile.mjs
//
// ponytail: reads exactly that flavour of TIFF (classic, uncompressed, float32, tiles
// or strips). Anything else is refused with a plain message. Swap in geotiff.js if
// CEDD ever ships compressed tiles.

/** @returns { w, h, dx, dy, x0, y0 (outer top-left corner, E/N), nodata, data:Float32Array(w*h) } */
export function parseDtmTiff(buf){
  const dv=new DataView(buf);
  const bom=dv.byteLength>8 ? dv.getUint16(0, true) : 0;
  if (bom!==0x4949 && bom!==0x4d4d) throw new Error('Not a TIFF file.');
  const le=bom===0x4949;
  if (dv.getUint16(2, le)!==42) throw new Error('Not a standard TIFF file.');
  const ifd=dv.getUint32(4, le), tags=new Map();
  const SIZE={ 1:1, 2:1, 3:2, 4:4, 12:8 };                   // byte, ascii, short, long, double
  for (let i=0, n=dv.getUint16(ifd, le); i<n; i++){
    const p=ifd+2+12*i, type=dv.getUint16(p+2, le), count=dv.getUint32(p+4, le);
    // a value that fits in 4 bytes sits in the entry itself; otherwise the entry holds its address
    tags.set(dv.getUint16(p, le), { type, count, at:(SIZE[type]||9)*count<=4 ? p+8 : dv.getUint32(p+8, le) });
  }
  const get=t=>{
    const g=tags.get(t); if (!g) return null;
    const out=[];
    for (let k=0;k<g.count;k++) out.push(
      g.type===3 ? dv.getUint16(g.at+2*k, le) : g.type===4 ? dv.getUint32(g.at+4*k, le) :
      g.type===12 ? dv.getFloat64(g.at+8*k, le) : dv.getUint8(g.at+k));
    return out;
  };
  const num=(t, d)=>get(t)?.[0] ?? d;
  const w=num(256), h=num(257);
  if (!w || !h || num(258)!==32 || num(339)!==3 || num(259, 1)!==1 || num(277, 1)!==1)
    throw new Error('Expected an uncompressed 32-bit DTM GeoTIFF (the "RASTER-DTM" product).');
  const scale=get(33550), tie=get(33922);
  if (!scale || !tie) throw new Error('This TIFF has no map position in it (not a GeoTIFF).');

  const data=new Float32Array(w*h);
  const block=(off, bw, bh, ox, oy)=>{                       // copy one tile / strip, cropping the padding at the edges
    for (let r=0; r<bh && oy+r<h; r++) for (let c=0; c<bw && ox+c<w; c++)
      data[(oy+r)*w+ox+c]=dv.getFloat32(off+4*(r*bw+c), le);
  };
  if (tags.has(324)){
    const tw=num(322), th=num(323), offs=get(324), across=Math.ceil(w/tw);
    offs.forEach((o,i)=>block(o, tw, th, (i%across)*tw, Math.floor(i/across)*th));
  } else {
    const rps=num(278, h), offs=get(273);
    if (!offs) throw new Error('This TIFF has no image data.');
    offs.forEach((o,i)=>block(o, w, rps, 0, i*rps));
  }
  const nd=get(42113);
  const nodata=nd ? parseFloat(String.fromCharCode(...nd)) : -9999;
  // tiepoint: raster (i,j) -> map (x,y); pixel scale: cell size. Cells are areas, so this is the outer corner.
  return { w, h, dx:scale[0], dy:scale[1], x0:tie[3]-tie[0]*scale[0], y0:tie[4]+tie[1]*scale[1],
           nodata:Number.isFinite(nodata) ? nodata : -9999, data };
}

/** [eMin, nMin, eMax, nMax] of a parsed tile. */
export const gridBounds = g => [g.x0, g.y0-g.h*g.dy, g.x0+g.w*g.dx, g.y0];

/** Level at (e,n) by bilinear interpolation between cell centres; null outside the tile or next to a no-data cell. */
export function sampleGrid(g, e, n){
  let fx=(e-g.x0)/g.dx-0.5, fy=(g.y0-n)/g.dy-0.5;
  if (fx<-0.5 || fy<-0.5 || fx>g.w-0.5 || fy>g.h-0.5) return null;
  fx=Math.min(g.w-1, Math.max(0, fx)); fy=Math.min(g.h-1, Math.max(0, fy));   // outer half-cell: hold the edge value
  const c0=Math.floor(fx), r0=Math.floor(fy), c1=Math.min(g.w-1, c0+1), r1=Math.min(g.h-1, r0+1);
  const a=g.data[r0*g.w+c0], b=g.data[r0*g.w+c1], c=g.data[r1*g.w+c0], d=g.data[r1*g.w+c1];
  if (a===g.nodata || b===g.nodata || c===g.nodata || d===g.nodata) return null;
  const tx=fx-c0, ty=fy-r0;
  return (a*(1-tx)+b*tx)*(1-ty)+(c*(1-tx)+d*tx)*ty;
}
