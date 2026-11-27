import * as THREE from "three";
import type { Panel } from "../panel";

/** Thick glass without lights or an environment map: graphite body, a fresnel rim in the accent, a cool top-edge highlight. Cheap enough for Quest. */
export function glassMaterial(rim = "#6cb8ff", body = "#26303d", alpha = 0.9): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { uBody: { value: new THREE.Color(body) }, uRim: { value: new THREE.Color(rim) }, uAlpha: { value: alpha }, uOpacity: { value: 1 }, uTint: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vW;
      void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uBody; uniform vec3 uRim; uniform float uAlpha; uniform float uOpacity; uniform float uTint;
      varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 n = normalize(vN); vec3 v = normalize(cameraPosition - vW);
        float f = pow(1.0 - abs(dot(n, v)), 2.4);
        float top = clamp(n.y, 0.0, 1.0);
        vec3 c = mix(uBody, uRim, uTint * 0.8) + uRim * (f * 1.1) + vec3(0.5, 0.62, 0.8) * top * 0.3;
        gl_FragColor = vec4(c, clamp(uAlpha + f * 0.5, 0.0, 1.0) * uOpacity);
      }`,
  });
  // the fade code sets `opacity` on every material; route it to the shader
  Object.defineProperty(m, "opacity", { get: () => m.uniforms.uOpacity!.value as number, set: (v: number) => { m.uniforms.uOpacity!.value = v; }, configurable: true });
  return m;
}

/** A bevelled slab behind a panel: a chamfered profile swept round the rounded outline, plus a back face. Follows the panel's curve. Local +z is toward the viewer; the slab sits behind z = 0. */
export function slabGeometry(width: number, height: number, curve: number, depth: number, radius = 0.02, bevel = 0.006): THREE.BufferGeometry {
  const R = curve < 1e-3 ? 0 : width / curve;
  const bend = (x: number): number => (R ? R * (1 - Math.cos(Math.asin(Math.max(-1, Math.min(1, x / R))))) : 0);
  const hw = width / 2, hh = height / 2, r = Math.min(radius, hw, hh);
  // outline, counter-clockwise seen from the front: bottom edge L->R, corner BR, right edge, top edge R->L, corner TL, left edge
  const pts: [number, number][] = [];
  const cols = R ? 24 : 1;
  for (let i = 0; i <= cols; i++) pts.push([-hw + r + ((width - 2 * r) * i) / cols, -hh]);
  const corner = (cx: number, cy: number, a0: number): void => { for (let k = 0; k <= 4; k++) { const a = a0 + (k / 4) * (Math.PI / 2); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  corner(hw - r, -hh + r, -Math.PI / 2);
  corner(hw - r, hh - r, 0);
  for (let i = cols; i >= 0; i--) pts.push([-hw + r + ((width - 2 * r) * i) / cols, hh]);
  corner(-hw + r, hh - r, Math.PI / 2);
  corner(-hw + r, -hh + r, Math.PI);
  // chamfered profile: outset, z (front rim just behind the face, bevel in, straight side, bevel to the back)
  const b = bevel;
  const prof: [number, number][] = [[0.0, -0.0005], [b * 0.6, -b * 0.5], [b, -b * 1.6], [b, -(depth - b * 1.6)], [b * 0.6, -(depth - b * 0.5)], [0, -depth]];
  const pos: number[] = [];
  const idx: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!, a = pts[(i + n - 1) % n]!, c = pts[(i + 1) % n]!;
    let tx = c[0] - a[0], ty = c[1] - a[1];
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const nx = ty, ny = -tx;
    for (const [o, z] of prof) pos.push(p[0] + nx * o, p[1] + ny * o, z + bend(p[0]));
  }
  const m = prof.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    for (let k = 0; k < m - 1; k++) { const a = i * m + k, b2 = i * m + k + 1, c = j * m + k, d = j * m + k + 1; idx.push(a, c, b2, b2, c, d); }
  }
  // back face: a grid in columns
  const base = pos.length / 3;
  for (let i = 0; i <= cols; i++) { const x = -hw + (width * i) / cols; pos.push(x, -hh, -depth + bend(x), x, hh, -depth + bend(x)); }
  for (let i = 0; i < cols; i++) { const a = base + i * 2; idx.push(a, a + 3, a + 2, a, a + 1, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

let haloTex: THREE.CanvasTexture | undefined;
function soft(): THREE.CanvasTexture {
  if (haloTex) return haloTex;
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const gr = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.55, "rgba(255,255,255,0.35)"); gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  haloTex = new THREE.CanvasTexture(c);
  return haloTex;
}

/** A soft dark contact shadow and a faint accent glow on the room behind a panel. */
export function halo(width: number, height: number): THREE.Group {
  const grp = new THREE.Group();
  const mk = (w: number, h: number, color: number, op: number, blending: THREE.Blending, z: number, dy: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: soft(), color, transparent: true, opacity: op, blending, depthWrite: false }));
    m.position.set(0, dy, z); m.renderOrder = -1; m.userData.baseOp = op;
    return m;
  };
  grp.add(mk(width * 1.35 + 0.1, height * 1.45 + 0.1, 0x000000, 0.34, THREE.NormalBlending, -0.05, -height * 0.06));
  grp.add(mk(width * 1.2 + 0.08, height * 1.3 + 0.08, 0x6cb8ff, 0.1, THREE.AdditiveBlending, -0.035, 0));
  grp.userData.noFade = true;
  return grp;
}

/** Slab + halo for a panel, as one child group; call `fit` when the panel size or curve changes. */
export class Glass {
  readonly group = new THREE.Group();
  private slab: THREE.Mesh;
  private shadow: THREE.Group;
  private key = "";
  constructor(private readonly depth: number, private readonly withHalo = true, private readonly radius = 0.02) {
    this.slab = new THREE.Mesh(new THREE.BufferGeometry(), glassMaterial());
    this.slab.renderOrder = 0;
    this.shadow = new THREE.Group();
    this.group.add(this.slab, this.shadow);
  }
  fit(p: Pick<Panel, "width" | "height" | "curve">): void {
    const k = `${p.width.toFixed(3)}|${p.height.toFixed(3)}|${p.curve.toFixed(3)}`;
    if (k === this.key) return;
    this.key = k;
    this.slab.geometry.dispose();
    this.slab.geometry = slabGeometry(p.width + 0.012, p.height + 0.012, p.curve, this.depth, this.radius);
    this.shadow.clear();
    if (this.withHalo) this.shadow.add(halo(p.width, p.height));
  }
}
