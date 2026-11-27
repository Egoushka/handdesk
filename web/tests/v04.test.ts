import { describe, expect, it } from "vitest";
import { ArrangeDrag } from "../src/input/arrange";
import { DRAG_METRES, PointerRouter, type Pick, type PointerAction, type SelectEvent } from "../src/input/pointer";
import { TAP_MS, Trackpad, type TrackpadTarget } from "../src/input/trackpad";
import { GestureLog, RIPPLE_MS, hudLines, rippleAt, strongestPinch, trackingText } from "../src/feedback/feedback";
import { MODES, WristFlip, isMode, loadMode, modeInfo, nextMode, policyOf, saveMode, type Mode } from "../src/modes/modes";
import { intersect, type Panel } from "../src/panel";
import type { Hand, HandFrame, Ray, Vec3 } from "../src/gesture/types";
import { SPAWN_DISTANCE, SPAWN_WIDTH, headDistance, panelInFront, panelOutline, pulledDistance, surfaceAt, withDistance } from "../src/space/surface";
import { handlesOf } from "../src/space/handles";
import { recenterPanels } from "../src/space/layout";
import { makeHand } from "./fixtures";

const flat: Panel = { display: 0, center: { x: 0, y: 1.6, z: -1.4 }, yaw: 0, width: 1.3, height: 0.8, curve: 0 };
const curved: Panel = { ...flat, curve: 0.5 };
const ray = (x: number, y: number, z = 0): Ray => ({ origin: { x: 0, y: 1.6, z }, direction: { x, y, z: -1.4 - z } });

/** The pick function the page builds: Mac panel hits as Picks, plus an optional UI panel. */
const picker = (panels: Panel[], ui?: { panel: Panel; id: string }) => (r: Ray): Pick | undefined => {
  if (ui) { const h = intersect(r, ui.panel); if (h) return { key: ui.id, ui: ui.id, display: -1, x: h.x, y: h.y, width: ui.panel.width, height: ui.panel.height, t: h.t }; }
  for (const p of panels) {
    const h = intersect(r, p);
    if (h) return { key: `d${p.display}`, display: p.display, window: p.windowId, x: h.x, y: h.y, width: p.width, height: p.height, t: h.t };
  }
  return undefined;
};
const sends = (a: PointerAction[]) => a.filter((x): x is Extract<PointerAction, { type: "send" }> => x.type === "send");
const ev = (type: SelectEvent["type"], hand: Hand = "right"): SelectEvent => ({ type, hand });

describe("modes", () => {
  it("has the six modes, cycles through all of them and round-trips storage", () => {
    expect(MODES.map((m) => m.id)).toEqual(["point", "touch", "trackpad", "type", "arrange", "real"]);
    let m: Mode = "point";
    const seen = new Set<Mode>();
    for (let i = 0; i < 6; i++) { seen.add(m); m = nextMode(m); }
    expect(seen.size).toBe(6);
    expect(m).toBe("point");
    const s = new Map<string, string>();
    const store = { getItem: (k: string) => s.get(k) ?? null, setItem: (k: string, v: string) => void s.set(k, v) };
    expect(loadMode(store)).toBe("point");
    saveMode(store, "trackpad");
    expect(loadMode(store)).toBe("trackpad");
    s.set("handdesk.mode", "nonsense");
    expect(loadMode(store)).toBe("point");
    expect(isMode("real")).toBe(true);
    expect(modeInfo("real").label).toBe("Real devices");
  });
  it("each mode allows exactly its own way to drive the Mac", () => {
    expect(policyOf("point")).toMatchObject({ ray: true, touch: false, trackpad: false, keyboard: false, arrange: false });
    expect(policyOf("touch")).toMatchObject({ ray: false, touch: true });
    expect(policyOf("trackpad")).toMatchObject({ ray: false, trackpad: true });
    expect(policyOf("type")).toMatchObject({ ray: true, keyboard: true });
    expect(policyOf("arrange")).toMatchObject({ ray: false, arrange: true, shortcuts: false });
    expect(policyOf("real")).toMatchObject({ ray: false, touch: false, trackpad: false, keyboard: false, arrange: true, shortcuts: false });
  });
});

