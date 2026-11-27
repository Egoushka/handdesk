import { defaultGestureConfig } from "../gesture/config";
import { dist } from "../gesture/math";
import type { HandFrame, JointName } from "../gesture/types";

const chain = (...n: JointName[]): [JointName, JointName][] => n.slice(1).map((b, i) => [n[i]!, b] as [JointName, JointName]);

/** Bones of the WebXR hand skeleton: every joint is connected, 25 joints, 24 bones plus the palm arch. */
export const BONES: [JointName, JointName][] = [
  ...chain("wrist", "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"),
  ...chain("wrist", "index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip"),
  ...chain("wrist", "middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip"),
  ...chain("wrist", "ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip"),
  ...chain("wrist", "pinky-finger-metacarpal", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip"),
  ["index-finger-metacarpal", "middle-finger-metacarpal"],
  ["middle-finger-metacarpal", "ring-finger-metacarpal"],
  ["ring-finger-metacarpal", "pinky-finger-metacarpal"],
];

/** 0 when the thumb and index tips are 8 cm apart or more, 1 when they touch (the pinch threshold). */
export function pinchStrength(h: HandFrame): number {
  const a = h.joints["thumb-tip"];
  const b = h.joints["index-finger-tip"];
  if (!a || !b) return 0;
  const open = 0.08;
  const on = defaultGestureConfig.pinchOn;
  return Math.min(1, Math.max(0, (open - dist(a, b)) / (open - on)));
}

/** "Hands not tracked" after no hand for lostMs; clears when a hand returns. */
export class TrackingState {
  lost = false;
  private lastSeen: number | undefined;
  private first: number | undefined;
  constructor(private readonly lostMs = 600) {}

  /** Returns "lost" or "restored" on the frame the state changes. */
  update(time: number, hands: number): "lost" | "restored" | undefined {
    this.first ??= time;
    if (hands > 0) {
      this.lastSeen = time;
      if (this.lost) { this.lost = false; return "restored"; }
      return undefined;
    }
    if (!this.lost && time - (this.lastSeen ?? this.first) >= this.lostMs) { this.lost = true; return "lost"; }
    return undefined;
  }
}
