import * as THREE from "three";
import { GestureClassifier } from "../gesture/classifier";
import type { GestureEvent, HandFrame, Hand, Ray, Vec3 } from "../gesture/types";
import { calibrateFromFlatHands, planeFromYaw, toPlane, type TypingPlane } from "../keyboard/plane";
import { POKE, PressDetector, SURFACE, type FingerTip } from "../keyboard/press";
import { TypingSession } from "../keyboard/session";
import { StripSwipe } from "../keyboard/strip";
import { editQuery, launcherRows, MacState, rowIndexAt, type Row, type ServerMessage } from "../mac/state";
import { HintTracker } from "../onboarding/hints";
import { PalmMenuDetector, introDone, markIntroDone } from "../onboarding/palm";
import { CHEAT_SHEET, INTRO, Stats, statusLine, type Permissions } from "../onboarding/status";
import { TrackingState } from "../hands/rig";
import { applyGrab, pickPanel, planePoint, type Panel } from "../panel";
import { gestureToMessages, keyActionToMessages, newMapperState, type ClientMessage } from "../protocol";
import { DirectTouch } from "../space/touch";
import { dragHandle, handlesOf, handlesVisible, distanceToPanel, pickHandle, type HandleKind } from "../space/handles";
import { windowPanel } from "../space/windows";
import { ExtraGestures, EXTRA_CHEAT_SHEET, type ExtraEvent } from "../gesture/extra";
import { extraToMessages } from "../gesture/extraMessages";
import { effectiveHandMode, HAND_MODES, loadHandMode, nextHandMode, saveHandMode, type HandMode } from "../hands/mode";
import { SkinnedHands } from "../hands/skin";
import { inTitleBand, titleDragCenter } from "../space/titledrag";
import { sessionInit } from "./session";
import { ENVIRONMENTS, isVr, loadLayout, nextEnvironment, recenterPanels, saveLayout, type EnvId } from "../space/layout";
import { Connection } from "./connection";
import { dirToWorld, rayToWorld, readInput, startSession, toWorld, type HeadFrame, type XRMode } from "./xr";
import { Billboard, HandleDots, HandsView, KeyboardView, PanelView, TouchDots, UiPanel, clickSound, makeEnvironments } from "./world";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $("status");
const linkEl = $("link");
const setStatus = (s: string) => { statusEl.textContent = s; };

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor");
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.02, 100);
const envs = makeEnvironments();
scene.add(envs.group);
const handsView = new HandsView();
scene.add(handsView.group);
const handleDots = new HandleDots();
const touchDots = new TouchDots();
scene.add(handleDots.mesh, touchDots.mesh);
const rayLines = new Map<Hand, THREE.Line>();
for (const h of ["left", "right"] as Hand[]) {
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.6 }));
  l.visible = false;
  l.frustumCulled = false;
  scene.add(l);
  rayLines.set(h, l);
}

// ---- state ----
const mac = new MacState();
const stats = new Stats();
let linkText = "Starting";
let permissions: Permissions | undefined;
let env: EnvId = (localStorage.getItem("handdesk.env") as EnvId | null) ?? "passthrough";
if (!ENVIRONMENTS.some((e) => e.id === env)) env = "passthrough";
envs.set(env);

const displayViews: PanelView[] = [];
const windowViews = new Map<number, PanelView>();
const streamToWindow = new Map<number, number>();
const allViews = (): PanelView[] => [...displayViews, ...windowViews.values()];
let placed = false;
let lastHead: HeadFrame = { position: { x: 0, y: 1.6, z: 0 }, yaw: 0 };

// ---- ui panels ----
const intro = new UiPanel("intro", 0.9, 0.42, 5);
const menu = new UiPanel("menu", 0.62, 0.95, 18);
const gestures = new UiPanel("gestures", 0.9, 0.5, 10);
const launcher = new UiPanel("launcher", 0.8, 1.15, 26);
const uiPanels = [intro, menu, launcher, gestures];
for (const u of uiPanels) scene.add(u.mesh);
const statusBar = new Billboard(1.1, 0.07, 30);
const hintBar = new Billboard(0.5, 0.07, 32);
const lostBar = new Billboard(0.9, 0.12, 42, "rgba(127,29,29,0.9)");
scene.add(statusBar.mesh, hintBar.mesh, lostBar.mesh);

let launcherQuery = "";
let launcherFocused = false;
let uiHover: { id: string; row: number; t: number } | undefined;

