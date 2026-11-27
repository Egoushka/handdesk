import type { Vec3 } from "../gesture/types";
import type { Panel } from "../panel";
import { probeSurface } from "../space/surface";

export interface Shadow { panel: number; u: number; v: number; alpha: number; radius: number }

/** Soft shadows of points hovering in front of panels: nearest panel in range, darker and tighter when closer. */
export function hoverShadows(points: { pos: Vec3; size: number; weight?: number }[], panels: Panel[], range = 0.25): Shadow[] {
  const out: Shadow[] = [];
  for (const pt of points) {
    let best: Shadow | undefined;
    let bestD = range;
    panels.forEach((p, i) => {
      const s = probeSurface(pt.pos, p);
      if (s.d < 0 || s.d >= bestD || s.u < -0.02 || s.u > 1.02 || s.v < -0.02 || s.v > 1.02) return;
      bestD = s.d;
      best = { panel: i, u: s.u, v: s.v, alpha: 0.55 * (1 - s.d / range) * (pt.weight ?? 1), radius: pt.size * (1 + 5 * s.d) };
    });
    if (best) out.push(best);
  }
  return out;
}
