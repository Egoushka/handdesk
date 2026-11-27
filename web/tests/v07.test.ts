import { describe, expect, it } from "vitest";
import { TABS, defaultDeck, deckLayout } from "../src/ui/deck";
import { RADIAL, RADIAL_M, radialLayout } from "../src/ui/radial";
import type { Zone } from "../src/ui/zones";
import { GUIDE } from "../src/ui/guide";
import { BAR_H, ButtonTapHold, HoldOnce, MAX_EXTRAS, barLayout, canAddExtra } from "../src/ui/rescue";

describe("v0.3.7 rescue and discoverability", () => {
  it("caps extra panels at six", () => {
    expect(MAX_EXTRAS).toBe(6);
    expect(canAddExtra(5)).toBe(true);
    expect(canAddExtra(6)).toBe(false);
  });
  it("both fists fire once after 1.5 s and re-arm on release", () => {
    const h = new HoldOnce(1500);
    expect(h.update(0, true)).toBe(false);
    expect(h.update(1499, true)).toBe(false);
    expect(h.update(1500, true)).toBe(true);
    expect(h.update(2500, true)).toBe(false);
    expect(h.update(2600, false)).toBe(false);
    expect(h.update(2700, true)).toBe(false);
    expect(h.update(4300, true)).toBe(true);
  });
  it("controller B or Y: tap is the menu, a hold is the reset (once)", () => {
    const b = new ButtonTapHold();
    expect(b.update(0, true)).toBeUndefined();
    expect(b.update(200, false)).toBe("tap");
    expect(b.update(1000, true)).toBeUndefined();
    expect(b.update(1800, true)).toBe("hold");
    expect(b.update(2500, true)).toBeUndefined();
    expect(b.update(2600, false)).toBeUndefined();
  });
  it("every panel title bar has a big labelled Close (screens get Menu) inside it", () => {
    for (const closable of [true, false]) {
      const zs = barLayout(1000, "Notes: x", closable);
      const z = zs.find((q) => q.id === (closable ? "x" : "menu"))!;
      expect(z.label).toBe(closable ? "Close" : "Menu");
      expect(z.w).toBeGreaterThanOrEqual(300);
      expect(z.x + z.w).toBeLessThanOrEqual(1000);
      expect(z.y + z.h).toBeLessThanOrEqual(BAR_H);
    }
  });
  it("the radial menu has eight round actions on a ring, each big and inside the panel, every power feature reachable", () => {
    const zs = radialLayout();
    const items = zs.filter((z) => z.id !== "r:close");
    expect(items).toHaveLength(8);
    for (const z of zs) { expect(z.x).toBeGreaterThanOrEqual(0); expect(z.y).toBeGreaterThanOrEqual(0); expect(z.x + z.w).toBeLessThanOrEqual(RADIAL); expect(z.y + z.h).toBeLessThanOrEqual(RADIAL); }
    for (const z of items) expect(z.w / (RADIAL / RADIAL_M)).toBeGreaterThan(0.14);
    expect(items.map((z) => z.id)).toEqual(["r:windows", "r:snips", "r:modes", "r:arrange", "r:hands", "r:screen", "r:help", "closeExtras"]);
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) expect(overlaps(items[i]!, items[j]!)).toBe(false);
  });
  it("the deck keeps every tab and a Close all extras button", () => {
    const ids = deckLayout(defaultDeck()).map((z) => z.id);
    expect(ids).toContain("closeExtras");
    for (const t of TABS) expect(ids).toContain(`tab:${t.id}`);
  });
  it("the guide opens with Find the Menu", () => { expect(GUIDE[0]!.title).toBe("Find the Menu"); });
});

const overlaps = (a: Zone, b: Zone) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
