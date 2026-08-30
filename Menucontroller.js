// menuController.js
//
// Builds and wires up: main menu (New Game / Continue / Settings),
// the settings sub-menu (volume / brightness / sensitivity / controls),
// and the in-game HUD — including the border-warning countdown shown
// when the player wanders past the island's accessible-area radius,
// a water tint overlay that intensifies with swimming depth, and an
// always-visible background music toggle. Talks to userSettings.js,
// saveSystem.js, voxelWorld.js, musicSystem.js, and gameBootstrap.js —
// never touches the original game files directly except by importing
// their already-exported classes.

import { initVoxelWorld } from "./voxelWorld.js";
import { initPlayerMovement } from "./Playermovement.js";
import { initMusicSystem } from "./Musicsystem.js";
import {
  loadSettings,
  saveSettings,
  applySettingsToConfig,
  labelForKeyCode,
} from "./Usersettings.js";
import { hasSave, createNewSave, continueSave } from "./savesystem.js";
import { startGame } from "./gamebootstrap.js";

export function initApp() {
  const canvas = document.getElementById("worldCanvas");
  const world = initVoxelWorld(canvas);
  world.setOrbiting(true);
  world.setMood("stable");

  // Reference to whichever GameEngine is currently running, so a fresh
  // beginPlay() can cleanly stop a leftover one from a previous run
  // (see beginPlay below) instead of leaving old input listeners and
  // ticks running underneath the new session.
  let activeEngine = null;

  let settings = loadSettings();
  applySettingsToConfig(settings);
  world.setBrightness(settings.brightness);

  // ---- HUD elements needed before initPlayerMovement, since the
  // border-warning and water-overlay callbacks reference them directly ----
  const hudEl = document.getElementById("hud");
  const borderWarningEl = document.getElementById("borderWarning");
  const waterOverlayEl = document.getElementById("waterOverlay");

  // ================= BACKGROUND MUSIC =================
  // Fully original, generated live via Web Audio oscillators (see
  // musicSystem.js) — no audio files, no copyright concerns. Browsers
  // block audio until a user gesture happens, so if music was left on
  // from a previous session we start it on the player's first click or
  // keypress rather than trying (and failing) to autoplay immediately.
  const music = initMusicSystem();
  music.setVolume(settings.volume);

  const musicToggleBtn = document.getElementById("musicToggleBtn");
  function refreshMusicButton() {
    const on = music.isPlaying();
    musicToggleBtn.textContent = on ? "🎵 Music: On" : "🔇 Music: Off";
    musicToggleBtn.classList.toggle("playing", on);
  }
  refreshMusicButton();

  musicToggleBtn.addEventListener("click", () => {
    settings.musicEnabled = music.toggle();
    saveSettings(settings);
    refreshMusicButton();
  });

  if (settings.musicEnabled) {
    const unlockAudio = () => {
      music.start();
      refreshMusicButton();
    };
    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
  }

  // Movement is purely visual (walks the camera around the island) —
  // it does not touch breath/stability/power at all. settings.controls
  // is passed by reference, so remapping keys in the settings menu
  // takes effect immediately without re-creating this.
  //
  // The player can walk past ACCESS_RADIUS freely; onBorderWarning
  // fires with the seconds remaining (or null when safe/inside) so the
  // HUD can show a "go back inside" countdown instead of a hard wall.
  //
  // getWaterDepth lets the movement code detect swimming vs. walking;
  // onWaterStateChange reports the current depth each frame (0 on dry
  // land) so the HUD can fade in a blue tint proportional to how deep
  // the player currently is.
  const player = initPlayerMovement({
    canvas,
    camera: world.camera,
    getGroundHeight: world.getGroundHeight,
    getWaterDepth: world.getWaterDepth,
    center: world.CENTER,
    controls: settings.controls,
    spawnSplash: world.spawnSplash,
    onBorderWarning(secondsLeft) {
      if (secondsLeft === null) {
        borderWarningEl.classList.remove("show");
        return;
      }
      borderWarningEl.textContent = `Go back inside the border! ${secondsLeft.toFixed(1)}s`;
      borderWarningEl.classList.add("show");
    },
    onWaterStateChange(depth) {
      // depth is 0 on dry land; opacity scales with how deep the water
      // is, capped so the overlay never becomes fully opaque/blinding.
      const intensity = Math.min(1, depth / 3);
      waterOverlayEl.style.opacity = intensity;
    },
  });

  // ---- screen elements ----
  const screens = {
    main: document.getElementById("mainMenu"),
    settings: document.getElementById("settingsMenu"),
  };

  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.add("hidden"));
    if (name) screens[name].classList.remove("hidden");
  }
  showScreen("main");

  // ================= MAIN MENU =================
  const newGameBtn = document.getElementById("newGameBtn");
  const continueBtn = document.getElementById("continueBtn");
  const settingsBtn = document.getElementById("settingsBtn");

  function refreshMainMenu() {
    const existingSave = hasSave();
    continueBtn.disabled = !existingSave;
    newGameBtn.classList.toggle("darkened", existingSave);
  }
  refreshMainMenu();

  newGameBtn.addEventListener("click", () => {
    if (hasSave()) {
      const ok = confirm("A previous session exists. Start a new game and overwrite it?");
      if (!ok) return;
    }
    createNewSave();
    beginPlay();
  });

  continueBtn.addEventListener("click", () => {
    if (!hasSave()) return;
    continueSave();
    beginPlay();
  });

  settingsBtn.addEventListener("click", () => showScreen("settings"));

  // ================= SETTINGS MENU =================
  const volumeSlider = document.getElementById("volumeSlider");
  const brightnessSlider = document.getElementById("brightnessSlider");
  const sensitivitySlider = document.getElementById("sensitivitySlider");
  const volumeVal = document.getElementById("volumeVal");
  const brightnessVal = document.getElementById("brightnessVal");
  const sensitivityVal = document.getElementById("sensitivityVal");
  const backFromSettingsBtn = document.getElementById("backFromSettingsBtn");
  const controlsGrid = document.getElementById("controlsGrid");

  volumeSlider.value = settings.volume;
  brightnessSlider.value = settings.brightness;
  sensitivitySlider.value = settings.sensitivity;
  volumeVal.textContent = settings.volume;
  brightnessVal.textContent = settings.brightness;
  sensitivityVal.textContent = settings.sensitivity;

  function persistAndApply() {
    saveSettings(settings);
    applySettingsToConfig(settings);
    world.setBrightness(settings.brightness);
    music.setVolume(settings.volume);
  }

  volumeSlider.addEventListener("input", (e) => {
    settings.volume = Number(e.target.value);
    volumeVal.textContent = settings.volume;
    persistAndApply();
  });
  brightnessSlider.addEventListener("input", (e) => {
    settings.brightness = Number(e.target.value);
    brightnessVal.textContent = settings.brightness;
    persistAndApply();
  });
  sensitivitySlider.addEventListener("input", (e) => {
    settings.sensitivity = Number(e.target.value);
    sensitivityVal.textContent = settings.sensitivity;
    persistAndApply();
  });

  backFromSettingsBtn.addEventListener("click", () => showScreen("main"));

  // ---- controls remapping ----
  const CONTROL_ACTIONS = [
    ["moveForward", "Move Forward"],
    ["moveBackward", "Move Backward"],
    ["moveLeft", "Move Left"],
    ["moveRight", "Move Right"],
    ["jump", "Jump"],
    ["crouch", "Crouch"],
  ];

  function renderControls() {
    controlsGrid.innerHTML = "";
    CONTROL_ACTIONS.forEach(([key, label]) => {
      const name = document.createElement("div");
      name.className = "action-name";
      name.textContent = label;

      const btn = document.createElement("button");
      btn.className = "keybind-btn";
      btn.textContent = labelForKeyCode(settings.controls[key]);
      btn.addEventListener("click", () => startListeningForKey(btn, key));

      controlsGrid.appendChild(name);
      controlsGrid.appendChild(btn);
    });
  }

  function startListeningForKey(btn, actionKey) {
    btn.textContent = "Press a key…";
    btn.classList.add("listening");

    function onKey(e) {
      e.preventDefault();
      settings.controls[actionKey] = e.code;
      btn.textContent = labelForKeyCode(e.code);
      btn.classList.remove("listening");
      window.removeEventListener("keydown", onKey, true);
      persistAndApply();
    }
    window.addEventListener("keydown", onKey, true);
  }

  renderControls();

  // ================= GAMEPLAY / HUD =================
  const stabilityValueEl = document.getElementById("stabilityValue");
  const stabilityFillEl = document.getElementById("stabilityFill");
  const powerValueEl = document.getElementById("powerValue");
  const powerFillEl = document.getElementById("powerFill");
  const breathStateEl = document.getElementById("breathStateValue");
  const zoneBanner = document.getElementById("zoneBanner");
  const inputBanner = document.getElementById("inputBanner");
  const winBanner = document.getElementById("winBanner");
  const winBannerText = document.getElementById("winBannerText");
  const failBanner = document.getElementById("failBanner");
  const failBannerText = document.getElementById("failBannerText");
  const pauseBanner = document.getElementById("pauseBanner");
  const lightningFlash = document.getElementById("lightningFlash");
  const inputModeEl = document.getElementById("inputModeValue");

  let zoneBannerTimeout = null;
  let inputBannerTimeout = null;

  const hud = {
    update({ breath, stability, power }) {
      stabilityValueEl.textContent = stability.value.toFixed(0);
      stabilityFillEl.style.width = stability.value + "%";
      powerValueEl.textContent = power;
      powerFillEl.style.width = power + "%";
      breathStateEl.textContent = breath.state;

      const dangerZone = stability.zone === "chaotic";
      stabilityFillEl.style.background = dangerZone ? "var(--danger)" : "var(--accent)";
    },
    flashZoneChange(from, to) {
      zoneBanner.textContent = `WORLD SHIFTING: ${from.toUpperCase()} → ${to.toUpperCase()}`;
      zoneBanner.classList.add("show");
      clearTimeout(zoneBannerTimeout);
      zoneBannerTimeout = setTimeout(() => zoneBanner.classList.remove("show"), 2200);
    },
    // Shows a short instructional/status message about breath INPUT
    // itself - e.g. reminding the player to breathe through their mouth
    // into the mic, or telling them the game switched to keyboard
    // because no real mouth-breathing was detected. Pass persist:true
    // to keep it on screen instead of auto-fading (used for the
    // fallback notice, since that's an important, lasting change).
    flashInputMessage(text, { persist = false } = {}) {
      inputBanner.textContent = text;
      inputBanner.classList.add("show");
      clearTimeout(inputBannerTimeout);
      if (!persist) {
        inputBannerTimeout = setTimeout(() => inputBanner.classList.remove("show"), 6000);
      }
    },
    showWin(heldDurationMs) {
      winBannerText.textContent = `Stabilized the world and found the treasure! (held maximum power for ${(heldDurationMs / 1000).toFixed(1)}s)`;
      winBanner.classList.add("show");
      // The persistent "go find the treasure" hint is no longer useful
      // once it's actually been found.
      clearTimeout(inputBannerTimeout);
      inputBanner.classList.remove("show");
    },
    showFail(reason) {
      failBannerText.textContent =
        reason === "treasure-hunt-broken"
          ? "You failed to maintain a calm breathing stage while finding the treasure. Do it all over again."
          : "You failed to meditate properly. Your world collapsed.";
      failBanner.classList.add("show");
      // The persistent "go find the treasure, stay calm" hint is no
      // longer relevant once the run has ended.
      clearTimeout(inputBannerTimeout);
      inputBanner.classList.remove("show");
    },
    flashLightning() {
      // Restart the CSS animation even if a previous flash is still
      // fading out, so rapid successive strikes each get their own
      // visible flash instead of the class-toggle being a no-op.
      lightningFlash.classList.remove("flash");
      // Force a reflow so the browser registers the class removal
      // before we re-add it - otherwise removing+re-adding in the same
      // tick is collapsed into nothing happening.
      void lightningFlash.offsetWidth;
      lightningFlash.classList.add("flash");
    },
    setInputMode(mode) {
      if (mode === "mic") inputModeEl.textContent = "Microphone";
      else if (mode === "keyboard") inputModeEl.textContent = "Keyboard (press B)";
      else inputModeEl.textContent = "Mic or Keyboard";
    },
  };

  async function beginPlay() {
    // A leftover engine from a previous run (e.g. pressing "Try Again"
    // after a fail) would otherwise keep its own tick loop and input
    // listeners running underneath this new one - stop it cleanly first.
    if (activeEngine) {
      activeEngine.stop();
      activeEngine = null;
    }

    showScreen(null);
    hudEl.classList.add("active");
    world.setOrbiting(false);
    player.enable();
    winBanner.classList.remove("show");
    failBanner.classList.remove("show");
    pauseBanner.classList.remove("show");
    borderWarningEl.classList.remove("show");
    inputBanner.classList.remove("show");
    waterOverlayEl.style.opacity = 0;
    try {
      activeEngine = await startGame({ world, hud });
    } catch (err) {
      console.error("Failed to start game:", err);
      alert("Could not start the game (check console for details).");
      activeEngine = null;
      returnToMenu();
    }
  }

  function returnToMenu() {
    hudEl.classList.remove("active");
    pauseBanner.classList.remove("show");
    player.disable();
    world.setOrbiting(true);
    world.setMood("stable");
    borderWarningEl.classList.remove("show");
    inputBanner.classList.remove("show");
    waterOverlayEl.style.opacity = 0;
    refreshMainMenu();
    showScreen("main");
  }

  document.getElementById("tryAgainBtn").addEventListener("click", () => {
    // The engine that triggered this fail screen has already stopped
    // itself (see gameLoop.js's hard-failure check), so this just needs
    // to kick off a completely fresh run - same flow as starting a new
    // game, without forcing the player back through the main menu.
    failBanner.classList.remove("show");
    beginPlay();
  });

  document.getElementById("failMainMenuBtn").addEventListener("click", () => {
    // Same situation as tryAgainBtn - the engine has already stopped
    // itself by the time the fail screen shows, but clear our reference
    // defensively before heading back to the menu.
    failBanner.classList.remove("show");
    if (activeEngine) {
      activeEngine.stop();
      activeEngine = null;
    }
    returnToMenu();
  });

  document.getElementById("escToMenuBtn").addEventListener("click", () => {
    if (activeEngine) {
      activeEngine.stop();
      activeEngine = null;
    }
    returnToMenu();
  });

  // ================= PAUSE MENU (Escape) =================
  // Only meaningful mid-session: gameplay must be active, and neither
  // the win nor fail banner (which already have their own "what next"
  // buttons) can be showing.
  function canTogglePause() {
    return (
      hudEl.classList.contains("active") &&
      !winBanner.classList.contains("show") &&
      !failBanner.classList.contains("show")
    );
  }

  function openPauseMenu() {
    if (!canTogglePause() || pauseBanner.classList.contains("show")) return;
    if (activeEngine) activeEngine.pause();
    player.pause();
    pauseBanner.classList.add("show");
  }

  function closePauseMenu() {
    if (!pauseBanner.classList.contains("show")) return;
    pauseBanner.classList.remove("show");
    player.resume();
    if (activeEngine) activeEngine.resume();
  }

  window.addEventListener("keydown", (e) => {
    if (e.code !== "Escape" || !canTogglePause()) return;
    if (pauseBanner.classList.contains("show")) {
      closePauseMenu();
    } else {
      openPauseMenu();
    }
  });

  document.getElementById("pauseContinueBtn").addEventListener("click", () => {
    closePauseMenu();
  });

  document.getElementById("pauseRestartBtn").addEventListener("click", () => {
    // beginPlay() stops the current engine and re-enables the player
    // itself, so there's no need to call player.resume()/engine.resume()
    // on the way out - it's a full fresh run, not an un-pause.
    pauseBanner.classList.remove("show");
    beginPlay();
  });

  document.getElementById("pauseMainMenuBtn").addEventListener("click", () => {
    pauseBanner.classList.remove("show");
    if (activeEngine) {
      activeEngine.stop();
      activeEngine = null;
    }
    returnToMenu();
  });
}