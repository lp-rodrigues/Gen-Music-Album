/* =========================================================================
   # 1. Global App Playback & Audio States
   # Defines the core data structures and variables used across the application.
   ========================================================================= */

// Audio engine components for standard Web Audio processing
let polyChordSynth, expressiveMelodySynth, delay, reverb, timbreFilter, masterLimiter;

// Generative playback control flags
let isPlayingGenerative = false;

// Original MIDI audition track control flags
let isPlayingOrig1 = false, isPlayingOrig2 = false, isPlayingOrig3 = false;

// Schedulers for executing the standard (non-generative) MIDI track data
let originalPart1, originalPart2, originalPart3;

// Containers to store the raw parsed note data for isolated track auditioning
let originalSequenceData1 = [], originalSequenceData2 = [], originalSequenceData3 = [];

// Schedulers for generative audio loop execution
let harmonyLoopEvent = null, melodyLoopEvent = null;

// Track pointers to store the "last played" generative state, enabling coherent future transitions
let currentChordState = null, currentMelodyState = null;      

// Interpolated mixing weights (Barycentric Influence Matrix), defining how closely we replicate standard tracks 1, 2, or 3.
let weights = { w1: 0.333, w2: 0.333, w3: 0.333 };

// Multi-Engine Markov Brains Arrays: Stores the probabilistic note relationships extracted from the MIDI files
let harmonyBrainA = { states: [], transitionMatrix: {} }, harmonyBrainB = { states: [], transitionMatrix: {} }, harmonyBrainC = { states: [], transitionMatrix: {} };
let melodyBrainA = { states: [], transitionMatrix: {} }, melodyBrainB = { states: [], transitionMatrix: {} }, melodyBrainC = { states: [], transitionMatrix: {} };

// AUTOMATION STATE: True = Locked (Automated Firefly tracking), False = Unlocked (Manual Slider Override)
let isSystemLocked = true;

// Active Target Tracking Pointer ID: Defines which "cylinder" the automated firefly is currently navigating toward.
let activeTargetMusicBoxId = 1;

// Tracks the key offset to transpose the MIDI files.
let currentKeyOffset = 0;

/* =========================================================================
   # 2. DOM Selectors & UI Data Mappings
   # Connects variables to specific elements in the index.html user interface.
   ========================================================================= */

// Text HUD displays
const statusText = document.getElementById('status-text');
const hudVectorDisplay = document.getElementById('live-vector-display');
const debugText = document.getElementById('blend-display-debug');

// Main command interaction buttons
const playBtn = document.getElementById('main-art-toggle');
const lockBtn = document.getElementById('lock-toggle-btn');

// Isolated original layer audition buttons
const midi1Btn = document.getElementById('midi1-btn'), midi2Btn = document.getElementById('midi2-btn'), midi3Btn = document.getElementById('midi3-btn'); 

// Global audio engine dynamic control sliders
const tempoSlider = document.getElementById('tempo-slider'), tempoVal = document.getElementById('tempo-val');
const chaosSlider = document.getElementById('chaos-slider');

// Manual Barycentric Weight mixing sliders
const w1Slider = document.getElementById('w1-slider'), w1Val = document.getElementById('w1-val');
const w2Slider = document.getElementById('w2-slider'), w2Val = document.getElementById('w2-val');
const w3Slider = document.getElementById('w3-slider'), w3Val = document.getElementById('w3-val');


/* =========================================================================
   # 3. Audio Visualization Dynamics (Barycentric Skin Colors)
   # Mappings to color the 3D visual chassis based on musical pitch and location data.
   ========================================================================= */

// Hardware dynamic ambient bases: Maps musical root notes to visual base-layer color shift
const pitchColorMap = {
    'C': { r: 14, g: 15, b: 17 }, 'D': { r: 20, g: 18, b: 24 }, 'E': { r: 24, g: 16, b: 16 },
    'F': { r: 14, g: 22, b: 18 }, 'G': { r: 24, g: 22, b: 16 }, 'A': { r: 18, g: 14, b: 24 }, 'B': { r: 14, g: 20, b: 24 }
};

// State variables to track ambient lighting transition
let currentTargetColor = { r: 14, g: 15, b: 17 }, currentBackgroundColor = { r: 14, g: 15, b: 17 };

// Visual mapping utility: Converts raw audio decimal duration to a musical notation label (e.g., "4n" for quarter note)
const getDurationTag = (dur) => {
    if (dur <= 0.18) return "16n"; if (dur <= 0.38) return "8n"; if (dur <= 0.75) return "4n"; if (dur <= 1.4) return "2n"; return "1m"; 
};


