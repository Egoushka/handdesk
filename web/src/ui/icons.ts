import type { IconName } from "./zones";

type G = CanvasRenderingContext2D;
const line = (g: G, ...pts: number[]) => { g.beginPath(); g.moveTo(pts[0]!, pts[1]!); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!); g.stroke(); };
const circ = (g: G, x: number, y: number, r: number, fill = false) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); fill ? g.fill() : g.stroke(); };
const rrect = (g: G, x: number, y: number, w: number, h: number, r: number, fill = false) => { g.beginPath(); g.roundRect(x, y, w, h, r); fill ? g.fill() : g.stroke(); };
const arrow = (g: G, x1: number, y1: number, x2: number, y2: number) => {
  line(g, x1, y1, x2, y2);
  const a = Math.atan2(y2 - y1, x2 - x1);
  line(g, x2 - 14 * Math.cos(a - 0.6), y2 - 14 * Math.sin(a - 0.6), x2, y2, x2 - 14 * Math.cos(a + 0.6), y2 - 14 * Math.sin(a + 0.6));
};
/** pointing hand-ish cursor */
const cursor = (g: G, x: number, y: number) => { g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 44); g.lineTo(x + 12, y + 33); g.lineTo(x + 22, y + 54); g.lineTo(x + 31, y + 50); g.lineTo(x + 21, y + 30); g.lineTo(x + 36, y + 30); g.closePath(); g.stroke(); };

