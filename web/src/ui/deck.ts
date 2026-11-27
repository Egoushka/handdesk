import { MODES, type Mode } from "../modes/modes";
import type { HandMode } from "../hands/mode";
import { MIN_TEXT, type IconName, type Zone } from "./zones";

export const DECK_W = 1600;
export const DECK_H = 1024;
/** Panel width in metres; height follows the canvas. 1739 px per metre. */
export const DECK_M = 0.92;

export type Tab = "mode" | "windows" | "snips" | "hands" | "distance" | "help";
export const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "windows", label: "Windows", icon: "windows" },
  { id: "snips", label: "Snips", icon: "snip" },
  { id: "mode", label: "Mode", icon: "point" },
  { id: "hands", label: "Hands", icon: "hand" },
  { id: "distance", label: "Screen", icon: "distance" },
  { id: "help", label: "Help", icon: "help" },
];

export interface DeckState {
  tab: Tab;
  mode: Mode;
  hand: HandMode;
  /** metres from the head to the display */
  distance: number;
  env: string;
  status: string;
  windows: { id: number; app: string; title: string; open: boolean }[];
  page: number;
  snips: { id: number; source: string; pinned: boolean }[];
  snipMode: boolean;
  calibrating: boolean;
  deskSet: boolean;
  log: boolean;
  dimmed: boolean;
}

export const WINDOWS_PER_PAGE = 6;
const ICON_OF_MODE: Record<Mode, IconName> = { point: "point", touch: "touch", trackpad: "trackpad", type: "keyboard", arrange: "arrange", real: "devices" };
const BLURB: Record<Mode, string> = {
  point: "Aim and pinch to click",
  touch: "Poke a panel with a finger",
  trackpad: "Right hand moves the cursor",
  type: "Keyboard on, point to click",
  arrange: "Move, resize, pull panels",
  real: "Your keyboard and mouse",
};

const PAD = 24;
const RAIL_W = 400;
const HEAD_H = 104;
const GAP = 24;
const CX = PAD + RAIL_W + PAD;
const CY = HEAD_H + PAD;
const CW = DECK_W - CX - PAD;
const CH = DECK_H - CY - PAD;

export const pageCount = (n: number): number => Math.max(1, Math.ceil(n / WINDOWS_PER_PAGE));

/** Equal-width row of tiles inside a box. */
function row(n: number, y: number, h: number, make: (i: number, x: number, w: number) => Zone): Zone[] {
  const w = Math.floor((CW - GAP * (n - 1)) / n);
  return Array.from({ length: n }, (_, i) => make(i, CX + i * (w + GAP), w)).map((z) => ({ ...z, y, h }));
}