/* =========================================================================
   # 4. MIDI Feature Extraction & Feature Splitting Engine
   ========================================================================= */

    /* -----------------------------------------------------------------------
       KEY DETECTION ENGINE — Krumhansl-Schmuckler Correlation Method
       Correlates the pitch-class duration histogram of a track against
       24 established tonal profiles (12 major + 12 minor) and picks the
       best match. Returns { root, index, quality } where quality is
       "major" or "minor". This correctly handles relative keys:
       C major and A minor share the same notes but have different profiles.
    ----------------------------------------------------------------------- */
    const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

    // Krumhansl-Kessler tonal hierarchy weights
    const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

    function pearsonCorrelation(a, b) {
        const n = a.length;
        const meanA = a.reduce((s, v) => s + v, 0) / n;
        const meanB = b.reduce((s, v) => s + v, 0) / n;
        let num = 0, denomA = 0, denomB = 0;
        for (let i = 0; i < n; i++) {
            const da = a[i] - meanA, db = b[i] - meanB;
            num += da * db; denomA += da * da; denomB += db * db;
        }
        return num / Math.sqrt(denomA * denomB);
    }

    function getMusicalKey(notes) {
        // Build pitch-class histogram weighted by note duration (longer notes count more)
        const histogram = new Array(12).fill(0);
        notes.forEach(n => {
            const pc = Tone.Midi(n.name).toMidi() % 12;
            histogram[pc] += (n.duration || 0.5); // weight by duration
        });

        let bestScore = -Infinity, bestRoot = 0, bestQuality = "major";

        for (let root = 0; root < 12; root++) {
            // Rotate the histogram so 'root' aligns with C in the profile
            const rotated = histogram.map((_, i) => histogram[(i + root) % 12]);

            const majorScore = pearsonCorrelation(rotated, KS_MAJOR);
            const minorScore = pearsonCorrelation(rotated, KS_MINOR);

            if (majorScore > bestScore) { bestScore = majorScore; bestRoot = root; bestQuality = "major"; }
            if (minorScore > bestScore) { bestScore = minorScore; bestRoot = root; bestQuality = "minor"; }
        }

        return { root: NOTE_NAMES[bestRoot], index: bestRoot, quality: bestQuality };
    }

    /* -----------------------------------------------------------------------
       SEMITONE SHIFT CALCULATOR — Mode-Preserving, Collection-Aligned

       Each "Machine Tuning" option represents a pitch-class COLLECTION,
       encoded as two roots: { majorRoot, minorRoot } (e.g. C=0, A=9).

       The shift logic preserves the detected mode:
         - If detected key is MINOR  → align its root to targetMinorRoot
         - If detected key is MAJOR  → align its root to targetMajorRoot

       This means a track in C# minor stays minor — it just shifts to land
       on A minor (when target collection is C maj / A min).

       Examples with target C maj / A min (majorRoot=0, minorRoot=9):
         - C# minor (1) → target minor root 9 → (9−1+12)%12 = 8 → −4 st ✓
         - F  minor (5) → target minor root 9 → (9−5+12)%12 = 4 st      ✓
         - C  minor (0) → target minor root 9 → (9−0+12)%12 = 9 → −3 st ✓
         - C  major (0) → target major root 0 → 0 st                     ✓
         - G  major (7) → target major root 0 → (0−7+12)%12 = 5 → −7? →
                          shorter path: 5 st up                           ✓
    ----------------------------------------------------------------------- */
    function computeSemitoneShift(detected, targetMajorRoot, targetMinorRoot) {
        const targetRoot = detected.quality === 'minor' ? targetMinorRoot : targetMajorRoot;
        const rawShift = (targetRoot - detected.index + 12) % 12;
        // Prefer the shorter path: if shift > 6, go the other direction
        return rawShift > 6 ? rawShift - 12 : rawShift;
    }

    async function analyzeMidiPerformance(url, harmonyBrain, melodyBrain, sequenceContainer, targetMajorRoot, targetMinorRoot) {
        const midi = await Midi.fromUrl(url);
        const activeTrack = midi.tracks.find(t => t.notes && t.notes.length > 0);
        if (!activeTrack) throw new Error(`Missing note tracks inside ${url}`);

        // --- STEP 0: SNAPSHOT ORIGINALS before any mutation ---
        // sequenceContainer is used by the audition buttons to play the
        // original track unmodified. We capture name/midi/time/duration/velocity
        // here, before the transposition loop touches the note objects.
        activeTrack.notes.forEach(n => {
            sequenceContainer.push({
                time: n.time,
                note: n.name,           // original pitch name
                midi: Tone.Midi(n.name).toMidi(), // original MIDI number
                duration: n.duration,
                velocity: n.velocity
            });
        });
        
        // --- STEP 1: HARMONIC NORMALIZATION (K-S Key Detection + Mode-Preserving Transposition) ---
        // Detection runs on originals (still unmodified at this point).
        const detected = getMusicalKey(activeTrack.notes);
        const shift = computeSemitoneShift(detected, targetMajorRoot, targetMinorRoot);

        // Mutate note objects in place for Markov processing only.
        // We store the PRE-SHIFT midi value as n.originalMidi so the harmony/melody
        // threshold split always reflects the composer's original register intention,
        // not the transposed pitch. A note that was a bass note stays a bass note
        // regardless of how many semitones it moved.
        activeTrack.notes.forEach(n => {
            n.originalMidi = Tone.Midi(n.name).toMidi(); // capture before shift
            const midiVal = n.originalMidi + shift;
            n.name = Tone.Midi(midiVal).toNote();
            n.midi = midiVal;
        });

        const detectedLabel = `${detected.root} ${detected.quality === 'minor' ? 'min' : 'maj'}`;
        const targetRoot = detected.quality === 'minor' ? targetMinorRoot : targetMajorRoot;
        const targetLabel = `${NOTE_NAMES[targetRoot]} ${detected.quality === 'minor' ? 'min' : 'maj'}`;
        const shiftLabel = shift === 0 ? 'no shift' : shift > 0 ? `+${shift} st` : `${shift} st`;
        harmonyBrain.metadata = {
            key: `${detectedLabel} → ${targetLabel} (${shiftLabel})`
        };

        // --- STEP 2: BUILD MARKOV MATRICES from transposed notes ---
        const rawNotes = activeTrack.notes;

        const timeBlocks = {};
        rawNotes.forEach(note => {
            const roundedTime = Math.round(note.time * 8) / 8; 
            if (!timeBlocks[roundedTime]) timeBlocks[roundedTime] = [];
            timeBlocks[roundedTime].push(note);
        });

        const chordTimeKeys = Object.keys(timeBlocks).sort((a,b) => a - b);
        let chordHistory = [];

        for (let i = 0; i < chordTimeKeys.length; i++) {
            const timeKey = parseFloat(chordTimeKeys[i]);
            const notesInBlock = timeBlocks[timeKey];
            const bassNotes = notesInBlock.filter(n => n.originalMidi < 60).sort((a,b) => a.originalMidi - b.originalMidi);
            if (bassNotes.length > 0) {
                const chordString = bassNotes.map(n => n.name).join("-");
                let duration = (i < chordTimeKeys.length - 1) ? parseFloat(chordTimeKeys[i+1]) - timeKey : bassNotes.reduce((max, n) => Math.max(max, n.duration), 1.0);
                chordHistory.push({ notes: chordString, duration: getDurationTag(duration) });
            }
        }
        harmonyBrain.states = chordHistory;
        for (let i = 0; i < chordHistory.length - 1; i++) {
            const key = `${chordHistory[i].notes}_${chordHistory[i].duration}`;
            if (!harmonyBrain.transitionMatrix[key]) harmonyBrain.transitionMatrix[key] = [];
            harmonyBrain.transitionMatrix[key].push(chordHistory[i+1]);
        }

        const melodyNotes = rawNotes.filter(n => n.originalMidi >= 60);
        let melodyHistory = [];
        for (let i = 0; i < melodyNotes.length; i++) {
            const current = melodyNotes[i];
            melodyHistory.push({ pitch: current.name, duration: getDurationTag(current.duration), velocity: current.velocity, isPause: false });
            if (i < melodyNotes.length - 1) {
                const gap = melodyNotes[i + 1].time - (current.time + current.duration);
                if (gap > 0.15) melodyHistory.push({ pitch: "REST", duration: getDurationTag(gap), velocity: 0, isPause: true });
            }
        }
        melodyBrain.states = melodyHistory;
        for (let i = 0; i < melodyHistory.length - 1; i++) {
            const key = `${melodyHistory[i].pitch}_${melodyHistory[i].duration}`;
            if (!melodyBrain.transitionMatrix[key]) melodyBrain.transitionMatrix[key] = [];
            melodyBrain.transitionMatrix[key].push(melodyHistory[i+1]);
        }
    }



