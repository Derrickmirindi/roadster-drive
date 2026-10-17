/**
 * Stunt Lab simulation (pure TypeScript, no Three.js).
 *
 * An illustrative teaching model of a concept rig that combines extractor-fan
 * suction (to press the tyres onto a surface) with compressed-air jets (to push
 * the vehicle into the air). The rig hardware is the same for every vehicle;
 * only the body changes. Everything is computed with a fixed 1/240 s step and
 * stored as samples so the result can be scrubbed backwards and forwards.
 *
 * Two independent trials:
 *  1. Ramp  — drive into a half-pipe, climb the wall to the inverted ceiling,
 *             hold, then drive back down. The tyres follow a reference speed
 *             programme, limited by friction μ·N; the vehicle detaches when the
 *             contact force would have to pull (N < 0).
 *  2. Flight — run in at a set speed, fire the lift jets for a fixed burn,
 *             apply a fixed roll couple, fly over a line of parked cars and
 *             try to land on the wheels.
 *
 * Coordinates: x forward along the course, y up, metres and seconds.
 * These are illustrative numbers, not measurements of any real vehicle.
 */

export const G = 9.81;
export const RIG_MASS = 350; // kg, fans + tanks + jets, shared by every vehicle
export const REFERENCE_MASS = 2000; // kg, the reference vehicle with the rig
export const SUCTION_MAX = 2 * REFERENCE_MASS * G; // 39.24 kN — twice the reference weight
export const LIFT_THRUST = 53_300; // N, upward jet thrust during the burn
export const MU = 1.0; // tyre–surface friction coefficient (dry, sticky)
export const ARC_R = 8; // m, half-pipe radius
export const ARC_LEN = Math.PI * ARC_R; // m, ground → inverted top
export const PIPE_WIDTH = 6; // m
export const FLIGHT_START_X = 70; // m, start of the launch strip
export const LINEUP_FROM = 118; // m, parked cars to clear
export const LINEUP_TO = 134;
export const LINEUP_HEIGHT = 1.6;
const STEP = 1 / 240;
const SAMPLE_EVERY = 4; // store at 60 Hz
const FLIGHT_SPEED = 14; // m/s run-in
const LAUNCH_T = 2.5; // s into the flight trial
const BURN = 0.6; // s
const ROLL_PULSE = 0.5; // s
const FLIGHT_MAX = 30; // s cap for very light bodies

export type VehicleKind =
  | 'roadster'
  | 'f1'
  | 'tricycle'
  | 'moped'
  | 'kart'
  | 'motorcycle'
  | 'cart'
  | 'golf'
  | 'compact'
  | 'pickup'
  | 'van'
  | 'bus'
  | 'semi';

export interface VehicleSpec {
  id: VehicleKind;
  name: string;
  /** Body and load, excluding the shared rig (kg). Illustrative. */
  bodyMass: number;
  length: number;
  width: number;
  height: number;
  color: string;
}

export const VEHICLES: VehicleSpec[] = [
  { id: 'roadster', name: 'Roadster', bodyMass: 1650, length: 4.3, width: 1.86, height: 1.2, color: '#a3141c' },
  { id: 'f1', name: 'F1-style racer', bodyMass: 800, length: 5.4, width: 2.0, height: 0.95, color: '#1f3f8f' },
  { id: 'tricycle', name: 'Tricycle', bodyMass: 15, length: 1.2, width: 0.75, height: 0.8, color: '#e0251b' },
  { id: 'moped', name: 'Moped', bodyMass: 90, length: 1.8, width: 0.7, height: 1.1, color: '#ece8df' },
  { id: 'kart', name: 'Go-kart', bodyMass: 90, length: 1.9, width: 1.3, height: 0.6, color: '#d4dc2a' },
  { id: 'motorcycle', name: 'Motorcycle', bodyMass: 200, length: 2.1, width: 0.8, height: 1.15, color: '#2e3033' },
  { id: 'cart', name: 'Shopping cart', bodyMass: 25, length: 1.0, width: 0.6, height: 1.0, color: '#b8bcc2' },
  { id: 'golf', name: 'Golf cart', bodyMass: 400, length: 2.4, width: 1.2, height: 1.8, color: '#ece8df' },
  { id: 'compact', name: 'Compact car', bodyMass: 1250, length: 4.0, width: 1.75, height: 1.5, color: '#1f4a35' },
  { id: 'pickup', name: 'Pickup truck', bodyMass: 2500, length: 5.8, width: 2.0, height: 1.9, color: '#5b5f66' },
  { id: 'van', name: 'Delivery van', bodyMass: 3500, length: 6.0, width: 2.0, height: 2.6, color: '#ece8df' },
  { id: 'bus', name: 'School bus', bodyMass: 11000, length: 11.0, width: 2.5, height: 3.2, color: '#e3a92b' },
  { id: 'semi', name: '18-wheeler', bodyMass: 30000, length: 16.5, width: 2.6, height: 4.0, color: '#2e3033' },
];

