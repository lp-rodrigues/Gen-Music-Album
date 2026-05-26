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
const playBtn = document.getElementById('main-art-toggle'); // Remapped to sleek glassmorphic button
const midi1Btn = document.getElementById('midi1-btn');
const midi2Btn = document.getElementById('midi2-btn');
const midi3Btn = document.getElementById('midi3-btn'); 
const tempoSlider = document.getElementById('tempo-slider');
const tempoVal = document.getElementById('tempo-val');
const chaosSlider = document.getElementById('chaos-slider');
const chaosVal = document.getElementById('chaos-val');
const hudVectorDisplay = document.getElementById('live-vector-display');

// Color Palette Maps for Musical Pitches (Maps note bases to elegant dark ambient glow states)
const pitchColorMap = {
    'C': { r: 28,  g: 45,  b: 66  }, // Midnight Slate Blue
    'D': { r: 42,  g: 26,  b: 48  }, // Deep Velvet Amethyst
    'E': { r: 61,  g: 27,  b: 34  }, // Muted Crimson Amber
    'F': { r: 21,  g: 54,  b: 44  }, // Dark Emerald Pine
    'G': { r: 58,  g: 51,  b: 26  }, // Smoked Ochre Topaz
    'A': { r: 44,  g: 30,  b: 58  }, // Royal Indigo Shadow
    'B': { r: 26,  g: 51,  b: 58  }  // Deep Ocean Teal
};

// Global Tracking Color Variables for Interpolation Smoothness
let currentTargetColor = { r: 11, g: 11, b: 15 };
let currentBackgroundColor = { r: 11, g: 11, b: 15 };

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

            chordHistory.push({ notes: chordString, duration: getDurationTag(duration) });
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
        
        const stateVector = { pitch: current.name, duration: durationTag, velocity: current.velocity, isPause: false };
        melodyHistory.push(stateVector);

        if (i < melodyNotes.length - 1) {
            const next = melodyNotes[i + 1];
            const gap = next.time - (current.time + current.duration);
            if (gap > 0.15) {
                melodyHistory.push({ pitch: "REST", duration: getDurationTag(gap), velocity: 0, isPause: true });
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

    reverb = new Tone.Reverb({ decay: 7.5, wet: 0.65 }).toDestination(); // Increased decay for cinematic space
    delay = new Tone.FeedbackDelay({ delayTime: "4n.", feedback: 0.4, wet: 0.3 }).connect(reverb);

    polyChordSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.02, decay: 0.8, sustain: 0.3, release: 1.5 } 
    }).connect(delay); 
    polyChordSynth.volume.value = -16; 

    expressiveMelodySynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.005, decay: 0.2, sustain: 0.1, release: 0.3 }
    }).connect(delay);
    expressiveMelodySynth.volume.value = -10;
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
    
    // HUD Vector Metric display updater
    hudVectorDisplay.innerText = `VECTOR STATE: ${nativeNotesArray.join(" + ")} [${duration}]`;
    
    polyChordSynth.triggerAttackRelease(nativeNotesArray, duration, time, 0.4);
    harmonyLoopEvent.interval = duration;
}

function triggerMelodyGeneration(time) {
    if (!isPlayingGenerative) return;

    const wanderFactor = parseFloat(chaosSlider.value);
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
        
        // INTERACTIVE ART ENGINE COUPLING: Map the note base letter directly to our ambient color shift coordinates
        const rootNoteLetter = currentMelodyState.pitch.charAt(0);
        if (pitchColorMap[rootNoteLetter]) {
            currentTargetColor = pitchColorMap[rootNoteLetter];
        }
    }

    melodyLoopEvent.interval = duration;
}

