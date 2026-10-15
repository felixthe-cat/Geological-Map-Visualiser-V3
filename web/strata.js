// ================================================================
// GeoVisualise — stratum classes, labels and colours (pure, shared by the
// 2D builder and the 3D block builder so both colour a layer the same way).
// ================================================================

// ---- stratum colours -------------------------------------------------
export const PALETTE = {
  fill:'#c9b98f', 'made ground':'#c9b98f', topsoil:'#7a5c33', soil:'#caa460',
  colluvium:'#b98c46', alluvium:'#d9c56b', marine:'#8fb0a8', clay:'#9c7b4d',
  silt:'#a89968', sand:'#e0c56e', gravel:'#b7a06a',
  cdg:'#d8a24a', hdg:'#b5762e', mdg:'#8f5a24', sdg:'#6f4620',
  granite:'#8a8f98', bedrock:'#6b7079', rock:'#6b7079', tuff:'#7d838c'
};
export function colourFor(surface){
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
export const GRADE_LABEL = { VI:'Grade VI · Residual Soil', V:'Grade V · Completely Decomposed',
  IV:'Grade IV · Highly Decomposed', III:'Grade III · Moderately Decomposed',
  II:'Grade II · Slightly Decomposed', I:'Grade I · Fresh Rock' };
export const GRADE_COLOUR = { VI:'#a9743a', V:'#d8a24a', IV:'#c07d2e', III:'#9a6a2c',
  II:'#8a8f98', I:'#5b6068' };
export function gradeRoman(grade){ const m=/^(VI|IV|III|II|V|I)\b/.exec((grade||'').trim()); return m?m[1]:''; }
export function classKey(l){ const r=gradeRoman(l.grade); return r ? ('G'+r) : (l.surface||''); }
export function classLabel(l){ const r=gradeRoman(l.grade); return r ? GRADE_LABEL[r] : (l.surface||'(unnamed)'); }
export function classColour(l){ const r=gradeRoman(l.grade); return r ? GRADE_COLOUR[r] : colourFor(l.surface); }
