// Unit tests for the pure simulation modules (run after `npm run build`): node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCarState,
  stepCar,
  DEFAULT_PARAMS,
  FixedStepper,
  requestGear,
  engageCruise,
  speedOf,
  forwardSpeed,
} from '../dist/js/physics.js';
import { TrackPath } from '../dist/js/track-path.js';
import { TrackRules, BARRIER_OFFSET, CAR_HALF_WIDTH } from '../dist/js/world-rules.js';
import { LapTimer, formatLapTime } from '../dist/js/laps.js';

const DT = 1 / 120;
const ROAD = { speedLimit: 75, surface: 'road' };
const none = { throttle: 0, brake: 0, steer: 0, handbrake: false };
const gas = { ...none, throttle: 1 };
const brake = { ...none, brake: 1 };

function run(s, input, seconds, env = ROAD) {
  const events = [];
  for (let i = 0; i < Math.round(seconds / DT); i++) events.push(stepCar(s, input, DEFAULT_PARAMS, env, DT));
  return events;
}

test('throttle accelerates forward; 0–100 km/h takes a plausible time', () => {
  const s = createCarState();
  let t = 0;
  while (speedOf(s) < 100 / 3.6 && t < 20) {
    stepCar(s, gas, DEFAULT_PARAMS, ROAD, DT);
    t += DT;
  }
  assert.ok(t > 2.5 && t < 6, `0-100 in ${t.toFixed(2)} s`);
  assert.ok(forwardSpeed(s) > 0);
  assert.ok(s.z > 0, 'heading 0 moves along +z');
});

test('braking at speed stops the car and never reverses it', () => {
  const s = createCarState();
  run(s, gas, 4);
  assert.ok(speedOf(s) > 20);
  run(s, brake, 6);
  assert.equal(speedOf(s), 0);
  const z = s.z;
  run(s, brake, 3); // keep holding brake at a standstill
  assert.equal(speedOf(s), 0);
  assert.equal(s.z, z, 'no movement while brake held at rest');
  assert.equal(s.gear, 'D');
});

test('reverse requires explicit gear selection at low speed', () => {
  const s = createCarState();
  run(s, gas, 2);
  assert.equal(requestGear(s, 'R'), false, 'refused while moving');
  assert.equal(s.gear, 'D');
  run(s, brake, 4);
  assert.equal(requestGear(s, 'R'), true);
  run(s, gas, 5);
  assert.ok(forwardSpeed(s) < 0, 'throttle in R drives backwards');
  assert.ok(Math.abs(forwardSpeed(s)) <= DEFAULT_PARAMS.reverseTopSpeed + 0.01, 'reverse speed capped');
  assert.ok(s.z < 0);
});

test('coasting slows the car gradually', () => {
  const s = createCarState();
  run(s, gas, 5);
  const v0 = speedOf(s);
  run(s, none, 1);
  const v1 = speedOf(s);
  assert.ok(v1 < v0 && v1 > v0 * 0.9, `coast ${v0.toFixed(1)} → ${v1.toFixed(1)}`);
});

test('steering authority decreases with speed', () => {
  const yaw = (speed) => {
    const s = createCarState();
    s.vz = speed;
    s.steer = 1;
    stepCar(s, { ...none, throttle: 0.0001, steer: 1 }, DEFAULT_PARAMS, ROAD, DT);
    // Heading change per metre travelled (curvature) should shrink at speed.
    return Math.abs(s.yawRate) / speed;
  };
  assert.ok(yaw(5) > yaw(40) * 3);
});

test('speed limit governs top speed; lowering it eases down instead of snapping', () => {
  const s = createCarState();
  run(s, gas, 20, { speedLimit: 100 / 3.6, surface: 'road' });
  assert.ok(Math.abs(speedOf(s) * 3.6 - 100) < 3, `held at ${(speedOf(s) * 3.6).toFixed(1)}`);
  const before = speedOf(s);
  stepCar(s, gas, DEFAULT_PARAMS, { speedLimit: 50 / 3.6, surface: 'road' }, DT);
  assert.ok(before - speedOf(s) < 0.1, 'no instantaneous drop');
  run(s, gas, 2, { speedLimit: 50 / 3.6, surface: 'road' });
  assert.ok(speedOf(s) * 3.6 > 60, 'still decelerating gradually after 2 s');
  run(s, gas, 15, { speedLimit: 50 / 3.6, surface: 'road' });
  assert.ok(speedOf(s) * 3.6 < 52);
});

test('cruise control approaches the target gradually and disengages on brake', () => {
  const s = createCarState();
  run(s, gas, 3);
  assert.equal(engageCruise(s, 75), true);
  s.cruiseTarget = 30; // ask for a higher speed (108 km/h)
  const v0 = speedOf(s);
  run(s, none, 0.5);
  assert.ok(speedOf(s) - v0 < DEFAULT_PARAMS.maxAccel * 0.5 * DEFAULT_PARAMS.cruiseMaxThrottle + 0.2, 'gentle acceleration');
  run(s, none, 20);
  assert.ok(Math.abs(speedOf(s) - 30) < 0.6, `cruise holds ${speedOf(s).toFixed(2)}`);
  const ev = run(s, brake, 0.1);
  assert.equal(s.cruiseOn, false);
  assert.ok(ev.some((e) => e.cruiseDisengaged));
});

test('cruise refuses to engage below 20 km/h or in reverse', () => {
  const s = createCarState();
  assert.equal(engageCruise(s, 75), false);
  requestGear(s, 'R');
  run(s, gas, 3);
  assert.equal(engageCruise(s, 75), false);
});

