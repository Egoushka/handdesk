import type { Zone } from "./zones";
import type { IconName } from "./zones";

/** The radial Menu: a ring of eight round actions around a hub, opened by pinching the Menu orb. Every power feature is one of these or one tap behind one. */
export const RADIAL = 1200;
export const RADIAL_M = 0.8;
export const RADIAL_BTN = 270;
export const RADIAL_RING = 400;
export const RADIAL_ITEMS: { id: string; label: string; icon: IconName; danger?: boolean }[] = [
  { id: "r:windows", label: "Windows", icon: "windows" },
  { id: "r:snips", label: "Snips", icon: "snip" },
  { id: "r:modes", label: "Modes", icon: "point" },
  { id: "r:arrange", label: "Arrange", icon: "arrange" },
  { id: "r:hands", label: "Hands", icon: "hand" },
  { id: "r:screen", label: "Screen", icon: "distance" },
  { id: "r:help", label: "Help", icon: "help" },
  { id: "closeExtras", label: "Close all", icon: "trash", danger: true },
];
/** Clockwise from the top. */
export function radialLayout(): Zone[] {
  const c = RADIAL / 2;
  const z: Zone[] = [{ id: "r:close", kind: "button", x: c - 130, y: c - 130, w: 260, h: 260, label: "Close", icon: "close", size: 50 }];
  RADIAL_ITEMS.forEach((it, i) => {
    const a = ((-90 + 45 * i) * Math.PI) / 180;
    z.push({ id: it.id, kind: "tile", x: Math.round(c + RADIAL_RING * Math.cos(a) - RADIAL_BTN / 2), y: Math.round(c + RADIAL_RING * Math.sin(a) - RADIAL_BTN / 2), w: RADIAL_BTN, h: RADIAL_BTN, label: it.label, icon: it.icon, danger: it.danger, size: 50 });
  });
  return z;
}
