import * as THREE from "three";
import { GestureClassifier } from "../gesture/classifier";
import type { GestureEvent, HandFrame, Ray } from "../gesture/types";
import { calibrateFromFlatHands, planeFromYaw, toPlane, type TypingPlane } from "../keyboard/plane";
import { POKE, PressDetector, SURFACE, type FingerTip } from "../keyboard/press";
import { TypingSession } from "../keyboard/session";
import { applyGrab, pick, type Panel } from "../panel";
import { gestureToMessages, keyActionToMessages } from "../protocol";
import { Connection } from "./connection";
import { dirToWorld, rayToWorld, readInput, startSession, type HeadFrame, type XRMode } from "./xr";
import { KeyboardView, PanelView, ToolbarView, clickSound, makeEnvironment, makeTipDots } from "./world";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const statusEl = $("status");
const linkEl = $("link");
const setStatus = (s: string) => { statusEl.textContent = s; toolbar.status = s; };
const setLink = (s: string) => { linkEl.textContent = s; toolbar.status = s; };

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor");
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.02, 100);
const env = makeEnvironment();
scene.add(env);
const tipDots = makeTipDots(20);
scene.add(tipDots);

const toolbar = new ToolbarView({ x: 0, y: 0.9, z: -1.2 }, 0);
scene.add(toolbar.mesh);

const views: PanelView[] = [];

// ---- typing state ----
const session = new TypingSession();
const detector = new PressDetector(POKE);
let pokeMode = true;
let keyboardOn = true;
let plane: TypingPlane = planeFromYaw({ x: 0, y: 0.95, z: -0.5 }, 0);
let keyboardView = new KeyboardView(session.keys);
scene.add(keyboardView.mesh);
const pressed = new Map<string, number>();
let audio: AudioContext | undefined;
let calibrating: { until: number; planes: TypingPlane[] } | undefined;
let placed = false;
let lastHead: HeadFrame = { position: { x: 0, y: 1.6, z: 0 }, yaw: 0 };

const conn = new Connection({
  onStatus: setLink,
  onHello(list) {
    for (const v of views) scene.remove(v.mesh);
    views.length = 0;
    list.forEach((d, i) => {
      const width = 2.4;
      const height = width * (d.height / d.width);
      const panel: Panel = { display: i, center: { x: i * (width + 0.1), y: 1.45, z: -1.8 }, yaw: 0, width, height, curve: 0.5 };
      const v = new PanelView(panel, d.pixelWidth, d.pixelHeight, d.name || `Display ${i + 1}`);
      views.push(v);
      scene.add(v.mesh);
    });
    conn.subscribe(list.map((_, i) => i));
    if (placed) placePanels(lastHead);
  },
  onFrame(i, f) { views[i]?.draw(f); },
});

function placePanels(head: HeadFrame): void {
  const fx = Math.sin(head.yaw);
  const fz = -Math.cos(head.yaw);
  const rx = Math.cos(head.yaw);
  const rz = Math.sin(head.yaw);
  const n = views.length;
  views.forEach((v, i) => {
    const off = (i - (n - 1) / 2) * (v.panel.width + 0.1);
    v.panel = { ...v.panel, center: { x: head.position.x + fx * 1.8 + rx * off, y: head.position.y - 0.15, z: head.position.z + fz * 1.8 + rz * off }, yaw: -head.yaw };
    v.sync();
  });
  toolbar.panel.center = { x: head.position.x + fx * 1.1, y: head.position.y - 0.75, z: head.position.z + fz * 1.1 };
  toolbar.panel.yaw = -head.yaw;
  toolbar.sync();
  if (pokeMode) {
    plane = planeFromYaw({ x: head.position.x + fx * 0.5, y: head.position.y - 0.45, z: head.position.z + fz * 0.5 }, -head.yaw);
  }
}

// ---- toolbar ----
function refreshToolbar(): void {
  toolbar.buttons = [
    { id: "env", label: "Environment", active: env.visible },
    { id: "kb", label: "Keyboard", active: keyboardOn },
    { id: "cal", label: calibrating ? "Hands flat..." : pokeMode ? "Find desk" : "Desk set", active: !pokeMode },
    { id: "curve", label: "Curve" },
    { id: "lang", label: session.lang === "en" ? "EN" : "УК", active: true },
  ];
  toolbar.render();
}
function toolbarAction(id: string, time: number): void {
  if (id === "env") env.visible = !env.visible;
  else if (id === "kb") { keyboardOn = !keyboardOn; keyboardView.mesh.visible = keyboardOn; }
  else if (id === "cal") calibrating = { until: time + 2500, planes: [] };
  else if (id === "curve") for (const v of views) { v.panel = { ...v.panel, curve: v.panel.curve > 0.9 ? 0 : v.panel.curve + 0.25 }; v.sync(); }
  else if (id === "lang") { session.lang = session.lang === "en" ? "uk" : "en"; session.prefix = ""; }
  refreshToolbar();
}

// ---- per frame ----
const classifier = new GestureClassifier();
let activePanel = 0;
let grabStart: Panel | undefined;
const TIPS = [["thumb", "thumb-tip"], ["index", "index-finger-tip"], ["middle", "middle-finger-tip"], ["ring", "ring-finger-tip"], ["pinky", "pinky-finger-tip"]] as const;

