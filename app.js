/* =========================================================================
   # 1. Global App State
   # Core audio playback, track control, and application state shared across the system.
   ========================================================================= */

let polyChordSynth, expressiveMelodySynth, delay, reverb, timbreFilter, masterLimiter, distortion;

let isPlayingGenerative = false;
let isPlayingOrig1 = false, isPlayingOrig2 = false, isPlayingOrig3 = false;
let originalPart1, originalPart2, originalPart3;
let originalSequenceData1 = [], originalSequenceData2 = [], originalSequenceData3 = [];
let harmonyLoopEvent = null, melodyLoopEvent = null;
let currentChordState = null, currentMelodyState = null;
let weights = { w1: 0.333, w2: 0.333, w3: 0.333 };

let harmonyBrainA = { states: [], transitionMatrix: {} }, harmonyBrainB = { states: [], transitionMatrix: {} }, harmonyBrainC = { states: [], transitionMatrix: {} };
let melodyBrainA  = { states: [], transitionMatrix: {} }, melodyBrainB  = { states: [], transitionMatrix: {} }, melodyBrainC  = { states: [], transitionMatrix: {} };

let isSystemLocked = true;
let activeTargetMusicBoxId = 1;

const DIST_MIN = 363000;
const DIST_MAX = 406000;
const BPM_MIN  = 25;
const BPM_MAX  = 100;

let currentBpm   = 60;
let currentPhase = 0;


/* =========================================================================
   # 2. DOM Selectors & UI Bindings
   # Connect HTML interface elements to their JavaScript controls and display nodes.
   ========================================================================= */

const statusText      = document.getElementById('status-text');
const hudVectorDisplay = document.getElementById('live-vector-display');
const debugText       = document.getElementById('blend-display-debug');

const playBtn  = document.getElementById('main-art-toggle');
const lockBtn  = document.getElementById('lock-toggle-btn');

const midi1Btn = document.getElementById('midi1-btn');
const midi2Btn = document.getElementById('midi2-btn');
const midi3Btn = document.getElementById('midi3-btn');

const tempoSlider = document.getElementById('tempo-slider');
const tempoVal    = document.getElementById('tempo-val');
const chaosSlider = document.getElementById('chaos-slider');

const w1Slider = document.getElementById('w1-slider'), w1Val = document.getElementById('w1-val');
const w2Slider = document.getElementById('w2-slider'), w2Val = document.getElementById('w2-val');
const w3Slider = document.getElementById('w3-slider'), w3Val = document.getElementById('w3-val');


/* =========================================================================
   # 3. Audio Visualization Dynamics
   # Map audio state into visual color, timing, and display updates for the UI.
   ========================================================================= */

const pitchColorMap = {
    'C': { r: 14, g: 15, b: 17 }, 'D': { r: 20, g: 18, b: 24 }, 'E': { r: 24, g: 16, b: 16 },
    'F': { r: 14, g: 22, b: 18 }, 'G': { r: 24, g: 22, b: 16 }, 'A': { r: 18, g: 14, b: 24 }, 'B': { r: 14, g: 20, b: 24 }
};

let currentTargetColor     = { r: 14, g: 15, b: 17 };
let currentBackgroundColor = { r: 14, g: 15, b: 17 };

const getDurationTag = (dur) => {
    if (dur <= 0.18) return "16n";
    if (dur <= 0.38) return "8n";
    if (dur <= 0.75) return "4n";
    if (dur <= 1.4)  return "2n";
    return "1m";
};


/* =========================================================================
   # 4. Harmonic Normalization Engine
   # Detects key and mode, then computes transposition shifts to align MIDI tracks.
   ========================================================================= */

const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const KS_MAJOR   = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const KS_MINOR   = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];

function pearsonCorrelation(a, b) {
    const n = a.length;
    const meanA = a.reduce((s,v) => s+v, 0) / n;
    const meanB = b.reduce((s,v) => s+v, 0) / n;
    let num = 0, denomA = 0, denomB = 0;
    for (let i = 0; i < n; i++) {
        const da = a[i]-meanA, db = b[i]-meanB;
        num += da*db; denomA += da*da; denomB += db*db;
    }
    return num / Math.sqrt(denomA * denomB);
}

function detectKey(notes) {
    const histogram = new Array(12).fill(0);
    notes.forEach(n => { histogram[n.midi % 12] += (n.duration || 0.5); });
    let bestScore = -Infinity, bestRoot = 0, bestQuality = "major";
    for (let root = 0; root < 12; root++) {
        const rotated = histogram.map((_,i) => histogram[(i+root) % 12]);
        const majorScore = pearsonCorrelation(rotated, KS_MAJOR);
        const minorScore = pearsonCorrelation(rotated, KS_MINOR);
        if (majorScore > bestScore) { bestScore = majorScore; bestRoot = root; bestQuality = "major"; }
        if (minorScore > bestScore) { bestScore = minorScore; bestRoot = root; bestQuality = "minor"; }
    }
    return { root: NOTE_NAMES[bestRoot], index: bestRoot, quality: bestQuality };
}

function computeShift(detected, targetMajorRoot, targetMinorRoot) {
    const targetRoot = detected.quality === 'minor' ? targetMinorRoot : targetMajorRoot;
    const raw = (targetRoot - detected.index + 12) % 12;
    return raw > 6 ? raw - 12 : raw;
}


