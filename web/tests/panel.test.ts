import { describe, expect, it } from "vitest";
import { applyGrab, intersect, pick, type Panel } from "../src/panel";
import { codecFromAnnexB, gestureToMessages, keyActionToMessages, parseServerText, parseVideoFrame } from "../src/protocol";

const flat: Panel = { display: 0, center: { x: 0, y: 0, z: -2 }, yaw: 0, width: 2, height: 1, curve: 0 };
const ray = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) => ({ origin: { x: ox, y: oy, z: oz }, direction: { x: dx, y: dy, z: dz } });

describe("panel picking", () => {
  it("a ray at the centre hits (0.5, 0.5)", () => {
    const h = intersect(ray(0, 0, 0, 0, 0, -1), flat)!;
    expect(h.x).toBeCloseTo(0.5);
    expect(h.y).toBeCloseTo(0.5);
    expect(h.t).toBeCloseTo(2);
  });
  it("top-left origin: up and left is small x, small y", () => {
    const h = intersect(ray(-0.5, 0.25, 0, 0, 0, -1), flat)!;
    expect(h.x).toBeCloseTo(0.25);
    expect(h.y).toBeCloseTo(0.25);
  });
  it("misses outside the panel and from behind", () => {
    expect(intersect(ray(1.5, 0, 0, 0, 0, -1), flat)).toBeUndefined();
    expect(intersect(ray(0, 0, -5, 0, 0, 1), flat)).toBeUndefined();
  });
  it("a yawed panel is hit where expected", () => {
    const p: Panel = { ...flat, yaw: Math.PI / 2, center: { x: -2, y: 0, z: 0 } };
    const h = intersect(ray(0, 0, 0, -1, 0, 0), p)!;
    expect(h.x).toBeCloseTo(0.5);
  });
  it("curved panel: centre and edges", () => {
    const c: Panel = { ...flat, curve: Math.PI / 2 };
    expect(intersect(ray(0, 0, 0, 0, 0, -1), c)!.x).toBeCloseTo(0.5);
    // from the centre of curvature (0,0,-2+R) every direction at angle phi hits at x = phi/curve + 0.5
    const R = c.width / c.curve;
    const phi = Math.PI / 8;
    const h = intersect(ray(0, 0, -2 + R, Math.sin(phi), 0, -Math.cos(phi)), c)!;
    expect(h.x).toBeCloseTo(phi / c.curve + 0.5, 5);
    const outside = intersect(ray(0, 0, -2 + R, Math.sin(0.9), 0, -Math.cos(0.9)), c);
    expect(outside).toBeUndefined();
  });
  it("pick returns the nearest panel", () => {
    const near: Panel = { ...flat, display: 1, center: { x: 0, y: 0, z: -1 } };
    expect(pick(ray(0, 0, 0, 0, 0, -1), [flat, near])!.display).toBe(1);
  });
  it("two-hand grab scales and moves the panel, clamped", () => {
    const p = applyGrab(flat, { x: 0.1, y: 0, z: 0.5 }, 2, 0.2);
    expect(p.width).toBe(4);
    expect(p.center.z).toBeCloseTo(-1.5);
    expect(applyGrab(flat, { x: 0, y: 0, z: 0 }, 100, 0).width).toBe(8);
  });
});

describe("protocol", () => {
  const hit = () => ({ display: 0, x: 0.3, y: 0.7 });
  const r = ray(0, 0, 0, 0, 0, -1);
  it("click is move, down, up at the same point", () => {
    expect(gestureToMessages({ type: "click", hand: "right", source: "hand", button: "left", ray: r }, hit).map((m) => m.type)).toEqual(["move", "button", "button"]);
  });
  it("drag is move+down, moves, move+up", () => {
    expect(gestureToMessages({ type: "drag-start", hand: "right", source: "hand", ray: r }, hit)).toMatchObject([{ type: "move" }, { type: "button", down: true, button: "left" }]);
    expect(gestureToMessages({ type: "drag-end", hand: "right", source: "hand", ray: r }, hit)).toMatchObject([{ type: "move" }, { type: "button", down: false }]);
  });
  it("a miss sends nothing", () => {
    expect(gestureToMessages({ type: "click", hand: "right", source: "hand", button: "left", ray: r }, () => undefined)).toEqual([]);
  });
  it("scroll, magnify, swipe and mission control", () => {
    expect(gestureToMessages({ type: "scroll", hand: "right", source: "hand", dx: 1.4, dy: -20.6 }, hit)).toEqual([{ type: "scroll", dx: 1, dy: -21 }]);
    expect(gestureToMessages({ type: "magnify", hand: "right", delta: 0.1 }, hit)).toEqual([{ type: "magnify", delta: 0.1 }]);
    expect(gestureToMessages({ type: "swipe", hand: "right", source: "hand", direction: "left" }, hit)).toEqual([{ type: "swipe", direction: "left" }]);
    expect(gestureToMessages({ type: "mission-control", hand: "left", source: "controller" }, hit)).toEqual([{ type: "swipe", direction: "up" }]);
  });
  it("grab events never reach the Mac", () => {
    expect(gestureToMessages({ type: "grab-start", points: 2 }, hit)).toEqual([]);
  });
  it("key actions become down and up key messages, or text", () => {
    expect(keyActionToMessages({ kind: "key", code: "KeyC", modifiers: ["cmd"] })).toEqual([
      { type: "key", code: "KeyC", down: true, modifiers: ["cmd"] },
      { type: "key", code: "KeyC", down: false, modifiers: ["cmd"] },
    ]);
    expect(keyActionToMessages({ kind: "text", text: "й" })).toEqual([{ type: "text", text: "й" }]);
    expect(keyActionToMessages({ kind: "layout", lang: "uk" })).toEqual([]);
  });
  it("parses hello and rejects junk", () => {
    expect(parseServerText('{"type":"hello","version":1,"displays":[]}')).toMatchObject({ type: "hello" });
    expect(parseServerText("not json")).toBeUndefined();
  });
  it("parses the video frame header", () => {
    const buf = new ArrayBuffer(15);
    const dv = new DataView(buf);
    dv.setUint8(0, 1); dv.setUint8(1, 2); dv.setUint8(2, 1); dv.setBigUint64(3, 123456n);
    new Uint8Array(buf).set([0, 0, 0, 1], 11);
    const f = parseVideoFrame(buf)!;
    expect(f).toMatchObject({ display: 2, keyframe: true, timestampUs: 123456 });
    expect(Array.from(f.data)).toEqual([0, 0, 0, 1]);
    expect(parseVideoFrame(new ArrayBuffer(4))).toBeUndefined();
  });
  it("derives the codec string from the SPS", () => {
    const au = new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x2a, 0xac, 0, 0, 0, 1, 0x68, 0xee]);
    expect(codecFromAnnexB(au)).toBe("avc1.64002a");
    expect(codecFromAnnexB(new Uint8Array([0, 0, 1, 0x65, 1, 2, 3]))).toBeUndefined();
  });
});
