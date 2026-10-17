/**
 * Procedural vehicle bodies for the Stunt Lab, plus the shared fan-and-jet rig.
 * Every model is generated from primitives at runtime (no external models).
 * Local axes: +z forward, +y up, origin on the ground under the body centre.
 */
import * as THREE from 'three';
import { CarModel } from './car-model.js';
import type { VehicleSpec } from './stunt-sim.js';

export interface VehicleVisual {
  root: THREE.Group;
  /** Body materials made translucent in cutaway view. */
  shell: THREE.Material[];
  rig: THREE.Group;
  fans: THREE.Object3D[];
  flames: THREE.Mesh[];
  wheels: THREE.Object3D[];
  dispose(): void;
}

const tyreMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.9 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.7 });
const metalMat = new THREE.MeshStandardMaterial({ color: 0x9a9da3, roughness: 0.35, metalness: 0.8 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x8fa3b0, roughness: 0.1, transparent: true, opacity: 0.45 });

function box(w: number, h: number, l: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function wheel(r: number, w: number, x: number, z: number, rim: THREE.Material = metalMat): THREE.Group {
  const g = new THREE.Group();
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 20), tyreMat);
  t.rotation.z = Math.PI / 2;
  t.castShadow = true;
  g.add(t);
  const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.01, 14), rim);
  h.rotation.z = Math.PI / 2;
  g.add(h);
  g.position.set(x, r, z);
  return g;
}