const DRAW: Record<IconName, (g: G) => void> = {
  point: (g) => { cursor(g, 28, 18); line(g, 70, 20, 82, 8); line(g, 78, 38, 94, 36); },
  touch: (g) => { rrect(g, 12, 62, 76, 22, 8); line(g, 50, 14, 50, 52); line(g, 50, 52, 40, 42); line(g, 50, 52, 60, 42); },
  trackpad: (g) => { rrect(g, 12, 22, 76, 56, 12); line(g, 12, 62, 88, 62); circ(g, 50, 42, 6, true); },
  keyboard: (g) => { rrect(g, 8, 26, 84, 50, 10); for (let i = 0; i < 5; i++) circ(g, 24 + i * 13, 42, 2.5, true); for (let i = 0; i < 4; i++) circ(g, 30 + i * 13, 56, 2.5, true); line(g, 30, 67, 70, 67); },
  arrange: (g) => { arrow(g, 50, 50, 50, 12); arrow(g, 50, 50, 50, 88); arrow(g, 50, 50, 12, 50); arrow(g, 50, 50, 88, 50); },
  devices: (g) => { rrect(g, 6, 40, 58, 34, 8); rrect(g, 70, 30, 24, 46, 12); line(g, 82, 30, 82, 46); line(g, 14, 54, 56, 54); },
  windows: (g) => { rrect(g, 10, 18, 80, 64, 10); line(g, 10, 36, 90, 36); circ(g, 22, 27, 3, true); circ(g, 33, 27, 3, true); },
  snip: (g) => { g.setLineDash([10, 8]); rrect(g, 14, 20, 72, 60, 6); g.setLineDash([]); line(g, 62, 56, 86, 80); line(g, 86, 66, 86, 80, 72, 80); },
  hand: (g) => { g.beginPath(); g.moveTo(30, 88); g.lineTo(22, 52); g.lineTo(30, 48); g.lineTo(38, 62); g.lineTo(38, 18); g.lineTo(47, 18); g.lineTo(47, 48); g.lineTo(47, 12); g.lineTo(57, 12); g.lineTo(57, 48); g.lineTo(58, 20); g.lineTo(68, 20); g.lineTo(68, 52); g.lineTo(78, 36); g.lineTo(86, 42); g.lineTo(74, 88); g.closePath(); g.stroke(); },
  distance: (g) => { rrect(g, 10, 22, 36, 56, 6); arrow(g, 56, 50, 92, 50); arrow(g, 92, 50, 56, 50); },
  help: (g) => { circ(g, 50, 50, 38); g.beginPath(); g.arc(50, 40, 11, Math.PI, Math.PI * 2.6); g.lineTo(50, 60); g.stroke(); circ(g, 50, 72, 3.5, true); },
  close: (g) => { line(g, 22, 22, 78, 78); line(g, 78, 22, 22, 78); },
  menu: (g) => { line(g, 16, 28, 84, 28); line(g, 16, 50, 84, 50); line(g, 16, 72, 84, 72); },
  check: (g) => { line(g, 18, 54, 40, 76, 84, 28); },
  plus: (g) => { line(g, 50, 16, 50, 84); line(g, 16, 50, 84, 50); },
  closer: (g) => { rrect(g, 56, 20, 34, 60, 6); arrow(g, 8, 50, 46, 50); },
  farther: (g) => { rrect(g, 8, 28, 28, 44, 6); arrow(g, 46, 50, 92, 50); },
  pin: (g) => { g.beginPath(); g.moveTo(36, 14); g.lineTo(64, 14); g.lineTo(60, 44); g.lineTo(74, 56); g.lineTo(26, 56); g.lineTo(40, 44); g.closePath(); g.stroke(); line(g, 50, 56, 50, 90); },
  trash: (g) => { line(g, 18, 26, 82, 26); line(g, 38, 26, 38, 14, 62, 14, 62, 26); g.beginPath(); g.moveTo(26, 26); g.lineTo(32, 88); g.lineTo(68, 88); g.lineTo(74, 26); g.stroke(); line(g, 42, 40, 42, 74); line(g, 58, 40, 58, 74); },
  search: (g) => { circ(g, 42, 42, 26); line(g, 62, 62, 88, 88); },
  display: (g) => { rrect(g, 10, 16, 80, 52, 8); line(g, 50, 68, 50, 84); line(g, 30, 84, 70, 84); },
  moon: (g) => { g.beginPath(); g.arc(50, 50, 34, 0.6, Math.PI * 2 - 0.2); g.arc(64, 38, 28, Math.PI * 2 - 0.9, 0.9, true); g.stroke(); },
  recenter: (g) => { circ(g, 50, 50, 8, true); circ(g, 50, 50, 32); line(g, 50, 6, 50, 20); line(g, 50, 80, 50, 94); line(g, 6, 50, 20, 50); line(g, 80, 50, 94, 50); },
  save: (g) => { rrect(g, 14, 14, 72, 72, 8); rrect(g, 30, 14, 36, 26, 3); rrect(g, 28, 56, 44, 30, 3); },
  desk: (g) => { line(g, 8, 44, 92, 44); line(g, 16, 44, 16, 86); line(g, 84, 44, 84, 86); rrect(g, 30, 14, 40, 22, 4); },
  globe: (g) => { circ(g, 50, 50, 38); g.beginPath(); g.ellipse(50, 50, 16, 38, 0, 0, Math.PI * 2); g.stroke(); line(g, 12, 50, 88, 50); },
  glove: (g) => { g.beginPath(); g.roundRect(26, 46, 48, 42, 12); g.stroke(); for (const x of [30, 42, 54, 66]) rrect(g, x, 12 + Math.abs(x - 48) * 0.5, 9, 40, 4.5); line(g, 26, 62, 12, 48); },
  dots: (g) => { for (const [x, y] of [[50, 78], [28, 50], [40, 30], [52, 24], [64, 30], [74, 52]] as const) circ(g, x, y, 6, true); line(g, 50, 78, 28, 50); line(g, 50, 78, 74, 52); line(g, 40, 30, 52, 24, 64, 30); },
  book: (g) => { rrect(g, 14, 16, 72, 68, 8); line(g, 50, 16, 50, 84); line(g, 24, 34, 42, 34); line(g, 24, 48, 42, 48); line(g, 58, 34, 76, 34); line(g, 58, 48, 76, 48); },
  list: (g) => { rrect(g, 14, 10, 72, 80, 8); for (const y of [30, 50, 70]) { circ(g, 28, y, 3, true); line(g, 40, y, 74, y); } },
  flip: (g) => { rrect(g, 30, 28, 40, 44, 10); g.beginPath(); g.arc(50, 50, 40, Math.PI * 1.15, Math.PI * 1.9); g.stroke(); line(g, 80, 28, 84, 14); line(g, 80, 28, 66, 30); },
  pinch: (g) => { circ(g, 38, 40, 9, true); circ(g, 62, 56, 9, true); arrow(g, 20, 20, 33, 33); arrow(g, 80, 76, 67, 63); },
  squeeze: (g) => { rrect(g, 24, 34, 52, 44, 16); line(g, 30, 34, 30, 22); line(g, 42, 34, 42, 18); line(g, 54, 34, 54, 18); line(g, 66, 34, 66, 22); },
  scroll: (g) => { rrect(g, 30, 8, 40, 84, 20); line(g, 50, 24, 50, 40); arrow(g, 84, 56, 84, 20); arrow(g, 16, 40, 16, 76); },
  zoom: (g) => { circ(g, 42, 42, 26); line(g, 62, 62, 86, 86); line(g, 30, 42, 54, 42); line(g, 42, 30, 42, 54); },
  swipe: (g) => { for (const x of [30, 46, 62]) line(g, x, 76, x, 30); arrow(g, 14, 18, 86, 18); },
  twohands: (g) => { circ(g, 24, 50, 10, true); circ(g, 76, 50, 10, true); arrow(g, 38, 50, 20, 50); arrow(g, 62, 50, 80, 50); arrow(g, 36, 50, 64, 50); },
  thumb: (g) => { g.beginPath(); g.moveTo(30, 88); g.lineTo(30, 46); g.lineTo(50, 8); g.lineTo(58, 12); g.lineTo(54, 38); g.lineTo(86, 38); g.lineTo(80, 88); g.closePath(); g.stroke(); },
  next: (g) => { line(g, 38, 16, 72, 50, 38, 84); },
  prev: (g) => { line(g, 62, 16, 28, 50, 62, 84); },
  app: (g) => { rrect(g, 14, 14, 72, 72, 20); circ(g, 50, 50, 14); },
};

/** Draw an icon in a size x size box at (x, y); strokes use the current stroke and fill style. */
export function drawIcon(g: G, name: IconName, x: number, y: number, size: number, color: string): void {
  g.save();
  g.translate(x, y);
  g.scale(size / 100, size / 100);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 7;
  g.lineCap = "round";
  g.lineJoin = "round";
  DRAW[name](g);
  g.restore();
}