describe("wrist flip", () => {
  const at = { x: 0, y: 1, z: -0.4 };
  const pose = (up: boolean, side: Hand = "left"): HandFrame => {
    const h = makeHand({ hand: side, palm: { x: 0, y: 0, z: 0 } });
    const joints: HandFrame["joints"] = {};
    for (const [k, p0] of Object.entries(h.joints)) {
      const p = side === "left" ? { ...p0!, x: -p0!.x } : p0!;
      const q = up ? p : { x: -p.x, y: -p.y, z: p.z };
      joints[k as keyof typeof joints] = { x: q.x + at.x, y: q.y + at.y, z: q.z + at.z };
    }
    return { hand: side, joints };
  };
  const run = (steps: [number, boolean][], side: Hand = "left") => { const f = new WristFlip(); return steps.map(([t, up]) => f.update(t, [pose(up, side)])); };
  it("down, up, down quickly changes mode once", () => {
    expect(run([[0, false], [100, false], [200, true], [300, true], [400, false]]).filter(Boolean)).toHaveLength(1);
  });
  it("a slow hold of the palm up (the menu) does not", () => {
    expect(run([[0, false], [100, true], [300, true], [500, true], [700, true], [900, false]]).filter(Boolean)).toHaveLength(0);
  });
  it("two flips in a row inside the cooldown count once; the right hand never flips", () => {
    expect(run([[0, false], [100, true], [200, false], [300, true], [400, false]]).filter(Boolean)).toHaveLength(1);
    expect(run([[0, false], [100, true], [200, false]], "right").filter(Boolean)).toHaveLength(0);
  });
});

describe("panel surface", () => {
  it("a point on the surface is where a ray through it lands, flat and curved, turned or not", () => {
    for (const p of [flat, curved, { ...curved, yaw: 0.4, center: { x: 1, y: 1.2, z: -1 } }]) {
      for (const [x, y] of [[0.5, 0.5], [0.1, 0.9], [0.95, 0.2]] as const) {
        const target = surfaceAt(p, x, y).pos;
        const origin: Vec3 = { x: p.center.x * 0.2, y: 1.6, z: 0 };
        const h = intersect({ origin, direction: { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z } }, p)!;
        expect(h.x).toBeCloseTo(x, 4);
        expect(h.y).toBeCloseTo(y, 4);
      }
    }
  });
  it("lifting moves the point towards the viewer, not sideways", () => {
    const a = surfaceAt(flat, 0.5, 0.5, 0).pos, b = surfaceAt(flat, 0.5, 0.5, 0.01).pos;
    expect(b.z - a.z).toBeCloseTo(0.01, 6);
    expect(surfaceAt(curved, 0.9, 0.5).yaw).toBeLessThan(0); // the right edge of a curved panel turns towards the viewer
  });
  it("the outline is a closed loop around the edge that grows on request", () => {
    const o = panelOutline(flat, 4);
    expect(o).toHaveLength(16);
    const big = panelOutline(flat, 4, 0.004, 0.1);
    expect(Math.abs(big[0]!.x - big[4]!.x)).toBeGreaterThan(Math.abs(o[0]!.x - o[4]!.x));
  });
  it("distance: closer and farther keep the direction and clamp", () => {
    const head = { x: 0, y: 1.6, z: 0 };
    const near = withDistance(flat, head, 1);
    expect(headDistance(near, head)).toBeCloseTo(1, 5);
    expect(near.center.x).toBeCloseTo(0, 5);
    expect(headDistance(withDistance(flat, head, 0.1), head)).toBeCloseTo(0.6, 5);
    expect(headDistance(withDistance(flat, head, 99), head)).toBeCloseTo(4, 5);
    expect(near.width).toBe(flat.width);
  });
  it("pinch-pull: hand towards the body brings the panel in, away pushes it out, never past the limits", () => {
    expect(pulledDistance(1.4, 0.4, 0.3)).toBeLessThan(1.4);
    expect(pulledDistance(1.4, 0.4, 0.5)).toBeGreaterThan(1.4);
    expect(pulledDistance(1.4, 0.4, 0.4)).toBeCloseTo(1.4, 6);
    expect(pulledDistance(1.4, 0.4, 0.05)).toBeGreaterThanOrEqual(0.6);
    expect(pulledDistance(1.4, 0.4, 5)).toBe(4);
  });
  it("spawn: 1.4 m, eye height, 1.3 m wide, and a snapped panel faces the head", () => {
    expect(SPAWN_DISTANCE).toBeGreaterThanOrEqual(1.2); expect(SPAWN_DISTANCE).toBeLessThanOrEqual(1.6); expect(SPAWN_WIDTH).toBe(1.3);
    const head = { position: { x: 1, y: 1.6, z: 2 }, yaw: Math.PI / 2 };
    const [r] = recenterPanels([flat], head);
    expect(r!.center.y).toBeCloseTo(1.6, 6);
    expect(Math.hypot(r!.center.x - 1, r!.center.z - 2)).toBeCloseTo(SPAWN_DISTANCE, 6);
    const s = panelInFront({ ...flat, curve: 0.3 }, head);
    expect(s.center.x).toBeCloseTo(1 + SPAWN_DISTANCE, 6);
    expect(s.yaw).toBeCloseTo(-Math.PI / 2, 6);
    expect(s.curve).toBe(0.3);
  });
});

