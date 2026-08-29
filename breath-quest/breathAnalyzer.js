// breathAnalyzer.js
// Takes the raw stream of "breathcycle" durations coming from breathInput.js
// and turns them into a meaningful classification: is the player breathing
// calm, moderate, panicked, or erratic (irregular)?
//
//not related to anythin about the microphone, stability, or the game loop -
// its only job is: numbers in, classification out.

import { CONFIG } from "./config.js";

export class BreathAnalyzer {
  // historySize = how many recent breath cycles we look at when judging
  // the current pattern (a "rolling window" instead of just one breath).
  constructor(historySize = 5) {
    this._historySize = historySize;
    this._recentDurations = []; // stores the last few cycle durations (ms)
  }

  // Called every time a new breath cycle completes. Adds it to our
  // rolling history and returns the freshly updated classification.
  addCycle(cycleDurationMs) {
    this._recentDurations.push(cycleDurationMs);

    // Keep only the most recent N durations - drop the oldest once we
    // exceed historySize, so old breathing patterns don't linger forever.
    if (this._recentDurations.length > this._historySize) {
      this._recentDurations.shift();
    }

    return this.classify();
  }

  // Helper: plain average of an array of numbers.
  _average(arr) {
    return arr.reduce((sum, v) => sum + v, 0) / arr.length;
  }

  // Helper: standard deviation - tells us how SPREAD OUT the values are.
  // A high value means the breathing rhythm is inconsistent/irregular.
  _variance(arr) {
    if (arr.length < 2) return 0; // can't measure spread with fewer than 2 points
    const avg = this._average(arr);
    const squaredDiffs = arr.map((v) => (v - avg) ** 2);
    return Math.sqrt(this._average(squaredDiffs));
  }

  // Looks at the current rolling history and decides which state we're in.
  classify() {
    // No data yet (game just started) - default to a neutral state.
    if (this._recentDurations.length === 0) {
      return { state: "moderate", avgCycleMs: null, variance: 0 };
    }

    const avgCycleMs = this._average(this._recentDurations);
    const variance = this._variance(this._recentDurations);

    // If the rhythm is too inconsistent, that overrides everything else -
    // even if the average speed looks okay, irregular breathing itself
    // is a sign of distress.
    if (variance > CONFIG.MAX_ALLOWED_VARIANCE_MS) {
      return { state: "erratic", avgCycleMs, variance };
    }

    // Otherwise, classify purely based on average breathing speed.
    if (avgCycleMs >= CONFIG.CALM_CYCLE_MS) {
      return { state: "calm", avgCycleMs, variance };
    }
    if (avgCycleMs >= CONFIG.MODERATE_CYCLE_MS) {
      return { state: "moderate", avgCycleMs, variance };
    }

    // Faster than "moderate" = panicked.
    return { state: "panicked", avgCycleMs, variance };
  }

  // Clears all history (useful when starting a new game session).
  reset() {
    this._recentDurations = [];
  }
}