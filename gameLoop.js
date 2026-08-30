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
import { ThunderSystem } from "./Thundersystem.js";

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
    this._thunder = new ThunderSystem();
    this._thunderTimeoutHandle = null; // handle for the next scheduled repeat strike, while chaotic persists

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

    // ── Stabilization tracking ──
    // Reaching max power and holding it no longer wins the game by
    // itself - it "stabilizes" the world (see _checkStabilization) and
    // unlocks the hidden treasure hunt. _hasStabilized becomes true
    // once, and stays true.
    this._powerFullSince = null; // timestamp when power FIRST reached max (resets if power drops)
    this._hasStabilized = false;
    this._stabilizedHeldDuration = 0; // heldDuration recorded at the moment stabilization happened

    // ── Win condition tracking ──
    // The actual "win" now only happens once the player has physically
    // found the treasure that stabilizing the world unlocked (see
    // notifyTreasureFound(), called from outside the engine once the
    // renderer/world detects the player standing next to it).
    this._hasWon = false;        // becomes true once, and stays true (prevents re-firing "win")

    // ── Fail condition tracking ──
    // Becomes true once, and stays true (prevents re-firing "fail" every
    // single tick the world sits in the chaotic zone).
    this._hasFailed = false;

    // ── Hidden "force chaotic" toggle tracking (Ctrl+F) ──
    // null = not currently forced. Otherwise holds the stability value
    // from the moment JUST BEFORE the world was forced chaotic, so a
    // second press can put it back exactly where it was. See
    // toggleForceChaotic() below.
    this._forcedChaoticPrevValue = null;

    // Wire up every input source identically - each one can independently
    // report breath phases/cycles/classifications at any time, for the
    // whole session.
    for (const input of this._inputs) {
      input.addEventListener("breathphase", () => this._onBreathPhase(input));
      input.addEventListener("breathcycle", (e) => this._onBreathCycle(input, e));
      input.addEventListener("breathclassification", (e) => this._onBreathClassification(input, e));
    }

    // Whenever the world's ZONE changes (e.g. unstable -> chaotic),
    // react accordingly: forward the event outward for the UI, AND
    // control the alarm/thunder based on whether we entered/left
    // "chaotic". Note: entering chaotic is NOT itself a failure - it's
    // purely audiovisual (red bar, alarm, storm) and fully recoverable
    // if stability climbs back up. The actual hard-failure check lives
    // in _tick(), tied to the separate, lower STABILITY_FAIL_THRESHOLD.
    this._stability.addEventListener("zonechange", (e) => {
      // Let any UI code listening to the GameEngine know the zone changed.
      this.dispatchEvent(new CustomEvent("worldzonechange", { detail: e.detail }));

      // Turn the alarm ON the moment the world becomes chaotic.
      if (e.detail.to === "chaotic") {
        this._alarm.start();
        // Lightning + thunder together, the instant the world turns
        // chaotic (the same moment the stability bar turns red), then
        // keeps striking every few seconds for as long as the storm
        // continues.
        this._strikeLightning();
        this._scheduleNextThunder();
      }
      // Turn the alarm OFF the moment the world LEAVES chaotic
      // (i.e. it was chaotic before, and now it's something else).
      else if (e.detail.from === "chaotic") {
        this._alarm.stop();
        // The storm has passed - stop scheduling further thunder.
        if (this._thunderTimeoutHandle) {
          clearTimeout(this._thunderTimeoutHandle);
          this._thunderTimeoutHandle = null;
        }
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

  // Called whenever an input source reports an ALREADY-DECIDED
  // classification directly (currently only MicBreathInput, which
  // classifies from raw volume-change magnitude rather than cycle
  // timing - see breathInput.js). No analyzer involved here at all;
  // we just record it and, if this source is active, use it as-is.
  _onBreathClassification(input, e) {
    const state = this._perInputState.get(input);
    state.classification = { state: e.detail.state, avgCycleMs: null, variance: null };

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
    if (this._thunderTimeoutHandle) {
      clearTimeout(this._thunderTimeoutHandle);
      this._thunderTimeoutHandle = null;
    }
    this._thunder.dispose();
  }

  // Freezes the game (used for the Escape pause menu) WITHOUT tearing
  // anything down: only the periodic tick is paused, so nothing about
  // stability/power/the breathing check gets re-evaluated while paused.
  // Breath input sources are deliberately left running - if we stopped
  // them here too, resuming would mean re-requesting mic access and
  // would lose the player's last-known breathing rhythm for no reason.
  // Also silences the alarm/thunder for the duration, since there's no
  // reason for a storm to keep going while the player is looking at a
  // menu.
  pause() {
    if (this._tickHandle) {
      clearInterval(this._tickHandle);
      this._tickHandle = null;
    }
    this._alarm.stop();
    if (this._thunderTimeoutHandle) {
      clearTimeout(this._thunderTimeoutHandle);
      this._thunderTimeoutHandle = null;
    }
  }

  // Reverses pause(): resumes the tick loop, and - if the world was
  // still in the chaotic zone when paused - resumes the alarm/thunder
  // too. Does nothing if the run has already ended (won or failed),
  // since there's nothing left to resume.
  resume() {
    if (this._hasWon || this._hasFailed) return;
    if (!this._tickHandle) {
      this._tickHandle = setInterval(() => this._tick(), CONFIG.TICK_INTERVAL_MS);
    }
    if (this._stability.zone === "chaotic") {
      this._alarm.start();
      this._scheduleNextThunder();
    }
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

    // Check whether the player has now stabilized the world (this
    // unlocks the treasure hunt - it does NOT win the game by itself).
    this._checkStabilization(power);

    // Once the world has been stabilized and the treasure hunt is on,
    // the player has to keep breathing CALMLY - not just "moderate" or
    // anything else - for the ENTIRE hunt, not just the original
    // stabilization hold. Slipping out of "calm" even briefly (including
    // going idle) ends the run immediately; there's no partial credit,
    // and no resuming - the whole game has to be started over.
    if (!this._hasFailed && !this._hasWon && this._hasStabilized && effectiveState !== "calm") {
      this._hasFailed = true;
      this.stop();
      this.dispatchEvent(
        new CustomEvent("fail", { detail: { reason: "treasure-hunt-broken", stability: stabilityValue } })
      );
    }

    // Hard failure: stability collapsing all the way down to
    // STABILITY_FAIL_THRESHOLD means the player failed to meditate/calm
    // down in time. Unlike merely entering the (higher, recoverable)
    // chaotic zone, this ends the run immediately - stop() below halts
    // the tick loop, all input sources, the alarm, and any pending
    // thunder, so nothing keeps running underneath the fail screen.
    if (!this._hasFailed && stabilityValue <= CONFIG.STABILITY_FAIL_THRESHOLD) {
      this._hasFailed = true;
      this.stop();
      this.dispatchEvent(
        new CustomEvent("fail", { detail: { reason: "meditation-failed", stability: stabilityValue } })
      );
    }

    // Broadcast the full updated state, so any UI listening can redraw itself.
    this.dispatchEvent(new CustomEvent("tick", { detail: this.getState() }));
  }

  // Fires the visual "lightning" flash and the thunder audio together,
  // for one strike. Real lightning is seen before it's heard (light
  // outruns sound) - so the flash fires immediately, and the thunder
  // clap follows a brief moment later, rather than both landing at the
  // exact same instant.
  _strikeLightning() {
    this.dispatchEvent(new CustomEvent("lightning", { detail: {} }));
    setTimeout(() => this._thunder.strike(), 120 + Math.random() * 180);
  }

  // Schedules the NEXT thunder strike a few seconds out, while the world
  // remains chaotic. Re-schedules itself after each strike, so thunder
  // keeps rumbling at randomized intervals for as long as the storm
  // continues - cleared the moment the world leaves the chaotic zone
  // (see the "from chaotic" branch above) or the engine stops.
  _scheduleNextThunder() {
    const delayMs = 3000 + Math.random() * 4000; // every 3-7 seconds
    this._thunderTimeoutHandle = setTimeout(() => {
      this._strikeLightning();
      this._scheduleNextThunder();
    }, delayMs);
  }

  // Determines whether the player has STABILIZED the world: power must
  // reach WIN_POWER_THRESHOLD and STAY there continuously for
  // WIN_HOLD_DURATION_MS. This used to be the win condition itself; now
  // it's the gate that reveals the hidden treasure (see
  // notifyTreasureFound() below for the actual win).
  _checkStabilization(power) {
    if (this._hasStabilized) return; // already stabilized this session - don't check again

    const now = performance.now();

    if (power >= CONFIG.WIN_POWER_THRESHOLD) {
      // Power just reached max for the first time (in this streak) -
      // start the countdown clock.
      if (this._powerFullSince === null) {
        this._powerFullSince = now;
      }

      // How long has power been continuously at/above the threshold?
      const heldDuration = now - this._powerFullSince;

      // If it's been held long enough, the world is considered
      // stabilized - this reveals the treasure but does not end the run.
      if (heldDuration >= CONFIG.WIN_HOLD_DURATION_MS) {
        this._hasStabilized = true;
        this._stabilizedHeldDuration = heldDuration;

        this.dispatchEvent(new CustomEvent("stabilityachieved", { detail: { heldDuration } }));
      }
    } else {
      // Power dropped below the threshold - reset the countdown, since
      // stabilizing requires CONTINUOUS max power, not just reaching it once.
      this._powerFullSince = null;
    }
  }

  // Called from OUTSIDE the engine (via the hidden Ctrl+F shortcut in
  // menuController.js) to instantly TOGGLE the world between the
  // chaotic zone and whatever it was before. This does NOT introduce a
  // second, separate "chaotic mode" - it just jams the stability value
  // via WorldStability.forceValue(), which is the same _setValue() path
  // the normal per-tick breath handling already uses. Every consequence
  // of that (the "zonechange"/"stabilitychange" events, the alarm
  // turning on/off, lightning + thunder starting/stopping, the HUD bar
  // flashing red) fires through the exact same listeners as an organic
  // collapse/recovery - nothing is short-circuited or duplicated.
  //
  // First press: remembers the CURRENT stability value, then forces
  // stability down to STABILITY_CHAOTIC_THRESHOLD (not 0, so it can't
  // also trip the separate, lower STABILITY_FAIL_THRESHOLD hard-failure
  // check in _tick() - the world stays normal/RECOVERABLE chaotic, and
  // the ordinary tick loop keeps running underneath exactly as usual).
  // Second press: restores stability back to the value it had right
  // before the first press, undoing the override.
  //
  // Ignored once the run has already ended.
  toggleForceChaotic() {
    if (this._hasWon || this._hasFailed) return;

    if (this._forcedChaoticPrevValue === null) {
      this._forcedChaoticPrevValue = this._stability.value;
      this._stability.forceValue(CONFIG.STABILITY_CHAOTIC_THRESHOLD);
    } else {
      const restoreValue = this._forcedChaoticPrevValue;
      this._forcedChaoticPrevValue = null;
      this._stability.forceValue(restoreValue);
    }
  }

  // Called from OUTSIDE the engine (by whatever is watching the
  // player's position in the 3D world - see voxelWorld.js's treasure
  // handler, wired up in menuController.js) the moment the player
  // physically reaches the hidden treasure. This is the ONLY thing that
  // actually wins the game now. Guarded so it can only do anything once
  // the world has genuinely been stabilized (the treasure doesn't exist
  // to be found before then) and only fires once per session.
  notifyTreasureFound() {
    if (this._hasWon || !this._hasStabilized) return;

    this._hasWon = true;
    this._alarm.stop(); // safety net - alarm should never play during/after a win

    this.dispatchEvent(
      new CustomEvent("win", { detail: { heldDuration: this._stabilizedHeldDuration } })
    );
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
      hasStabilized: this._hasStabilized,      // true once the world has been stabilized (treasure unlocked)
      hasWon: this._hasWon,                    // true once the treasure has actually been found
      hasFailed: this._hasFailed,              // true once the run has ended in failure (see the "fail" event's reason)
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