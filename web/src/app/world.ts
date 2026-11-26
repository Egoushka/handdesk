import * as THREE from "three";
import type { Panel } from "../panel";
import type { TypingPlane } from "../keyboard/plane";
import type { Key, Lang, Modifier } from "../keyboard/layouts";
import { PITCH } from "../keyboard/layouts";

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

  constructor(public panel: Panel, pixelW: number, pixelH: number, label: string) {
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
    this.mesh.position.set(p.center.x, p.center.y, p.center.z);
    this.mesh.rotation.set(0, p.yaw, 0);
  }
}

export interface ToolbarButton { id: string; label: string; active?: boolean }

/** A small floating toolbar, picked with the same ray math as a panel. */
export class ToolbarView {
  readonly canvas = document.createElement("canvas");
  readonly mesh: THREE.Mesh;
  readonly panel: Panel;
  private readonly texture: THREE.CanvasTexture;
  buttons: ToolbarButton[] = [];
  status = "";

  constructor(center: { x: number; y: number; z: number }, yaw: number) {
    this.canvas.width = 1024;
    this.canvas.height = 160;
    this.panel = { display: -1, center, yaw, width: 0.8, height: 0.125, curve: 0 };
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.panel.width, this.panel.height), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true }));
    this.sync();
  }

  sync(): void {
    const p = this.panel;
    this.mesh.position.set(p.center.x, p.center.y, p.center.z);
    this.mesh.rotation.set(0, p.yaw, 0);
  }

  /** button under normalized x */
  buttonAt(x: number): ToolbarButton | undefined {
    const i = Math.floor(x * this.buttons.length);
    return this.buttons[i];
  }

  render(): void {
    const c = this.canvas.getContext("2d")!;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const n = this.buttons.length;
    const bw = this.canvas.width / n;
    this.buttons.forEach((b, i) => {
      c.fillStyle = b.active ? "#3b82f6" : "#2a303b";
      c.beginPath();
      c.roundRect(i * bw + 6, 6, bw - 12, 100, 18);
      c.fill();
      c.fillStyle = "#fff";
      c.font = "34px system-ui";
      c.textAlign = "center";
      c.fillText(b.label, i * bw + bw / 2, 68);
    });
    c.fillStyle = "#cbd5e1";
    c.font = "28px system-ui";
    c.fillText(this.status, this.canvas.width / 2, 146);
    this.texture.needsUpdate = true;
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

export function makeEnvironment(): THREE.Object3D {
  const g = new THREE.Group();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(30, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {},
      vertexShader: "varying vec3 vp; void main(){ vp = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} ",
      fragmentShader: "varying vec3 vp; void main(){ float t = clamp(normalize(vp).y*0.5+0.5, 0.0, 1.0); gl_FragColor = vec4(mix(vec3(0.04,0.05,0.08), vec3(0.14,0.18,0.28), t), 1.0);} ",
    }),
  );
  sky.renderOrder = -10;
  g.add(sky);
  const grid = new THREE.GridHelper(40, 80, 0x3b4658, 0x222a38);
  g.add(grid);
  g.visible = false;
  return g;
}

export function makeTipDots(count: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshBasicMaterial({ color: 0x93c5fd }), count);
  m.count = 0;
  m.frustumCulled = false;
  return m;
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
