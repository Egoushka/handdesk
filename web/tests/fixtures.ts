import { GestureClassifier } from "../src/gesture/classifier";
import type { ControllerFrame, GestureEvent, Hand, HandFrame, InputFrame, JointName, Ray, Vec3 } from "../src/gesture/types";

type State = "ext" | "curl";
const FINGER_X: Record<string, number> = { index: 0.02, middle: 0.0, ring: -0.02, pinky: -0.04 };

export interface HandSpec {
  hand?: Hand;
  palm?: Vec3;
  index?: State;
  middle?: State;
  ring?: State;
  pinky?: State;
  thumb?: State;
  /** thumb tip placed this far (m, along x) from the index tip */
  thumbToIndex?: number;
  thumbToMiddle?: number;
  /** thumb touches both index and middle tips (gap in y) */
  thumbToBoth?: number;
  ray?: Ray;
}

/** Synthetic 25-joint-ish right hand in viewer space; fingers point -z. Only the joints the classifier reads are exact. */
export function makeHand(spec: HandSpec): HandFrame {
  const palm = spec.palm ?? { x: 0, y: -0.3, z: -0.4 };
  const hand = spec.hand ?? "right";
  const P = (dx: number, dy: number, dz: number): Vec3 => ({ x: palm.x + dx, y: palm.y + dy, z: palm.z + dz });
  const j: Partial<Record<JointName, Vec3>> = { wrist: P(0, 0, 0) };
  for (const f of ["index", "middle", "ring", "pinky"] as const) {
    const x = FINGER_X[f]!;
    const st = spec[f] ?? "ext";
    j[`${f}-finger-metacarpal` as JointName] = P(x, 0, -0.04);
    j[`${f}-finger-phalanx-proximal` as JointName] = P(x, 0, -0.095);
    if (st === "ext") {
      j[`${f}-finger-phalanx-intermediate` as JointName] = P(x, 0, -0.135);
      j[`${f}-finger-phalanx-distal` as JointName] = P(x, 0, -0.16);
      j[`${f}-finger-tip` as JointName] = P(x, 0, -0.185);
    } else {
      j[`${f}-finger-phalanx-intermediate` as JointName] = P(x, -0.03, -0.105);
      j[`${f}-finger-phalanx-distal` as JointName] = P(x, -0.045, -0.085);
      j[`${f}-finger-tip` as JointName] = P(x, -0.03, -0.07);
    }
  }
  j["thumb-metacarpal"] = P(0.03, 0, -0.02);
  j["thumb-phalanx-proximal"] = P(0.035, 0, -0.04);
  j["thumb-phalanx-distal"] = P(0.05, 0, -0.07);
  j["thumb-tip"] = (spec.thumb ?? "ext") === "ext" ? P(0.075, 0, -0.1) : P(0.03, -0.02, -0.06);

  const idxTip = j["index-finger-tip"]!;
  const midTip = j["middle-finger-tip"]!;
  if (spec.thumbToBoth !== undefined) {
    j["thumb-tip"] = { x: (idxTip.x + midTip.x) / 2, y: idxTip.y - spec.thumbToBoth, z: idxTip.z };
  } else if (spec.thumbToIndex !== undefined) {
    j["thumb-tip"] = { x: idxTip.x + spec.thumbToIndex, y: idxTip.y, z: idxTip.z };
  } else if (spec.thumbToMiddle !== undefined) {
    j["thumb-tip"] = { x: midTip.x + spec.thumbToMiddle, y: midTip.y, z: midTip.z };
  }
  const ray: Ray = spec.ray ?? { origin: { x: palm.x, y: palm.y + 0.05, z: palm.z }, direction: { x: 0, y: 0, z: -1 } };
  return { hand, joints: j, ray };
}

export const open = (o: HandSpec = {}): HandFrame => makeHand({ ...o });
export const pinch = (o: HandSpec = {}): HandFrame =>
  makeHand({ middle: "curl", ring: "curl", pinky: "curl", thumbToIndex: 0.005, ...o });
export const rightPinch = (o: HandSpec = {}): HandFrame =>
  makeHand({ index: "curl", ring: "curl", pinky: "curl", thumbToMiddle: 0.005, ...o });
export const scrollPose = (o: HandSpec = {}): HandFrame =>
  makeHand({ ring: "curl", pinky: "curl", thumbToBoth: 0.004, ...o });
export const three = (o: HandSpec = {}): HandFrame =>
  makeHand({ pinky: "curl", thumb: "curl", ...o });
export const lShape = (aperture: number, o: HandSpec = {}): HandFrame =>
  makeHand({ middle: "curl", ring: "curl", pinky: "curl", thumbToIndex: aperture, ...o });

export const at = (p: Vec3, dx = 0, dy = 0, dz = 0): Vec3 => ({ x: p.x + dx, y: p.y + dy, z: p.z + dz });
export const PALM0: Vec3 = { x: 0, y: -0.3, z: -0.4 };

export function controller(o: Partial<ControllerFrame> = {}): ControllerFrame {
  const position = o.position ?? { x: 0.2, y: -0.2, z: -0.3 };
  return {
    hand: "right",
    position,
    ray: { origin: position, direction: { x: 0, y: 0, z: -1 } },
    trigger: false,
    squeeze: false,
    buttonA: false,
    buttonB: false,
    stickX: 0,
    stickY: 0,
    ...o,
  };
}

/** Feeds frames at 60 Hz: build(i, n, tMs) per step. Returns every event in order. */
export function run(
  c: GestureClassifier,
  durationMs: number,
  build: (progress: number, tMs: number) => Partial<InputFrame>,
  startMs = 0,
): GestureEvent[] {
  const out: GestureEvent[] = [];
  const dt = 1000 / 60;
  const n = Math.max(1, Math.round(durationMs / dt));
  for (let i = 0; i <= n; i++) {
    const t = startMs + i * dt;
    const f = build(i / n, t);
    out.push(...c.update({ time: t, hands: f.hands ?? [], controllers: f.controllers ?? [] }));
  }
  return out;
}

export const types = (ev: GestureEvent[]): string[] => ev.map((e) => e.type);
export const ofType = <T extends GestureEvent["type"]>(ev: GestureEvent[], t: T): Extract<GestureEvent, { type: T }>[] =>
  ev.filter((e): e is Extract<GestureEvent, { type: T }> => e.type === t);
