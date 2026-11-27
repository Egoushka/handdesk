/** The palm menu: hold the left palm up and the menu hovers above it; turn the palm away, or choose something, and it goes. */
export interface PalmMenuConfig { upY: number; awayY: number; holdMs: number; leaveMs: number }
export const PALM_MENU: PalmMenuConfig = { upY: 0.7, awayY: 0.3, holdMs: 220, leaveMs: 350 };

export class PalmMenu {
  open = false;
  private upSince: number | undefined;
  private awaySince: number | undefined;
  /** after a dismiss the palm has to turn away once before it can open again */
  private armed = true;
  constructor(private readonly cfg: PalmMenuConfig = PALM_MENU) {}

  /** `ny` is the world-up part of the palm normal (1 = palm facing the ceiling), or undefined when the left hand is not tracked. */
  update(time: number, ny: number | undefined): "open" | "close" | undefined {
    const c = this.cfg;
    if (ny === undefined || ny < c.awayY) {
      this.upSince = undefined;
      if (!this.open) { this.armed = true; this.awaySince = undefined; return undefined; }
      this.awaySince ??= time;
      if (time - this.awaySince >= c.leaveMs) { this.open = false; this.awaySince = undefined; this.armed = true; return "close"; }
      return undefined;
    }
    this.awaySince = undefined;
    if (this.open || !this.armed) return undefined;
    if (ny >= c.upY) {
      this.upSince ??= time;
      if (time - this.upSince >= c.holdMs) { this.open = true; this.upSince = undefined; return "open"; }
    } else this.upSince = undefined;
    return undefined;
  }
  /** Something was chosen, or the menu was opened some other way: close and wait for the palm to turn away. */
  dismiss(): void { this.open = false; this.armed = false; this.upSince = undefined; this.awaySince = undefined; }
  /** The menu was opened some other way (handle, controller): keep the palm from reopening it at once. */
  external(): void { this.open = false; this.armed = false; }
}

/** First-run nag rule: hints and notices stop for good after ten minutes without the menu being used. */
export const NAG_MS = 10 * 60 * 1000;
export class NagClock {
  private last: number;
  constructor(start: number) { this.last = start; }
  used(time: number): void { this.last = time; }
  quiet(time: number): boolean { return time - this.last > NAG_MS; }
}
