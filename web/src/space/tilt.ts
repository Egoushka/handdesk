import type { Vec3 } from "../gesture/types";
/** A panel leans a little toward the head's height: above eye level its face tips down, below it tips up. Gentle (35 %) and capped at 9 degrees so text stays square. */
export const TILT_GAIN = 0.35;
export const TILT_MAX = (9 * Math.PI) / 180;
export function tiltToward(center: Vec3, head: Vec3): number {
  const d = Math.hypot(center.x - head.x, center.z - head.z) || 1;
  const a = Math.atan2(center.y - head.y, d) * TILT_GAIN;
  return Math.max(-TILT_MAX, Math.min(TILT_MAX, a));
}
/** The head position, updated each frame by the app; panels read it when they sync. */
export const headRef: Vec3 = { x: 0, y: 1.6, z: 0 };
