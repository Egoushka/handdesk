import { describe, expect, it } from "vitest";
import { GloveHands } from "../src/hands/glove";
import { PoseHold } from "../src/hands/hold";
import { effectiveHandMode } from "../src/hands/mode";
import { hoverShadows } from "../src/hands/shadow";
import { intersect, pickPanel, type Panel } from "../src/panel";
import { DirectTouch } from "../src/space/touch";
import { panelPoint, probeSurface } from "../src/space/surface";
import { snipHandles } from "../src/snip/handles";
import { cropUv, fromSource, rectFrom, rectValid, snipSize, toSource } from "../src/snip/rect";
import { SnipPinch } from "../src/snip/ringpinch";
import { loadSnips, saveSnips } from "../src/snip/store";
import type { HandFrame } from "../src/gesture/types";
import { makeHand } from "./fixtures";

const flat: Panel = { display: 0, center: { x: 0, y: 1.5, z: -2 }, yaw: 0, width: 2, height: 1, curve: 0 };
const snip: Panel = { display: 0, center: { x: 0, y: 1.5, z: -1 }, yaw: 0, width: 0.5, height: 0.25, curve: 0, crop: { x0: 0.5, y0: 0, x1: 1, y1: 0.5 } };
const ray = (x: number, y: number, z = 0) => ({ origin: { x, y, z }, direction: { x: 0, y: 0, z: -1 } });

describe("virtual hand", () => {
  it("is the default in passthrough and in VR", () => {
    expect(effectiveHandMode(undefined, false)).toBe("virtual");
    expect(effectiveHandMode(undefined, true)).toBe("virtual");
    expect(effectiveHandMode("joints", true)).toBe("joints");
  });

  it("holds the last pose 300 ms, then fades out; a returning hand fades in", () => {
    const h = makeHand({ hand: "right" });
    const hold = new PoseHold<HandFrame>();
    expect(hold.update(0, [h])[0]!.alpha).toBeLessThan(0.01);
    expect(hold.update(100, [h])[0]!.alpha).toBe(1);
    for (const t of [150, 250, 399]) { const out = hold.update(t, []); expect(out).toHaveLength(1); expect(out[0]!.alpha).toBe(1); }
    const fading = hold.update(500, [])[0]!;
    expect(fading.alpha).toBeGreaterThan(0);
    expect(fading.alpha).toBeLessThan(1);
    expect(hold.update(700, [])).toHaveLength(0);
    // a flicker keeps the hand solid; a long gap fades the hand in again
    hold.update(1000, [h]);
    hold.update(1100, [h]);
    expect(hold.update(1250, [h])[0]!.alpha).toBe(1);
    expect(hold.update(5000, [h])[0]!.alpha).toBeLessThan(0.01);
  });

  it("draws a glove for each held hand and hides it when faded out", () => {
    const g = new GloveHands();
    const l = makeHand({ hand: "left" }), r = makeHand({ hand: "right" });
    g.update([{ frame: l, alpha: 1 }, { frame: r, alpha: 1 }], () => 0);
    expect(g.visibleCount).toBe(2);
    g.update([{ frame: r, alpha: 0.5 }], () => 0.4);
    expect(g.visibleCount).toBe(1);
    g.update([{ frame: r, alpha: 0 }], () => 0);
    expect(g.visibleCount).toBe(0);
  });

  it("casts a shadow only on a panel it hovers in front of, darker when closer", () => {
    const near = hoverShadows([{ pos: { x: 0, y: 1.5, z: -1.95 }, size: 0.02 }], [flat]);
    const far = hoverShadows([{ pos: { x: 0, y: 1.5, z: -1.8 }, size: 0.02 }], [flat]);
    expect(near).toHaveLength(1);
    expect(near[0]!.u).toBeCloseTo(0.5);
    expect(near[0]!.alpha).toBeGreaterThan(far[0]!.alpha);
    expect(hoverShadows([{ pos: { x: 0, y: 1.5, z: -2.1 }, size: 0.02 }], [flat])).toHaveLength(0);
    expect(hoverShadows([{ pos: { x: 0, y: 1.5, z: -1.2 }, size: 0.02 }], [flat])).toHaveLength(0);
    expect(hoverShadows([{ pos: { x: 3, y: 1.5, z: -1.95 }, size: 0.02 }], [flat])).toHaveLength(0);
  });

  it("surface points round-trip on a curved panel", () => {
    const c: Panel = { ...flat, curve: 0.8, yaw: 0.3 };
    const p = panelPoint(c, 0.8, 0.3, 0.05);
    const s = probeSurface(p.pos, c);
    expect(Math.abs(s.d - 0.05)).toBeLessThan(0.005);
    expect(Math.abs(s.u - 0.8)).toBeLessThan(0.01);
    expect(s.v).toBeCloseTo(0.3, 2);
  });
});