// 4. UI Interface Control Mechanics Setup
playBtn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingGenerative) {
        playBtn.innerText = "Initialize Space";
        playBtn.classList.remove('active-stream');
        isPlayingGenerative = false;
        hudVectorDisplay.innerText = "Engine Standby // Suspended";
        
        if (harmonyLoopEvent) { harmonyLoopEvent.stop(); harmonyLoopEvent.dispose(); }
        if (melodyLoopEvent) { melodyLoopEvent.stop(); melodyLoopEvent.dispose(); }

        Tone.Transport.stop();
        Tone.Transport.position = 0;
        currentTargetColor = { r: 11, g: 11, b: 15 };
    } else {
        if (isPlayingOrig1) midi1Btn.click();
        if (isPlayingOrig2) midi2Btn.click();
        if (isPlayingOrig3) midi3Btn.click();

        isPlayingGenerative = true;
        playBtn.innerText = "Collapse Space";
        playBtn.classList.add('active-stream');
        
        currentChordState = null;
        currentMelodyState = null;

        harmonyLoopEvent = new Tone.Loop((time) => { triggerHarmonyGeneration(time); }, "2n").start(0);
        melodyLoopEvent = new Tone.Loop((time) => { triggerMelodyGeneration(time); }, "8n").start(0);
        
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
        midi1Btn.classList.remove('active'); isPlayingOrig1 = false;
    } else {
        if (isPlayingGenerative) playBtn.click();
        if (isPlayingOrig2) midi2Btn.click();
        if (isPlayingOrig3) midi3Btn.click();
        isPlayingOrig1 = true; midi1Btn.classList.add('active');
        if (originalPart1) originalPart1.dispose();
        originalPart1 = new Tone.Part((time, event) => { expressiveMelodySynth.triggerAttackRelease(event.note, event.duration, time, event.velocity || 0.6); }, originalSequenceData1);
        originalPart1.loop = true; originalPart1.loopEnd = originalSequenceData1.reduce((max, n) => Math.max(max, n.time + n.duration), 4);
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
        midi2Btn.classList.remove('active'); isPlayingOrig2 = false;
    } else {
        if (isPlayingGenerative) playBtn.click();
        if (isPlayingOrig1) midi1Btn.click();
        if (isPlayingOrig3) midi3Btn.click();
        isPlayingOrig2 = true; midi2Btn.classList.add('active');
        if (originalPart2) originalPart2.dispose();
        originalPart2 = new Tone.Part((time, event) => { expressiveMelodySynth.triggerAttackRelease(event.note, event.duration, time, event.velocity || 0.6); }, originalSequenceData2);
        originalPart2.loop = true; originalPart2.loopEnd = originalSequenceData2.reduce((max, n) => Math.max(max, n.time + n.duration), 4);
        originalPart2.add(originalPart2.loopEnd, () => { expressiveMelodySynth.releaseAll(); });
        Tone.Transport.position = 0; Tone.Transport.start(); originalPart2.start(0);
    }
});

midi3Btn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingOrig3) {
        if (originalPart3) originalPart3.stop();
        expressiveMelodySynth.releaseAll();
        Tone.Transport.stop(); Tone.Transport.position = 0;
        midi3Btn.classList.remove('active'); isPlayingOrig3 = false;
    } else {
        if (isPlayingGenerative) playBtn.click();
        if (isPlayingOrig1) midi1Btn.click();
        if (isPlayingOrig2) midi2Btn.click();
        isPlayingOrig3 = true; midi3Btn.classList.add('active');
        if (originalPart3) originalPart3.dispose();
        originalPart3 = new Tone.Part((time, event) => { expressiveMelodySynth.triggerAttackRelease(event.note, event.duration, time, event.velocity || 0.6); }, originalSequenceData3);
        originalPart3.loop = true; originalPart3.loopEnd = originalSequenceData3.reduce((max, n) => Math.max(max, n.time + n.duration), 4);
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
// 5. SCREEN-SPACE FULL VIEWPORT ARTISTIC TERNARY MAPPER & GRADIENT CANVAS
// =========================================================================
const canvas = document.getElementById('art-surface');
const ctx = canvas.getContext('2d');
const pointerDot = document.getElementById('glow-pointer');
const debugText = document.getElementById('blend-display-debug');

// Dynamic equilateral triangle spatial corner positions anchored to current viewport limits
let p1 = { x: 0, y: 0 };
let p2 = { x: 0, y: 0 };
let p3 = { x: 0, y: 0 };

function resizeViewportCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    // Position the invisible ternary points across the limits of the browser window dimensions
    p1 = { x: canvas.width / 2, y: 60 };
    p2 = { x: 60,                y: canvas.height - 60 };
    p3 = { x: canvas.width - 60, y: canvas.height - 60 };
}

// Calculate weights via Barycentric parameters and lock UI dot smoothly along constraints
function updateTernaryWeights(mx, my) {
    const denominator = ((p2.y - p3.y) * (p1.x - p3.x) + (p3.x - p2.x) * (p1.y - p3.y));
    let w1 = ((p2.y - p3.y) * (mx - p3.x) + (p3.x - p2.x) * (my - p3.y)) / denominator;
    let w2 = ((p3.y - p1.y) * (mx - p3.x) + (p1.x - p3.x) * (my - p3.y)) / denominator;
    let w3 = 1 - w1 - w2;

    w1 = Math.max(0, Math.min(1, w1));
    w2 = Math.max(0, Math.min(1, w2));
    w3 = Math.max(0, Math.min(1, w3));

    const sum = w1 + w2 + w3;
    if (sum > 0) { w1 /= sum; w2 /= sum; w3 /= sum; }

    weights.w1 = w1; weights.w2 = w2; weights.w3 = w3;

    // Track pointer dot location seamlessly across the calculated spatial surface area
    const clampedX = w1 * p1.x + w2 * p2.x + w3 * p3.x;
    const clampedY = w1 * p1.y + w2 * p2.y + w3 * p3.y;

    pointerDot.style.left = `${clampedX}px`; 
    pointerDot.style.top = `${clampedY}px`;
    
    debugText.innerText = `W1: ${Math.round(w1*100)}% | W2: ${Math.round(w2*100)}% | W3: ${Math.round(w3*100)}%`;
}