describe("pointer router (system select ray)", () => {
  const P = policyOf("point");
  const pick = picker([flat]);
  it("a select that stays put is one click at the aim point, with a ripple", () => {
    const rt = new PointerRouter();
    rt.update(0, { right: ray(0.1, 0) }, [ev("selectstart")], pick, P);
    const a = sends(rt.update(100, { right: ray(0.1, 0) }, [ev("selectend")], pick, P)).find((s) => s.gesture === "click")!;
    expect(a.ripple).toBe(true);
    expect(a.messages.map((m) => m.type + (m.type === "button" ? String(m.down) : ""))).toEqual(["move", "buttontrue", "buttonfalse"]);
    expect(a.messages[1]).toMatchObject({ display: 0, button: "left" });
  });
  it("sub-threshold jitter is still a click, past the threshold it is a drag from where the pinch began", () => {
    const rt = new PointerRouter();
    rt.update(0, { right: ray(0, 0) }, [ev("selectstart")], pick, P);
    const jitter = rt.update(16, { right: ray(0.01, 0) }, [], pick, P);
    expect(sends(jitter).filter((s) => s.gesture)).toHaveLength(0);
    const m = sends(rt.update(32, { right: ray(0.1, 0.03) }, [], pick, P)).find((s) => s.gesture === "drag start")!;
    expect(m.messages[1]).toMatchObject({ type: "button", down: true });
    expect(m.messages[0]).toMatchObject({ type: "move", x: 0.5, y: 0.5 });
    const more = sends(rt.update(48, { right: ray(0.2, 0.03) }, [], pick, P));
    expect(more[0]!.messages[0]!.type).toBe("move");
    const end = sends(rt.update(64, { right: ray(0.2, 0.03) }, [ev("selectend")], pick, P)).find((s) => s.gesture === "drag end")!;
    expect(end.messages[1]).toMatchObject({ type: "button", down: false });
    expect(sends(rt.update(80, { right: ray(0.2, 0.03) }, [], pick, P)).some((s) => s.messages.some((x) => x.type === "button"))).toBe(false);
    expect(DRAG_METRES).toBeGreaterThan(0.005);
  });
  it("squeeze is a right click", () => {
    const rt = new PointerRouter();
    const a = sends(rt.update(0, { right: ray(0, 0) }, [ev("squeezestart")], pick, P)).find((s) => s.gesture === "right click")!;
    expect(a.messages[1]).toMatchObject({ button: "right", down: true });
  });
  it("a select in empty space or with no ray does nothing", () => {
    const rt = new PointerRouter();
    rt.update(0, { right: ray(9, 0) }, [ev("selectstart")], pick, P);
    expect(sends(rt.update(50, { right: ray(9, 0) }, [ev("selectend")], pick, P)).filter((s) => s.gesture)).toHaveLength(0);
    rt.update(60, {}, [ev("selectstart", "left")], pick, P);
    expect(sends(rt.update(70, {}, [ev("selectend", "left")], pick, P))).toHaveLength(0);
  });
  it("hover moves the Mac cursor, throttled and only when the aim moved", () => {
    const rt = new PointerRouter();
    expect(sends(rt.update(0, { right: ray(0, 0) }, [], pick, P))).toHaveLength(1);
    expect(sends(rt.update(5, { right: ray(0.1, 0) }, [], pick, P))).toHaveLength(0);
    expect(sends(rt.update(40, { right: ray(0.1, 0) }, [], pick, P))).toHaveLength(1);
    expect(sends(rt.update(80, { right: ray(0.1, 0) }, [], pick, P))).toHaveLength(0);
    const hov = rt.update(120, { right: ray(0.1, 0) }, [], pick, P).find((a) => a.type === "hover" && a.hand === "right");
    expect(hov).toMatchObject({ type: "hover", pick: { key: "d0" } });
  });
  it("touch, trackpad and real modes never click on the Mac from the select ray", () => {
    for (const m of ["touch", "trackpad", "real", "arrange"] as Mode[]) {
      const rt = new PointerRouter();
      rt.update(0, { right: ray(0, 0) }, [ev("selectstart")], pick, policyOf(m));
      const out = rt.update(50, { right: ray(0, 0) }, [ev("selectend")], pick, policyOf(m));
      expect(sends(out), m).toHaveLength(0);
    }
  });
  it("a select on a UI panel is a UI click in every mode and never reaches the Mac", () => {
    const ui = { panel: { ...flat, display: -1, center: { x: 0, y: 1.6, z: -1 }, width: 0.5, height: 0.5 }, id: "menu" };
    for (const m of MODES.map((x) => x.id)) {
      const rt = new PointerRouter();
      const out = rt.update(0, { right: ray(0, 0, 0) }, [ev("selectstart")], picker([flat], ui), policyOf(m));
      expect(out.find((a) => a.type === "ui"), m).toMatchObject({ id: "menu" });
      expect(sends(rt.update(40, { right: ray(0, 0) }, [ev("selectend")], picker([flat], ui), policyOf(m))).filter((s) => s.gesture)).toHaveLength(0);
    }
  });
  it("arrange: select start, move and end are passed on with the ray", () => {
    const rt = new PointerRouter();
    const A = policyOf("arrange");
    expect(rt.update(0, { right: ray(0, 0) }, [ev("selectstart")], pick, A).find((a) => a.type === "arrange")).toMatchObject({ phase: "start", kind: "select" });
    expect(rt.update(10, { right: ray(0.1, 0) }, [], pick, A).find((a) => a.type === "arrange")).toMatchObject({ phase: "move" });
    expect(rt.update(20, { right: ray(0.1, 0) }, [ev("selectend")], pick, A).find((a) => a.type === "arrange")).toMatchObject({ phase: "end" });
    expect(rt.update(30, { right: ray(0.1, 0) }, [], pick, A).find((a) => a.type === "arrange")).toBeUndefined();
  });
});

