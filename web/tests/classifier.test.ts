import { describe, expect, it } from "vitest";
import { GestureClassifier } from "../src/gesture/classifier";
import { PALM0, at, controller, lShape, ofType, open, pinch, rightPinch, run, scrollPose, three, types, makeHand } from "./fixtures";

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("point", () => {
  it("emits point events with the hand ray while the hand is open", () => {
    const ev = run(new GestureClassifier(), 100, () => ({ hands: [open()] }));
    expect(ofType(ev, "point").length).toBeGreaterThan(3);
    expect(types(ev).every((t) => t === "point")).toBe(true);
  });
  it("falls back to a wrist-to-index ray when the runtime gives none", () => {
    const h = open();
    delete h.ray;
    const ev = new GestureClassifier().update({ time: 0, hands: [h], controllers: [] });
    const p = ofType(ev, "point")[0]!;
    expect(p.ray.direction.z).toBeLessThan(-0.9);
  });
});

describe("click", () => {
  it("a short pinch is one left click at the ray from pinch onset", () => {
    const c = new GestureClassifier();
    const ev = [
      ...run(c, 100, () => ({ hands: [open()] })),
      ...run(c, 150, () => ({ hands: [pinch({ ray: { origin: { x: 0.1, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } } })] }), 200),
      ...run(c, 100, () => ({ hands: [open()] }), 400),
    ];
    const clicks = ofType(ev, "click");
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({ button: "left", source: "hand", hand: "right" });
    expect(clicks[0]!.ray.origin.x).toBe(0.1);
    expect(ofType(ev, "drag-start")).toHaveLength(0);
  });
  it("two quick pinches are two clicks (the agent turns them into a double click)", () => {
    const c = new GestureClassifier();
    const ev = [
      ...run(c, 80, () => ({ hands: [pinch()] }), 0),
      ...run(c, 80, () => ({ hands: [open()] }), 100),
      ...run(c, 80, () => ({ hands: [pinch()] }), 200),
      ...run(c, 80, () => ({ hands: [open()] }), 300),
    ];
    expect(ofType(ev, "click")).toHaveLength(2);
  });
  it("a long hold without moving is not a click", () => {
    const c = new GestureClassifier();
    const ev = [...run(c, 1000, () => ({ hands: [pinch()] })), ...run(c, 50, () => ({ hands: [open()] }), 1100)];
    expect(ofType(ev, "click")).toHaveLength(0);
  });
  it("a loose hand with a thumb-index gap above the pinch threshold never clicks", () => {
    const c = new GestureClassifier();
    const ev = run(c, 500, () => ({ hands: [pinch({ thumbToIndex: 0.06 })] }));
    expect(ofType(ev, "click")).toHaveLength(0);
  });
  it("pinch hysteresis: a gap between on and off thresholds keeps the pinch", () => {
    const c = new GestureClassifier();
    const ev = [
      ...run(c, 50, () => ({ hands: [pinch({ thumbToIndex: 0.005 })] }), 0),
      ...run(c, 50, () => ({ hands: [pinch({ thumbToIndex: 0.03 })] }), 60),
      ...run(c, 50, () => ({ hands: [open()] }), 120),
    ];
    expect(ofType(ev, "click")).toHaveLength(1);
  });
});

describe("drag", () => {
  it("pinch, move, release is drag-start at the onset ray, moves, drag-end, and no click", () => {
    const c = new GestureClassifier();
    const ev = [
      ...run(c, 60, () => ({ hands: [pinch({ palm: PALM0 })] }), 0),
      ...run(c, 400, (p) => ({ hands: [pinch({ palm: at(PALM0, 0.1 * p) })] }), 70),
      ...run(c, 50, () => ({ hands: [open({ palm: at(PALM0, 0.1) })] }), 500),
    ];
    const ts = types(ev).filter((t) => t !== "point");
    expect(ts[0]).toBe("drag-start");
    expect(ts.at(-1)).toBe("drag-end");
    expect(ofType(ev, "drag-move").length).toBeGreaterThan(5);
    expect(ofType(ev, "click")).toHaveLength(0);
  });
  it("tracking loss during a drag ends it", () => {
    const c = new GestureClassifier();
    const ev = [
      ...run(c, 300, (p) => ({ hands: [pinch({ palm: at(PALM0, 0.2 * p) })] }), 0),
      ...run(c, 50, () => ({ hands: [] }), 400),
    ];
    expect(ofType(ev, "drag-end")).toHaveLength(1);
  });
});

describe("right click", () => {
  it("a thumb-middle tap is one right click and no left click", () => {
    const c = new GestureClassifier();
    const ev = [...run(c, 150, () => ({ hands: [rightPinch()] })), ...run(c, 80, () => ({ hands: [open()] }), 200)];
    const clicks = ofType(ev, "click");
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.button).toBe("right");
  });
});

