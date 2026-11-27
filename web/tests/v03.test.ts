import { describe, expect, it } from "vitest";
import { ExtraGestures, palmNormal, type ExtraEvent } from "../src/gesture/extra";
import { extraToMessages } from "../src/gesture/extraMessages";
import type { Hand, HandFrame, InputFrame, Vec3 } from "../src/gesture/types";
import { HAND_MODES, effectiveHandMode, isHandMode, loadHandMode, nextHandMode, saveHandMode } from "../src/hands/mode";
import { MacState, launcherRows } from "../src/mac/state";
import type { Panel } from "../src/panel";
import { inTitleBand, titleDragCenter } from "../src/space/titledrag";
import { WINDOW_DISTANCE, windowPanel } from "../src/space/windows";
import { sessionInit } from "../src/app/session";
import { makeHand, type HandSpec } from "./fixtures";

type Pose = "palmFwd" | "palmDown" | "palmUp";

/** The fixture hand lies palm up with fingers along -z. Turn it about its wrist so the palm faces `pose`, then move it to `at`. */
function hand(spec: HandSpec, pose: Pose, at: Vec3, side: Hand = "right"): HandFrame {
  const h = makeHand({ ...spec, hand: side, palm: { x: 0, y: 0, z: 0 } });
  const rot = (p0: Vec3): Vec3 => {
    const p = side === "left" ? { ...p0, x: -p0.x } : p0; // the fixture is a right hand; mirror it for the left
    if (pose === "palmUp") return p;
    if (pose === "palmDown") return { x: -p.x, y: -p.y, z: p.z }; // 180 degrees about z
    // fingers up, palm away: x -> -x, y -> -z... rotate 90 about x (fingers to +y, palm to +z) then 180 about y (palm to -z)
    const y = -p.z, z = p.y; // 90 about x
    return { x: -p.x, y, z: -z };
  };
  const joints: HandFrame["joints"] = {};
  for (const [k, p] of Object.entries(h.joints)) { const r = rot(p!); joints[k as keyof typeof joints] = { x: r.x + at.x, y: r.y + at.y, z: r.z + at.z }; }
  return { hand: side, joints, ray: { origin: at, direction: { x: 0, y: 0, z: -1 } } };
}

const feed = (g: ExtraGestures, frames: (t: number) => HandFrame[], from: number, to: number, step = 16): ExtraEvent[] => {
  const out: ExtraEvent[] = [];
  for (let t = from; t <= to; t += step) out.push(...g.update({ time: t, hands: frames(t), controllers: [] } as InputFrame));
  return out;
};
const types = (e: ExtraEvent[]) => e.map((x) => x.type);

describe("palm normal", () => {
  it("points where the posed hand faces", () => {
    expect(palmNormal(hand({}, "palmUp", { x: 0, y: 0, z: 0 }))!.y).toBeGreaterThan(0.9);
    expect(palmNormal(hand({}, "palmDown", { x: 0, y: 0, z: 0 }))!.y).toBeLessThan(-0.9);
    expect(palmNormal(hand({}, "palmFwd", { x: 0, y: 0, z: 0 }))!.z).toBeLessThan(-0.9);
    expect(palmNormal(hand({}, "palmFwd", { x: 0, y: 0, z: 0 }, "left"))!.z).toBeLessThan(-0.9);
  });
});

