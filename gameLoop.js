// gameLoop.js
// This is the "conductor" of the whole mechanism. It doesn't do any
// calculations itself - it wires together breathInput, breathAnalyzer,
// worldStability, playerState, and alarmSystem, and runs the periodic
// "tick" that drives the whole game forward.
//
// It also owns the WIN CONDITION logic, since winning depends on
// combining information from multiple systems (power + time).
//
// MULTIPLE SIMULTANEOUS INPUTS: the engine accepts one OR SEVERAL breath
// input sources at once (e.g. keyboard AND mic running together). Both
// stay live the whole session - there's no "try mic, fall back to
// keyboard after a timeout" step. Whichever source most recently
// produced a real breath becomes the "active" one driving the world, so
// if mic detection isn't working for someone, they can just start
// pressing B and the game switches over immediately - no waiting, no
// separate fallback mechanism to reason about.

import { CONFIG } from "./config.js";
import { BreathAnalyzer } from "./breathAnalyzer.js";
import { WorldStability } from "./worldStability.js";
import { PlayerState } from "./playerState.js";
import { AlarmSystem } from "./alarmsystem.js";

export class GameEngine extends EventTarget {
  // inputSources: a single BreathInputSource instance, OR an array of
  // several (e.g. [keyboardInput, micInput]) that should all run at once.
  constructor(inputSources) {
    super();

    // Normalize to an array so the rest of the class only ever deals
    // with "the list of active input sources", regardless of how many
    // were passed in.
    this._inputs = Array.isArray(inputSources) ? inputSources : [inputSources];

    // Store references to each subsystem.
    this._stability = new WorldStability();
    this._player = new PlayerState();
    this._alarm = new AlarmSystem();

    // Each input source gets its OWN analyzer and classification. This
    // matters because the sources aren't interchangeable data - mixing
    // mic-detected cycle durations and keyboard-tap durations into one
    // shared rolling average would make the classification erratic any
    // time someone alternates between the two. Instead we keep them
    // fully separate, and simply read from whichever source is
    // currently "active" (see _activeInput below).
    this._perInputState = new Map();
    for (const input of this._inputs) {
      this._perInputState.set(input, {
        analyzer: new BreathAnalyzer(),
        classification: { state: "moderate", avgCycleMs: null, variance: 0 },
      });
    }

    // Whichever input source most recently produced a genuine breath
    // phase. This is what "drives" the world at any given moment - it
    // updates instantly the moment a DIFFERENT source produces activity,
    // which is what lets a player seamlessly switch from breathing to
    // pressing B (or back) mid-session.
    this._activeInput = null;

    // Tracks the most recent breathing classification from whichever
    // input is active (defaults to neutral before any input arrives).
    this._latestClassification = { state: "moderate", avgCycleMs: null, variance: 0 };

    // The state actually applied to stability THIS tick - usually mirrors
    // _latestClassification.state, but becomes "idle" whenever no genuine
    // breath has been detected recently (see _tick). HUD reads this via
    // getState() so it always shows what's really driving the world,
    // rather than a stale "calm"/"moderate" left over from before the
    // player went quiet.
    this._effectiveState = "moderate";

    // Tracks when the last genuine breath ACTIVITY (any single phase -
    // one inhale, one exhale, or one keyboard tap) was detected, FROM
    // ANY input source, so we can tell if the player has stopped giving
    // input entirely. Updated on every "breathphase" event, not just on
    // completed full cycles - a full mic breath cycle only completes
    // once every ~2 phases, so gating idle-detection on cycle-completion
    // alone would leave real, ongoing breathing misclassified as "idle"
    // between cycles.
    this._lastBreathTimestamp = null;
    this._engineStartTimestamp = null;

    // Handle for the setInterval loop, so we can stop it later.
    this._tickHandle = null;

    // ── Win condition tracking ──
    this._powerFullSince = null; // timestamp when power FIRST reached max (resets if power drops)
    this._hasWon = false;        // becomes true once, and stays true (prevents re-firing "win")

    // ── Fail condition tracking ──
    // Becomes true once, and stays true (prevents re-firing "fail" every
    // single tick the world sits in the chaotic zone).
    this._hasFailed = false;

    // Wire up every input source identically - each one can independently
    // report breath phases/cycles at any time, for the whole session.
    for (const input of this._inputs) {
      input.addEventListener("breathphase", () => this._onBreathPhase(input));
      input.addEventListener("breathcycle", (e) => this._onBreathCycle(input, e));
    }

    // Whenever the world's ZONE changes (e.g. unstable -> chaotic),
    // react accordingly: forward the event outward for the UI, AND
    // control the alarm based on whether we entered/left "chaotic".
    this._stability.addEventListener("zonechange", (e) => {
      // Let any UI code listening to the GameEngine know the zone changed.
      this.dispatchEvent(new CustomEvent("worldzonechange", { detail: e.detail }));

      // Turn the alarm ON the moment the world becomes chaotic, and
      // report a failure the first time this happens (guarded by
      // _hasFailed, mirroring how "win" only ever fires once). This does
      // NOT stop the engine - chaotic is still recoverable (the alarm
      // turns back off in the "from chaotic" branch below if the player
      // calms back down), so the UI can choose to show a "failed - try
      // again" message without forcing the run to end.
      if (e.detail.to === "chaotic") {
        this._alarm.start();
        if (!this._hasFailed) {
          this._hasFailed = true;
          this.dispatchEvent(new CustomEvent("fail", { detail: { reason: "world-collapsed" } }));
        }
      }
      // Turn the alarm OFF the moment the world LEAVES chaotic
      // (i.e. it was chaotic before, and now it's something else).
      else if (e.detail.from === "chaotic") {
        this._alarm.stop();
      }
    });
  }