export function vehicleById(id: string): VehicleSpec {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
}

export function totalMass(v: VehicleSpec): number {
  return v.bodyMass + RIG_MASS;
}

/** Roll inertia about the forward axis, treating the body as a uniform box. */
export function rollInertia(v: VehicleSpec): number {
  return (totalMass(v) * (v.width * v.width + v.height * v.height)) / 12;
}

export interface Verdicts {
  /** Stationary on a vertical wall: μ·S ≥ m·g. */
  wallHold: boolean;
  /** Stationary on a ceiling: S ≥ m·g. */
  ceilingHold: boolean;
  /** Lift jets exceed weight: T > m·g. */
  liftOff: boolean;
  weight: number;
  thrustToWeight: number;
  suctionToWeight: number;
}

export function verdicts(v: VehicleSpec): Verdicts {
  const w = totalMass(v) * G;
  return {
    wallHold: MU * SUCTION_MAX >= w,
    ceilingHold: SUCTION_MAX >= w,
    liftOff: LIFT_THRUST > w,
    weight: w,
    thrustToWeight: LIFT_THRUST / w,
    suctionToWeight: SUCTION_MAX / w,
  };
}

export type Vec3 = [number, number, number];

export interface Sample {
  t: number;
  x: number;
  y: number;
  /** Nose-up rotation about the lateral axis (rad); π = upside-down on the ceiling. */
  pitch: number;
  /** Rotation about the forward axis (rad). */
  roll: number;
  vx: number;
  vy: number;
  gravity: Vec3;
  suction: Vec3;
  contact: Vec3;
  tire: Vec3;
  thrust: Vec3;
  /** Roll torque (N·m). */
  torque: number;
  /** Fan suction as a fraction of maximum. */
  fan: number;
  jets: boolean;
  state: 'ground' | 'climbing' | 'wall' | 'inverted' | 'airborne' | 'stopped' | 'crashed';
  trial: 'ramp' | 'flight';
}

export interface Chapter {
  label: string;
  t: number;
}

export interface StuntResult {
  vehicle: VehicleSpec;
  mass: number;
  inertia: number;
  verdicts: Verdicts;
  samples: Sample[];
  duration: number;
  rampEnd: number;
  flightStart: number;
  chapters: Chapter[];
  ramp: { completed: boolean; maxAngleDeg: number; outcome: string };
  flight: {
    lifted: boolean;
    peakHeight: number;
    rollTurns: number;
    landedUpright: boolean;
    hitLineup: boolean;
    outcome: string;
  };
  /** Roll couple used for every vehicle (N·m). */
  rollCouple: number;
}

// ---------------------------------------------------------------- helpers

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface Key {
  t: number;
  u: number;
  v: number;
}

/** Reference programme for the ramp trial: arc-length position u(t) along the course. */
const RAMP_KEYS: Key[] = [
  { t: 0, u: -40, v: 13 },
  { t: 3, u: -1, v: 13 },
  { t: 7, u: ARC_LEN, v: 0 },
  { t: 10, u: ARC_LEN, v: 0 },
  { t: 14, u: -1, v: -13 },
  { t: 18, u: -34, v: 0 },
  { t: 19, u: -34, v: 0 },
];
export const RAMP_DURATION = 19;

