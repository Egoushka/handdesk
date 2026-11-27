import type { ClientMessage, DisplayInfo } from "../protocol";
import type { Key } from "../keyboard/layouts";

export interface WindowInfo { id: number; app: string; pid: number; title: string; x: number; y: number; width: number; height: number }
export interface AppInfo { name: string; bundleId: string; pid: number; active: boolean }
export interface SpotlightResult { id: number; name: string; kind: string; path: string }
export interface WindowStream { windowId: number; stream: number; width: number; height: number; pixelWidth: number; pixelHeight: number }

export type ServerMessage =
  | { type: "windows"; windows: WindowInfo[] }
  | { type: "windowStreams"; streams: WindowStream[] }
  | { type: "displays"; displays: DisplayInfo[] }
  | { type: "apps"; apps: AppInfo[] }
  | { type: "spotlightResults"; query: string; results: SpotlightResult[] }
  | { type: "virtualDisplay"; ok: boolean; id?: number; error?: string }
  | { type: "dimPhysical"; ok: boolean }
  | { type: "pong"; t: number };

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object";
const num = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const str = (x: unknown): x is string => typeof x === "string";

export function parseMacMessage(text: string): ServerMessage | undefined {
  let m: unknown;
  try { m = JSON.parse(text); } catch { return undefined; }
  if (!isObj(m)) return undefined;
  switch (m.type) {
    case "windows":
      return Array.isArray(m.windows) ? { type: "windows", windows: m.windows.filter((w): w is WindowInfo => isObj(w) && num(w.id) && str(w.app) && num(w.pid) && str(w.title) && num(w.x) && num(w.y) && num(w.width) && num(w.height)) } : undefined;
    case "windowStreams":
      return Array.isArray(m.streams) ? { type: "windowStreams", streams: m.streams.filter((s): s is WindowStream => isObj(s) && num(s.windowId) && num(s.stream) && num(s.width) && num(s.height) && num(s.pixelWidth) && num(s.pixelHeight)) } : undefined;
    case "displays":
      return Array.isArray(m.displays) ? { type: "displays", displays: m.displays as DisplayInfo[] } : undefined;
    case "apps":
      return Array.isArray(m.apps) ? { type: "apps", apps: m.apps.filter((a): a is AppInfo => isObj(a) && str(a.name) && str(a.bundleId) && num(a.pid) && typeof a.active === "boolean") } : undefined;
    case "spotlightResults":
      return str(m.query) && Array.isArray(m.results) ? { type: "spotlightResults", query: m.query, results: m.results.filter((r): r is SpotlightResult => isObj(r) && num(r.id) && str(r.name) && str(r.kind) && str(r.path)) } : undefined;
    case "virtualDisplay":
      return typeof m.ok === "boolean" ? { type: "virtualDisplay", ok: m.ok, id: num(m.id) ? m.id : undefined, error: str(m.error) ? m.error : undefined } : undefined;
    case "dimPhysical":
      return typeof m.ok === "boolean" ? { type: "dimPhysical", ok: m.ok } : undefined;
    case "pong":
      return num(m.t) ? { type: "pong", t: m.t } : undefined;
    default:
      return undefined;
  }
}

/** Everything the Mac last told us. */
export class MacState {
  windows: WindowInfo[] = [];
  apps: AppInfo[] = [];
  results: SpotlightResult[] = [];
  resultsQuery = "";
  displays: DisplayInfo[] = [];
  streams = new Map<number, WindowStream>();
  notice = "";

  apply(m: ServerMessage): void {
    switch (m.type) {
      case "windows": this.windows = m.windows; break;
      case "apps": this.apps = m.apps; break;
      case "displays": this.displays = m.displays; break;
      case "windowStreams": this.streams = new Map(m.streams.map((s) => [s.windowId, s])); break;
      case "spotlightResults": this.results = m.results; this.resultsQuery = m.query; break;
      case "virtualDisplay": this.notice = m.ok ? "" : `Virtual display failed: ${m.error ?? "unknown"}`; break;
      case "dimPhysical": if (!m.ok) this.notice = "Could not dim the Mac screen"; break;
      case "pong": break;
    }
  }
}

export type LauncherAction =
  | { kind: "send"; message: ClientMessage }
  | { kind: "window"; windowId: number }
  | { kind: "local"; id: "close" | "addDisplay" | "dimOn" | "dimOff" | "env" | "recenter" | "save" | "closer" | "farther" | "log" | `mode:${string}` | "cal" | "launcher" | "hands" | "gestures" | "snipDraw" | "snipList" | "snipsClear" | `snipPin:${number}` | `snipClose:${number}` };

export interface Row { text: string; sub?: string; action?: LauncherAction; header?: boolean }

export const VIRTUAL_NAME = "handdesk";
export const isVirtual = (d: DisplayInfo): boolean => d.name.startsWith(VIRTUAL_NAME);

/** The launcher's lines, top to bottom: query, spotlight results, running apps, windows, displays. */
export function launcherRows(state: MacState, query: string, panelIds: ReadonlySet<number> = new Set()): Row[] {
  const rows: Row[] = [{ text: query === "" ? "Type to search the Mac" : query, sub: "search", header: true }];
  for (const r of state.results.slice(0, 4)) rows.push({ text: r.name, sub: r.kind, action: { kind: "send", message: { type: "open", id: r.id } } });
  rows.push({ text: "Running apps", header: true });
  for (const a of state.apps.slice(0, 5)) rows.push({ text: a.name, sub: a.active ? "active" : "", action: { kind: "send", message: { type: "app", action: "activate", bundleId: a.bundleId } } });
  rows.push({ text: "Windows", sub: state.windows.length === 0 ? "none on screen" : "tap: own panel", header: true });
  for (const w of state.windows.slice(0, 8)) rows.push({ text: `${panelIds.has(w.id) ? "[panel] " : ""}${w.app}: ${w.title || "untitled"}`.slice(0, 44), action: { kind: "window", windowId: w.id } });
  rows.push({ text: "Displays", header: true });
  rows.push({ text: "Add virtual display", sub: "2560 x 1440", action: { kind: "local", id: "addDisplay" } });
  for (const d of state.displays.filter(isVirtual)) rows.push({ text: `Remove ${d.name} ${d.width}x${d.height}`, action: { kind: "send", message: { type: "virtualDisplay", action: "remove", id: d.id } } });
  rows.push({ text: "Dim Mac screen", action: { kind: "local", id: "dimOn" } });
  rows.push({ text: "Restore Mac screen", action: { kind: "local", id: "dimOff" } });
  return rows;
}

/** Display y (0..1) to a row index of a list drawn in `count` equal rows. */
export const rowIndexAt = (y: number, count: number): number => Math.min(count - 1, Math.max(0, Math.floor(y * count)));

export interface QueryEdit { query: string; submit: boolean }

/** Virtual keyboard key typed while the launcher has focus. */
export function editQuery(query: string, key: Key, shift: boolean): QueryEdit {
  if (key.code === "Backspace") return { query: query.slice(0, -1), submit: false };
  if (key.code === "Enter") return { query, submit: true };
  if (key.code === "Space") return { query: query + " ", submit: false };
  if ((key.kind === "char" || key.kind === "digit") && key.ch) return { query: (query + (shift ? key.ch.toUpperCase() : key.ch)).slice(0, 64), submit: false };
  return { query, submit: false };
}
