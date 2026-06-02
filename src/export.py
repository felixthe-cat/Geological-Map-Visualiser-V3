import os
import zipfile
import numpy as np
import pyvista as pv
import trimesh

# Custom color palette (sleek and modern geological colors)
# Sandy Brown, Medium Turquoise, Slate Grey, Goldenrod, Dark Sea Green, Steel Blue
COLOR_HEX_PALETTE = [
    '#F4A460',  # Sandy Brown
    '#48D1CC',  # Medium Turquoise
    '#708090',  # Slate Grey
    '#DAA520',  # Goldenrod
    '#8FBC8F',  # Dark Sea Green
    '#4682B4'   # Steel Blue
]

COLOR_RGB_PALETTE = [
    [244, 164, 96, 255],   # Sandy Brown
    [72, 209, 204, 255],   # Medium Turquoise
    [112, 128, 144, 255],  # Slate Grey
    [218, 165, 32, 255],   # Goldenrod
    [143, 188, 143, 255],  # Dark Sea Green
    [70, 130, 180, 255]    # Steel Blue
]

def export_to_glb(geo_model, output_path: str) -> str:
    """
    Extracts surface meshes from the computed GemPy GeoModel, converts them
    to Trimesh objects, and exports them to a single multi-mesh GLB file.
    """
    surfaces = [e.name for e in geo_model.structural_frame.structural_elements if e.name != 'basement']
    meshes_to_combine = []
    
    for i, mesh_data in enumerate(geo_model.solutions.dc_meshes):
        if i >= len(surfaces):
            break
        surface_name = surfaces[i]
        
        # Apply inverse transformation to restore real-world coordinates
        vertices = geo_model.input_transform.apply_inverse(mesh_data.vertices)
        faces = mesh_data.edges
        
        if len(vertices) == 0 or len(faces) == 0:
            continue
            
        # Create trimesh
        t_mesh = trimesh.Trimesh(vertices=vertices, faces=faces)
        
        # Set color based on palette
        color = COLOR_RGB_PALETTE[i % len(COLOR_RGB_PALETTE)]
        t_mesh.visual.face_colors = color
        
        # Assign name to the mesh nodes in glTF
        t_mesh.metadata = {'name': surface_name}
        
        meshes_to_combine.append(t_mesh)
        
    if not meshes_to_combine:
        raise ValueError("No valid meshes found in GemPy solution to export.")
        
    # Create the scene and export to GLB
    scene = trimesh.Scene(meshes_to_combine)
    scene.export(output_path, file_type='glb')
    return output_path

def export_to_vtk(geo_model, zip_output_path: str) -> str:
    """
    Extracts surface meshes from the computed GemPy GeoModel, saves each as a VTK file,
    and bundles them into a zip archive.
    """
    surfaces = [e.name for e in geo_model.structural_frame.structural_elements if e.name != 'basement']
    vtk_files = []
    
    # Create a temporary directory or save directly
    temp_files = []
    
    try:
        for i, mesh_data in enumerate(geo_model.solutions.dc_meshes):
            if i >= len(surfaces):
                break
            surface_name = surfaces[i]
            
            # Apply inverse transformation
            vertices = geo_model.input_transform.apply_inverse(mesh_data.vertices)
            faces = mesh_data.edges
            
            if len(vertices) == 0 or len(faces) == 0:
                continue
                
            # PyVista requires faces prefixed by their vertex count (3 for triangles)
            faces_pv = np.hstack([np.full((len(faces), 1), 3), faces]).astype(np.int32).flatten()
            pv_mesh = pv.PolyData(vertices, faces_pv)
            
            # Save individual VTK file
            filename = f"{surface_name.replace(' ', '_')}.vtk"
            pv_mesh.save(filename)
            temp_files.append(filename)
            
        if not temp_files:
            raise ValueError("No valid meshes found in GemPy solution to export.")
            
        # Create zip archive
        with zipfile.ZipFile(zip_output_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            for file in temp_files:
                zip_file.write(file, os.path.basename(file))
                
        return zip_output_path
        
    finally:
        # Cleanup temp VTK files
        for file in temp_files:
            if os.path.exists(file):
                os.remove(file)

def export_to_png(geo_model, output_path: str) -> str:
    """
    Renders the model surfaces offscreen and saves a static image screenshot.
    """
    # Start XVFB if on Linux and headless (to avoid PyVista crash on HF spaces)
    if os.name != 'nt':
        try:
            pv.start_xvfb()
        except Exception:
            pass
            
    plotter = pv.Plotter(off_screen=True)
    surfaces = [e.name for e in geo_model.structural_frame.structural_elements if e.name != 'basement']
    
    has_mesh = False
    
    for i, mesh_data in enumerate(geo_model.solutions.dc_meshes):
        if i >= len(surfaces):
            break
            
        vertices = geo_model.input_transform.apply_inverse(mesh_data.vertices)
        faces = mesh_data.edges
        
        if len(vertices) == 0 or len(faces) == 0:
            continue
            
        faces_pv = np.hstack([np.full((len(faces), 1), 3), faces]).astype(np.int32).flatten()
        pv_mesh = pv.PolyData(vertices, faces_pv)
        
        color = COLOR_HEX_PALETTE[i % len(COLOR_HEX_PALETTE)]
        plotter.add_mesh(
            pv_mesh, 
            color=color, 
            name=surfaces[i], 
            opacity=0.85, 
            show_edges=True,
            edge_color='#555555'
        )
        has_mesh = True
        
    if not has_mesh:
        raise ValueError("No valid meshes found in GemPy solution to render.")
        
    plotter.view_isometric()
    plotter.add_axes()
    plotter.screenshot(output_path)
    plotter.close()
    return output_path