const conn = new Connection({
  onStatus: (t) => { linkText = t; linkEl.textContent = t; },
  onConnected: (on) => { if (!on) { permissions = undefined; } },
  onHello(list, hello) {
    permissions = hello.permissions;
    syncDisplays(list.length, list);
    conn.subscribe(list.map((_, i) => i), [...windowViews.keys()]);
    conn.send({ type: "windows" });
    conn.send({ type: "apps" });
  },
  onMessage: onMac,
  onFrame(stream, f) {
    stats.onFrame(performance.now());
    const view = stream >= 128 ? windowViews.get(streamToWindow.get(stream) ?? -1) : displayViews[stream];
    view?.draw(f);
  },
});

function log(level: "debug" | "info" | "warn", message: string): void { conn.send({ type: "log", level, message }); }
addEventListener("error", (e) => log("warn", `page error: ${e.message}`));

function onMac(m: ServerMessage): void {
  if (m.type === "pong") { stats.onPong(m.t, performance.now()); return; }
  mac.apply(m);
  if (m.type === "displays") { syncDisplays(m.displays.length, m.displays); conn.subscribe(m.displays.map((_, i) => i)); }
  if (m.type === "windowStreams") {
    streamToWindow.clear();
    for (const s of m.streams) {
      streamToWindow.set(s.stream, s.windowId);
      const v = windowViews.get(s.windowId);
      if (v && v.canvas.width / v.canvas.height !== s.pixelWidth / s.pixelHeight) {
        v.panel = { ...v.panel, height: v.panel.width * (s.height / s.width) };
        v.sync();
      }
    }
  }
  if (m.type === "windows") for (const id of [...windowViews.keys()]) if (!m.windows.some((w) => w.id === id)) removeWindowPanel(id);
}

function syncDisplays(n: number, list: { name: string; width: number; height: number; pixelWidth: number; pixelHeight: number }[]): void {
  while (displayViews.length > n) { const v = displayViews.pop()!; scene.remove(v.mesh); }
  list.forEach((d, i) => {
    if (displayViews[i]) return;
    const width = 2.4;
    const panel: Panel = { display: i, center: { x: i * (width + 0.1), y: 1.45, z: -1.8 }, yaw: 0, width, height: width * (d.height / d.width), curve: 0.5 };
    const v = new PanelView(panel, d.pixelWidth, d.pixelHeight, d.name || `Display ${i + 1}`);
    displayViews.push(v);
    scene.add(v.mesh);
    if (placed) arrange(lastHead);
  });
}

function addWindowPanel(id: number): void {
  const w = mac.windows.find((x) => x.id === id);
  if (!w || windowViews.has(id)) return;
  const panel = windowPanel(id, w, lastHead, windowViews.size);
  const v = new PanelView(panel, Math.round(w.width * 2), Math.round(w.height * 2), `${w.app}: ${w.title || "window"}`);
  windowViews.set(id, v);
  scene.add(v.mesh);
  conn.subscribe(displayViews.map((_, i) => i), [...windowViews.keys()]);
  conn.send({ type: "raise", window: id }); // the Mac window comes forward too
  log("info", `window panel added: ${w.app}`);
}

function removeWindowPanel(id: number): void {
  const v = windowViews.get(id);
  if (!v) return;
  scene.remove(v.mesh);
  windowViews.delete(id);
  conn.subscribe(displayViews.map((_, i) => i), [...windowViews.keys()]);
}

/** Recenter the display row. Window panels keep their own place: they spawn near the head and are moved by hand. */
function arrange(head: HeadFrame): void {
  const views = displayViews;
  recenterPanels(views.map((v) => v.panel), head).forEach((p, i) => { views[i]!.panel = p; views[i]!.sync(); });
}

// ---- typing state ----
const session = new TypingSession();
const detector = new PressDetector(POKE);
let pokeMode = true;
let keyboardOn = true;
let plane: TypingPlane = planeFromYaw({ x: 0, y: 0.95, z: -0.5 }, 0);
const keyboardView = new KeyboardView(session.keys);
scene.add(keyboardView.mesh);
const pressed = new Map<string, number>();
const stripSwipe = new StripSwipe();
let audio: AudioContext | undefined;
let calibrating: { until: number; planes: TypingPlane[] } | undefined;

// ---- hands ----
const skinned = new SkinnedHands(renderer);
scene.add(skinned.group);
let handSaved: HandMode | undefined = loadHandMode(localStorage);
let handMode: HandMode = effectiveHandMode(handSaved, false);
let xrMode: XRMode = "immersive-ar";
function applyHandMode(): void {
  handMode = effectiveHandMode(handSaved, xrMode === "immersive-vr" || isVr(env));
  handsView.group.visible = handMode === "joints";
  skinned.show(handMode === "skinned");
}