describe("air trackpad", () => {
  const target: TrackpadTarget = { key: "d0", display: 0, width: 1.3, height: 0.8 };
  const tip = (x: number, y = 1, z = -0.4): Vec3 => ({ x, y, z });
  const setup = () => { const t = new Trackpad(); t.retarget(target); return t; };
  it("does nothing without a target", () => {
    expect(new Trackpad().update(0, { right: tip(0) }, 0, [ev("selectstart")])).toEqual([]);
  });
  it("a pinch moves the cursor by the hand's travel in the head's frame", () => {
    const t = setup();
    t.update(0, { right: tip(0) }, 0, [ev("selectstart")]);
    const a = t.update(16, { right: tip(0.1) }, 0, [])[0]!;
    expect(a.messages[0]).toMatchObject({ type: "move", display: 0 });
    expect(t.pick!.x).toBeGreaterThan(0.5);
    const x1 = t.pick!.x;
    const turned = setup();
    turned.update(0, { right: tip(0, 1, -0.4) }, Math.PI / 2, [ev("selectstart")]);
    turned.update(16, { right: tip(0, 1, -0.3) }, Math.PI / 2, []);
    expect(turned.pick!.x).toBeGreaterThan(0.5); // the head turned right: +z is to its right
    expect(x1).toBeCloseTo(0.5 + (0.1 * 3) / 1.3, 6);
    t.update(32, { right: tip(0.1, 1.1) }, 0, []);
    expect(t.pick!.y).toBeLessThan(0.5); // hand up, cursor up
  });
  it("the cursor stays on the panel", () => {
    const t = setup();
    t.update(0, { right: tip(0) }, 0, [ev("selectstart")]);
    t.update(16, { right: tip(5) }, 0, []);
    expect(t.pick!.x).toBe(1);
  });
  it("a short still pinch taps; a long still pinch holds and drags; a squeeze right-clicks", () => {
    const t = setup();
    t.update(0, { right: tip(0) }, 0, [ev("selectstart")]);
    const tap = t.update(TAP_MS - 50, { right: tip(0) }, 0, [ev("selectend")]).find((a) => a.gesture === "tap")!;
    expect(tap.messages.filter((m) => m.type === "button")).toHaveLength(2);
    const h = setup();
    h.update(0, { right: tip(0) }, 0, [ev("selectstart")]);
    const down = h.update(500, { right: tip(0) }, 0, []).find((a) => a.gesture === "hold")!;
    expect(down.messages[1]).toMatchObject({ type: "button", down: true });
    const up = h.update(900, { right: tip(0.1) }, 0, [ev("selectend")]).find((a) => a.gesture === "drag end")!;
    expect(up.messages[0]).toMatchObject({ type: "button", down: false });
    expect(setup().update(0, {}, 0, [ev("squeezestart")]).find((a) => a.gesture === "right click")!.messages[1]).toMatchObject({ button: "right" });
  });
  it("a long pinch that moved is not a tap or a hold", () => {
    const t = setup();
    t.update(0, { right: tip(0) }, 0, [ev("selectstart")]);
    t.update(100, { right: tip(0.1) }, 0, []);
    expect(t.update(200, { right: tip(0.1) }, 0, [ev("selectend")]).some((a) => a.gesture)).toBe(false);
  });
  it("the left hand pinch scrolls: hand up scrolls the content up", () => {
    const t = setup();
    t.update(0, { left: tip(0) }, 0, [ev("selectstart", "left")]);
    const s = t.update(16, { left: tip(0, 1.05) }, 0, [])[0]!;
    expect(s.messages[0]).toMatchObject({ type: "scroll", dx: 0 });
    expect((s.messages[0] as { dy: number }).dy).toBeLessThan(0);
  });
});

