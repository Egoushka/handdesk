import type { Vec3 } from "../gesture/types";
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
