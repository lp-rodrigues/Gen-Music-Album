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

// AUTOMATION STATE: True = Locked (Automated Tracking), False = Unlocked (User Slider Control)
let isSystemLocked = true;

// Active Target Tracking Pointer ID (Tracks which song brain is driving the loop visually)
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

const pitchColorMap = {
    'C': { r: 25, g: 45, b: 70 }, 'D': { r: 50, g: 25, b: 70 }, 'E': { r: 75, g: 30, b: 40 },
    'F': { r: 20, g: 60, b: 45 }, 'G': { r: 65, g: 55, b: 25 }, 'A': { r: 50, g: 30, b: 70 }, 'B': { r: 25, g: 55, b: 70 }
};
let currentTargetColor = { r: 8, g: 8, b: 12 }, currentBackgroundColor = { r: 8, g: 8, b: 12 };

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

// 2. Audio Setup Configurations
function setupAudioEngine() {
    if (polyChordSynth) return;
    reverb = new Tone.Reverb({ decay: 7.5, wet: 0.55 }).toDestination();
    delay = new Tone.FeedbackDelay({ delayTime: "4n.", feedback: 0.35, wet: 0.25 }).connect(reverb);
    timbreFilter = new Tone.Filter({ type: "lowpass", frequency: 1200, Q: 1 }).connect(delay);

    polyChordSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" }, envelope: { attack: 0.02, decay: 0.8, sustain: 0.3, release: 1.5 } 
    }).connect(timbreFilter); 
    polyChordSynth.volume.value = -16; 

    expressiveMelodySynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" }, envelope: { attack: 0.005, decay: 0.2, sustain: 0.1, release: 0.3 }
    }).connect(timbreFilter);
    expressiveMelodySynth.volume.value = -10;
}

// Roulette Wheel Brain selector tracking the active driver source
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

// 4. Master Controls Handlers
playBtn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingGenerative) {
        playBtn.innerText = "Initialize Space"; playBtn.classList.remove('active-stream');
        isPlayingGenerative = false; hudVectorDisplay.innerText = "Engine Standby";
        if (harmonyLoopEvent) { harmonyLoopEvent.stop(); harmonyLoopEvent.dispose(); }
        if (melodyLoopEvent) { melodyLoopEvent.stop(); melodyLoopEvent.dispose(); }
        Tone.Transport.stop(); Tone.Transport.position = 0;
        currentTargetColor = { r: 8, g: 8, b: 12 };
    } else {
        if (isPlayingOrig1) midi1Btn.click(); if (isPlayingOrig2) midi2Btn.click(); if (isPlayingOrig3) midi3Btn.click();
        isPlayingGenerative = true; playBtn.innerText = "Collapse Space"; playBtn.classList.add('active-stream');
        currentChordState = null; currentMelodyState = null;
        harmonyLoopEvent = new Tone.Loop((time) => { triggerHarmonyGeneration(time); }, "2n").start(0);
        melodyLoopEvent = new Tone.Loop((time) => { triggerMelodyGeneration(time); }, "8n").start(0);
        Tone.Transport.start();
    }
});

// Toggling the Automation System Parameters Lock Button
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

// Manual Input Event Sync Bindings
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
    debugText.innerText = `MIDI 1: ${Math.round(weights.w1*100)}% | MIDI 2: ${Math.round(weights.w2*100)}% | MIDI 3: ${Math.round(weights.w3*100)}%`;
}
w1Slider.addEventListener('input', handleManualWeightMixUpdate);
w2Slider.addEventListener('input', handleManualWeightMixUpdate);
w3Slider.addEventListener('input', handleManualWeightMixUpdate);


// =========================================================================
// 5. SCREEN-CENTER SPATIAL MIXER & DECOUPLED ORBITER
// =========================================================================
const canvas = document.getElementById('art-surface');
const ctx = canvas.getContext('2d');

let moon = { x: window.innerWidth / 2, y: window.innerHeight / 2, vx: 3, vy: -2, radius: 10, attractionRadius: 400 };
let planets = [
    { id: 1, x: 0, y: 0, radius: 22, label: "MIDI 1", color: "#00d2ff", active: true },
    { id: 2, x: 0, y: 0, radius: 22, label: "MIDI 2", color: "#a120ff", active: true },
    { id: 3, x: 0, y: 0, radius: 22, label: "MIDI 3", color: "#ff8620", active: true }
];
let draggedPlanet = null;