/* =========================================================================
   # 5. Audio Pipeline Configuration (Calibrated Celesta)
   # Restores the pure music box/celesta glass-timbre sound engine while protecting against clipping distortion.
   ========================================================================= */
function setupAudioEngine() {
    if (polyChordSynth) return;

    // *** DISTORTION BRICKWALL: Prevent accumulating audio signal peaks from clipping ***
    masterLimiter = new Tone.Limiter(0).toDestination();

    // Standard stereo effects processed through the limiter
    reverb = new Tone.Reverb({ decay: 7.5, wet: 0.55 }).connect(masterLimiter);
    delay = new Tone.FeedbackDelay({ delayTime: "4n.", feedback: 0.35, wet: 0.25 }).connect(reverb);
    timbreFilter = new Tone.Filter({ type: "lowpass", frequency: 1200, Q: 1 }).connect(delay);

    // CHORD ENGINE: Pure Music Box sine tone (Lower baseline gain for stacking headroom)
    polyChordSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" }, envelope: { attack: 0.02, decay: 0.8, sustain: 0.3, release: 1.5 } 
    }).connect(timbreFilter); 
    polyChordSynth.volume.value = -16; 

    // MELODY ENGINE: Instant attack hammer transient strike sine tone
    expressiveMelodySynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" }, envelope: { attack: 0.005, decay: 0.2, sustain: 0.1, release: 0.3 }
    }).connect(timbreFilter);
    expressiveMelodySynth.volume.value = -10;
}


/* =========================================================================
   # 6. Generative Music Logic (Probabilistic Interpolation)
   # Defines how the engine navigates Markov chains to select the "next note".
   ========================================================================= */

