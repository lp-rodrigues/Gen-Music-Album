// Global App Playback States
let isPlayingGenerative = false;
let isPlayingOrig1 = false;
let isPlayingOrig2 = false;

let originalPart1 = null;
let originalPart2 = null;
let originalSequenceData1 = [];
let originalSequenceData2 = [];

// Advanced Multi-Engine Multi-Dimensional Markov Brains
let harmonyBrainA = { states: [], transitionMatrix: {} };
let harmonyBrainB = { states: [], transitionMatrix: {} };

let melodyBrainA = { states: [], transitionMatrix: {} };
let melodyBrainB = { states: [], transitionMatrix: {} };

// Live State Pointers
let currentChordState = null; 
let currentMelodyState = null;      

// Audio Synths Pipelines
let polyChordSynth, expressiveMelodySynth, delay, reverb;

// DOM Selectors
const statusText = document.getElementById('status-text');
const chordText = document.getElementById('chord-text');
const playBtn = document.getElementById('play-btn');
const midi1Btn = document.getElementById('midi1-btn');
const midi2Btn = document.getElementById('midi2-btn');
const tempoSlider = document.getElementById('tempo-slider');
const tempoVal = document.getElementById('tempo-val');
const chaosSlider = document.getElementById('chaos-slider');
const chaosVal = document.getElementById('chaos-val');
const blendSlider = document.getElementById('blend-slider');

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
    
    // Cache for raw original loop button triggers
    rawNotes.forEach(n => sequenceContainer.push({ time: n.time, note: n.name, duration: n.duration, velocity: n.velocity }));

    // Group concurrent notes into clean time-blocks to isolate chords
    const timeBlocks = {};
    rawNotes.forEach(note => {
        const roundedTime = Math.round(note.time * 8) / 8; 
        if (!timeBlocks[roundedTime]) timeBlocks[roundedTime] = [];
        timeBlocks[roundedTime].push(note);
    });

    // --- PHASE A: PROFILE HARMONY LAYER (Notes < MIDI 60) ---
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

    // --- PHASE B: PROFILE EXPRESSIVE MELODY LAYER (Notes >= MIDI 60) ---
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

    // Rich ambient environment space configuration
    reverb = new Tone.Reverb({ decay: 6.5, wet: 0.5 }).toDestination();
    delay = new Tone.FeedbackDelay({ delayTime: "4n.", feedback: 0.35, wet: 0.25 }).connect(reverb);

    // Dynamic background mallet configuration (tuned for original octave register)
    polyChordSynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { 
            attack: 0.01,   // Responsive response for natural middle octave ranges
            decay: 0.6,    // Natural fading body
            sustain: 0.2,  // Soft background cushion
            release: 1.2   // Smooth bleed out into reverb tail
        } 
    }).connect(delay); 
    polyChordSynth.volume.value = -14; 

    // Sharp, crisp lead mallet configuration
    expressiveMelodySynth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sine" },
        envelope: { attack: 0.003, decay: 0.15, sustain: 0.1, release: 0.2 }
    }).connect(delay);
}

// 3. Dual-Engine Adaptive Orchestration Loop
let currentMelodyDuration = "8n";
let currentHarmonyDuration = "2n";

function runHarmonyTick(time) {
    if (!isPlayingGenerative) return;
    
    const blendFactor = parseFloat(blendSlider.value);
    const wanderFactor = parseFloat(chaosSlider.value);
    const activeBrain = (Math.random() > blendFactor) ? harmonyBrainA : harmonyBrainB;

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
    
    // RESTORED: Read original duration directly from track parameters
    currentHarmonyDuration = currentChordState.duration;

    // RESTORED: Splitting the native chord array out directly without modification
    const nativeNotesArray = currentChordState.notes.split("-");

    // Update display markup text
    chordText.innerText = nativeNotesArray.join(" + ") + ` (${currentHarmonyDuration})`;
    
    // Play native mallet block chords stretching over native duration spaces
    polyChordSynth.triggerAttackRelease(nativeNotesArray, currentHarmonyDuration, time, 0.4);

    // Self-schedules at natural pace intervals
    Tone.Transport.scheduleOnce((nextTime) => {
        runHarmonyTick(nextTime);
    }, `+${currentHarmonyDuration}`);
}

