// menuController.js  (NEW FILE)
//
// Builds and wires up: main menu (New Game / Continue / Settings),
// the settings sub-menu (volume / brightness / sensitivity / controls),
// and the in-game HUD. Talks to userSettings.js, saveSystem.js,
// voxelWorld.js, and gameBootstrap.js — never touches your original
// game files directly except by importing their already-exported classes.

import { initVoxelWorld } from "./voxelWorld.js";
import { initPlayerMovement } from "./Playermovement.js";
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

  let settings = loadSettings();
  applySettingsToConfig(settings);
  world.setBrightness(settings.brightness);

  // Movement is purely visual (walks the camera around the accessible
  // island area) — it does not touch breath/stability/power at all.
  // settings.controls is passed by reference, so remapping keys in the
  // settings menu takes effect immediately without re-creating this.
  const player = initPlayerMovement({
    canvas,
    camera: world.camera,
    getGroundHeight: world.getGroundHeight,
    center: world.CENTER,
    controls: settings.controls,
  });

  // ---- screen elements ----
  const screens = {
    main: document.getElementById("mainMenu"),
    settings: document.getElementById("settingsMenu"),
  };
  const hudEl = document.getElementById("hud");

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
  const winBanner = document.getElementById("winBanner");
  const winBannerText = document.getElementById("winBannerText");
  const inputModeEl = document.getElementById("inputModeValue");

  let zoneBannerTimeout = null;

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
    showWin(heldDurationMs) {
      winBannerText.textContent = `Held maximum power for ${(heldDurationMs / 1000).toFixed(1)}s`;
      winBanner.classList.add("show");
    },
    setInputMode(mode) {
      inputModeEl.textContent = mode === "mic" ? "Microphone" : "Keyboard (hold SPACE)";
    },
  };

  async function beginPlay() {
    showScreen(null);
    hudEl.classList.add("active");
    world.setOrbiting(false);
    player.enable();
    winBanner.classList.remove("show");
    try {
      await startGame({ world, hud });
    } catch (err) {
      console.error("Failed to start game:", err);
      alert("Could not start the game (check console for details).");
      returnToMenu();
    }
  }

  function returnToMenu() {
    hudEl.classList.remove("active");
    player.disable();
    world.setOrbiting(true);
    world.setMood("stable");
    refreshMainMenu();
    showScreen("main");
  }

  document.getElementById("escToMenuBtn").addEventListener("click", () => {
    // Note: this does not stop the running GameEngine (no exposed handle
    // here) — for a full "pause/quit" flow, have gameBootstrap.startGame
    // return the engine instance and call engine.stop() before this.
    returnToMenu();
  });
}