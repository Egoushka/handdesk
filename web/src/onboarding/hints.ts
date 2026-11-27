import { extract, type PinchMemory } from "../gesture/features";
import { defaultGestureConfig, type GestureConfig } from "../gesture/config";
import { dist } from "../gesture/math";
import type { Hand, InputFrame, Vec3 } from "../gesture/types";

export interface Hint { hand: Hand; text: string; at: Vec3 }

type Key = "approach" | "pinch" | "three" | "magnify" | "other";
interface Track { key: Key; since: number; moved: number; palm: Vec3; aperture: number }

/** Short text near a hand that is part-way through a gesture. Dwell times keep it from flickering. */
export class HintTracker {
  private tracks = new Map<Hand, Track>();
  private mem = new Map<Hand, PinchMemory>();
  constructor(private readonly cfg: GestureConfig = defaultGestureConfig) {}

  update(frame: InputFrame): Hint | undefined {
    const t = frame.time;
    const keys = new Map<Hand, Key>();
    const palms = new Map<Hand, Vec3>();
    for (const h of frame.hands) {
      const m = this.mem.get(h.hand) ?? { index: false, middle: false };
      this.mem.set(h.hand, m);
      const f = extract(h, this.cfg, m);
      if (!f) continue;
      const gap = dist(h.joints["thumb-tip"]!, h.joints["index-finger-tip"]!);
      const key: Key =
        f.pose === "pinch" ? "pinch" : f.pose === "three" ? "three" : f.pose === "magnify" ? "magnify"
        : f.pose === "none" && gap > this.cfg.pinchOn && gap < this.cfg.pinchOff + 0.01 ? "approach" : "other";
      keys.set(h.hand, key);
      palms.set(h.hand, f.palm);
      const prev = this.tracks.get(h.hand);
      if (!prev || prev.key !== key) {
        this.tracks.set(h.hand, { key, since: t, moved: 0, palm: f.palm, aperture: f.aperture });
      } else {
        prev.moved = Math.max(prev.moved, dist(f.palm, prev.palm));
        if (Math.abs(f.aperture - prev.aperture) > 0.01) { prev.aperture = f.aperture; prev.since = t; }
      }
    }
    for (const h of [...this.tracks.keys()]) if (!keys.has(h)) this.tracks.delete(h);

    for (const [hand, tr] of this.tracks) {
      const dwell = t - tr.since;
      const at = palms.get(hand)!;
      if (tr.key === "approach" && dwell > 700 && tr.moved < 0.03) return { hand, text: "Close the pinch to click", at };
      if (tr.key === "three" && dwell > 800 && tr.moved < 0.03) return { hand, text: "Swipe 10 cm sideways or up", at };
      if (tr.key === "magnify" && dwell > 1500) return { hand, text: "Open or close the gap to zoom", at };
      if (tr.key === "pinch" && dwell > 1000 && tr.moved < 0.015) {
        const other = keys.get(hand === "left" ? "right" : "left");
        if (other === "other") return { hand, text: "Pinch with both hands to move the panel", at };
      }
    }
    return undefined;
  }
}
