import os
import gradio as gr
import pandas as pd
import numpy as np

from src.ingest_ags import ingest_ags
from src.ingest_csv import ingest_csv
from src.to_surface_points import generate_surface_and_orientation_points
from src.model import build_and_compute_model
from src.export import export_to_glb, export_solids_to_glb, export_to_vtk, export_to_png
from src.map_view import generate_site_map
from src import csdi_client

# Path to the local borehole spatial index database
CSDI_DB_PATH = os.path.join("data", "gi_spatial_index.sqlite")

# Sample files paths
SAMPLE_AGS_PATH = os.path.join("examples", "sample.ags")
SAMPLE_CSV_PATH = os.path.join("examples", "sample_boreholes.csv")

# Custom CSS for rich visual aesthetics — cream/forest-green/gold palette matching Vercel frontend
CUSTOM_CSS = """
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,700;1,300&family=Space+Grotesk:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap');

/* ── Page foundation ── */
body,
.gradio-container,
.gradio-container > .main,
.gradio-container > .main > .wrap,
.gradio-container > .main > .wrap > .contain {
    background-color: #f0e9dc !important;
    font-family: 'Outfit', sans-serif !important;
    color: #1a1a0f !important;
}

/* ── Component cards — every block gets a white card with border ── */
.block {
    background-color: #fffdf8 !important;
    border: 1px solid #c8bda8 !important;
    border-radius: 12px !important;
    box-shadow: 0 2px 10px rgba(0,0,0,0.06) !important;
    padding: 1rem !important;
}
.block .block {
    background-color: #f7f2e8 !important;
    box-shadow: none !important;
}

/* ── Outer wrappers — transparent so the page bg shows ── */
.tabs, .tabitem, .gap, .form, .panel, .gr-box, .gr-panel {
    background-color: transparent !important;
    border-color: #c8bda8 !important;
}

/* ── Tab bar ── */
.tab-nav {
    background-color: #e8dfd0 !important;
    border-bottom: 2px solid #c8bda8 !important;
    border-radius: 10px 10px 0 0 !important;
    padding: 0 0.5rem !important;
}
.tab-nav button {
    background: transparent !important;
    color: #4a4a38 !important;
    border: none !important;
    font-family: 'Space Grotesk', sans-serif !important;
    font-weight: 500 !important;
    padding: 0.6rem 1rem !important;
}
.tab-nav button.selected {
    background: #3d6618 !important;
    color: #f5f0e8 !important;
    border-radius: 8px 8px 0 0 !important;
    font-weight: 700 !important;
}

/* ── Accordion headers — gold bar style ── */
details > summary,
.block > .label-wrap,
span.label-wrap {
    background-color: #f0e4c4 !important;
    border: 1px solid #c8a84a !important;
    border-radius: 8px !important;
    color: #2d2d18 !important;
    font-family: 'Space Grotesk', sans-serif !important;
    font-weight: 700 !important;
    padding: 0.55rem 0.85rem !important;
}

/* ── Component labels (slider names, checkbox labels) ── */
label > span,
.block label > span,
span[data-testid] {
    color: #2d2d18 !important;
    font-family: 'Space Grotesk', sans-serif !important;
    font-size: 0.84rem !important;
    font-weight: 600 !important;
    background: none !important;
    padding: 0 !important;
}

/* ── Info/hint text below sliders ── */
.block .info, span.info, .description {
    color: #6a6a50 !important;
    font-size: 0.78rem !important;
}

/* ── Markdown / prose ── */
.prose, .md, .gr-markdown, .block .prose {
    color: #1a1a0f !important;
    font-family: 'Outfit', sans-serif !important;
}
.prose h3, .md h3 { color: #2d5016 !important; font-family: 'Space Grotesk', sans-serif !important; }
.prose a, .md a    { color: #3d6618 !important; }
.prose hr, .md hr  { border-color: #c8bda8 !important; }

/* ── Inputs, textareas, number boxes ── */
input[type="text"], input[type="number"],
textarea, select,
.input-wrap, .wrap-inner,
.block input, .block textarea {
    background-color: #faf5eb !important;
    border: 1px solid #c8bda8 !important;
    border-radius: 8px !important;
    color: #1a1a0f !important;
    font-family: 'Outfit', sans-serif !important;
}
input[type="text"]:focus, input[type="number"]:focus, textarea:focus {
    border-color: #3d6618 !important;
    box-shadow: 0 0 0 3px rgba(61,102,24,0.15) !important;
    outline: none !important;
}

/* ── File upload drop zone ── */
.upload-container, [data-testid="drop-target"],
.file-preview-holder, .file-drop-area {
    background-color: #faf5eb !important;
    border: 2px dashed #b89a38 !important;
    border-radius: 10px !important;
    color: #4a4a38 !important;
}

/* ── Range sliders ── */
input[type="range"] { accent-color: #3d6618 !important; }

/* ── Checkboxes / radio buttons ── */
input[type="checkbox"], input[type="radio"] { accent-color: #3d6618 !important; }

/* ── Default (secondary) buttons ── */
button.lg, button.sm, button.secondary {
    background-color: #e8dfd0 !important;
    border: 1px solid #c8bda8 !important;
    color: #2d2d18 !important;
    font-family: 'Space Grotesk', sans-serif !important;
    font-weight: 600 !important;
    border-radius: 8px !important;
    transition: background 0.2s !important;
}
button.lg:hover, button.sm:hover, button.secondary:hover {
    background-color: #ddd4c0 !important;
}

/* ── Primary buttons ── */
button.primary {
    background: linear-gradient(135deg, #3d6618 0%, #5a8a22 100%) !important;
    border: none !important;
    color: #f5f0e8 !important;
    font-family: 'Space Grotesk', sans-serif !important;
    font-weight: 700 !important;
    border-radius: 8px !important;
}
button.primary:hover {
    box-shadow: 0 6px 18px rgba(61,102,24,0.35) !important;
    transform: translateY(-1px) !important;
}

/* ── Dropdown options list ── */
ul.options, .block ul {
    background-color: #faf5eb !important;
    border: 1px solid #c8bda8 !important;
    border-radius: 8px !important;
    color: #1a1a0f !important;
}
ul.options li:hover { background-color: #e8dfd0 !important; }

/* ── 3D model viewer ── */
model-viewer, .model3D {
    background-color: #f7f2e8 !important;
    border-radius: 10px !important;
    border: 1px solid #c8bda8 !important;
}

/* ── Gradio footer ── */
footer, .footer {
    background-color: #e8dfd0 !important;
    border-top: 1px solid #c8bda8 !important;
}

/* ── Toast notifications ── */
.toast-wrap { font-family: 'Outfit', sans-serif !important; }

/* ── App hero header — mirrors Vercel landing design ── */
.hf-app-hero {
    display: grid;
    grid-template-columns: 1fr 1.85fr;
    gap: 3rem;
    align-items: start;
    background-color: #f0e9dc;
    background-image: radial-gradient(circle, rgba(100,80,40,0.10) 1px, transparent 1px);
    background-size: 26px 26px;
    padding: 2.5rem 2rem 2rem;
    border-radius: 16px;
    border: 1px solid #c8bda8 !important;
    margin-bottom: 0.5rem;
    box-shadow: none !important;
}
@media (max-width: 860px) { .hf-app-hero { grid-template-columns: 1fr; gap: 1.5rem; } }

.hf-section-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(0,0,0,0.055);
    border: 1px solid rgba(0,0,0,0.11) !important;
    color: #4a4a38 !important;
    font-family: 'Space Grotesk', sans-serif !important;
    font-size: 0.75rem !important;
    font-weight: 600 !important;
    letter-spacing: 0.3px;
    padding: 0.28rem 0.75rem !important;
    border-radius: 999px !important;
    margin-bottom: 1.2rem;
    box-shadow: none !important;
}

.hf-app-title {
    font-family: 'Space Grotesk', sans-serif !important;
    font-size: clamp(1.7rem, 2.6vw, 2.5rem) !important;
    font-weight: 700 !important;
    color: #1a1a0f !important;
    line-height: 1.15 !important;
    letter-spacing: -0.5px;
    margin: 0 !important;
    background: none !important;
    border: none !important;
    padding: 0 !important;
    box-shadow: none !important;
}
.hf-app-title em {
    font-family: 'Cormorant Garamond', Georgia, serif !important;
    font-style: italic !important;
    font-weight: 600 !important;
    font-size: 1.08em !important;
    display: block;
    color: #4a4a38 !important;
    margin-top: 0.1em;
    background: none !important;
    padding: 0 !important;
    border: none !important;
}

.hf-counter-row {
    display: flex;
    align-items: flex-start;
    gap: 1.25rem;
    padding-top: 0.25rem;
}
.hf-counter {
    font-family: 'Space Grotesk', sans-serif !important;
    font-size: 2rem !important;
    font-weight: 700 !important;
    color: #1a1a0f !important;
    line-height: 1;
    white-space: nowrap;
    flex-shrink: 0;
}
.hf-counter small {
    font-size: 1rem !important;
    font-weight: 400 !important;
    color: #8a8a70 !important;
}
.hf-counter-desc {
    font-family: 'Outfit', sans-serif !important;
    font-size: 0.88rem !important;
    color: #4a4a38 !important;
    line-height: 1.65 !important;
    margin: 0 !important;
    background: none !important;
    border: none !important;
    box-shadow: none !important;
    padding: 0 !important;
}

/* ── Feature cards row (Vercel-style dark cards) ── */
.hf-feature-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1.1rem;
    margin-bottom: 0.5rem;
}
@media (max-width: 1100px) { .hf-feature-cards { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 560px)  { .hf-feature-cards { grid-template-columns: 1fr; } }

.hf-feature-card {
    position: relative;
    background: #0e1b06 !important;
    border-radius: 14px !important;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: transform 0.3s ease, box-shadow 0.3s ease;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15) !important;
    border: none !important;
    padding: 0 !important;
}
.hf-feature-card:hover {
    transform: translateY(-5px);
    box-shadow: 0 12px 36px rgba(0,0,0,0.22) !important;
}
.hf-feature-card-chip {
    position: absolute;
    top: 0.8rem;
    left: 0.8rem;
    z-index: 2;
    display: inline-flex;
    padding: 0.22rem 0.62rem;
    background: rgba(0,0,0,0.42);
    border: 1px solid rgba(255,255,255,0.18) !important;
    border-radius: 999px !important;
    font-family: 'Space Grotesk', sans-serif !important;
    font-size: 0.7rem !important;
    font-weight: 600 !important;
    color: rgba(255,255,255,0.80) !important;
    letter-spacing: 0.3px;
    backdrop-filter: blur(6px);
    box-shadow: none !important;
}
.hf-feature-card-visual {
    height: 170px;
    flex-shrink: 0;
}
.hf-fv-model {
    background:
        radial-gradient(ellipse 80% 65% at 42% 100%, rgba(75,138,22,0.95) 0%, transparent 62%),
        radial-gradient(ellipse 55% 45% at 72% 90%, rgba(55,108,15,0.75) 0%, transparent 55%),
        linear-gradient(180deg, #0a1804 0%, #182e08 55%, #0d2005 100%);
}
.hf-fv-map {
    background:
        radial-gradient(ellipse 75% 55% at 50% 100%, rgba(18,75,105,0.95) 0%, transparent 65%),
        radial-gradient(ellipse 55% 40% at 22% 85%, rgba(12,55,80,0.75) 0%, transparent 55%),
        linear-gradient(180deg, #050b10 0%, #0a1c28 55%, #060e18 100%);
}
.hf-fv-data {
    background:
        radial-gradient(ellipse 78% 55% at 55% 100%, rgba(118,88,18,0.95) 0%, transparent 62%),
        radial-gradient(ellipse 55% 40% at 25% 85%, rgba(92,68,10,0.75) 0%, transparent 55%),
        linear-gradient(180deg, #0d0a04 0%, #221808 55%, #180e02 100%);
}
.hf-feature-card-body {
    padding: 1rem 1rem 1.1rem;
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
}
.hf-feature-card-body h3 {
    font-family: 'Space Grotesk', sans-serif !important;
    font-size: 0.98rem !important;
    font-weight: 600 !important;
    color: rgba(255,255,255,0.92) !important;
    margin-bottom: 0.4rem !important;
    background: none !important;
}
.hf-feature-card-body p {
    font-family: 'Outfit', sans-serif !important;
    font-size: 0.78rem !important;
    color: rgba(255,255,255,0.48) !important;
    line-height: 1.55 !important;
    margin: 0 !important;
    background: none !important;
}
.generate-btn {
    background: linear-gradient(135deg, #3d6618 0%, #5a8a22 100%) !important;
    color: #f5f0e8 !important;
    font-weight: 700 !important;
    border: none !important;
    border-radius: 10px !important;
    font-size: 1.1rem !important;
    padding: 0.75rem 1.5rem !important;
    transition: all 0.3s ease !important;
    cursor: pointer;
}
.generate-btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 20px rgba(61, 102, 24, 0.35) !important;
}
.demo-btn {
    background-color: #ede6d8 !important;
    color: #3d3d25 !important;
    border: 1px solid #c8bda8 !important;
    font-weight: 600 !important;
    transition: all 0.2s ease !important;
}
.demo-btn:hover {
    background-color: #e0d8c8 !important;
    transform: translateY(-1px);
}
.assumptions-card {
    border-left: 4px solid #b89a38;
    background-color: #faf5eb;
    padding: 1.25rem;
    border-radius: 0 12px 12px 0;
    margin-top: 1.5rem;
}
.assumptions-card h4 {
    margin-top: 0;
    color: #3d6618;
    font-weight: 700;
}
.assumptions-card p {
    font-size: 0.95rem;
    color: #4a4a30;
    margin: 0;
    line-height: 1.5;
}
#viewer-container {
    position: relative;
}
.screenshot-btn {
    position: absolute;
    top: 5px;
    right: 50px;
    z-index: 10;
    min-width: 40px !important;
    height: 30px !important;
    padding: 0 8px !important;
    background-color: #faf5eb !important;
    border: 1px solid #c8bda8 !important;
    border-radius: 6px !important;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05) !important;
    font-size: 0.8rem !important;
    cursor: pointer !important;
}
.screenshot-btn:hover {
    background-color: #f9fafb !important;
    border-color: #9ca3af !important;
}
"""

