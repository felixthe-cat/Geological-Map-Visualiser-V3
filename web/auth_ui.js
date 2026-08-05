// Shared header sign-in control, mounted on every page that wants it.
//
// Renders nothing at all when Supabase is unconfigured, so the live site is
// unchanged until credentials are filled into supabase_config.js.
import { isConfigured, onAuthChange, signInWithGoogle, signOut } from './cloud.js';

const STYLE = `
.gv-auth{display:flex;align-items:center;gap:8px;font-size:13px}
.gv-auth button{font:inherit;cursor:pointer;border-radius:6px;padding:5px 10px;
  border:1px solid rgba(216,230,196,.35);background:transparent;color:#d8e6c4;white-space:nowrap}
.gv-auth button:hover{background:rgba(216,230,196,.12)}
.gv-auth .gv-avatar{width:22px;height:22px;border-radius:50%;object-fit:cover;
  border:1px solid rgba(216,230,196,.4)}
.gv-auth .gv-who{display:flex;align-items:center;gap:6px;max-width:190px}
.gv-auth .gv-email{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85}
.gv-auth a.gv-link{color:#d8e6c4;text-decoration:none;font-size:13px;white-space:nowrap}
.gv-auth a.gv-link:hover{text-decoration:underline}
/* Light-background pages (the 2D Builder body) need darker text than the
   dark header the landing page uses. */
.gv-auth.gv-on-light button{border-color:#c8bda8;color:#3d3529}
.gv-auth.gv-on-light button:hover{background:rgba(0,0,0,.05)}
.gv-auth.gv-on-light a.gv-link{color:#3d3529}
`;

function injectStyle(){
  if (document.getElementById('gv-auth-style')) return;
  const s = document.createElement('style');
  s.id = 'gv-auth-style';
  s.textContent = STYLE;
  document.head.appendChild(s);
}

function esc(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * Mount the control into `host`.
 * @param host      element to render into
 * @param opts.onLight   true on light-background headers
 * @param opts.showProjects  show a "My projects" link (hide it on account.html itself)
 * @param opts.onUser    called with the user (or null) whenever auth changes
 */
export async function mountAuthControl(host, opts = {}){
  if (!host || !isConfigured()) return () => {};
  injectStyle();
  host.classList.add('gv-auth');
  if (opts.onLight) host.classList.add('gv-on-light');

  const render = (user) => {
    if (!user){
      host.innerHTML = '<button type="button" data-gv="signin">Sign in with Google</button>';
      return;
    }
    const meta = user.user_metadata || {};
    const avatar = meta.avatar_url || meta.picture || '';
    const label = meta.full_name || meta.name || user.email || 'Signed in';
    host.innerHTML =
      '<span class="gv-who" title="'+esc(user.email||'')+'">'+
        (avatar ? '<img class="gv-avatar" src="'+esc(avatar)+'" alt="" referrerpolicy="no-referrer">' : '')+
        '<span class="gv-email">'+esc(label)+'</span>'+
      '</span>'+
      (opts.showProjects === false ? '' : '<a class="gv-link" href="account.html">My projects</a>')+
      '<button type="button" data-gv="signout">Sign out</button>';
  };

  host.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-gv]');
    if (!btn) return;
    const action = btn.getAttribute('data-gv');
    btn.disabled = true;
    try {
      if (action === 'signin') await signInWithGoogle();
      else if (action === 'signout'){ await signOut(); location.reload(); }
    } catch (err){
      alert('Sign-in failed: ' + (err?.message || err));
      btn.disabled = false;
    }
  });

  return onAuthChange((user) => { render(user); opts.onUser?.(user); });
}