  // Called whenever ANY input source detects a genuine breath phase
  // (one inhale, one exhale, or one keyboard tap). Updates the shared
  // "is the player active at all" timestamp, and - if a DIFFERENT
  // source than before just produced activity - switches which source
  // is "active" and tells the UI about it.
  _onBreathPhase(input) {
    this._lastBreathTimestamp = performance.now();

    if (this._activeInput !== input) {
      const previous = this._activeInput;
      this._activeInput = input;

      // Immediately reflect that source's last-known classification,
      // rather than waiting for its next completed cycle - avoids a
      // brief stale reading from whichever source was active before.
      this._latestClassification = this._perInputState.get(input).classification;

      this.dispatchEvent(
        new CustomEvent("activeinputchange", {
          detail: { from: previous ? previous.name : null, to: input.name },
        })
      );
    }
  }

  // Called whenever ANY input source completes a full breath cycle.
  // Feeds that source's OWN analyzer (never a shared one - see the
  // comment in the constructor), and only updates the engine's overall
  // classification if this cycle came from the currently active source.
  _onBreathCycle(input, e) {
    const state = this._perInputState.get(input);
    state.classification = state.analyzer.addCycle(e.detail.cycleDurationMs);

    if (input === this._activeInput) {
      this._latestClassification = state.classification;
    }
  }

  // Starts the whole engine: activates EVERY input source at once, and
  // begins the repeating tick loop. If one source fails to start (e.g.
  // the player denies microphone permission), that's caught individually
  // so it doesn't stop the others from starting - the game stays fully
  // playable on whichever source(s) actually work.
  async start() {
    this._engineStartTimestamp = performance.now();

    await Promise.all(
      this._inputs.map(async (input) => {
        if (!input.start) return;
        try {
          await input.start(); // "await" matters for mic (asks permission first)
        } catch (err) {
          console.warn(`Breath input "${input.name}" failed to start (that's fine - other input methods are still active):`, err);
        }
      })
    );

    this._tickHandle = setInterval(() => this._tick(), CONFIG.TICK_INTERVAL_MS);
  }

