// musicSystem.js  (NEW FILE)
//
// A calm, fully original ambient pad loop, generated live with the Web
// Audio API — the same technique alarmSystem.js already uses
// (oscillators + gain nodes), just composed for calm instead of alarm.
// No audio files, no copyrighted material: four soft chords crossfade
// into each other slowly and indefinitely.

const CHORDS = [
  [130.81, 196.0, 329.63, 493.88], // C3 G3 E4 B4  (Cmaj7)
  [146.83, 220.0, 349.23, 523.25], // D3 A3 F4 C5  (Dm7)
  [110.0, 164.81, 293.66, 440.0],  // A2 E3 D4 A4  (Am7)
  [130.81, 174.61, 293.66, 440.0], // C3 F3 D4 A4  (Fmaj9-ish)
];

const CHORD_DURATION_S = 14;
const CROSSFADE_S = 4;
const BASE_VOLUME = 0.18; // volume at slider = 100

export function initMusicSystem() {
  let ctx = null;
  let masterGain = null;
  let filter = null;
  let playing = false;
  let chordIndex = 0;
  let timeouts = [];
  let activeVoices = []; // currently-sounding chord voices, for crossfade/cleanup

  function ensureContext() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = BASE_VOLUME;
    filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1200;
    filter.Q.value = 0.3;
    masterGain.connect(filter);
    filter.connect(ctx.destination);
  }

  function playChord(freqs, fadeInSeconds) {
    const now = ctx.currentTime;
    const bankGain = ctx.createGain();
    bankGain.gain.setValueAtTime(0, now);
    bankGain.gain.linearRampToValueAtTime(1, now + fadeInSeconds);
    bankGain.connect(masterGain);

    const oscillators = freqs.map((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? "sine" : "triangle";
      osc.frequency.value = freq;
      osc.detune.value = (Math.random() - 0.5) * 6; // subtle warmth, avoids a sterile tone
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = 1 / freqs.length;
      osc.connect(voiceGain);
      voiceGain.connect(bankGain);
      osc.start(now);
      return osc;
    });

    return { oscillators, bankGain };
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
    chordIndex++;

    const newVoice = playChord(freqs, isFirst ? 2 : CROSSFADE_S);
    const oldVoice = activeVoices.shift();
    if (oldVoice) stopVoice(oldVoice, CROSSFADE_S);
    activeVoices.push(newVoice);

    timeouts.push(setTimeout(() => scheduleNextChord(false), CHORD_DURATION_S * 1000));
  }

  function start() {
    ensureContext();
    if (ctx.state === "suspended") ctx.resume();
    if (playing) return;
    playing = true;
    scheduleNextChord(true);
  }

  function stop() {
    playing = false;
    timeouts.forEach(clearTimeout);
    timeouts = [];
    activeVoices.forEach((v) => stopVoice(v, 1.5));
    activeVoices = [];
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