def generate_model(
    file_obj, resolution, dip, azimuth, render_mode,
    z_scale, opacity, show_boreholes, show_grid, show_contours,
    clip_enabled, clip_axis, clip_pct
):
    """
    Main orchestration function running the processing and modeling pipeline.
    Computes GemPy model, caches it, and does the initial GLB exports.
    """
    if file_obj is None:
        raise gr.Error("Please upload an AGS or CSV file, or load a sample dataset first.")
        
    file_path = file_obj.name
    filename = os.path.basename(file_path).lower()
    
    # 1. Select correct ingestion parser based on extension
    gr.Info("Parsing borehole data...")
    try:
        if filename.endswith('.ags'):
            loca_df, geol_df = ingest_ags(file_path)
        elif filename.endswith('.csv'):
            loca_df, geol_df = ingest_csv(file_path)
        else:
            raise gr.Error("Unsupported file format. Please upload a .ags or .csv file.")
    except Exception as e:
        raise gr.Error(f"Ingestion failed: {e}")
        
    # 2. Transform coordinates & inject sub-horizontal orientations
    gr.Info("Computing 3D contact elevation coordinates...")
    try:
        sp_df, ori_df = generate_surface_and_orientation_points(
            loca_df=loca_df, 
            geol_df=geol_df,
            default_dip=float(dip),
            default_azimuth=float(azimuth)
        )
    except Exception as e:
        raise gr.Error(f"Coordinate transform failed: {e}")
        
    # 3. Build & Compute GemPy geological model
    gr.Info("Reconstructing 3D geological layers with GemPy (implicit interpolation)...")
    try:
        res_grid = [int(resolution), int(resolution), int(resolution)]
        model = build_and_compute_model(sp_df, ori_df, resolution=res_grid)
    except Exception as e:
        raise gr.Error(f"Modeling engine failed: {e}")
        
    # Cached state dictionary
    cached_state = {
        "model": model,
        "loca_df": loca_df,
        "geol_df": geol_df
    }
    
    # Unique stratum layers (surfaces)
    surfaces = [e.name for e in model.structural_frame.structural_elements if e.name != 'basement']
    
    # 4. Export artifacts using all visualization parameters
    gr.Info("Exporting 3D scenes & renders...")
    try:
        glb_interfaces_path = "geology_model_interfaces.glb"
        glb_solids_path = "geology_model_solids.glb"
        vtk_zip_path = "geology_model_vtk.zip"
        png_path = "geology_model_render.png"
        
        clipping_plane = {
            "enabled": clip_enabled,
            "axis": clip_axis,
            "position_pct": clip_pct
        }
        
        export_to_glb(
            model, 
            glb_interfaces_path,
            z_scale=float(z_scale),
            visible_layers=surfaces, # show all by default
            opacity=float(opacity),
            show_boreholes=show_boreholes,
            show_grid=show_grid,
            clipping_plane=clipping_plane,
            loca_df=loca_df,
            geol_df=geol_df,
            show_contours=show_contours
        )
        
        export_solids_to_glb(
            model, 
            glb_solids_path,
            z_scale=float(z_scale),
            visible_layers=surfaces, # show all by default
            opacity=float(opacity),
            show_boreholes=show_boreholes,
            show_grid=show_grid,
            clipping_plane=clipping_plane,
            loca_df=loca_df,
            geol_df=geol_df,
            show_contours=show_contours
        )
        
        export_to_vtk(model, vtk_zip_path)
        export_to_png(model, png_path)
        
        # Dynamic HTML legend generation matching colors in export.py
        from src.export import COLOR_HEX_PALETTE
        legend_items = []
        for i, name in enumerate(surfaces):
            color = COLOR_HEX_PALETTE[i % len(COLOR_HEX_PALETTE)]
            legend_items.append(f"""
            <div style="display: flex; align-items: center; gap: 8px; margin-right: 20px; margin-bottom: 8px;">
                <span style="display: inline-block; width: 18px; height: 18px; background-color: {color}; border-radius: 4px; border: 1px solid #555;"></span>
                <span style="font-weight: 600; font-size: 0.95rem; color: #374151; font-family: 'Outfit', sans-serif;">{name}</span>
            </div>
            """)
            
        legend_html_content = f"""
        <div style="margin-top: 10px; margin-bottom: 15px; padding: 12px; background-color: #faf5eb; border: 1px solid #d4c9a8; border-radius: 8px;">
            <h4 style="margin-top: 0; margin-bottom: 10px; color: #3d6618; font-weight: 700; font-size: 1rem; font-family: 'Outfit', sans-serif;">🏷️ Geological Legend</h4>
            <div style="display: flex; flex-wrap: wrap;">
                {"".join(legend_items)}
            </div>
        </div>
        """
        
        active_glb = glb_interfaces_path if render_mode == "Interface Contacts" else glb_solids_path
        
        gr.Info("Model ready!")
        return (
            active_glb, 
            legend_html_content, 
            png_path, 
            [glb_interfaces_path, glb_solids_path], 
            vtk_zip_path, 
            png_path, 
            cached_state,
            gr.update(choices=surfaces, value=surfaces) # Dynamic layers update
        )
        
    except Exception as e:
        raise gr.Error(f"Artifact export failed: {e}")