/* =========================================================================
   # 5. MIDI Feature Extraction & Markov Builder
   # Parse MIDI and build harmonic/melodic state machines for generative playback.
   ========================================================================= */

async function analyzeMidiPerformance(url, harmonyBrain, melodyBrain, sequenceContainer, targetMajorRoot, targetMinorRoot, keyDisplayId) {
    const midi = await Midi.fromUrl(url);
    const activeTrack = midi.tracks.find(t => t.notes && t.notes.length > 0);
    if (!activeTrack) throw new Error(`Missing note tracks inside ${url}`);

    const rawNotes = activeTrack.notes;

    rawNotes.forEach(n => {
        sequenceContainer.push({ time: n.time, note: n.name, duration: Math.min(n.duration, 4.0), velocity: n.velocity });
    });

    const detected = detectKey(rawNotes);
    const shift    = computeShift(detected, targetMajorRoot, targetMinorRoot);

    const transposedNotes = rawNotes.map(n => ({
        time: n.time, duration: n.duration, velocity: n.velocity,
        originalMidi: n.midi, midi: n.midi + shift, name: Tone.Midi(n.midi + shift).toNote()
    }));

    const shiftLabel   = shift === 0 ? 'no shift' : shift > 0 ? `+${shift} st` : `${shift} st`;
    const qualityLabel = detected.quality === 'minor' ? 'min' : 'maj';
    const keyEl        = keyDisplayId ? document.getElementById(keyDisplayId) : null;
    if (keyEl) keyEl.innerText = `${detected.root} ${qualityLabel}  →  ${shiftLabel}`;
    harmonyBrain.metadata = { key: `${detected.root} ${qualityLabel} → ${shiftLabel}` };

    const timeBlocks = {};
    transposedNotes.forEach(note => {
        const rt = Math.round(note.time * 8) / 8;
        if (!timeBlocks[rt]) timeBlocks[rt] = [];
        timeBlocks[rt].push(note);
    });

    const chordTimeKeys = Object.keys(timeBlocks).sort((a,b) => a-b);
    let chordHistory = [];
    for (let i = 0; i < chordTimeKeys.length; i++) {
        const timeKey     = parseFloat(chordTimeKeys[i]);
        const notesInBlock = timeBlocks[timeKey];
        const bassNotes   = notesInBlock.filter(n => n.originalMidi < 60).sort((a,b) => a.originalMidi - b.originalMidi);
        if (bassNotes.length > 0) {
            const chordString = bassNotes.map(n => n.name).join("-");
            let duration = (i < chordTimeKeys.length - 1)
                ? parseFloat(chordTimeKeys[i+1]) - timeKey
                : bassNotes.reduce((max,n) => Math.max(max, n.duration), 1.0);
            chordHistory.push({ notes: chordString, duration: getDurationTag(duration) });
        }
    }

    harmonyBrain.states = chordHistory;
    for (let i = 0; i < chordHistory.length - 1; i++) {
        const key = `${chordHistory[i].notes}_${chordHistory[i].duration}`;
        if (!harmonyBrain.transitionMatrix[key]) harmonyBrain.transitionMatrix[key] = [];
        harmonyBrain.transitionMatrix[key].push(chordHistory[i+1]);
    }

    const melodyNotes = transposedNotes.filter(n => n.originalMidi >= 60);
    let melodyHistory = [];
    for (let i = 0; i < melodyNotes.length; i++) {
        const current = melodyNotes[i];
        melodyHistory.push({ pitch: current.name, duration: getDurationTag(current.duration), velocity: current.velocity, isPause: false });
        if (i < melodyNotes.length - 1) {
            const gap = melodyNotes[i+1].time - (current.time + current.duration);
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
   # 6. Celestial Phase Engine
   # Compute moon phase values, map them to audio parameters, and update UI labels.
   ========================================================================= */

function mapValue(value, inMin, inMax, outMin, outMax) {
    const clamped = Math.min(Math.max(value, inMin), inMax);
    return (clamped - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
}

function getMoonPhaseName(phase) {
    if (phase < 0.05 || phase > 0.95) return "New Moon";
    if (phase < 0.20) return "Waxing Crescent";
    if (phase < 0.30) return "First Quarter";
    if (phase < 0.45) return "Waxing Gibbous";
    if (phase < 0.55) return "Full Moon";
    if (phase < 0.70) return "Waning Gibbous";
    if (phase < 0.80) return "Last Quarter";
    return "Waning Crescent";
}

function updateCelestialParameters(isManual = false) {
    let distance, distortionAmount;

    if (isManual) {
        currentBpm   = parseFloat(document.getElementById('tempo-slider').value);
        currentPhase = parseFloat(document.getElementById('test-phase').value);
        distance     = mapValue(currentBpm, BPM_MIN, BPM_MAX, DIST_MAX, DIST_MIN);
    } else {
        const now      = new Date();
        const moonIllum = SunCalc.getMoonIllumination(now);
        currentPhase   = moonIllum.phase;
        distance       = SunCalc.getMoonPosition(now, 0, 0).distance;
        currentBpm     = mapValue(distance, DIST_MIN, DIST_MAX, BPM_MAX, BPM_MIN);
        applyMonth(now.getMonth());
    }

    const peakAtFullMoon  = 1 - (Math.abs(currentPhase - 0.5) * 2);
    const freq            = mapValue(peakAtFullMoon, 0, 1, 400, 4000);
    distortionAmount      = mapValue(peakAtFullMoon, 0, 1, 0, 0.5);

    if (typeof currentBpm !== 'number' || isNaN(currentBpm)) { console.warn("Invalid BPM."); return; }

    Tone.Transport.bpm.rampTo(currentBpm, 0.1);
    if (timbreFilter) timbreFilter.frequency.rampTo(freq, 0.5);
    if (typeof distortion !== 'undefined') distortion.distortion = distortionAmount;

    const elPhase   = document.getElementById('mon-phase');
    const elFreq    = document.getElementById('mon-freq');
    const elDistort = document.getElementById('mon-distort');
    const elBpmLbl  = document.getElementById('mon-bpm-label');
    if (elPhase)   elPhase.innerText   = getMoonPhaseName(currentPhase);
    if (elFreq)    elFreq.innerText    = Math.round(freq);
    if (elDistort) elDistort.innerText = distortionAmount.toFixed(2);
    if (elBpmLbl)  elBpmLbl.innerText  = `BPM: ${Math.round(currentBpm)} | Distance: ${Math.round(distance).toLocaleString()} km | ${isManual ? 'Manual' : 'Auto'}`;
}

const MONTH_KEYS = [
    { name: "January",   label: "C maj / A min",   maj: 0,  min: 9  },
    { name: "February",  label: "G maj / E min",   maj: 7,  min: 4  },
    { name: "March",     label: "D maj / B min",   maj: 2,  min: 11 },
    { name: "April",     label: "A maj / F# min",  maj: 9,  min: 6  },
    { name: "May",       label: "E maj / C# min",  maj: 4,  min: 1  },
    { name: "June",      label: "B maj / G# min",  maj: 11, min: 8  },
    { name: "July",      label: "F# maj / D# min", maj: 6,  min: 3  },
    { name: "August",    label: "Db maj / Bb min", maj: 1,  min: 10 },
    { name: "September", label: "Ab maj / F min",  maj: 8,  min: 5  },
    { name: "October",   label: "Eb maj / C min",  maj: 3,  min: 0  },
    { name: "November",  label: "Bb maj / G min",  maj: 10, min: 7  },
    { name: "December",  label: "F maj / D min",   maj: 5,  min: 2  },
];

let _lastBootedMonthIndex = -1;

async function applyMonth(monthIndex, force = false) {
    if (monthIndex === _lastBootedMonthIndex && !force) return;
    _lastBootedMonthIndex = monthIndex;

    const key = MONTH_KEYS[monthIndex];
    const sel = document.getElementById('key-selector');
    if (sel) sel.value = monthIndex;

    harmonyBrainA = { states: [], transitionMatrix: {} }; harmonyBrainB = { states: [], transitionMatrix: {} }; harmonyBrainC = { states: [], transitionMatrix: {} };
    melodyBrainA  = { states: [], transitionMatrix: {} }; melodyBrainB  = { states: [], transitionMatrix: {} }; melodyBrainC  = { states: [], transitionMatrix: {} };
    originalSequenceData1 = []; originalSequenceData2 = []; originalSequenceData3 = [];
    ['k1','k2','k3'].forEach(id => { const el = document.getElementById(id); if (el) el.innerText = '—'; });

    statusText.innerText = `Setting key: ${key.name} — ${key.label}`;
    statusText.style.color = "";

    await analyzeMidiPerformance("midi_1.mid", harmonyBrainA, melodyBrainA, originalSequenceData1, key.maj, key.min, 'k1');
    await analyzeMidiPerformance("midi_2.mid", harmonyBrainB, melodyBrainB, originalSequenceData2, key.maj, key.min, 'k2');
    await analyzeMidiPerformance("midi_3.mid", harmonyBrainC, melodyBrainC, originalSequenceData3, key.maj, key.min, 'k3');

    statusText.innerText = "Engine is Ready";
    statusText.style.color = "#34c759";
}


/* =========================================================================
   # 7. Audio Pipeline Configuration
   # Initialize the Web Audio synthesis engine, effects chain, and tone routing.
   ========================================================================= */

function setupAudioEngine() {
    if (polyChordSynth) return;

    masterLimiter = new Tone.Limiter(0).toDestination();
    reverb        = new Tone.Reverb({ decay: 7.5, wet: 0.55 }).connect(masterLimiter);
    delay         = new Tone.FeedbackDelay({ delayTime: "4n.", feedback: 0.35, wet: 0.25 }).connect(reverb);
    timbreFilter  = new Tone.Filter({ type: "lowpass", frequency: 1200, Q: 1 }).connect(delay);
    distortion    = new Tone.Distortion(0.01).connect(timbreFilter);

    polyChordSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" }, envelope: { attack: 0.02, decay: 0.8, sustain: 0.3, release: 1.5 }
    }).connect(timbreFilter);
    polyChordSynth.volume.value = -16;

    expressiveMelodySynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" }, envelope: { attack: 0.005, decay: 0.2, sustain: 0.1, release: 0.3 }
    }).connect(distortion);
    expressiveMelodySynth.volume.value = -10;
}


