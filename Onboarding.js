// onboarding.js  (NEW FILE)
//
// Content and seen-state tracking for the first-launch explainer
// overlay ("breathe calm -> stability rises -> power -> treasure").
// The actual overlay UI/DOM lives in menuController.js + app.html/
// style.css - this file just owns the step content and the
// once-per-browser "have they seen it" flag, so that logic isn't
// tangled into the DOM-wiring code.

const SEEN_KEY = "breathQuest_onboardingSeen_v1";

export function hasSeenOnboarding() {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false; // localStorage unavailable (e.g. privacy mode) - just show it every time
  }
}

export function markOnboardingSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // ignore - nothing useful to do if storage isn't available
  }
}

// One short step per core mechanic, in the order a new player needs to
// learn them. Kept intentionally brief - this is a skimmable overlay,
// not documentation.
export const ONBOARDING_STEPS = [
  {
    title: "Breathe Calmly",
    text: "Breathe steadily through your mic, or press B on a steady rhythm if you'd rather use the keyboard. Either one works, any time.",
  },
  {
    title: "Stability Rises",
    text: "Calm breathing raises the world's stability. Panicked or erratic breathing - or staying silent too long - drains it instead.",
  },
  {
    title: "Power Follows Stability",
    text: "Your power scales directly with stability. Reach and hold maximum power to stabilize the world.",
  },
  {
    title: "Find the Treasure",
    text: "Stabilizing the world reveals a hidden treasure on the island. Walk to it while staying calm the whole way to actually win.",
  },
];