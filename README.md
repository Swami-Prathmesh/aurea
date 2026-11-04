# AUREA — AI classical music, free and unlimited

**Live:** https://swami-prathmesh.github.io/aurea/

Describe a feeling, an instrument, a key, a form — AUREA writes an original piece of
classical music and performs it in your browser. No account, no API key, no quota, no
server. Everything runs on the listener's own machine.

```
a melancholic nocturne for solo piano, slow and intimate, in C# minor
heroic symphony orchestra in D minor, triumphant, with timpani
gentle pastoral flute and harp on a spring morning
agitated string quartet, stormy and dramatic
solemn requiem for choir and organ, sacred and dignified
```

## Why it is genuinely free and unlimited

There is no backend. The composition engine, the instrument synthesis and the audio
rendering are all JavaScript running in the page. Nothing is metered, nothing is stored,
nobody is tracked. Open the file once and it keeps working.

## How it works

### 1. Prompt understanding (`engine.js`)

A lexical parser maps free text onto musical parameters:

* **Mood** — 12 affect classes (melancholic, serene, joyful, heroic, agitated, mysterious,
  romantic, solemn, dreamy, playful, pastoral, nostalgic), each carrying a prior over
  mode, tempo range, dynamic envelope, rhythmic density, leap tolerance, vibrato and rubato.
* **Instruments** — 18 orchestral instruments plus ensemble shorthand
  (`string quartet`, `piano trio`, `wind quintet`, `chamber orchestra`, `full orchestra`).
* **Form** — 17 forms (nocturne, sonata, fugue, waltz, march, adagio, scherzo, berceuse,
  siciliana, toccata, rondo, variations, serenade, aria, minuet, prelude, etude), each
  with its own metre, tempo scaling and accompaniment figuration.
* **Key and mode** — explicit (`in D minor`, `C# major`) or inferred from the mood.
* **Tempo, length, articulation** — from words (`slow`, `allegro`, `2 minutes`, `staccato`).

### 2. Composition

* **Harmony** — functional progressions drawn from separate major and minor banks, tiled
  into phrases, with a cadence forced every eight bars and a V–I close. Chords are built
  diatonically from the mode, so borrowed qualities stay consistent; in minor the dominant
  borrows the raised leading tone.
* **Melody** — a motif-first model. A rhythmic cell is chosen per bar (weighted by the
  mood's density), then pitches are chosen by scoring candidate scale degrees against:
  chord-tone membership on strong beats, stepwise preference (seconds are weighted far
  above leaps), a leap-resolution rule (a leap is answered by a step in the opposite
  direction), a per-phrase arch contour, a fixed compass, and an anti-repetition penalty.
  Edge reflection keeps the line moving instead of sticking at the top of the range.
* **Counterpoint** — a second line at half-note motion that prefers contrary motion against
  the melody and chord tones on the beat.
* **Bass** — root–fifth figures, with metre-specific patterns (oom-pah-pah in 3/4,
  march figures in 4/4).
* **Inner voices** — every remaining instrument holds the chord tone nearest its own range,
  which is what makes a nine-piece orchestra sound like an orchestra rather than a trio.
* **Performance** — phrase-level dynamic swells, velocity humanisation, and a rubato map
  that broadens at phrase ends and closes the piece with a ritardando.

Everything is seeded: the same prompt and seed always produce the same piece, which is why
the Share link reproduces your exact music.

### 3. Sound (`synth.js`)

No samples, no downloads. Instruments are synthesised from Web Audio primitives:

* **Piano / harp / harpsichord / guitar / lute** — additive partials with inharmonicity,
  per-partial decay, hammer or pluck noise, body resonance.
* **Strings** — detuned saw stack through a formant peak and lowpass, delayed vibrato LFO,
  bow noise at the attack, tremolo and staccato articulations.
* **Winds** — filtered oscillators with formant peaks plus a breath-noise layer.
* **Organ / choir / trumpet / horn / timpani** — drawbar additive, formant-filtered chorus,
  filter-swept brass, pitch-dropping kettledrum.
* **Space** — a procedurally generated hall impulse response, a stereo send per instrument,
  a bus compressor and a limiter.

### 4. Output

* Live performance with a scrolling score view.
* **WAV** export, rendered offline with the same graph.
* **MIDI** export (SMF type 1, one track per instrument) for use in any notation app.
* Shareable links that encode the prompt and seed.

## It learns from you (`learn.js`)

Every prompt is a training example. A small model lives in `localStorage` and updates
itself on every use — no server, no upload, no account.

* **Word memory** — each prompt token accumulates signed evidence for the musical
  parameters of the pieces it produced: mood, form, mode, tempo and instrumentation.
  Write *"a rainy window in november"* and keep what comes back, and those three words
  become cues that steer later prompts. Reject one and the evidence goes negative, so
  the word stops pulling in that direction.
* **Preference weights** — running scores over moods, forms, modes and instruments, used
  when a prompt is ambiguous.
* **Regret** — fingerprints of recently rejected pieces. If a new prompt would land on a
  shape you just passed on, it deliberately takes a different form or mode instead.

Signals come from behaviour, not just buttons: hearing a piece past 60% counts as
approval, skipping it within a few seconds counts as rejection, and exporting WAV/MIDI or
sharing counts as strong approval. **More like this** and **Not this** are the explicit
version. Every prompt contributes at least a small positive weight, so the vocabulary
grows even without feedback.

The **What it has learned here** panel shows the words it is tracking, the moods and forms
it leans toward, and lets you export the model as JSON, import it on another device,
switch learning off, or forget everything. Because it is exportable, knowledge can be
merged between devices — the beginnings of a shared vocabulary without a backend.

Shared links carry the resolved parameters in the URL, so a piece reproduces exactly even
on a device with a different memory.

## Running locally

No build step, no dependencies. Serve the folder over any static server:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Opening `index.html` directly from disk also works.

## Tests

```bash
node test_engine.js   # composition invariants across 13 prompts
node test_synth.js    # every instrument model + WAV/MIDI encoding, via a mock Audio API
```

## Licence

MIT. Do what you like with it.

Built by Prathmesh Swami.
