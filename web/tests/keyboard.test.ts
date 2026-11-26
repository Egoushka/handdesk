import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { snap, suggest } from "../src/keyboard/autocorrect";
import { PITCH, buildLayout, type Lang } from "../src/keyboard/layouts";
import { calibrateFromFlatHands, fromPlane, planeFromYaw, toPlane } from "../src/keyboard/plane";
import { POKE, PressDetector, SURFACE, type FingerTip, type PressEvent } from "../src/keyboard/press";
import { TypingSession } from "../src/keyboard/session";
import { makeHand, open } from "./fixtures";

const key = (lang: Lang, code: string) => buildLayout(lang).find((k) => k.code === code)!;

// ---- press detection on synthetic fingertip trajectories (60 Hz) ----
const DT = 1000 / 60;
type Traj = (t: number) => number;
const tapTraj = (t0: number, speed = 0.5): Traj => (t) => {
  // hover at 4 cm, dive at `speed`, bounce back up at the same speed
  if (t < t0) return 0.04;
  const dtS = (t - t0) / 1000;
  const down = 0.04 - speed * dtS;
  const tBottom = 0.036 / speed;
  if (dtS <= tBottom) return Math.max(0.004, down);
  return 0.004 + speed * (dtS - tBottom);
};
const resting = (h = 0.004): Traj => () => h;
const slowSettle: Traj = (t) => Math.max(0.004, 0.04 - 0.03 * (t / 1000));

function simulate(fingers: { id: string; hand?: "left" | "right"; finger?: any; u?: number; v?: number; h: Traj }[], ms: number, cfg = SURFACE) {
  const d = new PressDetector(cfg);
  const out: PressEvent[] = [];
  for (let t = 0; t <= ms; t += DT) {
    const tips: FingerTip[] = fingers.map((f) => ({
      id: f.id, hand: f.hand ?? "right", finger: f.finger ?? "index", u: f.u ?? 0, v: f.v ?? 0, h: f.h(t),
    }));
    out.push(...d.update(t, tips));
  }
  return out;
}
const presses = (ev: PressEvent[]) => ev.filter((e) => e.type === "press");

describe("press detection", () => {
  it("a fast tap is one press at the contact position", () => {
    const ev = simulate([{ id: "r-index", u: 0.03, v: 0.01, h: tapTraj(100) }], 600);
    const p = presses(ev);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ type: "press", u: 0.03, v: 0.01 });
  });
  it("a finger resting on the desk never presses", () => {
    expect(presses(simulate([{ id: "r-index", h: resting() }], 2000))).toHaveLength(0);
  });
  it("a finger resting with tracking jitter never presses", () => {
    const jitter: Traj = (t) => 0.007 + 0.004 * Math.sin(t / 37);
    expect(presses(simulate([{ id: "r-middle", h: jitter }], 2000))).toHaveLength(0);
  });
  it("a finger that settles slowly onto the desk does not press", () => {
    expect(presses(simulate([{ id: "r-index", h: slowSettle }], 2000))).toHaveLength(0);
  });
  it("a resting finger beside a typing finger stays silent", () => {
    const ev = simulate([{ id: "r-index", h: tapTraj(100) }, { id: "r-ring", finger: "ring", h: resting() }], 600);
    expect(presses(ev).map((e) => (e as any).id)).toEqual(["r-index"]);
  });
  it("two fingers tapping together give two presses", () => {
    const ev = simulate([
      { id: "r-index", u: 0.0, h: tapTraj(100, 0.5) },
      { id: "l-index", hand: "left", u: -0.1, h: tapTraj(100, 0.5) },
    ], 600);
    expect(presses(ev)).toHaveLength(2);
  });
  it("two fingers of one hand tapping at similar speed give two presses", () => {
    const ev = simulate([
      { id: "r-index", finger: "index", h: tapTraj(100, 0.5) },
      { id: "r-middle", finger: "middle", h: tapTraj(100, 0.45) },
    ], 600);
    expect(presses(ev)).toHaveLength(2);
  });
  it("a neighbour dragged down by a hard tap does not ghost-press", () => {
    const ev = simulate([
      { id: "r-index", h: tapTraj(100, 0.9) },
      { id: "r-middle", finger: "middle", h: tapTraj(100, 0.25) },
    ], 600);
    expect(presses(ev).map((e) => (e as any).id)).toEqual(["r-index"]);
  });
  it("tapping again needs the finger to lift first, and a second tap types again", () => {
    const two: Traj = (t) => (t < 500 ? tapTraj(100)(t) : tapTraj(600)(t));
    expect(presses(simulate([{ id: "r-index", h: two }], 1100))).toHaveLength(2);
  });
  it("a tap slower than the minimum speed is not a press", () => {
    expect(presses(simulate([{ id: "r-index", h: tapTraj(100, 0.05) }], 1500))).toHaveLength(0);
  });
  it("thumb presses are reported as the thumb so the session types Space", () => {
    const ev = simulate([{ id: "r-thumb", finger: "thumb", h: tapTraj(100) }], 600);
    expect(presses(ev)[0]).toMatchObject({ finger: "thumb" });
  });
  it("poke mode needs the fingertip to go through the plane", () => {
    const shallow = simulate([{ id: "r-index", h: tapTraj(100, 0.4) }], 600, POKE); // bottoms at +4 mm: not through
    expect(presses(shallow)).toHaveLength(0);
    const deep: Traj = (t) => (t < 100 ? 0.04 : Math.max(-0.02, 0.04 - 0.4 * ((t - 100) / 1000)));
    expect(presses(simulate([{ id: "r-index", h: deep }], 600, POKE))).toHaveLength(1);
  });
});