  // Stops everything cleanly (used when ending a game session).
  stop() {
    if (this._tickHandle) clearInterval(this._tickHandle);
    for (const input of this._inputs) {
      if (input.stop) input.stop();
    }
    this._alarm.stop(); // make sure the alarm never keeps blaring after stop()
  }

  // Runs automatically every TICK_INTERVAL_MS. This is where stability,
  // power, and the win condition all get recalculated.
  _tick() {
    // Figure out how long it's been since the player last produced a
    // detected breath, from ANY input source. If it's been too long,
    // treat this tick as IDLE - not "moderate". Silence must never be
    // mistaken for calm/moderate breathing, or the game becomes
    // winnable by doing nothing at all.
    const timeSinceLastBreath = this._lastBreathTimestamp
      ? performance.now() - this._lastBreathTimestamp
      : Infinity;

    const effectiveState =
      timeSinceLastBreath > CONFIG.NO_INPUT_TIMEOUT_MS
        ? "idle"
        : this._latestClassification.state;
    this._effectiveState = effectiveState;

    // Update stability based on the current breathing state. "idle"
    // gently drains stability instead of granting anything (see
    // worldStability.js), so no breathing = no progress toward winning.
    const stabilityValue = this._stability.applyBreathState(effectiveState);

    // Update power based on the newly updated stability.
    const power = this._player.updateFromStability(stabilityValue);

    // Check whether the player has now met the win condition.
    this._checkWinCondition(power);

    // Broadcast the full updated state, so any UI listening can redraw itself.
    this.dispatchEvent(new CustomEvent("tick", { detail: this.getState() }));
  }

  // Determines whether the player has won: power must reach WIN_POWER_THRESHOLD
  // and STAY there continuously for WIN_HOLD_DURATION_MS.
  _checkWinCondition(power) {
    if (this._hasWon) return; // already won this session - don't check again

    const now = performance.now();

    if (power >= CONFIG.WIN_POWER_THRESHOLD) {
      // Power just reached max for the first time (in this streak) -
      // start the countdown clock.
      if (this._powerFullSince === null) {
        this._powerFullSince = now;
      }

      // How long has power been continuously at/above the threshold?
      const heldDuration = now - this._powerFullSince;

      // If it's been held long enough, the player wins.
      if (heldDuration >= CONFIG.WIN_HOLD_DURATION_MS) {
        this._hasWon = true;
        this._alarm.stop(); // safety net - alarm should never play during/after a win

        this.dispatchEvent(new CustomEvent("win", { detail: { heldDuration } }));
      }
    } else {
      // Power dropped below the threshold - reset the countdown, since
      // the win requires CONTINUOUS max power, not just reaching it once.
      this._powerFullSince = null;
    }
  }

  // Returns a single object representing the full current game state.
  // Any UI/renderer should use ONLY this method to know what to draw -
  // it should never reach into the individual subsystems directly.
  getState() {
    return {
      // .state comes from _effectiveState (which can be "idle"), not
      // directly from _latestClassification - otherwise the HUD would
      // keep showing a stale "calm"/"moderate" after the player goes
      // quiet, instead of reflecting what's actually driving the world.
      breath: {
        ...this._latestClassification,
        state: this._effectiveState,
      },
      stability: {
        value: this._stability.value,          // 0-100
        zone: this._stability.zone,            // "stable" | "unstable" | "chaotic"
      },
      power: this._player.power,               // 10-100
      hasWon: this._hasWon,                    // true once the win condition is met
      hasFailed: this._hasFailed,              // true once the world has collapsed into chaos at least once
      // Which input source is currently driving the world ("mic",
      // "keyboard", or null before any breath has been detected yet).
      activeInput: this._activeInput ? this._activeInput.name : null,
      // How long (ms) power has been continuously at max right now.
      // Useful for a UI progress bar toward winning.
      winProgressMs: this._powerFullSince
        ? performance.now() - this._powerFullSince
        : 0,
    };
  }
}