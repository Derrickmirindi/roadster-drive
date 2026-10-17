# Test results

Grid Roadster — Created by Derrick Mirindi, Frederic Mirindi and David Sinkhonde.

Recorded 17 October 2026 on the built `dist/` site.

**Environment:** a Linux container running headless Chromium (bundled with
Playwright 1.56) using **SwiftShader software WebGL**. There is no GPU, so the
app rendered at roughly **2 frames per second** there. The browser checks
therefore wait for conditions rather than fixed times. These figures are not
performance measurements, and no performance numbers are claimed. Testing on
real phones, tablets and GPU-equipped desktops has **not** been done yet.

## Unit tests — 17 / 17 passed (`npm test`)

Physics, track and lap logic run in Node without a browser:

- 0–100 km/h in a plausible range (the app shows the measured simulated time,
  ≈ 3.6 s)
- braking stops the car and holding the brake never reverses it
- reverse only via explicit gear selection below 2 km/h; reverse speed capped
- coasting slows gradually
- steering authority falls with speed
- speed limit governs top speed; lowering it eases the car down without a jump
- cruise approaches its target gently, holds it, and disengages on brake
- cruise refuses below 20 km/h or in reverse
- handbrake increases sliding
- fixed timestep gives the same result at 30, 60 and 144 fps
- track loop is closed; tightest radius (39 m) is larger than the barrier offset
- barriers contain the car and register impacts
- reset returns the car to the centre line facing along the track
- stuck detection recovers a car pinned against a wall
- laps count only with all checkpoints crossed in order; shortcut laps are
  rejected
- crossing the line backwards cancels the lap
- lap time formatting

## Browser checks — 47 / 47 passed (`npm run test:e2e`)

Full output: [`test-results.json`](test-results.json). Screenshots:
[`screenshots/`](screenshots/).

| Area | Checks |
| --- | --- |
| Start-up | Loads without console or page errors; loader hides; render loop idles in the showroom when nothing changes |
| Credit | Exact text in the footer, not covered, at 390, 768, 844 (landscape) and 1440 px; exact text in About; also on the loading and WebGL-error screens |
| Showroom | Orbit drag and wheel zoom; About and Controls dialogs open and close with the keyboard |
| Appearance | Swatch changes only the body material (glass and wheels unchanged); colour picker applies immediately; matte and metallic change roughness and metalness; separate wheel colour; headlights off/on; reset appearance; night mode |
| Driving | Start driving; throttle accelerates and the HUD matches simulated speed; A/D change heading; brake stops without reversing; gear change refused while moving; explicit reverse works; handbrake turn |
| Speed | Limit slider changes the limit, not the current speed (108 → 108 km/h at the moment of change, then decreasing); km/h ↔ mph; cruise engages, holds 72 km/h and disengages on brake |
| Cameras | Chase → hood → overhead → chase |
| Track | Car driven into a barrier stops at 16.05 m from the centre (wall face 17 m); reset puts it back on the centre line at 0 km/h; lap timer starts at the line; a teleport "shortcut" lap is not counted |
| Pause & focus | Pause freezes the simulation and stops the render loop; Escape resumes; window blur releases held keys; driving keys ignored while the colour field has focus |
| Frame rate | Same pipeline at 30 / 60 / 144 fps: 150.96 / 150.96 / 150.81 km/h after 6 s |
| Mobile (390 px, real CDP touch events) | Steering and gas held together with two touch points; lifting one finger releases only that control; `touchcancel` releases everything; gear, camera, reset and pause buttons work; touch targets ≥ 48 px and above the credit |
| Layout | No horizontal overflow and Start button reachable at every size |
| Fallback | `?nowebgl` shows the WebGL-unavailable screen with tips and the credit |

## Known limitations

- **Arcade physics.** The handling is not a validated vehicle-dynamics model: the
  road is flat, there is no suspension, weight transfer or gearbox, and
  collisions only exist with the barrier walls (not trees, lamps or buildings,
  which stay outside the barriers).
- **Window blur in tests.** A synthetic `blur` event confirmed that keys are
  released. The automatic pause on focus loss also checks
  `document.hasFocus()`, which headless Chromium reports as still focused, so
  that pause was not observed in the test environment.
- **Real devices untested.** Frame rate, the automatic quality step-down and
  touch feel on physical phones have not been measured. Audio was not checked
  by ear.
- **Headlights.** Two spot lights light the road at night. They do not model
  real optics, beam patterns or regulations.
- **Very slow devices.** At most 0.25 s of simulation is processed per frame, so
  below about 4 fps the game runs in slow motion instead of skipping ahead.
- **Design specification.** `skill-muller-brockmann-grid-systems.json` was not
  supplied, so the interface uses the provisional Swiss-grid direction
  described in [DESIGN.md](DESIGN.md).
- **Accessibility.** Menus, settings and dialogs are keyboard- and
  screen-reader-operable with visible focus, but driving itself is visual and
  not usable without sight.
- **Single circuit.** There is one track and one car body style.
