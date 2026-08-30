// userSettings.js  (NEW FILE — does not modify config.js, breathInput.js, etc.)
//
// Owns all player-adjustable settings: volume, brightness, sensitivity,
// music on/off, and key bindings. Settings are persisted to
// localStorage and, where relevant, applied to the existing CONFIG
// object at runtime by mutating its properties (CONFIG is a plain
// object, so this does not require editing config.js itself — it just
// overrides values before the game starts).

import { CONFIG } from "./config.js";

const STORAGE_KEY = "breathQuest_settings_v1";

// The ORIGINAL values from config.js, captured once before anything
// mutates them. Sliders always recalculate FROM these, so moving a
// slider back and forth never compounds/drifts.
const BASE = {
  ALARM_VOLUME: CONFIG.ALARM_VOLUME,
  MIC_PANIC_VOLUME_FRACTION: CONFIG.MIC_PANIC_VOLUME_FRACTION,
};

// Default control scheme. NOTE: these are NOT wired to any gameplay yet —
// your current backend (breathInput.js / gameLoop.js) has no movement,
// jump, or crouch system. This just captures and persists key bindings
// for whenever movement code is added.
export function getDefaultSettings() {
  return {
    volume: 50,        // 0-100, maps to CONFIG.ALARM_VOLUME and music volume
    brightness: 50,     // 0-100, maps to renderer exposure in voxelWorld.js
    sensitivity: 50,    // 0-100, maps to mic peak threshold / gap
    musicEnabled: true, // whether the ambient background music should play
    controls: {
      moveForward: "KeyW",
      moveBackward: "KeyS",
      moveLeft: "KeyA",
      moveRight: "KeyD",
      jump: "Space",        // Keyboard breath input now uses the B key
                             // (not Space), so jump no longer collides
                             // with it even when KeyboardBreathInput is active.
      crouch: "ShiftLeft",
    },
  };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return getDefaultSettings();
    const parsed = JSON.parse(raw);
    // Merge with defaults so new fields added later don't crash old saves.
    const defaults = getDefaultSettings();
    return {
      ...defaults,
      ...parsed,
      controls: { ...defaults.controls, ...(parsed.controls || {}) },
    };
  } catch (err) {
    console.warn("Failed to load settings, using defaults.", err);
    return getDefaultSettings();
  }
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// Applies the given settings to the live CONFIG object. Call this once
// at startup (after loading settings) and again any time a slider changes.
export function applySettingsToConfig(settings) {
  // Volume: 0-100 -> 0-0.3 (keeps the alarm from ever being ear-splitting)
  CONFIG.ALARM_VOLUME = (settings.volume / 100) * 0.3;

  // Sensitivity: 50 = baseline (uses config.js defaults exactly).
  // Higher sensitivity = a SMALLER fraction of the session's loudest
  // volume is enough to count as "panicked" (easier to trigger); lower
  // sensitivity requires a swing closer to the full observed peak.
  // Clamped so extreme slider positions can't make panicked either
  // permanently on (fraction near 0) or effectively unreachable
  // (fraction above 1).
  const sensitivityFactor = Math.max(0.2, settings.sensitivity / 50);
  CONFIG.MIC_PANIC_VOLUME_FRACTION = Math.min(
    1.0,
    Math.max(0.15, BASE.MIC_PANIC_VOLUME_FRACTION / sensitivityFactor)
  );

  // Brightness has no CONFIG equivalent — voxelWorld.js reads
  // settings.brightness directly, so nothing to mutate here.
  // musicEnabled is read directly by menuController.js — nothing to
  // mutate on CONFIG for it either.
}

// Human-readable labels for key codes, used by the controls UI.
export function labelForKeyCode(code) {
  if (!code) return "—";
  if (code.startsWith("Key")) return code.slice(3);
  if (code === "Space") return "SPACE";
  if (code === "ShiftLeft" || code === "ShiftRight") return "SHIFT";
  if (code === "ControlLeft" || code === "ControlRight") return "CTRL";
  return code.toUpperCase();
}