import { dist, v } from "../gesture/math";
import { sessionInit } from "./session";
import type { ControllerFrame, Hand, HandFrame, InputFrame, JointName, Ray, Vec3 } from "../gesture/types";

export const JOINTS: JointName[] = [
  "wrist",
  "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip",
  "index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip",
  "middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip",
  "ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip",
  "pinky-finger-metacarpal", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip",
];

export const SESSION_INIT = {
  requiredFeatures: ["local-floor"],
  optionalFeatures: ["hand-tracking"],
} as const;

export type XRMode = "immersive-ar" | "immersive-vr";

export async function startSession(mode: XRMode, realHands = false): Promise<XRSession> {
  if (!navigator.xr) throw new Error("WebXR is not available in this browser (open the page in the Quest Browser)");
  return navigator.xr.requestSession(mode, sessionInit(mode, realHands));
}

/** Head frame: yaw-only rotation about the head position (decision D8). */
export interface HeadFrame { position: Vec3; yaw: number }

export function headFrameOf(pose: XRViewerPose): HeadFrame {
  const q = pose.transform.orientation;
  // forward = -z rotated by q; yaw from its horizontal component
  const fx = -2 * (q.x * q.z + q.w * q.y);
  const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  const p = pose.transform.position;
  return { position: { x: p.x, y: p.y, z: p.z }, yaw: Math.atan2(fx, -fz) };
}

const rot = (p: Vec3, a: number): Vec3 => ({ x: p.x * Math.cos(a) + p.z * Math.sin(a), y: p.y, z: -p.x * Math.sin(a) + p.z * Math.cos(a) });

export function toViewer(p: Vec3, h: HeadFrame): Vec3 {
  return rot({ x: p.x - h.position.x, y: p.y - h.position.y, z: p.z - h.position.z }, h.yaw);
}
export function dirToViewer(d: Vec3, h: HeadFrame): Vec3 { return rot(d, h.yaw); }
export function dirToWorld(d: Vec3, h: HeadFrame): Vec3 { return rot(d, -h.yaw); }
export function toWorld(p: Vec3, h: HeadFrame): Vec3 {
  const r = rot(p, -h.yaw);
  return { x: r.x + h.position.x, y: r.y + h.position.y, z: r.z + h.position.z };
}
export const rayToWorld = (r: Ray, h: HeadFrame): Ray => ({ origin: toWorld(r.origin, h), direction: dirToWorld(r.direction, h) });

const pt = (p: DOMPointReadOnly): Vec3 => ({ x: p.x, y: p.y, z: p.z });

function rayOf(frame: XRFrame, src: XRInputSource, ref: XRReferenceSpace): Ray | undefined {
  const pose = frame.getPose(src.targetRaySpace, ref);
  if (!pose) return undefined;
  const o = pose.transform.orientation;
  // forward = -z rotated by the quaternion
  const d = v(-2 * (o.x * o.z + o.w * o.y), -2 * (o.y * o.z - o.w * o.x), -(1 - 2 * (o.x * o.x + o.y * o.y)));
  return { origin: pt(pose.transform.position), direction: d };
}

export interface WorldInput {
  head: HeadFrame;
  /** world-space joints, for the typing surface */
  worldHands: HandFrame[];
  /** viewer-space frame for the gesture classifier */
  frame: InputFrame;
  /** the system's pointer ray of each hand or controller (inputSource.targetRaySpace), in world space */
  worldRays: Partial<Record<Hand, Ray>>;
}

/** Reads hands and controllers from an XRFrame. World space for the keyboard, viewer space for the classifier. */
export function readInput(frame: XRFrame, ref: XRReferenceSpace, time: number): WorldInput | undefined {
  const viewer = frame.getViewerPose(ref);
  if (!viewer) return undefined;
  const head = headFrameOf(viewer);
  const worldHands: HandFrame[] = [];
  const hands: HandFrame[] = [];
  const controllers: ControllerFrame[] = [];
  const worldRays: Partial<Record<Hand, Ray>> = {};

  for (const src of frame.session.inputSources) {
    const side = src.handedness === "left" ? "left" : "right";
    if (src.hand) {
      const joints: HandFrame["joints"] = {};
      const wj: HandFrame["joints"] = {};
      for (const n of JOINTS) {
        const space = src.hand.get(n as XRHandJoint);
        const pose = space ? frame.getJointPose?.(space, ref) : undefined;
        if (!pose) continue;
        const p = pt(pose.transform.position);
        wj[n] = p;
        joints[n] = toViewer(p, head);
      }
      const ray = rayOf(frame, src, ref);
      if (ray) worldRays[side] = ray;
      worldHands.push({ hand: side, joints: wj, ray });
      hands.push({ hand: side, joints, ray: ray && { origin: toViewer(ray.origin, head), direction: dirToViewer(ray.direction, head) } });
    } else if (src.gamepad) {
      const grip = src.gripSpace ? frame.getPose(src.gripSpace, ref) : undefined;
      const ray = rayOf(frame, src, ref);
      if (ray) worldRays[side] = ray;
      const position = grip ? pt(grip.transform.position) : ray?.origin;
      if (!position) continue;
      const b = src.gamepad.buttons;
      const a = src.gamepad.axes;
      controllers.push({
        hand: side,
        position: toViewer(position, head),
        ray: ray && { origin: toViewer(ray.origin, head), direction: dirToViewer(ray.direction, head) },
        trigger: b[0]?.pressed ?? false,
        squeeze: b[1]?.pressed ?? false,
        buttonA: b[4]?.pressed ?? false,
        buttonB: b[5]?.pressed ?? false,
        stickX: a[2] ?? 0,
        stickY: a[3] ?? 0,
      });
    }
  }
  return { head, worldHands, frame: { time, hands, controllers }, worldRays };
}

export const fingerSpan = (h: HandFrame): number => {
  const a = h.joints["index-finger-tip"];
  const b = h.joints["pinky-finger-tip"];
  return a && b ? dist(a, b) : 0;
};
