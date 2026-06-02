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

def create_grid(min_x, max_x, min_y, max_y, z_level, spacing=50.0, line_radius=0.5):
    """
    Creates a 3D grid mesh at a specific Z level using thin cylinders.
    """
    grid_meshes = []
    
    start_x = np.floor(min_x / spacing) * spacing
    end_x = np.ceil(max_x / spacing) * spacing
    start_y = np.floor(min_y / spacing) * spacing
    end_y = np.ceil(max_y / spacing) * spacing
    
    x_lines = np.arange(start_x, end_x + spacing, spacing)
    y_lines = np.arange(start_y, end_y + spacing, spacing)
    
    # Draw lines parallel to Y axis (constant X)
    for x in x_lines:
        length = end_y - start_y
        if length <= 0:
            continue
        cyl = trimesh.creation.cylinder(radius=line_radius, height=length, sections=4)
        R = trimesh.transformations.rotation_matrix(np.radians(90), [1, 0, 0])
        cyl.apply_transform(R)
        cyl.apply_translation([x, (start_y + end_y)/2.0, z_level])
        grid_meshes.append(cyl)
        
    # Draw lines parallel to X axis (constant Y)
    for y in y_lines:
        length = end_x - start_x
        if length <= 0:
            continue
        cyl = trimesh.creation.cylinder(radius=line_radius, height=length, sections=4)
        R = trimesh.transformations.rotation_matrix(np.radians(90), [0, 1, 0])
        cyl.apply_transform(R)
        cyl.apply_translation([(start_x + end_x)/2.0, y, z_level])
        grid_meshes.append(cyl)
        
    if not grid_meshes:
        return None
        
    grid_mesh = trimesh.util.concatenate(grid_meshes)
    grid_mesh.visual.face_colors = [180, 180, 180, 100]  # Semi-transparent light grey
    return grid_mesh

