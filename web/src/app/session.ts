import type { XRMode } from "./xr";

/**
 * requestSession options. Only when the hand mode is real, passthrough also asks for `depth-sensing`: three.js then draws the real world's depth first, so
 * your real hands (and desk) hide virtual panels behind them. Optional: a browser without it just shows no occlusion.
 */
export function sessionInit(mode: XRMode, realHands = false): XRSessionInit {
  const base: XRSessionInit = { requiredFeatures: ["local-floor"], optionalFeatures: ["hand-tracking"] };
  if (mode !== "immersive-ar" || !realHands) return base;
  return {
    ...base,
    optionalFeatures: ["hand-tracking", "depth-sensing"],
    depthSensing: { usagePreference: ["gpu-optimized", "cpu-optimized"], dataFormatPreference: ["luminance-alpha", "float32"] },
  } as XRSessionInit;
}

/** The on-screen line, and the agent log message, for a failed requestSession. Names the error: a SecurityError, NotSupportedError and a feature rejection need different fixes. */
export function startErrorText(mode: string, e: unknown): string {
  const err = e as { name?: string; message?: string } | undefined;
  const name = err?.name && err.name !== "Error" ? `${err.name}: ` : "";
  return `Could not start ${mode}: ${name}${err?.message || String(e)}`;
}
