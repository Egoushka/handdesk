import { drawIcon } from "./icons";
import { MIN_TEXT, type Zone } from "./zones";
import { PALETTE, RADIUS, TYPE, WEIGHT } from "./style";

type G = CanvasRenderingContext2D;
export interface DrawOpts {
  hover?: string;
  pressed?: string;
  /** live picture for a window tile, when that window has a panel */
  thumbs?: (windowId: number) => CanvasImageSource | undefined;
  /** `radial`: the 3D buttons draw themselves, the canvas stays empty; `card`: one tile on its own texture, no glass */
  look?: "panel" | "radial" | "card";
  /** the window tiles are drawn by 3D cards, so the flat deck leaves them out */
  skipThumbTiles?: boolean;
}

const FONT = "Roboto, 'Helvetica Neue', Arial, 'Liberation Sans', system-ui, sans-serif";
export const COLORS = { text: PALETTE.text, dim: PALETTE.dim, accent: PALETTE.accent, accentDark: PALETTE.accentInk, warn: PALETTE.warn };

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

/** Deep graphite glass: a flat dark body, a faint top light, a hairline edge. No scanlines, no glow. */
function glass(g: G, W: number, H: number, r: number): void {
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "rgba(27,33,43,0.92)");
  grad.addColorStop(1, "rgba(14,18,25,0.92)");
  g.fillStyle = grad;
  g.beginPath(); g.roundRect(0, 0, W, H, r); g.fill();
  g.strokeStyle = PALETTE.hairline; g.lineWidth = 3;
  g.beginPath(); g.roundRect(2, 2, W - 4, H - 4, r - 2); g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.10)"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(r, 5); g.lineTo(W - r, 5); g.stroke();
}

function font(g: G, px: number, weight: number = WEIGHT.label): void { g.font = `${weight} ${Math.max(px, MIN_TEXT)}px ${FONT}`; }

function button(g: G, z: Zone, state: "idle" | "hover" | "press", radius: number): void {
  g.beginPath(); g.roundRect(z.x, z.y, z.w, z.h, radius);
  const warm = !!z.danger;
  if (state === "press") g.fillStyle = warm ? PALETTE.warn : PALETTE.accent;
  else if (z.primary) g.fillStyle = state === "hover" ? "#8dc9ff" : PALETTE.accent;
  else if (z.active) g.fillStyle = PALETTE.accentSoft;
  else if (state === "hover") g.fillStyle = warm ? PALETTE.warnSoft : PALETTE.accentSoft;
  else g.fillStyle = warm ? "rgba(255,180,84,0.10)" : PALETTE.raised;
  g.fill();
  g.lineWidth = state === "hover" ? 4 : 2;
  g.strokeStyle = state === "hover" ? (warm ? PALETTE.warn : PALETTE.accent) : z.active ? "rgba(108,184,255,0.55)" : PALETTE.hairline;
  g.stroke();
}

