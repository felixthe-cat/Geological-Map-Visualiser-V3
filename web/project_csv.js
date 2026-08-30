// ================================================================
// GeoVisualise — project save / resume format (pure, Node-testable).
//
// One CSV that round-trips a whole session with NO loss:
//   line 1  `#GEOVIS {json}` — mode, site boundary, section line
//   line 2  header, then one row per layer with the borehole's own fields
// Fields are RFC4180-quoted, so commas, quotes and stray newlines inside a
// stratum description survive the round trip (they used to be stripped).
//
// Self-check:  node web/test_project_csv.mjs
// ================================================================

const COLS = ['borehole_id','x','y','ground_level','kind','surface','top_depth','base_depth','grade'];
const LEGACY = ['borehole_id','x','y','surface','top_depth','base_depth','ground_level'];

function q(v){
  const s = v==null ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
function num(v){ return Number.isFinite(+v) ? +v : 0; }

/** Split one CSV line, honouring quotes. Returns raw string cells. */
export function splitCSVLine(line){
  const out=[]; let cur='', inQ=false;
  for (let i=0;i<line.length;i++){
    const c=line[i];
    if (inQ){
      if (c==='"'){ if (line[i+1]==='"'){ cur+='"'; i++; } else inQ=false; }
      else cur+=c;
    } else if (c==='"'){ inQ=true; }
    else if (c===','){ out.push(cur); cur=''; }
    else cur+=c;
  }
  out.push(cur);
  return out;
}

/** Split a CSV body into logical rows, keeping newlines inside quoted fields. */
function splitRows(text){
  const rows=[]; let cur='', inQ=false;
  for (let i=0;i<text.length;i++){
    const c=text[i];
    if (c==='"'){
      if (inQ && text[i+1]==='"'){ cur+='""'; i++; }     // escaped quote stays inside the cell
      else { inQ=!inQ; cur+='"'; }
      continue;
    }
    if (!inQ && (c==='\n' || c==='\r')){
      if (c==='\r' && text[i+1]==='\n') i++;
      rows.push(cur); cur=''; continue;
    }
    cur+=c;
  }
  if (cur.length) rows.push(cur);
  return rows.filter(r=>r.length);
}

/**
 * @param state  {boreholes:[{id,x,y,gl,kind,layers:[{surface,top,base,grade}]}], mode, sitePlan}
 * @param sectionLine {a:[lat,lng], b:[lat,lng]} | null
 * @param extras {section?:object, excluded?:string[], annots?:object[]} — the
 *   whole cross-section setup: every option control's value, the boreholes the
 *   user manually deselected, and any drawn annotations. Kept in the same
 *   `#GEOVIS` header line so one file — and therefore one cloud row — still
 *   restores the entire project in one go.
 */
export function stateToProjectCSV(state, sectionLine, extras){
  const e = extras || {};
  const meta = { v:2, mode:state.mode,
    bounds:(state.sitePlan && state.sitePlan.bounds) || null,
    sectionLine: sectionLine || null,
    section: e.section || null,
    excluded: e.excluded && e.excluded.length ? e.excluded : null,
    annots: e.annots && e.annots.length ? e.annots : null };
  let out = '#GEOVIS '+JSON.stringify(meta)+'\n' + COLS.join(',') + '\n';
  for (const bh of state.boreholes)
    for (const l of bh.layers)
      out += [bh.id, bh.x, bh.y, bh.gl, bh.kind||'BH', l.surface, l.top, l.base, l.grade||''].map(q).join(',')+'\n';
  return out;
}

/** Plain 7-column CSV (the Import/export CSV textbox format). */
export function csvToBoreholes(text){
  const rows = splitRows(text).filter(r=>r.trim());
  if (!rows.length) throw new Error('No data.');
  const header = splitCSVLine(rows[0]).map(s=>s.trim().toLowerCase());
  const ix = n => header.indexOf(n);
  for (const c of LEGACY) if (ix(c)<0) throw new Error('Missing column: '+c);
  const map={};
  for (let i=1;i<rows.length;i++){
    const p=splitCSVLine(rows[i]);
    if (p.length < LEGACY.length) continue;
    const id=(p[ix('borehole_id')]||'').trim(); if(!id) continue;
    if (!map[id]) map[id]={ id, x:num(p[ix('x')]), y:num(p[ix('y')]),
      gl:num(p[ix('ground_level')]), kind:'BH', layers:[] };
    map[id].layers.push({ surface:(p[ix('surface')]||'').trim(),
      top:num(p[ix('top_depth')]), base:num(p[ix('base_depth')]), grade:'' });
  }
  const arr=Object.values(map);
  arr.forEach(bh=>bh.layers.sort((a,b)=>a.top-b.top));
  if (!arr.length) throw new Error('No boreholes parsed.');
  return arr;
}

/** @returns {boreholes, mode, bounds, sectionLine, section, excluded, annots} — `mode`/`bounds`/`sectionLine`
 *  are null/undefined for a legacy 7-column CSV with no #GEOVIS header, and
 *  `section`/`excluded`/`annots` are null for a v1 file. */
export function projectCSVToState(text){
  const rows = splitRows(text);
  if (!rows.length) throw new Error('Empty file.');
  let i=0, meta=null;
  if (rows[0].startsWith('#GEOVIS')){
    try{ meta=JSON.parse(rows[0].slice(rows[0].indexOf('{'))); }catch{}
    i=1;
  }
  const header = splitCSVLine(rows[i]).map(s=>s.trim().toLowerCase()); i++;
  const ix = n => header.indexOf(n);
  if (ix('kind')<0 && ix('grade')<0)                       // legacy 7-column CSV
    return { boreholes: csvToBoreholes(rows.slice(i-1).join('\n')), mode:null, bounds:null,
             sectionLine:null, section:null, excluded:null, annots:null };
  const map={};
  for (; i<rows.length; i++){
    const p=splitCSVLine(rows[i]);
    if (p.length < 8) continue;
    const id=(p[ix('borehole_id')]||'').trim(); if(!id) continue;
    if (!map[id]) map[id]={ id, x:num(p[ix('x')]), y:num(p[ix('y')]), gl:num(p[ix('ground_level')]),
      kind:(ix('kind')>=0?(p[ix('kind')]||'').trim():'')||'BH', layers:[] };
    map[id].layers.push({ surface:(p[ix('surface')]||'').trim(), top:num(p[ix('top_depth')]),
      base:num(p[ix('base_depth')]), grade:(ix('grade')>=0?(p[ix('grade')]||'').trim():'') });
  }
  const arr=Object.values(map);
  arr.forEach(bh=>bh.layers.sort((a,b)=>a.top-b.top));
  if (!arr.length) throw new Error('No boreholes parsed.');
  return { boreholes:arr, mode:(meta&&meta.mode)||null, bounds:(meta&&meta.bounds)||null,
           sectionLine:(meta&&meta.sectionLine)||null,
           section:(meta&&meta.section)||null,
           excluded:(meta&&meta.excluded)||null,
           annots:(meta&&meta.annots)||null };
}
