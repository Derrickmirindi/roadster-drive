/**
 * Original, procedurally built open-top roadster ("GR-1"), a long-bonnet
 * two-seater with twin head-rest fairings and a ducktail.
 *
 * Everything here is generated from Three.js primitives at runtime — there is no
 * third-party model. Each part uses its own material so recolouring the body
 * never touches glass, tyres, trim or lights.
 *
 * Local axes: +z is the front of the car, +y is up, origin on the ground at the
 * centre of the wheelbase.
 */
import * as THREE from 'three';

export type Finish = 'gloss' | 'metallic' | 'matte';

export const CAR_LENGTH = 4.4;
export const CAR_WIDTH = 1.9;
const WHEEL_R = 0.34;
const WHEEL_W = 0.27;
const FRONT_AXLE = 1.32;
const REAR_AXLE = -1.3;
const TRACK_HALF = 0.8;
const HALF_LEN = CAR_LENGTH / 2;

export interface WheelRig {
  steerPivot: THREE.Object3D; // rotates about y for steering (front only)
  spin: THREE.Object3D; // rotates about x for rolling
  front: boolean;
}

export class CarModel {
  readonly root = new THREE.Group();
  readonly bodyMaterial: THREE.MeshPhysicalMaterial;
  readonly wheelMaterial: THREE.MeshStandardMaterial;
  readonly trimMaterial: THREE.MeshStandardMaterial;
  readonly glassMaterial: THREE.MeshPhysicalMaterial;
  readonly headlightLensMaterial: THREE.MeshStandardMaterial;
  readonly taillightMaterial: THREE.MeshStandardMaterial;
  readonly wheels: WheelRig[] = [];
  readonly headlights: THREE.SpotLight[] = [];
  private headlightsOn = true;
  private night = false;

