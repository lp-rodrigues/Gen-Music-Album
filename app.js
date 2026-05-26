// Global App Playback States
let isPlayingGenerative = false;
let isPlayingOrig1 = false;
let isPlayingOrig2 = false;
let isPlayingOrig3 = false;

let originalPart1 = null;
let originalPart2 = null;
let originalPart3 = null;
let originalSequenceData1 = [];
let originalSequenceData2 = [];
let originalSequenceData3 = [];

// Advanced Multi-Engine Multi-Dimensional Markov Brains
let harmonyBrainA = { states: [], transitionMatrix: {} };
let harmonyBrainB = { states: [], transitionMatrix: {} };
let harmonyBrainC = { states: [], transitionMatrix: {} };

let melodyBrainA = { states: [], transitionMatrix: {} };
let melodyBrainB = { states: [], transitionMatrix: {} };
let melodyBrainC = { states: [], transitionMatrix: {} };

// Live State Pointers
let currentChordState = null; 
let currentMelodyState = null;      

// Audio Synths Pipelines
let polyChordSynth, expressiveMelodySynth, delay, reverb;

// Live Interpolated Song Target Weights (Calculated via Triangle Geometry)
let weights = { w1: 0.333, w2: 0.333, w3: 0.333 };

// DOM Selectors
const statusText = document.getElementById('status-text');
const chordText = document.getElementById('chord-text');
const playBtn = document.getElementById('play-btn');
const midi1Btn = document.getElementById('midi1-btn');
const midi2Btn = document.getElementById('midi2-btn');
const midi3Btn = document.getElementById('midi3-btn'); // Added Engine 3 Interface Button
const tempoSlider = document.getElementById('tempo-slider');
const tempoVal = document.getElementById('tempo-val');
const chaosSlider = document.getElementById('chaos-slider');
const chaosVal = document.getElementById('chaos-val');

// Helper to quantize random file timings into clean musical notation strings
const getDurationTag = (dur) => {
    if (dur <= 0.18) return "16n";
    if (dur <= 0.38) return "8n";
    if (dur <= 0.75) return "4n";
    if (dur <= 1.4) return "2n";
    return "1m"; 
};

// 1. Dual-Feature Extraction & Track Splitting Engine
async function analyzeMidiPerformance(url, harmonyBrain, melodyBrain, sequenceContainer) {
    const midi = await Midi.fromUrl(url);
    const activeTrack = midi.tracks.find(t => t.notes && t.notes.length > 0);
    if (!activeTrack) throw new Error(`Missing note tracks inside ${url}`);

    const rawNotes = activeTrack.notes;
    
    rawNotes.forEach(n => sequenceContainer.push({ time: n.time, note: n.name, duration: n.duration, velocity: n.velocity }));

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
        const bassNotes = notesInBlock.filter(n => n.midi < 60).sort((a,b) => a.midi - b.midi);
        
        if (bassNotes.length > 0) {
            const chordString = bassNotes.map(n => n.name).join("-");
            
            let duration = 0.5; 
            if (i < chordTimeKeys.length - 1) {
                duration = parseFloat(chordTimeKeys[i+1]) - timeKey;
            } else {
                const maxEnd = bassNotes.reduce((max, n) => Math.max(max, n.duration), 1.0);
                duration = maxEnd;
            }

            chordHistory.push({
                notes: chordString,
                duration: getDurationTag(duration)
            });
        }
    }

    harmonyBrain.states = chordHistory;
    for (let i = 0; i < chordHistory.length - 1; i++) {
        const current = chordHistory[i];
        const next = chordHistory[i+1];
        const key = `${current.notes}_${current.duration}`;
        if (!harmonyBrain.transitionMatrix[key]) harmonyBrain.transitionMatrix[key] = [];
        harmonyBrain.transitionMatrix[key].push(next);
    }

    const melodyNotes = rawNotes.filter(n => n.midi >= 60);
    let melodyHistory = [];

    for (let i = 0; i < melodyNotes.length; i++) {
        const current = melodyNotes[i];
        const durationTag = getDurationTag(current.duration);
        
        const stateVector = {
            pitch: current.name,
            duration: durationTag,
            velocity: current.velocity,
            isPause: false
        };
        melodyHistory.push(stateVector);

        if (i < melodyNotes.length - 1) {
            const next = melodyNotes[i + 1];
            const gap = next.time - (current.time + current.duration);
            if (gap > 0.15) {
                melodyHistory.push({
                    pitch: "REST",
                    duration: getDurationTag(gap),
                    velocity: 0,
                    isPause: true
                });
            }
        }
    }

    melodyBrain.states = melodyHistory;
    for (let i = 0; i < melodyHistory.length - 1; i++) {
        const current = melodyHistory[i];
        const next = melodyHistory[i+1];
        const key = `${current.pitch}_${current.duration}`;
        if (!melodyBrain.transitionMatrix[key]) melodyBrain.transitionMatrix[key] = [];
        melodyBrain.transitionMatrix[key].push(next);
    }
}

