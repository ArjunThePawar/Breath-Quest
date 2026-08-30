// breathInput.js
// This file detects breathing/input activity from two different
// sources, which classify breathing in two DIFFERENT ways:
//   - KeyboardBreathInput: rhythm-based. Each key tap is a full
//     simulated breath; the TIMING between taps ("breathcycle" events,
//     with a cycleDurationMs) is what breathAnalyzer.js turns into a
//     calm/moderate/panicked/erratic classification.
//   - MicBreathInput: volume-based. There's no notion of a "cycle" at
//     all - it continuously measures how much the mic's volume is
//     changing moment to moment, and reports a direct classification
//     ("breathclassification" events, with a state already decided) -
//     a big volume swing means panicked, a small one means calm.
// Both sources also emit "breathphase" any time there's genuine
// activity, regardless of classification - this is what the rest of
// the game (gameLoop.js) uses to know a source is actively in use, for
// idle-detection and for picking which source is "driving" the world.

import { CONFIG } from "./config.js";

// ── Base class ──
// Both input methods (keyboard and microphone) share this common logic:
// tracking the timestamp of the last detected breath, and calculating
// how long the gap was since the one before it.
export class BreathInputSource extends EventTarget {
  // phasesPerCycle = how many detected "phases" make up ONE full breath
  // cycle for this input method.
  //   - Keyboard: each key tap IS a full breath by design -> 1.
  //   - Microphone: a real breath produces TWO loud phases (the inhale
  //     sound, then the exhale sound) -> 2. Without this distinction,
  //     mic input was measuring inhale-to-exhale (roughly HALF a real
  //     breath) and calling that a "cycle", which made completely calm
  //     breathing look twice as fast as it really was and get
  //     classified as moderate/panicked instead of calm - draining
  //     stability even while breathing correctly.
  constructor(phasesPerCycle = 1) {
    super(); // required when extending EventTarget
    this._phasesPerCycle = Math.max(1, phasesPerCycle);
    this._phaseTimestamps = []; // rolling history of the most recent phase timestamps
  }

  // Call this method whenever a breath PHASE is detected, with the current time.
  _registerBreathPeak(timestamp = performance.now()) {
    // Always announce a single breath PHASE (one inhale or one exhale
    // sound) - this fires even for the very first one detected, before
    // there's enough history to measure a full cycle against.
    // GameEngine listens for this to confirm real breathing is actually
    // happening at all (used to decide whether to fall back from mic to
    // keyboard input), separately from "breathcycle" below which only
    // fires once there are enough phases to measure a full-breath
    // duration between.
    this.dispatchEvent(
      new CustomEvent("breathphase", { detail: { timestamp } })
    );

    // Keep a short rolling history of phase timestamps - just enough to
    // look back phasesPerCycle steps.
    this._phaseTimestamps.push(timestamp);
    if (this._phaseTimestamps.length > this._phasesPerCycle + 1) {
      this._phaseTimestamps.shift();
    }

    // Once we have enough history to span one full cycle (phasesPerCycle
    // phases back from now), fire a "breathcycle" event using that
    // FULL-BREATH duration, not just the gap since the immediately
    // previous phase.
    if (this._phaseTimestamps.length > this._phasesPerCycle) {
      const startTimestamp =
        this._phaseTimestamps[this._phaseTimestamps.length - 1 - this._phasesPerCycle];
      const cycleDurationMs = timestamp - startTimestamp;

      // Fire a custom event so anything listening (like GameEngine)
      // finds out a full breath cycle just completed.
      this.dispatchEvent(
        new CustomEvent("breathcycle", {
          detail: { cycleDurationMs, timestamp },
        })
      );
    }
  }
}

//  Keyboard input (for testing without a microphone) 
// Each press of the B key counts as one breath moment (a single tap,
// not a hold) - like tapping out an inhale or an exhale. The RHYTHM of
// taps is what matters, exactly like real mouth-breathing into the mic:
// press it roughly once every ~4-5 seconds for calm/normal breathing,
// and faster, more frequent taps for panicked breathing.
export class KeyboardBreathInput extends BreathInputSource {
  constructor(targetElement = window) {
    super(1); // one key tap = one full simulated breath
    this.name = "keyboard";           // lets GameEngine report which input is driving the game
    this._targetElement = targetElement;         // where we listen for key events
    this._onKeyDown = this._onKeyDown.bind(this); // bind so "this" works inside the handler
    this._isKeyDown = false;                      // prevents key-repeat from counting multiple times
    this.usesMic = false;                         // general-purpose flag identifying this source type
  }

  // Begin listening for B-key presses.
  start() {
    this._targetElement.addEventListener("keydown", this._onKeyDown);
  }

  // Stop listening (cleanup).
  stop() {
    this._targetElement.removeEventListener("keydown", this._onKeyDown);
  }

  // Runs every time a key is pressed down.
  _onKeyDown(e) {
    // Ignore all keys except B, and ignore repeat events while held.
    if (e.code !== "KeyB" || this._isKeyDown) return;

    this._isKeyDown = true;
    this._registerBreathPeak(); // count this press as one breath moment

    // Set up a one-time listener to detect when the key is released,
    // so we know when it's safe to count the NEXT press.
    const onUp = (upEvent) => {
      if (upEvent.code === "KeyB") {
        this._isKeyDown = false;
        this._targetElement.removeEventListener("keyup", onUp);
      }
    };
    this._targetElement.addEventListener("keyup", onUp);
  }
}

