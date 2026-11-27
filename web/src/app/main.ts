import * as THREE from "three";
import { GestureClassifier } from "../gesture/classifier";
import type { GestureEvent, HandFrame, Hand, Ray, Vec3 } from "../gesture/types";
import { calibrateFromFlatHands, planeFromYaw, toPlane, type TypingPlane } from "../keyboard/plane";
import { POKE, PressDetector, SURFACE, type FingerTip } from "../keyboard/press";
import { TypingSession } from "../keyboard/session";
import { StripSwipe } from "../keyboard/strip";
import { editQuery, launcherRows, MacState, rowIndexAt, type ServerMessage } from "../mac/state";
import { HintTracker } from "../onboarding/hints";
import { introDone, markIntroDone } from "../onboarding/palm";
import { Stats, permissionProblems, type Permissions } from "../onboarding/status";
import { Surface } from "../ui/surface";
import { RADIAL, RADIAL_M, radialLayout } from "../ui/radial";
import { BAR_H, BAR_PX_PER_M, ENTER_HINT, ButtonTapHold, HoldOnce, LIMIT_TEXT, PANIC_HOLD_MS, barLayout, canAddExtra } from "../ui/rescue";
import { DECK_H, DECK_M, DECK_W, deckLayout, pageCount, type DeckState } from "../ui/deck";
import { CHIP_H, CHIP_M, CHIP_W, GUIDE, GUIDE_H, GUIDE_M, GUIDE_W, SHEET_H, SHEET_M, SHEET_W, chipLayout, guideLayout, modeIconOf, sheetLayout } from "../ui/guide";
import { TrackingState } from "../hands/rig";
import { applyGrab, pickPanel, type Panel } from "../panel";
import { gestureToMessages, keyActionToMessages, newMapperState, type ClientMessage } from "../protocol";
import { DirectTouch } from "../space/touch";
import { handlesOf, type Handle, handlesVisible, distanceToPanel } from "../space/handles";
import { windowPanel } from "../space/windows";
import { ExtraGestures, type ExtraEvent } from "../gesture/extra";
import { ArrangeDrag } from "../input/arrange";
import { PointerRouter, type Pick, type PointerAction, type SelectEvent } from "../input/pointer";
import { Trackpad } from "../input/trackpad";
import { GestureLog, hudLines, strongestPinch, trackingText } from "../feedback/feedback";
import { WristFlip, loadMode, modeInfo, policyOf, saveMode, type Mode } from "../modes/modes";
import { DISTANCE_STEP, SPAWN_DISTANCE, SPAWN_WIDTH, headDistance, panelInFront, withDistance } from "../space/surface";
import { extraToMessages } from "../gesture/extraMessages";
import { effectiveHandMode, loadHandMode, saveHandMode, type HandMode } from "../hands/mode";
import { SkinnedHands } from "../hands/skin";
import { sessionInit, startErrorText } from "./session";
import { ENVIRONMENTS, isVr, loadLayout, nextEnvironment, recenterPanels, saveLayout, type EnvId } from "../space/layout";
import { Connection } from "./connection";
import { dirToWorld, rayToWorld, readInput, startSession, toWorld, type HeadFrame, type XRMode } from "./xr";
import { GloveHands, ShadowPool } from "../hands/glove";
import { PoseHold } from "../hands/hold";
import { hoverShadows } from "../hands/shadow";
import { panelPoint } from "../space/surface";
import { fromSource, rectFrom, rectValid, snipSize, type Rect } from "../snip/rect";
import { SnipPinch } from "../snip/ringpinch";
import { snipHandles } from "../snip/handles";
import { loadSnips, saveSnips, type SnipRecord } from "../snip/store";
import { SelectionOverlay, SnipView } from "../snip/view";
import { Billboard, HandleDots, HandsView, KeyboardView, PanelView, TouchDots, UiPanel, clickSound, makeEnvironments } from "./world";
import { CursorViews, HoverFrame, Ripples, TextBoard, tickSound } from "./feedbackView";

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
const glove = new GloveHands();
const shadows = new ShadowPool();
const poseHold = new PoseHold<HandFrame>();
const selection = new SelectionOverlay();
scene.add(glove.group, shadows.group, selection.group);
const handleDots = new HandleDots();
const touchDots = new TouchDots();
scene.add(handleDots.mesh, touchDots.mesh);
const hoverFrame = new HoverFrame();
const cursorViews = new CursorViews();
const ripples = new Ripples();
const hud = new TextBoard(0.22, 4, 40);
const logBoard = new TextBoard(0.3, 11, 34);
scene.add(hoverFrame.group, cursorViews.group, ripples.group, hud.mesh, logBoard.mesh);
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
/** Anything with a panel that can be moved: displays, window panels and snips. */
interface Placed { panel: Panel; sync(): void; mesh: THREE.Object3D }
const sourceViews = (): PanelView[] => [...displayViews, ...windowViews.values()];
const allViews = (): Placed[] => [...sourceViews(), ...snips];
const snips: SnipView[] = [];
const sourceKey = (v: PanelView): string => (v.panel.windowId === undefined ? `display:${v.panel.display}` : `window:${mac.windows.find((w) => w.id === v.panel.windowId)?.app ?? "?"}`);
let placed = false;
let lastHead: HeadFrame = { position: { x: 0, y: 1.6, z: 0 }, yaw: 0 };

// ---- ui panels ----
// the main menu, the guide, the cheat sheet and the Menu button are Surfaces (zones); the launcher is the old text list, only for typing a Spotlight search
const deck = new Surface("deck", DECK_M, DECK_W, DECK_H);
const guide = new Surface("guide", GUIDE_M, GUIDE_W, GUIDE_H);
const sheet = new Surface("sheet", SHEET_M, SHEET_W, SHEET_H);
const chip = new Surface("menu", CHIP_M, CHIP_W, CHIP_H, "orb");
const radial = new Surface("radial", RADIAL_M, RADIAL, RADIAL, "radial");
const launcher = new UiPanel("launcher", 0.8, 1.15, 26);
type UiLike = UiPanel | Surface;
const uiPanels: UiLike[] = [chip, deck, launcher, guide, sheet, radial];
for (const u of uiPanels) scene.add(u.mesh);
const deckState: DeckState = { tab: "windows", mode: "point", hand: "virtual", distance: 1.4, env: "", status: "", windows: [], page: 0, snips: [], snipMode: false, calibrating: false, deskSet: false, log: false, dimmed: false };
let guideStep = 0;
let deckMoved = false;
let deckMove: { hand: Hand; t: number; off: Vec3 } | { hand: Hand; t?: undefined } | undefined;
const statusBar = new Billboard(1.1, 0.07, 30);
const hintBar = new Billboard(0.5, 0.07, 32);
const lostBar = new Billboard(0.9, 0.12, 42, "rgba(127,29,29,0.9)");
scene.add(statusBar.mesh, hintBar.mesh, lostBar.mesh);

