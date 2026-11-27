import { extraConfig, type ExtraConfig } from "./extraConfig";
import { dist, dot, norm, sub, v } from "./math";
import type { Hand, HandFrame, InputFrame, JointName, Ray, Vec3 } from "./types";

export type ExtraEvent =
  | { type: "back" | "forward" | "mission-control" | "hide-window" | "screenshot" | "enter"; hand: Hand }
  | { type: "fist-start" | "fist-move" | "fist-end"; hand: Hand; ray?: Ray }
  | { type: "spread"; scale: number }
  | { type: "spread-end" };

/** What the in-headset cheat sheet says about these gestures. */
export const EXTRA_CHEAT_SHEET: string[] = [
  "Two fingers (index and middle), flick left: back; right: forward",
  "Open palm facing away, push forward: Mission Control",
  "Fist held: drag; open the hand to drop",
  "Open palm facing down, flick down: hide the window",
  "Both palms open facing away, spread or close: scale the panel you look at",
  "Pinch the top strip of a panel and hold: move it",
  "Snap your fingers: screenshot",
  "Thumb up: Enter",
];

const FINGERS = ["index", "middle", "ring", "pinky"] as const;
const J = (f: string, part: string) => `${f}-finger-${part}` as JointName;

function extended(h: HandFrame, f: (typeof FINGERS)[number], c: ExtraConfig): boolean | undefined {
  const w = h.joints.wrist, tip = h.joints[J(f, "tip")], prox = h.joints[J(f, "phalanx-proximal")];
  if (!w || !tip || !prox) return undefined;
  return dist(tip, w) > c.extendedRatio * dist(prox, w);
}
function thumbOut(h: HandFrame, c: ExtraConfig): boolean | undefined {
  const t = h.joints["thumb-tip"], k = h.joints["index-finger-metacarpal"];
  return t && k ? dist(t, k) > c.thumbOutDist : undefined;
}
/** Palm normal (points out of the palm) in viewer space, undefined without the joints. */
export function palmNormal(h: HandFrame): Vec3 | undefined {
  const w = h.joints.wrist, a = h.joints["index-finger-metacarpal"], b = h.joints["pinky-finger-metacarpal"];
  if (!w || !a || !b) return undefined;
  const p = sub(a, w), q = sub(b, w);
  const n = norm(v(p.y * q.z - p.z * q.y, p.z * q.x - p.x * q.z, p.x * q.y - p.y * q.x));
  return h.hand === "right" ? n : v(-n.x, -n.y, -n.z);
}

interface Pose { flick: boolean; open: boolean; fist: boolean; thumbsUp: boolean; facingAway: boolean; facingDown: boolean }
function poseOf(h: HandFrame, c: ExtraConfig): Pose {
  const e = FINGERS.map((f) => extended(h, f, c));
  const thumb = thumbOut(h, c);
  const known = e.every((x) => x !== undefined) && thumb !== undefined;
  const [i, m, r, p] = e;
  const n = palmNormal(h);
  const none = { flick: false, open: false, fist: false, thumbsUp: false, facingAway: false, facingDown: false };
  if (!known) return none;
  const curled = !i && !m && !r && !p;
  const t = h.joints["thumb-tip"]!, k = h.joints["index-finger-metacarpal"]!;
  return {
    flick: !!i && !!m && !r && !p,
    open: !!i && !!m && !!r && !!p && !!thumb,
    fist: curled && !thumb,
    thumbsUp: curled && !!thumb && t.y - k.y >= c.thumbsUpRise,
    facingAway: !!n && dot(n, v(0, 0, -1)) >= c.palmFacing,
    facingDown: !!n && dot(n, v(0, -1, 0)) >= c.palmFacing,
  };
}

interface Sample { t: number; wrist: Vec3; index: Vec3; pose: Pose; thumbMid?: number; midTip?: Vec3 }
interface HandState {
  samples: Sample[];
  fistSince?: number;
  fistActive: boolean;
  thumbsUpSince?: number;
  thumbsUpArmed: boolean;
}

/** Detects the v0.3 gestures from viewer-space hand frames. Pure: feed `update` once per frame. */
export class ExtraGestures {
  cfg: ExtraConfig;
  private hands = new Map<Hand, HandState>();
  private cooldown = new Map<string, number>();
  private spread?: { since: number; gap0?: number; active: boolean };

  constructor(cfg: Partial<ExtraConfig> = {}) { this.cfg = { ...extraConfig, ...cfg }; }

  reset(): void { this.hands.clear(); this.cooldown.clear(); this.spread = undefined; }

  private ready(key: string, t: number, ms: number): boolean {
    if (t < (this.cooldown.get(key) ?? -Infinity)) return false;
    this.cooldown.set(key, t + ms);
    return true;
  }

  update(frame: InputFrame): ExtraEvent[] {
    const c = this.cfg, t = frame.time, out: ExtraEvent[] = [];
    const seen = new Set<Hand>();
    for (const h of frame.hands) {
      const w = h.joints.wrist, idx = h.joints["index-finger-tip"];
      if (!w || !idx) continue;
      seen.add(h.hand);
      let st = this.hands.get(h.hand);
      if (!st) { st = { samples: [], fistActive: false, thumbsUpArmed: true }; this.hands.set(h.hand, st); }
      const pose = poseOf(h, c);
      const th = h.joints["thumb-tip"], mid = h.joints["middle-finger-tip"];
      st.samples.push({ t, wrist: w, index: idx, pose, thumbMid: th && mid ? dist(th, mid) : undefined, midTip: mid });
      while (st.samples.length > 2 && t - st.samples[0]!.t > 500) st.samples.shift();
      this.motion(h, st, pose, t, out);
      this.fist(h, st, pose, t, out);
      this.thumbsUp(h, st, pose, t, out);
      this.snap(h, st, t, out);
    }
    for (const [hand, st] of this.hands) if (!seen.has(hand)) { if (st.fistActive) out.push({ type: "fist-end", hand }); this.hands.delete(hand); }
    this.spreadStep(frame, t, out);
    return out;
  }

