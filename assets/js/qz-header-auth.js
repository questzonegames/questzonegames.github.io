// ===== Quest Zone — header auth-state sync =====
//
// Runs on every page that shares the standard header. Logged out: leaves
// the existing "Profile / Signup / Login" buttons in place, just repoints
// Signup/Login from their old "coming soon" placeholder to the real
// signup/login pages (accounts are live now). Logged in: replaces them
// with the player's username, an Admin link (only if their profile is
// flagged admin — the link itself is just a convenience; the page it
// leads to is what actually enforces access, via RLS), and Logout.
(function () {
  function pathPrefix() {
    // the logo link is already correctly relative per page ("index.html"
    // at the root, "../index.html" one level down) — reuse that instead
    // of hardcoding depth per page.
    const logo = document.querySelector('.logo');
    const href = logo ? logo.getAttribute('href') || '' : '';
    return href.replace(/index\.html$/, '');
  }

  function repointComingSoonAuthLinks(prefix) {
    const actions = document.querySelector('.header-actions');
    if (!actions) return;
    actions.querySelectorAll('a[data-coming-soon]').forEach((a) => {
      const label = (a.textContent || '').trim();
      if (label === 'Signup') {
        a.href = prefix + 'signup.html';
        a.removeAttribute('data-coming-soon');
      } else if (label === 'Login') {
        a.href = prefix + 'login.html';
        a.removeAttribute('data-coming-soon');
      }
    });
  }

  function renderLoggedIn(actions, prefix, profile) {
    actions.innerHTML = '';

    const profileBtn = document.createElement('a');
    profileBtn.href = prefix + 'profile/index.html';
    profileBtn.className = 'btn btn-chrome-dark';
    profileBtn.textContent = '👤 ' + (profile ? profile.username : 'Account');
    actions.appendChild(profileBtn);

    if (profile && profile.is_admin) {
      const adminBtn = document.createElement('a');
      adminBtn.href = prefix + 'profile/admin.html';
      adminBtn.className = 'btn btn-chrome-blue';
      adminBtn.textContent = '🛠 Admin Zone';
      actions.appendChild(adminBtn);
    }

    const logoutBtn = document.createElement('button');
    logoutBtn.type = 'button';
    logoutBtn.className = 'btn btn-chrome-dark';
    logoutBtn.textContent = 'Logout';
    logoutBtn.addEventListener('click', async () => {
      logoutBtn.disabled = true;
      try { await window.QZAuth.signOut(); } catch (_) {}
      location.href = prefix + 'index.html';
    });
    actions.appendChild(logoutBtn);
  }

  async function run() {
    const actions = document.querySelector('.header-actions');
    if (!actions) return;
    const prefix = pathPrefix();

    if (!window.QZAuth || !window.QZAuth.client) {
      repointComingSoonAuthLinks(prefix);
      return;
    }

    const session = await window.QZAuth.getSession();
    if (!session) {
      repointComingSoonAuthLinks(prefix);
      return;
    }

    const profile = await window.QZAuth.getProfile();

    const banMessage = await window.QZAuth.enforceNotBanned(profile);
    if (banMessage) {
      repointComingSoonAuthLinks(prefix);
      if (window.qzToast) window.qzToast(banMessage);
      return;
    }

    renderLoggedIn(actions, prefix, profile);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