describe("scroll", () => {
  it("hand moving up gives negative dy (content follows the hand), down gives positive", () => {
    const c = new GestureClassifier();
    const up = run(c, 300, (p) => ({ hands: [scrollPose({ palm: at(PALM0, 0, 0.1 * p) })] }), 0);
    const dyUp = sum(ofType(up, "scroll").map((e) => e.dy));
    expect(dyUp).toBeCloseTo(-250, 0);
    run(c, 50, () => ({ hands: [open()] }), 400);
    const down = run(c, 300, (p) => ({ hands: [scrollPose({ palm: at(PALM0, 0, -0.1 * p) })] }), 500);
    expect(sum(ofType(down, "scroll").map((e) => e.dy))).toBeGreaterThan(200);
  });
  it("horizontal motion gives dx", () => {
    const c = new GestureClassifier();
    const ev = run(c, 300, (p) => ({ hands: [scrollPose({ palm: at(PALM0, 0.05 * p) })] }));
    expect(sum(ofType(ev, "scroll").map((e) => e.dx))).toBeGreaterThan(100);
  });
  it("a still two-finger pinch scrolls nothing", () => {
    const ev = run(new GestureClassifier(), 300, () => ({ hands: [scrollPose()] }));
    expect(ofType(ev, "scroll")).toHaveLength(0);
  });
  it("index pinch growing into a two-finger scroll does not click", () => {
    const c = new GestureClassifier();
    const ev = [
      ...run(c, 100, () => ({ hands: [pinch()] }), 0),
      ...run(c, 300, (p) => ({ hands: [scrollPose({ palm: at(PALM0, 0, 0.05 * p) })] }), 120),
      ...run(c, 50, () => ({ hands: [open()] }), 500),
    ];
    expect(ofType(ev, "click")).toHaveLength(0);
  });
});

describe("magnify", () => {
  it("opening the L shape zooms in, closing zooms out", () => {
    const c = new GestureClassifier();
    const hold = run(c, 350, () => ({ hands: [lShape(0.05)] }), 0);
    expect(ofType(hold, "magnify")).toHaveLength(0);
    const grow = run(c, 300, (p) => ({ hands: [lShape(0.05 + 0.05 * p)] }), 400);
    expect(sum(ofType(grow, "magnify").map((e) => e.delta))).toBeCloseTo(Math.log(2), 1);
    const shrink = run(c, 300, (p) => ({ hands: [lShape(0.1 - 0.05 * p)] }), 800);
    expect(sum(ofType(shrink, "magnify").map((e) => e.delta))).toBeCloseTo(-Math.log(2), 1);
  });
  it("a pinch release that passes through the L shape does not zoom", () => {
    const c = new GestureClassifier();
    const ev = [
      ...run(c, 100, () => ({ hands: [pinch()] }), 0),
      ...run(c, 150, (p) => ({ hands: [lShape(0.03 + 0.07 * p)] }), 120),
      ...run(c, 50, () => ({ hands: [open()] }), 300),
    ];
    expect(ofType(ev, "magnify")).toHaveLength(0);
  });
});

describe("three-finger swipe", () => {
  const swipe = (dx: number, dy: number, ms: number) => {
    const c = new GestureClassifier();
    return [
      ...run(c, 100, () => ({ hands: [three()] }), 0),
      ...run(c, ms, (p) => ({ hands: [three({ palm: at(PALM0, dx * p, dy * p) })] }), 120),
    ];
  };
  it.each([
    ["left", -0.15, 0],
    ["right", 0.15, 0],
    ["up", 0, 0.15],
    ["down", 0, -0.15],
  ] as const)("a quick swipe %s is exactly one swipe event", (dir, dx, dy) => {
    const sw = ofType(swipe(dx, dy, 300), "swipe");
    expect(sw).toHaveLength(1);
    expect(sw[0]!.direction).toBe(dir);
  });
  it("a slow drift of the same distance is not a swipe", () => {
    expect(ofType(swipe(-0.15, 0, 3000), "swipe")).toHaveLength(0);
  });
  it("a short move is not a swipe", () => {
    expect(ofType(swipe(-0.05, 0, 300), "swipe")).toHaveLength(0);
  });
});

