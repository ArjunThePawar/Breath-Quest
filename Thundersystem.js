// thunderSystem.js  (NEW FILE)
//
// A synthesized thunder strike - a sharp, bright "crack" followed by a
// low rumbling decay - built the same way alarmSystem.js and
// musicSystem.js are (raw oscillators/noise + gain nodes via the Web
// Audio API). No audio files, no copyrighted material.
//
// This is purely a sound EFFECT - it doesn't decide WHEN to play (that
// decision belongs to gameLoop.js, tied to the same moment the world
// enters the chaotic zone and turns the stability bar red).

export class ThunderSystem {
  constructor() {
    this._audioContext = null; // created lazily, only once a strike is actually needed
  }

  // Plays a single thunder strike immediately.
  strike() {
    const ctx = this._ensureContext();
    const now = ctx.currentTime;

    // ── The "crack": a short, bright burst of noise ──
    // This is the sharp part of a thunderclap - mostly high-frequency
    // noise with a very fast decay.
    const crackBuffer = this._makeNoiseBuffer(ctx, 0.3);
    const crackSource = ctx.createBufferSource();
    crackSource.buffer = crackBuffer;

    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = "highpass";
    crackFilter.frequency.value = 1000;

    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.5, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    crackSource.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(ctx.destination);
    crackSource.start(now);
    crackSource.stop(now + 0.3);

    // ── The "rumble": a longer, low-frequency decay ──
    // This is the distant, rolling part of the thunder that lingers
    // after the initial crack. Duration is randomized slightly so
    // repeated strikes don't all sound identical.
    const rumbleDuration = 2.2 + Math.random() * 1.5;
    const rumbleBuffer = this._makeNoiseBuffer(ctx, rumbleDuration);
    const rumbleSource = ctx.createBufferSource();
    rumbleSource.buffer = rumbleBuffer;

    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.value = 120;

    const rumbleGain = ctx.createGain();
    rumbleGain.gain.setValueAtTime(0.0001, now);
    rumbleGain.gain.linearRampToValueAtTime(0.4, now + 0.15); // quick swell right after the crack
    rumbleGain.gain.exponentialRampToValueAtTime(0.001, now + rumbleDuration);

    rumbleSource.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(ctx.destination);
    rumbleSource.start(now + 0.05);
    rumbleSource.stop(now + rumbleDuration + 0.1);
  }

  // Creates (or resumes) the shared audio context, lazily - so no audio
  // resources are allocated until a thunder strike is actually needed.
  _ensureContext() {
    if (!this._audioContext) {
      this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._audioContext.state === "suspended") {
      this._audioContext.resume();
    }
    return this._audioContext;
  }

  // Generates a buffer of plain white noise - the raw material both the
  // crack and the rumble are filtered from.
  _makeNoiseBuffer(ctx, duration) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  // Frees up audio resources. Safe to call even if no strike ever
  // happened (the context is only created lazily in the first place).
  dispose() {
    if (this._audioContext) {
      this._audioContext.close();
      this._audioContext = null;
    }
  }
}