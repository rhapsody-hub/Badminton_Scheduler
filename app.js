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
    present: false
  }));

  const score = {'A+':6,'A':5,'B+':4.5,'B':4,'C':3,'D':2,'?':3.5};
  const tierClass = {'A+':'tier-ap','A':'tier-a','B+':'tier-bp','B':'tier-b','C':'tier-c','D':'tier-d','?':'tier-q'};

  const defaultState = () => ({
    members: defaultMembers.map(m => ({ ...m })),
    matches: [],
    sessionName: '',
    courts: 3,
    duration: 180,
    rotationMin: 18,
    mix: 'less-mixed'
  });

  let state = defaultState();
  let cloudReady = false;
  let applyingRemoteState = false;
  let cloudSaveTimer = null;
  let historySource = 'local';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
  }[c]));

  const memberById = (id) => state.members.find(m => m.id === Number(id));
  const memberName = (id) => memberById(id)?.name || '—';

  function setStatus(text) {
    $('#status').textContent = text || '';
  }

  function snapshotState() {
    return {
      members: state.members.map(m => ({ ...m })),
      matches: state.matches.map(m => ({
        ...m,
        players: [...m.players]
      })),
      sessionName: state.sessionName || '',
      courts: state.courts,
      duration: state.duration,
      rotationMin: state.rotationMin,
      mix: state.mix
    };
  }

  function saveState(message = '') {
    const snapshot = snapshotState();
    const ok = window.BadmintonStorage?.save(snapshot);

    if (!applyingRemoteState && cloudReady && window.BadmintonCloud?.getActiveWorkspace()) {
      clearTimeout(cloudSaveTimer);
      cloudSaveTimer = setTimeout(async () => {
        try {
          await window.BadmintonCloud.saveCurrentState(snapshotState());
        } catch (error) {
          setCloudUiStatus('error', error.message);
        }
      }, 350);
    }

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
    const labels = { offline: 'Local only', signedout: 'Sign in required', workspace: 'Choose workspace', saving: 'Saving…', loading: 'Loading…', synced: 'Synced', 'remote-update': 'Updated by coordinator', error: 'Sync error' };
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
        applyingRemoteState = true;
        state = { ...defaultState(), ...JSON.parse(JSON.stringify(remoteState)) };
        applyingRemoteState = false;
        syncSessionInputs();
        window.BadmintonStorage?.save(snapshotState());
        renderAll();
        setStatus(`Shared workspace loaded: ${workspace.name}`);
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
      applyingRemoteState = true;
      state = { ...defaultState(), ...JSON.parse(JSON.stringify(remoteState)) };
      applyingRemoteState = false;
      syncSessionInputs();
      window.BadmintonStorage?.save(snapshotState());
      renderAll();
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

  function generateMatches() {
    state.courts = Math.max(1, Math.min(12, Number($('#courts').value) || 3));
    state.duration = Math.max(30, Math.min(720, Number($('#duration').value) || 180));
    state.rotationMin = Math.max(10, Math.min(60, Number($('#rotation-min').value) || 18));
    state.mix = $('#mix').value;

    const rounds = Math.max(1, Math.floor(state.duration / state.rotationMin));
    const slotsPerRound = state.courts * 4;

    if (state.members.length < 4) {
      setStatus('Add at least 4 members first.');
      return;
    }

    const plays = new Map(state.members.map(m => [m.id, 0]));
    const last = new Map(state.members.map(m => [m.id, -99]));
    const partnerCount = new Map();
    const opponentCount = new Map();
    const matches = [];

    const pairKey = (a, b) => [a, b].sort((x,y) => x-y).join('-');

    for (let round = 1; round <= rounds; round++) {
      const tieMap = randomTieMap(state.members);

      // Participation count remains the strongest priority.
      // Waiting time is second. Randomness only breaks otherwise-similar choices.
      let candidates = [...state.members]
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
        .slice(0, Math.min(slotsPerRound, state.members.length));

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

    state.matches = matches;
    saveState();
    renderAll();

    const counts = [...plays.values()];
    const minMatches = Math.min(...counts);
    const maxMatches = Math.max(...counts);

    setStatus(
      `Reshuffled ${matches.length} matches. Player participation range: ${minMatches}–${maxMatches} matches.`
    );
  }

  function renderMembers() {
    $('#member-list').innerHTML = state.members.map(m => `
      <div class="card member-row" data-member="${m.id}">
        <label>
          Name
          <input class="input member-name" value="${esc(m.name)}" />
        </label>

        <label>
          Gender
          <select class="input member-gender">
            <option ${m.gender === 'Man' ? 'selected' : ''}>Man</option>
            <option ${m.gender === 'Woman' ? 'selected' : ''}>Woman</option>
          </select>
        </label>

        <label>
          Tier
          <select class="input member-tier">
            ${['A+','A','B+','B','C','D','?']
              .map(t => `<option ${m.tier === t ? 'selected' : ''}>${t}</option>`)
              .join('')}
          </select>
        </label>

        <button class="btn remove-member" type="button">Remove</button>
      </div>
    `).join('');

    $$('.member-name').forEach(el => el.addEventListener('change', e => {
      const card = e.target.closest('[data-member]');
      memberById(card.dataset.member).name = e.target.value.trim() || 'Unnamed';
      saveState('Member saved.');
      renderAll();
    }));

    $$('.member-gender').forEach(el => el.addEventListener('change', e => {
      memberById(e.target.closest('[data-member]').dataset.member).gender = e.target.value;
      saveState('Member saved.');
      renderAll();
    }));

    $$('.member-tier').forEach(el => el.addEventListener('change', e => {
      memberById(e.target.closest('[data-member]').dataset.member).tier = e.target.value;
      saveState('Member saved.');
      renderAll();
    }));

    $$('.remove-member').forEach(el => el.addEventListener('click', e => {
      const id = Number(e.target.closest('[data-member]').dataset.member);
      state.members = state.members.filter(m => m.id !== id);
      state.matches = state.matches.filter(x => !x.players.includes(id));
      saveState('Member removed and session saved.');
      renderAll();
    }));
  }

  function playerOptions(selected) {
    return state.members.map(m =>
      `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${esc(m.name)} (${esc(m.tier)})</option>`
    ).join('');
  }

  function playerNameOptions(selected) {
    return state.members.map(m =>
      `<option value="${m.id}" ${m.id === selected ? 'selected' : ''}>${esc(m.name)}</option>`
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

    const playerRows = [...state.members]
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

    const rows = state.members
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
    const rounds = Math.max(1, Math.floor(state.duration / state.rotationMin));
    const slots = state.matches.length * 4;
    const avg = state.members.length ? slots / state.members.length : 0;

    const cards = [
      ['Members', state.members.length],
      ['Rotations', rounds],
      ['Planned matches', state.matches.length || rounds * state.courts],
      ['Avg. matches/player', avg ? avg.toFixed(1) : '—']
    ];

    $('#session-summary').innerHTML = cards.map(([label,value]) => `
      <div class="summary-card">
        <div class="label">${label}</div>
        <div class="value">${value}</div>
      </div>
    `).join('');
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

    attendanceList.innerHTML = [...state.members]
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
    const now = new Date();
    const datePart = now.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
    const timePart = now.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit'
    });
    return `Session ${datePart} ${timePart}`;
  }

  async function saveSessionToHistory() {
    state.sessionName = $('#session-name').value.trim().slice(0, 80);
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

    return {
      players: members.length,
      matches: matches.length,
      completed: matches.filter(match => match.completed).length,
      confirmed: matches.filter(match => match.confirmed).length,
      present: members.filter(member => member.present).length
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
      const playerCounts = new Map(record.state.members.map(member => [member.id, 0]));
      record.state.matches.forEach(match => match.players.forEach(id => {
        if (playerCounts.has(id)) playerCounts.set(id, playerCounts.get(id) + 1);
      }));
      const countText = record.state.members.map(member => `${esc(member.name)} ${playerCounts.get(member.id) || 0}`).join(' · ');
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
    renderSession();
    renderPlayerMatchCounts();
    renderMatches();
    renderAttendance();
    renderHistory();
  }

  function showPanel(panelName, updateHash = false) {
    const validPanels = ['members', 'session', 'matches', 'history'];
    const target = validPanels.includes(panelName) ? panelName : 'members';

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
      showPanel(tab.dataset.tab, true);
    });
  });

  window.addEventListener('hashchange', () => {
    showPanel(window.location.hash.replace('#', '') || 'members');
  });

  $('#add-member').addEventListener('click', () => {
    const id = Math.max(0, ...state.members.map(m => m.id)) + 1;

    state.members.push({
      id,
      name: `Member ${id}`,
      gender: 'Man',
      tier: '?',
      present: false
    });

    saveState('New member added and saved.');
    renderAll();
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

    state.members.forEach(member => {
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
    state.members.forEach(m => m.present = true);
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
  showPanel(window.location.hash.replace('#', '') || 'members');

  if (restored) {
    setStatus('Local session cache restored. Cloud will replace it when a shared workspace is opened.');
  } else {
    saveState();
    setStatus('Default member list loaded. Generate a schedule only when you explicitly press Generate / Reshuffle.');
  }

  initializeCloud();
})();
