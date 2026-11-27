import * as THREE from "three";
import type { Panel } from "../panel";
import { panelPoint } from "../space/surface";
import { cropUv, type Rect } from "./rect";
import { Glass } from "../space/glass";
import { headRef, tiltToward } from "../space/tilt";

/** A floating live crop of a panel: the same texture as its source with the uv cut to the region, so no extra capture. */
export class SnipView {
  readonly mesh = new THREE.Group();
  private readonly frame: THREE.LineLoop;
  private readonly quad: THREE.Mesh;
  /** the picture and its frame, scaled to the snip size; the glass slab is not scaled */
  private readonly inner = new THREE.Group();
  private readonly glass = new Glass(0.016, true, 0.012);
  constructor(readonly id: number, readonly sourceKey: string, texture: THREE.Texture, public panel: Panel, public pinned: boolean) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(cropUv(panel.crop!), 2));
    this.quad = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
    this.frame = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.5, -0.5, 0.001), new THREE.Vector3(0.5, -0.5, 0.001), new THREE.Vector3(0.5, 0.5, 0.001), new THREE.Vector3(-0.5, 0.5, 0.001)]),
      new THREE.LineBasicMaterial({ color: 0x67e8f9 }),
    );
    this.inner.add(this.quad, this.frame);
    this.mesh.rotation.order = "YXZ";
    this.mesh.add(this.inner, this.glass.group);
    this.mesh.renderOrder = 1;
    this.setPinned(pinned);
    this.sync();
  }
  setPinned(p: boolean): void {
    this.pinned = p;
    (this.frame.material as THREE.LineBasicMaterial).color.set(p ? 0xfbbf24 : 0x67e8f9);
  }
  sync(): void {
    const p = this.panel;
    this.mesh.position.set(p.center.x, p.center.y, p.center.z);
    this.mesh.rotation.set(tiltToward(p.center, headRef), p.yaw, 0);
    this.inner.scale.set(p.width, p.height, 1);
    this.glass.fit({ width: p.width, height: p.height, curve: 0 });
  }
}

/** The live selection while a snip is being drawn: an outline and a faint fill lying on the source panel. */
export class SelectionOverlay {
  readonly group = new THREE.Group();
  private readonly line = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x67e8f9, depthTest: false }));
  private readonly fill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.16, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  constructor() {
    this.line.renderOrder = this.fill.renderOrder = 8;
    this.line.frustumCulled = this.fill.frustumCulled = false;
    this.group.add(this.fill, this.line);
    this.group.visible = false;
  }
  hide(): void { this.group.visible = false; }
  /** the outline points of a rectangle on the panel, following its curve */
  static outline(p: Panel, r: Rect, steps = 16): THREE.Vector3[] {
    const pts: THREE.Vector3[] = [];
    const add = (u: number, v: number) => { const { pos } = panelPoint(p, u, v, 0.004); pts.push(new THREE.Vector3(pos.x, pos.y, pos.z)); };
    for (let i = 0; i < steps; i++) add(r.x0 + ((r.x1 - r.x0) * i) / steps, r.y0);
    for (let i = 0; i < steps; i++) add(r.x1, r.y0 + ((r.y1 - r.y0) * i) / steps);
    for (let i = 0; i < steps; i++) add(r.x1 - ((r.x1 - r.x0) * i) / steps, r.y1);
    for (let i = 0; i < steps; i++) add(r.x0, r.y1 - ((r.y1 - r.y0) * i) / steps);
    return pts;
  }
  show(p: Panel, r: Rect): void {
    const pts = SelectionOverlay.outline(p, r);
    this.line.geometry.setFromPoints(pts);
    const tri: number[] = [];
    const c = new THREE.Vector3();
    pts.forEach((q) => c.add(q));
    c.multiplyScalar(1 / pts.length);
    pts.forEach((q, i) => { const n = pts[(i + 1) % pts.length]!; tri.push(c.x, c.y, c.z, q.x, q.y, q.z, n.x, n.y, n.z); });
    this.fill.geometry.setAttribute("position", new THREE.Float32BufferAttribute(tri, 3));
    this.group.visible = true;
  }
}
