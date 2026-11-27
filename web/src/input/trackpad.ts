import type { Hand, Vec3 } from "../gesture/types";
import type { ClientMessage } from "../protocol";
import { buttonAt, moveTo, type Pick, type SelectEvent } from "./pointer";

/** Cursor travel per metre of hand travel, in panel widths: 0.35 m of hand crosses a 1.3 m panel. */
export const TRACKPAD_GAIN = 3;
export const SCROLL_PX_PER_M = 2200;
export const TAP_MS = 350;
export const TAP_METRES = 0.015;
export const HOLD_MS = 450;

export interface TrackpadTarget { key: string; display: number; window?: number; width: number; height: number }

export type TrackpadAction = { type: "send"; hand: Hand; messages: ClientMessage[]; gesture?: string; at?: Pick; ripple?: boolean };

interface Pinch { start: number; last: Vec3; travel: number; down: boolean }

/** One hand as an air trackpad: the right hand pinches to move the cursor (a short pinch taps, a still hold grabs), squeeze right-clicks, the left hand pinch scrolls. */
export class Trackpad {
  private cursor?: { target: TrackpadTarget; x: number; y: number };
  private right?: Pinch;
  private left?: { last: Vec3 };

  reset(): void { this.right = undefined; this.left = undefined; }

  /** True while the cursor hand is pinching: the cursor must not jump to another panel then. */
  get busy(): boolean { return !!this.right; }

  /** The cursor, for drawing. */
  get pick(): Pick | undefined {
    const c = this.cursor;
    return c && { key: c.target.key, display: c.target.display, window: c.target.window, x: c.x, y: c.y, width: c.target.width, height: c.target.height, t: 0 };
  }

  /** Put the cursor on a panel (the one last used) when it has none or its panel is gone. */
  retarget(t: TrackpadTarget | undefined): void {
    if (!t) { this.cursor = undefined; return; }
    if (this.cursor?.target.key === t.key) { this.cursor.target = t; return; }
    this.cursor = { target: t, x: 0.5, y: 0.5 };
  }

  update(time: number, tips: Partial<Record<Hand, Vec3>>, headYaw: number, events: SelectEvent[]): TrackpadAction[] {
    const out: TrackpadAction[] = [];
    const c = this.cursor;
    if (!c) return out;
    const pk = (): Pick => this.pick!;
    for (const e of events) {
      const tip = tips[e.hand];
      if (e.type === "selectstart" && tip) {
        if (e.hand === "right") this.right = { start: time, last: tip, travel: 0, down: false };
        else this.left = { last: tip };
      } else if (e.type === "selectend") {
        if (e.hand === "right" && this.right) {
          const p = this.right; this.right = undefined;
          if (p.down) out.push({ type: "send", hand: "right", messages: [buttonAt(pk(), "left", false)], gesture: "drag end", at: pk() });
          else if (time - p.start < TAP_MS && p.travel < TAP_METRES) out.push({ type: "send", hand: "right", messages: [moveTo(pk()), buttonAt(pk(), "left", true), buttonAt(pk(), "left", false)], gesture: "tap", at: pk(), ripple: true });
        } else if (e.hand === "left") this.left = undefined;
      } else if (e.type === "squeezestart" && e.hand === "right") {
        out.push({ type: "send", hand: "right", messages: [moveTo(pk()), buttonAt(pk(), "right", true), buttonAt(pk(), "right", false)], gesture: "right click", at: pk(), ripple: true });
      }
    }

    const r = this.right;
    const rt = tips.right;
    if (r && rt) {
      const dx = rt.x - r.last.x, dy = rt.y - r.last.y, dz = rt.z - r.last.z;
      r.last = rt;
      const side = dx * Math.cos(headYaw) + dz * Math.sin(headYaw);
      r.travel += Math.hypot(dx, dy, dz);
      const before = { x: c.x, y: c.y };
      c.x = Math.min(1, Math.max(0, c.x + (side * TRACKPAD_GAIN) / c.target.width));
      c.y = Math.min(1, Math.max(0, c.y - (dy * TRACKPAD_GAIN) / c.target.height));
      if (!r.down && r.travel < TAP_METRES && time - r.start >= HOLD_MS) {
        r.down = true;
        out.push({ type: "send", hand: "right", messages: [moveTo(pk()), buttonAt(pk(), "left", true)], gesture: "hold", at: pk() });
      } else if (c.x !== before.x || c.y !== before.y) out.push({ type: "send", hand: "right", messages: [moveTo(pk())], at: pk() });
    }
    const l = this.left;
    const lt = tips.left;
    if (l && lt) {
      const dy = lt.y - l.last.y;
      l.last = lt;
      const px = Math.round(-dy * SCROLL_PX_PER_M);
      if (px !== 0) out.push({ type: "send", hand: "left", messages: [{ type: "scroll", dx: 0, dy: px }], gesture: "scroll" });
    }
    return out;
  }
}
