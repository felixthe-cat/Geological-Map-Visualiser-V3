import os
import pytest
import pandas as pd
from src.ingest_ags import ingest_ags

def test_ingest_ags_success():
    # Path to sample.ags
    sample_path = os.path.join("examples", "sample.ags")
    assert os.path.exists(sample_path), "sample.ags file does not exist"
    
    loca_df, geol_df = ingest_ags(sample_path)
    
    # Verify LOCA structure and data
    assert isinstance(loca_df, pd.DataFrame)
    assert len(loca_df) == 3
    assert list(loca_df.columns) == ['LOCA_ID', 'LOCA_NATE', 'LOCA_NATN', 'LOCA_GL']
    assert set(loca_df['LOCA_ID']) == {"BH-1", "BH-2", "BH-3"}
    
    # Verify GEOL structure and data
    assert isinstance(geol_df, pd.DataFrame)
    assert len(geol_df) == 9
    assert 'surface' in geol_df.columns
    assert set(geol_df['surface'].unique()) == {"Soil", "Clay", "Bedrock"}
    
def test_ingest_ags_missing_file():
    with pytest.raises(ValueError) as excinfo:
        ingest_ags("non_existent_file.ags")
    assert "Failed to parse AGS file" in str(excinfo.value)
