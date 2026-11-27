import * as THREE from "three";
import type { Panel } from "../panel";
import type { HandFrame, Vec3 } from "../gesture/types";
import { BONES, pinchStrength } from "../hands/rig";
import type { Row } from "../mac/state";
import type { EnvId } from "../space/layout";
import type { Handle } from "../space/handles";
import type { TypingPlane } from "../keyboard/plane";
import type { Key, Lang, Modifier } from "../keyboard/layouts";
import { PITCH } from "../keyboard/layouts";
import { Glass } from "../space/glass";
import { headRef, tiltToward } from "../space/tilt";

function panelGeometry(p: Panel): THREE.BufferGeometry {
  const n = p.curve < 1e-3 ? 1 : 48;
  const R = p.curve < 1e-3 ? 0 : p.width / p.curve;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = R ? R * Math.sin((t - 0.5) * p.curve) : (t - 0.5) * p.width;
    const z = R ? R * (1 - Math.cos((t - 0.5) * p.curve)) : 0;
    pos.push(x, -p.height / 2, z, x, p.height / 2, z);
    uv.push(t, 0, t, 1);
    if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 3, a, a + 3, a + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export class PanelView {
  readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  readonly mesh: THREE.Mesh;
  private curve = -1;
  private w = 0;
  private h = 0;
  hasVideo = false;
  readonly glass: Glass;

  constructor(public panel: Panel, pixelW: number, pixelH: number, label: string, slabDepth = 0.022) {
    this.canvas.width = Math.min(pixelW, 2560);
    this.canvas.height = Math.round(this.canvas.width * (pixelH / pixelW));
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.fillStyle = "#1b1f27";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = "#8b93a1";
    this.ctx.font = `${Math.round(this.canvas.height / 18)}px system-ui`;
    this.ctx.textAlign = "center";
    this.ctx.fillText(label, this.canvas.width / 2, this.canvas.height / 2);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(panelGeometry(panel), new THREE.MeshBasicMaterial({ map: this.texture, side: THREE.DoubleSide }));
    this.mesh.rotation.order = "YXZ";
    this.glass = new Glass(slabDepth);
    this.mesh.add(this.glass.group);
    this.sync();
  }

  draw(frame: VideoFrame): void {
    this.ctx.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
    this.hasVideo = true;
  }

  sync(): void {
    const p = this.panel;
    if (p.curve !== this.curve || p.width !== this.w || p.height !== this.h) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = panelGeometry(p);
      this.curve = p.curve; this.w = p.width; this.h = p.height;
    }
    this.glass.fit(p);
    this.mesh.position.set(p.center.x, p.center.y, p.center.z);
    this.mesh.rotation.set(tiltToward(p.center, headRef), p.yaw, 0);
  }
}

const PX_PER_M = 3200;
const STRIP_H = 1.6 * PITCH;

export interface KeyboardDrawState {
  keys: Key[];
  lang: Lang;
  mod: (m: Modifier) => "off" | "armed" | "locked";
  pressed: Map<string, number>;
  suggestions: string[];
  poke: boolean;
  now: number;
}

/** The keyboard and its suggestion strip, drawn on one canvas lying in the typing plane. */
export class KeyboardView {
  readonly canvas = document.createElement("canvas");
  readonly mesh: THREE.Mesh;
  private readonly texture: THREE.CanvasTexture;
  readonly width: number;
  readonly height: number;
  /** strip centre v (metres), above the top row */
  readonly stripV: number;
  private signature = "";

