# Neverending Lullaby — Technical Architecture

**Author:** Luís Rodrigues  
**Stack:** Vanilla JavaScript · Tone.js · @tonejs/midi · SunCalc · HTML5 Canvas

---

## Concept

*Neverending Lullaby* is a browser-based generative music installation. It takes three MIDI compositions as raw material, dissolves their structure into probabilistic models, and uses real astronomical data — the current distance and phase of the Moon — to drive an infinite, never-repeating piece of music. The result sounds like a music box playing something it half-remembers: melodically coherent, harmonically grounded, but never quite the same twice.

There are no samples, no loops, and no fixed score. Everything heard is synthesized and sequenced in real time by the generative engine.

---

## System Overview

```
┌─────────────────────────────────────────────┐
│              MIDI SOURCE FILES               │
│        midi_1.mid  midi_2.mid  midi_3.mid    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────┐
│         HARMONIC NORMALIZATION ENGINE        │
│  K-S key detection → semitone shift          │
│  All tracks transposed to same key space     │
└──────────────────┬──────────────────────────┘
                   │
          ┌────────┴────────┐
          ▼                 ▼
┌──────────────────┐  ┌──────────────────┐
│  HARMONY BRAINS  │  │  MELODY BRAINS   │
│  A  B  C         │  │  A  B  C         │
│  (bass chords)   │  │  (lead melody)   │
└────────┬─────────┘  └────────┬─────────┘
         │                     │
         └──────────┬──────────┘
                    ▼
┌─────────────────────────────────────────────┐
│           GENERATIVE ENGINE                  │
│  Weighted Markov traversal                   │
│  Barycentric influence from lamp position    │
└──────────────────┬──────────────────────────┘
                   │
          ┌────────┴────────┐
          ▼                 ▼
┌──────────────────┐  ┌──────────────────┐
│   CELESTIAL DATA │  │   AUDIO ENGINE   │
│   SunCalc:       │  │   Tone.js:       │
│   Distance→BPM   │  │   Synths + FX    │
│   Phase→Timbre   │  │   Chain          │
└──────────────────┘  └──────────────────┘
```

---

## 1. MIDI Analysis Pipeline

This is the core of the project. When the application boots, each of the three MIDI files passes through a four-stage pipeline: parse → normalize → split → build matrices.

### 1.1 Parsing

The `@tonejs/midi` library parses binary MIDI files into JavaScript objects. For each file, the engine finds the first track that contains note data. Each note object exposes:

- `name` — pitch name string, e.g. `"C4"`
- `midi` — integer MIDI note number, e.g. `60`
- `time` — onset time in seconds
- `duration` — note length in seconds
- `velocity` — normalized float 0–1

One important implementation detail: `@tonejs/midi` Note objects define `duration` and `velocity` as **prototype getters**, not own enumerable properties. This means the spread operator (`{ ...note }`) silently drops them. The code therefore explicitly copies each property by name when creating transposed note copies.

### 1.2 Key Detection — Krumhansl-Schmuckler

Before any Markov processing, the system needs to know what key each MIDI file is in, so it can transpose all tracks to share the same harmonic space.

The detection algorithm is the **Krumhansl-Schmuckler key-finding model**, a well-established music cognition method. It works by correlating the pitch content of a piece against 24 pre-established tonal profiles — one for each major and minor key.

