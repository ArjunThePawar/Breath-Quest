// musicSystem.js
//
// A calm, fully original lofi loop — generated live with the Web Audio
// API, same technique alarmSystem.js already uses (oscillators + gain
// nodes), just composed for a mellow lofi feel instead of an alarm.
// No audio files, no copyrighted material.
//
// Layers, all procedurally generated:
//   - warm filtered chords (electric-piano-ish, slow attack)
//   - a soft root-note bassline under each chord
//   - a laid-back drum pattern (soft kick + swung noise hi-hat)
//   - a quiet, constant vinyl-crackle noise bed for texture
//   - "tape wobble" (detune LFO) on the chords for that lofi drift
//
// Public API is unchanged:
//   const music = initMusicSystem();
//   music.start(); music.stop(); music.toggle();
//   music.isPlaying(); music.setVolume(0-100); music.dispose();

const CHORDS = [
  [130.81, 196.0, 246.94, 329.63], // C3 G3 B3 E4  (Cmaj7)
  [110.0, 164.81, 220.0, 329.63],  // A2 E3 A3 E4  (Am9-ish, no 3rd for softness)
  [98.0, 146.83, 220.0, 293.66],   // G2 D3 A3 D4  (G6/9-ish)
  [87.31, 130.81, 196.0, 261.63],  // F2 C3 G3 C4  (Fmaj7)
];
const ROOTS = [65.41, 55.0, 49.0, 43.65]; // one octave below each chord's root, for the bassline

const CHORD_DURATION_S = 5;   // faster chord/tone changes than before (was 8)
const CROSSFADE_S = 1.4;      // quicker transition between chords to match (was 2.2)
const BASE_VOLUME = 0.16;     // overall lofi mix volume at slider = 100

