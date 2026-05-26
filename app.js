// Global App Playback States
let isPlayingGenerative = false;
let isPlayingOrig1 = false, isPlayingOrig2 = false, isPlayingOrig3 = false;
let originalPart1, originalPart2, originalPart3;
let originalSequenceData1 = [], originalSequenceData2 = [], originalSequenceData3 = [];

// Multi-Engine Markov Brains Arrays
let harmonyBrainA = { states: [], transitionMatrix: {} }, harmonyBrainB = { states: [], transitionMatrix: {} }, harmonyBrainC = { states: [], transitionMatrix: {} };
let melodyBrainA = { states: [], transitionMatrix: {} }, melodyBrainB = { states: [], transitionMatrix: {} }, melodyBrainC = { states: [], transitionMatrix: {} };

let currentChordState = null, currentMelodyState = null;      
let polyChordSynth, expressiveMelodySynth, delay, reverb, timbreFilter;

// Live Interpolated Song Target Weights
let weights = { w1: 0.333, w2: 0.333, w3: 0.333 };

// AUTOMATION STATE: True = Locked, False = Unlocked
let isSystemLocked = true;

// Active Target Tracking Pointer ID
let activeTargetPlanetId = 1;

// DOM Selectors
const statusText = document.getElementById('status-text');
const playBtn = document.getElementById('main-art-toggle');
const lockBtn = document.getElementById('lock-toggle-btn');
const midi1Btn = document.getElementById('midi1-btn'), midi2Btn = document.getElementById('midi2-btn'), midi3Btn = document.getElementById('midi3-btn'); 
const tempoSlider = document.getElementById('tempo-slider'), tempoVal = document.getElementById('tempo-val');
const chaosSlider = document.getElementById('chaos-slider');
const hudVectorDisplay = document.getElementById('live-vector-display');
const debugText = document.getElementById('blend-display-debug');

// Manual Weight Sliders DOM Selectors
const w1Slider = document.getElementById('w1-slider'), w1Val = document.getElementById('w1-val');
const w2Slider = document.getElementById('w2-slider'), w2Val = document.getElementById('w2-val');
const w3Slider = document.getElementById('w3-slider'), w3Val = document.getElementById('w3-val');

// Hardware chassis dynamic ambient bases
const pitchColorMap = {
    'C': { r: 14, g: 15, b: 17 }, 'D': { r: 20, g: 18, b: 24 }, 'E': { r: 24, g: 16, b: 16 },
    'F': { r: 14, g: 22, b: 18 }, 'G': { r: 24, g: 22, b: 16 }, 'A': { r: 18, g: 14, b: 24 }, 'B': { r: 14, g: 20, b: 24 }
};
let currentTargetColor = { r: 14, g: 15, b: 17 }, currentBackgroundColor = { r: 14, g: 15, b: 17 };

const getDurationTag = (dur) => {
    if (dur <= 0.18) return "16n"; if (dur <= 0.38) return "8n"; if (dur <= 0.75) return "4n"; if (dur <= 1.4) return "2n"; return "1m"; 
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

    const melodyNotes = rawNotes.filter(n => n.midi >= 60);
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

// 2. Audio Setup Configurations — RESTORED PURE SINE TIMBRE WITH ANTI-DISTORTION LIMITER
function setupAudioEngine() {
    if (polyChordSynth) return;

    // Create a safety brickwall limiter to catch compounding audio peaks before they distort
    const masterLimiter = new Tone.Limiter(0).toDestination();

    // Reverb & structural feedback delay routed safely into the limiter
    reverb = new Tone.Reverb({ decay: 7.5, wet: 0.55 }).connect(masterLimiter);
    delay = new Tone.FeedbackDelay({ delayTime: "4n.", feedback: 0.35, wet: 0.25 }).connect(reverb);
    timbreFilter = new Tone.Filter({ type: "lowpass", frequency: 1200, Q: 1 }).connect(delay);

    // CHORD ENGINE: Restored original pure music box sine tone and envelopes
    polyChordSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" }, 
        envelope: { attack: 0.02, decay: 0.8, sustain: 0.3, release: 1.5 } 
    }).connect(timbreFilter); 
    polyChordSynth.volume.value = -20; // Lowered slightly from -16 to give the delay tail breathing room

    // MELODY ENGINE: Restored original pure music box sine tone and envelopes
    expressiveMelodySynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" }, 
        envelope: { attack: 0.005, decay: 0.2, sustain: 0.1, release: 0.3 }
    }).connect(timbreFilter);
    expressiveMelodySynth.volume.value = -14; // Lowered slightly from -10 to prevent accumulation overload
}