// Barycentric Influence Mixer: Calculates influence weights (W1, W2, W3) dynamically to provide live composition balancing.
function processAutomatedBarycentricInfluence() {
    if (!isSystemLocked) return;
    const centerX = canvas.width / 2; const centerY = canvas.height / 2;
    const d1 = Math.sqrt((musicBoxes[0].x - centerX)**2 + (musicBoxes[0].y - centerY)**2);
    const d2 = Math.sqrt((musicBoxes[1].x - centerX)**2 + (musicBoxes[1].y - centerY)**2);
    const d3 = Math.sqrt((musicBoxes[2].x - centerX)**2 + (musicBoxes[2].y - centerY)**2);

    const maxRadius = 600;
    let s1 = Math.max(0.01, maxRadius - d1), s2 = Math.max(0.01, maxRadius - d2), s3 = Math.max(0.01, maxRadius - d3);
    const total = s1 + s2 + s3;
    weights.w1 = s1 / total; weights.w2 = s2 / total; weights.w3 = s3 / total;

    // Update Manual Mixer Sliders
    w1Slider.value = Math.round(weights.w1 * 100); w1Val.innerText = w1Slider.value + "%";
    w2Slider.value = Math.round(weights.w2 * 100); w2Val.innerText = w2Slider.value + "%";
    w3Slider.value = Math.round(weights.w3 * 100); w3Val.innerText = w3Slider.value + "%";
    if (debugText) debugText.innerText = `MIDI 1: ${w1Slider.value}% | MIDI 2: ${w2Slider.value}% | MIDI 3: ${w3Slider.value}%`;
}

// Probabilistic Brain Selector: Dynamically selects the active database (A, B, or C) based on current Barycentric Influence matrix.
function selectBrainFromTernary(brainA, brainB, brainC) {
    const rand = Math.random();
    if (rand < weights.w1) { activeTargetMusicBoxId = 1; return brainA; }
    if (rand < weights.w1 + weights.w2) { activeTargetMusicBoxId = 2; return brainB; }
    activeTargetMusicBoxId = 3; return brainC;
}

// GENERATIVE TASK 1: Harmony Scheduler
function triggerHarmonyGeneration(time) {
    if (!isPlayingGenerative) return;
    const wanderFactor = chaosSlider ? parseFloat(chaosSlider.value) : 0.15;
    const activeBrain = selectBrainFromTernary(harmonyBrainA, harmonyBrainB, harmonyBrainC);
    if (!currentChordState) currentChordState = activeBrain.states[0] || { notes: "C3-E3-G3", duration: "2n" };

    const lookupKey = `${currentChordState.notes}_${currentChordState.duration}`;
    let nextState = null;
    if (Math.random() < wanderFactor || !activeBrain.transitionMatrix[lookupKey]) {
        nextState = activeBrain.states[Math.floor(Math.random() * activeBrain.states.length)];
    } else {
        const choices = activeBrain.transitionMatrix[lookupKey];
        nextState = choices[Math.floor(Math.random() * choices.length)];
    }
    currentChordState = nextState;
    const duration = currentChordState.duration;
    polyChordSynth.triggerAttackRelease(currentChordState.notes.split("-"), duration, time, 0.4);
    
    // --- FORCE UPDATE BY DIRECT ID LOOKUP ---
    const targetDisplay = document.getElementById('live-vector-display');
    if (targetDisplay) {
        targetDisplay.innerText = `${currentChordState.notes} [${duration}]`;
    }

    harmonyLoopEvent.interval = duration;
}

// GENERATIVE TASK 2: Melody Scheduler
function triggerMelodyGeneration(time) {
    if (!isPlayingGenerative) return;
    const wanderFactor = chaosSlider ? parseFloat(chaosSlider.value) : 0.15;
    const activeBrain = selectBrainFromTernary(melodyBrainA, melodyBrainB, melodyBrainC);
    if (!currentMelodyState) currentMelodyState = activeBrain.states[0] || { pitch: "C4", duration: "8n", velocity: 0.6, isPause: false };

    const lookupKey = `${currentMelodyState.pitch}_${currentMelodyState.duration}`;
    let nextState = null;
    if (Math.random() < wanderFactor || !activeBrain.transitionMatrix[lookupKey]) {
        nextState = activeBrain.states[Math.floor(Math.random() * activeBrain.states.length)];
    } else {
        const choices = activeBrain.transitionMatrix[lookupKey];
        nextState = choices[Math.floor(Math.random() * choices.length)];
    }
    currentMelodyState = nextState;
    const duration = currentMelodyState.duration;
    if (!currentMelodyState.isPause && currentMelodyState.pitch !== "REST") {
        expressiveMelodySynth.triggerAttackRelease(currentMelodyState.pitch, duration, time, currentMelodyState.velocity);
        const char = currentMelodyState.pitch.charAt(0);
        if (pitchColorMap[char]) currentTargetColor = pitchColorMap[char];
    }
    melodyLoopEvent.interval = duration;
}


/* =========================================================================
   # 7. Audition Playback Engine & Standard Schedulers
   # Logic to play back standard, non-generative, isolated MIDI tracks.
   ========================================================================= */

// Isolated Schedulers Builder: Compiles a raw data array into a Tone.Part scheduled object for direct synthesis routing
function buildTonePartFromContainer(containerData) {
    return new Tone.Part((time, event) => {
        if (event.note) {
            if (Tone.Midi(event.note).toMidi() < 60) {
                polyChordSynth.triggerAttackRelease(event.note, event.duration, time, event.velocity);
            } else {
                expressiveMelodySynth.triggerAttackRelease(event.note, event.duration, time, event.velocity);
            }
        }
    }, containerData);
}