// ---- menu ----
const menuRows = (): Row[] => [
  { text: "handdesk", sub: "cheat sheet", header: true },
  ...CHEAT_SHEET.map((t) => ({ text: t, header: true })),
  { text: `Environment: ${ENVIRONMENTS.find((e) => e.id === env)!.label}`, action: { kind: "local", id: "env" } },
  { text: "Recenter", action: { kind: "local", id: "recenter" } },
  { text: "Save layout", action: { kind: "local", id: "save" } },
  { text: keyboardOn ? "Keyboard: on" : "Keyboard: off", action: { kind: "local", id: "kb" } },
  { text: calibrating ? "Hands flat on the desk..." : pokeMode ? "Find desk (hands flat)" : "Desk set: find again", action: { kind: "local", id: "cal" } },
  { text: "Launcher", action: { kind: "local", id: "launcher" } },
  { text: `Hands: ${HAND_MODES.find((m) => m.id === handMode)!.label}`, action: { kind: "local", id: "hands" } },
  { text: "More gestures", action: { kind: "local", id: "gestures" } },
];
function localAction(id: string, time: number): void {
  if (id === "env") { env = nextEnvironment(env); envs.set(env); localStorage.setItem("handdesk.env", env); applyHandMode(); }
  else if (id === "recenter") arrange(lastHead);
  else if (id === "save") {
    saveLayout(localStorage, {
      version: 1,
      env,
      panels: allViews().map((v) => ({ key: v.panel.windowId === undefined ? `display:${v.panel.display}` : `window:${mac.windows.find((w) => w.id === v.panel.windowId)?.app ?? "?"}`, center: v.panel.center, yaw: v.panel.yaw, width: v.panel.width, height: v.panel.height, curve: v.panel.curve })),
      keyboard: pokeMode ? undefined : { origin: plane.origin, yaw: Math.atan2(-plane.uAxis.z, plane.uAxis.x) },
    });
    log("info", "layout saved");
  } else if (id === "kb") { keyboardOn = !keyboardOn; keyboardView.mesh.visible = keyboardOn; }
  else if (id === "cal") calibrating = { until: time + 2500, planes: [] };
  else if (id === "launcher") { launcher.show(!launcher.visible); launcherFocused = launcher.visible; if (launcher.visible) { conn.send({ type: "windows" }); conn.send({ type: "apps" }); placeUi(launcher, lastHead, -0.55, 1.1); } }
  else if (id === "hands") { handSaved = nextHandMode(handMode); saveHandMode(localStorage, handSaved); applyHandMode(); }
  else if (id === "gestures") { gestures.setRows([{ text: "More gestures (tap to close)", header: true }, ...EXTRA_CHEAT_SHEET.map((t) => ({ text: t, header: true }))]); gestures.show(!gestures.visible); placeUi(gestures, lastHead, 0.5, 1.1); }
  else if (id === "addDisplay") conn.send({ type: "virtualDisplay", action: "add", width: 2560, height: 1440, name: "handdesk" });
  else if (id === "dimOn") conn.send({ type: "dimPhysical", on: true });
  else if (id === "dimOff") conn.send({ type: "dimPhysical", on: false });
}

function placeUi(u: UiPanel, head: HeadFrame, offset: number, distance: number): void {
  const fx = Math.sin(head.yaw), fz = -Math.cos(head.yaw), rx = Math.cos(head.yaw), rz = Math.sin(head.yaw);
  u.panel.center = { x: head.position.x + fx * distance + rx * offset, y: head.position.y - 0.1, z: head.position.z + fz * distance + rz * offset };
  u.panel.yaw = -head.yaw;
  u.sync();
}

function applyLayout(): boolean {
  const l = loadLayout(localStorage);
  if (!l) return false;
  const used = new Set<string>();
  for (const v of allViews()) {
    const key = v.panel.windowId === undefined ? `display:${v.panel.display}` : `window:${mac.windows.find((w) => w.id === v.panel.windowId)?.app ?? "?"}`;
    const s = l.panels.find((p) => p.key === key && !used.has(p.key));
    if (!s) continue;
    used.add(key);
    v.panel = { ...v.panel, center: s.center, yaw: s.yaw, width: s.width, height: s.height, curve: s.curve };
    v.sync();
  }
  if (l.keyboard) { plane = planeFromYaw(l.keyboard.origin, l.keyboard.yaw); pokeMode = false; detector.cfg = SURFACE; }
  env = l.env; envs.set(env);
  return used.size > 0;
}