describe("extra gestures", () => {
  const flick = { ring: "curl", pinky: "curl", thumb: "curl" } as const;

  it("two-finger flick left is back, right is forward, slow movement is nothing", () => {
    const g = new ExtraGestures();
    expect(types(feed(g, (t) => [hand(flick, "palmFwd", { x: 0.2 - 0.0007 * t, y: 0, z: -0.4 })], 0, 250))).toEqual(["back"]);
    const g2 = new ExtraGestures();
    expect(types(feed(g2, (t) => [hand(flick, "palmFwd", { x: -0.2 + 0.0007 * t, y: 0, z: -0.4 })], 0, 250))).toEqual(["forward"]);
    const g3 = new ExtraGestures();
    expect(feed(g3, (t) => [hand(flick, "palmFwd", { x: 0.2 - 0.00005 * t, y: 0, z: -0.4 })], 0, 2000)).toEqual([]);
  });

  it("a diagonal flick is not back or forward", () => {
    const g = new ExtraGestures();
    expect(feed(g, (t) => [hand(flick, "palmFwd", { x: 0.0007 * t, y: 0.0007 * t, z: -0.4 })], 0, 250)).toEqual([]);
  });

  it("open palm pushed forward is Mission Control, pushed sideways is not", () => {
    const g = new ExtraGestures();
    expect(types(feed(g, (t) => [hand({}, "palmFwd", { x: 0, y: 0, z: -0.2 - 0.0007 * t })], 0, 300))).toEqual(["mission-control"]);
    const g2 = new ExtraGestures();
    expect(feed(g2, (t) => [hand({}, "palmFwd", { x: 0.0007 * t, y: 0, z: -0.3 })], 0, 300)).toEqual([]);
  });

  it("open palm facing down dropped is hide-window; facing away dropped is not", () => {
    const g = new ExtraGestures();
    expect(types(feed(g, (t) => [hand({}, "palmDown", { x: 0, y: 0.1 - 0.0007 * t, z: -0.4 })], 0, 250))).toEqual(["hide-window"]);
    const g2 = new ExtraGestures();
    expect(feed(g2, (t) => [hand({}, "palmFwd", { x: 0, y: 0.1 - 0.0007 * t, z: -0.4 })], 0, 250)).toEqual([]);
  });

  const fist = { index: "curl", middle: "curl", ring: "curl", pinky: "curl", thumb: "curl" } as const;
  it("a fist held starts a drag, follows, and drops when the hand opens or tracking is lost", () => {
    const g = new ExtraGestures();
    const ev = feed(g, (t) => [hand(t < 800 ? fist : {}, "palmFwd", { x: 0, y: 0, z: -0.4 })], 0, 900);
    expect(types(ev)[0]).toBe("fist-start");
    expect(types(ev).filter((t) => t === "fist-start")).toHaveLength(1);
    expect(types(ev)).toContain("fist-move");
    expect(types(ev).at(-1)).toBe("fist-end");
    const g2 = new ExtraGestures();
    feed(g2, () => [hand(fist, "palmFwd", { x: 0, y: 0, z: -0.4 })], 0, 600);
    expect(types(g2.update({ time: 700, hands: [], controllers: [] }))).toEqual(["fist-end"]);
    const g3 = new ExtraGestures();
    expect(feed(g3, () => [hand(fist, "palmFwd", { x: 0, y: 0, z: -0.4 })], 0, 300)).toEqual([]); // not held long enough
  });

  it("thumb up with curled fingers is Enter once; a plain fist is not", () => {
    const up = { index: "curl", middle: "curl", ring: "curl", pinky: "curl", thumb: "ext" } as const;
    const g = new ExtraGestures();
    // palmFwd puts the fixture thumb (x+) at -x, so rotate: use a hand whose thumb tip is above the knuckle
    const thumbUp = (t: number): HandFrame => {
      const h = hand(up, "palmFwd", { x: 0, y: 0, z: -0.4 });
      h.joints["thumb-tip"] = { x: h.joints["index-finger-metacarpal"]!.x, y: h.joints["index-finger-metacarpal"]!.y + 0.08, z: h.joints["index-finger-metacarpal"]!.z };
      return t >= 0 ? h : h;
    };
    expect(types(feed(g, (t) => [thumbUp(t)], 0, 1500))).toEqual(["enter"]);
    const g2 = new ExtraGestures();
    expect(feed(g2, () => [hand({ ...fist }, "palmFwd", { x: 0, y: 0, z: -0.4 })], 0, 300)).toEqual([]);
  });

  it("two open palms facing away: spreading scales, settling ends", () => {
    const g = new ExtraGestures();
    const both = (gap: number) => [hand({}, "palmFwd", { x: -gap / 2, y: 0, z: -0.4 }, "left"), hand({}, "palmFwd", { x: gap / 2, y: 0, z: -0.4 })];
    const hold = feed(g, () => both(0.3), 0, 400);
    expect(hold).toEqual([]);
    const ev = feed(g, () => both(0.6), 416, 500);
    const s = ev.find((e) => e.type === "spread") as { scale: number };
    expect(s.scale).toBeCloseTo(2, 1);
    expect(types(g.update({ time: 600, hands: [hand({}, "palmFwd", { x: 0, y: 0, z: -0.4 })], controllers: [] }))).toEqual(["spread-end"]);
  });

  it("a snap (thumb and middle touch, then the middle tip leaves fast) is a screenshot; a slow release is not", () => {
    const snapHand = (gap: number, tipX: number): HandFrame => {
      const h = hand({ thumb: "ext" }, "palmUp", { x: 0, y: 0, z: -0.4 });
      h.joints["middle-finger-tip"] = { x: tipX, y: 0, z: -0.5 };
      h.joints["thumb-tip"] = { x: tipX + gap, y: 0, z: -0.5 };
      return h;
    };
    const g = new ExtraGestures();
    const ev = [...feed(g, () => [snapHand(0.005, 0)], 0, 100), ...feed(g, () => [snapHand(0.05, 0.1)], 116, 116)];
    expect(types(ev)).toEqual(["screenshot"]);
    const g2 = new ExtraGestures();
    const slow = [...feed(g2, () => [snapHand(0.005, 0)], 0, 100), ...feed(g2, () => [snapHand(0.05, 0.005)], 116, 116)];
    expect(slow).toEqual([]);
  });

  it("thresholds are config: a looser flick distance fires on a shorter flick", () => {
    const g = new ExtraGestures({ flickDistance: 0.04 });
    expect(types(feed(g, (t) => [hand(flick, "palmFwd", { x: 0.0003 * t, y: 0, z: -0.4 })], 0, 250))).toEqual(["forward"]);
  });
});

