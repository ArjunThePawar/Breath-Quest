// playerState.js
// Manages the player character's "power" stat. Power is calculated
// directly from world stability - this keeps the core game promise:
// calm breathing -> stable world -> powerful character.
//
// This file has no knowledge of breathing, microphones, or alarms -
// it just converts one number (stability) into another (power).

import { CONFIG } from "./config.js";

export class PlayerState {
  constructor() {
    this._power = CONFIG.POWER_MIN; // start at minimum power
  }

  // Public read-only access to current power.
  get power() {
    return this._power;
  }

  // Recalculates power based on the current stability value.
  // Uses a simple straight-line (linear) mapping: 0 stability = POWER_MIN,
  // 100 stability = POWER_MAX, everything in between scales proportionally.
  updateFromStability(stabilityValue) {
    // Convert stability (0-100) into a fraction between 0 and 1.
    const t = stabilityValue / CONFIG.STABILITY_MAX;

    // Scale that fraction into the power range, and round to a whole number.
    this._power = Math.round(
      CONFIG.POWER_MIN + t * (CONFIG.POWER_MAX - CONFIG.POWER_MIN)
    );

    return this._power;
  }
}