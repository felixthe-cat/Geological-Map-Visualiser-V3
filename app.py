import os
import gradio as gr
import pandas as pd
import numpy as np

from src.ingest_ags import ingest_ags
from src.ingest_csv import ingest_csv
from src.to_surface_points import generate_surface_and_orientation_points
from src.model import build_and_compute_model
from src.export import export_to_glb, export_to_vtk, export_to_png

# Sample files paths
SAMPLE_AGS_PATH = os.path.join("examples", "sample.ags")
SAMPLE_CSV_PATH = os.path.join("examples", "sample_boreholes.csv")

# Custom CSS for rich visual aesthetics
CUSTOM_CSS = """
.title-container {
    background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
    color: white;
    padding: 2.5rem;
    border-radius: 16px;
    margin-bottom: 2rem;
    box-shadow: 0 10px 30px rgba(42, 82, 152, 0.15);
}
.title-container h1 {
    font-size: 2.75rem;
    font-weight: 800;
    margin: 0;
    font-family: 'Outfit', sans-serif;
    letter-spacing: -0.5px;
}
.title-container p {
    font-size: 1.15rem;
    opacity: 0.9;
    margin-top: 0.75rem;
    font-weight: 300;
}
.generate-btn {
    background: linear-gradient(135deg, #00b4db 0%, #0083b0 100%) !important;
    color: white !important;
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
    box-shadow: 0 8px 20px rgba(0, 180, 219, 0.3) !important;
}
.demo-btn {
    background-color: #f3f4f6 !important;
    color: #374151 !important;
    border: 1px solid #d1d5db !important;
    font-weight: 600 !important;
    transition: all 0.2s ease !important;
}
.demo-btn:hover {
    background-color: #e5e7eb !important;
    transform: translateY(-1px);
}
.assumptions-card {
    border-left: 4px solid #00b4db;
    background-color: #f0f9ff;
    padding: 1.25rem;
    border-radius: 0 12px 12px 0;
    margin-top: 1.5rem;
}
.assumptions-card h4 {
    margin-top: 0;
    color: #0369a1;
    font-weight: 700;
}
.assumptions-card p {
    font-size: 0.95rem;
    color: #0c4a6e;
    margin: 0;
    line-height: 1.5;
}
"""

def generate_model(file_obj, resolution, dip, azimuth):
    """
    Main orchestration function running the processing and modeling pipeline.
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
            raise ValueError("Unsupported file format. Please upload a .ags (Hong Kong CEDD standard) or .csv file.")
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
        # Capping resolution parameters to avoid CPU Spaces RAM OOM
        res_grid = [int(resolution), int(resolution), int(resolution)]
        model = build_and_compute_model(sp_df, ori_df, resolution=res_grid)
    except Exception as e:
        raise gr.Error(f"Modeling engine failed: {e}")
        
    # 4. Export artifacts (GLB, VTK Zip, PNG Screenshot)
    gr.Info("Exporting 3D scene & renders...")
    try:
        glb_path = "geology_model.glb"
        vtk_zip_path = "geology_model_vtk.zip"
        png_path = "geology_model_render.png"
        
        export_to_glb(model, glb_path)
        export_to_vtk(model, vtk_zip_path)
        export_to_png(model, png_path)
        
        # Dynamic HTML legend generation matching colors in export.py
        surfaces = [e.name for e in model.structural_frame.structural_elements if e.name != 'basement']
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
        <div style="margin-top: 10px; margin-bottom: 15px; padding: 12px; background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;">
            <h4 style="margin-top: 0; margin-bottom: 10px; color: #1e3c72; font-weight: 700; font-size: 1rem; font-family: 'Outfit', sans-serif;">🏷️ Geological Legend</h4>
            <div style="display: flex; flex-wrap: wrap;">
                {"".join(legend_items)}
            </div>
        </div>
        """
        
        gr.Info("Model ready!")
        return glb_path, legend_html_content, png_path, glb_path, vtk_zip_path, png_path
        
    except Exception as e:
        raise gr.Error(f"Artifact export failed: {e}")

def load_demo_ags():
    return gr.update(value=SAMPLE_AGS_PATH)

def load_demo_csv():
    return gr.update(value=SAMPLE_CSV_PATH)

theme_soft = gr.themes.Soft(
    primary_hue="sky", 
    secondary_hue="slate", 
    font=[gr.themes.GoogleFont("Outfit"), "sans-serif"]
)

# Build Gradio Block Layout
with gr.Blocks() as demo:
    
    # 1. Header banner
    with gr.Row():
        gr.HTML("""
        <div class='title-container'>
            <h1>Geological Map Visualiser V3</h1>
            <p>Construct 3D geological models from CEDD open-data AGS files using GemPy implicit structural modeling.</p>
        </div>
        """)
        
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
            
            # Quick Demos Loader Row
            gr.Markdown("💡 **Don't have a file? Load a pre-bundled demo dataset:**")
            with gr.Row():
                btn_demo_ags = gr.Button("📂 Load Sample AGS", elem_classes="demo-btn")
                btn_demo_csv = gr.Button("📄 Load Sample CSV", elem_classes="demo-btn")
                
            btn_demo_ags.click(fn=load_demo_ags, outputs=file_input)
            btn_demo_csv.click(fn=load_demo_csv, outputs=file_input)
            
            # Configuration panel
            with gr.Accordion("⚙️ Model Parameters", open=True):
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
                    download_glb = gr.File(label="Download 3D Scene (GLB)")
                    download_vtk = gr.File(label="Download Surfaces Meshes (VTK ZIP)")
                    download_png = gr.File(label="Download Isometric Image (PNG)")
                    
            # Linking generation logic
            btn_generate.click(
                fn=generate_model,
                inputs=[file_input, slider_res, slider_dip, slider_azimuth],
                outputs=[viewer_3d, legend_html, render_image, download_glb, download_vtk, download_png]
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
        
# Entry point
if __name__ == "__main__":
    demo.queue().launch(
        server_name="0.0.0.0", 
        server_port=7860,
        theme=theme_soft,
        css=CUSTOM_CSS
    )
