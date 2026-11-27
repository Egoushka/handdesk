import type { XRMode } from "./xr";

/**
 * requestSession options. Passthrough also asks for `depth-sensing`: three.js then draws the real world's depth first, so
 * your real hands (and desk) hide virtual panels behind them. Optional: a browser without it just shows no occlusion.
 */
export function sessionInit(mode: XRMode): XRSessionInit {
  const base: XRSessionInit = { requiredFeatures: ["local-floor"], optionalFeatures: ["hand-tracking"] };
  if (mode !== "immersive-ar") return base;
  return {
    ...base,
    optionalFeatures: ["hand-tracking", "depth-sensing"],
    depthSensing: { usagePreference: ["gpu-optimized", "cpu-optimized"], dataFormatPreference: ["luminance-alpha", "float32"] },
  } as XRSessionInit;
}
