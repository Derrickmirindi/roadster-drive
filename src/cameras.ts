/**
 * Camera rig: showroom orbit, chase, hood and overhead views, with smooth
 * blended transitions (instant when reduced motion is requested).
 */
import * as THREE from 'three';

export type CameraMode = 'orbit' | 'chase' | 'hood' | 'overhead';
export const DRIVE_CAMERAS: CameraMode[] = ['chase', 'hood', 'overhead'];
export const CAMERA_LABELS: Record<CameraMode, string> = {
  orbit: 'Orbit',
  chase: 'Chase',
  hood: 'Hood',
  overhead: 'Overhead',
};

export interface CarPose {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

export interface CameraOptions {
  shake: boolean;
  speedFov: boolean;
  reducedMotion: boolean;
}

const BASE_FOV = 55;
const ORBIT_MIN_DIST = 4.2;
const ORBIT_MAX_DIST = 11;
const ORBIT_MIN_PITCH = 0.08;
const ORBIT_MAX_PITCH = 1.3;

const damp = (current: number, target: number, rate: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-rate * dt));

function dampAngle(current: number, target: number, rate: number, dt: number): number {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return current + d * (1 - Math.exp(-rate * dt));
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'orbit';
  orbitYaw = Math.PI * 0.78;
  orbitPitch = 0.32;
  orbitDist = 7.2;

  private smoothHeading = 0;
  private chasePos = new THREE.Vector3();
  private chaseInit = false;
  private blendT = 1;
  private blendDur = 0.7;
  private fromPos = new THREE.Vector3();
  private fromQuat = new THREE.Quaternion();
  private shakeAmount = 0;
  private shakeSeed = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  /** A camera-type helper so lookAt() uses camera orientation (looking down −z). */
  private readonly helper = new THREE.PerspectiveCamera();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.1, 2000);
  }

  /** Whether a transition is still animating (so the render loop must keep running). */
  get animating(): boolean {
    return this.blendT < 1;
  }

  setMode(mode: CameraMode, reducedMotion: boolean): void {
    if (mode === this.mode) return;
    this.fromPos.copy(this.camera.position);
    this.fromQuat.copy(this.camera.quaternion);
    this.mode = mode;
    this.blendT = reducedMotion ? 1 : 0;
    this.chaseInit = false;
  }

  orbitBy(dYaw: number, dPitch: number): void {
    this.orbitYaw += dYaw;
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + dPitch, ORBIT_MIN_PITCH, ORBIT_MAX_PITCH);
  }

  zoomBy(factor: number): void {
    this.orbitDist = THREE.MathUtils.clamp(this.orbitDist * factor, ORBIT_MIN_DIST, ORBIT_MAX_DIST);
  }

  addShake(amount: number): void {
    this.shakeAmount = Math.min(0.6, this.shakeAmount + amount);
  }

  update(dt: number, car: CarPose, opts: CameraOptions): void {
    const cam = this.camera;
    const sin = Math.sin(car.heading);
    const cos = Math.cos(car.heading);
    this.smoothHeading = this.chaseInit ? dampAngle(this.smoothHeading, car.heading, 5, dt) : car.heading;

    // Compute the target pose for the current mode in `helper`.
    const h = this.helper;
    h.up.set(0, 1, 0);
    let fov = BASE_FOV;
    switch (this.mode) {
      case 'orbit': {
        const cp = Math.cos(this.orbitPitch);
        h.position.set(
          car.x + Math.sin(this.orbitYaw) * cp * this.orbitDist,
          0.6 + Math.sin(this.orbitPitch) * this.orbitDist,
          car.z + Math.cos(this.orbitYaw) * cp * this.orbitDist,
        );
        this.look.set(car.x, 0.62, car.z);
        break;
      }
      case 'chase': {
        const sh = Math.sin(this.smoothHeading);
        const ch = Math.cos(this.smoothHeading);
        const dist = 6.4 + Math.min(car.speed, 60) * 0.02;
        this.tmp.set(car.x - sh * dist, 2.35, car.z - ch * dist);
        if (!this.chaseInit) this.chasePos.copy(this.tmp);
        else this.chasePos.set(damp(this.chasePos.x, this.tmp.x, 9, dt), damp(this.chasePos.y, this.tmp.y, 9, dt), damp(this.chasePos.z, this.tmp.z, 9, dt));
        h.position.copy(this.chasePos);
        this.look.set(car.x + sin * 3.5, 0.95, car.z + cos * 3.5);
        if (opts.speedFov && !opts.reducedMotion) fov = BASE_FOV + Math.min(12, car.speed * 0.17);
        break;
      }
      case 'hood': {
        // Just above the windscreen header, looking down the bonnet.
        h.position.set(car.x + sin * 0.55, 1.38, car.z + cos * 0.55);
        this.look.set(car.x + sin * 20, 0.6, car.z + cos * 20);
        fov = 62;
        break;
      }
      case 'overhead': {
        h.position.set(car.x - sin * 8, 46, car.z - cos * 8);
        this.look.set(car.x + sin * 6, 0, car.z + cos * 6);
        h.up.set(sin, 0, cos); // forward is "up" on screen
        fov = 50;
        break;
      }
    }
    this.chaseInit = true;

    // Camera shake (collisions / rough surface), optional.
    if (opts.shake && !opts.reducedMotion && this.shakeAmount > 0.001 && this.mode !== 'orbit') {
      this.shakeSeed += dt * 60;
      const a = this.shakeAmount;
      h.position.x += (Math.sin(this.shakeSeed * 1.7) + Math.sin(this.shakeSeed * 3.1)) * 0.06 * a;
      h.position.y += Math.sin(this.shakeSeed * 2.3) * 0.08 * a;
    }
    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 1.8);

    // Never dip below the ground.
    h.position.y = Math.max(h.position.y, 0.45);
    h.lookAt(this.look);

    if (this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / this.blendDur);
      const t = this.blendT;
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      cam.position.lerpVectors(this.fromPos, h.position, e);
      cam.quaternion.slerpQuaternions(this.fromQuat, h.quaternion, e);
    } else {
      cam.position.copy(h.position);
      cam.quaternion.copy(h.quaternion);
    }
    const newFov = this.mode === 'chase' ? damp(cam.fov, fov, 4, dt) : fov;
    if (Math.abs(newFov - cam.fov) > 0.01) {
      cam.fov = newFov;
      cam.updateProjectionMatrix();
    }
  }
}
