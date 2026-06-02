import pandas as pd

def ingest_csv(file_path: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Parses a fallback CSV file and maps columns to match the LOCA and GEOL structure.
    
    Expected CSV columns:
        borehole_id, x, y, surface, top_depth, base_depth, ground_level
        
    Returns:
        A tuple of (loca_df, geol_df) DataFrames.
    """
    try:
        df = pd.read_csv(file_path)
    except Exception as e:
        raise ValueError(f"Failed to parse CSV file at {file_path}: {e}")
        
    required_cols = ['borehole_id', 'x', 'y', 'surface', 'top_depth', 'base_depth', 'ground_level']
    # Check case-insensitively and map
    df.columns = [col.strip().lower() for col in df.columns]
    
    for col in required_cols:
        if col not in df.columns:
            raise ValueError(f"CSV file is missing required column: '{col}' (columns found: {list(df.columns)})")
            
    # Clean data types
    df['x'] = pd.to_numeric(df['x'], errors='coerce')
    df['y'] = pd.to_numeric(df['y'], errors='coerce')
    df['top_depth'] = pd.to_numeric(df['top_depth'], errors='coerce')
    df['base_depth'] = pd.to_numeric(df['base_depth'], errors='coerce')
    df['ground_level'] = pd.to_numeric(df['ground_level'], errors='coerce')
    
    # Drop rows with critical missing values
    df = df.dropna(subset=['borehole_id', 'x', 'y', 'surface', 'top_depth', 'base_depth', 'ground_level'])
    
    # Format LOCA-like DataFrame
    loca_df = df[['borehole_id', 'x', 'y', 'ground_level']].drop_duplicates(subset=['borehole_id']).copy()
    loca_df = loca_df.rename(columns={
        'borehole_id': 'LOCA_ID',
        'x': 'LOCA_NATE',
        'y': 'LOCA_NATN',
        'ground_level': 'LOCA_GL'
    })
    
    # Format GEOL-like DataFrame
    geol_df = df[['borehole_id', 'top_depth', 'base_depth', 'surface']].copy()
    geol_df = geol_df.rename(columns={
        'borehole_id': 'LOCA_ID',
        'top_depth': 'GEOL_TOP',
        'base_depth': 'GEOL_BASE'
    })
    
    # Trim strings
    loca_df['LOCA_ID'] = loca_df['LOCA_ID'].astype(str).str.strip()
    geol_df['LOCA_ID'] = geol_df['LOCA_ID'].astype(str).str.strip()
    geol_df['surface'] = geol_df['surface'].astype(str).str.strip()
    
    return loca_df, geol_df
