export interface Vec3 { x: number; y: number; z: number }
export interface Ray { origin: Vec3; direction: Vec3 }

export const FINGERS = ["thumb", "index", "middle", "ring", "pinky"] as const;
export type Finger = (typeof FINGERS)[number];
export type Hand = "left" | "right";

export type JointName =
  | "wrist"
  | "thumb-metacarpal" | "thumb-phalanx-proximal" | "thumb-phalanx-distal" | "thumb-tip"
  | "index-finger-metacarpal" | "index-finger-phalanx-proximal" | "index-finger-phalanx-intermediate" | "index-finger-phalanx-distal" | "index-finger-tip"
  | "middle-finger-metacarpal" | "middle-finger-phalanx-proximal" | "middle-finger-phalanx-intermediate" | "middle-finger-phalanx-distal" | "middle-finger-tip"
  | "ring-finger-metacarpal" | "ring-finger-phalanx-proximal" | "ring-finger-phalanx-intermediate" | "ring-finger-phalanx-distal" | "ring-finger-tip"
  | "pinky-finger-metacarpal" | "pinky-finger-phalanx-proximal" | "pinky-finger-phalanx-intermediate" | "pinky-finger-phalanx-distal" | "pinky-finger-tip";

/** Joints in viewer space, metres: x right, y up, -z forward (decision D8). */
export interface HandFrame {
  hand: Hand;
  joints: Partial<Record<JointName, Vec3>>;
  ray?: Ray;
}

export interface ControllerFrame {
  hand: Hand;
  ray?: Ray;
  position: Vec3;
  trigger: boolean;
  squeeze: boolean;
  /** A or X */
  buttonA: boolean;
  /** B or Y */
  buttonB: boolean;
  stickX: number;
  stickY: number;
}

export interface InputFrame {
  /** milliseconds */
  time: number;
  hands: HandFrame[];
  controllers: ControllerFrame[];
}

export type Source = "hand" | "controller";

export type GestureEvent =
  | { type: "point"; hand: Hand; source: Source; ray: Ray }
  | { type: "click"; hand: Hand; source: Source; button: "left" | "right"; ray: Ray }
  | { type: "drag-start"; hand: Hand; source: Source; ray: Ray }
  | { type: "drag-move"; hand: Hand; source: Source; ray: Ray }
  | { type: "drag-end"; hand: Hand; source: Source; ray: Ray }
  /** dx, dy in pixels; dy > 0 moves content down (touch-drag direction, decision D6). */
  | { type: "scroll"; hand: Hand; source: Source; dx: number; dy: number }
  /** delta is a natural-log zoom ratio; > 0 zooms in. */
  | { type: "magnify"; hand: Hand; delta: number }
  | { type: "swipe"; hand: Hand; source: Source; direction: "left" | "right" | "up" | "down" }
  | { type: "mission-control"; hand: Hand; source: Source }
  | { type: "grab-start"; points: number }
  /** center: metres moved since grab start, scale: ratio of hand separation to start (1 for one point), yaw: radians turned since start. */
  | { type: "grab-move"; center: Vec3; scale: number; yaw: number; points: number }
  | { type: "grab-end" };