/* =========================================================================
   # 8. Generative Music Logic
   # Manage influence weights, probabilistic transitions, and generative note selection.
   ========================================================================= */

function processAutomatedBarycentricInfluence() {
    if (!isSystemLocked) return;
    // Use the centre of the lamp's illuminated area, not the screen centre
    const cx = lampLightCenterX || canvas.width / 2;
    const cy = lampLightCenterY || canvas.height * 0.75;
    const d1 = Math.sqrt((musicBoxes[0].x - cx)**2 + (musicBoxes[0].y - cy)**2);
    const d2 = Math.sqrt((musicBoxes[1].x - cx)**2 + (musicBoxes[1].y - cy)**2);
    const d3 = Math.sqrt((musicBoxes[2].x - cx)**2 + (musicBoxes[2].y - cy)**2);
    const maxRadius = 600;
    let s1 = Math.max(0.01, maxRadius - d1), s2 = Math.max(0.01, maxRadius - d2), s3 = Math.max(0.01, maxRadius - d3);
    const total = s1 + s2 + s3;
    weights.w1 = s1 / total; weights.w2 = s2 / total; weights.w3 = s3 / total;

    w1Slider.value = Math.round(weights.w1 * 100); w1Val.innerText = w1Slider.value + "%";
    w2Slider.value = Math.round(weights.w2 * 100); w2Val.innerText = w2Slider.value + "%";
    w3Slider.value = Math.round(weights.w3 * 100); w3Val.innerText = w3Slider.value + "%";
    if (debugText) debugText.innerText = `Song 1: ${w1Slider.value}% | Song 2: ${w2Slider.value}% | Song 3: ${w3Slider.value}%`;
}

