import { dist, mid, norm, sub } from "./math";
import type { Finger, HandFrame, JointName, Ray, Vec3 } from "./types";
import type { GestureConfig } from "./config";

const tipName = (f: Finger): JointName => (f === "thumb" ? "thumb-tip" : (`${f}-finger-tip` as JointName));
const proxName = (f: Finger): JointName =>
  f === "thumb" ? "thumb-phalanx-proximal" : (`${f}-finger-phalanx-proximal` as JointName);

export type Pose = "none" | "pinch" | "rpinch" | "scroll" | "three" | "magnify";

export interface HandFeatures {
  pose: Pose;
  /** thumb-index contact point */
  pinchPoint: Vec3;
  palm: Vec3;
  aperture: number;
  ray: Ray;
}

export function joint(h: HandFrame, n: JointName): Vec3 | undefined {
  return h.joints[n];
}

export function isExtended(h: HandFrame, f: Finger, cfg: GestureConfig): boolean | undefined {
  const w = h.joints.wrist;
  const tip = h.joints[tipName(f)];
  const prox = h.joints[proxName(f)];
  if (!w || !tip || !prox) return undefined;
  const ratio = f === "thumb" ? cfg.thumbExtendedRatio : cfg.extendedRatio;
  return dist(tip, w) > ratio * dist(prox, w);
}

export interface PinchMemory { index: boolean; middle: boolean }

/** Returns undefined when joints are missing (tracking loss). `mem` carries pinch hysteresis between frames. */
export function extract(h: HandFrame, cfg: GestureConfig, mem: PinchMemory): HandFeatures | undefined {
  const w = h.joints.wrist;
  const tt = h.joints["thumb-tip"];
  const it = h.joints["index-finger-tip"];
  const mt = h.joints["middle-finger-tip"];
  const mp = h.joints["middle-finger-phalanx-proximal"];
  if (!w || !tt || !it || !mt || !mp) return undefined;

  const dIdx = dist(tt, it);
  const dMid = dist(tt, mt);
  mem.index = dIdx < (mem.index ? cfg.pinchOff : cfg.pinchOn);
  mem.middle = dMid < (mem.middle ? cfg.pinchOff : cfg.pinchOn);

  const ext = (f: Finger) => isExtended(h, f, cfg) ?? false;
  let pose: Pose = "none";
  if (mem.index && mem.middle) pose = "scroll";
  else if (mem.index) pose = "pinch";
  else if (mem.middle) pose = "rpinch";
  else if (ext("index") && ext("middle") && ext("ring") && !ext("pinky") && !ext("thumb")) pose = "three";
  else if (ext("thumb") && ext("index") && !ext("middle") && !ext("ring") && !ext("pinky")) pose = "magnify";

  const ray: Ray = h.ray ?? { origin: it, direction: norm(sub(it, w)) };
  return { pose, pinchPoint: mid(tt, it), palm: mid(w, mp), aperture: dIdx, ray };
}
