import type { Vec3 } from "../gesture/types";
import { rectValid, type Rect } from "./rect";

/** A snip as saved: where it is and what it shows. Only pinned snips are saved. */
export interface SnipRecord {
  /** `display:N` or `window:App`, the same keys as the saved layout */
  source: string;
  rect: Rect;
  center: Vec3;
  yaw: number;
  width: number;
  height: number;
}

const KEY = "handdesk.snips";
interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void }

const num = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const vec = (v: unknown): v is Vec3 => !!v && num((v as Vec3).x) && num((v as Vec3).y) && num((v as Vec3).z);

export function loadSnips(store: Store): SnipRecord[] {
  try {
    const raw = JSON.parse(store.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((r): r is SnipRecord => {
      const x = r as SnipRecord;
      return !!x && typeof x.source === "string" && !!x.rect && [x.rect.x0, x.rect.y0, x.rect.x1, x.rect.y1].every(num) && rectValid(x.rect) &&
        vec(x.center) && num(x.yaw) && num(x.width) && num(x.height) && x.width > 0.05 && x.height > 0.05 && x.width < 6;
    }).slice(0, 24);
  } catch { return []; }
}

export function saveSnips(store: Store, list: SnipRecord[]): string {
  const s = JSON.stringify(list);
  store.setItem(KEY, s);
  return s;
}