export function initMusicSystem() {
  let ctx = null;
  let masterGain = null;
  let masterFilter = null;   // gentle overall lowpass, the core "lofi warmth" ingredient
  let wobbleLFO = null;      // oscillator driving pitch wobble (tape-style drift)
  let wobbleGain = null;
  let crackleSource = null;  // looping vinyl-crackle noise buffer
  let crackleGain = null;

  let playing = false;
  let chordIndex = 0;
  let timeouts = [];
  let activeChordVoices = []; // currently-sounding chord+bass voices, for crossfade/cleanup

  function ensureContext() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Master chain: everything -> masterFilter (lofi lowpass warmth) -> masterGain -> speakers
    masterGain = ctx.createGain();
    masterGain.gain.value = BASE_VOLUME;

    masterFilter = ctx.createBiquadFilter();
    masterFilter.type = "lowpass";
    masterFilter.frequency.value = 2200; // rolls off harsh highs, classic lofi mellowness
    masterFilter.Q.value = 0.2;

    masterFilter.connect(masterGain);
    masterGain.connect(ctx.destination);

    // Tape wobble: an LFO that we read from per-note to nudge detune,
    // simulating the pitch drift of a worn tape/turntable. Slightly
    // quicker now to match the faster overall pacing.
    wobbleLFO = ctx.createOscillator();
    wobbleLFO.frequency.value = 0.25; // was 0.15 — a bit quicker drift
    wobbleGain = ctx.createGain();
    wobbleGain.gain.value = 6; // +/- 6 cents of detune drift — subtle, not seasick
    wobbleLFO.connect(wobbleGain);
    wobbleLFO.start();

    // Vinyl crackle bed: filtered noise, looped quietly under everything
    crackleSource = ctx.createBufferSource();
    crackleSource.buffer = makeCrackleBuffer(ctx);
    crackleSource.loop = true;

    const crackleFilter = ctx.createBiquadFilter();
    crackleFilter.type = "bandpass";
    crackleFilter.frequency.value = 3500;
    crackleFilter.Q.value = 0.6;

    crackleGain = ctx.createGain();
    crackleGain.gain.value = 0.05; // just barely audible texture, not a foreground sound

    crackleSource.connect(crackleFilter);
    crackleFilter.connect(crackleGain);
    crackleGain.connect(masterFilter);
  }

  // Generates a short buffer of white noise shaped with random sparse
  // "pop" bursts, for a vinyl-crackle texture rather than plain hiss.
  function makeCrackleBuffer(audioCtx) {
    const duration = 3;
    const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * duration, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      let sample = (Math.random() * 2 - 1) * 0.015; // quiet base hiss
      if (Math.random() < 0.0006) sample += (Math.random() * 2 - 1) * 0.5; // occasional pop
      data[i] = sample;
    }
    return buffer;
  }

  // Short filtered noise burst used for the hi-hat hits.
  function playHiHat(time, velocity) {
    const bufferSize = Math.floor(ctx.sampleRate * 0.05);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize); // quick decay noise burst
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const hpFilter = ctx.createBiquadFilter();
    hpFilter.type = "highpass";
    hpFilter.frequency.value = 6000;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);

    src.connect(hpFilter);
    hpFilter.connect(gain);
    gain.connect(masterFilter);

    src.start(time);
    src.stop(time + 0.06);
  }

  // Soft low sine "thump" used for the kick.
  function playKick(time, velocity) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(110, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(velocity, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.22);

    osc.connect(gain);
    gain.connect(masterFilter);

    osc.start(time);
    osc.stop(time + 0.25);
  }

  // Schedules one bar's worth of a laid-back, slightly-swung lofi beat
  // (soft kick on 1 and the "and" of 3, gentle hi-hats on the off-beats)
  // across the duration of one chord. Automatically speeds up along
  // with CHORD_DURATION_S since barDuration is passed in directly.
  function scheduleDrumPattern(startTime, barDuration) {
    const eighth = barDuration / 8;
    const swing = eighth * 0.12; // pushes every other eighth-note late, for a laid-back feel

    // kick on beat 1 and the "and" of beat 3 (indices 0 and 5 of 8 eighths)
    playKick(startTime, 0.5);
    playKick(startTime + eighth * 5 + swing, 0.4);

    // soft hi-hats on every off-beat eighth
    for (let i = 1; i < 8; i += 2) {
      const swungOffset = i % 4 === 3 ? swing : 0;
      playHiHat(startTime + eighth * i + swungOffset, 0.12 + Math.random() * 0.05);
    }
  }

  // Plays one chord (pad voices) + a soft bass note under it, with slow
  // attack (electric-piano-ish) and tape-wobble detune applied per voice.
  function playChordAndBass(freqs, rootFreq, fadeInSeconds) {
    const now = ctx.currentTime;

    const bankGain = ctx.createGain();
    bankGain.gain.setValueAtTime(0, now);
    bankGain.gain.linearRampToValueAtTime(1, now + fadeInSeconds);
    bankGain.connect(masterFilter);

    const oscillators = freqs.map((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? "sine" : "triangle"; // soft, rounded tone — no harsh sawtooths
      osc.frequency.value = freq;

      // tape wobble: route the shared LFO into this voice's detune
      wobbleGain.connect(osc.detune);

      const voiceGain = ctx.createGain();
      voiceGain.gain.value = 1 / freqs.length;
      osc.connect(voiceGain);
      voiceGain.connect(bankGain);
      osc.start(now);
      return osc;
    });

    // soft sine bass note, an octave below the chord's root, gently
    // low-passed further so it sits underneath rather than competing
    const bassOsc = ctx.createOscillator();
    bassOsc.type = "sine";
    bassOsc.frequency.value = rootFreq;
    wobbleGain.connect(bassOsc.detune);

    const bassFilter = ctx.createBiquadFilter();
    bassFilter.type = "lowpass";
    bassFilter.frequency.value = 400;

    const bassGain = ctx.createGain();
    bassGain.gain.value = 0.6;

    bassOsc.connect(bassFilter);
    bassFilter.connect(bassGain);
    bassGain.connect(bankGain);
    bassOsc.start(now);

    return { oscillators: [...oscillators, bassOsc], bankGain };
  }

  function stopVoice(voice, fadeOutSeconds) {
    if (!voice) return;
    const now = ctx.currentTime;
    voice.bankGain.gain.cancelScheduledValues(now);
    voice.bankGain.gain.setValueAtTime(voice.bankGain.gain.value, now);
    voice.bankGain.gain.linearRampToValueAtTime(0, now + fadeOutSeconds);
    voice.oscillators.forEach((osc) => osc.stop(now + fadeOutSeconds + 0.1));
  }

  function scheduleNextChord(isFirst) {
    if (!playing) return;

    const freqs = CHORDS[chordIndex % CHORDS.length];
    const root = ROOTS[chordIndex % ROOTS.length];
    chordIndex++;

    const newVoice = playChordAndBass(freqs, root, isFirst ? 2 : CROSSFADE_S);
    const oldVoice = activeChordVoices.shift();
    if (oldVoice) stopVoice(oldVoice, CROSSFADE_S);
    activeChordVoices.push(newVoice);

    // lay the drum pattern under this chord's duration
    scheduleDrumPattern(ctx.currentTime + 0.05, CHORD_DURATION_S);

    timeouts.push(setTimeout(() => scheduleNextChord(false), CHORD_DURATION_S * 1000));
  }

  function start() {
    ensureContext();
    if (ctx.state === "suspended") ctx.resume();
    if (playing) return;
    playing = true;

    // vinyl crackle runs continuously in the background, independent of
    // the chord/drum loop's own timing
    try {
      crackleSource.start();
    } catch (err) {
      // already started once before (buffer sources can't restart) —
      // rebuild it fresh if start() is called after a full stop/dispose
      if (err.name === "InvalidStateError") {
        crackleSource = ctx.createBufferSource();
        crackleSource.buffer = makeCrackleBuffer(ctx);
        crackleSource.loop = true;
        crackleSource.connect(crackleGain);
        crackleSource.start();
      }
    }

    scheduleNextChord(true);
  }

  function stop() {
    playing = false;
    timeouts.forEach(clearTimeout);
    timeouts = [];
    activeChordVoices.forEach((v) => stopVoice(v, 1.2));
    activeChordVoices = [];
    if (crackleSource) {
      try {
        crackleSource.stop();
      } catch {
        // already stopped — fine, nothing to do
      }
    }
  }

  function toggle() {
    if (playing) stop();
    else start();
    return playing;
  }

  function setVolume(value0to100) {
    ensureContext();
    masterGain.gain.value = (value0to100 / 100) * BASE_VOLUME;
  }

  function isPlaying() {
    return playing;
  }

  function dispose() {
    stop();
    if (ctx) ctx.close();
  }

  return { start, stop, toggle, isPlaying, setVolume, dispose };
}