def update_visualisation(
    cached_state, render_mode, z_scale, visible_layers, opacity,
    show_boreholes, show_grid, show_contours, clip_enabled, clip_axis, clip_pct
):
    """
    Fast update function that re-exports the GLB and assets using cached model settings,
    avoiding recalculation of the GemPy interpolation engine.
    """
    if not cached_state or "model" not in cached_state:
        # Silently return if no model has been generated yet
        return None, "", None, [], None, None
        
    model = cached_state["model"]
    loca_df = cached_state["loca_df"]
    geol_df = cached_state["geol_df"]
    
    surfaces = [e.name for e in model.structural_frame.structural_elements if e.name != 'basement']
    
    glb_interfaces_path = "geology_model_interfaces.glb"
    glb_solids_path = "geology_model_solids.glb"
    vtk_zip_path = "geology_model_vtk.zip"
    png_path = "geology_model_render.png"
    
    clipping_plane = {
        "enabled": clip_enabled,
        "axis": clip_axis,
        "position_pct": clip_pct
    }
    
    export_to_glb(
        model, 
        glb_interfaces_path,
        z_scale=float(z_scale),
        visible_layers=visible_layers,
        opacity=float(opacity),
        show_boreholes=show_boreholes,
        show_grid=show_grid,
        clipping_plane=clipping_plane,
        loca_df=loca_df,
        geol_df=geol_df,
        show_contours=show_contours
    )
    
    export_solids_to_glb(
        model, 
        glb_solids_path,
        z_scale=float(z_scale),
        visible_layers=visible_layers,
        opacity=float(opacity),
        show_boreholes=show_boreholes,
        show_grid=show_grid,
        clipping_plane=clipping_plane,
        loca_df=loca_df,
        geol_df=geol_df,
        show_contours=show_contours
    )
    
    # HTML Legend (show checked layers)
    from src.export import COLOR_HEX_PALETTE
    legend_items = []
    for i, name in enumerate(surfaces):
        if name not in visible_layers:
            continue
        color = COLOR_HEX_PALETTE[i % len(COLOR_HEX_PALETTE)]
        legend_items.append(f"""
        <div style="display: flex; align-items: center; gap: 8px; margin-right: 20px; margin-bottom: 8px;">
            <span style="display: inline-block; width: 18px; height: 18px; background-color: {color}; border-radius: 4px; border: 1px solid #555;"></span>
            <span style="font-weight: 600; font-size: 0.95rem; color: #374151; font-family: 'Outfit', sans-serif;">{name}</span>
        </div>
        """)
        
    legend_html_content = f"""
    <div style="margin-top: 10px; margin-bottom: 15px; padding: 12px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
        <h4 style="margin-top: 0; margin-bottom: 10px; color: #1e3c72; font-weight: 700; font-size: 1rem; font-family: 'Outfit', sans-serif;">🏷️ Geological Legend</h4>
        <div style="display: flex; flex-wrap: wrap;">
            {"".join(legend_items)}
        </div>
    </div>
    """
    
    active_glb = glb_interfaces_path if render_mode == "Interface Contacts" else glb_solids_path
    
    return active_glb, legend_html_content, png_path, [glb_interfaces_path, glb_solids_path], vtk_zip_path, png_path