// ---- gestures ----
const classifier = new GestureClassifier();
const hints = new HintTracker();
const palm = new PalmMenuDetector();
const tracking = new TrackingState();
const touch = new DirectTouch<Panel & { uiId?: string }>();
const mapperState = newMapperState();
let activePanel: Panel | undefined;
let grabStart: Panel | undefined;
let grabView: PanelView | undefined;
let handleDrag: { view: PanelView; kind: HandleKind; start: Panel; from: Vec3 } | undefined;
let uiSwallow = false;
let titleDrag: { view: PanelView; start: Panel; from: Vec3 } | undefined;
const extra = new ExtraGestures();
const fistState = newMapperState();
let spread: { view: PanelView; start: Panel } | undefined;
const touchCursor = new Map<string, { display: number; window?: number; x: number; y: number }>();
let lastGestureLog = 0;

const TIPS = [["thumb", "thumb-tip"], ["index", "index-finger-tip"], ["middle", "middle-finger-tip"], ["ring", "ring-finger-tip"], ["pinky", "pinky-finger-tip"]] as const;

const visibleUi = (): UiPanel[] => uiPanels.filter((u) => u.visible);
const macPanels = (): Panel[] => allViews().map((v) => v.panel);

function clickUi(u: UiPanel, y: number, time: number): void {
  const i = rowIndexAt(y, u.slots());
  const row = u.rows[i];
  if (u.id === "intro") { u.show(false); markIntroDone(localStorage); return; }
  if (u.id === "gestures") { u.show(false); return; }
  if (u.id === "launcher") launcherFocused = true;
  const a = row?.action;
  if (!a) return;
  if (a.kind === "local") localAction(a.id, time);
  else if (a.kind === "send") conn.send(a.message);
  else { if (windowViews.has(a.windowId)) removeWindowPanel(a.windowId); else addWindowPanel(a.windowId); }
}

const hitFn = (head: HeadFrame) => (ray: Ray) => {
  const h = pickPanel(rayToWorld(ray, head), macPanels());
  return h ? { display: h.hit.display, window: h.hit.window, x: h.hit.x, y: h.hit.y } : undefined;
};

function handleGesture(ev: GestureEvent, head: HeadFrame, time: number): void {
  if (ev.type === "grab-start") { activePanel ??= macPanels()[0]; grabView = allViews().find((v) => v.panel === activePanel) ?? allViews()[0]; grabStart = grabView?.panel; return; }
  if (ev.type === "grab-move") {
    if (grabView && grabStart) { grabView.panel = applyGrab(grabStart, dirToWorld(ev.center, head), ev.scale, ev.yaw); grabView.sync(); }
    return;
  }
  if (ev.type === "grab-end") { grabStart = undefined; grabView = undefined; return; }

  if (ev.type === "drag-move" && titleDrag) {
    const to = planePoint(rayToWorld(ev.ray, head), titleDrag.start);
    if (to) { titleDrag.view.panel = { ...titleDrag.start, center: titleDragCenter(titleDrag.start, titleDrag.from, to) }; titleDrag.view.sync(); }
    return;
  }
  if (ev.type === "drag-end" && titleDrag) { titleDrag = undefined; return; }
  if (ev.type === "drag-move" && handleDrag) {
    const to = planePoint(rayToWorld(ev.ray, head), handleDrag.start);
    if (to) { handleDrag.view.panel = dragHandle(handleDrag.start, handleDrag.kind, handleDrag.from, to); handleDrag.view.sync(); }
    return;
  }
  if (ev.type === "drag-end" && handleDrag) { handleDrag = undefined; return; }
  if ((ev.type === "drag-move" || ev.type === "drag-end") && uiSwallow) { if (ev.type === "drag-end") uiSwallow = false; return; }

  if ("ray" in ev && ev.type !== "drag-move" && ev.type !== "drag-end") {
    const ray = rayToWorld(ev.ray, head);
    const ui = pickPanelUi(ray);
    if (ui) {
      uiHover = { id: ui.u.id, row: rowIndexAt(ui.y, ui.u.slots()), t: time };
      if (ev.type === "click" && ev.button === "left") clickUi(ui.u, ui.y, time);
      if (ev.type === "drag-start") uiSwallow = true;
      return;
    }
    uiHover = undefined;
    if (ev.type === "click" && intro.visible) { intro.show(false); markIntroDone(localStorage); }
    if (ev.type === "click" || ev.type === "drag-start") launcherFocused = false;
    if (ev.type === "drag-start") {
      for (const v of allViews()) {
        if (!handlePanelVisible(v.panel)) continue;
        const h = pickHandle(ray, v.panel);
        const from = h && planePoint(ray, v.panel);
        if (h && from) { handleDrag = { view: v, kind: h.kind as HandleKind, start: v.panel, from }; return; }
      }
    }
    const hit = pickPanel(ray, macPanels());
    if (ev.type === "drag-start" && hit && inTitleBand(hit.hit.y)) {
      const view = allViews().find((v) => v.panel === hit.panel);
      const from = planePoint(ray, hit.panel);
      if (view && from) { titleDrag = { view, start: view.panel, from }; activePanel = hit.panel; log("info", "gesture title-move"); return; }
    }
    if (hit) {
      activePanel = hit.panel;
      if (ev.type === "point") setRay(ev.hand, ray, hit.hit.t);
    } else if (ev.type === "point") rayLines.get(ev.hand)!.visible = false;
  }
  if (ev.type !== "point" && ev.type !== "drag-move" && ev.type !== "scroll" && ev.type !== "magnify" && time - lastGestureLog > 250) { lastGestureLog = time; log("debug", `gesture ${ev.type}`); }
  for (const m of gestureToMessages(ev, hitFn(head), mapperState)) conn.send(m);
}

