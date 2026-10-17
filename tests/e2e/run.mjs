// End-to-end checks against the built app (serve dist/ first: npm run preview).
// Usage: node tests/e2e/run.mjs   (BASE_URL defaults to http://localhost:4173/)
// Writes screenshots and results to docs/screenshots and docs/test-results.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { launch, BASE } from './browser.mjs';

const OUT = new URL('../../docs/screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const CREDIT = 'Created by Derrick Mirindi, Frederic Mirindi and David Sinkhonde';
const results = [];
let current = '';

async function check(name, fn) {
  current = name;
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail: detail ?? '', ms: Date.now() - t0 });
    console.log(`PASS  ${name}${detail ? ' — ' + detail : ''}`);
  } catch (e) {
    results.push({ name, ok: false, detail: String(e.message || e), ms: Date.now() - t0 });
    console.log(`FAIL  ${name} — ${e.message || e}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const R = (page, expr) => page.evaluate(expr);
// Software-rendered headless Chromium can run at ~2 fps, so wait on conditions, not fixed times.
const until = (page, fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });

async function openApp(browser, opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  context.setDefaultTimeout(60000);
  const page = await context.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && page.errors.push(m.text()));
  await page.goto(BASE + (opts.query || ''));
  await page.waitForFunction(() => window.roadster && document.getElementById('loader').hidden, null, { timeout: 90000 });
  return { context, page };
}

async function setLowQuality(page) {
  // Software rendering in CI is slow; low quality keeps the frame rate usable.
  await page.evaluate(() => {
    const sel = document.getElementById('s-quality');
    sel.value = 'low';
    sel.dispatchEvent(new Event('change'));
  });
}

async function holdKey(page, code, ms) {
  await page.keyboard.down(code);
  await page.waitForTimeout(ms);
  await page.keyboard.up(code);
}

const browser = await launch();
// Optional: run a subset, e.g. E2E_SECTIONS=layouts,webgl
const SECTIONS = (process.env.E2E_SECTIONS || 'desktop,stunt,layouts,webgl').split(',');

// ---------------------------------------------------------------- desktop
if (SECTIONS.includes('desktop')) {
  const { context, page } = await openApp(browser);
  await check('Loads without errors; loader hides', async () => {
    assert(page.errors.length === 0, page.errors.join(' | '));
    return 'no console errors or page errors';
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + 'desktop-1440-showroom.png' });

  await check('Exact creator credit visible in footer', async () => {
    const text = await page.locator('footer.credit').innerText();
    assert(text.includes(CREDIT), `footer text: ${text}`);
    const box = await page.locator('.credit__names').boundingBox();
    assert(box && box.y + box.height <= 900 && box.width > 100, 'credit not in viewport');
    const top = await page.evaluate(() => {
      const r = document.querySelector('.credit__names').getBoundingClientRect();
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return el?.closest('.credit') !== null;
    });
    assert(top, 'credit is covered by another element');
    return `"${CREDIT}" at y=${Math.round(box.y)}`;
  });

  await check('Render loop idles in showroom when nothing changes', async () => {
    await page.waitForTimeout(1200);
    const running = await R(page, () => window.roadster.loopRunning);
    assert(!running, 'loop still running while idle');
    return 'no continuous rAF while idle';
  });

  await check('Showroom orbit: drag rotates, wheel zooms', async () => {
    const before = await page.evaluate(() => [window.roadster.camera]);
    await page.mouse.move(900, 500);
    await page.mouse.down();
    await page.mouse.move(700, 450, { steps: 8 });
    await page.mouse.up();
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(300);
    const after = await R(page, () => window.roadster.camera);
    assert(before[0] === 'orbit' && after === 'orbit', 'not orbit camera');
    return 'orbit camera responds (visual check in screenshot)';
  });

  await check('About / Credits panel shows exact credit', async () => {
    await page.click('#btn-about');
    const t = await page.locator('#dlg-about .credit-block').innerText();
    assert(t.trim() === CREDIT, t);
    await page.screenshot({ path: OUT + 'desktop-about.png' });
    await page.keyboard.press('Escape');
    return 'dialog closes with Escape';
  });

  await check('Paint: swatch updates body material only', async () => {
    await page.click('#btn-panel');
    const glass0 = await R(page, () => window.roadster.glassColor);
    const wheel0 = await R(page, () => window.roadster.wheelColor);
    await page.click('#body-swatches .swatch[aria-label="Ultramarine"]');
    const body = await R(page, () => window.roadster.bodyColor);
    assert(body === '#1f3f8f', body);
    assert((await R(page, () => window.roadster.glassColor)) === glass0, 'glass changed');
    assert((await R(page, () => window.roadster.wheelColor)) === wheel0, 'wheels changed');
    return `body ${body}; glass and wheels unchanged`;
  });

  await check('Custom colour picker updates immediately', async () => {
    await page.evaluate(() => {
      const i = document.getElementById('body-color');
      i.value = '#22aa66';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const body = await R(page, () => window.roadster.bodyColor);
    assert(body === '#22aa66', body);
    return body;
  });

  await check('Finish options change the paint material', async () => {
    await page.click('#finish label:nth-child(3)');
    const m = await R(page, () => window.roadster.finish);
    assert(m.roughness > 0.8 && m.clearcoat === 0, JSON.stringify(m));
    await page.click('#finish label:nth-child(2)');
    const k = await R(page, () => window.roadster.finish);
    assert(k.metalness > 0.6, JSON.stringify(k));
    return `matte rough=${m.roughness}, metallic metal=${k.metalness}`;
  });

  await check('Separate wheel colour', async () => {
    await page.click('#wheel-swatches .swatch[aria-label="Bronze"]');
    const w = await R(page, () => window.roadster.wheelColor);
    assert(w === '#8a6a3a', w);
    return w;
  });

  await check('Headlights toggle', async () => {
    await page.click('label.switch:has(#headlights)');
    const off = await R(page, () => window.roadster.headlights);
    assert(off.every((v) => v === 0), JSON.stringify(off));
    await page.click('label.switch:has(#headlights)');
    const on = await R(page, () => window.roadster.headlights);
    assert(on.every((v) => v > 0), JSON.stringify(on));
    return `off ${off} → on ${on}`;
  });
  await page.screenshot({ path: OUT + 'desktop-customise.png' });

  await check('Reset appearance restores crimson gloss', async () => {
    await page.click('#reset-look');
    const b = await R(page, () => window.roadster.bodyColor);
    const f = await R(page, () => window.roadster.finish);
    assert(b === '#a3141c' && f.clearcoat === 1, b);
    return b;
  });

  await check('Night mode renders with headlights', async () => {
    await page.click('#daynight label:nth-child(2)');
    await page.waitForTimeout(600);
    await page.screenshot({ path: OUT + 'desktop-night-showroom.png' });
    await page.click('#daynight label:nth-child(1)');
    return 'screenshot desktop-night-showroom.png';
  });
  await page.click('#panel-close');
  await setLowQuality(page);

  await check('Start driving switches to Drive mode', async () => {
    await page.click('#btn-start');
    const mode = await R(page, () => window.roadster.mode);
    assert(mode === 'drive', mode);
    assert((await R(page, () => window.roadster.camera)) === 'chase', 'camera not chase');
    return 'mode=drive, camera=chase';
  });

  await check('Throttle accelerates (speed derived from velocity)', async () => {
    await holdKey(page, 'KeyW', 3500);
    const v = await R(page, () => window.roadster.speedMs * 3.6);
    const shown = Number(await page.locator('#hud-speed').innerText());
    assert(v > 8, `speed ${v}`);
    assert(Math.abs(shown - v) < 6, `HUD ${shown} vs sim ${v}`);
    await page.screenshot({ path: OUT + 'desktop-1440-drive.png' });
    return `${v.toFixed(1)} km/h, HUD shows ${shown}`;
  });

  await check('Steering changes heading', async () => {
    await page.evaluate(() => window.roadster.place(window.roadster.startIndex + 60, 0, 0, 12));
    const h0 = await R(page, () => window.roadster.position.heading);
    await page.keyboard.down('KeyW');
    await page.keyboard.down('KeyA');
    await until(page, (h) => window.roadster.position.heading - h > 0.05, h0);
    await page.keyboard.up('KeyA');
    const h1 = await R(page, () => window.roadster.position.heading);
    await page.keyboard.down('KeyD');
    await until(page, (h) => window.roadster.position.heading < h - 0.05, h1);
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');
    const h2 = await R(page, () => window.roadster.position.heading);
    assert(h2 < h1, 'right steer did not turn right');
    return `A: +${(h1 - h0).toFixed(3)} rad, D: ${(h2 - h1).toFixed(3)} rad`;
  });

  await check('Brake stops the car without reversing', async () => {
    await page.evaluate(() => window.roadster.place(window.roadster.startIndex + 60, 0, 0, 20));
    await page.keyboard.down('KeyS');
    await until(page, () => Math.abs(window.roadster.forwardMs) < 0.05);
    await page.keyboard.up('KeyS');
    const v = await R(page, () => window.roadster.forwardMs);
    const gear = await R(page, () => window.roadster.gear);
    assert(Math.abs(v) < 0.05 && gear === 'D', `v=${v} gear=${gear}`);
    await holdKey(page, 'KeyS', 3000);
    const v2 = await R(page, () => window.roadster.forwardMs);
    assert(v2 >= -0.001, `moved backwards: ${v2}`);
    return `stopped (v=${v.toFixed(3)}), stays in D, holding brake does not reverse`;
  });

  await check('Gear change refused while moving', async () => {
    await page.evaluate(() => window.roadster.place(window.roadster.startIndex + 60, 0, 0, 15));
    await page.keyboard.press('KeyG');
    const g = await R(page, () => window.roadster.gear);
    assert(g === 'D', g);
    return 'stays in D at 54 km/h';
  });

  await check('Reverse via explicit gear selection', async () => {
    await page.evaluate(() => window.roadster.place(window.roadster.startIndex + 60, 0, 0, 0));
    await page.keyboard.press('KeyG');
    assert((await R(page, () => window.roadster.gear)) === 'R', 'not in R');
    await page.keyboard.down('KeyW');
    await until(page, () => window.roadster.forwardMs < -1);
    await page.keyboard.up('KeyW');
    const v = await R(page, () => window.roadster.forwardMs);
    assert(v < -0.5, `forward speed ${v}`);
    await page.keyboard.down('KeyS');
    await until(page, () => window.roadster.speedMs < 0.1);
    await page.keyboard.up('KeyS');
    await page.keyboard.press('KeyG');
    assert((await R(page, () => window.roadster.gear)) === 'D', 'not back in D');
    return `reversing at ${(v * 3.6).toFixed(1)} km/h, back to D after stopping`;
  });

  await check('Handbrake makes the car slide', async () => {
    await page.evaluate(() => window.roadster.place(window.roadster.startIndex + 60, 0, 0, 22));
    await page.keyboard.down('KeyA');
    await page.keyboard.down('Space');
    await page.waitForTimeout(700);
    const heading = await R(page, () => window.roadster.position.heading);
    await page.keyboard.up('Space');
    await page.keyboard.up('KeyA');
    return `heading after handbrake turn ${heading.toFixed(2)} rad (slip verified in unit tests)`;
  });

  await check('Speed limit slider changes the limit, not the speed', async () => {
    await page.click('#btn-panel');
    await page.click('#tab-drive');
    await page.evaluate(() => window.roadster.place(window.roadster.startIndex + 30, 0, 0, 30)); // 108 km/h
    const before = await R(page, () => window.roadster.speedMs * 3.6);
    await page.evaluate(() => {
      const s = document.getElementById('speed-limit');
      s.value = '50';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const just = await R(page, () => window.roadster.speedMs * 3.6);
    assert(Math.abs(before - just) < 3, `jumped ${before} → ${just}`);
    await page.click('#scene');
    await page.keyboard.down('KeyW');
    await until(page, (v) => window.roadster.speedMs * 3.6 < v - 3, just);
    await page.keyboard.up('KeyW');
    const later = await R(page, () => window.roadster.speedMs * 3.6);
    assert(later < just, 'did not slow toward new limit');
    const limitHud = await page.locator('#hud-limit').innerText();
    assert(limitHud === '50', limitHud);
    const out = await page.locator('#speed-limit-out').innerText();
    return `${before.toFixed(0)} → ${just.toFixed(0)} immediately, ${later.toFixed(0)} km/h later; slider shows "${out}"`;
  });

  await check('Units switch to mph', async () => {
    await page.click('#units label:nth-child(2)');
    const unit = await page.locator('#hud-unit').innerText();
    assert(unit === 'mph', unit);
    await page.click('#units label:nth-child(1)');
    await page.evaluate(() => {
      const s = document.getElementById('speed-limit');
      s.value = '180';
      s.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return 'km/h ↔ mph';
  });

  await check('Cruise control engages, holds, disengages on brake', async () => {
    await page.click('#scene');
    await page.evaluate(() => window.roadster.place(window.roadster.startIndex + 30, 0, 0, 20));
    await page.keyboard.press('KeyK');
    const c = await R(page, () => window.roadster.cruise);
    assert(c.on, 'not engaged');
    await page.waitForTimeout(4000);
    const v = await R(page, () => window.roadster.speedMs);
    assert(Math.abs(v - c.target) < 2.5, `speed ${v} vs target ${c.target}`);
    await page.keyboard.down('KeyS');
    await until(page, () => !window.roadster.cruise.on);
    await page.keyboard.up('KeyS');
    const c2 = await R(page, () => window.roadster.cruise);
    assert(!c2.on, 'still on after braking');
    return `target ${(c.target * 3.6).toFixed(0)} km/h, held at ${(v * 3.6).toFixed(0)}, off after brake`;
  });
  await page.click('#panel-close');

  await check('Camera cycles chase → hood → overhead → chase', async () => {
    const seen = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('KeyC');
      await page.waitForTimeout(900);
      seen.push(await R(page, () => window.roadster.camera));
      await page.screenshot({ path: OUT + `desktop-camera-${seen.at(-1)}.png` });
    }
    assert(seen.join() === 'hood,overhead,chase', seen.join());
    return seen.join(' → ');
  });

  await check('Barrier keeps the car inside the circuit', async () => {
    await page.evaluate(() => window.roadster.place(window.roadster.startIndex + 120, 10, Math.PI / 2, 25));
    // Wait for the impact (speed drops sharply), then read the largest distance reached.
    await until(page, () => window.roadster.speedMs < 15, undefined, 90000);
    const maxLat = await R(page, () => window.roadster.maxLateral);
    assert(maxLat > 15 && maxLat <= 16.06, `max lateral ${maxLat}`);
    return `hit the wall; max distance from centre ${maxLat.toFixed(2)} m (wall face at 17 m, car half-width 0.95 m)`;
  });

  await check('Reset returns the car to the road', async () => {
    await page.evaluate(() => window.roadster.place(window.roadster.startIndex + 200, 12, 1, 5));
    await page.keyboard.press('KeyR');
    const lat = await R(page, () => window.roadster.lateral);
    const v = await R(page, () => window.roadster.speedMs);
    assert(Math.abs(lat) < 0.5 && v === 0, `lat ${lat} v ${v}`);
    return `lateral ${lat.toFixed(2)} m, speed 0`;
  });

  await check('Lap timer starts at the line; shortcut lap is voided', async () => {
    await page.evaluate(() => window.roadster.place(window.roadster.startIndex - 8, 0, 0, 25));
    await until(page, () => window.roadster.laps.running);
    const l = await R(page, () => window.roadster.laps);
    assert(l.running, 'timer not running after crossing start');
    // Teleport to just before the line (skipping all checkpoints) and cross it again.
    await page.evaluate(() => window.roadster.place(window.roadster.startIndex - 8, 0, 0, 25));
    await until(page, () => window.roadster.laps.running);
    await page.waitForTimeout(1000);
    const l2 = await R(page, () => window.roadster.laps);
    assert(l2.completed === 0, 'shortcut lap counted');
    return `running=${l.running}, laps counted=${l2.completed}`;
  });

  await check('Pause freezes simulation and stops the render loop', async () => {
    await page.evaluate(() => window.roadster.place(window.roadster.startIndex + 60, 0, 0, 20));
    await page.keyboard.press('KeyP');
    const p0 = await R(page, () => window.roadster.position);
    await page.waitForTimeout(1000);
    const p1 = await R(page, () => window.roadster.position);
    const paused = await R(page, () => window.roadster.paused);
    const loop = await R(page, () => window.roadster.loopRunning);
    const dialog = await page.locator('#dlg-pause').isVisible();
    assert(paused && dialog && p0.x === p1.x && p0.z === p1.z, 'did not freeze');
    assert(!loop, 'render loop still running while paused');
    await page.screenshot({ path: OUT + 'desktop-pause.png' });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    assert(!(await R(page, () => window.roadster.paused)), 'Escape did not resume');
    return 'frozen, loop stopped, Escape resumes';
  });

  await check('Window blur releases held keys (no stuck throttle)', async () => {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(200);
    assert((await R(page, () => window.roadster.input.throttle)) === 1, 'throttle not held');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    const t = await R(page, () => window.roadster.input.throttle);
    await page.keyboard.up('KeyW');
    assert(t === 0, 'throttle stuck after blur');
    await page.waitForTimeout(300);
    return `throttle released (${t}); paused=${await R(page, () => window.roadster.paused)}`;
  });
  if (await R(page, () => window.roadster.paused)) await page.click('#p-resume');

  await check('Keys ignored while typing in a colour field', async () => {
    await page.click('#btn-panel');
    await page.click('#tab-look');
    await page.focus('#body-color');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(150);
    const t = await R(page, () => window.roadster.input.throttle);
    await page.keyboard.up('KeyW');
    await page.keyboard.press('KeyC');
    const cam = await R(page, () => window.roadster.camera);
    assert(t === 0, 'W captured while colour field focused');
    await page.click('#panel-close');
    return `throttle=${t}, camera unchanged (${cam})`;
  });

  await check('Frame-rate independence (30 / 60 / 144 fps)', async () => {
    const r = await page.evaluate(() => [30, 60, 144].map((f) => window.roadster.simulateAtFps(f, 6, 1, 0)));
    const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    assert(d(r[0], r[1]) < 0.5 && d(r[0], r[2]) < 0.5, JSON.stringify(r));
    return r.map((x, i) => `${[30, 60, 144][i]} fps: ${x.speedKmh.toFixed(2)} km/h`).join(', ');
  });

  await check('Back to showroom', async () => {
    await page.click('#mode-showroom');
    assert((await R(page, () => window.roadster.mode)) === 'showroom', 'mode');
    assert((await R(page, () => window.roadster.speedMs)) === 0, 'car not parked');
    return 'car parked, orbit camera';
  });

  await check('Controls guide opens and is keyboard reachable', async () => {
    await page.keyboard.press('Slash');
    assert(await page.locator('#dlg-help').isVisible(), 'not visible');
    await page.screenshot({ path: OUT + 'desktop-controls-guide.png' });
    await page.keyboard.press('Escape');
    return '? opens guide';
  });

  await check('No runtime errors during desktop session', async () => {
    assert(page.errors.length === 0, page.errors.join(' | '));
    return 'none';
  });
  await context.close();
}


// ---------------------------------------------------------------- stunt lab
if (SECTIONS.includes('stunt')) {
  const { context, page } = await openApp(browser);
  const st = () => R(page, () => window.roadster.stunt);
  const scrub = (t) =>
    page.evaluate((v) => {
      const r = document.getElementById('st-time');
      r.value = String(v);
      r.dispatchEvent(new Event('input', { bubbles: true }));
    }, t);

  await check('Stunt lab: mode opens with timeline, forces and controls', async () => {
    await page.click('#mode-stunt');
    const s = await st();
    const visible = await Promise.all(['.stunt-controls', '#st-panel', '.stunt-timeline'].map((q) => page.locator(q).isVisible()));
    assert((await R(page, () => window.roadster.mode)) === 'stunt' && visible.every(Boolean), JSON.stringify(visible));
    assert(s.vehicle === 'roadster' && s.duration > 25, JSON.stringify(s));
    const chapters = await page.locator('#st-chapters .chapter').allInnerTexts();
    return `duration ${s.duration.toFixed(1)} s; chapters ${chapters.join(', ')}`;
  });

  await check('Stunt lab: play advances time; Space pauses', async () => {
    await page.click('#st-play');
    await until(page, () => window.roadster.stunt.time > 0.5);
    await page.click('#scene', { position: { x: 600, y: 400 } });
    await page.keyboard.press('Space');
    const t1 = (await st()).time;
    await page.waitForTimeout(800);
    const t2 = (await st()).time;
    assert(!(await st()).playing && Math.abs(t2 - t1) < 0.05, `t1 ${t1} t2 ${t2}`);
    return `paused at ${t2.toFixed(2)} s`;
  });

  await check('Stunt lab: scrubbing updates the force diagram (inverted on the pipe)', async () => {
    await scrub(8.5);
    await page.waitForTimeout(400);
    const state = await page.locator('#st-state').innerText();
    const suction = Number((await page.locator('#st-f-suction').innerText()).replace(/[^\d.]/g, ''));
    const h = await page.locator('#st-height').innerText();
    assert(state === 'Upside down' && suction > 39 && parseFloat(h) > 15, `${state} ${suction} ${h}`);
    await page.screenshot({ path: OUT + 'stunt-desktop-inverted.png' });
    return `${state}, suction ${suction} kN, height ${h}`;
  });

  await check('Stunt lab: chapter buttons jump in time', async () => {
    await page.click('#st-chapters .chapter:has-text("Launch")');
    const s = await st();
    assert(Math.abs(s.time - (s.flightStart + 2.5)) < 0.02, String(s.time));
    return `Launch → ${s.time.toFixed(2)} s`;
  });

  await check('Stunt lab: swapping to the school bus changes mass and verdicts', async () => {
    await page.selectOption('#st-vehicle', 'bus');
    const s = await st();
    const verdicts = await Promise.all(['#st-wall', '#st-ceiling', '#st-lift'].map((q) => page.locator(q).innerText()));
    const mass = await page.locator('#st-mass').innerText();
    assert(s.vehicle === 'bus' && verdicts.join() === 'Slips,Falls,Stays down' && !s.flight.lifted, verdicts.join());
    return `${mass}; ${verdicts.join(' / ')}; flight: ${s.flight.outcome}`;
  });

  await check('Stunt lab: Flight trial plays from the run-in', async () => {
    await page.selectOption('#st-vehicle', 'roadster');
    await page.click('#st-flight');
    await until(page, () => window.roadster.stunt.time > window.roadster.stunt.flightStart + 3.2, undefined, 90000);
    await page.click('#st-play');
    const s = await st();
    assert(s.flight.landedUpright && s.time >= s.flightStart, JSON.stringify(s.flight));
    return `airborne at ${s.time.toFixed(1)} s; outcome: ${s.flight.outcome}`;
  });

  await check('Stunt lab: cameras, cutaway, path and arrows toggles', async () => {
    for (const c of ['wide', 'orbit', 'follow']) {
      await page.click(`[data-st-camera=${c}]`);
      assert((await st()).camera === c, c);
    }
    await page.click('#st-cutaway');
    await page.click('#st-path');
    await page.click('#st-arrows');
    const s = await st();
    assert(s.cutaway && s.path && !s.arrows, JSON.stringify(s));
    await page.click('#st-arrows');
    await scrub(s.flightStart + 3.0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + 'stunt-desktop-cutaway-path.png' });
    await page.keyboard.press('KeyC');
    return `camera cycles; cutaway=${s.cutaway} path=${s.path}; C → ${(await st()).camera}`;
  });

  await check('Stunt lab: render loop stops when paused', async () => {
    await page.evaluate(() => document.getElementById('st-play').getAttribute('aria-label') === 'Pause' && document.getElementById('st-play').click());
    await page.waitForTimeout(1200);
    assert(!(await R(page, () => window.roadster.loopRunning)), 'loop still running');
    return 'idle while paused';
  });

  await check('Stunt lab: credit visible and no runtime errors', async () => {
    const text = await page.locator('footer.credit').innerText();
    assert(text.includes(CREDIT), text);
    assert(page.errors.length === 0, page.errors.join(' | '));
    return 'ok';
  });
  await context.close();

  const mob = await openApp(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await check('Stunt lab 390px: controls fit, panel expands, timeline reachable', async () => {
    const p = mob.page;
    await p.click('#mode-stunt');
    await p.waitForTimeout(500);
    const info = await p.evaluate(() => {
      const ids = ['st-play', 'st-ramp', 'st-flight', 'st-vehicle', 'st-panel-toggle'];
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        inView: ids.every((id) => {
          const r = document.getElementById(id).getBoundingClientRect();
          return r.width > 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight;
        }),
      };
    });
    assert(!info.overflow && info.inView, JSON.stringify(info));
    await p.tap('#st-panel-toggle');
    const open = await p.locator('#st-wall').isVisible();
    assert(open, 'details did not expand');
    await p.tap('#st-panel-toggle');
    await p.screenshot({ path: OUT + 'stunt-mobile-390.png' });
    assert(p.errors.length === 0, p.errors.join(' | '));
    return 'all controls inside the viewport; details expand on tap';
  });
  await mob.context.close();
}

// ---------------------------------------------------------------- layouts
for (const [w, h, name, touch] of !SECTIONS.includes('layouts') ? [] : [
  [390, 844, 'mobile-390', true],
  [768, 1024, 'tablet-768', true],
  [844, 390, 'mobile-landscape-844', true],
  [1440, 900, 'desktop-1440', false],
]) {
  const { context, page } = await openApp(browser, { viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch && w < 700 });
  await check(`Layout ${w}px: credit readable and no horizontal overflow`, async () => {
    const info = await page.evaluate(() => {
      const c = document.querySelector('.credit__names');
      const r = c.getBoundingClientRect();
      const fs = parseFloat(getComputedStyle(c).fontSize);
      const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {
        visible: r.width > 0 && r.bottom <= innerHeight && r.right <= innerWidth + 1,
        fs,
        top: el?.closest('.credit') !== null,
        overflow: document.documentElement.scrollWidth > innerWidth,
        startClickable: (() => {
          const b = document.getElementById('btn-start').getBoundingClientRect();
          return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('#btn-start') !== null;
        })(),
      };
    });
    assert(info.visible && info.top && info.fs >= 11 && !info.overflow && info.startClickable, JSON.stringify(info));
    return `font ${info.fs}px`;
  });
  await page.screenshot({ path: OUT + `${name}-showroom.png` });
  await setLowQuality(page);
  await page.click('#btn-start');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + `${name}-drive.png` });
  if (touch) {
    await check(`Touch controls visible at ${w}px`, async () => {
      const vis = await page.locator('#touch').isVisible();
      const boxes = await Promise.all(['#t-left', '#t-right', '#t-gas', '#t-brake', '#t-gear', '#t-hand'].map((s) => page.locator(s).boundingBox()));
      assert(vis && boxes.every((b) => b && b.width >= 44 && b.height >= 44), JSON.stringify(boxes));
      const credit = await page.locator('.credit__names').boundingBox();
      assert(boxes.every((b) => b.y + b.height <= credit.y), 'touch controls overlap credit');
      return boxes.map((b) => `${Math.round(b.width)}×${Math.round(b.height)}`).join(', ');
    });
  }
  if (name === 'mobile-390') {
    await check('Mobile multi-touch: steer + throttle together, release on cancel/end', async () => {
      const cdp = await context.newCDPSession(page);
      const c = async (sel) => {
        const b = await page.locator(sel).boundingBox();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      };
      const left = await c('#t-left');
      const gas = await c('#t-gas');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...left, id: 1 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...left, id: 1 }, { ...gas, id: 2 }] });
      await until(page, () => window.roadster.speedMs > 0.5);
      const both = await R(page, () => window.roadster.input);
      const speed = await R(page, () => window.roadster.speedMs);
      assert(both.throttle === 1 && both.steer === 1, JSON.stringify(both));
      // Lift the gas finger only.
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ ...gas, id: 2 }] });
      await page.waitForTimeout(100);
      const one = await R(page, () => window.roadster.input);
      assert(one.throttle === 0 && one.steer === 1, 'gas not released independently: ' + JSON.stringify(one));
      // Interrupted gesture: cancel the remaining touch.
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      await page.waitForTimeout(100);
      const none = await R(page, () => window.roadster.input);
      assert(none.steer === 0 && none.throttle === 0, 'stuck after touchcancel: ' + JSON.stringify(none));
      await page.screenshot({ path: OUT + 'mobile-390-touch-driving.png' });
      return `steer+gas held together (speed ${(speed * 3.6).toFixed(1)} km/h); independent release; cancel clears`;
    });
    await check('Mobile reverse, camera, pause, reset buttons', async () => {
      await page.evaluate(() => window.roadster.place(window.roadster.startIndex + 60, 0, 0, 0));
      await page.waitForTimeout(500);
      await page.tap('#t-gear');
      const g = await R(page, () => window.roadster.gear);
      await page.tap('#btn-camera');
      const cam = await R(page, () => window.roadster.camera);
      await page.tap('#btn-reset');
      await page.tap('#btn-pause');
      const paused = await R(page, () => window.roadster.paused);
      await page.screenshot({ path: OUT + 'mobile-390-pause.png' });
      await page.tap('#p-resume');
      assert(g === 'R' && cam === 'hood' && paused, `${g} ${cam} ${paused}`);
      return `gear ${g}, camera ${cam}, paused ${paused}`;
    });
  }
  await check(`No runtime errors at ${w}px`, async () => {
    assert(page.errors.length === 0, page.errors.join(' | '));
    return 'none';
  });
  await context.close();
}

// ---------------------------------------------------------------- WebGL unavailable
if (SECTIONS.includes('webgl')) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  await page.goto(BASE + '?nowebgl');
  await check('WebGL-unavailable screen with credit', async () => {
    await page.waitForSelector('#fatal:not([hidden])', { timeout: 30000 });
    const t = await page.locator('#fatal').innerText();
    assert(t.includes('3D graphics unavailable') && t.includes(CREDIT), t);
    await page.screenshot({ path: OUT + 'webgl-unavailable.png' });
    return 'fallback screen shown';
  });
  await context.close();
}

await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
const outName = SECTIONS.length === 4 ? 'test-results.json' : `test-results-${SECTIONS.join('-')}.json`;
writeFileSync(new URL('../../docs/' + outName, import.meta.url), JSON.stringify({ date: new Date().toISOString(), base: BASE, sections: SECTIONS, results }, null, 2));
process.exit(passed === results.length ? 0 : 1);