function selectBrainFromTernary(brainA, brainB, brainC) {
    const rand = Math.random();
    if (rand < weights.w1)              { activeTargetMusicBoxId = 1; return brainA; }
    if (rand < weights.w1 + weights.w2) { activeTargetMusicBoxId = 2; return brainB; }
    activeTargetMusicBoxId = 3; return brainC;
}

function triggerHarmonyGeneration(time) {
    if (!isPlayingGenerative) return;
    const wanderFactor = chaosSlider ? parseFloat(chaosSlider.value) : 0.15;
    const activeBrain  = selectBrainFromTernary(harmonyBrainA, harmonyBrainB, harmonyBrainC);
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

    const targetDisplay = document.getElementById('live-vector-display');
    if (targetDisplay) targetDisplay.innerText = `${currentChordState.notes} [${duration}]`;

    harmonyLoopEvent.interval = duration;
}

function triggerMelodyGeneration(time) {
    if (!isPlayingGenerative) return;
    const wanderFactor = chaosSlider ? parseFloat(chaosSlider.value) : 0.15;
    const activeBrain  = selectBrainFromTernary(melodyBrainA, melodyBrainB, melodyBrainC);
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
   # 9. Audition Playback Engine
   # Play back isolated MIDI audition tracks and manage overall playback cleanup.
   ========================================================================= */

function buildTonePartFromContainer(containerData) {
    return new Tone.Part((time, event) => {
        if (event.note) {
            const safeDuration = Math.min(event.duration, 4.0);
            if (Tone.Midi(event.note).toMidi() < 60) {
                polyChordSynth.triggerRelease(event.note, time);
                polyChordSynth.triggerAttackRelease(event.note, safeDuration, time, event.velocity);
            } else {
                expressiveMelodySynth.triggerRelease(event.note, time);
                expressiveMelodySynth.triggerAttackRelease(event.note, safeDuration, time, event.velocity);
            }
        }
    }, containerData);
}

function clearAllPlaybacks() {
    if (isPlayingGenerative) {
        isPlayingGenerative = false;
        if (playBtn) { playBtn.innerText = "Start Sound"; playBtn.classList.remove('active-stream'); }
        if (harmonyLoopEvent) { harmonyLoopEvent.stop(); harmonyLoopEvent.dispose(); harmonyLoopEvent = null; }
        if (melodyLoopEvent)  { melodyLoopEvent.stop();  melodyLoopEvent.dispose();  melodyLoopEvent = null; }
    }
    if (originalPart1) { originalPart1.stop(); originalPart1.dispose(); originalPart1 = null; }
    isPlayingOrig1 = false; if (midi1Btn) midi1Btn.classList.remove('active');
    if (originalPart2) { originalPart2.stop(); originalPart2.dispose(); originalPart2 = null; }
    isPlayingOrig2 = false; if (midi2Btn) midi2Btn.classList.remove('active');
    if (originalPart3) { originalPart3.stop(); originalPart3.dispose(); originalPart3 = null; }
    isPlayingOrig3 = false; if (midi3Btn) midi3Btn.classList.remove('active');

    Tone.Transport.stop(); Tone.Transport.position = 0;
    if (polyChordSynth)        polyChordSynth.releaseAll();
    if (expressiveMelodySynth) expressiveMelodySynth.releaseAll();
    if (hudVectorDisplay)      hudVectorDisplay.innerText = "Engine Standby";
}


/* =========================================================================
   # 10. User Interaction & Control Handlers
   # Attach UI controls and button behavior for play, lock, and audition interaction.
   ========================================================================= */

if (playBtn) playBtn.addEventListener('click', async () => {
    await Tone.start();
    setupAudioEngine();
    if (isPlayingGenerative) {
        clearAllPlaybacks();
        currentTargetColor = { r: 14, g: 15, b: 17 };
    } else {
        clearAllPlaybacks();
        isPlayingGenerative = true;
        playBtn.innerText = "Stop Sound";
        playBtn.classList.add('active-stream');
        currentChordState = null; currentMelodyState = null;
        harmonyLoopEvent = new Tone.Loop((time) => { triggerHarmonyGeneration(time); }, "2n").start(0);
        melodyLoopEvent  = new Tone.Loop((time) => { triggerMelodyGeneration(time); },  "8n").start(0);
        Tone.Transport.start();
    }
});

if (midi1Btn) midi1Btn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingOrig1) { clearAllPlaybacks(); } else {
        clearAllPlaybacks();
        isPlayingOrig1 = true; midi1Btn.classList.add('active');
        activeTargetMusicBoxId = 1;
        originalPart1 = buildTonePartFromContainer(originalSequenceData1);
        originalPart1.start(0); Tone.Transport.start();
        if (hudVectorDisplay) hudVectorDisplay.innerText = "Auditioning MIDI Track 1";
    }
});

