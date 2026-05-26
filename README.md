# Generative Music Album

An advanced, interactive browser-based generative music application that utilizes multi-dimensional Markov Chains to synthesize infinite, non-repeating ambient soundscapes. The engine dynamically parses, extracts, and interpolates structures from multiple source MIDI compositions, allowing real-time geometric orchestration via a custom 2D Ternary Blend Trackpad.

---

## Core Features

* **Algorithmic Composition Pipeline:** Parses standard binary MIDI files on launch and isolates performance characteristics into discrete Harmony and Melody Markov matrices.
* **2D Ternary Blend Matrix:** A custom-engineered canvas UI trackpad that maps mouse or touch positioning inside an equilateral triangle to real-time probability weights using Barycentric Coordinates.
* **Fault-Tolerant Audio Clocking:** Powered by native `Tone.Loop` clocking vehicles, ensuring perfect structural and temporal stability even under extreme tempo shifts.
* **Stochastic Entropy Injection:** Integrates an adjustable Entropy Coefficient slider to introduce controlled mutations, freeing the generative engine from historical limits.
* **Ambient Mallet Synthesizers:** Employs physical-modeling-style subtractive synthesis chains complete with serial feedback delays and a lush 6.5-second convolution reverb network.

---

## System Architecture

The application is structured as a direct four-stage serialization pipeline:

[ 1. EXTRACTION ENGINE ]  --->  [ 2. MARKOV BRAIN ]
      (MIDI Parse & Split)             (Probability Matrix)
                                               |
                                               v
 [ 4. UI / CONTROLLERS  ]  <---  [ 3. NATIVE AUDIO ENGINE ]
    (Sliders & Loops)               (Synths, Delay, Reverb)

### 1. Dual-Feature Extraction
Upon initialization, `analyzeMidiPerformance()` ingests three local source files (`midi_1.mid`, `midi_2.mid`, and `midi_3.mid`).
* **The Splitter Threshold:** Notes falling below MIDI Value 60 (Middle C) are cataloged into the **Harmony Layer**. Notes at or above MIDI 60 are mapped to the **Melody Layer**.
* **Time Block Quantization:** Overlapping note groups are quantized to the nearest 1/8th beat to assemble structural block chords.

### 2. Multi-Dimensional Markov Brains
The states inside the Markov chains are modeled as unified **Active Target State Event Vectors**. Instead of processing independent parameters, the engine bundles pitch clusters and native time tags together (e.g., `["C3-E3-G3", "2n"]`). This ensures that structural harmonic changes remain perfectly locked to their intended durations.

### 3. Audio & Effects Pipelines
Audio flows from the generators through a serial master FX chain before routing to the main hardware destination:

[ polyChordSynth ] --------+
                            |---> [ FeedbackDelay ] ---> [ Reverb ] ---> [ Output ]
 [ expressiveMelodySynth ] -+

 * **polyChordSynth:** A gentle polyphonic mallet synth featuring a soft attack profile (`0.01s`) to establish a smooth harmonic bed.
* **expressiveMelodySynth:** A crisp, snappy monophonic lead voice optimized with an instantaneous attack (`0.003s`) to simulate physical mallets.

---

## Control Interface Parameters

### Geometric Ternary Blend Pad
The application converts your cursor position inside the tracking triangle into three distinct percentage weights ($W_1 + W_2 + W_3 = 100\%$) using **Barycentric Coordinates**:

$$\begin{aligned}
W_1 &= \frac{(Y_2 - Y_3)(X - X_3) + (X_3 - X_2)(Y - Y_3)}{(Y_2 - Y_3)(X_1 - X_3) + (X_3 - X_2)(Y_1 - Y_3)} \\
W_2 &= \frac{(Y_3 - Y_1)(X - X_3) + (X_1 - X_3)(Y - Y_3)}{(Y_2 - Y_3)(X_1 - X_3) + (X_3 - X_2)(Y_1 - Y_3)} \\
W_3 &= 1 - W_1 - W_2
\end{aligned}$$

Mathematical clamping limits are embedded within the calculator, ensuring that if a user drags their pointer outside the triangle, the coordinates seamlessly snap to and glide along the nearest boundary edge without locking up the loop sequences.

### Entropy Coefficient
An implementation of stochastic mutation gatekeeping. At low values (e.g., `0.05`), the engine operates with high predictability, following the analyzed composition habits of the source MIDI tracks. At maximum values (`1.00`), the Markov system experiences total thermodynamic breakdown, prompting the instruments to play completely uninhibited random sequences from their compiled histories.

### Wide-Range Tempo Slider
Allows fluid runtime alteration of the master clock speed down to an ambient crawl of **20 BPM** up to an energetic **200 BPM**.

---

## Installation & Deployment

1. Clone this repository to your local workspace:
   ```bash
   git clone [https://github.com/YOUR-USERNAME/Gen-Music-Album.git](https://github.com/lp-rodrigues/Gen-Music-Album.git)

2. Place your chosen source MIDI tracks into the root directory and ensure they are exactly named:

    midi_1.mid
    midi_2.mid
    midi_3.mid

3. Launch a local development server (due to browser CORS policies regarding external file loads):
    # Using Python
    python -m http.server 8000

    # Using Node.js
    npx live-server

4. Open your browser and navigate to http://localhost:8000.

---

## License
    This project is open-source and available under the MIT License.