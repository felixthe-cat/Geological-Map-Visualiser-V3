// ================================================================
// GeoVisualise — worked example datasets for the Import / export CSV panel.
//
// These are REAL ground-investigation records transcribed from a published
// site-investigation report, not invented numbers. Each is stored in the
// project-CSV format (the same file "⬇ Download project CSV" produces), so an
// example loads with its grades and coordinates intact and can be re-exported.
//
// Depths are below ground level; the source tables give mPD levels, so
//   depth = ground level − level
// The transcription is checked against the source's own published thicknesses
// and rockhead levels by web/test_examples.mjs.
// ================================================================

// Hillside drillholes DH 3–DH 6 (HK1980 grid ≈ E829000 / N827500, Tsuen Wan area).
// Source table columns: Ground Level, Fill/Concrete, Colluvium, Residual Soil,
// "Grade V to Grade IV Rock", "Grade III or better Rock Top Level", Rock Type, End of Hole.
//
// Two transcription decisions worth knowing:
//  * The report does NOT split Grade V from Grade IV — it publishes one combined
//    band — so it is kept as a single undivided layer with no grade numeral
//    rather than inventing a split. It therefore does not count as rockhead,
//    which is correct: rockhead is Grade III or better.
//  * "Grade III or better" is tagged `III`, so the Rock Contour tab's rockhead
//    comes out at exactly the level the report states.
const HILLSIDE_TUFF = `#GEOVIS {"v":1,"mode":"depth","bounds":null,"sectionLine":null}
borehole_id,x,y,ground_level,kind,surface,top_depth,base_depth,grade
DH 3,829001.64,827502.52,178.57,BH,Fill / Concrete,0,1.6,
DH 3,829001.64,827502.52,178.57,BH,Grade V to IV rock (undivided),1.6,14.16,
DH 3,829001.64,827502.52,178.57,BH,Grade III or better rock (TUFF BRECCIA),14.16,15.01,III
DH 4,829015.24,827503.6,176.28,BH,Fill / Concrete,0,1.3,
DH 4,829015.24,827503.6,176.28,BH,Colluvium,1.3,3.5,
DH 4,829015.24,827503.6,176.28,BH,Grade V to IV rock (undivided),3.5,20.22,
DH 4,829015.24,827503.6,176.28,BH,Grade III or better rock (TUFF BRECCIA),20.22,26.03,III
DH 5,829036.19,827484.26,171.34,BH,Fill / Concrete,0,2.3,
DH 5,829036.19,827484.26,171.34,BH,Colluvium,2.3,6.75,
DH 5,829036.19,827484.26,171.34,BH,Grade V to IV rock (undivided),6.75,22.43,
DH 5,829036.19,827484.26,171.34,BH,Grade III or better rock (SILTSTONE / Coarse ash TUFF),22.43,27.99,III
DH 6,829002.5,827546,187.35,BH,Fill / Concrete,0,0.1,
DH 6,829002.5,827546,187.35,BH,Colluvium,0.1,2,
DH 6,829002.5,827546,187.35,BH,Grade V to IV rock (undivided),2,36.59,
DH 6,829002.5,827546,187.35,BH,Grade III or better rock (TUFF BRECCIA),36.59,41.76,III
`;

export const EXAMPLES = [
  {
    id: 'hillside-tuff',
    name: 'Hillside drillholes DH 3–DH 6 (tuff breccia, rockhead +149 to +164 mPD)',
    note: '4 drillholes on a Tsuen Wan hillside, ground level +171 to +187 mPD. '
        + 'Fill/concrete over colluvium over Grade V–IV rock, on tuff breccia / siltstone. '
        + 'Rockhead (Grade III or better) is proved in every hole, so the Rock Contour '
        + 'tab works on it. Transcribed from a published site-investigation report.',
    csv: HILLSIDE_TUFF
  }
];

export const exampleById = id => EXAMPLES.find(e => e.id === id) || null;