// ---- plane ----
describe("typing plane", () => {
  it("round-trips plane coordinates", () => {
    const p = planeFromYaw({ x: 0.1, y: -0.4, z: -0.5 }, 0.4);
    const w = fromPlane(0.05, -0.03, 0.01, p);
    const c = toPlane(w, p);
    expect(c.u).toBeCloseTo(0.05);
    expect(c.v).toBeCloseTo(-0.03);
    expect(c.h).toBeCloseTo(0.01);
  });
  it("flat-hand calibration puts the plane just under the fingertips and faces the way the fingers point", () => {
    const hands = [makeHand({ palm: { x: -0.1, y: -0.35, z: -0.4 }, hand: "left" }), makeHand({ palm: { x: 0.1, y: -0.35, z: -0.4 } })];
    const plane = calibrateFromFlatHands(hands)!;
    expect(plane.origin.y).toBeCloseTo(-0.35 - 0.008, 3);
    expect(plane.vAxis.z).toBeCloseTo(-1, 3);
    expect(plane.origin.x).toBeCloseTo(0, 3);
    expect(calibrateFromFlatHands([])).toBeUndefined();
  });
});

// ---- autocorrect ----
describe("autocorrect", () => {
  // Press `frac` of a pitch away from the intended key towards `towards`, past the midpoint so the raw hit is the neighbour.
  const edge = (lang: Lang, prefix: string, intended: string, towards: string, frac = 0.62) => {
    const a = key(lang, intended);
    const b = key(lang, towards);
    const dir = Math.sign(b.u - a.u);
    const u = a.u + dir * frac * PITCH;
    const raw = buildLayout(lang).find((k) => Math.abs(u - k.u) <= k.w / 2 && Math.abs(a.v - k.v) <= k.h / 2)!;
    expect(raw.code).toBe(towards);
    return snap(lang, prefix, u, a.v, raw);
  };
  it.each([
    ["en", "th", "KeyE", "KeyR"],
    ["en", "hel", "KeyL", "KeyK"],
    ["en", "yo", "KeyU", "KeyI"],
    ["en", "tomorro", "KeyW", "KeyE"],
    ["en", "peopl", "KeyE", "KeyW"],
    ["uk", "дяк", "KeyE", "KeyR"],
    ["uk", "до", "Comma", "Period"],
    ["uk", "прив", "KeyS", "KeyD"],
  ] as const)("%s: after %s an edge press on %s snaps back from %s", (lang, prefix, intended, towards) => {
    const r = edge(lang, prefix, intended, towards);
    expect(r.key.code).toBe(intended);
    expect(r.corrected).toBe(true);
  });
  it("a deliberate press in the middle of a key is never overridden", () => {
    const r = key("en", "KeyR");
    const out = snap("en", "th", r.u, r.v, r);
    expect(out.key.code).toBe("KeyR");
    expect(out.corrected).toBe(false);
  });
  it("an edge press with no word-list evidence keeps the nearest key", () => {
    const r = key("en", "KeyR");
    const out = snap("en", "qzx", r.u + 0.3 * PITCH + 0.002, r.v, r);
    expect(out.key.code).toBe("KeyR");
  });
  it("suggests the most frequent words for a prefix in each language", () => {
    expect(suggest("en", "th")[0]).toBe("the");
    expect(suggest("en", "hel")).toContain("hello");
    expect(suggest("uk", "прив")).toContain("привіт");
    expect(suggest("en", "")).toEqual([]);
  });
});

