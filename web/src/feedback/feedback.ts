import type { Hand, HandFrame } from "../gesture/types";
import { pinchStrength } from "../hands/rig";
import { modeInfo, type Mode } from "../modes/modes";

export interface GestureNote { name: string; hand?: Hand; time: number }

/** The last gestures the page recognised, newest first. A repeat within 150 ms of the same name is merged (a drag is one gesture). */
export class GestureLog {
  readonly items: GestureNote[] = [];
  constructor(readonly size = 10) {}

  add(name: string, time: number, hand?: Hand): void {
    const top = this.items[0];
    if (top && top.name === name && top.hand === hand && time - top.time < 150) { top.time = time; return; }
    this.items.unshift({ name, hand, time });
    if (this.items.length > this.size) this.items.length = this.size;
  }

  lines(now: number): string[] {
    return this.items.map((g) => `${((now - g.time) / 1000).toFixed(1)}s  ${g.hand ? g.hand[0]!.toUpperCase() + " " : ""}${g.name}`);
  }
}

export const trackingText = (lost: boolean, hands: HandFrame[]): string => {
  if (lost || hands.length === 0) return "hands lost";
  return hands.length === 2 ? "both hands" : `${hands[0]!.hand} hand only`;
};

const bar = (f: number, n = 8): string => "█".repeat(Math.round(f * n)) + "░".repeat(n - Math.round(f * n));

/** The strongest pinch of either hand, 0..1. */
export const strongestPinch = (hands: HandFrame[]): number => hands.reduce((m, h) => Math.max(m, pinchStrength(h)), 0);

export interface HudState { mode: Mode; last?: GestureNote; pinch: number; tracking: string; now: number }

export function hudLines(s: HudState): string[] {
  const last = s.last && s.now - s.last.time < 4000 ? `${s.last.hand ? s.last.hand + " " : ""}${s.last.name}` : "none yet";
  return [`Mode: ${modeInfo(s.mode).label}`, `Gesture: ${last}`, `Pinch ${bar(s.pinch)} ${Math.round(s.pinch * 100)}%`, `Tracking: ${s.tracking}`];
}

export interface Ripple { x: number; y: number; key: string; start: number }
export const RIPPLE_MS = 450;
/** Ring size and opacity at an age, 0..1 through the ripple's life; undefined once it is over. */
export function rippleAt(age: number): { radius: number; opacity: number } | undefined {
  if (age < 0 || age > RIPPLE_MS) return undefined;
  const f = age / RIPPLE_MS;
  return { radius: 0.012 + 0.05 * f, opacity: 0.9 * (1 - f) };
}