let launcherQuery = "";
let launcherFocused = false;
let uiHover: { id: string; x: number; y: number; t: number } | undefined;

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
  while (displayViews.length > n) { const v = displayViews.pop()!; scene.remove(v.mesh); removeBar(v); }
  list.forEach((d, i) => {
    if (displayViews[i]) return;
    const width = SPAWN_WIDTH;
    const panel: Panel = { display: i, center: { x: i * (width + 0.1), y: 1.6, z: -SPAWN_DISTANCE }, yaw: 0, width, height: width * (d.height / d.width), curve: 0.5 };
    const v = new PanelView(panel, d.pixelWidth, d.pixelHeight, d.name || `Display ${i + 1}`);
    displayViews.push(v);
    scene.add(v.mesh);
    ensureBar(v, () => (displayViews.length > 1 ? `Screen ${i + 1}` : "Mac screen"), false);
    if (placed) arrange(lastHead);
  });
}

function addWindowPanel(id: number): void {
  const w = mac.windows.find((x) => x.id === id);
  if (!w) return;
  const have = windowViews.get(id);
  if (have) { focusView(have); return; }
  if (!canAddExtra(windowViews.size + snips.length)) { notify(LIMIT_TEXT); return; }
  const panel = windowPanel(id, w, lastHead, windowViews.size);
  const v = new PanelView(panel, Math.round(w.width * 2), Math.round(w.height * 2), `${w.app}: ${w.title || "window"}`);
  windowViews.set(id, v);
  scene.add(v.mesh);
  ensureBar(v, () => `${w.app}: ${w.title || "window"}`, true);
  conn.subscribe(displayViews.map((_, i) => i), [...windowViews.keys()]);
  conn.send({ type: "raise", window: id }); // the Mac window comes forward too
  log("info", `window panel added: ${w.app}`);
}

function removeWindowPanel(id: number): void {
  const v = windowViews.get(id);
  if (!v) return;
  fadeOut(v.mesh);
  removeBar(v);
  for (const sn of snips.filter((x) => x.panel.windowId === id)) { if (sn.pinned) pendingSnips.push(recordOf(sn)); dropSnip(sn); }
  windowViews.delete(id);
  conn.subscribe(displayViews.map((_, i) => i), [...windowViews.keys()]);
}

// ---- materialise and dissolve ----
const fading: { objs: THREE.Object3D[]; start: number; out: boolean }[] = [];
const FADE_MS = 320;
const eachMat = (o: THREE.Object3D, fn: (m: THREE.MeshBasicMaterial) => void): void => o.traverse((c) => { const m = (c as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined; if (m && "opacity" in m) fn(m); });
function fadeIn(...objs: THREE.Object3D[]): void {
  for (const o of objs) eachMat(o, (m) => { m.transparent = true; });
  fading.push({ objs, start: performance.now(), out: false });
  if (audio) tickSound(audio);
}
function fadeOut(...objs: THREE.Object3D[]): void {
  fading.push({ objs, start: performance.now(), out: true });
}
function updateFades(): void {
  const now = performance.now();
  for (let i = fading.length - 1; i >= 0; i--) {
    const f = fading[i]!;
    const k = Math.min(1, (now - f.start) / FADE_MS);
    const a = f.out ? 1 - k : k;
    for (const o of f.objs) { eachMat(o, (m) => { m.opacity = a; }); const sc = 0.88 + 0.12 * a; o.scale.set(sc, sc, 1); }
    if (k >= 1) {
      for (const o of f.objs) { o.scale.set(1, 1, 1); eachMat(o, (m) => { m.opacity = 1; }); if (f.out) scene.remove(o); }
      fading.splice(i, 1);
    }
  }
}

// ---- title bars, notices and the reset ----
/** Every panel wears a title bar (a Surface above its top edge): the title, and a big Close (or Menu on a screen). */
const bars = new Map<Placed, { bar: Surface; title: () => string; closable: boolean }>();
const barOwner = new Map<Surface, Placed>();
function ensureBar(v: Placed, title: () => string, closable: boolean): void {
  const m = Math.min(1.2, Math.max(0.45, v.panel.width));
  const bar = new Surface(`bar${barOwner.size}-${Math.random().toString(36).slice(2, 6)}`, m, Math.round(m * BAR_PX_PER_M), BAR_H);
  bars.set(v, { bar, title, closable });
  barOwner.set(bar, v);
  uiPanels.push(bar);
  scene.add(bar.mesh);
  bar.show(true);
  fadeIn(v.mesh, bar.mesh);
}
function removeBar(v: Placed): void {
  const b = bars.get(v);
  if (!b) return;
  fadeOut(b.bar.mesh);
  uiPanels.splice(uiPanels.indexOf(b.bar), 1);
  barOwner.delete(b.bar);
  bars.delete(v);
}
function updateBars(time: number): void {
  for (const [v, b] of bars) {
    const p = v.panel;
    b.bar.panel.center = { x: p.center.x, y: p.center.y + p.height / 2 + b.bar.panel.height / 2 + 0.012, z: p.center.z };
    b.bar.panel.yaw = p.yaw;
    b.bar.sync();
    const t = b.title();
    b.bar.setZones(barLayout(b.bar.W, t.length > 30 ? `${t.slice(0, 29)}\u2026` : t, b.closable), time);
  }
}
function closeView(v: Placed): void {
  if (v instanceof SnipView) { dropSnip(v); persistSnips(true); return; }
  const id = (v as PanelView).panel.windowId;
  if (id !== undefined) removeWindowPanel(id);
}
/** Bring an existing panel in front of the head instead of making another. */
function focusView(v: Placed): void {
  v.panel = panelInFront(v.panel, lastHead);
  v.sync();
  activePanel = v.panel;
  const id = v.panel.windowId;
  if (id !== undefined) conn.send({ type: "raise", window: id });
}
const tipLabel = new Billboard(0.3, 0.06, 40, "rgba(8,47,73,0.85)");
scene.add(tipLabel.mesh);
const noticeBar = new Billboard(1.0, 0.16, 40, "rgba(120,53,15,0.94)");
scene.add(noticeBar.mesh);
let noticeUntil = 0;
function notify(text: string, ms = 5000): void { noticeBar.setText(text); noticeUntil = performance.now() + ms; log("info", `notice: ${text}`); }
/** Close every extra (window panels, snips), put the main screen back in front, open the Menu. */
function panic(head: HeadFrame): void {
  for (const id of [...windowViews.keys()]) removeWindowPanel(id);
  for (const sn of [...snips]) dropSnip(sn);
  pendingSnips.length = 0;
  persistSnips(true);
  snipMode = false; snipDraw = undefined; selection.hide();
  launcher.show(false); guide.show(false); sheet.show(false); radial.show(false);
  arrange(head);
  deck.show(false); radial.show(false);
  toggleMenu(head);
  notify("Closed all extras. Your screen is back in front.", 4000);
  log("info", "panic reset");
}

/** Recenter the display row. Window panels keep their own place: they spawn near the head and are moved by hand. */
function arrange(head: HeadFrame): void {
  placeChip(head);
  const views = displayViews;
  recenterPanels(views.map((v) => v.panel), head).forEach((p, i) => { views[i]!.panel = p; views[i]!.sync(); });
}

/** Without a tracked left wrist (controllers) the Menu orb floats low and to the left in front of the head; recenter brings it back. */
function placeChip(head: HeadFrame): void {
  placeUi(chip, head, -0.3, 0.75);
  chip.panel.center.y = head.position.y - 0.4;
  chip.sync();
}

// ---- modes and feedback ----
let mode: Mode = loadMode(localStorage);
const policy = () => policyOf(mode);
const kbOn = (): boolean => policy().keyboard || launcher.visible;
const router = new PointerRouter();
const trackpad = new Trackpad();
const arrangeDrag = new ArrangeDrag();
const wristFlip = new WristFlip();
const gestureLog = new GestureLog(10);
const selQueue: SelectEvent[] = [];
let lastNote: { name: string; hand?: Hand; time: number } | undefined;
let showLog = false;
let lastHud = 0;
let selSnip: Hand | undefined;
let dragView: Placed | undefined;
let gestureLogged = 0;

function note(name: string, time: number, hand?: Hand): void {
  gestureLog.add(name, time, hand);
  lastNote = { name, hand, time };
  if (time - gestureLogged > 250) { gestureLogged = time; log("debug", `gesture ${name}`); }
}

function setMode(m: Mode, time: number): void {
  if (m === mode) return;
  mode = m;
  saveMode(localStorage, m);
  classifier.reset();
  extra.reset();
  router.reset();
  trackpad.reset();
  arrangeDrag.end();
  dragView = undefined;
  note(`mode: ${modeInfo(m).label}`, time);
  if (audio) tickSound(audio);
  log("info", `mode ${m}`);
}

/** A hit is in source coordinates; a snip draws it in its own. */
const localUv = (p: Panel, x: number, y: number): { x: number; y: number } => (p.crop ? fromSource(p.crop, x, y) : { x, y });
const keyOf = (p: Panel): string => (p.windowId === undefined ? `d${p.display}` : `w${p.windowId}`) + (p.crop ? `c${p.crop.x0.toFixed(4)},${p.crop.y0.toFixed(4)},${p.crop.x1.toFixed(4)},${p.crop.y1.toFixed(4)}` : "");
const viewByKey = (k: string): Placed | undefined => allViews().find((v) => keyOf(v.panel) === k);

// ---- typing state ----
const session = new TypingSession();
const detector = new PressDetector(POKE);
let pokeMode = true;
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
  glove.group.visible = handMode === "virtual";
  shadows.group.visible = handMode === "virtual";
  skinned.show(handMode === "skinned");
}