/** The v0.3 gestures: shortcuts go straight out; fist drag reuses the pinch-drag mapping; spread scales the panel in the gaze. */
function handleExtra(ev: ExtraEvent, head: HeadFrame): void {
  if (ev.type === "fist-start" || ev.type === "fist-move" || ev.type === "fist-end") {
    if (!ev.ray) return;
    const kind = ev.type === "fist-start" ? "drag-start" : ev.type === "fist-move" ? "drag-move" : "drag-end";
    for (const m of gestureToMessages({ type: kind, hand: ev.hand, source: "hand", ray: ev.ray }, hitFn(head), fistState)) conn.send(m);
    if (ev.type === "fist-start") log("info", "gesture fist-drag");
    return;
  }
  if (ev.type === "spread") {
    if (!spread) {
      const gaze = pickPanel({ origin: head.position, direction: { x: Math.sin(head.yaw), y: 0, z: -Math.cos(head.yaw) } }, macPanels());
      const view = gaze && allViews().find((v) => v.panel === gaze.panel);
      if (!view) return;
      spread = { view, start: view.panel };
      log("info", "gesture spread");
    }
    spread.view.panel = applyGrab(spread.start, { x: 0, y: 0, z: 0 }, ev.scale, 0);
    spread.view.sync();
    return;
  }
  if (ev.type === "spread-end") { spread = undefined; return; }
  log("info", `gesture ${ev.type}`);
  for (const m of extraToMessages(ev)) conn.send(m);
}

function pickPanelUi(ray: Ray): { u: UiPanel; y: number } | undefined {
  let best: { u: UiPanel; y: number; t: number } | undefined;
  for (const u of visibleUi()) {
    const h = pickPanel(ray, [u.panel]);
    if (h && (!best || h.hit.t < best.t)) best = { u, y: h.hit.y, t: h.hit.t };
  }
  return best;
}

function setRay(hand: Hand, ray: Ray, t: number): void {
  const l = rayLines.get(hand)!;
  if (t < 0.7) { l.visible = false; return; }
  l.geometry.setFromPoints([new THREE.Vector3(ray.origin.x, ray.origin.y - 0.03, ray.origin.z), new THREE.Vector3(ray.origin.x + ray.direction.x * t, ray.origin.y + ray.direction.y * t, ray.origin.z + ray.direction.z * t)]);
  l.visible = true;
  (l.userData as { seen: number }).seen = performance.now();
}

let pointedHandPos: Vec3[] = [];
function handlePanelVisible(p: Panel): boolean {
  return pointedHandPos.some((pt) => handlesVisible(pt, p)) || p === activePanel;
}

// ---- keyboard ----
function typing(hands: HandFrame[]): Set<string> {
  const typists = new Set<string>();
  if (!keyboardOn) return typists;
  const strip = keyboardView.stripRect();
  for (const h of hands) {
    for (const [, joint] of TIPS) {
      const p = h.joints[joint];
      if (!p) continue;
      const c = toPlane(p, plane);
      if (Math.abs(c.u) < keyboardView.width / 2 + 0.03 && c.v > -keyboardView.height / 2 && c.v < strip.v1 + 0.03 && c.h < 0.08 && c.h > -0.15) typists.add(h.hand);
    }
  }
  return typists;
}

