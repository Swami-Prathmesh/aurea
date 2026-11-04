/* =========================================================================
   AUREA — Synthesis & Playback
   Physical-ish instrument models built from Web Audio primitives:
   additive partials with inharmonicity, filtered saw/formant stacks,
   breath and bow noise, vibrato, plus a generated hall impulse response.
   Works in both a live AudioContext and an OfflineAudioContext.
   ========================================================================= */
(function (root) {
  'use strict';

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const PROGRAM = {
    piano: 0, harpsichord: 6, organ: 19, harp: 46, guitar: 24, lute: 25,
    violin: 40, viola: 41, cello: 42, doublebass: 43,
    flute: 73, oboe: 68, clarinet: 71, bassoon: 70,
    horn: 60, trumpet: 56, timpani: 47, choir: 52
  };

  const WET = {
    piano: 0.26, harpsichord: 0.2, organ: 0.42, harp: 0.34, guitar: 0.24, lute: 0.26,
    violin: 0.32, viola: 0.32, cello: 0.34, doublebass: 0.3,
    flute: 0.36, oboe: 0.33, clarinet: 0.33, bassoon: 0.32,
    horn: 0.4, trumpet: 0.34, timpani: 0.42, choir: 0.55
  };

  /* ---------------- primitive helpers ---------------- */
  function g(ctx, v) { const n = ctx.createGain(); n.gain.value = v === undefined ? 1 : v; return n; }
  function osc(ctx, type, f) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; }
  function flt(ctx, type, f, q) {
    const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f;
    if (q !== undefined) b.Q.value = q;
    return b;
  }

  let noiseCache = new WeakMap();
  function noiseBuffer(ctx) {
    if (noiseCache.has(ctx)) return noiseCache.get(ctx);
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = 0.85 * last + 0.15 * w;   // slightly brown
      d[i] = last * 0.8;
    }
    noiseCache.set(ctx, buf);
    return buf;
  }

  function noiseSrc(ctx) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(ctx);
    s.loop = true;
    s.playbackRate.value = 0.9 + Math.random() * 0.2;
    return s;
  }

  // percussive envelope: fast attack, exponential decay, hard stop
  function percEnv(ctx, node, t, peak, attack, decay) {
    const p = node.gain;
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    p.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  // sustained envelope with release
  function susEnv(ctx, node, t, dur, peak, attack, release) {
    const p = node.gain;
    const end = t + Math.max(dur, attack + 0.05);
    p.setValueAtTime(0.0001, t);
    p.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    p.setTargetAtTime(peak * 0.78, t + attack, 0.35);
    p.setValueAtTime(Math.max(0.0002, peak * 0.78), Math.max(t + attack + 0.02, end - release));
    p.exponentialRampToValueAtTime(0.0001, end + release);
    return end + release;
  }

  /* ---------------- reverb ---------------- */
  function makeImpulse(ctx, seconds, decay) {
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * seconds));
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const x = i / len;
        // dense diffuse tail with a touch of pre-delay shaping
        const env = Math.pow(1 - x, decay) * (i < rate * 0.012 ? i / (rate * 0.012) : 1);
        d[i] = (Math.random() * 2 - 1) * env;
      }
      // a few early reflections to give the room a size
      const taps = [0.011, 0.019, 0.027, 0.041, 0.058, 0.073];
      taps.forEach((tp, k) => {
        const idx = Math.floor(tp * rate);
        if (idx < len) d[idx] += (k % 2 ? -1 : 1) * (0.5 - k * 0.06);
      });
    }
    return buf;
  }

  function buildGraph(ctx) {
    const master = g(ctx, 0.9);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 24;
    comp.ratio.value = 2.6;
    comp.attack.value = 0.006;
    comp.release.value = 0.28;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    master.connect(comp);
    comp.connect(limiter);
    limiter.connect(ctx.destination);

    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 1.9, 2.6);
    const revOut = g(ctx, 0.9);
    conv.connect(revOut);
    revOut.connect(master);

    return { master, reverb: conv };
  }

  function getChannel(ctx, graph, wet, pan) {
    if (!graph.channels) graph.channels = {};
    const key = wet.toFixed(2) + '|' + (pan || 0).toFixed(2);
    if (!graph.channels[key]) graph.channels[key] = channel(ctx, graph, wet, pan);
    return graph.channels[key];
  }

  function channel(ctx, graph, wet, pan) {
    const input = g(ctx, 1);
    const dry = g(ctx, 1 - wet * 0.55);
    const send = g(ctx, wet);
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = pan || 0;
      input.connect(panner);
      panner.connect(dry);
      panner.connect(send);
    } else {
      input.connect(dry);
      input.connect(send);
    }
    dry.connect(graph.master);
    send.connect(graph.reverb);
    return input;
  }

  /* ---------------- instruments ---------------- */
  // Each returns a stop time; sources are started/stopped internally.

  function piano(ctx, out, t, dur, midi, vel, art) {
    const f = mtof(midi);
    const bright = 0.55 + vel * 0.55;
    const partials = [1, 2, 3, 4, 6];
    const amps = [1, 0.5, 0.29, 0.16, 0.08];
    const body = g(ctx, 0.16 * (0.35 + vel * 0.85));
    const lp = flt(ctx, 'lowpass', Math.min(16000, f * (6 + bright * 8)), 0.6);
    body.connect(lp); lp.connect(out);
    let maxEnd = t + 0.5;
    const baseDecay = Math.min(4.5, 1.9 * Math.pow(2, (72 - midi) / 22));
    partials.forEach((n, i) => {
      const pn = n * (1 + 0.00035 * n * n);
      const freq = f * pn;
      if (freq > 15000) return;
      const o = osc(ctx, 'sine', freq);
      const pg = g(ctx, 0);
      const decay = Math.max(0.12, baseDecay / Math.pow(n, 0.75));
      const peak = amps[i] * (i > 2 ? bright : 1) * 0.9;
      percEnv(ctx, pg, t, peak, 0.004 + i * 0.001, decay);
      o.connect(pg); pg.connect(body);
      o.start(t); o.stop(t + decay + 0.06);
      maxEnd = Math.max(maxEnd, t + decay + 0.06);
    });
    // hammer / damper noise
    const ns = noiseSrc(ctx);
    const nf = flt(ctx, 'bandpass', Math.min(9000, f * 3), 1.2);
    const ng = g(ctx, 0);
    percEnv(ctx, ng, t, 0.05 * vel, 0.002, 0.05);
    ns.connect(nf); nf.connect(ng); ng.connect(out);
    ns.start(t); ns.stop(t + 0.09);
    return maxEnd;
  }

  function pluck(ctx, out, t, midi, vel, opts) {
    const f = mtof(midi);
    const o = opts || {};
    const partials = o.partials || [1, 2, 3, 4, 5, 6];
    const amps = o.amps || [1, 0.6, 0.38, 0.22, 0.13, 0.07];
    const body = g(ctx, (o.level || 0.15) * (0.35 + vel * 0.8));
    const lp = flt(ctx, 'lowpass', o.cutoff || 8000, 0.7);
    const peak = flt(ctx, 'peaking', o.body || 240, 1.1);
    peak.gain.value = 6;
    body.connect(peak); peak.connect(lp); lp.connect(out);
    let maxEnd = t + 0.4;
    partials.forEach((n, i) => {
      const freq = f * n * (1 + 0.0005 * n * n);
      if (freq > 15000) return;
      const osc1 = osc(ctx, 'sine', freq);
      const pg = g(ctx, 0);
      const decay = Math.max(0.1, (o.decay || 1.6) / Math.pow(n, 0.8));
      percEnv(ctx, pg, t, amps[i], 0.003, decay);
      osc1.connect(pg); pg.connect(body);
      osc1.start(t); osc1.stop(t + decay + 0.05);
      maxEnd = Math.max(maxEnd, t + decay + 0.05);
    });
    return maxEnd;
  }

  function bowed(ctx, out, t, dur, midi, vel, art, cfg) {
    const f = mtof(midi);
    const c = cfg;
    const now = t;
    const vca = g(ctx, 0);
    const lp = flt(ctx, 'lowpass', Math.min(14000, f * c.cutoffMul), 0.8);
    const formant = flt(ctx, 'peaking', c.formant * (0.85 + vel * 0.4), 1.4);
    formant.gain.value = c.formantGain;
    const hp = flt(ctx, 'highpass', Math.max(40, f * 0.5), 0.7);
    vca.connect(hp); hp.connect(lp); lp.connect(formant); formant.connect(out);

    const detunes = [-6, 6];
    const oscs = [];
    detunes.forEach((dt) => {
      const o = osc(ctx, 'sawtooth', f);
      o.detune.value = dt;
      const og = g(ctx, 0.42);
      o.connect(og); og.connect(vca);
      oscs.push(o);
    });
    // vibrato
    const lfo = osc(ctx, 'sine', c.vibRate);
    const lfoGain = g(ctx, 0);
    lfoGain.gain.setValueAtTime(0, now);
    lfoGain.gain.linearRampToValueAtTime(c.vibDepth * (0.4 + vel * 0.9), now + Math.min(0.5, dur * 0.4));
    lfo.connect(lfoGain);
    oscs.forEach((o) => lfoGain.connect(o.detune));
    lfo.start(now); lfo.stop(now + dur + 1.2);

    const staccato = art === 'staccato';
    const soundDur = staccato ? Math.min(dur, 0.16 + dur * 0.35) : dur;
    const attack = staccato ? 0.012 : c.attack;
    const release = staccato ? 0.06 : c.release;
    const end = susEnv(ctx, vca, now, soundDur, c.level * (0.4 + vel * 0.9), attack, release);

    // bow / rosin noise at the attack
    const ns = noiseSrc(ctx);
    const nf = flt(ctx, 'bandpass', Math.min(9000, f * 2.5), 1.6);
    const ng = g(ctx, 0);
    percEnv(ctx, ng, now, c.noise * (0.3 + vel), 0.008, 0.09);
    ns.connect(nf); nf.connect(ng); ng.connect(out);
    ns.start(now); ns.stop(now + 0.14);

    if (art === 'trem') {
      const tl = osc(ctx, 'sine', 11);
      const tg = g(ctx, 0.35);
      tl.connect(tg); tg.connect(vca.gain);
      tl.start(now); tl.stop(now + soundDur + release + 0.05);
    }

    oscs.forEach((o) => { o.start(now); o.stop(end + 0.08); });
    return end + 0.1;
  }

  function wind(ctx, out, t, dur, midi, vel, art, cfg) {
    const f = mtof(midi);
    const c = cfg;
    const vca = g(ctx, 0);
    const lp = flt(ctx, 'lowpass', Math.min(13000, f * c.cutoffMul), 0.9);
    vca.connect(lp); lp.connect(out);
    if (c.peak1) { const p1 = flt(ctx, 'peaking', c.peak1, c.q1 || 3); p1.gain.value = c.peak1Gain || 8; lp.connect(p1); p1.connect(out); }
    if (c.peak2) { const p2 = flt(ctx, 'peaking', c.peak2, c.q2 || 4); p2.gain.value = c.peak2Gain || 6; lp.connect(p2); p2.connect(out); }

    const o1 = osc(ctx, c.wave || 'sine', f);
    const og1 = g(ctx, c.mix1 === undefined ? 0.9 : c.mix1);
    o1.connect(og1); og1.connect(vca);
    let o2 = null;
    if (c.mix2) {
      o2 = osc(ctx, c.wave2 || 'triangle', f * (c.oct2 || 2));
      const og2 = g(ctx, c.mix2);
      o2.connect(og2); og2.connect(vca);
    }
    // breath
    const ns = noiseSrc(ctx);
    const nf = flt(ctx, 'bandpass', Math.min(11000, f * 1.6), 0.9);
    const ng = g(ctx, 0);
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(c.noise * (0.25 + vel), t + 0.03);
    ng.gain.linearRampToValueAtTime(c.noise * 0.25 * (0.3 + vel), t + 0.2);
    ns.connect(nf); nf.connect(ng); ng.connect(out);
    ns.start(t); ns.stop(t + Math.max(dur, 0.3) + 0.2);

    // vibrato
    const lfo = osc(ctx, 'sine', c.vibRate || 5);
    const lfoGain = g(ctx, 0);
    lfoGain.gain.setValueAtTime(0, t);
    lfoGain.gain.linearRampToValueAtTime((c.vibDepth || 6) * (0.5 + vel), t + Math.min(0.45, dur * 0.5));
    lfo.connect(lfoGain); lfoGain.connect(o1.detune);
    if (o2) lfoGain.connect(o2.detune);
    lfo.start(t); lfo.stop(t + dur + 0.6);

    const staccato = art === 'staccato';
    const soundDur = staccato ? Math.min(dur, 0.2) : dur;
    const end = susEnv(ctx, vca, t, soundDur, c.level * (0.4 + vel * 0.9), staccato ? 0.015 : c.attack, staccato ? 0.05 : c.release);
    o1.start(t); o1.stop(end + 0.06);
    if (o2) { o2.start(t); o2.stop(end + 0.06); }
    return end + 0.08;
  }

  const INSTR = {
    piano: (ctx, out, t, d, m, v, a) => piano(ctx, out, t, d, m, v, a),
    harp: (ctx, out, t, d, m, v) => pluck(ctx, out, t, m, v, { partials: [1, 2, 3, 4, 5, 6, 8], amps: [1, 0.55, 0.4, 0.25, 0.16, 0.1, 0.05], decay: 2.4, level: 0.14, cutoff: 9000, body: 200 }),
    guitar: (ctx, out, t, d, m, v) => pluck(ctx, out, t, m, v, { partials: [1, 2, 3, 4, 5], amps: [1, 0.5, 0.32, 0.18, 0.09], decay: 1.5, level: 0.16, cutoff: 6000, body: 190 }),
    lute: (ctx, out, t, d, m, v) => pluck(ctx, out, t, m, v, { partials: [1, 2, 3, 4, 6], amps: [1, 0.55, 0.4, 0.2, 0.1], decay: 1.1, level: 0.15, cutoff: 5500, body: 230 }),
    harpsichord: (ctx, out, t, d, m, v) => {
      const end = pluck(ctx, out, t, m, v, { partials: [1, 2, 3, 4, 5, 6, 7], amps: [1, 0.7, 0.5, 0.34, 0.2, 0.13, 0.08], decay: 1.1, level: 0.12, cutoff: 11000, body: 320 });
      const ns = noiseSrc(ctx); const nf = flt(ctx, 'highpass', 3000, 0.8); const ng = g(ctx, 0);
      percEnv(ctx, ng, t, 0.03 * v, 0.001, 0.02);
      ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); ns.stop(t + 0.05);
      return end;
    },
    organ: (ctx, out, t, dur, midi, vel) => {
      const f = mtof(midi);
      const vca = g(ctx, 0);
      const lp = flt(ctx, 'lowpass', 6500, 0.6);
      vca.connect(lp); lp.connect(out);
      const bars = [[1, 1], [2, 0.62], [3, 0.5], [4, 0.34], [6, 0.2], [8, 0.14], [12, 0.08]];
      bars.forEach(([n, amp]) => {
        if (f * n > 12000) return;
        const o = osc(ctx, 'sine', f * n);
        const og = g(ctx, amp * 0.3);
        o.connect(og); og.connect(vca);
        o.start(t); o.stop(t + dur + 0.5);
      });
      const end = susEnv(ctx, vca, t, dur, 0.55 * (0.5 + vel), 0.05, 0.22);
      // chiff
      const ns = noiseSrc(ctx); const nf = flt(ctx, 'bandpass', f * 2, 1.5); const ng = g(ctx, 0);
      percEnv(ctx, ng, t, 0.03 * vel, 0.004, 0.07);
      ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); ns.stop(t + 0.12);
      return end;
    },
    violin: (ctx, out, t, d, m, v, a) => bowed(ctx, out, t, d, m, v, a, { cutoffMul: 12, formant: 2900, formantGain: 7, level: 0.16, attack: 0.06, release: 0.11, noise: 0.03, vibRate: 5.4, vibDepth: 9 }),
    viola: (ctx, out, t, d, m, v, a) => bowed(ctx, out, t, d, m, v, a, { cutoffMul: 10, formant: 1900, formantGain: 8, level: 0.16, attack: 0.075, release: 0.12, noise: 0.03, vibRate: 5.1, vibDepth: 8 }),
    cello: (ctx, out, t, d, m, v, a) => bowed(ctx, out, t, d, m, v, a, { cutoffMul: 9, formant: 1150, formantGain: 9, level: 0.17, attack: 0.085, release: 0.14, noise: 0.032, vibRate: 4.8, vibDepth: 8 }),
    doublebass: (ctx, out, t, d, m, v, a) => bowed(ctx, out, t, d, m, v, a, { cutoffMul: 8, formant: 650, formantGain: 9, level: 0.19, attack: 0.09, release: 0.15, noise: 0.03, vibRate: 4.2, vibDepth: 6 }),
    flute: (ctx, out, t, d, m, v, a) => wind(ctx, out, t, d, m, v, a, { wave: 'sine', mix1: 1, mix2: 0.14, wave2: 'triangle', oct2: 2, cutoffMul: 10, level: 0.2, attack: 0.05, release: 0.1, noise: 0.05, vibRate: 5.2, vibDepth: 7, peak1: 2200, q1: 2, peak1Gain: 4 }),
    oboe: (ctx, out, t, d, m, v, a) => wind(ctx, out, t, d, m, v, a, { wave: 'sawtooth', mix1: 0.55, mix2: 0.18, wave2: 'square', oct2: 2, cutoffMul: 6, level: 0.15, attack: 0.04, release: 0.09, noise: 0.03, vibRate: 5.6, vibDepth: 7, peak1: 1400, q1: 4, peak1Gain: 10, peak2: 3100, q2: 5, peak2Gain: 7 }),
    clarinet: (ctx, out, t, d, m, v, a) => wind(ctx, out, t, d, m, v, a, { wave: 'square', mix1: 0.5, mix2: 0.22, wave2: 'sine', oct2: 3, cutoffMul: 5, level: 0.16, attack: 0.045, release: 0.1, noise: 0.035, vibRate: 4.9, vibDepth: 5, peak1: 1600, q1: 2, peak1Gain: 5 }),
    bassoon: (ctx, out, t, d, m, v, a) => wind(ctx, out, t, d, m, v, a, { wave: 'sawtooth', mix1: 0.6, mix2: 0.15, wave2: 'square', oct2: 2, cutoffMul: 5, level: 0.17, attack: 0.05, release: 0.11, noise: 0.03, vibRate: 4.6, vibDepth: 5, peak1: 520, q1: 3, peak1Gain: 9 }),
    horn: (ctx, out, t, d, m, v, a) => wind(ctx, out, t, d, m, v, a, { wave: 'sine', mix1: 0.7, mix2: 0.4, wave2: 'sawtooth', oct2: 1, cutoffMul: 6, level: 0.17, attack: 0.1, release: 0.16, noise: 0.02, vibRate: 4.4, vibDepth: 6, peak1: 800, q1: 2, peak1Gain: 7 }),
    trumpet: (ctx, out, t, d, m, v, a) => {
      const f = mtof(m);
      const vca = g(ctx, 0);
      const lp = flt(ctx, 'lowpass', 900, 1.2);
      lp.frequency.setValueAtTime(700 + v * 400, t);
      lp.frequency.exponentialRampToValueAtTime(4200 + v * 1800, t + 0.05);
      const pk = flt(ctx, 'peaking', 1800, 2); pk.gain.value = 8;
      vca.connect(lp); lp.connect(pk); pk.connect(out);
      const o = osc(ctx, 'sawtooth', f); const og = g(ctx, 0.5);
      o.connect(og); og.connect(vca);
      const o2 = osc(ctx, 'square', f * 1.001); const og2 = g(ctx, 0.12);
      o2.connect(og2); og2.connect(vca);
      const end = susEnv(ctx, vca, t, d, 0.19 * (0.45 + v), 0.035, 0.1);
      o.start(t); o.stop(end + 0.06); o2.start(t); o2.stop(end + 0.06);
      return end;
    },
    timpani: (ctx, out, t, d, m, v) => {
      const f = mtof(m);
      const vca = g(ctx, 0);
      const lp = flt(ctx, 'lowpass', 500, 0.8);
      vca.connect(lp); lp.connect(out);
      const o = osc(ctx, 'sine', f * 1.08);
      o.frequency.setValueAtTime(f * 1.08, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
      const og = g(ctx, 0.9); o.connect(og); og.connect(vca);
      const o2 = osc(ctx, 'triangle', f * 1.5); const og2 = g(ctx, 0.18);
      o2.connect(og2); og2.connect(vca);
      percEnv(ctx, vca, t, 0.42 * (0.4 + v), 0.006, 1.1);
      o.start(t); o.stop(t + 1.3); o2.start(t); o2.stop(t + 0.6);
      const ns = noiseSrc(ctx); const nf = flt(ctx, 'lowpass', 380, 0.9); const ng = g(ctx, 0);
      percEnv(ctx, ng, t, 0.18 * v, 0.002, 0.22);
      ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); ns.stop(t + 0.4);
      return t + 1.3;
    },
    choir: (ctx, out, t, dur, midi, vel) => {
      const f = mtof(midi);
      const vca = g(ctx, 0);
      const lp = flt(ctx, 'lowpass', 4200, 0.7);
      const p1 = flt(ctx, 'peaking', 800, 2.2); p1.gain.value = 8;
      const p2 = flt(ctx, 'peaking', 1250, 2.6); p2.gain.value = 7;
      vca.connect(lp); lp.connect(p1); p1.connect(p2); p2.connect(out);
      [-9, 0, 8].forEach((dt) => {
        const o = osc(ctx, 'sine', f); o.detune.value = dt;
        const og = g(ctx, 0.28); o.connect(og); og.connect(vca);
        o.start(t); o.stop(t + dur + 0.9);
      });
      const ns = noiseSrc(ctx); const nf = flt(ctx, 'bandpass', 1600, 0.8); const ng = g(ctx, 0.02);
      ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(t); ns.stop(t + dur + 0.4);
      return susEnv(ctx, vca, t, dur, 0.24 * (0.5 + vel), 0.22, 0.35);
    }
  };

  /* ---------------- player ---------------- */
  function Player() {
    this.ctx = null;
    this.graph = null;
    this.comp = null;
    this.sources = [];
    this.timer = null;
    this.cursor = 0;
    this.startTime = 0;
    this.playing = false;
    this.onTick = null;
    this.onEnd = null;
  }

  Player.prototype.ensure = function () {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.graph = buildGraph(this.ctx);
    return this.ctx;
  };

  Player.prototype.load = function (comp) {
    this.stop();
    this.comp = comp;
    this.cursor = 0;
  };

  Player.prototype.play = function (from) {
    const ctx = this.ensure();
    if (ctx.state === 'suspended') ctx.resume();
    if (!this.comp) return;
    this.stop(true);
    this.playing = true;
    this.startTime = ctx.currentTime + 0.12 - (from || 0);
    this.cursor = 0;
    const ev = this.comp.events;
    const offset = from || 0;
    while (this.cursor < ev.length && ev[this.cursor].t < offset) this.cursor++;

    const pan = {};
    this.comp.meta.instruments.forEach((id, i) => {
      const n = this.comp.meta.instruments.length;
      pan[id + i] = n > 1 ? (i / (n - 1)) * 0.7 - 0.35 : 0;
    });

    const self = this;
    const lookahead = 0.55;
    function pump() {
      if (!self.playing) return;
      const now = self.ctx.currentTime;
      const horizon = now + lookahead;
      while (self.cursor < ev.length) {
        const e = ev[self.cursor];
        const when = self.startTime + e.t;
        if (when > horizon) break;
        self.fire(e, Math.max(now + 0.005, when));
        self.cursor++;
      }
      if (self.onTick) self.onTick(Math.max(0, now - self.startTime));
      if (self.cursor >= ev.length && now - self.startTime > self.comp.meta.duration) {
        self.playing = false;
        clearInterval(self.timer);
        self.timer = null;
        if (self.onEnd) self.onEnd();
        return;
      }
    }
    this.timer = setInterval(pump, 60);
    pump();
  };

  Player.prototype.fire = function (e, when) {
    const ctx = this.ctx;
    const fn = INSTR[e.inst] || INSTR.piano;
    const wet = WET[e.inst] !== undefined ? WET[e.inst] : 0.3;
    const pan = (e.voice === 'bass' ? -0.18 : e.voice === 'melody' ? 0.16 : e.voice === 'counter' ? -0.1 : 0);
    const ch = getChannel(ctx, this.graph, wet, pan);
    try {
      const end = fn(ctx, ch, when, e.d, e.midi, e.vel, e.art || 'legato');
      this.sources.push({ end });
    } catch (err) { /* a single bad note must never kill the piece */ }
  };

  Player.prototype.stop = function (keepComp) {
    this.playing = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.ctx && this.graph) {
      // rebuild the graph to silence everything instantly
      try {
        this.graph.master.gain.cancelScheduledValues(0);
        this.graph.master.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.02);
        const old = this.graph;
        setTimeout(() => { try { old.master.disconnect(); old.reverb.disconnect(); } catch (e) {} }, 220);
        this.graph = buildGraph(this.ctx);
      } catch (e) {}
    }
    this.sources = [];
    if (!keepComp && this.onEnd) { /* no-op */ }
  };

  /* ---------------- offline render to WAV ---------------- */
  function renderOffline(comp, onProgress) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const rate = 44100;
    const dur = comp.meta.duration + 3.2;
    const ctx = new OAC(2, Math.ceil(rate * dur), rate);
    const graph = buildGraph(ctx);
    const pan = {};
    const ev = comp.events;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      const fn = INSTR[e.inst] || INSTR.piano;
      const wet = WET[e.inst] !== undefined ? WET[e.inst] : 0.3;
      const p = (e.voice === 'bass' ? -0.18 : e.voice === 'melody' ? 0.16 : e.voice === 'counter' ? -0.1 : 0);
      const ch = getChannel(ctx, graph, wet, p);
      try { fn(ctx, ch, e.t + 0.05, e.d, e.midi, e.vel, e.art || 'legato'); } catch (err) {}
    }
    return ctx.startRendering().then((buf) => encodeWav(buf));
  }

  function encodeWav(buffer) {
    const numCh = buffer.numberOfChannels;
    const len = buffer.length;
    const rate = buffer.sampleRate;
    const bytes = 44 + len * numCh * 2;
    const ab = new ArrayBuffer(bytes);
    const view = new DataView(ab);
    function str(off, s) { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); }
    str(0, 'RIFF'); view.setUint32(4, bytes - 8, true); str(8, 'WAVE');
    str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, numCh, true); view.setUint32(24, rate, true);
    view.setUint32(28, rate * numCh * 2, true); view.setUint16(32, numCh * 2, true);
    view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, len * numCh * 2, true);
    const chans = [];
    for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
    let off = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = Math.max(-1, Math.min(1, chans[c][i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  root.AureaSynth = {
    Player,
    renderOffline,
    encodeWav,
    INSTR,
    PROGRAM,
    mtof
  };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
