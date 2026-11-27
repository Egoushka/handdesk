export interface Permissions { screenRecording: boolean; accessibility: boolean }

/** Round-trip time from ping/pong and video frames per second. */
export class Stats {
  rtt: number | undefined;
  fps = 0;
  private frames = 0;
  private windowStart: number | undefined;

  onPong(sentAt: number, now: number): void {
    const sample = Math.max(0, now - sentAt);
    this.rtt = this.rtt === undefined ? sample : this.rtt * 0.7 + sample * 0.3;
  }

  onFrame(now: number): void {
    this.windowStart ??= now;
    this.frames++;
    if (now - this.windowStart >= 1000) {
      this.fps = Math.round((this.frames * 1000) / (now - this.windowStart));
      this.frames = 0;
      this.windowStart = now;
    }
  }
}

export function permissionProblems(p: Permissions | undefined): string[] {
  if (!p) return [];
  const out: string[] = [];
  if (!p.screenRecording) out.push("Screen Recording is not granted on the Mac");
  if (!p.accessibility) out.push("Accessibility is not granted on the Mac: clicks and keys will not work");
  return out;
}

export function statusLine(link: string, stats: Stats, permissions: Permissions | undefined): string {
  const bits = [link];
  if (stats.rtt !== undefined) bits.push(`${Math.round(stats.rtt)} ms`);
  if (stats.fps > 0) bits.push(`${stats.fps} fps`);
  const problems = permissionProblems(permissions);
  return problems.length > 0 ? `${bits.join(" | ")} | ${problems[0]}` : bits.join(" | ");
}

export const CHEAT_SHEET: string[] = [
  "Point: your hand ray moves the pointer",
  "Pinch thumb and index: click; hold and move: drag",
  "Thumb and middle: right click",
  "Thumb on index and middle, move the hand: scroll",
  "L shape, change the gap: zoom",
  "Three fingers, swipe 10 cm: Spaces and Mission Control",
  "Both hands pinching: move, turn, resize a panel",
  "Touch a panel within reach: tap and drag",
  "Left palm up: this menu",
];

export const INTRO: string[] = [
  "Point with your hand. Pinch to click.",
  "Pinch with both hands to move a panel.",
  "Hold your left palm up for the cheat sheet.",
  "Pinch now to start.",
];