/** Cubic Hermite evaluation of the programme: position, velocity, acceleration. */
export function rampProgram(t: number): { u: number; v: number; a: number } {
  const k = RAMP_KEYS;
  if (t <= k[0].t) return { u: k[0].u + k[0].v * (t - k[0].t), v: k[0].v, a: 0 };
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i];
    const b = k[i + 1];
    if (t <= b.t) {
      const h = b.t - a.t;
      const s = (t - a.t) / h;
      const s2 = s * s;
      const s3 = s2 * s;
      const m0 = a.v * h;
      const m1 = b.v * h;
      const u = (2 * s3 - 3 * s2 + 1) * a.u + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * b.u + (s3 - s2) * m1;
      const du = (6 * s2 - 6 * s) * a.u + (3 * s2 - 4 * s + 1) * m0 + (-6 * s2 + 6 * s) * b.u + (3 * s2 - 2 * s) * m1;
      const ddu = (12 * s - 6) * a.u + (6 * s - 4) * m0 + (-12 * s + 6) * b.u + (6 * s - 2) * m1;
      return { u, v: du / h, a: ddu / (h * h) };
    }
  }
  const last = k[k.length - 1];
  return { u: last.u, v: 0, a: 0 };
}

/** Fan programme: spin up before the pipe, release after returning to the ground. */
export function fanProgram(t: number): number {
  return smoothstep(2, 3, t) * (1 - smoothstep(14, 15, t));
}

/** Position and frame on the course for arc-length u. */
export function coursePoint(u: number): { x: number; y: number; theta: number } {
  if (u <= 0) return { x: u, y: 0, theta: 0 };
  const th = Math.min(u, ARC_LEN) / ARC_R;
  return { x: ARC_R * Math.sin(th), y: ARC_R - ARC_R * Math.cos(th), theta: th };
}

const vec = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];

// ---------------------------------------------------------------- ramp trial

