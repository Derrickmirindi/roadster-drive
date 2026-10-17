// Unit tests for jet flight while driving (run after `npm run build`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlightState, launch, stepFlight, canFly, BURN_TIME, RECHARGE_TIME } from '../dist/js/flight.js';

const DT = 1 / 120;
function fly(rollEnabled) {
  const f = createFlightState();
  f.rollEnabled = rollEnabled;
  assert.equal(launch(f), true);
  const events = [];
  let maxRoll = 0;
  for (let i = 0; i < 120 * 6; i++) {
    events.push(...stepFlight(f, DT));
    maxRoll = Math.max(maxRoll, f.roll);
    if (events.some((e) => e.type === 'landed')) break;
  }
  return { f, events, maxRoll };
}

test('jets lift the 2,000 kg car off and it lands back on the road', () => {
  const { f, events } = fly(false);
  assert.equal(events[0].type, 'liftoff');
  const land = events.find((e) => e.type === 'landed');
  assert.ok(land && land.upright);
  assert.ok(land.peak > 7.5 && land.peak < 9, `peak ${land.peak}`);
  assert.ok(land.airtime > 2.5 && land.airtime < 3.3, `airtime ${land.airtime}`);
  assert.equal(f.y, 0);
  assert.equal(f.airborne, false);
});

test('barrel roll completes exactly one turn and lands upright', () => {
  const { events, maxRoll } = fly(true);
  const land = events.find((e) => e.type === 'landed');
  assert.ok(land.upright);
  assert.ok(Math.abs(maxRoll - 2 * Math.PI) < 0.2, `roll ${maxRoll}`);
});

test('no second launch until the tanks have refilled', () => {
  const { f } = fly(false);
  assert.equal(canFly(f), false);
  assert.equal(launch(f), false);
  const events = [];
  for (let i = 0; i < Math.ceil((RECHARGE_TIME + 0.1) / DT); i++) events.push(...stepFlight(f, DT));
  assert.ok(events.some((e) => e.type === 'ready'));
  assert.equal(canFly(f), true);
});

test('cannot launch while already flying', () => {
  const f = createFlightState();
  launch(f);
  for (let i = 0; i < Math.round(BURN_TIME / DT) + 10; i++) stepFlight(f, DT);
  assert.equal(f.airborne, true);
  assert.equal(launch(f), false);
});
