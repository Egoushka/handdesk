import type { Store } from "../onboarding/palm";

/** How hands are shown: your real hands (passthrough only, they hide panels behind them), a skinned hand model, or the joint skeleton. */
export type HandMode = "real" | "skinned" | "joints";
export const HAND_MODES: { id: HandMode; label: string }[] = [
  { id: "real", label: "Real hands" },
  { id: "skinned", label: "Skinned hands" },
  { id: "joints", label: "Joints" },
];
const KEY = "handdesk.handMode";

export const nextHandMode = (m: HandMode): HandMode => HAND_MODES[(HAND_MODES.findIndex((x) => x.id === m) + 1) % HAND_MODES.length]!.id;
export const isHandMode = (s: unknown): s is HandMode => HAND_MODES.some((m) => m.id === s);

export const loadHandMode = (store: Store): HandMode | undefined => { const v = store.getItem(KEY); return isHandMode(v) ? v : undefined; };
export const saveHandMode = (store: Store, m: HandMode): void => store.setItem(KEY, m);

/**
 * The mode actually drawn. Real hands need passthrough, so in a fully virtual scene they fall back to skinned hands.
 * With no saved choice: real in passthrough, skinned in VR.
 */
export function effectiveHandMode(saved: HandMode | undefined, vr: boolean): HandMode {
  const m = saved ?? (vr ? "skinned" : "real");
  return vr && m === "real" ? "skinned" : m;
}