function initCelestialLayout() {
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    planets[0].x = canvas.width / 2; planets[0].y = canvas.height * 0.28;
    planets[1].x = canvas.width * 0.28; planets[1].y = canvas.height * 0.68;
    planets[2].x = canvas.width * 0.72; planets[2].y = canvas.height * 0.68;
    moon.x = canvas.width / 2; moon.y = canvas.height / 2;
}

// SPATIAL RE-ENGINEERING: Mix weights scale based on proximity to the screen's listening sweet spot (center)
function processAutomatedBarycentricInfluence() {
    if (!isSystemLocked) return;

    // Fixed master listener coordinate (Perfect middle of screen)
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    // Calculate distance of each planet from the master listener sweet spot
    const d1 = Math.sqrt((planets[0].x - centerX)**2 + (planets[0].y - centerY)**2);
    const d2 = Math.sqrt((planets[1].x - centerX)**2 + (planets[1].y - centerY)**2);
    const d3 = Math.sqrt((planets[2].x - centerX)**2 + (planets[2].y - centerY)**2);

    // Invert distances: Closer to center means higher score. Max out reach at 600px range.
    const maxInfluenceRadius = 600;
    let score1 = Math.max(0.01, maxInfluenceRadius - d1);
    let score2 = Math.max(0.01, maxInfluenceRadius - d2);
    let score3 = Math.max(0.01, maxInfluenceRadius - d3);

    // Turn scores into relative percentages
    const totalScore = score1 + score2 + score3;
    let w1 = score1 / totalScore;
    let w2 = score2 / totalScore;
    let w3 = score3 / totalScore;

    weights.w1 = w1; weights.w2 = w2; weights.w3 = w3;

    // Dynamic slider updates
    w1Slider.value = Math.round(w1 * 100); w1Val.innerText = `${Math.round(w1*100)}%`;
    w2Slider.value = Math.round(w2 * 100); w2Val.innerText = `${Math.round(w2*100)}%`;
    w3Slider.value = Math.round(w3 * 100); w3Val.innerText = `${Math.round(w3*100)}%`;

    debugText.innerText = `MIDI 1: ${Math.round(w1*100)}% | MIDI 2: ${Math.round(w2*100)}% | MIDI 3: ${Math.round(w3*100)}%`;
}

