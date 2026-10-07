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

  async function changeCoordinatorPassword(
    email,
    currentPassword,
    newPassword
  ) {
    if (!client || !user) throw new Error('Sign in first.');

    const normalized = String(email || '').trim().toLowerCase();
    const currentSecret = String(currentPassword || '');
    const nextSecret = String(newPassword || '');

    if (!normalized) {
      throw new Error('Choose a coordinator email.');
    }

    const callerApproved = await isCoordinatorEmail(user.email);
    if (!callerApproved) {
      throw new Error('Coordinator access required.');
    }

    const targetApproved = await isCoordinatorEmail(normalized);
    if (!targetApproved) {
      throw new Error('The selected email is not an approved coordinator.');
    }

    if (!currentSecret) {
      throw new Error("Enter the selected coordinator's current password.");
    }

    if (nextSecret.length < 8) {
      throw new Error('New password must be at least 8 characters.');
    }

    if (currentSecret === nextSecret) {
      throw new Error('New password must be different from the current password.');
    }

    const tempClient = window.supabase.createClient(
      config.supabaseUrl,
      config.supabasePublishableKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      }
    );

    try {
      const { data: targetAuth, error: signInError } =
        await tempClient.auth.signInWithPassword({
          email: normalized,
          password: currentSecret
        });

      if (signInError || !targetAuth?.user) {
        throw new Error('Current password is incorrect for the selected coordinator.');
      }

      const signedInEmail =
        String(targetAuth.user.email || '').trim().toLowerCase();

      if (signedInEmail !== normalized) {
        throw new Error('Current-password verification did not match the selected coordinator.');
      }

      const { data, error: updateError } =
        await tempClient.auth.updateUser({
          password: nextSecret
        });

      if (updateError) throw updateError;
      return data;
    } finally {
      try {
        await tempClient.auth.signOut();
      } catch (_) {
        // Non-persistent temporary session; nothing else to clean up.
      }
    }
  }

  async function getWorkspaceAdminStatus(workspaceId = activeWorkspace?.id) {
    if (!client || !user || !workspaceId) return null;

    const { data, error } = await client.rpc(
      'get_badminton_workspace_admin_status',
      { p_workspace_id: workspaceId }
    );

    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row || null;
  }

  async function listCoordinators(workspaceId = activeWorkspace?.id) {
    if (!client || !user) throw new Error('Sign in first.');
    if (!workspaceId) throw new Error('Open a workspace first.');

    const { data, error } = await client.rpc(
      'list_badminton_coordinators_for_workspace',
      { p_workspace_id: workspaceId }
    );

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function listManageableWorkspaceAccess() {
    if (!client || !user) throw new Error('Sign in first.');

    const { data, error } = await client.rpc(
      'list_manageable_badminton_workspace_access'
    );

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function setOwnerCredential(workspaceId, credential) {
    if (!client || !user) throw new Error('Sign in first.');
    const secret = String(credential || '');
    if (!workspaceId) throw new Error('Choose an owned workspace.');
    if (secret.length < 8) throw new Error('Owner credential must be at least 8 characters.');

    const { data, error } = await client.rpc(
      'set_badminton_owner_credential',
      {
        p_workspace_id: workspaceId,
        p_credential: secret
      }
    );

    if (error) throw error;
    return data === true;
  }

  async function promoteCoowner(workspaceId, email, ownerCredential) {
    if (!client || !user) throw new Error('Sign in first.');
    const normalized = String(email || '').trim().toLowerCase();
    if (!workspaceId) throw new Error('Choose an owned workspace.');
    if (!normalized) throw new Error('Choose a coordinator.');
    if (!ownerCredential) throw new Error('Enter the owner credential.');

    const { data, error } = await client.rpc(
      'promote_badminton_coowner',
      {
        p_workspace_id: workspaceId,
        p_email: normalized,
        p_owner_credential: String(ownerCredential)
      }
    );

    if (error) throw error;
    return data === true;
  }

  async function demoteCoowner(workspaceId, email, ownerCredential) {
    if (!client || !user) throw new Error('Sign in first.');
    const normalized = String(email || '').trim().toLowerCase();
    if (!workspaceId) throw new Error('Choose an owned workspace.');
    if (!normalized) throw new Error('Choose a coordinator.');
    if (!ownerCredential) throw new Error('Enter the owner credential.');

    const { data, error } = await client.rpc(
      'demote_badminton_coowner',
      {
        p_workspace_id: workspaceId,
        p_email: normalized,
        p_owner_credential: String(ownerCredential)
      }
    );

    if (error) throw error;
    return data === true;
  }

  async function grantWorkspaceAccess(workspaceId, email) {
    if (!client || !user) throw new Error('Sign in first.');

    const normalized = String(email || '').trim().toLowerCase();
    if (!workspaceId) throw new Error('Choose a workspace.');
    if (!normalized) throw new Error('Choose a coordinator.');

    const { data, error } = await client.rpc(
      'grant_badminton_workspace_access',
      {
        p_workspace_id: workspaceId,
        p_email: normalized
      }
    );

    if (error) throw error;
    return data === true;
  }

  async function revokeWorkspaceAccess(workspaceId, email) {
    if (!client || !user) throw new Error('Sign in first.');

    const normalized = String(email || '').trim().toLowerCase();
    if (!workspaceId) throw new Error('Choose a workspace.');
    if (!normalized) throw new Error('Choose a coordinator.');

    const { data, error } = await client.rpc(
      'revoke_badminton_workspace_access',
      {
        p_workspace_id: workspaceId,
        p_email: normalized
      }
    );

    if (error) throw error;
    return data === true;
  }

  async function addCoordinator(email, password, workspaceId = activeWorkspace?.id) {
    if (!client || !user) throw new Error('Sign in first.');

    const normalized = String(email || '').trim().toLowerCase();
    const secret = String(password || '');

    if (!workspaceId) throw new Error('Open a workspace first.');
    if (!normalized) throw new Error('Enter an email address.');
    if (secret.length < 8) {
      throw new Error('Initial password must be at least 8 characters.');
    }

    const { data, error } = await client.functions.invoke(
      'badminton-coordinator-admin',
      {
        body: {
          action: 'add',
          workspace_id: workspaceId,
          email: normalized,
          password: secret
        }
      }
    );

    if (error) {
      let message = error.message || 'Coordinator account creation failed.';

      try {
        const context = error.context;
        if (context && typeof context.json === 'function') {
          const body = await context.json();
          if (body?.error) message = body.error;
        }
      } catch (_) {}

      throw new Error(message);
    }

    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function removeCoordinator(email, workspaceId = activeWorkspace?.id) {
    if (!client || !user) throw new Error('Sign in first.');

    const normalized = String(email || '').trim().toLowerCase();
    if (!workspaceId) throw new Error('Open a workspace first.');
    if (!normalized) throw new Error('Choose a coordinator email.');

    const { data, error } = await client.rpc(
      'remove_badminton_coordinator_authorized',
      {
        p_workspace_id: workspaceId,
        p_email: normalized
      }
    );

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
  window.BadmintonCloud = { isConfigured, init, getUser, getActiveWorkspace, setSyncStatusHandler, setRemoteStateHandler, isCoordinatorEmail, signInWithPassword, changeCoordinatorPassword, signOut, getWorkspaceAdminStatus, listCoordinators, listManageableWorkspaceAccess, setOwnerCredential, promoteCoowner, demoteCoowner, grantWorkspaceAccess, revokeWorkspaceAccess, addCoordinator, removeCoordinator, listWorkspaces, createWorkspace, joinWorkspace, openWorkspace, restoreRememberedWorkspace, leaveActiveWorkspaceView, loadCurrentState, saveCurrentState, saveHistorySession, loadHistory, deleteHistorySession, clearHistory };
})();