// 2. Audio Engine Inits (Ambient Mallet Configuration)
function setupAudioEngine() {
    if (polyChordSynth) return;

    reverb = new Tone.Reverb({ decay: 6.5, wet: 0.5 }).toDestination();
    delay = new Tone.FeedbackDelay({ delayTime: "4n.", feedback: 0.35, wet: 0.25 }).connect(reverb);

    polyChordSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.01, decay: 0.6, sustain: 0.2, release: 1.2 } 
    }).connect(delay); 
    polyChordSynth.volume.value = -14; 

    expressiveMelodySynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.003, decay: 0.15, sustain: 0.1, release: 0.2 }
    }).connect(delay);
}

// Helper: Roulette wheel selector choosing a memory bank based on ternary weights
function selectBrainFromTernary(brainA, brainB, brainC) {
    const rand = Math.random();
    if (rand < weights.w1) return brainA;
    if (rand < weights.w1 + weights.w2) return brainB;
    return brainC;
}

// 3. Native Loop Schedulers (Using Tone.Loop for absolute tempo-slider immunity)
let harmonyLoopEvent = null;
let melodyLoopEvent = null;

function triggerHarmonyGeneration(time) {
    if (!isPlayingGenerative) return;

    const wanderFactor = parseFloat(chaosSlider.value);
    // UPGRADED: Reads dynamically from the 3-axis ternary distribution weights
    const activeBrain = selectBrainFromTernary(harmonyBrainA, harmonyBrainB, harmonyBrainC);

    if (!currentChordState) {
        currentChordState = activeBrain.states[0] || { notes: "C3-E3-G3", duration: "2n" };
    }

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

    const nativeNotesArray = currentChordState.notes.split("-");
    chordText.innerText = nativeNotesArray.join(" + ") + ` (${duration})`;
    
    polyChordSynth.triggerAttackRelease(nativeNotesArray, duration, time, 0.4);
    harmonyLoopEvent.interval = duration;
}

function triggerMelodyGeneration(time) {
    if (!isPlayingGenerative) return;

    const wanderFactor = parseFloat(chaosSlider.value);
    // UPGRADED: Reads dynamically from the 3-axis ternary distribution weights
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
    }

    melodyLoopEvent.interval = duration;
}

// 4. UI Interface Control Mechanics Setup
playBtn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingGenerative) {
        playBtn.innerText = "Start Orchestrated Stream";
        isPlayingGenerative = false;
        
        if (harmonyLoopEvent) { harmonyLoopEvent.stop(); harmonyLoopEvent.dispose(); }
        if (melodyLoopEvent) { melodyLoopEvent.stop(); melodyLoopEvent.dispose(); }

        Tone.Transport.stop();
        Tone.Transport.position = 0;
        chordText.innerText = "None";
    } else {
        if (isPlayingOrig1) { midi1Btn.click(); }
        if (isPlayingOrig2) { midi2Btn.click(); }
        if (isPlayingOrig3) { midi3Btn.click(); } // Clear track 3

        isPlayingGenerative = true;
        playBtn.innerText = "Stop Orchestrated Stream";
        
        currentChordState = null;
        currentMelodyState = null;

        harmonyLoopEvent = new Tone.Loop((time) => {
            triggerHarmonyGeneration(time);
        }, "2n").start(0);

        melodyLoopEvent = new Tone.Loop((time) => {
            triggerMelodyGeneration(time);
        }, "8n").start(0);
        
        Tone.Transport.start();
    }
});

