import { drawIcon } from "./icons";
import { MIN_TEXT, type Zone } from "./zones";

type G = CanvasRenderingContext2D;
export interface DrawOpts {
  hover?: string;
  pressed?: string;
  /** live picture for a window tile, when that window has a panel */
  thumbs?: (windowId: number) => CanvasImageSource | undefined;
  /** the small Menu button reports link state and draws differently */
  chip?: boolean;
}

const FONT = "Roboto, 'Helvetica Neue', Arial, 'Liberation Sans', system-ui, sans-serif";
export const COLORS = { text: "#f1f5f9", dim: "#a9b6cc", accent: "#3b82f6", accentDark: "#1d4ed8", ok: "#4ade80", bad: "#f87171", wait: "#fbbf24" };

function fit(g: G, text: string, maxW: number): string {
  if (g.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && g.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}

/** Lines of words that fit maxW at the current font. */
export function wrap(g: G, text: string, maxW: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(" ")) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && g.measureText(next).width > maxW) { out.push(cur); cur = word; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

function glass(g: G, W: number, H: number, r: number): void {
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "rgba(28,36,56,0.96)");
  grad.addColorStop(1, "rgba(14,19,32,0.96)");
  g.fillStyle = grad;
  g.beginPath(); g.roundRect(0, 0, W, H, r); g.fill();
  g.strokeStyle = "rgba(255,255,255,0.16)";
  g.lineWidth = 3;
  g.beginPath(); g.roundRect(1.5, 1.5, W - 3, H - 3, r - 1); g.stroke();
}

function font(g: G, px: number, weight = 600): void { g.font = `${weight} ${Math.max(px, MIN_TEXT)}px ${FONT}`; }

function button(g: G, z: Zone, state: "idle" | "hover" | "press", radius: number): void {
  const active = !!z.active || !!z.primary;
  g.beginPath(); g.roundRect(z.x, z.y, z.w, z.h, radius);
  if (state === "press") g.fillStyle = COLORS.accentDark;
  else if (active) { const gr = g.createLinearGradient(0, z.y, 0, z.y + z.h); gr.addColorStop(0, state === "hover" ? "#60a5fa" : "#4f8ff7"); gr.addColorStop(1, state === "hover" ? "#3b82f6" : "#2f6fe0"); g.fillStyle = gr; }
  else g.fillStyle = state === "hover" ? "rgba(96,165,250,0.30)" : "rgba(255,255,255,0.075)";
  g.fill();
  g.lineWidth = state === "hover" ? 5 : 2;
  g.strokeStyle = state === "hover" ? "#bfdbfe" : active ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.14)";
  g.stroke();
}

function chip(g: G, z: Zone, state: "idle" | "hover" | "press"): void {
  button(g, { ...z, active: true }, state, z.h / 2);
  const link = z.sub === "ok" ? COLORS.ok : z.sub === "bad" ? COLORS.bad : COLORS.wait;
  g.fillStyle = link;
  g.beginPath(); g.arc(z.x + 52, z.y + z.h / 2, 16, 0, Math.PI * 2); g.fill();
  if (z.icon) drawIcon(g, z.icon, z.x + 92, z.y + z.h / 2 - 34, 68, "#fff");
  g.fillStyle = "#fff"; font(g, 62, 700); g.textBaseline = "middle"; g.textAlign = "left";
  g.fillText(fit(g, z.label, 300), z.x + 176, z.y + z.h / 2 + 2);
  g.fillStyle = "rgba(255,255,255,0.35)"; g.fillRect(z.x + 500, z.y + 40, 3, z.h - 80);
  drawIcon(g, "menu", z.x + 530, z.y + z.h / 2 - 28, 56, "#fff");
  g.fillStyle = "#fff"; font(g, 54, 600); g.fillText("Menu", z.x + 600, z.y + z.h / 2 + 2);
}

