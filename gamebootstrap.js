// gameBootstrap.js
//
// Starts your existing GameEngine (from gameLoop.js) once the player
// presses Play from the menu, and connects its events to the HUD and
// the voxel world's mood lighting. This does NOT reuse main.js (which
// auto-runs on load) — it imports the same underlying classes directly,
// so main.js is left completely untouched and unused by this flow.
//
// BOTH breath input methods (microphone AND keyboard) are created and
// started together, and stay active for the whole session. There's no
// "try mic, fall back to keyboard" step - if mic detection doesn't work
// for someone (denied permission, no mic, unreliable detection), they
// can just press B at any point and the game switches over immediately,
// with no waiting period. Whichever one is currently driving the world
// is reported via the engine's "activeinputchange" event.
//
// WIN FLOW: holding max power stabilizes the world ("stabilityachieved")
// rather than winning outright - that's the moment world.unlockTreasure()
// reveals a treasure hidden somewhere on the island. The actual "win"
// (and the win banner) only happens once the player physically walks up
// to it - voxelWorld.js detects that proximity itself and calls back
// through the handler wired up below, which tells the engine via
// engine.notifyTreasureFound().

import { KeyboardBreathInput, MicBreathInput } from "./breathInput.js";
import { GameEngine } from "./gameLoop.js";
import { updateSaveStats } from "./savesystem.js";
import { createSessionRecorder } from "./Sessionsummary.js";

// Starts the game with both input methods live simultaneously.
export async function startGame({ world, hud, onWin }) {
  const keyboardInput = new KeyboardBreathInput(window);
  const micInput = new MicBreathInput();

  const engine = new GameEngine([keyboardInput, micInput]);

  // Records stability-over-time (and calm/panicked tick counts) for
  // this run, so the win/fail screen can show an actual chart and a
  // few headline stats from the session that just happened, instead of
  // just a pass/fail message.
  const recorder = createSessionRecorder();
  recorder.start();

  // Fresh run: make sure any treasure left open/found from a previous
  // session is hidden and reset before this one starts.
  world.resetTreasure();

  // The world detects the player's proximity to the (unlocked) treasure
  // entirely on its own each frame - all it needs from us is something
  // to call the instant that happens, which forwards the news to the
  // engine so the real "win" event can fire.
  world.setTreasureFoundHandler(() => engine.notifyTreasureFound());

  engine.addEventListener("tick", (e) => {
    const { breath, stability, power, hasWon, winProgressMs } = e.detail;
    hud.update({ breath, stability, power, hasWon, winProgressMs });
    world.setMood(stability.zone, stability.value);
    updateSaveStats({ stabilityValue: stability.value, power, hasWon });
    recorder.record(stability.value, breath.state);
  });

  engine.addEventListener("worldzonechange", (e) => {
    hud.flashZoneChange(e.detail.from, e.detail.to);
  });

  // Fires once, the moment the player holds 100% power/stability long
  // enough. This is NOT the win - it reveals the treasure hidden
  // somewhere on the island and tells the player to go find it. From
  // this point on they must keep breathing CALMLY the entire time they
  // search - see gameLoop.js's _tick(), which now fails the run the
  // instant breathing slips out of "calm" once the hunt is on.
  engine.addEventListener("stabilityachieved", () => {
    world.unlockTreasure();
    hud.flashInputMessage(
      "The world is stable! A treasure lies hidden somewhere on the island — go find it. " +
        "Keep breathing calmly the whole time you search, or you'll have to start over.",
      { persist: true }
    );
  });

  // Fires once, the moment the player actually reaches the treasure.
  // This is the real win.
  engine.addEventListener("win", (e) => {
    hud.showWin(e.detail.heldDuration, recorder.getSummary());
    updateSaveStats({ stabilityValue: 100, power: 100, hasWon: true });
    if (onWin) onWin(e.detail);
  });

  // Fires the first time the world collapses into the chaotic zone
  // (the same moment the alarm starts). Chaotic is still recoverable -
  // the engine keeps running - so this just surfaces a "failed, try
  // again" message telling the player what happened without ending
  // their session for them.
  //
  // The engine can ALSO fire "fail" for a second, unrelated reason once
  // the treasure hunt is on: losing calm breathing mid-search ends the
  // run outright (no recovery). e.detail.reason tells the HUD which
  // message to show.
  engine.addEventListener("fail", (e) => {
    hud.showFail(e.detail && e.detail.reason, recorder.getSummary());
  });

  // Fires once per lightning/thunder strike, at the exact moment the
  // visual flash should happen (thunder audio follows a beat later).
  engine.addEventListener("lightning", () => {
    hud.flashLightning();
  });

  // Fires the instant a DIFFERENT input source than before produces a
  // real breath - i.e. the player just switched from breathing to
  // pressing B, or vice versa. Update the HUD label to match, and give
  // a brief, non-alarming confirmation toast (not persistent - this is
  // normal usage, not an error condition).
  engine.addEventListener("activeinputchange", (e) => {
    hud.setInputMode(e.detail.to);
    hud.flashInputMessage(
      e.detail.to === "mic"
        ? "Now using microphone input."
        : "Now using keyboard input (press B)."
    );
  });

  hud.setInputMode(null);
  hud.flashInputMessage("Setting up microphone and keyboard input…", { persist: true });

  await engine.start();

  hud.flashInputMessage(
    "Breathe calmly through your mouth into the mic, or press B every few seconds - whichever you use will drive the world."
  );
  return engine;
}