  constructor(keys: Key[]) {
    const maxU = Math.max(...keys.map((k) => Math.abs(k.u) + k.w / 2));
    const maxV = Math.max(...keys.map((k) => Math.abs(k.v) + k.h / 2));
    this.width = maxU * 2 + 0.02;
    this.height = maxV * 2 + STRIP_H + 0.03;
    this.stripV = maxV + STRIP_H / 2 + 0.008;
    this.canvas.width = Math.round(this.width * PX_PER_M);
    this.canvas.height = Math.round(this.height * PX_PER_M);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0.92, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.width, this.height), mat);
    // plane centre sits half the strip above the key block's centre
    this.mesh.renderOrder = 2;
  }

  place(plane: TypingPlane): void {
    const basis = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(plane.uAxis.x, plane.uAxis.y, plane.uAxis.z),
      new THREE.Vector3(plane.vAxis.x, plane.vAxis.y, plane.vAxis.z),
      new THREE.Vector3(plane.normal.x, plane.normal.y, plane.normal.z),
    );
    this.mesh.quaternion.setFromRotationMatrix(basis);
    const dv = this.canvasCentreV();
    this.mesh.position.set(
      plane.origin.x + plane.vAxis.x * dv + plane.normal.x * 0.0015,
      plane.origin.y + plane.vAxis.y * dv + plane.normal.y * 0.0015,
      plane.origin.z + plane.vAxis.z * dv + plane.normal.z * 0.0015,
    );
  }

  private canvasCentreV(): number {
    // canvas spans v from (stripV + STRIP_H/2 + 0.015) at the top down to the bottom edge of the key block
    const top = this.stripV + STRIP_H / 2 + 0.015;
    return top - this.height / 2;
  }

  private pyOf(v: number): number { return (this.canvasCentreV() + this.height / 2 - v) * PX_PER_M; }
  private pxOf(u: number): number { return (u + this.width / 2) * PX_PER_M; }

  stripRect(): { u0: number; u1: number; v0: number; v1: number } {
    return { u0: -this.width / 2, u1: this.width / 2, v0: this.stripV - STRIP_H / 2, v1: this.stripV + STRIP_H / 2 };
  }

  draw(s: KeyboardDrawState): void {
    const sig = JSON.stringify([s.lang, [...s.pressed.keys()], s.suggestions, s.poke, (["cmd", "ctrl", "alt", "shift"] as Modifier[]).map(s.mod)]);
    if (sig === this.signature) return;
    this.signature = sig;
    const c = this.canvas.getContext("2d")!;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.fillStyle = s.poke ? "rgba(30,41,59,0.55)" : "rgba(15,23,42,0.75)";
    c.beginPath();
    c.roundRect(0, 0, this.canvas.width, this.canvas.height, 24);
    c.fill();
    // suggestion strip
    const sr = this.stripRect();
    const sx = this.pxOf(sr.u0) + 10;
    const sw = this.pxOf(sr.u1) - sx - 10;
    const sy = this.pyOf(sr.v1);
    const sh = this.pyOf(sr.v0) - sy;
    for (let i = 0; i < 3; i++) {
      c.fillStyle = s.suggestions[i] ? "#334155" : "#1e293b";
      c.beginPath();
      c.roundRect(sx + (sw / 3) * i + 4, sy, sw / 3 - 8, sh, 14);
      c.fill();
      c.fillStyle = "#f1f5f9";
      c.font = `${Math.round(sh * 0.5)}px system-ui`;
      c.textAlign = "center";
      c.fillText(s.suggestions[i] ?? "", sx + (sw / 3) * (i + 0.5), sy + sh * 0.66);
    }
    for (const k of s.keys) {
      const x = this.pxOf(k.u - k.w / 2);
      const y = this.pyOf(k.v + k.h / 2);
      const w = k.w * PX_PER_M;
      const h = k.h * PX_PER_M;
      const hot = s.pressed.has(k.code);
      const m = k.mod ? s.mod(k.mod) : "off";
      c.fillStyle = hot ? "#60a5fa" : m === "locked" ? "#f59e0b" : m === "armed" ? "#3b82f6" : k.kind === "char" || k.kind === "digit" ? "#475569" : "#334155";
      c.beginPath();
      c.roundRect(x, y, w, h, 8);
      c.fill();
      c.fillStyle = "#fff";
      c.font = `${Math.round(h * 0.5)}px system-ui`;
      c.textAlign = "center";
      c.fillText(k.label, x + w / 2, y + h * 0.66);
    }
    this.texture.needsUpdate = true;
  }
}

export function clickSound(ctx: AudioContext): void {
  const len = Math.floor(ctx.sampleRate * 0.025);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len / 6));
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const g = ctx.createGain();
  g.gain.value = 0.35;
  src.connect(g).connect(ctx.destination);
  src.start();
}

// ---- environments ----
export interface Environments { group: THREE.Group; set(e: EnvId): void }

export function makeEnvironments(): Environments {
  const group = new THREE.Group();
  const veil = new THREE.Mesh(new THREE.SphereGeometry(20, 24, 12), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, side: THREE.BackSide, depthWrite: false }));
  veil.renderOrder = -10;
  const sky = (top: number, bottom: number) =>
    new THREE.Mesh(
      new THREE.SphereGeometry(30, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
        vertexShader: "varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} ",
        fragmentShader: "uniform vec3 top; uniform vec3 bottom; varying vec3 vp; void main(){ float t = clamp(normalize(vp).y*0.5+0.5, 0.0, 1.0); gl_FragColor = vec4(mix(bottom, top, t), 1.0);} ",
      }),
    );
  const night = new THREE.Group();
  const nightSky = sky(0x02030a, 0x0b1020);
  nightSky.renderOrder = -10;
  const pts: number[] = [];
  for (let i = 0; i < 900; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    pts.push(Math.cos(th) * r * 25, Math.abs(u) * 25 * 0.9 + 0.5, Math.sin(th) * r * 25);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  night.add(nightSky, new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, sizeAttenuation: true, depthWrite: false })));
  const grid = new THREE.Group();
  const gridSky = sky(0x14182a, 0x0a0c14);
  gridSky.renderOrder = -10;
  grid.add(gridSky, new THREE.GridHelper(40, 80, 0x3b4658, 0x222a38));
  group.add(veil, night, grid);
  const set = (e: EnvId) => {
    veil.visible = e === "dim";
    night.visible = e === "night";
    grid.visible = e === "grid";
  };
  set("passthrough");
  return { group, set };
}

