import * as THREE from "three";
import type { HandFrame, JointName } from "../gesture/types";
import { BONES } from "./rig";
import type { Held } from "./hold";

const FINGERS = ["thumb", "index-finger", "middle-finger", "ring-finger", "pinky-finger"] as const;
const TIPS = FINGERS.map((f) => `${f}-tip` as JointName);

/** Radius of the glove around a joint, metres: thicker at the knuckle, finer at the tip. */
export function jointRadius(name: JointName): number {
  if (name === "wrist") return 0.014;
  const thumb = name.startsWith("thumb") ? 1.12 : 1;
  const base = name.includes("metacarpal") ? 0.0105 : name.includes("proximal") ? 0.0105 : name.includes("intermediate") ? 0.0093 : name.includes("distal") ? 0.0083 : 0.0074;
  return base * thumb;
}

const j = (finger: string, part: string) => `${finger}-${part}` as JointName;
/** Palm triangles: the sheet between the wrist, the metacarpals and the knuckle row, plus the thumb web. */
const PALM: [JointName, JointName, JointName][] = [
  ["wrist", "index-finger-metacarpal", "middle-finger-metacarpal"],
  ["wrist", "middle-finger-metacarpal", "ring-finger-metacarpal"],
  ["wrist", "ring-finger-metacarpal", "pinky-finger-metacarpal"],
  ["wrist", "thumb-metacarpal", "index-finger-metacarpal"],
  [j("index-finger", "metacarpal"), j("index-finger", "phalanx-proximal"), j("middle-finger", "phalanx-proximal")],
  [j("index-finger", "metacarpal"), j("middle-finger", "phalanx-proximal"), j("middle-finger", "metacarpal")],
  [j("middle-finger", "metacarpal"), j("middle-finger", "phalanx-proximal"), j("ring-finger", "phalanx-proximal")],
  [j("middle-finger", "metacarpal"), j("ring-finger", "phalanx-proximal"), j("ring-finger", "metacarpal")],
  [j("ring-finger", "metacarpal"), j("ring-finger", "phalanx-proximal"), j("pinky-finger", "phalanx-proximal")],
  [j("ring-finger", "metacarpal"), j("pinky-finger", "phalanx-proximal"), j("pinky-finger", "metacarpal")],
  ["thumb-metacarpal", "thumb-phalanx-proximal", "index-finger-phalanx-proximal"],
  ["thumb-metacarpal", "index-finger-phalanx-proximal", "index-finger-metacarpal"],
];
const SEGMENTS = BONES.slice(0, BONES.length - 3);
const JOINTS = [...new Set(SEGMENTS.flat())];

const VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV;
void main() {
  vec4 p = vec4(position, 1.0);
  vec3 n = normal;
  #ifdef USE_INSTANCING
    p = instanceMatrix * p;
    n = mat3(instanceMatrix) * n;
  #endif
  vec4 mv = modelViewMatrix * p;
  vN = normalize(normalMatrix * n);
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
uniform vec3 base; uniform vec3 rim; uniform float opacity;
varying vec3 vN; varying vec3 vV;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(vV);
  float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.4);
  float key = 0.5 + 0.5 * dot(n, normalize(vec3(0.35, 0.8, 0.45)));
  vec3 c = base * (0.45 + 0.55 * key) + rim * fres * 0.85;
  gl_FragColor = vec4(c, opacity * (0.74 + 0.26 * fres));
  #include <colorspace_fragment>
}`;

function glassMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { base: { value: new THREE.Color(0x6f9bd8) }, rim: { value: new THREE.Color(0xbfe3ff) }, opacity: { value: 1 } },
    transparent: true,
    side: THREE.DoubleSide,
  });
}

/** One hand drawn as a solid, slightly translucent glove from all 25 joints. */
class Glove {
  readonly group = new THREE.Group();
  readonly material = glassMaterial();
  private readonly segs = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 14, 1, true), this.material, SEGMENTS.length);
  private readonly knuckles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), this.material, JOINTS.length);
  private readonly palmPos = new Float32Array(PALM.length * 9);
  private readonly palmGeo = new THREE.BufferGeometry();
  private readonly palm: THREE.Mesh;
  private readonly tips = TIPS.map(() => new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xcdeaff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.palmGeo.setAttribute("position", new THREE.BufferAttribute(this.palmPos, 3));
    this.palmGeo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(this.palmPos.length), 3));
    this.palm = new THREE.Mesh(this.palmGeo, this.material);
    for (const m of [this.segs, this.knuckles, this.palm]) { m.frustumCulled = false; m.renderOrder = 3; this.group.add(m); }
    for (const t of this.tips) { t.renderOrder = 4; t.frustumCulled = false; this.group.add(t); }
    this.group.visible = false;
  }

  /** glow(joint) is 0..1 */
  update(h: HandFrame, alpha: number, glow: (joint: JointName) => number): void {
    this.group.visible = alpha > 0.01;
    if (!this.group.visible) return;
    this.material.uniforms.opacity!.value = 0.86 * alpha;
    let ns = 0;
    for (const [a, b] of SEGMENTS) {
      const pa = h.joints[a], pb = h.joints[b];
      if (!pa || !pb) continue;
      const va = new THREE.Vector3(pa.x, pa.y, pa.z), vb = new THREE.Vector3(pb.x, pb.y, pb.z);
      const dir = vb.clone().sub(va);
      const len = dir.length();
      if (len < 1e-4) continue;
      const r = (jointRadius(a) + jointRadius(b)) / 2;
      this.q.setFromUnitVectors(this.up, dir.normalize());
      this.m.compose(va.add(vb).multiplyScalar(0.5), this.q, new THREE.Vector3(r, len, r));
      this.segs.setMatrixAt(ns++, this.m);
    }
    this.segs.count = ns;
    this.segs.instanceMatrix.needsUpdate = true;
    let nk = 0;
    for (const name of JOINTS) {
      const p = h.joints[name];
      if (!p) continue;
      const r = jointRadius(name);
      this.m.compose(new THREE.Vector3(p.x, p.y, p.z), this.q.identity(), new THREE.Vector3(r, r, r));
      this.knuckles.setMatrixAt(nk++, this.m);
    }
    this.knuckles.count = nk;
    this.knuckles.instanceMatrix.needsUpdate = true;
    PALM.forEach((tri, i) => {
      const ps = tri.map((n) => h.joints[n]);
      const ok = ps.every(Boolean);
      ps.forEach((p, k) => {
        this.palmPos[i * 9 + k * 3] = ok ? p!.x : 0;
        this.palmPos[i * 9 + k * 3 + 1] = ok ? p!.y : 0;
        this.palmPos[i * 9 + k * 3 + 2] = ok ? p!.z : 0;
      });
    });
    this.palmGeo.attributes.position!.needsUpdate = true;
    this.palmGeo.computeVertexNormals();
    TIPS.forEach((name, i) => {
      const t = this.tips[i]!;
      const p = h.joints[name];
      t.visible = !!p;
      if (!p) return;
      const g = glow(name);
      t.position.set(p.x, p.y, p.z);
      const s = 0.0078 + 0.007 * g;
      t.scale.set(s, s, s);
      (t.material as THREE.MeshBasicMaterial).opacity = (0.28 + 0.72 * g) * alpha;
    });
  }
}

/** Both hands as gloves. Fed with held poses, so a tracking dropout does not blink them (see PoseHold). */
export class GloveHands {
  readonly group = new THREE.Group();
  private readonly gloves = { left: new Glove(), right: new Glove() };
  constructor() { this.group.add(this.gloves.left.group, this.gloves.right.group); }

  update(held: Held<HandFrame>[], glow: (h: HandFrame, joint: JointName) => number): void {
    const seen = new Set<string>();
    for (const { frame, alpha } of held) { seen.add(frame.hand); this.gloves[frame.hand].update(frame, alpha, (n) => glow(frame, n)); }
    for (const side of ["left", "right"] as const) if (!seen.has(side)) this.gloves[side].group.visible = false;
  }

  /** how many gloves are drawn right now */
  get visibleCount(): number { return [this.gloves.left, this.gloves.right].filter((g) => g.group.visible).length; }
}

/** Soft dark blobs on panels under hovering hands. A fixed pool, reused every frame. */
export class ShadowPool {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  constructor(n = 12) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, "rgba(0,0,0,0.9)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      m.visible = false;
      m.renderOrder = 2;
      this.meshes.push(m);
      this.group.add(m);
    }
  }
  set(spots: { pos: { x: number; y: number; z: number }; yaw: number; alpha: number; radius: number }[]): void {
    this.meshes.forEach((m, i) => {
      const s = spots[i];
      m.visible = !!s;
      if (!s) return;
      m.position.set(s.pos.x, s.pos.y, s.pos.z);
      m.rotation.set(0, s.yaw, 0);
      m.scale.set(s.radius * 2, s.radius * 2, 1);
      (m.material as THREE.MeshBasicMaterial).opacity = s.alpha;
    });
  }
}