if (midi2Btn) midi2Btn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingOrig2) { clearAllPlaybacks(); } else {
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
    if (isPlayingOrig3) { clearAllPlaybacks(); } else {
        clearAllPlaybacks();
        isPlayingOrig3 = true; midi3Btn.classList.add('active');
        activeTargetMusicBoxId = 3;
        originalPart3 = buildTonePartFromContainer(originalSequenceData3);
        originalPart3.start(0); Tone.Transport.start();
        if (hudVectorDisplay) hudVectorDisplay.innerText = "Auditioning MIDI Track 3";
    }
});

if (lockBtn) lockBtn.addEventListener('click', () => {
    isSystemLocked = !isSystemLocked;
    const _tempoSlider = document.getElementById('tempo-slider');
    const _phaseSlider = document.getElementById('test-phase');
    const _w1 = document.getElementById('w1-slider');
    const _w2 = document.getElementById('w2-slider');
    const _w3 = document.getElementById('w3-slider');

    if (isSystemLocked) {
        lockBtn.innerText = "🔒 System Automation: LOCKED";
        lockBtn.classList.remove('unlocked');
        _lastBootedMonthIndex = -1;
        updateCelestialParameters(false);
        _tempoSlider.disabled = true; _phaseSlider.disabled = true;
        _w1.disabled = true; _w2.disabled = true; _w3.disabled = true;
        _tempoSlider.value = Math.round(currentBpm);
        _phaseSlider.value = currentPhase.toFixed(2);
        initCelestialLayout();
    } else {
        lockBtn.innerText = "🔓 Manual Override: UNLOCKED";
        lockBtn.classList.add('unlocked');
        _tempoSlider.disabled = false; _phaseSlider.disabled = false;
        _w1.disabled = false; _w2.disabled = false; _w3.disabled = false;
        updateCelestialParameters(false);
    }
});

if (tempoSlider) tempoSlider.addEventListener('input', () => { if (!isSystemLocked) updateCelestialParameters(true); });

const phaseSlider = document.getElementById('test-phase');
if (phaseSlider) phaseSlider.addEventListener('input', () => { if (!isSystemLocked) updateCelestialParameters(true); });

function handleManualWeightMixUpdate() {
    if (isSystemLocked) return;
    let v1 = parseFloat(w1Slider.value), v2 = parseFloat(w2Slider.value), v3 = parseFloat(w3Slider.value);
    let sum = v1 + v2 + v3;
    if (sum === 0) { v1 = 1; v2 = 1; v3 = 1; sum = 3; }
    weights.w1 = v1/sum; weights.w2 = v2/sum; weights.w3 = v3/sum;
    w1Val.innerText = `${Math.round(weights.w1*100)}%`;
    w2Val.innerText = `${Math.round(weights.w2*100)}%`;
    w3Val.innerText = `${Math.round(weights.w3*100)}%`;
    if (debugText) debugText.innerText = `Song 1: ${Math.round(weights.w1*100)}% | Song 2: ${Math.round(weights.w2*100)}% | Song 3: ${Math.round(weights.w3*100)}%`;
}
if (w1Slider) w1Slider.addEventListener('input', handleManualWeightMixUpdate);
if (w2Slider) w2Slider.addEventListener('input', handleManualWeightMixUpdate);
if (w3Slider) w3Slider.addEventListener('input', handleManualWeightMixUpdate);


/* =========================================================================
   # 11. Canvas Rendering Engine
   # Render the lamp, moon window, music boxes, firefly, and overall scene animation.
   ========================================================================= */

const canvas = document.getElementById('art-surface');
const ctx    = canvas.getContext('2d');

let moon = { x: window.innerWidth / 2, y: window.innerHeight * 0.75, vx: 2, vy: -1.5, radius: 3, attractionRadius: 400 };

let musicBoxes = [
    { id: 1, x: 0, y: 0, rad: 16, length: 50, rotation: 0, color: "#ff3b30", active: true },
    { id: 2, x: 0, y: 0, rad: 16, length: 50, rotation: 0, color: "#ffcc00", active: true },
    { id: 3, x: 0, y: 0, rad: 16, length: 50, rotation: 0, color: "#007aff", active: true }
];

let draggedMusicBox = null;

