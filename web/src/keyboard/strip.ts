import type { FingerTip } from "./press";

export interface Rect { u0: number; u1: number; v0: number; v1: number }

export interface StripConfig {
  /** fingertip must be this low above the plane while swiping */
  maxHeight: number;
  minDistance: number;
  maxMs: number;
  cooldownMs: number;
}
export const STRIP: StripConfig = { maxHeight: 0.03, minDistance: 0.06, maxMs: 350, cooldownMs: 400 };

/**
 * Swipe a fingertip across the suggestion strip, then lift or leave: the suggestion under the last point is accepted.
 * Returns the third (0..2) or undefined.
 */
export class StripSwipe {
  private tracks = new Map<string, { t0: number; u0: number; u: number; moved: boolean }>();
  private last = -Infinity;
  constructor(private readonly cfg: StripConfig = STRIP) {}

  update(time: number, tips: FingerTip[], rect: Rect): number | undefined {
    let hit: number | undefined;
    const inside = new Set<string>();
    for (const tip of tips) {
      if (!(tip.u >= rect.u0 && tip.u <= rect.u1 && tip.v >= rect.v0 && tip.v <= rect.v1 && tip.h <= this.cfg.maxHeight && tip.h > -0.05)) continue;
      inside.add(tip.id);
      let tr = this.tracks.get(tip.id);
      if (!tr || time - tr.t0 > this.cfg.maxMs) {
        tr = { t0: time, u0: tip.u, u: tip.u, moved: false };
        this.tracks.set(tip.id, tr);
      }
      tr.u = tip.u;
      if (Math.abs(tr.u - tr.u0) >= this.cfg.minDistance) tr.moved = true;
    }
    for (const [id, tr] of [...this.tracks]) {
      if (inside.has(id)) continue;
      this.tracks.delete(id);
      if (tr.moved && time - this.last >= this.cfg.cooldownMs) {
        this.last = time;
        const frac = (tr.u - rect.u0) / (rect.u1 - rect.u0);
        hit = Math.min(2, Math.max(0, Math.floor(frac * 3)));
      }
    }
    return hit;
  }
}
