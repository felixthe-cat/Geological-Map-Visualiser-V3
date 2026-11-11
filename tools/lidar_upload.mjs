// Upload packed LiDAR sheets (tools/lidar_pack.mjs) to the public Supabase Storage bucket "lidar",
// which web/builder3d.js reads. Needs the project's service_role key (Supabase dashboard →
// Project Settings → API keys). Keep it out of git: put it in .env.local as
//   SUPABASE_SERVICE_ROLE_KEY=...
// then:  node --env-file=.env.local tools/lidar_upload.mjs "<packed folder>"
// Re-running skips files already there (same size), so a dropped connection costs nothing.
import fs from 'node:fs'; import path from 'node:path';
import { SUPABASE_URL } from '../web/supabase_config.js';

const dir=process.argv[2], key=process.env.SUPABASE_SERVICE_ROLE_KEY, BUCKET='lidar';
if (!dir || !key){ console.error('usage: SUPABASE_SERVICE_ROLE_KEY=… node tools/lidar_upload.mjs <packed folder>'); process.exit(1); }
const H={ Authorization:`Bearer ${key}`, apikey:key };

// Public bucket, 2 MB per file cap (a packed 0.5 m sheet is ~1 MB) so nothing big lands by mistake.
const mk=await fetch(`${SUPABASE_URL}/storage/v1/bucket`, { method:'POST', headers:{ ...H, 'Content-Type':'application/json' },
  body:JSON.stringify({ id:BUCKET, name:BUCKET, public:true, file_size_limit:2*1024*1024 }) });
if (!mk.ok && !/already exists|Duplicate/i.test(await mk.text())) throw new Error('could not create the bucket: '+mk.status);

// What is there already (name -> size)
const have=new Map();
for (let off=0;;off+=1000){
  const r=await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, { method:'POST', headers:{ ...H, 'Content-Type':'application/json' },
    body:JSON.stringify({ prefix:'', limit:1000, offset:off }) });
  const page=await r.json(); if (!Array.isArray(page) || !page.length) break;
  for (const o of page) have.set(o.name, o.metadata?.size);
}

// index.json last, so the page never lists a sheet that is not uploaded yet
const files=fs.readdirSync(dir).filter(f=>f.endsWith('.hkdt')).sort().concat('index.json');
let sent=0, kept=0, bytes=0; const bad=[];
async function put(f){
  const body=fs.readFileSync(path.join(dir,f));
  if (f!=='index.json' && have.get(f)===body.length){ kept++; return; }
  for (let t=0;;t++){
    // Network blips are normal over ~2,000 uploads: retry a couple of times, then report and move on.
    const r=await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${f}`, { method:'POST', body,
      headers:{ ...H, 'x-upsert':'true', 'cache-control':f==='index.json' ? 'max-age=300' : 'max-age=31536000',
                'Content-Type':f==='index.json' ? 'application/json' : 'application/octet-stream' } });
    if (r.ok){ sent++; bytes+=body.length; return; }
    if (t>=2){ bad.push(`${f}: ${r.status} ${await r.text()}`); return; }
  }
}
const sheets=files.slice(0,-1);
for (let i=0;i<sheets.length;i+=8){
  await Promise.all(sheets.slice(i,i+8).map(put));
  if ((i/8)%25===0) console.log(`${Math.min(i+8,sheets.length)}/${sheets.length}`);
}
if (!bad.length) await put('index.json'); else console.log('index.json NOT uploaded until every sheet is in');
console.log(`uploaded ${sent} (${(bytes/1e9).toFixed(3)} GB), already there ${kept}`);
if (bad.length) console.log('failed:\n  '+bad.join('\n  '));
