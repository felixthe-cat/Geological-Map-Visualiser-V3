// Which LiDAR sheets hold boreholes with digital AGS data — the only places the 3D builder can
// make geology, so the only LiDAR worth hosting. Reads every borehole station from the CSDI
// layer (331k, ~2 min), keeps those whose report is in web/data/ags_repnos.json.
//   node tools/lidar_ags_sheets.mjs <out.json> [minHoles=1] [cached stations.csv]
// Output: { sheets:["49_36.hkdt", …], holes:[[e,n], …] } (the AGS borehole positions).
import fs from 'node:fs';
import { sheetName } from '../web/lidar_tile.js';

const [outPath, minArg='1', cache]=process.argv.slice(2);
if (!outPath){ console.error('usage: node tools/lidar_ags_sheets.mjs <out.json> [minHoles] [stations.csv]'); process.exit(1); }
const B='https://portal.csdi.gov.hk/server/rest/services/common/cedd_rcd_1636517845149_16420/FeatureServer/0/query';

async function stations(){
  if (cache && fs.existsSync(cache)) return fs.readFileSync(cache,'utf8').split('\n').map(l=>l.split(','));
  const { count }=await (await fetch(`${B}?where=1%3D1&returnCountOnly=true&f=json`)).json();
  const page=async i=>{
    const q=new URLSearchParams({ where:'1=1', outFields:'REPNO,E_COORD,N_COORD', returnGeometry:'false',
      orderByFields:'OBJECTID', resultOffset:String(i*3000), resultRecordCount:'3000', f:'json' });
    for (let t=0;;t++){
      // The portal drops the odd request under load: retry a few times before giving up on the run.
      try { return (await (await fetch(`${B}?${q}`)).json()).features.map(f=>[f.attributes.REPNO, f.attributes.E_COORD, f.attributes.N_COORD]); }
      catch(err){ if (t>=3) throw err; await new Promise(r=>setTimeout(r,2000)); }
    }
  };
  const rows=[];
  for (let i=0;i<Math.ceil(count/3000);i+=8) (await Promise.all([...Array(8).keys()].map(k=>i+k<Math.ceil(count/3000) ? page(i+k) : []))).forEach(p=>rows.push(...p));
  if (cache) fs.writeFileSync(cache, rows.map(r=>r.join(',')).join('\n'));
  return rows;
}

const ags=new Set(JSON.parse(fs.readFileSync('web/data/ags_repnos.json','utf8')));
const count=new Map(), holes=[];
for (const [rep, e, n] of await stations()){
  if (!ags.has(String(rep)) || !Number.isFinite(+e) || !Number.isFinite(+n)) continue;
  const s=sheetName(+e, +n); count.set(s, (count.get(s)||0)+1); holes.push([Math.round(+e), Math.round(+n)]);
}
const sheets=[...count].filter(([,k])=>k>=+minArg).map(([s])=>s).sort();
// holes go along so the packer can keep 0.5 m only near them
fs.writeFileSync(outPath, JSON.stringify({ sheets, holes }));
console.log(`${holes.length} AGS boreholes → ${sheets.length} sheet(s) with ≥${minArg} of them`);
