import { add, dot, norm, scale, sub, v } from "../gesture/math";
import type { HandFrame, Vec3 } from "../gesture/types";

/** The typing surface: origin on the plane at the keyboard centre, unit axes in viewer space. */
export interface TypingPlane {
  origin: Vec3;
  /** to the typist's right */
  uAxis: Vec3;
  /** away from the typist, along the plane */
  vAxis: Vec3;
  /** up out of the plane */
  normal: Vec3;
}

/** Fingertip joint to pad-contact offset used when calibrating from a flat hand (starting value). */
export const TIP_RADIUS = 0.008;

export function planeFromYaw(origin: Vec3, yaw: number): TypingPlane {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return { origin, uAxis: v(c, 0, -s), vAxis: v(-s, 0, -c), normal: v(0, 1, 0) };
}

/** Plane coordinates of a point: u, v along the surface, h above it. */
export function toPlane(p: Vec3, plane: TypingPlane): { u: number; v: number; h: number } {
  const d = sub(p, plane.origin);
  return { u: dot(d, plane.uAxis), v: dot(d, plane.vAxis), h: dot(d, plane.normal) };
}

export function fromPlane(u: number, vv: number, h: number, plane: TypingPlane): Vec3 {
  return add(plane.origin, add(scale(plane.uAxis, u), add(scale(plane.vAxis, vv), scale(plane.normal, h))));
}

/**
 * Calibration with a flat hand (or two) laid on the desk: the plane height is the lowest fingertip height minus the tip radius,
 * the keyboard faces the way the fingers point and is centred under the hands. Returns undefined without a usable hand.
 */
export function calibrateFromFlatHands(hands: HandFrame[]): TypingPlane | undefined {
  const tips: Vec3[] = [];
  const dirs: Vec3[] = [];
  const centres: Vec3[] = [];
  for (const h of hands) {
    const w = h.joints.wrist;
    const m = h.joints["middle-finger-tip"];
    if (!w || !m) continue;
    for (const n of ["index-finger-tip", "middle-finger-tip", "ring-finger-tip", "pinky-finger-tip"] as const) {
      const t = h.joints[n];
      if (t) tips.push(t);
    }
    const d = v(m.x - w.x, 0, m.z - w.z);
    if (Math.hypot(d.x, d.z) < 0.05) continue;
    dirs.push(norm(d));
    centres.push(v((w.x + m.x) / 2, 0, (w.z + m.z) / 2));
  }
  if (tips.length === 0 || dirs.length === 0) return undefined;
  const y = Math.min(...tips.map((t) => t.y)) - TIP_RADIUS;
  const dir = norm(dirs.reduce((a, b) => add(a, b), v()));
  const c = scale(centres.reduce((a, b) => add(a, b), v()), 1 / centres.length);
  // yaw 0 means keyboard "away" is -z
  const yaw = Math.atan2(-dir.x, -dir.z);
  return planeFromYaw(v(c.x, y, c.z), yaw);
}