function runMelodyTick(time) {
    if (!isPlayingGenerative) return;

    const blendFactor = parseFloat(blendSlider.value);
    const wanderFactor = parseFloat(chaosSlider.value);
    const activeBrain = (Math.random() > blendFactor) ? melodyBrainA : melodyBrainB;

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
    currentMelodyDuration = currentMelodyState.duration;

    if (currentMelodyState.isPause || currentMelodyState.pitch === "REST") {
        Tone.Transport.scheduleOnce((nextTime) => {
            runMelodyTick(nextTime);
        }, `+${currentMelodyDuration}`);
        return;
    }

    expressiveMelodySynth.triggerAttackRelease(currentMelodyState.pitch, currentMelodyDuration, time, currentMelodyState.velocity);

    Tone.Transport.scheduleOnce((nextTime) => {
        runMelodyTick(nextTime);
    }, `+${currentMelodyDuration}`);
}

// 4. UI Interface Control Mechanics Setup
playBtn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingGenerative) {
        playBtn.innerText = "Start Orchestrated Stream";
        isPlayingGenerative = false;
        if (!isPlayingOrig1 && !isPlayingOrig2) Tone.Transport.stop();
        chordText.innerText = "None";
    } else {
        isPlayingGenerative = true;
        playBtn.innerText = "Stop Orchestrated Stream";
        
        currentChordState = null;
        currentMelodyState = null;
        
        Tone.Transport.start();
        
        runHarmonyTick(Tone.Transport.seconds);
        runMelodyTick(Tone.Transport.seconds);
    }
});

midi1Btn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingOrig1) {
        if (originalPart1) originalPart1.stop();
        expressiveMelodySynth.releaseAll(); // Safety release flush on stop
        midi1Btn.innerText = "Play Orig 1";
        isPlayingOrig1 = false;
    } else {
        isPlayingOrig1 = true;
        midi1Btn.innerText = "Stop Orig 1";
        if (originalPart1) originalPart1.dispose();
        
        originalPart1 = new Tone.Part((time, event) => {
            expressiveMelodySynth.triggerAttackRelease(event.note, event.duration, time, event.velocity || 0.6);
        }, originalSequenceData1);
        
        originalPart1.loop = true;
        originalPart1.loopEnd = originalSequenceData1.reduce((max, n) => Math.max(max, n.time + n.duration), 4);
        
        // FIXED: Boundary condition event clears stuck note triggers on wrap-around
        originalPart1.add(originalPart1.loopEnd, () => {
            expressiveMelodySynth.releaseAll();
        });

        Tone.Transport.start(); originalPart1.start(0);
    }
});

midi2Btn.addEventListener('click', async () => {
    await Tone.start(); setupAudioEngine();
    if (isPlayingOrig2) {
        if (originalPart2) originalPart2.stop();
        expressiveMelodySynth.releaseAll(); // Safety release flush on stop
        midi2Btn.innerText = "Play Orig 2";
        isPlayingOrig2 = false;
    } else {
        isPlayingOrig2 = true;
        midi2Btn.innerText = "Stop Orig 2";
        if (originalPart2) originalPart2.dispose();
        
        originalPart2 = new Tone.Part((time, event) => {
            expressiveMelodySynth.triggerAttackRelease(event.note, event.duration, time, event.velocity || 0.6);
        }, originalSequenceData2);
        
        originalPart2.loop = true;
        originalPart2.loopEnd = originalSequenceData2.reduce((max, n) => Math.max(max, n.time + n.duration), 4);
        
        // FIXED: Boundary condition event clears stuck note triggers on wrap-around
        originalPart2.add(originalPart2.loopEnd, () => {
            expressiveMelodySynth.releaseAll();
        });

        Tone.Transport.start(); originalPart2.start(0);
    }
});

tempoSlider.addEventListener('input', (e) => {
    const targetBpm = parseFloat(e.target.value);
    tempoVal.innerText = targetBpm;
    Tone.Transport.bpm.value = targetBpm;
});
chaosSlider.addEventListener('input', (e) => { chaosVal.innerText = e.target.value; });

// Main Boot Execution Pipeline call
async function bootArranger() {
    try {
        await analyzeMidiPerformance("melody_1.mid", harmonyBrainA, melodyBrainA, originalSequenceData1);
        statusText.innerText = "Track 1 Analyzed...";
        
        await analyzeMidiPerformance("melody_2.mid", harmonyBrainB, melodyBrainB, originalSequenceData2);
        statusText.innerText = "Orchestrator Online!";
        statusText.className = "ready";
    } catch(err) {
        console.error(err);
        statusText.innerText = "Analysis error. Check filenames.";
    }
}
bootArranger();