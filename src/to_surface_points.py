import pandas as pd
import numpy as np

def generate_surface_and_orientation_points(
    loca_df: pd.DataFrame, 
    geol_df: pd.DataFrame,
    default_dip: float = 1.0,
    default_azimuth: float = 0.0
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Merges borehole location and geological layers to compute absolute 3D coordinates.
    Generates default sub-horizontal orientations for each geological formation.
    
    Args:
        loca_df: DataFrame with location data (LOCA_ID, LOCA_NATE, LOCA_NATN, LOCA_GL)
        geol_df: DataFrame with geology layers (LOCA_ID, GEOL_TOP, GEOL_BASE, surface)
        default_dip: The default dip in degrees (e.g. 1.0 for near horizontal)
        default_azimuth: The default azimuth in degrees (e.g. 0.0)
        
    Returns:
        A tuple of (surface_points_df, orientations_df) DataFrames ready for GemPy.
    """
    # Merge on LOCA_ID
    merged = pd.merge(geol_df, loca_df, on='LOCA_ID', how='inner')
    
    if merged.empty:
        raise ValueError("No matching borehole records found between location and geology tables.")
        
    # Calculate Z coordinate (elevation = collar level - depth to top of layer)
    merged['Z'] = merged['LOCA_GL'] - merged['GEOL_TOP']
    
    # Create surface points DataFrame
    surface_points = pd.DataFrame({
        'X': merged['LOCA_NATE'],
        'Y': merged['LOCA_NATN'],
        'Z': merged['Z'],
        'surface': merged['surface']
    })
    
    # Drop any duplicate points to avoid GemPy matrix errors
    surface_points = surface_points.drop_duplicates(subset=['X', 'Y', 'Z', 'surface']).reset_index(drop=True)
    
    # Drop rows with NaN values
    surface_points = surface_points.dropna().reset_index(drop=True)
    
    if surface_points.empty:
        raise ValueError("No valid 3D surface points could be computed from the input data.")
        
    # For GemPy orientations, we need at least one orientation per surface.
    # We will compute the average position (centroid) of the points for each surface,
    # and place the orientation measurement at that point with a default near-horizontal dip.
    orientations_list = []
    
    for surface_name in surface_points['surface'].unique():
        surface_subset = surface_points[surface_points['surface'] == surface_name]
        
        # Centroid coordinates
        mean_x = surface_subset['X'].mean()
        mean_y = surface_subset['Y'].mean()
        mean_z = surface_subset['Z'].mean()
        
        orientations_list.append({
            'X': mean_x,
            'Y': mean_y,
            'Z': mean_z,
            'dip': default_dip,
            'azimuth': default_azimuth,
            'polarity': 1.0,  # 1.0 means pointing upwards (normal sequence)
            'surface': surface_name
        })
        
    orientations = pd.DataFrame(orientations_list)
    
    return surface_points, orientations