function sendActions(actions: ReturnType<TypingSession["accept"]>): void {
  for (const a of actions) for (const m of keyActionToMessages(a)) conn.send(m);
}

let lastQuerySent = "";
function handleKeyboard(world: HandFrame[], time: number): void {
  const tips: FingerTip[] = [];
  for (const h of world) for (const [finger, joint] of TIPS) { const p = h.joints[joint]; if (p) tips.push({ id: `${h.hand}-${finger}`, hand: h.hand, finger, ...toPlane(p, plane) }); }
  const rect = keyboardView.stripRect();
  const swiped = stripSwipe.update(time, tips, rect);
  if (swiped !== undefined && !launcherFocused) sendActions(session.accept(swiped));
  for (const e of detector.update(time, tips)) {
    if (e.type !== "press") continue;
    if (e.v >= rect.v0 && e.v <= rect.v1 && Math.abs(e.u) <= keyboardView.width / 2) {
      if (!launcherFocused) sendActions(session.accept(Math.min(2, Math.max(0, Math.floor(((e.u + keyboardView.width / 2) / keyboardView.width) * 3)))));
      continue;
    }
    const r = session.pressAt(e.u, e.v, time, e.finger === "thumb");
    if (!r.key) continue;
    if (launcherFocused && launcher.visible) {
      if (r.key.kind === "globe") { sendActions(r.actions); }
      else {
        const shift = session.modifierState("shift") !== "off";
        const out = editQuery(launcherQuery, r.key, shift);
        launcherQuery = out.query;
        if (out.submit && mac.results[0]) conn.send({ type: "open", id: mac.results[0].id });
        if (launcherQuery !== lastQuerySent) { lastQuerySent = launcherQuery; conn.send({ type: "spotlight", query: launcherQuery }); }
      }
    } else sendActions(r.actions);
    pressed.set(r.key.code, time);
    audio ??= new AudioContext();
    clickSound(audio);
  }
  for (const [k, t] of pressed) if (time - t > 120) pressed.delete(k);
}

function calibrate(world: HandFrame[], time: number): void {
  if (!calibrating) return;
  const p = calibrateFromFlatHands(world);
  if (p) calibrating.planes.push(p);
  if (time >= calibrating.until) {
    const ps = calibrating.planes;
    calibrating = undefined;
    if (ps.length > 10) {
      const last = ps.slice(-30);
      const avg = (f: (p: TypingPlane) => number) => last.reduce((s, p) => s + f(p), 0) / last.length;
      plane = planeFromYaw({ x: avg((p) => p.origin.x), y: avg((p) => p.origin.y), z: avg((p) => p.origin.z) }, Math.atan2(-avg((p) => p.uAxis.z), avg((p) => p.uAxis.x)));
      pokeMode = false;
      detector.cfg = SURFACE;
    }
  }
}

function placeKeyboardInAir(head: HeadFrame): void {
  const fx = Math.sin(head.yaw), fz = -Math.cos(head.yaw);
  plane = planeFromYaw({ x: head.position.x + fx * 0.5, y: head.position.y - 0.45, z: head.position.z + fz * 0.5 }, -head.yaw);
}

// ---- frame loop ----
let lastUi = 0;
function onFrame(time: number, xrFrame?: XRFrame): void {
  if (xrFrame) {
    const ref = renderer.xr.getReferenceSpace();
    const input = ref && readInput(xrFrame, ref as XRReferenceSpace, time);
    if (input) frame(input, time);
  }
  if (keyboardOn) {
    keyboardView.place(plane);
    keyboardView.draw({ keys: session.keys, lang: session.lang, mod: (x) => session.modifierState(x), pressed, suggestions: launcherFocused && launcher.visible ? [] : session.suggestions(), poke: pokeMode, now: time });
  }
  renderer.render(scene, camera);
}

