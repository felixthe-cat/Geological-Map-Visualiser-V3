// ================================================================
// GeoVisualise 3D — Vercel Frontend Controller
// ================================================================

const HF_SPACE_URL = 'https://huggingface.co/spaces/ferxxxxx/Geological-Map-Visualiser-V3';

// ----------------------------------------------------------------
const iframe = document.getElementById('viewer-iframe');

function toEmbedUrl(url) {
  url = url.trim();
  // Convert huggingface.co/spaces/user/space → user-space.hf.space
  if (url.includes('huggingface.co/spaces/')) {
    const after = url.split('huggingface.co/spaces/')[1] || '';
    const [user, space] = after.split('/');
    if (user && space) {
      const slug = `${user}-${space.replace(/_/g, '-')}`.toLowerCase();
      return `https://${slug}.hf.space`;
    }
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  return url;
}

function loadSpace(url) {
  if (!url || url.includes('YOUR_USERNAME')) {
    console.warn('[GeoVisualise] Set HF_SPACE_URL in app.js to your Hugging Face Space URL.');
    return;
  }
  iframe.src = toEmbedUrl(url);
}

window.addEventListener('DOMContentLoaded', () => {
  loadSpace(HF_SPACE_URL);
});