function selectBrainFromTernary(brainA, brainB, brainC) {
    const rand = Math.random();
    if (rand < weights.w1) { activeTargetPlanetId = 1; return brainA; }
    if (rand < weights.w1 + weights.w2) { activeTargetPlanetId = 2; return brainB; }
    activeTargetPlanetId = 3; return brainC;
}

// 3. Generative Audio Schedulers
let harmonyLoopEvent = null, melodyLoopEvent = null;

function triggerHarmonyGeneration(time) {
    if (!isPlayingGenerative) return;
    const wanderFactor = parseFloat(chaosSlider.value);
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
    hudVectorDisplay.innerText = `${currentChordState.notes} [${duration}]`;
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
        const char = currentMelodyState.pitch.charAt(0);
        if (pitchColorMap[char]) currentTargetColor = pitchColorMap[char];
    }
    melodyLoopEvent.interval = duration;
}

function clearAllPlaybacks() {
    if (isPlayingGenerative) {
        isPlayingGenerative = false;
        playBtn.innerText = "Start Sound";
        playBtn.classList.remove('active-stream');
        if (harmonyLoopEvent) { harmonyLoopEvent.stop(); harmonyLoopEvent.dispose(); harmonyLoopEvent = null; }
        if (melodyLoopEvent) { melodyLoopEvent.stop(); melodyLoopEvent.dispose(); melodyLoopEvent = null; }
    }
    
    if (originalPart1) { originalPart1.stop(); originalPart1.dispose(); originalPart1 = null; }
    isPlayingOrig1 = false;
    midi1Btn.classList.remove('active');

    if (originalPart2) { originalPart2.stop(); originalPart2.dispose(); originalPart2 = null; }
    isPlayingOrig2 = false;
    midi2Btn.classList.remove('active');

    if (originalPart3) { originalPart3.stop(); originalPart3.dispose(); originalPart3 = null; }
    isPlayingOrig3 = false;
    midi3Btn.classList.remove('active');

    Tone.Transport.stop();
    Tone.Transport.position = 0;
    hudVectorDisplay.innerText = "Engine Standby";
}

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

// 4. Master Controls Handlers
playBtn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingGenerative) {
        clearAllPlaybacks();
        currentTargetColor = { r: 14, g: 15, b: 17 };
    } else {
        clearAllPlaybacks(); 
        isPlayingGenerative = true; playBtn.innerText = "Stop Sound"; playBtn.classList.add('active-stream');
        currentChordState = null; currentMelodyState = null;
        harmonyLoopEvent = new Tone.Loop((time) => { triggerHarmonyGeneration(time); }, "2n").start(0);
        melodyLoopEvent = new Tone.Loop((time) => { triggerMelodyGeneration(time); }, "8n").start(0);
        Tone.Transport.start();
    }
});

midi1Btn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingOrig1) {
        clearAllPlaybacks();
    } else {
        clearAllPlaybacks();
        isPlayingOrig1 = true;
        midi1Btn.classList.add('active');
        activeTargetPlanetId = 1; 
        originalPart1 = buildTonePartFromContainer(originalSequenceData1);
        originalPart1.start(0);
        Tone.Transport.start();
        hudVectorDisplay.innerText = "Auditioning MIDI Track 1";
    }
});

midi2Btn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingOrig2) {
        clearAllPlaybacks();
    } else {
        clearAllPlaybacks();
        isPlayingOrig2 = true;
        midi2Btn.classList.add('active');
        activeTargetPlanetId = 2;
        originalPart2 = buildTonePartFromContainer(originalSequenceData2);
        originalPart2.start(0);
        Tone.Transport.start();
        hudVectorDisplay.innerText = "Auditioning MIDI Track 2";
    }
});

midi3Btn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingOrig3) {
        clearAllPlaybacks();
    } else {
        clearAllPlaybacks();
        isPlayingOrig3 = true;
        midi3Btn.classList.add('active');
        activeTargetPlanetId = 3;
        originalPart3 = buildTonePartFromContainer(originalSequenceData3);
        originalPart3.start(0);
        Tone.Transport.start();
        hudVectorDisplay.innerText = "Auditioning MIDI Track 3";
    }
});