// Playback Cleanup Utility: Safely stops and disposes of all active synthesis and loop schedulers across all playback modes.
function clearAllPlaybacks() {
    // Stop generative mode loop schedulers
    if (isPlayingGenerative) {
        isPlayingGenerative = false;
        if (playBtn) { playBtn.innerText = "Start Sound"; playBtn.classList.remove('active-stream'); }
        if (harmonyLoopEvent) { harmonyLoopEvent.stop(); harmonyLoopEvent.dispose(); harmonyLoopEvent = null; }
        if (melodyLoopEvent) { melodyLoopEvent.stop(); melodyLoopEvent.dispose(); melodyLoopEvent = null; }
    }
    
    // Disconnect and stop isolated audition Parts 1, 2, and 3
    if (originalPart1) { originalPart1.stop(); originalPart1.dispose(); originalPart1 = null; }
    isPlayingOrig1 = false; if (midi1Btn) midi1Btn.classList.remove('active');

    if (originalPart2) { originalPart2.stop(); originalPart2.dispose(); originalPart2 = null; }
    isPlayingOrig2 = false; if (midi2Btn) midi2Btn.classList.remove('active');

    if (originalPart3) { originalPart3.stop(); originalPart3.dispose(); originalPart3 = null; }
    isPlayingOrig3 = false; if (midi3Btn) midi3Btn.classList.remove('active');

    Tone.Transport.stop(); Tone.Transport.position = 0;
    if (hudVectorDisplay) hudVectorDisplay.innerText = "Engine Standby";
}


/* =========================================================================
   # 8. User Interaction & Control Handlers
   # Connects HTML buttons and sliders to JavaScript execution logic.
   ========================================================================= */

// *** MAIN COMMAND: Start/Stop Generative Sound Engine ***
if (playBtn) playBtn.addEventListener('click', async () => {
    await Tone.start(); 
    setupAudioEngine();
    
    if (isPlayingGenerative) {
        clearAllPlaybacks();
        currentTargetColor = { r: 14, g: 15, b: 17 };
    } 
    else {
        clearAllPlaybacks(); 
        isPlayingGenerative = true; 
        playBtn.innerText = "Stop Sound"; 
        playBtn.classList.add('active-stream');
        currentChordState = null; 
        currentMelodyState = null;
        
        // Boot standard generative loops
        harmonyLoopEvent = new Tone.Loop((time) => { triggerHarmonyGeneration(time); }, "2n").start(0);
        melodyLoopEvent = new Tone.Loop((time) => { triggerMelodyGeneration(time); }, "8n").start(0);
        
        // Ensure Transport starts AFTER the loops are scheduled so the readout updates instantly
        Tone.Transport.start();
    }
});

// *** AUDITION COMMAND: Isolated Track Playback Buttons 1, 2, and 3 ***
if (midi1Btn) midi1Btn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingOrig1) { clearAllPlaybacks(); } 
    else {
        clearAllPlaybacks();
        isPlayingOrig1 = true; midi1Btn.classList.add('active');
        activeTargetMusicBoxId = 1; // Direct visual firefly tracking override
        originalPart1 = buildTonePartFromContainer(originalSequenceData1);
        originalPart1.start(0); Tone.Transport.start();
        if (hudVectorDisplay) hudVectorDisplay.innerText = "Auditioning MIDI Track 1";
    }
});

if (midi2Btn) midi2Btn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingOrig2) { clearAllPlaybacks(); } 
    else {
        clearAllPlaybacks();
        isPlayingOrig2 = true; midi2Btn.classList.add('active');
        activeTargetMusicBoxId = 2;
        originalPart2 = buildTonePartFromContainer(originalSequenceData2);
        originalPart2.start(0); Tone.Transport.start();
        if (hudVectorDisplay) hudVectorDisplay.innerText = "Auditioning MIDI Track 2";
    }
});

if (midi3Btn) midi3Btn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingOrig3) { clearAllPlaybacks(); } 
    else {
        clearAllPlaybacks();
        isPlayingOrig3 = true; midi3Btn.classList.add('active');
        activeTargetMusicBoxId = 3;
        originalPart3 = buildTonePartFromContainer(originalSequenceData3);
        originalPart3.start(0); Tone.Transport.start();
        if (hudVectorDisplay) hudVectorDisplay.innerText = "Auditioning MIDI Track 3";
    }
});

// *** AUTOMATION CONTROL: System Locked vs Manual Slider Override Toggle ***
if (lockBtn) lockBtn.addEventListener('click', () => {
    isSystemLocked = !isSystemLocked;
    if (isSystemLocked) {
        lockBtn.innerText = "🔒 System Automation: LOCKED"; lockBtn.classList.remove('unlocked');
        // Disable Manual Input Fields
        tempoSlider.disabled = true; w1Slider.disabled = true; w2Slider.disabled = true; w3Slider.disabled = true;
    } else {
        lockBtn.innerText = "🔓 Manual Override: UNLOCKED"; lockBtn.classList.add('unlocked');
        // Enable Manual Input Fields
        tempoSlider.disabled = false; w1Slider.disabled = false; w2Slider.disabled = false; w3Slider.disabled = false;
    }
});

// Tempo Potentiometer Slider Listener
if (tempoSlider) tempoSlider.addEventListener('input', (e) => {
    if (!isSystemLocked) { tempoVal.innerText = e.target.value; Tone.Transport.bpm.value = parseFloat(e.target.value); }
});

