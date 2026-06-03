// State and Selectors
let supabaseUrl = localStorage.getItem('geo_supabase_url');
let supabaseKey = localStorage.getItem('geo_supabase_key');
let hfSpaceUrl = localStorage.getItem('geo_hf_space_url');
let supabaseClient = null;
let currentUser = null;
let isSignUpMode = false;

// Dom Elements
const setupView = document.getElementById('setup-view');
const authView = document.getElementById('auth-view');
const dashboardView = document.getElementById('dashboard-view');
const authForm = document.getElementById('auth-form');
const authEmail = document.getElementById('auth-email');
const authPassword = document.getElementById('auth-password');
const btnAuthSubmit = document.getElementById('btn-auth-submit');
const authTitle = document.getElementById('auth-view-title');
const authSubtitle = document.getElementById('auth-view-subtitle');
const linkToggleAuth = document.getElementById('link-toggle-auth');
const authToggleMsg = document.getElementById('auth-toggle-msg');
const authError = document.getElementById('auth-error');
const authSuccess = document.getElementById('auth-success');

const setupUrl = document.getElementById('setup-url');
const setupKey = document.getElementById('setup-key');
const setupError = document.getElementById('setup-error');
const btnSaveSetup = document.getElementById('btn-save-setup');
const btnResetKeys = document.getElementById('btn-reset-keys');

const navUserInfo = document.getElementById('nav-user-info');
const userEmailSpan = document.getElementById('user-email');
const btnLogout = document.getElementById('btn-logout');

const dropzone = document.getElementById('dropzone');
const fileUploader = document.getElementById('file-uploader');
const fileListContainer = document.getElementById('file-list');
const uploadError = document.getElementById('upload-error');
const uploadSuccess = document.getElementById('upload-success');

const emptyViewer = document.getElementById('empty-viewer');
const viewerIframe = document.getElementById('viewer-iframe');
const hfUrlInput = document.getElementById('hf-url-input');
const btnSaveHf = document.getElementById('btn-save-hf');

// Initialize Application
function init() {
  if (supabaseUrl && supabaseKey) {
    try {
      supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
      checkSession();
    } catch (err) {
      showSetup("Failed to initialize Supabase. Check your parameters.");
    }
  } else {
    showSetup();
  }
  
  if (hfSpaceUrl) {
    loadIframe(hfSpaceUrl);
  }
}

// UI Views Toggle Helpers
function showSetup(errorMsg = '') {
  setupView.style.display = 'flex';
  authView.style.display = 'none';
  dashboardView.style.display = 'none';
  navUserInfo.style.display = 'none';
  btnLogout.style.display = 'none';
  
  if (errorMsg) {
    setupError.textContent = errorMsg;
    setupError.style.display = 'block';
  } else {
    setupError.style.display = 'none';
  }
  
  if (supabaseUrl) setupUrl.value = supabaseUrl;
  if (supabaseKey) setupKey.value = supabaseKey;
}

function showAuth() {
  setupView.style.display = 'none';
  authView.style.display = 'flex';
  dashboardView.style.display = 'none';
  navUserInfo.style.display = 'none';
  btnLogout.style.display = 'none';
  
  // Set default form values
  isSignUpMode = false;
  updateAuthUI();
}

function showDashboard(user) {
  setupView.style.display = 'none';
  authView.style.display = 'none';
  dashboardView.style.display = 'flex';
  
  currentUser = user;
  userEmailSpan.textContent = user.email;
  navUserInfo.style.display = 'flex';
  btnLogout.style.display = 'block';
  
  fetchFiles();
}

// Check current active session
async function checkSession() {
  try {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    
    if (session) {
      showDashboard(session.user);
    } else {
      showAuth();
    }
  } catch (err) {
    console.error("Session check error:", err);
    showAuth();
  }
}

// 1. Setup Form Event
btnSaveSetup.addEventListener('click', () => {
  const url = setupUrl.value.trim();
  const key = setupKey.value.trim();
  
  if (!url || !key) {
    setupError.textContent = "Please fill in all config parameters.";
    setupError.style.display = 'block';
    return;
  }
  
  try {
    // Validate by trying to create client
    const client = supabase.createClient(url, key);
    if (client) {
      localStorage.setItem('geo_supabase_url', url);
      localStorage.setItem('geo_supabase_key', key);
      supabaseUrl = url;
      supabaseKey = key;
      supabaseClient = client;
      setupError.style.display = 'none';
      checkSession();
    }
  } catch (err) {
    setupError.textContent = "Invalid URL or Key format. Verification failed.";
    setupError.style.display = 'block';
  }
});

