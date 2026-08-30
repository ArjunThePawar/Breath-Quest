// difficulty.js  (NEW FILE)
//
// Difficulty presets, expressed as MULTIPLIERS on top of config.js's
// existing values rather than a second set of hardcoded numbers - that
// way "Normal" is always exactly what config.js already defines (a
// multiplier of 1 on everything), and Zen/Hard just scale from there.
// Whatever tuning happens in config.js in the future is automatically
// respected by all three presets.
//
// Only touches the handful of values that meaningfully change how
// forgiving a session feels - it does NOT touch mic sensitivity,
// audio/visual settings, or anything Usersettings.js already owns.

import { CONFIG } from "./config.js";

// Captured once, straight from config.js, BEFORE any preset has been
// applied. Every call to applyDifficulty() recomputes from these same
// original numbers, so switching presets back and forth never
// compounds/drifts the way repeatedly multiplying CONFIG in place would.
const BASE_CONFIG_SNAPSHOT = {
  STABILITY_LOSS_PANICKED: CONFIG.STABILITY_LOSS_PANICKED,
  STABILITY_LOSS_ERRATIC: CONFIG.STABILITY_LOSS_ERRATIC,
  STABILITY_DECAY_IDLE: CONFIG.STABILITY_DECAY_IDLE,
  NO_INPUT_TIMEOUT_MS: CONFIG.NO_INPUT_TIMEOUT_MS,
  STABILITY_CHAOTIC_THRESHOLD: CONFIG.STABILITY_CHAOTIC_THRESHOLD,
  STABILITY_FAIL_THRESHOLD: CONFIG.STABILITY_FAIL_THRESHOLD,
  WIN_HOLD_DURATION_MS: CONFIG.WIN_HOLD_DURATION_MS,
};

export const DIFFICULTIES = {
  zen: {
    label: "Zen",
    description: "Slower drain, more forgiving thresholds - a relaxed, low-pressure session.",
    multipliers: {
      STABILITY_LOSS_PANICKED: 0.5,
      STABILITY_LOSS_ERRATIC: 0.5,
      STABILITY_DECAY_IDLE: 0.5,
      NO_INPUT_TIMEOUT_MS: 1.25,
      STABILITY_CHAOTIC_THRESHOLD: 0.7,
      STABILITY_FAIL_THRESHOLD: 0.5,
      WIN_HOLD_DURATION_MS: 0.7,
    },
  },
  normal: {
    label: "Normal",
    description: "The default balance - no changes from config.js.",
    multipliers: {},
  },
  hard: {
    label: "Hard",
    description: "Faster drain, tighter thresholds - losing your calm costs you fast.",
    multipliers: {
      STABILITY_LOSS_PANICKED: 1.6,
      STABILITY_LOSS_ERRATIC: 1.6,
      STABILITY_DECAY_IDLE: 1.6,
      // Kept close to 1 on purpose: NO_INPUT_TIMEOUT_MS must stay safely
      // above CALM_CYCLE_MS (see config.js's own comment on this) or
      // calm breathing itself starts tripping false idle-decay. 0.95
      // tightens the window a little without risking that.
      NO_INPUT_TIMEOUT_MS: 0.95,
      STABILITY_CHAOTIC_THRESHOLD: 1.25,
      STABILITY_FAIL_THRESHOLD: 1.5,
      WIN_HOLD_DURATION_MS: 1.3,
    },
  },
};

// Applies a preset by key ("zen" | "normal" | "hard") to the live
// CONFIG object. Falls back to "normal" (i.e. the original config.js
// values, untouched) for an unrecognized key.
export function applyDifficulty(difficultyKey) {
  const preset = DIFFICULTIES[difficultyKey] || DIFFICULTIES.normal;

  for (const [key, baseValue] of Object.entries(BASE_CONFIG_SNAPSHOT)) {
    const multiplier = preset.multipliers[key] ?? 1;
    const scaled = baseValue * multiplier;
    // Millisecond fields should stay whole numbers; the rest (stability
    // gain/loss amounts, thresholds) are fine as-is.
    CONFIG[key] = key.endsWith("_MS") ? Math.round(scaled) : scaled;
  }
}