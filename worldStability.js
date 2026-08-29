// worldStability.js
// Manages the single most important stat in the game: WORLD STABILITY
// (a number from 0 to 100). Calm breathing raises it, panicked/erratic breathing lowers it.
// It also tracks which "zone" the world is currently in - stable,
// unstable, or chaotic - and announces it whenever that zone CHANGES,
// so other parts of the game (like the alarm) can react without
// constantly polling the value themselves.

import { CONFIG } from "./config.js";

export class WorldStability extends EventTarget {
  constructor() {
    super();
    this._value = CONFIG.STABILITY_START;        // starting stability value
    this._currentZone = this._zoneFor(this._value); // zone matching that starting value
  }

  // Public read-only access to the current stability number.
  get value() {
    return this._value;
  }

  // Public read-only access to the current zone name.
  get zone() {
    return this._currentZone;
  }

  // Given a stability number, returns which "zone" it falls into.
  _zoneFor(value) {
    if (value <= CONFIG.STABILITY_CHAOTIC_THRESHOLD) return "chaotic";
    if (value >= CONFIG.STABILITY_STABLE_THRESHOLD) return "stable";
    return "unstable";
  }

  // Called once per game tick with the player's current breath classification.
  // Adjusts stability up or down depending on that classification.
  applyBreathState(classification) {
    let delta = 0;     // how much to change stability by this tick

    switch (classification) {
      case "calm":
        delta = CONFIG.STABILITY_GAIN_CALM;
        break;
      case "moderate":
        delta = CONFIG.STABILITY_GAIN_MODERATE;
        break;
      case "panicked":
        delta = -CONFIG.STABILITY_LOSS_PANICKED;
        break;
      case "erratic":
        delta = -CONFIG.STABILITY_LOSS_ERRATIC;
        break;
      default:
        delta = 0;    // unknown state - no change
    }

    this._setValue(this._value + delta);
    return this._value;
  }

  // Internal helper: safely updates the stability value, clamps it within
  // bounds, updates the zone, and fires events if anything meaningful changed.
  _setValue(newValue) {
    // Keep the value within STABILITY_MIN/MAX no matter what.
    const clamped = Math.max(
      CONFIG.STABILITY_MIN,
      Math.min(CONFIG.STABILITY_MAX, newValue)
    );

    const previousZone = this._currentZone; // remember the OLD zone before updating

    this._value = clamped;
    this._currentZone = this._zoneFor(clamped);

    // Always announce that stability changed (useful for UI that shows the number).
    this.dispatchEvent(
      new CustomEvent("stabilitychange", {
        detail: { value: this._value, zone: this._currentZone },
      })
    );

    // Only announce a "zone change" if the zone is actually DIFFERENT
    // than it was before this update (e.g. went from unstable -> chaotic).
    if (previousZone !== this._currentZone) {
      this.dispatchEvent(
        new CustomEvent("zonechange", {
          detail: { from: previousZone, to: this._currentZone },
        })
      );
    }
  }
}