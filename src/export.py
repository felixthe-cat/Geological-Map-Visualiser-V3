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

# A simple vector font stroke mapping (in [0,1]x[0,2] char bounds)
STROKE_FONT = {
    '0': [((0,0), (1,0)), ((1,0), (1,2)), ((1,2), (0,2)), ((0,2), (0,0)), ((0,0), (1,2))],
    '1': [((0.5,0), (0.5,2)), ((0.2,1.6), (0.5,2))],
    '2': [((0,2), (1,2)), ((1,2), (1,1)), ((1,1), (0,0)), ((0,0), (1,0))],
    '3': [((0,2), (1,2)), ((1,2), (1,0)), ((1,0), (0,0)), ((0,1), (1,1))],
    '4': [((0,2), (0,1)), ((0,1), (1,1)), ((1,2), (1,0))],
    '5': [((1,2), (0,2)), ((0,2), (0,1)), ((0,1), (1,1)), ((1,1), (1,0)), ((1,0), (0,0))],
    '6': [((1,2), (0,2)), ((0,2), (0,0)), ((0,0), (1,0)), ((1,0), (1,1)), ((1,1), (0,1))],
    '7': [((0,2), (1,2)), ((1,2), (0,0))],
    '8': [((0,0), (1,0)), ((1,0), (1,2)), ((1,2), (0,2)), ((0,2), (0,0)), ((0,1), (1,1))],
    '9': [((0,1), (1,1)), ((1,1), (1,2)), ((1,2), (0,2)), ((0,2), (0,1)), ((1,1), (1,0)), ((1,0), (0,0))],
    '.': [((0.4,0), (0.6,0)), ((0.5,-0.1), (0.5,0.1))],
    '-': [((0.2,1), (0.8,1))],
    'E': [((1,0), (0,0)), ((0,0), (0,2)), ((0,2), (1,2)), ((0,1), (0.8,1))],
    'N': [((0,0), (0,2)), ((0,2), (1,0)), ((1,0), (1,2))],
    'Z': [((0,2), (1,2)), ((1,2), (0,0)), ((0,0), (1,0))],
    'm': [((0,0), (0,1.2)), ((0,1.2), (0.5,1.2)), ((0.5,1.2), (0.5,0)), ((0.5,1.2), (1,1.2)), ((1,1.2), (1,0))],
    ' ': []
}

def create_cylinder_between_points(A, B, radius, sections=4):
    """
    Creates a cylinder mesh aligned between point A and point B in 3D.
    """
    height = np.linalg.norm(B - A)
    if height < 1e-6:
        return None
    cyl = trimesh.creation.cylinder(radius=radius, height=height, sections=sections)
    midpoint = (A + B) / 2.0
    direction = (B - A) / height
    
    z_axis = np.array([0.0, 0.0, 1.0])
    if np.allclose(direction, z_axis):
        cyl.apply_translation(midpoint)
        return cyl
    elif np.allclose(direction, -z_axis):
        cyl.apply_translation(midpoint)
        return cyl
        
    axis = np.cross(z_axis, direction)
    axis_len = np.linalg.norm(axis)
    axis = axis / axis_len
    angle = np.arccos(np.dot(z_axis, direction))
    
    R = trimesh.transformations.rotation_matrix(angle, axis)
    cyl.apply_transform(R)
    cyl.apply_translation(midpoint)
    return cyl

def create_text_mesh_3d(text, origin, char_width=2.0, char_height=4.0, spacing=0.5, radius=0.1, color=[100, 100, 100, 255]):
    """
    Constructs a 3D text mesh in the X-Z plane using stroke segments.
    """
    meshes = []
    text = str(text)
    current_x = 0.0
    for char in text:
        if char in STROKE_FONT:
            segments = STROKE_FONT[char]
            for p1, p2 in segments:
                A = np.array([
                    origin[0] + (current_x + p1[0] * char_width),
                    origin[1],
                    origin[2] + p1[1] * (char_height / 2.0)
                ])
                B = np.array([
                    origin[0] + (current_x + p2[0] * char_width),
                    origin[1],
                    origin[2] + p2[1] * (char_height / 2.0)
                ])
                cyl = create_cylinder_between_points(A, B, radius, sections=4)
                if cyl is not None:
                    meshes.append(cyl)
        current_x += char_width + spacing
    if not meshes:
        return None
    combined = trimesh.util.concatenate(meshes)
    combined.visual.face_colors = color
    return combined