function body(spec: VehicleSpec): { group: THREE.Group; shell: THREE.Material[]; wheels: THREE.Object3D[] } {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.4, metalness: 0.2 });
  const shell: THREE.Material[] = [paint];
  const wheels: THREE.Object3D[] = [];
  const L = spec.length;
  const W = spec.width;
  const H = spec.height;
  const addWheels = (r: number, w: number, zs: number[], halfTrack: number, dual = false) => {
    for (const z of zs)
      for (const s of [-1, 1]) {
        const wh = wheel(r, w, s * halfTrack, z);
        g.add(wh);
        wheels.push(wh);
        if (dual) {
          const w2 = wheel(r, w, s * (halfTrack - w - 0.02), z);
          g.add(w2);
          wheels.push(w2);
        }
      }
  };
  switch (spec.id) {
    case 'f1': {
      g.add(box(0.8, 0.45, L * 0.75, paint, 0, 0.42, -0.1));
      g.add(box(0.5, 0.3, 1.2, paint, 0, 0.35, L * 0.36));
      g.add(box(W * 0.9, 0.06, 0.5, darkMat, 0, 0.2, L / 2 - 0.25)); // front wing
      g.add(box(W * 0.75, 0.06, 0.4, darkMat, 0, 0.95, -L / 2 + 0.3)); // rear wing
      g.add(box(0.06, 0.6, 0.3, darkMat, 0, 0.65, -L / 2 + 0.35));
      g.add(box(1.4, 0.35, 1.6, paint, 0, 0.35, -0.4)); // sidepods
      g.add(box(0.35, 0.3, 0.5, darkMat, 0, 0.75, 0.2)); // cockpit
      addWheels(0.33, 0.38, [L * 0.32, -L * 0.3], W / 2 - 0.2);
      break;
    }
    case 'tricycle': {
      g.add(box(0.06, 0.06, 0.9, metalMat, 0, 0.45, 0));
      g.add(box(0.5, 0.06, 0.06, metalMat, 0, 0.3, -0.4));
      g.add(box(0.3, 0.08, 0.25, paint, 0, 0.55, -0.15)); // seat
      g.add(box(0.05, 0.4, 0.05, metalMat, 0, 0.6, 0.45));
      g.add(box(0.45, 0.04, 0.04, darkMat, 0, 0.8, 0.45));
      const fw = wheel(0.3, 0.06, 0, 0.45, paint);
      g.add(fw);
      wheels.push(fw);
      for (const s of [-1, 1]) {
        const w = wheel(0.18, 0.05, s * 0.26, -0.4, paint);
        g.add(w);
        wheels.push(w);
      }
      break;
    }
    case 'moped':
    case 'motorcycle': {
      const big = spec.id === 'motorcycle';
      const r = big ? 0.33 : 0.25;
      g.add(box(0.3, 0.35, L * 0.55, paint, 0, r + 0.25, 0));
      g.add(box(0.3, 0.1, 0.6, darkMat, 0, r + 0.5, -0.2)); // seat
      g.add(box(0.06, 0.55, 0.06, metalMat, 0, r + 0.4, L / 2 - 0.35));
      g.add(box(0.7, 0.04, 0.04, darkMat, 0, r + 0.68, L / 2 - 0.35));
      if (big) g.add(box(0.36, 0.3, 0.5, paint, 0, r + 0.45, 0.25)); // tank
      for (const z of [L / 2 - r, -L / 2 + r]) {
        const w = wheel(r, 0.12, 0, z);
        g.add(w);
        wheels.push(w);
      }
      break;
    }
    case 'kart': {
      g.add(box(1.0, 0.08, L * 0.85, metalMat, 0, 0.16, 0));
      g.add(box(0.5, 0.35, 0.45, paint, 0, 0.35, -0.2)); // seat
      g.add(box(0.8, 0.2, 0.3, paint, 0, 0.22, L / 2 - 0.2)); // nose
      g.add(box(0.05, 0.3, 0.05, darkMat, 0, 0.35, 0.35));
      addWheels(0.14, 0.18, [L * 0.33, -L * 0.33], W / 2 - 0.1);
      break;
    }
    case 'cart': {
      const wire = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.3, metalness: 0.9, wireframe: true });
      shell.push(wire);
      const basket = new THREE.Mesh(new THREE.BoxGeometry(W, 0.55, L * 0.85, 4, 3, 6), wire);
      basket.position.set(0, 0.75, 0.05);
      g.add(basket);
      g.add(box(W, 0.04, 0.04, darkMat, 0, 1.0, -L / 2 + 0.02)); // handle
      g.add(box(0.04, 0.4, L * 0.8, metalMat, -W / 2 + 0.05, 0.3, 0));
      g.add(box(0.04, 0.4, L * 0.8, metalMat, W / 2 - 0.05, 0.3, 0));
      addWheels(0.06, 0.04, [L * 0.35, -L * 0.35], W / 2 - 0.06);
      break;
    }
    case 'golf': {
      g.add(box(W, 0.45, L, paint, 0, 0.45, 0));
      g.add(box(W * 0.9, 0.35, 0.5, darkMat, 0, 0.85, -0.2)); // bench
      g.add(box(W, 0.06, L * 0.75, paint, 0, H - 0.03, -0.1)); // roof
      for (const sx of [-1, 1])
        for (const z of [L * 0.25, -L * 0.45]) g.add(box(0.05, H - 0.65, 0.05, metalMat, sx * (W / 2 - 0.05), 0.65 + (H - 0.65) / 2, z));
      g.add(box(W * 0.9, 0.5, 0.03, glassMat, 0, 1.15, L * 0.27));
      addWheels(0.22, 0.18, [L * 0.33, -L * 0.33], W / 2 - 0.08);
      break;
    }
    case 'compact': {
      g.add(box(W, 0.7, L, paint, 0, 0.6, 0));
      g.add(box(W * 0.88, 0.6, L * 0.55, paint, 0, 1.2, -0.2));
      g.add(box(W * 0.89, 0.45, L * 0.5, glassMat, 0, 1.2, -0.2));
      addWheels(0.31, 0.2, [L * 0.32, -L * 0.32], W / 2 - 0.12);
      break;
    }
    case 'pickup': {
      g.add(box(W, 0.8, L, paint, 0, 0.85, 0));
      g.add(box(W * 0.95, 0.75, L * 0.35, paint, 0, 1.6, 0.6));
      g.add(box(W * 0.96, 0.5, L * 0.3, glassMat, 0, 1.62, 0.6));
      g.add(box(W * 0.9, 0.05, L * 0.4, darkMat, 0, 1.26, -L * 0.28)); // bed floor
      addWheels(0.42, 0.3, [L * 0.33, -L * 0.3], W / 2 - 0.15);
      break;
    }
    case 'van': {
      g.add(box(W, H - 0.4, L * 0.75, paint, 0, 0.4 + (H - 0.4) / 2, -L * 0.12));
      g.add(box(W, 1.3, L * 0.25, paint, 0, 1.05, L * 0.375));
      g.add(box(W * 0.96, 0.6, 0.05, glassMat, 0, 1.7, L * 0.25 + 0.02));
      g.add(box(0.03, 0.4, L * 0.6, new THREE.MeshStandardMaterial({ color: 0xe0251b }), W / 2 + 0.01, 1.4, -L * 0.15));
      addWheels(0.4, 0.28, [L * 0.33, -L * 0.3], W / 2 - 0.15);
      break;
    }
    case 'bus': {
      g.add(box(W, H - 0.45, L, paint, 0, 0.45 + (H - 0.45) / 2, 0));
      g.add(box(W + 0.02, 0.7, L * 0.85, glassMat, 0, 2.3, -0.3));
      g.add(box(W + 0.03, 0.08, L, darkMat, 0, 1.6, 0));
      g.add(box(W * 0.95, 0.9, 0.04, glassMat, 0, 2.3, L / 2 + 0.01));
      addWheels(0.5, 0.35, [L * 0.33, -L * 0.3], W / 2 - 0.2);
      break;
    }
    case 'semi': {
      const trailer = new THREE.MeshStandardMaterial({ color: 0xe7e3dc, roughness: 0.6 });
      shell.push(trailer);
      g.add(box(W, H - 1.25, L * 0.74, trailer, 0, 1.25 + (H - 1.25) / 2, -L * 0.13));
      g.add(box(W, 2.6, 2.4, paint, 0, 0.6 + 1.3, L / 2 - 1.2)); // cab
      g.add(box(W * 0.95, 0.8, 0.05, glassMat, 0, 2.5, L / 2 + 0.01));
      g.add(box(W * 0.8, 0.3, 2.0, darkMat, 0, 1.0, L / 2 - 3.4)); // chassis
      addWheels(0.52, 0.3, [L / 2 - 1.0], W / 2 - 0.2);
      addWheels(0.52, 0.3, [L / 2 - 3.5, L / 2 - 4.7, -L / 2 + 1.6, -L / 2 + 2.8], W / 2 - 0.2, true);
      break;
    }
    default: {
      g.add(box(W, H * 0.6, L, paint, 0, H * 0.4, 0));
      addWheels(0.3, 0.2, [L * 0.33, -L * 0.33], W / 2 - 0.1);
    }
  }
  return { group: g, shell, wheels };
}

