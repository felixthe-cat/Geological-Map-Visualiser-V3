import pandas as pd
from python_ags4 import AGS4

def ingest_ags(file_path: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Parses an AGS4 file and extracts cleaned LOCA and GEOL DataFrames.
    
    Args:
        file_path: Absolute path to the AGS file.
        
    Returns:
        A tuple of (loca_df, geol_df) DataFrames.
    """
    try:
        tables, headings = AGS4.AGS4_to_dataframe(file_path)
    except Exception as e:
        raise ValueError(f"Failed to parse AGS file at {file_path}: {e}")
        
    if not tables:
        raise ValueError(f"AGS file at {file_path} returned no tables. It might be invalid or empty.")
        
    # Ensure both LOCA and GEOL groups exist
    if 'LOCA' not in tables:
        raise ValueError("AGS file is missing the required 'LOCA' (Location) group.")
    if 'GEOL' not in tables:
        raise ValueError("AGS file is missing the required 'GEOL' (Geology) group.")
        
    # Use python-ags4 helper to convert numeric columns and strip metadata/unit rows for each table
    try:
        loca_df = AGS4.convert_to_numeric(tables['LOCA']).copy()
        geol_df = AGS4.convert_to_numeric(tables['GEOL']).copy()
    except Exception as e:
        # Fallback manual conversion if helper fails
        loca_df = tables['LOCA'].copy()
        geol_df = tables['GEOL'].copy()
        # Filter out UNIT and TYPE lines if they exist
        if 'HEADING' in loca_df.columns:
            loca_df = loca_df[loca_df['HEADING'] == 'DATA'].copy()
        if 'HEADING' in geol_df.columns:
            geol_df = geol_df[geol_df['HEADING'] == 'DATA'].copy()
    
    # Ensure required columns are present in LOCA
    required_loca = ['LOCA_ID', 'LOCA_NATE', 'LOCA_NATN', 'LOCA_GL']
    for col in required_loca:
        if col not in loca_df.columns:
            raise ValueError(f"LOCA group is missing required column: {col}")
            
    # Ensure required columns are present in GEOL
    required_geol = ['LOCA_ID', 'GEOL_TOP', 'GEOL_BASE']
    for col in required_geol:
        if col not in geol_df.columns:
            raise ValueError(f"GEOL group is missing required column: {col}")
            
    # Stratigraphic label column: prefer GEOL_LEG (legend code) or GEOL_GEOL (geology code)
    if 'GEOL_LEG' in geol_df.columns:
        geol_df['surface'] = geol_df['GEOL_LEG']
    elif 'GEOL_GEOL' in geol_df.columns:
        geol_df['surface'] = geol_df['GEOL_GEOL']
    else:
        raise ValueError("GEOL group must contain either 'GEOL_LEG' or 'GEOL_GEOL' for surface classification.")
        
    # Standardize data types and drop rows with invalid coordinates or depths
    loca_df['LOCA_NATE'] = pd.to_numeric(loca_df['LOCA_NATE'], errors='coerce')
    loca_df['LOCA_NATN'] = pd.to_numeric(loca_df['LOCA_NATN'], errors='coerce')
    loca_df['LOCA_GL'] = pd.to_numeric(loca_df['LOCA_GL'], errors='coerce')
    
    loca_df = loca_df.dropna(subset=['LOCA_ID', 'LOCA_NATE', 'LOCA_NATN', 'LOCA_GL'])
    
    geol_df['GEOL_TOP'] = pd.to_numeric(geol_df['GEOL_TOP'], errors='coerce')
    geol_df['GEOL_BASE'] = pd.to_numeric(geol_df['GEOL_BASE'], errors='coerce')
    
    geol_df = geol_df.dropna(subset=['LOCA_ID', 'GEOL_TOP', 'GEOL_BASE', 'surface'])
    
    # Trim strings
    loca_df['LOCA_ID'] = loca_df['LOCA_ID'].astype(str).str.strip()
    geol_df['LOCA_ID'] = geol_df['LOCA_ID'].astype(str).str.strip()
    geol_df['surface'] = geol_df['surface'].astype(str).str.strip()
    
    # Subset to only return the necessary columns
    loca_df = loca_df[['LOCA_ID', 'LOCA_NATE', 'LOCA_NATN', 'LOCA_GL']].copy()
    geol_df = geol_df[['LOCA_ID', 'GEOL_TOP', 'GEOL_BASE', 'surface']].copy()
    
    return loca_df, geol_df