def clip_mesh_with_pyvista(vertices, faces, normal, origin, close_surface=False):
    """
    Clips a mesh using PyVista's clip function and returns the clipped (vertices, faces) for Trimesh.
    If close_surface is True, uses clip_closed_surface to generate cap faces at the cut plane.
    """
    if len(vertices) == 0 or len(faces) == 0:
        return vertices, faces
        
    faces_pv = np.hstack([np.full((len(faces), 1), 3), faces]).astype(np.int32).flatten()
    pv_mesh = pv.PolyData(vertices, faces_pv)
    
    # Perform clipping
    if close_surface:
        try:
            clipped = pv_mesh.clip_closed_surface(normal=normal, origin=origin)
        except Exception:
            # Fallback to standard clip if clipping closed surface fails
            clipped = pv_mesh.clip(normal=normal, origin=origin, invert=False)
    else:
        clipped = pv_mesh.clip(normal=normal, origin=origin, invert=False)
        
    if clipped.n_points == 0 or clipped.n_cells == 0:
        return np.empty((0, 3)), np.empty((0, 3), dtype=np.int32)
        
    # Ensure it's triangulated
    tri_clipped = clipped.triangulate()
    
    v_out = tri_clipped.points
    f_out = tri_clipped.faces.reshape(-1, 4)[:, 1:]
    
    return v_out, f_out

def add_grid_labels_and_ticks(
    meshes_to_combine,
    min_coords,
    max_coords,
    center,
    z_scale,
    spacing,
    line_radius,
    R
):
    # Determine bounds
    start_x = np.floor(min_coords[0] / spacing) * spacing
    end_x = np.ceil(max_coords[0] / spacing) * spacing
    start_y = np.floor(min_coords[1] / spacing) * spacing
    end_y = np.ceil(max_coords[1] / spacing) * spacing
    z_level = min_coords[2]
    
    # Label offsets and sizes
    char_w = spacing * 0.04
    char_h = char_w * 2.0
    char_sp = char_w * 0.2
    char_r = line_radius * 0.5
    
    # 1. Add Easting (X) labels along start_y edge
    # Offset in Y
    y_offset = spacing * 0.08
    for x in np.arange(start_x, end_x + spacing, spacing):
        text_mesh = create_text_mesh_3d(
            text=f"{int(x)}E",
            origin=[x - center[0] - (len(f"{int(x)}E") * char_w)/2.0, start_y - center[1] - y_offset, (z_level - center[2]) * z_scale],
            char_width=char_w,
            char_height=char_h,
            spacing=char_sp,
            radius=char_r,
            color=[120, 120, 120, 255]
        )
        if text_mesh is not None:
            text_mesh.apply_transform(R)
            meshes_to_combine.append(text_mesh)
            
    # 2. Add Northing (Y) labels along start_x edge
    x_offset = spacing * 0.12
    for y in np.arange(start_y, end_y + spacing, spacing):
        text_mesh = create_text_mesh_3d(
            text=f"{int(y)}N",
            origin=[start_x - center[0] - x_offset, y - center[1] - char_h/4.0, (z_level - center[2]) * z_scale],
            char_width=char_w,
            char_height=char_h,
            spacing=char_sp,
            radius=char_r,
            color=[120, 120, 120, 255]
        )
        if text_mesh is not None:
            text_mesh.apply_transform(R)
            meshes_to_combine.append(text_mesh)
            
    # 3. Add vertical elevation ticks and labels
    span_z = max_coords[2] - min_coords[2]
    if span_z <= 20.0:
        spacing_z = 5.0
    elif span_z <= 50.0:
        spacing_z = 10.0
    else:
        spacing_z = 20.0
        
    start_z = np.floor(min_coords[2] / spacing_z) * spacing_z
    end_z = np.ceil(max_coords[2] / spacing_z) * spacing_z
    
    # Draw vertical tick pole at (start_x, start_y)
    pole_h = (end_z - start_z) * z_scale
    if pole_h > 0:
        pole = trimesh.creation.cylinder(radius=line_radius * 1.2, height=pole_h)
        pole.apply_translation([start_x - center[0], start_y - center[1], (start_z + end_z)/2.0 * z_scale - center[2] * z_scale])
        pole.apply_transform(R)
        pole.visual.face_colors = [150, 150, 150, 255]
        meshes_to_combine.append(pole)
        
    # Draw ticks and text along the pole
    for z in np.arange(start_z, end_z + spacing_z, spacing_z):
        # Tick cylinder along X
        tick_len = spacing * 0.05
        tick = trimesh.creation.cylinder(radius=line_radius * 0.8, height=tick_len)
        # Rotate to align with X axis
        R_tick = trimesh.transformations.rotation_matrix(np.radians(90), [0, 1, 0])
        tick.apply_transform(R_tick)
        tick.apply_translation([start_x - center[0] - tick_len/2.0, start_y - center[1], (z - center[2]) * z_scale])
        tick.apply_transform(R)
        tick.visual.face_colors = [150, 150, 150, 255]
        meshes_to_combine.append(tick)
        
        # Label Z
        z_label_offset = spacing * 0.15
        text_mesh = create_text_mesh_3d(
            text=f"{int(z)}m",
            origin=[start_x - center[0] - z_label_offset, start_y - center[1], (z - center[2]) * z_scale - char_h/4.0],
            char_width=char_w,
            char_height=char_h,
            spacing=char_sp,
            radius=char_r,
            color=[120, 120, 120, 255]
        )
        if text_mesh is not None:
            text_mesh.apply_transform(R)
            meshes_to_combine.append(text_mesh)

