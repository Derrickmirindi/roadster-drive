/**
 * Arcade vehicle model (pure TypeScript, no Three.js), stepped at a fixed timestep.
 *
 * This is an ARCADE simulation, not a validated vehicle-dynamics model. It uses:
 *  - longitudinal acceleration with a tapering power curve, braking, rolling
 *    resistance and quadratic aerodynamic drag;
 *  - kinematic "bicycle" yaw with steering authority that shrinks with speed;
 *  - exponential decay of sideways velocity ("grip"), reduced by the handbrake
 *    so the rear can slide.
 *
 * Units: metres, seconds, radians. Speeds are in m/s.
 * Heading θ = 0 faces +z; forward = (sin θ, cos θ); positive yaw turns left.
 */

export type Gear = 'D' | 'R';
export type Surface = 'road' | 'grass';

export interface CarInput {
  /** 0..1 accelerator. */
  throttle: number;
  /** 0..1 service brake. */
  brake: number;
  /** −1 (right) .. +1 (left). */
  steer: number;
  handbrake: boolean;
}

export interface CarParams {
  maxAccel: number; // m/s² at standstill
  topSpeed: number; // m/s absolute mechanical cap in D
  reverseTopSpeed: number; // m/s
  brakeDecel: number; // m/s²
  handbrakeDecel: number; // m/s²
  rollingResistance: number; // m/s²
  dragCoeff: number; // 1/m  (decel = k·v²)
  limiterDecel: number; // m/s² when above the user speed limit
  wheelBase: number; // m
  maxSteerAngle: number; // rad at standstill
  steerFalloffSpeed: number; // m/s — steering halves at this speed
  steerRate: number; // 1/s, input smoothing toward a larger angle
  steerReturnRate: number; // 1/s, smoothing back toward centre
  grip: number; // 1/s lateral velocity decay on tarmac
  handbrakeGrip: number; // 1/s
  grassDrag: number; // m/s² extra on grass
  grassGripFactor: number; // multiplier on grip
  cruiseMaxThrottle: number; // 0..1
  maxLateralAccel: number; // m/s² — caps yaw rate so steering calms down at speed
}

export const DEFAULT_PARAMS: CarParams = {
  maxAccel: 8.5,
  topSpeed: 75, // 270 km/h
  reverseTopSpeed: 8.4, // ~30 km/h
  brakeDecel: 13,
  handbrakeDecel: 5,
  rollingResistance: 0.22,
  dragCoeff: 0.00042,
  limiterDecel: 2.5,
  wheelBase: 2.55,
  maxSteerAngle: 0.56,
  steerFalloffSpeed: 14,
  steerRate: 3.2,
  steerReturnRate: 5.5,
  grip: 11,
  handbrakeGrip: 1.4,
  grassDrag: 3.2,
  grassGripFactor: 0.55,
  cruiseMaxThrottle: 0.55,
  maxLateralAccel: 13,
};

export interface CarState {
  x: number;
  z: number;
  heading: number;
  vx: number;
  vz: number;
  /** Smoothed steering position, −1..1. */
  steer: number;
  gear: Gear;
  yawRate: number;
  /** Absolute sideways sliding speed (m/s), useful for audio/visuals. */
  slip: number;
  /** Accumulated wheel rotation (rad) for rendering. */
  wheelSpin: number;
  cruiseOn: boolean;
  cruiseTarget: number; // m/s
}

export interface StepEnv {
  /** User-selected maximum forward speed (m/s). */
  speedLimit: number;
  surface: Surface;
}

export const WHEEL_RADIUS = 0.34;
/** Gear changes are only accepted below this speed (m/s ≈ 2 km/h). */
export const GEAR_CHANGE_MAX_SPEED = 0.56;
/** Cruise control can only be engaged at or above this speed (m/s ≈ 20 km/h). */
export const CRUISE_MIN_SPEED = 5.56;

export function createCarState(x = 0, z = 0, heading = 0): CarState {
  return {
    x,
    z,
    heading,
    vx: 0,
    vz: 0,
    steer: 0,
    gear: 'D',
    yawRate: 0,
    slip: 0,
    wheelSpin: 0,
    cruiseOn: false,
    cruiseTarget: 0,
  };
}

export function speedOf(s: CarState): number {
  return Math.hypot(s.vx, s.vz);
}

/** Signed speed along the car's heading (positive = forwards). */
export function forwardSpeed(s: CarState): number {
  return s.vx * Math.sin(s.heading) + s.vz * Math.cos(s.heading);
}

/** Try to select a gear. Returns false (and changes nothing) if the car is moving. */
export function requestGear(s: CarState, gear: Gear): boolean {
  if (s.gear === gear) return true;
  if (speedOf(s) > GEAR_CHANGE_MAX_SPEED) return false;
  s.gear = gear;
  s.cruiseOn = false;
  return true;
}

/** Engage cruise at the current speed. Returns false when conditions are not met. */
export function engageCruise(s: CarState, speedLimit: number): boolean {
  const f = forwardSpeed(s);
  if (s.gear !== 'D' || f < CRUISE_MIN_SPEED) return false;
  s.cruiseOn = true;
  s.cruiseTarget = Math.min(f, speedLimit);
  return true;
}

const approach = (value: number, target: number, maxDelta: number) =>
  value < target ? Math.min(value + maxDelta, target) : Math.max(value - maxDelta, target);

/** Reduce |v| by `amount` without crossing zero. */
const decelToward0 = (v: number, amount: number) => (v > 0 ? Math.max(0, v - amount) : Math.min(0, v + amount));

export interface StepEvents {
  cruiseDisengaged: boolean;
}