  /** samples in the last `ms` during which `ok(pose)` held without a break, oldest first */
  private run(st: HandState, t: number, ms: number, ok: (p: Pose) => boolean): Sample[] {
    const run: Sample[] = [];
    for (let i = st.samples.length - 1; i >= 0; i--) {
      const s = st.samples[i]!;
      if (t - s.t > ms || !ok(s.pose)) break;
      run.unshift(s);
    }
    return run;
  }

  private motion(h: HandFrame, st: HandState, pose: Pose, t: number, out: ExtraEvent[]): void {
    const c = this.cfg;
    if (pose.flick) {
      const r = this.run(st, t, c.flickWindowMs, (p) => p.flick);
      if (r.length >= 3) {
        const d = sub(r[r.length - 1]!.index, r[0]!.index);
        const side = Math.max(Math.abs(d.y), Math.abs(d.z));
        if (Math.abs(d.x) >= c.flickDistance && Math.abs(d.x) >= c.flickAxisRatio * side && this.ready("flick", t, c.flickCooldownMs)) {
          out.push({ type: d.x < 0 ? "back" : "forward", hand: h.hand });
          st.samples = [];
          return;
        }
      }
    }
    if (pose.open && pose.facingAway) {
      const r = this.run(st, t, c.pushWindowMs, (p) => p.open && p.facingAway);
      if (r.length >= 3) {
        const d = sub(r[r.length - 1]!.wrist, r[0]!.wrist);
        if (-d.z >= c.pushDistance && -d.z >= 2 * Math.max(Math.abs(d.x), Math.abs(d.y)) && this.ready("push", t, c.pushCooldownMs)) {
          out.push({ type: "mission-control", hand: h.hand });
          st.samples = [];
          return;
        }
      }
    }
    if (pose.open && pose.facingDown) {
      const r = this.run(st, t, c.dropWindowMs, (p) => p.open && p.facingDown);
      if (r.length >= 3) {
        const d = sub(r[r.length - 1]!.wrist, r[0]!.wrist);
        if (-d.y >= c.dropDistance && -d.y >= 2 * Math.max(Math.abs(d.x), Math.abs(d.z)) && this.ready("drop", t, c.dropCooldownMs)) {
          out.push({ type: "hide-window", hand: h.hand });
          st.samples = [];
        }
      }
    }
  }

  private fist(h: HandFrame, st: HandState, pose: Pose, t: number, out: ExtraEvent[]): void {
    if (pose.fist) {
      st.fistSince ??= t;
      if (!st.fistActive && t - st.fistSince >= this.cfg.fistHoldMs) { st.fistActive = true; out.push({ type: "fist-start", hand: h.hand, ray: h.ray }); }
      else if (st.fistActive) out.push({ type: "fist-move", hand: h.hand, ray: h.ray });
    } else {
      if (st.fistActive) out.push({ type: "fist-end", hand: h.hand, ray: h.ray });
      st.fistActive = false;
      st.fistSince = undefined;
    }
  }

  private thumbsUp(h: HandFrame, st: HandState, pose: Pose, t: number, out: ExtraEvent[]): void {
    if (!pose.thumbsUp) { st.thumbsUpSince = undefined; st.thumbsUpArmed = true; return; }
    st.thumbsUpSince ??= t;
    if (st.thumbsUpArmed && t - st.thumbsUpSince >= this.cfg.thumbsUpHoldMs && this.ready("thumbsUp", t, this.cfg.thumbsUpCooldownMs)) {
      st.thumbsUpArmed = false;
      out.push({ type: "enter", hand: h.hand });
    }
  }

  private snap(h: HandFrame, st: HandState, t: number, out: ExtraEvent[]): void {
    const c = this.cfg, n = st.samples.length;
    if (n < 2) return;
    const cur = st.samples[n - 1]!, prev = st.samples[n - 2]!;
    if (!cur.midTip || !prev.midTip || cur.thumbMid === undefined || prev.thumbMid === undefined) return;
    const dt = (cur.t - prev.t) / 1000;
    if (dt <= 0) return;
    const speed = dist(cur.midTip, prev.midTip) / dt;
    const wasTouching = st.samples.some((s) => t - s.t <= c.snapWindowMs && s.thumbMid !== undefined && s.thumbMid <= c.snapContact);
    if (wasTouching && cur.thumbMid > c.snapContact && speed >= c.snapSpeed && this.ready("snap", t, c.snapCooldownMs)) out.push({ type: "screenshot", hand: h.hand });
  }

  private spreadStep(frame: InputFrame, t: number, out: ExtraEvent[]): void {
    const c = this.cfg;
    const open = frame.hands.filter((h) => { const p = poseOf(h, c); return p.open && p.facingAway; });
    const l = open.find((h) => h.hand === "left")?.joints.wrist, r = open.find((h) => h.hand === "right")?.joints.wrist;
    if (!l || !r) {
      if (this.spread?.active) out.push({ type: "spread-end" });
      this.spread = undefined;
      return;
    }
    this.spread ??= { since: t, active: false };
    const s = this.spread, gap = dist(l, r);
    if (t - s.since < c.spreadHoldMs) { s.gap0 = gap; return; }
    s.gap0 ??= gap;
    const scale = gap / s.gap0;
    if (!s.active && Math.abs(scale - 1) < c.spreadDeadZone) return;
    s.active = true;
    out.push({ type: "spread", scale });
  }
}
