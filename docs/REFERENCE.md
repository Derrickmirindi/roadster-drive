# Reference inspection (roadster.pplx.app)

Inspected on 16 October 2026 with REA browser capture: headless Chrome on the
author's Windows PC, 1440 × 900, accessibility tree and console only. No code or
assets were extracted.

## Observed

- A 36-second **scripted physics replay** titled "Interactive Roadster physics
  reconstruction", not a drivable game.
- Camera buttons: Follow (default), Wide, Orbit, Cutaway, Path.
- A live forces panel (gravity, suction, road contact, tyre friction, gas thrust,
  roll torque) with an Arrows toggle.
- A "How this car works" explainer linking to external sources.
- Timeline controls: play/restart, playback speed (¼×–2×), a time slider and
  chapter jumps.
- A skip link and labelled controls. Built with Three.js.

## Not present in the reference (new in this project)

Free driving, keyboard and touch controls, velocity-based speedometer, paint and
finish customisation, speed limiter, cruise control, laps and minimap, audio,
day/night.

## Relationship

Grid Roadster borrows only the general idea of camera modes and clean
instrumentation. Its code, car, circuit, interface and branding are original.

## Second inspection (17 October 2026)

The site had been redeployed (new asset hashes) and now also offers a 13-vehicle
selector, Ramp and Flight trial buttons, a mass / force-limit panel and live
height, vertical-speed and roll readouts. REA captured the HTML and CSS; the two
JavaScript bundles exceeded REA's 64 KiB capture limit, and only the first
~66 KB of the main bundle could be read through a web fetch. That portion
showed procedural geometry (no model files), a closed-form time-sampled
trajectory, g = 9.81 and a 2,000 kg reference mass. No analytics or tracking
requests were observed.

## Stunt lab in this project

Grid Roadster's Stunt lab offers the same *kinds* of tools — replay timeline,
chapters, playback speed, vehicle swap, free-body diagram, force arrows,
cutaway, path, Follow / Wide / Orbit cameras, Ramp and Flight trials — but is
an independent implementation: its own course, its own forward-integrated
physics (friction-limited half-pipe climb and jet flight), its own 13
procedural vehicles, interface and wording. No code, assets or text from the
reference were copied, and it makes no claims about any real vehicle or event.
