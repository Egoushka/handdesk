import * as THREE from "three";
import type { Panel } from "../panel";
import { drawZones, type DrawOpts } from "./draw";
import { zoneAt, type Zone } from "./zones";
import { Glass } from "../space/glass";
import { DEPTH } from "./style";
import { Radial3D } from "./radial3d";
import { Cards3D } from "./cards3d";

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
  /** thick glass behind the face; the radial menu builds its own 3D buttons instead */
  readonly glass: Glass | undefined;
  private readonly baseM: number;
  private r3: Radial3D | undefined;
  private cards: Cards3D | undefined;

  constructor(readonly id: string, widthM: number, readonly W: number, readonly H: number, private readonly look: "panel" | "radial" | "card" = "panel") {
    this.canvas.width = W;
    this.canvas.height = H;
    this.panel = { display: -1, center: { x: 0, y: 1.2, z: -1 }, yaw: 0, width: widthM, height: widthM * (H / W), curve: 0 };
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(this.panel.width, this.panel.height), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }));
    this.baseM = widthM;
    this.mesh.renderOrder = 4;
    if (look === "panel") { this.glass = new Glass(DEPTH.uiSlab); this.glass.fit(this.panel); this.mesh.add(this.glass.group); }
    this.mesh.visible = false;
  }

  show(on: boolean): void { this.visible = on; this.mesh.visible = on; }
  /** Resize in metres (the palm menu is small, the one in front is bigger); hits and the mesh agree. */
  setWidth(m: number): void {
    this.panel.width = m; this.panel.height = m * (this.H / this.W);
    this.mesh.scale.setScalar(m / this.baseM);
  }
  sync(): void {
    this.mesh.position.set(this.panel.center.x, this.panel.center.y, this.panel.center.z);
    this.mesh.rotation.set(0, this.panel.yaw, 0);
  }
  /** Per-frame motion of the 3D parts: radial buttons rise and press in, window cards settle on their arc. */
  animate(now: number, opts: Pick<DrawOpts, "thumbs"> = {}, tick = ""): void {
    this.r3?.update(now, this.hover, this.pressed?.id);
    if (this.cards) {
      const tiles = this.zones.filter((z) => z.thumb !== undefined);
      this.cards.group.visible = tiles.length > 0;
      this.cards.update(now, tiles, this.H, this.hover, this.pressed?.id, opts, tick);
    }
  }
  /** Turn the window overview (3D cards over the tiles) on or off. */
  overview(on: boolean): void {
    if (on && !this.cards) { this.cards = new Cards3D(this.baseM, this.W); this.mesh.add(this.cards.group); }
    if (this.cards) this.cards.group.visible = on;
  }
  zoneAt(x: number, y: number): Zone | undefined { return zoneAt(this.zones, x, y, this.W, this.H); }

  /** Redraw only when the zones, the hover or the press changed; `extra` is a cache key for live content such as thumbnails. */
  setZones(zones: Zone[], now: number, opts: Omit<DrawOpts, "hover" | "pressed" | "look"> = {}, extra = ""): void {
    this.zones = zones;
    if (this.look === "radial" && !this.r3) { this.r3 = new Radial3D(zones); this.mesh.add(this.r3.group); }
    if (this.pressed && now > this.pressed.until) this.pressed = undefined;
    const sig = JSON.stringify([zones, this.hover, this.pressed?.id, extra]);
    if (sig === this.sig) return;
    this.sig = sig;
    drawZones(this.canvas.getContext("2d")!, this.W, this.H, zones, { ...opts, hover: this.hover, pressed: this.pressed?.id, look: this.look });
    this.texture.needsUpdate = true;
  }
}
