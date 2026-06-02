import os
import pytest
from src.ingest_ags import ingest_ags
from src.to_surface_points import generate_surface_and_orientation_points
from src.model import build_and_compute_model
from src.export import export_to_glb, export_solids_to_glb, export_to_vtk, export_to_png

def test_end_to_end_pipeline():
    # File paths
    sample_path = os.path.join("examples", "sample.ags")
    glb_out = "test_model_output.glb"
    glb_solids_out = "test_model_output_solids.glb"
    vtk_out = "test_model_output.zip"
    png_out = "test_model_output.png"
    
    # 1. Ingest
    loca_df, geol_df = ingest_ags(sample_path)
    
    # 2. Transform
    sp_df, ori_df = generate_surface_and_orientation_points(loca_df, geol_df)
    
    # 3. Model
    # Use low resolution for fast testing
    model = build_and_compute_model(sp_df, ori_df, resolution=[15, 10, 10])
    
    # Assert meshes were computed
    assert len(model.solutions.dc_meshes) > 0, "No meshes generated"
    
    # 4. Exports
    try:
        # GLB Interfaces
        glb_path = export_to_glb(model, glb_out)
        assert os.path.exists(glb_path)
        assert os.path.getsize(glb_path) > 0, "Exported GLB is empty"

        # GLB Solids
        glb_solids_path = export_solids_to_glb(model, glb_solids_out)
        assert os.path.exists(glb_solids_path)
        assert os.path.getsize(glb_solids_path) > 0, "Exported Solids GLB is empty"
        
        # VTK
        vtk_path = export_to_vtk(model, vtk_out)
        assert os.path.exists(vtk_path)
        assert os.path.getsize(vtk_path) > 0, "Exported VTK zip is empty"
        
        # PNG (offscreen)
        png_path = export_to_png(model, png_out)
        assert os.path.exists(png_path)
        assert os.path.getsize(png_path) > 0, "Exported PNG is empty"
        
    finally:
        # Cleanup generated test outputs
        for file in [glb_out, glb_solids_out, vtk_out, png_out]:
            if os.path.exists(file):
                os.remove(file)
