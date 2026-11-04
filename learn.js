/* =========================================================================
   AUREA — Learning layer
   Every use of the instrument is a training example. This module keeps a
   small, private, on-device model of what your words seem to mean and what
   you actually liked, and feeds it back into the parser on the next prompt.

   What is learned
   ---------------
   1. Word memory  — each prompt token accumulates signed evidence for the
                     musical parameters of the pieces it produced (mood, form,
                     mode, tempo, instruments). A token that keeps appearing in
                     pieces you keep becomes a reliable cue; one that keeps
                     appearing in pieces you reject becomes a cue to avoid.
   2. Preferences  — a running weight over moods / forms / modes / instruments
                     used as a tie-breaker when a prompt is ambiguous.
   3. Regret       — fingerprints of recently rejected pieces, so the next
                     generation does not walk into the same wall.

   Everything lives in localStorage. Nothing is uploaded anywhere.
   ========================================================================= */
(function (root) {
  'use strict';

  const KEY = 'aurea.memory.v1';
  const MAX_WORDS = 900;
  const MAX_HISTORY = 240;
  const MAX_DISLIKES = 40;

  const STOP = new Set(('the a an and or of for with in on at to from by like very really some more most much ' +
    'little bit piece music song sound sounding make create compose write generate please want need would should ' +
    'could can will just it that this these those my me i we you our is are was were be been being do does did ' +
    'something anything thing things about into over under out up down not no yes also then than there here ' +
    'while when where what which who how why all any both each few other same so such only own too now new ' +
    'get got give play playing hear listen listening make makes made').split(' '));

  let E = null;                 // engine module, injected by init()
  let M = blank();
  let loaded = false;

  function blank() {
    return {
      v: 1, created: Date.now(), uses: 0, enabled: true,
      words: {}, prefs: { mood: {}, form: {}, mode: {}, inst: {} },
      dislikes: [], history: []
    };
  }

  function tokenize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^\w\s'-]/g, ' ')
      .split(/\s+/)
      .map((w) => w.replace(/^['-]+|['-]+$/g, ''))
      .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (o && o.v === 1 && o.words) return o;
    } catch (e) { /* private mode, quota, corrupt */ }
    return null;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(M)); } catch (e) { /* ignore */ }
  }

  function bump(obj, key, amount) {
    if (!key) return;
    obj[key] = (obj[key] || 0) + amount;
  }

  function init(engine) {
    E = engine || null;
    if (loaded) return M;
    const stored = load();
    if (stored) M = stored;
    loaded = true;
    return M;
  }

  /* ------------------------------------------------------------------ */
  /* learning                                                            */
  /* ------------------------------------------------------------------ */
  function learn(prompt, meta, reward) {
    if (!M.enabled || !prompt || !meta || !isFinite(reward) || reward === 0) return;
    M.uses++;
    const toks = tokenize(prompt);

    for (const tk of toks) {
      let e = M.words[tk];
      if (!e) e = M.words[tk] = { n: 0, r: 0, mood: {}, form: {}, mode: {}, inst: {}, tempo: 0, tempoN: 0 };
      e.n++;
      e.r += reward;
      bump(e.mood, meta.mood, reward);
      bump(e.form, meta.form, reward * 0.7);
      bump(e.mode, meta.modeId, reward * 0.6);
      bump(e.inst, (meta.instruments || []).join('+'), reward * 0.5);
      if (meta.tempo) { e.tempo += meta.tempo * reward; e.tempoN += Math.abs(reward); }
    }

    bump(M.prefs.mood, meta.mood, reward);
    bump(M.prefs.form, meta.form, reward);
    bump(M.prefs.mode, meta.modeId, reward);
    bump(M.prefs.inst, (meta.instruments || []).join('+'), reward * 0.6);

    if (reward < -0.3) {
      M.dislikes.push({
        mood: meta.mood, form: meta.form, mode: meta.modeId,
        inst: (meta.instruments || []).join('+'), t: Date.now()
      });
      if (M.dislikes.length > MAX_DISLIKES) M.dislikes = M.dislikes.slice(-MAX_DISLIKES);
    }

    M.history.push({ t: Date.now(), p: String(prompt).slice(0, 160), r: Math.round(reward * 100) / 100 });
    if (M.history.length > MAX_HISTORY) M.history = M.history.slice(-MAX_HISTORY);

    prune();
    save();
  }

  function prune() {
    const keys = Object.keys(M.words);
    if (keys.length <= MAX_WORDS) return;
    keys.sort((a, b) => (M.words[a].n - M.words[b].n) || (Math.abs(M.words[a].r) - Math.abs(M.words[b].r)));
    for (const k of keys.slice(0, keys.length - MAX_WORDS)) delete M.words[k];
  }

  /* ------------------------------------------------------------------ */
  /* inference                                                           */
  /* ------------------------------------------------------------------ */
  function best(obj) {
    let k = null, v = 0;
    for (const id in obj) if (obj[id] > v) { v = obj[id]; k = id; }
    return k;
  }

  // What do these words mean, given everything learned so far?
  function hints(text) {
    if (!M.enabled) return null;
    const toks = tokenize(text);
    const acc = { mood: {}, form: {}, mode: {}, inst: {}, tempoW: 0, tempoSum: 0, weight: 0 };
    const used = [];
    let matched = 0;

    for (const tk of toks) {
      const e = M.words[tk];
      if (!e || e.n < 1) continue;
      const conf = Math.min(1, e.n / 4) * Math.min(1, Math.abs(e.r) / 2);
      if (conf <= 0.05 || e.r <= 0) continue;      // only positive evidence steers
      matched++;
      used.push(tk);
      for (const k of ['mood', 'form', 'mode', 'inst']) {
        for (const id in e[k]) acc[k][id] = (acc[k][id] || 0) + (e[k][id] / e.n) * conf;
      }
      if (e.tempoN > 0) { acc.tempoSum += (e.tempo / e.tempoN) * conf; acc.tempoW += conf; }
      acc.weight += conf;
    }
    if (!matched || acc.weight < 0.35) return null;

    const inst = best(acc.inst);
    return {
      moodId: best(acc.mood),
      formId: best(acc.form),
      mode: best(acc.mode),
      instruments: inst ? inst.split('+') : null,
      tempo: acc.tempoW > 0 ? Math.round(acc.tempoSum / acc.tempoW) : null,
      strength: Math.round(acc.weight * 100) / 100,
      words: used
    };
  }

  // Was something very like this just rejected?
  function isDisliked(meta) {
    if (!M.enabled || !meta) return false;
    const inst = (meta.instruments || []).join('+');
    const now = Date.now();
    return M.dislikes.some((d) =>
      d.mood === meta.mood && d.form === meta.form && d.mode === meta.modeId &&
      d.inst === inst && (now - d.t) < 1000 * 60 * 60 * 12);
  }

  // A concrete alternative to a rejected shape: different form, or flipped mode.
  function alternative(meta) {
    if (!E || !meta) return null;
    const forms = E.FORMS.filter((f) => f.id !== meta.form);
    const pick = forms[Math.floor(Math.random() * forms.length)];
    const flip = meta.modeId === 'major'
      ? (Math.random() < 0.5 ? 'minor' : 'harmonicMinor')
      : 'major';
    return {
      formId: pick ? pick.id : null,
      mode: flip,
      moodId: meta.mood,
      instruments: meta.instruments,
      tonic: meta.tonic
    };
  }

  /* ------------------------------------------------------------------ */
  /* reporting                                                           */
  /* ------------------------------------------------------------------ */
  function stats() {
    const words = Object.keys(M.words).map((w) => ({
      w, n: M.words[w].n, r: Math.round(M.words[w].r * 100) / 100,
      mood: best(M.words[w].mood), form: best(M.words[w].form),
      tempo: M.words[w].tempoN > 0 ? Math.round(M.words[w].tempo / M.words[w].tempoN) : null
    }));
    const strong = words.filter((x) => Math.abs(x.r) >= 0.5 && x.n >= 2)
      .sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 8);
    return {
      enabled: M.enabled,
      pieces: M.uses,
      words: words.length,
      strong,
      topMood: best(M.prefs.mood),
      topForm: best(M.prefs.form),
      topInst: best(M.prefs.inst),
      likes: M.history.filter((h) => h.r > 0).length,
      dislikes: M.dislikes.length,
      created: M.created
    };
  }

  function exportJSON() { return JSON.stringify(M, null, 1); }

  function importJSON(text) {
    try {
      const o = JSON.parse(text);
      if (!o || o.v !== 1 || !o.words) return false;
      // merge: sum evidence rather than replace
      M.uses += o.uses || 0;
      for (const w in o.words) {
        const src = o.words[w];
        let e = M.words[w];
        if (!e) e = M.words[w] = { n: 0, r: 0, mood: {}, form: {}, mode: {}, inst: {}, tempo: 0, tempoN: 0 };
        e.n += src.n || 0; e.r += src.r || 0;
        for (const k of ['mood', 'form', 'mode', 'inst']) {
          for (const id in (src[k] || {})) bump(e[k], id, src[k][id]);
        }
        e.tempo += src.tempo || 0; e.tempoN += src.tempoN || 0;
      }
      for (const k of ['mood', 'form', 'mode', 'inst']) {
        for (const id in (o.prefs && o.prefs[k] || {})) bump(M.prefs[k], id, o.prefs[k][id]);
      }
      prune(); save();
      return true;
    } catch (e) { return false; }
  }

  function reset() {
    M = blank();
    save();
    return M;
  }

  function setEnabled(on) { M.enabled = !!on; save(); }
  function isEnabled() { return M.enabled; }

  /* ------------------------------------------------------------------ */
  /* shareable fingerprints (so a link reproduces a piece exactly)        */
  /* ------------------------------------------------------------------ */
  function fingerprint(meta) {
    try {
      const o = {
        m: meta.mood, f: meta.form, o: meta.modeId,
        t: meta.tonic, p: meta.tempo, i: meta.instruments
      };
      return btoa(JSON.stringify(o)).replace(/=+$/, '');
    } catch (e) { return ''; }
  }

  function unfingerprint(str) {
    try {
      const o = JSON.parse(atob(str));
      return { moodId: o.m, formId: o.f, mode: o.o, tonic: o.t, tempo: o.p, instruments: o.i };
    } catch (e) { return null; }
  }

  root.AureaL = {
    init, learn, hints, isDisliked, alternative, stats,
    exportJSON, importJSON, reset, setEnabled, isEnabled,
    fingerprint, unfingerprint, tokenize
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
