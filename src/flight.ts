/**
 * Jet flight while driving (pure TypeScript, no Three.js).
 *
 * The same fictional rig as the Stunt lab: lift jets give 53.3 kN for 0.6 s,
 * then an optional roll couple turns the car once about its forward axis. The
 * car keeps its horizontal velocity while airborne (tyres have no grip in the
 * air) and lands on the road. The air tanks then recharge before the next jump.
 *
 * Units: metres, seconds, newtons. Roll is in radians about the forward axis.
 */
import { G, LIFT_THRUST, REFERENCE_MASS } from './stunt-sim.js';

export const FLIGHT_MASS = REFERENCE_MASS; // the drivable roadster with its rig (kg)
export const BURN_TIME = 0.6; // s
export const ROLL_PULSE = 0.5; // s, roll couple applied right after the burn
export const RECHARGE_TIME = 5; // s, tanks refill after landing
/** Roll inertia of the roadster (box approximation, kg·m²). */
export const ROLL_INERTIA = (FLIGHT_MASS * (1.86 * 1.86 + 1.2 * 1.2)) / 12;

export interface FlightState {
  y: number;
  vy: number;
  roll: number;
  rollRate: number;
  airborne: boolean;
  /** Seconds since the jets fired, or −1 when no flight is in progress. */
  t: number;
  /** 0..1 tank charge; flights need a full tank. */
  charge: number;
  rollEnabled: boolean;
  /** Highest point of the current or last flight (m). */
  peak: number;
}

export type FlightEvent =
  | { type: 'liftoff' }
  | { type: 'landed'; upright: boolean; airtime: number; peak: number }
  | { type: 'ready' };

export function createFlightState(): FlightState {
  return { y: 0, vy: 0, roll: 0, rollRate: 0, airborne: false, t: -1, charge: 1, rollEnabled: true, peak: 0 };
}

/** Airtime of an unrolled jump: burn phase plus ballistic phase back to y = 0. */
function airtime(): number {
  const a = LIFT_THRUST / FLIGHT_MASS - G;
  const v = a * BURN_TIME;
  const h = 0.5 * a * BURN_TIME * BURN_TIME;
  const tUp = v / G;
  const peak = h + (v * v) / (2 * G);
  return BURN_TIME + tUp + Math.sqrt((2 * peak) / G);
}

/**
 * Roll couple chosen so that one full turn is completed exactly at touchdown
 * (constant angular acceleration during the pulse, then coasting).
 */
export const ROLL_COUPLE = (() => {
  const coast = airtime() - BURN_TIME - ROLL_PULSE;
  const alpha = (2 * Math.PI) / (0.5 * ROLL_PULSE * ROLL_PULSE + ROLL_PULSE * coast);
  return alpha * ROLL_INERTIA;
})();

export function canFly(f: FlightState): boolean {
  return !f.airborne && f.t < 0 && f.charge >= 1;
}

/** Fire the jets. Returns false if airborne or the tanks are not full. */
export function launch(f: FlightState): boolean {
  if (!canFly(f)) return false;
  f.t = 0;
  f.charge = 0;
  f.peak = 0;
  return true;
}

export function stepFlight(f: FlightState, dt: number): FlightEvent[] {
  const events: FlightEvent[] = [];
  if (f.t < 0) {
    if (f.charge < 1) {
      f.charge = Math.min(1, f.charge + dt / RECHARGE_TIME);
      if (f.charge >= 1) events.push({ type: 'ready' });
    }
    return events;
  }
  const burning = f.t < BURN_TIME;
  // Thrust acts along the body's up axis, so a rolled car loses vertical thrust.
  const thrust = burning ? LIFT_THRUST * Math.cos(f.roll) : 0;
  const net = thrust - FLIGHT_MASS * G;
  if (!f.airborne) {
    if (net > 0) {
      f.airborne = true;
      events.push({ type: 'liftoff' });
    } else if (!burning) {
      f.t = -1; // jets too weak (never for the reference mass)
      return events;
    }
  }
  if (f.airborne) {
    const rolling = f.rollEnabled && f.t >= BURN_TIME && f.t < BURN_TIME + ROLL_PULSE;
    f.rollRate += (rolling ? ROLL_COUPLE / ROLL_INERTIA : 0) * dt;
    f.roll += f.rollRate * dt;
    f.vy += (net / FLIGHT_MASS) * dt;
    f.y += f.vy * dt;
    f.peak = Math.max(f.peak, f.y);
    if (f.y <= 0 && f.vy < 0) {
      const turns = f.roll / (2 * Math.PI);
      const err = Math.abs(turns - Math.round(turns)) * 2 * Math.PI;
      const upright = err < 0.45;
      events.push({ type: 'landed', upright, airtime: f.t, peak: f.peak });
      f.y = 0;
      f.vy = 0;
      f.roll = 0;
      f.rollRate = 0;
      f.airborne = false;
      f.t = -1;
      return events;
    }
  }
  f.t += dt;
  return events;
}

export function isBurning(f: FlightState): boolean {
  return f.t >= 0 && f.t < BURN_TIME;
}