def add_topography_contours(
    meshes_to_combine,
    geo_model,
    z_scale,
    center,
    line_radius,
    R,
    clip_active=False,
    normal=None,
    origin=None
):
    """
    Generates topography contour lines on the uppermost surface mesh and adds them to the scene.
    """
    if len(geo_model.solutions.dc_meshes) == 0:
        return
        
    mesh_data = geo_model.solutions.dc_meshes[0]
    vertices = geo_model.input_transform.apply_inverse(mesh_data.vertices)
    faces = mesh_data.edges
    
    if len(vertices) == 0 or len(faces) == 0:
        return
        
    # Scale Z
    vertices = vertices.copy()
    vertices[:, 2] *= z_scale
    
    # Center vertices
    centered_vertices = vertices.copy()
    centered_vertices[:, 0] -= center[0]
    centered_vertices[:, 1] -= center[1]
    centered_vertices[:, 2] -= center[2]
    
    # Convert to PyVista PolyData
    faces_pv = np.hstack([np.full((len(faces), 1), 3), faces]).astype(np.int32).flatten()
    pv_mesh = pv.PolyData(centered_vertices, faces_pv)
    
    # Determine Z range of this surface
    min_z = centered_vertices[:, 2].min()
    max_z = centered_vertices[:, 2].max()
    span_z = max_z - min_z
    
    if span_z < 0.1:
        return
        
    if span_z <= 5.0:
        interval = 0.5
    elif span_z <= 20.0:
        interval = 1.0
    elif span_z <= 50.0:
        interval = 2.0
    else:
        interval = 5.0
        
    start_val = np.ceil(min_z / interval) * interval
    end_val = np.floor(max_z / interval) * interval
    z_levels = np.arange(start_val, end_val + interval, interval)
    
    if len(z_levels) == 0:
        return
        
    pv_mesh.point_data['elevation'] = pv_mesh.points[:, 2]
    
    try:
        contours = pv_mesh.contour(isosurfaces=z_levels, scalars='elevation')
    except Exception:
        return
        
    if contours.n_points == 0 or contours.n_cells == 0:
        return
        
    # Parse line segments
    lines_data = contours.lines
    idx = 0
    segments = []
    while idx < len(lines_data):
        n_pts = lines_data[idx]
        pt_ids = lines_data[idx+1 : idx+1+n_pts]
        for i in range(len(pt_ids)-1):
            A = contours.points[pt_ids[i]]
            B = contours.points[pt_ids[i+1]]
            segments.append((A, B))
        idx += 1 + n_pts
        
    # Create thin cylinder meshes for contours
    contour_radius = line_radius * 0.4
    contour_meshes = []
    
    for A, B in segments:
        cyl = create_cylinder_between_points(A, B, radius=contour_radius, sections=3)
        if cyl is not None:
            contour_meshes.append(cyl)
            
    if not contour_meshes:
        return
        
    combined_contours = trimesh.util.concatenate(contour_meshes)
    
    if clip_active and normal is not None and origin is not None:
        v_c, f_c = clip_mesh_with_pyvista(combined_contours.vertices, combined_contours.faces, normal, origin)
        if len(v_c) == 0 or len(f_c) == 0:
            return
        combined_contours = trimesh.Trimesh(vertices=v_c, faces=f_c)
        
    color_float = np.array([40, 40, 40, 255]) / 255.0
    material = trimesh.visual.material.PBRMaterial(
        baseColorFactor=color_float,
        doubleSided=True
    )
    combined_contours.visual = trimesh.visual.TextureVisuals(material=material)
    combined_contours.apply_transform(R)
    meshes_to_combine.append(combined_contours)

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

