# Breath Quest

A calming, breath-controlled 3D exploration game: breathe steadily (via
microphone or the keyboard) to stabilize a small voxel island, then find
the treasure it reveals. Built with vanilla JS + Three.js — no build
step, no bundler, no framework.

This file exists to make the project easy to review quickly — for
teammates, and for hackathon judges skimming the repo during a review
round.

## Running it

Everything is a static file. No `npm install`, no build step.

- Open `app.html` directly in a browser, **or**
- Serve the folder with any static server (recommended, since some
  browsers restrict `type="module"` imports and mic access on `file://`
  URLs):
  ```
  npx serve .
  # or
  python3 -m http.server 8000
  ```
  then visit `http://localhost:<port>/app.html`.
- `index.html` is a separate, older console-only harness (`main.js`)
  used to sanity-check the core breathing→stability mechanism before
  any UI existed. It's not the game — `app.html` is.

**Deploying a hosted link:** because there's no build step, any static
host works as-is — drag-and-drop the folder onto Netlify, or push to a
repo and enable GitHub Pages pointed at the root. No environment
variables or server config needed. (three.js itself loads from a CDN
via the import map in `app.html`, so the host just needs to serve the
files — nothing to bundle.)

**Requirements:** a browser with Web Audio + `getUserMedia` support
(any modern Chrome/Edge/Firefox). Microphone access is optional — see
"Input fallback" below.

## Core loop

1. Breathe calmly (mic) or press **B** rhythmically (keyboard) — both
   inputs are live simultaneously; whichever produced a breath most
   recently "drives" the world.
2. Calm breathing raises **World Stability**; panicked/erratic
   breathing — or staying silent too long — drains it.
3. **Power** scales directly with stability. Reach and hold max power
   long enough to **stabilize** the world.
4. Stabilizing reveals a hidden treasure somewhere on the island. Walk
   to it *while staying calm the whole way* to actually win.
5. Scattered around the island (separately, and available from the
   very start) are a handful of small collectible gems — a low-stakes,
   always-on side-goal for anyone who'd rather explore for a minute.

## Architecture

```
app.html            Real game shell: menu, settings, in-game HUD markup
index.html + main.js  Console-only mechanism harness (dev/debug only)

menuController.js   Wires up every DOM screen/HUD element; owns the
                     top-level "what screen are we on" state machine
gamebootstrap.js     Starts a GameEngine session, connects its events
                     to the HUD and to voxelWorld's mood/treasure/gems

gameLoop.js          GameEngine: the tick loop, win/fail conditions,
                     alarm/thunder triggering, the hidden Ctrl+F toggle
worldStability.js    The single stability number (0-100) + zone changes
playerState.js       Converts stability -> power (linear map)
breathInput.js       KeyboardBreathInput + MicBreathInput (raw signal)
breathAnalyzer.js    Turns a stream of breath-cycle durations into
                     calm/moderate/panicked/erratic
config.js            Every tunable number in one place
difficulty.js        Zen/Normal/Hard as multipliers on config.js

voxelWorld.js        Three.js scene: island terrain, water, sky, mood
                     lighting, decoration (trees/rocks/grass), the
                     treasure hunt, the collectible gems, obstacle
                     collision data
playerMovement.js    WASD + mouse-look, swimming, border grace period,
                     tree/rock collision resolution
alarmsystem.js / thundersystem.js / musicsystem.js
                     Web Audio synthesis - no audio files, no license
                     concerns; alarm/thunder/lofi music all generated
                     live from oscillators + noise buffers
breathingguide.js    Optional visual breathing pacer (accessibility aid)
onboarding.js        First-launch "how to play" step content
sessionsummary.js    End-of-run stats + inline SVG stability chart
usersettings.js      Volume/brightness/sensitivity/controls/difficulty,
                     persisted to localStorage (guarded - see below)
savesystem.js        "Has this browser played before" bookkeeping, so
                     the menu can offer Continue vs New Game
```

## Hidden dev/demo shortcuts

Two intentionally undocumented-in-UI shortcuts exist, kept out of the
HUD on purpose so they can't be triggered by accident during normal
play or a demo:

- **Ctrl+F** — toggles the world straight into the chaotic zone and
  back (see `GameEngine.toggleForceChaotic()`). Useful for instantly
  showing off the alarm/lightning/thunder reaction without waiting
  through several minutes of panicked breathing. Goes through the
  exact same `WorldStability` code path an organic collapse would, so
  it's not a separate/fake "chaotic mode" — it's a real state change.
- **B key** (documented in-game) — simulates a keyboard breath, and
  doubles as the built-in fallback/demo path if a mic ever misbehaves
  in front of judges.

If asked about these during a review: they're explicitly dev/demo
aids for reliably showcasing mechanics on a schedule, not hidden
"cheats" meant to be discovered by players.

## Input fallback & robustness

- Both breath inputs (mic + keyboard) start together; if the mic fails
  to start (permission denied, no device, browser restriction), the
  engine fires an `inputunavailable` event and the HUD shows a
  persistent banner explaining exactly what happened and confirming
  the keyboard is fully playable on its own — no silent failure.
- Every `localStorage` call across `savesystem.js`, `usersettings.js`,
  and `onboarding.js` is wrapped in try/catch, so a browser/session
  that blocks storage (private browsing, a locked-down demo laptop)
  degrades gracefully — settings/saves just won't persist across a
  reload — instead of throwing and breaking the menu.
- Movement, jump, crouch, and swimming all respect the key bindings
  set in Settings live (the bindings object is passed by reference),
  and the player now collides with trees/rocks (`voxelWorld.js`'s
  `getObstacles()` + `Playermovement.js`'s `resolveCollisions()`)
  instead of clipping through the scenery.

## Known limitations / next steps

- Mic-based panic detection is tuned around typical browser/mic gain
  and hasn't been validated in every acoustic environment — the
  Sensitivity slider exists to compensate, but it's worth a quick
  sound-check in the actual demo room beforehand.
- No automated tests yet; the mechanism harness (`index.html`/`main.js`)
  is the closest thing to one — it exercises the engine headlessly via
  console output.
- Grass-tuft decoration and the sound-effect systems don't yet respond
  to the Brightness/Volume sliders' extreme ends as gracefully as the
  rest of the HUD — a polish pass, not a functional gap.