describe("extra messages", () => {
  it("shortcuts map to the Mac keys", () => {
    expect(extraToMessages({ type: "back", hand: "right" })[0]).toEqual({ type: "key", code: "BracketLeft", down: true, modifiers: ["cmd"] });
    expect(extraToMessages({ type: "forward", hand: "right" })[0]).toMatchObject({ code: "BracketRight" });
    expect(extraToMessages({ type: "hide-window", hand: "right" })[0]).toMatchObject({ code: "KeyH", modifiers: ["cmd"] });
    expect(extraToMessages({ type: "screenshot", hand: "right" })[0]).toMatchObject({ code: "Digit3", modifiers: ["cmd", "shift"] });
    expect(extraToMessages({ type: "enter", hand: "right" })).toHaveLength(2);
    expect(extraToMessages({ type: "mission-control", hand: "right" })).toEqual([{ type: "swipe", direction: "up" }]);
    expect(extraToMessages({ type: "spread", scale: 1 })).toEqual([]);
  });
});

describe("hand mode", () => {
  it("cycles, persists, and real hands fall back to skinned in a virtual scene", () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(loadHandMode(s)).toBeUndefined();
    saveHandMode(s, "joints");
    expect(loadHandMode(s)).toBe("joints");
    store.set("handdesk.handMode2", "bogus");
    expect(loadHandMode(s)).toBeUndefined();
    expect(HAND_MODES.map((m) => nextHandMode(m.id))).toEqual(["real", "skinned", "joints", "virtual"]);
    expect(isHandMode("real")).toBe(true);
    expect(effectiveHandMode(undefined, false)).toBe("virtual");
    expect(effectiveHandMode(undefined, true)).toBe("virtual");
    expect(effectiveHandMode("real", true)).toBe("virtual");
    expect(effectiveHandMode("joints", true)).toBe("joints");
  });
});

describe("session request", () => {
  it("passthrough asks for depth sensing only for real hands; VR never does", () => {
    const none = sessionInit("immersive-ar") as { optionalFeatures: string[] };
    expect(none.optionalFeatures).not.toContain("depth-sensing");
    const ar = sessionInit("immersive-ar", true) as { optionalFeatures: string[]; depthSensing?: unknown };
    expect(ar.optionalFeatures).toContain("depth-sensing");
    expect(ar.optionalFeatures).toContain("hand-tracking");
    expect(ar.depthSensing).toBeDefined();
    const vr = sessionInit("immersive-vr", true) as { optionalFeatures: string[]; depthSensing?: unknown };
    expect(vr.optionalFeatures).not.toContain("depth-sensing");
    expect(vr.depthSensing).toBeUndefined();
  });
});

describe("window panels", () => {
  it("spawn in front of the head, nearer than the display row, and step aside", () => {
    const head = { position: { x: 1, y: 1.6, z: 2 }, yaw: 0 };
    const a = windowPanel(7, { width: 1200, height: 800 }, head, 0);
    expect(a.windowId).toBe(7);
    expect(a.center.z).toBeCloseTo(2 - WINDOW_DISTANCE, 5);
    expect(a.width).toBeCloseTo(1.3, 5);
    expect(a.center.y).toBeCloseTo(1.6, 5);
    expect(a.height).toBeCloseTo(a.width * (800 / 1200), 5);
    const b = windowPanel(8, { width: 1200, height: 800 }, head, 1);
    expect(b.center.x).toBeGreaterThan(a.center.x);
    const turned = windowPanel(9, { width: 300, height: 300 }, { position: { x: 0, y: 1.6, z: 0 }, yaw: Math.PI / 2 }, 0);
    expect(turned.center.x).toBeGreaterThan(1); // looking along +x
    expect(turned.width).toBe(0.9);
  });

  it("launcher marks windows that have a panel and says when there are none", () => {
    const st = new MacState();
    expect(launcherRows(st, "").find((r) => r.text === "Windows")!.sub).toBe("none on screen");
    st.apply({ type: "windows", windows: [{ id: 3, app: "Zen", pid: 1, title: "Tab", x: 0, y: 0, width: 800, height: 600 }] });
    const rows = launcherRows(st, "", new Set([3]));
    expect(rows.find((r) => r.action?.kind === "window")!.text.startsWith("[panel] Zen")).toBe(true);
  });
});

describe("title strip move", () => {
  const p: Panel = { display: 0, center: { x: 0, y: 1.5, z: -1.5 }, yaw: 0, width: 2, height: 1, curve: 0 };
  it("only the top strip counts", () => {
    expect(inTitleBand(0.03)).toBe(true);
    expect(inTitleBand(0.3)).toBe(false);
    expect(inTitleBand(-0.1)).toBe(false);
  });
  it("moves with the hand, in the panel's own frame", () => {
    expect(titleDragCenter(p, { x: 0, y: 0, z: 0 }, { x: 0.2, y: -0.1, z: 0 })).toEqual({ x: 0.2, y: 1.4, z: -1.5 });
    const c = titleDragCenter({ ...p, yaw: Math.PI / 2 }, { x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0 });
    expect(c.x).toBeCloseTo(0, 5);
    expect(c.z).toBeCloseTo(-1.7, 5);
  });
});
