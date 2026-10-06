(() => {
  const ACTIVE_WORKSPACE_KEY = 'badmintonActiveWorkspaceId';
  const config = window.APP_CONFIG || {};
  const configured = typeof config.supabaseUrl === 'string' && /^https?:\/\//.test(config.supabaseUrl) && config.supabaseUrl !== 'YOUR_SUPABASE_URL' && typeof config.supabasePublishableKey === 'string' && config.supabasePublishableKey.length > 20 && config.supabasePublishableKey !== 'YOUR_SUPABASE_PUBLISHABLE_KEY';
  let client = null, activeWorkspace = null, user = null, realtimeChannel = null, remoteStateHandler = null, syncStatusHandler = null, suppressRealtimeUntil = 0;
  const emit = (status, detail = '') => { if (typeof syncStatusHandler === 'function') syncStatusHandler({ status, detail }); };
  function isConfigured() { return configured && Boolean(window.supabase?.createClient); }
  async function init() {
    if (!isConfigured()) return { configured: false, user: null };
    client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    user = data.session?.user || null;
    client.auth.onAuthStateChange((_event, session) => {
      user = session?.user || null;
      window.dispatchEvent(new CustomEvent('badminton-cloud-auth-change', { detail: { user } }));
    });
    return { configured: true, user };
  }
  const getUser = () => user;
  const getActiveWorkspace = () => activeWorkspace;
  const setSyncStatusHandler = handler => { syncStatusHandler = handler; };
  const setRemoteStateHandler = handler => { remoteStateHandler = handler; };
  async function isCoordinatorEmail(email) {
    if (!client) throw new Error('Cloud is not configured.');

    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return false;

    const { data, error } = await client.rpc('is_badminton_coordinator', {
      p_email: normalized
    });

    if (error) throw error;
    return data === true;
  }

  async function signInWithPassword(email, password) {
    if (!client) throw new Error('Cloud is not configured.');

    const normalized = String(email || '').trim().toLowerCase();
    const secret = String(password || '');

    if (!normalized) throw new Error('Enter an approved coordinator email.');
    if (!secret) throw new Error('Enter your password.');

    const approved = await isCoordinatorEmail(normalized);
    if (!approved) {
      throw new Error('This email is not an approved coordinator.');
    }

    const { data, error } = await client.auth.signInWithPassword({
      email: normalized,
      password: secret
    });

    if (error) throw error;

    const signedInEmail = String(data?.user?.email || '').trim().toLowerCase();
    if (signedInEmail !== normalized) {
      await client.auth.signOut();
      throw new Error('Signed-in account does not match the approved coordinator email.');
    }

    return data;
  }

  async function changeOwnPassword(currentPassword, newPassword) {
    if (!client || !user) throw new Error('Sign in first.');

    const currentSecret = String(currentPassword || '');
    const nextSecret = String(newPassword || '');

    if (!currentSecret) {
      throw new Error('Enter your current password.');
    }

    if (nextSecret.length < 8) {
      throw new Error('New password must be at least 8 characters.');
    }

    if (currentSecret === nextSecret) {
      throw new Error('New password must be different from the current password.');
    }

    const currentUserId = user.id;
    const currentEmail = String(user.email || '').trim().toLowerCase();

    if (!currentEmail) {
      throw new Error('The signed-in coordinator account has no email address.');
    }

    // Re-authenticate against Supabase first. A wrong old password stops here
    // and the password update is never attempted.
    const { data: reauthData, error: reauthError } =
      await client.auth.signInWithPassword({
        email: currentEmail,
        password: currentSecret
      });

    if (reauthError) {
      const error = new Error('Current password is incorrect.');
      error.cause = reauthError;
      throw error;
    }

    if (
      !reauthData?.user ||
      String(reauthData.user.id) !== String(currentUserId)
    ) {
      throw new Error('Current-password verification did not match the signed-in coordinator.');
    }

    const { data, error } = await client.auth.updateUser({
      password: nextSecret
    });

    if (error) throw error;

    user = data?.user || reauthData.user || user;
    return data;
  }

  async function listCoordinators() {
    if (!client || !user) throw new Error('Sign in first.');

    const { data, error } = await client.rpc('list_badminton_coordinators');
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function addCoordinator(email) {
    if (!client || !user) throw new Error('Sign in first.');

    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) throw new Error('Enter an email address.');

    const { data, error } = await client.rpc('add_badminton_coordinator', {
      p_email: normalized
    });

    if (error) throw error;
    return data;
  }

  async function removeCoordinator(email) {
    if (!client || !user) throw new Error('Sign in first.');

    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) throw new Error('Choose a coordinator email.');

    const { data, error } = await client.rpc('remove_badminton_coordinator', {
      p_email: normalized
    });

    if (error) throw error;
    return data === true;
  }
  async function signOut() {
    if (!client) return;
    await unsubscribeRealtime();
    activeWorkspace = null;
    localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }
  async function listWorkspaces() {
    if (!client || !user) return [];
    const { data, error } = await client.from('badminton_workspaces').select('id,name,join_code,created_at').order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  }
  async function createWorkspace(name) {
    if (!client || !user) throw new Error('Sign in first.');
    const { data, error } = await client.rpc('create_badminton_workspace', { p_name: name || 'Badminton Workspace' });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.workspace_id) throw new Error('Workspace creation returned no ID.');
    await openWorkspace(row.workspace_id);
    return activeWorkspace;
  }
  async function joinWorkspace(joinCode) {
    if (!client || !user) throw new Error('Sign in first.');
    const { data, error } = await client.rpc('join_badminton_workspace', { p_join_code: String(joinCode || '').trim().toUpperCase() });
    if (error) throw error;
    const workspaceId = Array.isArray(data) ? data[0] : data;
    if (!workspaceId) throw new Error('Workspace could not be joined.');
    await openWorkspace(workspaceId);
    return activeWorkspace;
  }
  async function openWorkspace(workspaceId) {
    if (!client || !user) throw new Error('Sign in first.');
    const { data, error } = await client.from('badminton_workspaces').select('id,name,join_code,created_at').eq('id', workspaceId).single();
    if (error) throw error;
    activeWorkspace = data;
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, activeWorkspace.id);
    await subscribeRealtime(activeWorkspace.id);
    return activeWorkspace;
  }
  async function restoreRememberedWorkspace() {
    const id = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
    if (!id || !user) return null;
    try { return await openWorkspace(id); } catch (_error) { localStorage.removeItem(ACTIVE_WORKSPACE_KEY); return null; }
  }
  async function leaveActiveWorkspaceView() { await unsubscribeRealtime(); activeWorkspace = null; localStorage.removeItem(ACTIVE_WORKSPACE_KEY); }
  async function loadCurrentState() {
    if (!client || !activeWorkspace) return null;
    emit('loading');
    const { data, error } = await client.from('badminton_workspace_state').select('state,updated_at,updated_by').eq('workspace_id', activeWorkspace.id).maybeSingle();
    if (error) { emit('error', error.message); throw error; }
    emit('synced');
    return data?.state || null;
  }
  async function saveCurrentState(state) {
    if (!client || !activeWorkspace || !user) return false;
    emit('saving'); suppressRealtimeUntil = Date.now() + 1200;
    const { error } = await client.from('badminton_workspace_state').upsert({ workspace_id: activeWorkspace.id, state, updated_at: new Date().toISOString(), updated_by: user.id }, { onConflict: 'workspace_id' });
    if (error) { emit('error', error.message); throw error; }
    emit('synced'); return true;
  }
  async function subscribeRealtime(workspaceId) {
    await unsubscribeRealtime();
    if (!client || !workspaceId) return;
    realtimeChannel = client.channel(`badminton-workspace-${workspaceId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'badminton_workspace_state', filter: `workspace_id=eq.${workspaceId}` }, payload => {
      if (Date.now() < suppressRealtimeUntil) return;
      const row = payload.new;
      if (!row?.state) return;
      if (row.updated_by && user?.id && row.updated_by === user.id) return;
      emit('remote-update');
      if (typeof remoteStateHandler === 'function') remoteStateHandler(row.state, row);
    }).subscribe(status => { if (status === 'SUBSCRIBED') emit('synced'); });
  }
  async function unsubscribeRealtime() { if (client && realtimeChannel) { try { await client.removeChannel(realtimeChannel); } catch (_error) {} } realtimeChannel = null; }
  async function saveHistorySession(name, state) {
    if (!client || !activeWorkspace || !user) throw new Error('Open a shared workspace first.');
    const { data, error } = await client.from('badminton_session_history').insert({ workspace_id: activeWorkspace.id, name: name || 'Saved Session', state, saved_by: user.id }).select('id,name,saved_at,state').single();
    if (error) throw error; return data;
  }
  async function loadHistory() {
    if (!client || !activeWorkspace) return [];
    const { data, error } = await client.from('badminton_session_history').select('id,name,saved_at,state').eq('workspace_id', activeWorkspace.id).order('saved_at', { ascending: false }).limit(100);
    if (error) throw error; return data || [];
  }
  async function deleteHistorySession(id) {
    if (!client || !activeWorkspace) return false;
    const { error } = await client.from('badminton_session_history').delete().eq('workspace_id', activeWorkspace.id).eq('id', id);
    if (error) throw error; return true;
  }
  async function clearHistory() {
    if (!client || !activeWorkspace) return false;
    const { error } = await client.from('badminton_session_history').delete().eq('workspace_id', activeWorkspace.id);
    if (error) throw error; return true;
  }
  window.BadmintonCloud = { isConfigured, init, getUser, getActiveWorkspace, setSyncStatusHandler, setRemoteStateHandler, isCoordinatorEmail, signInWithPassword, changeOwnPassword, signOut, listCoordinators, addCoordinator, removeCoordinator, listWorkspaces, createWorkspace, joinWorkspace, openWorkspace, restoreRememberedWorkspace, leaveActiveWorkspaceView, loadCurrentState, saveCurrentState, saveHistorySession, loadHistory, deleteHistorySession, clearHistory };
})();
