/* =========================================================================
   AUREA — interface
   ========================================================================= */
(function () {
  'use strict';

  const E = window.AureaEngine;
  const S = window.AureaSynth;
  const M = window.AureaMidi;
  const L = window.AureaL;
  L.init(E);

  const $ = (id) => document.getElementById(id);
  const promptEl = $('prompt');
  const canvas = $('score');
  const ctx2d = canvas.getContext('2d');

  const EXAMPLES = [
    'a melancholic nocturne for solo piano, slow and intimate',
    'heroic symphony orchestra in D minor, triumphant, with timpani',
    'gentle pastoral flute and harp on a spring morning',
    'agitated string quartet, stormy and dramatic',
    'serene cello and piano adagio in F major',
    'mysterious organ fugue, dark and haunting',
    'a joyful Viennese waltz for chamber orchestra in G major',
    'romantic violin and piano, tender and longing',
    'dreamy harp prelude, ethereal and floating',
    'solemn requiem for choir and organ, sacred and dignified',
    'playful clarinet scherzo, light and witty',
    'a nostalgic serenade for string trio, bittersweet'
  ];

  let comp = null;
  let session = null;   // the piece on the stand, and what it is teaching us
  let player = new S.Player();
  let playing = false;
  let position = 0;
  let dirty = true;
  let busy = false;

  /* ---------------- setup ---------------- */
  EXAMPLES.forEach((text) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', () => {
      promptEl.value = text;
      generate();
    });
    $('chips').appendChild(b);
  });

  /* ---------------- compose ---------------- */
  function generate() {
    const text = promptEl.value.trim();
    if (!text) {
      promptEl.focus();
      status('Describe the music first — a mood, an instrument, a key.');
      return;
    }
    settleSession();                        // judge what we just heard, before replacing it

    const duration = parseInt($('duration').value, 10);
    const keep = $('seedMode').value === 'keep';
    const seed = keep && comp ? comp.meta.seed : Math.floor(Math.random() * 1e9);

    player.stop();
    playing = false;
    position = 0;
    updatePlayIcon();

    const learned = L.hints(text);
    const t0 = performance.now();
    let fresh = E.compose(text, { duration, seed, learned });

    // if this exact shape was rejected recently, take a different road
    let detour = false;
    if (L.isDisliked(fresh.meta)) {
      const alt = L.alternative(fresh.meta);
      if (alt) {
        fresh = E.compose(text, { duration, seed: seed + 1, learned, force: alt });
        detour = true;
      }
    }
    const ms = Math.round(performance.now() - t0);
    comp = fresh;

    player.load(comp);
    paintMeta(ms);
    dirty = true;
    enable(true);
    $('feedback').hidden = false;

    session = { prompt: text, meta: comp.meta, started: Date.now(), listened: 0, rewarded: false };

    const bits = ['Composed in ' + ms + ' ms'];
    if (learned && learned.words && learned.words.length) {
      bits.push('recalled “' + learned.words.slice(0, 3).join('”, “') + '”');
    }
    if (detour) bits.push('steered away from the form you passed on');
    status(bits.join(' · ') + ' — press play.');
    setHash(text, comp.meta.seed, comp.meta);
    renderKnowledge();

    // start immediately on user gesture (this click is one)
    play();
  }

  /* ---------------- learning from use ---------------- */
  function credit(reward) {
    if (!session || session.rewarded) return;
    session.rewarded = true;
    L.learn(session.prompt, session.meta, reward + 0.15);
    renderKnowledge();
  }

  // Passive judgement: was it heard out, or skipped straight past?
  function settleSession() {
    if (!session || session.rewarded) return;
    const dur = session.meta.duration || 60;
    const elapsed = (Date.now() - session.started) / 1000;
    let reward = 0;
    if (session.listened >= dur * 0.6) reward = 0.7;        // heard it through
    else if (session.listened < 6 && elapsed > 4) reward = -0.4;  // skipped it
    session.rewarded = true;
    L.learn(session.prompt, session.meta, reward + 0.15);
    renderKnowledge();
  }

  function moreLikeThis() {
    if (!comp) return;
    credit(1.2);
    generate();
    status('Noted — more in this direction. Each one teaches it a little more.');
  }

  function notThis() {
    if (!comp) return;
    credit(-1.0);
    generate();
    status('Noted — steering away from that shape.');
  }

  function renderKnowledge() {
    const st = L.stats();
    $('kCount').textContent = st.pieces + (st.pieces === 1 ? ' piece' : ' pieces') +
      ' · ' + st.words + ' word' + (st.words === 1 ? '' : 's');
    $('kToggle').textContent = 'Learning: ' + (st.enabled ? 'on' : 'off');
    $('kToggle').classList.toggle('off', !st.enabled);

    const bits = [];
    if (st.topMood) bits.push('leans <b>' + st.topMood + '</b>');
    if (st.topForm) bits.push('often <b>' + st.topForm + '</b>');
    if (st.topInst) bits.push('likes <b>' + st.topInst.replace(/\+/g, ' + ') + '</b>');
    if (st.likes) bits.push(st.likes + ' kept');
    if (st.dislikes) bits.push(st.dislikes + ' passed on');
    $('kStats').innerHTML = bits.length ? bits.join(' · ') : 'Nothing learned yet — compose something.';

    if (st.strong.length) {
      $('kWords').innerHTML = st.strong.map((w) => {
        const good = w.r > 0;
        const hint = [w.mood, w.form, w.tempo ? w.tempo + 'bpm' : null].filter(Boolean).join(', ');
        return '<span class="kw ' + (good ? 'pos' : 'neg') + '" title="' + w.n + ' uses, weight ' + w.r + '">' +
          w.w + (hint ? ' <i>' + hint + '</i>' : '') + '</span>';
      }).join('');
    } else {
      $('kWords').innerHTML = '<span class="kw none">the words it keeps an ear out for will appear here</span>';
    }
  }

  function paintMeta(ms) {
    const m = comp.meta;
    $('meta').hidden = false;
    $('metaTitle').textContent = '“' + m.title + '”';
    $('mKey').textContent = m.key + ' ' + m.mode;
    $('mForm').textContent = m.form;
    $('mTempo').textContent = m.tempo + ' bpm';
    $('mMeter').textContent = m.meter;
    $('mMood').textContent = m.moodLabel;
    $('mSeed').textContent = String(m.seed).slice(0, 8);
    $('mInst').innerHTML = '<b>Scored for</b> ' + m.instrumentLabels.join(' · ') +
      ' &nbsp;·&nbsp; ' + m.bars + ' bars, ' + fmt(m.duration);
    $('npTitle').textContent = m.title;
    $('tTotal').textContent = fmt(m.duration);
    $('scoreEmpty').style.display = 'none';
  }

  /* ---------------- transport ---------------- */
  function play() {
    if (!comp || busy) return;
    player.play(position >= comp.meta.duration - 0.3 ? 0 : position);
    if (position >= comp.meta.duration - 0.3) position = 0;
    playing = true;
    updatePlayIcon();
    player.onTick = (t) => {
      position = t;
      if (session && t > session.listened) session.listened = t;
      const pct = Math.min(100, (t / comp.meta.duration) * 100);
      $('progressFill').style.width = pct + '%';
      $('tNow').textContent = fmt(t);
      dirty = true;
    };
    player.onEnd = () => {
      playing = false;
      position = 0;
      $('progressFill').style.width = '0%';
      $('tNow').textContent = fmt(0);
      updatePlayIcon();
      dirty = true;
    };
  }

  function pause() {
    position = Math.max(0, player.ctx ? player.ctx.currentTime - player.startTime : 0);
    player.stop();
    playing = false;
    updatePlayIcon();
    dirty = true;
  }

  function updatePlayIcon() {
    $('playIcon').innerHTML = playing
      ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
      : '<path d="M8 5v14l11-7z"/>';
  }

  function enable(on) {
    ['play', 'restart', 'dlWav', 'dlMidi', 'share'].forEach((id) => { $(id).disabled = !on; });
  }

  /* ---------------- downloads ---------------- */
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function slug(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'aurea';
  }

  async function downloadWav() {
    if (!comp || busy) return;
    busy = true;
    $('dlWav').disabled = true;
    const started = Date.now();
    const tick = setInterval(() => {
      status('Rendering ' + fmt(comp.meta.duration) + ' of audio offline… ' + Math.round((Date.now() - started) / 1000) + 's');
    }, 500);
    status('Rendering ' + fmt(comp.meta.duration) + ' of audio offline…');
    try {
      const blob = await S.renderOffline(comp);
      clearInterval(tick);
      download(blob, slug(comp.meta.title) + '.wav');
      status('Saved ' + (blob.size / 1048576).toFixed(1) + ' MB of WAV audio.');
      credit(0.8);
    } catch (err) {
      clearInterval(tick);
      status('Audio export failed in this browser: ' + err.message);
    }
    busy = false;
    $('dlWav').disabled = false;
  }

  function downloadMidi() {
    if (!comp) return;
    download(M.write(comp), slug(comp.meta.title) + '.mid');
    status('MIDI score saved — open it in any notation app.');
    credit(0.6);
  }

  function share() {
    if (!comp) return;
    const url = location.origin + location.pathname + '?p=' + encodeURIComponent(comp.meta.prompt) +
      '&s=' + comp.meta.seed + '&k=' + L.fingerprint(comp.meta);
    credit(0.6);
    navigator.clipboard.writeText(url).then(
      () => status('Link copied — it reproduces this exact piece.'),
      () => status(url)
    );
  }

  /* ---------------- canvas ---------------- */
  const VOICE_COLOR = {
    melody: '#e8cc8d',
    counter: '#bf9f68',
    bass: '#8fa387',
    accomp: '#8b8173',
    perc: '#6d5b47'
  };

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      dirty = true;
    }
  }

  function draw() {
    resize();
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    ctx2d.clearRect(0, 0, W, H);
    if (!comp) return;

    const ev = comp.events;
    let lo = 127, hi = 0;
    for (const e of ev) { if (e.midi < lo) lo = e.midi; if (e.midi > hi) hi = e.midi; }
    lo -= 3; hi += 3;
    const pad = 10;
    const pitchToY = (m) => pad + (1 - (m - lo) / Math.max(1, hi - lo)) * (H - pad * 2);

    const span = Math.max(8, Math.min(16, comp.meta.duration / 5));
    const t0 = playing || position > 0 ? Math.max(0, position - span * 0.32) : 0;
    const timeToX = (t) => ((t - t0) / span) * W;

    // bar lines
    const barDur = parseFloat(comp.meta.meter.split('/')[0]) * (60 / comp.meta.tempo);
    ctx2d.strokeStyle = 'rgba(216,184,126,0.07)';
    ctx2d.lineWidth = 1;
    for (let b = 0; b * barDur < t0 + span; b++) {
      const x = timeToX(b * barDur);
      if (x < -1 || x > W + 1) continue;
      ctx2d.beginPath();
      ctx2d.moveTo(Math.round(x) + 0.5, 0);
      ctx2d.lineTo(Math.round(x) + 0.5, H);
      ctx2d.stroke();
    }
    // octave guides
    ctx2d.strokeStyle = 'rgba(255,248,235,0.045)';
    for (let m = Math.ceil(lo / 12) * 12; m < hi; m += 12) {
      const y = pitchToY(m);
      ctx2d.beginPath();
      ctx2d.moveTo(0, Math.round(y) + 0.5);
      ctx2d.lineTo(W, Math.round(y) + 0.5);
      ctx2d.stroke();
    }

    // notes
    for (const e of ev) {
      const x = timeToX(e.t);
      const w = Math.max(2.5, (e.d / span) * W - 1);
      if (x + w < -4 || x > W + 4) continue;
      const y = pitchToY(e.midi);
      const hgt = Math.max(3, Math.min(9, (H - pad * 2) / (hi - lo) * 2.2));
      const c = VOICE_COLOR[e.voice] || VOICE_COLOR.accomp;
      const alpha = 0.28 + e.vel * 0.62;
      ctx2d.globalAlpha = alpha;
      ctx2d.fillStyle = c;
      const r = Math.min(hgt / 2, 3);
      roundRect(ctx2d, x, y - hgt / 2, w, hgt, r);
      ctx2d.fill();
    }
    ctx2d.globalAlpha = 1;

    // playhead
    if (playing || position > 0) {
      const px = timeToX(position);
      const grad = ctx2d.createLinearGradient(px - 24, 0, px + 2, 0);
      grad.addColorStop(0, 'rgba(216,184,126,0)');
      grad.addColorStop(1, 'rgba(216,184,126,0.16)');
      ctx2d.fillStyle = grad;
      ctx2d.fillRect(px - 24, 0, 26, H);
      ctx2d.strokeStyle = 'rgba(232,204,141,0.85)';
      ctx2d.lineWidth = 1.4;
      ctx2d.beginPath();
      ctx2d.moveTo(px, 0);
      ctx2d.lineTo(px, H);
      ctx2d.stroke();
    }
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    if (c.roundRect) { c.roundRect(x, y, w, h, r); return; }
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function loop() {
    if (dirty) { draw(); dirty = false; }
    requestAnimationFrame(loop);
  }

  /* ---------------- misc ---------------- */
  function fmt(s) {
    s = Math.max(0, Math.round(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function status(msg) { $('status').textContent = msg || ''; }

  function setHash(p, seed, meta) {
    try {
      const k = meta ? '&k=' + L.fingerprint(meta) : '';
      history.replaceState(null, '', location.pathname + '?p=' + encodeURIComponent(p) + '&s=' + seed + k);
    } catch (e) { /* file:// or blocked */ }
  }

  /* ---------------- wiring ---------------- */
  $('compose').addEventListener('click', generate);
  $('play').addEventListener('click', () => (playing ? pause() : play()));
  $('restart').addEventListener('click', () => {
    position = 0;
    $('progressFill').style.width = '0%';
    $('tNow').textContent = fmt(0);
    if (playing) { player.stop(); play(); } else { dirty = true; }
  });
  $('dlWav').addEventListener('click', downloadWav);
  $('dlMidi').addEventListener('click', downloadMidi);
  $('share').addEventListener('click', share);
  $('like').addEventListener('click', moreLikeThis);
  $('dislike').addEventListener('click', notThis);

  $('kToggle').addEventListener('click', () => {
    L.setEnabled(!L.isEnabled());
    renderKnowledge();
    status(L.isEnabled() ? 'Learning is on — every prompt teaches it.' : 'Learning is off — nothing is being recorded.');
  });
  $('kExport').addEventListener('click', () => {
    download(new Blob([L.exportJSON()], { type: 'application/json' }), 'aurea-knowledge.json');
    status('Knowledge exported — import it on another device to carry it over.');
  });
  $('kImport').addEventListener('click', () => $('kFile').click());
  $('kFile').addEventListener('change', (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const ok = L.importJSON(String(reader.result));
      renderKnowledge();
      status(ok ? 'Knowledge merged into this device.' : 'That file was not an AUREA knowledge export.');
    };
    reader.readAsText(file);
    ev.target.value = '';
  });
  $('kReset').addEventListener('click', () => {
    if (confirm('Forget everything AUREA has learned on this device? This cannot be undone.')) {
      L.reset();
      renderKnowledge();
      status('Memory cleared — it starts from nothing again.');
    }
  });

  document.addEventListener('keydown', (ev) => {
    const typing = document.activeElement === promptEl;
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); generate(); }
    else if (ev.code === 'Space' && !typing) {
      ev.preventDefault();
      playing ? pause() : play();
    }
  });

  window.addEventListener('resize', () => { dirty = true; });

  // restore a shared piece
  (function restore() {
    const q = new URLSearchParams(location.search);
    const p = q.get('p');
    if (p) {
      promptEl.value = p;
      const sd = parseInt(q.get('s'), 10);
      const kRaw = q.get('k');
      const force = kRaw ? L.unfingerprint(kRaw) : null;
      const duration = parseInt($('duration').value, 10);
      comp = E.compose(p, { duration, seed: isFinite(sd) ? sd : undefined, force: force || undefined });
      player.load(comp);
      paintMeta(0);
      enable(true);
      $('feedback').hidden = false;
      dirty = true;
      status('Shared piece loaded — press play.');
    }
  })();

  renderKnowledge();

  requestAnimationFrame(loop);
})();
