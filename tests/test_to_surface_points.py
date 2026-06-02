import os
import pytest
import pandas as pd
from src.ingest_ags import ingest_ags
from src.ingest_csv import ingest_csv
from src.to_surface_points import generate_surface_and_orientation_points

def test_to_surface_points_ags():
    sample_path = os.path.join("examples", "sample.ags")
    loca_df, geol_df = ingest_ags(sample_path)
    
    surface_df, orientation_df = generate_surface_and_orientation_points(loca_df, geol_df)
    
    # Check surface points columns and shape
    assert list(surface_df.columns) == ['X', 'Y', 'Z', 'surface']
    assert len(surface_df) == 9  # 3 boreholes * 3 layers each = 9 points
    
    # Check elevation calculations
    # BH-1 GL = 15.0, Soil top = 0.0 -> Z = 15.0
    bh1_soil = surface_df[(surface_df['X'] == 840000.0) & (surface_df['surface'] == 'Soil')]
    assert len(bh1_soil) == 1
    assert bh1_soil.iloc[0]['Z'] == 15.0
    
    # BH-1 GL = 15.0, Bedrock top = 15.0 -> Z = 0.0
    bh1_bedrock = surface_df[(surface_df['X'] == 840000.0) & (surface_df['surface'] == 'Bedrock')]
    assert len(bh1_bedrock) == 1
    assert bh1_bedrock.iloc[0]['Z'] == 0.0
    
    # Check orientations columns and shape
    assert list(orientation_df.columns) == ['X', 'Y', 'Z', 'dip', 'azimuth', 'polarity', 'surface']
    assert len(orientation_df) == 3  # 3 unique surfaces (Soil, Clay, Bedrock)
    assert set(orientation_df['surface']) == {"Soil", "Clay", "Bedrock"}
    
    # Check defaults
    assert (orientation_df['dip'] == 1.0).all()
    assert (orientation_df['azimuth'] == 0.0).all()
    assert (orientation_df['polarity'] == 1.0).all()

def test_to_surface_points_csv():
    sample_path = os.path.join("examples", "sample_boreholes.csv")
    loca_df, geol_df = ingest_csv(sample_path)
    
    surface_df, orientation_df = generate_surface_and_orientation_points(loca_df, geol_df)
    
    assert len(surface_df) == 9
    assert len(orientation_df) == 3
    assert set(surface_df['surface']) == {"Soil", "Clay", "Bedrock"}