**Step 1 — Build a pitch-class histogram:**  
The algorithm counts how much time is spent on each of the 12 pitch classes (C, C#, D, … B), weighted by note duration. Longer notes contribute more than short passing tones.

```javascript
const histogram = new Array(12).fill(0);
notes.forEach(n => { histogram[n.midi % 12] += n.duration; });
```

**Step 2 — Rotate and correlate:**  
For each of the 12 possible root notes, the histogram is rotated so that root note aligns with position 0 (C in the profile). The rotated histogram is then compared to both the major and minor Krumhansl-Kessler profiles using Pearson correlation.

```javascript
for (let root = 0; root < 12; root++) {
    const rotated = histogram.map((_, i) => histogram[(i + root) % 12]);
    const majorScore = pearsonCorrelation(rotated, KS_MAJOR);
    const minorScore = pearsonCorrelation(rotated, KS_MINOR);
    // Keep the root and quality with the highest score
}
```

The Pearson correlation coefficient measures how well the pitch distribution matches the expected pattern for a given key. A high positive value means the music uses the "important" notes of that key heavily (tonic, dominant, mediant) and avoids the non-scale tones.

**Output:** `{ root: "C#", index: 1, quality: "minor" }`

This correctly distinguishes relative keys: C major and A minor share identical pitch-class sets, but their K-S correlation profiles peak at different roots.

### 1.3 Harmonic Normalization — Mode-Preserving Transposition

Once the key of each track is known, the system computes how many semitones to shift it so it lands in the target key space defined by the current month's setting.

The key design principle is **mode preservation**: a minor track stays minor, a major track stays major. Only the root is shifted to align with the target collection.

The target is defined as a pair: `{ majorRoot, minorRoot }`. For example, the C major / A minor collection has `majorRoot = 0` and `minorRoot = 9`.

```
If detected quality is minor → target root = targetMinorRoot
If detected quality is major → target root = targetMajorRoot

shift = (targetRoot - detectedRoot + 12) % 12
if shift > 6: shift = shift - 12   // prefer shorter path
```

The "prefer shorter path" rule means the engine never transposes more than 6 semitones in either direction — it always chooses the nearest equivalent key centre.

**Example:** Track in C# minor (root index 1), target is C maj / A min (minor root 9):
```
shift = (9 - 1 + 12) % 12 = 8 → 8 > 6, so shift = 8 - 12 = -4 semitones
C# minor shifted down 4 semitones → A minor ✓
```

After computing the shift, every note in the track is transposed by that amount for Markov building. Crucially, the **original** (un-transposed) MIDI note number is preserved as `originalMidi` on each note object. This is used for the harmony/melody split threshold, so the structural register of the original composition is respected regardless of transposition.

### 1.4 Feature Splitting — Harmony and Melody

The transposed notes are split into two streams at a **threshold of MIDI note 60** (Middle C), using the `originalMidi` value:

- **Below 60 → Harmony layer** — bass notes, typically forming chords
- **60 and above → Melody layer** — lead voice, single-note lines

Using `originalMidi` for the threshold is essential. If the transposed pitch were used instead, a note that was originally a bass chord note might shift above 60 after transposition and end up routed to the melody brain — breaking the structural character of the composition.

**Harmony extraction — chord grouping:**  
Because bass notes often sound simultaneously (forming chords), the system groups notes that occur within the same 1/8th-beat time window into a single chord descriptor:

```javascript
const roundedTime = Math.round(note.time * 8) / 8;
// All notes at the same rounded time form one chord block
```

Within each time block, the bass notes (below original MIDI 60) are sorted by pitch and joined into a string: `"C3-E3-G3"`. This string becomes the chord identity. The duration of the chord state is computed as the time to the next chord block.

**Melody extraction — monophonic sequence:**  
Melody notes are processed in chronological order. A velocity of 0 and `isPause: true` marks silence. Gaps between melody notes larger than 0.15 seconds are explicitly represented as `REST` states — this preserves the rhythmic phrasing of the original melody rather than rushing past silences.

### 1.5 Markov Matrix Construction

Both harmony and melody streams are converted into **first-order Markov chains** — probability tables mapping each state to the set of states that followed it in the original composition.

**State definition:**

For harmony:
```javascript
{ notes: "C3-E3-G3", duration: "2n" }
```

For melody:
```javascript
{ pitch: "D4", duration: "8n", velocity: 0.78, isPause: false }
```

The state key is `pitch_duration` or `chordString_duration` — duration is baked into the key. This means the chain doesn't just predict the next pitch; it predicts the next pitch-and-duration pair as an atomic unit. The music doesn't just have the right notes — it has the right rhythm.

**Transition matrix construction:**
```javascript
for (let i = 0; i < history.length - 1; i++) {
    const key = `${history[i].notes}_${history[i].duration}`;
    transitionMatrix[key].push(history[i + 1]);
}
```

The result is a lookup table: given the current state, what states were possible next steps in the original composition? Each entry in the array is an equally-weighted candidate. Repeated transitions (common progressions) appear multiple times, giving them higher probability.

**Six matrices total:**  
- `harmonyBrainA`, `harmonyBrainB`, `harmonyBrainC` — chord progressions from tracks 1, 2, 3  
- `melodyBrainA`, `melodyBrainB`, `melodyBrainC` — melodic sequences from tracks 1, 2, 3

---

## 2. Generative Engine

### 2.1 Brain Selection — Barycentric Weighting

At each generative step, the engine selects which of the three source tracks to draw from. This selection is **probabilistic**, driven by three weights `w1`, `w2`, `w3` that always sum to 1.0.

In automated mode, the weights are computed from the distance between each music box object and the centre of the lamp's illuminated cone on the canvas floor:

```javascript
const d1 = distance(musicBox1, lampCentre);
const s1 = Math.max(0.01, maxRadius - d1); // score = inverse distance
weights.w1 = s1 / (s1 + s2 + s3);
```

A music box directly under the lamp gets nearly all the weight. As the user drags a box further from the lamp, its influence fades. This creates a spatial, physical metaphor for the mixing process.

In manual mode, three sliders directly control the weights.

**Brain selection:**
```javascript
const rand = Math.random();
if (rand < weights.w1) return harmonyBrainA;     // 33% chance if equal weights
if (rand < weights.w1 + weights.w2) return harmonyBrainB;
return harmonyBrainC;
```

### 2.2 State Traversal — Entropy-Controlled Markov Walk

Given the selected brain, the engine performs a Markov step:

1. Compute the lookup key from the current state
2. Check if the current state has known successors in the selected brain
3. With probability `wanderFactor` (the chaos coefficient), ignore the transition matrix and jump to a completely random state — this is the "entropy injection" that prevents the engine from getting trapped in loops
4. Otherwise, pick uniformly at random from the recorded successors

```javascript
if (Math.random() < wanderFactor || !brain.transitionMatrix[lookupKey]) {
    nextState = brain.states[Math.floor(Math.random() * brain.states.length)];
} else {
    const choices = brain.transitionMatrix[lookupKey];
    nextState = choices[Math.floor(Math.random() * choices.length)];
}
```

The cross-brain mixing is the key to why this sounds like "hallucinated" music. The harmony might be drawn from Track 1 (a chord progression in one style) while the melody is drawn from Track 3 (phrasing from a completely different piece). The results are harmonically compatible (all tracks share the same key space) but melodically novel.

### 2.3 Loop Scheduling

Two independent `Tone.Loop` instances run the harmony and melody schedulers:

```javascript
harmonyLoopEvent = new Tone.Loop(triggerHarmonyGeneration, "2n").start(0);
melodyLoopEvent  = new Tone.Loop(triggerMelodyGeneration,  "8n").start(0);
```

After each step, the loop's `interval` property is updated to match the duration of the just-generated state. The harmony loop stretches or compresses in real time, following the rhythm learned from the source material. This self-modifying scheduling is what produces the irregular, breathing quality of the output — it's not a fixed metronome grid.

---

## 3. Audio Engine — The Celesta Sound

### 3.1 Signal Chain

```
polyChordSynth ───────────────────────┐
                                      ├──→ timbreFilter ──→ delay ──→ reverb ──→ masterLimiter ──→ output
expressiveMelodySynth ─→ distortion ──┘
```

### 3.2 Synthesis — Why Sine Waves

Both synthesizers use **pure sine wave oscillators**. This is a deliberate design choice. A sine wave produces only the fundamental frequency with no harmonics. Stacking multiple sine waves (as a chord does) produces a clean, glassy timbre with no inter-harmonic beating — exactly the sound of a music box or celesta.

**Chord synthesizer** (`polyChordSynth`):
```javascript
oscillator: { type: "sine" }
envelope: { attack: 0.02, decay: 0.8, sustain: 0.3, release: 1.5 }
volume: -16 dB
```
Soft attack, long decay and release — sustains warmly under the melody.

**Melody synthesizer** (`expressiveMelodySynth`):
```javascript
oscillator: { type: "sine" }
envelope: { attack: 0.005, decay: 0.2, sustain: 0.1, release: 0.3 }
volume: -10 dB
```
Near-instantaneous attack simulates a physical mallet strike. The very short sustain and release means each note is crisp and separated — like a music box pin plucking a tine.

### 3.3 Effects Chain

**Distortion** (`Tone.Distortion`) — receives only the melody signal. AArround 0.5 phase values (full moon), distortion is higher (~0.4), adding harmonics to make the sound brighter. At new moon (phase values 0 or 1), distortion drops to near zero, making the sound clean and warm. Cobined with the low-pass filter this distortion shapes the timber of the melodies.

**Low-pass filter** (`Tone.Filter`, Q=1) — the primary timbre control. Moon phase drives the cutoff frequency between 400 Hz (new moon — muffled, dark) and 4000 Hz (full moon — bright, open). This is the most audible effect of the celestial mapping.

**Feedback delay** (`Tone.FeedbackDelay`) — `4n.` delay time (dotted quarter note), 0.35 feedback, 25% wet. Creates an echo that follows the musical pulse, reinforcing the sense of rhythm without adding a rigid grid.

**Convolution reverb** (`Tone.Reverb`) — 7.5 second decay, 55% wet. The long decay time is key to the installation quality of the piece. Notes blur into each other, creating a continuous harmonic haze that makes individual events feel less discrete and more environmental.

**Limiter** (`Tone.Limiter`) — hard ceiling at 0 dB. Prevents clipping when multiple long-sustain notes accumulate.

### 3.4 Voice Management

`PolySynth` in Tone.js can accumulate stuck voices when the same pitch is retriggered before its release envelope completes. The audition playback engine guards against this explicitly:

```javascript
synth.triggerRelease(event.note, time);       // release any current voice on this pitch
synth.triggerAttackRelease(event.note, ...);  // then start the new one
```

All note durations from MIDI files are also capped at 4.0 seconds before being passed to the synth. This catches any notes with missing note-off events in the source MIDI data that would otherwise sustain indefinitely.

---

## 4. Celestial Data Mapping

### 4.1 SunCalc Integration

At boot and whenever parameters need updating, the app queries the SunCalc library with the current timestamp:

```javascript
const moonIllum = SunCalc.getMoonIllumination(now);
// → { fraction: 0.73, phase: 0.38, angle: ... }

const moonPos = SunCalc.getMoonPosition(now, lat, lon);
// → { altitude, azimuth, distance, ... }  // distance in km
```

`phase` is a value 0–1 representing position in the lunar cycle (0 = new moon, 0.5 = full moon, 1 = new moon again). `distance` is the Earth-Moon distance in kilometres, ranging roughly 363,000 km (perigee) to 406,000 km (apogee).

### 4.2 Parameter Mappings

**BPM ← Moon Distance**  
```
363,000 km (closest) → 100 BPM (fastest)
406,000 km (farthest) → 25 BPM (slowest)
```
The logic: when the Moon is close, its gravitational pull is stronger — the music moves faster. When distant, slower. This creates a ~75 BPM range that shifts gradually over the course of a month as the Moon traces its elliptical orbit.

**Filter frequency ← Moon Phase**  
The phase value (0–1) is converted to a "peak at full moon" curve:
```javascript
const peakAtFullMoon = 1 - Math.abs(currentPhase - 0.5) * 2;
// 0 at new moon, 1 at full moon, symmetric on either side
const freq = mapValue(peakAtFullMoon, 0, 1, 400, 4000);
```
New moon: 400 Hz cutoff — dark, muffled sound. Full moon: 4000 Hz — bright, clear. The curve is symmetric, so waxing and waning phases at equivalent illumination sound the same tonally.

**Distortion amount ← Moon Phase**  
Same curve as frequency:
```javascript
distortionAmount = mapValue(peakAtFullMoon, 0, 1, 0, 0.5);
```
Full moon: maximum distortion (0.4–0.5) — texture and grit. New moon: clean (0) — pure tone.

**Key / Harmonic Collection ← Month of Year**  
The twelve months map to twelve key collections following the circle of fifths:
```
January   → C maj / A min
February  → G maj / E min
March     → D maj / B min
April     → A maj / F# min
May       → E maj / C# min
June      → B maj / G# min
July      → F# maj / D# min
August    → Db maj / Bb min
September → Ab maj / F min
October   → Eb maj / C min
November  → Bb maj / G min
December  → F maj / D min
```
Each step moves a fifth up — the same interval relationship as adjacent keys on the circle of fifths. The system re-analyses all three MIDI files and rebuilds all six Markov matrices when the month changes (or when manually changed in the interface).

### 4.3 Named Moon Phases

For display, the continuous phase value is mapped to one of eight named phases:

```
0.00–0.05, 0.95–1.00  → New Moon
0.05–0.20             → Waxing Crescent
0.20–0.30             → First Quarter
0.30–0.45             → Waxing Gibbous
0.45–0.55             → Full Moon
0.55–0.70             → Waning Gibbous
0.70–0.80             → Last Quarter
0.80–0.95             → Waning Crescent
```

---

## 5. Visual Engine

### 5.1 Canvas Architecture

The visual engine runs on a full-screen HTML5 canvas (`<canvas id="art-surface">`). The main animation loop is `advanceCelestialPhysics()`, driven by `requestAnimationFrame`. Rather than clearing the canvas each frame, it fills with a very low-alpha colour (0.15 opacity) to create a motion-blur trail effect.

### 5.2 Scene Composition

The scene is drawn in layers each frame, back to front:

1. **Background colour wash** — slow fill with the pitch-driven background colour
2. **Standing lamp** (`drawLamp`) — renders a floor lamp with a realistic light cone
3. **Moon window** (`drawWindow`) — a framed window showing the current moon phase
4. **Music boxes** — three isometric cylinders on the floor
5. **Firefly** — the animated light that navigates between boxes

### 5.3 Moon Phase Rendering

The moon is rendered with a simple but effective two-circle technique:

1. Draw a full lit disc in `#dddbc8` (warm white-grey)
2. Draw a dark disc (`#03030a`) offset horizontally to mask part of the lit disc

The offset direction and magnitude are driven by the `currentPhase` value:
```javascript
const phaseFactor    = 1 - Math.abs(currentPhase - 0.5) * 2;  // 0 at new/full, 1 at quarter
const shadowShift    = phaseFactor * moonR * 2;
const shadowDirection = currentPhase < 0.5 ? -1 : 1;          // left = waxing, right = waning
const shadowX        = mx + shadowDirection * shadowShift;
```
At `phase = 0` (new moon): shadow perfectly overlaps the lit disc → dark circle.  
At `phase = 0.5` (full moon): `phaseFactor = 1`, shift is maximum → shadow moved entirely off the disc → full illumination.  
At quarter phases: shadow half-overlaps → crescent or gibbous shape.

The waxing/waning direction is preserved: the shadow comes from the right during waxing and from the left during waning.

### 5.4 Isometric Music Box Cylinders

Each music box is a **horizontal cylinder** rendered in isometric projection using a custom `isoProject(x, y, z)` function:

```javascript
function isoProject(x, y, z) {
    return {
        x: (x - y) * Math.cos(Math.PI / 6),
        y: (x + y) * Math.sin(Math.PI / 6) - z
    };
}
```

The cylinder surface is approximated by 6 flat trapezoidal facets (half of a 12-segment division). Each facet is shaded with a grey tone derived from `Math.sin(angle)`, simulating the curved lighting of a cylindrical surface.

Small coloured pins appear along the cylinder surface and scroll as the crank rotates — a direct reference to the pins on a real music box cylinder that pluck the tines as it turns. Pin speed is proportional to `Tone.Transport.bpm.value`, keeping the visual rotation synchronized with the musical tempo.

### 5.5 Firefly Navigation

The firefly is a point of light that navigates between the three music boxes using a simple physics model:

```javascript
// Attraction toward target music box
moon.vx += (targetDx / targetDist) * pull;
moon.vy += (targetDy / targetDist) * pull;

// Centripetal pull toward screen centre
moon.vx += (centreX - moon.x) / centreDist * 0.12;
moon.vy += (centreY - moon.y) / centreDist * 0.12;

// Organic turbulence
moon.vx += (Math.random() - 0.5) * 0.5;
moon.vx *= friction;  // friction = 0.94
```

The firefly's distance to each music box controls the glow intensity (lInt) of that box. When the firefly is close, the box glows and its cylinder rotates. The firefly's current target is `activeTargetMusicBoxId`, which is updated each time the generative engine selects a brain — the firefly always moves toward whichever source track is currently playing.

---

## 6. Code Organization — Improvement Suggestions

The current `app.js` is structured into 13 labelled sections and is clean and readable. The following improvements would make it easier to maintain and extend:

**1. Dead DOM selectors**  
`chaosSlider` and `debugText` are referenced in DOM selectors (lines 38–49) but neither element exists in the final HTML. These cause silent null references throughout. Remove them or add the corresponding HTML elements back.

**2. `moon` variable naming**  
The firefly object is still named `moon` in the rendering code. This conflicts conceptually with the actual moon drawn in `drawWindow`. Renaming it to `firefly` throughout would eliminate confusion and make the code self-documenting.

**3. `styles.css` is unused**  
All styles are defined inline in `index.html`. The `styles.css` file contains a completely different layout (flex-centred app container) from an earlier version of the project. It should either be deleted or integrated, since including an unused file that overrides or conflicts is a maintenance hazard.

**4. `processAutomatedBarycentricInfluence` writes to removed sliders**  
Lines 342–345 call `w1Slider.value`, `w2Slider.value` etc. In the current UI these sliders exist, but the function only runs when `isSystemLocked` is true — at which point the sliders are disabled. Writing to `.value` on disabled inputs is harmless, but the `debugText` write on line 345 references a null element. That line should be removed.

**5. Moon position latitude/longitude**  
`SunCalc.getMoonPosition(now, 0, 0)` uses coordinates 0°N, 0°E (Gulf of Guinea). For an installation that adapts to real astronomical data, using the viewer's actual location (via the Geolocation API) would make the data genuinely local. At minimum, the coordinates should be set to a fixed location meaningful to the work (Porto, Portugal: 41.15, -8.63) rather than the arbitrary null island.

**6. Key selector value format inconsistency**  
The HTML `<option value="0">` through `<option value="11">` correctly use plain month indices. The old README still mentions a `"maj:min|monthName"` format from an earlier iteration. The README should be updated to reflect the final implementation.

**7. Split into modules**  
At 919 lines, `app.js` is approaching the limit of comfortable single-file management. Natural module boundaries exist:
- `midi.js` — sections 4 + 5 (key detection, MIDI analysis, Markov building)
- `audio.js` — sections 7 + 8 + 9 (synth setup, generative engine, audition)
- `celestial.js` — section 6 (SunCalc integration, phase mapping)
- `render.js` — sections 11 + 12 (canvas, animation loop, input)
- `main.js` — sections 1 + 2 + 3 + 10 + 13 (state, DOM, controls, boot)

This would require either a module bundler or native ES modules (`type="module"` in the HTML script tag), both of which are straightforward to introduce.

**8. `applyMonth` called inside `updateCelestialParameters`**  
`applyMonth` is an async function that rebuilds all six Markov matrices (a relatively slow operation). `updateCelestialParameters` calls it synchronously as if it were instant. While this doesn't break anything (JavaScript's event loop handles it gracefully), it means the status display may briefly show the wrong message. Awaiting the call properly or separating the concerns would make the flow cleaner.

---

## 7. Dependencies

| Library | Version | Role |
|---|---|---|
| Tone.js | 14.8.49 | Web Audio synthesis, scheduling, effects |
| @tonejs/midi | latest | Binary MIDI file parsing |
| SunCalc | 1.8.0 | Moon phase and distance calculation |

All loaded from CDN. No build step required. Run locally with any static file server to avoid CORS restrictions on MIDI file loading.

```bash
python -m http.server 8000
# or
npx live-server
```