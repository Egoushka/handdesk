import type { Ray, Vec3 } from "./gesture/types";

/** A Mac display floating in space. Faces +z locally (towards the viewer) before yaw is applied. */
export interface Panel {
  /** index into the agent's display list */
  display: number;
  /** set for a macOS window panel; display is then -2 */
  windowId?: number;
  center: Vec3;
  /** radians about the y axis */
  yaw: number;
  width: number;
  height: number;
  /** total horizontal arc in radians; 0 is flat. The surface curves towards the viewer. */
  curve: number;
}

export interface Hit { display: number; window?: number; x: number; y: number; t: number }

export function toLocal(p: Vec3, panel: Panel): Vec3 {
  const d = { x: p.x - panel.center.x, y: p.y - panel.center.y, z: p.z - panel.center.z };
  const c = Math.cos(-panel.yaw);
  const s = Math.sin(-panel.yaw);
  return { x: d.x * c + d.z * s, y: d.y, z: -d.x * s + d.z * c };
}

export function dirToLocal(d: Vec3, panel: Panel): Vec3 {
  const c = Math.cos(-panel.yaw);
  const s = Math.sin(-panel.yaw);
  return { x: d.x * c + d.z * s, y: d.y, z: -d.x * s + d.z * c };
}

function hit(panel: Panel, x: number, y: number, t: number): Hit {
  return panel.windowId === undefined ? { display: panel.display, x, y, t } : { display: panel.display, window: panel.windowId, x, y, t };
}

/** Where a ray meets the panel, as display coordinates 0..1 with a top-left origin; undefined on a miss. */
export function intersect(ray: Ray, panel: Panel): Hit | undefined {
  const o = toLocal(ray.origin, panel);
  const d = dirToLocal(ray.direction, panel);
  if (panel.curve < 1e-3) {
    if (d.z >= -1e-9 || o.z <= 0) return undefined;
    const t = -o.z / d.z;
    const x = o.x + t * d.x;
    const y = o.y + t * d.y;
    if (Math.abs(x) > panel.width / 2 || Math.abs(y) > panel.height / 2) return undefined;
    return hit(panel, x / panel.width + 0.5, 0.5 - y / panel.height, t);
  }
  const R = panel.width / panel.curve;
  // circle in the xz plane centred at (0, R) with radius R; the viewer is inside it
  const ox = o.x;
  const oz = o.z - R;
  const A = d.x * d.x + d.z * d.z;
  if (A < 1e-12) return undefined;
  const B = 2 * (ox * d.x + oz * d.z);
  const C = ox * ox + oz * oz - R * R;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return undefined;
  const sq = Math.sqrt(disc);
  const t = (-B + sq) / (2 * A);
  if (t <= 0) return undefined;
  const hx = o.x + t * d.x;
  const hz = o.z + t * d.z;
  const hy = o.y + t * d.y;
  const phi = Math.atan2(hx, R - hz);
  if (Math.abs(phi) > panel.curve / 2 || Math.abs(hy) > panel.height / 2 || R - hz <= 0) return undefined;
  return hit(panel, phi / panel.curve + 0.5, 0.5 - hy / panel.height, t);
}

/** The nearest panel the ray hits. */
export function pick(ray: Ray, panels: Panel[]): Hit | undefined {
  let best: Hit | undefined;
  for (const p of panels) {
    const h = intersect(ray, p);
    if (h && (!best || h.t < best.t)) best = h;
  }
  return best;
}

/** Apply a grab (see GestureEvent grab-move) to the panel as it was when the grab started. */
export function applyGrab(start: Panel, center: Vec3, scale: number, yaw: number): Panel {
  const s = Math.min(4, Math.max(0.25, scale));
  return {
    ...start,
    center: { x: start.center.x + center.x, y: start.center.y + center.y, z: start.center.z + center.z },
    yaw: start.yaw + yaw,
    width: start.width * s,
    height: start.height * s,
  };
}

export function pickPanel<P extends Panel>(ray: Ray, panels: P[]): { panel: P; hit: Hit } | undefined {
  let best: { panel: P; hit: Hit } | undefined;
  for (const panel of panels) {
    const h = intersect(ray, panel);
    if (h && (!best || h.t < best.hit.t)) best = { panel, hit: h };
  }
  return best;
}

/** Local-frame coordinates of the point where the ray crosses the panel's flat plane (z = 0), ignoring bounds. */
export function planePoint(ray: Ray, panel: Panel): Vec3 | undefined {
  const o = toLocal(ray.origin, panel);
  const d = dirToLocal(ray.direction, panel);
  if (Math.abs(d.z) < 1e-9) return undefined;
  const t = -o.z / d.z;
  if (t <= 0) return undefined;
  return { x: o.x + t * d.x, y: o.y + t * d.y, z: 0 };
}
