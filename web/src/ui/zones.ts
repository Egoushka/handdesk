/** A touch target on a UI surface, in canvas pixels. Layout is pure so it can be tested; drawing and hit tests both read the same list. */
export type IconName =
  | "point" | "touch" | "trackpad" | "keyboard" | "arrange" | "devices" | "windows" | "snip" | "hand" | "distance" | "help"
  | "close" | "menu" | "check" | "plus" | "closer" | "farther" | "pin" | "trash" | "search" | "display" | "moon" | "recenter"
  | "save" | "desk" | "globe" | "glove" | "dots" | "book" | "list" | "flip" | "pinch" | "squeeze" | "scroll" | "zoom" | "swipe" | "twohands" | "thumb" | "next" | "prev" | "app";

export type ZoneKind = "tab" | "tile" | "button" | "drag" | "text" | "scrim";

export interface Zone {
  id: string;
  kind: ZoneKind;
  x: number; y: number; w: number; h: number;
  label: string;
  sub?: string;
  icon?: IconName;
  active?: boolean;
  disabled?: boolean;
  primary?: boolean;
  /** text size in canvas px; the draw code never goes below MIN_TEXT */
  size?: number;
  /** a window id: the tile shows that panel's live picture when there is one */
  thumb?: number;
  /** a text zone: left, center */
  align?: "left" | "center";
}

/** Smallest text anywhere, canvas px. At 1739 px per metre (the main menu) 46 px is 2.6 cm: 1.5 degrees at the 0.95 m it opens at. */
export const MIN_TEXT = 46;

export const interactive = (z: Zone): boolean => z.kind !== "text" && !z.disabled;

/** The topmost interactive zone under a point given in 0..1 surface coordinates (top-left origin). Later zones are drawn on top. */
export function zoneAt(zones: readonly Zone[], x: number, y: number, W: number, H: number): Zone | undefined {
  const px = x * W, py = y * H;
  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i]!;
    if (interactive(z) && px >= z.x && px <= z.x + z.w && py >= z.y && py <= z.y + z.h) return z;
  }
  return undefined;
}