export function deckLayout(s: DeckState): Zone[] {
  const z: Zone[] = [];
  z.push({ id: "drag", kind: "drag", x: 0, y: 0, w: DECK_W, h: HEAD_H, label: "handdesk", sub: s.status, icon: "desk" });
  z.push({ id: "close", kind: "button", x: DECK_W - PAD - 88, y: 8, w: 88, h: 88, label: "", icon: "close" });
  const ROW = 104, RH = 96;
  TABS.forEach((t, i) => z.push({ id: `tab:${t.id}`, kind: "tab", x: PAD, y: CY + i * ROW, w: RAIL_W, h: RH, label: t.label, icon: t.icon, active: s.tab === t.id, size: 50 }));
  z.push({ id: "closeExtras", kind: "button", x: PAD, y: DECK_H - PAD - RH, w: RAIL_W, h: RH, label: "Close all extras", size: 46, danger: true });

  if (s.tab === "mode") {
    const w = Math.floor((CW - GAP * 2) / 3);
    const h = Math.floor((CH - GAP) / 2);
    MODES.forEach((m, i) => z.push({ id: `mode:${m.id}`, kind: "tile", x: CX + (i % 3) * (w + GAP), y: CY + Math.floor(i / 3) * (h + GAP), w, h, label: m.label, sub: BLURB[m.id], icon: ICON_OF_MODE[m.id], active: s.mode === m.id }));
  } else if (s.tab === "windows") {
    z.push(...row(3, CY, 104, (i, x, w) => [
      { id: "search", kind: "button", x, y: 0, w, h: 0, label: "Search", icon: "search", size: 50 } as Zone,
      { id: "addDisplay", kind: "button", x, y: 0, w, h: 0, label: "Screen +", icon: "display", size: 50 } as Zone,
      { id: s.dimmed ? "dimOff" : "dimOn", kind: "button", x, y: 0, w, h: 0, label: s.dimmed ? "Restore Mac" : "Dim Mac", icon: "moon", size: 50 } as Zone,
    ][i]!));
    const pages = pageCount(s.windows.length);
    const page = Math.min(s.page, pages - 1);
    const list = s.windows.slice(page * WINDOWS_PER_PAGE, (page + 1) * WINDOWS_PER_PAGE);
    const top = CY + 104 + GAP;
    const bottom = pages > 1 ? CY + CH - 96 - GAP : CY + CH;
    const h = Math.floor((bottom - top - GAP) / 2);
    const w = Math.floor((CW - GAP * 2) / 3);
    if (list.length === 0) z.push({ id: "none", kind: "text", x: CX, y: top + 120, w: CW, h: 160, label: "No windows are open on the Mac", size: 56, align: "center" });
    list.forEach((win, i) => z.push({ id: `win:${win.id}`, kind: "tile", x: CX + (i % 3) * (w + GAP), y: top + Math.floor(i / 3) * (h + GAP), w, h, label: win.app, sub: win.title || "untitled", thumb: win.id, active: win.open }));
    if (pages > 1) {
      const y = CY + CH - 96;
      z.push({ id: "page:-1", kind: "button", x: CX, y, w: 300, h: 96, label: "Back", icon: "prev", disabled: page === 0 });
      z.push({ id: "pageNo", kind: "text", x: CX + 300, y, w: CW - 600, h: 96, label: `${page + 1} of ${pages}`, size: 54, align: "center" });
      z.push({ id: "page:1", kind: "button", x: CX + CW - 300, y, w: 300, h: 96, label: "More", icon: "next", disabled: page >= pages - 1 });
    }
  } else if (s.tab === "snips") {
    z.push(...row(2, CY, 130, (i, x, w) => (i === 0
      ? { id: "snipDraw", kind: "tile" as const, x, y: 0, w, h: 0, label: s.snipMode ? "Drag a box on a screen" : "New snip", icon: "snip", active: s.snipMode, primary: true }
      : { id: "snipsClear", kind: "tile" as const, x, y: 0, w, h: 0, label: "Close all", icon: "trash", disabled: s.snips.length === 0 })));
    if (s.snips.length === 0) z.push({ id: "none", kind: "text", x: CX, y: CY + 200, w: CW, h: 300, label: "A snip is a small live copy of part of a screen. Tap New snip, then drag a box on a screen. Or touch thumb to ring finger and drag.", size: 52, align: "center" });
    s.snips.slice(0, 4).forEach((sn, i) => {
      const y = CY + 130 + GAP + i * (150 + 12);
      z.push({ id: `snipRow:${sn.id}`, kind: "text", x: CX, y, w: CW - 480 - GAP, h: 150, label: `Snip ${sn.id}`, sub: sn.source.replace("display:", "Screen ").replace("window:", ""), size: 54 });
      z.push({ id: `snipPin:${sn.id}`, kind: "button", x: CX + CW - 480, y, w: 300, h: 150, label: sn.pinned ? "Pinned" : "Pin", icon: "pin", active: sn.pinned });
      z.push({ id: `snipClose:${sn.id}`, kind: "button", x: CX + CW - 160, y, w: 160, h: 150, label: "", icon: "trash" });
    });
  } else if (s.tab === "hands") {
    const opts: { id: HandMode; label: string; sub: string; icon: IconName }[] = [
      { id: "virtual", label: "Glove", sub: "A soft glove on your hands", icon: "glove" },
      { id: "real", label: "Real hands", sub: "Passthrough only", icon: "hand" },
      { id: "joints", label: "Dots", sub: "Just the joints", icon: "dots" },
    ];
    z.push(...row(3, CY, 420, (i, x, w): Zone => ({ id: `hand:${opts[i]!.id}`, kind: "tile", x, y: 0, w, h: 0, label: opts[i]!.label, sub: opts[i]!.sub, icon: opts[i]!.icon, active: s.hand === opts[i]!.id })));
    z.push({ id: "note", kind: "text", x: CX, y: CY + 420 + GAP + 20, w: CW, h: 200, label: "Real hands needs a new session: leave and enter AR again after you pick it.", size: 50, align: "center" });
  } else if (s.tab === "distance") {
    z.push(...row(2, CY, 330, (i, x, w) => (i === 0
      ? { id: "closer", kind: "tile" as const, x, y: 0, w, h: 0, label: "Closer", sub: "20 cm nearer", icon: "closer" }
      : { id: "farther", kind: "tile" as const, x, y: 0, w, h: 0, label: "Farther", sub: "20 cm back", icon: "farther" })));
    z.push({ id: "dist", kind: "text", x: CX, y: CY + 330 + 10, w: CW, h: 80, label: `Screens are ${s.distance.toFixed(1)} m away`, size: 56, align: "center" });
    const y0 = CY + 330 + 100 + GAP / 2;
    const h = Math.floor((CY + CH - y0 - GAP) / 2);
    const w = Math.floor((CW - GAP) / 2);
    const small: Zone[] = [
      { id: "recenter", kind: "button", x: 0, y: 0, w, h, label: "Recenter", icon: "recenter" },
      { id: "env", kind: "button", x: 0, y: 0, w, h, label: s.env, icon: "globe" },
      { id: "save", kind: "button", x: 0, y: 0, w, h, label: "Save layout", icon: "save" },
      { id: "cal", kind: "button", x: 0, y: 0, w, h, label: s.calibrating ? "Hands flat on desk" : s.deskSet ? "Find desk again" : "Find desk", icon: "desk", active: s.calibrating },
    ];
    small.forEach((b, i) => { b.x = CX + (i % 2) * (w + GAP); b.y = y0 + Math.floor(i / 2) * (h + GAP); z.push(b); });
  } else {
    z.push(...row(3, CY, 420, (i, x, w): Zone => ([
      { id: "guide", kind: "tile" as const, x, y: 0, w, h: 0, label: "Guide", sub: "Five short steps", icon: "book" },
      { id: "sheet", kind: "tile" as const, x, y: 0, w, h: 0, label: "Gestures", sub: "One-page cheat sheet", icon: "list" },
      { id: "log", kind: "tile" as const, x, y: 0, w, h: 0, label: s.log ? "Log on" : "Log off", sub: "What the app saw", icon: "list", active: s.log },
    ] as Zone[])[i]!));
    z.push({ id: "note", kind: "text", x: CX, y: CY + 420 + GAP + 10, w: CW, h: 200, label: "Flip your left wrist, or tap Menu under the screen, to open or close this panel. Drag the top bar to move it.", size: 50, align: "center" });
  }
  for (const q of z) if (q.kind === "text" && (q.size ?? MIN_TEXT) < MIN_TEXT) q.size = MIN_TEXT;
  return z;
}

export const defaultDeck = (): DeckState => ({
  tab: "windows", mode: "point", hand: "virtual", distance: 1.4, env: "Passthrough", status: "", windows: [], page: 0, snips: [], snipMode: false, calibrating: false, deskSet: false, log: false, dimmed: false,
});