  constructor() {
    this.bodyMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xa3141c,
      roughness: 0.28,
      metalness: 0.1,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    });
    this.trimMaterial = new THREE.MeshStandardMaterial({ color: 0x232426, roughness: 0.55, metalness: 0.2 });
    const interiorMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.85 });
    const seatMaterial = new THREE.MeshStandardMaterial({ color: 0x2c2b2a, roughness: 0.7 });
    this.glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x9fb3bf,
      roughness: 0.05,
      metalness: 0,
      transmission: 0, // keep cheap: no transmission pass
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const tyreMaterial = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 });
    this.wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3b3d, roughness: 0.35, metalness: 0.85 });
    const discMaterial = new THREE.MeshStandardMaterial({ color: 0x6d6e70, roughness: 0.45, metalness: 0.9 });
    const caliperMaterial = new THREE.MeshStandardMaterial({ color: 0xd62a1e, roughness: 0.4 });
    this.headlightLensMaterial = new THREE.MeshStandardMaterial({
      color: 0xf4f1ea,
      emissive: 0xfff4dc,
      emissiveIntensity: 1.2,
      roughness: 0.2,
    });
    this.taillightMaterial = new THREE.MeshStandardMaterial({
      color: 0x5a0a0a,
      emissive: 0xff1a12,
      emissiveIntensity: 0.9,
      roughness: 0.4,
    });

    const add = (mesh: THREE.Mesh, cast = true) => {
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      return mesh;
    };

    // --- Sculpted body shell -------------------------------------------------
    // A lofted surface: rounded "superellipse" cross-sections whose width and
    // height follow smooth profiles along the car, with cut-outs for the wheel
    // arches and the open cockpit.
    const body = buildShell();
    add(new THREE.Mesh(body, this.bodyMaterial));
    // Dark arch liners behind the openings so the wheels sit in proper wells.
    const linerGeo = new THREE.CylinderGeometry(ARCH_R - 0.01, ARCH_R - 0.01, 0.34, 32, 1, true, -0.25, Math.PI + 0.5);
    linerGeo.rotateZ(Math.PI / 2);
    const linerMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.95, side: THREE.BackSide });
    for (const za of [FRONT_AXLE, REAR_AXLE])
      for (const side of [-1, 1]) {
        const liner = new THREE.Mesh(linerGeo, linerMat);
        liner.position.set(side * (shellHalfWidth(za) - 0.27), WHEEL_R, za);
        add(liner, false);
      }

    // Satin-black lower body: sills, front splitter, rear diffuser.
    const sillGeo = new THREE.BoxGeometry(0.05, 0.1, 1.55);
    for (const side of [-1, 1]) {
      const sill = new THREE.Mesh(sillGeo, this.trimMaterial);
      sill.position.set(side * (shellHalfWidth(0) - 0.01), 0.27, 0.02);
      add(sill, false);
    }
    const splitter = new THREE.Mesh(new RoundedBox(1.18, 0.04, 0.3, 0.015), this.trimMaterial);
    splitter.position.set(0, 0.19, surfaceZ(0.24, 0.55) - 0.12);
    add(splitter);
    const diffuser = new THREE.Mesh(new RoundedBox(1.2, 0.12, 0.3, 0.02), this.trimMaterial);
    diffuser.position.set(0, 0.24, surfaceZ(0.26, 0.6, true) + 0.14);
    add(diffuser);
    for (let k = -2; k <= 2; k++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.3), this.trimMaterial);
      fin.position.set(k * 0.22, 0.2, surfaceZ(0.26, 0.6, true) + 0.1);
      add(fin, false);
    }
    // Lower front intake.
    const intake = new THREE.Mesh(new RoundedBox(0.9, 0.09, 0.05, 0.02), interiorMaterial);
    intake.position.set(0, 0.29, surfaceZ(0.29, 0.45) - 0.005);
    add(intake, false);
    // Side vents ahead of the rear wheels.
    for (const side of [-1, 1]) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.42), interiorMaterial);
      vent.position.set(side * (shellHalfWidth(-0.55) + 0.003), 0.52, -0.55);
      add(vent, false);
    }

    // --- Open cockpit --------------------------------------------------------
    const tub = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.05, 1.32), interiorMaterial);
    tub.position.set(0, 0.6, -0.12);
    add(tub, false);
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.16, 0.24), interiorMaterial);
    dash.position.set(0, 0.84, 0.48);
    add(dash, false);
    for (const side of [-1, 1]) {
      const cushion = new THREE.Mesh(new RoundedBox(0.5, 0.14, 0.52, 0.05), seatMaterial);
      cushion.position.set(side * 0.33, 0.7, -0.1);
      add(cushion);
      const back = new THREE.Mesh(new RoundedBox(0.46, 0.5, 0.12, 0.05), seatMaterial);
      back.position.set(side * 0.33, 0.93, -0.42);
      back.rotation.x = -0.22;
      add(back);
      // Head-rest fairings flowing into the rear deck, in body colour.
      const fairing = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.7, 8, 16), this.bodyMaterial);
      fairing.rotation.x = Math.PI / 2 - 0.08;
      fairing.scale.set(1, 1, 0.82);
      fairing.position.set(side * 0.33, 0.88, -0.98);
      add(fairing);
    }
    const steering = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 10, 28), this.trimMaterial);
    steering.position.set(0.33, 0.9, 0.24);
    steering.rotation.x = -0.5;
    add(steering);

    // Raked windscreen with a slim frame.
    const screenGeo = new THREE.PlaneGeometry(1.42, 0.42, 8, 2);
    const sp = screenGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i);
      sp.setZ(i, -0.12 * (x / 0.71) ** 2); // wrap-around curvature
    }
    screenGeo.computeVertexNormals();
    const screen = new THREE.Mesh(screenGeo, this.glassMaterial);
    screen.position.set(0, 0.98, 0.6);
    screen.rotation.x = -0.95;
    screen.renderOrder = 2;
    this.root.add(screen);
    const header = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.36, 8), this.trimMaterial);
    header.rotation.z = Math.PI / 2;
    header.position.set(0, 1.13, 0.48);
    add(header);
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.46, 8), this.trimMaterial);
      pillar.position.set(side * 0.7, 0.98, 0.6);
      pillar.rotation.x = -0.95;
      add(pillar);
      // Mirrors on slim stalks, housing in body colour.
      const mirror = new THREE.Mesh(new RoundedBox(0.2, 0.09, 0.08, 0.03), this.bodyMaterial);
      mirror.position.set(side * 0.98, 0.9, 0.5);
      add(mirror);
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.03), this.trimMaterial);
      stalk.position.set(side * 0.86, 0.87, 0.52);
      add(stalk, false);
    }

    // --- Lights --------------------------------------------------------------
    // Thin headlamp strips that follow the nose surface.
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 8; k++) {
        const x = side * (0.32 + k * 0.045);
        const y = 0.45 + k * 0.007;
        pts.push(new THREE.Vector3(x, y, surfaceZ(y, x) + 0.006));
      }
      const lamp = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.022, 6), this.headlightLensMaterial);
      add(lamp, false);
    }
    // Full-width rear light bar following the tail.
    {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 16; k++) {
        const x = -0.62 + (k / 16) * 1.24;
        const y = 0.66;
        pts.push(new THREE.Vector3(x, y, surfaceZ(y, x, true) - 0.006));
      }
      const bar = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.018, 6), this.taillightMaterial);
      add(bar, false);
    }

    // Headlight beams: real spot lights, so they visibly light the road at night.
    for (const side of [-1, 1]) {
      const spot = new THREE.SpotLight(0xfff1d6, 0, 70, 0.42, 0.55, 1.2);
      spot.position.set(side * 0.6, 0.55, 2.15);
      spot.target.position.set(side * 0.9, 0, 14);
      spot.castShadow = false;
      this.root.add(spot);
      this.root.add(spot.target);
      this.headlights.push(spot);
    }

    // --- Wheels: profiled tyres, ten-spoke rims, discs and calipers ----------
    const tyreGeo = buildTyre(WHEEL_R, WHEEL_W);
    const rimBarrel = new THREE.CylinderGeometry(WHEEL_R * 0.72, WHEEL_R * 0.72, WHEEL_W * 0.9, 32, 1, true);
    rimBarrel.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.055, 0.065, 0.06, 16);
    hubGeo.rotateZ(Math.PI / 2);
    const spokeGeo = new THREE.BoxGeometry(0.03, WHEEL_R * 0.62, 0.045);
    spokeGeo.translate(0, WHEEL_R * 0.36, 0);
    const discGeo = new THREE.CylinderGeometry(WHEEL_R * 0.6, WHEEL_R * 0.6, 0.028, 32);
    discGeo.rotateZ(Math.PI / 2);
    const caliperGeo = new RoundedBox(0.05, 0.16, 0.12, 0.02);

    for (const [z, front] of [
      [FRONT_AXLE, true],
      [REAR_AXLE, false],
    ] as const) {
      for (const side of [-1, 1]) {
        const steerPivot = new THREE.Object3D();
        steerPivot.position.set(side * TRACK_HALF, WHEEL_R, z);
        this.root.add(steerPivot);
        const spin = new THREE.Object3D();
        steerPivot.add(spin);
        const tyre = new THREE.Mesh(tyreGeo, tyreMaterial);
        tyre.castShadow = true;
        spin.add(tyre);
        const barrel = new THREE.Mesh(rimBarrel, this.wheelMaterial);
        spin.add(barrel);
        const face = new THREE.Group();
        face.position.x = side * (WHEEL_W * 0.36);
        const hub = new THREE.Mesh(hubGeo, this.wheelMaterial);
        face.add(hub);
        for (let k = 0; k < 10; k++) {
          const spoke = new THREE.Mesh(spokeGeo, this.wheelMaterial);
          spoke.rotation.x = (k / 10) * Math.PI * 2;
          spoke.rotation.z = side * 0.06; // slight dish
          face.add(spoke);
        }
        spin.add(face);
        // Non-rotating parts live on the steer pivot.
        const disc = new THREE.Mesh(discGeo, discMaterial);
        disc.position.x = side * 0.02;
        steerPivot.add(disc);
        const caliper = new THREE.Mesh(caliperGeo, caliperMaterial);
        caliper.position.set(side * 0.05, 0.13, front ? -0.06 : 0.06);
        steerPivot.add(caliper);
        this.wheels.push({ steerPivot, spin, front });
      }
    }

    // Soft contact shadow blob (always visible, even with shadows disabled).
    const blobTex = makeBlobTexture();
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 5.0),
      new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.55 }),
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.012;
    blob.renderOrder = 1;
    this.root.add(blob);

    this.applyLightState();
  }

  setBodyColor(hex: string): void {
    this.bodyMaterial.color.set(hex);
  }

  setWheelColor(hex: string): void {
    this.wheelMaterial.color.set(hex);
  }

  setFinish(finish: Finish): void {
    const m = this.bodyMaterial;
    if (finish === 'gloss') {
      m.metalness = 0.08;
      m.roughness = 0.26;
      m.clearcoat = 1;
      m.clearcoatRoughness = 0.06;
    } else if (finish === 'metallic') {
      m.metalness = 0.72;
      m.roughness = 0.32;
      m.clearcoat = 0.8;
      m.clearcoatRoughness = 0.12;
    } else {
      m.metalness = 0.02;
      m.roughness = 0.82;
      m.clearcoat = 0;
      m.clearcoatRoughness = 1;
    }
    m.needsUpdate = true;
  }

  setHeadlights(on: boolean): void {
    this.headlightsOn = on;
    this.applyLightState();
  }

  setNight(night: boolean): void {
    this.night = night;
    this.applyLightState();
  }

  private applyLightState(): void {
    const on = this.headlightsOn;
    this.headlightLensMaterial.emissiveIntensity = on ? (this.night ? 3.2 : 1.6) : 0;
    this.headlightLensMaterial.color.set(on ? 0xf4f1ea : 0x9a9893);
    for (const s of this.headlights) {
      s.intensity = on ? (this.night ? 140 : 25) : 0;
      s.visible = on;
    }
    this.taillightMaterial.emissiveIntensity = on ? (this.night ? 2.2 : 1.0) : 0.25;
  }

  /** Update wheel visuals. `steerNorm` is −1..1, `spin` the accumulated wheel angle. */
  updateWheels(steerNorm: number, spin: number, maxAngle = 0.5): void {
    for (const w of this.wheels) {
      if (w.front) w.steerPivot.rotation.y = steerNorm * maxAngle;
      w.spin.rotation.x = spin;
    }
  }

  /** Brake lights brighten while braking. */
  setBraking(braking: boolean): void {
    const base = this.headlightsOn ? (this.night ? 2.2 : 1.0) : 0.25;
    this.taillightMaterial.emissiveIntensity = braking ? base + 2.5 : base;
  }
}

function makeBlobTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 64, 4, 32, 64, 62);
  grd.addColorStop(0, 'rgba(0,0,0,0.85)');
  grd.addColorStop(0.55, 'rgba(0,0,0,0.45)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.save();
  g.scale(1, 2);
  g.beginPath();
  g.arc(32, 32, 32, 0, Math.PI * 2);
  g.restore();
  g.fillRect(0, 0, 64, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- body maths

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const bump = (c: number, w: number, x: number) => Math.exp(-(((x - c) / w) ** 2));

/** Half-width of the shell at position z (m), with flared hips over the wheels. */
export function shellHalfWidth(z: number): number {
  const base = 0.84 + 0.07 * bump(FRONT_AXLE, 0.55, z) + 0.11 * bump(REAR_AXLE, 0.6, z);
  // Narrower, rounded nose; squarer tail.
  const nose = 1 - 0.3 * smooth(1.55, HALF_LEN, z);
  const tail = 1 - 0.12 * smooth(-1.7, -HALF_LEN, z);
  return base * nose * tail;
}

/** Top (y) of the shell at z: low nose, rising bonnet, belt line, ducktail. */
function shellTop(z: number): number {
  const bonnet = 0.47 + 0.27 * smooth(HALF_LEN, 0.55, z); // nose → cowl
  const deck = 0.74 + 0.07 * smooth(-0.6, -1.6, z) + 0.05 * bump(-2.0, 0.18, z); // rear deck + ducktail lip
  const t = smooth(0.2, 0.6, z);
  // Fenders crest over the front wheels.
  return (1 - t) * deck + t * bonnet + 0.08 * bump(FRONT_AXLE, 0.42, z) + 0.03 * bump(REAR_AXLE, 0.45, z);
}
const SHELL_BOTTOM = 0.2;
const ARCH_R = WHEEL_R + 0.075;

/** End rounding factor so the loft closes smoothly at nose and tail. */
function endFactor(z: number): number {
  const r = 0.32;
  const d = Math.abs(z) - (HALF_LEN - r);
  if (d <= 0) return 1;
  const k = Math.min(1, d / r);
  return Math.sqrt(Math.max(0, 1 - k * k)) * 0.9 + 0.1 * (1 - k);
}

function superellipse(theta: number, n: number): [number, number] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [Math.sign(c) * Math.abs(c) ** (2 / n), Math.sign(s) * Math.abs(s) ** (2 / n)];
}

/** Point on the shell surface. */
function shellPoint(z: number, theta: number, out: THREE.Vector3): THREE.Vector3 {
  const top = shellTop(z);
  const yc = (top + SHELL_BOTTOM) / 2;
  const hh = (top - SHELL_BOTTOM) / 2;
  const e = endFactor(z);
  const upper = Math.sin(theta) >= 0;
  const [cx, cy] = superellipse(theta, upper ? 2.6 : 4.2);
  // Tumblehome: the upper sides lean inwards.
  const lean = upper ? 1 - 0.1 * Math.max(0, cy) : 1;
  const x = cx * shellHalfWidth(z) * lean * (0.35 + 0.65 * e);
  let y = yc + cy * hh * e;
  if (y < SHELL_BOTTOM) y = SHELL_BOTTOM;
  return out.set(x, y, z);
}

/** Half-width of the shell cross-section at position z and height y (0 if outside). */
function sectionHalfWidthAt(z: number, y: number): number {
  const top = shellTop(z);
  const yc = (top + SHELL_BOTTOM) / 2;
  const hh = (top - SHELL_BOTTOM) / 2;
  const e = endFactor(z);
  const ny = (y - yc) / (hh * e);
  if (Math.abs(ny) >= 1) return 0;
  const n = ny >= 0 ? 2.6 : 4.2;
  const cx = (1 - Math.abs(ny) ** n) ** (1 / n);
  const lean = ny >= 0 ? 1 - 0.1 * Math.abs(ny) ** (2 / n) : 1;
  return cx * shellHalfWidth(z) * lean * (0.35 + 0.65 * e);
}

/** Absolute z of the nose (or tail) surface at height y and lateral offset x. */
function surfaceZ(y: number, x: number, rear = false): number {
  const dir = rear ? -1 : 1;
  for (let d = 0; d < 0.9; d += 0.004) {
    const z = dir * (HALF_LEN - d);
    if (sectionHalfWidthAt(z, y) >= Math.abs(x)) return z;
  }
  return dir * (HALF_LEN - 0.9);
}

function buildShell(): THREE.BufferGeometry {
  const NU = 220;
  const NV = 96;
  const pos: number[] = [];
  const inside: boolean[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= NU; i++) {
    const z = -HALF_LEN + (i / NU) * CAR_LENGTH;
    for (let j = 0; j <= NV; j++) {
      const th = (j / NV) * Math.PI * 2 - Math.PI / 2;
      shellPoint(z, th, p);
      let inArch = false;
      // Wheel arches: side-facing vertices inside a circle around each axle are
      // pulled onto that circle, giving a clean, round arch edge.
      if (Math.abs(Math.cos(th)) > 0.72) {
        for (const za of [FRONT_AXLE, REAR_AXLE]) {
          const dz = p.z - za;
          const dy = p.y - WHEEL_R;
          const d = Math.hypot(dz, dy);
          if (d < ARCH_R) {
            inArch = true;
            const k = ARCH_R / Math.max(d, 1e-4);
            p.z = za + dz * k;
            p.y = WHEEL_R + dy * k;
          }
        }
      }
      pos.push(p.x, p.y, p.z);
      inside.push(inArch);
    }
  }
  // Cockpit opening: skip the top faces between the windscreen and the fairings.
  const inCockpit = (z: number, theta: number) => {
    const c = Math.cos(theta);
    return z > -0.78 && z < 0.56 && Math.sin(theta) > 0.55 && Math.abs(c) < 0.8;
  };
  for (let i = 0; i < NU; i++) {
    const z = -HALF_LEN + ((i + 0.5) / NU) * CAR_LENGTH;
    for (let j = 0; j < NV; j++) {
      const th = ((j + 0.5) / NV) * Math.PI * 2 - Math.PI / 2;
      if (inCockpit(z, th)) continue;
      const a = i * (NV + 1) + j;
      const b = a + NV + 1;
      // A face whose corners were all pulled onto the arch circle lies in the opening.
      if (inside[a] && inside[a + 1] && inside[b] && inside[b + 1]) continue;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Tyre with a rounded sidewall profile, as a lathe around the x axis. */
function buildTyre(r: number, w: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const inner = r * 0.72;
  const steps = 14;
  for (let k = 0; k <= steps; k++) {
    const a = -Math.PI / 2 + (k / steps) * Math.PI;
    // Rounded shoulder: radius (lathe x) and axial position (lathe y).
    pts.push(new THREE.Vector2(r - 0.05 + 0.05 * Math.cos(a), (w / 2) * Math.sin(a)));
  }
  pts.unshift(new THREE.Vector2(inner, -w / 2));
  pts.push(new THREE.Vector2(inner, w / 2));
  const g = new THREE.LatheGeometry(pts, 40);
  g.rotateZ(Math.PI / 2); // lathe axis y → x
  return g;
}

/** Simple rounded box (chamfered via a scaled, smoothed box). */
class RoundedBox extends THREE.BufferGeometry {
  constructor(w: number, h: number, d: number, r: number) {
    super();
    const g = new THREE.BoxGeometry(w, h, d, 4, 4, 4);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    const hw = w / 2 - r;
    const hh = h / 2 - r;
    const hd = d / 2 - r;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const c = new THREE.Vector3(Math.max(-hw, Math.min(hw, v.x)), Math.max(-hh, Math.min(hh, v.y)), Math.max(-hd, Math.min(hd, v.z)));
      const n = v.clone().sub(c);
      if (n.lengthSq() > 0) n.setLength(r);
      p.setXYZ(i, c.x + n.x, c.y + n.y, c.z + n.z);
    }
    g.computeVertexNormals();
    this.copy(g);
    g.dispose();
  }
}