export function drawZones(g: G, W: number, H: number, zones: readonly Zone[], o: DrawOpts = {}): void {
  g.clearRect(0, 0, W, H);
  if (o.chip) { for (const z of zones) chip(g, z, o.pressed === z.id ? "press" : o.hover === z.id ? "hover" : "idle"); return; }
  glass(g, W, H, 56);
  g.textBaseline = "middle";
  for (const z of zones) {
    if (z.kind === "scrim" || (z.disabled && !z.label && !z.icon)) continue;
    const state = z.disabled ? "idle" : o.pressed === z.id ? "press" : o.hover === z.id ? "hover" : "idle";
    const cy = z.y + z.h / 2;
    const fg = z.active || z.primary || state === "press" ? "#ffffff" : COLORS.text;
    const dim = z.active || z.primary || state === "press" ? "rgba(255,255,255,0.88)" : COLORS.dim;
    g.globalAlpha = z.disabled ? 0.35 : 1;
    if (z.kind === "drag") {
      drawIcon(g, z.icon!, 36, 24, 56, COLORS.accent);
      g.fillStyle = COLORS.text; font(g, 58, 700); g.textAlign = "left";
      g.fillText(z.label, 112, cy + 2);
      g.fillStyle = COLORS.dim; font(g, 46, 500); g.textAlign = "right";
      g.fillText(fit(g, z.sub ?? "", 700), W - 24 - 88 - 28, cy + 2);
      // a grip so it reads as a handle
      g.fillStyle = "rgba(255,255,255,0.28)";
      for (let i = -2; i <= 2; i++) { g.beginPath(); g.arc(W / 2 + 240 + i * 26 - 400, cy, 5, 0, Math.PI * 2); g.fill(); }
    } else if (z.kind === "tab") {
      g.beginPath(); g.roundRect(z.x, z.y, z.w, z.h, 28);
      g.fillStyle = z.active ? "rgba(59,130,246,0.32)" : state === "hover" ? "rgba(96,165,250,0.22)" : "rgba(255,255,255,0.03)";
      g.fill();
      if (state === "hover" || z.active) { g.lineWidth = state === "hover" ? 5 : 3; g.strokeStyle = state === "hover" ? "#bfdbfe" : "rgba(147,197,253,0.6)"; g.stroke(); }
      if (z.active) { g.fillStyle = COLORS.accent; g.beginPath(); g.roundRect(z.x, z.y + 22, 10, z.h - 44, 5); g.fill(); }
      drawIcon(g, z.icon!, z.x + 28, cy - 28, 56, z.active ? "#93c5fd" : COLORS.dim);
      g.fillStyle = z.active ? "#fff" : COLORS.text; font(g, z.size ?? 50, 600); g.textAlign = "left";
      g.fillText(fit(g, z.label, z.w - 110 - 8), z.x + 104, cy + 2);
    } else if (z.kind === "text") {
      g.textAlign = z.align === "center" ? "center" : "left";
      const tx = z.align === "center" ? z.x + z.w / 2 : z.x;
      if (z.icon) {
        if (z.w > 300 && z.h > 300) {
          const sz = Math.min(z.w, z.h);
          g.fillStyle = "rgba(59,130,246,0.14)"; g.beginPath(); g.roundRect(z.x, z.y, sz, sz, 56); g.fill();
          drawIcon(g, z.icon, z.x + sz * 0.2, z.y + sz * 0.2, sz * 0.6, COLORS.accent);
          g.globalAlpha = 1; continue;
        }
        drawIcon(g, z.icon, z.x, z.y + 14, 84, COLORS.accent);
        g.textAlign = "left"; g.textBaseline = "alphabetic"; g.fillStyle = COLORS.text; font(g, z.size ?? 54, 700);
        g.fillText(fit(g, z.label, z.w - 116), z.x + 116, z.y + 44);
        g.fillStyle = COLORS.dim; font(g, 46, 500);
        wrap(g, z.sub ?? "", z.w - 116).slice(0, 2).forEach((l, i) => g.fillText(l, z.x + 116, z.y + 100 + i * 52));
        g.textBaseline = "middle";
      } else if (z.sub !== undefined) {
        g.fillStyle = COLORS.text; font(g, z.size ?? 54, 700);
        g.fillText(fit(g, z.label, z.w), tx, z.y + z.h * 0.35);
        g.fillStyle = COLORS.dim; font(g, 46, 500);
        g.fillText(fit(g, z.sub, z.w), tx, z.y + z.h * 0.72);
      } else {
        g.fillStyle = z.size && z.size >= 80 ? "#fff" : /^Step /.test(z.label) ? COLORS.dim : COLORS.text;
        font(g, z.size ?? 54, z.size && z.size >= 80 ? 700 : 500);
        g.textBaseline = "top";
        const lines = wrap(g, z.label, z.w);
        const lh = (z.size ?? 54) * 1.3;
        const top = z.align === "center" ? z.y + Math.max(0, (z.h - lines.length * lh) / 2) : z.y;
        lines.forEach((l, i) => g.fillText(l, tx, top + i * lh));
        g.textBaseline = "middle";
      }
    } else if (z.kind === "tile") {
      button(g, z, state, 36);
      g.save(); g.beginPath(); g.roundRect(z.x, z.y, z.w, z.h, 36); g.clip();
      if (z.thumb !== undefined) {
        const th = Math.floor(z.h * 0.5);
        const img = o.thumbs?.(z.thumb);
        g.fillStyle = "rgba(0,0,0,0.28)"; g.fillRect(z.x + 14, z.y + 14, z.w - 28, th);
        if (img) {
          const iw = (img as HTMLCanvasElement).width, ih = (img as HTMLCanvasElement).height;
          const s = Math.min((z.w - 28) / iw, th / ih);
          g.drawImage(img, z.x + 14 + (z.w - 28 - iw * s) / 2, z.y + 14 + (th - ih * s) / 2, iw * s, ih * s);
        } else drawIcon(g, "app", z.x + z.w / 2 - 38, z.y + 14 + th / 2 - 38, 76, dim);
        g.fillStyle = fg; font(g, 52, 700); g.textAlign = "left";
        g.fillText(fit(g, z.label, z.w - 96), z.x + 24, z.y + th + 54);
        g.fillStyle = dim; font(g, 46, 500);
        g.fillText(fit(g, z.sub ?? "", z.w - 48), z.x + 24, z.y + th + 112);
        if (z.active) { drawIcon(g, "check", z.x + z.w - 72, z.y + th + 22, 44, fg); }
      } else {
        const big = z.h > 300;
        const isz = big ? 120 : 72;
        if (big) {
          drawIcon(g, z.icon!, z.x + z.w / 2 - isz / 2, z.y + 36, isz, fg);
          g.textAlign = "center"; g.fillStyle = fg; font(g, 58, 700);
          for (let px = 58; px > MIN_TEXT && g.measureText(z.label).width > z.w - 40; px -= 2) font(g, px, 700);
          g.fillText(fit(g, z.label, z.w - 40), z.x + z.w / 2, z.y + 36 + isz + 48);
          g.fillStyle = dim; font(g, 46, 500);
          wrap(g, z.sub ?? "", z.w - 48).slice(0, 3).forEach((l, i) => g.fillText(l, z.x + z.w / 2, z.y + 36 + isz + 112 + i * 54));
          if (z.active) { g.fillStyle = "#fff"; g.beginPath(); g.arc(z.x + z.w - 44, z.y + 44, 28, 0, Math.PI * 2); g.fill(); drawIcon(g, "check", z.x + z.w - 62, z.y + 26, 36, COLORS.accentDark); }
        } else {
          drawIcon(g, z.icon!, z.x + 32, cy - isz / 2, isz, fg);
          g.textAlign = "left"; g.fillStyle = fg; font(g, 56, 700);
          g.fillText(fit(g, z.label, z.w - 150), z.x + 128, cy + 2);
        }
      }
      g.restore();
    } else {
      // button
      button(g, z, state, 32);
      const isz = z.label ? 60 : 64;
      g.font = `700 ${z.size ?? 54}px ${FONT}`;
      font(g, z.size ?? 54, 700);
      const tw = z.label ? Math.min(g.measureText(z.label).width, z.w - 40 - isz - 20) : 0;
      const total = (z.icon ? isz + (z.label ? 20 : 0) : 0) + tw;
      let x = z.x + (z.w - total) / 2;
      if (z.icon) { drawIcon(g, z.icon, x, cy - isz / 2, isz, fg); x += isz + (z.label ? 20 : 0); }
      if (z.label) { g.textAlign = "left"; g.fillStyle = fg; g.fillText(fit(g, z.label, tw + 1), x, cy + 2); }
    }
    g.globalAlpha = 1;
  }
}
