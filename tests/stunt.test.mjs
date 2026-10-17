// Unit tests for the Stunt Lab simulation (run after `npm run build`).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  G, RIG_MASS, SUCTION_MAX, LIFT_THRUST, MU, ARC_R, VEHICLES,
  vehicleById, totalMass, verdicts, simulateStunt, sampleAt, rampProgram, coursePoint, referenceRollCouple, rollInertia, magnitude,
} from '../dist/js/stunt-sim.js';

test('every vehicle includes the same 350 kg rig', () => {
  for (const v of VEHICLES) assert.equal(totalMass(v), v.bodyMass + RIG_MASS);
});

test('static verdicts follow from suction, friction and thrust against weight', () => {
  for (const v of VEHICLES) {
    const w = totalMass(v) * G;
    const d = verdicts(v);
    assert.equal(d.wallHold, MU * SUCTION_MAX >= w, v.id);
    assert.equal(d.ceilingHold, SUCTION_MAX >= w, v.id);
    assert.equal(d.liftOff, LIFT_THRUST > w, v.id);
  }
  const bus = verdicts(vehicleById('bus'));
  assert.ok(!bus.wallHold && !bus.ceilingHold && !bus.liftOff);
  const r = verdicts(vehicleById('roadster'));
  assert.ok(r.wallHold && r.ceilingHold && r.liftOff);
  assert.ok(Math.abs(r.suctionToWeight - 2) < 1e-9, 'suction is twice the reference weight');
});

test('reference Roadster completes the ramp and follows the programme', () => {
  const r = simulateStunt(vehicleById('roadster'));
  assert.equal(r.ramp.completed, true);
  for (const s of r.samples.filter((x) => x.trial === 'ramp')) {
    const p = coursePoint(rampProgram(s.t).u);
    assert.ok(Math.hypot(p.x - s.x, p.y - s.y) < 0.05, `tracking error at ${s.t}`);
  }
});

test('ramp forces balance: m·a = gravity + suction + contact + friction', () => {
  const v = vehicleById('roadster');
  const m = totalMass(v);
  const r = simulateStunt(v);
  const ramp = r.samples.filter((s) => s.trial === 'ramp' && s.t > 3.2 && s.t < 6.8);
  for (let i = 1; i < ramp.length - 1; i++) {
    const a = ramp[i - 1], b = ramp[i], c = ramp[i + 1];
    const dt = c.t - a.t;
    const ax = (c.vx - a.vx) / dt;
    const ay = (c.vy - a.vy) / dt;
    const fx = b.gravity[0] + b.suction[0] + b.contact[0] + b.tire[0];
    const fy = b.gravity[1] + b.suction[1] + b.contact[1] + b.tire[1];
    assert.ok(Math.abs(fx - m * ax) < 0.03 * m * G && Math.abs(fy - m * ay) < 0.03 * m * G, `imbalance at t=${b.t.toFixed(2)}`);
  }
});

test('contact force never pulls; friction never exceeds μN', () => {
  for (const v of VEHICLES) {
    for (const s of simulateStunt(v).samples) {
      const N = magnitude(s.contact);
      assert.ok(N >= -1e-6);
      assert.ok(magnitude(s.tire) <= MU * N + 1, `${v.id} t=${s.t.toFixed(2)} friction ${magnitude(s.tire)} > μN ${N}`);
    }
  }
});

test('the bus cannot hold the ceiling, cannot lift off, and is stopped by the parked cars', () => {
  const r = simulateStunt(vehicleById('bus'));
  assert.equal(r.ramp.completed, false);
  assert.equal(r.flight.lifted, false);
  assert.equal(r.flight.hitLineup, true);
});

test('reference Roadster clears the parked cars and lands on its wheels after one roll', () => {
  const r = simulateStunt(vehicleById('roadster'));
  assert.equal(r.flight.lifted, true);
  assert.equal(r.flight.hitLineup, false);
  assert.equal(r.flight.landedUpright, true);
  assert.ok(Math.abs(r.flight.rollTurns - 1) < 0.02, `turns ${r.flight.rollTurns}`);
  assert.ok(r.flight.peakHeight > 4 && r.flight.peakHeight < 15);
});

test('the same roll couple is used for every body; lighter bodies over-rotate', () => {
  const c = referenceRollCouple();
  for (const v of VEHICLES) assert.equal(simulateStunt(v).rollCouple, c);
  const kart = simulateStunt(vehicleById('kart'));
  assert.ok(Math.abs(kart.flight.rollTurns) > 2);
  assert.ok(rollInertia(vehicleById('semi')) > rollInertia(vehicleById('roadster')) * 20);
});

test('deterministic results and continuous interpolation', () => {
  const a = simulateStunt(vehicleById('compact'));
  const s1 = sampleAt(a, 5.123);
  const s2 = sampleAt(a, 5.123);
  assert.deepEqual(s1, s2);
  const s3 = sampleAt(a, 5.13);
  assert.ok(Math.hypot(s3.x - s1.x, s3.y - s1.y) < 0.5);
  assert.ok(a.duration > a.flightStart && a.flightStart > a.rampEnd);
  assert.equal(ARC_R, 8);
});