describe("arrange drag", () => {
  const head: Vec3 = { x: 0, y: 1.6, z: 0 };
  const none = () => undefined;
  it("a select on the body moves the panel in its plane and keeps its distance", () => {
    const a = new ArrangeDrag();
    const grabbed = a.start(ray(0, 0), [flat], { x: 0.2, y: 1.3, z: -0.4 }, head, none)!;
    expect(grabbed).toBe(flat);
    const p = a.move(ray(0.7, 0), { x: 0.2, y: 1.3, z: -0.4 }, head)!;
    expect(p.center.x).toBeCloseTo(0.7, 1);
    expect(p.center.z).toBeCloseTo(flat.center.z, 6);
    a.end();
    expect(a.active).toBe(false);
  });
  it("pulling the hand towards the head while pinching brings the panel closer; small drift does not", () => {
    const a = new ArrangeDrag();
    a.start(ray(0, 0), [flat], { x: 0, y: 1.3, z: -0.5 }, head, none);
    expect(a.move(ray(0, 0), { x: 0, y: 1.3, z: -0.52 }, head)!.center.z).toBeCloseTo(-1.4, 6);
    const near = a.move(ray(0, 0), { x: 0, y: 1.3, z: -0.25 }, head)!;
    expect(headDistance(near, head)).toBeLessThan(headDistance(flat, head));
    const far = a.move(ray(0, 0), { x: 0, y: 1.3, z: -0.75 }, head)!;
    expect(headDistance(far, head)).toBeGreaterThan(headDistance(flat, head));
  });
  it("a select on a corner handle scales; with handles hidden it moves instead; empty space grabs nothing", () => {
    const a = new ArrangeDrag();
    const corner = surfaceAt(flat, 1, 0).pos;
    const aim = (x: number, y: number): Ray => ({ origin: head, direction: { x: x - head.x, y: y - head.y, z: -1.4 } });
    expect(a.start(aim(corner.x, corner.y), [flat], undefined, head, (p) => handlesOf(p))).toBe(flat);
    const scaled = a.move(aim(corner.x * 1.5, corner.y + 0.5 * (corner.y - flat.center.y)), undefined, head)!;
    expect(scaled.width).toBeGreaterThan(flat.width);
    expect(new ArrangeDrag().start(ray(9, 0), [flat], undefined, head, none)).toBeUndefined();
    expect(new ArrangeDrag().move(ray(0, 0), undefined, head)).toBeUndefined();
  });
});

