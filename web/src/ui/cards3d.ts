import * as THREE from "three";
import { glassMaterial, slabGeometry } from "../space/glass";
import { drawZones, type DrawOpts } from "./draw";
import { approach } from "./style";
import type { Zone } from "./zones";

/** Where a card of the window overview rests: a shallow arc in front of the deck, outer cards further back and turned toward the middle. `nx` is -1..1 across the deck. */
export function cardPose(nx: number): { z: number; yaw: number } {
  const a = Math.max(-1, Math.min(1, nx));
  return { z: 0.04 - 0.03 * a * a, yaw: -a * 0.26 };
}

interface Card { id: string; group: THREE.Group; face: THREE.Mesh; tex: THREE.CanvasTexture; canvas: HTMLCanvasElement; z: Zone; lift: number; sig: string; nx: number }

/** The Windows tab as a 3D overview: every window is a thick glass card (live picture on its face) arranged on an arc in space. The deck's zones stay the hit shapes. */
export class Cards3D {
  readonly group = new THREE.Group();
  private cards: Card[] = [];
  private key = "";
  private last = 0;
  constructor(private readonly baseM: number, private readonly W: number) {}

  private build(tiles: Zone[], H: number): void {
    for (const c of this.cards) { c.tex.dispose(); c.face.geometry.dispose(); }
    this.group.clear();
    this.cards = [];
    const K = this.baseM / this.W;
    for (const z of tiles) {
      const w = z.w * K, h = z.h * K;
      const canvas = document.createElement("canvas"); canvas.width = z.w; canvas.height = z.h;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
      const group = new THREE.Group();
      const slab = new THREE.Mesh(slabGeometry(w + 0.008, h + 0.008, 0, 0.014, 0.014, 0.004), glassMaterial("#6cb8ff", "#26303d", 0.92));
      slab.renderOrder = 5;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      face.position.z = 0.0008; face.renderOrder = 6;
      group.add(slab, face);
      const cx = (z.x + z.w / 2 - this.W / 2) * K, cy = -(z.y + z.h / 2 - H / 2) * K;
      group.position.set(cx, cy, 0.04);
      this.group.add(group);
      this.cards.push({ id: z.id, group, face, tex, canvas, z, lift: 0.04, sig: "", nx: cx / (this.baseM / 2) });
    }
  }

  update(now: number, tiles: Zone[], H: number, hover: string | undefined, pressed: string | undefined, opts: Pick<DrawOpts, "thumbs">, tick: string): void {
    const key = tiles.map((t) => `${t.id}:${t.x}:${t.y}`).join("|");
    if (key !== this.key) { this.key = key; this.build(tiles, H); }
    const dt = this.last ? Math.min(100, now - this.last) : 16;
    this.last = now;
    for (const c of this.cards) {
      const pose = cardPose(c.nx);
      const up = c.id === pressed ? -0.02 : c.id === hover ? 0.03 : 0;
      c.lift = approach(c.lift, pose.z + up, dt, 120);
      c.group.position.z = c.lift;
      c.group.rotation.y = pose.yaw * (c.id === hover ? 0.4 : 1);
      const live = tiles.find((t) => t.id === c.id) ?? c.z;
      const sig = JSON.stringify([live, c.id === hover, c.id === pressed, tick]);
      if (sig !== c.sig) {
        c.sig = sig;
        drawZones(c.canvas.getContext("2d")!, c.canvas.width, c.canvas.height, [{ ...live, x: 0, y: 0 }], { ...opts, look: "card", hover: c.id === hover ? c.id : undefined, pressed: c.id === pressed ? c.id : undefined });
        c.tex.needsUpdate = true;
      }
    }
  }
}