// Original Audio Playback Trigger Handlers
midi1Btn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingOrig1) {
        if (originalPart1) originalPart1.stop();
        expressiveMelodySynth.releaseAll();
        Tone.Transport.stop(); Tone.Transport.position = 0;
        midi1Btn.innerText = "Play Orig 1"; isPlayingOrig1 = false;
    } else {
        if (isPlayingGenerative) { playBtn.click(); }
        if (isPlayingOrig2) { midi2Btn.click(); }
        if (isPlayingOrig3) { midi3Btn.click(); }
        isPlayingOrig1 = true; midi1Btn.innerText = "Stop Orig 1";
        if (originalPart1) originalPart1.dispose();
        originalPart1 = new Tone.Part((time, event) => { expressiveMelodySynth.triggerAttackRelease(event.note, event.duration, time, event.velocity || 0.6); }, originalSequenceData1);
        originalPart1.loop = true;
        originalPart1.loopEnd = originalSequenceData1.reduce((max, n) => Math.max(max, n.time + n.duration), 4);
        originalPart1.add(originalPart1.loopEnd, () => { expressiveMelodySynth.releaseAll(); });
        Tone.Transport.position = 0; Tone.Transport.start(); originalPart1.start(0);
    }
});

midi2Btn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingOrig2) {
        if (originalPart2) originalPart2.stop();
        expressiveMelodySynth.releaseAll();
        Tone.Transport.stop(); Tone.Transport.position = 0;
        midi2Btn.innerText = "Play Orig 2"; isPlayingOrig2 = false;
    } else {
        if (isPlayingGenerative) { playBtn.click(); }
        if (isPlayingOrig1) { midi1Btn.click(); }
        if (isPlayingOrig3) { midi3Btn.click(); }
        isPlayingOrig2 = true; midi2Btn.innerText = "Stop Orig 2";
        if (originalPart2) originalPart2.dispose();
        originalPart2 = new Tone.Part((time, event) => { expressiveMelodySynth.triggerAttackRelease(event.note, event.duration, time, event.velocity || 0.6); }, originalSequenceData2);
        originalPart2.loop = true;
        originalPart2.loopEnd = originalSequenceData2.reduce((max, n) => Math.max(max, n.time + n.duration), 4);
        originalPart2.add(originalPart2.loopEnd, () => { expressiveMelodySynth.releaseAll(); });
        Tone.Transport.position = 0; Tone.Transport.start(); originalPart2.start(0);
    }
});

// ADDED: Track 3 Native Playback Event Triggers
midi3Btn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingOrig3) {
        if (originalPart3) originalPart3.stop();
        expressiveMelodySynth.releaseAll();
        Tone.Transport.stop(); Tone.Transport.position = 0;
        midi3Btn.innerText = "Play Orig 3"; isPlayingOrig3 = false;
    } else {
        if (isPlayingGenerative) { playBtn.click(); }
        if (isPlayingOrig1) { midi1Btn.click(); }
        if (isPlayingOrig2) { midi2Btn.click(); }
        isPlayingOrig3 = true; midi3Btn.innerText = "Stop Orig 3";
        if (originalPart3) originalPart3.dispose();
        originalPart3 = new Tone.Part((time, event) => { expressiveMelodySynth.triggerAttackRelease(event.note, event.duration, time, event.velocity || 0.6); }, originalSequenceData3);
        originalPart3.loop = true;
        originalPart3.loopEnd = originalSequenceData3.reduce((max, n) => Math.max(max, n.time + n.duration), 4);
        originalPart3.add(originalPart3.loopEnd, () => { expressiveMelodySynth.releaseAll(); });
        Tone.Transport.position = 0; Tone.Transport.start(); originalPart3.start(0);
    }
});

tempoSlider.addEventListener('input', (e) => {
    const targetBpm = parseFloat(e.target.value);
    tempoVal.innerText = targetBpm;
    Tone.Transport.bpm.value = targetBpm;
});
chaosSlider.addEventListener('input', (e) => { chaosVal.innerText = e.target.value; });


// =========================================================================
// 5. GEOMETRIC TERNARY TRIANGLE BLEND PAD CALCULATOR (NEW GRAPHICS ENGINE)
// =========================================================================
const canvas = document.getElementById('blend-triangle');
const ctx = canvas.getContext('2d');
const dot = document.getElementById('triangle-dot');
const debugText = document.getElementById('blend-display-debug');

// Formulate geometry locations for an equilateral triangle bounded inside a 300x260 canvas footprint
const p1 = { x: 150, y: 20 };   // Vertex Top: Song 1 
const p2 = { x: 20,  y: 240 };  // Vertex Bottom-Left: Song 2
const p3 = { x: 280, y: 240 };  // Vertex Bottom-Right: Song 3