test('handbrake reduces grip and increases sliding', () => {
  const slide = (hb) => {
    const s = createCarState();
    run(s, gas, 4);
    run(s, { ...none, steer: 1, handbrake: hb }, 0.6);
    return s.slip;
  };
  assert.ok(slide(true) > slide(false) * 2);
});

test('fixed stepper makes results independent of frame rate', () => {
  const sim = (fps) => {
    const s = createCarState();
    const st = new FixedStepper(120);
    for (let f = 0; f < 5 * fps; f++) {
      const n = st.advance(1 / fps);
      for (let i = 0; i < n; i++) stepCar(s, { ...gas, steer: 0.3 }, DEFAULT_PARAMS, ROAD, st.step);
    }
    return s;
  };
  const a = sim(30);
  const b = sim(60);
  const c = sim(144);
  for (const o of [b, c]) {
    assert.ok(Math.abs(o.x - a.x) < 0.5 && Math.abs(o.z - a.z) < 0.5, `position ${o.x},${o.z} vs ${a.x},${a.z}`);
    assert.ok(Math.abs(speedOf(o) - speedOf(a)) < 0.2);
  }
});

test('track is a closed loop with sane geometry', () => {
  const t = new TrackPath();
  assert.ok(t.length > 1500 && t.length < 2500);
  assert.ok(t.minRadius > BARRIER_OFFSET + 10, `min radius ${t.minRadius}`);
  const first = t.sample(0);
  const last = t.sample(t.count - 1);
  assert.ok(Math.hypot(first.x - last.x, first.z - last.z) < t.spacing * 1.5);
});

test('barriers stop the car leaving the circuit', () => {
  const t = new TrackPath();
  const rules = new TrackRules(t);
  const s = createCarState();
  rules.resetCar(s, 100);
  // Aim straight at the left barrier at 30 m/s.
  const smp = t.sample(100);
  s.heading = Math.atan2(smp.nx, smp.nz);
  s.vx = smp.nx * 30;
  s.vz = smp.nz * 30;
  let maxLat = 0;
  let impact = 0;
  for (let i = 0; i < 240; i++) {
    stepCar(s, none, DEFAULT_PARAMS, ROAD, DT);
    const r = rules.apply(s);
    // Position after collision resolution is what gets rendered.
    maxLat = Math.max(maxLat, Math.abs(t.nearest(s.x, s.z).lateral));
    impact = Math.max(impact, r.impact);
  }
  assert.ok(maxLat <= BARRIER_OFFSET - CAR_HALF_WIDTH + 0.01, `max lateral ${maxLat}`);
  assert.ok(impact > 20, 'impact registered');
});

test('reset returns the car to the centre line facing along the track', () => {
  const t = new TrackPath();
  const rules = new TrackRules(t);
  const s = createCarState(1e6, 1e6, 2);
  s.vx = 50;
  const i = rules.resetCar(s);
  const r = rules.apply(s);
  assert.ok(Math.abs(r.lateral) < 0.01);
  assert.equal(speedOf(s), 0);
  assert.ok(Math.abs(s.heading - t.headingAt(i)) < 1e-9);
});

test('stuck detection recovers a car pinned against a barrier', () => {
  const t = new TrackPath();
  const rules = new TrackRules(t);
  const s = createCarState();
  rules.resetCar(s, 200);
  const smp = t.sample(200);
  s.x += smp.nx * 16.5;
  s.z += smp.nz * 16.5;
  s.heading = Math.atan2(smp.nx, smp.nz); // nose into the wall
  let recovered = false;
  for (let i = 0; i < 120 * 5 && !recovered; i++) {
    stepCar(s, gas, DEFAULT_PARAMS, ROAD, DT);
    const r = rules.apply(s);
    recovered = rules.needsRecovery(s, r, 1, DT);
  }
  assert.ok(recovered);
});

test('laps only count when all checkpoints are crossed in order', () => {
  const n = 800;
  const lt = new LapTimer(n, 0, 8);
  let time = 0;
  const drive = (from, to) => {
    const ev = [];
    for (let i = from; i <= to; i++) {
      time += 0.05;
      ev.push(...lt.update(((i % n) + n) % n, time));
    }
    return ev;
  };
  drive(-20, 0); // cross the start line → timer starts
  assert.equal(lt.running, true);
  const ev = drive(1, n);
  const done = ev.find((e) => e.type === 'completed');
  assert.ok(done, 'full lap completes');
  assert.equal(lt.lapsCompleted, 1);
  assert.ok(Math.abs(done.time - n * 0.05) < 0.11);

  // Teleport past most of the circuit → lap is voided and does not count.
  lt.invalidate();
  drive(n - 10, n + 5);
  lt.update(n / 2, time + 1);
  const ev2 = drive(n / 2 + 1, n + 2);
  assert.ok(!ev2.some((e) => e.type === 'completed'), 'shortcut lap rejected');
  assert.equal(lt.lapsCompleted, 1);
});

test('crossing the start line backwards cancels the lap', () => {
  const lt = new LapTimer(800, 0, 8);
  let t = 0;
  for (let i = -5; i <= 50; i++) lt.update((i + 800) % 800, (t += 0.05));
  assert.equal(lt.running, true);
  const ev = [];
  for (let i = 50; i >= -5; i--) ev.push(...lt.update((i + 800) % 800, (t += 0.05)));
  assert.ok(ev.some((e) => e.type === 'invalid' && e.reason === 'wrong-way'));
  assert.equal(lt.running, false);
});

test('lap time formatting', () => {
  assert.equal(formatLapTime(83.4567), '1:23.457');
  assert.equal(formatLapTime(5.2), '0:05.200');
  assert.equal(formatLapTime(null), '—');
});
