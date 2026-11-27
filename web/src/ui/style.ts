/** The one look (D36): deep graphite glass, a single cool accent, warm only for warnings. Canvas px unless noted. */
export const PALETTE = {
  ink: "#0d1117",
  glass: "rgba(17,21,28,0.86)",
  raised: "rgba(255,255,255,0.07)",
  hairline: "rgba(255,255,255,0.14)",
  text: "#eef2f7",
  dim: "#a3afc0",
  accent: "#6cb8ff",
  accentSoft: "rgba(108,184,255,0.22)",
  accentInk: "#06223a",
  warn: "#ffb454",
  warnSoft: "rgba(255,180,84,0.20)",
} as const;
/** Type scale for 1.2 to 1.6 m: nothing below `caption`. */
export const TYPE = { caption: 46, body: 54, label: 56, title: 72, display: 88 } as const;
export const WEIGHT = { body: 500, label: 650, emphasis: 750 } as const;
export const RADIUS = { s: 24, m: 36, l: 56 } as const;
/** Motion: short eases only. */
export const MOTION = { fast: 150, base: 200, slow: 250 } as const;
export const easeOut = (k: number): number => 1 - (1 - Math.min(1, Math.max(0, k))) ** 3;
/** Exponential approach, frame-rate independent: how far `cur` moves to `target` in `dtMs` with time constant `ms`. */
export const approach = (cur: number, target: number, dtMs: number, ms: number = MOTION.fast): number => cur + (target - cur) * (1 - Math.exp(-dtMs / ms));
/** Depth in metres: how far each kind of thing rests in front of the main screen plane, and slab thickness. */
export const DEPTH = { screenSlab: 0.03, windowSlab: 0.022, snipSlab: 0.016, uiSlab: 0.012, button: 0.012, buttonHover: 0.024, buttonPressed: 0.004 } as const;