// 6. REAL-TIME FLUID VISUAL RENDERING LOOP (Mathematical Frame Animation Thread)
function renderFluidVisuals() {
    // Smooth linear interpolation animation frame steps (Asymptotic color drift approach)
    currentBackgroundColor.r += (currentTargetColor.r - currentBackgroundColor.r) * 0.04;
    currentBackgroundColor.g += (currentTargetColor.g - currentBackgroundColor.g) * 0.04;
    currentBackgroundColor.b += (currentTargetColor.b - currentBackgroundColor.b) * 0.04;

    const baseHex = `rgb(${Math.round(currentBackgroundColor.r)}, ${Math.round(currentBackgroundColor.g)}, ${Math.round(currentBackgroundColor.b)})`;
    
    // Clear the layer and inject a rich visual backdrop gradient based on the ternary ratios
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Subtle ambient color-bleeding localized spot lights for the corners of the hidden matrix boundaries
    const drawAmbientGlowPoint = (x, y, colorStr, weightValue) => {
        if (weightValue <= 0.01) return;
        let glowGrad = ctx.createRadialGradient(x, y, 10, x, y, canvas.width * 0.45);
        glowGrad.addColorStop(0, colorStr + Math.min(weightValue * 0.25, 0.3) + ")");
        glowGrad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glowGrad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    // Layer 1 (Top / Song A): Shimmering Quartz Cyan Glow
    drawAmbientGlowPoint(p1.x, p1.y, "rgba(0, 210, 255, ", weights.w1);
    // Layer 2 (Bottom-Left / Song B): Electric Orchid Violet Glow
    drawAmbientGlowPoint(p2.x, p2.y, "rgba(161, 32, 255, ", weights.w2);
    // Layer 3 (Bottom-Right / Song C): Sunrise Amber Glow
    drawAmbientGlowPoint(p3.x, p3.y, "rgba(255, 134, 32, ", weights.w3);

    // Continue loop cycle cleanly synchronized with browser frame intervals
    requestAnimationFrame(renderFluidVisuals);
}

// Interactive Surface Click and Drag Event Tracking Handlers
function handleInteraction(e) {
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    if (clientX !== undefined && clientY !== undefined) {
        updateTernaryWeights(clientX, clientY);
    }
}

canvas.addEventListener('mousedown', (e) => {
    handleInteraction(e);
    const track = (ev) => handleInteraction(ev);
    window.addEventListener('mousemove', track);
    window.addEventListener('mouseup', () => window.removeEventListener('mousemove', track), { once: true });
});

canvas.addEventListener('touchstart', (e) => {
    handleInteraction(e);
    const track = (ev) => handleInteraction(ev);
    window.addEventListener('touchmove', track, { passive: true });
    window.addEventListener('touchend', () => window.removeEventListener('touchmove', track), { once: true });
});

window.addEventListener('resize', () => {
    resizeViewportCanvas();
    updateTernaryWeights(window.innerWidth / 2, window.innerHeight / 2);
});

// Primary Inits initialization configurations
resizeViewportCanvas();
updateTernaryWeights(window.innerWidth / 2, window.innerHeight / 2);
requestAnimationFrame(renderFluidVisuals); // Fire visual engine framework pipeline thread loop


// 7. Main Boot Execution Pipeline call
async function bootArranger() {
    try {
        await analyzeMidiPerformance("midi_1.mid", harmonyBrainA, melodyBrainA, originalSequenceData1);
        statusText.innerText = "System Matrix 1 Compiled...";
        
        await analyzeMidiPerformance("midi_2.mid", harmonyBrainB, melodyBrainB, originalSequenceData2);
        statusText.innerText = "System Matrix 2 Compiled...";

        await analyzeMidiPerformance("midi_3.mid", harmonyBrainC, melodyBrainC, originalSequenceData3);
        statusText.innerText = "All Engines Online // Ready.";
        statusText.style.color = "#34c759";
    } catch(err) {
        console.error(err);
        statusText.innerText = "System initialization error. Review MIDI paths.";
        statusText.style.color = "#ff3b30";
    }
}
bootArranger();