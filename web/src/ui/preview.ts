// Dev-only page (vite dev, never in the build): the real UI surfaces in a three.js scene seen from the head at the real distances,
// with a stand-in Mac screen and window streams. `scripts/shots.mjs` screenshots it. ?s=deck|guide|sheet|chip&tab=&step=&hover=&windows=&snips=
import * as THREE from "three";
import { Surface } from "./surface";
import { DECK_H, DECK_M, DECK_W, deckLayout, defaultDeck, type Tab } from "./deck";
import { CHIP_H, CHIP_M, CHIP_W, GUIDE_H, GUIDE_M, GUIDE_W, SHEET_H, SHEET_M, SHEET_W, chipLayout, guideLayout, modeIconOf, sheetLayout } from "./guide";
import { RADIAL, RADIAL_M, radialLayout } from "./radial";
import { BAR_H, BAR_PX_PER_M, barLayout } from "./rescue";
import type { Mode } from "../modes/modes";

const q = new URLSearchParams(location.search);
const W = Number(q.get("w") ?? 2400), H = Number(q.get("h") ?? 1500);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a2230);
const camera = new THREE.PerspectiveCamera(90, W / H, 0.02, 50);
camera.position.set(0, 1.6, 0);

// the Mac screen, 1.3 m wide at 1.4 m
const mac = document.createElement("canvas"); mac.width = 1600; mac.height = 900;
{
  const g = mac.getContext("2d")!;
  const gr = g.createLinearGradient(0, 0, 1600, 900); gr.addColorStop(0, "#334155"); gr.addColorStop(1, "#7c3aed");
  g.fillStyle = gr; g.fillRect(0, 0, 1600, 900);
  g.fillStyle = "rgba(255,255,255,0.85)"; g.fillRect(0, 0, 1600, 36);
  g.fillStyle = "#f8fafc"; g.beginPath(); g.roundRect(380, 150, 840, 560, 16); g.fill();
  g.fillStyle = "#94a3b8"; for (let i = 0; i < 9; i++) g.fillRect(420, 200 + i * 48, 300 + (i * 97) % 400, 20);
  g.font = "28px system-ui"; g.fillStyle = "#e2e8f0"; g.fillText("Finder   File   Edit   View", 20, 26);
}
const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3 * 900 / 1600), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(mac) }));
(screen.material as THREE.MeshBasicMaterial).map!.colorSpace = THREE.SRGBColorSpace;
screen.position.set(0, 1.6, -1.4);
scene.add(screen);

const fakeWin = (c1: string, label: string): HTMLCanvasElement => {
  const c = document.createElement("canvas"); c.width = 640; c.height = 400;
  const g = c.getContext("2d")!; g.fillStyle = c1; g.fillRect(0, 0, 640, 400); g.fillStyle = "#fff"; g.font = "64px system-ui"; g.fillText(label, 30, 120);
  g.fillStyle = "rgba(255,255,255,.6)"; for (let i = 0; i < 5; i++) g.fillRect(30, 170 + i * 40, 300 + i * 40, 16);
  return c;
};
const thumbs = new Map<number, HTMLCanvasElement>([[1, fakeWin("#0f766e", "Terminal")], [3, fakeWin("#b45309", "Notes")]]);
const apps = ["Safari", "Terminal", "Notes", "Xcode", "Slack", "Mail", "Finder", "Calendar", "Messages"];

const state = defaultDeck();
state.tab = (q.get("tab") as Tab) ?? "mode";
state.mode = (q.get("mode") as Mode) ?? "point";
state.status = "Connected to the Mac";
state.env = "Passthrough";
const nWin = Number(q.get("windows") ?? 5);
state.windows = Array.from({ length: nWin }, (_, i) => ({ id: i + 1, app: apps[i % apps.length]!, title: ["Documents", "zsh - 120x32", "Meeting notes", "handdesk.xcodeproj", "general"][i % 5]!, open: i === 0 || i === 2 }));
state.snips = Array.from({ length: Number(q.get("snips") ?? 2) }, (_, i) => ({ id: i + 1, source: i ? "window:Terminal" : "display:0", pinned: i === 0 }));
if (q.get("hand")) state.hand = q.get("hand") as typeof state.hand;

const hover = q.get("hover") ?? undefined;
const place = (u: Surface, d: number, dx = 0, dy = 0): void => { u.panel.center = { x: dx, y: 1.6 + dy, z: -d }; u.sync(); scene.add(u.mesh); u.show(true); };
const s = q.get("s") ?? "deck";
if (s === "deck" || s === "all") {
  const deck = new Surface("deck", DECK_M, DECK_W, DECK_H);
  deck.hover = hover;
  place(deck, 0.95, 0, -0.12);
  deck.setZones(deckLayout(state), 0, { thumbs: (id) => thumbs.get(id) });
}
if (s === "guide") {
  const g = new Surface("guide", GUIDE_M, GUIDE_W, GUIDE_H); g.hover = hover;
  place(g, 1.0, 0, -0.05); g.setZones(guideLayout(Number(q.get("step") ?? 0)), 0);
}
if (s === "sheet") {
  const g = new Surface("sheet", SHEET_M, SHEET_W, SHEET_H); g.hover = hover;
  place(g, 1.0, 0, -0.05); g.setZones(sheetLayout(), 0);
}
if (s === "radial") {
  const r = new Surface("radial", RADIAL_M, RADIAL, RADIAL, "radial"); r.hover = hover;
  place(r, 0.8, 0, -0.05); r.setZones(radialLayout(), 0);
}
if (s === "bars") {
  // a title bar over the screen, a window panel and a snip, as in the headset
  const bar = (title: string, closable: boolean, wM: number, x: number, y: number, z: number): void => {
    const b = new Surface("bar", wM, Math.round(wM * BAR_PX_PER_M), BAR_H); b.hover = closable ? hover : undefined;
    b.panel.center = { x, y, z: -z }; b.sync(); scene.add(b.mesh); b.show(true); b.setZones(barLayout(b.W, title, closable), 0);
  };
  bar("Mac screen", false, 1.2, 0, 1.6 + 1.3 * 900 / 1600 / 2 + 0.056, 1.4);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.56), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(fakeWin("#0f766e", "Terminal")) }));
  win.position.set(-0.55, 1.4, -1.0); win.rotation.y = 0.45; scene.add(win);
  bar("Terminal: zsh - 120x32", true, 0.9, -0.55, 1.4 + 0.28 + 0.056, 1.0); scene.children[scene.children.length - 1]!.rotation.y = 0.45;
}
const chip = new Surface("menu", CHIP_M, CHIP_W, CHIP_H, "orb");
chip.hover = s === "chip" ? hover : undefined;
if (s !== "guide" && s !== "radial") { place(chip, 0.75, -0.3, -0.3); chip.setZones(chipLayout(modeInfoLabel(state.mode), "ok", modeIconOf(state.mode)), 0); }
function modeInfoLabel(m: Mode): string { return m === "real" ? "Real devices" : m[0]!.toUpperCase() + m.slice(1); }

renderer.render(scene, camera);
(window as unknown as { __done: boolean }).__done = true;
