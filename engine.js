/* =========================================================================
   AUREA — Classical Music Engine
   A pure-JS generative composition engine: prompt parsing, functional
   harmony planning, motif-driven melody writing, species-style counterpoint,
   accompaniment figuration, dynamics and humanised timing.
   No DOM, no Web Audio, no network. Runs anywhere.
   ========================================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AureaEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* 1. Utilities                                                        */
  /* ------------------------------------------------------------------ */
  const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function makeRng(seed) {
    let a = typeof seed === 'number' ? seed >>> 0 : hashString(String(seed));
    const next = function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.range = (lo, hi) => lo + next() * (hi - lo);
    next.int = (lo, hi) => Math.floor(lo + next() * (hi - lo + 1));
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    next.chance = (p) => next() < p;
    next.sign = () => (next() < 0.5 ? -1 : 1);
    next.shuffle = (arr) => {
      const a2 = arr.slice();
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    };
    // pick from weighted list [{w, v}]
    next.weighted = (list) => {
      let total = 0;
      for (const it of list) total += it.w;
      let r = next() * total;
      for (const it of list) { r -= it.w; if (r <= 0) return it.v; }
      return list[list.length - 1].v;
    };
    return next;
  }

  /* ------------------------------------------------------------------ */
  /* 2. Music theory tables                                              */
  /* ------------------------------------------------------------------ */
  const MODES = {
    major:         { steps: [0, 2, 4, 5, 7, 9, 11], label: 'major' },
    minor:         { steps: [0, 2, 3, 5, 7, 8, 10], label: 'minor' },
    harmonicMinor: { steps: [0, 2, 3, 5, 7, 8, 11], label: 'minor' },
    dorian:        { steps: [0, 2, 3, 5, 7, 9, 10], label: 'Dorian' },
    phrygian:      { steps: [0, 1, 3, 5, 7, 8, 10], label: 'Phrygian' },
    lydian:        { steps: [0, 2, 4, 6, 7, 9, 11], label: 'Lydian' },
    mixolydian:    { steps: [0, 2, 4, 5, 7, 9, 10], label: 'Mixolydian' }
  };

  const MOODS = [
    { id: 'melancholic', label: 'melancholic',
      words: ['melancholy', 'melancholic', 'sad', 'sadness', 'sorrow', 'sorrowful', 'grief', 'grieving', 'lament', 'lamenting', 'mournful', 'weeping', 'tears', 'tearful', 'tragic', 'tragedy', 'heartbreak', 'heartbroken', 'regret', 'longing', 'yearning', 'wistful', 'lonely', 'solitude'],
      modes: ['minor', 'harmonicMinor', 'dorian'], tempo: [50, 66], dyn: [0.3, 0.62],
      density: 0.42, leap: 0.16, artic: 'legato', vibrato: 0.9, register: -1, rubato: 0.035 },
    { id: 'serene', label: 'serene',
      words: ['serene', 'serenity', 'calm', 'peaceful', 'peace', 'tranquil', 'gentle', 'soft', 'quiet', 'still', 'restful', 'soothing', 'tender', 'delicate', 'meditative', 'contemplative'],
      modes: ['major', 'lydian'], tempo: [56, 72], dyn: [0.26, 0.55],
      density: 0.38, leap: 0.14, artic: 'legato', vibrato: 0.5, register: 0, rubato: 0.03 },
    { id: 'joyful', label: 'joyful',
      words: ['joyful', 'joy', 'happy', 'happiness', 'cheerful', 'bright', 'sunny', 'delight', 'delightful', 'merry', 'festive', 'celebration', 'glad', 'radiant', 'buoyant', 'ebullient'],
      modes: ['major', 'mixolydian'], tempo: [104, 132], dyn: [0.5, 0.9],
      density: 0.62, leap: 0.3, artic: 'detache', vibrato: 0.6, register: 1, rubato: 0.015 },
    { id: 'heroic', label: 'heroic',
      words: ['heroic', 'hero', 'epic', 'triumphant', 'triumph', 'majestic', 'majesty', 'grand', 'grandiose', 'noble', 'valiant', 'victorious', 'powerful', 'bold', 'monumental', 'anthem'],
      modes: ['major', 'harmonicMinor'], tempo: [92, 118], dyn: [0.62, 1.0],
      density: 0.55, leap: 0.42, artic: 'marcato', vibrato: 1.0, register: 1, rubato: 0.01 },
    { id: 'agitated', label: 'agitated',
      words: ['agitated', 'agitation', 'angry', 'anger', 'furious', 'rage', 'storm', 'stormy', 'turbulent', 'frantic', 'restless', 'anxious', 'anxiety', 'tense', 'tension', 'violent', 'fierce', 'tumult', 'dramatic', 'drama', 'passionate', 'impassioned', 'turbulence'],
      modes: ['minor', 'harmonicMinor', 'phrygian'], tempo: [126, 168], dyn: [0.7, 1.0],
      density: 0.82, leap: 0.48, artic: 'marcato', vibrato: 1.1, register: 1, rubato: 0.008 },
    { id: 'mysterious', label: 'mysterious',
      words: ['mysterious', 'mystery', 'dark', 'darkness', 'ominous', 'haunting', 'haunted', 'eerie', 'shadow', 'shadowy', 'sinister', 'enigmatic', 'uncanny', 'nocturnal', 'midnight', 'gothic', 'suspense', 'tenebrous'],
      modes: ['minor', 'phrygian', 'harmonicMinor'], tempo: [54, 74], dyn: [0.28, 0.6],
      density: 0.4, leap: 0.22, artic: 'legato', vibrato: 0.8, register: -2, rubato: 0.03 },
    { id: 'romantic', label: 'romantic',
      words: ['romantic', 'romance', 'love', 'loving', 'passion', 'amorous', 'affection', 'devotion', 'intimate', 'sensuous', 'ardent', 'yearn', 'rapture'],
      modes: ['minor', 'major', 'harmonicMinor'], tempo: [60, 80], dyn: [0.36, 0.8],
      density: 0.5, leap: 0.28, artic: 'legato', vibrato: 1.0, register: 0, rubato: 0.045 },
    { id: 'solemn', label: 'solemn',
      words: ['solemn', 'solemnity', 'ceremonial', 'sacred', 'liturgical', 'requiem', 'elegy', 'funeral', 'dignified', 'reverent', 'devotional', 'hymn', 'processional', 'austere', 'grave'],
      modes: ['minor', 'dorian', 'harmonicMinor'], tempo: [56, 76], dyn: [0.42, 0.82],
      density: 0.34, leap: 0.18, artic: 'legato', vibrato: 0.7, register: -1, rubato: 0.025 },
    { id: 'dreamy', label: 'dreamy',
      words: ['dreamy', 'dream', 'dreaming', 'ethereal', 'floating', 'hazy', 'misty', 'mist', 'cloud', 'clouds', 'reverie', 'fantasy', 'magical', 'shimmer', 'shimmering', 'celestial', 'otherworldly', 'weightless', 'suspended'],
      modes: ['lydian', 'major', 'dorian'], tempo: [52, 70], dyn: [0.24, 0.55],
      density: 0.36, leap: 0.2, artic: 'legato', vibrato: 0.6, register: 1, rubato: 0.04 },
    { id: 'playful', label: 'playful',
      words: ['playful', 'play', 'whimsical', 'mischievous', 'cheeky', 'dance', 'dancing', 'lively', 'sprightly', 'bouncy', 'charming', 'graceful', 'scherzo', 'jest', 'wit'],
      modes: ['major', 'mixolydian'], tempo: [112, 146], dyn: [0.45, 0.85],
      density: 0.7, leap: 0.34, artic: 'staccato', vibrato: 0.5, register: 1, rubato: 0.012 },
    { id: 'pastoral', label: 'pastoral',
      words: ['pastoral', 'pasture', 'countryside', 'rural', 'meadow', 'shepherd', 'village', 'folk', 'rustic', 'bucolic', 'fields', 'harvest', 'spring'],
      modes: ['major', 'lydian', 'mixolydian'], tempo: [68, 92], dyn: [0.34, 0.7],
      density: 0.5, leap: 0.26, artic: 'detache', vibrato: 0.55, register: 0, rubato: 0.02 },
    { id: 'nostalgic', label: 'nostalgic',
      words: ['nostalgic', 'nostalgia', 'memory', 'memories', 'remember', 'reminisce', 'childhood', 'past', 'yesteryear', 'bittersweet', 'homesick', 'distant'],
      modes: ['major', 'minor', 'dorian'], tempo: [58, 78], dyn: [0.32, 0.68],
      density: 0.44, leap: 0.22, artic: 'legato', vibrato: 0.85, register: 0, rubato: 0.04 }
  ];

  const INSTRUMENTS = {
    violin:      { label: 'Violin',       lo: 55, hi: 96, family: 'strings' },
    viola:       { label: 'Viola',        lo: 48, hi: 88, family: 'strings' },
    cello:       { label: 'Cello',        lo: 36, hi: 76, family: 'strings' },
    doublebass:  { label: 'Double Bass',  lo: 28, hi: 60, family: 'strings' },
    flute:       { label: 'Flute',        lo: 60, hi: 96, family: 'woodwind' },
    oboe:        { label: 'Oboe',         lo: 58, hi: 91, family: 'woodwind' },
    clarinet:    { label: 'Clarinet',     lo: 50, hi: 88, family: 'woodwind' },
    bassoon:     { label: 'Bassoon',      lo: 34, hi: 72, family: 'woodwind' },
    horn:        { label: 'French Horn',  lo: 41, hi: 77, family: 'brass' },
    trumpet:     { label: 'Trumpet',      lo: 55, hi: 86, family: 'brass' },
    piano:       { label: 'Piano',        lo: 28, hi: 100, family: 'keyboard' },
    harpsichord: { label: 'Harpsichord',  lo: 36, hi: 96, family: 'keyboard' },
    organ:       { label: 'Organ',        lo: 36, hi: 91, family: 'keyboard' },
    harp:        { label: 'Harp',         lo: 33, hi: 96, family: 'plucked' },
    guitar:      { label: 'Guitar',       lo: 40, hi: 88, family: 'plucked' },
    lute:        { label: 'Lute',         lo: 43, hi: 86, family: 'plucked' },
    timpani:     { label: 'Timpani',      lo: 36, hi: 55, family: 'percussion' },
    choir:       { label: 'Choir',        lo: 48, hi: 84, family: 'voice' }
  };

  const INSTRUMENT_WORDS = {
    violin: ['violin', 'violins', 'fiddle'],
    viola: ['viola', 'violas'],
    cello: ['cello', 'cellos', 'violoncello'],
    doublebass: ['double bass', 'double-bass', 'contrabass', 'upright bass'],
    flute: ['flute', 'flutes', 'piccolo'],
    oboe: ['oboe', 'oboes'],
    clarinet: ['clarinet', 'clarinets'],
    bassoon: ['bassoon', 'bassoons'],
    horn: ['french horn', 'horn', 'horns'],
    trumpet: ['trumpet', 'trumpets'],
    piano: ['piano', 'pianoforte', 'grand piano'],
    harpsichord: ['harpsichord', 'clavecin', 'cembalo'],
    organ: ['organ', 'pipe organ'],
    harp: ['harp', 'harps'],
    guitar: ['guitar', 'classical guitar', 'nylon guitar'],
    lute: ['lute', 'lutes'],
    timpani: ['timpani', 'kettledrum', 'kettle drum'],
    choir: ['choir', 'chorus', 'voices', 'vocal', 'chant', 'soprano', 'chorale']
  };

  const ENSEMBLES = [
    { words: ['string quartet', 'quartet'], instruments: ['violin', 'violin', 'viola', 'cello'] },
    { words: ['piano trio'], instruments: ['violin', 'cello', 'piano'] },
    { words: ['string trio'], instruments: ['violin', 'viola', 'cello'] },
    { words: ['wind quintet'], instruments: ['flute', 'oboe', 'clarinet', 'bassoon', 'horn'] },
    { words: ['brass quintet'], instruments: ['trumpet', 'trumpet', 'horn', 'bassoon', 'doublebass'] },
    { words: ['full orchestra', 'symphony orchestra', 'symphonic', 'orchestra', 'orchestral'],
      instruments: ['violin', 'viola', 'cello', 'doublebass', 'flute', 'oboe', 'clarinet', 'horn', 'timpani'] },
    { words: ['chamber orchestra', 'chamber ensemble', 'chamber'],
      instruments: ['violin', 'viola', 'cello', 'flute', 'clarinet'] },
    { words: ['string orchestra', 'strings', 'string section'],
      instruments: ['violin', 'violin', 'viola', 'cello', 'doublebass'] },
    { words: ['piano and cello', 'cello and piano'], instruments: ['cello', 'piano'] },
    { words: ['piano and violin', 'violin and piano'], instruments: ['violin', 'piano'] },
    { words: ['solo piano', 'piano solo'], instruments: ['piano'] }
  ];

  const FORMS = [
    { id: 'nocturne', words: ['nocturne', 'night piece', 'notturno'], meter: [4, 4], tempoMul: 0.94, fig: 'arp', sections: ['A', 'A', 'B', 'A', 'coda'] },
    { id: 'waltz', words: ['waltz', 'valse', 'viennese'], meter: [3, 4], tempoMul: 1.06, fig: 'waltz', sections: ['A', 'A', 'B', 'A', 'B', 'A'] },
    { id: 'march', words: ['march', 'marcia', 'processional'], meter: [4, 4], tempoMul: 1.0, fig: 'march', sections: ['A', 'A', 'B', 'A', 'coda'] },
    { id: 'fugue', words: ['fugue', 'fugal', 'fugato'], meter: [4, 4], tempoMul: 0.98, fig: 'counter', sections: ['A', 'A', 'B', 'A'] },
    { id: 'prelude', words: ['prelude', 'preludium'], meter: [4, 4], tempoMul: 1.0, fig: 'arp', sections: ['A', 'B', 'A', 'coda'] },
    { id: 'sonata', words: ['sonata', 'sonatina'], meter: [4, 4], tempoMul: 1.0, fig: 'alberti', sections: ['A', 'A', 'B', 'B', 'A', 'coda'] },
    { id: 'adagio', words: ['adagio', 'largo', 'lento'], meter: [4, 4], tempoMul: 0.82, fig: 'sustain', sections: ['A', 'A', 'B', 'A', 'coda'] },
    { id: 'etude', words: ['etude', 'étude', 'study'], meter: [4, 4], tempoMul: 1.08, fig: 'arp', sections: ['A', 'A', 'B', 'A'] },
    { id: 'minuet', words: ['minuet', 'menuet', 'gavotte', 'sarabande'], meter: [3, 4], tempoMul: 0.96, fig: 'waltz', sections: ['A', 'A', 'B', 'A'] },
    { id: 'aria', words: ['aria', 'song', 'cantilena', 'romanza', 'lied'], meter: [4, 4], tempoMul: 0.92, fig: 'sustain', sections: ['A', 'A', 'B', 'A', 'coda'] },
    { id: 'rondo', words: ['rondo', 'rondeau'], meter: [4, 4], tempoMul: 1.04, fig: 'alberti', sections: ['A', 'B', 'A', 'B', 'A'] },
    { id: 'variations', words: ['variations', 'theme and variations', 'chaconne', 'passacaglia'], meter: [4, 4], tempoMul: 1.0, fig: 'arp', sections: ['A', 'A', 'B', 'A', 'B', 'A'] },
    { id: 'toccata', words: ['toccata', 'fantasia', 'capriccio', 'impromptu'], meter: [4, 4], tempoMul: 1.1, fig: 'arp', sections: ['A', 'B', 'A', 'coda'] },
    { id: 'serenade', words: ['serenade', 'divertimento', 'cassation'], meter: [4, 4], tempoMul: 0.98, fig: 'alberti', sections: ['A', 'A', 'B', 'A', 'coda'] },
    { id: 'scherzo', words: ['scherzo', 'joke', 'caprice'], meter: [3, 4], tempoMul: 1.24, fig: 'waltz', sections: ['A', 'A', 'B', 'A', 'B', 'A'] },
    { id: 'siciliana', words: ['siciliana', 'siciliano', 'barcarolle', 'barcarola'], meter: [4, 4], tempoMul: 0.86, fig: 'arp', sections: ['A', 'A', 'B', 'A'] },
    { id: 'berceuse', words: ['berceuse', 'lullaby', 'cradle'], meter: [3, 4], tempoMul: 0.78, fig: 'waltz', sections: ['A', 'A', 'B', 'A', 'coda'] }
  ];

  const MAJOR_PROGRESSIONS = [
    [1, 4, 5, 1], [1, 6, 4, 5], [1, 5, 6, 4], [6, 4, 1, 5], [1, 2, 5, 1],
    [1, 3, 4, 5], [4, 1, 5, 1], [1, 4, 2, 5], [1, 5, 4, 5], [6, 2, 5, 1],
    [1, 4, 1, 5], [3, 6, 2, 5]
  ];
  const MINOR_PROGRESSIONS = [
    [1, 4, 5, 1], [1, 6, 3, 7], [1, 4, 7, 3], [1, 7, 6, 5], [1, 4, 5, 7],
    [1, 6, 4, 5], [1, 5, 6, 4], [1, 3, 6, 5], [1, 4, 1, 5]
  ];

  /* Rhythm cells: arrays of beat durations that fill one bar of 4/4 */
  const CELLS_4 = [
    [1, 1, 1, 1], [1.5, 0.5, 1, 1], [1, 0.5, 0.5, 1, 1], [2, 1, 1],
    [1, 1, 2], [1.5, 1.5, 1], [3, 1], [0.5, 0.5, 1, 1, 1],
    [2, 2], [1.5, 0.5, 2], [1, 1, 0.5, 0.5, 1], [0.5, 0.5, 0.5, 0.5, 2]
  ];
  const CELLS_3 = [[1, 1, 1], [1.5, 0.5, 1], [1, 2], [2, 1], [0.5, 0.5, 1, 1], [3], [1, 0.5, 0.5, 1]];
  const CELLS_FAST = [[0.5, 0.5, 0.5, 0.5, 1, 1], [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1], [1, 0.5, 0.5, 1, 1], [0.5, 0.5, 1, 0.5, 0.5, 1]];

  /* ------------------------------------------------------------------ */
  /* 3. Prompt parsing                                                   */
  /* ------------------------------------------------------------------ */
  function parsePrompt(text, rng, opts) {
    opts = opts || {};
    rng = rng || makeRng(String(text || ''));
    const raw = String(text || '');
    const t = ' ' + raw.toLowerCase().replace(/[^\w\s#-]/g, ' ').replace(/\s+/g, ' ') + ' ';

    const found = { mood: null, moodScore: 0 };
    for (const m of MOODS) {
      let score = 0;
      for (const w of m.words) {
        if (t.indexOf(' ' + w) >= 0) score += w.length > 5 ? 2 : 1;
      }
      if (score > found.moodScore) { found.mood = m; found.moodScore = score; }
    }
    let mood = found.mood || (rng.chance(0.5) ? MOODS[1] : MOODS[0]);
    const moodFromText = !!found.mood;

    // ---- form
    let form = null;
    for (const f of FORMS) {
      if (f.words.some((w) => t.indexOf(w) >= 0)) { form = f; break; }
    }
    const formFromText = !!form;
    if (!form) {
      const preferred = {
        melancholic: ['nocturne', 'aria', 'adagio'],
        serene: ['adagio', 'berceuse', 'prelude'],
        joyful: ['rondo', 'waltz', 'sonata'],
        heroic: ['sonata', 'march', 'toccata'],
        agitated: ['toccata', 'sonata', 'prelude'],
        mysterious: ['nocturne', 'fugue', 'prelude'],
        romantic: ['aria', 'nocturne', 'serenade'],
        solemn: ['adagio', 'march', 'variations'],
        dreamy: ['prelude', 'berceuse', 'nocturne'],
        playful: ['scherzo', 'rondo', 'waltz'],
        pastoral: ['serenade', 'sonata', 'waltz'],
        nostalgic: ['nocturne', 'aria', 'variations']
      }[mood.id] || ['nocturne', 'aria', 'sonata'];
      const pool = FORMS.filter((f) => preferred.indexOf(f.id) >= 0);
      form = pool.length ? rng.pick(pool) : rng.pick(FORMS);
    }

    // ---- key
    let tonic = null;
    let modeName = null;
    const keyRe = /\b(c#|db|d|d#|eb|e|f|f#|gb|g|g#|ab|a|a#|bb|b)\s*(minor|major|min|maj|m)\b/;
    const km = t.match(keyRe);
    if (km) {
      const map = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11 };
      const name = km[1];
      const q = km[2];
      if (map[name] !== undefined) {
        tonic = map[name];
        modeName = q[0] === 'm' && q !== 'major' && q !== 'maj' ? 'minor' : 'major';
      }
    }
    if (tonic === null) tonic = rng.int(0, 11);

    // ---- mode
    let mode;
    if (modeName === 'major') mode = 'major';
    else if (modeName === 'minor') mode = rng.chance(0.3) ? 'harmonicMinor' : 'minor';
    else mode = rng.pick(mood.modes);
    // church modes only when no explicit key quality was given
    const modeFromText = !!modeName;
    if (!modeName && (mode === 'lydian' || mode === 'mixolydian' || mode === 'phrygian' || mode === 'dorian') && rng.chance(0.45)) {
      mode = (mode === 'phrygian' || mode === 'dorian') ? 'minor' : 'major';
    }

    // ---- tempo
    let tempo = rng.range(mood.tempo[0], mood.tempo[1]);
    const bpmMatch = t.match(/(\d{2,3})\s*(bpm|beats per minute)/);
    if (bpmMatch) tempo = clamp(parseInt(bpmMatch[1], 10), 36, 200);
    else if (/\b(fast|quick|allegro|presto|vivace)\b/.test(t)) tempo = clamp(tempo * 1.28, 60, 190);
    else if (/\b(slow|slowly|adagio|largo|grave|solemnly)\b/.test(t)) tempo = clamp(tempo * 0.76, 40, 120);
    tempo = tempo * form.tempoMul;
    tempo = Math.round(clamp(tempo, 38, 190));

    // ---- duration
    let duration = 72;
    const minMatch = t.match(/(\d+(?:\.\d+)?)\s*(minute|min|minutes)/);
    const secMatch = t.match(/(\d{2,4})\s*(second|seconds|sec|s)\b/);
    if (minMatch) duration = parseFloat(minMatch[1]) * 60;
    else if (secMatch) duration = parseFloat(secMatch[1]);
    duration = clamp(duration, 20, 300);

    // ---- instruments
    let instruments = [];
    for (const f of ENSEMBLES) {
      if (f.words.some((w) => t.indexOf(w) >= 0)) { instruments = f.instruments.slice(); break; }
    }
    if (!instruments.length) {
      const hits = [];
      for (const id in INSTRUMENT_WORDS) {
        if (INSTRUMENT_WORDS[id].some((w) => t.indexOf(w) >= 0)) hits.push(id);
      }
      if (hits.length) instruments = hits.slice(0, 6);
    }
    const instFromText = instruments.length > 0;
    if (!instruments.length) {
      instruments = rng.pick([
        ['piano'], ['violin', 'piano'], ['cello', 'piano'], ['violin', 'viola', 'cello'],
        ['flute', 'harp'], ['violin', 'cello'], ['harp'], ['clarinet', 'piano'], ['organ']
      ]);
    }
    // de-duplicate but keep doubled violins for quartets
    const seen = {};
    instruments = instruments.filter((id) => {
      if (!INSTRUMENTS[id]) return false;
      seen[id] = (seen[id] || 0) + 1;
      return seen[id] <= 2;
    });
    if (!instruments.length) instruments = ['piano'];

    // ---- dynamics / articulation tweaks from explicit words
    let dynScale = 1;
    if (/\b(soft|quiet|whisper|pianissimo|delicate|subtle)\b/.test(t)) dynScale = 0.72;
    if (/\b(loud|powerful|thunder|fortissimo|blazing|mighty)\b/.test(t)) dynScale = 1.2;
    if (/\b(staccato|detache|detach|short|plucked|pizzicato)\b/.test(t)) dynScale *= 0.95;

    // ---- learned priors: what this instrument has been taught about these words
    const L = opts.learned;
    if (L) {
      if (!moodFromText && L.moodId) {
        const m = MOODS.find((x) => x.id === L.moodId);
        if (m) mood = m;
      }
      if (!formFromText && L.formId) {
        const f = FORMS.find((x) => x.id === L.formId);
        if (f) form = f;
      }
      if (!modeFromText && L.mode && MODES[L.mode]) mode = L.mode;
      if (!instFromText && L.instruments && L.instruments.length) instruments = L.instruments.slice();
      if (L.tempo && L.strength > 0.5) tempo = Math.round(clamp(tempo * 0.6 + L.tempo * 0.4, 38, 190));
    }

    // ---- explicit overrides (used to reproduce a shared piece exactly)
    const F = opts.force;
    if (F) {
      if (F.moodId) { const m = MOODS.find((x) => x.id === F.moodId); if (m) mood = m; }
      if (F.formId) { const f = FORMS.find((x) => x.id === F.formId); if (f) form = f; }
      if (F.mode && MODES[F.mode]) mode = F.mode;
      if (typeof F.tonic === 'number') tonic = F.tonic;
      if (F.tempo) tempo = F.tempo;
      if (F.instruments && F.instruments.length) instruments = F.instruments.slice();
    }

    const articWord = /\b(staccato|pizzicato|plucked)\b/.test(t) ? 'staccato'
      : /\b(marcato|accent|accented|punchy)\b/.test(t) ? 'marcato'
      : /\b(legato|smooth|flowing|slurred)\b/.test(t) ? 'legato'
      : mood.artic;

    return {
      raw,
      mood,
      form,
      tonic,
      mode,
      tempo,
      duration,
      instruments,
      dynScale,
      articulation: articWord,
      density: clamp(mood.density + (tempo > 120 ? 0.1 : 0) - (tempo < 60 ? 0.08 : 0), 0.2, 0.95),
      leap: mood.leap,
      register: mood.register,
      vibrato: mood.vibrato,
      rubato: mood.rubato
    };
  }

  /* ------------------------------------------------------------------ */
  /* 4. Harmony                                                          */
  /* ------------------------------------------------------------------ */
  function buildLadder(tonicMidi, mode, octaves) {
    const steps = MODES[mode].steps;
    const arr = [];
    for (let o = 0; o < octaves; o++) {
      for (let s = 0; s < 7; s++) arr.push(tonicMidi + o * 12 + steps[s]);
    }
    return arr;
  }

  function chordPitches(degree, ladder, octIdx, mode) {
    const i = octIdx * 7 + (degree - 1);
    const a = ladder[i], b = ladder[i + 2], c = ladder[i + 4];
    const notes = [a, b, c];
    // In natural minor, borrow the raised leading tone so V is a true dominant.
    if ((mode === 'minor' || mode === 'dorian') && degree === 5) notes[1] = b + 1;
    if ((mode === 'minor') && degree === 7) notes[2] = c + 1;
    return notes;
  }

  function planHarmony(totalBars, P, rng) {
    const bank = (P.mode === 'major' || P.mode === 'lydian' || P.mode === 'mixolydian')
      ? MAJOR_PROGRESSIONS : MINOR_PROGRESSIONS;
    const degrees = [];
    let guard = 0;
    while (degrees.length < totalBars && guard++ < 200) {
      const prog = rng.pick(bank).slice();
      if (rng.chance(0.35)) prog[prog.length - 1] = rng.pick([1, 5]);
      for (const d of prog) {
        if (degrees.length >= totalBars) break;
        degrees.push(d);
      }
    }
    // Force a cadence at the end: V -> I over the last two bars.
    if (totalBars >= 4) {
      degrees[totalBars - 2] = 5;
      degrees[totalBars - 1] = 1;
    }
    // Cadence every 8 bars
    for (let b = 7; b < totalBars - 2; b += 8) {
      degrees[b - 1] = 5;
      degrees[b] = 1;
    }
    return degrees;
  }

  /* ------------------------------------------------------------------ */
  /* 5. Voice writing                                                    */
  /* ------------------------------------------------------------------ */
  function rangeIndices(ladder, lo, hi) {
    let a = 0, b = ladder.length - 1;
    for (let i = 0; i < ladder.length; i++) { if (ladder[i] >= lo) { a = i; break; } }
    for (let i = ladder.length - 1; i >= 0; i--) { if (ladder[i] <= hi) { b = i; break; } }
    return [a, Math.max(a + 4, b)];
  }

  function pickCell(P, rng, beats) {
    const fast = P.tempo > 108 && P.density > 0.6;
    const pool = beats === 3 ? CELLS_3 : (fast && rng.chance(0.5) ? CELLS_FAST : CELLS_4);
    // filter by density preference
    const scored = pool.map((c) => ({
      v: c,
      w: 1 / (1 + Math.abs(c.length / beats - P.density) * 3)
    }));
    return rng.weighted(scored).slice();
  }

  function makeMelody(opts) {
    const { bars, ladder, degrees, octIdx, P, rng, lo, hi, motif } = opts;
    const events = [];
    const beats = P.meterBeats;
    let prevIdx = clamp(Math.round((lo + hi) / 2) + 7, lo, hi);
    const notes = [];
    const cellCache = [];

    for (let b = 0; b < bars; b++) {
      const deg = degrees[b];
      const chord = chordPitches(deg, ladder, octIdx, P.mode);
      const pcs = chord.map((n) => ((n % 12) + 12) % 12);
      let cell;
      if (motif && motif.cells && motif.cells[b]) cell = motif.cells[b].slice();
      else {
        cell = cellCache[b] || pickCell(P, rng, beats);
        if (motif && motif.cells) motif.cells[b] = cell.slice();
      }
      // phrase arch target
      const phrasePos = (b % 4) / 3;
      const arch = Math.sin(Math.PI * phrasePos) * (hi - lo) * 0.22;
      let target = (lo + hi) / 2 + arch + P.register * 2;
      target = clamp(target, lo + 1, hi - 1);

      let beatPos = 0;
      for (let k = 0; k < cell.length; k++) {
        const dur = cell[k];
        const strong = beatPos === 0 || Math.abs(beatPos - Math.round(beatPos)) < 1e-6 && Math.round(beatPos) % 2 === 0;
        const isFinal = b === bars - 1 && k === cell.length - 1;

        let best = prevIdx, bestScore = -1e9;
        const lastDelta = notes.length > 1 ? notes[notes.length - 1].idx - notes[notes.length - 2].idx : 0;
        const repeating = notes.length > 0 && notes[notes.length - 1].idx === prevIdx;
        const trials = 10;
        for (let s = 0; s < trials; s++) {
          let delta;
          if (s === 0) delta = 0;
          else {
            // interval preference: seconds dominate, leaps are the exception
            const mag = rng.weighted([
              { w: 54, v: 1 }, { w: 22, v: 2 }, { w: 12, v: 3 }, { w: 5, v: 4 }, { w: 3, v: 5 }, { w: 1.5, v: 6 }
            ]);
            delta = rng.sign() * mag;
            if (rng.chance(P.leap * 0.55)) delta = rng.sign() * rng.int(3, 6);
            // a leap is normally answered by a step in the opposite direction
            if (Math.abs(lastDelta) >= 3 && rng.chance(0.78)) delta = -Math.sign(lastDelta) * rng.int(1, 2);
          }
          let cand = prevIdx + delta;
          if (cand > hi) cand = hi - (cand - hi);   // reflect at the compass edges
          if (cand < lo) cand = lo + (lo - cand);
          cand = clamp(cand, lo, hi);
          const midi = ladder[cand];
          const pc = ((midi % 12) + 12) % 12;
          const isChordTone = pcs.indexOf(pc) >= 0;
          let score = 0;
          if (isChordTone) score += strong ? 2.1 : 0.9;
          if (strong && !isChordTone) score -= 1.1;
          const step = Math.abs(cand - prevIdx);
          if (step === 0) score -= (delta === 0 ? (repeating ? 6.5 : 1.6) : 6);
          else if (step === 1) score += 2.4;
          else if (step === 2) score += 1.3;
          else if (step === 3) score += 0.2;
          else if (step === 4) score -= 0.8;
          else if (step >= 5) score -= 2.0;
          score -= Math.abs(cand - target) * 0.3;
          if (cand < lo || cand > hi) score -= 6;
          if (isFinal) score += (pc === ((ladder[octIdx * 7] % 12) + 12) % 12) ? 4 : -1;
          score += rng() * 0.55;
          if (score > bestScore) { bestScore = score; best = cand; }
        }
        prevIdx = best;
        notes.push({ beat: b * beats + beatPos, dur: dur, idx: best, strong: strong });
        beatPos += dur;
      }
    }
    return notes;
  }

  function makeCounter(melody, opts) {
    const { ladder, degrees, octIdx, P, rng, lo, hi, bars } = opts;
    const out = [];
    let prev = clamp(Math.round((lo + hi) / 2), lo, hi);
    let beat = 0;
    const beats = P.meterBeats;
    for (let b = 0; b < bars; b++) {
      const chord = chordPitches(degrees[b], ladder, octIdx, P.mode);
      const pcs = chord.map((n) => ((n % 12) + 12) % 12);
      const barMel = melody.filter((n) => n.beat >= b * beats && n.beat < (b + 1) * beats);
      const melDir = barMel.length > 1 ? Math.sign(barMel[barMel.length - 1].idx - barMel[0].idx) : 0;
      // two notes per bar, half-note motion, contrary to the melody where possible
      for (let k = 0; k < 2; k++) {
        const at = b * beats + k * (beats / 2);
        let best = prev, bestScore = -1e9;
        for (let s = 0; s < 8; s++) {
          const cand = clamp(prev + rng.sign() * rng.int(1, 3), lo, hi);
          const midi = ladder[cand];
          const pc = ((midi % 12) + 12) % 12;
          let score = (pcs.indexOf(pc) >= 0 ? 3 : -0.5);
          score -= Math.abs(cand - prev) * 0.3;
          if (melDir !== 0) score += Math.sign(cand - prev) === -melDir ? 1.1 : -0.4;
          score += rng() * 0.5;
          if (score > bestScore) { bestScore = score; best = cand; }
        }
        prev = best;
        out.push({ beat: at, dur: beats / 2, idx: best, voice: 1 });
      }
    }
    return out;
  }

  function makeBass(degrees, opts) {
    const { ladder, octIdx, P, rng, bars } = opts;
    const out = [];
    const beats = P.meterBeats;
    for (let b = 0; b < bars; b++) {
      const deg = degrees[b];
      const chord = chordPitches(deg, ladder, octIdx, P.mode);
      const root = chord[0];
      if (beats === 3) {
        out.push({ beat: b * beats, dur: 1, midi: root, vel: 1 });
        out.push({ beat: b * beats + 1, dur: 1, midi: chord[2], vel: 0.7 });
        out.push({ beat: b * beats + 2, dur: 1, midi: chord[1], vel: 0.65 });
      } else if (P.form.fig === 'march') {
        out.push({ beat: b * beats, dur: 1, midi: root, vel: 1 });
        out.push({ beat: b * beats + 1, dur: 0.5, midi: root, vel: 0.6 });
        out.push({ beat: b * beats + 2, dur: 1, midi: chord[2] - 12, vel: 0.85 });
        out.push({ beat: b * beats + 3, dur: 1, midi: chord[1], vel: 0.7 });
      } else {
        out.push({ beat: b * beats, dur: 2, midi: root, vel: 1 });
        if (beats >= 4) {
          out.push({ beat: b * beats + 2, dur: 1.5, midi: rng.chance(0.6) ? chord[2] - 12 : chord[1], vel: 0.72 });
          if (P.density > 0.55) out.push({ beat: b * beats + 3.5, dur: 0.5, midi: root, vel: 0.55 });
        }
      }
    }
    return out;
  }

  function makeAccompaniment(degrees, opts) {
    const { ladder, octIdx, P, rng, bars } = opts;
    const out = [];
    const beats = P.meterBeats;
    const fig = P.form.fig;
    for (let b = 0; b < bars; b++) {
      const chord = chordPitches(degrees[b], ladder, octIdx, P.mode);
      const [r, th, fi] = chord;
      if (fig === 'waltz' || beats === 3) {
        out.push({ beat: b * beats, dur: 1, midi: r - 12, vel: 0.95 });
        out.push({ beat: b * beats + 1, dur: 0.9, midi: th, vel: 0.6 });
        out.push({ beat: b * beats + 1, dur: 0.9, midi: fi, vel: 0.55 });
        out.push({ beat: b * beats + 2, dur: 0.9, midi: th, vel: 0.6 });
        out.push({ beat: b * beats + 2, dur: 0.9, midi: fi, vel: 0.55 });
      } else if (fig === 'alberti') {
        const seq = [r - 12, fi, th, fi, r - 12, fi, th, fi];
        const step = 0.5;
        for (let i = 0; i < 8; i++) out.push({ beat: b * beats + i * step, dur: step * 0.95, midi: seq[i], vel: i % 2 === 0 ? 0.7 : 0.52 });
      } else if (fig === 'arp') {
        const seq = [r - 12, th, fi, th + 12, fi, th, fi, th + 12];
        const step = beats / seq.length;
        for (let i = 0; i < seq.length; i++) out.push({ beat: b * beats + i * step, dur: step * 1.1, midi: seq[i], vel: 0.45 + (i === 0 ? 0.25 : 0) });
      } else if (fig === 'sustain') {
        out.push({ beat: b * beats, dur: beats * 0.98, midi: r - 12, vel: 0.7 });
        out.push({ beat: b * beats, dur: beats * 0.98, midi: th, vel: 0.45 });
        out.push({ beat: b * beats, dur: beats * 0.98, midi: fi, vel: 0.42 });
      } else { // counter / march / default: block chords on strong beats
        out.push({ beat: b * beats, dur: beats / 2, midi: r, vel: 0.65 });
        out.push({ beat: b * beats, dur: beats / 2, midi: th, vel: 0.5 });
        out.push({ beat: b * beats, dur: beats / 2, midi: fi, vel: 0.48 });
        out.push({ beat: b * beats + beats / 2, dur: beats / 2, midi: r, vel: 0.55 });
        out.push({ beat: b * beats + beats / 2, dur: beats / 2, midi: th, vel: 0.42 });
        out.push({ beat: b * beats + beats / 2, dur: beats / 2, midi: fi, vel: 0.4 });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 6. Roles                                                            */
  /* ------------------------------------------------------------------ */
  const LEAD_PRIORITY = ['violin', 'flute', 'oboe', 'clarinet', 'trumpet', 'viola', 'cello', 'piano', 'harpsichord', 'organ', 'harp', 'guitar', 'lute', 'choir', 'horn', 'bassoon', 'doublebass', 'timpani'];
  const COUNTER_PRIORITY = ['viola', 'cello', 'horn', 'clarinet', 'bassoon', 'oboe', 'violin', 'piano', 'harpsichord', 'harp', 'guitar', 'lute', 'organ', 'choir', 'flute', 'trumpet'];
  const BASS_PRIORITY = ['doublebass', 'cello', 'bassoon', 'organ', 'piano', 'harp', 'lute', 'guitar', 'timpani', 'viola'];

  function pickByPriority(voices, priority) {
    for (const id of priority) {
      const hit = voices.find((v) => v.id === id && !v.role);
      if (hit) return hit;
    }
    return null;
  }

  function assignRoles(instruments) {
    const list = instruments.map((id, i) => ({
      id, index: i,
      center: (INSTRUMENTS[id].lo + INSTRUMENTS[id].hi) / 2,
      lo: INSTRUMENTS[id].lo,
      hi: INSTRUMENTS[id].hi,
      family: INSTRUMENTS[id].family,
      role: null
    }));
    const byRange = list.slice().sort((a, b) => b.center - a.center);
    const keyboardish = (v) => v.family === 'keyboard' || v.family === 'plucked';

    if (list.length === 1) {
      const v = list[0];
      v.role = keyboardish(v) ? 'solo' : 'melody';
      if (!keyboardish(v)) v.duet = true;   // unaccompanied line gets a second voice
      return byRange;
    }

    if (list.length === 2) {
      const kb = byRange.find(keyboardish);
      const other = byRange.find((v) => v !== kb);
      if (kb && other) { kb.role = 'accomp'; other.role = 'melody'; }
      else { byRange[0].role = 'melody'; byRange[1].role = 'bass'; }
      return byRange;
    }

    // larger ensembles: lead, counter-line, bass, and the rest sustain the harmony
    const lead = pickByPriority(byRange, LEAD_PRIORITY) || byRange[0];
    lead.role = 'melody';
    const bass = pickByPriority(byRange, BASS_PRIORITY);
    if (bass) bass.role = 'bass';
    const counter = pickByPriority(byRange, COUNTER_PRIORITY);
    if (counter) counter.role = 'counter';
    const spareKeyboard = byRange.find((v) => !v.role && keyboardish(v));
    if (spareKeyboard) spareKeyboard.role = 'accomp';
    byRange.forEach((v) => { if (!v.role) v.role = v.id === 'timpani' ? 'perc' : 'pad'; });
    return byRange;
  }

  // Inner voices: hold the harmony, doubling the chord tone nearest the player.
  function makePad(degrees, opts) {
    const { ladder, P, bars, center, tonicMidi } = opts;
    const out = [];
    const beats = P.meterBeats;
    for (let b = 0; b < bars; b++) {
      const octIdx = clamp(Math.floor((center - tonicMidi) / 12), 0, 4);
      const chord = chordPitches(degrees[b], ladder, octIdx, P.mode);
      let best = chord[0], bd = 1e9;
      for (const n of chord) {
        const d = Math.abs(n - center);
        if (d < bd) { bd = d; best = n; }
      }
      while (best < center - 7 && best + 12 <= 104) best += 12;
      while (best > center + 7 && best - 12 >= 26) best -= 12;
      out.push({ beat: b * beats, dur: beats * 0.98, midi: best, vel: 0.3 });
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 7. Compose                                                          */
  /* ------------------------------------------------------------------ */
  function compose(promptText, options) {
    options = options || {};
    const seedStr = String(promptText || '') + '::' + (options.seed != null ? options.seed : '');
    const rng = makeRng(seedStr);
    const P = parsePrompt(promptText, rng, { learned: options.learned, force: options.force });
    P.meterBeats = P.form.meter[0];
    P.meterUnit = P.form.meter[1];

    const secPerBeat = 60 / P.tempo;
    const barDur = P.meterBeats * secPerBeat;
    const wantDur = options.duration || P.duration;
    const rawBars = Math.round(wantDur / barDur);
    const unit = P.meterBeats === 3 ? 4 : 4;
    const minBars = wantDur <= 45 ? 4 : 8;
    let totalBars = Math.max(minBars, Math.round(rawBars / unit) * unit);
    while (totalBars > minBars && totalBars * barDur > wantDur * 1.22) totalBars -= unit;
    totalBars = Math.min(totalBars, 120);

    const tonicMidi = 48 + P.tonic; // C3 based
    const ladder = buildLadder(tonicMidi, P.mode, 6);
    const degrees = planHarmony(totalBars, P, rng);

    const roles = assignRoles(P.instruments);
    const events = [];

    // --- melody
    const melVoice = roles.find((r) => r.role === 'melody') || roles[0];
    const melCentre = clamp((melVoice.lo + melVoice.hi) / 2 + P.register * 3, melVoice.lo + 4, melVoice.hi - 4);
    let melCIdx = 0;
    for (let i = 0; i < ladder.length; i++) if (Math.abs(ladder[i] - melCentre) < Math.abs(ladder[melCIdx] - melCentre)) melCIdx = i;
    const melRange = [clamp(melCIdx - 6, 0, ladder.length - 1), clamp(melCIdx + 6, 0, ladder.length - 1)];
    const melody = makeMelody({
      bars: totalBars, ladder, degrees, octIdx: 3, P, rng,
      lo: melRange[0], hi: melRange[1], motif: {}
    });

    // --- counter
    const counterVoice = roles.find((r) => r.role === 'counter');
    let counter = null;
    if (counterVoice) {
      const cr = rangeIndices(ladder, counterVoice.lo + 3, counterVoice.hi - 3);
      counter = makeCounter(melody, { ladder, degrees, octIdx: 2, P, rng, lo: cr[0], hi: cr[1], bars: totalBars });
    }

    // --- bass
    const bassVoice = roles.find((r) => r.role === 'bass');
    const bass = bassVoice ? makeBass(degrees, { ladder, octIdx: 1, P, rng, bars: totalBars }) : null;

    // --- accompaniment
    const accompVoice = roles.find((r) => r.role === 'accomp') ||
      (melVoice.role === 'solo' ? melVoice : null);
    const accomp = accompVoice ? makeAccompaniment(degrees, { ladder, octIdx: 2, P, rng, bars: totalBars }) : null;

    // ---- timing map with rubato
    const barStart = [];
    let tsec = 0.6;
    for (let b = 0; b < totalBars; b++) {
      barStart.push(tsec);
      const pos = b % 4;
      let f = 1;
      if (pos === 3) f += P.rubato * 1.6;      // slight broadening at phrase end
      if (pos === 0) f -= P.rubato * 0.7;      // and a gentle push forward
      if (b === totalBars - 1) f += P.rubato * 3;
      tsec += barDur * f;
    }
    const totalDur = tsec + 1.4;

    function beatToTime(beat) {
      const bar = Math.floor(beat / P.meterBeats + 1e-9);
      const within = beat - bar * P.meterBeats;
      const b0 = barStart[Math.min(bar, totalBars - 1)];
      return b0 + within * secPerBeat;
    }

    function push(voice, notes, instId, kind) {
      const isMel = kind === 'melody';
      for (const n of notes) {
        const midi = n.midi !== undefined ? n.midi : ladder[n.idx];
        if (midi == null) continue;
        const t = beatToTime(n.beat);
        const d = Math.max(0.05, n.dur * secPerBeat);
        // dynamics: phrase-level swell
        const bar = Math.floor(n.beat / P.meterBeats + 1e-9);
        const phrasePos = (bar % 4) / 3;
        const swell = 0.78 + 0.22 * Math.sin(Math.PI * phrasePos);
        let vel = (n.vel != null ? n.vel : 0.72) * swell * P.dynScale;
        if (isMel) vel *= 1.08;
        vel = clamp(vel * rng.range(0.94, 1.06), 0.08, 1);
        let art = P.articulation;
        if (kind === 'accomp' && P.form.fig === 'arp') art = 'legato';
        if (kind === 'pad') art = 'legato';
        if (P.form.id === 'march' && kind === 'bass') art = 'marcato';
        if (n.dur <= 0.5 && P.articulation === 'staccato') art = 'staccato';
        events.push({
          t: Math.max(0, t), d, midi, vel, inst: instId, art,
          voice: kind
        });
      }
    }

    push(melVoice, melody, melVoice.id, 'melody');
    if (counter && counterVoice) push(counterVoice, counter, counterVoice.id, 'counter');
    if (melVoice.duet) {
      // an unaccompanied melodic instrument answers itself a few steps lower
      const dr = [clamp(melRange[0] - 7, 0, ladder.length - 1), clamp(melRange[1] - 7, 0, ladder.length - 1)];
      const dbl = makeCounter(melody, { ladder, degrees, octIdx: 2, P, rng, lo: dr[0], hi: dr[1], bars: totalBars });
      push(melVoice, dbl, melVoice.id, 'counter');
    }
    for (const pv of roles.filter((r) => r.role === 'pad')) {
      push(pv, makePad(degrees, { ladder, P, bars: totalBars, center: pv.center, tonicMidi }), pv.id, 'pad');
    }
    if (bass && bassVoice) push(bassVoice, bass, bassVoice.id, 'bass');
    if (accomp && accompVoice) push(accompVoice, accomp, accompVoice.id, 'accomp');

    // --- timpani / percussion punctuation for large ensembles
    if (roles.length >= 6) {
      const timp = roles.find((r) => r.id === 'timpani');
      if (timp) {
        for (let b = 0; b < totalBars; b += 4) {
          events.push({ t: beatToTime(b * P.meterBeats), d: 1.2, midi: ladder[degrees[b] - 1] - 12, vel: 0.55 * P.dynScale, inst: 'timpani', art: 'marcato', voice: 'perc' });
        }
      }
    }

    events.sort((a, b) => a.t - b.t);

    // ---- metadata
    const keyName = NOTE_NAMES[((P.tonic % 12) + 12) % 12];
    const modeLabel = (P.mode === 'harmonicMinor') ? 'minor' : MODES[P.mode].label;
    const opus = 1 + (hashString(seedStr) % 89);
    const titleWord = P.form.id.charAt(0).toUpperCase() + P.form.id.slice(1);
    const title = titleWord + ' in ' + keyName + ' ' + modeLabel + ', Op. ' + opus;

    const chords = [];
    for (let b = 0; b < totalBars; b++) {
      const c = chordPitches(degrees[b], ladder, 2, P.mode);
      chords.push({ bar: b, t: barStart[b], d: barDur, degree: degrees[b], notes: c });
    }

    return {
      meta: {
        title,
        prompt: String(promptText || ''),
        key: keyName,
        mode: modeLabel,
        modeId: P.mode,
        tonic: P.tonic,
        tempo: P.tempo,
        meter: P.meterBeats + '/' + P.meterUnit,
        form: P.form.id,
        mood: P.mood.id,
        moodLabel: P.mood.label,
        instruments: P.instruments,
        instrumentLabels: P.instruments.map((i) => INSTRUMENTS[i].label),
        bars: totalBars,
        duration: Math.round(totalDur * 10) / 10,
        seed: hashString(seedStr),
        articulation: P.articulation
      },
      events,
      chords,
      ladder,
      degrees
    };
  }

  return {
    compose,
    parsePrompt,
    NOTE_NAMES,
    MODES,
    MOODS,
    INSTRUMENTS,
    FORMS,
    version: '1.0.0'
  };
});
