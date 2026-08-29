// alarmSystem.js
// Plays a simple alarm tone using the Web Audio API - 
// only how to START and STOP a beeping
// sound; it does not decide WHEN to do so (that decision is made in
// gameLoop.js, based on the world's stability zone).

import { CONFIG } from "./config.js";

export class AlarmSystem {
  constructor() {
    this._audioContext = null; // Web Audio context, created only when needed
    this._oscillator = null;   // generates the actual tone
    this._gainNode = null;     // controls the volume of the tone
    this._isPlaying = false;   // tracks whether the alarm is currently active
  }

  // Starts the alarm tone, if it isn't already playing.
  start() {
    // Guard clause: if it's already playing, do nothing - this prevents
    // creating multiple overlapping oscillators if start() is called
    // more than once in a row.
    if (this._isPlaying) return;

    // Create a fresh audio context and tone generator.
    this._audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this._oscillator = this._audioContext.createOscillator();
    this._gainNode = this._audioContext.createGain();

    // Configure the tone: a buzzy square wave at a fixed pitch/volume.
    this._oscillator.type = "square";
    this._oscillator.frequency.value = CONFIG.ALARM_FREQUENCY_HZ;
    this._gainNode.gain.value = CONFIG.ALARM_VOLUME;

    // Wire the oscillator -> volume control -> speakers.
    this._oscillator.connect(this._gainNode);
    this._gainNode.connect(this._audioContext.destination);

    // Actually begin making sound.
    this._oscillator.start();
    this._isPlaying = true;
  }

  // Stops the alarm tone, if it's currently playing.
  stop() {
    if (!this._isPlaying) return; // nothing to stop

    this._oscillator.stop();       // stop generating the tone
    this._audioContext.close();    // free up audio resources
    this._oscillator = null;
    this._gainNode = null;
    this._audioContext = null;
    this._isPlaying = false;
  }
}