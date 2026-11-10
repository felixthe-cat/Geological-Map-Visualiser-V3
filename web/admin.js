// Lightweight admin gate for hiding not-yet-ready features (3D) from normal
// users while letting us test them.
//
// SECURITY NOTE: this is a client-side deterrent, NOT real security. The page
// stores only a SHA-256 hash of the password (never the plaintext), so the
// password can't be read straight from the source — but a determined user can
// still bypass a client-side check (e.g. by setting the localStorage flag).
// For genuine access control the gated features would need server-side auth.
(function () {
  const HASH = 'acd3f40f3a531aacafce58f42cc3d8d229af5dc36e23723dd4477953ce476b4c';
  const KEY = 'geovis_admin';

  async function sha256(s) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  function isAdmin() { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } }
  async function tryLogin(pw) {
    if (!pw) return false;
    const ok = (await sha256(pw)) === HASH;
    if (ok) localStorage.setItem(KEY, '1');
    return ok;
  }
  function logout() { localStorage.removeItem(KEY); }

  window.GeoAdmin = { isAdmin, tryLogin, logout };
})();