def load_selected_demo(choice):
    if choice == "Sample AGS (3 Boreholes)":
        return SAMPLE_AGS_PATH
    elif choice == "Sample CSV (3 Boreholes)":
        return SAMPLE_CSV_PATH
    elif choice == "Complex Site CSV (5 Boreholes, 5 Layers)":
        return "examples/sample_complex_site.csv"
    elif choice == "Pinch-out CSV (Lens Layer)":
        return "examples/sample_pinch_out.csv"
    return None

theme_soft = gr.themes.Soft(
    primary_hue="green",
    secondary_hue="yellow",
    neutral_hue="stone",
    font=[gr.themes.GoogleFont("Outfit"), "sans-serif"]
)

def build_model_from_csv(csv_text, resolution, dip, azimuth):
    """Headless API endpoint for the JS frontend (web/builder.js).

    Accepts raw CSV text instead of a file upload — this deliberately avoids the
    gr.File `file_types` gate, which rejects API-client uploads under Gradio 6.x.
    Writes the text to a temp .csv and reuses the full generate_model pipeline,
    returning just the GLB 3D scene(s).
    """
    import tempfile
    if not csv_text or not csv_text.strip():
        raise gr.Error("No CSV data received.")
    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="utf-8")
    tmp.write(csv_text)
    tmp.close()

    class _Upload:  # mimic the file object generate_model expects (.name)
        def __init__(self, name):
            self.name = name

    outputs = generate_model(
        _Upload(tmp.name), resolution, dip, azimuth, "Interface Separation Surfaces",
        1, 1, True, True, False, False, "X", 50
    )
    return outputs[3]  # download_glb (GLB file path[s])


def fetch_stratigraphy_api(repnos_json):
    """Headless endpoint for the JS site map: given a JSON array of CEDD report
    numbers (REPNO), byte-range fetch each report's AGS from the GEO Open Data
    archive and return its logged stratigraphy. See src/ags_open_data.py.

    Returns JSON: {repno: {station_id: {x, y, gl, layers:[{surface, top, base}]}}}
    Reports with no AGS/GEOL data are simply omitted.
    """
    import json
    from src.ags_open_data import get_stratigraphy
    try:
        repnos = json.loads(repnos_json) if repnos_json else []
    except Exception:
        raise gr.Error("Invalid repnos JSON.")
    if not isinstance(repnos, list):
        raise gr.Error("repnos must be a JSON array of report numbers.")
    repnos = [str(r).strip() for r in repnos if str(r).strip()][:200]  # cap per request
    try:
        return json.dumps(get_stratigraphy(repnos))
    except Exception as e:
        raise gr.Error(f"Stratigraphy fetch failed: {e}")


