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

export const INTRO: string[] = [
  "Aim your hand at a panel and pinch: that is a click.",
  "Left palm up: the menu appears above it. Touch an item with your other index finger.",
  "The box by your left hand shows the mode and what it saw.",
  "Pinch now to start.",
];