lockBtn.addEventListener('click', () => {
    isSystemLocked = !isSystemLocked;
    if (isSystemLocked) {
        lockBtn.innerText = "🔒 System Automation: LOCKED";
        lockBtn.classList.remove('unlocked');
        tempoSlider.disabled = true; w1Slider.disabled = true; w2Slider.disabled = true; w3Slider.disabled = true;
    } else {
        lockBtn.innerText = "🔓 Manual Override: UNLOCKED";
        lockBtn.classList.add('unlocked');
        tempoSlider.disabled = false; w1Slider.disabled = false; w2Slider.disabled = false; w3Slider.disabled = false;
    }
});

tempoSlider.addEventListener('input', (e) => {
    if (!isSystemLocked) { tempoVal.innerText = e.target.value; Tone.Transport.bpm.value = parseFloat(e.target.value); }
});

function handleManualWeightMixUpdate() {
    if (isSystemLocked) return;
    let v1 = parseFloat(w1Slider.value), v2 = parseFloat(w2Slider.value), v3 = parseFloat(w3Slider.value);
    let sum = v1 + v2 + v3;
    if (sum === 0) { v1 = 1; v2 = 1; v3 = 1; sum = 3; }
    weights.w1 = v1 / sum; weights.w2 = v2 / sum; weights.w3 = v3 / sum;
    w1Val.innerText = `${Math.round(weights.w1*100)}%`; w2Val.innerText = `${Math.round(weights.w2*100)}%`; w3Val.innerText = `${Math.round(weights.w3*100)}%`;
    if (debugText) debugText.innerText = `MIDI 1: ${Math.round(weights.w1*100)}% | MIDI 2: ${Math.round(weights.w2*100)}% | MIDI 3: ${Math.round(weights.w3*100)}%`;
}
w1Slider.addEventListener('input', handleManualWeightMixUpdate);
w2Slider.addEventListener('input', handleManualWeightMixUpdate);
w3Slider.addEventListener('input', handleManualWeightMixUpdate);


// =========================================================================
// 5. TEENAGE ENGINEERING HORIZONTAL CYLINDER RENDERING MODULES
// =========================================================================
const canvas = document.getElementById('art-surface');
const ctx = canvas.getContext('2d');

let moon = { x: window.innerWidth / 2, y: window.innerHeight / 2, vx: 2, vy: -1.5, radius: 3, attractionRadius: 400 };

let planets = [
    { id: 1, x: 0, y: 0, rad: 16, length: 50, rotation: 0, color: "#ff3b30", active: true },
    { id: 2, x: 0, y: 0, rad: 16, length: 50, rotation: 0, color: "#ffcc00", active: true },
    { id: 3, x: 0, y: 0, rad: 16, length: 50, rotation: 0, color: "#007aff", active: true }
];
let draggedPlanet = null;

function initCelestialLayout() {
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    planets[0].x = canvas.width / 2; planets[0].y = canvas.height * 0.30;
    planets[1].x = canvas.width * 0.28; planets[1].y = canvas.height * 0.65;
    planets[2].x = canvas.width * 0.72; planets[2].y = canvas.height * 0.65;
}

function processAutomatedBarycentricInfluence() {
    if (!isSystemLocked) return;
    const centerX = canvas.width / 2; const centerY = canvas.height / 2;
    const d1 = Math.sqrt((planets[0].x - centerX)**2 + (planets[0].y - centerY)**2);
    const d2 = Math.sqrt((planets[1].x - centerX)**2 + (planets[1].y - centerY)**2);
    const d3 = Math.sqrt((planets[2].x - centerX)**2 + (planets[2].y - centerY)**2);

    const maxRadius = 600;
    let s1 = Math.max(0.01, maxRadius - d1), s2 = Math.max(0.01, maxRadius - d2), s3 = Math.max(0.01, maxRadius - d3);
    const total = s1 + s2 + s3;
    weights.w1 = s1 / total; weights.w2 = s2 / total; weights.w3 = s3 / total;

    w1Slider.value = Math.round(weights.w1 * 100); w1Val.innerText = w1Slider.value + "%";
    w2Slider.value = Math.round(weights.w2 * 100); w2Val.innerText = w2Slider.value + "%";
    w3Slider.value = Math.round(weights.w3 * 100); w3Val.innerText = w3Slider.value + "%";
    if (debugText) debugText.innerText = `MIDI 1: ${w1Slider.value}% | MIDI 2: ${w2Slider.value}% | MIDI 3: ${w3Slider.value}%`;
}

