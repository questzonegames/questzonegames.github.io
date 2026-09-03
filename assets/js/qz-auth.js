// ===== Quest Zone — Supabase auth wrapper =====
//
// Requires, in this order, before this script on the page:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>
//   <script src=".../qz-config.js"></script>   (sets window.QZ_SUPABASE_URL / _ANON_KEY)
//   <script src=".../qz-auth.js"></script>      (this file)
//
// window.QZAuth.client is the raw Supabase client (null if not configured
// yet — see qz-config.js). Everything else is a thin, Quest-Zone-flavoured
// wrapper around it:
//
//   QZAuth.signUp(username, email, password)
//   QZAuth.signIn(usernameOrEmail, password)   — resolves a username to its
//                                                 account's email first via
//                                                 the email_for_username RPC,
//                                                 since Supabase Auth itself
//                                                 only signs in by email
//   QZAuth.signOut()
//   QZAuth.getSession()   -> Supabase session or null
//   QZAuth.getProfile()   -> { id, username, is_admin, created_at } or null
(function () {
  const configured = !!(window.QZ_SUPABASE_URL && window.QZ_SUPABASE_ANON_KEY);
  if (!configured) {
    console.warn('Quest Zone: Supabase is not configured yet — fill in assets/js/qz-config.js.');
  }
  const client = (configured && window.supabase)
    ? window.supabase.createClient(window.QZ_SUPABASE_URL, window.QZ_SUPABASE_ANON_KEY)
    : null;

  function isEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || ''));
  }

  function requireClient() {
    if (!client) throw new Error('Accounts aren’t configured on this deployment yet.');
    return client;
  }

  async function signUp(username, email, password) {
    const c = requireClient();
    username = String(username || '').trim();
    email = String(email || '').trim();
    if (!username) throw new Error('Choose a username.');
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      throw new Error('Usernames are 3–20 characters: letters, numbers, and underscores only.');
    }
    if (!isEmail(email)) throw new Error('Enter a valid email address.');
    if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');

    const { data, error } = await c.auth.signUp({
      email,
      password,
      options: { data: { username } }
    });
    if (error) throw error;
    return data;
  }

  async function signIn(usernameOrEmail, password) {
    const c = requireClient();
    const input = String(usernameOrEmail || '').trim();
    if (!input) throw new Error('Enter your username or email.');
    if (!password) throw new Error('Enter your password.');

    let email = input;
    if (!isEmail(input)) {
      const { data: foundEmail, error: lookupError } = await c.rpc('email_for_username', { p_username: input });
      if (lookupError) throw lookupError;
      if (!foundEmail) throw new Error('No account found with that username or email.');
      email = foundEmail;
    }

    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error) {
      // A banned account is rejected server-side by the hook_custom_access_
      // token Auth Hook — genuinely secure, but Supabase turns any Postgres
      // hook exception into a generic "Error running hook..." message
      // rather than forwarding its text. Recover the real reason so a
      // banned player actually sees why, instead of a confusing error.
      //
      // Only do that lookup when the error actually came from the hook
      // (its message mentions "hook") — NOT on every failed sign-in.
      // signInWithPassword rejects a WRONG PASSWORD before the hook ever
      // runs, so gating on this keeps that case showing Supabase's normal
      // "Invalid login credentials" and never reveals that a given email
      // belongs to a banned account to someone who doesn't already know
      // its correct password.
      if (/hook/i.test(error.message || '')) {
        let banMsg = null;
        try {
          const banRes = await c.rpc('ban_message_for_login', { p_identifier: email });
          banMsg = banRes.data;
        } catch (_) { /* fall through to the original error below */ }
        if (banMsg) throw new Error(banMsg);
      }
      // Supabase's own message ("Invalid login credentials") doesn't leak
      // whether the account exists — keep that property for username logins too.
      throw error;
    }

    // Real enforcement is the Password Verification Auth Hook (server-side,
    // rejects before a session is even issued — see admin_bans migration).
    // This is a belt-and-suspenders client-side check for the case where
    // that hook isn't enabled yet, or a ban lands between hook checks: never
    // leave a banned account signed in past this point.
    const profile = await getProfile();
    if (profile && (profile.banned_permanently || (profile.banned_until && new Date(profile.banned_until) > new Date()))) {
      const message = await banMessageFor(profile);
      await signOut();
      throw new Error(message);
    }

    return data;
  }

  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
  }

  async function getSession() {
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data ? data.session : null;
  }

  async function getProfile() {
    if (!client) return null;
    const { data: userData } = await client.auth.getUser();
    const user = userData ? userData.user : null;
    if (!user) return null;
    const { data, error } = await client.from('profiles').select('*').eq('id', user.id).single();
    if (error) return null;
    return data;
  }

  function isBannedProfile(profile) {
    if (!profile) return false;
    if (profile.banned_permanently) return true;
    return !!(profile.banned_until && new Date(profile.banned_until) > new Date());
  }

  async function banMessageFor(profile) {
    if (!client || !profile) return 'This account is banned.';
    const { data } = await client.rpc('ban_message', { p_user: profile.id });
    return data || 'This account is banned.';
  }

  // Call on any page right after getProfile() to make sure a ban that lands
  // while someone's already signed in actually logs them out promptly,
  // instead of waiting for their token to expire. Returns the ban message
  // if it signed them out, otherwise null.
  async function enforceNotBanned(profile) {
    if (!isBannedProfile(profile)) return null;
    const message = await banMessageFor(profile);
    await signOut();
    return message;
  }

  window.QZAuth = {
    client, configured, isEmail, signUp, signIn, signOut, getSession, getProfile,
    isBannedProfile, banMessageFor, enforceNotBanned
  };
})();