function simulateRamp(v: VehicleSpec, out: Sample[]): StuntResult['ramp'] {
  const m = totalMass(v);
  let u = RAMP_KEYS[0].u;
  let du = RAMP_KEYS[0].v;
  let attached = true;
  // Free-flight state (when detached from the pipe).
  let fx = 0;
  let fy = 0;
  let fvx = 0;
  let fvy = 0;
  let pitch = 0;
  let pitchRate = 0;
  let maxTheta = 0;
  let slipped = false;
  let slipAt: number | null = null;
  let detachedAt: number | null = null;
  const steps = Math.round(RAMP_DURATION / STEP);

  for (let i = 0; i <= steps; i++) {
    const t = i * STEP;
    const fan = fanProgram(t);
    const S = fan * SUCTION_MAX;
    const prog = rampProgram(t);
    let sample: Sample;

    if (attached) {
      const p = coursePoint(u);
      const th = p.theta;
      const onArc = u > 0;
      const tx = Math.cos(th);
      const ty = Math.sin(th);
      const nx = -Math.sin(th);
      const ny = Math.cos(th);
      const curvature = onArc ? 1 / ARC_R : 0;
      // Contact normal force needed to stay on the surface (towards the pipe centre).
      const N = m * du * du * curvature + m * G * ny + S;
      if (N < 0 && onArc) {
        // The surface would have to pull: the vehicle leaves it.
        attached = false;
        detachedAt = th;
        fx = p.x;
        fy = p.y;
        fvx = du * tx;
        fvy = du * ty;
        pitch = th;
        pitchRate = du * curvature;
        i--; // re-evaluate this step in free flight
        continue;
      }
      // Tyres try to follow the programme (tracking controller), limited by μN.
      const aCmd = prog.a + 6 * (prog.v - du) + 9 * (prog.u - u);
      const fNeeded = m * aCmd + m * G * ty; // along the tangent
      const fMax = MU * Math.max(0, N);
      const fTyre = Math.max(-fMax, Math.min(fMax, fNeeded));
      if (Math.abs(fNeeded) > fMax + 1e-6 && onArc && Math.abs(fNeeded - fTyre) > 0.02 * m * G) {
        if (!slipped) slipAt = th;
        slipped = true;
      }
      const acc = (fTyre - m * G * ty) / m;
      if (i % SAMPLE_EVERY === 0) {
        sample = {
          t,
          x: p.x,
          y: p.y,
          pitch: th,
          roll: 0,
          vx: du * tx,
          vy: du * ty,
          gravity: vec(0, -m * G),
          suction: vec(-S * nx, -S * ny),
          contact: vec(N * nx, N * ny),
          tire: vec(fTyre * tx, fTyre * ty),
          thrust: vec(),
          torque: 0,
          fan,
          jets: false,
          state: !onArc ? (Math.abs(du) < 0.05 && t > 15 ? 'stopped' : 'ground') : th > 2.4 ? 'inverted' : th > 1.1 ? 'wall' : 'climbing',
          trial: 'ramp',
        };
        out.push(sample);
      }
      du += acc * STEP;
      u += du * STEP;
      if (u < -60) u = -60;
      if (u > ARC_LEN) {
        u = ARC_LEN;
        du = Math.min(du, 0);
      }
      maxTheta = Math.max(maxTheta, coursePoint(u).theta);
    } else {
      // Free flight under gravity until the vehicle meets the pipe or the ground.
      if (i % SAMPLE_EVERY === 0) {
        out.push({
          t,
          x: fx,
          y: fy,
          pitch,
          roll: 0,
          vx: fvx,
          vy: fvy,
          gravity: vec(0, -m * G),
          suction: vec(),
          contact: vec(),
          tire: vec(),
          thrust: vec(),
          torque: 0,
          fan,
          jets: false,
          state: 'airborne',
          trial: 'ramp',
        });
      }
      fvy -= G * STEP;
      fx += fvx * STEP;
      fy += fvy * STEP;
      pitch += pitchRate * STEP;
      const cx = fx;
      const cy = fy - ARC_R;
      const dist = Math.hypot(cx, cy);
      if (fx > 0 && dist >= ARC_R) {
        // Hit the inside of the pipe: land on it, keeping the tangential speed.
        const th = Math.atan2(fx, -(fy - ARC_R));
        const tx = Math.cos(th);
        const ty = Math.sin(th);
        u = Math.max(0.001, Math.min(ARC_LEN, th * ARC_R));
        du = fvx * tx + fvy * ty;
        attached = true;
      } else if (fy <= 0) {
        u = Math.min(fx, 0);
        du = fvx;
        attached = true;
        pitch = 0;
      }
    }
  }

  const maxAngleDeg = Math.round((maxTheta * 180) / Math.PI);
  const completed = maxTheta > Math.PI - 0.05 && detachedAt === null && !slipped;
  const deg = (r: number) => Math.round((r * 180) / Math.PI);
  const reached = maxTheta > Math.PI - 0.05;
  let outcome: string;
  if (completed) outcome = 'Climbs to the inverted ceiling, holds and drives back down.';
  else if (detachedAt !== null)
    outcome = `Reaches ${maxAngleDeg}° on momentum, then drops off the pipe at ${deg(detachedAt)}° — suction is weaker than its weight.`;
  else if (reached)
    outcome = `Reaches the ceiling, but the tyres slip from ${deg(slipAt ?? 0)}° and it cannot follow the reference run.`;
  else outcome = `The tyres slip from ${deg(slipAt ?? 0)}°; it peaks at ${maxAngleDeg}° and slides back down.`;
  return { completed, maxAngleDeg, outcome };
}

// ---------------------------------------------------------------- flight trial

interface FlightRun {
  samples: Sample[];
  lifted: boolean;
  peak: number;
  roll: number;
  landedUpright: boolean;
  hitLineup: boolean;
  liftoffT: number | null;
  burnEndT: number;
  landT: number | null;
  duration: number;
}