function isoProject(x, y, z) {
    return {
        x: (x - y) * Math.cos(Math.PI / 6),
        y: (x + y) * Math.sin(Math.PI / 6) - z
    };
}

function advanceCelestialPhysics() {
    currentBackgroundColor.r += (currentTargetColor.r - currentBackgroundColor.r) * 0.04;
    currentBackgroundColor.g += (currentTargetColor.g - currentBackgroundColor.g) * 0.04;
    currentBackgroundColor.b += (currentTargetColor.b - currentBackgroundColor.b) * 0.04;
    
    ctx.fillStyle = `rgba(${Math.round(currentBackgroundColor.r)}, ${Math.round(currentBackgroundColor.g)}, ${Math.round(currentBackgroundColor.b)}, 0.42)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2; const centerY = canvas.height / 2;
    let activePlanetsCount = 0; let distSum = 0;
    let targetP = planets.find(p => p.id === activeTargetPlanetId) || planets[0];

    planets.forEach(p => {
        const dx = p.x - centerX; const dy = p.y - centerY;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d < moon.attractionRadius) { p.active = true; activePlanetsCount++; distSum += d; } else { p.active = false; }

        const fDist = Math.sqrt((p.x - moon.x)**2 + (p.y - moon.y)**2);
        const lInt = Math.max(0, 1 - (fDist / 220));

        const isAuditioningThisTrack = (p.id === 1 && isPlayingOrig1) || (p.id === 2 && isPlayingOrig2) || (p.id === 3 && isPlayingOrig3);
        
        if ((lInt > 0 || isAuditioningThisTrack) && (isPlayingGenerative || isAuditioningThisTrack)) {
            const motionMultiplier = isAuditioningThisTrack ? 1.0 : lInt;
            p.rotation += (Tone.Transport.bpm.value / 60) * 0.035 * motionMultiplier;
        }

        ctx.save(); ctx.translate(p.x, p.y);
        
        if (lInt > 0 || isAuditioningThisTrack) {
            const glowScalar = isAuditioningThisTrack ? 1.0 : lInt;
            let grad = ctx.createRadialGradient(0, 0, p.length * 0.2, 0, 0, p.length * 2.2);
            grad.addColorStop(0, `rgba(255,255,255,${glowScalar * 0.08})`);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.beginPath(); ctx.arc(0, 0, p.length * 2.2, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
        }

        const b1 = isoProject(-30, -20, 0), b2 = isoProject(30, -20, 0), b3 = isoProject(30, 20, 0), b4 = isoProject(-30, 20, 0);
        ctx.beginPath(); ctx.moveTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y); ctx.lineTo(b3.x, b3.y); ctx.lineTo(b4.x, b4.y);
        ctx.fillStyle = '#1c1e22'; ctx.fill();
        ctx.strokeStyle = p.active ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)'; ctx.stroke();

        const segments = 12;
        for (let i = 0; i < segments / 2; i++) {
            let a1 = (i / segments) * Math.PI * 2 - Math.PI/2, a2 = ((i + 1) / segments) * Math.PI * 2 - Math.PI/2;
            let pL1 = isoProject(-25, Math.cos(a1)*p.rad, Math.sin(a1)*p.rad + p.rad);
            let pL2 = isoProject(-25, Math.cos(a2)*p.rad, Math.sin(a2)*p.rad + p.rad);
            let pR1 = isoProject(25, Math.cos(a1)*p.rad, Math.sin(a1)*p.rad + p.rad);
            let pR2 = isoProject(25, Math.cos(a2)*p.rad, Math.sin(a2)*p.rad + p.rad);
            ctx.beginPath(); ctx.moveTo(pL1.x, pL1.y); ctx.lineTo(pL2.x, pL2.y); ctx.lineTo(pR2.x, pR2.y); ctx.lineTo(pR1.x, pR1.y);
            let color = Math.floor(35 + Math.sin(a1) * 15); ctx.fillStyle = `rgb(${color},${color},${color+5})`; ctx.fill();

            if ((lInt > 0.1 || isAuditioningThisTrack) && i % 2 === 0) {
                ctx.fillStyle = p.color;
                let px = -25 + 8 + ((i * 5 + p.rotation * 12) % 34);
                let pin = isoProject(px, Math.cos(a1)*p.rad, Math.sin(a1)*p.rad + p.rad);
                ctx.beginPath(); ctx.arc(pin.x, pin.y, 1, 0, Math.PI*2); ctx.fill();
            }
        }

        let end = isoProject(25, 0, p.rad);
        ctx.save(); ctx.translate(end.x, end.y);
        ctx.strokeStyle = '#5d646f'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(6, 2); ctx.stroke();
        ctx.translate(6, 2);
        let armX = Math.cos(p.rotation) * 10, armY = Math.sin(p.rotation) * 5;
        ctx.strokeStyle = '#9ca5b4'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(armX, armY); ctx.stroke();
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.ellipse(armX, armY, 2, 1, 0, 0, Math.PI*2); ctx.fill();
        ctx.restore();
        ctx.restore();
    });

    if (isSystemLocked) {
        const pull = 0.54, friction = 0.94;
        const tDx = targetP.x - moon.x, tDy = targetP.y - moon.y;
        const tD = Math.sqrt(tDx*tDx + tDy*tDy);
        if (tD > 10) { moon.vx += (tDx/tD) * pull; moon.vy += (tDy/tD) * pull; }
        const cDx = centerX - moon.x, cDy = centerY - moon.y, cD = Math.sqrt(cDx*cDx + cDy*cDy);
        if (cD > 10) { moon.vx += (cDx/cD) * 0.12; moon.vy += (cDy/cD) * 0.12; }
        moon.vx += (Math.random()-0.5)*0.5; moon.vx *= friction; moon.vy *= friction;
        moon.x += moon.vx; moon.y += moon.vy;
    }

    if (activePlanetsCount > 0 && isSystemLocked) {
        let bpm = Math.max(20, Math.min(180, Math.round(180 - ((distSum/activePlanetsCount)/moon.attractionRadius)*160)));
        tempoSlider.value = bpm; tempoVal.innerText = bpm;
        if (isPlayingGenerative) Tone.Transport.bpm.value = bpm;
    }

    let glow = ctx.createRadialGradient(moon.x, moon.y, 0, moon.x, moon.y, 44);
    glow.addColorStop(0, '#ffffff'); glow.addColorStop(0.15, 'rgba(238,255,204,0.9)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(moon.x, moon.y, 44, 0, Math.PI*2); ctx.fillStyle = glow; ctx.fill();
    ctx.beginPath(); ctx.arc(moon.x, moon.y, moon.radius, 0, Math.PI*2); ctx.fillStyle = '#ffffff'; ctx.fill();

    processAutomatedBarycentricInfluence();
    requestAnimationFrame(advanceCelestialPhysics);
}

canvas.addEventListener('mousedown', (e) => {
    const clicked = planets.find(p => Math.sqrt((p.x - e.clientX)**2 + (p.y - e.clientY)**2) < 36);
    if (clicked) draggedPlanet = clicked;
    else if (!isSystemLocked) { moon.x = e.clientX; moon.y = e.clientY; moon.vx = 0; moon.vy = 0; }
});
window.addEventListener('mousemove', (e) => {
    if (draggedPlanet) { draggedPlanet.x = e.clientX; draggedPlanet.y = e.clientY; }
    else if (!isSystemLocked && e.buttons === 1) { moon.x = e.clientX; moon.y = e.clientY; }
});
window.addEventListener('mouseup', () => draggedPlanet = null);
window.addEventListener('resize', initCelestialLayout);

initCelestialLayout();
requestAnimationFrame(advanceCelestialPhysics);

async function boot() {
    try {
        await analyzeMidiPerformance("midi_1.mid", harmonyBrainA, melodyBrainA, originalSequenceData1);
        await analyzeMidiPerformance("midi_2.mid", harmonyBrainB, melodyBrainB, originalSequenceData2);
        await analyzeMidiPerformance("midi_3.mid", harmonyBrainC, melodyBrainC, originalSequenceData3);
        statusText.innerText = "Engine is Ready"; statusText.style.color = "#34c759";
    } catch(e) { 
        statusText.innerText = "ERROR"; statusText.style.color = "#ff3b30";
    }
}
boot();