// 6. MAIN PHYSICAL ANIMATION RENDERING LOOP FRAME
function advanceCelestialPhysics() {
    currentBackgroundColor.r += (currentTargetColor.r - currentBackgroundColor.r) * 0.04;
    currentBackgroundColor.g += (currentTargetColor.g - currentBackgroundColor.g) * 0.04;
    currentBackgroundColor.b += (currentTargetColor.b - currentBackgroundColor.b) * 0.04;
    ctx.fillStyle = `rgb(${Math.round(currentBackgroundColor.r)}, ${Math.round(currentBackgroundColor.g)}, ${Math.round(currentBackgroundColor.b)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let activePlanetsCount = 0;
    let accumulatedDistanceSum = 0;

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    let activeTargetPlanet = planets.find(p => p.id === activeTargetPlanetId) || planets[0];

    planets.forEach(p => {
        const dx = p.x - centerX; const dy = p.y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < moon.attractionRadius) { p.active = true; activePlanetsCount++; accumulatedDistanceSum += distance; } 
        else { p.active = false; }

        // Render Field Reach rings
        ctx.beginPath(); ctx.arc(p.x, p.y, moon.attractionRadius, 0, Math.PI * 2);
        ctx.strokeStyle = p.active ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.005)';
        ctx.lineWidth = 1; ctx.stroke();

        // Render Planet Sphere
        let pGrad = ctx.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.radius);
        pGrad.addColorStop(0, '#ffffff'); pGrad.addColorStop(1, p.color);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = pGrad; ctx.fill();

        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '9px monospace';
        ctx.fillText(p.label, p.x - 18, p.y + p.radius + 15);
    });

    // PURE ORBITING DANCE MOVEMENT (Decoupled entirely from mix calculations)
    if (isSystemLocked) {
        const spaceFriction = 0.96; 
        const gravitationalConstant = 0.65; 

        // Gravitational pull toward the planet currently firing a note event
        const tDx = activeTargetPlanet.x - moon.x;
        const tDy = activeTargetPlanet.y - moon.y;
        const tDist = Math.sqrt(tDx * tDx + tDy * tDy);

        if (tDist > 10) {
            moon.vx += (tDx / tDist) * gravitationalConstant;
            moon.vy += (tDy / tDist) * gravitationalConstant;
        }

        // Slight vortex pull toward center to keep the orbit framed nicely
        const cDx = centerX - moon.x; const cDy = centerY - moon.y;
        const cDist = Math.sqrt(cDx * cDx + cDy * cDy);
        if (cDist > 10) {
            moon.vx += (cDx / cDist) * 0.12;
            moon.vy += (cDy / cDist) * 0.12;
        }

        moon.vx *= spaceFriction; moon.vy *= spaceFriction;
        moon.x += moon.vx; moon.y += moon.vy;

        // Boundary containment
        if (moon.x < 0 || moon.x > canvas.width) moon.vx *= -1;
        if (moon.y < 0 || moon.y > canvas.height) moon.vy *= -1;
    }

    // AUTOMATION BOUNDS: Inverted Speed Engine Mapping (Based on system density)
    if (activePlanetsCount > 0 && isSystemLocked) {
        const averageDistance = accumulatedDistanceSum / activePlanetsCount;
        let scaledBpm = Math.round(180 - ((averageDistance / moon.attractionRadius) * 160));
        scaledBpm = Math.max(20, Math.min(180, scaledBpm));

        tempoSlider.value = scaledBpm;
        tempoVal.innerText = scaledBpm;
        if (isPlayingGenerative) Tone.Transport.bpm.value = scaledBpm;
    }

    // AUTOMATION: Spatial Filter Timbre Modulation based on visual position
    if (polyChordSynth) {
        const filterFreq = Math.max(200, Math.min(3500, (moon.x / canvas.width) * 3300 + 200));
        timbreFilter.frequency.setValueAtTime(filterFreq, Tone.now());
    }

    // Draw a subtle crosshair indicator at the master listening center sweet-spot
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(centerX - 8, centerY); ctx.lineTo(centerX + 8, centerY); ctx.moveTo(centerX, centerY - 8); ctx.lineTo(centerX, centerY + 8); ctx.stroke();

    // Render Selector Moon Node
    ctx.beginPath(); ctx.arc(moon.x, moon.y, moon.radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff'; ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 15; ctx.fill(); ctx.shadowBlur = 0;

    processAutomatedBarycentricInfluence();
    requestAnimationFrame(advanceCelestialPhysics);
}

// Drag and Drop Controllers
function findClickedPlanet(mx, my) {
    return planets.find(p => Math.sqrt((p.x - mx)**2 + (p.y - my)**2) < p.radius + 10);
}

canvas.addEventListener('mousedown', (e) => {
    const clicked = findClickedPlanet(e.clientX, e.clientY);
    if (clicked) draggedPlanet = clicked;
    else if (!isSystemLocked) { moon.x = e.clientX; moon.y = e.clientY; moon.vx = 0; moon.vy = 0; }
});

window.addEventListener('mousemove', (e) => {
    if (draggedPlanet) { draggedPlanet.x = e.clientX; draggedPlanet.y = e.clientY; }
    else if (!isSystemLocked && e.buttons === 1) { moon.x = e.clientX; moon.y = e.clientY; }
});

window.addEventListener('mouseup', () => { draggedPlanet = null; });
window.addEventListener('resize', initCelestialLayout);

initCelestialLayout();
requestAnimationFrame(advanceCelestialPhysics);

async function bootArranger() {
    try {
        await analyzeMidiPerformance("midi_1.mid", harmonyBrainA, melodyBrainA, originalSequenceData1);
        await analyzeMidiPerformance("midi_2.mid", harmonyBrainB, melodyBrainB, originalSequenceData2);
        await analyzeMidiPerformance("midi_3.mid", harmonyBrainC, melodyBrainC, originalSequenceData3);
        statusText.innerText = "All Celestial Systems Aligned."; statusText.style.color = "#34c759";
    } catch(err) {
        console.error(err); statusText.innerText = "Alignment Error."; statusText.style.color = "#ff3b30";
    }
}
bootArranger();