function frame(input: NonNullable<ReturnType<typeof readInput>>, time: number): void {
  const head = input.head;
  lastHead = head;
  if (!placed && displayViews.length > 0) {
    arrange(head);
    placed = true;
    if (pokeMode) placeKeyboardInAir(head);
    applyLayout();
    if (!introDone(localStorage)) { intro.setRows(INTRO.map((t, i) => ({ text: t, header: i < INTRO.length - 1 })).map((r, i, a) => (i === a.length - 1 ? { ...r, action: { kind: "local", id: "close" } } : r))); intro.show(true); placeUi(intro, head, 0, 1.0); }
    log("info", "layout ready");
  }

  // tracking
  const change = tracking.update(time, input.worldHands.length);
  if (change === "lost") { classifier.reset(); detector.reset(); log("warn", "hand tracking lost"); }
  if (change === "restored") log("info", "hand tracking restored");
  lostBar.mesh.visible = tracking.lost;
  if (tracking.lost) { lostBar.setText("Hands not tracked: bring them into view"); lostBar.place({ x: head.position.x + Math.sin(head.yaw) * 0.8, y: head.position.y - 0.1, z: head.position.z - Math.cos(head.yaw) * 0.8 }, camera); }

  calibrate(input.worldHands, time);

  // palm-up menu follows the left hand
  const open = palm.update(time, input.frame.hands);
  if (open) {
    const lw = input.worldHands.find((h) => h.hand === "left")?.joints.wrist;
    if (lw) {
      menu.show(true);
      menu.setRows(menuRows(), uiHover?.id === "menu" ? uiHover.row : -1);
      menu.panel.center = { x: lw.x, y: lw.y + 0.28, z: lw.z };
      menu.panel.yaw = Math.atan2(head.position.x - lw.x, head.position.z - lw.z);
      menu.sync();
    }
  } else if (menu.visible && !uiHover) menu.show(false);
  if (launcher.visible) launcher.setRows(launcherRows(mac, launcherQuery, new Set(windowViews.keys())), uiHover?.id === "launcher" ? uiHover.row : -1);
  if (uiHover && time - uiHover.t > 300) uiHover = undefined;

  // direct touch: the index finger of hands not typing
  const typists = typing(input.worldHands);
  const tips = input.worldHands.filter((h) => !typists.has(h.hand)).flatMap((h) => (h.joints["index-finger-tip"] ? [{ id: `${h.hand}-touch`, pos: h.joints["index-finger-tip"]! }] : []));
  const touchPanels = [...visibleUi().map((u) => Object.assign({}, u.panel, { uiId: u.id })), ...macPanels()];
  const touching = new Set<string>();
  const dots: { pos: Vec3; yaw: number; down: boolean }[] = [];
  for (const e of touch.update(tips, touchPanels, head.position)) {
    touching.add(e.id.split("-")[0]!);
    const uiId = e.panel.uiId;
    if (e.type === "hover" || e.type === "down" || e.type === "move") dots.push({ pos: surfacePoint(e.panel, e.x, e.y), yaw: e.panel.yaw, down: e.type !== "hover" });
    if (uiId) {
      const u = uiPanels.find((x) => x.id === uiId);
      if (u && e.type === "down") clickUi(u, e.y, time);
      continue;
    }
    const cur = { display: e.panel.display, window: e.panel.windowId, x: e.x, y: e.y };
    if (e.type === "down") { touchCursor.set(e.id, cur); activePanel = e.panel; launcherFocused = false; sendCursor("move", cur); conn.send(button(cur, true)); }
    else if (e.type === "move") { touchCursor.set(e.id, cur); sendCursor("move", cur); }
    else if (e.type === "up") { const c = touchCursor.get(e.id); touchCursor.delete(e.id); if (c) conn.send(button(c, false)); }
  }
  touchDots.set(dots);

  // classifier: hands that are typing or touching stay out of the pointer gestures
  pointedHandPos = input.worldHands.flatMap((h) => (h.joints["index-finger-tip"] ? [h.joints["index-finger-tip"]!] : []));
  const frameIn = { ...input.frame, hands: tracking.lost ? [] : input.frame.hands.filter((h) => !typists.has(h.hand) && !touching.has(h.hand)) };
  for (const ev of classifier.update(frameIn)) handleGesture(ev, head, time);
  for (const ev of extra.update(frameIn)) handleExtra(ev, head);
  if (keyboardOn && !tracking.lost) handleKeyboard(input.worldHands, time);

  // controllers: B held for a second recenters
  const b = input.frame.controllers.some((c) => c.buttonB);
  if (b) { holdB ??= time; if (time - holdB > 1000) { arrange(head); holdB = Infinity; } } else holdB = undefined;

  // visuals
  const panelsNow = [...macPanels(), ...visibleUi().map((u) => u.panel)];
  handsView.update(input.worldHands, (h, joint) => {
    const p = h.joints[joint as "index-finger-tip"];
    if (!p) return 0;
    let d = Math.min(...panelsNow.map((pn) => distanceToPanel(p, pn)), 1);
    if (keyboardOn) { const c = toPlane(p, plane); if (Math.abs(c.u) < keyboardView.width / 2 && Math.abs(c.v) < keyboardView.height / 2) d = Math.min(d, Math.max(0, c.h)); }
    return Math.max(0, 1 - d / 0.05);
  });
  const shown: ReturnType<typeof handlesOf> = [];
  for (const v of allViews()) if (handlePanelVisible(v.panel)) shown.push(...handlesOf(v.panel));
  handleDots.set(shown);
  for (const l of rayLines.values()) if (l.visible && performance.now() - ((l.userData as { seen?: number }).seen ?? 0) > 200) l.visible = false;

  // hints and status, a few times a second
  const hint = hints.update(input.frame);
  hintBar.mesh.visible = !!hint && !tracking.lost;
  if (hint) { hintBar.setText(hint.text); const w = toWorld(hint.at, head); hintBar.place({ x: w.x, y: w.y + 0.18, z: w.z }, camera); }
  if (time - lastUi > 250) {
    lastUi = time;
    const first = allViews()[0]?.panel;
    const text = [statusLine(linkText, stats, permissions), mac.notice].filter(Boolean).join(" | ");
    statusBar.setText(text);
    statusBar.mesh.visible = true;
    if (first) statusBar.place({ x: first.center.x, y: first.center.y + first.height / 2 + 0.1, z: first.center.z }, camera);
  }
}

