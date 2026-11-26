import { defaultGestureConfig, type GestureConfig } from "./config";
import { extract, type HandFeatures, type PinchMemory } from "./features";
import { dist, mid, sub, v } from "./math";
import type { ControllerFrame, GestureEvent, Hand, InputFrame, Ray, Source, Vec3 } from "./types";

interface Press { t0: number; p0: Vec3; ray0: Ray; dragging: boolean }

/** Tap vs drag for one pinch or one trigger. Right buttons never drag. */
class PressTracker {
  private press: Press | undefined;
  constructor(
    private readonly cfg: GestureConfig,
    private readonly hand: Hand,
    private readonly source: Source,
    private readonly button: "left" | "right",
  ) {}

  get active(): boolean { return this.press !== undefined; }

  update(down: boolean, point: Vec3, ray: Ray, time: number, out: GestureEvent[]): void {
    const { hand, source } = this;
    if (down && !this.press) {
      this.press = { t0: time, p0: point, ray0: ray, dragging: false };
      return;
    }
    const p = this.press;
    if (!p) return;
    if (down) {
      if (this.button === "left") {
        if (!p.dragging && dist(point, p.p0) > this.cfg.dragStart) {
          p.dragging = true;
          out.push({ type: "drag-start", hand, source, ray: p.ray0 });
        }
        if (p.dragging) out.push({ type: "drag-move", hand, source, ray });
      } else if (dist(point, p.p0) > this.cfg.dragStart) {
        p.dragging = true;
      }
      return;
    }
    // released
    if (p.dragging && this.button === "left") out.push({ type: "drag-end", hand, source, ray });
    else if (!p.dragging && time - p.t0 <= this.cfg.clickMaxMs) out.push({ type: "click", hand, source, button: this.button, ray: p.ray0 });
    this.press = undefined;
  }

  cancel(ray: Ray, out: GestureEvent[]): void {
    if (this.press?.dragging && this.button === "left") out.push({ type: "drag-end", hand: this.hand, source: this.source, ray });
    this.press = undefined;
  }
}

class HandState {
  mem: PinchMemory = { index: false, middle: false };
  left: PressTracker;
  right: PressTracker;
  lastPalm: Vec3 | undefined;
  threeStart: { t: number; palm: Vec3 } | undefined;
  threeFired = false;
  magnifySince: number | undefined;
  lastAperture: number | undefined;
  /** after a grab ends, ignore pinches until released so the release is not a click */
  suppress = false;
  prev: HandFeatures | undefined;
  lastRay: Ray | undefined;
  constructor(cfg: GestureConfig, public hand: Hand) {
    this.left = new PressTracker(cfg, hand, "hand", "left");
    this.right = new PressTracker(cfg, hand, "hand", "right");
  }
}

class ControllerState {
  trigger: PressTracker;
  prevA = false;
  prevB = false;
  flickArmed = true;
  lastTime: number | undefined;
  constructor(cfg: GestureConfig, hand: Hand) {
    this.trigger = new PressTracker(cfg, hand, "controller", "left");
  }
}

const wrapAngle = (a: number): number => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
};

export class GestureClassifier {
  private hands = new Map<Hand, HandState>();
  private controllers = new Map<Hand, ControllerState>();
  private grab: { points: number; center0: Vec3; dist0: number; yaw0: number } | undefined;
  private lastRay: Ray = { origin: v(), direction: v(0, 0, -1) };

  constructor(private readonly cfg: GestureConfig = defaultGestureConfig) {}

  reset(): void {
    this.hands.clear();
    this.controllers.clear();
    this.grab = undefined;
  }

  update(frame: InputFrame): GestureEvent[] {
    const out: GestureEvent[] = [];
    const t = frame.time;

    // hands
    const features = new Map<Hand, HandFeatures>();
    for (const hf of frame.hands) {
      const st = this.hands.get(hf.hand) ?? new HandState(this.cfg, hf.hand);
      this.hands.set(hf.hand, st);
      const f = extract(hf, this.cfg, st.mem);
      if (f) features.set(hf.hand, f);
    }
    // tracking lost: drop state of hands not seen this frame
    for (const [h, st] of this.hands) {
      if (!features.has(h)) {
        st.left.cancel(st.lastRay ?? this.lastRay, out);
        st.right.cancel(st.lastRay ?? this.lastRay, out);
        this.hands.delete(h);
      }
    }

    const pinching = [...features].filter(([, f]) => f.pose === "pinch").map(([h, f]) => ({ h, f }));
    const squeezing = frame.controllers.filter((c) => c.squeeze);
    const handGrab = pinching.length === 2;
    const grabPoints: { hand: Hand; p: Vec3 }[] = handGrab
      ? pinching.map(({ h, f }) => ({ hand: h, p: f.pinchPoint }))
      : squeezing.map((c) => ({ hand: c.hand, p: c.position }));
    this.updateGrab(grabPoints, out);
    const grabbing = this.grab !== undefined;

    for (const [hand, f] of features) {
      const st = this.hands.get(hand)!;
      this.lastRay = f.ray;
      st.lastRay = f.ray;
      if (grabbing) {
        st.left.cancel(f.ray, out);
        st.right.cancel(f.ray, out);
        st.suppress = true;
        st.prev = f;
        continue;
      }
      if (st.suppress) {
        if (f.pose !== "pinch" && f.pose !== "rpinch" && f.pose !== "scroll") st.suppress = false;
        else { st.prev = f; continue; }
      }
      this.updateHand(st, f, t, out);
      st.prev = f;
    }

    for (const c of frame.controllers) this.updateController(c, t, grabbing, out);
    return out;
  }