export function stepCar(s: CarState, input: CarInput, p: CarParams, env: StepEnv, dt: number): StepEvents {
  const events: StepEvents = { cruiseDisengaged: false };
  const throttleIn = Math.min(1, Math.max(0, input.throttle));
  const brakeIn = Math.min(1, Math.max(0, input.brake));

  // --- Cruise control (D only) -------------------------------------------
  if (s.cruiseOn && (brakeIn > 0.05 || input.handbrake || s.gear !== 'D')) {
    s.cruiseOn = false;
    events.cruiseDisengaged = true;
  }
  let throttle = throttleIn;
  let f = s.vx * Math.sin(s.heading) + s.vz * Math.cos(s.heading);
  if (s.cruiseOn) {
    s.cruiseTarget = Math.min(s.cruiseTarget, env.speedLimit);
    const err = s.cruiseTarget - f;
    const cruiseThrottle = Math.min(p.cruiseMaxThrottle, Math.max(0, err * 0.35));
    throttle = Math.max(throttle, cruiseThrottle);
  }

  // --- Steering smoothing ------------------------------------------------
  const target = Math.min(1, Math.max(-1, input.steer));
  const growing = Math.abs(target) > Math.abs(s.steer) && Math.sign(target) === Math.sign(s.steer || target);
  s.steer = approach(s.steer, target, (growing ? p.steerRate : p.steerReturnRate) * dt);

  // --- Decompose velocity in the current heading frame --------------------
  let sin = Math.sin(s.heading);
  let cos = Math.cos(s.heading);
  f = s.vx * sin + s.vz * cos;
  // Lateral (to the car's left): left = (cos θ, −sin θ)
  let l = s.vx * cos - s.vz * sin;

  const onGrass = env.surface === 'grass';
  const dir = s.gear === 'D' ? 1 : -1;
  const speedInDir = f * dir;
  const cap = s.gear === 'D' ? Math.min(p.topSpeed, env.speedLimit) : p.reverseTopSpeed;

  // Engine: tapering power, smoothly governed at the cap.
  if (throttle > 0) {
    const v = Math.max(0, speedInDir);
    const taper = Math.max(0, 1 - (v / p.topSpeed) ** 2);
    const governor = Math.min(1, Math.max(0, (cap - v) / 1.5));
    f += dir * throttle * p.maxAccel * taper * governor * dt;
  }

  // Opposing decelerations never reverse the direction of travel.
  let resist = p.rollingResistance + p.dragCoeff * f * f + (onGrass ? p.grassDrag : 0);
  resist += brakeIn * p.brakeDecel;
  if (input.handbrake) resist += p.handbrakeDecel;
  if (speedInDir > cap + 0.2) resist += p.limiterDecel; // lowered limit: ease down, never snap
  f = decelToward0(f, resist * dt);

  // --- Yaw (kinematic bicycle) --------------------------------------------
  const wheelAngle = (s.steer * p.maxSteerAngle) / (1 + Math.abs(f) / p.steerFalloffSpeed);
  let yawRate = (f * Math.tan(wheelAngle)) / p.wheelBase;
  // Cap the yaw rate by the lateral acceleration the tyres could sustain.
  let latCap = p.maxLateralAccel * (onGrass ? 0.6 : 1);
  if (input.handbrake && Math.abs(f) > 3) {
    yawRate *= 1.55;
    latCap *= 1.7;
  }
  const maxYaw = latCap / Math.max(Math.abs(f), 1);
  yawRate = Math.max(-maxYaw, Math.min(maxYaw, yawRate));
  if (onGrass) yawRate *= 0.85;
  s.yawRate = yawRate;
  s.heading += yawRate * dt;
  if (s.heading > Math.PI) s.heading -= 2 * Math.PI;
  else if (s.heading < -Math.PI) s.heading += 2 * Math.PI;

  // Re-express the (world) velocity in the new heading frame. Rotating the car
  // leaves some velocity sideways; grip then removes it.
  const vxOld = f * sin + l * cos;
  const vzOld = f * cos - l * sin;
  sin = Math.sin(s.heading);
  cos = Math.cos(s.heading);
  f = vxOld * sin + vzOld * cos;
  l = vxOld * cos - vzOld * sin;
  const grip = (input.handbrake ? p.handbrakeGrip : p.grip) * (onGrass ? p.grassGripFactor : 1);
  l *= Math.exp(-grip * dt);

  // Settle completely at a standstill so the car never creeps.
  if (throttle === 0 && Math.abs(f) < 0.05 && Math.abs(l) < 0.05) {
    f = 0;
    l = 0;
  }

  s.vx = f * sin + l * cos;
  s.vz = f * cos - l * sin;
  s.slip = Math.abs(l);
  s.x += s.vx * dt;
  s.z += s.vz * dt;
  s.wheelSpin += (f / WHEEL_RADIUS) * dt;
  return events;
}

/**
 * Fixed-timestep driver: accumulates real frame time and advances the model in
 * constant steps, so handling does not depend on the display refresh rate.
 */
export class FixedStepper {
  readonly step: number;
  readonly maxSteps: number;
  private acc = 0;

  constructor(hz = 120, maxSteps = 12) {
    this.step = 1 / hz;
    this.maxSteps = maxSteps;
  }

  /** Returns how many fixed steps to run for this frame. Excess time is dropped. */
  advance(frameSeconds: number): number {
    this.acc += Math.min(Math.max(frameSeconds, 0), 0.25);
    let n = Math.floor(this.acc / this.step);
    if (n > this.maxSteps) {
      n = this.maxSteps;
      this.acc = 0;
    } else {
      this.acc -= n * this.step;
    }
    return n;
  }

  reset(): void {
    this.acc = 0;
  }
}
