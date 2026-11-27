import type { Store } from "../onboarding/palm";

/**
 * How hands are shown: a virtual glove drawn from the joints (default), your real hands (passthrough only, they hide
 * panels behind them), a skinned hand model, or the joint skeleton.
 */
export type HandMode = "virtual" | "real" | "skinned" | "joints";
export const HAND_MODES: { id: HandMode; label: string }[] = [
  { id: "virtual", label: "Virtual hands" },
  { id: "real", label: "Real hands" },
  { id: "skinned", label: "Skinned hands" },
  { id: "joints", label: "Joints" },
];
// v2: the v0.3.1 default was real hands; an old saved choice must not override the new default
const KEY = "handdesk.handMode2";

export const nextHandMode = (m: HandMode): HandMode => HAND_MODES[(HAND_MODES.findIndex((x) => x.id === m) + 1) % HAND_MODES.length]!.id;
export const isHandMode = (s: unknown): s is HandMode => HAND_MODES.some((m) => m.id === s);

export const loadHandMode = (store: Store): HandMode | undefined => { const v = store.getItem(KEY); return isHandMode(v) ? v : undefined; };
export const saveHandMode = (store: Store, m: HandMode): void => store.setItem(KEY, m);

/** The mode actually drawn. Real hands need passthrough, so in a fully virtual scene they fall back to the virtual hand. Default: virtual everywhere. */
export function effectiveHandMode(saved: HandMode | undefined, vr: boolean): HandMode {
  const m = saved ?? "virtual";
  return vr && m === "real" ? "virtual" : m;
}
