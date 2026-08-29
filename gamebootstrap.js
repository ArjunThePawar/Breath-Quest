// gameBootstrap.js  (NEW FILE)
//
// Starts your existing GameEngine (from gameLoop.js) once the player
// presses Play from the menu, and connects its events to the HUD and
// the voxel world's mood lighting. This does NOT reuse main.js (which
// auto-runs on load) — it imports the same underlying classes directly,
// so main.js is left completely untouched and unused by this flow.

import { KeyboardBreathInput, MicBreathInput } from "./breathInput.js";
import { GameEngine } from "./gameLoop.js";
import { updateSaveStats } from "./savesystem.js";

// Starts the game. Tries the microphone first (the intended experience);
// if the user denies permission or has no mic, falls back to keyboard
// (hold B) input so the game is still playable.
export async function startGame({ world, hud, onWin }) {
  let input;
  let usingMic = true;
  try {
    input = new MicBreathInput();
    // MicBreathInput.start() requests mic permission lazily inside
    // engine.start(), so we do a quick permission probe here first.
    await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) =>
      s.getTracks().forEach((t) => t.stop())
    );
  } catch (err) {
    console.warn("Microphone unavailable, falling back to keyboard input (hold B).", err);
    input = new KeyboardBreathInput(window);
    usingMic = false;
  }

  const engine = new GameEngine(input);

  engine.addEventListener("tick", (e) => {
    const { breath, stability, power, hasWon, winProgressMs } = e.detail;
    hud.update({ breath, stability, power, hasWon, winProgressMs });
    world.setMood(stability.zone, stability.value);
    updateSaveStats({ stabilityValue: stability.value, power, hasWon });
  });

  engine.addEventListener("worldzonechange", (e) => {
    hud.flashZoneChange(e.detail.from, e.detail.to);
  });

  engine.addEventListener("win", (e) => {
    hud.showWin(e.detail.heldDuration);
    updateSaveStats({ stabilityValue: 100, power: 100, hasWon: true });
    if (onWin) onWin(e.detail);
  });

  // The engine itself may swap from mic to keyboard mid-session if it
  // never picks up genuine mouth-breathing (see GameEngine._tick /
  // _switchToKeyboardFallback in gameLoop.js). Reflect that in the HUD
  // so the player knows what changed and how to keep playing.
  engine.addEventListener("inputfallback", () => {
    hud.setInputMode("keyboard");
    hud.flashInputMessage(
      "No steady mouth-breathing detected — switched to keyboard input. Hold B to breathe.",
      { persist: true }
    );
  });

  hud.setInputMode(usingMic ? "mic" : "keyboard");
  hud.flashInputMessage(
    usingMic
      ? "Breathe calmly through your mouth into the mic — silence won't stabilize the world."
      : "Microphone unavailable — hold B to breathe."
  );

  await engine.start();
  return engine;
}