/** The shared rig: two air tanks, two extractor fans and lift/roll jets, sized to the body footprint. */
function buildRig(spec: VehicleSpec, floorY: number): { rig: THREE.Group; fans: THREE.Object3D[]; flames: THREE.Mesh[] } {
  const rig = new THREE.Group();
  const fans: THREE.Object3D[] = [];
  const flames: THREE.Mesh[] = [];
  const W = Math.max(spec.width, 0.8);
  const L = Math.max(spec.length, 1.2);
  const tankMat = new THREE.MeshStandardMaterial({ color: 0x6fb7d6, roughness: 0.35, metalness: 0.5, emissive: 0x0d2a36 });
  const fanMat = new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.4, metalness: 0.6 });
  const tankR = Math.min(0.22, W * 0.14);
  const tankL = Math.min(L * 0.45, 2.4);
  for (const s of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.CapsuleGeometry(tankR, tankL, 4, 12), tankMat);
    t.rotation.x = Math.PI / 2;
    t.position.set(s * W * 0.22, floorY + tankR + 0.05, -L * 0.08);
    rig.add(t);
  }
  const fanR = Math.min(0.32, W * 0.2);
  for (const z of [L * 0.18, -L * 0.3]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(fanR, 0.03, 6, 24), fanMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, Math.max(0.12, floorY - 0.05), z);
    rig.add(ring);
    const blades = new THREE.Group();
    for (let k = 0; k < 5; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(fanR * 1.8, 0.01, 0.07), fanMat);
      b.rotation.y = (k / 5) * Math.PI;
      blades.add(b);
    }
    blades.position.copy(ring.position);
    rig.add(blades);
    fans.push(blades);
  }
  const jetMat = new THREE.MeshStandardMaterial({ color: 0x3a3b3f, roughness: 0.4, metalness: 0.7 });
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xbfe6f5, transparent: true, opacity: 0.75, depthWrite: false });
  for (const sx of [-1, 1])
    for (const z of [L * 0.38, -L * 0.38]) {
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.16, 10), jetMat);
      nozzle.position.set(sx * W * 0.38, Math.max(0.1, floorY - 0.05), z);
      rig.add(nozzle);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.6, 12, 1, true), flameMat);
      flame.rotation.x = Math.PI; // point down
      flame.position.set(nozzle.position.x, nozzle.position.y - 0.85, z);
      flame.visible = false;
      flames.push(flame);
      // Flames are added to the vehicle root so they show without cutaway.
    }
  return { rig, fans, flames };
}

export function buildVehicleVisual(spec: VehicleSpec, roadster?: CarModel): VehicleVisual {
  const root = new THREE.Group();
  let shell: THREE.Material[];
  let wheels: THREE.Object3D[];
  let floorY = 0.35;
  if (spec.id === 'roadster' && roadster) {
    root.add(roadster.root);
    shell = [roadster.bodyMaterial, roadster.trimMaterial];
    wheels = roadster.wheels.map((w) => w.spin);
    floorY = 0.3;
  } else {
    const b = body(spec);
    root.add(b.group);
    shell = b.shell;
    wheels = b.wheels;
    floorY = spec.id === 'semi' || spec.id === 'bus' ? 0.9 : spec.id === 'cart' || spec.id === 'tricycle' ? 0.3 : 0.35;
  }
  const { rig, fans, flames } = buildRig(spec, floorY);
  rig.visible = false;
  root.add(rig);
  for (const f of flames) root.add(f);
  return {
    root,
    shell,
    rig,
    fans,
    flames,
    wheels,
    dispose() {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry && !(roadster && isDescendant(o, roadster.root))) m.geometry.dispose();
      });
      if (roadster) root.remove(roadster.root);
    },
  };
}

function isDescendant(o: THREE.Object3D, parent: THREE.Object3D): boolean {
  let p: THREE.Object3D | null = o;
  while (p) {
    if (p === parent) return true;
    p = p.parent;
  }
  return false;
}