def export_to_glb(
    geo_model, 
    output_path: str,
    z_scale: float = 1.0,
    visible_layers: list[str] = None,
    opacity: float = 1.0,
    show_boreholes: bool = True,
    show_grid: bool = True,
    clipping_plane: dict = None,
    loca_df = None,
    geol_df = None,
    show_contours: bool = True
) -> str:
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
    # Apply z_scale to vertices elevation
    all_vertices[:, 2] *= z_scale
    
    min_coords = all_vertices.min(axis=0)
    max_coords = all_vertices.max(axis=0)
    center = (min_coords + max_coords) / 2.0
    
    # Setup clipping normal and origin if enabled
    clip_active = clipping_plane is not None and clipping_plane.get('enabled', False)
    if clip_active:
        c_min = min_coords - center
        c_max = max_coords - center
        axis = clipping_plane.get('axis', 'X').upper()
        pct = clipping_plane.get('position_pct', 50.0) / 100.0
        
        if axis == 'X':
            slice_val = c_min[0] + pct * (c_max[0] - c_min[0])
            normal = [-1.0, 0.0, 0.0]
            origin = [slice_val, 0.0, 0.0]
        elif axis == 'Y':
            slice_val = c_min[1] + pct * (c_max[1] - c_min[1])
            normal = [0.0, -1.0, 0.0]
            origin = [0.0, slice_val, 0.0]
        else: # Z
            slice_val = c_min[2] + pct * (c_max[2] - c_min[2])
            normal = [0.0, 0.0, -1.0]
            origin = [0.0, 0.0, slice_val]
            
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
    
    # 2. Add grid lines and labels
    if show_grid:
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
            
        # Add labels
        add_grid_labels_and_ticks(
            meshes_to_combine=meshes_to_combine,
            min_coords=min_coords,
            max_coords=max_coords,
            center=center,
            z_scale=z_scale,
            spacing=spacing,
            line_radius=line_radius,
            R=R
        )
        
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
        
        # Filter visibility
        if visible_layers is not None and surface_name not in visible_layers:
            continue
            
        # Apply inverse transformation to restore real-world coordinates
        vertices = geo_model.input_transform.apply_inverse(mesh_data.vertices)
        faces = mesh_data.edges
        
        if len(vertices) == 0 or len(faces) == 0:
            continue
            
        # Scale Z
        vertices = vertices.copy()
        vertices[:, 2] *= z_scale
        
        # Center the vertices around (0, 0, 0)
        centered_vertices = vertices.copy()
        centered_vertices[:, 0] -= center[0]
        centered_vertices[:, 1] -= center[1]
        centered_vertices[:, 2] -= center[2]
        
        # Clip if active
        if clip_active:
            centered_vertices, faces = clip_mesh_with_pyvista(centered_vertices, faces, normal, origin)
            if len(centered_vertices) == 0 or len(faces) == 0:
                continue
                
        # Create trimesh
        t_mesh = trimesh.Trimesh(vertices=centered_vertices, faces=faces)
        
        # Set color and doubleSided using PBRMaterial
        color = COLOR_RGB_PALETTE[i % len(COLOR_RGB_PALETTE)].copy()
        color[3] = int(opacity * 255)
        color_float = np.array(color) / 255.0
        material = trimesh.visual.material.PBRMaterial(
            baseColorFactor=color_float,
            doubleSided=True
        )
        t_mesh.visual = trimesh.visual.TextureVisuals(material=material)
        
        # Assign name to the mesh nodes in glTF
        t_mesh.metadata = {'name': surface_name}
        
        # Rotate Z-up to Y-up (rotation of -90 degrees around X-axis)
        t_mesh.apply_transform(R)
        
        meshes_to_combine.append(t_mesh)
        
    # 5. Add Borehole Cylinders
    if show_boreholes and loca_df is not None and geol_df is not None and not loca_df.empty and not geol_df.empty:
        borehole_radius = line_radius * 2.0
        for bh_id in loca_df['LOCA_ID'].unique():
            bh_loc = loca_df[loca_df['LOCA_ID'] == bh_id]
            if bh_loc.empty:
                continue
            bh_loc = bh_loc.iloc[0]
            x_b = bh_loc['LOCA_NATE']
            y_b = bh_loc['LOCA_NATN']
            gl_b = bh_loc['LOCA_GL']
            
            bh_layers = geol_df[geol_df['LOCA_ID'] == bh_id]
            for _, layer in bh_layers.iterrows():
                top_depth = layer['GEOL_TOP']
                base_depth = layer['GEOL_BASE']
                layer_surf = layer['surface']
                
                # Filter layer visibility
                if visible_layers is not None and layer_surf not in visible_layers:
                    continue
                    
                z_top = (gl_b - top_depth) * z_scale
                z_base = (gl_b - base_depth) * z_scale
                h_b = z_top - z_base
                if h_b <= 0.001:
                    continue
                    
                cyl = trimesh.creation.cylinder(radius=borehole_radius, height=h_b, sections=6)
                
                x_c = x_b - center[0]
                y_c = y_b - center[1]
                z_c = (z_top + z_base) / 2.0 - center[2]
                
                cyl.apply_translation([x_c, y_c, z_c])
                
                if clip_active:
                    v_b, f_b = clip_mesh_with_pyvista(cyl.vertices, cyl.faces, normal, origin)
                    if len(v_b) == 0 or len(f_b) == 0:
                        continue
                    cyl = trimesh.Trimesh(vertices=v_b, faces=f_b)
                    
                # Map color
                color = [150, 150, 150, 255]
                if layer_surf in surfaces:
                    surf_idx = surfaces.index(layer_surf)
                    color = COLOR_RGB_PALETTE[surf_idx % len(COLOR_RGB_PALETTE)].copy()
                    color[3] = int(opacity * 255)
                    
                color_float = np.array(color) / 255.0
                material = trimesh.visual.material.PBRMaterial(
                    baseColorFactor=color_float,
                    doubleSided=True
                )
                cyl.visual = trimesh.visual.TextureVisuals(material=material)
                cyl.apply_transform(R)
                meshes_to_combine.append(cyl)
                
    # Add topography contours if enabled
    if show_contours:
        add_topography_contours(
            meshes_to_combine=meshes_to_combine,
            geo_model=geo_model,
            z_scale=z_scale,
            center=center,
            line_radius=line_radius,
            R=R,
            clip_active=clip_active,
            normal=normal if clip_active else None,
            origin=origin if clip_active else None
        )
        
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

