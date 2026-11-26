import type { Finger, Hand } from "../gesture/types";

export interface FingerTip {
  /** stable id, e.g. "right-index" */
  id: string;
  hand: Hand;
  finger: Finger;
  /** keyboard-plane coordinates, metres; h is height above the plane (negative = through it) */
  u: number;
  v: number;
  h: number;
}

export type PressEvent =
  | { type: "press"; id: string; hand: Hand; finger: Finger; u: number; v: number; speed: number; time: number }
  | { type: "release"; id: string; time: number };

export interface PressConfig {
  /** fingertip height at which a press registers */
  contactH: number;
  /** the fingertip must rise above this before it can press again */
  releaseH: number;
  /** minimum downward speed (m/s) over the lookback window */
  minSpeed: number;
  lookbackMs: number;
  refractoryMs: number;
  /** a press is ghost when another finger of the same hand moves down this many times faster */
  sympathyRatio: number;
}

/** Starting values (decision D10/D11). Joint height is the fingertip joint, so contact sits a few mm above the desk. */
export const SURFACE: PressConfig = { contactH: 0.012, releaseH: 0.025, minSpeed: 0.2, lookbackMs: 90, refractoryMs: 70, sympathyRatio: 2.5 };
export const POKE: PressConfig = { contactH: -0.01, releaseH: 0.01, minSpeed: 0.12, lookbackMs: 120, refractoryMs: 90, sympathyRatio: 2.5 };

const SYMPATHY_WINDOW_MS = 200;

interface Track {
  hand: Hand;
  finger: Finger;
  samples: { t: number; h: number }[];
  /** true while the finger is down (pressed, or arrived too slowly and is resting) */
  down: boolean;
  lastPress: number;
}

/**
 * Per-fingertip tap detection. A press is a fast downward move that ends at the plane: crossing the contact height
 * with enough downward speed. A finger that arrives slowly, or is already down, is resting and never types until it lifts.
 */
export class PressDetector {
  private tracks = new Map<string, Track>();
  private lastHandPress = new Map<Hand, { time: number; speed: number }>();
  constructor(public cfg: PressConfig = SURFACE) {}

  reset(): void { this.tracks.clear(); this.lastHandPress.clear(); }

  private speed(tr: Track, t: number): number {
    // largest downward speed between any pair of samples in the lookback window (m/s)
    let best = 0;
    const s = tr.samples;
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length; j++) {
        const dt = (s[j]!.t - s[i]!.t) / 1000;
        if (dt <= 0 || t - s[i]!.t > this.cfg.lookbackMs) continue;
        const v = (s[i]!.h - s[j]!.h) / dt;
        if (v > best) best = v;
      }
    }
    return best;
  }

  update(time: number, tips: FingerTip[]): PressEvent[] {
    const out: PressEvent[] = [];
    const seen = new Set<string>();
    const crossing: { tip: FingerTip; tr: Track; speed: number }[] = [];
    const speeds = new Map<string, number>();

    for (const tip of tips) {
      seen.add(tip.id);
      let tr = this.tracks.get(tip.id);
      if (!tr) {
        // first sight: a fingertip already at or under the plane is resting
        tr = { hand: tip.hand, finger: tip.finger, samples: [], down: tip.h <= this.cfg.contactH, lastPress: -Infinity };
        this.tracks.set(tip.id, tr);
      }
      tr.samples.push({ t: time, h: tip.h });
      while (tr.samples.length > 1 && time - tr.samples[0]!.t > this.cfg.lookbackMs) tr.samples.shift();
      const speed = this.speed(tr, time);
      speeds.set(tip.id, speed);

      if (tr.down) {
        if (tip.h >= this.cfg.releaseH) {
          tr.down = false;
          out.push({ type: "release", id: tip.id, time });
        }
        continue;
      }
      if (tip.h <= this.cfg.contactH) {
        tr.down = true;
        if (speed >= this.cfg.minSpeed && time - tr.lastPress >= this.cfg.refractoryMs) crossing.push({ tip, tr, speed });
      }
    }

    for (const c of crossing) {
      let dominated = false;
      for (const [id, s] of speeds) {
        if (id === c.tip.id) continue;
        const other = this.tracks.get(id);
        if (other && other.hand === c.tr.hand && s > c.speed * this.cfg.sympathyRatio) dominated = true;
      }
      const prev = this.lastHandPress.get(c.tr.hand);
      if (prev && time - prev.time <= SYMPATHY_WINDOW_MS && prev.speed > c.speed * this.cfg.sympathyRatio) dominated = true;
      if (dominated) continue;
      c.tr.lastPress = time;
      this.lastHandPress.set(c.tr.hand, { time, speed: c.speed });
      out.push({ type: "press", id: c.tip.id, hand: c.tr.hand, finger: c.tr.finger, u: c.tip.u, v: c.tip.v, speed: c.speed, time });
    }

    for (const id of [...this.tracks.keys()]) if (!seen.has(id)) this.tracks.delete(id);
    return out;
  }
}