function tipsOf(hands: HandFrame[]): FingerTip[] {
  const out: FingerTip[] = [];
  for (const h of hands) {
    for (const [finger, joint] of TIPS) {
      const p = h.joints[joint];
      if (p) out.push({ id: `${h.hand}-${finger}`, hand: h.hand, finger, ...toPlane(p, plane) });
    }
  }
  return out;
}

const worldPanels = (): Panel[] => [...views.map((v) => v.panel)];
const hitFn = (head: HeadFrame) => (ray: Ray) => {
  const h = pick(rayToWorld(ray, head), worldPanels());
  return h ? { display: h.display, x: h.x, y: h.y } : undefined;
};

function handleGesture(ev: GestureEvent, head: HeadFrame, time: number): void {
  if (ev.type === "grab-start") { grabStart = views[activePanel]?.panel; return; }
  if (ev.type === "grab-move") {
    const v = views[activePanel];
    if (v && grabStart) { v.panel = applyGrab(grabStart, dirToWorld(ev.center, head), ev.scale, ev.yaw); v.sync(); }
    return;
  }
  if (ev.type === "grab-end") { grabStart = undefined; return; }
  if ("ray" in ev) {
    const ray = rayToWorld(ev.ray, head);
    const tb = pick(ray, [toolbar.panel]);
    if (tb && ev.type === "click" && ev.button === "left") {
      const b = toolbar.buttonAt(tb.x);
      if (b) toolbarAction(b.id, time);
      return;
    }
    if (tb) return;
    const h = pick(ray, worldPanels());
    if (h && (ev.type === "point" || ev.type === "click" || ev.type === "drag-start")) activePanel = h.display;
  }
  for (const m of gestureToMessages(ev, hitFn(head))) conn.send(m);
}

function typing(hands: HandFrame[]): Set<string> {
  // hands low over the keyboard are typing: keep them out of the pointer classifier
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

function handleKeyboard(world: HandFrame[], time: number): void {
  const tips = tipsOf(world);
  const rect = keyboardView.stripRect();
  for (const e of detector.update(time, tips)) {
    if (e.type !== "press") continue;
    if (e.v >= rect.v0 && e.v <= rect.v1 && Math.abs(e.u) <= keyboardView.width / 2) {
      const i = Math.min(2, Math.max(0, Math.floor(((e.u + keyboardView.width / 2) / keyboardView.width) * 3)));
      for (const a of session.accept(i)) for (const m of keyActionToMessages(a)) conn.send(m);
      continue;
    }
    const r = session.pressAt(e.u, e.v, time, e.finger === "thumb");
    if (!r.key) continue;
    for (const a of r.actions) for (const m of keyActionToMessages(a)) conn.send(m);
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
      const yaw = Math.atan2(avg((p) => p.uAxis.z) * -1, avg((p) => p.uAxis.x));
      plane = planeFromYaw({ x: avg((p) => p.origin.x), y: avg((p) => p.origin.y), z: avg((p) => p.origin.z) }, yaw);
      pokeMode = false;
      detector.cfg = SURFACE;
      setStatus("Desk found: type on it");
    } else setStatus("No flat hands seen: poke mode stays on");
    refreshToolbar();
  }
}

function onFrame(time: number, xrFrame?: XRFrame): void {
  if (xrFrame) {
    const ref = renderer.xr.getReferenceSpace();
    const input = ref && readInput(xrFrame, ref as XRReferenceSpace, time);
    if (input) {
      lastHead = input.head;
      if (!placed && views.length > 0) { placePanels(input.head); placed = true; }
      calibrate(input.worldHands, time);
      const typists = typing(input.worldHands);
      const frame = { ...input.frame, hands: input.frame.hands.filter((h) => !typists.has(h.hand)) };
      for (const ev of classifier.update(frame)) handleGesture(ev, input.head, time);
      if (keyboardOn) handleKeyboard(input.worldHands, time);

      let n = 0;
      const m = new THREE.Matrix4();
      for (const h of input.worldHands) {
        for (const [, joint] of TIPS) {
          const p = h.joints[joint];
          if (!p) continue;
          m.setPosition(p.x, p.y, p.z);
          tipDots.setMatrixAt(n++, m);
        }
      }
      tipDots.count = n;
      tipDots.instanceMatrix.needsUpdate = true;
    }
  }
  if (keyboardOn) {
    keyboardView.place(plane);
    keyboardView.draw({ keys: session.keys, lang: session.lang, mod: (x) => session.modifierState(x), pressed, suggestions: session.suggestions(), poke: pokeMode, now: time });
  }
  renderer.render(scene, camera);
}
// ---- entering a session ----
async function enter(mode: XRMode): Promise<void> {
  try {
    audio ??= new AudioContext();
    const s = await startSession(mode);
    placed = false;
    classifier.reset();
    detector.reset();
    s.addEventListener("end", () => { renderer.setAnimationLoop(null); setStatus("Session ended"); $("ui").style.display = "flex"; });
    await renderer.xr.setSession(s);
    renderer.setAnimationLoop(onFrame);
    env.visible = mode === "immersive-vr";
    $("ui").style.display = "none";
    refreshToolbar();
  } catch (e) {
    setStatus(`Could not start ${mode}: ${(e as Error).message}`);
  }
}
$("enter-ar").addEventListener("click", () => void enter("immersive-ar"));
$("enter-vr").addEventListener("click", () => void enter("immersive-vr"));
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
  }
  refreshToolbar();
  conn.connect();
})();