// ---- menu ----
function localAction(id: string, time: number): void {
  if (id.startsWith("hand:")) { handSaved = id.slice(5) as HandMode; saveHandMode(localStorage, handSaved); applyHandMode(); }
  else if (id === "closer" || id === "farther") {
    for (const v of sourceViews()) { v.panel = withDistance(v.panel, lastHead.position, headDistance(v.panel, lastHead.position) + (id === "closer" ? -DISTANCE_STEP : DISTANCE_STEP)); v.sync(); }
  } else if (id === "log") showLog = !showLog;
  else if (id === "env") { env = nextEnvironment(env); envs.set(env); localStorage.setItem("handdesk.env", env); applyHandMode(); }
  else if (id === "recenter") arrange(lastHead);
  else if (id === "save") {
    saveLayout(localStorage, {
      version: 1,
      env,
      panels: sourceViews().map((v) => ({ key: sourceKey(v), center: v.panel.center, yaw: v.panel.yaw, width: v.panel.width, height: v.panel.height, curve: v.panel.curve })),
      keyboard: pokeMode ? undefined : { origin: plane.origin, yaw: Math.atan2(-plane.uAxis.z, plane.uAxis.x) },
    });
    log("info", "layout saved");
  }
  else if (id === "cal") calibrating = { until: time + 2500, planes: [] };
  else if (id === "launcher") { launcher.show(!launcher.visible); launcherFocused = launcher.visible; if (launcher.visible) { conn.send({ type: "windows" }); conn.send({ type: "apps" }); placeUi(launcher, lastHead, -0.55, 1.1); } }
  else if (id === "snipDraw") { snipMode = !snipMode; if (snipMode) deck.show(false); log("info", snipMode ? "snip mode on" : "snip mode off"); }
  else if (id === "snipsClear") { for (const sn of [...snips]) dropSnip(sn); pendingSnips.length = 0; persistSnips(true); }
  else if (id.startsWith("snipPin:")) { const sn = snips.find((x) => x.id === Number(id.slice(8))); if (sn) sn.setPinned(!sn.pinned); persistSnips(true); }
  else if (id.startsWith("snipClose:")) { const sn = snips.find((x) => x.id === Number(id.slice(10))); if (sn) dropSnip(sn); persistSnips(true); }
  else if (id === "addDisplay") conn.send({ type: "virtualDisplay", action: "add", width: 2560, height: 1440, name: "handdesk" });
  else if (id === "dimOn") { deckState.dimmed = true; conn.send({ type: "dimPhysical", on: true }); }
  else if (id === "dimOff") { deckState.dimmed = false; conn.send({ type: "dimPhysical", on: false }); }
}

function placeUi(u: UiLike, head: HeadFrame, offset: number, distance: number): void {
  const fx = Math.sin(head.yaw), fz = -Math.cos(head.yaw), rx = Math.cos(head.yaw), rz = Math.sin(head.yaw);
  u.panel.center = { x: head.position.x + fx * distance + rx * offset, y: head.position.y - 0.1, z: head.position.z + fz * distance + rz * offset };
  u.panel.yaw = -head.yaw;
  u.sync();
}

