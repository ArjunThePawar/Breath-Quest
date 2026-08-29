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

import { KeyboardBreathInput, MicBreathInput } from "./breathInput.js";
import { GameEngine } from "./gameLoop.js";
import { updateSaveStats } from "./savesystem.js";

// Starts the game with both input methods live simultaneously.
export async function startGame({ world, hud, onWin }) {
  const keyboardInput = new KeyboardBreathInput(window);
  const micInput = new MicBreathInput();

  const engine = new GameEngine([keyboardInput, micInput]);

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

  // Fires the first time the world collapses into the chaotic zone
  // (the same moment the alarm starts). Chaotic is still recoverable -
  // the engine keeps running - so this just surfaces a "failed, try
  // again" message telling the player what happened without ending
  // their session for them.
  engine.addEventListener("fail", () => {
    hud.showFail();
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
  hud.flashInputMessage(
    "Breathe calmly through your mouth into the mic, or press B every few seconds - whichever you use will drive the world."
  );

  await engine.start();
  return engine;
}