// Microphone input (real breathing detection)
// Uses the Web Audio API to listen to the microphone and classify
// breathing DIRECTLY from how much the volume changes moment to moment,
// relative to the loudest volume this mic has picked up so far:
//   - a volume swing that's a large fraction (3/4 by default) of the
//     loudest sound heard so far this session -> panicked
//   - anything smaller -> calm
// No cycle timing, no sustained-peak detection, no filtering.
export class MicBreathInput extends BreathInputSource {
  constructor() {
    super();
    this.name = "mic";                 // lets GameEngine report which input is driving the game
    this._audioContext = null;         // the Web Audio context (created on start)
    this._analyser = null;             // node that gives us live audio data
    this._dataArray = null;            // buffer that holds the raw waveform data
    this._rafId = null;                // requestAnimationFrame handle, so we can cancel the loop later
    this.usesMic = true;               // general-purpose flag identifying this source type

    // Two running averages of the same volume signal, at different
    // speeds - comparing them is how we measure a MEANINGFUL change in
    // volume (see _loop() for why a single-frame comparison doesn't work).
    this._fastAmplitude = 0;
    this._slowAmplitude = 0;

    // The loudest volume this mic has picked up so far THIS SESSION -
    // our live stand-in for "the max volume input possible". There's no
    // fixed hardware ceiling real breathing/voice ever actually reaches,
    // so a hardcoded absolute number would either be unreachable (too
    // strict) or trivially exceeded (too loose) depending on the room
    // and mic gain. Tracking the actual observed peak makes the panic
    // threshold self-calibrating to whoever is playing. Starts at a
    // small nonzero floor so early frames (before any real peak has
    // been seen yet) aren't compared against ~0.
    this._maxAmplitude = CONFIG.MIC_MAX_AMPLITUDE_FLOOR;
  }

  // Requests microphone access and starts analyzing audio.
  async start() {
    // Ask the browser for microphone access - plain and unfiltered, since
    // classification here works directly off the raw volume signal.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = this._audioContext.createMediaStreamSource(stream);

    this._analyser = this._audioContext.createAnalyser();
    this._analyser.fftSize = CONFIG.MIC_FFT_SIZE;
    this._dataArray = new Uint8Array(this._analyser.frequencyBinCount);

    source.connect(this._analyser);

    this._loop();
  }

  // Stops the microphone and analysis loop (cleanup).
  stop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._audioContext) this._audioContext.close();
  }

  // Reads the current audio buffer and calculates its loudness (RMS),
  // normalized to a 0–1 range.
  _getNormalizedAmplitude() {
    this._analyser.getByteTimeDomainData(this._dataArray);

    let sumSquares = 0;
    for (let i = 0; i < this._dataArray.length; i++) {
      // Raw byte values are 0-255 with 128 as "silence" - convert to -1..1 range.
      const centered = (this._dataArray[i] - 128) / 128;
      sumSquares += centered * centered;
    }

    // Root-mean-square gives us a single "how loud is it right now" number.
    return Math.sqrt(sumSquares / this._dataArray.length);
  }

  // Runs continuously, once per animation frame. Tracks TWO running
  // averages of the volume, at different speeds:
  //   - fast average: reacts almost immediately to a real volume change
  //   - slow average: drifts along with the recent overall level,
  //     barely reacting to any single moment
  // The gap between them is the "change in volume". That gets compared
  // against a threshold that is ITSELF a fraction (3/4 by default) of
  // the loudest volume this mic has picked up so far this session -
  // i.e. "panicked" means a volume swing that's a large portion of as
  // loud as this mic/room has gotten, not an arbitrary fixed number.
  //   - change >= 3/4 of session peak -> "panicked"
  //   - change <  3/4 of session peak -> "calm"
  _loop() {
    const rawAmplitude = this._getNormalizedAmplitude();
    const now = performance.now();

    this._fastAmplitude = this._fastAmplitude * 0.6 + rawAmplitude * 0.4;
    this._slowAmplitude = this._slowAmplitude * 0.95 + rawAmplitude * 0.05;

    // Keep track of the loudest moment seen so far this session - this
    // never decreases, so once a genuinely loud breath happens, it
    // permanently calibrates what "loud" means for the rest of the run.
    if (this._fastAmplitude > this._maxAmplitude) {
      this._maxAmplitude = this._fastAmplitude;
    }

    const volumeChange = Math.abs(this._fastAmplitude - this._slowAmplitude);
    const panicThreshold = this._maxAmplitude * CONFIG.MIC_PANIC_VOLUME_FRACTION;

    // Only bother classifying (and counting this as real activity) once
    // there's actually meaningful sound at all - otherwise constant tiny
    // fluctuations in silence/ambient hiss would still register as
    // "calm breathing" nonstop, which would be indistinguishable from
    // genuine silence and defeat the idle-detection in gameLoop.js.
    if (this._fastAmplitude > CONFIG.MIC_SOUND_FLOOR) {
      // Announce that real activity is happening right now (keeps
      // idle-timeout and active-input switching in gameLoop.js honest).
      this.dispatchEvent(new CustomEvent("breathphase", { detail: { timestamp: now } }));

      const state = volumeChange >= panicThreshold ? "panicked" : "calm";

      this.dispatchEvent(
        new CustomEvent("breathclassification", {
          detail: { state, volumeChange, panicThreshold, amplitude: this._fastAmplitude, timestamp: now },
        })
      );
    }

    // Schedule the next check on the next animation frame.
    this._rafId = requestAnimationFrame(() => this._loop());
  }
}