// ---- hands ----
const JOINT_ORDER = [
  "wrist",
  "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip",
  "index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip",
  "middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip",
  "ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip",
  "pinky-finger-metacarpal", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip",
] as const;
const BASE = new THREE.Color(0x8ab4f8);
const GLOW = new THREE.Color(0xffffff);
const CLOSED = new THREE.Color(0x4ade80);

/** Both hands from all 25 joints: spheres, capsule-like bones, tip glow, pinch ring. They write depth, so panels and hands hide each other. */
export class HandsView {
  readonly group = new THREE.Group();
  private readonly joints = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial(), 50);
  private readonly bones = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1), new THREE.MeshBasicMaterial({ color: 0x5b7fc7 }), 2 * BONES.length);
  private readonly rings = [0, 1].map(() => new THREE.Mesh(new THREE.TorusGeometry(1, 0.08, 8, 24), new THREE.MeshBasicMaterial({ color: 0x4ade80 })));

  constructor() {
    for (const m of [this.joints, this.bones]) { m.frustumCulled = false; m.count = 0; this.group.add(m); }
    for (const r of this.rings) { r.visible = false; this.group.add(r); }
  }

  /** glow(handIndex, jointName) is 0..1 */
  update(hands: HandFrame[], glow: (h: HandFrame, joint: string) => number): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let nj = 0;
    let nb = 0;
    const col = new THREE.Color();
    hands.slice(0, 2).forEach((h, hi) => {
      for (const name of JOINT_ORDER) {
        const p = h.joints[name];
        if (!p) continue;
        const tip = name.endsWith("tip");
        const r = tip ? 0.0075 : 0.0095;
        m.compose(new THREE.Vector3(p.x, p.y, p.z), q.identity(), new THREE.Vector3(r, r, r));
        this.joints.setMatrixAt(nj, m);
        const g = tip ? glow(h, name) : 0;
        this.joints.setColorAt(nj, col.copy(BASE).lerp(GLOW, g));
        nj++;
      }
      for (const [a, b] of BONES) {
        const pa = h.joints[a];
        const pb = h.joints[b];
        if (!pa || !pb) continue;
        const va = new THREE.Vector3(pa.x, pa.y, pa.z);
        const vb = new THREE.Vector3(pb.x, pb.y, pb.z);
        const dir = vb.clone().sub(va);
        const len = dir.length();
        if (len < 1e-4) continue;
        q.setFromUnitVectors(up, dir.normalize());
        m.compose(va.add(vb).multiplyScalar(0.5), q, new THREE.Vector3(0.0055, len, 0.0055));
        this.bones.setMatrixAt(nb++, m);
      }
      const ring = this.rings[hi]!;
      const t = h.joints["thumb-tip"];
      const i = h.joints["index-finger-tip"];
      const strength = pinchStrength(h);
      if (t && i && strength > 0.05) {
        ring.visible = true;
        ring.position.set((t.x + i.x) / 2, (t.y + i.y) / 2, (t.z + i.z) / 2);
        const s = 0.025 - 0.018 * strength;
        ring.scale.set(s, s, s);
        (ring.material as THREE.MeshBasicMaterial).color.copy(strength >= 1 ? CLOSED : BASE);
        ring.lookAt(ring.position.x, ring.position.y + 1, ring.position.z);
      } else ring.visible = false;
    });
    this.joints.count = nj;
    this.bones.count = nb;
    this.joints.instanceMatrix.needsUpdate = true;
    if (this.joints.instanceColor) this.joints.instanceColor.needsUpdate = true;
    this.bones.instanceMatrix.needsUpdate = true;
  }
}

