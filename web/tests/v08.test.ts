import { describe, expect, it } from "vitest";
import { NAG_MS, NagClock, PalmMenu } from "../src/input/palmMenu";
import { RADIAL_ITEMS, radialLayout, stickSector } from "../src/ui/radial";
import { TILT_MAX, tiltToward } from "../src/space/tilt";
import { cardPose } from "../src/ui/cards3d";
import { MIN_TEXT, zoneAt } from "../src/ui/zones";
import { DEPTH, MOTION, PALETTE, TYPE, approach, easeOut } from "../src/ui/style";
import { BAR_H, BAR_PX_PER_M, HANDLE_M, handleLayout, barLayout } from "../src/ui/rescue";
import { RADIAL } from "../src/ui/radial";

describe("palm menu", () => {
  it("opens after the palm is held up, not on a glance", () => {
    const m = new PalmMenu();
    expect(m.update(0, 0.9)).toBeUndefined();
    expect(m.update(100, 0.9)).toBeUndefined();
    expect(m.update(300, 0.9)).toBe("open");
    expect(m.open).toBe(true);
  });
  it("a passing palm does not open it", () => {
    const m = new PalmMenu();
    m.update(0, 0.9); m.update(100, 0.2); m.update(150, 0.9);
    expect(m.update(300, 0.9)).toBeUndefined();
  });
  it("closes when the palm turns away or the hand is lost, after a short grace", () => {
    const m = new PalmMenu();
    m.update(0, 0.9); m.update(300, 0.9);
    expect(m.update(400, 0.1)).toBeUndefined();
    expect(m.update(600, 0.9)).toBeUndefined();
    m.update(700, 0.1);
    expect(m.update(1100, 0.1)).toBe("close");
    const n = new PalmMenu();
    n.update(0, 0.9); n.update(300, 0.9); n.update(400, undefined);
    expect(n.update(800, undefined)).toBe("close");
  });
  it("after choosing something the palm has to turn away before it opens again", () => {
    const m = new PalmMenu();
    m.update(0, 0.9); m.update(300, 0.9);
    m.dismiss();
    expect(m.open).toBe(false);
    expect(m.update(600, 0.9)).toBeUndefined();
    expect(m.update(1200, 0.9)).toBeUndefined();
    m.update(1300, 0.1);
    m.update(1400, 0.9);
    expect(m.update(1700, 0.9)).toBe("open");
  });
  it("opening it by hand keeps the palm from reopening it", () => {
    const m = new PalmMenu();
    m.external();
    m.update(0, 0.9);
    expect(m.update(500, 0.9)).toBeUndefined();
  });
});

describe("nothing nags after ten minutes unused", () => {
  it("goes quiet and wakes on use", () => {
    const n = new NagClock(0);
    expect(n.quiet(NAG_MS - 1)).toBe(false);
    expect(n.quiet(NAG_MS + 1)).toBe(true);
    n.used(NAG_MS + 2);
    expect(n.quiet(NAG_MS + 3)).toBe(false);
  });
});

describe("controller thumbstick on the radial", () => {
  it("picks the sector clockwise from the top, with a dead zone", () => {
    expect(stickSector(0, 0.2)).toBeUndefined();
    expect(stickSector(0, -1)).toBe(RADIAL_ITEMS[0]!.id);
    expect(stickSector(1, 0)).toBe(RADIAL_ITEMS[2]!.id);
    expect(stickSector(0, 1)).toBe(RADIAL_ITEMS[4]!.id);
    expect(stickSector(-1, 0)).toBe(RADIAL_ITEMS[6]!.id);
    expect(stickSector(-0.7, -0.7)).toBe(RADIAL_ITEMS[7]!.id);
  });
  it("every capability is still in the radial, with the panic reset", () => {
    const ids = radialLayout().map((z) => z.id);
    for (const id of ["r:windows", "r:snips", "r:modes", "r:arrange", "r:hands", "r:screen", "r:help", "closeExtras", "r:close"]) expect(ids).toContain(id);
  });
  it("a finger on a button's centre hits that button", () => {
    for (const z of radialLayout()) expect(zoneAt(radialLayout(), (z.x + z.w / 2) / RADIAL, (z.y + z.h / 2) / RADIAL, RADIAL, RADIAL)?.id).toBe(z.id);
  });
});

describe("depth and style", () => {
  it("panels lean toward the head, gently and capped", () => {
    expect(tiltToward({ x: 0, y: 1.6, z: -1.4 }, { x: 0, y: 1.6, z: 0 })).toBe(0);
    const up = tiltToward({ x: 0, y: 2.4, z: -1 }, { x: 0, y: 1.6, z: 0 });
    expect(up).toBeGreaterThan(0);
    expect(up).toBeLessThanOrEqual(TILT_MAX);
    expect(tiltToward({ x: 0, y: 0.5, z: -1 }, { x: 0, y: 1.6, z: 0 })).toBeLessThan(0);
    expect(tiltToward({ x: 0, y: 9, z: -0.2 }, { x: 0, y: 1.6, z: 0 })).toBe(TILT_MAX);
  });
  it("window cards rest on an arc: the middle nearest, outer ones further back and turned in", () => {
    expect(cardPose(0).z).toBeGreaterThan(cardPose(1).z);
    expect(cardPose(-0.8).yaw).toBeGreaterThan(0);
    expect(cardPose(0.8).yaw).toBeLessThan(0);
  });
  it("buttons rise when hovered and sink when pressed", () => {
    expect(DEPTH.buttonHover).toBeGreaterThan(DEPTH.button);
    expect(DEPTH.buttonPressed).toBeLessThan(DEPTH.button);
  });
  it("motion is a short ease and never overshoots", () => {
    expect(MOTION.fast).toBeGreaterThanOrEqual(150);
    expect(MOTION.slow).toBeLessThanOrEqual(250);
    expect(easeOut(0)).toBe(0); expect(easeOut(1)).toBe(1); expect(easeOut(2)).toBe(1);
    let v = 0; for (let i = 0; i < 100; i++) { v = approach(v, 1, 16); expect(v).toBeLessThanOrEqual(1); }
    expect(v).toBeGreaterThan(0.99);
  });
  it("one palette: a single cool accent and a warm warning, text no smaller than the floor", () => {
    expect(PALETTE.accent).not.toBe(PALETTE.warn);
    expect(Object.values(TYPE).every((px) => px >= MIN_TEXT)).toBe(true);
  });
});

describe("the Menu handle", () => {
  it("is a small single target on the screen frame, not a bar", () => {
    const W = Math.round(HANDLE_M * BAR_PX_PER_M);
    const zs = handleLayout(W);
    expect(zs).toHaveLength(1);
    expect(zs[0]!.id).toBe("menu");
    expect(HANDLE_M).toBeLessThan(0.3);
    expect(zs[0]!.h).toBeLessThanOrEqual(BAR_H);
  });
  it("windows keep their Close; only screens get the handle", () => {
    expect(barLayout(1500, "Terminal", true).some((z) => z.id === "x")).toBe(true);
  });
});
