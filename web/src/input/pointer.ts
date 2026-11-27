import type { Hand, Ray } from "../gesture/types";
import type { ModePolicy } from "../modes/modes";
import type { ClientMessage } from "../protocol";

/** What a ray hit: a Mac panel (display or window) or a page UI panel. `x`,`y` are 0..1 with a top-left origin; `width`/`height` are metres. */
export interface Pick { key: string; ui?: string; display: number; window?: number; x: number; y: number; width: number; height: number; t: number }

/** The system's select and squeeze events for one input source, in the order the browser fired them. */
export interface SelectEvent { type: "selectstart" | "selectend" | "squeezestart" | "squeezeend"; hand: Hand }

export type PointerAction =
  | { type: "hover"; hand: Hand; pick?: Pick }
  | { type: "ui"; hand: Hand; id: string; x: number; y: number }
  /** messages for the Mac; `gesture` names it for the HUD and log, absent for plain cursor moves */
  | { type: "send"; hand: Hand; messages: ClientMessage[]; gesture?: string; at?: Pick; ripple?: boolean }
  | { type: "arrange"; hand: Hand; phase: "start" | "move" | "end"; pick?: Pick; ray?: Ray; kind: "select" | "squeeze" };

/** Metres the aim point may travel on the panel before a select becomes a drag. */
export const DRAG_METRES = 0.02;
/** Hover moves go to the Mac at most this often (ms) and only when the point moved by this much (0..1). */
export const HOVER_MS = 25;
export const HOVER_EPS = 0.0015;

const at = (p: Pick) => (p.window === undefined ? { display: p.display, x: p.x, y: p.y } : { window: p.window, x: p.x, y: p.y });
export const moveTo = (p: Pick): ClientMessage => ({ type: "move", ...at(p) });
export const buttonAt = (p: Pick, button: "left" | "right", down: boolean): ClientMessage => ({ type: "button", ...at(p), button, down });

interface Held { kind: "select" | "squeeze"; mode: "ui" | "mac" | "arrange" | "none"; start?: Pick; last?: Pick; dragging: boolean }

/**
 * Turns the system select ray into Mac actions. The ray is the platform's own filtered pointer (inputSource.targetRaySpace) and the click is its
 * select event, so the page never decides what a pinch is. A select that stays put is a click; one that moves is a drag; squeeze is a right click.
 */
export class PointerRouter {
  private held = new Map<Hand, Held>();
  private lastHover = new Map<Hand, { t: number; pick?: Pick }>();

  reset(): void { this.held.clear(); this.lastHover.clear(); }

  /** True while this hand has a select or squeeze down. */
  holding(hand: Hand): boolean { return this.held.has(hand); }

  update(time: number, rays: Partial<Record<Hand, Ray>>, events: SelectEvent[], pick: (r: Ray) => Pick | undefined, policy: ModePolicy): PointerAction[] {
    const out: PointerAction[] = [];
    const now: Partial<Record<Hand, Pick | undefined>> = {};
    for (const hand of ["left", "right"] as Hand[]) { const r = rays[hand]; now[hand] = r && pick(r); }

    for (const e of events) {
      const cur = now[e.hand];
      const h = this.held.get(e.hand);
      if (e.type === "selectstart" || e.type === "squeezestart") {
        const kind = e.type === "selectstart" ? "select" : "squeeze";
        if (cur?.ui) { out.push({ type: "ui", hand: e.hand, id: cur.ui, x: cur.x, y: cur.y }); this.held.set(e.hand, { kind, mode: "ui", dragging: false }); continue; }
        if (policy.arrange) {
          this.held.set(e.hand, { kind, mode: "arrange", start: cur, last: cur, dragging: false });
          out.push({ type: "arrange", hand: e.hand, phase: "start", pick: cur, ray: rays[e.hand], kind });
          continue;
        }
        if (policy.ray && cur) {
          this.held.set(e.hand, { kind, mode: "mac", start: cur, last: cur, dragging: false });
          if (kind === "squeeze") {
            out.push({ type: "send", hand: e.hand, messages: [moveTo(cur), buttonAt(cur, "right", true), buttonAt(cur, "right", false)], gesture: "right click", at: cur, ripple: true });
          }
          continue;
        }
        this.held.set(e.hand, { kind, mode: "none", dragging: false });
        continue;
      }
      // end events
      if (!h) continue;
      this.held.delete(e.hand);
      const last = cur ?? h.last;
      if (h.mode === "arrange") out.push({ type: "arrange", hand: e.hand, phase: "end", pick: last, ray: rays[e.hand], kind: h.kind });
      else if (h.mode === "mac" && h.kind === "select" && last) {
        if (h.dragging) out.push({ type: "send", hand: e.hand, messages: [moveTo(last), buttonAt(last, "left", false)], gesture: "drag end", at: last });
        else out.push({ type: "send", hand: e.hand, messages: [moveTo(last), buttonAt(last, "left", true), buttonAt(last, "left", false)], gesture: "click", at: last, ripple: true });
      }
    }

    for (const hand of ["left", "right"] as Hand[]) {
      const cur = now[hand];
      const h = this.held.get(hand);
      if (h?.mode === "arrange") { out.push({ type: "arrange", hand, phase: "move", pick: cur, ray: rays[hand], kind: h.kind }); if (cur) h.last = cur; continue; }
      if (h?.mode === "mac" && h.kind === "select" && h.start && cur && cur.key === h.start.key) {
        h.last = cur;
        if (!h.dragging) {
          const travel = Math.hypot((cur.x - h.start.x) * cur.width, (cur.y - h.start.y) * cur.height);
          if (travel > DRAG_METRES) { h.dragging = true; out.push({ type: "send", hand, messages: [moveTo(h.start), buttonAt(h.start, "left", true), moveTo(cur)], gesture: "drag start", at: cur }); }
        } else out.push({ type: "send", hand, messages: [moveTo(cur)], at: cur });
        out.push({ type: "hover", hand, pick: cur });
        continue;
      }
      if (h?.mode === "mac" && h.kind === "select" && cur) h.last = cur;
      out.push({ type: "hover", hand, pick: cur });
      if (policy.ray && cur && !cur.ui && !h) {
        const lh = this.lastHover.get(hand);
        const moved = !lh?.pick || lh.pick.key !== cur.key || Math.hypot(lh.pick.x - cur.x, lh.pick.y - cur.y) > HOVER_EPS;
        if (moved && (!lh || time - lh.t >= HOVER_MS)) { this.lastHover.set(hand, { t: time, pick: cur }); out.push({ type: "send", hand, messages: [moveTo(cur)], at: cur }); }
      }
    }
    return out;
  }
}
