import type { KeyAction } from "./keyboard/session";
import type { GestureEvent, Ray } from "./gesture/types";

export interface DisplayInfo { id: number; name: string; x: number; y: number; width: number; height: number; pixelWidth: number; pixelHeight: number }
export interface Hello { type: "hello"; version: number; agent?: string; permissions?: { screenRecording: boolean; accessibility: boolean }; displays: DisplayInfo[] }

export type ClientMessage =
  | { type: "subscribe"; displays: number[]; windows?: number[] }
  | { type: "move"; display?: number; window?: number; x: number; y: number }
  | { type: "button"; display?: number; window?: number; button: "left" | "right"; down: boolean; x: number; y: number }
  | { type: "ping"; t: number }
  | { type: "log"; level: "debug" | "info" | "warn"; message: string }
  | { type: "windows" }
  | { type: "apps" }
  | { type: "app"; action: "launch" | "activate" | "quit"; bundleId: string }
  | { type: "spotlight"; query: string }
  | { type: "open"; id: number }
  | { type: "virtualDisplay"; action: "add"; width: number; height: number; name: string }
  | { type: "virtualDisplay"; action: "remove"; id: number }
  | { type: "dimPhysical"; on: boolean }
  | { type: "scroll"; dx: number; dy: number }
  | { type: "magnify"; delta: number }
  | { type: "swipe"; direction: "left" | "right" | "up" | "down" }
  | { type: "key"; code: string; down: boolean; modifiers?: string[] }
  | { type: "text"; text: string };

export const encode = (m: ClientMessage): string => JSON.stringify(m);

export function parseServerText(s: string): Hello | { type: "error"; message: string } | undefined {
  try {
    const m = JSON.parse(s) as { type?: string };
    if (m.type === "hello" && Array.isArray((m as Hello).displays)) return m as Hello;
    if (m.type === "error" && typeof (m as { message?: unknown }).message === "string") return m as { type: "error"; message: string };
  } catch { /* ignore */ }
  return undefined;
}

export interface VideoFrame { display: number; keyframe: boolean; timestampUs: number; data: Uint8Array }

export function parseVideoFrame(buf: ArrayBuffer): VideoFrame | undefined {
  if (buf.byteLength < 12) return undefined;
  const dv = new DataView(buf);
  if (dv.getUint8(0) !== 1) return undefined;
  return {
    display: dv.getUint8(1),
    keyframe: (dv.getUint8(2) & 1) === 1,
    timestampUs: Number(dv.getBigUint64(3)),
    data: new Uint8Array(buf, 11),
  };
}

/** `avc1.PPCCLL` from the first SPS (NAL type 7) in an Annex B access unit. */
export function codecFromAnnexB(data: Uint8Array): string | undefined {
  for (let i = 0; i + 4 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && (data[i + 2] === 1 || (data[i + 2] === 0 && data[i + 3] === 1))) {
      const start = i + (data[i + 2] === 1 ? 3 : 4);
      if (((data[start] ?? 0) & 0x1f) === 7 && start + 3 < data.length) {
        const h = (n: number) => n.toString(16).padStart(2, "0");
        return `avc1.${h(data[start + 1]!)}${h(data[start + 2]!)}${h(data[start + 3]!)}`;
      }
    }
  }
  return undefined;
}

export function keyActionToMessages(a: KeyAction): ClientMessage[] {
  if (a.kind === "text") return [{ type: "text", text: a.text }];
  if (a.kind === "layout") return [];
  return [
    { type: "key", code: a.code, down: true, modifiers: a.modifiers },
    { type: "key", code: a.code, down: false, modifiers: a.modifiers },
  ];
}

export interface Cursor { display: number; window?: number; x: number; y: number }

/** Carries what a drag and a slow scroll need between events. */
export interface MapperState {
  /** last cursor while the left button is held; the release always goes there, even if the ray misses */
  drag?: Cursor;
  scrollX: number;
  scrollY: number;
}
export const newMapperState = (): MapperState => ({ scrollX: 0, scrollY: 0 });

/**
 * Turns gesture events into agent messages. `hit` resolves a ray to a display position (the page uses the panel
 * picker). Clicks press and release in place; drags press at the pinch-onset ray and follow the hand.
 */
export function gestureToMessages(ev: GestureEvent, hit: (ray: Ray) => Cursor | undefined, state: MapperState = newMapperState()): ClientMessage[] {
  const at = (c: Cursor) => (c.window === undefined ? { display: c.display, x: c.x, y: c.y } : { window: c.window, x: c.x, y: c.y });
  switch (ev.type) {
    case "point":
    case "drag-move": {
      const c = hit(ev.ray);
      if (c && ev.type === "drag-move" && state.drag) state.drag = c;
      return c ? [{ type: "move", ...at(c) }] : [];
    }
    case "click": {
      const c = hit(ev.ray);
      if (!c) return [];
      return [
        { type: "move", ...at(c) },
        { type: "button", ...at(c), button: ev.button, down: true },
        { type: "button", ...at(c), button: ev.button, down: false },
      ];
    }
    case "drag-start": {
      const c = hit(ev.ray);
      if (!c) return [];
      state.drag = c;
      return [{ type: "move", ...at(c) }, { type: "button", ...at(c), button: "left", down: true }];
    }
    case "drag-end": {
      const c = hit(ev.ray) ?? state.drag;
      state.drag = undefined;
      return c ? [{ type: "move", ...at(c) }, { type: "button", ...at(c), button: "left", down: false }] : [];
    }
    case "scroll": {
      state.scrollX += ev.dx;
      state.scrollY += ev.dy;
      const dx = Math.trunc(state.scrollX);
      const dy = Math.trunc(state.scrollY);
      state.scrollX -= dx;
      state.scrollY -= dy;
      return dx === 0 && dy === 0 ? [] : [{ type: "scroll", dx, dy }];
    }
    case "magnify":
      return [{ type: "magnify", delta: ev.delta }];
    case "swipe":
      return [{ type: "swipe", direction: ev.direction }];
    case "mission-control":
      return [{ type: "swipe", direction: "up" }];
    default:
      return [];
  }
}