  private updateHand(st: HandState, f: HandFeatures, t: number, out: GestureEvent[]): void {
    const { hand } = st;
    const cfg = this.cfg;
    if (f.pose === "scroll") {
      // the pinch that grows into a two-finger scroll is not a click
      st.left.cancel(f.ray, out);
      st.right.cancel(f.ray, out);
    }
    st.left.update(f.pose === "pinch", f.pinchPoint, f.ray, t, out);
    st.right.update(f.pose === "rpinch", f.pinchPoint, f.ray, t, out);
    if (f.pose === "none") out.push({ type: "point", hand, source: "hand", ray: f.ray });

    // scroll
    if (f.pose === "scroll") {
      if (st.lastPalm) {
        const dx = (f.palm.x - st.lastPalm.x) * cfg.scrollGain;
        const dy = -(f.palm.y - st.lastPalm.y) * cfg.scrollGain;
        if (dx !== 0 || dy !== 0) out.push({ type: "scroll", hand, source: "hand", dx, dy });
      }
      st.lastPalm = f.palm;
    } else st.lastPalm = undefined;

    // three-finger swipe
    if (f.pose === "three") {
      if (!st.threeStart) st.threeStart = { t, palm: f.palm };
      if (!st.threeFired) {
        if (t - st.threeStart.t > cfg.swipeMaxMs) st.threeStart = { t, palm: f.palm };
        const d = sub(f.palm, st.threeStart.palm);
        if (Math.max(Math.abs(d.x), Math.abs(d.y)) >= cfg.swipeDistance) {
          const horizontal = Math.abs(d.x) >= Math.abs(d.y);
          const direction = horizontal ? (d.x > 0 ? "right" : "left") : d.y > 0 ? "up" : "down";
          out.push({ type: "swipe", hand, source: "hand", direction });
          st.threeFired = true;
        }
      }
    } else {
      st.threeStart = undefined;
      st.threeFired = false;
    }

    // magnify
    if (f.pose === "magnify") {
      st.magnifySince ??= t;
      if (t - st.magnifySince >= cfg.magnifyHoldMs) {
        if (st.lastAperture === undefined) st.lastAperture = f.aperture;
        else if (Math.abs(f.aperture - st.lastAperture) > cfg.magnifyDeadband && f.aperture > 0 && st.lastAperture > 0) {
          out.push({ type: "magnify", hand, delta: Math.log(f.aperture / st.lastAperture) });
          st.lastAperture = f.aperture;
        }
      }
    } else {
      st.magnifySince = undefined;
      st.lastAperture = undefined;
    }
  }

  private updateGrab(points: { hand: Hand; p: Vec3 }[], out: GestureEvent[]): void {
    const pts = [...points].sort((a, b) => (a.hand === b.hand ? 0 : a.hand === "left" ? -1 : 1)).slice(0, 2).map((x) => x.p);
    if (this.grab && this.grab.points !== pts.length) {
      out.push({ type: "grab-end" });
      this.grab = undefined;
    }
    if (pts.length === 0) {
      if (this.grab) {
        out.push({ type: "grab-end" });
        this.grab = undefined;
      }
      return;
    }
    const first = pts[0]!;
    const second = pts[1];
    const center = second ? mid(first, second) : first;
    const separation = second ? dist(first, second) : 0;
    const yaw = second ? Math.atan2(second.x - first.x, second.z - first.z) : 0;
    if (!this.grab) {
      this.grab = { points: pts.length, center0: center, dist0: separation, yaw0: yaw };
      out.push({ type: "grab-start", points: pts.length });
      return;
    }
    const g = this.grab;
    out.push({
      type: "grab-move",
      center: sub(center, g.center0),
      scale: second && g.dist0 > 0 ? separation / g.dist0 : 1,
      yaw: second ? wrapAngle(yaw - g.yaw0) : 0,
      points: pts.length,
    });
  }

  private updateController(c: ControllerFrame, t: number, grabbing: boolean, out: GestureEvent[]): void {
    const st = this.controllers.get(c.hand) ?? new ControllerState(this.cfg, c.hand);
    this.controllers.set(c.hand, st);
    const ray = c.ray ?? { origin: c.position, direction: v(0, 0, -1) };
    this.lastRay = ray;
    const dtMs = st.lastTime === undefined ? 0 : t - st.lastTime;
    st.lastTime = t;

    if (grabbing) st.trigger.cancel(ray, out);
    else {
      st.trigger.update(c.trigger, c.position, ray, t, out);
      if (!c.trigger) out.push({ type: "point", hand: c.hand, source: "controller", ray });
      if (c.buttonA && !st.prevA) out.push({ type: "click", hand: c.hand, source: "controller", button: "right", ray });
      if (c.buttonB && !st.prevB) out.push({ type: "mission-control", hand: c.hand, source: "controller" });

      if (Math.abs(c.stickY) > this.cfg.stickDeadzone && dtMs > 0) {
        // stick forward is negative: forward moves content down, as scrolling the view toward the top
        out.push({ type: "scroll", hand: c.hand, source: "controller", dx: 0, dy: -c.stickY * this.cfg.stickScrollPxPerSec * (dtMs / 1000) });
      }
      if (st.flickArmed && Math.abs(c.stickX) > this.cfg.stickFlickOn) {
        out.push({ type: "swipe", hand: c.hand, source: "controller", direction: c.stickX > 0 ? "right" : "left" });
        st.flickArmed = false;
      } else if (Math.abs(c.stickX) < this.cfg.stickFlickOff) st.flickArmed = true;
    }
    st.prevA = c.buttonA;
    st.prevB = c.buttonB;
  }
}
