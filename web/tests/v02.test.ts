import { describe, expect, it } from "vitest";
import { HintTracker } from "../src/onboarding/hints";
import { PalmMenuDetector, introDone, isPalmUp, markIntroDone } from "../src/onboarding/palm";
import { Stats, permissionProblems, statusLine } from "../src/onboarding/status";
import { BONES, TrackingState, pinchStrength } from "../src/hands/rig";
import { DirectTouch } from "../src/space/touch";
import { dragHandle, handlesOf, handlesVisible, pickHandle } from "../src/space/handles";
import { ENVIRONMENTS, loadLayout, nextEnvironment, recenterPanels, saveLayout } from "../src/space/layout";
import { MacState, editQuery, isVirtual, launcherRows, parseMacMessage, rowIndexAt } from "../src/mac/state";
import { buildLayout } from "../src/keyboard/layouts";
import { gestureToMessages } from "../src/protocol";
import { applyGrab, pickPanel, planePoint, type Panel } from "../src/panel";
import { PALM0, lShape, makeHand, open, pinch, rollHand, three, at } from "./fixtures";
import type { InputFrame, JointName } from "../src/gesture/types";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("intro flag and palm-up menu", () => {
  it("first run shows the intro once", () => {
    const s = mem();
    expect(introDone(s)).toBe(false);
    markIntroDone(s);
    expect(introDone(s)).toBe(true);
  });
  const up = (hand: "left" | "right" = "left") => rollHand(open({ hand }), Math.PI);
  it("a left palm facing up is detected, palm down is not", () => {
    expect(isPalmUp(up())).toBe(true);
    expect(isPalmUp(open({ hand: "left" }))).toBe(false);
  });
  it("a closed fist with the palm up is not a menu", () => {
    expect(isPalmUp(rollHand(makeHand({ hand: "left", index: "curl", middle: "curl", ring: "curl", pinky: "curl" }), Math.PI))).toBe(false);
  });
  it("opens after the hold time, closes when the palm turns away", () => {
    const d = new PalmMenuDetector(400);
    expect(d.update(0, [up()])).toBe(false);
    expect(d.update(300, [up()])).toBe(false);
    expect(d.update(450, [up()])).toBe(true);
    expect(d.update(500, [open({ hand: "left" })])).toBe(false);
    expect(d.update(600, [up()])).toBe(false);
  });
  it("only the left hand opens it", () => {
    const d = new PalmMenuDetector(100);
    d.update(0, [up("right")]);
    expect(d.update(500, [up("right")])).toBe(false);
  });
});

describe("hints", () => {
  const frame = (t: number, ...hands: InputFrame["hands"]): InputFrame => ({ time: t, hands, controllers: [] });
  const run = (build: (t: number) => InputFrame["hands"], ms: number) => {
    const h = new HintTracker();
    let last: string | undefined;
    for (let t = 0; t <= ms; t += 33) last = h.update(frame(t, ...build(t)))?.text;
    return last;
  };
  it("a thumb that stays near the index without closing says to close the pinch", () => {
    expect(run(() => [makeHand({ thumbToIndex: 0.035 })], 1200)).toBe("Close the pinch to click");
  });
  it("a closed pinch says nothing about closing", () => {
    expect(run(() => [pinch()], 600)).toBeUndefined();
  });
  it("three fingers held still says to swipe", () => {
    expect(run(() => [three()], 1200)).toBe("Swipe 10 cm sideways or up");
  });
  it("three fingers that move do not get the hint", () => {
    expect(run((t) => [three({ palm: at(PALM0, t / 5000) })], 1200)).toBeUndefined();
  });
  it("an L shape held with no change says to open or close the gap", () => {
    expect(run(() => [lShape(0.06)], 2000)).toBe("Open or close the gap to zoom");
  });
  it("one hand pinching while the other is open suggests both hands", () => {
    expect(run(() => [pinch({ hand: "left" }), open({ hand: "right" })], 1400)).toBe("Pinch with both hands to move the panel");
  });
  it("an open hand gets no hint", () => {
    expect(run(() => [open()], 3000)).toBeUndefined();
  });
});

