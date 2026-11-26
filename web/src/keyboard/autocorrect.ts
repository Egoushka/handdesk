import { PITCH, letterKeys, type Key, type Lang } from "./layouts";
import { vocab } from "./wordlists";

/** Starting values (decision D13). */
export const AUTOCORRECT = { sigma: 0.45 * PITCH, innerFraction: 0.3, searchRadius: 1.6 * PITCH, alpha: 0.02 } as const;

/** The key whose rectangle contains the point, else the nearest key centre within one pitch. */
export function hitTest(keys: Key[], u: number, v: number): Key | undefined {
  let best: Key | undefined;
  let bestD = Infinity;
  for (const k of keys) {
    const du = Math.abs(u - k.u) / k.w;
    const dv = Math.abs(v - k.v) / k.h;
    const d = Math.max(du, dv);
    if (d < bestD) { bestD = d; best = k; }
  }
  return bestD <= 1 ? best : undefined;
}

/** Sum of weights of words starting with the prefix. */
function prefixMass(lang: Lang, prefix: string): number {
  const { words, weight } = vocab(lang);
  let s = 0;
  for (let i = 0; i < words.length; i++) if (words[i]!.startsWith(prefix)) s += weight[i]!;
  return s;
}

export interface Snap { key: Key; corrected: boolean }

/**
 * A press near a key edge snaps to the likelier neighbour: Gaussian around each key centre times the
 * share of word-list mass that continues the typed prefix with that letter. A press in the inner part
 * of its key is never overridden.
 */
export function snap(lang: Lang, prefix: string, u: number, v: number, nearest: Key): Snap {
  if (nearest.kind !== "char") return { key: nearest, corrected: false };
  const inner = Math.abs(u - nearest.u) <= AUTOCORRECT.innerFraction * nearest.w && Math.abs(v - nearest.v) <= AUTOCORRECT.innerFraction * nearest.h;
  if (inner) return { key: nearest, corrected: false };
  const total = prefixMass(lang, prefix);
  if (total === 0) return { key: nearest, corrected: false };
  const letters = letterKeys(lang);
  let best = nearest;
  let bestScore = -1;
  for (const k of letters) {
    const d = Math.hypot(u - k.u, v - k.v);
    if (d > AUTOCORRECT.searchRadius) continue;
    const g = Math.exp(-(d * d) / (2 * AUTOCORRECT.sigma * AUTOCORRECT.sigma));
    const prior = (prefixMass(lang, prefix + k.ch!) + AUTOCORRECT.alpha * total) / (total * (1 + AUTOCORRECT.alpha * letters.length) || 1);
    const score = g * prior;
    if (score > bestScore) { bestScore = score; best = k; }
  }
  return { key: best, corrected: best !== nearest };
}

export function suggest(lang: Lang, prefix: string, n = 3): string[] {
  if (prefix.length === 0) return [];
  const { words } = vocab(lang);
  const out: string[] = [];
  for (const w of words) {
    if (w.length > prefix.length && w.startsWith(prefix)) {
      out.push(w);
      if (out.length === n) break;
    }
  }
  return out;
}