def export_to_glb(geo_model, output_path: str) -> str:
    """
    Extracts surface meshes from the computed GemPy GeoModel, converts them
    to Trimesh objects, and exports them to a single multi-mesh GLB file.
    The meshes are centered around (0,0,0) and rotated from Z-up to Y-up
    for correct horizontal presentation in WebGL.
    Also adds a local grid and coordinate axis indicator.
    """
    surfaces = [e.name for e in geo_model.structural_frame.structural_elements if e.name != 'basement']
    
    # 1. Collect all real-world vertices first to find global bounding box
    all_vertices = []
    for mesh_data in geo_model.solutions.dc_meshes:
        v = geo_model.input_transform.apply_inverse(mesh_data.vertices)
        if len(v) > 0:
            all_vertices.append(v)
            
    if not all_vertices:
        raise ValueError("No valid meshes found in GemPy solution to export.")
        
    all_vertices = np.concatenate(all_vertices, axis=0)
    min_coords = all_vertices.min(axis=0)
    max_coords = all_vertices.max(axis=0)
    center = (min_coords + max_coords) / 2.0
    
    meshes_to_combine = []
    
    # Calculate grid parameters based on physical scale
    span_x = max_coords[0] - min_coords[0]
    span_y = max_coords[1] - min_coords[1]
    max_span = max(span_x, span_y)
    
    if max_span <= 50.0:
        spacing = 10.0
        line_radius = 0.05
    elif max_span <= 250.0:
        spacing = 50.0
        line_radius = 0.2
    elif max_span <= 1000.0:
        spacing = 100.0
        line_radius = 0.5
    else:
        spacing = 500.0
        line_radius = 1.5
        
    # Homogeneous transformation for rotation from Z-up to Y-up
    R = np.array([
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, -1.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 1.0]
    ])
    
    # 2. Add grid lines at bottom elevation
    grid_mesh = create_grid(
        min_x=min_coords[0], max_x=max_coords[0],
        min_y=min_coords[1], max_y=max_coords[1],
        z_level=min_coords[2],
        spacing=spacing,
        line_radius=line_radius
    )
    
    if grid_mesh is not None:
        grid_mesh.apply_translation([-center[0], -center[1], -center[2]])
        grid_mesh.apply_transform(R)
        meshes_to_combine.append(grid_mesh)
        
    # 3. Add XYZ axes at the corner of the grid
    start_x = np.floor(min_coords[0] / spacing) * spacing
    start_y = np.floor(min_coords[1] / spacing) * spacing
    z_level = min_coords[2]
    
    axis_length = max(spacing * 0.6, 5.0)
    axis_radius = line_radius * 1.5
    
    axis_mesh = trimesh.creation.axis(
        origin_size=axis_radius * 2.5,
        axis_radius=axis_radius,
        axis_length=axis_length
    )
    axis_mesh.apply_translation([start_x - center[0], start_y - center[1], z_level - center[2]])
    axis_mesh.apply_transform(R)
    meshes_to_combine.append(axis_mesh)
    
    # 4. Add layer surface meshes
    for i, mesh_data in enumerate(geo_model.solutions.dc_meshes):
        if i >= len(surfaces):
            break
        surface_name = surfaces[i]
        
        # Apply inverse transformation to restore real-world coordinates
        vertices = geo_model.input_transform.apply_inverse(mesh_data.vertices)
        faces = mesh_data.edges
        
        if len(vertices) == 0 or len(faces) == 0:
            continue
            
        # Center the vertices around (0, 0, 0)
        centered_vertices = vertices.copy()
        centered_vertices[:, 0] -= center[0]
        centered_vertices[:, 1] -= center[1]
        centered_vertices[:, 2] -= center[2]
        
        # Create trimesh
        t_mesh = trimesh.Trimesh(vertices=centered_vertices, faces=faces)
        
        # Set color based on palette
        color = COLOR_RGB_PALETTE[i % len(COLOR_RGB_PALETTE)]
        t_mesh.visual.face_colors = color
        
        # Assign name to the mesh nodes in glTF
        t_mesh.metadata = {'name': surface_name}
        
        # Rotate Z-up to Y-up (rotation of -90 degrees around X-axis)
        t_mesh.apply_transform(R)
        
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
    Also adds a legend for the layers.
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
            label=surfaces[i],  # Label for legend
            opacity=0.85, 
            show_edges=True,
            edge_color='#555555'
        )
        has_mesh = True
        
    if not has_mesh:
        raise ValueError("No valid meshes found in GemPy solution to render.")
        
    plotter.view_isometric()
    plotter.add_axes()
    
    # Add a legend on the screenshot
    plotter.add_legend(
        bcolor='white',
        border=True,
        size=(0.18, 0.18)
    )
    
    plotter.screenshot(output_path)
    plotter.close()
    return output_path