function drawTriangle() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p3.x, p3.y); ctx.closePath();
    ctx.lineWidth = 3; ctx.strokeStyle = '#cccccc'; ctx.stroke();
    ctx.fillStyle = '#f9f9f9'; ctx.fill();
    
    // Label textual boundaries for absolute visibility
    ctx.fillStyle = '#333333'; ctx.font = 'bold 12px sans-serif';
    ctx.fillText('MIDI 1', p1.x - 20, p1.y - 5);
    ctx.fillText('MIDI 2', p2.x - 15, p2.y + 15);
    ctx.fillText('MIDI 3', p3.x - 15, p3.y + 15);
}

// Barycentric Coordinate Math: maps an arbitrary 2D click point to 3 weights relative to vertices
function updateTernaryWeights(mx, my) {
    const denominator = ((p2.y - p3.y) * (p1.x - p3.x) + (p3.x - p2.x) * (p1.y - p3.y));
    let w1 = ((p2.y - p3.y) * (mx - p3.x) + (p3.x - p2.x) * (my - p3.y)) / denominator;
    let w2 = ((p3.y - p1.y) * (mx - p3.x) + (p1.x - p3.x) * (my - p3.y)) / denominator;
    let w3 = 1 - w1 - w2;

    // FIXED: Clamp individual raw weights so they never go negative or above 1.0
    w1 = Math.max(0, Math.min(1, w1));
    w2 = Math.max(0, Math.min(1, w2));
    w3 = Math.max(0, Math.min(1, w3));

    // Re-normalize to guarantee that w1 + w2 + w3 always perfectly equals 1.0
    const sum = w1 + w2 + w3;
    if (sum > 0) {
        w1 /= sum;
        w2 /= sum;
        w3 /= sum;
    }

    // Assign the polished, safe weights to your generative engine variables
    weights.w1 = w1; 
    weights.w2 = w2; 
    weights.w3 = w3;

    // FIXED: Re-project the UI dot back onto the triangle's physical canvas pixels 
    // This allows the dot to glide smoothly along the edges without flying away or freezing!
    const clampedX = w1 * p1.x + w2 * p2.x + w3 * p3.x;
    const clampedY = w1 * p1.y + w2 * p2.y + w3 * p3.y;

    dot.style.left = `${clampedX}px`; 
    dot.style.top = `${clampedY}px`;
    
    debugText.innerText = `MIDI 1: ${Math.round(w1*100)}% | MIDI 2: ${Math.round(w2*100)}% | MIDI 3: ${Math.round(w3*100)}%`;
}

// Interaction handling via mouse/touch trackpad inputs
function handleTriangleInteraction(e) {
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX || e.touches[0].clientX) - rect.left;
    const my = (e.clientY || e.touches[0].clientY) - rect.top;
    updateTernaryWeights(mx, my);
}

canvas.addEventListener('mousedown', () => {
    const tracking = (e) => handleTriangleInteraction(e);
    window.addEventListener('mousemove', tracking);
    window.addEventListener('mouseup', () => window.removeEventListener('mousemove', tracking), { once: true });
});
canvas.addEventListener('touchstart', (e) => {
    const tracking = (ev) => handleTriangleInteraction(ev);
    window.addEventListener('touchmove', tracking);
    window.addEventListener('touchend', () => window.removeEventListener('touchmove', tracking), { once: true });
});

// Initialization: Draw layout outline canvas framework and center indicator to default state
drawTriangle();
updateTernaryWeights(150, 140); 


// 6. Main Boot Execution Pipeline call
async function bootArranger() {
    try {
        // RENAMED: Point targets explicitly to your newly refactored midi file architecture
        await analyzeMidiPerformance("midi_1.mid", harmonyBrainA, melodyBrainA, originalSequenceData1);
        statusText.innerText = "Track 1 Analyzed...";
        
        await analyzeMidiPerformance("midi_2.mid", harmonyBrainB, melodyBrainB, originalSequenceData2);
        statusText.innerText = "Track 2 Analyzed...";

        await analyzeMidiPerformance("midi_3.mid", harmonyBrainC, melodyBrainC, originalSequenceData3);
        statusText.innerText = "Orchestrator Online!";
        statusText.className = "ready";
    } catch(err) {
        console.error(err);
        statusText.innerText = "Analysis error. Check filenames.";
    }
}
bootArranger();