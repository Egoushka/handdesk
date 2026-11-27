// Dev-only page (vite dev, never in the build): the real UI surfaces in a three.js scene seen from the head at the real distances,
// with a stand-in Mac screen and window streams. `scripts/shots.mjs` screenshots it. ?s=deck|guide|sheet|chip&tab=&step=&hover=&windows=&snips=
import * as THREE from "three";
import { Surface } from "./surface";
import { DECK_H, DECK_M, DECK_W, deckLayout, defaultDeck, type Tab } from "./deck";
import { GUIDE_H, GUIDE_M, GUIDE_W, SHEET_H, SHEET_M, SHEET_W, guideLayout, sheetLayout } from "./guide";
import { RADIAL, RADIAL_M, radialLayout } from "./radial";
import { BAR_H, BAR_PX_PER_M, HANDLE_M, barLayout, handleLayout } from "./rescue";
import { PanelView } from "../app/world";
import { SnipView } from "../snip/view";
import { headRef } from "../space/tilt";
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
headRef.x = 0; headRef.y = 1.6; headRef.z = 0;
const drawOn = (v: PanelView, c: HTMLCanvasElement): void => { v.canvas.getContext("2d")!.drawImage(c, 0, 0, v.canvas.width, v.canvas.height); v.texture.needsUpdate = true; };
const screenW = 1.3;
const screenView = new PanelView({ display: 0, center: { x: 0, y: 1.6, z: -1.4 }, yaw: 0, width: screenW, height: screenW * 900 / 1600, curve: 0.5 }, 1600, 900, "Mac", 0.03);
drawOn(screenView, mac);
scene.add(screenView.mesh);

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
let deckSurface: Surface | undefined;
if (s === "deck" || s === "all") {
  const deck = new Surface("deck", DECK_M, DECK_W, DECK_H);
  deck.hover = hover;
  place(deck, 0.95, 0, -0.12);
  const ov = state.tab === "windows";
  deck.overview(ov);
  deck.setZones(deckLayout(state), 0, { skipThumbTiles: ov, thumbs: (id) => thumbs.get(id) });
  deckSurface = deck;
}
if (s === "guide") {
  const g = new Surface("guide", GUIDE_M, GUIDE_W, GUIDE_H); g.hover = hover;
  place(g, 1.0, 0, -0.05); g.setZones(guideLayout(Number(q.get("step") ?? 0)), 0);
}
if (s === "sheet") {
  const g = new Surface("sheet", SHEET_M, SHEET_W, SHEET_H); g.hover = hover;
  place(g, 1.0, 0, -0.05); g.setZones(sheetLayout(), 0);
}
let radialSurface: Surface | undefined;
if (s === "radial") {
  const r = new Surface("radial", RADIAL_M, RADIAL, RADIAL, "radial"); r.hover = hover;
  if (q.get("pressed")) r.pressed = { id: q.get("pressed")!, until: 1e9 };
  place(r, 0.8, 0, -0.05); r.setZones(radialLayout(), 0); radialSurface = r;
}
const settle = (u: Surface): void => { for (let i = 0; i < 40; i++) u.animate(1000 + i * 16, { thumbs: (id) => thumbs.get(id) }); };
if (s === "radial") settle(radialSurface!);
if (s === "bars" || s === "room") {
  const sx = screenView.panel;
  const handle = new Surface("handle", HANDLE_M, Math.round(HANDLE_M * BAR_PX_PER_M), BAR_H);
  handle.hover = s === "room" ? undefined : hover;
  handle.panel.center = { x: sx.center.x + sx.width / 2 - HANDLE_M / 2 - 0.02, y: sx.center.y - sx.height / 2 - handle.panel.height / 2 - 0.03, z: sx.center.z + 0.01 };
  handle.sync(); scene.add(handle.mesh); handle.show(true); handle.setZones(handleLayout(handle.W), 0);
  const winPanel = { display: -2, windowId: 1, center: { x: -0.62, y: 1.55, z: -1.0 }, yaw: 0.5, width: 0.9, height: 0.56, curve: 0.2 };
  const win = new PanelView(winPanel, 640, 400, "Terminal");
  drawOn(win, fakeWin("#0f766e", "Terminal"));
  scene.add(win.mesh);
  const bar = new Surface("bar", 0.9, Math.round(0.9 * BAR_PX_PER_M), BAR_H);
  bar.hover = hover;
  bar.panel.center = { x: -0.62, y: 1.55 + 0.28 + 0.056, z: -1.0 }; bar.panel.yaw = 0.5; bar.sync(); scene.add(bar.mesh); bar.show(true); bar.setZones(barLayout(bar.W, "Terminal: zsh - 120x32", true), 0);
  const snip = new SnipView(1, "display:0", screenView.texture, { display: 0, center: { x: 0.2, y: 1.02, z: -1.0 }, yaw: -0.2, width: 0.36, height: 0.22, curve: 0, crop: { x0: 0.25, y0: 0.2, x1: 0.65, y1: 0.7 } }, false);
  scene.add(snip.mesh);
  if (s === "room") {
    const pr = new Surface("radial", RADIAL_M, RADIAL, RADIAL, "radial"); pr.hover = q.get("hover") ?? "r:modes";
    pr.setWidth(0.4); pr.panel.center = { x: -0.28, y: 1.28, z: -0.62 }; pr.panel.yaw = 0.25; pr.sync(); scene.add(pr.mesh); pr.show(true); pr.setZones(radialLayout(), 0); settle(pr);
  }
}
if (deckSurface) settle(deckSurface);
renderer.render(scene, camera);
(window as unknown as { __done: boolean }).__done = true;
