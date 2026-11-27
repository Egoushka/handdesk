import type { Vec3 } from "../gesture/types";
import { dist, norm, sub } from "../gesture/math";
import { toLocal, type Panel } from "../panel";

/** Depth towards the viewer of the panel's surface at local x (0 for a flat panel). */
export function surfaceSag(p: Panel, x: number): number {
  if (p.curve < 1e-3) return 0;
  const R = p.width / p.curve;
  return R * (1 - Math.cos(Math.asin(Math.max(-1, Math.min(1, x / R)))));
}

/** Panel uv (0..1, top-left origin, the same convention as a hit) for a local x, y. */
export function localToUv(p: Panel, x: number, y: number): { u: number; v: number } {
  const u = p.curve < 1e-3 ? x / p.width + 0.5 : Math.asin(Math.max(-1, Math.min(1, x / (p.width / p.curve)))) / p.curve + 0.5;
  return { u, v: 0.5 - y / p.height };
}

/** World position and yaw of the surface at uv, lifted `lift` metres towards the viewer along the local normal. */
export function panelPoint(p: Panel, u: number, v: number, lift = 0): { pos: Vec3; yaw: number } {
  const phi = (u - 0.5) * p.curve;
  const R = p.curve < 1e-3 ? 0 : p.width / p.curve;
  const lx = R ? R * Math.sin(phi) : (u - 0.5) * p.width;
  const lz = R ? R * (1 - Math.cos(phi)) : 0;
  const ly = (0.5 - v) * p.height;
  // the normal at a curved point is turned by -phi about y; for a flat panel phi is 0
  const nx = -Math.sin(phi) * lift, nz = Math.cos(phi) * lift;
  const yaw = p.yaw - phi;
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  const x = lx + (R ? nx : 0), z = lz + nz;
  return { pos: { x: p.center.x + x * c + z * s, y: p.center.y + ly, z: p.center.z - x * s + z * c }, yaw };
}

/** Where a world point is relative to the panel surface: uv and distance in front (positive towards the viewer). */
export function probeSurface(point: Vec3, p: Panel): { u: number; v: number; d: number } {
  const l = toLocal(point, p);
  const { u, v } = localToUv(p, l.x, l.y);
  return { u, v, d: l.z - surfaceSag(p, l.x) };
}

/** Spawn distance and size for every panel (m): about 1.4 m away at eye height, 1.3 m wide. */
export const SPAWN_DISTANCE = 1.4;
export const SPAWN_WIDTH = 1.3;
export const MIN_DISTANCE = 0.6;
export const MAX_DISTANCE = 4;
export const DISTANCE_STEP = 0.2;

/** A point on the panel surface (x, y in 0..1, top-left origin) lifted off it along the surface normal, with the yaw the surface faces. */
export function surfaceAt(p: Panel, x: number, y: number, lift = 0): { pos: Vec3; yaw: number } {
  const lx0 = (x - 0.5) * p.width;
  const ly = (0.5 - y) * p.height;
  let lx = lx0, lz = 0, phi = 0;
  if (p.curve >= 1e-3) {
    const R = p.width / p.curve;
    phi = (x - 0.5) * p.curve;
    lx = R * Math.sin(phi);
    lz = R * (1 - Math.cos(phi));
  }
  lx += -Math.sin(phi) * lift;
  lz += Math.cos(phi) * lift;
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return { pos: { x: p.center.x + lx * c + lz * s, y: p.center.y + ly, z: p.center.z - lx * s + lz * c }, yaw: p.yaw - phi };
}

/** Closed loop around the panel edge, `n` points per side, `grow` is the fraction the loop is scaled up by. */
export function panelOutline(p: Panel, n = 16, lift = 0.004, grow = 0): Vec3[] {
  const out: Vec3[] = [];
  const at = (x: number, y: number): Vec3 => surfaceAt(p, 0.5 + (x - 0.5) * (1 + grow), 0.5 + (y - 0.5) * (1 + grow), lift).pos;
  for (let i = 0; i < n; i++) out.push(at(i / n, 0));
  for (let i = 0; i < n; i++) out.push(at(1, i / n));
  for (let i = 0; i < n; i++) out.push(at(1 - i / n, 1));
  for (let i = 0; i < n; i++) out.push(at(0, 1 - i / n));
  return out;
}

export const headDistance = (p: Panel, head: Vec3): number => dist(p.center, head);

/** The panel moved along the line from the head to its centre so it is `d` metres away (clamped). Size is kept. */
export function withDistance(p: Panel, head: Vec3, d: number): Panel {
  const dir = norm(sub(p.center, head));
  const nd = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, d));
  return { ...p, center: { x: head.x + dir.x * nd, y: head.y + dir.y * nd, z: head.z + dir.z * nd } };
}

/** Pinch-pull: the hand moved from `d0` to `d` metres from the head; pulling it in brings the panel in by the same factor, amplified. */
export function pulledDistance(startDistance: number, d0: number, d: number, gain = 3): number {
  if (d0 < 1e-3) return startDistance;
  const f = 1 + (d / d0 - 1) * gain;
  return Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, startDistance * Math.max(0.2, f)));
}

/** The panel in front of the head at spawn distance and eye height, facing it; size and curve are kept. */
export function panelInFront(p: Panel, head: { position: Vec3; yaw: number }): Panel {
  return { ...p, center: { x: head.position.x + Math.sin(head.yaw) * SPAWN_DISTANCE, y: head.position.y, z: head.position.z - Math.cos(head.yaw) * SPAWN_DISTANCE }, yaw: -head.yaw };
}
