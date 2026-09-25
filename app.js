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
    courts: 3,
    duration: 180,
    rotationMin: 18,
    mix: 'less-mixed'
  });

  let state = defaultState();

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
      courts: state.courts,
      duration: state.duration,
      rotationMin: state.rotationMin,
      mix: state.mix
    };
  }

  function saveState(message = '') {
    const ok = window.BadmintonStorage?.save(snapshotState());
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
    $('#courts').value = state.courts;
    $('#duration').value = state.duration;
    $('#rotation-min').value = state.rotationMin;
    $('#mix').value = state.mix;
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

  function pairBalanced(group) {
    const g = [...group].sort((a,b) => score[b.tier] - score[a.tier]);
    const men = g.filter(x => x.gender === 'Man');
    const women = g.filter(x => x.gender === 'Woman');

    if (men.length === 2 && women.length === 2) {
      return [men[0], women[1], men[1], women[0]];
    }

    return [g[0], g[3], g[1], g[2]];
  }

  function chooseCourtGroup(pool, prefer) {
    const byGender = {
      Man: pool.filter(x => x.gender === 'Man'),
      Woman: pool.filter(x => x.gender === 'Woman')
    };

    if (prefer === 'women' && byGender.Woman.length >= 4) {
      return byGender.Woman.slice(0,4);
    }

    if (prefer === 'mixed' && byGender.Woman.length >= 2 && byGender.Man.length >= 2) {
      return [byGender.Man[0], byGender.Man[1], byGender.Woman[0], byGender.Woman[1]];
    }

    if (prefer === 'men' && byGender.Man.length >= 4) {
      return byGender.Man.slice(0,4);
    }

    if (byGender.Man.length >= 4) return byGender.Man.slice(0,4);
    if (byGender.Woman.length >= 4) return byGender.Woman.slice(0,4);

    if (byGender.Woman.length >= 2 && byGender.Man.length >= 2) {
      return [byGender.Man[0], byGender.Man[1], byGender.Woman[0], byGender.Woman[1]];
    }

    return pool.slice(0,4);
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
    const matches = [];

    for (let round = 1; round <= rounds; round++) {
      let candidates = [...state.members]
        .sort((a,b) => {
          const pa = plays.get(a.id);
          const pb = plays.get(b.id);
          if (pa !== pb) return pa - pb;

          const wa = round - last.get(a.id);
          const wb = round - last.get(b.id);
          if (wa !== wb) return wb - wa;

          return score[b.tier] - score[a.tier];
        })
        .slice(0, Math.min(slotsPerRound, state.members.length));

      candidates.sort((a,b) => score[b.tier] - score[a.tier]);

      for (let court = 1; court <= state.courts; court++) {
        if (candidates.length < 4) break;

        let pref = 'men';

        if (state.mix === 'more-mixed') {
          pref = 'mixed';
        } else if (state.mix === 'less-mixed') {
          pref = (court === 1 && round % 3 !== 1) ? 'women' : 'men';
        } else {
          pref = (court + round) % 3 === 0
            ? 'mixed'
            : ((court + round) % 3 === 1 ? 'women' : 'men');
        }

        const group = chooseCourtGroup(candidates, pref);

        group.forEach(x => {
          const idx = candidates.findIndex(y => y.id === x.id);
          if (idx >= 0) candidates.splice(idx, 1);
        });

        const paired = pairBalanced(group);
        if (paired.length < 4) continue;

        const ids = paired.map(x => x.id);

        ids.forEach(id => {
          plays.set(id, plays.get(id) + 1);
          last.set(id, round);
        });

        matches.push({
          id: `${Date.now()}-${round}-${court}-${matches.length}`,
          round,
          court,
          start: (round - 1) * state.rotationMin,
          end: round * state.rotationMin,
          players: ids,
          confirmed: true,
          completed: false
        });
      }
    }

    state.matches = matches;
    saveState();
    renderAll();
    setStatus(`Generated and saved ${matches.length} matches across ${rounds} rotations.`);
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


  function renderMatches() {
    const head = $('#match-grid-head');
    const body = $('#match-grid-body');
    const hideCompleted = Boolean($('#hide-completed')?.checked);

    const courtCount = Math.max(
      state.courts || 1,
      ...state.matches.map(m => Number(m.court) || 1)
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
      const allCompleted = matches.length > 0 && matches.every(m => m.completed);
      if (hideCompleted && allCompleted) continue;

      const first = matches[0];
      const byCourt = new Map(matches.map(m => [Number(m.court), m]));

      const courtCells = Array.from({ length: courtCount }, (_, index) => {
        const courtNo = index + 1;
        const m = byCourt.get(courtNo);

        if (!m || (hideCompleted && m.completed)) {
          return `
            <td class="court-grid-cell">
              <div class="empty-court">${m?.completed ? 'Completed' : 'No match'}</div>
            </td>
          `;
        }

        const type = matchType(m.players);
        const duplicate = new Set(m.players).size < 4;
        const skillLabel = matchSkillLabel(m);

        return `
          <td
            class="court-grid-cell
              ${m.completed ? 'done' : ''}
              ${!m.confirmed ? 'unconfirmed' : ''}
              ${duplicate ? 'duplicate' : ''}"
            data-match="${esc(m.id)}"
          >
            <div class="court-cell-head">
              <div class="court-name-line">
                <span class="court-no">${courtNo}</span>
                <span class="court-type">${type}</span>
              </div>

              <div class="court-flags">
                <label class="court-flag" title="Confirmed">
                  <input class="confirm-match" type="checkbox" ${m.confirmed ? 'checked' : ''} />
                  C
                </label>
                <label class="court-flag" title="Completed">
                  <input class="complete-match" type="checkbox" ${m.completed ? 'checked' : ''} />
                  D
                </label>
              </div>
            </div>

            <div class="court-teams-grid">
              <div class="court-team">
                <select
                  class="grid-player player-select ${selectedTierClass(m.players[0])}"
                  data-slot="0"
                  aria-label="Court ${courtNo}, Team 1 player 1"
                >${playerNameOptions(m.players[0])}</select>

                <select
                  class="grid-player player-select ${selectedTierClass(m.players[1])}"
                  data-slot="1"
                  aria-label="Court ${courtNo}, Team 1 player 2"
                >${playerNameOptions(m.players[1])}</select>
              </div>

              <div class="court-vs">VS</div>

              <div class="court-team">
                <select
                  class="grid-player player-select ${selectedTierClass(m.players[2])}"
                  data-slot="2"
                  aria-label="Court ${courtNo}, Team 2 player 1"
                >${playerNameOptions(m.players[2])}</select>

                <select
                  class="grid-player player-select ${selectedTierClass(m.players[3])}"
                  data-slot="3"
                  aria-label="Court ${courtNo}, Team 2 player 2"
                >${playerNameOptions(m.players[3])}</select>
              </div>
            </div>

            <div class="court-foot">
              <span>${skillLabel}</span>
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

    $$('.player-select').forEach(el => el.addEventListener('change', e => {
      const cell = e.target.closest('[data-match]');
      const match = state.matches.find(x => x.id === cell.dataset.match);

      match.players[Number(e.target.dataset.slot)] = Number(e.target.value);
      saveState('Edited match saved.');
      renderAll();
    }));

    $$('.confirm-match').forEach(el => el.addEventListener('change', e => {
      const cell = e.target.closest('[data-match]');
      state.matches.find(x => x.id === cell.dataset.match).confirmed = e.target.checked;
      saveState('Match confirmation saved.');
      renderAll();
    }));

    $$('.complete-match').forEach(el => el.addEventListener('change', e => {
      const cell = e.target.closest('[data-match]');
      state.matches.find(x => x.id === cell.dataset.match).completed = e.target.checked;
      saveState('Match status saved.');
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
    $('#attendance-list').innerHTML = state.members.map(m => `
      <label class="attendance-row">
        <span class="attendance-name pill ${tierClass[m.tier] || 'tier-q'}">
          ${esc(m.name)}
        </span>

        <input
          class="attend-toggle"
          data-id="${m.id}"
          type="checkbox"
          ${m.present ? 'checked' : ''}
        />
      </label>
    `).join('');

    $$('.attend-toggle').forEach(el => el.addEventListener('change', e => {
      memberById(e.target.dataset.id).present = e.target.checked;
      saveState();
      renderAttendance();
    }));

    const confirmed = state.matches.filter(m => m.confirmed && !m.completed);
    const available = confirmed.filter(m => m.players.every(id => memberById(id)?.present));
    const waiting = confirmed.filter(m => !m.players.every(id => memberById(id)?.present));
    const completed = state.matches.filter(m => m.completed).length;

    $('#live-summary').innerHTML = [
      [available.length, 'Available'],
      [waiting.length, 'Waiting'],
      [completed, 'Completed']
    ].map(([value,label]) => `
      <div class="summary-card">
        <div class="value">${value}</div>
        <div class="label">${label}</div>
      </div>
    `).join('');

    const availableCard = (m) => `
      <div class="match-card ready">
        <div class="match-top">
          <div>
            <strong>R${m.round} · Court ${m.court} · ${matchType(m.players)}</strong>
            <div class="player-chips">${m.players.map(playerChip).join('')}</div>
          </div>

          <button class="btn primary mark-done" data-id="${esc(m.id)}" type="button">
            Mark complete
          </button>
        </div>
      </div>
    `;

    $('#available-matches').innerHTML = available.length
      ? available.map(availableCard).join('')
      : '<div class="card">No confirmed match is fully present yet.</div>';

    $('#waiting-matches').innerHTML = waiting.length
      ? waiting.map(m => {
          const missing = m.players
            .filter(id => !memberById(id)?.present)
            .map(memberName)
            .join(', ');

          return `
            <div class="match-card waiting">
              <strong>R${m.round} · Court ${m.court} · ${matchType(m.players)}</strong>
              <div class="match-meta">Waiting for: ${esc(missing)}</div>
              <div class="player-chips">${m.players.map(playerChip).join('')}</div>
            </div>
          `;
        }).join('')
      : '<div class="card">No waiting matches.</div>';

    $$('.mark-done').forEach(el => el.addEventListener('click', e => {
      const match = state.matches.find(x => x.id === e.target.dataset.id);

      if (match) {
        match.completed = true;
        saveState('Match completed and saved.');
      }

      renderAll();
    }));
  }

  function renderAll() {
    renderMembers();
    renderSession();
    renderMatches();
    renderAttendance();
  }

  function showPanel(panelName, updateHash = false) {
    const validPanels = ['members', 'session', 'matches', 'attendance'];
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

  $('#generate').addEventListener('click', generateMatches);

  $('#unconfirm-all').addEventListener('click', () => {
    state.matches.forEach(m => m.confirmed = false);
    saveState('All matches unconfirmed and saved.');
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
    state.matches.forEach(m => m.completed = false);
    saveState('Completed flags cleared and saved.');
    renderAll();
  });

  $('#all-present').addEventListener('click', () => {
    state.members.forEach(m => m.present = true);
    saveState('Attendance saved.');
    renderAttendance();
  });

  $('#reset-saved').addEventListener('click', () => {
    const confirmed = window.confirm(
      'Reset all saved members, matches, attendance, and session settings in this browser?'
    );

    if (!confirmed) return;

    window.BadmintonStorage?.clear();
    state = defaultState();
    syncSessionInputs();
    renderAll();
    setStatus('Saved data reset to defaults.');
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
    setStatus('Saved session restored from this browser.');
  } else {
    generateMatches();
    setStatus('Default member list restored and saved.');
  }
})();
