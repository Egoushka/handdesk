import { isPalmUp, palmNormal } from "../onboarding/palm";
import type { HandFrame } from "../gesture/types";

export type Mode = "point" | "touch" | "trackpad" | "type" | "arrange" | "real";

export interface ModeInfo { id: Mode; label: string; hint: string }
export const MODES: ModeInfo[] = [
  { id: "point", label: "Point", hint: "aim with your hand, pinch to click" },
  { id: "touch", label: "Touch", hint: "poke a panel within reach" },
  { id: "trackpad", label: "Trackpad", hint: "right hand pinch-moves the cursor" },
  { id: "type", label: "Type", hint: "keyboard on, point to click" },
  { id: "arrange", label: "Arrange", hint: "move, resize, curve, pull panels" },
  { id: "real", label: "Real devices", hint: "your keyboard and mouse drive the Mac" },
];

/** What each mode lets the hands do. The classifier's raw pinch clicks never reach the Mac in any mode: the system select ray does that. */
export interface ModePolicy {
  /** the select ray clicks and drags on the Mac */
  ray: boolean;
  /** the right hand is an air trackpad */
  trackpad: boolean;
  /** poking a Mac panel with a fingertip */
  touch: boolean;
  keyboard: boolean;
  /** select moves panels, squeeze snaps one in front */
  arrange: boolean;
  /** scroll, zoom, swipe and the shortcut gestures */
  shortcuts: boolean;
}

export function policyOf(m: Mode): ModePolicy {
  return {
    ray: m === "point" || m === "type",
    trackpad: m === "trackpad",
    touch: m === "touch",
    keyboard: m === "type",
    arrange: m === "arrange" || m === "real",
    shortcuts: m === "point" || m === "type" || m === "touch" || m === "trackpad",
  };
}

export const modeInfo = (m: Mode): ModeInfo => MODES.find((x) => x.id === m)!;
export const nextMode = (m: Mode): Mode => MODES[(MODES.findIndex((x) => x.id === m) + 1) % MODES.length]!.id;
export const isMode = (s: unknown): s is Mode => MODES.some((m) => m.id === s);

const KEY = "handdesk.mode";
interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void }
export const loadMode = (s: Store): Mode => { const v = s.getItem(KEY); return isMode(v) ? v : "point"; };
export const saveMode = (s: Store, m: Mode): void => s.setItem(KEY, m);

/**
 * A quick wrist flip of the left hand (palm down, up, down again) changes mode. The palm has to stay up for less than the palm menu's hold time,
 * so a flip does not open the menu and holding the palm up still does.
 */
export class WristFlip {
  private state: "down" | "up" | "idle" = "idle";
  private upAt = 0;
  private cooldownUntil = 0;
  constructor(private readonly maxUpMs = 350, private readonly cooldownMs = 1000) {}

  update(time: number, hands: HandFrame[]): boolean {
    const left = hands.find((h) => h.hand === "left");
    const n = left && palmNormal(left);
    if (!left || !n) { this.state = "idle"; return false; }
    const up = n.y > 0.6 && isPalmUp(left);
    const down = n.y < -0.5;
    if (this.state === "idle") { if (down) this.state = "down"; return false; }
    if (this.state === "down") {
      if (up) { this.state = "up"; this.upAt = time; }
      return false;
    }
    // up
    if (time - this.upAt > this.maxUpMs) { this.state = up ? "idle" : down ? "down" : "idle"; return false; }
    if (down) {
      this.state = "down";
      if (time < this.cooldownUntil) return false;
      this.cooldownUntil = time + this.cooldownMs;
      return true;
    }
    return false;
  }
}
