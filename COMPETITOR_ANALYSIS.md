# Competitor Analysis & Feature Roadmap

> Analysis of **Subcores** (https://www.subcores.com) vs **Geological Map Visualiser V3**, plus the
> features we should adopt. Searched the repo first — no existing feature-list markdown existed, so this
> file is the canonical one. Related planning doc: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
>
> _Last updated: 2026-07-23._

---

## 1. What Subcores is

A **borehole-log-first SaaS** for geotechnical/geological professionals. Next.js on Vercel, Google/email
auth, cloud project storage, freemium with a **"Professional+"** paid tier. Beta v1.10.5, UK-based
(~500 logs / ~50 engineers self-reported).

Pages discovered: `/` (landing), `/demo` (6-step walkthrough), `/app/borehole-builder` (auth-gated tool),
`/dashboard` (project list), `/login` (Google + email), `/about`, `/terms`, `/privacy`.

Workflow: manually enter borehole (ID, coords, GL, depth) → type stratigraphy layers (depth ranges,
descriptions, colours, classifications) with **live schematic preview** → add samples + water strikes →
select boreholes → **2D cross-section** (IDW, vertical exaggeration) → **3D model** (IDW, gated behind
Professional+) → export PNG / PDF / interactive HTML / JSON.

## 2. Feature comparison

| Capability | Subcores | Our V3 |
|---|---|---|
| Primary input | Manual data entry | **File upload: AGS4 + CSV** ✅ |
| Government open-data integration | ❌ | **CSDI WFS DB, offline SQLite, bbox search** ✅✅ |
| Interpolation engine | IDW (distance-weighted) | **GemPy co-kriging (Leapfrog-grade)** ✅✅ |
| 2D borehole log / schematic | ✅✅ core strength | ❌ (being added — prototype) |
| 2D cross-sections | ✅ w/ vertical exaggeration | ❌ (being added — prototype) |
| 3D model | ✅ (IDW, gated) | ✅✅ (GemPy volumetric + interfaces, free) |
| Interactive site map / basemaps | ❌ | **Folium, Google Hybrid/ESRI/OSM** ✅ |
| Export | PNG, PDF, interactive HTML, JSON | GLB, VTK, PNG |
| User accounts / cloud save | ✅✅ | ❌ stateless session |
| Multi-project management | ✅ dashboard | ❌ |
| Monetisation | ✅ freemium + Professional+ | ❌ free |
| Geographic scope | Generic (UK-oriented) | **Hong Kong CEDD-specialised** |
| Hosting | Next.js on Vercel | Gradio on HF Spaces + Vercel landing |

**Core insight:** inverted strengths. Subcores is weak where we're strong (ingestion, government data,
interpolation quality, mapping) and strong where we're weak (the everyday **2D borehole log**, accounts,
persistence, monetisation). Our engineering is deeper; their product is more complete.

## 3. Features to adopt (ranked)

**Tier 1 — highest leverage**
1. **2D borehole log / schematic generator.** Their killer feature, our biggest gap. Engineers draw logs
   daily; 3D is occasional. We already ingest all the data (LOCA + GEOL) — just render it as a vertical
   log. → **Prototype delivered:** `web/builder.html`.
2. **2D cross-section view.** Extracting a section between selected boreholes is nearly free from data we
   already have; every report needs one. → **Prototype delivered:** `web/builder.html`.

**Tier 2 — product maturity**
3. **Interactive HTML export** — wrap the GLB in a self-contained `<model-viewer>` page; email a client an
   interactive 3D model with no software. Low effort.
4. **Project persistence / accounts** — only if commercialising. State lives on the Vercel/JS side + a DB
   (Supabase/Postgres), NOT on HF (HF stays a stateless compute endpoint).

**Tier 3 — deliberately skip**
- Their IDW interpolation (ours is better — don't downgrade).
- Their manual-only data entry (our file upload + CSDI is superior).
- Freemium tiering (only if commercialising).

**Do NOT abandon our moats:** CSDI integration + AGS ingestion are things Subcores lacks and are hard to
replicate. Lead with them.

## 4. Architecture: Hugging Face vs alternatives

**Why Subcores can be pure Vercel and we can't (easily):** their IDW interpolation is light enough to run
**client-side in JS**, so their backend does nothing heavy — a static/serverless Next.js app + a DB for
accounts. Vercel serverless caps at ~10–60s with no persistent process.

**We run GemPy** — co-kriging + heavy native deps (gempy, pyvista, trimesh, scipy), 5–30s per model. This
**cannot** run in the browser or in a Vercel function. It needs a **persistent Python process** — exactly
what HF Spaces gives us free.

**Recommendation — hybrid (what we're building toward):**

```
Vercel / JS  →  landing page + borehole input + location selection + 2D log + 2D cross-section
   │
   └── send borehole CSV ──►  HF Spaces (Gradio + GemPy)  = heavy 3D compute only
```

- Keep **GemPy 3D on HF Spaces** — don't try to move it to Vercel; you can't.
- Build the **light, everyday features (2D log, cross-section, input, location) in the JS layer** so they
  render instantly with no HF cold-start.
- If accounts/saved projects are ever wanted, that state lives on the **Vercel side + a DB**, not HF.
- HF's real limits: free Spaces **sleep** (first visitor waits ~30s cold start), **no per-user auth/DB**,
  **shared CPU** under load. Fine for a free tool; a paid SaaS would outgrow it.
- **Only leave HF** if commercialising (need no cold starts) or outgrowing free CPU → move the same
  Gradio/GemPy app to a small always-on container (Fly.io / Render / Railway / cheap VPS).

**Bottom line:** HF Spaces is right *for the GemPy engine* and wrong *for accounts / 2D logs / instant UX*.
The lesson from Subcores isn't "leave Hugging Face" — it's "push the light everyday features into the
Vercel/JS layer and keep HF as the specialist heavy-compute backend."

## 5. Prototype status (2026-07-23)

`web/builder.html` + `web/builder.js` — vanilla JS (drops into existing Vercel `web/` deploy; upgradeable
to Next.js later):
- Borehole data input (CSV contract: `borehole_id, x, y, surface, top_depth, base_depth, ground_level`).
- **2D borehole log / schematic** (SVG, per-borehole, colour-by-stratum, PNG export).
- **2D cross-section** with interpolated boundary bands + vertical exaggeration (SVG, PNG export).
- **Two-way pipeline:** "Send to Hugging Face" ships the same dataset to the live Space's `build_model`
  endpoint (added `api_name="build_model"` in `app.py`) for heavy 3D modelling.
