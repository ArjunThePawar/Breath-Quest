// config.js
// holds every tunable number for the game in one place.
// Nothing here contains logic - just values. If you want to make the
// game harder/easier/faster/slower, change numbers here instead of
// hunting through other files.

export const CONFIG = {
  //  Breath timing thresholds (all in milliseconds) 
  // These decide how we classify the SPEED of a breath cycle.
  CALM_CYCLE_MS: 5000,        // a breath cycle this long or longer = "calm"
  MODERATE_CYCLE_MS: 3000,    // a breath cycle this long or longer (but under CALM) = "moderate"
  PANIC_CYCLE_MS: 1800,       // reference value; anything faster than MODERATE counts as "panicked"

  // How much variation between consecutive breath cycles is allowed
  // before we call the rhythm "erratic" (irregular), even if the
  // average speed looks fine.
  MAX_ALLOWED_VARIANCE_MS: 900,

  //  World stability settings 
  STABILITY_MAX: 100,          // ceiling for the stability stat
  STABILITY_MIN: 0,            // floor for the stability stat
  STABILITY_START: 60,         // stability value when the game begins

  // How much stability changes per game-loop tick, based on breath state.
  STABILITY_GAIN_CALM: 0.6,        // calm breathing slowly raises stability
  STABILITY_GAIN_MODERATE: 0.1,    // moderate breathing raises it very slightly
  STABILITY_LOSS_PANICKED: 1.0,    // panicked breathing lowers it noticeably
  STABILITY_LOSS_ERRATIC: 0.6,     // erratic (irregular) breathing lowers it moderately
  STABILITY_DECAY_IDLE: 0.15,      // NO genuine breathing detected this tick - gently DRAINS
                                    // stability instead of granting free gain. This is what
                                    // stops the game from being winnable by just staying silent:
                                    // silence/no-input must never be treated as "moderate breathing".

  // Crossing these thresholds changes the "zone" of the world.
  STABILITY_CHAOTIC_THRESHOLD: 30,  // at/below this value, world = "chaotic"
  STABILITY_STABLE_THRESHOLD: 75,   // at/above this value, world = "stable"
  // anything between the two thresholds = "unstable"

  // Player power settings
  POWER_MIN: 10,   // weakest possible power (when stability is at its lowest)
  POWER_MAX: 100,  // strongest possible power (when stability is at its highest)

  // Game loop timing 
  TICK_INTERVAL_MS: 500,     // how often (ms) the game re-evaluates stability/power
  NO_INPUT_TIMEOUT_MS: 4000, // if no new breath detected in this long, count the tick as "idle"
                              // (see STABILITY_DECAY_IDLE - idle NEVER grants gain)

  //  Microphone input settings 
  MIC_FFT_SIZE: 1024,           // size of the audio analysis buffer (must be a power of 2)
  MIC_PEAK_THRESHOLD: 0.15,     // how much louder than the noise floor counts as a "breath"
  MIC_MIN_PEAK_GAP_MS: 700,     // ignore peaks closer together than this (prevents double-counting one breath)
  MIN_BREATH_PHASE_MS: 180,     // a loud moment only counts as a real inhale/exhale once it has
                                 // stayed above the threshold for this long - filters out short
                                 // clicks, pops, taps, and stray noise that aren't actual mouth-breathing
  MIC_FALLBACK_TIMEOUT_MS: 10000,// if the mic never picks up a single genuine breath phase for this
                                 // long (game start, or after breathing stops being detected),
                                 // automatically switch to keyboard (hold B) input

  //  Alarm settings (plays when the world becomes chaotic)
  ALARM_FREQUENCY_HZ: 880,   // pitch of the alarm tone
  ALARM_VOLUME: 0.15,        // volume of the alarm tone (0 = silent, 1 = full volume)

  //  Win condition settings 
  WIN_POWER_THRESHOLD: 100,     // power must reach this value to start the win timer
  WIN_HOLD_DURATION_MS: 10000,  // power must STAY at/above the threshold for this long to win
};