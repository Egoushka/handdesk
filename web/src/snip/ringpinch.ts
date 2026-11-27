import { defaultGestureConfig } from "../gesture/config";
import { dist } from "../gesture/math";
import type { Hand, HandFrame, Ray } from "../gesture/types";

export type SnipPinchEvent =
  | { type: "snip-start"; hand: Hand; ray: Ray }
  | { type: "snip-move"; hand: Hand; ray: Ray }
  | { type: "snip-end"; hand: Hand; ray: Ray };

/**
 * The snip gesture: thumb to ring finger, index and middle held away. It cannot be mistaken for the other pinches
 * (index = click and drag, middle = right click, index + middle = scroll). While held, the hand's ray draws the rectangle.
 */
export class SnipPinch {
  private active = new Map<Hand, Ray>();

  /** true when this frame has the snip pinch (with hysteresis once held) */
  static isPinch(h: HandFrame, held: boolean): boolean {
    const t = h.joints["thumb-tip"], r = h.joints["ring-finger-tip"], i = h.joints["index-finger-tip"], m = h.joints["middle-finger-tip"];
    if (!t || !r || !i || !m) return false;
    const c = defaultGestureConfig;
    if (dist(t, r) > (held ? c.pinchOff : c.pinchOn)) return false;
    return dist(t, i) > 0.045 && dist(t, m) > 0.045;
  }

  /** hands currently holding the snip pinch: keep them out of the other gesture detectors */
  holding(): Set<Hand> { return new Set(this.active.keys()); }

  update(hands: HandFrame[]): SnipPinchEvent[] {
    const out: SnipPinchEvent[] = [];
    const seen = new Set<Hand>();
    for (const h of hands) {
      seen.add(h.hand);
      const held = this.active.has(h.hand);
      const on = SnipPinch.isPinch(h, held);
      const ray = h.ray ?? this.active.get(h.hand);
      if (on && ray) {
        this.active.set(h.hand, ray);
        out.push({ type: held ? "snip-move" : "snip-start", hand: h.hand, ray });
      } else if (held) {
        out.push({ type: "snip-end", hand: h.hand, ray: this.active.get(h.hand)! });
        this.active.delete(h.hand);
      }
    }
    for (const [hand, ray] of [...this.active]) if (!seen.has(hand)) { out.push({ type: "snip-end", hand, ray }); this.active.delete(hand); }
    return out;
  }
  reset(): void { this.active.clear(); }
}