describe("snip rectangle and crop", () => {
  it("normalises, clamps and rejects tiny drags", () => {
    const r = rectFrom({ x: 0.7, y: 0.9 }, { x: 0.2, y: 1.4 });
    expect(r).toEqual({ x0: 0.2, y0: 0.9, x1: 0.7, y1: 1 });
    expect(rectValid(r)).toBe(true);
    expect(rectValid(rectFrom({ x: 0.5, y: 0.5 }, { x: 0.505, y: 0.9 }))).toBe(false);
  });

  it("maps snip coordinates to source coordinates and back", () => {
    const r = { x0: 0.5, y0: 0.2, x1: 0.9, y1: 0.6 };
    expect(toSource(r, 0, 0)).toEqual({ x: 0.5, y: 0.2 });
    expect(toSource(r, 1, 1).x).toBeCloseTo(0.9);
    const back = fromSource(r, ...(Object.values(toSource(r, 0.3, 0.7)) as [number, number]));
    expect(back.x).toBeCloseTo(0.3);
    expect(back.y).toBeCloseTo(0.7);
  });

  it("cuts the texture with uvs, flipped for a canvas texture", () => {
    expect(cropUv({ x0: 0.25, y0: 0.5, x1: 0.75, y1: 1 })).toEqual([0.25, 0, 0.75, 0, 0.25, 0.5, 0.75, 0.5]);
  });

  it("starts at the region's real size but not tiny or huge", () => {
    const src = { width: 2.4, height: 1.35 };
    expect(snipSize({ x0: 0, y0: 0, x1: 0.5, y1: 0.5 }, src).width).toBeCloseTo(1.2);
    expect(snipSize({ x0: 0, y0: 0, x1: 0.05, y1: 0.05 }, src).width).toBeCloseTo(0.3);
    const mid = snipSize({ x0: 0, y0: 0, x1: 0.25, y1: 0.5 }, src);
    expect(mid.width).toBeCloseTo(0.6);
    expect(mid.height).toBeCloseTo(0.675);
  });

  it("a ray at a snip's centre and corners hits the right source coordinates", () => {
    const c = intersect(ray(0, 1.5), snip)!;
    expect(c.x).toBeCloseTo(0.75);
    expect(c.y).toBeCloseTo(0.25);
    const tl = intersect(ray(-0.249, 1.624), snip)!;
    expect(tl.x).toBeCloseTo(0.5, 1);
    expect(tl.y).toBeCloseTo(0, 1);
    const br = intersect(ray(0.249, 1.376), snip)!;
    expect(br.x).toBeCloseTo(1, 1);
    expect(br.y).toBeCloseTo(0.5, 1);
    expect(snip.display).toBe(0);
  });

  it("a window snip reports its window, and a snip in front wins over its source", () => {
    const win: Panel = { ...snip, display: -2, windowId: 9 };
    const h = pickPanel(ray(0, 1.5), [flat, win])!;
    expect(h.panel).toBe(win);
    expect(h.hit.window).toBe(9);
  });

  it("direct touch on a snip reports source coordinates", () => {
    const t = new DirectTouch<Panel>();
    const tip = (z: number) => [{ id: "r", pos: { x: 0, y: 1.5, z } }];
    t.update(tip(-0.9), [snip], { x: 0, y: 1.5, z: -0.5 });
    const ev = t.update(tip(-1.002), [snip], { x: 0, y: 1.5, z: -0.5 });
    const down = ev.find((e) => e.type === "down")!;
    expect(down.x).toBeCloseTo(0.75);
    expect(down.y).toBeCloseTo(0.25);
  });
});

describe("snip gesture", () => {
  const ringPinch = (gap: number): HandFrame => {
    const h = makeHand({ index: "curl", middle: "curl" });
    const r = h.joints["ring-finger-tip"]!;
    h.joints["thumb-tip"] = { x: r.x + gap, y: r.y, z: r.z };
    return h;
  };
  it("thumb to ring finger starts, moves and ends a snip with hysteresis", () => {
    const g = new SnipPinch();
    expect(g.update([makeHand({})]).length).toBe(0);
    expect(g.update([ringPinch(0.005)]).map((e) => e.type)).toEqual(["snip-start"]);
    expect(g.update([ringPinch(0.03)]).map((e) => e.type)).toEqual(["snip-move"]);
    expect(g.holding().has("right")).toBe(true);
    expect(g.update([ringPinch(0.06)]).map((e) => e.type)).toEqual(["snip-end"]);
    expect(g.holding().size).toBe(0);
  });
  it("ends when the hand is lost, and ignores the index pinch", () => {
    const g = new SnipPinch();
    g.update([ringPinch(0.005)]);
    expect(g.update([]).map((e) => e.type)).toEqual(["snip-end"]);
    const idx = makeHand({ middle: "curl", ring: "curl", pinky: "curl", thumbToIndex: 0.005 });
    expect(g.update([idx])).toHaveLength(0);
  });
});

describe("snip handles and storage", () => {
  it("a pinned snip offers only pin and close; a free one also scales and moves, never curves", () => {
    expect(snipHandles(snip, true).map((h) => h.kind).sort()).toEqual(["close", "pin"]);
    const free = snipHandles({ ...snip, width: 0.5 }, false).map((h) => h.kind);
    expect(free).toContain("scale-br");
    expect(free).toContain("move");
    expect(free).not.toContain("curve");
  });
  it("saves and loads snips, dropping damaged records", () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const rec = { source: "display:0", rect: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.4 }, center: { x: 0, y: 1, z: -1 }, yaw: 0.2, width: 0.4, height: 0.3 };
    saveSnips(s, [rec, { ...rec, rect: { x0: 0.1, y0: 0.1, x1: 0.11, y1: 0.4 } }, { ...rec, width: NaN }]);
    expect(loadSnips(s)).toHaveLength(1);
    expect(loadSnips(s)[0]).toEqual(rec);
    m.set("handdesk.snips", "not json");
    expect(loadSnips(s)).toEqual([]);
  });
});
