# Geological Map Visualiser V3 — Implementation Plan

## Goal Description

A web-hosted tool where a user uploads borehole data (Hong Kong AGS files or CSV), the server builds a 3D geological model with GemPy, and the user views it in the browser and downloads it as a GLB 3D file.

## User Review Required

> [!IMPORTANT]
> **Proposed Stratum Volume (Solid) vs. Interface Layer (Surface) Toggle Feature**
> We have mapped out a plan to toggle between viewing the 2D layer boundary interfaces (current representation) and the 3D solid volumetric strata blocks (soil/rock bodies).
> - **Solid stratum extraction**: The volumetric data computed by GemPy on the 3D regular grid (`geo_model.solutions.lith_block`) will be loaded into a PyVista `UniformGrid` matching the model dimensions. A `threshold` filter will isolate cell blocks by lithology unit index, and `extract_surface()` will extract the outer closed boundary.
> - **Dual Exports**: The backend will render and export both `geology_model_interfaces.glb` and `geology_model_solids.glb`.
> - **Gradio Toggle**: A radio input component `Render Mode` ("Interface Surfaces" or "Volumetric Solids") will update the active model in `gr.Model3D` dynamically when toggled.
> Please review this planned toggle feature for future milestones.

---

## 🛠️ Completed Changes (Executed)

### 1. Coordinate Grid & Local Axis
- Created a `create_grid` helper using thin cylinders representing grid lines at the bottom elevation boundary of the geological model, dynamically spaced based on the physical bounding box (10m, 50m, 100m, or 500m intervals).
- Integrated `trimesh.creation.axis` at the bottom-left coordinate of the grid to display standard Red-Green-Blue axes representing X (Easting), Y (Northing), and Z (Elevation) orientations.
- Centered WebGL coordinates around `(0, 0, 0)` and rotated them -90° around the X-axis for horizontal presentation in the browser, eliminating WebGL float32 coordinate truncation and camera orbit glitches.
- Pushed updates successfully to GitHub ([felixthe-cat/Geological-Map-Visualiser-V3](https://github.com/felixthe-cat/Geological-Map-Visualiser-V3)).

### 2. Dynamic Legend Support
- Configured a dynamic HTML legend block in Gradio right below the `gr.Model3D` viewer that changes color-swatches depending on the layer names present in the uploaded dataset.
- Added native legend support inside the offscreen PyVista PNG renderer plotter so that download screenshots contain color swatches.

---

## 📋 Proposed Changes (Toggle Feature - Future Execution)

### [Component Name] Stratum Volume Extractor & Toggle UI

#### [MODIFY] [export.py](file:///c:/VS%20Code%20Projects/Geological%20Map%20Visualiser%20V3/src/export.py)
* Add `export_solids_to_glb(geo_model, output_path)`:
  * Extract resolution and extent from the `geo_model.grid`.
  * Instantiate a `pyvista.UniformGrid` matching the regular grid shape.
  * Load `geo_model.solutions.lith_block` values into the cells.
  * Loop over each unique lithology ID, run `grid.threshold([lith_id, lith_id]).extract_surface()`.
  * Convert the PyVista volumetric surface mesh back to real-world coordinates, apply the centering translation, rotate Z-up to Y-up, and add to `trimesh` scene.
  * Save as a solid volume GLB.

#### [MODIFY] [app.py](file:///c:/VS%20Code%20Projects/Geological%20Map%20Visualiser%20V3/app.py)
* Add `gr.Radio(choices=["Interface Separation Surfaces", "Volumetric Solids"], value="Interface Separation Surfaces", label="Render Mode")` in the control panel.
* Modify `generate_model` to calculate and export **both** `geology_model_interfaces.glb` and `geology_model_solids.glb`.
* Return both file paths (or cache them in a state container) and load the selected one dynamically based on the radio button value.

---

## Verification Plan

### Automated Tests
- Add a new integration test: `pytest tests/test_model_solids.py` to verify that `export_solids_to_glb` builds and exports a valid GLB.

### Manual Verification
- Deploy to Hugging Face Spaces and test the interactive toggle widget to confirm responsiveness and correct visual representation of soil/rock strata volumes.
