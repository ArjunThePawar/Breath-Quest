// gameLoop.js
// This is the "conductor" of the whole mechanism. It doesn't do any
// calculations itself - it wires together breathInput, breathAnalyzer,
// worldStability, playerState, and alarmSystem, and runs the periodic
// "tick" that drives the whole game forward.
//
// It also owns the WIN CONDITION logic, since winning depends on
// combining information from multiple systems (power + time).

import { CONFIG } from "./config.js";
import { BreathAnalyzer } from "./breathAnalyzer.js";
import { WorldStability } from "./worldStability.js";
import { PlayerState } from "./playerState.js";
import { AlarmSystem } from "./alarmsystem.js";

export class GameEngine extends EventTarget {
  // breathInputSource: either a KeyboardBreathInput or MicBreathInput instance.
  constructor(breathInputSource) {
    super();

    // Store references to each subsystem.
    this._input = breathInputSource;
    this._analyzer = new BreathAnalyzer();
    this._stability = new WorldStability();
    this._player = new PlayerState();
    this._alarm = new AlarmSystem();

    // Tracks the most recent breathing classification (defaults to neutral).
    this._latestClassification = { state: "moderate", avgCycleMs: null, variance: 0 };

    // Tracks when the last real breath was detected, so we can tell if
    // the player has stopped giving input entirely.
    this._lastBreathTimestamp = null;

    // Handle for the setInterval loop, so we can stop it later.
    this._tickHandle = null;

    // ── Win condition tracking ──
    this._powerFullSince = null; // timestamp when power FIRST reached max (resets if power drops)
    this._hasWon = false;        // becomes true once, and stays true (prevents re-firing "win")

    // Whenever the input source detects a completed breath cycle,
    // update our classification immediately (not just on the tick timer),
    // so the analyzer always has the latest data available.
    this._onBreathCycle = (e) => {
      this._latestClassification = this._analyzer.addCycle(e.detail.cycleDurationMs);
      this._lastBreathTimestamp = performance.now();
    };
    this._input.addEventListener("breathcycle", this._onBreathCycle);

    // Whenever the world's ZONE changes (e.g. unstable -> chaotic),
    // react accordingly: forward the event outward for the UI, AND
    // control the alarm based on whether we entered/left "chaotic".
    this._stability.addEventListener("zonechange", (e) => {
      // Let any UI code listening to the GameEngine know the zone changed.
      this.dispatchEvent(new CustomEvent("worldzonechange", { detail: e.detail }));

      // Turn the alarm ON the moment the world becomes chaotic.
      if (e.detail.to === "chaotic") {
        this._alarm.start();
      }
      // Turn the alarm OFF the moment the world LEAVES chaotic
      // (i.e. it was chaotic before, and now it's something else).
      else if (e.detail.from === "chaotic") {
        this._alarm.stop();
      }
    });
  }

  // Starts the whole engine: activates the input source (mic/keyboard)
  // and begins the repeating tick loop.
  async start() {
    if (this._input.start) {
      await this._input.start(); // "await" matters for mic (asks permission first)
    }
    this._tickHandle = setInterval(() => this._tick(), CONFIG.TICK_INTERVAL_MS);
  }

  // Stops everything cleanly (used when ending a game session).
  stop() {
    if (this._tickHandle) clearInterval(this._tickHandle);
    if (this._input.stop) this._input.stop();
    this._alarm.stop(); // make sure the alarm never keeps blaring after stop()
  }

  // Runs automatically every TICK_INTERVAL_MS. This is where stability,
  // power, and the win condition all get recalculated.
  _tick() {
    // Figure out how long it's been since the player last produced a
    // detected breath. If it's been too long, we assume they've stopped
    // giving input (not necessarily panicking) and drift toward neutral,
    // instead of endlessly repeating a stale classification.
    const timeSinceLastBreath = this._lastBreathTimestamp
      ? performance.now() - this._lastBreathTimestamp
      : Infinity;

    const effectiveState =
      timeSinceLastBreath > CONFIG.NO_INPUT_TIMEOUT_MS
        ? "moderate"
        : this._latestClassification.state;

    // Update stability based on the current breathing state.
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
      breath: this._latestClassification,      // { state, avgCycleMs, variance }
      stability: {
        value: this._stability.value,          // 0-100
        zone: this._stability.zone,            // "stable" | "unstable" | "chaotic"
      },
      power: this._player.power,               // 10-100
      hasWon: this._hasWon,                    // true once the win condition is met
      // How long (ms) power has been continuously at max right now.
      // Useful for a UI progress bar toward winning.
      winProgressMs: this._powerFullSince
        ? performance.now() - this._powerFullSince
        : 0,
    };
  }
}