// ---- session: layouts, modifiers, mapping to key messages ----
describe("typing session", () => {
  const press = (s: TypingSession, code: string, t = 0) => {
    const k = key(s.lang, code);
    return s.pressAt(k.u, k.v, t).actions;
  };
  it("English letters go as physical keys", () => {
    const s = new TypingSession();
    expect(press(s, "KeyA")).toEqual([{ kind: "key", code: "KeyA", modifiers: [] }]);
  });
  it("Ukrainian letters go as text, Shift capitalises", () => {
    const s = new TypingSession();
    press(s, "Globe");
    expect(s.lang).toBe("uk");
    expect(press(s, "KeyQ")).toEqual([{ kind: "text", text: "й" }]);
    press(s, "ShiftLeft", 100);
    expect(press(s, "KeyQ", 200)).toEqual([{ kind: "text", text: "Й" }]);
    expect(press(s, "KeyQ", 300)).toEqual([{ kind: "text", text: "й" }]);
  });
  it("the globe key toggles layout and sends no key to the Mac", () => {
    const s = new TypingSession();
    expect(press(s, "Globe")).toEqual([{ kind: "layout", lang: "uk" }]);
    expect(press(s, "Globe")).toEqual([{ kind: "layout", lang: "en" }]);
  });
  it("Cmd is sticky for one key: Cmd then C is Cmd-C, then plain again", () => {
    const s = new TypingSession();
    expect(press(s, "MetaLeft", 0)).toEqual([]);
    expect(s.modifierState("cmd")).toBe("armed");
    expect(press(s, "KeyC", 100)).toEqual([{ kind: "key", code: "KeyC", modifiers: ["cmd"] }]);
    expect(press(s, "KeyC", 200)).toEqual([{ kind: "key", code: "KeyC", modifiers: [] }]);
  });
  it("double tap locks a modifier; tapping again releases it", () => {
    const s = new TypingSession();
    press(s, "ControlLeft", 0);
    press(s, "ControlLeft", 200);
    expect(s.modifierState("ctrl")).toBe("locked");
    press(s, "KeyA", 300);
    expect(press(s, "KeyA", 400)).toEqual([{ kind: "key", code: "KeyA", modifiers: ["ctrl"] }]);
    press(s, "ControlLeft", 500);
    expect(s.modifierState("ctrl")).toBe("off");
  });
  it("Cmd shortcuts in the Ukrainian layout send the physical key, not text", () => {
    const s = new TypingSession();
    press(s, "Globe");
    press(s, "MetaLeft", 100);
    expect(press(s, "KeyC", 200)).toEqual([{ kind: "key", code: "KeyC", modifiers: ["cmd"] }]);
  });
  it("combined Cmd+Shift", () => {
    const s = new TypingSession();
    press(s, "MetaLeft", 0);
    press(s, "ShiftLeft", 50);
    expect(press(s, "KeyZ", 100)).toEqual([{ kind: "key", code: "KeyZ", modifiers: ["cmd", "shift"] }]);
  });
  it("a thumb always types Space", () => {
    const s = new TypingSession();
    expect(s.pressAt(0.5, 0.5, 0, true).actions).toEqual([{ kind: "key", code: "Space", modifiers: [] }]);
  });
  it("a press in the gap beside the keyboard types nothing", () => {
    expect(new TypingSession().pressAt(1, 1, 0).actions).toEqual([]);
  });
  it("tracks the word and accepting a suggestion types the rest plus a space", () => {
    const s = new TypingSession();
    press(s, "KeyH"); press(s, "KeyE"); press(s, "KeyL");
    expect(s.suggestions()).toContain("hello");
    const i = s.suggestions().indexOf("hello");
    expect(s.accept(i)).toEqual([{ kind: "text", text: "lo " }]);
    expect(s.prefix).toBe("");
  });
  it("autocorrect applies inside the session: an edge press after 'th' types e", () => {
    const s = new TypingSession();
    press(s, "KeyT"); press(s, "KeyH");
    const e = key("en", "KeyE");
    const r = key("en", "KeyR");
    const out = s.pressAt(e.u + 0.62 * PITCH, e.v, 0);
    expect(out.key!.code).toBe("KeyE");
    expect(r.code).toBe("KeyR");
  });
  it("Backspace removes from the tracked word", () => {
    const s = new TypingSession();
    press(s, "KeyH"); press(s, "KeyI");
    press(s, "Backspace");
    expect(s.prefix).toBe("h");
  });
});

// ---- every virtual key maps to a code the Mac agent knows ----
describe("key code coverage", () => {
  it("every key in both layouts that is sent as a key has an entry in the Swift key table", () => {
    const swift = readFileSync(new URL("../../agent/Sources/HandDeskCore/KeyCodes.swift", import.meta.url), "utf8");
    const known = new Set([...swift.matchAll(/"([A-Za-z0-9]+)"\s*:/g)].map((m) => m[1]));
    for (const lang of ["en", "uk"] as const) {
      for (const k of buildLayout(lang)) {
        if (k.kind === "globe") continue;
        expect(known.has(k.code), `${lang} ${k.code}`).toBe(true);
      }
    }
  });
  it("open() fixture still works for the keyboard tests", () => {
    expect(open().hand).toBe("right");
  });
});
