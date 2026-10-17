# Third-party components

Grid Roadster — Created by Derrick Mirindi, Frederic Mirindi and David Sinkhonde.

| Component | Version | Use | Licence | Source | Licence text |
| --- | --- | --- | --- | --- | --- |
| Three.js | r185 (0.185.1) | 3D rendering (vendored build files) | MIT | https://github.com/mrdoob/three.js | `public/vendor/three/LICENSE.txt` |
| Inter | 4.x variable | Interface typeface (vendored woff2) | SIL Open Font License 1.1 | https://github.com/rsms/inter | `public/fonts/Inter-OFL.txt` |
| @types/three | 0.185.x | TypeScript type definitions (development only, not shipped) | MIT | https://github.com/three-types/three-ts-types | — |
| TypeScript | 5.6+ | Compiler (development only, not shipped) | Apache-2.0 | https://github.com/microsoft/TypeScript | — |

## Assets created for this project

All of the following are generated in code at runtime and are covered by this
project's MIT licence:

- **GR-1 roadster** — procedural geometry from Three.js primitives
  (`src/car-model.ts`). No external 3D model is used.
- **Circuit and scenery** — road ribbons, kerbs, barriers, gantry, trees,
  buildings and lamp posts (`src/environment.ts`).
- **Textures** — asphalt grain, grass, dashed lines, kerbs, chequered line and
  contact shadow, drawn on canvases at runtime.
- **Icons** — inline SVG line icons in `index.html`.
- **Sound** — engine, tyre and impact sounds synthesised with the Web Audio
  API (`src/audio.ts`). No audio files are used.
