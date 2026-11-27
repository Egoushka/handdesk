import { dist } from "../gesture/math";
import type { Ray, Vec3 } from "../gesture/types";
import { planePoint, toLocal, type Panel } from "../panel";

export type HandleKind = "scale-tl" | "scale-tr" | "scale-bl" | "scale-br" | "move" | "curve";
export interface Handle { kind: HandleKind; pos: Vec3 }

/** Local-frame to world, the inverse of toLocal. */
export function toWorldPoint(l: Vec3, p: Panel): Vec3 {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  return { x: p.center.x + l.x * c + l.z * s, y: p.center.y + l.y, z: p.center.z - l.x * s + l.z * c };
}

/** Surface depth (towards the viewer) of a curved panel at local x. */
const sag = (p: Panel, x: number): number => {
  if (p.curve < 1e-3) return 0;
  const R = p.width / p.curve;
  return R * (1 - Math.cos(Math.asin(Math.max(-1, Math.min(1, x / R)))));
};

export function handlesOf(p: Panel): Handle[] {
  const hw = p.width / 2;
  const hh = p.height / 2;
  const at = (x: number, y: number): Vec3 => toWorldPoint({ x, y, z: sag(p, x) }, p);
  return [
    { kind: "scale-tl", pos: at(-hw, hh) },
    { kind: "scale-tr", pos: at(hw, hh) },
    { kind: "scale-bl", pos: at(-hw, -hh) },
    { kind: "scale-br", pos: at(hw, -hh) },
    { kind: "move", pos: at(0, hh + 0.06) },
    { kind: "curve", pos: at(0, -hh - 0.06) },
  ];
}

/** Distance from the point to the panel's bounding box (0 inside it), in the panel's own frame. */
export function distanceToPanel(point: Vec3, p: Panel): number {
  const l = toLocal(point, p);
  const dx = Math.max(Math.abs(l.x) - p.width / 2, 0);
  const dy = Math.max(Math.abs(l.y) - p.height / 2, 0);
  return Math.hypot(dx, dy, Math.max(Math.abs(l.z) - 0.02, 0));
}
export const handlesVisible = (point: Vec3, p: Panel, near = 0.3): boolean => distanceToPanel(point, p) <= near;

function rayPointDistance(r: Ray, pt: Vec3): number {
  const d = { x: pt.x - r.origin.x, y: pt.y - r.origin.y, z: pt.z - r.origin.z };
  const len = Math.hypot(r.direction.x, r.direction.y, r.direction.z) || 1;
  const t = (d.x * r.direction.x + d.y * r.direction.y + d.z * r.direction.z) / len;
  if (t <= 0) return Infinity;
  return Math.hypot(d.x - (r.direction.x / len) * t, d.y - (r.direction.y / len) * t, d.z - (r.direction.z / len) * t);
}

/** The handle a ray passes within `radius` of, nearest to the ray. */
export function pickHandle(ray: Ray, p: Panel, radius = 0.07): Handle | undefined {
  let best: Handle | undefined;
  let bestD = radius;
  for (const h of handlesOf(p)) {
    const d = rayPointDistance(ray, h.pos);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}

export const touchesHandle = (tip: Vec3, p: Panel, radius = 0.04): Handle | undefined => handlesOf(p).find((h) => dist(tip, h.pos) <= radius);

/**
 * Drag a handle: `from` and `to` are where the ray met the panel's flat plane at the start and now (local frame, see planePoint).
 * Scale keeps the aspect ratio and the opposite corner's side; curve follows horizontal motion; move translates in the panel's plane.
 */
export function dragHandle(start: Panel, kind: HandleKind, from: Vec3, to: Vec3): Panel {
  if (kind === "move") {
    const d = toWorldPoint({ x: to.x - from.x, y: to.y - from.y, z: 0 }, { ...start, center: { x: 0, y: 0, z: 0 } });
    return { ...start, center: { x: start.center.x + d.x, y: start.center.y + d.y, z: start.center.z + d.z } };
  }
  if (kind === "curve") {
    const dx = (to.x - from.x) / start.width;
    return { ...start, curve: Math.min(1.6, Math.max(0, start.curve + dx * 2)) };
  }
  const r0 = Math.hypot(from.x, from.y) || 1e-6;
  const r1 = Math.hypot(to.x, to.y);
  const s = Math.min(4, Math.max(0.25, r1 / r0));
  return { ...start, width: start.width * s, height: start.height * s };
}

export { planePoint };
