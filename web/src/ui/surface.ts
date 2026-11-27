import * as THREE from "three";
import type { Panel } from "../panel";
import { drawZones, type DrawOpts } from "./draw";
import { zoneAt, type Zone } from "./zones";

/** A flat glass panel in the scene whose buttons are a list of zones; the select ray, touch and the hover state all read the same list. */
export class Surface {
  readonly canvas = document.createElement("canvas");
  readonly mesh: THREE.Mesh;
  readonly panel: Panel;
  zones: Zone[] = [];
  visible = false;
  hover: string | undefined;
  pressed: { id: string; until: number } | undefined;
  private readonly texture: THREE.CanvasTexture;
  private sig = "";

  constructor(readonly id: string, widthM: number, readonly W: number, readonly H: number, private readonly chip = false) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.panel = { display: -1, center: { x: 0, y: 1.2, z: -1 }, yaw: 0, width: widthM, height: widthM * (H / W), curve: 0 };
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.panel.width, this.panel.height), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }));
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
  }

  show(on: boolean): void { this.visible = on; this.mesh.visible = on; }
  sync(): void {
    this.mesh.position.set(this.panel.center.x, this.panel.center.y, this.panel.center.z);
    this.mesh.rotation.set(0, this.panel.yaw, 0);
  }
  zoneAt(x: number, y: number): Zone | undefined { return zoneAt(this.zones, x, y, this.W, this.H); }

  /** Redraw only when the zones, the hover or the press changed; `extra` is a cache key for live content such as thumbnails. */
  setZones(zones: Zone[], now: number, opts: Omit<DrawOpts, "hover" | "pressed" | "chip"> = {}, extra = ""): void {
    this.zones = zones;
    if (this.pressed && now > this.pressed.until) this.pressed = undefined;
    const sig = JSON.stringify([zones, this.hover, this.pressed?.id, extra]);
    if (sig === this.sig) return;
    this.sig = sig;
    drawZones(this.canvas.getContext("2d")!, this.W, this.H, zones, { ...opts, hover: this.hover, pressed: this.pressed?.id, chip: this.chip });
    this.texture.needsUpdate = true;
  }
}