// Lamp position — floor lamp, left side
let lampPos = { x: 0, y: 0 };
// Centre of the lamp's illuminated area (computed each frame inside drawLamp)
let lampLightCenterX = 0, lampLightCenterY = 0;

function initCelestialLayout() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    // Place the boxes on the lower third of the room floor
    musicBoxes[0].x = canvas.width / 2;      musicBoxes[0].y = canvas.height * 0.72;
    musicBoxes[1].x = canvas.width * 0.25;   musicBoxes[1].y = canvas.height * 0.78;
    musicBoxes[2].x = canvas.width * 0.75;   musicBoxes[2].y = canvas.height * 0.78;

    // Floor lamp on the left side, positioned higher than the boxes
    lampPos.x = canvas.width * 0.12;
    lampPos.y = canvas.height * 0.38;   // higher value places the lamp higher on the canvas

    if (isSystemLocked) {
        weights = { w1: 0.33, w2: 0.33, w3: 0.33 };
        if (w1Slider) w1Slider.value = 1;
        if (w2Slider) w2Slider.value = 1;
        if (w3Slider) w3Slider.value = 1;
    }
}

function isoProject(x, y, z) {
    return {
        x: (x - y) * Math.cos(Math.PI / 6),
        y: (x + y) * Math.sin(Math.PI / 6) - z
    };
}

// ─── FLOOR LAMP ───────────────────────────────────────────────────────────
function drawLamp() {
    const lx   = lampPos.x;
    const base = canvas.height - 30;
    const head = lampPos.y;   // top of the pole / centre of the lampshade

    // Haste vertical
    ctx.strokeStyle = 'rgba(160, 140, 100, 0.55)';
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.moveTo(lx, base);
    ctx.lineTo(lx, head);
    ctx.stroke();

    // Base of the lamp stand
    ctx.strokeStyle = 'rgba(160, 140, 100, 0.4)';
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.moveTo(lx - 20, base);
    ctx.lineTo(lx + 20, base);
    ctx.stroke();

    // Curved arm connecting the pole to the lampshade
    ctx.strokeStyle = 'rgba(160, 140, 100, 0.45)';
    ctx.lineWidth   = 2.5;
    ctx.beginPath();
    ctx.moveTo(lx, head);
    ctx.quadraticCurveTo(lx + 30, head - 5, lx + 42, head - 22);
    ctx.stroke();

    // Inverted lampshade with the wider edge at the bottom for a realistic lamp shape
    const ax = lx + 42, ay = head - 22;
    // narrow top, wide bottom
    ctx.beginPath();
    ctx.moveTo(ax - 12, ay - 14);   // topo esquerdo (estreito)
    ctx.lineTo(ax + 12, ay - 14);   // topo direito
    ctx.lineTo(ax + 28, ay + 12);   // right base (wide)
    ctx.lineTo(ax - 28, ay + 12);   // left base
    ctx.closePath();
    ctx.fillStyle   = 'rgba(210, 185, 120, 0.22)';
    ctx.strokeStyle = 'rgba(210, 185, 120, 0.55)';
    ctx.lineWidth   = 1;
    ctx.fill();
    ctx.stroke();

    // Light source bulb at the base of the lampshade
    const bx = ax, by = ay + 12;
    ctx.beginPath();
    ctx.arc(bx, by, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 245, 190, 0.95)';
    ctx.fill();

    // Immediate halo around the bulb
    const halo = ctx.createRadialGradient(bx, by, 0, bx, by, 30);
    halo.addColorStop(0,   'rgba(255, 245, 190, 0.18)');
    halo.addColorStop(1,   'rgba(0, 0, 0, 0)');
    ctx.beginPath(); ctx.arc(bx, by, 30, 0, Math.PI * 2);
    ctx.fillStyle = halo; ctx.fill();

    // Main light cone from the bulb down and to the right, covering the boxes
    const coneH    = canvas.height * 1.1;
    const coneW    = canvas.height * 0.90;
    const coneGrad = ctx.createRadialGradient(bx, by, 0, bx, by, coneH);
    coneGrad.addColorStop(0,    'rgba(255, 240, 180, 0.13)');
    coneGrad.addColorStop(0.35, 'rgba(255, 230, 150, 0.055)');
    coneGrad.addColorStop(1,    'rgba(0, 0, 0, 0)');
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - coneW * 0.35, canvas.height);
    ctx.lineTo(bx + coneW,        canvas.height);
    ctx.closePath();
    ctx.fillStyle = coneGrad;
    ctx.fill();

    // Store the lamp cone center for influence-weight calculations
    // The geometric centre at box height is roughly 2/3 of the way from bx to bx+coneW
    lampLightCenterX = bx + coneW * 0.33;
    lampLightCenterY = canvas.height * 0.75;
}

