// saveSystem.js  (NEW FILE)
//
// Tracks whether a game session has been started before, so the main
// menu can enable/disable "Continue" and darken "New Game" accordingly.
// Does not touch gameLoop.js — it just records session bookkeeping
// alongside it.
//
// Every localStorage call in this file is wrapped in try/catch (matching
// the pattern loadSave() already used). Some browsers/environments -
// private/incognito windows, storage explicitly disabled, a locked-down
// demo machine - throw on ANY localStorage access, not just on reads.
// Without these guards, something as simple as pressing "New Game" on
// such a machine would throw an uncaught exception and break the menu
// entirely, rather than just silently not persisting a save.

const SAVE_KEY = "breathQuest_save_v1";

export function hasSave() {
  try {
    return localStorage.getItem(SAVE_KEY) !== null;
  } catch {
    return false; // can't read storage - treat it as "no save", same as a fresh browser
  }
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Small internal helper so every write site shares the same guard
// instead of repeating try/catch around each one.
function safeWrite(save) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // Storage unavailable/full/blocked - nothing useful to do. The
    // session still plays fine; it just won't persist bestStability/
    // bestPower/hasWonBefore across reloads this time.
  }
  return save;
}

// Called when the player presses "New Game". Overwrites any existing save.
export function createNewSave() {
  const save = {
    createdAt: Date.now(),
    lastPlayedAt: Date.now(),
    timesPlayed: 1,
    bestStability: 0,
    bestPower: 0,
    hasWonBefore: false,
  };
  return safeWrite(save);
}

// Called when the player presses "Continue". Bumps play count but keeps
// existing best-stat history.
export function continueSave() {
  const save = loadSave();
  if (!save) return createNewSave();
  save.lastPlayedAt = Date.now();
  save.timesPlayed = (save.timesPlayed || 0) + 1;
  return safeWrite(save);
}

// Call periodically during play (e.g. on each "tick" event) to keep
// best-stat records up to date.
export function updateSaveStats({ stabilityValue, power, hasWon }) {
  const save = loadSave();
  if (!save) return;
  save.bestStability = Math.max(save.bestStability || 0, stabilityValue ?? 0);
  save.bestPower = Math.max(save.bestPower || 0, power ?? 0);
  if (hasWon) save.hasWonBefore = true;
  safeWrite(save);
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    // Storage unavailable - nothing to clear anyway.
  }
}