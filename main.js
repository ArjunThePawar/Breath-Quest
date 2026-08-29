// main.js
// The entry point that wires everything together and runs it.
// This file has no game logic of its own - it just creates the pieces,
// listens for events, and prints results (for now, until real UI is added).

import { KeyboardBreathInput, MicBreathInput } from "./breathInput.js";
import { GameEngine } from "./gameLoop.js";

async function main() {
  // Choose your input source here:
  // - MicBreathInput()      -> real breathing via microphone
  // - KeyboardBreathInput() -> hold SPACE to simulate breathing (for testing)
  const input = new MicBreathInput();
  // const input = new KeyboardBreathInput(window);

  // Create the game engine, passing in whichever input source we chose.
  const engine = new GameEngine(input);

  // Runs every tick (every CONFIG.TICK_INTERVAL_MS) - prints the current state.
  engine.addEventListener("tick", (e) => {
    const { breath, stability, power, hasWon, winProgressMs } = e.detail;
    console.log(
      `[breath: ${breath.state}] stability: ${stability.value.toFixed(1)} (${stability.zone}) | power: ${power} | winProgress: ${(winProgressMs / 1000).toFixed(1)}s`
    );
  });

  // Runs whenever the world's zone changes (e.g. stable -> chaotic).
  engine.addEventListener("worldzonechange", (e) => {
    console.log(`--- WORLD ZONE CHANGED: ${e.detail.from} -> ${e.detail.to} ---`);
  });

  // Runs exactly once, the moment the player wins.
  engine.addEventListener("win", (e) => {
    console.log(`🏆 YOU WIN! Held max power for ${(e.detail.heldDuration / 1000).toFixed(1)} seconds.`);
  });

  // Start everything (this will prompt for microphone permission if using MicBreathInput).
  await engine.start();
  console.log("Breath Quest engine running.");
}

main();