// ─── MOON WINDOW ───────────────────────────────────────────────────────────
function drawWindow() {
    const winW = 460, winH = 240;
    const wx   = canvas.width / 2 - winW / 2;
    const wy   = 80;   // um pouco abaixo do título

    // Background sky inside the moon window
    ctx.fillStyle = '#03030a';
    ctx.fillRect(wx, wy, winW, winH);

    // Outer frame of the moon window
    ctx.strokeStyle = 'rgba(70, 62, 48, 0.85)';
    ctx.lineWidth   = 10;
    ctx.strokeRect(wx, wy, winW, winH);

    // Soft inner glow for the frame
    ctx.strokeStyle = 'rgba(110, 95, 65, 0.25)';
    ctx.lineWidth   = 2;
    ctx.strokeRect(wx + 5, wy + 5, winW - 10, winH - 10);

    // Moon phase rendering:
    // phase=0 => New Moon (dark), phase=0.5 => Full Moon (bright)
    // The offset moves the shadow; at phase=0.5 the shadow is off-centre, showing the full moon.
    // At phase=0 or 1 the shadow covers the moon fully, producing New Moon.
    const moonR = 46;
    const mx = wx + winW / 2;
    const my = wy + winH / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(wx + 2, wy + 2, winW - 4, winH - 4);
    ctx.clip();

    // Fixed illuminated moon disc
    ctx.beginPath();
    ctx.arc(mx, my, moonR, 0, Math.PI * 2);
    ctx.fillStyle = '#dddbc8';
    ctx.fill();

    // Moving dark mask to create the lunar phases:
    // phase=0/1 => new moon (mask centered); phase=0.5 => full moon (mask shifted away).
    const phaseFactor = 1 - Math.abs(currentPhase - 0.5) * 2;
    const shadowShift = phaseFactor * moonR * 2;
    const shadowDirection = currentPhase < 0.5 ? -1 : 1;
    const shadowX = mx + shadowDirection * shadowShift;

    ctx.beginPath();
    ctx.arc(shadowX, my, moonR, 0, Math.PI * 2);
    ctx.fillStyle = '#03030a';
    ctx.fill();

    ctx.restore();
}