# Build Gradio Block Layout
with gr.Blocks() as demo:
    
    # State container for GemPy computed model to allow instant visualisation tweaks
    cached_state = gr.State(None)
    csdi_state   = gr.State(None)   # holds csdi_client.query_bbox_*() DataFrame
    screenshot_list = gr.State([])
    # Hidden bridge: receives drawn-shape bbox JSON from the Leaflet map JS
    draw_bbox_data = gr.Textbox(elem_id="draw_bbox_data", visible=False)
    
    # 1. Header banner — Vercel-inspired layout
    with gr.Row():
        gr.HTML("""
        <div class='hf-app-hero'>
          <div>
            <div class='hf-section-chip'>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
              </svg>
              Interactive Tool
            </div>
            <h1 class='hf-app-title'>
              Interactive 3D
              <em>Geological Mapping</em>
            </h1>
          </div>
          <div>
            <div class='hf-counter-row'>
              <div class='hf-counter'>01<small>/04</small></div>
              <p class='hf-counter-desc'>
                Upload AGS or CSV borehole data, configure model parameters, and generate a fully
                interactive 3D geological model. Rotate, zoom, and export GLB or VTK meshes directly
                in the browser.
              </p>
            </div>
          </div>
        </div>

        <div class='hf-feature-cards' style='margin-top:1rem;'>
          <div class='hf-feature-card'>
            <span class='hf-feature-card-chip'>3D ENGINE</span>
            <div class='hf-feature-card-visual hf-fv-model'></div>
            <div class='hf-feature-card-body'>
              <h3>GemPy Implicit Modelling</h3>
              <p>Kriging-based interpolation reconstructs smooth geological layer boundaries from sparse borehole contacts.</p>
            </div>
          </div>
          <div class='hf-feature-card'>
            <span class='hf-feature-card-chip'>SITE MAP</span>
            <div class='hf-feature-card-visual hf-fv-map'></div>
            <div class='hf-feature-card-body'>
              <h3>Interactive Site Map</h3>
              <p>Plot borehole locations on a Google Hybrid satellite basemap. Query the CSDI database by bounding box.</p>
            </div>
          </div>
          <div class='hf-feature-card'>
            <span class='hf-feature-card-chip'>EXPORT</span>
            <div class='hf-feature-card-visual hf-fv-data'></div>
            <div class='hf-feature-card-body'>
              <h3>GLB, VTK &amp; PNG Export</h3>
              <p>Download high-fidelity 3D scene files, surface meshes, and isometric renders for use in GIS or CAD workflows.</p>
            </div>
          </div>
        </div>
        """)
        
    # -- Tab container -----------------------------------------------
    with gr.Tabs():

        # ============================================================
        with gr.Tab("\U0001f528 3D Model Builder"):

            # 2. Main Interface
            with gr.Row():
                # Left Side: Control Panel
                with gr.Column(scale=1):
                    gr.Markdown("### 🛠️ Input & Settings")

                    # File Upload widget
                    file_input = gr.File(
                        label="Upload AGS or CSV File", 
                        file_types=[".ags", ".csv"], 
                        type="filepath"
                    )

                    # Quick Demos Loader Dropdown
                    gr.Markdown("💡 **Don't have a file? Load a pre-bundled demo dataset:**")
                    demo_dropdown = gr.Dropdown(
                        choices=[
                            "None",
                            "Sample AGS (3 Boreholes)", 
                            "Sample CSV (3 Boreholes)", 
                            "Complex Site CSV (5 Boreholes, 5 Layers)", 
                            "Pinch-out CSV (Lens Layer)"
                        ],
                        value="None",
                        label="Load Sample Dataset"
                    )
                    demo_dropdown.change(fn=load_selected_demo, inputs=demo_dropdown, outputs=file_input)

                    # Configuration panel
                    with gr.Accordion("⚙️ Model Parameters", open=False):
                        slider_res = gr.Slider(
                            minimum=20, 
                            maximum=60, 
                            value=40, 
                            step=5, 
                            label="Model Grid Resolution (Voxels³)",
                            info="Higher resolutions capture finer detail but take longer and use more memory."
                        )
                        slider_dip = gr.Slider(
                            minimum=0.0, 
                            maximum=10.0, 
                            value=1.0, 
                            step=0.5, 
                            label="Default Layer Dip (Degrees)",
                            info="Assumed bedding inclination from horizontal plane."
                        )
                        slider_azimuth = gr.Slider(
                            minimum=0.0, 
                            maximum=360.0, 
                            value=0.0, 
                            step=10.0, 
                            label="Default Dip Azimuth (Degrees)",
                            info="Dip direction compass angle (0° = North, 90° = East)."
                        )

                    # Visual styles and toggles panel
                    with gr.Accordion("🎨 Visual Styles & Toggles", open=False):
                        slider_z_scale = gr.Slider(
                            minimum=1.0, 
                            maximum=10.0, 
                            value=1.0, 
                            step=0.5, 
                            label="Vertical Exaggeration (Z-Scale)",
                            info="Stretch the vertical axis to make thin layers legible."
                        )
                        slider_opacity = gr.Slider(
                            minimum=0.0, 
                            maximum=1.0, 
                            value=0.85, 
                            step=0.05, 
                            label="Strata Opacity",
                            info="Adjust transparency of geological strata."
                        )
                        chk_show_boreholes = gr.Checkbox(
                            value=True, 
                            label="Render Borehole Cylinders",
                            info="Display vertical logging segments as colored cylinders."
                        )
                        chk_show_grid = gr.Checkbox(
                            value=True, 
                            label="Render Axis Grid & Coordinate Labels",
                            info="Display floor grid and Easting/Northing/Elevation ticks."
                        )
                        chk_show_contours = gr.Checkbox(
                            value=True, 
                            label="Render Topography Contours",
                            info="Display elevation contour lines on the uppermost surface layer."
                        )
                        checkbox_visible_layers = gr.CheckboxGroup(
                            label="Visible Strata Layers", 
                            choices=[], 
                            value=[],
                            info="Toggle checkboxes to show or hide specific formations."
                        )

                    # Cross-Section clipping panel
                    with gr.Accordion("✂️ Cross-Section Slicing", open=False):
                        chk_enable_slice = gr.Checkbox(
                            value=False, 
                            label="Enable Clipping Plane"
                        )
                        radio_slice_axis = gr.Radio(
                            choices=["X", "Y", "Z"], 
                            value="X", 
                            label="Clipping Axis"
                        )
                        slider_slice_pct = gr.Slider(
                            minimum=0, 
                            maximum=100, 
                            value=50, 
                            step=5, 
                            label="Clipping Position (%)"
                        )

                    # Render Mode Toggle
                    render_mode = gr.Radio(
                        choices=["Interface Contacts", "Volumetric Solids"],
                        value="Interface Contacts",
                        label="3D Render Mode",
                        info="Toggle between thin interface separation surfaces and solid volumetric geological strata blocks."
                    )

                    # Submit Button
                    btn_generate = gr.Button("🔨 Generate 3D Model", elem_classes="generate-btn")

                    # Geological Caveat card
                    gr.HTML("""
                    <div class='assumptions-card'>
                        <h4>⚠️ Geological Modeling Assumption</h4>
                        <p>Boreholes only provide stratigraphic interface elevations (contacts) and do not record structural dip. 
                        The model assumes sub-horizontal layering using the configured Default Dip values unless customized orientation data is provided.</p>
                    </div>
                    """)

                # Right Side: Visualiser Panel
                with gr.Column(scale=2):
                    gr.Markdown("### 📊 3D Interactive Model")

                    # 3D Viewer Component
                    with gr.Group(elem_id="viewer-container"):
                        btn_screenshot = gr.Button("📸 Take Screenshot", elem_classes="screenshot-btn")
                        viewer_3d = gr.Model3D(
                            label="3D Geology Scene (Rotate, zoom & pan)", 
                            interactive=True,
                            height=500
                        )

                    # Dynamic HTML legend component
                    legend_html = gr.HTML(
                        value="<div style='text-align: center; color: #666; font-family: sans-serif; padding: 10px;'>Upload a file to generate a 3D model and legend.</div>",
                        label="Geological Legend"
                    )

                    # Renders and Downloads Panel
                    with gr.Row():
                        with gr.Column(scale=1):
                            # Screenshot Render Image
                            render_image = gr.Image(
                                label="Isometric View Render", 
                                type="filepath"
                            )
                        with gr.Column(scale=1):
                            # Downloads panel
                            gr.Markdown("### 📥 Download Results")
                            download_glb = gr.File(label="Download 3D Scenes (GLB)", file_count="multiple")
                            download_vtk = gr.File(label="Download Surfaces Meshes (VTK ZIP)")
                            download_png = gr.File(label="Download Isometric Image (PNG)")
                            download_screenshots = gr.File(
                                label="Captured Screenshots (Max 10)", 
                                file_count="multiple",
                                interactive=False
                            )
                            btn_clear_screenshots = gr.Button("🗑️ Clear Screenshots", size="sm")

                    # Hidden textbox to receive base64 screenshot data
                    screenshot_data = gr.Textbox(elem_id="screenshot_data", visible=False)

                    # Linking generation logic
                    btn_generate.click(
                        fn=generate_model,
                        inputs=[
                            file_input, slider_res, slider_dip, slider_azimuth, render_mode,
                            slider_z_scale, slider_opacity, chk_show_boreholes, chk_show_grid, chk_show_contours,
                            chk_enable_slice, radio_slice_axis, slider_slice_pct
                        ],
                        outputs=[
                            viewer_3d, legend_html, render_image,
                            download_glb, download_vtk, download_png,
                            cached_state, checkbox_visible_layers
                        ],
                        api_name="build_model"  # stable endpoint for the JS frontend (web/builder.js)
                    )

                    # Headless CSV-text endpoint for the JS frontend (no file-upload gate).
                    # Called by web/builder.js "Send to Hugging Face".
                    csv_api_in = gr.Textbox(visible=False)
                    res_api_in = gr.Number(value=50, visible=False)
                    dip_api_in = gr.Number(value=2, visible=False)
                    az_api_in = gr.Number(value=90, visible=False)
                    glb_api_out = gr.File(visible=False)
                    btn_api = gr.Button(visible=False)
                    btn_api.click(
                        fn=build_model_from_csv,
                        inputs=[csv_api_in, res_api_in, dip_api_in, az_api_in],
                        outputs=glb_api_out,
                        api_name="build_model_csv"
                    )

                    # Stratigraphy endpoint for the JS site map (CEDD AGS open data).
                    strat_api_in = gr.Textbox(visible=False)
                    strat_api_out = gr.Textbox(visible=False)
                    btn_strat_api = gr.Button(visible=False)
                    btn_strat_api.click(
                        fn=fetch_stratigraphy_api,
                        inputs=strat_api_in,
                        outputs=strat_api_out,
                        api_name="fetch_stratigraphy"
                    )

                    # Pack inputs for fast visualisation updates
                    visual_inputs = [
                        cached_state, render_mode, slider_z_scale, checkbox_visible_layers, slider_opacity,
                        chk_show_boreholes, chk_show_grid, chk_show_contours, chk_enable_slice, radio_slice_axis, slider_slice_pct
                    ]
                    visual_outputs = [
                        viewer_3d, legend_html, render_image, 
                        download_glb, download_vtk, download_png
                    ]

                    # Interactive visual options release/change events
                    render_mode.change(fn=update_visualisation, inputs=visual_inputs, outputs=visual_outputs)
                    slider_z_scale.release(fn=update_visualisation, inputs=visual_inputs, outputs=visual_outputs)
                    checkbox_visible_layers.change(fn=update_visualisation, inputs=visual_inputs, outputs=visual_outputs)
                    slider_opacity.release(fn=update_visualisation, inputs=visual_inputs, outputs=visual_outputs)
                    chk_show_boreholes.change(fn=update_visualisation, inputs=visual_inputs, outputs=visual_outputs)
                    chk_show_grid.change(fn=update_visualisation, inputs=visual_inputs, outputs=visual_outputs)
                    chk_show_contours.change(fn=update_visualisation, inputs=visual_inputs, outputs=visual_outputs)
                    chk_enable_slice.change(fn=update_visualisation, inputs=visual_inputs, outputs=visual_outputs)
                    radio_slice_axis.change(fn=update_visualisation, inputs=visual_inputs, outputs=visual_outputs)
                    slider_slice_pct.release(fn=update_visualisation, inputs=visual_inputs, outputs=visual_outputs)

                    # JS event callback to capture model-viewer canvas to hidden textbox
                    btn_screenshot.click(
                        fn=None,
                        js="""
                        () => {
                            const viewer = document.querySelector('#viewer-container model-viewer');
                            if (viewer) {
                                const dataUrl = viewer.toDataURL("image/png");
                                const textarea = document.querySelector('#screenshot_data textarea');
                                if (textarea) {
                                    textarea.value = dataUrl;
                                    textarea.dispatchEvent(new Event('input', { bubbles: true }));
                                }
                            }
                        }
                        """,
                        inputs=[],
                        outputs=[]
                    )

                    # Python backend helper to save decoded base64 screenshot
                    def save_screenshot(data_url, current_photos):
                        if not data_url or not data_url.startswith("data:image/png;base64,"):
                            return current_photos, current_photos

                        import base64
                        import time

                        header, encoded = data_url.split(",", 1)
                        data = base64.b64decode(encoded)

                        os.makedirs("screenshots", exist_ok=True)

                        if current_photos is None:
                            current_photos = []

                        if len(current_photos) >= 10:
                            oldest_file = current_photos.pop(0)
                            if os.path.exists(oldest_file):
                                try:
                                    os.remove(oldest_file)
                                except Exception:
                                    pass

                        filename = f"screenshots/geology_screenshot_{int(time.time())}_{len(current_photos) + 1}.png"
                        with open(filename, "wb") as f:
                            f.write(data)

                        current_photos.append(filename)
                        gr.Info(f"Screenshot saved! ({len(current_photos)}/10)")
                        return current_photos, current_photos

                    screenshot_data.change(
                        fn=save_screenshot,
                        inputs=[screenshot_data, screenshot_list],
                        outputs=[download_screenshots, screenshot_list]
                    )

                    # Python backend helper to clear screenshots
                    def clear_screenshots(current_photos):
                        if current_photos:
                            for file in current_photos:
                                if os.path.exists(file):
                                    try:
                                        os.remove(file)
                                    except Exception:
                                        pass
                        gr.Info("Screenshots cleared.")
                        return [], []

                    btn_clear_screenshots.click(
                        fn=clear_screenshots,
                        inputs=[screenshot_list],
                        outputs=[download_screenshots, screenshot_list]
                    )

            # 3. Bottom instructions and documentation
            with gr.Row():
                gr.Markdown("""
                ---
                ### 📖 Guide & Source Data References

                #### How to acquire Hong Kong AGS data:
                1. Visit the **[Hong Kong Government Data Portal](https://data.gov.hk/en-data/dataset/hk-cedd-csu-cedd-gi-lt)**.
                2. Browse or search for Ground Investigation (GI) records.
                3. Download the `.ags` data files.
                4. Alternatively, use the **[Geotechnical Information Infrastructure (CSDI G-Info)](https://ginfo.cedd.gov.hk/)** to download borehole records for specific locations.

                #### Fallback CSV Data Schema:
                If you have custom borehole data, you can upload a CSV file with the following columns:
                * `borehole_id` - Unique name for the borehole location (e.g. *BH-01*)
                * `x` - Metric Grid coordinate Easting (e.g. *HK1980 Easting*)
                * `y` - Metric Grid coordinate Northing (e.g. *HK1980 Northing*)
                * `surface` - Name of the geological layer/strata contact (e.g. *Soil*, *Clay*, *Granite*)
                * `top_depth` - Depth to the top of the layer from the ground surface (meters)
                * `base_depth` - Depth to the base of the layer from the ground surface (meters)
                * `ground_level` - Elevation of the borehole collar above sea level (meters)

                *Ensure all spatial coordinates (x, y, ground_level) and depths are measured in consistent metric units (meters).*
                """)


        # ============================================================
        with gr.Tab("\U0001f5fa\ufe0f Site Map"):

            gr.HTML("""
            <div style="padding:1.25rem 1.5rem;background:linear-gradient(135deg,#2d5016,#4a7c20);
                        border-radius:12px;margin-bottom:1rem;color:#f5f0e8;">
              <h3 style="margin:0 0 0.4rem 0;font-family:'Outfit',sans-serif;font-weight:700;font-size:1.3rem;color:#f5f0e8 !important;">
                \U0001f5fa\ufe0f Interactive Site Map
              </h3>
              <p style="margin:0;opacity:0.88;font-size:0.92rem;">
                Visualise your project boreholes on a Google Hybrid satellite map of Hong Kong.
                Load a model in the <b>3D Model Builder</b> tab first, then click <b>Refresh Map</b>
                to plot borehole locations. Use the layer switcher (top-right) to toggle basemaps.
              </p>
            </div>
            """)

            with gr.Row():
                with gr.Column(scale=3):
                    btn_refresh_map = gr.Button(
                        "\U0001f504 Refresh Map from Current Session",
                        variant="primary",
                        elem_classes="generate-btn",
                    )
                with gr.Column(scale=1):
                    gr.HTML("""
                    <div style="font-size:0.8rem;color:#6b7280;padding:0.5rem 0;">
                      <b>Layer switcher</b> top-right &nbsp;|
                      <b>Draw rectangle</b> top-left &nbsp;|
                      <b>Cursor coords</b> bottom-left
                    </div>
                    """)

            # Map display - initially shows HK with no boreholes
            map_html_component = gr.HTML(
                value=generate_site_map(),
                label="Interactive Site Map",
            )

            gr.HTML("""
            <div style="margin-top:1.25rem;padding:1rem 1.25rem;
                        background:#faf5eb;border-left:4px solid #b89a38;
                        border-radius:0 8px 8px 0;font-size:0.88rem;color:#3d3d25;">
              <b>CSDI GI Data (Hong Kong Government)</b><br>
              CEDD publishes Ground Investigation records via the
              <a href="https://portal.csdi.gov.hk/geoportal/?datasetId=cedd_rcd_1636517845149_16420"
                 target="_blank" style="color:#3d6618;font-weight:600;">CSDI GeoPortal</a>.
              The portal's OGC WFS API supports bounding-box queries,
              enabling the planned Bounding Box Borehole Selector (next phase).
            </div>
            """)

            def _refresh_map(state, csdi_results):
                loca = state.get("loca_df") if state else None
                geol = state.get("geol_df") if state else None
                csdi = csdi_results if (csdi_results is not None and not csdi_results.empty) else None
                return generate_site_map(loca, geol, csdi)

            btn_refresh_map.click(
                fn=_refresh_map,
                inputs=[cached_state, csdi_state],
                outputs=[map_html_component],
            )

            # ── CSDI Database Sync ────────────────────────────────────────
            with gr.Accordion("\U0001f5c4\ufe0f CSDI Borehole Database (HK Government)", open=False):
                _n_local = csdi_client.count_local(CSDI_DB_PATH)
                _last_sync = csdi_client.get_last_sync(CSDI_DB_PATH)
                _sync_status_txt = (
                    f"\U0001f7e2 Database ready: {_n_local:,} boreholes loaded."
                    f"  Last sync: {_last_sync}"
                    if _n_local > 0
                    else "\U0001f534 Database is empty. Click \"Sync Now\" to download all HK borehole locations."
                )

                csdi_sync_status = gr.Textbox(
                    value=_sync_status_txt,
                    label="Database Status",
                    interactive=False,
                    lines=2,
                )

                gr.HTML("""
                <div style="font-size:0.82rem;color:#6b7280;margin:-0.4rem 0 0.6rem 0;">
                  Downloads all borehole <b>locations</b> (coordinates + metadata) into a local SQLite file
                  (~15-30 MB). Only AGS files for your selected boreholes are fetched on-demand.
                  This sync may take <b>2-5 minutes</b> — progress updates appear in the status box.
                  Re-run monthly to pick up new CEDD records.
                </div>
                """)

                with gr.Row():
                    btn_sync_csdi = gr.Button(
                        "\U0001f504 Sync CSDI Database Now",
                        variant="secondary",
                    )
                    btn_count_csdi = gr.Button(
                        "\U0001f4ca Check Record Count",
                        variant="secondary",
                        size="sm",
                    )

                def _do_sync():
                    import os
                    os.makedirs("data", exist_ok=True)
                    messages = []
                    def _cb(msg):
                        messages.append(msg)
                    n, final_msg = csdi_client.sync_spatial_index(
                        CSDI_DB_PATH, progress_cb=_cb
                    )
                    last = csdi_client.get_last_sync(CSDI_DB_PATH)
                    return (
                        f"\U0001f7e2 Sync complete: {n:,} boreholes stored.  "
                        f"Last sync: {last}\n\nProgress log:\n"
                        + "\n".join(messages[-20:])
                    )

                btn_sync_csdi.click(
                    fn=_do_sync,
                    inputs=[],
                    outputs=[csdi_sync_status],
                )

                def _do_count():
                    n = csdi_client.count_local(CSDI_DB_PATH)
                    last = csdi_client.get_last_sync(CSDI_DB_PATH)
                    if n > 0:
                        return f"\U0001f7e2 {n:,} borehole records in local database.  Last sync: {last}"
                    return "\U0001f534 Database is empty — click Sync to download."

                btn_count_csdi.click(
                    fn=_do_count,
                    inputs=[],
                    outputs=[csdi_sync_status],
                )

            # ── Bounding Box Borehole Search ──────────────────────────────
            with gr.Accordion("\U0001f50d Bounding Box Search", open=True):

                gr.HTML("""
                <div style="font-size:0.84rem;color:#1e293b;margin-bottom:0.85rem;
                            padding:0.75rem 1rem;background:#f0f9ff;
                            border-left:4px solid #0ea5e9;border-radius:0 8px 8px 0;">
                  <b>&#9654; Draw a rectangle on the map to auto-fill these fields:</b><br>
                  <span style="color:#475569;">
                    Use the <b>&#9645; rectangle tool</b> in the top-left toolbar of the map above.
                    Draw any rectangle over your site — the four coordinates below will fill in
                    automatically. Then click <b>Search Boreholes in Area</b>.<br><br>
                    Or type coordinates directly using HK1980 Grid or WGS84 (use the cursor
                    coordinates shown at the bottom-left of the map).
                  </span>
                </div>
                """)

                bbox_mode = gr.Radio(
                    choices=["HK1980 Grid (Easting / Northing)", "WGS84 (Latitude / Longitude)"],
                    value="HK1980 Grid (Easting / Northing)",
                    label="Coordinate System",
                )

                with gr.Row():
                    bbox_e_min = gr.Number(label="West  (E min / Lon min)", value=None, precision=2)
                    bbox_n_min = gr.Number(label="South (N min / Lat min)", value=None, precision=2)
                    bbox_e_max = gr.Number(label="East  (E max / Lon max)", value=None, precision=2)
                    bbox_n_max = gr.Number(label="North (N max / Lat max)", value=None, precision=2)

                gr.HTML("""
                <div style="font-size:0.78rem;color:#94a3b8;margin-top:-0.25rem;">
                  HK1980 example — Kowloon: E 831000 / 834000, N 818000 / 821000
                  &nbsp;|&nbsp; WGS84 example — Kowloon: Lat 22.30 / 22.33, Lon 114.15 / 114.18
                </div>
                """)

                with gr.Row():
                    btn_search_bbox = gr.Button(
                        "\U0001f50d Search Boreholes in Area",
                        variant="primary",
                    )
                    btn_clear_bbox = gr.Button("\u2715 Clear Results", variant="secondary", size="sm")

                bbox_result_info = gr.Textbox(
                    value="",
                    label="Search Result",
                    interactive=False,
                    lines=1,
                    visible=False,
                )

                bbox_table = gr.Dataframe(
                    value=pd.DataFrame(),
                    label="Boreholes Found in Area",
                    interactive=False,
                    wrap=True,
                    visible=False,
                )

                def _search_bbox(mode, e_min, n_min, e_max, n_max):
                    """Query the local SQLite index and return results + updated map."""
                    if not all(v is not None for v in [e_min, n_min, e_max, n_max]):
                        gr.Warning("Please fill in all four bounding box coordinates.")
                        return (
                            gr.update(visible=True, value="Please fill all four coordinate fields."),
                            gr.update(visible=False, value=pd.DataFrame()),
                            None,
                        )

                    n_db = csdi_client.count_local(CSDI_DB_PATH)
                    if n_db == 0:
                        gr.Warning("Local CSDI database is empty. Please sync first.")
                        return (
                            gr.update(visible=True, value="Database empty — click Sync in the CSDI Database section above."),
                            gr.update(visible=False, value=pd.DataFrame()),
                            None,
                        )

                    if "HK1980" in mode:
                        df = csdi_client.query_bbox_hk1980(
                            CSDI_DB_PATH,
                            float(e_min), float(n_min), float(e_max), float(n_max),
                        )
                    else:
                        df = csdi_client.query_bbox_wgs84(
                            CSDI_DB_PATH,
                            float(n_min), float(e_min),   # sw_lat=n_min, sw_lng=e_min
                            float(n_max), float(e_max),   # ne_lat=n_max, ne_lng=e_max
                        )

                    if df.empty:
                        info = "No boreholes found in the specified area."
                        return (
                            gr.update(visible=True, value=info),
                            gr.update(visible=False, value=pd.DataFrame()),
                            None,
                        )

                    # Select display columns
                    disp_cols = [c for c in [
                        "statno", "stattype", "repno",
                        "e_coord", "n_coord", "grdlevel", "depth",
                        "sdate", "edate",
                    ] if c in df.columns]
                    disp_df = df[disp_cols].copy()
                    disp_df.columns = [
                        c.upper().replace("_COORD","").replace("GRD","COLLAR_").replace("STAT","BH_")
                        for c in disp_cols
                    ]

                    info = f"\U0001f7e2 Found {len(df):,} boreholes. Showing on map as grey dots. Click Refresh Map."
                    return (
                        gr.update(visible=True, value=info),
                        gr.update(visible=True, value=disp_df),
                        df,   # stored in csdi_state
                    )

                btn_search_bbox.click(
                    fn=_search_bbox,
                    inputs=[bbox_mode, bbox_e_min, bbox_n_min, bbox_e_max, bbox_n_max],
                    outputs=[bbox_result_info, bbox_table, csdi_state],
                )

                def _clear_bbox():
                    return (
                        gr.update(visible=False, value=""),
                        gr.update(visible=False, value=pd.DataFrame()),
                        None,
                        gr.update(value=None), gr.update(value=None),
                        gr.update(value=None), gr.update(value=None),
                    )

                btn_clear_bbox.click(
                    fn=_clear_bbox,
                    inputs=[],
                    outputs=[bbox_result_info, bbox_table, csdi_state,
                             bbox_e_min, bbox_n_min, bbox_e_max, bbox_n_max],
                )

                # ── Draw-tool → auto-fill bbox inputs ──────────────────
                def _on_draw_bbox(json_str):
                    """Parse WGS84 bounding box written by the Leaflet draw listener."""
                    import json as _json
                    if not json_str:
                        return (gr.update(),) * 5
                    try:
                        d = _json.loads(json_str)
                        return (
                            "WGS84 (Latitude / Longitude)",  # bbox_mode
                            d["lon_min"],   # W → E min / Lon min
                            d["lat_min"],   # S → N min / Lat min
                            d["lon_max"],   # E → E max / Lon max
                            d["lat_max"],   # N → N max / Lat max
                        )
                    except Exception:
                        return (gr.update(),) * 5

                draw_bbox_data.change(
                    fn=_on_draw_bbox,
                    inputs=[draw_bbox_data],
                    outputs=[bbox_mode, bbox_e_min, bbox_n_min, bbox_e_max, bbox_n_max],
                )

    # -- End of Tabs --------------------------------------------------

    # Page-level JS: relay postMessage bbox events from Leaflet iframe
    # → hidden #draw_bbox_data textarea → Python .change() handler
    demo.load(
        fn=None,
        js="""
        () => {
            window.addEventListener('message', function(e) {
                if (!e.data || e.data.type !== 'leaflet_bbox') return;
                var data = e.data;
                var json = JSON.stringify({
                    lat_min: data.lat_min,
                    lon_min: data.lon_min,
                    lat_max: data.lat_max,
                    lon_max: data.lon_max
                });
                var attempt = 0;
                (function tryWrite() {
                    var el = document.getElementById('draw_bbox_data');
                    if (!el && attempt < 30) {
                        attempt++;
                        setTimeout(tryWrite, 200);
                        return;
                    }
                    if (!el) return;
                    var ta = el.querySelector('textarea');
                    if (ta) {
                        ta.value = json;
                        ta.dispatchEvent(new Event('input', {bubbles: true}));
                    }
                })();
            });
            return [];
        }
        """,
    )

# Entry point
if __name__ == "__main__":
    demo.queue().launch(
        server_name="0.0.0.0", 
        server_port=7860,
        theme=theme_soft,
        css=CUSTOM_CSS
    )