def export_solids_to_glb(geo_model, output_path: str) -> str:
    """
    Extracts solid volume stratum meshes from the computed GemPy GeoModel solutions
    using PyVista ImageData voxel thresholding. Converts them to Trimesh objects,
    centers them around (0,0,0), rotates Z-up to Y-up, and exports them to a single GLB file.
    Also adds a local grid and coordinate axis indicator.
    """
    elements = geo_model.structural_frame.structural_elements
    
    # 1. Access grid and solutions properties
    nx, ny, nz = geo_model.grid.regular_grid.resolution
    extent = geo_model.grid.regular_grid.extent
    lith = geo_model.solutions.raw_arrays.lith_block
    
    # Calculate global bounding box to center the model
    center = np.array([
        (extent[0] + extent[1]) / 2.0,
        (extent[2] + extent[3]) / 2.0,
        (extent[4] + extent[5]) / 2.0
    ])
    
    # Define PyVista ImageData representing voxel grid
    grid = pv.ImageData()
    grid.dimensions = [nx + 1, ny + 1, nz + 1]
    grid.spacing = [
        (extent[1] - extent[0]) / nx,
        (extent[3] - extent[2]) / ny,
        (extent[5] - extent[4]) / nz
    ]
    grid.origin = [extent[0], extent[2], extent[4]]
    grid.cell_data['lithology'] = lith
    
    meshes_to_combine = []
    
    # Calculate grid parameters for the floor grid
    span_x = extent[1] - extent[0]
    span_y = extent[3] - extent[2]
    max_span = max(span_x, span_y)
    
    if max_span <= 50.0:
        spacing = 10.0
        line_radius = 0.05
    elif max_span <= 250.0:
        spacing = 50.0
        line_radius = 0.2
    elif max_span <= 1000.0:
        spacing = 100.0
        line_radius = 0.5
    else:
        spacing = 500.0
        line_radius = 1.5
        
    # Homogeneous transformation for rotation from Z-up to Y-up
    R = np.array([
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, -1.0, 0.0, 0.0],
        [0.0, 0.0, 0.0, 1.0]
    ])
    
    # 2. Add grid lines at bottom elevation
    grid_mesh = create_grid(
        min_x=extent[0], max_x=extent[1],
        min_y=extent[2], max_y=extent[3],
        z_level=extent[4],
        spacing=spacing,
        line_radius=line_radius
    )
    
    if grid_mesh is not None:
        grid_mesh.apply_translation([-center[0], -center[1], -center[2]])
        grid_mesh.apply_transform(R)
        meshes_to_combine.append(grid_mesh)
        
    # 3. Add XYZ axes at the corner of the grid
    start_x = np.floor(extent[0] / spacing) * spacing
    start_y = np.floor(extent[2] / spacing) * spacing
    z_level = extent[4]
    
    axis_length = max(spacing * 0.6, 5.0)
    axis_radius = line_radius * 1.5
    
    axis_mesh = trimesh.creation.axis(
        origin_size=axis_radius * 2.5,
        axis_radius=axis_radius,
        axis_length=axis_length
    )
    axis_mesh.apply_translation([start_x - center[0], start_y - center[1], z_level - center[2]])
    axis_mesh.apply_transform(R)
    meshes_to_combine.append(axis_mesh)
    
    # 4. Extract volumetric meshes for each stratigraphic stratum
    # Element indices in lith_block are 1-based index (1 = Soil, 2 = Clay, etc.)
    for val in range(1, len(elements) + 1):
        element_name = elements[val - 1].name
        
        # Isolate voxels matching this lithology value
        vol = grid.threshold([val, val], scalars="lithology")
        if vol.n_points == 0 or vol.n_cells == 0:
            continue
            
        # Extract boundaries and triangulate quad faces for trimesh
        surf = vol.extract_surface(algorithm='dataset_surface').triangulate()
        vertices = surf.points
        faces_flat = surf.faces
        
        if len(vertices) == 0 or len(faces_flat) == 0:
            continue
            
        faces = faces_flat.reshape(-1, 4)[:, 1:]
        
        # Center vertices
        centered_vertices = vertices.copy()
        centered_vertices[:, 0] -= center[0]
        centered_vertices[:, 1] -= center[1]
        centered_vertices[:, 2] -= center[2]
        
        # Create trimesh
        t_mesh = trimesh.Trimesh(vertices=centered_vertices, faces=faces)
        
        # Set colors matching the palette
        color = COLOR_RGB_PALETTE[(val - 1) % len(COLOR_RGB_PALETTE)]
        t_mesh.visual.face_colors = color
        t_mesh.metadata = {'name': element_name}
        
        # Rotate Z-up to Y-up
        t_mesh.apply_transform(R)
        
        meshes_to_combine.append(t_mesh)
        
    if not meshes_to_combine:
        raise ValueError("No valid volumetric meshes found to export.")
        
    # Create the scene and export to GLB
    scene = trimesh.Scene(meshes_to_combine)
    scene.export(output_path, file_type='glb')
    return output_path