function applyLayout(): boolean {
  const l = loadLayout(localStorage);
  if (!l) return false;
  const used = new Set<string>();
  for (const v of sourceViews()) {
    const key = sourceKey(v);
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
const tracking = new TrackingState();
const touch = new DirectTouch<Panel & { uiId?: string }>();
const mapperState = newMapperState();
let activePanel: Panel | undefined;
let grabStart: Panel | undefined;
let grabView: Placed | undefined;
let snipMode = false;
let snipDraw: { view: PanelView; a: { x: number; y: number }; b: { x: number; y: number } } | undefined;
let snipSeq = 0;
const snipPinch = new SnipPinch();
const pendingSnips: SnipRecord[] = loadSnips(localStorage);
let snipSig = "";
const extra = new ExtraGestures();
let spread: { view: Placed; start: Panel } | undefined;
const touchCursor = new Map<string, { display: number; window?: number; x: number; y: number }>();

const TIPS = [["thumb", "thumb-tip"], ["index", "index-finger-tip"], ["middle", "middle-finger-tip"], ["ring", "ring-finger-tip"], ["pinky", "pinky-finger-tip"]] as const;

const visibleUi = (): UiLike[] => uiPanels.filter((u) => u.visible);
const macPanels = (): Panel[] => allViews().map((v) => v.panel);

/** Put a surface in front of the head, facing it. */
function placeFront(u: UiLike, head: HeadFrame, distance: number, drop = 0.08): void { placeUi(u, head, 0, distance); u.panel.center.y = head.position.y - drop; u.sync(); }

function toggleDeck(head: HeadFrame): void {
  if (deck.visible) { deck.show(false); return; }
  guide.show(false); sheet.show(false);
  const d = { x: deck.panel.center.x - head.position.x, z: deck.panel.center.z - head.position.z };
  const len = Math.hypot(d.x, d.z) || 1;
  const keep = deckMoved && len < 2.5 && (d.x * Math.sin(head.yaw) - d.z * Math.cos(head.yaw)) / len > 0.5;
  if (!keep) { placeFront(deck, head, 0.95, 0.12); deckMoved = false; }
  deck.show(true);
  conn.send({ type: "windows" });
}

/** The Menu orb or a wrist flip: the radial menu opens, or whatever menu is open closes. */
function toggleMenu(head: HeadFrame): void {
  if (radial.visible || deck.visible) { radial.show(false); deck.show(false); return; }
  guide.show(false); sheet.show(false);
  placeFront(radial, head, 0.8, 0.05);
  radial.show(true);
  if (audio) tickSound(audio);
}
function openDeckTab(tab: DeckState["tab"], head: HeadFrame): void {
  radial.show(false);
  deckState.tab = tab; deckState.page = 0;
  if (!deck.visible) toggleDeck(head);
}

function openGuide(head: HeadFrame): void { guideStep = 0; deck.show(false); sheet.show(false); placeFront(guide, head, 1.0); guide.show(true); }

function radialAction(id: string, time: number): void {
  if (id === "r:close") { radial.show(false); return; }
  if (id === "closeExtras") { panic(lastHead); return; }
  if (id === "r:arrange") { setMode("arrange", time); radial.show(false); notify("Arrange: grab a panel, flick it away to close it", 3500); return; }
  const tab = ({ "r:windows": "windows", "r:snips": "snips", "r:modes": "mode", "r:hands": "hands", "r:screen": "distance", "r:help": "help" } as Record<string, DeckState["tab"]>)[id];
  if (tab) openDeckTab(tab, lastHead);
}

function surfaceAction(u: Surface, id: string, time: number): void {
  const owner = barOwner.get(u);
  if (owner) { if (id === "x") closeView(owner); else if (id === "menu") toggleMenu(lastHead); return; }
  if (u === radial) { radialAction(id, time); return; }
  if (id === "menu") { toggleMenu(lastHead); return; }
  if (u === deck) {
    if (id.startsWith("tab:")) { deckState.tab = id.slice(4) as DeckState["tab"]; deckState.page = 0; }
    else if (id === "close") deck.show(false);
    else if (id.startsWith("mode:")) setMode(id.slice(5) as Mode, time);
    else if (id.startsWith("win:")) addWindowPanel(Number(id.slice(4)));
    else if (id === "closeExtras") panic(lastHead);
    else if (id === "search") { localAction("launcher", time); deck.show(false); }
    else if (id.startsWith("page:")) deckState.page = Math.max(0, Math.min(pageCount(mac.windows.length) - 1, deckState.page + Number(id.slice(5))));
    else if (id === "guide") openGuide(lastHead);
    else if (id === "sheet") { deck.show(false); placeFront(sheet, lastHead, 1.0); sheet.show(true); }
    else if (id === "log") showLog = !showLog;
    else localAction(id, time);
    return;
  }
  if (u === guide) {
    if (id === "gNext") { if (guideStep >= GUIDE.length - 1) { guide.show(false); markIntroDone(localStorage); } else guideStep++; }
    else if (id === "gBack") guideStep = Math.max(0, guideStep - 1);
    else if (id === "gSkip") { guide.show(false); markIntroDone(localStorage); }
    return;
  }
  if (u === sheet && (id === "sheetClose" || id === "sClose")) sheet.show(false);
}

function clickUi(u: UiLike, x: number, y: number, time: number): void {
  if (u instanceof Surface) {
    const z = u.zoneAt(x, y);
    if (!z) return;
    u.pressed = { id: z.id, until: time + 200 };
    if (z.id === "drag") return;
    note(`menu: ${z.label || z.id}`, time);
    surfaceAction(u, z.id, time);
    return;
  }
  const i = rowIndexAt(y, u.slots());
  const row = u.rows[i];
  if (u.id === "launcher") launcherFocused = true;
  const a = row?.action;
  if (!a) return;
  note(`menu: ${row!.text.replace(/^[\u25cf\u25cb] /, "")}`, time);
  if (a.kind === "local") localAction(a.id, time);
  else if (a.kind === "send") conn.send(a.message);
  else addWindowPanel(a.windowId);
}

const hitFn = (head: HeadFrame) => (ray: Ray) => {
  const h = pickPanel(rayToWorld(ray, head), macPanels());
  return h ? { display: h.hit.display, window: h.hit.window, x: h.hit.x, y: h.hit.y } : undefined;
};

/** Nearest thing a world-space ray hits: a page UI panel or a Mac panel. */
function pickAll(ray: Ray): Pick | undefined {
  const ui = pickPanelUi(ray);
  const mac = pickPanel(ray, macPanels());
  if (ui && (!mac || ui.t <= mac.hit.t)) return { key: ui.u.id, ui: ui.u.id, display: -1, x: ui.x, y: ui.y, width: ui.u.panel.width, height: ui.u.panel.height, t: ui.t };
  if (!mac) return undefined;
  return { key: keyOf(mac.panel), display: mac.hit.display, window: mac.hit.window, x: mac.hit.x, y: mac.hit.y, width: mac.panel.width, height: mac.panel.height, t: mac.hit.t };
}

const handPoint = (hands: HandFrame[], hand: Hand): Vec3 | undefined => {
  const h = hands.find((x) => x.hand === hand);
  const a = h?.joints["thumb-tip"], b = h?.joints["index-finger-tip"];
  return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 } : h?.joints.wrist;
};

/** What the pointer router decided: UI clicks, Mac messages (with the click ripple and tick), and panel moves in Arrange. */
function handleAction(a: PointerAction, head: HeadFrame, world: HandFrame[], time: number): void {
  if (a.type === "hover") {
    if (a.pick?.ui) uiHover = { id: a.pick.ui, x: a.pick.x, y: a.pick.y, t: time };
    return;
  }
  if (a.type === "ui") {
    const u = uiPanels.find((x) => x.id === a.id);
    if (u) {
      uiHover = { id: u.id, x: a.x, y: a.y, t: time };
      if (u instanceof Surface && u.zoneAt(a.x, a.y)?.id === "drag") deckMove = { hand: a.hand };
      clickUi(u, a.x, a.y, time);
    }
    return;
  }
  if (a.type === "send") {
    for (const m of a.messages) conn.send(m);
    if (a.gesture) { note(a.gesture, time, a.hand); if (a.gesture !== "scroll") launcherFocused = false; }
    const v = a.at && viewByKey(a.at.key);
    if (a.at) { activePanel = v?.panel ?? activePanel; }
    if (a.ripple && a.at && v) { ripples.add({ ...localUv(v.panel, a.at.x, a.at.y), key: a.at.key, start: time }, v.panel); if (audio) tickSound(audio); }
    return;
  }
  // arrange
  if (a.kind === "squeeze") {
    if (a.phase !== "start" || !a.pick) return;
    const v = viewByKey(a.pick.key);
    if (v) { v.panel = panelInFront(v.panel, head); v.sync(); activePanel = v.panel; note("snap panel in front", time, a.hand); }
    return;
  }
  if (a.phase === "start" && a.ray) {
    dragTrail.length = 0;
    const grabbed = arrangeDrag.start(a.ray, macPanels(), handPoint(world, a.hand), head.position, (p) => {
      const sn = allViews().find((v) => v.panel === p);
      return sn instanceof SnipView ? snipHandles(p, sn.pinned) : handlesOf(p);
    }, (p, kind) => {
      const sn = allViews().find((v) => v.panel === p);
      if (!(sn instanceof SnipView)) return false;
      if (kind === "pin") sn.setPinned(!sn.pinned); else dropSnip(sn);
      persistSnips(true);
      return true;
    });
    dragView = grabbed && allViews().find((v) => v.panel === grabbed);
    if (grabbed) { activePanel = grabbed; note("grab panel", time, a.hand); }
  } else if (a.phase === "move" && a.ray && dragView) {
    const next = arrangeDrag.move(a.ray, handPoint(world, a.hand), head.position);
    if (next) { dragView.panel = next; dragView.sync(); activePanel = next; dragTrail.push({ t: time, p: next.center }); if (dragTrail.length > 12) dragTrail.shift(); }
  } else if (a.phase === "end") {
    const flicked = dragView && !(dragView instanceof PanelView && dragView.panel.windowId === undefined) ? flickSpeed(time) : 0;
    const v = dragView;
    arrangeDrag.end(); dragView = undefined; dragTrail.length = 0;
    if (v && flicked > FLICK_SPEED) { note("flick away", time); closeView(v); }
  }
}

const dragTrail: { t: number; p: Vec3 }[] = [];
/** Metres per second a released panel must be moving to count as a flick: it closes (extras only, never a screen). A starting value. */
const FLICK_SPEED = 2.2;
function flickSpeed(now: number): number {
  const recent = dragTrail.filter((x) => now - x.t < 160);
  if (recent.length < 2) return 0;
  const a = recent[0]!, b = recent[recent.length - 1]!;
  const dt = (b.t - a.t) / 1000;
  return dt > 0 ? Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y, b.p.z - a.p.z) / dt : 0;
}

