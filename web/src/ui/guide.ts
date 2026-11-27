import type { Mode } from "../modes/modes";
import type { IconName, Zone } from "./zones";

/** First-run guide: shown once, re-opened from Help. */
export const GUIDE_W = 1520;
export const GUIDE_H = 800;
export const GUIDE_M = 0.95;
export interface GuideStep { title: string; body: string; icon: IconName }
export const GUIDE: GuideStep[] = [
  { title: "Point and pinch", body: "Aim your hand at a screen. Touch thumb to index finger to click. Hold the pinch and move to drag.", icon: "pinch" },
  { title: "Switch mode", body: "Open the menu and pick a mode: Point, Touch, Trackpad, Type, Arrange or Real devices. Point is the default.", icon: "point" },
  { title: "Open a window", body: "Menu, then Windows. Tap a window and it floats as its own panel you can move.", icon: "windows" },
  { title: "Make a snip", body: "Menu, then Snips, then New snip. Drag a box on a screen to keep that part in view.", icon: "snip" },
  { title: "Summon the menu", body: "Flip your left wrist, or tap the Menu button under the screen. Flip again to hide it.", icon: "flip" },
];

export function guideLayout(step: number): Zone[] {
  const s = GUIDE[Math.min(step, GUIDE.length - 1)]!;
  const last = step >= GUIDE.length - 1;
  const z: Zone[] = [
    { id: "gTitle", kind: "text", x: 64, y: 36, w: 700, h: 70, label: `Step ${step + 1} of ${GUIDE.length}`, size: 50 },
    { id: "gArt", kind: "text", x: 64, y: 150, w: 420, h: 420, label: "", icon: s.icon },
    { id: "gHead", kind: "text", x: 540, y: 150, w: 920, h: 110, label: s.title, size: 88 },
    { id: "gBody", kind: "text", x: 540, y: 290, w: 920, h: 300, label: s.body, size: 56 },
    { id: "gSkip", kind: "button", x: 64, y: 640, w: 300, h: 124, label: last ? "" : "Skip", disabled: last },
    { id: "gBack", kind: "button", x: 400, y: 640, w: 300, h: 124, label: "Back", icon: "prev", disabled: step === 0 },
    { id: "gNext", kind: "button", x: 1520 - 64 - 440, y: 640, w: 440, h: 124, label: last ? "Done" : "Next", icon: last ? "check" : "next", primary: true },
  ];
  return z;
}

export const SHEET_W = 1600;
export const SHEET_H = 1080;
export const SHEET_M = 1.1;
export const SHEET: { icon: IconName; title: string; body: string }[] = [
  { icon: "pinch", title: "Pinch", body: "Thumb to index: click. Hold and move: drag" },
  { icon: "squeeze", title: "Squeeze", body: "Grip the hand: right click" },
  { icon: "scroll", title: "Two fingers", body: "Thumb to index and middle, then move: scroll" },
  { icon: "zoom", title: "L shape", body: "Open or close the gap: zoom" },
  { icon: "swipe", title: "Three fingers", body: "Swipe sideways: Spaces. Up: Mission Control" },
  { icon: "twohands", title: "Both hands pinch", body: "Move, turn and resize a panel (Arrange)" },
  { icon: "snip", title: "Thumb to ring", body: "Then drag a box: make a snip" },
  { icon: "touch", title: "Fingertip", body: "Poke through a panel: tap (Touch mode)" },
  { icon: "thumb", title: "Thumb up", body: "Enter. Snap fingers: screenshot" },
  { icon: "flip", title: "Left wrist flip", body: "Open or hide the menu" },
];
export function sheetLayout(): Zone[] {
  const z: Zone[] = [
    { id: "sheetClose", kind: "scrim", x: 0, y: 0, w: SHEET_W, h: SHEET_H, label: "" },
    { id: "sTitle", kind: "text", x: 64, y: 28, w: 900, h: 100, label: "Gestures", size: 84 },
    { id: "sClose", kind: "button", x: SHEET_W - 64 - 320, y: 28, w: 320, h: 100, label: "Close", icon: "close" },
  ];
  const colW = 700, rowH = 176, y0 = 150;
  SHEET.forEach((g, i) => {
    const col = Math.floor(i / 5), r = i % 5;
    z.push({ id: `g${i}`, kind: "text", x: 64 + col * (colW + 72), y: y0 + r * (rowH + 4), w: colW, h: rowH, label: g.title, sub: g.body, icon: g.icon, size: 54 });
  });
  return z;
}

/** The small always-there Menu button under the screen. It also carries the mode, so it doubles as the compact HUD. */
export const CHIP_W = 800;
export const CHIP_H = 190;
export const CHIP_M = 0.45;
export function chipLayout(label: string, link: "ok" | "wait" | "bad", modeIcon: IconName): Zone[] {
  return [
    { id: "menu", kind: "button", x: 0, y: 0, w: CHIP_W, h: CHIP_H, label, sub: link, icon: modeIcon, primary: true },
  ];
}
export const modeIconOf = (m: Mode): IconName => ({ point: "point", touch: "touch", trackpad: "trackpad", type: "keyboard", arrange: "arrange", real: "devices" } as const)[m];