describe("status", () => {
  it("latency and fps", () => {
    const s = new Stats();
    s.onPong(100, 120);
    expect(s.rtt).toBe(20);
    for (let t = 0; t <= 1000; t += 20) s.onFrame(t);
    expect(s.fps).toBeGreaterThan(45);
  });
  it("permission problems read as plain sentences", () => {
    expect(permissionProblems({ screenRecording: false, accessibility: true })).toEqual(["Screen Recording is not granted on the Mac"]);
    expect(permissionProblems({ screenRecording: true, accessibility: true })).toEqual([]);
    expect(statusLine("Connected", new Stats(), { screenRecording: false, accessibility: true })).toContain("Screen Recording");
  });
});

describe("hand rig and tracking state", () => {
  const JOINTS = new Set(Object.keys(open().joints));
  it("bones use only the 25 joints and every joint is connected", () => {
    const used = new Set<JointName>();
    for (const [a, b] of BONES) { expect(JOINTS.has(a)).toBe(true); expect(JOINTS.has(b)).toBe(true); used.add(a); used.add(b); }
    expect(used.size).toBe(25);
  });
  it("pinch strength goes from 0 open to 1 closed", () => {
    expect(pinchStrength(open())).toBe(0);
    expect(pinchStrength(pinch())).toBe(1);
    const half = pinchStrength(makeHand({ thumbToIndex: 0.05 }));
    expect(half).toBeGreaterThan(0.1);
    expect(half).toBeLessThan(0.9);
  });
  it("tracking is lost after 600 ms without a hand and restored when one returns", () => {
    const t = new TrackingState(600);
    expect(t.update(0, 1)).toBeUndefined();
    expect(t.update(300, 0)).toBeUndefined();
    expect(t.update(700, 0)).toBe("lost");
    expect(t.lost).toBe(true);
    expect(t.update(800, 0)).toBeUndefined();
    expect(t.update(900, 1)).toBe("restored");
    expect(t.lost).toBe(false);
  });
  it("no hands from the start counts as lost after the same delay", () => {
    const t = new TrackingState(600);
    t.update(0, 0);
    expect(t.update(650, 0)).toBe("lost");
  });
});

const flat: Panel = { display: 0, center: { x: 0, y: 1.2, z: -0.5 }, yaw: 0, width: 0.6, height: 0.4, curve: 0 };
const head = { x: 0, y: 1.4, z: 0 };
describe("direct touch", () => {
  const tipAt = (z: number, x = 0, y = 1.2) => [{ id: "r", pos: { x, y, z } }];
  const run = (zs: number[], panels = [flat], hd = head) => {
    const d = new DirectTouch();
    return zs.flatMap((z) => d.update(tipAt(z), panels, hd));
  };
  it("approach, cross, move, pull back: hover, down, move, up", () => {
    const ev = run([-0.3, -0.45, -0.49, -0.51, -0.52, -0.45]);
    expect(ev.map((e) => e.type)).toEqual(["hover", "down", "move", "up"]);
    expect(ev[1]).toMatchObject({ x: 0.5, y: 0.5 });
  });
  it("a quick cross and return is down then up", () => {
    expect(run([-0.3, -0.49, -0.52, -0.4]).map((e) => e.type)).toEqual(["hover", "down", "up"]);
  });
  it("a fingertip that starts behind the panel never presses", () => {
    expect(run([-0.6, -0.58, -0.56]).map((e) => e.type)).toEqual([]);
  });
  it("a panel beyond arm's reach is not touchable", () => {
    const far = { ...flat, center: { x: 0, y: 1.2, z: -2 } };
    const d = new DirectTouch();
    const ev = [-1.8, -1.95, -2.05].flatMap((z) => d.update(tipAt(z), [far], head));
    expect(ev).toEqual([]);
  });
  it("outside the panel's bounds nothing happens", () => {
    const d = new DirectTouch();
    const ev = [-0.3, -0.45, -0.52].flatMap((z) => d.update(tipAt(z, 0.9), [flat], head));
    expect(ev).toEqual([]);
  });
  it("losing the finger while pressed releases", () => {
    const d = new DirectTouch();
    d.update(tipAt(-0.3), [flat], head);
    d.update(tipAt(-0.49), [flat], head);
    d.update(tipAt(-0.52), [flat], head);
    expect(d.update([], [flat], head).map((e) => e.type)).toEqual(["up"]);
  });
});