btnResetKeys.addEventListener('click', () => {
  if (confirm("Are you sure you want to reconfigure Supabase project settings?")) {
    localStorage.removeItem('geo_supabase_url');
    localStorage.removeItem('geo_supabase_key');
    supabaseUrl = null;
    supabaseKey = null;
    supabaseClient = null;
    showSetup();
  }
});

// 2. Auth Toggle Login / Registration
linkToggleAuth.addEventListener('click', (e) => {
  e.preventDefault();
  isSignUpMode = !isSignUpMode;
  updateAuthUI();
});

function updateAuthUI() {
  authError.style.display = 'none';
  authSuccess.style.display = 'none';
  authForm.reset();
  
  if (isSignUpMode) {
    authTitle.textContent = "Create Account";
    authSubtitle.textContent = "Sign up to begin uploading and visualising geological maps.";
    btnAuthSubmit.textContent = "Sign Up";
    authToggleMsg.textContent = "Already have an account?";
    linkToggleAuth.textContent = "Sign In";
  } else {
    authTitle.textContent = "Welcome Back";
    authSubtitle.textContent = "Sign in to your account to view geological models.";
    btnAuthSubmit.textContent = "Sign In";
    authToggleMsg.textContent = "Don't have an account?";
    linkToggleAuth.textContent = "Sign Up";
  }
}

// Auth Submit Handling
authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = authEmail.value.trim();
  const password = authPassword.value.trim();
  
  authError.style.display = 'none';
  authSuccess.style.display = 'none';
  
  if (password.length < 6) {
    authError.textContent = "Password must be at least 6 characters.";
    authError.style.display = 'block';
    return;
  }
  
  btnAuthSubmit.disabled = true;
  btnAuthSubmit.textContent = isSignUpMode ? "Signing Up..." : "Signing In...";
  
  try {
    if (isSignUpMode) {
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if (error) throw error;
      
      authSuccess.textContent = "Registration successful! Please check your email for confirmation, or log in if confirmation is disabled.";
      authSuccess.style.display = 'block';
      isSignUpMode = false;
      setTimeout(updateAuthUI, 3000);
    } else {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      
      showDashboard(data.user);
    }
  } catch (err) {
    authError.textContent = err.message || "Authentication failed.";
    authError.style.display = 'block';
  } finally {
    btnAuthSubmit.disabled = false;
    btnAuthSubmit.textContent = isSignUpMode ? "Sign Up" : "Sign In";
  }
});

// Logout Event
btnLogout.addEventListener('click', async () => {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
    currentUser = null;
    showAuth();
  }
});

// 3. Hugging Face Space URL configuration
btnSaveHf.addEventListener('click', () => {
  let url = hfUrlInput.value.trim();
  if (!url) return;
  
  // Format Hugging Face Spaces embed URL if the user pastes the Space website URL
  if (url.includes('huggingface.co/spaces/')) {
    const parts = url.split('huggingface.co/spaces/');
    if (parts.length > 1) {
      const spaceParts = parts[1].split('/');
      if (spaceParts.length >= 2) {
        url = `https://${spaceParts[0]}-${spaceParts[1].replace(/_/g, '-')}.hf.space`;
      }
    }
  }
  
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  
  localStorage.setItem('geo_hf_space_url', url);
  hfSpaceUrl = url;
  loadIframe(url);
});

function loadIframe(url) {
  emptyViewer.style.display = 'none';
  viewerIframe.src = url;
  viewerIframe.style.display = 'block';
}

// 4. File Drag & Drop + Supabase Database Storage Integration
dropzone.addEventListener('click', () => fileUploader.click());

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.style.borderColor = 'var(--color-sky)';
  dropzone.style.background = 'rgba(14, 165, 233, 0.05)';
});

dropzone.addEventListener('dragleave', () => {
  dropzone.style.borderColor = 'rgba(14, 165, 233, 0.3)';
  dropzone.style.background = 'none';
});

dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.style.borderColor = 'rgba(14, 165, 233, 0.3)';
  dropzone.style.background = 'none';
  
  if (e.dataTransfer.files.length > 0) {
    handleFileUpload(e.dataTransfer.files[0]);
  }
});

fileUploader.addEventListener('change', () => {
  if (fileUploader.files.length > 0) {
    handleFileUpload(fileUploader.files[0]);
  }
});

// File upload processing
async function handleFileUpload(file) {
  uploadError.style.display = 'none';
  uploadSuccess.style.display = 'none';
  
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext !== 'ags' && ext !== 'csv') {
    showUploadError("Unsupported file type. Please upload a .ags or .csv file.");
    return;
  }
  
  if (file.size > 10 * 1024 * 1024) { // 10MB limit
    showUploadError("File exceeds the 10MB limit.");
    return;
  }
  
  try {
    dropzone.style.pointerEvents = 'none';
    dropzone.querySelector('p').textContent = "Uploading file to storage...";
    
    // 1. Upload to Supabase Storage (bucket named: "boreholes-models")
    const fileExt = file.name.split('.').pop();
    const fileName = `${currentUser.id}/${Date.now()}_${file.name}`;
    
    const { data: uploadData, error: uploadErrorMsg } = await supabaseClient.storage
      .from('boreholes-models')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false
      });
      
    if (uploadErrorMsg) {
      // Handle missing bucket gracefully by instructing user
      if (uploadErrorMsg.message.includes("Bucket not found")) {
        throw new Error("Supabase Storage bucket 'boreholes-models' not found. Please create this bucket as public in your Supabase dashboard.");
      }
      throw uploadErrorMsg;
    }
    
    // 2. Get Public URL
    const { data: { publicUrl } } = supabaseClient.storage
      .from('boreholes-models')
      .getPublicUrl(fileName);
      
    // 3. Write row log inside Postgres Database "boreholes"
    const { error: dbError } = await supabaseClient
      .from('boreholes')
      .insert([
        {
          user_id: currentUser.id,
          filename: file.name,
          file_url: publicUrl,
          created_at: new Date().toISOString()
        }
      ]);
      
    if (dbError) {
      if (dbError.message.includes("relation") && dbError.message.includes("not found")) {
        throw new Error("Postgres table 'boreholes' not found. Please create the table in Supabase SQL editor using the schema in the implementation plan.");
      }
      throw dbError;
    }
    
    uploadSuccess.textContent = `Uploaded ${file.name} successfully.`;
    uploadSuccess.style.display = 'block';
    fetchFiles();
    
  } catch (err) {
    showUploadError(err.message || "Failed to upload file.");
    console.error(err);
  } finally {
    dropzone.style.pointerEvents = 'auto';
    dropzone.querySelector('p').textContent = "Drag & drop .ags or .csv";
  }
}

function showUploadError(msg) {
  uploadError.textContent = msg;
  uploadError.style.display = 'block';
}

// Fetch files from Supabase Postgres logs
async function fetchFiles() {
  fileListContainer.innerHTML = '<div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 1rem 0;">Loading files list...</div>';
  
  try {
    const { data, error } = await supabaseClient
      .from('boreholes')
      .select('*')
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    
    if (data.length === 0) {
      fileListContainer.innerHTML = '<div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 1rem 0;">No datasets uploaded yet.</div>';
      return;
    }
    
    fileListContainer.innerHTML = '';
    data.forEach(item => {
      const date = new Date(item.created_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      const fileEl = document.createElement('div');
      fileEl.className = 'file-item';
      fileEl.innerHTML = `
        <div class="file-info">
          <div class="file-name">${escapeHtml(item.filename)}</div>
          <div class="file-meta">${date}</div>
        </div>
        <a href="${item.file_url}" target="_blank" class="file-action-btn" title="Download source file">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </a>
      `;
      fileListContainer.appendChild(fileEl);
    });
  } catch (err) {
    fileListContainer.innerHTML = `<div style="text-align: center; color: var(--color-rose); font-size: 0.85rem; padding: 1rem 0;">Error reading logs: ${escapeHtml(err.message)}</div>`;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// Start
window.addEventListener('DOMContentLoaded', init);
