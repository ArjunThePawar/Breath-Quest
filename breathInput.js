// breathInput.js
// This file's ONLY job is detecting the raw timing of breath cycles.
//not realted to anything about stability, power, alarms, or winning -
// it just watches for "one breath happened" moments and reports how much
// time passed since the previous one.
// Two interchangeable sources are provided below. Both emit the exact
// same kind of event ("breathcycle"), so the rest of the game can use
// either one without caring which is active.

import { CONFIG } from "./config.js";

// ── Base class ──
// Both input methods (keyboard and microphone) share this common logic:
// tracking the timestamp of the last detected breath, and calculating
// how long the gap was since the one before it.
export class BreathInputSource extends EventTarget {
  constructor() {
    super(); // required when extending EventTarget
    this._lastPeakTimestamp = null; // timestamp of the previous detected breath
  }

  // Call this method whenever a breath is detected, with the current time.
  _registerBreathPeak(timestamp = performance.now()) {
    // If we've already seen a previous breath, we can calculate the
    // duration of the cycle between that one and this one.
    if (this._lastPeakTimestamp !== null) {
      const cycleDurationMs = timestamp - this._lastPeakTimestamp;

      // Fire a custom event so anything listening (like GameEngine)
      // finds out a breath cycle just completed.
      this.dispatchEvent(
        new CustomEvent("breathcycle", {
          detail: { cycleDurationMs, timestamp },
        })
      );
    }

    // Remember this timestamp so the NEXT breath can measure against it.
    this._lastPeakTimestamp = timestamp;
  }
}

//  Keyboard input (for testing without a microphone) 
// Holding SPACE down counts as one breath moment. This lets developers
// simulate slow (calm) or fast (panicked) breathing just by tapping
// the spacebar at different speeds.
export class KeyboardBreathInput extends BreathInputSource {
  constructor(targetElement = window) {
    super();
    this._targetElement = targetElement;         // where we listen for key events
    this._onKeyDown = this._onKeyDown.bind(this); // bind so "this" works inside the handler
    this._isKeyDown = false;                      // prevents key-repeat from counting multiple times
  }

  // Begin listening for spacebar presses.
  start() {
    this._targetElement.addEventListener("keydown", this._onKeyDown);
  }

  // Stop listening (cleanup).
  stop() {
    this._targetElement.removeEventListener("keydown", this._onKeyDown);
  }

  // Runs every time a key is pressed down.
  _onKeyDown(e) {
    // Ignore all keys except spacebar, and ignore repeat events while held.
    if (e.code !== "Space" || this._isKeyDown) return;

    this._isKeyDown = true;
    this._registerBreathPeak(); // count this press as one breath moment

    // Set up a one-time listener to detect when the key is released,
    // so we know when it's safe to count the NEXT press.
    const onUp = (upEvent) => {
      if (upEvent.code === "Space") {
        this._isKeyDown = false;
        this._targetElement.removeEventListener("keyup", onUp);
      }
    };
    this._targetElement.addEventListener("keyup", onUp);
  }
}

// Microphone input (real breathing detection)
// Uses the Web Audio API to listen to the microphone and detect
// "breath peaks" - moments where the sound is noticeably louder than
// the surrounding ambient noise (an inhale/exhale sound).
export class MicBreathInput extends BreathInputSource {
  constructor() {
    super();
    this._audioContext = null;         // the Web Audio context (created on start)
    this._analyser = null;             // node that gives us live audio data
    this._dataArray = null;            // buffer that holds the raw waveform data
    this._rafId = null;                // requestAnimationFrame handle, so we can cancel the loop later
    this._lastRegisteredTime = 0;      // timestamp of the last counted breath (for debouncing)

    // We track a "noise floor" - the ambient background loudness - so the
    // detector adapts to different rooms/microphones instead of using
    // one fixed number that might be wrong for a loud or quiet space.
    this._noiseFloor = 0;
  }

  // Requests microphone access and starts analyzing audio.
  async start() {
    // Ask the browser for permission to use the microphone.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Create the audio processing graph.
    this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = this._audioContext.createMediaStreamSource(stream);

    // The analyser node lets us read live volume/frequency data.
    this._analyser = this._audioContext.createAnalyser();
    this._analyser.fftSize = CONFIG.MIC_FFT_SIZE;
    this._dataArray = new Uint8Array(this._analyser.frequencyBinCount);

    // Connect the microphone source into the analyser.
    source.connect(this._analyser);

    // Begin the continuous analysis loop.
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

  // Runs continuously, once per animation frame, checking for breath peaks.
  _loop() {
    const amplitude = this._getNormalizedAmplitude();
    const now = performance.now();

    // Slowly adjust our estimate of the "ambient" noise level, so quiet
    // rooms and loud rooms both work without manual reconfiguration.
    this._noiseFloor = this._noiseFloor * 0.98 + amplitude * 0.02;

    // A "peak" is real breathing if it's noticeably louder than ambient
    // noise, and if enough time has passed since the last counted peak
    // (this prevents one breath from being counted multiple times).
    const dynamicThreshold = this._noiseFloor + CONFIG.MIC_PEAK_THRESHOLD;

    if (
      amplitude > dynamicThreshold &&
      now - this._lastRegisteredTime > CONFIG.MIC_MIN_PEAK_GAP_MS
    ) {
      this._lastRegisteredTime = now;
      this._registerBreathPeak(now);
    }

    // Schedule the next check on the next animation frame.
    this._rafId = requestAnimationFrame(() => this._loop());
  }
}