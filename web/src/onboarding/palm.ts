import { isExtended } from "../gesture/features";
import { defaultGestureConfig, type GestureConfig } from "../gesture/config";
import { norm, sub, v } from "../gesture/math";
import type { HandFrame, Vec3 } from "../gesture/types";

const cross = (a: Vec3, b: Vec3): Vec3 => v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);

/** Unit vector pointing out of the palm, or undefined without the joints. */
export function palmNormal(h: HandFrame): Vec3 | undefined {
  const w = h.joints.wrist;
  const i = h.joints["index-finger-metacarpal"];
  const p = h.joints["pinky-finger-metacarpal"];
  if (!w || !i || !p) return undefined;
  const c = norm(cross(sub(i, w), sub(p, w)));
  // for a left hand held palm down the index side is +x and the cross points up (out of the back of the hand)
  return h.hand === "left" ? v(-c.x, -c.y, -c.z) : c;
}

export function isPalmUp(h: HandFrame, cfg: GestureConfig = defaultGestureConfig): boolean {
  const n = palmNormal(h);
  if (!n || n.y < 0.75) return false;
  const open = (["index", "middle", "ring"] as const).filter((f) => isExtended(h, f, cfg)).length;
  return open >= 3;
}

/** The left palm facing up for holdMs opens the menu; it closes the moment the palm turns away. */
export class PalmMenuDetector {
  private since: number | undefined;
  open = false;
  constructor(private readonly holdMs = 400, private readonly cfg: GestureConfig = defaultGestureConfig) {}

  update(time: number, hands: HandFrame[]): boolean {
    const left = hands.find((h) => h.hand === "left");
    if (left && isPalmUp(left, this.cfg)) {
      this.since ??= time;
      if (time - this.since >= this.holdMs) this.open = true;
    } else {
      this.since = undefined;
      this.open = false;
    }
    return this.open;
  }
}

const KEY = "handdesk.intro.done";
export interface Store { getItem(k: string): string | null; setItem(k: string, val: string): void }
export const introDone = (s: Store): boolean => s.getItem(KEY) === "1";
export const markIntroDone = (s: Store): void => s.setItem(KEY, "1");
