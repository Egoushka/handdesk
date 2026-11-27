import type { Vec3 } from "../gesture/types";
import type { Panel } from "../panel";
import type { Store } from "../onboarding/palm";

export type EnvId = "passthrough" | "dim" | "night" | "grid";
export const ENVIRONMENTS: { id: EnvId; label: string }[] = [
  { id: "passthrough", label: "Passthrough" },
  { id: "dim", label: "Dim passthrough" },
  { id: "night", label: "Night sky" },
  { id: "grid", label: "Grid" },
];
export const nextEnvironment = (e: EnvId): EnvId => ENVIRONMENTS[(ENVIRONMENTS.findIndex((x) => x.id === e) + 1) % ENVIRONMENTS.length]!.id;
export const isVr = (e: EnvId): boolean => e === "night" || e === "grid";

export interface SavedPanel { key: string; center: Vec3; yaw: number; width: number; height: number; curve: number }
export interface SavedLayout { version: 1; panels: SavedPanel[]; keyboard?: { origin: Vec3; yaw: number }; env: EnvId }

/** Stable key for a panel across sessions: display index or window app+title is not stable, so windows key by app name only. */
export const panelKey = (p: Panel, windowApp?: string): string => (p.windowId !== undefined ? `window:${windowApp ?? "?"}` : `display:${p.display}`);

const KEY = "handdesk.layout.default";
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const vec = (v: unknown): v is Vec3 => !!v && typeof v === "object" && finite((v as Vec3).x) && finite((v as Vec3).y) && finite((v as Vec3).z);

export function saveLayout(store: Store, layout: SavedLayout): void {
  store.setItem(KEY, JSON.stringify(layout));
}

export function loadLayout(store: Store): SavedLayout | undefined {
  const raw = store.getItem(KEY);
  if (!raw) return undefined;
  try {
    const l = JSON.parse(raw) as SavedLayout;
    if (l.version !== 1 || !Array.isArray(l.panels) || !ENVIRONMENTS.some((e) => e.id === l.env)) return undefined;
    const panels = l.panels.filter((p) => typeof p.key === "string" && vec(p.center) && finite(p.yaw) && finite(p.width) && finite(p.height) && finite(p.curve) && p.width > 0.1 && p.width < 20 && p.height > 0.05 && p.height < 20);
    const kb = l.keyboard && vec(l.keyboard.origin) && finite(l.keyboard.yaw) ? l.keyboard : undefined;
    return { version: 1, panels, keyboard: kb, env: l.env };
  } catch { return undefined; }
}

export interface Head { position: Vec3; yaw: number }

/** Put every panel in a row in front of the head, keeping each one's size and curve. */
export function recenterPanels<P extends Panel>(panels: P[], head: Head, distance = 1.8, drop = 0.15): P[] {
  const fx = Math.sin(head.yaw);
  const fz = -Math.cos(head.yaw);
  const rx = Math.cos(head.yaw);
  const rz = Math.sin(head.yaw);
  const gap = 0.1;
  const total = panels.reduce((s, p) => s + p.width, 0) + gap * (panels.length - 1);
  let x = -total / 2;
  return panels.map((p) => {
    const off = x + p.width / 2;
    x += p.width + gap;
    return {
      ...p,
      center: { x: head.position.x + fx * distance + rx * off, y: head.position.y - drop, z: head.position.z + fz * distance + rz * off },
      yaw: -head.yaw,
    };
  });
}