// ---- text and list panels ----
export class Billboard {
  readonly canvas = document.createElement("canvas");
  readonly mesh: THREE.Mesh;
  private readonly texture: THREE.CanvasTexture;
  private text = "\u0000";
  constructor(width: number, height: number, private readonly size = 40, private readonly bg = "rgba(15,23,42,0.85)") {
    this.canvas.width = 1024;
    this.canvas.height = Math.round(1024 * (height / width));
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }));
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
  }
  setText(t: string): void {
    if (t === this.text) return;
    this.text = t;
    const c = this.canvas.getContext("2d")!;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.fillStyle = this.bg;
    c.beginPath();
    c.roundRect(0, 0, this.canvas.width, this.canvas.height, 36);
    c.fill();
    c.fillStyle = "#f8fafc";
    c.font = `${this.size}px system-ui`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(t, this.canvas.width / 2, this.canvas.height / 2, this.canvas.width - 40);
    this.texture.needsUpdate = true;
  }
  place(p: Vec3, camera: THREE.Camera): void {
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.quaternion.copy(camera.quaternion);
  }
}

/** A vertical list: rows are drawn top to bottom in equal slots; headers are not clickable. */
export class UiPanel {
  readonly canvas = document.createElement("canvas");
  readonly mesh: THREE.Mesh;
  readonly panel: Panel;
  rows: Row[] = [];
  private readonly texture: THREE.CanvasTexture;
  private sig = "";
  visible = false;
  constructor(readonly id: string, width: number, height: number, private readonly rowCount: number) {
    this.canvas.width = 1024;
    this.canvas.height = Math.round(1024 * (height / width));
    this.panel = { display: -1, center: { x: 0, y: 1.2, z: -1 }, yaw: 0, width, height, curve: 0 };
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }));
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
  }
  show(on: boolean): void { this.visible = on; this.mesh.visible = on; }
  sync(): void {
    this.mesh.position.set(this.panel.center.x, this.panel.center.y, this.panel.center.z);
    this.mesh.rotation.set(0, this.panel.yaw, 0);
  }
  /** rows are laid out in `rowCount` equal slots (the list may be shorter) */
  slots(): number { return this.rowCount; }
  setRows(rows: Row[], hover = -1): void {
    this.rows = rows;
    const sig = JSON.stringify([rows.map((r) => [r.text, r.sub, r.header]), hover]);
    if (sig === this.sig) return;
    this.sig = sig;
    const c = this.canvas.getContext("2d")!;
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    c.fillStyle = "rgba(15,23,42,0.92)";
    c.beginPath();
    c.roundRect(0, 0, W, H, 40);
    c.fill();
    const rh = H / this.rowCount;
    rows.forEach((r, i) => {
      const y = i * rh;
      if (!r.header && r.action) {
        c.fillStyle = i === hover ? "#3b82f6" : "#1e293b";
        c.beginPath();
        c.roundRect(16, y + 4, W - 32, rh - 8, 14);
        c.fill();
      }
      c.fillStyle = r.header ? "#94a3b8" : "#f8fafc";
      c.font = `${Math.round(rh * (r.header ? 0.5 : 0.56))}px system-ui`;
      c.textAlign = "left";
      c.textBaseline = "middle";
      c.fillText(r.text, 40, y + rh / 2, W - 360);
      if (r.sub) {
        c.fillStyle = "#94a3b8";
        c.textAlign = "right";
        c.fillText(r.sub, W - 40, y + rh / 2, 300);
      }
    });
    this.texture.needsUpdate = true;
  }
}

// ---- handles and touch dots ----
export class HandleDots {
  readonly mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.025, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }), 64);
  constructor() { this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 6; }
  set(handles: Handle[]): void {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    handles.slice(0, 64).forEach((h, i) => { m.setPosition(h.pos.x, h.pos.y, h.pos.z); this.mesh.setMatrixAt(i, m); this.mesh.setColorAt(i, c.set(h.kind === "pin" ? 0x4ade80 : h.kind === "close" ? 0xf87171 : 0xfbbf24)); });
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.count = Math.min(64, handles.length);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class TouchDots {
  readonly mesh = new THREE.InstancedMesh(new THREE.CircleGeometry(0.012, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }), 10);
  constructor() { this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 6; }
  set(dots: { pos: Vec3; yaw: number; down: boolean }[]): void {
    const m = new THREE.Matrix4();
    dots.slice(0, 10).forEach((d, i) => {
      m.makeRotationY(d.yaw);
      m.setPosition(d.pos.x, d.pos.y, d.pos.z);
      m.scale(new THREE.Vector3(d.down ? 0.6 : 1, d.down ? 0.6 : 1, 1));
      this.mesh.setMatrixAt(i, m);
    });
    this.mesh.count = Math.min(10, dots.length);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
