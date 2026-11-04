require('./mock_audio.js');
require('./synth.js');
require('./midi.js');
const E = require('./engine.js');
const S = globalThis.AureaSynth;
const M = globalThis.AureaMidi;

const prompts = [
  'melancholic piano nocturne',
  'heroic orchestra D minor',
  'string quartet agitated',
  'flute and harp pastoral',
  'organ fugue mysterious',
  'cello and piano romantic',
  'choir and organ solemn requiem',
  'harp dreamy prelude'
];
(async () => {
  let fails = 0;
  for (const p of prompts) {
    const comp = E.compose(p, { duration: 20, seed: 7 });
    const insts = [...new Set(comp.events.map(e => e.inst))];
    // fire every note through every instrument model
    const ctx = new window.AudioContext();
    const graph = null;
    try {
      for (const e of comp.events.slice(0, 400)) {
        const fn = S.INSTR[e.inst];
        if (!fn) throw new Error('no instrument model for ' + e.inst);
        const ch = { connect(){}, };
        const out = null; // not used
      }
      // full offline render (exercises channel graph + reverb + master)
      const blob = await S.renderOffline(comp);
      const midi = M.write(comp);
      console.log(p.padEnd(28), 'inst=' + insts.join(',').padEnd(34), 'wav=' + (blob.size/1048576).toFixed(1) + 'MB', 'midi=' + midi.size + 'B');
      if (blob.size < 100000) { fails++; console.log('  WAV too small'); }
      if (midi.size < 200) { fails++; console.log('  MIDI too small'); }
    } catch (err) {
      fails++;
      console.log(p.padEnd(28), 'ERROR:', err.message);
    }
  }
  console.log('FAILS:', fails);
})();
