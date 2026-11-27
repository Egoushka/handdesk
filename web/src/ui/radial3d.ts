import * as THREE from "three";
import { glassMaterial } from "../space/glass";
import { drawIcon } from "./icons";
import { RADIAL, RADIAL_M } from "./radial";
import { DEPTH, PALETTE, TYPE, WEIGHT, approach } from "./style";
import type { Zone } from "./zones";

const K = RADIAL_M / RADIAL;
/** Profile of a bevelled disc with its axis on +z: face at z = 1 (scaled by depth), rim chamfered. */
function discGeometry(r: number, depth: number): THREE.BufferGeometry {
  const b = Math.min(depth * 0.45, r * 0.12);
  const pts = [new THREE.Vector2(0, depth), new THREE.Vector2(r - b, depth), new THREE.Vector2(r, depth - b), new THREE.Vector2(r, 0.001), new THREE.Vector2(0, 0)];
  const g = new THREE.LatheGeometry(pts, 40);
  g.rotateX(Math.PI / 2);
  return g;
}

interface Btn { id: string; group: THREE.Group; body: THREE.Mesh; face: THREE.Mesh; lift: number; tint: number; danger: boolean }

/** The radial Menu as a 3D object: each action is a bevelled glass disc that rises toward you when hovered and presses in when poked. The Surface it belongs to keeps the zones, so touch, ray and controller hit the same shapes. */
export class Radial3D {
  readonly group = new THREE.Group();
  private readonly btns = new Map<string, Btn>();
  private last = 0;
  private ring: THREE.Mesh;

  constructor(zones: readonly Zone[]) {
    const ringTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 512; const g = c.getContext("2d")!; g.strokeStyle = "rgba(108,184,255,0.35)"; g.lineWidth = 6; g.beginPath(); g.arc(256, 256, 236, 0, Math.PI * 2); g.stroke(); g.strokeStyle = "rgba(255,255,255,0.08)"; g.lineWidth = 36; g.beginPath(); g.arc(256, 256, 200, 0, Math.PI * 2); g.stroke(); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(RADIAL_M * 0.84, RADIAL_M * 0.84), new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false }));
    this.ring.position.z = 0.002; this.ring.renderOrder = 4;
    this.group.add(this.ring);
    for (const z of zones) this.add(z);
  }

  private add(z: Zone): void {
    const r = (z.w / 2 - 6) * K;
    const danger = !!z.danger;
    const group = new THREE.Group();
    const mat = glassMaterial(danger ? PALETTE.warn : PALETTE.accent, "#2a3441", 0.95);
    const body = new THREE.Mesh(discGeometry(r, DEPTH.button * 1.6), mat);
    body.renderOrder = 5;
    const c = document.createElement("canvas"); c.width = c.height = 270;
    const g = c.getContext("2d")!;
    g.fillStyle = PALETTE.text; g.strokeStyle = PALETTE.text;
    if (z.icon) drawIcon(g, z.icon, 87, 38, 96, danger ? PALETTE.warn : PALETTE.text);
    g.font = `${WEIGHT.emphasis} ${TYPE.caption}px Roboto, 'Helvetica Neue', Arial, 'Liberation Sans', system-ui, sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = PALETTE.text;
    g.fillText(z.label, 135, 200, 240);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    face.position.z = DEPTH.button * 1.6 + 0.0008; face.renderOrder = 6;
    group.add(body, face);
    group.position.set((z.x + z.w / 2 - RADIAL / 2) * K, -(z.y + z.h / 2 - RADIAL / 2) * K, DEPTH.button);
    this.group.add(group);
    this.btns.set(z.id, { id: z.id, group, body, face, lift: DEPTH.button, tint: 0, danger });
  }

  /** Move each button toward its state: rest, hover (rises), pressed (sinks in). */
  update(now: number, hover: string | undefined, pressed: string | undefined): void {
    const dt = this.last ? Math.min(100, now - this.last) : 16;
    this.last = now;
    for (const b of this.btns.values()) {
      const target = b.id === pressed ? DEPTH.buttonPressed : b.id === hover ? DEPTH.buttonHover : DEPTH.button;
      b.lift = approach(b.lift, target, dt, 90);
      b.group.position.z = b.lift;
      b.tint = approach(b.tint, b.id === pressed ? 1 : b.id === hover ? 0.65 : 0, dt, 120);
      (b.body.material as THREE.ShaderMaterial).uniforms.uTint!.value = b.tint;
    }
  }
}
