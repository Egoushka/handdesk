import { intersect, toLocal, type Panel } from "../panel";
import type { Vec3 } from "../gesture/types";
import { dist } from "../gesture/math";

export interface TouchConfig {
  /** hover dot shows within this distance in front of the surface */
  hover: number;
  /** pulling back past this releases */
  release: number;
  /** panels farther than this from the head are not touchable */
  reach: number;
}
export const TOUCH: TouchConfig = { hover: 0.03, release: 0.008, reach: 0.7 };

export type TouchEvent<P extends Panel = Panel> = {
  type: "hover" | "down" | "move" | "up";
  id: string;
  panel: P;
  /** display coordinates, 0..1, top-left origin */
  x: number;
  y: number;
};

interface State { panel: Panel; down: boolean; armed: boolean }

/**
 * Fingertip touch on a panel, like a touchscreen. A tip must come from in front (armed) and cross the surface to press;
 * staying while moving drags; pulling back releases.
 */
export class DirectTouch<P extends Panel = Panel> {
  private state = new Map<string, State>();
  constructor(private readonly cfg: TouchConfig = TOUCH) {}

  /** distance in front of the surface (positive in front) and the display coordinates under the tip, or undefined */
  private probe(tip: Vec3, panel: Panel): { d: number; x: number; y: number } | undefined {
    const local = toLocal(tip, panel);
    if (Math.abs(local.x) > panel.width / 2 + 0.05 || Math.abs(local.y) > panel.height / 2 + 0.05) return undefined;
    // a ray from 10 cm in front of the tip, straight into the panel in its own frame
    const back = 0.1;
    const originLocal = { x: local.x, y: local.y, z: local.z + back };
    const c = Math.cos(panel.yaw);
    const s = Math.sin(panel.yaw);
    const origin = {
      x: panel.center.x + originLocal.x * c + originLocal.z * s,
      y: panel.center.y + originLocal.y,
      z: panel.center.z - originLocal.x * s + originLocal.z * c,
    };
    const dir = { x: -s, y: 0, z: -c };
    const hit = intersect({ origin, direction: dir }, panel);
    if (!hit) return undefined;
    return { d: hit.t - back, x: hit.x, y: hit.y };
  }

  update(tips: { id: string; pos: Vec3 }[], panels: P[], head: Vec3): TouchEvent<P>[] {
    const out: TouchEvent<P>[] = [];
    const seen = new Set<string>();
    for (const tip of tips) {
      seen.add(tip.id);
      const st = this.state.get(tip.id);
      if (st?.down) {
        const p = st.panel as P;
        const r = this.probe(tip.pos, p);
        if (!r || r.d > this.cfg.release) {
          const pos = r ?? { x: 0, y: 0 };
          out.push({ type: "up", id: tip.id, panel: p, x: pos.x, y: pos.y });
          this.state.set(tip.id, { panel: p, down: false, armed: !!r && r.d > this.cfg.release });
        } else out.push({ type: "move", id: tip.id, panel: p, x: r.x, y: r.y });
        continue;
      }
      let best: { panel: P; d: number; x: number; y: number } | undefined;
      for (const panel of panels) {
        if (dist(panel.center, head) > this.cfg.reach + panel.width / 2) continue;
        const r = this.probe(tip.pos, panel);
        if (!r) continue;
        if (dist(tip.pos, head) > this.cfg.reach + 0.2) continue;
        if (!best || Math.abs(r.d) < Math.abs(best.d)) best = { panel, ...r };
      }
      if (!best) { this.state.delete(tip.id); continue; }
      const armed = st?.armed ?? false;
      if (best.d > 0 && best.d <= this.cfg.hover) {
        this.state.set(tip.id, { panel: best.panel, down: false, armed: true });
        out.push({ type: "hover", id: tip.id, panel: best.panel, x: best.x, y: best.y });
      } else if (best.d > this.cfg.hover) {
        this.state.set(tip.id, { panel: best.panel, down: false, armed: true });
      } else if (best.d <= 0 && armed) {
        this.state.set(tip.id, { panel: best.panel, down: true, armed: false });
        out.push({ type: "down", id: tip.id, panel: best.panel, x: best.x, y: best.y });
      } else {
        // behind the panel, or arrived through it: not armed until it is seen in front
        this.state.set(tip.id, { panel: best.panel, down: false, armed: false });
      }
    }
    for (const [id, st] of [...this.state]) {
      if (!seen.has(id)) {
        if (st.down) out.push({ type: "up", id, panel: st.panel as P, x: 0, y: 0 });
        this.state.delete(id);
      }
    }
    return out;
  }
}
