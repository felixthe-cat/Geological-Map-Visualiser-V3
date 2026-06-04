# Use python 3.12 slim image
FROM python:3.12-slim

# Install system dependencies for PyVista offscreen rendering and VTK
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglx0 \
    libglapi-mesa \
    libosmesa6 \
    xvfb \
    libxrender1 \
    libxt6 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Set up user with UID 1000 for Hugging Face Spaces compatibility
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYVISTA_OFF_SCREEN=true \
    PYVISTA_PLOT_DIRECTLY=false

WORKDIR $HOME/app

# Copy requirements and install
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY --chown=user . .

# Expose port 7860 for Gradio
EXPOSE 7860

# Run the application
CMD ["python", "app.py"]
