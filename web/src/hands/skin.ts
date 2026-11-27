import * as THREE from "three";
import { XRHandModelFactory } from "three/examples/jsm/webxr/XRHandModelFactory.js";

/** Where the generic hand meshes are served from: web/public/hands (copied from @webxr-input-profiles/assets, MIT). */
export const HAND_MODEL_PATH = "/hands/";

/** Skinned hand models driven by the renderer's own XR hand objects (not our joint pipeline). */
export class SkinnedHands {
  readonly group = new THREE.Group();
  constructor(renderer: THREE.WebGLRenderer) {
    const factory = new XRHandModelFactory();
    factory.setPath(HAND_MODEL_PATH);
    for (const i of [0, 1]) {
      const hand = renderer.xr.getHand(i);
      hand.add(factory.createHandModel(hand, "mesh"));
      this.group.add(hand);
    }
    this.group.visible = false;
  }
  show(on: boolean): void { this.group.visible = on; }
}
