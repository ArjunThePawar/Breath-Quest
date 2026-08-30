// sessionSummary.js  (NEW FILE)
//
// Records a running history of world-stability values across a single
// play session, and renders that history as a small inline SVG line
// chart plus a few headline stats (duration, average/peak/lowest
// stability, calm vs panicked tick counts). Shown on the win/fail
// banners once a run ends, so a demo/judge sees actual data from the
// session that just happened, not just a pass/fail message.
//
// Pure DOM/SVG - no chart library, no canvas, no dependencies.

const MAX_POINTS = 400; // caps memory/rendering cost on very long sessions

// Creates a fresh recorder for one play session. Call start() the
// moment a run begins, record() on every tick, and getSummary() once
// it ends (win, fail, or manually stopped) to get the data to render.
export function createSessionRecorder() {
  let points = []; // { t: ms since session start, value: stability 0-100 }
  let panickedTicks = 0;
  let calmTicks = 0;
  let startTime = null;

  return {
    start() {
      points = [];
      panickedTicks = 0;
      calmTicks = 0;
      startTime = performance.now();
    },
    record(stabilityValue, breathState) {
      if (startTime === null) return; // start() was never called - ignore
      const t = performance.now() - startTime;
      points.push({ t, value: stabilityValue });

      // Downsample by dropping every other point once the cap is hit,
      // rather than truncating the front - this keeps the chart
      // spanning the WHOLE session (just at lower resolution) instead
      // of silently losing its earliest history on a long run.
      if (points.length > MAX_POINTS) {
        points = points.filter((_, i) => i % 2 === 0);
      }

      if (breathState === "panicked" || breathState === "erratic") panickedTicks++;
      if (breathState === "calm") calmTicks++;
    },
    getSummary() {
      const durationMs = startTime === null ? 0 : performance.now() - startTime;
      const values = points.map((p) => p.value);
      const avgStability = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      const peakStability = values.length ? Math.max(...values) : 0;
      const lowStability = values.length ? Math.min(...values) : 0;
      return {
        points,
        durationMs,
        avgStability,
        peakStability,
        lowStability,
        panickedTicks,
        calmTicks,
      };
    },
  };
}

// Renders the chart + stat rows into a container element. Safe to call
// repeatedly - it replaces the container's own content each time.
export function renderSessionSummary(containerEl, summary) {
  const { points, durationMs, avgStability, peakStability, lowStability, panickedTicks, calmTicks } = summary;

  const width = 320;
  const height = 90;
  const pad = 6;

  let pathD = "";
  if (points.length > 1) {
    const maxT = points[points.length - 1].t || 1;
    const toXY = (p) => {
      const x = pad + (p.t / maxT) * (width - pad * 2);
      const y = height - pad - (p.value / 100) * (height - pad * 2);
      return [x, y];
    };
    pathD = points
      .map((p, i) => {
        const [x, y] = toXY(p);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const mm = Math.floor(totalSeconds / 60);
  const ss = String(totalSeconds % 60).padStart(2, "0");

  containerEl.innerHTML = `
    <svg class="summary-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="summary-chart-axis"></line>
      ${pathD ? `<path d="${pathD}" class="summary-chart-line" fill="none"></path>` : ""}
    </svg>
    <div class="summary-stats">
      <div class="summary-stat"><span>Duration</span><strong>${mm}:${ss}</strong></div>
      <div class="summary-stat"><span>Avg Stability</span><strong>${avgStability.toFixed(0)}%</strong></div>
      <div class="summary-stat"><span>Peak</span><strong>${peakStability.toFixed(0)}%</strong></div>
      <div class="summary-stat"><span>Lowest</span><strong>${lowStability.toFixed(0)}%</strong></div>
      <div class="summary-stat"><span>Calm ticks</span><strong>${calmTicks}</strong></div>
      <div class="summary-stat"><span>Panicked ticks</span><strong>${panickedTicks}</strong></div>
    </div>
  `;
}