// Barycentric Influence Matrix Manual Mixer Handlers: Updated weight mix calculations
function handleManualWeightMixUpdate() {
    if (isSystemLocked) return;
    let v1 = parseFloat(w1Slider.value), v2 = parseFloat(w2Slider.value), v3 = parseFloat(w3Slider.value);
    let sum = v1 + v2 + v3;
    if (sum === 0) { v1 = 1; v2 = 1; v3 = 1; sum = 3; }
    // Recalculate weights relative to the total sum of all three sliders
    weights.w1 = v1 / sum; weights.w2 = v2 / sum; weights.w3 = v3 / sum;
    w1Val.innerText = `${Math.round(weights.w1*100)}%`; w2Val.innerText = `${Math.round(weights.w2*100)}%`; w3Val.innerText = `${Math.round(weights.w3*100)}%`;
    if (debugText) debugText.innerText = `MIDI 1: ${Math.round(weights.w1*100)}% | MIDI 2: ${Math.round(weights.w2*100)}% | MIDI 3: ${Math.round(weights.w3*100)}%`;
}
if (w1Slider) w1Slider.addEventListener('input', handleManualWeightMixUpdate);
if (w2Slider) w2Slider.addEventListener('input', handleManualWeightMixUpdate);
if (w3Slider) w3Slider.addEventListener('input', handleManualWeightMixUpdate);


/* =========================================================================
   # 9. HORIZONTAL CYLINDER RENDERING MODULES
   # Complete Canvas physics engine and 3D isometric visualization logic.
   ========================================================================= */

// Canvas Context Setup
const canvas = document.getElementById('art-surface');
const ctx = canvas.getContext('2d');

// Automated Firefly Physics Parameters:zig-zag motion model
let moon = { x: window.innerWidth / 2, y: window.innerHeight / 2, vx: 2, vy: -1.5, radius: 3, attractionRadius: 400 };

// 3D Music Box Objects (Hardware Cylinders): defines visual geometry, hardware colors, and 2D/3D location matrix data.
let musicBoxes = [
    { id: 1, x: 0, y: 0, rad: 16, length: 50, rotation: 0, color: "#ff3b30", active: true },
    { id: 2, x: 0, y: 0, rad: 16, length: 50, rotation: 0, color: "#ffcc00", active: true },
    { id: 3, x: 0, y: 0, rad: 16, length: 50, rotation: 0, color: "#007aff", active: true }
];

// Reference variable for handling visual "drag and drop" matrix logic
let draggedMusicBox = null;

// Layout Initialization: Sets initial visual barycentric balance point locations based on standard geometry principles.
function initCelestialLayout() {
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    musicBoxes[0].x = canvas.width / 2; musicBoxes[0].y = canvas.height * 0.30;
    musicBoxes[1].x = canvas.width * 0.28; musicBoxes[1].y = canvas.height * 0.65;
    musicBoxes[2].x = canvas.width * 0.72; musicBoxes[2].y = canvas.height * 0.65;
}

// True Isometric AXIS Coordinate Transformation Matrix: Converts flat X/Y data into oblique 3D space projection.
function isoProject(x, y, z) {
    return {
        x: (x - y) * Math.cos(Math.PI / 6),
        y: (x + y) * Math.sin(Math.PI / 6) - z
    };
}