export function drawZones(g: G, W: number, H: number, zones: readonly Zone[], o: DrawOpts = {}): void {
  g.clearRect(0, 0, W, H);
  if (o.look === "radial") return;
  if (o.look !== "card") glass(g, W, H, RADIUS.l);
  g.textBaseline = "middle";
  for (const z of zones) {
    if (z.kind === "scrim" || (z.disabled && !z.label && !z.icon)) continue;
    if (o.skipThumbTiles && z.thumb !== undefined) continue;
    const state = z.disabled ? "idle" : o.pressed === z.id ? "press" : o.hover === z.id ? "hover" : "idle";
    const cy = z.y + z.h / 2;
    const onAccent = !!z.primary || state === "press";
    const fg = onAccent ? PALETTE.accentInk : COLORS.text;
    const dim = onAccent ? "rgba(6,34,58,0.8)" : COLORS.dim;
    g.globalAlpha = z.disabled ? 0.35 : 1;
    if (z.kind === "drag") {
      drawIcon(g, z.icon!, 36, 24, 56, COLORS.accent);
      g.fillStyle = COLORS.text; font(g, TYPE.title - 14, WEIGHT.emphasis); g.textAlign = "left";
      g.fillText(z.label, 112, cy + 2);
      g.fillStyle = COLORS.dim; font(g, 46, WEIGHT.body); g.textAlign = "right";
      g.fillText(fit(g, z.sub ?? "", 700), W - 24 - 88 - 28, cy + 2);
      // a grip so it reads as a handle
      g.fillStyle = "rgba(255,255,255,0.22)";
      for (let i = -2; i <= 2; i++) { g.beginPath(); g.arc(W / 2 + 240 + i * 26 - 400, cy, 5, 0, Math.PI * 2); g.fill(); }
    } else if (z.kind === "tab") {
      g.beginPath(); g.roundRect(z.x, z.y, z.w, z.h, RADIUS.s);
      g.fillStyle = z.active ? PALETTE.accentSoft : state === "hover" ? "rgba(108,184,255,0.14)" : "rgba(255,255,255,0.03)";
      g.fill();
      if (state === "hover" || z.active) { g.lineWidth = state === "hover" ? 5 : 3; g.strokeStyle = state === "hover" ? PALETTE.accent : "rgba(108,184,255,0.55)"; g.stroke(); }
      if (z.active) { g.fillStyle = COLORS.accent; g.beginPath(); g.roundRect(z.x, z.y + 22, 10, z.h - 44, 5); g.fill(); }
      drawIcon(g, z.icon!, z.x + 28, cy - 28, 56, z.active ? PALETTE.accent : COLORS.dim);
      g.fillStyle = COLORS.text; font(g, z.size ?? 50, WEIGHT.label); g.textAlign = "left";
      g.fillText(fit(g, z.label, z.w - 110 - 8), z.x + 104, cy + 2);
    } else if (z.kind === "text") {
      g.textAlign = z.align === "center" ? "center" : "left";
      const tx = z.align === "center" ? z.x + z.w / 2 : z.x;
      if (z.icon) {
        if (z.w > 300 && z.h > 300) {
          const sz = Math.min(z.w, z.h);
          g.fillStyle = PALETTE.accentSoft; g.beginPath(); g.roundRect(z.x, z.y, sz, sz, RADIUS.l); g.fill();
          drawIcon(g, z.icon, z.x + sz * 0.2, z.y + sz * 0.2, sz * 0.6, COLORS.accent);
          g.globalAlpha = 1; continue;
        }
        drawIcon(g, z.icon, z.x, z.y + 14, 84, COLORS.accent);
        g.textAlign = "left"; g.textBaseline = "alphabetic"; g.fillStyle = COLORS.text; font(g, z.size ?? 54, WEIGHT.emphasis);
        g.fillText(fit(g, z.label, z.w - 116), z.x + 116, z.y + 44);
        g.fillStyle = COLORS.dim; font(g, 46, WEIGHT.body);
        wrap(g, z.sub ?? "", z.w - 116).slice(0, 2).forEach((l, i) => g.fillText(l, z.x + 116, z.y + 100 + i * 52));
        g.textBaseline = "middle";
      } else if (z.sub !== undefined) {
        g.fillStyle = COLORS.text; font(g, z.size ?? 54, WEIGHT.emphasis);
        g.fillText(fit(g, z.label, z.w), tx, z.y + z.h * 0.35);
        g.fillStyle = COLORS.dim; font(g, 46, WEIGHT.body);
        g.fillText(fit(g, z.sub, z.w), tx, z.y + z.h * 0.72);
      } else {
        g.fillStyle = z.size && z.size >= 80 ? COLORS.text : /^Step /.test(z.label) ? COLORS.dim : COLORS.text;
        font(g, z.size ?? 54, z.size && z.size >= 80 ? 700 : 500);
        g.textBaseline = "top";
        const lines = wrap(g, z.label, z.w);
        const lh = (z.size ?? 54) * 1.3;
        const top = z.align === "center" ? z.y + Math.max(0, (z.h - lines.length * lh) / 2) : z.y;
        lines.forEach((l, i) => g.fillText(l, tx, top + i * lh));
        g.textBaseline = "middle";
      }
    } else if (z.kind === "tile") {
      button(g, z, state, RADIUS.m);
      g.save(); g.beginPath(); g.roundRect(z.x, z.y, z.w, z.h, RADIUS.m); g.clip();
      if (z.thumb !== undefined) {
        const th = Math.floor(z.h * 0.5);
        const img = o.thumbs?.(z.thumb);
        g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(z.x + 14, z.y + 14, z.w - 28, th);
        if (img) {
          const iw = (img as HTMLCanvasElement).width, ih = (img as HTMLCanvasElement).height;
          const s = Math.min((z.w - 28) / iw, th / ih);
          g.drawImage(img, z.x + 14 + (z.w - 28 - iw * s) / 2, z.y + 14 + (th - ih * s) / 2, iw * s, ih * s);
        } else drawIcon(g, "app", z.x + z.w / 2 - 38, z.y + 14 + th / 2 - 38, 76, dim);
        g.fillStyle = fg; font(g, 52, WEIGHT.emphasis); g.textAlign = "left";
        g.fillText(fit(g, z.label, z.w - 96), z.x + 24, z.y + th + 54);
        g.fillStyle = dim; font(g, 46, WEIGHT.body);
        g.fillText(fit(g, z.sub ?? "", z.w - 48), z.x + 24, z.y + th + 112);
        if (z.active) { drawIcon(g, "check", z.x + z.w - 72, z.y + th + 22, 44, fg); }
      } else {
        const big = z.h > 300;
        const isz = big ? 120 : 72;
        if (big) {
          drawIcon(g, z.icon!, z.x + z.w / 2 - isz / 2, z.y + 36, isz, fg);
          g.textAlign = "center"; g.fillStyle = fg; font(g, 58, WEIGHT.emphasis);
          for (let px = 58; px > MIN_TEXT && g.measureText(z.label).width > z.w - 40; px -= 2) font(g, px, WEIGHT.emphasis);
          g.fillText(fit(g, z.label, z.w - 40), z.x + z.w / 2, z.y + 36 + isz + 48);
          g.fillStyle = dim; font(g, 46, WEIGHT.body);
          wrap(g, z.sub ?? "", z.w - 48).slice(0, 3).forEach((l, i) => g.fillText(l, z.x + z.w / 2, z.y + 36 + isz + 112 + i * 54));
          if (z.active) { g.fillStyle = PALETTE.accent; g.beginPath(); g.arc(z.x + z.w - 44, z.y + 44, 28, 0, Math.PI * 2); g.fill(); drawIcon(g, "check", z.x + z.w - 62, z.y + 26, 36, COLORS.accentDark); }
        } else {
          drawIcon(g, z.icon!, z.x + 32, cy - isz / 2, isz, fg);
          g.textAlign = "left"; g.fillStyle = fg; font(g, 56, WEIGHT.emphasis);
          g.fillText(fit(g, z.label, z.w - 150), z.x + 128, cy + 2);
        }
      }
      g.restore();
    } else {
      // button
      button(g, z, state, RADIUS.m);
      const isz = z.label ? 60 : 64;
      g.font = `${WEIGHT.emphasis} ${z.size ?? 54}px ${FONT}`;
      font(g, z.size ?? 54, WEIGHT.emphasis);
      const tw = z.label ? Math.min(g.measureText(z.label).width, z.w - 40 - isz - 20) : 0;
      const total = (z.icon ? isz + (z.label ? 20 : 0) : 0) + tw;
      let x = z.x + (z.w - total) / 2;
      if (z.icon) { drawIcon(g, z.icon, x, cy - isz / 2, isz, fg); x += isz + (z.label ? 20 : 0); }
      if (z.label) { g.textAlign = "left"; g.fillStyle = fg; g.fillText(fit(g, z.label, tw + 1), x, cy + 2); }
    }
    g.globalAlpha = 1;
  }
}
