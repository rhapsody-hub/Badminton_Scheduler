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
    $('#session-name').value = state.sessionName || '';
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
          completed: false
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

    const counts = new Map(state.members.map(member => [member.id, 0]));
    state.matches.forEach(match => {
      match.players.forEach(id => {
        if (counts.has(id)) counts.set(id, counts.get(id) + 1);
      });
    });

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
            <td>${match.completed ? 'Yes' : 'No'}</td>
          </tr>
        `;
      }).join('');

    const playerRows = [...state.members]
      .sort((a, b) =>
        (counts.get(b.id) || 0) - (counts.get(a.id) || 0) ||
        a.name.localeCompare(b.name)
      )
      .map(member => `
        <tr>
          <td style="background:${excelTierColor(member.tier)}">${excelEscape(member.name)}</td>
          <td>${excelEscape(member.gender)}</td>
          <td>${excelEscape(member.tier)}</td>
          <td>${counts.get(member.id) || 0}</td>
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
            <th>Match Count</th>
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
            <th>Completed</th>
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

    const counts = new Map(state.members.map(member => [member.id, 0]));

    state.matches.forEach(match => {
      match.players.forEach(playerId => {
        if (counts.has(playerId)) {
          counts.set(playerId, counts.get(playerId) + 1);
        }
      });
    });

    const rows = state.members
      .map(member => ({
        ...member,
        matchCount: counts.get(member.id) || 0
      }))
      .sort((a, b) =>
        b.matchCount - a.matchCount ||
        a.name.localeCompare(b.name)
      );

    if (!rows.length) {
      container.innerHTML = '<span class="match-count-empty">No players.</span>';
      return;
    }

    container.innerHTML = rows.map(member => `
      <div
        class="match-count-chip ${tierClass[member.tier] || 'tier-q'}"
        title="${esc(member.name)}: ${member.matchCount} scheduled match${member.matchCount === 1 ? '' : 'es'}"
      >
        <span class="match-count-name">${esc(member.name)}</span>
        <span class="match-count-number">${member.matchCount}</span>
      </div>
    `).join('');
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

  function saveSessionToHistory() {
    state.sessionName = $('#session-name').value.trim().slice(0, 80);

    const name = state.sessionName || defaultHistoryName();
    const record = window.BadmintonStorage?.saveHistorySession(name, snapshotState());

    if (!record) {
      setStatus('Could not save session history in this browser.');
      return;
    }

    if (!state.sessionName) {
      state.sessionName = name;
      $('#session-name').value = name;
      saveState();
    }

    renderHistory();
    setStatus(`Session saved to history: ${name}`);
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

  function renderHistory() {
    const list = $('#history-list');
    const summary = $('#history-summary');
    if (!list || !summary) return;

    const result = window.BadmintonStorage?.loadHistory();
    const records = result?.records || [];

    const totalMatches = records.reduce(
      (sum, record) => sum + (record.state.matches?.length || 0),
      0
    );
    const totalCompleted = records.reduce(
      (sum, record) =>
        sum + (record.state.matches || []).filter(match => match.completed).length,
      0
    );

    summary.innerHTML = `
      <div class="history-kpi">
        <span class="history-kpi-value">${records.length}</span>
        <span class="history-kpi-label">Saved sessions</span>
      </div>
      <div class="history-kpi">
        <span class="history-kpi-value">${totalMatches}</span>
        <span class="history-kpi-label">Saved matches</span>
      </div>
      <div class="history-kpi">
        <span class="history-kpi-value">${totalCompleted}</span>
        <span class="history-kpi-label">Completed matches</span>
      </div>
    `;

    if (!records.length) {
      list.innerHTML = `
        <div class="history-empty">
          No saved sessions yet. Use <strong>Save Session</strong> from Session or Matches.
        </div>
      `;
      return;
    }

    list.innerHTML = records.map(record => {
      const stats = historyRecordStats(record);

      const playerCounts = new Map(record.state.members.map(member => [member.id, 0]));
      record.state.matches.forEach(match => {
        match.players.forEach(id => {
          if (playerCounts.has(id)) {
            playerCounts.set(id, playerCounts.get(id) + 1);
          }
        });
      });

      const countText = record.state.members
        .map(member => `${esc(member.name)} ${playerCounts.get(member.id) || 0}`)
        .join(' · ');

      return `
        <article class="history-card" data-history-id="${esc(record.id)}">
          <div class="history-card-main">
            <div class="history-title-row">
              <div>
                <h3>${esc(record.name)}</h3>
                <div class="history-date">${esc(formatHistoryDate(record.savedAt))}</div>
              </div>

              <div class="history-actions">
                <button class="btn history-restore" type="button">Restore</button>
                <button class="btn danger history-delete" type="button">Delete</button>
              </div>
            </div>

            <div class="history-meta-grid">
              <span><strong>${stats.players}</strong> players</span>
              <span><strong>${stats.matches}</strong> matches</span>
              <span><strong>${stats.completed}</strong> completed</span>
              <span><strong>${stats.present}</strong> attended</span>
              <span><strong>${record.state.courts}</strong> courts</span>
              <span><strong>${record.state.duration}</strong> min</span>
            </div>

            <details class="history-details">
              <summary>View session details</summary>
              <div class="history-detail-content">
                <div><strong>Match mix:</strong> ${esc(record.state.mix)}</div>
                <div><strong>Rotation:</strong> ${record.state.rotationMin} min</div>
                <div><strong>Confirmed:</strong> ${stats.confirmed}/${stats.matches}</div>
                <div class="history-player-counts"><strong>Player matches:</strong> ${esc(countText)}</div>
              </div>
            </details>
          </div>
        </article>
      `;
    }).join('');

    $$('.history-restore').forEach(button => {
      button.addEventListener('click', event => {
        const card = event.target.closest('[data-history-id]');
        const record = records.find(item => item.id === card.dataset.historyId);
        if (!record) return;

        state = {
          ...defaultState(),
          ...JSON.parse(JSON.stringify(record.state))
        };

        syncSessionInputs();
        saveState();
        renderAll();
        showPanel('matches', true);
        setStatus(`Restored saved session: ${record.name}`);
      });
    });

    $$('.history-delete').forEach(button => {
      button.addEventListener('click', event => {
        const card = event.target.closest('[data-history-id]');
        const record = records.find(item => item.id === card.dataset.historyId);
        if (!record) return;

        const confirmed = window.confirm(`Delete saved session "${record.name}"?`);
        if (!confirmed) return;

        window.BadmintonStorage?.deleteHistorySession(record.id);
        renderHistory();
        setStatus(`Deleted saved session: ${record.name}`);
      });
    });
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
    const validPanels = ['members', 'session', 'matches', 'attendance', 'history'];
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

  $('#save-session').addEventListener('click', saveSessionToHistory);
  $('#save-session-matches').addEventListener('click', saveSessionToHistory);

  $('#export-excel').addEventListener('click', exportMatchesToExcel);

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

  $('#clear-attendance').addEventListener('click', () => {
    state.members.forEach(m => m.present = false);
    saveState('Attendance cleared and saved.');
    renderAttendance();
  });

  $('#all-present').addEventListener('click', () => {
    state.members.forEach(m => m.present = true);
    saveState('Attendance saved.');
    renderAttendance();
  });

  $('#clear-history').addEventListener('click', () => {
    const result = window.BadmintonStorage?.loadHistory();
    const count = result?.records?.length || 0;

    if (!count) {
      setStatus('Session history is already empty.');
      return;
    }

    const confirmed = window.confirm(
      `Delete all ${count} saved session${count === 1 ? '' : 's'} from history?`
    );
    if (!confirmed) return;

    window.BadmintonStorage?.clearHistory();
    renderHistory();
    setStatus('Session history cleared.');
  });

  $('#reset-saved').addEventListener('click', () => {
    const confirmed = window.confirm(
      'Reset the current working session? Saved Session History will be kept.'
    );

    if (!confirmed) return;

    window.BadmintonStorage?.clear();
    state = defaultState();
    syncSessionInputs();
    renderAll();
    setStatus('Saved data reset to defaults.');
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
    setStatus('Saved session restored from this browser.');
  } else {
    generateMatches();
    setStatus('Default member list restored and saved.');
  }
})();
