import type { Zone } from "./zones";

/** Most extra panels (window panels plus snips) at once; the main screen does not count. */
export const MAX_EXTRAS = 6;
export const canAddExtra = (count: number): boolean => count < MAX_EXTRAS;
export const LIMIT_TEXT = `Limit: ${MAX_EXTRAS} extra panels. Close one with its X, or use Close all extras in the menu.`;
export const ENTER_HINT = "Hold your left palm up for the menu";
export const PANIC_HOLD_MS = 1500;

/** True once, when `active` has been true for `ms` without a break; re-arms after it goes false. */
export class HoldOnce {
  private since: number | undefined;
  private fired = false;
  constructor(private readonly ms: number) {}
  update(t: number, active: boolean): boolean {
    if (!active) { this.since = undefined; this.fired = false; return false; }
    this.since ??= t;
    if (!this.fired && t - this.since >= this.ms) { this.fired = true; return true; }
    return false;
  }
  reset(): void { this.since = undefined; this.fired = false; }
}

/** A controller button: a short press is a "tap" (menu), a long hold is a "hold" (panic) and fires while still held. */
export class ButtonTapHold {
  private down: number | undefined;
  private held = false;
  constructor(private readonly holdMs = 800, private readonly tapMs = 500) {}
  update(t: number, pressed: boolean): "tap" | "hold" | undefined {
    if (pressed) {
      this.down ??= t;
      if (!this.held && t - this.down >= this.holdMs) { this.held = true; return "hold"; }
      return undefined;
    }
    const d = this.down, was = this.held;
    this.down = undefined; this.held = false;
    return d !== undefined && !was && t - d <= this.tapMs ? "tap" : undefined;
  }
}

export const BAR_PX_PER_M = 1739;
export const BAR_H = 150;
/** Title bar over a panel: the title, and a big labelled Close (or, on the main screen, Menu). */
export function barLayout(W: number, title: string, closable: boolean): Zone[] {
  const bw = 340;
  return [
    { id: "title", kind: "text", x: 28, y: 35, w: W - bw - 56, h: 80, label: title, size: 54 },
    closable
      ? { id: "x", kind: "button", x: W - bw - 12, y: 12, w: bw, h: BAR_H - 24, label: "Close", icon: "close", size: 60, danger: true }
      : { id: "menu", kind: "button", x: W - bw - 12, y: 12, w: bw, h: BAR_H - 24, label: "Menu", icon: "menu", size: 56, primary: true },
  ];
}

/** The small Menu handle on the main screen's frame (not on the body). */
export const HANDLE_M = 0.2;
export function handleLayout(W: number): Zone[] {
  return [{ id: "menu", kind: "button", x: 8, y: 8, w: W - 16, h: BAR_H - 16, label: "Menu", icon: "menu", size: 56 }];
}
