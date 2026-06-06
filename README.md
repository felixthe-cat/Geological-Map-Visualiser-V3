---
title: Geological Map Visualiser V3
emoji: 🏔️
colorFrom: blue
colorTo: gray
sdk: docker
pinned: false
---

# Geological Map Visualiser V3

A web-hosted geotechnical tool that automates the construction of 3D geological models from borehole data (Hong Kong **AGS** files or custom **CSVs**). 

The backend parses the stratigraphic contacts, builds a 3D geological model using the **GemPy** implicit structural modeling engine, and renders it in an interactive browser-based 3D visualiser. The final 3D model can be downloaded as a **GLB** file for CAD/BIM compatibility, a **VTK** mesh pack, or a static **PNG** screenshot.

---

## 🚀 Key Features

*   **Borehole Ingestion:** Parses official Hong Kong CEDD AGS files natively using `python-ags4`.
*   **Fallback CSV Schema:** Upload custom coordinates and layer contact depths if AGS data is unavailable.
*   **3D Implicit Interpolation:** Reconstructs complex layer boundaries automatically using GemPy.
*   **Interoperable Exports:**
    *   **GLB (glTF Binary):** Renders natively in-browser; compatible with Three.js, Blender, and CAD/BIM packages.
    *   **VTK Zip:** A pack of `.vtk` meshes for advanced analysis in ParaView or Leapfrog.
    *   **PNG screenshot:** Off-screen isometric rendering of the layered geological model.
*   **Modern Premium UI:** Build with Gradio using Outfit typography, smooth layout transitions, and glassmorphic aesthetics.

---

## 🛠️ Local Installation & Setup

Ensure you have **Python 3.11** or **Python 3.12** installed on your system.

### 1. Clone & Set Up Environment
```bash
# Navigate to the project directory
cd "Geological Map Visualiser V3"

# Create a virtual environment
python -m venv .venv

# Activate the virtual environment
# On Windows (PowerShell):
.venv\Scripts\Activate.ps1
# On Linux / macOS:
source .venv/bin/activate
```

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Run the Gradio App Locally
```bash
python app.py
```
Open `http://localhost:7860` in your web browser.

### 4. Running Tests
Run the automated test suite to verify ingestion, transform, modeling, and exporting:
```bash
pytest
```

---

## 📊 Where to Get Hong Kong AGS Data

Ground Investigation (GI) and Lab Test (LT) records are published as open data in AGS format by the Civil Engineering and Development Department (CEDD).

1.  **[Hong Kong Government Open Data Portal](https://data.gov.hk/en-data/dataset/hk-cedd-csu-cedd-gi-lt):** Search and download complete GI datasets by contract number.
2.  **[CSDI Spatial Portal](https://portal.csdi.gov.hk/):** Query and download spatial layers representing borehole stations and geotech data.
3.  **[Geotechnical Information Infrastructure (CSDI G-Info)](https://ginfo.cedd.gov.hk/):** An interactive map portal where you can click on specific regions of Hong Kong and download nearby borehole files in AGS format.

---

## 📂 CSV Fallback Schema

If you do not have an AGS file, you can upload a single CSV file representing your borehole layers. The CSV must contain the following columns:

| Column | Description | Example |
|---|---|---|
| `borehole_id` | Unique alphanumeric string representing the borehole location | `BH-001` |
| `x` | Easting coordinate (e.g. HK1980 Grid, in meters) | `840000.0` |
| `y` | Northing coordinate (e.g. HK1980 Grid, in meters) | `820000.0` |
| `surface` | Name of the geological formation or layer interface (top of layer) | `Clay` |
| `top_depth` | Vertical depth to the top of the layer from the ground level (meters) | `5.0` |
| `base_depth` | Vertical depth to the base of the layer from the ground level (meters) | `15.0` |
| `ground_level` | Elevation of the borehole collar above sea level datum (meters) | `15.0` |

*Note: Ensure all dimensions (coordinates, elevations, and depths) are consistent metric units (meters).*

---

## ⚠️ Known Modeling Assumptions & Limitations

1.  **Sub-Horizontal Assumption:** Standard AGS files and geological reports record interface contacts (depths) but lack structural orientations (dip and azimuth). The visualiser assumes sub-horizontal geological layering (default dip of ~1.0° to 2.0°) unless customized orientations are specified.
2.  **Model Grid Resolution:** For Hugging Face Spaces (CPU Free Tier, ~16 GB RAM), the modeling grid resolution is capped between 20³ and 60³ to prevent Out-Of-Memory (OOM) errors and processing timeouts.
3.  **Complex Tectonics:** This v1 model is designed for depositional stratigraphic layering. Folds, fault displacement, and intrusive structures are outside the scope of this baseline release.

---

## ☁️ Deploying to Hugging Face Spaces

This repository is pre-configured with a `Dockerfile` for Hugging Face Spaces compatibility.

1. Create a new Space on [Hugging Face](https://huggingface.co/new-space).
2. Choose **Docker** as the SDK.
3. Push the files in this directory to your Space's repository.
4. Hugging Face will build the image, spin up a virtual framebuffer (XVFB) for off-screen rendering, and launch the Gradio server automatically.
