(() => {
  const STORAGE_KEY = 'badmintonSessionManagerState';
  const STORAGE_VERSION = 1;

  function isAvailable() {
    try {
      const testKey = '__bsm_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return true;
    } catch (error) {
      return false;
    }
  }

  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object') return null;

    const members = Array.isArray(raw.members)
      ? raw.members
          .filter(m => m && Number.isFinite(Number(m.id)))
          .map(m => ({
            id: Number(m.id),
            name: String(m.name || 'Unnamed'),
            gender: m.gender === 'Woman' ? 'Woman' : 'Man',
            tier: ['A+','A','B+','B','C','D','?'].includes(m.tier) ? m.tier : '?',
            present: Boolean(m.present)
          }))
      : [];

    const validMemberIds = new Set(members.map(m => m.id));

    const matches = Array.isArray(raw.matches)
      ? raw.matches
          .filter(match =>
            match &&
            Array.isArray(match.players) &&
            match.players.length === 4
          )
          .map(match => ({
            id: String(match.id || `${match.round || 1}-${match.court || 1}`),
            round: Math.max(1, Number(match.round) || 1),
            court: Math.max(1, Number(match.court) || 1),
            start: Math.max(0, Number(match.start) || 0),
            end: Math.max(0, Number(match.end) || 0),
            players: match.players.map(Number),
            confirmed: Boolean(match.confirmed),
            completed: Boolean(match.completed)
          }))
          .filter(match => match.players.every(id => validMemberIds.has(id)))
      : [];

    return {
      members,
      matches,
      courts: Math.max(1, Math.min(12, Number(raw.courts) || 3)),
      duration: Math.max(30, Math.min(720, Number(raw.duration) || 180)),
      rotationMin: Math.max(10, Math.min(60, Number(raw.rotationMin) || 18)),
      mix: ['balanced','less-mixed','more-mixed'].includes(raw.mix) ? raw.mix : 'less-mixed'
    };
  }

  function load() {
    if (!isAvailable()) {
      return { ok: false, reason: 'localStorage unavailable', state: null };
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ok: true, reason: 'empty', state: null };

      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== STORAGE_VERSION) {
        return { ok: true, reason: 'version-mismatch', state: null };
      }

      return {
        ok: true,
        reason: 'loaded',
        state: normalizeState(parsed.state)
      };
    } catch (error) {
      console.warn('Could not load saved badminton session:', error);
      return { ok: false, reason: 'parse-error', state: null };
    }
  }

  function save(state) {
    if (!isAvailable()) return false;

    try {
      const payload = {
        version: STORAGE_VERSION,
        savedAt: new Date().toISOString(),
        state
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch (error) {
      console.warn('Could not save badminton session:', error);
      return false;
    }
  }

  function clear() {
    if (!isAvailable()) return false;

    try {
      localStorage.removeItem(STORAGE_KEY);
      return true;
    } catch (error) {
      console.warn('Could not clear saved badminton session:', error);
      return false;
    }
  }

  window.BadmintonStorage = {
    key: STORAGE_KEY,
    version: STORAGE_VERSION,
    isAvailable,
    load,
    save,
    clear
  };
})();