describe("handles, layout and recenter", () => {
  it("six handles on the panel's corners, top and bottom", () => {
    expect(handlesOf(flat).map((h) => h.kind).sort()).toEqual(["curve", "move", "scale-bl", "scale-br", "scale-tl", "scale-tr"]);
  });
  it("handles show only when a hand is near the panel", () => {
    expect(handlesVisible({ x: 0, y: 1.2, z: -0.3 }, flat)).toBe(true);
    expect(handlesVisible({ x: 0, y: 1.2, z: 0.5 }, flat)).toBe(false);
  });
  it("a ray at a corner picks the scale handle, one in the middle picks none", () => {
    const corner = handlesOf(flat).find((h) => h.kind === "scale-tr")!.pos;
    const ray = { origin: head, direction: { x: corner.x - head.x, y: corner.y - head.y, z: corner.z - head.z } };
    expect(pickHandle(ray, flat)?.kind).toBe("scale-tr");
    expect(pickHandle({ origin: head, direction: { x: 0, y: -0.2, z: -1 } }, flat)).toBeUndefined();
  });
  it("dragging a corner outward doubles the panel, the move handle translates, the curve handle bends", () => {
    expect(dragHandle(flat, "scale-tr", { x: 0.3, y: 0.2, z: 0 }, { x: 0.6, y: 0.4, z: 0 }).width).toBeCloseTo(1.2);
    expect(dragHandle(flat, "move", { x: 0, y: 0, z: 0 }, { x: 0.1, y: 0.2, z: 0 }).center).toMatchObject({ x: 0.1, y: 1.4 });
    expect(dragHandle(flat, "curve", { x: 0, y: 0, z: 0 }, { x: 0.3, y: 0, z: 0 }).curve).toBeCloseTo(1);
    expect(dragHandle(flat, "scale-tr", { x: 0.3, y: 0.2, z: 0 }, { x: 30, y: 20, z: 0 }).width).toBeLessThanOrEqual(2.4);
  });
  it("planePoint gives the local crossing point", () => {
    expect(planePoint({ origin: head, direction: { x: 0, y: -0.2 / 0.9 * 0, z: -1 } }, flat)).toBeDefined();
  });
  it("layout round-trips and bad data is ignored", () => {
    const s = mem();
    saveLayout(s, { version: 1, panels: [{ key: "display:0", center: { x: 0, y: 1, z: -1 }, yaw: 0.1, width: 2, height: 1, curve: 0.5 }], env: "night" });
    expect(loadLayout(s)?.env).toBe("night");
    expect(loadLayout(s)?.panels).toHaveLength(1);
    s.setItem("handdesk.layout.default", "{nope");
    expect(loadLayout(s)).toBeUndefined();
    s.setItem("handdesk.layout.default", JSON.stringify({ version: 1, env: "night", panels: [{ key: "x", center: { x: 0, y: 0, z: 0 }, yaw: 0, width: 1e9, height: 1, curve: 0 }] }));
    expect(loadLayout(s)?.panels).toHaveLength(0);
  });
  it("recenter puts panels in a row in front of a turned head and keeps their size", () => {
    const [a, b] = recenterPanels([{ ...flat, width: 1 }, { ...flat, display: 1, width: 2 }], { position: { x: 1, y: 1.6, z: 0 }, yaw: Math.PI / 2 }, 2);
    expect(a!.width).toBe(1);
    expect(a!.center.x).toBeGreaterThan(2.5);
    expect(a!.yaw).toBeCloseTo(-Math.PI / 2);
    expect(Math.abs(b!.center.z - a!.center.z)).toBeCloseTo(1.6, 1);
  });
  it("environments cycle through all choices", () => {
    let e = ENVIRONMENTS[0]!.id;
    const seen = new Set([e]);
    for (let i = 0; i < ENVIRONMENTS.length; i++) { e = nextEnvironment(e); seen.add(e); }
    expect(seen.size).toBe(ENVIRONMENTS.length);
  });
  it("applyGrab keeps window ids", () => {
    expect(applyGrab({ ...flat, windowId: 5 }, { x: 0, y: 0, z: 0 }, 1, 0).windowId).toBe(5);
  });
});

