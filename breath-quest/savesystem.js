// saveSystem.js  (NEW FILE)
//
// Tracks whether a game session has been started before, so the main
// menu can enable/disable "Continue" and darken "New Game" accordingly.
// Does not touch gameLoop.js — it just records session bookkeeping
// alongside it.

const SAVE_KEY = "breathQuest_save_v1";

export function hasSave() {
  return localStorage.getItem(SAVE_KEY) !== null;
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
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
  localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  return save;
}

// Called when the player presses "Continue". Bumps play count but keeps
// existing best-stat history.
export function continueSave() {
  const save = loadSave();
  if (!save) return createNewSave();
  save.lastPlayedAt = Date.now();
  save.timesPlayed = (save.timesPlayed || 0) + 1;
  localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  return save;
}

// Call periodically during play (e.g. on each "tick" event) to keep
// best-stat records up to date.
export function updateSaveStats({ stabilityValue, power, hasWon }) {
  const save = loadSave();
  if (!save) return;
  save.bestStability = Math.max(save.bestStability || 0, stabilityValue ?? 0);
  save.bestPower = Math.max(save.bestPower || 0, power ?? 0);
  if (hasWon) save.hasWonBefore = true;
  localStorage.setItem(SAVE_KEY, JSON.stringify(save));
}

export function clearSave() {
  localStorage.removeItem(SAVE_KEY);
}