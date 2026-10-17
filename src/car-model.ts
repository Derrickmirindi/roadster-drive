/**
 * Original, procedurally built open-top roadster ("GR-1").
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

export const CAR_LENGTH = 4.3;
export const CAR_WIDTH = 1.86;
const WHEEL_R = 0.34;
const WHEEL_W = 0.27;
const FRONT_AXLE = 1.3;
const REAR_AXLE = -1.25;
const TRACK_HALF = 0.79;

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

    // --- Body shell: a side profile extruded across the width, with soft bevels.
    // Long bonnet, low cowl, short rear deck that kicks up into a ducktail.
    const profile = new THREE.Shape();
    profile.moveTo(-2.06, 0.25);
    profile.lineTo(1.9, 0.25);
    profile.quadraticCurveTo(2.2, 0.27, 2.19, 0.42);
    profile.quadraticCurveTo(2.16, 0.58, 1.82, 0.63);
    profile.bezierCurveTo(1.3, 0.7, 0.85, 0.8, 0.45, 0.83);
    profile.lineTo(-0.55, 0.85);
    profile.bezierCurveTo(-1.15, 0.87, -1.8, 0.9, -2.06, 0.95);
    profile.quadraticCurveTo(-2.2, 0.9, -2.18, 0.62);
    profile.lineTo(-2.16, 0.36);
    profile.quadraticCurveTo(-2.14, 0.25, -2.06, 0.25);
    const bevel = 0.13;
    const bodyGeo = new THREE.ExtrudeGeometry(profile, {
      depth: CAR_WIDTH - bevel * 2,
      bevelEnabled: true,
      bevelThickness: bevel,
      bevelSize: 0.1,
      bevelSegments: 6,
      curveSegments: 12,
    });
    // Shape lies in (x, y); extrusion goes along +z. Map shape-x → car z, extrusion → car x.
    bodyGeo.translate(0, 0, -(CAR_WIDTH - bevel * 2) / 2);
    bodyGeo.rotateY(-Math.PI / 2);
    bodyGeo.computeVertexNormals();
    add(new THREE.Mesh(bodyGeo, this.bodyMaterial));

    // Lower sill / side intakes in charcoal to break up the slab sides.
    for (const side of [-1, 1]) {
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 2.0), this.trimMaterial);
      sill.position.set(side * (CAR_WIDTH / 2 + 0.005), 0.36, 0.02);
      add(sill, false);
      const intake = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.5), interiorMaterial);
      intake.position.set(side * (CAR_WIDTH / 2 + 0.01), 0.58, -0.55);
      add(intake, false);
    }

    // Front splitter, grille and rear diffuser.
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.3), this.trimMaterial);
    splitter.position.set(0, 0.2, 2.12);
    add(splitter);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 0.06), interiorMaterial);
    grille.position.set(0, 0.36, 2.29);
    add(grille, false);
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 0.2), this.trimMaterial);
    diffuser.position.set(0, 0.3, -2.27);
    add(diffuser);
    const exhaustGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.14, 14);
    exhaustGeo.rotateX(Math.PI / 2);
    for (const side of [-1, 1]) {
      const pipe = new THREE.Mesh(exhaustGeo, this.trimMaterial);
      pipe.position.set(side * 0.32, 0.3, -2.36);
      add(pipe, false);
    }

    // --- Open cockpit.
    const tub = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.06, 1.25), interiorMaterial);
    tub.position.set(0, 0.95, -0.15);
    add(tub, false);
    for (const side of [-1, 1]) {
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.5), seatMaterial);
      cushion.position.set(side * 0.33, 0.98, -0.12);
      add(cushion);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.48, 0.1), seatMaterial);
      back.position.set(side * 0.33, 1.17, -0.45);
      back.rotation.x = -0.2;
      add(back);
      // Headrest fairings behind each seat, in body colour.
      const fairing = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.75, 6, 12), this.bodyMaterial);
      fairing.rotation.x = Math.PI / 2;
      fairing.scale.set(1, 1, 0.9);
      fairing.position.set(side * 0.33, 0.98, -1.0);
      add(fairing);
      // Roll hoop.
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 18, Math.PI), this.trimMaterial);
      hoop.position.set(side * 0.33, 1.15, -0.62);
      add(hoop);
    }
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 8, 20), this.trimMaterial);
    wheel.position.set(0.33, 1.13, 0.3);
    wheel.rotation.x = -0.45;
    add(wheel);

    // Windscreen with frame.
    const screen = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.4, 0.02), this.glassMaterial);
    screen.position.set(0, 1.04, 0.52);
    screen.rotation.x = -0.62;
    screen.renderOrder = 2;
    this.root.add(screen);
    const frameTop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.035, 0.04), this.trimMaterial);
    frameTop.position.set(0, 1.2, 0.4);
    add(frameTop);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.42, 0.04), this.trimMaterial);
      post.position.set(side * 0.74, 1.04, 0.52);
      post.rotation.x = -0.62;
      add(post);
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.06), this.bodyMaterial);
      mirror.position.set(side * 0.98, 0.98, 0.5);
      add(mirror);
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.02, 0.03), this.trimMaterial);
      stalk.position.set(side * 0.86, 0.94, 0.52);
      add(stalk, false);
    }

    // --- Lights: slim angled headlamp strips and a full-width rear light bar.
    for (const side of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.08), this.headlightLensMaterial);
      lamp.position.set(side * 0.6, 0.57, 2.19);
      lamp.rotation.set(0.35, side * 0.22, 0);
      add(lamp, false);
    }
    const tailBar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 0.04), this.taillightMaterial);
    tailBar.position.set(0, 0.76, -2.3);
    add(tailBar, false);

    // Headlight beams: real spot lights, so they visibly light the road at night.
    for (const side of [-1, 1]) {
      const spot = new THREE.SpotLight(0xfff1d6, 0, 70, 0.42, 0.55, 1.2);
      spot.position.set(side * 0.6, 0.62, 2.25);
      spot.target.position.set(side * 0.9, 0, 14);
      spot.castShadow = false;
      this.root.add(spot);
      this.root.add(spot.target);
      this.headlights.push(spot);
    }

    // --- Wheels with arches, discs and calipers.
    const tyreGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, WHEEL_W, 28, 1);
    tyreGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(WHEEL_R * 0.68, WHEEL_R * 0.68, WHEEL_W + 0.01, 24, 1, true);
    rimGeo.rotateZ(Math.PI / 2);
    const hubGeo = new THREE.CylinderGeometry(0.06, 0.06, WHEEL_W + 0.03, 12);
    hubGeo.rotateZ(Math.PI / 2);
    const spokeGeo = new THREE.BoxGeometry(0.035, WHEEL_R * 1.3, 0.05);
    const discGeo = new THREE.CylinderGeometry(WHEEL_R * 0.55, WHEEL_R * 0.55, 0.03, 24);
    discGeo.rotateZ(Math.PI / 2);
    const archGeo = new THREE.TorusGeometry(WHEEL_R + 0.07, 0.045, 6, 20, Math.PI);

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
        const rim = new THREE.Mesh(rimGeo, this.wheelMaterial);
        spin.add(rim);
        const hub = new THREE.Mesh(hubGeo, this.wheelMaterial);
        spin.add(hub);
        for (let k = 0; k < 5; k++) {
          const spoke = new THREE.Mesh(spokeGeo, this.wheelMaterial);
          spoke.position.x = side * (WHEEL_W / 2 - 0.02);
          spoke.rotation.x = (k / 5) * Math.PI;
          spin.add(spoke);
        }
        // Non-rotating parts live on the steer pivot.
        const disc = new THREE.Mesh(discGeo, discMaterial);
        disc.position.x = -side * 0.02;
        steerPivot.add(disc);
        const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.16), caliperMaterial);
        caliper.position.set(side * 0.02, 0.1, front ? -0.08 : 0.08);
        steerPivot.add(caliper);
        this.wheels.push({ steerPivot, spin, front });

        const arch = new THREE.Mesh(archGeo, this.trimMaterial);
        arch.position.set(side * (CAR_WIDTH / 2 - 0.02), WHEEL_R, z);
        arch.rotation.y = Math.PI / 2;
        arch.scale.set(1, 1, 1.6);
        add(arch, false);
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
