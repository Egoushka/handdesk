import * as THREE from "three";
import type { Vec3 } from "../gesture/types";
import type { Panel } from "../panel";
import { rippleAt, type Ripple } from "../feedback/feedback";
import { panelOutline, surfaceAt } from "../space/surface";

/** A small multi-line text card that faces the camera. */
export class TextBoard {
  readonly mesh: THREE.Mesh;
  private readonly canvas = document.createElement("canvas");
  private readonly texture: THREE.CanvasTexture;
  private text = "\u0000";
  constructor(width: number, private readonly rows: number, private readonly px = 44) {
    const height = (width * rows * px * 1.35) / 900;
    this.canvas.width = 900;
    this.canvas.height = Math.round(rows * px * 1.35 + 24);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, depthTest: false }));
    this.mesh.renderOrder = 40;
    this.mesh.visible = false;
  }
  setLines(lines: string[]): void {
    const t = lines.join("\n");
    if (t === this.text) return;
    this.text = t;
    const c = this.canvas.getContext("2d")!;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.fillStyle = "rgba(15,23,42,0.88)";
    c.beginPath(); c.roundRect(0, 0, this.canvas.width, this.canvas.height, 28); c.fill();
    c.fillStyle = "#f8fafc";
    c.font = `${this.px}px ui-monospace, monospace`;
    c.textBaseline = "top";
    lines.slice(0, this.rows).forEach((l, i) => c.fillText(l, 24, 14 + i * this.px * 1.35, this.canvas.width - 48));
    this.texture.needsUpdate = true;
  }
  place(p: Vec3, camera: THREE.Camera): void {
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.quaternion.copy(camera.quaternion);
  }
}

/** Bright outline on the panel the ray is over. */
export class HoverFrame {
  readonly group = new THREE.Group();
  private readonly loops: THREE.LineLoop[];
  constructor() {
    this.loops = [0, 0.012].map(() => new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x7dd3fc, depthTest: false })));
    for (const l of this.loops) { l.frustumCulled = false; l.renderOrder = 38; this.group.add(l); }
    this.group.visible = false;
  }
  show(p: Panel | undefined): void {
    this.group.visible = !!p;
    if (!p) return;
    [0, 0.012].forEach((grow, i) => {
      const pts = panelOutline(p, 16, 0.004, grow).map((v) => new THREE.Vector3(v.x, v.y, v.z));
      this.loops[i]!.geometry.setFromPoints(pts);
    });
  }
}

function cursorTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.translate(14, 8);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 92); g.lineTo(24, 70); g.lineTo(42, 108); g.lineTo(58, 100); g.lineTo(40, 64); g.lineTo(72, 62); g.closePath();
  g.fillStyle = "#ffffff"; g.fill(); g.lineWidth = 7; g.strokeStyle = "#0f172a"; g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** The Mac cursor drawn on the panel at the aim point; the tip of the arrow is the aim. */
export class CursorViews {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  constructor(n = 2, private readonly size = 0.045) {
    const tex = cursorTexture();
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
      m.renderOrder = 39;
      m.visible = false;
      this.meshes.push(m);
      this.group.add(m);
    }
  }
  set(i: number, at?: { panel: Panel; x: number; y: number }): void {
    const m = this.meshes[i]!;
    m.visible = !!at;
    if (!at) return;
    const s = surfaceAt(at.panel, at.x, at.y, 0.006);
    // the arrow tip is at the top-left of the quad, so shift the quad right and down by half its size in the panel's frame
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const o = this.size * 0.4;
    m.position.set(s.pos.x + o * c, s.pos.y - o, s.pos.z - o * sn);
    m.rotation.set(0, s.yaw, 0);
  }
}

/** Expanding rings where a click landed. */
export class Ripples {
  readonly group = new THREE.Group();
  private readonly live: { r: Ripple; mesh: THREE.Mesh }[] = [];
  add(r: Ripple, panel: Panel): void {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32), new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, depthTest: false, side: THREE.DoubleSide }));
    m.renderOrder = 37;
    const s = surfaceAt(panel, r.x, r.y, 0.005);
    m.position.set(s.pos.x, s.pos.y, s.pos.z);
    m.rotation.set(0, s.yaw, 0);
    this.group.add(m);
    this.live.push({ r, mesh: m });
  }
  update(now: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const { r, mesh } = this.live[i]!;
      const a = rippleAt(now - r.start);
      if (!a) { this.group.remove(mesh); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); this.live.splice(i, 1); continue; }
      mesh.scale.setScalar(a.radius);
      (mesh.material as THREE.MeshBasicMaterial).opacity = a.opacity;
    }
  }
}

/** A short high tick for a click on the Mac. */
export function tickSound(ctx: AudioContext): void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "square";
  o.frequency.value = 1800;
  g.gain.setValueAtTime(0.05, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.04);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.05);
}
