/* =========================================================================
   AUREA — Standard MIDI File writer (SMF type 1)
   ========================================================================= */
(function (root) {
  'use strict';

  const PPQ = 480;

  function vlq(n) {
    const bytes = [n & 0x7f];
    n >>= 7;
    while (n > 0) { bytes.unshift((n & 0x7f) | 0x80); n >>= 7; }
    return bytes;
  }
  function str(s) { const a = []; for (let i = 0; i < s.length; i++) a.push(s.charCodeAt(i) & 0xff); return a; }
  function u32(n) { return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]; }
  function u16(n) { return [(n >>> 8) & 0xff, n & 0xff]; }

  const PROGRAM = {
    piano: 0, harpsichord: 6, organ: 19, harp: 46, guitar: 24, lute: 25,
    violin: 40, viola: 41, cello: 42, doublebass: 43,
    flute: 73, oboe: 68, clarinet: 71, bassoon: 70,
    horn: 60, trumpet: 56, timpani: 47, choir: 52
  };

  function write(comp) {
    const spb = 60 / comp.meta.tempo;
    const ticks = (sec) => Math.max(0, Math.round((sec / spb) * PPQ));

    // group events by instrument
    const byInst = {};
    for (const e of comp.events) {
      (byInst[e.inst] = byInst[e.inst] || []).push(e);
    }

    const tracks = [];

    // ---- tempo track
    let tempo = [];
    tempo = tempo.concat(vlq(0), [0xff, 0x51, 0x03,
      (Math.round(60000000 / comp.meta.tempo) >> 16) & 0xff,
      (Math.round(60000000 / comp.meta.tempo) >> 8) & 0xff,
      Math.round(60000000 / comp.meta.tempo) & 0xff]);
    // title + time signature
    const title = comp.meta.title;
    tempo = tempo.concat(vlq(0), [0xff, 0x03, title.length & 0x7f], str(title));
    const [num, den] = comp.meta.meter.split('/').map(Number);
    tempo = tempo.concat(vlq(0), [0xff, 0x58, 0x04, num, Math.log2(den), 24, 8]);
    tempo = tempo.concat(vlq(0), [0xff, 0x2f, 0x00]);
    tracks.push({ name: 'Tempo', data: tempo });

    // ---- one track per instrument
    let ch = 0;
    for (const inst in byInst) {
      const evs = byInst[inst].slice().sort((a, b) => a.t - b.t);
      const out = [];
      const name = inst;
      out.push(...vlq(0), [0xff, 0x03, name.length & 0x7f], ...str(name));
      out.push(...vlq(0), [0xc0 | (ch & 0x0f), PROGRAM[inst] !== undefined ? PROGRAM[inst] : 0]);

      // build absolute-tick note on/off pairs
      const pairs = [];
      for (const e of evs) {
        const on = ticks(e.t);
        const off = Math.max(on + 8, ticks(e.t + Math.max(0.06, e.d * 0.96)));
        pairs.push({ on, off, midi: e.midi, vel: Math.round(Math.max(0.05, Math.min(1, e.vel)) * 127) });
      }
      pairs.sort((a, b) => a.on - b.on || a.midi - b.midi);
      const msgs = [];
      for (const p of pairs) {
        msgs.push({ tick: p.on, type: 0x90, midi: p.midi, vel: p.vel });
        msgs.push({ tick: p.off, type: 0x80, midi: p.midi, vel: 0 });
      }
      msgs.sort((a, b) => a.tick - b.tick || a.type - b.type);

      let last = 0;
      for (const m of msgs) {
        out.push(...vlq(m.tick - last));
        out.push(m.type | (ch & 0x0f), m.midi & 0x7f, m.vel & 0x7f);
        last = m.tick;
      }
      out.push(...vlq(0), [0xff, 0x2f, 0x00]);
      tracks.push({ name, data: out });
      ch = (ch + 1) % 16;
      if (ch === 9) ch = 10; // skip the drum channel
    }

    // ---- assemble
    const header = [].concat(str('MThd'), u32(6), u16(1), u16(tracks.length), u16(PPQ));
    let all = header;
    for (const t of tracks) {
      all = all.concat(str('MTrk'), u32(t.data.length), t.data);
    }
    return new Blob([new Uint8Array(all)], { type: 'audio/midi' });
  }

  root.AureaMidi = { write, PPQ };
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