function simulateFlight(v: VehicleSpec, rollCouple: number, t0: number): FlightRun {
  const m = totalMass(v);
  const I = rollInertia(v);
  let x = FLIGHT_START_X;
  let y = 0;
  let vx = FLIGHT_SPEED;
  let vy = 0;
  let roll = 0;
  let rollRate = 0;
  let airborne = false;
  let lifted = false;
  let peak = 0;
  let liftoffT: number | null = null;
  let landT: number | null = null;
  let landedUpright = false;
  let hitLineup = false;
  let crashed = false;
  let stoppedAt: number | null = null;
  const samples: Sample[] = [];
  const maxSteps = Math.round(FLIGHT_MAX / STEP);
  let i = 0;

  for (; i <= maxSteps; i++) {
    const t = i * STEP;
    const jets = t >= LAUNCH_T && t < LAUNCH_T + BURN;
    const T = jets ? LIFT_THRUST : 0;
    // Thrust acts along the body's up axis, which rolls with the vehicle.
    const tY = T * Math.cos(roll);
    const tZ = -T * Math.sin(roll);
    const rollOn = t >= LAUNCH_T + BURN && t < LAUNCH_T + BURN + ROLL_PULSE && airborne;
    const torque = rollOn ? rollCouple : 0;

    let N = 0;
    let fTyre = 0;
    if (!airborne) {
      N = m * G - tY;
      if (N < 0) {
        airborne = true;
        lifted = true;
        liftoffT = t;
        N = 0;
      } else if (!crashed && landT === null && !hitLineup) {
        // Wheels try to hold the run-in speed.
        const need = m * 4 * (FLIGHT_SPEED - vx);
        fTyre = Math.max(-MU * N, Math.min(MU * N, need));
      } else {
        // After landing or a crash: brake (or scrape) to a stop.
        const decel = crashed ? 0.6 * MU * N : 0.5 * MU * N;
        fTyre = vx > 0 ? -Math.min(decel, (m * vx) / STEP) : 0;
      }
    }

    if (i % SAMPLE_EVERY === 0) {
      const state: Sample['state'] = crashed || hitLineup
        ? 'crashed'
        : airborne
          ? 'airborne'
          : vx < 0.05 && landT !== null
            ? 'stopped'
            : 'ground';
      samples.push({
        t: t0 + t,
        x,
        y,
        pitch: 0,
        roll,
        vx,
        vy,
        gravity: vec(0, -m * G),
        suction: vec(),
        contact: vec(0, N),
        tire: vec(fTyre, 0),
        thrust: vec(0, tY, tZ),
        torque,
        fan: 0,
        jets,
        state,
        trial: 'flight',
      });
    }

    if (stoppedAt !== null && t - stoppedAt > 1.5) break;

    // Integrate.
    const ay = airborne ? (tY - m * G) / m : 0;
    const ax = fTyre / m;
    vx += ax * STEP;
    if (vx < 0) vx = 0;
    vy += ay * STEP;
    x += vx * STEP;
    y += vy * STEP;
    rollRate += (torque / I) * STEP;
    roll += rollRate * STEP;
    peak = Math.max(peak, y);

    // Parked cars: anything low enough inside their footprint hits them.
    if (!hitLineup && y < LINEUP_HEIGHT && x + v.length / 2 > LINEUP_FROM && x - v.length / 2 < LINEUP_TO) {
      hitLineup = true;
      vx = Math.min(vx, 1);
      if (airborne && y > 0) {
        // keep falling onto the cars' roof line
      }
    }

    if (airborne && y <= 0 && t > (liftoffT ?? 0) + 0.05) {
      y = 0;
      vy = 0;
      airborne = false;
      landT = t;
      rollRate = 0;
      const turns = roll / (2 * Math.PI);
      const err = Math.abs(turns - Math.round(turns)) * 2 * Math.PI;
      landedUpright = err < 0.45;
      if (landedUpright) roll = Math.round(turns) * 2 * Math.PI;
      else crashed = true;
    }
    if (!airborne && (landT !== null || hitLineup) && vx <= 0.01 && stoppedAt === null) stoppedAt = t;
    if (!lifted && t > LAUNCH_T + BURN + 2 && vx <= 0.01 && stoppedAt === null) stoppedAt = t;
    if (!lifted && t > LAUNCH_T + BURN + 6) {
      // Never lifted and still rolling: end the trial a few seconds after the burn.
      break;
    }
  }
  return {
    samples,
    lifted,
    peak,
    roll,
    landedUpright,
    hitLineup,
    liftoffT,
    burnEndT: LAUNCH_T + BURN,
    landT,
    duration: Math.min(FLIGHT_MAX, i * STEP),
  };
}

let cachedCouple: number | null = null;

/**
 * The roll couple is calibrated once so that the reference Roadster completes
 * exactly one roll before landing; every other body gets the same couple.
 */