describe("two-hand grab", () => {
  const both = (sepHalf: number, palm = PALM0, yawShift = 0) => [
    pinch({ hand: "left", palm: at(palm, -sepHalf, 0, -yawShift) }),
    pinch({ hand: "right", palm: at(palm, sepHalf, 0, yawShift) }),
  ];
  it("grab-start, moves with center, scale and yaw, grab-end, and no click on release", () => {
    const c = new GestureClassifier();
    const ev = [
      ...run(c, 100, () => ({ hands: both(0.1) }), 0),
      ...run(c, 300, (p) => ({ hands: both(0.1 * (1 + p), at(PALM0, 0, 0, -0.2 * p)) }), 120),
      ...run(c, 100, () => ({ hands: [open({ hand: "left" }), open({ hand: "right" })] }), 450),
    ];
    expect(types(ev).filter((t) => t.startsWith("grab"))[0]).toBe("grab-start");
    const moves = ofType(ev, "grab-move");
    const last = moves.at(-1)!;
    expect(last.scale).toBeCloseTo(2, 1);
    expect(last.center.z).toBeCloseTo(-0.2, 1);
    expect(ofType(ev, "grab-end")).toHaveLength(1);
    expect(ofType(ev, "click")).toHaveLength(0);
    expect(ofType(ev, "drag-start")).toHaveLength(0);
  });
  it("turning the hands reports yaw", () => {
    const c = new GestureClassifier();
    const ev = [
      ...run(c, 60, () => ({ hands: both(0.1) }), 0),
      ...run(c, 300, (p) => ({ hands: both(0.1, PALM0, 0.1 * p) }), 80),
    ];
    expect(Math.abs(ofType(ev, "grab-move").at(-1)!.yaw)).toBeGreaterThan(0.5);
  });
  it("one pinching hand does not grab", () => {
    const ev = run(new GestureClassifier(), 200, () => ({ hands: [pinch({ hand: "left" }), open({ hand: "right" })] }));
    expect(ofType(ev, "grab-start")).toHaveLength(0);
  });
  it("the first hand's pending click is dropped when the second hand pinches", () => {
    const c = new GestureClassifier();
    const ev = [
      ...run(c, 60, () => ({ hands: [pinch({ hand: "left" }), open({ hand: "right" })] }), 0),
      ...run(c, 100, () => ({ hands: both(0.1) }), 80),
      ...run(c, 60, () => ({ hands: [open({ hand: "left" }), open({ hand: "right" })] }), 200),
    ];
    expect(ofType(ev, "click")).toHaveLength(0);
  });
});

describe("controller fallback", () => {
  it("trigger tap is a left click from the controller ray", () => {
    const c = new GestureClassifier();
    const ev = [
      ...run(c, 80, () => ({ controllers: [controller()] }), 0),
      ...run(c, 100, () => ({ controllers: [controller({ trigger: true })] }), 100),
      ...run(c, 50, () => ({ controllers: [controller()] }), 250),
    ];
    const clicks = ofType(ev, "click");
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({ source: "controller", button: "left" });
  });
  it("trigger held while the controller moves is a drag", () => {
    const c = new GestureClassifier();
    const ev = [
      ...run(c, 300, (p) => ({ controllers: [controller({ trigger: true, position: { x: 0.2 + 0.2 * p, y: -0.2, z: -0.3 } })] }), 0),
      ...run(c, 50, () => ({ controllers: [controller()] }), 400),
    ];
    expect(types(ev).filter((t) => t.startsWith("drag"))[0]).toBe("drag-start");
    expect(ofType(ev, "drag-end")).toHaveLength(1);
  });
  it("A is right click, B is mission control", () => {
    const c = new GestureClassifier();
    const ev = [
      ...run(c, 50, () => ({ controllers: [controller({ buttonA: true })] }), 0),
      ...run(c, 50, () => ({ controllers: [controller({ buttonB: true })] }), 100),
    ];
    expect(ofType(ev, "click").map((e) => e.button)).toEqual(["right"]);
    expect(ofType(ev, "mission-control")).toHaveLength(1);
  });
  it("thumbstick forward scrolls content down; back scrolls it up", () => {
    const c = new GestureClassifier();
    const fwd = run(c, 500, () => ({ controllers: [controller({ stickY: -1 })] }), 0);
    expect(sum(ofType(fwd, "scroll").map((e) => e.dy))).toBeGreaterThan(400);
    const back = run(c, 500, () => ({ controllers: [controller({ stickY: 1 })] }), 600);
    expect(sum(ofType(back, "scroll").map((e) => e.dy))).toBeLessThan(-400);
  });
  it("a stick flick is one swipe until it returns to centre", () => {
    const c = new GestureClassifier();
    const ev = [
      ...run(c, 200, () => ({ controllers: [controller({ stickX: -1 })] }), 0),
      ...run(c, 100, () => ({ controllers: [controller({ stickX: 0 })] }), 300),
      ...run(c, 100, () => ({ controllers: [controller({ stickX: 1 })] }), 500),
    ];
    expect(ofType(ev, "swipe").map((e) => e.direction)).toEqual(["left", "right"]);
  });
  it("squeeze grabs the panel with one controller", () => {
    const c = new GestureClassifier();
    const ev = [
      ...run(c, 200, (p) => ({ controllers: [controller({ squeeze: true, position: { x: 0.2, y: -0.2, z: -0.3 - 0.3 * p } })] }), 0),
      ...run(c, 50, () => ({ controllers: [controller()] }), 300),
    ];
    expect(ofType(ev, "grab-start")[0]!.points).toBe(1);
    expect(ofType(ev, "grab-move").at(-1)!.center.z).toBeLessThan(-0.2);
    expect(ofType(ev, "grab-end")).toHaveLength(1);
  });
});

it("makeHand is a valid 25-joint-shaped frame for the classifier (sanity)", () => {
  expect(Object.keys(makeHand({}).joints).length).toBeGreaterThanOrEqual(21);
});
