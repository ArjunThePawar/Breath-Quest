// breathingGuide.js  (NEW FILE)
//
// An optional, purely visual breathing pacer: a circle that expands
// over the first half of CALM_CYCLE_MS (inhale) and contracts over the
// second half (exhale), looping continuously with an eased (not
// linear) motion so it reads as an actual breath rather than a
// metronome tick. Useful for:
//   - anyone giving a live demo who doesn't want to actually breathe
//     into a mic for several minutes straight
//   - players who find free-form breathing hard to pace on their own
//     (a legitimate accessibility aid, not just a demo convenience)
//
// Pure DOM/CSS-transform animation - no canvas, no dependencies. Does
// NOT read or affect actual breath input in any way; it's guidance
// only, entirely decoupled from breathInput.js/gameLoop.js.

import { CONFIG } from "./config.js";

export function createBreathingGuide(circleEl, labelEl) {
  let rafId = null;
  let running = false;
  let startTime = 0;

  function loop(now) {
    if (!running) return;

    const elapsed = now - startTime;
    const half = CONFIG.CALM_CYCLE_MS / 2;
    const cyclePos = elapsed % CONFIG.CALM_CYCLE_MS;
    const inhaling = cyclePos < half;
    const phaseT = inhaling ? cyclePos / half : (cyclePos - half) / half;

    // Ease in/out (cosine easing) instead of linear, so the motion
    // slows at the top/bottom of each breath like a real inhale/exhale.
    const eased = 0.5 - 0.5 * Math.cos(phaseT * Math.PI);
    const scale = inhaling ? 0.6 + eased * 0.5 : 1.1 - eased * 0.5;

    circleEl.style.transform = `scale(${scale.toFixed(3)})`;
    labelEl.textContent = inhaling ? "Breathe in…" : "Breathe out…";

    rafId = requestAnimationFrame(loop);
  }

  return {
    start() {
      if (running) return;
      running = true;
      startTime = performance.now();
      rafId = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    },
    isRunning() {
      return running;
    },
  };
}