(() => {
  const defaultMembers = [
    ['Russel','Man','?'],['Jason','Man','?'],['Ricky','Man','?'],['Rizal','Man','A+'],
    ['Benny','Man','A'],['Rony','Man','A'],['Jeff','Man','A'],['Dyoo','Man','A'],['Rian','Man','A'],
    ['Andi','Man','B'],['Hendra','Man','B'],['Anto','Man','B'],['Vincent','Man','B'],['Edward','Man','B+'],
    ['Henky','Man','C'],['Stefry','Man','C'],['Varianto','Man','C'],['Fricky','Man','C'],['Steven','Man','D'],
    ['Jess','Woman','A'],['Gio','Woman','A'],['Cindy','Woman','C'],['Gwen','Woman','C'],['Vivy','Woman','C'],
    ['Violin','Woman','C'],['Novia','Woman','C'],['Amy','Woman','C'],['Vebby','Woman','D'],['Vallen','Woman','D']
  ].map((x, i) => ({
    id: i + 1,
    name: x[0],
    gender: x[1],
    tier: x[2],
    memberType: 'regular',
    present: false
  }));

  const score = {'A+':6,'A':5,'B+':4.5,'B':4,'C':3,'D':2,'?':3.5};
  const tierClass = {'A+':'tier-ap','A':'tier-a','B+':'tier-bp','B':'tier-b','C':'tier-c','D':'tier-d','?':'tier-q'};

  function localDateValue(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatSessionDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return 'No date';
    const [year, month, day] = String(value).split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  const defaultState = () => ({
    members: defaultMembers.map(m => ({ ...m })),
    groups: [],
    sessionMemberIds: [],
    sessionGroupIds: [],
    sessionIndividualMemberIds: [],
    sessionManualMemberIds: [],
    sessionExcludedMemberIds: [],
    sessionParticipantTypes: {},
    matches: [],
    sessionName: '',
    sessionDate: localDateValue(),
    courts: 3,
    duration: 180,
    rotationMin: 18,
    mix: 'less-mixed'
  });

  let state = defaultState();
  let cloudReady = false;
  let applyingRemoteState = false;
  let cloudSaveTimer = null;
  let cloudSavePendingSnapshot = null;
  let cloudSaveInFlight = false;
  let pendingCloudConflictState = null;
  let pendingCloudConflictWorkspace = null;
  let historySource = 'local';
  let selectedGroupId = null;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
  }[c]));

  const memberById = (id) => state.members.find(m => m.id === Number(id));
  const memberName = (id) => memberById(id)?.name || '—';

  function normalizeRuntimeMembership() {
    const validIds = new Set(state.members.map(participant => participant.id));

    if (!Array.isArray(state.groups)) {
      state.groups = [];
    }

    /*
      IMPORTANT:
      Normalize each existing group IN PLACE.

      Older versions rebuilt every group object on each save/render. The Groups
      editor event handlers then held references to stale objects, so later
      participant edits could appear to reset recently selected group members.
      Keeping object identity stable prevents that.
    */
    state.groups = state.groups.filter(group => group && group.id);

    state.groups.forEach(group => {
      group.id = String(group.id);
      group.name = String(group.name || 'Unnamed Group').slice(0, 60);

      const memberIds = Array.isArray(group.memberIds)
        ? [...new Set(
            group.memberIds
              .map(Number)
              .filter(id => validIds.has(id))
          )]
        : [];

      const sourceTypes =
        group.memberTypes && typeof group.memberTypes === 'object'
          ? group.memberTypes
          : {};

      const nextTypes = {};

      memberIds.forEach(id => {
        const participant = state.members.find(item => item.id === id);
        const legacyType = participant?.memberType === 'non-member'
          ? 'non-member'
          : 'regular';

        nextTypes[id] = sourceTypes[id] === 'non-member'
          ? 'non-member'
          : (sourceTypes[id] === 'regular' ? 'regular' : legacyType);
      });

      // Mutate the current group instead of replacing the group object.
      group.memberIds = memberIds;
      group.memberTypes = nextTypes;
    });

    if (!Array.isArray(state.sessionMemberIds)) {
      state.sessionMemberIds = [];
    } else {
      state.sessionMemberIds = [
        ...new Set(
          state.sessionMemberIds
            .map(Number)
            .filter(id => validIds.has(id))
        )
      ];
    }

    const validGroupIds = new Set(state.groups.map(group => group.id));

    state.sessionGroupIds = Array.isArray(state.sessionGroupIds)
      ? [...new Set(state.sessionGroupIds.map(String).filter(id => validGroupIds.has(id)))]
      : [];

    state.sessionIndividualMemberIds = Array.isArray(state.sessionIndividualMemberIds)
      ? [...new Set(state.sessionIndividualMemberIds.map(Number).filter(id => validIds.has(id)))]
      : (
          state.sessionGroupIds.length
            ? []
            : (
                Array.isArray(state.sessionManualMemberIds)
                  ? [...new Set(state.sessionManualMemberIds.map(Number).filter(id => validIds.has(id)))]
                  : []
              )
        );

    // Keep the legacy field only for backward compatibility. It is no longer
    // used as the source of individually-added participants.
    state.sessionManualMemberIds = Array.isArray(state.sessionManualMemberIds)
      ? [...new Set(state.sessionManualMemberIds.map(Number).filter(id => validIds.has(id)))]
      : [];

    state.sessionExcludedMemberIds = Array.isArray(state.sessionExcludedMemberIds)
      ? [...new Set(state.sessionExcludedMemberIds.map(Number).filter(id => validIds.has(id)))]
      : [];

    if (
      !state.sessionParticipantTypes ||
      typeof state.sessionParticipantTypes !== 'object'
    ) {
      state.sessionParticipantTypes = {};
    }

    const normalizedSessionTypes = {};

    state.sessionMemberIds.forEach(id => {
      const participant = state.members.find(item => item.id === id);
      const legacyType = participant?.memberType === 'non-member'
        ? 'non-member'
        : 'regular';

      normalizedSessionTypes[id] =
        state.sessionParticipantTypes[id] === 'non-member'
          ? 'non-member'
          : (state.sessionParticipantTypes[id] === 'regular'
              ? 'regular'
              : legacyType);
    });

    state.sessionParticipantTypes = normalizedSessionTypes;

    if (
      selectedGroupId &&
      !state.groups.some(group => group.id === selectedGroupId)
    ) {
      selectedGroupId = state.groups[0]?.id || null;
    }
  }

  function groupById(id) {
    return state.groups.find(group => group.id === String(id));
  }

  function memberGroups(memberId) {
    const id = Number(memberId);
    normalizeRuntimeMembership();
    return state.groups.filter(group => group.memberIds.includes(id));
  }

  function groupMembershipType(group, participantId) {
    return group?.memberTypes?.[Number(participantId)] === 'non-member'
      ? 'non-member'
      : 'regular';
  }

  function sessionParticipantType(participantId) {
    return state.sessionParticipantTypes?.[Number(participantId)] === 'non-member'
      ? 'non-member'
      : 'regular';
  }

  function membershipLabelFromType(type) {
    return type === 'non-member' ? 'Non-member' : 'Regular';
  }

  function sameIdSet(a, b) {
    const left = new Set((a || []).map(Number));
    const right = new Set((b || []).map(Number));

    if (left.size !== right.size) return false;

    for (const id of left) {
      if (!right.has(id)) return false;
    }

    return true;
  }

  function participantSources(participantId) {
    const id = Number(participantId);

    const linkedGroups = state.sessionGroupIds
      .map(groupId => groupById(groupId))
      .filter(Boolean)
      .filter(group => group.memberIds.includes(id));

    return {
      manual: state.sessionIndividualMemberIds.includes(id),
      groups: linkedGroups
    };
  }

  function syncSessionParticipantsFromSources() {
    normalizeRuntimeMembership();

    const validIds = new Set(state.members.map(participant => participant.id));
    const excluded = new Set(state.sessionExcludedMemberIds);
    const nextIds = new Set(
      state.sessionIndividualMemberIds.filter(id => validIds.has(id))
    );

    state.sessionGroupIds.forEach(groupId => {
      const group = groupById(groupId);
      if (!group) return;

      group.memberIds.forEach(id => {
        if (validIds.has(id)) nextIds.add(id);
      });
    });

    excluded.forEach(id => nextIds.delete(id));

    const previousIds = new Set(state.sessionMemberIds);
    const nextIdList = [...nextIds];
    const removedIds = new Set(
      [...previousIds].filter(id => !nextIds.has(id))
    );

    state.sessionMemberIds = nextIdList;

    const nextTypes = {};

    nextIdList.forEach(id => {
      const firstLinkedGroup = state.sessionGroupIds
        .map(groupId => groupById(groupId))
        .find(group => group?.memberIds.includes(id));

      if (firstLinkedGroup) {
        nextTypes[id] = groupMembershipType(firstLinkedGroup, id);
      } else {
        nextTypes[id] =
          state.sessionParticipantTypes?.[id] === 'non-member'
            ? 'non-member'
            : 'regular';
      }
    });

    state.sessionParticipantTypes = nextTypes;

    if (removedIds.size) {
      removedIds.forEach(id => {
        const participant = memberById(id);
        if (participant) participant.present = false;
      });

      state.matches = state.matches.filter(match =>
        match.completed ||
        !match.players.some(id => removedIds.has(id))
      );
    }

    return {
      added: nextIdList.filter(id => !previousIds.has(id)),
      removed: [...removedIds]
    };
  }

  function inferLegacyGroupLinkBeforeEdit(group) {
    if (!group) return false;
    if (state.sessionGroupIds.length) return false;
    if (!state.sessionMemberIds.length) return false;

    if (!sameIdSet(state.sessionMemberIds, group.memberIds)) return false;

    state.sessionGroupIds = [group.id];
    state.sessionIndividualMemberIds = [];
    state.sessionManualMemberIds = [];
    state.sessionExcludedMemberIds = [];
    return true;
  }

  function createGroup(name) {
    const cleanName = String(name || '').trim().slice(0, 60);
    if (!cleanName) {
      setStatus('Enter a group name first.');
      return;
    }

    const duplicate = state.groups.some(
      group => group.name.toLowerCase() === cleanName.toLowerCase()
    );

    if (duplicate) {
      setStatus(`A group named "${cleanName}" already exists.`);
      return;
    }

    const group = {
      id: `group-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
      name: cleanName,
      memberIds: [],
      memberTypes: {}
    };

    state.groups.push(group);
    selectedGroupId = group.id;
    saveState(`Group created: ${cleanName}`);
    renderAll();
  }

  function deleteGroup(groupId) {
    const group = groupById(groupId);
    if (!group) return;

    if (!window.confirm(`Delete group "${group.name}"? Participants themselves will not be deleted.`)) {
      return;
    }

    state.groups = state.groups.filter(item => item.id !== group.id);
    state.sessionGroupIds = state.sessionGroupIds.filter(id => id !== group.id);
    selectedGroupId = state.groups[0]?.id || null;

    syncSessionParticipantsFromSources();
    saveState(`Group deleted: ${group.name}`, 0);
    renderAll();
  }

  function importGroupIntoSession(groupId) {
    const group = groupById(groupId);
    if (!group) {
      setStatus('Choose a group first.');
      return;
    }

    const alreadyLinked = state.sessionGroupIds.includes(group.id);

    if (!alreadyLinked) {
      if (sameIdSet(state.sessionMemberIds, group.memberIds)) {
        state.sessionIndividualMemberIds = state.sessionIndividualMemberIds.filter(
          id => !group.memberIds.includes(id)
        );
      }

      state.sessionGroupIds = [...state.sessionGroupIds, group.id];

      group.memberIds.forEach(id => {
        state.sessionExcludedMemberIds =
          state.sessionExcludedMemberIds.filter(excludedId => excludedId !== id);
      });
    }

    syncSessionParticipantsFromSources();

    saveState(
      alreadyLinked
        ? `${group.name} is already linked to this session.`
        : `${group.name} linked to this session.`,
      0
    );

    renderAll();
  }

  function getSessionMemberIds() {
    normalizeRuntimeMembership();
    return [...state.sessionMemberIds];
  }

  function getSessionMembers() {
    const ids = new Set(getSessionMemberIds());
    return state.members.filter(member => ids.has(member.id));
  }

  function isSessionMember(id) {
    return getSessionMemberIds().includes(Number(id));
  }

  function setStatus(text) {
    $('#status').textContent = text || '';
  }

  function snapshotState() {
    normalizeRuntimeMembership();

    return {
      members: state.members.map(m => ({ ...m })),
      groups: state.groups.map(group => ({
        id: group.id,
        name: group.name,
        memberIds: [...group.memberIds],
        memberTypes: { ...(group.memberTypes || {}) }
      })),
      sessionMemberIds: [...state.sessionMemberIds],
      sessionGroupIds: [...state.sessionGroupIds],
      sessionIndividualMemberIds: [...state.sessionIndividualMemberIds],
      sessionManualMemberIds: [...state.sessionManualMemberIds],
      sessionExcludedMemberIds: [...state.sessionExcludedMemberIds],
      sessionParticipantTypes: { ...(state.sessionParticipantTypes || {}) },
      matches: state.matches.map(m => ({
        ...m,
        players: [...m.players]
      })),
      sessionName: state.sessionName || '',
      sessionDate: state.sessionDate || '',
      courts: state.courts,
      duration: state.duration,
      rotationMin: state.rotationMin,
      mix: state.mix
    };
  }

  async function flushCloudSaveQueue() {
    if (
      cloudSaveInFlight ||
      !cloudReady ||
      !window.BadmintonCloud?.getActiveWorkspace()
    ) {
      return;
    }

    cloudSaveInFlight = true;

    try {
      while (cloudSavePendingSnapshot) {
        const snapshotToSave = cloudSavePendingSnapshot;
        cloudSavePendingSnapshot = null;

        await window.BadmintonCloud.saveCurrentState(snapshotToSave);
      }
    } catch (error) {
      setCloudUiStatus('error', error.message);
    } finally {
      cloudSaveInFlight = false;

      if (cloudSavePendingSnapshot) {
        clearTimeout(cloudSaveTimer);
        cloudSaveTimer = setTimeout(flushCloudSaveQueue, 0);
      }
    }
  }

  function queueCloudSave(snapshot, delay = 350) {
    if (
      applyingRemoteState ||
      !cloudReady ||
      !window.BadmintonCloud?.getActiveWorkspace()
    ) {
      return;
    }

    // Store the exact snapshot produced by this action. Do not recalculate
    // state later after another UI action has occurred.
    cloudSavePendingSnapshot = JSON.parse(JSON.stringify(snapshot));

    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(flushCloudSaveQueue, Math.max(0, delay));
  }

  function saveState(message = '', cloudDelay = 350) {
    const snapshot = snapshotState();
    const ok = window.BadmintonStorage?.save(snapshot);

    queueCloudSave(snapshot, cloudDelay);

    if (message) {
      setStatus(ok ? message : 'Changes made, but browser storage is unavailable.');
    }

    return ok;
  }

  function loadSavedState() {
    const result = window.BadmintonStorage?.load();

    if (
      !result?.ok ||
      !result.state ||
      !Array.isArray(result.state.members) ||
      result.state.members.length === 0
    ) {
      state = defaultState();

      // Remove a corrupt/empty saved state so it does not keep returning.
      if (result?.reason !== 'empty') {
        window.BadmintonStorage?.clear();
      }

      return false;
    }

    state = {
      ...defaultState(),
      ...result.state
    };

    return true;
  }

  function syncSessionInputs() {
    $('#session-name').value = state.sessionName || '';
    $('#session-date').value = state.sessionDate || localDateValue();
    $('#courts').value = state.courts;
    $('#duration').value = state.duration;
    $('#rotation-min').value = state.rotationMin;
    $('#mix').value = state.mix;
  }

  function setCloudUiStatus(status, detail = '') {
    const badge = $('#cloud-sync-badge');
    const text = $('#cloud-status-text');
    if (!badge || !text) return;
    badge.className = `cloud-sync-badge ${status}`;
    const labels = { offline: 'Local only', signedout: 'Sign in required', workspace: 'Choose workspace', saving: 'Saving…', loading: 'Loading…', synced: 'Synced', 'remote-update': 'Updated by coordinator', conflict: 'Sync conflict', error: 'Sync error' };
    badge.textContent = labels[status] || status;
    if (detail) text.textContent = detail;
  }

  function showCloudElement(id, show) {
    const el = $('#' + id);
    if (el) el.hidden = !show;
  }

  function renderWorkspaceOptions(workspaces) {
    const select = $('#cloud-workspace-select');
    if (!select) return;
    select.innerHTML = workspaces.length
      ? workspaces.map(workspace => `<option value="${workspace.id}">${esc(workspace.name)}</option>`).join('')
      : '<option value="">No workspaces yet</option>';
  }

  async function refreshCloudWorkspaceList() {
    const workspaces = await window.BadmintonCloud.listWorkspaces();
    renderWorkspaceOptions(workspaces);
    return workspaces;
  }

  function prepareIncomingState(rawState) {
    const incoming = JSON.parse(JSON.stringify(rawState || {}));

    if (!Array.isArray(incoming.sessionGroupIds)) {
      incoming.sessionGroupIds = [];
    }

    if (!Array.isArray(incoming.sessionIndividualMemberIds)) {
      /*
        Older linked-group builds used sessionManualMemberIds for explicit
        individuals. If there are linked groups, use that older field.
        If there are no linked groups, preserve the old current participants
        as individual sources so upgrading does not silently produce zero.
      */
      if (incoming.sessionGroupIds.length) {
        incoming.sessionIndividualMemberIds = Array.isArray(incoming.sessionManualMemberIds)
          ? [...incoming.sessionManualMemberIds]
          : [];
      } else {
        incoming.sessionIndividualMemberIds = Array.isArray(incoming.sessionManualMemberIds) &&
          incoming.sessionManualMemberIds.length
          ? [...incoming.sessionManualMemberIds]
          : (
              Array.isArray(incoming.sessionMemberIds)
                ? [...incoming.sessionMemberIds]
                : []
            );
      }
    }

    if (!Array.isArray(incoming.sessionManualMemberIds)) {
      incoming.sessionManualMemberIds = [];
    }

    if (!Array.isArray(incoming.sessionExcludedMemberIds)) {
      incoming.sessionExcludedMemberIds = [];
    }

    return incoming;
  }

  function stateDataMetrics(candidate) {
    const value = candidate || {};
    const participants = Array.isArray(value.members) ? value.members.length : 0;
    const groups = Array.isArray(value.groups) ? value.groups.length : 0;
    const groupAssignments = Array.isArray(value.groups)
      ? value.groups.reduce(
          (sum, group) =>
            sum + (Array.isArray(group?.memberIds) ? group.memberIds.length : 0),
          0
        )
      : 0;

    return {
      participants,
      groups,
      groupAssignments,
      sessionParticipants: Array.isArray(value.sessionMemberIds)
        ? value.sessionMemberIds.length
        : 0
    };
  }

  function stateProtectionScore(candidate) {
    const metrics = stateDataMetrics(candidate);

    // Participant directory and reusable Groups matter much more than the
    // transient current-session list when deciding whether an incoming cloud
    // copy is suspiciously incomplete.
    return (
      metrics.participants * 10000 +
      metrics.groups * 1000 +
      metrics.groupAssignments * 10 +
      metrics.sessionParticipants
    );
  }

  function incomingStateLooksPoorer(localState, incomingState) {
    if (!localState?.members?.length || !incomingState?.members?.length) {
      return false;
    }

    const local = stateDataMetrics(localState);
    const incoming = stateDataMetrics(incomingState);

    return (
      incoming.participants < local.participants ||
      incoming.groups < local.groups ||
      incoming.groupAssignments < local.groupAssignments
    );
  }

  function hideCloudConflict() {
    pendingCloudConflictState = null;
    pendingCloudConflictWorkspace = null;
    showCloudElement('cloud-conflict', false);

    const text = $('#cloud-conflict-text');
    if (text) text.textContent = '';
  }

  function showCloudConflict(localState, incomingState, workspace = null) {
    pendingCloudConflictState = JSON.parse(JSON.stringify(incomingState));
    pendingCloudConflictWorkspace = workspace || window.BadmintonCloud?.getActiveWorkspace() || null;

    const local = stateDataMetrics(localState);
    const remote = stateDataMetrics(incomingState);

    const text = $('#cloud-conflict-text');
    if (text) {
      text.textContent =
        `Local: ${local.participants} participants, ${local.groups} groups, ${local.groupAssignments} group assignments. ` +
        `Cloud: ${remote.participants} participants, ${remote.groups} groups, ${remote.groupAssignments} group assignments. ` +
        `Nothing was overwritten.`;
    }

    showCloudElement('cloud-conflict', true);
    setCloudUiStatus(
      'conflict',
      'Cloud has less participant/group data than this device. Choose which copy to keep.'
    );
  }

  function applyIncomingState(incomingState, {
    workspace = null,
    force = false,
    sourceLabel = 'cloud'
  } = {}) {
    if (!incomingState?.members?.length) return false;

    const prepared = prepareIncomingState(incomingState);
    const localSnapshot = snapshotState();

    if (!force && incomingStateLooksPoorer(localSnapshot, prepared)) {
      window.BadmintonStorage?.saveBackup(
        localSnapshot,
        `Protected local copy before rejecting poorer ${sourceLabel} state`
      );
      showCloudConflict(localSnapshot, prepared, workspace);
      return false;
    }

    window.BadmintonStorage?.saveBackup(
      localSnapshot,
      `Before applying ${sourceLabel} state`
    );

    applyingRemoteState = true;
    state = { ...defaultState(), ...prepared };
    applyingRemoteState = false;

    syncSessionInputs();
    window.BadmintonStorage?.save(snapshotState());
    hideCloudConflict();
    renderAll();
    return true;
  }

  async function activateCloudWorkspace(workspace, { loadState = true } = {}) {
    if (!workspace) return;
    historySource = 'cloud';
    $('#cloud-workspace-name').textContent = workspace.name || 'Workspace';
    $('#cloud-workspace-code').textContent = workspace.join_code || '—';
    showCloudElement('cloud-workspace-picker', false);
    showCloudElement('cloud-active-workspace', true);
    setCloudUiStatus('loading', `Loading shared workspace: ${workspace.name}`);

    if (loadState) {
      const remoteState = await window.BadmintonCloud.loadCurrentState();
      if (remoteState?.members?.length) {
        const applied = applyIncomingState(remoteState, {
          workspace,
          sourceLabel: 'workspace'
        });

        if (applied) {
          setStatus(`Shared workspace loaded: ${workspace.name}`);
        } else {
          setStatus(
            'Cloud copy was not loaded because it contains less participant/group data than this device.'
          );
        }
      } else {
        await window.BadmintonCloud.saveCurrentState(snapshotState());
        setStatus(`Shared workspace initialized: ${workspace.name}`);
      }
    }

    setCloudUiStatus('synced', `Shared across coordinators: ${workspace.name}`);
    await renderHistory();
  }

  async function renderCloudUi() {
    const configured = window.BadmintonCloud?.isConfigured();
    showCloudElement('cloud-config-missing', !configured);
    showCloudElement('cloud-auth-signed-out', false);
    showCloudElement('cloud-auth-signed-in', false);

    if (!configured) {
      setCloudUiStatus('offline', 'Configure Supabase in config.js for cross-device sync.');
      return;
    }

    const user = window.BadmintonCloud.getUser();
    if (!user) {
      showCloudElement('cloud-auth-signed-out', true);
      setCloudUiStatus('signedout', 'Sign in to access the shared coordinator workspace.');
      return;
    }

    showCloudElement('cloud-auth-signed-in', true);
    $('#cloud-user-email').textContent = user.email || user.id;
    const active = window.BadmintonCloud.getActiveWorkspace();

    if (active) {
      showCloudElement('cloud-workspace-picker', false);
      showCloudElement('cloud-active-workspace', true);
      $('#cloud-workspace-name').textContent = active.name || 'Workspace';
      $('#cloud-workspace-code').textContent = active.join_code || '—';
      setCloudUiStatus('synced', `Shared across coordinators: ${active.name}`);
    } else {
      showCloudElement('cloud-workspace-picker', true);
      showCloudElement('cloud-active-workspace', false);
      await refreshCloudWorkspaceList();
      setCloudUiStatus('workspace', 'Choose, create, or join a shared workspace.');
    }
  }

  async function initializeCloud() {
    if (!window.BadmintonCloud) return;
    window.BadmintonCloud.setSyncStatusHandler(({ status, detail }) => {
      setCloudUiStatus(status, detail || $('#cloud-status-text')?.textContent || '');
    });
    window.BadmintonCloud.setRemoteStateHandler((remoteState) => {
      if (!remoteState?.members?.length) return;

      const applied = applyIncomingState(remoteState, {
        workspace: window.BadmintonCloud?.getActiveWorkspace() || null,
        sourceLabel: 'realtime cloud'
      });

      if (!applied) {
        setStatus(
          'A cloud update was blocked because it would remove participant/group data from this device.'
        );
        return;
      }

      setStatus('Shared session updated by another coordinator.');
      setCloudUiStatus('remote-update', 'A coordinator changed the shared session.');
    });

    try {
      const result = await window.BadmintonCloud.init();
      cloudReady = Boolean(result.configured);
      if (!result.configured) { await renderCloudUi(); return; }
      if (result.user) {
        const remembered = await window.BadmintonCloud.restoreRememberedWorkspace();
        if (remembered) await activateCloudWorkspace(remembered, { loadState: true });
      }
      await renderCloudUi();
    } catch (error) {
      cloudReady = false;
      setCloudUiStatus('error', error.message);
    }
  }

  function fmtTime(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  }

  function badge(tier) {
    return `<span class="pill ${tierClass[tier] || 'tier-q'}">${esc(tier)}</span>`;
  }

  function playerChip(id) {
    const m = memberById(id);
    if (!m) return '<span class="pill tier-q">Unassigned</span>';
    return `<span class="pill ${tierClass[m.tier]}">${esc(m.name)}</span>`;
  }

  function matchType(ids) {
    const ms = ids.map(memberById).filter(Boolean);
    if (ms.length < 4) return 'Incomplete';

    const men = ms.filter(m => m.gender === 'Man').length;
    const women = ms.filter(m => m.gender === 'Woman').length;

    if (men === 4) return "Men's Doubles";
    if (women === 4) return "Women's Doubles";
    if (men === 2 && women === 2) return 'Mixed Doubles';
    return 'Open Doubles';
  }

  function setGenerateMessage(message = '', type = '') {
    const element = $('#session-generate-message');
    if (!element) return;

    element.textContent = message;
    element.className = `session-generate-message${type ? ` ${type}` : ''}`;
  }

  function randomValue() {
    // crypto gives a better reshuffle when available; Math.random is the fallback.
    if (window.crypto?.getRandomValues) {
      const values = new Uint32Array(1);
      window.crypto.getRandomValues(values);
      return values[0] / 4294967296;
    }
    return Math.random();
  }

  function shuffleCopy(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(randomValue() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function randomTieMap(members) {
    return new Map(members.map(member => [member.id, randomValue()]));
  }

  function pairBalanced(group) {
    const g = [...group].sort((a,b) => score[b.tier] - score[a.tier]);
    const men = g.filter(x => x.gender === 'Man');
    const women = g.filter(x => x.gender === 'Woman');

    // Mixed doubles: randomly choose between the two valid cross-pairings.
    // Both preserve one man + one woman per team.
    if (men.length === 2 && women.length === 2) {
      if (randomValue() < 0.5) {
        return [men[0], women[1], men[1], women[0]];
      }
      return [men[0], women[0], men[1], women[1]];
    }

    // Same-gender/open groups have three possible doubles pairings.
    // Prefer the more balanced two, then randomly choose between them.
    if (g.length === 4) {
      const pairings = [
        [g[0], g[3], g[1], g[2]],
        [g[0], g[2], g[1], g[3]],
        [g[0], g[1], g[2], g[3]]
      ];

      const evaluated = pairings.map(players => {
        const team1 = score[players[0].tier] + score[players[1].tier];
        const team2 = score[players[2].tier] + score[players[3].tier];
        return {
          players,
          gap: Math.abs(team1 - team2)
        };
      }).sort((a,b) => a.gap - b.gap);

      const bestGap = evaluated[0].gap;
      const acceptable = evaluated.filter(item => item.gap <= bestGap + 1);
      return acceptable[Math.floor(randomValue() * acceptable.length)].players;
    }

    return shuffleCopy(g);
  }

  function chooseCourtGroup(pool, prefer) {
    const byGender = {
      Man: shuffleCopy(pool.filter(x => x.gender === 'Man')),
      Woman: shuffleCopy(pool.filter(x => x.gender === 'Woman'))
    };

    if (prefer === 'women' && byGender.Woman.length >= 4) {
      return byGender.Woman.slice(0,4);
    }

    if (prefer === 'mixed' && byGender.Woman.length >= 2 && byGender.Man.length >= 2) {
      return [
        ...byGender.Man.slice(0,2),
        ...byGender.Woman.slice(0,2)
      ];
    }

    if (prefer === 'men' && byGender.Man.length >= 4) {
      return byGender.Man.slice(0,4);
    }

    if (byGender.Man.length >= 4) return byGender.Man.slice(0,4);
    if (byGender.Woman.length >= 4) return byGender.Woman.slice(0,4);

    if (byGender.Woman.length >= 2 && byGender.Man.length >= 2) {
      return [
        ...byGender.Man.slice(0,2),
        ...byGender.Woman.slice(0,2)
      ];
    }

    return shuffleCopy(pool).slice(0,4);
  }

  function getFreshSessionSource() {
    normalizeRuntimeMembership();

    const validParticipantIds = new Set(
      state.members.map(participant => participant.id)
    );

    const requestedGroupIds = Array.isArray(state.sessionGroupIds)
      ? [...new Set(state.sessionGroupIds.map(String))]
      : [];

    const linkedGroups = requestedGroupIds
      .map(groupId => groupById(groupId))
      .filter(Boolean);

    const missingGroupIds = requestedGroupIds.filter(
      groupId => !groupById(groupId)
    );

    const groupParticipantIds = new Set();

    linkedGroups.forEach(group => {
      group.memberIds.forEach(id => {
        const participantId = Number(id);
        if (validParticipantIds.has(participantId)) {
          groupParticipantIds.add(participantId);
        }
      });
    });

    const individualParticipantIds = [
      ...new Set(
        (state.sessionIndividualMemberIds || [])
          .map(Number)
          .filter(id =>
            validParticipantIds.has(id) &&
            !groupParticipantIds.has(id)
          )
      )
    ];

    const participantIds = [
      ...groupParticipantIds,
      ...individualParticipantIds
    ];

    return {
      linkedGroups,
      missingGroupIds,
      groupParticipantIds: [...groupParticipantIds],
      individualParticipantIds,
      participantIds
    };
  }

  function commitFreshSessionSource(source) {
    const selectedIds = new Set(source.participantIds);

    // The old session and all of its progress are now deliberately discarded,
    // but only after the new source has already passed validation.
    state.sessionExcludedMemberIds = [];
    state.sessionMemberIds = [...source.participantIds];

    const nextTypes = {};

    source.participantIds.forEach(id => {
      const firstGroup = source.linkedGroups.find(
        group => group.memberIds.includes(id)
      );

      nextTypes[id] = firstGroup
        ? groupMembershipType(firstGroup, id)
        : (
            state.sessionParticipantTypes?.[id] === 'non-member'
              ? 'non-member'
              : 'regular'
          );
    });

    state.sessionParticipantTypes = nextTypes;

    state.members.forEach(participant => {
      if (selectedIds.has(participant.id)) {
        participant.present = false;
      }
    });

    state.matches = [];

    return state.members.filter(
      participant => selectedIds.has(participant.id)
    );
  }

  function renderSessionSourceSummary() {
    const element = $('#session-source-summary');
    if (!element) return;

    const source = getFreshSessionSource();

    const groupCount = source.linkedGroups.length;
    const individualCount = source.individualParticipantIds.length;
    const participantCount = source.participantIds.length;

    element.innerHTML = `
      <span><strong>${groupCount}</strong> linked group${groupCount === 1 ? '' : 's'}</span>
      <span><strong>${individualCount}</strong> individual${individualCount === 1 ? '' : 's'}</span>
      <span><strong>${participantCount}</strong> selected participants</span>
    `;
  }

  async function generateMatches() {
    const button = $('#generate');

    try {
      if (button) {
        button.disabled = true;
        button.textContent = 'Generating…';
      }

      setGenerateMessage('Checking selected groups and individuals…', 'working');

      state.sessionName = $('#session-name').value.trim().slice(0, 80);
      state.sessionDate = $('#session-date').value || localDateValue();
      state.courts = Math.max(1, Math.min(12, Number($('#courts').value) || 3));
      state.duration = Math.max(30, Math.min(720, Number($('#duration').value) || 180));
      state.rotationMin = Math.max(10, Math.min(60, Number($('#rotation-min').value) || 18));
      state.mix = $('#mix').value;

      const source = getFreshSessionSource();
      const sourceCount = source.participantIds.length;

      // Critical: do not destroy the old session until the new source is valid.
      if (source.missingGroupIds.length) {
        const message =
          'Cannot generate: one or more linked groups no longer exist. Re-link the groups on the Session page.';
        setStatus(message);
        setGenerateMessage(message, 'error');
        return;
      }

      if (sourceCount < 4) {
        let message;

        if (!source.linkedGroups.length && !source.individualParticipantIds.length) {
          message =
            'Nothing is selected for this session. Link at least one group or add individuals first.';
        } else {
          message =
            `Only ${sourceCount} participant${sourceCount === 1 ? '' : 's'} selected. At least 4 are required to generate matches.`;
        }

        setStatus(message);
        setGenerateMessage(message, 'error');
        return;
      }

      setGenerateMessage(
        `Building a fresh schedule for ${sourceCount} participants…`,
        'working'
      );

      const participants = commitFreshSessionSource(source);
      const participantCount = participants.length;
      const rounds = Math.max(1, Math.floor(state.duration / state.rotationMin));
      const slotsPerRound = state.courts * 4;

    const plays = new Map(participants.map(m => [m.id, 0]));
    const last = new Map(participants.map(m => [m.id, -99]));
    const partnerCount = new Map();
    const opponentCount = new Map();
    const matches = [];

    const pairKey = (a, b) => [a, b].sort((x,y) => x-y).join('-');

    for (let round = 1; round <= rounds; round++) {
      const tieMap = randomTieMap(participants);

      // Participation count remains the strongest priority.
      // Waiting time is second. Randomness only breaks otherwise-similar choices.
      let candidates = [...participants]
        .sort((a,b) => {
          const pa = plays.get(a.id);
          const pb = plays.get(b.id);
          if (pa !== pb) return pa - pb;

          const wa = round - last.get(a.id);
          const wb = round - last.get(b.id);
          if (wa !== wb) return wb - wa;

          // Keep broad tier composition, but don't make it deterministic.
          const tierDiff = score[b.tier] - score[a.tier];
          if (Math.abs(tierDiff) >= 2) return tierDiff;

          return tieMap.get(a.id) - tieMap.get(b.id);
        })
        .slice(0, Math.min(slotsPerRound, participants.length));

      // Shuffle selected players before court assignment so every Generate click
      // produces a genuinely different lineup while preserving the same fair pool.
      candidates = shuffleCopy(candidates);

      for (let court = 1; court <= state.courts; court++) {
        if (candidates.length < 4) break;

        let pref = 'men';

        if (state.mix === 'more-mixed') {
          pref = 'mixed';
        } else if (state.mix === 'less-mixed') {
          // Same composition rule as before: fewer mixed, with women's doubles
          // appearing regularly when enough women are available.
          pref = (court === 1 && round % 3 !== 1) ? 'women' : 'men';
        } else {
          pref = (court + round) % 3 === 0
            ? 'mixed'
            : ((court + round) % 3 === 1 ? 'women' : 'men');
        }

        // Try several randomized groups and prefer one that avoids repeating
        // partners while still following the selected match-type preference.
        let bestOption = null;

        for (let attempt = 0; attempt < 14; attempt++) {
          const trialPool = shuffleCopy(candidates);
          const group = chooseCourtGroup(trialPool, pref);
          if (group.length < 4) continue;

          const paired = pairBalanced(group);
          if (paired.length < 4) continue;

          const ids = paired.map(x => x.id);
          const partnerPenalty =
            (partnerCount.get(pairKey(ids[0], ids[1])) || 0) +
            (partnerCount.get(pairKey(ids[2], ids[3])) || 0);

          const opponentPenalty =
            (opponentCount.get(pairKey(ids[0], ids[2])) || 0) +
            (opponentCount.get(pairKey(ids[0], ids[3])) || 0) +
            (opponentCount.get(pairKey(ids[1], ids[2])) || 0) +
            (opponentCount.get(pairKey(ids[1], ids[3])) || 0);

          const team1 = score[paired[0].tier] + score[paired[1].tier];
          const team2 = score[paired[2].tier] + score[paired[3].tier];
          const skillGap = Math.abs(team1 - team2);

          // Partner repeats matter most, then excessive opponent repeats,
          // then skill gap. Tiny random noise means equal-quality options reshuffle.
          const quality =
            partnerPenalty * 20 +
            opponentPenalty * 2 +
            skillGap +
            randomValue() * 0.35;

          if (!bestOption || quality < bestOption.quality) {
            bestOption = { group, paired, ids, quality };
          }
        }

        if (!bestOption) {
          const group = chooseCourtGroup(candidates, pref);
          if (group.length < 4) break;
          const paired = pairBalanced(group);
          bestOption = {
            group,
            paired,
            ids: paired.map(x => x.id),
            quality: 0
          };
        }

        // Remove the selected four players from this rotation's remaining pool.
        bestOption.group.forEach(player => {
          const idx = candidates.findIndex(x => x.id === player.id);
          if (idx >= 0) candidates.splice(idx, 1);
        });

        const ids = bestOption.ids;

        partnerCount.set(
          pairKey(ids[0], ids[1]),
          (partnerCount.get(pairKey(ids[0], ids[1])) || 0) + 1
        );
        partnerCount.set(
          pairKey(ids[2], ids[3]),
          (partnerCount.get(pairKey(ids[2], ids[3])) || 0) + 1
        );

        [
          [ids[0], ids[2]], [ids[0], ids[3]],
          [ids[1], ids[2]], [ids[1], ids[3]]
        ].forEach(([a,b]) => {
          const key = pairKey(a,b);
          opponentCount.set(key, (opponentCount.get(key) || 0) + 1);
        });

        ids.forEach(id => {
          plays.set(id, plays.get(id) + 1);
          last.set(id, round);
        });

        matches.push({
          id: `${Date.now()}-${round}-${court}-${matches.length}-${Math.floor(randomValue()*1000000)}`,
          round,
          court,
          start: (round - 1) * state.rotationMin,
          end: round * state.rotationMin,
          players: ids,
          confirmed: true,
          playing: false,
          startedAt: null,
          completed: false,
          completedAt: null
        });
      }
    }



      if (!matches.length) {
        const message =
          'No matches could be generated from the current participants and settings.';
        setStatus(message);
        setGenerateMessage(message, 'error');
        return;
      }

      state.matches = matches;

      saveState('', 0);
      renderAll();

      const counts = [...plays.values()];
      const minMatches = Math.min(...counts);
      const maxMatches = Math.max(...counts);

      const message =
        `Generated ${matches.length} fresh matches for ${participantCount} participants. ` +
        `Participation range: ${minMatches}–${maxMatches} matches.`;

      setStatus(message);
      setGenerateMessage(message, 'success');

      showPanel('matches', true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      console.error('Match generation failed:', error);

      const detail = error?.message || String(error);
      const message = `Match generation failed: ${detail}`;

      setStatus(message);
      setGenerateMessage(message, 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Generate fresh matches';
      }
    }
  }

  function renderMembers() {
    // Participant edits modify directory fields only. Group membership/status
    // is owned exclusively by state.groups and is never recalculated here.
    const menContainer = $('#men-member-list');
    const womenContainer = $('#women-member-list');
    if (!menContainer || !womenContainer) return;

    normalizeRuntimeMembership();

    const menQuery = ($('#men-member-search')?.value || '').trim().toLowerCase();
    const womenQuery = ($('#women-member-search')?.value || '').trim().toLowerCase();

    const matchesSearch = (participant, query) => {
      if (!query) return true;

      return (
        participant.name.toLowerCase().includes(query) ||
        participant.tier.toLowerCase().includes(query)
      );
    };

    const renderGroup = (gender, container, query) => {
      const participants = state.members
        .filter(participant => participant.gender === gender)
        .sort((a, b) => a.name.localeCompare(b.name));

      const filtered = participants.filter(participant =>
        matchesSearch(participant, query)
      );

      container.innerHTML = filtered.length
        ? filtered.map(participant => {
            const moveLabel = gender === 'Man' ? '→ Women' : '→ Men';
            const targetGender = gender === 'Man' ? 'Woman' : 'Man';

            return `
              <div class="member-compact-row participant-compact-row" data-member="${participant.id}">
                <input
                  class="member-compact-name"
                  value="${esc(participant.name)}"
                  aria-label="Participant name"
                  title="${esc(participant.name)}"
                />

                <select
                  class="member-compact-tier ${tierClass[participant.tier] || 'tier-q'}"
                  aria-label="Skill tier for ${esc(participant.name)}"
                >
                  ${['A+','A','B+','B','C','D','?']
                    .map(tier => `<option ${participant.tier === tier ? 'selected' : ''}>${tier}</option>`)
                    .join('')}
                </select>

                <button
                  class="member-gender-move"
                  type="button"
                  data-target-gender="${targetGender}"
                >${moveLabel}</button>

                <button
                  class="member-remove-compact"
                  type="button"
                  aria-label="Remove ${esc(participant.name)}"
                >×</button>
              </div>
            `;
          }).join('')
        : `<div class="member-list-empty">${query ? 'No matching participants.' : 'No participants in this list.'}</div>`;

      return { total: participants.length, visible: filtered.length };
    };

    const men = renderGroup('Man', menContainer, menQuery);
    const women = renderGroup('Woman', womenContainer, womenQuery);

    if ($('#member-total')) {
      $('#member-total').textContent = `${state.members.length} participants`;
    }

    if ($('#men-member-count')) {
      $('#men-member-count').textContent = menQuery
        ? `${men.visible} of ${men.total}`
        : `${men.total} participants`;
    }

    if ($('#women-member-count')) {
      $('#women-member-count').textContent = womenQuery
        ? `${women.visible} of ${women.total}`
        : `${women.total} participants`;
    }

    $$('.member-compact-name').forEach(input => {
      input.addEventListener('change', event => {
        commitVisibleGroupEditor();
        const participant = memberById(event.target.closest('[data-member]').dataset.member);
        if (!participant) return;

        participant.name = event.target.value.trim() || 'Unnamed';
        saveState('Participant saved.');
        renderAll();
      });
    });

    $$('.member-compact-tier').forEach(select => {
      select.addEventListener('change', event => {
        commitVisibleGroupEditor();
        const participant = memberById(event.target.closest('[data-member]').dataset.member);
        if (!participant) return;

        participant.tier = event.target.value;
        saveState('Participant skill tier saved.');
        renderAll();
      });
    });

    $$('.member-gender-move').forEach(button => {
      button.addEventListener('click', event => {
        commitVisibleGroupEditor();
        const participant = memberById(event.target.closest('[data-member]').dataset.member);
        if (!participant) return;

        participant.gender = event.currentTarget.dataset.targetGender;
        saveState(`${participant.name} moved to ${participant.gender === 'Man' ? 'Men' : 'Women'}.`);
        renderAll();
      });
    });

    $$('.member-remove-compact').forEach(button => {
      button.addEventListener('click', event => {
        commitVisibleGroupEditor();
        const row = event.target.closest('[data-member]');
        const id = Number(row.dataset.member);
        const participant = memberById(id);
        if (!participant) return;

        const confirmed = window.confirm(
          isSessionMember(id)
            ? `Remove ${participant.name} from Participants? They will also be removed from the current session, all groups, and their uncompleted matches.`
            : `Remove ${participant.name} from Participants? They will also be removed from all groups.`
        );

        if (!confirmed) return;

        state.members = state.members.filter(item => item.id !== id);

        state.groups.forEach(group => {
          group.memberIds = group.memberIds.filter(memberId => memberId !== id);
          if (group.memberTypes) delete group.memberTypes[id];
        });

        state.sessionMemberIds = getSessionMemberIds().filter(memberId => memberId !== id);
        state.sessionIndividualMemberIds = state.sessionIndividualMemberIds.filter(memberId => memberId !== id);
        state.sessionManualMemberIds = state.sessionManualMemberIds.filter(memberId => memberId !== id);
        state.sessionExcludedMemberIds = state.sessionExcludedMemberIds.filter(memberId => memberId !== id);

        if (state.sessionParticipantTypes) {
          delete state.sessionParticipantTypes[id];
        }

        state.matches = state.matches.filter(match => !match.players.includes(id));

        syncSessionParticipantsFromSources();
        saveState('Participant removed from directory, groups, and current session.', 0);
        renderAll();
      });
    });
  }

  function addMemberForGender(gender) {
    const id = Math.max(0, ...state.members.map(participant => participant.id)) + 1;
    const label = gender === 'Woman' ? 'Woman' : 'Man';

    state.members.push({
      id,
      name: `New ${label}`,
      gender,
      tier: '?',
      present: false
    });

    saveState('New participant added.');

    const search = gender === 'Woman'
      ? $('#women-member-search')
      : $('#men-member-search');

    if (search) search.value = '';

    renderAll();

    requestAnimationFrame(() => {
      const input = document.querySelector(
        `[data-member="${id}"] .member-compact-name`
      );

      if (input) {
        input.focus();
        input.select();
      }
    });
  }

  function commitVisibleGroupEditor(message = '') {
    const editor = $('#group-editor');

    if (
      !editor ||
      !selectedGroupId ||
      $('#groups')?.hidden
    ) {
      return false;
    }

    const currentGroup = groupById(selectedGroupId);
    if (!currentGroup) return false;

    const toggles = [
      ...editor.querySelectorAll('.group-member-toggle')
    ];

    if (!toggles.length) return false;

    const memberIds = [];
    const memberTypes = {};

    toggles.forEach(toggle => {
      if (!toggle.checked) return;

      const participantId = Number(toggle.dataset.memberId);
      if (!Number.isFinite(participantId)) return;

      memberIds.push(participantId);

      const typeSelect = editor.querySelector(
        `.group-member-type[data-member-id="${participantId}"]`
      );

      memberTypes[participantId] =
        typeSelect?.value === 'non-member'
          ? 'non-member'
          : 'regular';
    });

    currentGroup.memberIds = [...new Set(memberIds)];
    currentGroup.memberTypes = memberTypes;

    if (state.sessionGroupIds.includes(currentGroup.id)) {
      syncSessionParticipantsFromSources();
    }

    saveState(message, 0);
    return true;
  }

  function renderGroupManager() {
    const list = $('#group-list');
    const editor = $('#group-editor');
    const note = $('#group-empty-note');
    if (!list || !editor || !note) return;

    normalizeRuntimeMembership();

    const updateGroupSummaryUi = (group) => {
      const groupTotal = $('#group-total');

      if (groupTotal) {
        const memberships = state.groups.reduce(
          (sum, item) => sum + item.memberIds.length,
          0
        );

        groupTotal.textContent =
          `${state.groups.length} group${state.groups.length === 1 ? '' : 's'} · ${memberships} assignments`;
      }

      const selectedCount = $('#selected-group-member-count');
      if (selectedCount && group) {
        selectedCount.textContent =
          `${group.memberIds.length} member${group.memberIds.length === 1 ? '' : 's'}`;
      }

      if (group) {
        const groupListCount = document.querySelector(
          `.group-list-item[data-group-id="${CSS.escape(group.id)}"] .group-list-count`
        );

        if (groupListCount) {
          groupListCount.textContent = group.memberIds.length;
        }
      }
    };

    const groupTotal = $('#group-total');
    if (groupTotal) {
      const memberships = state.groups.reduce(
        (sum, group) => sum + group.memberIds.length,
        0
      );
      groupTotal.textContent =
        `${state.groups.length} group${state.groups.length === 1 ? '' : 's'} · ${memberships} assignments`;
    }

    if (!state.groups.length) {
      selectedGroupId = null;
      list.innerHTML = '';
      note.textContent = 'No groups yet. Create your first group above.';
      editor.innerHTML = `
        <div class="group-editor-empty">
          Groups can overlap. For example, the same member can belong to both "Tuesday" and "Advanced".
        </div>
      `;
      return;
    }

    note.textContent = '';

    if (!selectedGroupId || !groupById(selectedGroupId)) {
      selectedGroupId = state.groups[0].id;
    }

    list.innerHTML = state.groups
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(group => `
        <button
          class="group-list-item ${group.id === selectedGroupId ? 'active' : ''}"
          data-group-id="${esc(group.id)}"
          type="button"
        >
          <span>${esc(group.name)}</span>
          <strong class="group-list-count">${group.memberIds.length}</strong>
        </button>
      `).join('');

    const group = groupById(selectedGroupId);
    if (!group) return;

    const rows = state.members
      .slice()
      .sort((a, b) =>
        Number(group.memberIds.includes(b.id)) - Number(group.memberIds.includes(a.id)) ||
        a.gender.localeCompare(b.gender) ||
        a.name.localeCompare(b.name)
      );

    editor.innerHTML = `
      <div class="group-editor-head">
        <div>
          <input
            id="group-name-edit"
            class="group-name-edit"
            value="${esc(group.name)}"
            maxlength="60"
            aria-label="Group name"
          />
          <span id="selected-group-member-count">
            ${group.memberIds.length} member${group.memberIds.length === 1 ? '' : 's'}
          </span>
        </div>
        <button
          id="delete-selected-group"
          class="btn danger"
          type="button"
        >Delete group</button>
      </div>

      <input
        id="group-member-search"
        class="input group-member-search"
        type="search"
        placeholder="Search members to add/remove..."
        autocomplete="off"
      />

      <div id="group-member-no-results" class="group-member-no-results" hidden>
        No matching members.
      </div>

      <div class="group-member-list">
        ${rows.map(member => `
          <div
            class="group-member-row group-member-row-with-status"
            data-group-search="${esc(
              `${member.name} ${member.tier} ${member.gender}`.toLowerCase()
            )}"
          >
            <input
              class="group-member-toggle"
              data-member-id="${member.id}"
              type="checkbox"
              ${group.memberIds.includes(member.id) ? 'checked' : ''}
            />

            <span class="pill ${tierClass[member.tier] || 'tier-q'}">${esc(member.name)}</span>

            <span>${member.gender === 'Woman' ? 'W' : 'M'} · ${esc(member.tier)}</span>

            <select
              class="group-member-type"
              data-member-id="${member.id}"
              ${group.memberIds.includes(member.id) ? '' : 'disabled'}
              aria-label="Status in ${esc(group.name)} for ${esc(member.name)}"
            >
              <option value="regular" ${groupMembershipType(group, member.id) === 'regular' ? 'selected' : ''}>Regular</option>
              <option value="non-member" ${groupMembershipType(group, member.id) === 'non-member' ? 'selected' : ''}>Non-member</option>
            </select>
          </div>
        `).join('')}
      </div>
    `;

    $$('.group-list-item').forEach(button => {
      button.addEventListener('click', event => {
        const nextGroupId = event.currentTarget.dataset.groupId;

        if (nextGroupId === selectedGroupId) return;

        commitVisibleGroupEditor('Group membership saved.');
        selectedGroupId = nextGroupId;
        renderGroupManager();
      });
    });

    $('#group-name-edit')?.addEventListener('change', event => {
      const cleanName = event.target.value.trim().slice(0, 60);
      if (!cleanName) {
        event.target.value = group.name;
        setStatus('Group name cannot be blank.');
        return;
      }

      group.name = cleanName;
      saveState('Group name saved.');
      renderAll();
    });

    $('#delete-selected-group')?.addEventListener('click', () => {
      deleteGroup(group.id);
    });

    // IMPORTANT:
    // Filter existing DOM rows instead of re-rendering the entire editor.
    // This preserves keyboard focus and the cursor position while typing.
    $('#group-member-search')?.addEventListener('input', event => {
      const query = event.currentTarget.value.trim().toLowerCase();
      let visibleCount = 0;

      $$('.group-member-row').forEach(row => {
        const searchable = row.dataset.groupSearch || '';
        const visible = !query || searchable.includes(query);

        row.hidden = !visible;
        if (visible) visibleCount += 1;
      });

      const noResults = $('#group-member-no-results');
      if (noResults) {
        noResults.hidden = visibleCount !== 0;
      }
    });

    // IMPORTANT:
    // Do not renderAll() here. Re-rendering after every checkbox change
    // destroyed/recreated the checkbox list, causing rows to move and making
    // rapid selections unreliable. Update state and only the small counters.
    $$('.group-member-toggle').forEach(input => {
      input.addEventListener('change', event => {
        const participantId = Number(event.currentTarget.dataset.memberId);

        // Always obtain the current state object; never rely on an old closure.
        const currentGroup = groupById(group.id);
        if (!currentGroup) {
          renderGroupManager();
          return;
        }

        if (
          !currentGroup.memberTypes ||
          typeof currentGroup.memberTypes !== 'object'
        ) {
          currentGroup.memberTypes = {};
        }

        inferLegacyGroupLinkBeforeEdit(currentGroup);

        const ids = new Set(currentGroup.memberIds);

        if (event.currentTarget.checked) {
          ids.add(participantId);

          if (!currentGroup.memberTypes[participantId]) {
            currentGroup.memberTypes[participantId] = 'regular';
          }
        } else {
          ids.delete(participantId);
          delete currentGroup.memberTypes[participantId];
        }

        currentGroup.memberIds = [...ids];

        const typeSelect = document.querySelector(
          `.group-member-type[data-member-id="${participantId}"]`
        );

        if (typeSelect) {
          typeSelect.disabled = !event.currentTarget.checked;

          if (event.currentTarget.checked) {
            typeSelect.value = groupMembershipType(
              currentGroup,
              participantId
            );
          }
        }

        if (state.sessionGroupIds.includes(currentGroup.id)) {
          syncSessionParticipantsFromSources();
        }

        saveState('Group membership saved.', 0);
        updateGroupSummaryUi(currentGroup);

        renderSessionParticipants();
        renderAttendance();
        renderMatches();
      });
    });

    $$('.group-member-type').forEach(select => {
      select.addEventListener('change', event => {
        const participantId = Number(event.currentTarget.dataset.memberId);

        // Same protection for group-specific Regular / Non-member changes.
        const currentGroup = groupById(group.id);
        if (!currentGroup || !currentGroup.memberIds.includes(participantId)) {
          return;
        }

        if (
          !currentGroup.memberTypes ||
          typeof currentGroup.memberTypes !== 'object'
        ) {
          currentGroup.memberTypes = {};
        }

        currentGroup.memberTypes[participantId] =
          event.currentTarget.value === 'non-member'
            ? 'non-member'
            : 'regular';

        if (state.sessionGroupIds.includes(currentGroup.id)) {
          syncSessionParticipantsFromSources();
        }

        saveState('Group participant status saved.', 0);
        updateGroupSummaryUi(currentGroup);
        renderSessionParticipants();
        renderAttendance();
      });
    });
  }

  function addSessionMember(memberId) {
    const id = Number(memberId);
    const member = memberById(id);
    if (!member) return;

    const ids = getSessionMemberIds();
    if (ids.includes(id)) {
      setStatus(`${member.name} is already in this session.`);
      return;
    }

    if (!state.sessionIndividualMemberIds.includes(id)) {
      state.sessionIndividualMemberIds = [...state.sessionIndividualMemberIds, id];
    }

    state.sessionExcludedMemberIds = state.sessionExcludedMemberIds.filter(
      participantId => participantId !== id
    );

    if (!state.sessionParticipantTypes || typeof state.sessionParticipantTypes !== 'object') {
      state.sessionParticipantTypes = {};
    }

    state.sessionParticipantTypes[id] = 'regular';
    member.present = false;

    syncSessionParticipantsFromSources();
    saveState(`${member.name} added to this session.`, 0);
    renderAll();
  }

  function removeSessionMember(memberId) {
    const id = Number(memberId);
    const member = memberById(id);
    if (!member || !isSessionMember(id)) return;

    const relatedMatches = state.matches.filter(match => match.players.includes(id));
    const activeOrFuture = relatedMatches.filter(match => !match.completed);
    const playing = activeOrFuture.filter(match => match.playing);

    let message = `Remove ${member.name} from this session?`;

    if (activeOrFuture.length) {
      message += ` ${activeOrFuture.length} uncompleted match${activeOrFuture.length === 1 ? '' : 'es'} containing this player will be removed.`;
    }

    if (playing.length) {
      message += ` This includes ${playing.length} match currently marked Playing.`;
    }

    if (relatedMatches.some(match => match.completed)) {
      message += ' Completed matches will be kept for session history.';
    }

    if (!window.confirm(message)) return;

    const sources = participantSources(id);

    state.sessionIndividualMemberIds = state.sessionIndividualMemberIds.filter(
      participantId => participantId !== id
    );

    if (sources.groups.length) {
      if (!state.sessionExcludedMemberIds.includes(id)) {
        state.sessionExcludedMemberIds = [...state.sessionExcludedMemberIds, id];
      }
    } else {
      state.sessionExcludedMemberIds = state.sessionExcludedMemberIds.filter(
        participantId => participantId !== id
      );
    }

    if (state.sessionParticipantTypes) {
      delete state.sessionParticipantTypes[id];
    }

    member.present = false;

    syncSessionParticipantsFromSources();

    saveState(`${member.name} removed from this session.`, 0);
    renderAll();
  }

  function renderSessionParticipants() {
    const menList = $('#session-men-list');
    const womenList = $('#session-women-list');
    if (!menList || !womenList) return;

    normalizeRuntimeMembership();

    const participants = getSessionMembers();
    const participantIds = new Set(participants.map(member => member.id));

    const menQuery = ($('#session-men-search')?.value || '').trim().toLowerCase();
    const womenQuery = ($('#session-women-search')?.value || '').trim().toLowerCase();

    const matchesQuery = (member, query) => {
      if (!query) return true;
      return (
        member.name.toLowerCase().includes(query) ||
        member.tier.toLowerCase().includes(query) ||
        membershipLabelFromType(sessionParticipantType(member.id)).toLowerCase().includes(query)
      );
    };

    const renderGroup = (gender, container, query, countSelector) => {
      const group = participants
        .filter(member => member.gender === gender)
        .sort((a, b) =>
          sessionParticipantType(a.id).localeCompare(sessionParticipantType(b.id)) ||
          a.name.localeCompare(b.name)
        );

      const filtered = group.filter(member => matchesQuery(member, query));

      if ($(countSelector)) {
        $(countSelector).textContent = query
          ? `${filtered.length} of ${group.length}`
          : `${group.length} participants`;
      }

      container.innerHTML = filtered.length
        ? filtered.map(member => `
            <div class="session-member-row" data-session-member="${member.id}">
              <span class="session-member-name pill ${tierClass[member.tier] || 'tier-q'}">
                ${esc(member.name)}
              </span>
              <span class="session-member-tier">${esc(member.tier)}</span>
              <span class="session-member-type ${sessionParticipantType(member.id) === 'non-member' ? 'nonmember' : 'regular'}">
                ${membershipLabelFromType(sessionParticipantType(member.id))}
              </span>
              <button
                class="session-member-remove"
                data-id="${member.id}"
                type="button"
              >Remove</button>
            </div>
          `).join('')
        : `<div class="session-member-empty">${query ? 'No matching participants.' : 'No participants.'}</div>`;
    };

    renderGroup('Man', menList, menQuery, '#session-men-count');
    renderGroup('Woman', womenList, womenQuery, '#session-women-count');

    const regular = participants.filter(member => sessionParticipantType(member.id) === 'regular').length;
    const nonMembers = participants.length - regular;

    if ($('#session-participant-summary')) {
      $('#session-participant-summary').innerHTML = `
        <span><strong>${participants.length}</strong> participants</span>
        <span><strong>${regular}</strong> regular</span>
        <span><strong>${nonMembers}</strong> non-member</span>
      `;
    }

    const groupSelect = $('#session-group-select');
    if (groupSelect) {
      groupSelect.innerHTML = state.groups.length
        ? `<option value="">Choose a group…</option>` +
          state.groups
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(group => `
              <option value="${esc(group.id)}">
                ${state.sessionGroupIds.includes(group.id) ? 'Linked · ' : ''}${esc(group.name)} · ${group.memberIds.length} member${group.memberIds.length === 1 ? '' : 's'}
              </option>
            `).join('')
        : '<option value="">Create a group in Groups first</option>';
    }

    const individualSelect = $('#session-add-individual-select');
    if (individualSelect) {
      const linkedGroupMemberIds = new Set();

      state.sessionGroupIds.forEach(groupId => {
        const linkedGroup = groupById(groupId);
        linkedGroup?.memberIds.forEach(id => linkedGroupMemberIds.add(Number(id)));
      });

      const individualIds = new Set(
        state.sessionIndividualMemberIds.map(Number)
      );

      const available = state.members
        .filter(member =>
          !linkedGroupMemberIds.has(member.id) &&
          !individualIds.has(member.id)
        )
        .sort((a, b) =>
          a.gender.localeCompare(b.gender) ||
          a.name.localeCompare(b.name)
        );

      individualSelect.innerHTML = available.length
        ? `<option value="">Add individual…</option>` +
          available.map(member => `
            <option value="${member.id}">
              ${esc(member.name)} · ${member.gender === 'Woman' ? 'W' : 'M'} · ${esc(member.tier)}
            </option>
          `).join('')
        : '<option value="">Everyone outside linked groups is already added</option>';
    }

    $$('.session-member-remove').forEach(button => {
      button.addEventListener('click', event => {
        removeSessionMember(event.currentTarget.dataset.id);
      });
    });

    renderSessionSourceSummary();
  }

  function playerOptionMembers(selected) {
    const participants = getSessionMembers();
    const selectedMember = memberById(selected);

    if (
      selectedMember &&
      !participants.some(member => member.id === selectedMember.id)
    ) {
      return [...participants, selectedMember];
    }

    return participants;
  }

  function playerOptions(selected) {
    return playerOptionMembers(selected).map(m =>
      `<option value="${m.id}" ${m.id === Number(selected) ? 'selected' : ''}>${esc(m.name)} (${esc(m.tier)})</option>`
    ).join('');
  }

  function playerNameOptions(selected) {
    return playerOptionMembers(selected).map(m =>
      `<option value="${m.id}" ${m.id === Number(selected) ? 'selected' : ''}>${esc(m.name)}</option>`
    ).join('');
  }

  function selectedTierClass(playerId) {
    const tier = memberById(playerId)?.tier || '?';
    return tierClass[tier] || 'tier-q';
  }

  function teamAverage(playerA, playerB) {
    const a = memberById(playerA);
    const b = memberById(playerB);
    if (!a || !b) return 0;
    return (score[a.tier] + score[b.tier]) / 2;
  }

  function matchSkillLabel(match) {
    const a = teamAverage(match.players[0], match.players[1]);
    const b = teamAverage(match.players[2], match.players[3]);
    const avg = (a + b) / 2;

    if (avg >= 5.1) return 'High tier';
    if (avg >= 4.0) return 'Upper / mid';
    if (avg >= 3.0) return 'Mid / development';
    return 'Development';
  }


  function hasMatchStarted(match) {
    return Boolean(match?.playing || match?.completed || match?.startedAt);
  }

  function getPlayedCountMap() {
    const counts = new Map(state.members.map(member => [member.id, 0]));

    state.matches.forEach(match => {
      if (!hasMatchStarted(match)) return;
      match.players.forEach(id => {
        if (counts.has(Number(id))) {
          counts.set(Number(id), (counts.get(Number(id)) || 0) + 1);
        }
      });
    });

    return counts;
  }

  function getScheduledCountMap() {
    const counts = new Map(state.members.map(member => [member.id, 0]));

    state.matches.forEach(match => {
      match.players.forEach(id => {
        if (counts.has(Number(id))) {
          counts.set(Number(id), (counts.get(Number(id)) || 0) + 1);
        }
      });
    });

    return counts;
  }

  function getPlayingPlayerIds() {
    const ids = new Set();
    state.matches
      .filter(match => match.playing && !match.completed)
      .forEach(match => match.players.forEach(id => ids.add(Number(id))));
    return ids;
  }

  function getPlayingMatchOnCourt(courtNo, excludeMatchId = null) {
    return state.matches.find(match =>
      match.id !== excludeMatchId &&
      match.playing &&
      !match.completed &&
      Number(match.court) === Number(courtNo)
    );
  }

  function courtOptions(selectedCourt) {
    return Array.from({ length: state.courts }, (_, index) => {
      const courtNo = index + 1;
      const playing = getPlayingMatchOnCourt(courtNo);
      const busyText = playing ? ' (playing)' : '';
      return `<option value="${courtNo}" ${Number(selectedCourt) === courtNo ? 'selected' : ''}>Court ${courtNo}${busyText}</option>`;
    }).join('');
  }

  function changeMatchCourt(matchId, newCourt) {
    const match = state.matches.find(item => item.id === matchId);
    if (!match || match.playing || match.completed) {
      setStatus('Court can only be changed before the match starts.');
      renderAll();
      return;
    }

    const courtNo = Math.max(1, Math.min(state.courts, Number(newCourt) || 1));
    const oldCourt = Number(match.court) || 1;

    // Keep one match per court within the same planned rotation by swapping
    // court numbers if another scheduled match already occupies that court.
    const sameRoundConflict = state.matches.find(item =>
      item.id !== match.id &&
      Number(item.round) === Number(match.round) &&
      !item.playing &&
      !item.completed &&
      Number(item.court) === courtNo
    );

    if (sameRoundConflict) {
      sameRoundConflict.court = oldCourt;
    }

    match.court = courtNo;
    saveState('Court assignment saved.');
    renderAll();
  }

  function changeMatchPlayerWithSwap(matchId, slot, newPlayerId) {
    const match = state.matches.find(item => item.id === matchId);
    const slotNo = Number(slot);
    const newId = Number(newPlayerId);

    if (!match || match.playing || match.completed) {
      setStatus('Players can only be changed before the match starts.');
      renderAll();
      return;
    }

    const oldId = Number(match.players[slotNo]);
    if (oldId === newId) return;

    if (match.players.some((id, index) => index !== slotNo && Number(id) === newId)) {
      setStatus(`${memberName(newId)} is already in this match.`);
      renderAll();
      return;
    }

    const playingIds = getPlayingPlayerIds();
    if (playingIds.has(newId)) {
      setStatus(`${memberName(newId)} is currently playing and cannot be moved.`);
      renderAll();
      return;
    }

    // Find other not-started matches containing the selected player.
    // Exclude targets that already contain the displaced player, which would
    // create a duplicate after the swap.
    const swapCandidates = state.matches.filter(other =>
      other.id !== match.id &&
      !other.playing &&
      !other.completed &&
      other.players.some(id => Number(id) === newId) &&
      !other.players.some(id => Number(id) === oldId)
    );

    let swapMatch = null;

    if (swapCandidates.length) {
      const lines = swapCandidates.map((candidate, index) =>
        `${index + 1}. R${candidate.round} · Court ${candidate.court} · ${matchType(candidate.players)}`
      );

      const answer = window.prompt(
        `Switch ${memberName(oldId)} with ${memberName(newId)}.\n\n` +
        `${memberName(newId)} is scheduled in these available matches:\n` +
        `${lines.join('\n')}\n\n` +
        `Enter the match number to swap with, or Cancel to keep the current schedule.`
      );

      if (answer === null || String(answer).trim() === '') {
        renderAll();
        return;
      }

      const choice = Number(answer) - 1;
      if (!Number.isInteger(choice) || choice < 0 || choice >= swapCandidates.length) {
        setStatus('Invalid match selection. No player changes were made.');
        renderAll();
        return;
      }

      swapMatch = swapCandidates[choice];
    }

    if (swapMatch) {
      const targetSlot = swapMatch.players.findIndex(id => Number(id) === newId);
      if (targetSlot < 0) {
        renderAll();
        return;
      }

      swapMatch.players[targetSlot] = oldId;
      match.players[slotNo] = newId;

      saveState(
        `Swapped ${memberName(oldId)} and ${memberName(newId)} between R${match.round} and R${swapMatch.round}.`
      );
    } else {
      // If the selected player has no other unstarted scheduled appearance,
      // allow a direct replacement.
      match.players[slotNo] = newId;
      saveState(`Replaced ${memberName(oldId)} with ${memberName(newId)}.`);
    }

    renderAll();
  }

  function startMatch(matchId) {
    const match = state.matches.find(item => item.id === matchId);
    if (!match || match.completed || match.playing) return;

    if (!match.confirmed) {
      setStatus('Confirm this match before starting it.');
      return;
    }

    const missing = match.players.filter(id => !memberById(id)?.present);
    if (missing.length) {
      setStatus(`Cannot start: waiting for ${missing.map(memberName).join(', ')}.`);
      return;
    }

    const playingIds = getPlayingPlayerIds();
    const busyPlayers = match.players.filter(id => playingIds.has(Number(id)));
    if (busyPlayers.length) {
      setStatus(`Cannot start: ${busyPlayers.map(memberName).join(', ')} already playing.`);
      return;
    }

    const occupied = getPlayingMatchOnCourt(match.court, match.id);
    if (occupied) {
      setStatus(`Court ${match.court} is already being used by R${occupied.round}.`);
      return;
    }

    match.playing = true;
    match.startedAt = new Date().toISOString();
    match.completed = false;
    match.completedAt = null;

    saveState(`R${match.round} started on Court ${match.court}. Player played counts increased.`);
    renderAll();
  }

  function completeMatch(matchId) {
    const match = state.matches.find(item => item.id === matchId);
    if (!match || !match.playing || match.completed) return;

    match.playing = false;
    match.completed = true;
    match.completedAt = new Date().toISOString();

    saveState(`R${match.round} on Court ${match.court} completed.`);
    renderAll();
  }

  function undoMatchStart(matchId) {
    const match = state.matches.find(item => item.id === matchId);
    if (!match || !match.playing || match.completed) return;

    const confirmed = window.confirm(
      `Return R${match.round} on Court ${match.court} to Available? Its four played counts will decrease by one.`
    );
    if (!confirmed) return;

    match.playing = false;
    match.startedAt = null;
    match.completed = false;
    match.completedAt = null;

    saveState(`R${match.round} returned to Available.`);
    renderAll();
  }

  function excelEscape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function excelTierColor(tier) {
    return {
      'A+': '#4472C4',
      'A': '#9DC3E6',
      'B+': '#70AD47',
      'B': '#A9D18E',
      'C': '#FFE699',
      'D': '#FCE4D6',
      '?': '#E7E6E6'
    }[tier] || '#FFFFFF';
  }

  function exportMatchesToExcel() {
    if (!state.matches.length) {
      setStatus('There are no matches to export.');
      return;
    }

    const playedCounts = getPlayedCountMap();
    const scheduledCounts = getScheduledCountMap();

    const matchRows = [...state.matches]
      .sort((a, b) => a.round - b.round || a.court - b.court)
      .map(match => {
        const p = match.players.map(memberById);
        const team1 = p.slice(0, 2);
        const team2 = p.slice(2, 4);

        return `
          <tr>
            <td>${match.round}</td>
            <td>${match.court}</td>
            <td>${excelEscape(matchType(match.players))}</td>
            <td style="background:${excelTierColor(team1[0]?.tier)}">${excelEscape(team1[0]?.name)}</td>
            <td style="background:${excelTierColor(team1[1]?.tier)}">${excelEscape(team1[1]?.name)}</td>
            <td style="background:${excelTierColor(team2[0]?.tier)}">${excelEscape(team2[0]?.name)}</td>
            <td style="background:${excelTierColor(team2[1]?.tier)}">${excelEscape(team2[1]?.name)}</td>
            <td>${excelEscape(matchSkillLabel(match))}</td>
            <td>${match.confirmed ? 'Yes' : 'No'}</td>
            <td>${match.playing ? 'Playing' : (match.completed ? 'Completed' : 'Not started')}</td>
          </tr>
        `;
      }).join('');

    const playerRows = [...getSessionMembers()]
      .sort((a, b) =>
        (playedCounts.get(a.id) || 0) - (playedCounts.get(b.id) || 0) ||
        a.name.localeCompare(b.name)
      )
      .map(member => `
        <tr>
          <td style="background:${excelTierColor(member.tier)}">${excelEscape(member.name)}</td>
          <td>${excelEscape(member.gender)}</td>
          <td>${excelEscape(member.tier)}</td>
          <td>${playedCounts.get(member.id) || 0}</td>
          <td>${scheduledCounts.get(member.id) || 0}</td>
          <td>${member.present ? 'Present' : 'Absent'}</td>
        </tr>
      `).join('');

    const sessionName = state.sessionName || 'Badminton Session';
    const generatedAt = new Date().toLocaleString();

    const html = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:x="urn:schemas-microsoft-com:office:excel"
            xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="UTF-8">
        <meta name="ProgId" content="Excel.Sheet">
        <meta name="Generator" content="Badminton Session Manager">
        <style>
          body { font-family: Arial, sans-serif; font-size: 10pt; }
          table { border-collapse: collapse; margin-bottom: 18px; }
          th, td { border: 1px solid #999; padding: 5px 7px; white-space: nowrap; }
          th { background: #D9E2F3; font-weight: bold; }
          .title { font-size: 16pt; font-weight: bold; border: 0; }
          .label { font-weight: bold; background: #F2F2F2; }
        </style>
      </head>
      <body>

        <table>
          <tr><td class="title" colspan="4">${excelEscape(sessionName)}</td></tr>
          <tr><td class="label">Session date</td><td>${excelEscape(formatSessionDate(state.sessionDate))}</td></tr>
          <tr><td class="label">Exported</td><td>${excelEscape(generatedAt)}</td></tr>
          <tr><td class="label">Courts</td><td>${state.courts}</td></tr>
          <tr><td class="label">Duration</td><td>${state.duration} min</td></tr>
          <tr><td class="label">Rotation</td><td>${state.rotationMin} min</td></tr>
          <tr><td class="label">Match mix</td><td>${excelEscape(state.mix)}</td></tr>
          <tr><td class="label">Total matches</td><td>${state.matches.length}</td></tr>
        </table>

        <table>
          <tr>
            <th>Player</th>
            <th>Gender</th>
            <th>Tier</th>
            <th>Played</th>
            <th>Scheduled</th>
            <th>Attendance</th>
          </tr>
          ${playerRows}
        </table>

        <table>
          <tr>
            <th>Rotation</th>
            <th>Court</th>
            <th>Type</th>
            <th>Team 1 - Player 1</th>
            <th>Team 1 - Player 2</th>
            <th>Team 2 - Player 1</th>
            <th>Team 2 - Player 2</th>
            <th>Profile</th>
            <th>Confirmed</th>
            <th>Status</th>
          </tr>
          ${matchRows}
        </table>

      </body>
      </html>
    `;

    const blob = new Blob(
      ['\ufeff', html],
      { type: 'application/vnd.ms-excel;charset=utf-8' }
    );

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    const safeName = String(sessionName || 'badminton-session')
      .trim()
      .replace(/[^\w\-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'badminton-session';

    anchor.href = url;
    anchor.download = `${safeName}.xls`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`Excel file exported: ${safeName}.xls`);
  }

  function renderPlayerMatchCounts() {
    const container = $('#player-match-counts');
    if (!container) return;

    const played = getPlayedCountMap();
    const scheduled = getScheduledCountMap();

    const rows = getSessionMembers()
      .map(member => ({
        ...member,
        playedCount: played.get(member.id) || 0,
        scheduledCount: scheduled.get(member.id) || 0
      }))
      .sort((a, b) =>
        a.playedCount - b.playedCount ||
        a.scheduledCount - b.scheduledCount ||
        a.name.localeCompare(b.name)
      );

    if (!rows.length) {
      container.innerHTML = '<span class="match-count-empty">No players.</span>';
      return;
    }

    container.innerHTML = rows.map(member => `
      <div
        class="match-count-chip ${tierClass[member.tier] || 'tier-q'}"
        title="${esc(member.name)}: ${member.playedCount} played, ${member.scheduledCount} scheduled"
      >
        <span class="match-count-name">${esc(member.name)}</span>
        <span class="match-count-number">${member.playedCount}/${member.scheduledCount}</span>
      </div>
    `).join('');
  }

  function renderMatches() {
    const head = $('#match-grid-head');
    const body = $('#match-grid-body');
    const hideCompleted = Boolean($('#hide-completed')?.checked);

    if (!head || !body) return;

    const courtCount = Math.max(
      state.courts || 1,
      ...state.matches.map(match => Number(match.court) || 1)
    );

    head.innerHTML = `
      <tr>
        <th class="rotation-col">Rot.</th>
        ${Array.from({ length: courtCount }, (_, i) => `<th>Court ${i + 1}</th>`).join('')}
      </tr>
    `;

    if (!state.matches.length) {
      body.innerHTML = `<tr><td class="rotation-sheet-empty" colspan="${courtCount + 1}">No matches yet. Generate them from Session.</td></tr>`;
      return;
    }

    const grouped = [...state.matches]
      .sort((a, b) => a.round - b.round || a.court - b.court)
      .reduce((map, match) => {
        if (!map.has(match.round)) map.set(match.round, []);
        map.get(match.round).push(match);
        return map;
      }, new Map());

    const rows = [];

    for (const [round, matches] of grouped.entries()) {
      const allCompleted = matches.length > 0 && matches.every(match => match.completed);
      if (hideCompleted && allCompleted) continue;

      const byCourt = new Map(matches.map(match => [Number(match.court), match]));

      const courtCells = Array.from({ length: courtCount }, (_, index) => {
        const courtNo = index + 1;
        const match = byCourt.get(courtNo);

        if (!match || (hideCompleted && match.completed)) {
          return `
            <td class="court-grid-cell">
              <div class="empty-court">${match?.completed ? 'Completed' : 'No match'}</div>
            </td>
          `;
        }

        const duplicate = new Set(match.players.map(Number)).size < 4;
        const status = match.completed ? 'Completed' : (match.playing ? 'Playing' : 'Available');
        const statusClass = match.completed ? 'status-completed' : (match.playing ? 'status-playing' : 'status-available');
        const locked = match.playing || match.completed;

        return `
          <td
            class="court-grid-cell ${match.completed ? 'done' : ''} ${match.playing ? 'playing' : ''} ${!match.confirmed ? 'unconfirmed' : ''} ${duplicate ? 'duplicate' : ''}"
            data-match="${esc(match.id)}"
          >
            <div class="court-cell-head">
              <div class="court-name-line">
                <select class="grid-court-select" ${locked ? 'disabled' : ''} aria-label="Court assignment">
                  ${courtOptions(match.court)}
                </select>
                <span class="match-status-badge ${statusClass}">${status}</span>
              </div>

              <label class="court-flag" title="Confirmed">
                <input class="confirm-match" type="checkbox" ${match.confirmed ? 'checked' : ''} ${locked ? 'disabled' : ''} />
                C
              </label>
            </div>

            <div class="court-teams-grid">
              <div class="court-team">
                <select
                  class="grid-player player-select ${selectedTierClass(match.players[0])}"
                  data-slot="0"
                  ${locked ? 'disabled' : ''}
                  aria-label="R${round}, Team 1 player 1"
                >${playerNameOptions(match.players[0])}</select>

                <select
                  class="grid-player player-select ${selectedTierClass(match.players[1])}"
                  data-slot="1"
                  ${locked ? 'disabled' : ''}
                  aria-label="R${round}, Team 1 player 2"
                >${playerNameOptions(match.players[1])}</select>
              </div>

              <div class="court-vs">VS</div>

              <div class="court-team">
                <select
                  class="grid-player player-select ${selectedTierClass(match.players[2])}"
                  data-slot="2"
                  ${locked ? 'disabled' : ''}
                  aria-label="R${round}, Team 2 player 1"
                >${playerNameOptions(match.players[2])}</select>

                <select
                  class="grid-player player-select ${selectedTierClass(match.players[3])}"
                  data-slot="3"
                  ${locked ? 'disabled' : ''}
                  aria-label="R${round}, Team 2 player 2"
                >${playerNameOptions(match.players[3])}</select>
              </div>
            </div>

            <div class="court-foot">
              <span>${matchType(match.players)} · ${matchSkillLabel(match)}</span>
              ${duplicate ? '<span class="court-warning">Duplicate</span>' : ''}
            </div>
          </td>
        `;
      }).join('');

      rows.push(`
        <tr class="${allCompleted ? 'completed-rotation' : ''}">
          <td class="rotation-meta-cell rotation-number-cell">${round}</td>
          ${courtCells}
        </tr>
      `);
    }

    body.innerHTML = rows.length
      ? rows.join('')
      : `<tr><td class="rotation-sheet-empty" colspan="${courtCount + 1}">All matches are completed.</td></tr>`;

    $$('.player-select').forEach(select => select.addEventListener('change', event => {
      const cell = event.target.closest('[data-match]');
      changeMatchPlayerWithSwap(
        cell.dataset.match,
        event.target.dataset.slot,
        event.target.value
      );
    }));

    $$('.grid-court-select').forEach(select => select.addEventListener('change', event => {
      const cell = event.target.closest('[data-match]');
      changeMatchCourt(cell.dataset.match, event.target.value);
    }));

    $$('.confirm-match').forEach(input => input.addEventListener('change', event => {
      const cell = event.target.closest('[data-match]');
      const match = state.matches.find(item => item.id === cell.dataset.match);
      if (!match || match.playing || match.completed) {
        renderAll();
        return;
      }
      match.confirmed = event.target.checked;
      saveState('Match confirmation saved.');
      renderAll();
    }));
  }

  function renderSession() {
    renderSessionParticipants();
  }

  function renderAttendance() {
    const attendanceList = $('#attendance-list');
    const summary = $('#live-summary');
    const availableContainer = $('#available-matches');
    const waitingContainer = $('#waiting-matches');
    const courtGrid = $('#court-status-grid');

    if (!attendanceList || !summary || !availableContainer || !waitingContainer || !courtGrid) {
      return;
    }

    const playedCounts = getPlayedCountMap();
    const scheduledCounts = getScheduledCountMap();
    const playingIds = getPlayingPlayerIds();

    attendanceList.innerHTML = [...getSessionMembers()]
      .sort((a, b) =>
        (playedCounts.get(a.id) || 0) - (playedCounts.get(b.id) || 0) ||
        a.name.localeCompare(b.name)
      )
      .map(member => `
        <label class="attendance-row">
          <span class="attendance-name-wrap">
            <span class="attendance-name pill ${tierClass[member.tier] || 'tier-q'}">
              ${esc(member.name)}
            </span>
            <span class="attendance-played-count">
              ${playedCounts.get(member.id) || 0}/${scheduledCounts.get(member.id) || 0}
              ${playingIds.has(member.id) ? ' · Playing' : ''}
            </span>
          </span>

          <input
            class="attend-toggle"
            data-id="${member.id}"
            type="checkbox"
            ${member.present ? 'checked' : ''}
          />
        </label>
      `).join('');

    $$('.attend-toggle').forEach(input => input.addEventListener('change', event => {
      const member = memberById(event.target.dataset.id);
      if (!member) return;

      if (!event.target.checked && playingIds.has(member.id)) {
        setStatus(`${member.name} is currently playing. Complete or undo that match before clearing attendance.`);
        renderAll();
        return;
      }

      member.present = event.target.checked;
      saveState();
      renderAll();
    }));

    const playing = state.matches
      .filter(match => match.playing && !match.completed)
      .sort((a, b) => a.court - b.court);

    const unstartedConfirmed = state.matches.filter(match =>
      match.confirmed &&
      !match.playing &&
      !match.completed
    );

    const available = unstartedConfirmed
      .filter(match => {
        const allPresent = match.players.every(id => memberById(id)?.present);
        const nobodyPlaying = match.players.every(id => !playingIds.has(Number(id)));
        return allPresent && nobodyPlaying;
      })
      .sort((a, b) => {
        const aCounts = a.players.map(id => playedCounts.get(Number(id)) || 0);
        const bCounts = b.players.map(id => playedCounts.get(Number(id)) || 0);

        const aSum = aCounts.reduce((sum, value) => sum + value, 0);
        const bSum = bCounts.reduce((sum, value) => sum + value, 0);
        if (aSum !== bSum) return aSum - bSum;

        const aMax = Math.max(...aCounts);
        const bMax = Math.max(...bCounts);
        if (aMax !== bMax) return aMax - bMax;

        return a.round - b.round || a.court - b.court;
      });

    const availableIds = new Set(available.map(match => match.id));
    const waiting = unstartedConfirmed
      .filter(match => !availableIds.has(match.id))
      .sort((a, b) => a.round - b.round || a.court - b.court);

    const completed = state.matches.filter(match => match.completed).length;

    summary.innerHTML = [
      [available.length, 'Available'],
      [playing.length, 'Playing'],
      [waiting.length, 'Waiting'],
      [completed, 'Completed']
    ].map(([value, label]) => `
      <div class="summary-card">
        <div class="value">${value}</div>
        <div class="label">${label}</div>
      </div>
    `).join('');

    // Physical court view: one card per configured court.
    courtGrid.innerHTML = Array.from({ length: state.courts }, (_, index) => {
      const courtNo = index + 1;
      const match = playing.find(item => Number(item.court) === courtNo);

      if (!match) {
        return `
          <div class="court-live-card empty">
            <div class="court-live-title">Court ${courtNo}</div>
            <div class="court-live-empty">Free</div>
          </div>
        `;
      }

      return `
        <div class="court-live-card active" data-playing-match="${esc(match.id)}">
          <div class="court-live-head">
            <div>
              <div class="court-live-title">Court ${courtNo}</div>
              <div class="court-live-sub">R${match.round} · ${matchType(match.players)}</div>
            </div>
            <span class="match-status-badge status-playing">Playing</span>
          </div>

          <div class="court-live-teams">
            <div class="court-live-team">${playerChip(match.players[0])}${playerChip(match.players[1])}</div>
            <div class="court-live-vs">VS</div>
            <div class="court-live-team">${playerChip(match.players[2])}${playerChip(match.players[3])}</div>
          </div>

          <div class="court-live-actions">
            <button class="btn undo-start" data-id="${esc(match.id)}" type="button">Undo start</button>
            <button class="btn primary complete-playing" data-id="${esc(match.id)}" type="button">Complete match</button>
          </div>
        </div>
      `;
    }).join('');

    availableContainer.innerHTML = available.length
      ? available.map((match, index) => {
          const counts = match.players.map(id => playedCounts.get(Number(id)) || 0);
          const priority = counts.reduce((sum, value) => sum + value, 0);

          return `
            <article class="available-match-card" data-available-match="${esc(match.id)}">
              <div class="available-match-head">
                <div>
                  <div class="available-priority">Priority ${index + 1}</div>
                  <strong>R${match.round} · ${matchType(match.players)}</strong>
                  <div class="available-count-note">Played counts: ${counts.join(' · ')} · Total ${priority}</div>
                </div>

                <select class="available-court-select" aria-label="Court for R${match.round}">
                  ${courtOptions(match.court)}
                </select>
              </div>

              <div class="available-teams-grid">
                <div class="available-team">
                  <select class="available-player-select ${selectedTierClass(match.players[0])}" data-slot="0">${playerNameOptions(match.players[0])}</select>
                  <select class="available-player-select ${selectedTierClass(match.players[1])}" data-slot="1">${playerNameOptions(match.players[1])}</select>
                </div>

                <div class="available-vs">VS</div>

                <div class="available-team">
                  <select class="available-player-select ${selectedTierClass(match.players[2])}" data-slot="2">${playerNameOptions(match.players[2])}</select>
                  <select class="available-player-select ${selectedTierClass(match.players[3])}" data-slot="3">${playerNameOptions(match.players[3])}</select>
                </div>
              </div>

              <div class="available-match-foot">
                <span>${matchSkillLabel(match)}</span>
                <button class="btn primary start-match" data-id="${esc(match.id)}" type="button">
                  Start on Court ${match.court}
                </button>
              </div>
            </article>
          `;
        }).join('')
      : '<div class="card">No match is currently available. Check attendance or finish the matches already playing.</div>';

    waitingContainer.innerHTML = waiting.length
      ? waiting.map(match => {
          const missing = match.players
            .filter(id => !memberById(id)?.present)
            .map(memberName);

          const busy = match.players
            .filter(id => playingIds.has(Number(id)))
            .map(memberName);

          const reasons = [];
          if (missing.length) reasons.push(`Waiting for attendance: ${missing.join(', ')}`);
          if (busy.length) reasons.push(`Currently playing: ${busy.join(', ')}`);

          return `
            <div class="match-card waiting">
              <strong>R${match.round} · Court ${match.court} · ${matchType(match.players)}</strong>
              <div class="match-meta">${esc(reasons.join(' · ') || 'Blocked')}</div>
              <div class="player-chips">${match.players.map(playerChip).join('')}</div>
            </div>
          `;
        }).join('')
      : '<div class="card">No waiting matches.</div>';

    $$('.available-court-select').forEach(select => select.addEventListener('change', event => {
      const card = event.target.closest('[data-available-match]');
      changeMatchCourt(card.dataset.availableMatch, event.target.value);
    }));

    $$('.available-player-select').forEach(select => select.addEventListener('change', event => {
      const card = event.target.closest('[data-available-match]');
      changeMatchPlayerWithSwap(
        card.dataset.availableMatch,
        event.target.dataset.slot,
        event.target.value
      );
    }));

    $$('.start-match').forEach(button => button.addEventListener('click', event => {
      startMatch(event.currentTarget.dataset.id);
    }));

    $$('.complete-playing').forEach(button => button.addEventListener('click', event => {
      completeMatch(event.currentTarget.dataset.id);
    }));

    $$('.undo-start').forEach(button => button.addEventListener('click', event => {
      undoMatchStart(event.currentTarget.dataset.id);
    }));
  }

  function defaultHistoryName() {
    const datePart = formatSessionDate(state.sessionDate || localDateValue());
    return `Session ${datePart}`;
  }

  async function saveSessionToHistory() {
    state.sessionName = $('#session-name').value.trim().slice(0, 80);
    state.sessionDate = $('#session-date').value || localDateValue();
    const name = state.sessionName || defaultHistoryName();

    try {
      if (cloudReady && window.BadmintonCloud?.getActiveWorkspace()) {
        await window.BadmintonCloud.saveHistorySession(name, snapshotState());
        historySource = 'cloud';
      } else {
        const record = window.BadmintonStorage?.saveHistorySession(name, snapshotState());
        if (!record) throw new Error('Could not save local session history.');
        historySource = 'local';
      }

      if (!state.sessionName) {
        state.sessionName = name;
        $('#session-name').value = name;
        saveState();
      }

      await renderHistory();
      setStatus(cloudReady && window.BadmintonCloud?.getActiveWorkspace()
        ? `Session saved to shared history: ${name}`
        : `Session saved locally: ${name}`);
    } catch (error) {
      setStatus(`Could not save session: ${error.message}`);
    }
  }

  function historyRecordStats(record) {
    const matches = record.state.matches || [];
    const members = record.state.members || [];
    const validIds = new Set(members.map(member => Number(member.id)));
    const participantIds = Array.isArray(record.state.sessionMemberIds)
      ? record.state.sessionMemberIds.map(Number).filter(id => validIds.has(id))
      : members.map(member => Number(member.id));
    const participantIdSet = new Set(participantIds);
    const participants = members.filter(member => participantIdSet.has(Number(member.id)));

    return {
      players: participants.length,
      matches: matches.length,
      completed: matches.filter(match => match.completed).length,
      confirmed: matches.filter(match => match.confirmed).length,
      present: participants.filter(member => member.present).length
    };
  }

  function formatHistoryDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown date';

    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  async function renderHistory() {
    const list = $('#history-list');
    const summary = $('#history-summary');
    if (!list || !summary) return;

    let records = [];
    try {
      if (cloudReady && window.BadmintonCloud?.getActiveWorkspace()) {
        records = await window.BadmintonCloud.loadHistory();
        historySource = 'cloud';
      } else {
        const result = window.BadmintonStorage?.loadHistory();
        records = result?.records || [];
        historySource = 'local';
      }
    } catch (error) {
      list.innerHTML = `<div class="history-empty">Could not load history: ${esc(error.message)}</div>`;
      return;
    }

    const totalMatches = records.reduce((sum, record) => sum + (record.state.matches?.length || 0), 0);
    const totalCompleted = records.reduce((sum, record) => sum + (record.state.matches || []).filter(match => match.completed).length, 0);

    summary.innerHTML = `
      <div class="history-kpi"><span class="history-kpi-value">${records.length}</span><span class="history-kpi-label">${historySource === 'cloud' ? 'Shared sessions' : 'Local sessions'}</span></div>
      <div class="history-kpi"><span class="history-kpi-value">${totalMatches}</span><span class="history-kpi-label">Saved matches</span></div>
      <div class="history-kpi"><span class="history-kpi-value">${totalCompleted}</span><span class="history-kpi-label">Completed matches</span></div>`;

    if (!records.length) {
      list.innerHTML = `<div class="history-empty">No ${historySource === 'cloud' ? 'shared' : 'local'} saved sessions yet. Use <strong>Save Session</strong> from Session or Matches.</div>`;
      return;
    }

    list.innerHTML = records.map(record => {
      const stats = historyRecordStats(record);
      const historyMembers = record.state.members || [];
      const historyValidIds = new Set(historyMembers.map(member => Number(member.id)));
      const historyParticipantIds = Array.isArray(record.state.sessionMemberIds)
        ? record.state.sessionMemberIds.map(Number).filter(id => historyValidIds.has(id))
        : historyMembers.map(member => Number(member.id));
      const historyParticipantSet = new Set(historyParticipantIds);
      const historyParticipants = historyMembers.filter(member =>
        historyParticipantSet.has(Number(member.id))
      );

      const playerCounts = new Map(historyParticipants.map(member => [Number(member.id), 0]));
      record.state.matches.forEach(match => match.players.forEach(id => {
        const numericId = Number(id);
        if (playerCounts.has(numericId)) {
          playerCounts.set(numericId, playerCounts.get(numericId) + 1);
        }
      }));
      const countText = historyParticipants
        .map(member => `${esc(member.name)} ${playerCounts.get(Number(member.id)) || 0}`)
        .join(' · ');
      return `
        <article class="history-card" data-history-id="${esc(record.id)}">
          <div class="history-card-main">
            <div class="history-title-row">
              <div><h3>${esc(record.name)}</h3><div class="history-date">${esc(formatHistoryDate(record.saved_at || record.savedAt))}</div></div>
              <div class="history-actions"><button class="btn history-restore" type="button">Restore</button><button class="btn danger history-delete" type="button">Delete</button></div>
            </div>
            <div class="history-meta-grid">
              <span><strong>${stats.players}</strong> players</span><span><strong>${stats.matches}</strong> matches</span><span><strong>${stats.completed}</strong> completed</span><span><strong>${stats.present}</strong> attended</span><span><strong>${record.state.courts}</strong> courts</span><span><strong>${record.state.duration}</strong> min</span>
            </div>
            <details class="history-details"><summary>View session details</summary><div class="history-detail-content">
              <div><strong>Session date:</strong> ${esc(formatSessionDate(record.state.sessionDate))}</div>
              <div><strong>Match mix:</strong> ${esc(record.state.mix)}</div><div><strong>Rotation:</strong> ${record.state.rotationMin} min</div><div><strong>Confirmed:</strong> ${stats.confirmed}/${stats.matches}</div><div class="history-player-counts"><strong>Player matches:</strong> ${esc(countText)}</div>
            </div></details>
          </div>
        </article>`;
    }).join('');

    $$('.history-restore').forEach(button => button.addEventListener('click', async event => {
      const card = event.target.closest('[data-history-id]');
      const record = records.find(item => String(item.id) === card.dataset.historyId);
      if (!record) return;
      state = { ...defaultState(), ...JSON.parse(JSON.stringify(record.state)) };
      syncSessionInputs();
      saveState();
      renderAll();
      showPanel('matches', true);
      setStatus(`Restored saved session: ${record.name}`);
    }));

    $$('.history-delete').forEach(button => button.addEventListener('click', async event => {
      const card = event.target.closest('[data-history-id]');
      const record = records.find(item => String(item.id) === card.dataset.historyId);
      if (!record) return;
      if (!window.confirm(`Delete saved session "${record.name}"?`)) return;
      try {
        if (historySource === 'cloud') await window.BadmintonCloud.deleteHistorySession(record.id);
        else window.BadmintonStorage?.deleteHistorySession(record.id);
        await renderHistory();
        setStatus(`Deleted saved session: ${record.name}`);
      } catch (error) { setStatus(`Could not delete session: ${error.message}`); }
    }));
  }

  function renderAll() {
    renderMembers();
    renderGroupManager();
    renderSession();
    renderPlayerMatchCounts();
    renderMatches();
    renderAttendance();
    renderHistory();
  }

  function showPanel(panelName, updateHash = false) {
    const validPanels = ['participants', 'groups', 'session', 'matches', 'history'];
    const target = validPanels.includes(panelName) ? panelName : 'participants';

    $$('.tab').forEach(tab => {
      const selected = tab.dataset.tab === target;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', String(selected));
    });

    $$('[data-panel]').forEach(panel => {
      panel.hidden = panel.dataset.panel !== target;
    });

    if (updateHash && window.location.hash !== `#${target}`) {
      history.replaceState(null, '', `#${target}`);
    }
  }

  $$('.tab').forEach(tab => {
    tab.addEventListener('click', event => {
      event.preventDefault();

      if (
        !$('#groups')?.hidden &&
        tab.dataset.tab !== 'groups'
      ) {
        commitVisibleGroupEditor('Group membership saved.');
      }

      showPanel(tab.dataset.tab, true);
    });
  });

  window.addEventListener('hashchange', () => {
    const target = window.location.hash.replace('#', '') || 'participants';

    if (
      !$('#groups')?.hidden &&
      target !== 'groups'
    ) {
      commitVisibleGroupEditor('Group membership saved.');
    }

    showPanel(target);
  });

  $('#add-man').addEventListener('click', () => addMemberForGender('Man'));
  $('#add-woman').addEventListener('click', () => addMemberForGender('Woman'));

  $('#men-member-search').addEventListener('input', renderMembers);
  $('#women-member-search').addEventListener('input', renderMembers);

  $('#create-group').addEventListener('click', () => {
    const input = $('#new-group-name');
    createGroup(input.value);
    input.value = '';
  });

  $('#new-group-name').addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    createGroup(event.currentTarget.value);
    event.currentTarget.value = '';
  });

  $('#session-men-search').addEventListener('input', renderSessionParticipants);
  $('#session-women-search').addEventListener('input', renderSessionParticipants);

  $('#toggle-session-participants').addEventListener('click', () => {
    const body = $('#session-participants-body');
    const button = $('#toggle-session-participants');
    if (!body || !button) return;

    const collapsed = body.classList.toggle('collapsed');
    button.textContent = collapsed ? 'Show participants' : 'Hide participants';
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });

  $('#session-import-group').addEventListener('click', () => {
    importGroupIntoSession($('#session-group-select').value);
  });

  $('#session-add-individual').addEventListener('click', () => {
    const id = $('#session-add-individual-select').value;

    if (!id) {
      setStatus('Choose a person first.');
      return;
    }

    addSessionMember(id);
  });

  $('#toggle-session-advanced').addEventListener('click', () => {
    const body = $('#session-advanced-body');
    const button = $('#toggle-session-advanced');
    const indicator = $('#session-advanced-indicator');
    if (!body || !button) return;

    const opening = body.hidden;
    body.hidden = !opening;
    button.setAttribute('aria-expanded', opening ? 'true' : 'false');

    if (indicator) {
      indicator.textContent = opening ? '−' : '+';
    }
  });

  $('#session-clear-participants').addEventListener('click', () => {
    const participants = getSessionMembers();

    if (!participants.length) {
      setStatus('This session already has no participants.');
      return;
    }

    const hasPlaying = state.matches.some(match => match.playing && !match.completed);
    const confirmed = window.confirm(
      hasPlaying
        ? 'Clear all participants? Playing and uncompleted matches will be removed. Completed matches will be kept.'
        : 'Clear all participants? Uncompleted matches will be removed. Completed matches will be kept.'
    );

    if (!confirmed) return;

    participants.forEach(member => {
      member.present = false;
    });

    state.sessionMemberIds = [];
    state.sessionGroupIds = [];
    state.sessionIndividualMemberIds = [];
    state.sessionManualMemberIds = [];
    state.sessionExcludedMemberIds = [];
    state.sessionParticipantTypes = {};
    state.matches = state.matches.filter(match => match.completed);

    saveState('All participants removed from the current session.');
    renderAll();
  });

  $('#cloud-keep-local').addEventListener('click', async () => {
    try {
      const localSnapshot = snapshotState();

      window.BadmintonStorage?.saveBackup(
        localSnapshot,
        'Local copy chosen during cloud conflict'
      );

      await window.BadmintonCloud.saveCurrentState(localSnapshot);
      hideCloudConflict();

      setStatus('Local participant/group data uploaded to the shared workspace.');
      setCloudUiStatus('synced', 'Local copy is now the shared cloud copy.');
    } catch (error) {
      setStatus(`Could not upload local copy: ${error.message}`);
      setCloudUiStatus('error', error.message);
    }
  });

  $('#cloud-use-remote').addEventListener('click', () => {
    if (!pendingCloudConflictState) return;

    const remote = JSON.parse(JSON.stringify(pendingCloudConflictState));
    const workspace = pendingCloudConflictWorkspace;

    const applied = applyIncomingState(remote, {
      workspace,
      force: true,
      sourceLabel: 'cloud copy selected manually'
    });

    if (applied) {
      setStatus('Cloud copy selected. The previous local copy was saved as a local backup.');
      setCloudUiStatus('synced', 'Cloud copy selected.');
    }
  });

  $('#cloud-signin').addEventListener('click', async () => {
    const email = $('#cloud-email').value.trim();
    if (!email) { setStatus('Enter a coordinator email address first.'); return; }
    try {
      await window.BadmintonCloud.signInWithEmail(email);
      setStatus('Sign-in link sent. Open the email, then return to this website.');
    } catch (error) { setStatus(`Sign-in failed: ${error.message}`); }
  });

  $('#cloud-signout').addEventListener('click', async () => {
    try {
      await window.BadmintonCloud.signOut();
      historySource = 'local';
      await renderCloudUi();
      await renderHistory();
      setStatus('Signed out. Local cache remains on this device.');
    } catch (error) { setStatus(`Sign-out failed: ${error.message}`); }
  });

  $('#cloud-open-workspace').addEventListener('click', async () => {
    const id = $('#cloud-workspace-select').value;
    if (!id) { setStatus('Choose a workspace first.'); return; }
    try {
      const workspace = await window.BadmintonCloud.openWorkspace(id);
      await activateCloudWorkspace(workspace, { loadState: true });
      await renderCloudUi();
    } catch (error) { setStatus(`Could not open workspace: ${error.message}`); }
  });

  $('#cloud-create-workspace').addEventListener('click', async () => {
    const name = $('#cloud-new-workspace-name').value.trim() || 'Badminton Workspace';
    try {
      const workspace = await window.BadmintonCloud.createWorkspace(name);
      await activateCloudWorkspace(workspace, { loadState: false });
      await window.BadmintonCloud.saveCurrentState(snapshotState());
      await renderCloudUi();
      setStatus(`Workspace created: ${workspace.name}. Share join code ${workspace.join_code} with coordinators.`);
    } catch (error) { setStatus(`Could not create workspace: ${error.message}`); }
  });

  $('#cloud-join-workspace').addEventListener('click', async () => {
    const code = $('#cloud-join-code').value.trim();
    if (!code) { setStatus('Enter a workspace join code first.'); return; }
    try {
      const workspace = await window.BadmintonCloud.joinWorkspace(code);
      await activateCloudWorkspace(workspace, { loadState: true });
      await renderCloudUi();
      setStatus(`Joined shared workspace: ${workspace.name}`);
    } catch (error) { setStatus(`Could not join workspace: ${error.message}`); }
  });

  $('#cloud-switch-workspace').addEventListener('click', async () => {
    await window.BadmintonCloud.leaveActiveWorkspaceView();
    historySource = 'local';
    showCloudElement('cloud-active-workspace', false);
    showCloudElement('cloud-workspace-picker', true);
    await refreshCloudWorkspaceList();
    await renderCloudUi();
    await renderHistory();
  });

  $('#cloud-push-current').addEventListener('click', async () => {
    try {
      await window.BadmintonCloud.saveCurrentState(snapshotState());
      setStatus('Current session synced to shared workspace.');
    } catch (error) { setStatus(`Sync failed: ${error.message}`); }
  });

  window.addEventListener('badminton-cloud-auth-change', async () => {
    const user = window.BadmintonCloud.getUser();
    if (user) {
      const remembered = await window.BadmintonCloud.restoreRememberedWorkspace();
      if (remembered) await activateCloudWorkspace(remembered, { loadState: true });
    } else {
      historySource = 'local';
    }
    await renderCloudUi();
    await renderHistory();
  });

  $('#generate').addEventListener('click', generateMatches);

  $('#save-session').addEventListener('click', saveSessionToHistory);
  $('#save-session-matches').addEventListener('click', saveSessionToHistory);

  $('#export-excel').addEventListener('click', exportMatchesToExcel);

  $('#unconfirm-all').addEventListener('click', () => {
    state.matches.forEach(match => {
      if (!match.playing && !match.completed) match.confirmed = false;
    });
    saveState('All unstarted matches unconfirmed and saved.');
    renderAll();
  });

  $('#confirm-all').addEventListener('click', () => {
    state.matches.forEach(m => m.confirmed = true);
    saveState('All matches confirmed and saved.');
    renderAll();
  });

  $('#hide-completed').addEventListener('change', () => {
    renderMatches();
  });

  $('#clear-completed').addEventListener('click', () => {
    const confirmed = window.confirm(
      'Reset all Playing/Completed progress? Player played counts will return to zero.'
    );
    if (!confirmed) return;

    state.matches.forEach(match => {
      match.playing = false;
      match.startedAt = null;
      match.completed = false;
      match.completedAt = null;
    });

    saveState('Match progress reset. Played counts returned to zero.');
    renderAll();
  });

  $('#clear-attendance').addEventListener('click', () => {
    const playingIds = getPlayingPlayerIds();

    getSessionMembers().forEach(member => {
      if (!playingIds.has(member.id)) {
        member.present = false;
      }
    });

    saveState(
      playingIds.size
        ? 'Attendance cleared for waiting players. Players currently playing were kept present.'
        : 'Attendance cleared and saved.'
    );
    renderAll();
  });

  $('#all-present').addEventListener('click', () => {
    getSessionMembers().forEach(m => m.present = true);
    saveState('Attendance saved.');
    renderAll();
  });

  $('#clear-history').addEventListener('click', async () => {
    try {
      let count = 0;
      if (cloudReady && window.BadmintonCloud?.getActiveWorkspace()) count = (await window.BadmintonCloud.loadHistory()).length;
      else count = window.BadmintonStorage?.loadHistory()?.records?.length || 0;
      if (!count) { setStatus('Session history is already empty.'); return; }
      if (!window.confirm(`Delete all ${count} saved session${count === 1 ? '' : 's'} from history?`)) return;
      if (cloudReady && window.BadmintonCloud?.getActiveWorkspace()) await window.BadmintonCloud.clearHistory();
      else window.BadmintonStorage?.clearHistory();
      await renderHistory();
      setStatus('Session history cleared.');
    } catch (error) { setStatus(`Could not clear history: ${error.message}`); }
  });

  $('#reset-saved').addEventListener('click', () => {
    const confirmed = window.confirm(
      'Reset the current working session? Saved Session History will be kept.'
    );

    if (!confirmed) return;

    window.BadmintonStorage?.clear();
    state = defaultState();
    syncSessionInputs();
    saveState();
    renderAll();
    setStatus(
      cloudReady && window.BadmintonCloud?.getActiveWorkspace()
        ? 'Shared current session reset to defaults. Saved history was kept.'
        : 'Current local session reset to defaults. Saved history was kept.'
    );
  });

  $('#session-name').addEventListener('change', () => {
    state.sessionName = $('#session-name').value.trim().slice(0, 80);
    saveState('Session name saved.');
  });

  $('#session-date').addEventListener('change', () => {
    state.sessionDate = $('#session-date').value || localDateValue();
    $('#session-date').value = state.sessionDate;
    saveState('Session date saved.');
  });

  ['courts','duration','rotation-min','mix'].forEach(id => {
    $('#' + id).addEventListener('change', () => {
      state.courts = Math.max(1, Number($('#courts').value) || 3);
      state.duration = Math.max(30, Number($('#duration').value) || 180);
      state.rotationMin = Math.max(10, Number($('#rotation-min').value) || 18);
      state.mix = $('#mix').value;

      saveState('Session settings saved.');
      renderSession();
    });
  });

  const restored = loadSavedState();
  syncSessionInputs();
  renderAll();
  showPanel(window.location.hash.replace('#', '') || 'participants');

  if (restored) {
    setStatus('Local session cache restored. Cloud will replace it when a shared workspace is opened.');
  } else {
    saveState();
    setStatus('Default member list loaded. Generate a schedule only when you explicitly press Generate / Reshuffle.');
  }

  initializeCloud();
})();