def export_solids_to_glb(
    geo_model, 
    output_path: str,
    z_scale: float = 1.0,
    visible_layers: list[str] = None,
    opacity: float = 1.0,
    show_boreholes: bool = True,
    show_grid: bool = True,
    clipping_plane: dict = None,
    loca_df = None,
    geol_df = None,
    show_contours: bool = True
) -> str:
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
    
    # Calculate global bounding box to center the model (applying z_scale)
    center = np.array([
        (extent[0] + extent[1]) / 2.0,
        (extent[2] + extent[3]) / 2.0,
        (extent[4] + extent[5]) / 2.0 * z_scale
    ])
    
    # Define PyVista ImageData representing voxel grid
    grid = pv.ImageData()
    grid.dimensions = [nx + 1, ny + 1, nz + 1]
    grid.spacing = [
        (extent[1] - extent[0]) / nx,
        (extent[3] - extent[2]) / ny,
        (extent[5] - extent[4]) / nz * z_scale
    ]
    grid.origin = [extent[0], extent[2], extent[4] * z_scale]
    grid.cell_data['lithology'] = lith.reshape((nx, ny, nz)).flatten(order='F')
    
    # Calculate grid bounds for ticks
    min_coords = np.array([extent[0], extent[2], extent[4] * z_scale])
    max_coords = np.array([extent[1], extent[3], extent[5] * z_scale])
    
    # Setup clipping normal and origin if enabled
    clip_active = clipping_plane is not None and clipping_plane.get('enabled', False)
    if clip_active:
        c_min = min_coords - center
        c_max = max_coords - center
        axis = clipping_plane.get('axis', 'X').upper()
        pct = clipping_plane.get('position_pct', 50.0) / 100.0
        
        if axis == 'X':
            slice_val = c_min[0] + pct * (c_max[0] - c_min[0])
            normal = [-1.0, 0.0, 0.0]
            origin = [slice_val, 0.0, 0.0]
        elif axis == 'Y':
            slice_val = c_min[1] + pct * (c_max[1] - c_min[1])
            normal = [0.0, -1.0, 0.0]
            origin = [0.0, slice_val, 0.0]
        else: # Z
            slice_val = c_min[2] + pct * (c_max[2] - c_min[2])
            normal = [0.0, 0.0, -1.0]
            origin = [0.0, 0.0, slice_val]
            
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
    
    # 2. Add grid lines and labels
    if show_grid:
        grid_mesh = create_grid(
            min_x=extent[0], max_x=extent[1],
            min_y=extent[2], max_y=extent[3],
            z_level=extent[4] * z_scale,
            spacing=spacing,
            line_radius=line_radius
        )
        
        if grid_mesh is not None:
            grid_mesh.apply_translation([-center[0], -center[1], -center[2]])
            grid_mesh.apply_transform(R)
            meshes_to_combine.append(grid_mesh)
            
        # Add labels
        add_grid_labels_and_ticks(
            meshes_to_combine=meshes_to_combine,
            min_coords=min_coords,
            max_coords=max_coords,
            center=center,
            z_scale=z_scale,
            spacing=spacing,
            line_radius=line_radius,
            R=R
        )
        
        # 3. Add XYZ axes at the corner of the grid
        start_x = np.floor(extent[0] / spacing) * spacing
        start_y = np.floor(extent[2] / spacing) * spacing
        z_level = extent[4] * z_scale
        
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
    for val in range(1, len(elements) + 1):
        element_name = elements[val - 1].name
        
        # Filter stratum visibility
        if visible_layers is not None and element_name not in visible_layers:
            continue
            
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
        
        # Clip if active
        if clip_active:
            centered_vertices, faces = clip_mesh_with_pyvista(centered_vertices, faces, normal, origin, close_surface=True)
            if len(centered_vertices) == 0 or len(faces) == 0:
                continue
                
        # Create trimesh
        t_mesh = trimesh.Trimesh(vertices=centered_vertices, faces=faces)
        
        # Set colors and doubleSided using PBRMaterial
        color = COLOR_RGB_PALETTE[(val - 1) % len(COLOR_RGB_PALETTE)].copy()
        color[3] = int(opacity * 255)
        color_float = np.array(color) / 255.0
        material = trimesh.visual.material.PBRMaterial(
            baseColorFactor=color_float,
            doubleSided=True
        )
        t_mesh.visual = trimesh.visual.TextureVisuals(material=material)
        t_mesh.metadata = {'name': element_name}
        
        # Rotate Z-up to Y-up
        t_mesh.apply_transform(R)
        
        meshes_to_combine.append(t_mesh)
        
    # 5. Add Borehole Cylinders
    if show_boreholes and loca_df is not None and geol_df is not None and not loca_df.empty and not geol_df.empty:
        borehole_radius = line_radius * 2.0
        for bh_id in loca_df['LOCA_ID'].unique():
            bh_loc = loca_df[loca_df['LOCA_ID'] == bh_id]
            if bh_loc.empty:
                continue
            bh_loc = bh_loc.iloc[0]
            x_b = bh_loc['LOCA_NATE']
            y_b = bh_loc['LOCA_NATN']
            gl_b = bh_loc['LOCA_GL']
            
            bh_layers = geol_df[geol_df['LOCA_ID'] == bh_id]
            for _, layer in bh_layers.iterrows():
                top_depth = layer['GEOL_TOP']
                base_depth = layer['GEOL_BASE']
                layer_surf = layer['surface']
                
                # Filter layer visibility
                if visible_layers is not None and layer_surf not in visible_layers:
                    continue
                    
                z_top = (gl_b - top_depth) * z_scale
                z_base = (gl_b - base_depth) * z_scale
                h_b = z_top - z_base
                if h_b <= 0.001:
                    continue
                    
                cyl = trimesh.creation.cylinder(radius=borehole_radius, height=h_b, sections=6)
                
                x_c = x_b - center[0]
                y_c = y_b - center[1]
                z_c = (z_top + z_base) / 2.0 - center[2]
                
                cyl.apply_translation([x_c, y_c, z_c])
                
                if clip_active:
                    v_b, f_b = clip_mesh_with_pyvista(cyl.vertices, cyl.faces, normal, origin)
                    if len(v_b) == 0 or len(f_b) == 0:
                        continue
                    cyl = trimesh.Trimesh(vertices=v_b, faces=f_b)
                    
                # Map color
                color = [150, 150, 150, 255]
                elem_names = [e.name for e in elements]
                if layer_surf in elem_names:
                    surf_idx = elem_names.index(layer_surf)
                    color = COLOR_RGB_PALETTE[surf_idx % len(COLOR_RGB_PALETTE)].copy()
                    color[3] = int(opacity * 255)
                    
                color_float = np.array(color) / 255.0
                material = trimesh.visual.material.PBRMaterial(
                    baseColorFactor=color_float,
                    doubleSided=True
                )
                cyl.visual = trimesh.visual.TextureVisuals(material=material)
                cyl.apply_transform(R)
                meshes_to_combine.append(cyl)
                
    # Add topography contours if enabled
    if show_contours:
        add_topography_contours(
            meshes_to_combine=meshes_to_combine,
            geo_model=geo_model,
            z_scale=z_scale,
            center=center,
            line_radius=line_radius,
            R=R,
            clip_active=clip_active,
            normal=normal if clip_active else None,
            origin=origin if clip_active else None
        )
        
    if not meshes_to_combine:
        raise ValueError("No valid volumetric meshes found to export.")
        
    scene = trimesh.Scene(meshes_to_combine)
    scene.export(output_path, file_type='glb')
    return output_path
