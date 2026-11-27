import { describe, expect, it } from "vitest";
import { DECK_H, DECK_M, DECK_W, TABS, defaultDeck, deckLayout, pageCount, WINDOWS_PER_PAGE, type DeckState, type Tab } from "../src/ui/deck";
import { GUIDE, GUIDE_H, GUIDE_W, SHEET, SHEET_H, SHEET_W, chipLayout, guideLayout, sheetLayout } from "../src/ui/guide";
import { MIN_TEXT, interactive, zoneAt, type Zone } from "../src/ui/zones";
import { MODES } from "../src/modes/modes";
import { PointerRouter } from "../src/input/pointer";
import { policyOf } from "../src/modes/modes";

const full = (tab: Tab): DeckState => ({
  ...defaultDeck(), tab,
  windows: Array.from({ length: 9 }, (_, i) => ({ id: i + 1, app: `App${i}`, title: "t", open: i === 0 })),
  snips: [{ id: 1, source: "display:0", pinned: true }, { id: 2, source: "window:Notes", pinned: false }],
});
const overlap = (a: Zone, b: Zone) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const ppm = DECK_W / DECK_M;

describe("main menu layout", () => {
  for (const t of TABS) {
    it(`${t.id}: every button is inside the panel, big enough to hit, and none overlap`, () => {
      const zs = deckLayout(full(t.id));
      const hit = zs.filter((z) => interactive(z) && z.kind !== "drag");
      for (const z of hit) {
        expect(z.x, z.id).toBeGreaterThanOrEqual(0); expect(z.y, z.id).toBeGreaterThanOrEqual(0);
        expect(z.x + z.w, z.id).toBeLessThanOrEqual(DECK_W); expect(z.y + z.h, z.id).toBeLessThanOrEqual(DECK_H);
        expect(Math.min(z.w, z.h) / ppm, z.id).toBeGreaterThanOrEqual(0.05); // 5 cm target
      }
      for (let i = 0; i < hit.length; i++) for (let j = i + 1; j < hit.length; j++) expect(overlap(hit[i]!, hit[j]!), `${hit[i]!.id} vs ${hit[j]!.id}`).toBe(false);
    });
  }
  it("the Mode tab has the six modes as tiles and marks the current one", () => {
    const zs = deckLayout({ ...defaultDeck(), mode: "arrange" });
    expect(zs.filter((z) => z.id.startsWith("mode:")).map((z) => z.id)).toEqual(MODES.map((m) => `mode:${m.id}`));
    expect(zs.filter((z) => z.active && z.id.startsWith("mode:")).map((z) => z.id)).toEqual(["mode:arrange"]);
  });
  it("every section is a tab and the Windows list pages at six", () => {
    expect(TABS.map((t) => t.id)).toEqual(["mode", "windows", "snips", "hands", "distance", "help"]);
    const s = full("windows");
    expect(deckLayout(s).filter((z) => z.id.startsWith("win:")).length).toBe(WINDOWS_PER_PAGE);
    expect(pageCount(9)).toBe(2);
    expect(deckLayout({ ...s, page: 1 }).filter((z) => z.id.startsWith("win:")).map((z) => z.id)).toEqual(["win:7", "win:8", "win:9"]);
  });
  it("text is never smaller than the floor (about 1.5 degrees at the 0.95 m the menu opens at)", () => {
    expect(MIN_TEXT / ppm / 0.95).toBeGreaterThan(0.025);
    for (const t of TABS) for (const z of deckLayout(full(t.id))) expect(z.size ?? MIN_TEXT, z.id).toBeGreaterThanOrEqual(MIN_TEXT);
  });
});

describe("hit testing", () => {
  it("a normalised point maps to the zone drawn there; later zones win; disabled and text are not hit", () => {
    const zs = deckLayout(defaultDeck());
    const t = zs.find((z) => z.id === "mode:touch")!;
    expect(zoneAt(zs, (t.x + t.w / 2) / DECK_W, (t.y + t.h / 2) / DECK_H, DECK_W, DECK_H)?.id).toBe("mode:touch");
    const close = zs.find((z) => z.id === "close")!;
    expect(zoneAt(zs, (close.x + 10) / DECK_W, (close.y + 10) / DECK_H, DECK_W, DECK_H)?.id).toBe("close");
    expect(zoneAt(zs, 0.5, 0.02, DECK_W, DECK_H)?.id).toBe("drag");
    const empty = deckLayout({ ...defaultDeck(), tab: "windows" });
    const none = empty.find((z) => z.id === "none")!;
    expect(zoneAt(empty, (none.x + 5) / DECK_W, (none.y + 5) / DECK_H, DECK_W, DECK_H)).toBeUndefined();
  });
  it("the select ray reports where on a UI panel it hit, so a button is chosen by x and y", () => {
    const r = new PointerRouter();
    const pick = () => ({ key: "deck", ui: "deck", display: -1, x: 0.7, y: 0.4, width: 1, height: 1, t: 1 });
    const out = r.update(0, { right: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } } }, [{ type: "selectstart", hand: "right" }], pick, policyOf("point"));
    expect(out.find((a) => a.type === "ui")).toMatchObject({ id: "deck", x: 0.7, y: 0.4 });
  });
});

describe("guide, cheat sheet and Menu button", () => {
  it("the guide has five short steps and walks Back and Next to Done", () => {
    expect(GUIDE.length).toBe(5);
    for (const g of GUIDE) expect(g.body.length).toBeLessThan(130);
    expect(guideLayout(0).find((z) => z.id === "gBack")!.disabled).toBe(true);
    expect(guideLayout(4).find((z) => z.id === "gNext")!.label).toBe("Done");
    for (const z of guideLayout(2).filter(interactive)) { expect(z.x + z.w).toBeLessThanOrEqual(GUIDE_W); expect(z.y + z.h).toBeLessThanOrEqual(GUIDE_H); }
  });
  it("the cheat sheet is one page of ten gestures, all inside the panel, closed by a tap anywhere", () => {
    expect(SHEET.length).toBe(10);
    const zs = sheetLayout();
    for (const z of zs) { expect(z.x + z.w).toBeLessThanOrEqual(SHEET_W); expect(z.y + z.h).toBeLessThanOrEqual(SHEET_H); }
    expect(zoneAt(zs, 0.5, 0.5, SHEET_W, SHEET_H)?.id).toBe("sheetClose");
  });
  it("the Menu button is one big target", () => {
    const [z] = chipLayout("Point", "ok", "point");
    expect(z!.id).toBe("menu");
    expect(z!.h / (SHEET_W / 1.1)).toBeGreaterThan(0.08);
  });
});
