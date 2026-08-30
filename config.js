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
  STABILITY_GAIN_CALM: 1.5,        // calm breathing raises stability (was 0.6 — increased for faster progress)
  STABILITY_GAIN_MODERATE: 0.4,    // moderate breathing raises it a bit (was 0.1 — increased for faster progress)
  STABILITY_LOSS_PANICKED: 1.0,    // panicked breathing lowers it noticeably
  STABILITY_LOSS_ERRATIC: 0.6,     // erratic (irregular) breathing lowers it moderately
  STABILITY_DECAY_IDLE: 0.15,      // NO genuine breathing detected this tick - gently DRAINS
                                    // stability instead of granting free gain. This is what
                                    // stops the game from being winnable by just staying silent:
                                    // silence/no-input must never be treated as "moderate breathing".

  // Crossing these thresholds changes the "zone" of the world.
  STABILITY_CHAOTIC_THRESHOLD: 40,  // at/below this value, world = "chaotic" (alarm, thunder, red bar -
                                     // still RECOVERABLE if stability climbs back up)
  STABILITY_STABLE_THRESHOLD: 75,   // at/above this value, world = "stable"
  // If stability keeps falling all the way down to this value, that's a
  // HARD failure, not just "the world is currently chaotic" - the run
  // ends immediately ("failed to meditate properly"), unlike the
  // chaotic zone above which stays recoverable. Must be lower than
  // STABILITY_CHAOTIC_THRESHOLD - crossing it always means chaotic was
  // already active first.
  STABILITY_FAIL_THRESHOLD: 20,
  // anything between the two thresholds = "unstable"

  // Player power settings
  POWER_MIN: 10,   // weakest possible power (when stability is at its lowest)
  POWER_MAX: 100,  // strongest possible power (when stability is at its highest)

  // Game loop timing 
  TICK_INTERVAL_MS: 500,     // how often (ms) the game re-evaluates stability/power
  // If no new breath ACTIVITY detected in this long, count the tick as
  // "idle" (see STABILITY_DECAY_IDLE - idle NEVER grants gain). This
  // MUST stay comfortably above CALM_CYCLE_MS (5000ms) - otherwise
  // breathing calmly (which by definition has 5+ second gaps between
  // breaths) would itself keep tripping the idle timeout and draining
  // stability between every single calm breath.
  NO_INPUT_TIMEOUT_MS: 6500,

  //  Microphone input settings 
  // MicBreathInput classifies breathing directly from how much the
  // mic's volume changes moment to moment, relative to the loudest
  // volume it's picked up so far this session - no cycle timing, no
  // sustained-peak detection.
  MIC_FFT_SIZE: 1024,               // size of the audio analysis buffer (must be a power of 2)
  MIC_SOUND_FLOOR: 0.02,            // minimum (smoothed) volume before we consider there to be any
                                     // real sound at all - filters out constant near-silent hiss so
                                     // it doesn't count as ongoing "calm breathing" during true silence
  MIC_MAX_AMPLITUDE_FLOOR: 0.15,    // starting/minimum value for "the loudest volume seen so far" -
                                     // without this, the very first few frames of a session (before any
                                     // real peak has occurred) would be compared against ~0
  MIC_PANIC_VOLUME_FRACTION: 0.5,   // "panicked" triggers once a volume change reaches this fraction
                                     // of the loudest volume this mic has picked up so far this session
                                     // (was 0.75 — lowered to HALF, so panicked triggers more easily,
                                     // on a smaller volume swing relative to the loudest moment so far).
                                     // Lower this further to make panicked even easier to trigger;
                                     // raise it to require a sharper, more extreme swing.
  MIC_MAX_AMPLITUDE_DECAY: 0.997,    // per-frame decay applied to "loudest volume seen recently" when
                                     // it isn't being challenged - without this, one loud breath early
                                     // in a session permanently raises the panic threshold for the rest
                                     // of the run, eventually making panicked impossible to trigger
                                     // again. ~0.997 means it takes several seconds to meaningfully
                                     // relax back down - move closer to 1 for slower decay (more
                                     // session memory), closer to 0.99 for faster decay.
  // NOTE: there used to be a MIC_FALLBACK_TIMEOUT_MS here that switched
  // from mic to keyboard input after a period of silence. That's no
  // longer needed - both input methods now run simultaneously from the
  // start (see gamebootstrap.js), so switching is immediate and doesn't
  // depend on any timeout at all.

  //  Alarm settings (plays when the world becomes chaotic)
  ALARM_FREQUENCY_HZ: 880,   // pitch of the alarm tone
  ALARM_VOLUME: 0.15,        // volume of the alarm tone (0 = silent, 1 = full volume)

  //  Win condition settings 
  // Reaching and HOLDING max power no longer wins the game outright -
  // it "stabilizes" the world and unlocks the treasure hunt below.
  // Actually winning now requires physically finding that treasure.
  WIN_POWER_THRESHOLD: 100,     // power must reach this value to start the stabilization timer
  WIN_HOLD_DURATION_MS: 10000,  // power must STAY at/above the threshold for this long to stabilize the world

  //  Treasure hunt settings 
  // Once the world stabilizes (see above), a treasure is revealed
  // somewhere on the island - hidden among the existing trees/rocks
  // rather than sitting out in the open. This is how close (in world
  // units) the player has to physically walk up to it before it counts
  // as "found" and the game is actually won.
  TREASURE_FIND_RADIUS: 2.2,
  // How close the player needs to be before the treasure's faint glow
  // starts to become noticeable at all - kept short on purpose so the
  // glow can't be used to spot it from across the island.
  TREASURE_GLOW_RADIUS: 4,
};