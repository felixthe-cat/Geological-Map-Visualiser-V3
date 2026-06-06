import os
import tempfile
import pandas as pd
import numpy as np
import gempy as gp

def build_and_compute_model(
    surface_points_df: pd.DataFrame, 
    orientations_df: pd.DataFrame, 
    resolution: list[int] = None
) -> gp.core.data.geo_model.GeoModel:
    """
    Builds and computes a GemPy geological model from surface points and orientations.
    
    Args:
        surface_points_df: DataFrame with columns [X, Y, Z, surface]
        orientations_df: DataFrame with columns [X, Y, Z, dip, azimuth, polarity, surface]
        resolution: A list of [x_res, y_res, z_res], defaults to [50, 50, 50]
        
    Returns:
        The computed GemPy GeoModel object.
    """
    if resolution is None:
        resolution = [50, 50, 50]
        
    # 1. Determine bounding box and add margins
    min_x, max_x = surface_points_df['X'].min(), surface_points_df['X'].max()
    min_y, max_y = surface_points_df['Y'].min(), surface_points_df['Y'].max()
    min_z, max_z = surface_points_df['Z'].min(), surface_points_df['Z'].max()
    
    x_span = max_x - min_x if max_x > min_x else 100.0
    y_span = max_y - min_y if max_y > min_y else 100.0
    z_span = max_z - min_z if max_z > min_z else 50.0
    
    # 10% margins
    margin_x = max(x_span * 0.1, 20.0)
    margin_y = max(y_span * 0.1, 20.0)
    margin_z = max(z_span * 0.1, 10.0)
    
    extent = [
        float(min_x - margin_x), float(max_x + margin_x),
        float(min_y - margin_y), float(max_y + margin_y),
        float(min_z - margin_z - 10.0), float(max_z + margin_z + 10.0)
    ]
    
    # 2. Write DataFrames to temporary CSV files for ImporterHelper
    # We use temporary files in the current folder to avoid OS-specific temp dir permission issues.
    temp_sp_path = "temp_surface_points.csv"
    temp_ori_path = "temp_orientations.csv"
    
    surface_points_df.to_csv(temp_sp_path, index=False)
    orientations_df.to_csv(temp_ori_path, index=False)
    
    try:
        # Initialize helper
        helper = gp.data.ImporterHelper(
            path_to_orientations=temp_ori_path,
            path_to_surface_points=temp_sp_path
        )
        
        # Create model
        geo_model = gp.create_geomodel(
            project_name="GeologicalModel",
            extent=extent,
            resolution=resolution,
            importer_helper=helper
        )
        
        # Determine depositional order (youngest/highest to oldest/lowest)
        # Average elevation of surface points for each surface type
        avg_z = surface_points_df.groupby('surface')['Z'].mean()
        ordered_surfaces = list(avg_z.sort_values(ascending=False).index)
        
        # Group surfaces into one Stratigraphic Series
        gp.map_stack_to_surfaces(
            gempy_model=geo_model,
            mapping_object={
                "Strat_Series": tuple(ordered_surfaces)
            }
        )
        
        # Compute model (defaulting to numpy engine config)
        # Specify numpy backend explicitly for CPU stability
        engine_config = gp.data.GemPyEngineConfig(
            backend=gp.data.AvailableBackends.numpy
        )
        
        gp.compute_model(
            gempy_model=geo_model,
            engine_config=engine_config
        )
        
        return geo_model
        
    finally:
        # Clean up temporary CSV files
        if os.path.exists(temp_sp_path):
            os.remove(temp_sp_path)
        if os.path.exists(temp_ori_path):
            os.remove(temp_ori_path)
