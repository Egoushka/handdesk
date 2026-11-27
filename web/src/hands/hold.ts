import type { Hand } from "../gesture/types";

export interface Held<T> { frame: T; alpha: number }

/**
 * Keeps a hand drawn through tracking dropouts: the last pose is held for `holdMs`, then fades out over `fadeMs`.
 * A returning hand fades in over `inMs`. A short flicker therefore never blinks the hand.
 */
export class PoseHold<T extends { hand: Hand }> {
  private last = new Map<Hand, { frame: T; seen: number; born: number }>();
  constructor(readonly holdMs = 300, readonly fadeMs = 200, readonly inMs = 100) {}

  update(time: number, hands: T[]): Held<T>[] {
    for (const h of hands) {
      const prev = this.last.get(h.hand);
      // a hand gone for longer than hold+fade is new again
      const born = prev && time - prev.seen <= this.holdMs + this.fadeMs ? prev.born : time;
      this.last.set(h.hand, { frame: h, seen: time, born });
    }
    const out: Held<T>[] = [];
    for (const [side, s] of [...this.last]) {
      const age = time - s.seen;
      if (age > this.holdMs + this.fadeMs) { this.last.delete(side); continue; }
      const out1 = age <= this.holdMs ? 1 : 1 - (age - this.holdMs) / this.fadeMs;
      const in1 = this.inMs <= 0 ? 1 : Math.min(1, Math.max(0, (time - s.born) / this.inMs));
      out.push({ frame: s.frame, alpha: Math.max(0.0, Math.min(out1, Math.max(in1, 0.001))) });
    }
    return out;
  }
}