function snipDrag(phase: "start" | "move" | "end", ray: Ray): void {
  const srcs = sourceViews();
  if (phase === "start") {
    const h = pickPanel(ray, srcs.map((v) => v.panel));
    const view = h && srcs.find((v) => v.panel === h.panel);
    if (h && view) snipDraw = { view, a: { x: h.hit.x, y: h.hit.y }, b: { x: h.hit.x, y: h.hit.y } };
    return;
  }
  if (!snipDraw) return;
  const h = pickPanel(ray, [snipDraw.view.panel]);
  if (h) snipDraw.b = { x: h.hit.x, y: h.hit.y };
  const rect = rectFrom(snipDraw.a, snipDraw.b);
  if (phase === "move") { selection.show(snipDraw.view.panel, rect); return; }
  selection.hide();
  if (rectValid(rect)) createSnip(snipDraw.view, rect);
  snipDraw = undefined;
  snipMode = false;
}

function createSnip(src: PanelView, rect: Rect, rec?: SnipRecord): void {
  if (!canAddExtra(windowViews.size + snips.length)) { if (!rec) notify(LIMIT_TEXT); return; }
  const size = rec ?? snipSize(rect, src.panel);
  const at = panelPoint(src.panel, (rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2, 0.06);
  const panel: Panel = { display: src.panel.display, windowId: src.panel.windowId, center: rec?.center ?? at.pos, yaw: rec?.yaw ?? at.yaw, width: size.width, height: size.height, curve: 0, crop: rect };
  const v = new SnipView(++snipSeq, sourceKey(src), src.texture, panel, !!rec);
  snips.push(v);
  scene.add(v.mesh);
  ensureBar(v, () => `Snip: ${src.panel.windowId === undefined ? "screen" : (mac.windows.find((w) => w.id === src.panel.windowId)?.app ?? "window")}`, true);
  if (!rec) log("info", `snip created from ${v.sourceKey}`);
}

function dropSnip(v: SnipView): void {
  fadeOut(v.mesh);
  removeBar(v);
  snips.splice(snips.indexOf(v), 1);
  if (grabView === v) { grabView = undefined; grabStart = undefined; }
  if (activePanel === v.panel) activePanel = undefined;
}

const recordOf = (v: SnipView): SnipRecord => ({ source: v.sourceKey, rect: v.panel.crop!, center: v.panel.center, yaw: v.panel.yaw, width: v.panel.width, height: v.panel.height });

/** Bring back saved snips whose source panel exists, and save the pinned ones (and those waiting for their source). */
function persistSnips(force = false): void {
  for (const rec of [...pendingSnips]) {
    const src = sourceViews().find((v) => sourceKey(v) === rec.source);
    if (src && canAddExtra(windowViews.size + snips.length)) { pendingSnips.splice(pendingSnips.indexOf(rec), 1); createSnip(src, rec.rect, rec); }
  }
  const sig = JSON.stringify([...snips.filter((x) => x.pinned).map(recordOf), ...pendingSnips]);
  if (sig !== snipSig || force) { snipSig = sig; saveSnips(localStorage, JSON.parse(sig) as SnipRecord[]); }
}

/** Two-hand grab (Arrange and Real devices only); scroll, zoom and swipe go to the Mac in the other modes. */
function handleGesture(ev: GestureEvent, head: HeadFrame, time: number): void {
  if (ev.type === "grab-start") { activePanel ??= macPanels()[0]; grabView = allViews().find((v) => v.panel === activePanel) ?? allViews()[0]; grabStart = grabView?.panel; if (grabView instanceof SnipView && grabView.pinned) { grabView = undefined; grabStart = undefined; } note("two-hand grab", time); return; }
  if (ev.type === "grab-move") {
    if (grabView && grabStart) { grabView.panel = applyGrab(grabStart, dirToWorld(ev.center, head), ev.scale, ev.yaw); grabView.sync(); }
    return;
  }
  if (ev.type === "grab-end") { grabStart = undefined; grabView = undefined; return; }
  if (ev.type !== "scroll" && ev.type !== "magnify") note(ev.type, time, "hand" in ev ? ev.hand : undefined);
  for (const m of gestureToMessages(ev, hitFn(head), mapperState)) conn.send(m);
}

/** The v0.3 gestures: shortcuts go straight out; spread scales the panel in the gaze. Fist drag is gone: the select ray drags now. */
function handleExtra(ev: ExtraEvent, head: HeadFrame, time: number): void {
  if (ev.type === "fist-start" || ev.type === "fist-move" || ev.type === "fist-end") return;
  if (ev.type === "spread") {
    if (!spread) {
      const gaze = pickPanel({ origin: head.position, direction: { x: Math.sin(head.yaw), y: 0, z: -Math.cos(head.yaw) } }, macPanels());
      const view = gaze && allViews().find((v) => v.panel === gaze.panel);
      if (!view) return;
      spread = { view, start: view.panel };
      note("spread resize", time);
    }
    spread.view.panel = applyGrab(spread.start, { x: 0, y: 0, z: 0 }, ev.scale, 0);
    spread.view.sync();
    return;
  }
  if (ev.type === "spread-end") { spread = undefined; return; }
  note(ev.type, time);
  for (const m of extraToMessages(ev)) conn.send(m);
}

function pickPanelUi(ray: Ray): { u: UiLike; x: number; y: number; t: number } | undefined {
  let best: { u: UiLike; x: number; y: number; t: number } | undefined;
  for (const u of visibleUi()) {
    const h = pickPanel(ray, [u.panel]);
    if (h && (!best || h.hit.t < best.t)) best = { u, x: h.hit.x, y: h.hit.y, t: h.hit.t };
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
  return policy().arrange || pointedHandPos.some((pt) => handlesVisible(pt, p)) || p === activePanel;
}

// ---- keyboard ----
function typing(hands: HandFrame[]): Set<string> {
  const typists = new Set<string>();
  if (!kbOn()) return typists;
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
  keyboardView.mesh.visible = kbOn();
  if (kbOn()) {
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
    placeChip(head);
    if (!introDone(localStorage)) openGuide(head);
    notify(ENTER_HINT, 12000);
    try { speechSynthesis.speak(new SpeechSynthesisUtterance(ENTER_HINT)); } catch { /* no speech here */ }
    log("info", "layout ready");
  }

  // tracking
  const change = tracking.update(time, input.worldHands.length);
  if (change === "lost") { classifier.reset(); detector.reset(); log("warn", "hand tracking lost"); }
  if (change === "restored") log("info", "hand tracking restored");
  lostBar.mesh.visible = tracking.lost;
  if (tracking.lost) { lostBar.setText("Hands not tracked: bring them into view"); lostBar.place({ x: head.position.x + Math.sin(head.yaw) * 0.8, y: head.position.y - 0.1, z: head.position.z - Math.cos(head.yaw) * 0.8 }, camera); }

  calibrate(input.worldHands, time);
  if (!tracking.lost && wristFlip.update(time, input.frame.hands)) { toggleMenu(head); note("menu", time); }
  const pol = policy();

  // the menu, guide and cheat sheet: hover and press come from the select ray, content from the live state
  const now = time;
  if (uiHover && time - uiHover.t > 300) uiHover = undefined;
  for (const u of [chip, deck, guide, sheet, radial, ...barOwner.keys()]) u.hover = uiHover?.id === u.id ? u.zoneAt(uiHover.x, uiHover.y)?.id : undefined;
  if (deck.visible) {
    deckState.mode = mode; deckState.hand = handMode; deckState.distance = displayViews[0] ? headDistance(displayViews[0].panel, head.position) : 1.4;
    deckState.env = ENVIRONMENTS.find((e) => e.id === env)!.label; deckState.calibrating = !!calibrating; deckState.deskSet = !pokeMode; deckState.log = showLog; deckState.snipMode = snipMode;
    deckState.status = permissionProblems(permissions)[0] ?? (linkText.startsWith("Connected") ? "Connected to the Mac" : linkText);
    deckState.windows = [...mac.windows].sort((a, b) => Number(windowViews.has(b.id)) - Number(windowViews.has(a.id))).map((w) => ({ id: w.id, app: w.app, title: w.title, open: windowViews.has(w.id) }));
    deckState.snips = snips.map((x) => ({ id: x.id, source: x.sourceKey, pinned: x.pinned }));
    deck.setZones(deckLayout(deckState), now, { thumbs: (id) => { const v = windowViews.get(id); return v?.hasVideo ? v.canvas : undefined; } }, deckState.tab === "windows" ? String(Math.floor(now / 800)) : "");
  }
  if (guide.visible) guide.setZones(guideLayout(guideStep), now);
  if (radial.visible) radial.setZones(radialLayout(), now);
  if (sheet.visible) sheet.setZones(sheetLayout(), now);
  const permBad = permissionProblems(permissions).length > 0;
  chip.show(placed);
  updateBars(time);
  chip.setZones(chipLayout(snipMode ? "Drag a box" : modeInfo(mode).label, permBad || linkText.startsWith("No ") ? "bad" : linkText.startsWith("Connected") ? "ok" : "wait", snipMode ? "snip" : modeIconOf(mode)), now);
  if (launcher.visible) launcher.setRows(launcherRows(mac, launcherQuery, new Set(windowViews.keys())), uiHover?.id === "launcher" ? Math.floor(uiHover.y * launcher.slots()) : -1);

  // moving the menu: grab its top bar with the select ray
  if (deckMove) {
    const ray = (tracking.lost ? {} : input.worldRays)[deckMove.hand];
    if (!router.holding(deckMove.hand) || !ray) deckMove = undefined;
    else if (deckMove.t === undefined) {
      const h = pickPanel(ray, [deck.panel]);
      if (h) { const p = { x: ray.origin.x + ray.direction.x * h.hit.t, y: ray.origin.y + ray.direction.y * h.hit.t, z: ray.origin.z + ray.direction.z * h.hit.t }; deckMove = { hand: deckMove.hand, t: h.hit.t, off: { x: p.x - deck.panel.center.x, y: p.y - deck.panel.center.y, z: p.z - deck.panel.center.z } }; }
      else deckMove = undefined;
    } else {
      const c = { x: ray.origin.x + ray.direction.x * deckMove.t - deckMove.off.x, y: ray.origin.y + ray.direction.y * deckMove.t - deckMove.off.y, z: ray.origin.z + ray.direction.z * deckMove.t - deckMove.off.z };
      deck.panel.center = c;
      deck.panel.yaw = Math.atan2(head.position.x - c.x, head.position.z - c.z);
      deck.sync();
      deckMoved = true;
    }
  }

  // direct touch: the index finger of hands not typing
  const typists = typing(input.worldHands);
  const tips = input.worldHands.filter((h) => !typists.has(h.hand)).flatMap((h) => (h.joints["index-finger-tip"] ? [{ id: `${h.hand}-touch`, pos: h.joints["index-finger-tip"]! }] : []));
  const touchPanels = [...visibleUi().map((u) => Object.assign({}, u.panel, { uiId: u.id })), ...(pol.touch ? macPanels() : [])];
  const touching = new Set<string>();
  const dots: { pos: Vec3; yaw: number; down: boolean }[] = [];
  for (const e of touch.update(tips, touchPanels, head.position)) {
    touching.add(e.id.split("-")[0]!);
    const uiId = e.panel.uiId;
    if (e.type === "hover" || e.type === "down" || e.type === "move") dots.push({ pos: surfacePoint(e.panel, e.x, e.y), yaw: e.panel.yaw, down: e.type !== "hover" });
    if (uiId) {
      const u = uiPanels.find((x) => x.id === uiId);
      if (u && e.type === "down") clickUi(u, e.x, e.y, time);
      continue;
    }
    const cur = { display: e.panel.display, window: e.panel.windowId, x: e.x, y: e.y };
    if (e.type === "down") { note("touch tap", time, e.id.startsWith("left") ? "left" : "right"); touchCursor.set(e.id, cur); activePanel = e.panel; launcherFocused = false; sendCursor("move", cur); conn.send(button(cur, true)); }
    else if (e.type === "move") { touchCursor.set(e.id, cur); sendCursor("move", cur); }
    else if (e.type === "up") { const c = touchCursor.get(e.id); touchCursor.delete(e.id); if (c) conn.send(button(c, false)); }
  }
  touchDots.set(dots);

  // classifier: hands that are typing or touching stay out of the pointer gestures
  pointedHandPos = input.worldHands.flatMap((h) => (h.joints["index-finger-tip"] ? [h.joints["index-finger-tip"]!] : []));
  if (!tracking.lost) for (const ev of snipPinch.update(input.frame.hands.filter((h) => !typists.has(h.hand) && !touching.has(h.hand)))) snipDrag(ev.type === "snip-start" ? "start" : ev.type === "snip-move" ? "move" : "end", rayToWorld(ev.ray, head));
  const snipping = snipPinch.holding();
  const frameIn = { ...input.frame, hands: tracking.lost ? [] : input.frame.hands.filter((h) => !typists.has(h.hand) && !touching.has(h.hand) && !snipping.has(h.hand)) };
  // raw pinch clicks and drags are not used: the system select ray and the modes decide what a click is
  for (const ev of classifier.update(frameIn)) {
    if (ev.type === "grab-start" || ev.type === "grab-move" || ev.type === "grab-end") { if (pol.arrange) handleGesture(ev, head, time); }
    else if (ev.type === "scroll" || ev.type === "magnify" || ev.type === "swipe" || ev.type === "mission-control") { if (pol.shortcuts) handleGesture(ev, head, time); }
  }
  for (const ev of extra.update(frameIn)) {
    if (ev.type === "fist-start") fistsActive.add(ev.hand); else if (ev.type === "fist-end") fistsActive.delete(ev.hand);
    if (ev.type === "spread" || ev.type === "spread-end") { if (pol.arrange) handleExtra(ev, head, time); }
    else if (pol.shortcuts) handleExtra(ev, head, time);
  }

  // the select ray and its events: clicks, drags, menu, arranging
  const selected = selQueue.splice(0);
  const rays = tracking.lost ? {} : input.worldRays;
  let routed = selected;
  if (snipMode || selSnip) {
    // while snipping, the select ray draws the rectangle; UI clicks still go through
    routed = [];
    for (const e of selected) {
      const r = rays[e.hand];
      if (e.type === "selectstart" && snipMode && !snipDraw && r && !pickPanelUi(r)) { snipDrag("start", r); if (snipDraw) selSnip = e.hand; }
      else if (e.type === "selectend" && selSnip === e.hand) { snipDrag("end", r ?? { origin: lastHead.position, direction: { x: 0, y: 0, z: -1 } }); selSnip = undefined; }
      else routed.push(e);
    }
    const sr = selSnip && rays[selSnip];
    if (sr && snipDraw) snipDrag("move", sr);
    if (!snipDraw) selSnip = undefined;
  }
  const hovers = new Map<Hand, Pick | undefined>();
  const actions = router.update(time, rays, routed, pickAll, pol);
  for (const a of actions) { if (a.type === "hover") hovers.set(a.hand, a.pick); handleAction(a, head, input.worldHands, time); }
  if (pol.trackpad) {
    if (!trackpad.busy) { const ap = activePanel ?? macPanels()[0]; trackpad.retarget(ap && { key: keyOf(ap), display: ap.display, window: ap.windowId, width: ap.width, height: ap.height }); }
    const tips: Partial<Record<Hand, Vec3>> = {};
    for (const h of ["left", "right"] as Hand[]) tips[h] = handPoint(input.worldHands, h);
    for (const a of trackpad.update(time, tips, head.yaw, routed)) handleAction(a, head, input.worldHands, time);
  }
  for (const h of ["left", "right"] as Hand[]) {
    const pk = hovers.get(h);
    const ray = rays[h];
    if (pk && !pk.ui && !trackpad.busy) { const v = viewByKey(pk.key); if (v && !router.holding(h)) activePanel = v.panel; }
    if (ray && pk && !pk.ui && (pol.ray || pol.trackpad || pol.arrange)) setRay(h, ray, pk.t);
  }
  if (kbOn() && !tracking.lost) handleKeyboard(input.worldHands, time);

  if (kbOn() && !tracking.lost) handleKeyboard(input.worldHands, time);

  // controllers: B or Y tapped opens the Menu, held 0.8 s is the reset; both fists held 1.5 s is the same reset
  const bp = btn.update(time, input.frame.controllers.some((c) => c.buttonB));
  if (bp === "tap") { toggleMenu(head); note("menu", time); } else if (bp === "hold") { panic(head); note("reset", time); }
  if (!tracking.lost && fistHold.update(time, fistsActive.size >= 2)) { panic(head); note("reset", time); }
  // the Menu button follows the gaze when it has been out of view for a moment
  const toChip = Math.atan2(chip.panel.center.x - head.position.x, -(chip.panel.center.z - head.position.z)) - head.yaw;
  const off = Math.abs(Math.atan2(Math.sin(toChip), Math.cos(toChip)));
  const lw = input.worldHands.find((h) => h.hand === "left")?.joints.wrist;
  if (lw && !tracking.lost) {
    // the orb rides above the left wrist, turned to the head
    const tgt = { x: lw.x, y: lw.y + 0.14, z: lw.z };
    const c = chip.panel.center;
    const k = 0.35;
    chip.panel.center = { x: c.x + (tgt.x - c.x) * k, y: c.y + (tgt.y - c.y) * k, z: c.z + (tgt.z - c.z) * k };
    chip.panel.yaw = Math.atan2(head.position.x - chip.panel.center.x, head.position.z - chip.panel.center.z);
    chip.sync();
    chipAway = undefined;
  } else if (off > 0.75) { chipAway ??= time; if (time - chipAway > 1500) { placeChip(head); chipAway = undefined; } } else chipAway = undefined;
  updateFades();
  const rt = input.worldHands.find((h) => h.hand === "right")?.joints["index-finger-tip"];
  const recentNote = lastNote && time - lastNote.time < 1400 ? lastNote.name : undefined;
  tipLabel.mesh.visible = !!rt && !tracking.lost && !!recentNote;
  if (rt && recentNote) { tipLabel.setText(recentNote); tipLabel.place({ x: rt.x, y: rt.y + 0.07, z: rt.z }, camera); }
  noticeBar.mesh.visible = performance.now() < noticeUntil;
  if (noticeBar.mesh.visible) noticeBar.place({ x: head.position.x + Math.sin(head.yaw) * 0.8, y: head.position.y + 0.22, z: head.position.z - Math.cos(head.yaw) * 0.8 }, camera);

  // feedback: hover outline, the Mac cursor at the aim point, click ripples
  const aimed = (h: Hand): Pick | undefined => { const p = hovers.get(h); return p && !p.ui ? p : undefined; };
  const hoverPick = tracking.lost ? undefined : (aimed("right") ?? aimed("left"));
  hoverFrame.show(hoverPick && (pol.ray || pol.trackpad || pol.arrange) ? viewByKey(hoverPick.key)?.panel : undefined);
  (["left", "right"] as Hand[]).forEach((h, i) => {
    const pk = pol.trackpad ? (h === "right" ? trackpad.pick : undefined) : pol.ray ? hovers.get(h) : undefined;
    const v = pk && !pk.ui && viewByKey(pk.key);
    cursorViews.set(i, v && pk ? { panel: v.panel, ...localUv(v.panel, pk.x, pk.y) } : undefined);
  });
  ripples.update(time);
  const leftWrist = input.worldHands.find((h) => h.hand === "left")?.joints.wrist;
  if (time - lastHud > 90) {
    lastHud = time;
    hud.setLines(hudLines({ mode, last: lastNote, pinch: strongestPinch(input.frame.hands), tracking: trackingText(tracking.lost, input.frame.hands), now: time }));
    logBoard.setLines(["Gestures (newest first)", ...gestureLog.lines(time)]);
  }
  hud.mesh.visible = showLog && !deck.visible;
  logBoard.mesh.visible = showLog;
  const fx = Math.sin(head.yaw), fz = -Math.cos(head.yaw), rx = Math.cos(head.yaw), rz = Math.sin(head.yaw);
  hud.place(leftWrist && !tracking.lost ? { x: leftWrist.x, y: leftWrist.y + 0.12, z: leftWrist.z } : { x: head.position.x + fx * 0.7 - rx * 0.28, y: head.position.y - 0.28, z: head.position.z + fz * 0.7 - rz * 0.28 }, camera);
  logBoard.place({ x: head.position.x + fx * 0.8 + rx * 0.42, y: head.position.y - 0.2, z: head.position.z + fz * 0.8 + rz * 0.42 }, camera);

  // visuals
  const panelsNow = [...macPanels(), ...visibleUi().map((u) => u.panel)];
  handsView.update(input.worldHands, (h, joint) => {
    const p = h.joints[joint as "index-finger-tip"];
    if (!p) return 0;
    let d = Math.min(...panelsNow.map((pn) => distanceToPanel(p, pn)), 1);
    if (kbOn()) { const c = toPlane(p, plane); if (Math.abs(c.u) < keyboardView.width / 2 && Math.abs(c.v) < keyboardView.height / 2) d = Math.min(d, Math.max(0, c.h)); }
    return Math.max(0, 1 - d / 0.05);
  });
  if (handMode === "virtual") {
    const panelList = [...macPanels(), ...visibleUi().map((u) => u.panel)];
    const held = poseHold.update(time, input.worldHands);
    glove.update(held, (h, joint) => {
      const p = h.joints[joint as "index-finger-tip"];
      if (!p) return 0;
      let d = Math.min(...panelList.map((pn) => distanceToPanel(p, pn)), 1);
      if (kbOn()) { const c = toPlane(p, plane); if (Math.abs(c.u) < keyboardView.width / 2 && Math.abs(c.v) < keyboardView.height / 2) d = Math.min(d, Math.max(0, c.h)); }
      return Math.max(0, 1 - d / 0.05);
    });
    const pts = held.flatMap(({ frame, alpha }) => [["middle-finger-metacarpal", 0.05], ["thumb-tip", 0.014], ["index-finger-tip", 0.014], ["middle-finger-tip", 0.014], ["ring-finger-tip", 0.014], ["pinky-finger-tip", 0.014]].flatMap(([n, size]) => { const p = frame.joints[n as "wrist"]; return p ? [{ pos: p, size: size as number, weight: alpha }] : []; }));
    shadows.set(hoverShadows(pts, panelList).map((sh) => { const pt = panelPoint(panelList[sh.panel]!, sh.u, sh.v, 0.003); return { pos: pt.pos, yaw: pt.yaw, alpha: sh.alpha, radius: sh.radius }; }));
  }
  const shown: Handle[] = [];
  if (pol.arrange) for (const v of allViews()) if (handlePanelVisible(v.panel)) shown.push(...(v instanceof SnipView ? snipHandles(v.panel, v.pinned) : handlesOf(v.panel)));
  handleDots.set(shown);
  for (const l of rayLines.values()) if (l.visible && performance.now() - ((l.userData as { seen?: number }).seen ?? 0) > 200) l.visible = false;

  // hints and status, a few times a second
  const hint = hints.update(input.frame);
  hintBar.mesh.visible = !!hint && !tracking.lost && !deck.visible && !guide.visible && !sheet.visible;
  if (hint) { hintBar.setText(hint.text); const w = toWorld(hint.at, head); hintBar.place({ x: w.x, y: w.y + 0.18, z: w.z }, camera); }
  if (time - lastUi > 250) {
    lastUi = time;
    const first = sourceViews()[0]?.panel;
    persistSnips();
    // only a problem shows here; mode and link live in the Menu button
    const text = [permissionProblems(permissions)[0], linkText.startsWith("Connected") ? "" : linkText, mac.notice].filter(Boolean).join(" | ");
    statusBar.setText(text);
    statusBar.mesh.visible = text !== "" && !deck.visible;
    if (first) statusBar.place({ x: first.center.x, y: first.center.y + first.height / 2 + 0.1, z: first.center.z }, camera);
  }
}

const btn = new ButtonTapHold();
const fistHold = new HoldOnce(PANIC_HOLD_MS);
const fistsActive = new Set<Hand>();
let chipAway: number | undefined;
const button = (c: { display: number; window?: number; x: number; y: number }, down: boolean): ClientMessage =>
  c.window === undefined ? { type: "button", display: c.display, button: "left", down, x: c.x, y: c.y } : { type: "button", window: c.window, button: "left", down, x: c.x, y: c.y };
function sendCursor(_: "move", c: { display: number; window?: number; x: number; y: number }): void {
  conn.send(c.window === undefined ? { type: "move", display: c.display, x: c.x, y: c.y } : { type: "move", window: c.window, x: c.x, y: c.y });
}
function surfacePoint(p: Panel, x: number, y: number): Vec3 {
  const u = p.crop ? fromSource(p.crop, x, y) : { x, y };
  return panelPoint(p, u.x, u.y, 0.004).pos;
}

// ---- entering a session ----
async function begin(s: XRSession, mode: XRMode): Promise<void> {
  placed = false;
  xrMode = mode;
  classifier.reset();
  extra.reset();
  detector.reset();
  router.reset();
  trackpad.reset();
  selQueue.length = 0;
  if (mode === "immersive-vr" && !isVr(env)) { env = "grid"; envs.set(env); }
  s.addEventListener("end", () => { renderer.setAnimationLoop(null); setStatus("Session ended"); $("ui").style.display = "flex"; log("info", "xr session ended"); });
  for (const type of ["selectstart", "selectend", "squeezestart", "squeezeend"] as const) {
    s.addEventListener(type, (e) => selQueue.push({ type, hand: (e as XRInputSourceEvent).inputSource.handedness === "left" ? "left" : "right" }));
  }
  await renderer.xr.setSession(s);
  applyHandMode();
  renderer.setAnimationLoop(onFrame);
  $("ui").style.display = "none";
  log("info", `xr session started: ${mode}`);
}

async function enter(mode: XRMode): Promise<void> {
  try {
    audio ??= new AudioContext();
    await begin(await startSession(mode, handSaved === "real"), mode);
  } catch (e) {
    const text = startErrorText(mode, e);
    setStatus(text);
    log("warn", text);
  }
}
$("enter-ar").addEventListener("click", () => void enter("immersive-ar"));
$("enter-vr").addEventListener("click", () => void enter("immersive-vr"));
$("ui").addEventListener("click", (e) => { if (e.target === $("ui")) void enter("immersive-ar"); });
addEventListener("resize", () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

(window as unknown as { __handdesk?: boolean }).__handdesk = true;
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
      void offer.call(xr, "immersive-ar", sessionInit("immersive-ar", handSaved === "real")).then((s) => begin(s, "immersive-ar")).catch((e) => { const text = startErrorText("immersive-ar", e); setStatus(text); log("warn", text); });
      setStatus("Press Enter AR, or the browser's Enter button.");
    } else if (ar) setStatus("Press Enter AR (or click anywhere on this page).");
  }
  conn.connect();
})();

