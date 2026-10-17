/**
 * Track rules that act on the pure car state: surfaces, barrier collisions,
 * stuck detection and safe resets. No Three.js dependency.
 */
import { TrackPath } from './track-path.js';
import { CarState, Surface, speedOf } from './physics.js';

/** Half of the 12 m wide circuit tarmac (two 6 m racing lanes). */
export const ROAD_HALF_WIDTH = 6;
export const KERB_WIDTH = 1.1;
/** Inner face of the barrier wall, measured from the centre line. */
export const BARRIER_OFFSET = 17;
export const CAR_HALF_WIDTH = 0.95;
/** Scenery is placed at least this far from the centre line. */
export const SCENERY_CLEARANCE = 32;

export interface RuleResult {
  surface: Surface;
  index: number;
  lateral: number;
  /** Speed (m/s) lost into the wall this step; 0 when no contact. */
  impact: number;
  contact: boolean;
}

export class TrackRules {
  private hint = -1;
  private stuckTime = 0;

  constructor(readonly track: TrackPath) {}

  /** Classify surface and resolve barrier contact. Mutates the car state. */
  apply(car: CarState): RuleResult {
    const near = this.track.nearest(car.x, car.z, this.hint);
    this.hint = near.index;
    const sample = this.track.sample(near.index);
    const abs = Math.abs(near.lateral);
    const surface: Surface = abs <= ROAD_HALF_WIDTH + KERB_WIDTH ? 'road' : 'grass';
    let impact = 0;
    let contact = false;
    const limit = BARRIER_OFFSET - CAR_HALF_WIDTH;
    if (abs > limit) {
      contact = true;
      // Outward unit normal of the wall the car is touching.
      const side = Math.sign(near.lateral) || 1;
      const ox = sample.nx * side;
      const oz = sample.nz * side;
      // Push the car back inside.
      const push = abs - limit;
      car.x -= ox * push;
      car.z -= oz * push;
      // Remove (and slightly reflect) the velocity going into the wall.
      const vn = car.vx * ox + car.vz * oz;
      if (vn > 0) {
        const restitution = 0.25;
        car.vx -= (1 + restitution) * vn * ox;
        car.vz -= (1 + restitution) * vn * oz;
        impact = vn;
      }
      // Scraping friction along the wall.
      car.vx *= 0.985;
      car.vz *= 0.985;
      car.cruiseOn = false;
    }
    return { surface, index: near.index, lateral: near.lateral, impact, contact };
  }

  /**
   * Detects a car that cannot make progress (pinned against a barrier with the
   * accelerator held) or that has somehow left the playable area.
   */
  needsRecovery(car: CarState, result: RuleResult, throttle: number, dt: number): boolean {
    if (!Number.isFinite(car.x) || !Number.isFinite(car.z) || !Number.isFinite(car.vx) || !Number.isFinite(car.vz)) {
      return true;
    }
    if (Math.abs(result.lateral) > BARRIER_OFFSET + 3) return true;
    if (result.contact && throttle > 0.5 && speedOf(car) < 0.8) {
      this.stuckTime += dt;
    } else {
      this.stuckTime = Math.max(0, this.stuckTime - dt * 2);
    }
    if (this.stuckTime > 3) {
      this.stuckTime = 0;
      return true;
    }
    return false;
  }

  /** Place the car on the centre line nearest to it, facing the direction of travel. */
  resetCar(car: CarState, index?: number): number {
    const i = index ?? this.track.nearest(car.x, car.z).index;
    const s = this.track.sample(i);
    car.x = s.x;
    car.z = s.z;
    car.heading = this.track.headingAt(i);
    car.vx = 0;
    car.vz = 0;
    car.steer = 0;
    car.yawRate = 0;
    car.slip = 0;
    car.gear = 'D';
    car.cruiseOn = false;
    this.hint = i;
    this.stuckTime = 0;
    return i;
  }
}