// ─── ISOMETRIC CYLINDER (music box) ─────────────────────────────────────────
function drawMusicBox(p, lInt, isAuditioningThisTrack) {
    ctx.save();
    ctx.translate(p.x, p.y);

    // 1. Radiant glow
    if (lInt > 0 || isAuditioningThisTrack) {
        const glowScalar = isAuditioningThisTrack ? 1.0 : lInt;
        const grad = ctx.createRadialGradient(0, 0, p.length * 0.2, 0, 0, p.length * 2.2);
        grad.addColorStop(0, `rgba(255,255,255,${(glowScalar * 0.08).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath(); ctx.arc(0, 0, p.length * 2.2, 0, Math.PI * 2);
        ctx.fillStyle = grad; ctx.fill();
    }

    // 2. Isometric base plate
    const b1 = isoProject(-30,-20,0), b2 = isoProject(30,-20,0), b3 = isoProject(30,20,0), b4 = isoProject(-30,20,0);
    ctx.beginPath();
    ctx.moveTo(b1.x,b1.y); ctx.lineTo(b2.x,b2.y); ctx.lineTo(b3.x,b3.y); ctx.lineTo(b4.x,b4.y);
    ctx.fillStyle   = '#1c1e22';
    ctx.fill();
    ctx.strokeStyle = p.active ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // 3. Cylinder facets
    const segments = 12;
    for (let i = 0; i < segments / 2; i++) {
        const a1 = (i / segments) * Math.PI * 2 - Math.PI / 2;
        const a2 = ((i+1) / segments) * Math.PI * 2 - Math.PI / 2;
        const pL1 = isoProject(-25, Math.cos(a1)*p.rad, Math.sin(a1)*p.rad + p.rad);
        const pL2 = isoProject(-25, Math.cos(a2)*p.rad, Math.sin(a2)*p.rad + p.rad);
        const pR1 = isoProject( 25, Math.cos(a1)*p.rad, Math.sin(a1)*p.rad + p.rad);
        const pR2 = isoProject( 25, Math.cos(a2)*p.rad, Math.sin(a2)*p.rad + p.rad);

        ctx.beginPath();
        ctx.moveTo(pL1.x,pL1.y); ctx.lineTo(pL2.x,pL2.y); ctx.lineTo(pR2.x,pR2.y); ctx.lineTo(pR1.x,pR1.y);
        const shade = Math.floor(35 + Math.sin(a1) * 15);
        ctx.fillStyle = `rgb(${shade},${shade},${shade+5})`;
        ctx.fill();

        // Pins
        if ((lInt > 0.1 || isAuditioningThisTrack) && i % 2 === 0) {
            ctx.fillStyle = p.color;
            const px  = -25 + 8 + ((i * 5 + p.rotation * 12) % 34);
            const pin = isoProject(px, Math.cos(a1)*p.rad, Math.sin(a1)*p.rad + p.rad);
            ctx.beginPath(); ctx.arc(pin.x, pin.y, 1, 0, Math.PI * 2); ctx.fill();
        }
    }

    // 4. Rotating end crank
    const endPt = isoProject(25, 0, p.rad);
    ctx.save();
    ctx.translate(endPt.x, endPt.y);
    ctx.strokeStyle = '#5d646f'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(6,2); ctx.stroke();
    ctx.translate(6, 2);
    const armX = Math.cos(p.rotation) * 10, armY = Math.sin(p.rotation) * 5;
    ctx.strokeStyle = '#9ca5b4';
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(armX,armY); ctx.stroke();
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.ellipse(armX, armY, 2, 1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.restore();
}

// ─── MAIN ANIMATION LOOP ─────────────────────────────────────────────────────
function advanceCelestialPhysics() {

    // Smooth background color transition
    currentBackgroundColor.r += (currentTargetColor.r - currentBackgroundColor.r) * 0.04;
    currentBackgroundColor.g += (currentTargetColor.g - currentBackgroundColor.g) * 0.04;
    currentBackgroundColor.b += (currentTargetColor.b - currentBackgroundColor.b) * 0.04;

    // Motion-blur clear (low alpha = long trail)
    ctx.fillStyle = `rgba(${Math.round(currentBackgroundColor.r)},${Math.round(currentBackgroundColor.g)},${Math.round(currentBackgroundColor.b)},0.15)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // ── Draw lamp and window into scene ──
    drawLamp();
    drawWindow();

    // ── Music boxes ──
    const centerX = canvas.width / 2, centerY = canvas.height / 2;

    musicBoxes.forEach(p => {
        const dx = p.x - centerX, dy = p.y - centerY;
        p.active = Math.sqrt(dx*dx + dy*dy) < moon.attractionRadius;

        const fDist = Math.sqrt((p.x - moon.x)**2 + (p.y - moon.y)**2);
        // Increase radius to 350px so the light influence reaches all boxes
        const lInt  = Math.max(0, 1 - (fDist / 350));
        const isAuditioningThisTrack = (p.id === 1 && isPlayingOrig1) || (p.id === 2 && isPlayingOrig2) || (p.id === 3 && isPlayingOrig3);

        // Rotação sempre ativa — proporcional à proximidade do pirilampo,
        // ou a 100% quando em audição isolada.
        // Rotation runs continuously so boxes keep turning even when not generative.
        const motionMultiplier = isAuditioningThisTrack ? 1.0 : lInt;
        if (motionMultiplier > 0) {
            p.rotation += (Tone.Transport.bpm.value / 60) * 0.035 * motionMultiplier;
        }

        drawMusicBox(p, lInt, isAuditioningThisTrack);
    });

    // ── Firefly physics ──
    if (isSystemLocked) {
        const pull = 0.54, friction = 0.94;
        const targetP = musicBoxes.find(p => p.id === activeTargetMusicBoxId) || musicBoxes[0];

        const tDx = targetP.x - moon.x, tDy = targetP.y - moon.y;
        const tD  = Math.sqrt(tDx*tDx + tDy*tDy);
        if (tD > 10) { moon.vx += (tDx/tD) * pull; moon.vy += (tDy/tD) * pull; }

        const cDx = centerX - moon.x, cDy = centerY - moon.y, cD = Math.sqrt(cDx*cDx + cDy*cDy);
        if (cD > 10) { moon.vx += (cDx/cD) * 0.12; moon.vy += (cDy/cD) * 0.12; }

        moon.vx += (Math.random()-0.5)*0.5; moon.vx *= friction; moon.vy *= friction;
        moon.x  += moon.vx; moon.y += moon.vy;
    }

    // ── Firefly render ──
    const glow = ctx.createRadialGradient(moon.x, moon.y, 0, moon.x, moon.y, 44);
    glow.addColorStop(0,    '#ffffff');
    glow.addColorStop(0.15, 'rgba(238,255,204,0.9)');
    glow.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(moon.x, moon.y, 44, 0, Math.PI*2); ctx.fillStyle = glow; ctx.fill();
    ctx.beginPath(); ctx.arc(moon.x, moon.y, moon.radius, 0, Math.PI*2); ctx.fillStyle = '#ffffff'; ctx.fill();

    processAutomatedBarycentricInfluence();
    requestAnimationFrame(advanceCelestialPhysics);
}


/* =========================================================================
   # 12. Input & Resize Events
   # Handle canvas mouse interaction, dragging, and window resize updates.
   ========================================================================= */

canvas.addEventListener('mousedown', (e) => {
    const clicked = musicBoxes.find(p => Math.sqrt((p.x-e.clientX)**2 + (p.y-e.clientY)**2) < 36);
    if (clicked) draggedMusicBox = clicked;
    else if (!isSystemLocked) { moon.x = e.clientX; moon.y = e.clientY; moon.vx = 0; moon.vy = 0; }
});
window.addEventListener('mousemove', (e) => {
    if (draggedMusicBox) { draggedMusicBox.x = e.clientX; draggedMusicBox.y = e.clientY; }
    else if (!isSystemLocked && e.buttons === 1) { moon.x = e.clientX; moon.y = e.clientY; }
});
window.addEventListener('mouseup', () => draggedMusicBox = null);
window.addEventListener('resize', initCelestialLayout);


/* =========================================================================
   # 13. Application Boot
   # Start the app by analyzing MIDI, setting the key, and initializing audio state.
   ========================================================================= */

const keySelector = document.getElementById('key-selector');
if (keySelector) {
    keySelector.addEventListener('change', async (e) => {
        if (isSystemLocked) { keySelector.value = _lastBootedMonthIndex; return; }
        await applyMonth(parseInt(e.target.value), true);
    });
}

async function boot() {
    statusText.innerText   = "Calibrating Harmonic Engine...";
    statusText.style.color = "";
    try {
        setupAudioEngine();
        await applyMonth(new Date().getMonth(), true);
        updateCelestialParameters(false);
    } catch(e) {
        statusText.innerText   = "ERROR: " + e.message;
        statusText.style.color = "#ff3b30";
        console.error(e);
    }
}

initCelestialLayout();
requestAnimationFrame(advanceCelestialPhysics);
boot();