export function referenceRollCouple(): number {
  if (cachedCouple !== null) return cachedCouple;
  const ref = vehicleById('roadster');
  const probe = simulateFlight(ref, 0, 0);
  const land = probe.landT ?? LAUNCH_T + BURN + 2;
  const start = LAUNCH_T + BURN;
  const alpha = (2 * Math.PI) / (ROLL_PULSE * ROLL_PULSE * 0.5 + ROLL_PULSE * (land - start - ROLL_PULSE));
  cachedCouple = alpha * rollInertia(ref);
  return cachedCouple;
}

// ---------------------------------------------------------------- full run

const results = new Map<string, StuntResult>();

export function simulateStunt(v: VehicleSpec): StuntResult {
  const cached = results.get(v.id);
  if (cached) return cached;
  const samples: Sample[] = [];
  const ramp = simulateRamp(v, samples);
  const rampEnd = RAMP_DURATION;
  const gap = 0.5;
  const flightStart = rampEnd + gap;
  const couple = referenceRollCouple();
  const fl = simulateFlight(v, couple, flightStart);
  samples.push(...fl.samples);
  const duration = flightStart + fl.duration;
  const m = totalMass(v);
  const vd = verdicts(v);
  const turns = fl.roll / (2 * Math.PI);

  let outcome: string;
  if (!fl.lifted) outcome = fl.hitLineup ? 'Cannot lift off and runs into the parked cars.' : 'Cannot lift off — the jets are weaker than its weight.';
  else if (fl.hitLineup) outcome = `Lifts but only to ${fl.peak.toFixed(1)} m and clips the parked cars.`;
  else if (fl.landedUpright) outcome = `Clears the parked cars at up to ${fl.peak.toFixed(1)} m and lands on its wheels after ${Math.round(turns)} roll${Math.round(turns) === 1 ? '' : 's'}.`;
  else outcome = `Flies to ${fl.peak.toFixed(1)} m but turns ${turns.toFixed(2)} times and lands on its roof or side.`;

  const chapters: Chapter[] = [
    { label: 'Approach', t: 0 },
    { label: 'Climb', t: 3 },
    { label: 'Invert', t: 7 },
    { label: 'Return', t: 10 },
    { label: 'Run-in', t: flightStart },
    { label: 'Launch', t: flightStart + LAUNCH_T },
    { label: 'Roll', t: flightStart + LAUNCH_T + BURN },
  ];
  if (fl.landT !== null) chapters.push({ label: 'Land', t: flightStart + fl.landT });

  const res: StuntResult = {
    vehicle: v,
    mass: m,
    inertia: rollInertia(v),
    verdicts: vd,
    samples,
    duration,
    rampEnd,
    flightStart,
    chapters,
    ramp,
    flight: {
      lifted: fl.lifted,
      peakHeight: fl.peak,
      rollTurns: turns,
      landedUpright: fl.landedUpright,
      hitLineup: fl.hitLineup,
      outcome,
    },
    rollCouple: couple,
  };
  results.set(v.id, res);
  return res;
}

/** Interpolated sample at time t (seconds on the combined timeline). */
export function sampleAt(r: StuntResult, t: number): Sample {
  const s = r.samples;
  if (t <= s[0].t) return s[0];
  if (t >= s[s.length - 1].t) return s[s.length - 1];
  // Binary search.
  let lo = 0;
  let hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = s[lo];
  const b = s[hi];
  if (a.trial !== b.trial) return t - a.t < b.t - t ? a : b;
  const w = (t - a.t) / (b.t - a.t || 1);
  const lerp = (p: number, q: number) => p + (q - p) * w;
  const lv = (p: Vec3, q: Vec3): Vec3 => [lerp(p[0], q[0]), lerp(p[1], q[1]), lerp(p[2], q[2])];
  return {
    ...a,
    t,
    x: lerp(a.x, b.x),
    y: lerp(a.y, b.y),
    pitch: lerp(a.pitch, b.pitch),
    roll: lerp(a.roll, b.roll),
    vx: lerp(a.vx, b.vx),
    vy: lerp(a.vy, b.vy),
    gravity: lv(a.gravity, b.gravity),
    suction: lv(a.suction, b.suction),
    contact: lv(a.contact, b.contact),
    tire: lv(a.tire, b.tire),
    thrust: lv(a.thrust, b.thrust),
    torque: lerp(a.torque, b.torque),
    fan: lerp(a.fan, b.fan),
  };
}

export const magnitude = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