describe("arrange on snips", () => {
  const head: Vec3 = { x: 0, y: 1.6, z: 0 };
  const snip: Panel = { ...flat, crop: { x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.6 }, curve: 0 };
  const pinAt = surfaceAt(snip, 0.4, -0.1).pos;
  it("the pin and close handles go to the special callback and start no grab", () => {
    const seen: string[] = [];
    const a = new ArrangeDrag();
    const handles = (p: Panel) => [{ kind: "pin" as const, pos: surfaceAt(p, 0.4, -0.1).pos }, { kind: "close" as const, pos: surfaceAt(p, 0.6, -0.1).pos }];
    const aim = { origin: head, direction: { x: pinAt.x - head.x, y: pinAt.y - head.y, z: pinAt.z - head.z } };
    expect(a.start(aim, [snip], undefined, head, handles, (_p, k) => { seen.push(k); return true; })).toBeUndefined();
    expect(seen).toEqual(["pin"]);
    expect(a.active).toBe(false);
  });
  it("a corner drag on a snip never curves it", () => {
    const a = new ArrangeDrag();
    const t = surfaceAt(snip, 0.5, 0.5).pos;
    a.start({ origin: head, direction: { x: t.x - head.x, y: t.y - head.y, z: t.z - head.z } }, [snip], undefined, head, () => undefined);
    expect(a.move({ origin: head, direction: { x: 0.3, y: 0, z: -1.4 } }, undefined, head)!.curve).toBe(0);
  });
});

describe("feedback", () => {
  it("the gesture log keeps the last 10, newest first, and merges a quick repeat", () => {
    const g = new GestureLog();
    for (let i = 0; i < 14; i++) g.add(`g${i}`, i * 1000, "right");
    expect(g.items).toHaveLength(10);
    expect(g.items[0]!.name).toBe("g13");
    g.add("g13", 13050, "right");
    expect(g.items).toHaveLength(10);
    expect(g.lines(14000)[0]).toMatch(/0\.9s\s+R g13/);
  });
  it("the HUD names the mode, the last gesture, the pinch and the tracking state", () => {
    const l = hudLines({ mode: "trackpad", last: { name: "tap", hand: "right", time: 900 }, pinch: 0.5, tracking: "both hands", now: 1000 });
    expect(l[0]).toBe("Mode: Trackpad");
    expect(l[1]).toBe("Gesture: right tap");
    expect(l[2]).toContain("50%");
    expect(l[3]).toBe("Tracking: both hands");
    expect(hudLines({ mode: "point", pinch: 0, tracking: "hands lost", now: 9000, last: { name: "x", time: 0 } })[1]).toBe("Gesture: none yet");
  });
  it("tracking text and pinch strength follow the hands", () => {
    const h = makeHand({});
    expect(trackingText(false, [h, { ...h, hand: "left" }])).toBe("both hands");
    expect(trackingText(false, [h])).toBe("right hand only");
    expect(trackingText(true, [h])).toBe("hands lost");
    expect(strongestPinch([])).toBe(0);
    expect(strongestPinch([makeHand({ thumbToIndex: 0 })])).toBeGreaterThan(0.9);
  });
  it("a ripple grows and fades, then ends", () => {
    const a = rippleAt(0)!, b = rippleAt(RIPPLE_MS / 2)!;
    expect(b.radius).toBeGreaterThan(a.radius);
    expect(b.opacity).toBeLessThan(a.opacity);
    expect(rippleAt(RIPPLE_MS + 1)).toBeUndefined();
  });
});