// *** MAIN VISUAL ANIMATION & PHYSICS ADVANCEMENT ENGINE ***
function advanceCelestialPhysics() {
    // Smoothed Barycentric ambient base color shift transition calculations
    currentBackgroundColor.r += (currentTargetColor.r - currentBackgroundColor.r) * 0.04;
    currentBackgroundColor.g += (currentTargetColor.g - currentBackgroundColor.g) * 0.04;
    currentBackgroundColor.b += (currentTargetColor.b - currentBackgroundColor.b) * 0.04;
    
    // Reset canvas frame buffer with specific alpha clear value to establish motion blur tail footprint.
    ctx.fillStyle = `rgba(${Math.round(currentBackgroundColor.r)}, ${Math.round(currentBackgroundColor.g)}, ${Math.round(currentBackgroundColor.b)}, 0.42)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2; const centerY = canvas.height / 2;
    let activeMusicBoxesCount = 0; let distSum = 0;
    
    // Visual tracking override definition (e.g., during isolated audition)
    let targetP = musicBoxes.find(p => p.id === activeTargetMusicBoxId) || musicBoxes[0];

    musicBoxes.forEach(p => {
        const dx = p.x - centerX; const dy = p.y - centerY;
        const d = Math.sqrt(dx*dx + dy*dy);
        
        // Establish activation zone: check distance from central influence center
        if (d < moon.attractionRadius) { p.active = true; activeMusicBoxesCount++; distSum += d; } 
        else { p.active = false; }

        const fDist = Math.sqrt((p.x - moon.x)**2 + (p.y - moon.y)**2);
        
        // Define dynamic lighting glow rangezone (220px maximum range)
        const lInt = Math.max(0, 1 - (fDist / 220));

        // Define kinetic conditions: trigger the mechanical rotational graphics if a) Firefly is close, or b) This specific track audition Part is explicitly running.
        const isAuditioningThisTrack = (p.id === 1 && isPlayingOrig1) || (p.id === 2 && isPlayingOrig2) || (p.id === 3 && isPlayingOrig3);
        
        if ((lInt > 0 || isAuditioningThisTrack) && (isPlayingGenerative || isAuditioningThisTrack)) {
            // Apply a speed scalar relative to light intensity, unless in forced audition mode.
            const motionMultiplier = isAuditioningThisTrack ? 1.0 : lInt;
            p.rotation += (Tone.Transport.bpm.value / 60) * 0.035 * motionMultiplier;
        }

        // --- DRAW ISOMETRIC HORIZONTAL CYLINDER GRAPHICS CHASSIS ---
        ctx.save(); ctx.translate(p.x, p.y);
        
        // 1. DYNAMIC RADIANT GLOW: Soft fased radial gradient field illumination
        if (lInt > 0 || isAuditioningThisTrack) {
            const glowScalar = isAuditioningThisTrack ? 1.0 : lInt;
            let grad = ctx.createRadialGradient(0, 0, p.length * 0.2, 0, 0, p.length * 2.2);
            grad.addColorStop(0, `rgba(255,255,255,${glowScalar * 0.08})`);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.beginPath(); ctx.arc(0, 0, p.length * 2.2, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
        }

        // 2. ISOMETRIC BASE PLATE STRUCTURAL LAYOUT
        const b1 = isoProject(-30, -20, 0), b2 = isoProject(30, -20, 0), b3 = isoProject(30, 20, 0), b4 = isoProject(-30, 20, 0);
        ctx.beginPath(); ctx.moveTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(b3.x, b3.y); ctx.lineTo(b4.x, b4.y);
        ctx.fillStyle = '#1c1e22'; ctx.fill();
        ctx.strokeStyle = p.active ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)'; ctx.stroke();

        // 3. HORIZONTAL ISOMETRIC CYLINDER EXTRUSION FACETS Face Mapping: Extrude segmented rings left-to-right
        const segments = 12;
        for (let i = 0; i < segments / 2; i++) {
            // Project profile points oblique to isometric grid planes
            let a1 = (i / segments) * Math.PI * 2 - Math.PI/2, a2 = ((i + 1) / segments) * Math.PI * 2 - Math.PI/2;
            let pL1 = isoProject(-25, Math.cos(a1)*p.rad, Math.sin(a1)*p.rad + p.rad);
            let pL2 = isoProject(-25, Math.cos(a2)*p.rad, Math.sin(a2)*p.rad + p.rad);
            let pR1 = isoProject(25, Math.cos(a1)*p.rad, Math.sin(a1)*p.rad + p.rad);
            let pR2 = isoProject(25, Math.cos(a2)*p.rad, Math.sin(a2)*p.rad + p.rad);
            
            // Render surface facets with matte color grading to simulate circular 3D metal curve depth shading.
            ctx.beginPath(); ctx.moveTo(pL1.x, pL1.y); ctx.lineTo(pL2.x, pL2.y); ctx.lineTo(pR2.x, pR2.y); ctx.lineTo(pR1.x, pR1.y);
            let color = Math.floor(35 + Math.sin(a1) * 15); ctx.fillStyle = `rgb(${color},${color},${color+5})`; ctx.fill();

            // Render scrolling kinetic music box pins (If activated via proximity or play)
            if ((lInt > 0.1 || isAuditioningThisTrack) && i % 2 === 0) {
                ctx.fillStyle = p.color;
                // Shift visual coordinates relative to current rotational cycle position mapping data.
                let px = -25 + 8 + ((i * 5 + p.rotation * 12) % 34);
                let pin = isoProject(px, Math.cos(a1)*p.rad, Math.sin(a1)*p.rad + p.rad);
                ctx.beginPath(); ctx.arc(pin.x, pin.y, 1, 0, Math.PI*2); ctx.fill();
            }
        }

        // 4. MECHANICAL ROTATING END CRANK 3D ASSEMBLY: projecting crank vectors
        let end = isoProject(25, 0, p.rad);
        ctx.save(); ctx.translate(end.x, end.y);
        
        // Extruded mechanical central drive rod line
        ctx.strokeStyle = '#5d646f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(6, 2); ctx.stroke();
        
        // Turning Crank Arm Lever Link (Spins geometrically flat oblique to simulate oblique angle perspective maps)
        ctx.translate(6, 2);
        let armX = Math.cos(p.rotation) * 10, armY = Math.sin(p.rotation) * 5;
        ctx.strokeStyle = '#9ca5b4'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(armX, armY); ctx.stroke();
        
        // Color-popped tactile handle peg visualization on link tip
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.ellipse(armX, armY, 2, 1, 0, 0, Math.PI*2); ctx.fill();
        
        ctx.restore();
        ctx.restore();
    });

    // *** DECOUPLED AUTOMATED FIREFLY KINETICS MODEL ***
    // (Barycentric Influence Navigator)
    if (isSystemLocked) {
        const pull = 0.54, friction = 0.94;
        
        // Force 1: Calculate visual "Gravity" force pull towards active tracking pointer target (A, B, or C)
        const tDx = targetP.x - moon.x, tDy = targetP.y - moon.y;
        const tD = Math.sqrt(tDx*tDx + tDy*tDy);
        if (tD > 10) { moon.vx += (tDx/tD) * pull; moon.vy += (tDy/tD) * pull; }
        
        // Force 2: Soft "Centripetal" pull towards influence center to constrain orbit
        const cDx = centerX - moon.x, cDy = centerY - moon.y, cD = Math.sqrt(cDx*cDx + cDy*cDy);
        if (cD > 10) { moon.vx += (cDx/cD) * 0.12; moon.vy += (cDy/cD) * 0.12; }
        
        // Force 3: Apply dynamic organic wiggle turbulence (Tremor simulation data factor)
        moon.vx += (Math.random()-0.5)*0.5; moon.vx *= friction; moon.vy *= friction;
        
        moon.x += moon.vx; moon.y += moon.vy;
    }

    // Dynamic Tempo Synchronization Logic based on averaged visually orbiting distance factor parameters data points.
    if (activeMusicBoxesCount > 0 && isSystemLocked) {
        let bpm = Math.max(20, Math.min(180, Math.round(180 - ((distSum/activeMusicBoxesCount)/moon.attractionRadius)*160)));
        tempoSlider.value = bpm; tempoVal.innerText = bpm;
        if (isPlayingGenerative) Tone.Transport.bpm.value = bpm;
    }

    // --- RENDER DYNAMIC LIQUID LIGHT FIELD FIREFLY CORE ---
    // (High-Intensity illumination source)
    let glow = ctx.createRadialGradient(moon.x, moon.y, 0, moon.x, moon.y, 44);
    glow.addColorStop(0, '#ffffff'); glow.addColorStop(0.15, 'rgba(238,255,204,0.9)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(moon.x, moon.y, 44, 0, Math.PI*2); ctx.fillStyle = glow; ctx.fill();
    
    // Core white hot point factor
    ctx.beginPath(); ctx.arc(moon.x, moon.y, moon.radius, 0, Math.PI*2); ctx.fillStyle = '#ffffff'; ctx.fill();

    // Advance physics/mixing weights relative to visual data, execute standard frame loop recursion.
    processAutomatedBarycentricInfluence();
    requestAnimationFrame(advanceCelestialPhysics);
}

// User Control Input & Drag and Drop Interaction Event Listeners for HTML Canvas
canvas.addEventListener('mousedown', (e) => {
    // Detect mouse-hit intersections on 3D visualization objects (Hitbox detection factor analysis)
    const clicked = musicBoxes.find(p => Math.sqrt((p.x - e.clientX)**2 + (p.y - e.clientY)**2) < 36);
    if (clicked) draggedMusicBox = clicked; // Activate Drag Override mode
    // Direct visual firefly navigation point override (Manual movement factor)
    else if (!isSystemLocked) { moon.x = e.clientX; moon.y = e.clientY; moon.vx = 0; moon.vy = 0; }
});
window.addEventListener('mousemove', (e) => {
    // If holding a 3D visual chassis, shift its location coordinates based on current visual location matrix pointers data.
    if (draggedMusicBox) { draggedMusicBox.x = e.clientX; draggedMusicBox.y = e.clientY; }
    // If automation unlocked, manual drag moves automated firefly position factors data.
    else if (!isSystemLocked && e.buttons === 1) { moon.x = e.clientX; moon.y = e.clientY; }
});
window.addEventListener('mouseup', () => draggedMusicBox = null); // Disable Drag Override Matrix logic.

// Interaction binding utility: Ensures canvas geometry data remains coherent during window scaling matrix shifts.
window.addEventListener('resize', initCelestialLayout);

// Standard application deployment & frame loop booting protocol.
initCelestialLayout();
requestAnimationFrame(advanceCelestialPhysics);

// System Initialization & Parallel Boot Protocol.
async function boot(targetMajorRoot = 0, targetMinorRoot = 9) {
        statusText.innerText = "Calibrating Harmonic Normalizer...";
        try {
            await analyzeMidiPerformance("midi_1.mid", harmonyBrainA, melodyBrainA, originalSequenceData1, targetMajorRoot, targetMinorRoot);
            await analyzeMidiPerformance("midi_2.mid", harmonyBrainB, melodyBrainB, originalSequenceData2, targetMajorRoot, targetMinorRoot);
            await analyzeMidiPerformance("midi_3.mid", harmonyBrainC, melodyBrainC, originalSequenceData3, targetMajorRoot, targetMinorRoot);
            
            // Update UI
            document.getElementById('k1').innerText = harmonyBrainA.metadata.key;
            document.getElementById('k2').innerText = harmonyBrainB.metadata.key;
            document.getElementById('k3').innerText = harmonyBrainC.metadata.key;
            
            statusText.innerText = "Engine is Ready (Key Normalization Active)"; 
            statusText.style.color = "#34c759";
        } catch(e) { 
            console.error(e);
            statusText.innerText = "ERROR: Could not normalize"; statusText.style.color = "#ff3b30";
        }
    }

    // The listener for the key selector — value is "majorRootIndex:minorRootIndex"
    document.getElementById('key-selector').addEventListener('change', (e) => {
        clearAllPlaybacks();
        const [majorRoot, minorRoot] = e.target.value.split(':').map(Number);
        boot(majorRoot, minorRoot);
    });
// Final matrix boot activation (default: C maj / A min).
boot(0, 9);