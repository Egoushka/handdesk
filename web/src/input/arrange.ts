import { dist } from "../gesture/math";
import type { Ray, Vec3 } from "../gesture/types";
import { pickPanel, planePoint, type Panel } from "../panel";
import { dragHandle, pickHandle, type Handle, type HandleKind } from "../space/handles";
import { headDistance, pulledDistance, withDistance } from "../space/surface";
import { titleDragCenter } from "../space/titledrag";

/** The hand may drift this far (m) from where the pinch began before pinch-pull starts to change the distance. */
export const PULL_DEAD_ZONE = 0.04;

interface Grab { start: Panel; kind: HandleKind | "body"; from: Vec3; handDist: number; panelDist: number }

/**
 * Arrange mode: a select on a handle drags the handle (scale, curve), a select on the panel body moves it in its plane, and
 * pulling the pinching hand towards the head brings the panel closer (pushing it away sends it back). All in world space.
 */
export class ArrangeDrag {
  private grab?: Grab;
  get active(): boolean { return !!this.grab; }

  /**
   * Begin a grab; returns the panel it grabbed (by reference) or undefined when the ray hit nothing.
   * `handlesFor` gives a panel's handles (a snip has its own), `special` takes the pin and close handles and says whether it used them.
   */
  start(ray: Ray, panels: Panel[], hand: Vec3 | undefined, head: Vec3, handlesFor: (p: Panel) => Handle[] | undefined, special?: (p: Panel, kind: string) => boolean): Panel | undefined {
    for (const p of panels) {
      const handles = handlesFor(p);
      if (!handles) continue;
      const h = pickHandle(ray, p, 0.07, handles);
      if (h && (h.kind === "pin" || h.kind === "close")) { if (special?.(p, h.kind)) return undefined; continue; }
      const from = h && planePoint(ray, p);
      if (h && from) { this.grab = { start: p, kind: h.kind as HandleKind, from, handDist: hand ? dist(hand, head) : 0, panelDist: headDistance(p, head) }; return p; }
    }
    const hit = pickPanel(ray, panels);
    const from = hit && planePoint(ray, hit.panel);
    if (!hit || !from) return undefined;
    this.grab = { start: hit.panel, kind: "body", from, handDist: hand ? dist(hand, head) : 0, panelDist: headDistance(hit.panel, head) };
    return hit.panel;
  }

  move(ray: Ray, hand: Vec3 | undefined, head: Vec3): Panel | undefined {
    const g = this.grab;
    if (!g) return undefined;
    const to = planePoint(ray, g.start);
    if (!to) return undefined;
    if (g.kind !== "body") return { ...dragHandle(g.start, g.kind, g.from, to), ...(g.start.crop ? { curve: 0 } : {}) };
    let p: Panel = { ...g.start, center: titleDragCenter(g.start, g.from, to) };
    if (hand && g.handDist > 0) {
      const delta = dist(hand, head) - g.handDist;
      const eff = Math.abs(delta) < PULL_DEAD_ZONE ? 0 : delta - Math.sign(delta) * PULL_DEAD_ZONE;
      if (eff !== 0) {
        const wanted = pulledDistance(g.panelDist, g.handDist, g.handDist + eff);
        p = withDistance(p, head, headDistance(p, head) * (wanted / g.panelDist));
      }
    }
    return p;
  }

  end(): void { this.grab = undefined; }
}