let holdB: number | undefined;
const button = (c: { display: number; window?: number; x: number; y: number }, down: boolean): ClientMessage =>
  c.window === undefined ? { type: "button", display: c.display, button: "left", down, x: c.x, y: c.y } : { type: "button", window: c.window, button: "left", down, x: c.x, y: c.y };
function sendCursor(_: "move", c: { display: number; window?: number; x: number; y: number }): void {
  conn.send(c.window === undefined ? { type: "move", display: c.display, x: c.x, y: c.y } : { type: "move", window: c.window, x: c.x, y: c.y });
}
function surfacePoint(p: Panel, x: number, y: number): Vec3 {
  const lx = (x - 0.5) * p.width;
  const ly = (0.5 - y) * p.height;
  const lz = 0.004;
  const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
  return { x: p.center.x + lx * c + lz * s, y: p.center.y + ly, z: p.center.z - lx * s + lz * c };
}

// ---- entering a session ----
async function begin(s: XRSession, mode: XRMode): Promise<void> {
  placed = false;
  xrMode = mode;
  classifier.reset();
  extra.reset();
  detector.reset();
  if (mode === "immersive-vr" && !isVr(env)) { env = "grid"; envs.set(env); }
  s.addEventListener("end", () => { renderer.setAnimationLoop(null); setStatus("Session ended"); $("ui").style.display = "flex"; log("info", "xr session ended"); });
  await renderer.xr.setSession(s);
  applyHandMode();
  renderer.setAnimationLoop(onFrame);
  $("ui").style.display = "none";
  log("info", `xr session started: ${mode}`);
}

async function enter(mode: XRMode): Promise<void> {
  try {
    audio ??= new AudioContext();
    await begin(await startSession(mode), mode);
  } catch (e) {
    setStatus(`Could not start ${mode}: ${(e as Error).message}`);
  }
}
$("enter-ar").addEventListener("click", () => void enter("immersive-ar"));
$("enter-vr").addEventListener("click", () => void enter("immersive-vr"));
$("ui").addEventListener("click", (e) => { if (e.target === $("ui")) void enter("immersive-ar"); });
addEventListener("resize", () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

void (async () => {
  const xr = navigator.xr;
  if (!xr) {
    setStatus("WebXR is not available here. Open this page in the Quest Browser.");
    $("enter-ar").setAttribute("disabled", "");
    $("enter-vr").setAttribute("disabled", "");
  } else {
    const ar = await xr.isSessionSupported("immersive-ar").catch(() => false);
    const vr = await xr.isSessionSupported("immersive-vr").catch(() => false);
    if (!ar) $("enter-ar").setAttribute("disabled", "");
    if (!vr) $("enter-vr").setAttribute("disabled", "");
    if (!ar && !vr) setStatus("This browser supports neither immersive-ar nor immersive-vr.");
    // the browser's own Enter button, where the browser has it: opens straight into the session
    const offer = (xr as unknown as { offerSession?: (m: string, i: unknown) => Promise<XRSession> }).offerSession;
    if (ar && offer) {
      void offer.call(xr, "immersive-ar", sessionInit("immersive-ar")).then((s) => begin(s, "immersive-ar")).catch(() => undefined);
      setStatus("Press Enter AR, or the browser's Enter button.");
    } else if (ar) setStatus("Press Enter AR (or click anywhere on this page).");
  }
  conn.connect();
})();

