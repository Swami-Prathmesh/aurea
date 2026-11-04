const E = require('./engine.js');
const prompts = [
  "A melancholic nocturne for solo piano, slow and intimate",
  "Heroic symphony orchestra in D minor, triumphant, 2 minutes",
  "Gentle pastoral flute and harp, peaceful spring morning",
  "Agitated string quartet, stormy and dramatic, fast",
  "Serene cello and piano adagio in F major",
  "Mysterious organ fugue, dark and haunting",
  "Joyful waltz for chamber orchestra in G major",
  "A romantic violin and piano piece, tender and longing",
  "Epic orchestral march with timpani, majestic",
  "Dreamy harp prelude, ethereal and floating",
  "",
  "play something",
  "clarinet and bassoon playful scherzo 90 seconds",
];
let fails = 0;
for (const p of prompts) {
  const r = E.compose(p);
  const ev = r.events;
  const bad = ev.filter(e => !isFinite(e.t) || !isFinite(e.d) || !isFinite(e.midi) || !isFinite(e.vel) || e.midi < 20 || e.midi > 108 || e.d <= 0 || e.t < 0);
  const span = ev.length ? Math.max(...ev.map(e => e.t + e.d)) : 0;
  console.log(`${p.slice(0,42).padEnd(44)} | ${r.meta.instruments.join('+').padEnd(28)} | ${r.meta.form.padEnd(9)} ${r.meta.key} ${r.meta.modeId.padEnd(13)} ${String(r.meta.tempo).padStart(3)}bpm ${String(r.meta.bars).padStart(3)}bar ${r.meta.duration}s notes=${String(ev.length).padStart(5)} span=${span.toFixed(1)} bad=${bad.length}`);
  if (bad.length) { fails++; console.log('  ', JSON.stringify(bad[0])); }
  if (ev.length < 20) { fails++; console.log('   TOO FEW NOTES'); }
}
// determinism
const a = E.compose("melancholic piano nocturne", {seed: 42});
const b = E.compose("melancholic piano nocturne", {seed: 42});
console.log('deterministic:', JSON.stringify(a.events) === JSON.stringify(b.events));
console.log('FAILS:', fails);