describe("Mac messages and launcher", () => {
  it("parses windows, apps, spotlight, displays and drops malformed entries", () => {
    expect(parseMacMessage('{"type":"windows","windows":[{"id":1,"app":"A","pid":2,"title":"t","x":0,"y":0,"width":100,"height":100},{"id":"bad"}]}')).toMatchObject({ windows: [{ id: 1 }] });
    expect(parseMacMessage('{"type":"apps","apps":[{"name":"Safari","bundleId":"com.apple.Safari","pid":3,"active":true}]}')).toMatchObject({ type: "apps" });
    expect(parseMacMessage('{"type":"spotlightResults","query":"s","results":[{"id":1,"name":"Safari","kind":"app","path":"/Applications/Safari.app"}]}')).toMatchObject({ results: [{ id: 1 }] });
    expect(parseMacMessage('{"type":"virtualDisplay","ok":false,"error":"nope"}')).toMatchObject({ ok: false });
    expect(parseMacMessage("junk")).toBeUndefined();
    expect(parseMacMessage('{"type":"windows"}')).toBeUndefined();
  });
  it("state keeps the latest of each and reports a virtual display failure", () => {
    const st = new MacState();
    st.apply({ type: "apps", apps: [{ name: "Safari", bundleId: "b", pid: 1, active: false }] });
    st.apply({ type: "virtualDisplay", ok: false, error: "unavailable" });
    expect(st.apps).toHaveLength(1);
    expect(st.notice).toContain("unavailable");
  });
  it("launcher rows have sections and actions: apps activate, results open by id, windows add a panel", () => {
    const st = new MacState();
    st.apply({ type: "apps", apps: [{ name: "Safari", bundleId: "com.apple.Safari", pid: 1, active: false }] });
    st.apply({ type: "spotlightResults", query: "s", results: [{ id: 7, name: "Safari", kind: "app", path: "/x" }] });
    st.apply({ type: "windows", windows: [{ id: 42, app: "Safari", pid: 1, title: "Home", x: 0, y: 0, width: 800, height: 600 }] });
    st.apply({ type: "displays", displays: [{ id: 9, name: "handdesk 1", x: 0, y: 0, width: 2560, height: 1440, pixelWidth: 2560, pixelHeight: 1440 }] });
    const rows = launcherRows(st, "s");
    expect(rows.find((r) => r.action?.kind === "send" && r.action.message.type === "open")).toBeDefined();
    expect(rows.find((r) => r.action?.kind === "send" && r.action.message.type === "app")).toBeDefined();
    expect(rows.find((r) => r.action?.kind === "window")).toMatchObject({ action: { windowId: 42 } });
    expect(rows.find((r) => r.text.startsWith("Remove handdesk"))).toBeDefined();
    expect(isVirtual(st.displays[0]!)).toBe(true);
    expect(rowIndexAt(0.999, rows.length)).toBe(rows.length - 1);
    expect(rowIndexAt(0, rows.length)).toBe(0);
  });
  it("typing into the launcher query", () => {
    const k = (code: string) => buildLayout("en").find((x) => x.code === code)!;
    let q = "";
    for (const c of ["KeyS", "KeyA", "KeyF"]) q = editQuery(q, k(c), false).query;
    expect(q).toBe("saf");
    expect(editQuery(q, k("Backspace"), false).query).toBe("sa");
    expect(editQuery(q, k("Enter"), false).submit).toBe(true);
    expect(editQuery("a", k("KeyB"), true).query).toBe("aB");
    expect(editQuery("x".repeat(64), k("KeyB"), false).query).toHaveLength(64);
  });
  it("a click on a window panel addresses the window, not a display", () => {
    const w: Panel = { ...flat, display: -2, windowId: 123 };
    const r = { origin: head, direction: { x: 0, y: -0.2, z: -0.5 } };
    const h = pickPanel(r, [w])!;
    const out = gestureToMessages({ type: "click", hand: "right", source: "hand", button: "left", ray: r }, () => ({ display: h.hit.display, window: h.hit.window, x: h.hit.x, y: h.hit.y }));
    expect(out[1]).toMatchObject({ type: "button", window: 123, down: true });
    expect((out[1] as { display?: number }).display).toBeUndefined();
  });
});
