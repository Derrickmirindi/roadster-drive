/**
 * Original test-circuit environment: road ribbon, markings, kerbs, barriers,
 * start gantry, simple architectural scenery, sky and lighting (day / night).
 * All geometry and textures are generated at runtime.
 */
import * as THREE from 'three';
import { TrackPath } from './track-path.js';
import { BARRIER_OFFSET, KERB_WIDTH, ROAD_HALF_WIDTH, SCENERY_CLEARANCE } from './world-rules.js';

export type Quality = 'low' | 'medium' | 'high';

const PALETTE = {
  daySky: new THREE.Color(0xbfcad3),
  dayHorizon: new THREE.Color(0xe6e3dc),
  nightSky: new THREE.Color(0x07090d),
  nightHorizon: new THREE.Color(0x141821),
  grass: 0x6c745b,
  asphalt: 0x2a2a2c,
  line: 0xf2efe8,
  red: 0xc8231b,
  concrete: 0xd8d4cc,
  tree: 0x3f4a35,
  trunk: 0x4a3c30,
  building: 0xe7e3dc,
};

/** Simple seeded PRNG so scenery is identical on every load. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build a flat ribbon between two lateral offsets along the track. */
function ribbon(track: TrackPath, inner: number, outer: number, y: number, uvScale = 1): THREE.BufferGeometry {
  const n = track.count;
  const pos = new Float32Array((n + 1) * 2 * 3);
  const uv = new Float32Array((n + 1) * 2 * 2);
  const idx: number[] = [];
  for (let k = 0; k <= n; k++) {
    const s = track.sample(k);
    const o = k * 6;
    pos[o] = s.x + s.nx * inner;
    pos[o + 1] = y;
    pos[o + 2] = s.z + s.nz * inner;
    pos[o + 3] = s.x + s.nx * outer;
    pos[o + 4] = y;
    pos[o + 5] = s.z + s.nz * outer;
    const v = (k * track.spacing) / uvScale;
    uv.set([0, v, 1, v], k * 4);
  }
  // Choose the winding so faces point up (visible from above), whichever side
  // of the centre line the ribbon is on.
  const ax = pos[0], az = pos[2];
  const bx = pos[3], bz = pos[5];
  const cx = pos[6], cz = pos[8];
  const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az); // y of (b−a)×(c−a)
  const up = ny > 0;
  for (let k = 0; k < n; k++) {
    const a = k * 2;
    if (up) idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    else idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Ensure normals point up regardless of winding.
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  return g;
}

/** Vertical wall (barrier) following the track at a lateral offset. */
function wall(track: TrackPath, offset: number, height: number, thickness: number): THREE.BufferGeometry {
  const n = track.count;
  const positions: number[] = [];
  const normals: number[] = [];
  const side = Math.sign(offset);
  const inner = offset;
  const outer = offset + side * thickness;
  for (let k = 0; k < n; k++) {
    const a = track.sample(k);
    const b = track.sample(k + 1);
    const p = (s: typeof a, off: number, y: number) => [s.x + s.nx * off, y, s.z + s.nz * off];
    // Inner face (towards the road), outer face, and top.
    const faces: Array<[number, number, number[]]> = [
      [inner, inner, [-side * a.nx, 0, -side * a.nz]],
      [outer, outer, [side * a.nx, 0, side * a.nz]],
    ];
    for (const [o1, , nrm] of faces) {
      const q = [p(a, o1, 0), p(b, o1, 0), p(b, o1, height), p(a, o1, height)];
      positions.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
      for (let i = 0; i < 6; i++) normals.push(...nrm);
    }
    const t = [p(a, inner, height), p(b, inner, height), p(b, outer, height), p(a, outer, height)];
    positions.push(...t[0], ...t[1], ...t[2], ...t[0], ...t[2], ...t[3]);
    for (let i = 0; i < 6; i++) normals.push(0, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return g;
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export class Environment {
  readonly scene: THREE.Scene;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private readonly skyMaterial: THREE.ShaderMaterial;
  private readonly markingMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly lampMaterial: THREE.MeshStandardMaterial;
  private readonly windowMaterial: THREE.MeshStandardMaterial;
  private readonly sceneryGroup = new THREE.Group();
  private night = false;
  private envDay: THREE.Texture | null = null;
  private envNight: THREE.Texture | null = null;
  readonly startIndex: number;

  constructor(
    readonly track: TrackPath,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    const scene = new THREE.Scene();
    this.scene = scene;
    scene.fog = new THREE.Fog(PALETTE.dayHorizon, 220, 1100);

    // Sky dome with a vertical gradient.
    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: PALETTE.daySky.clone() },
        horizon: { value: PALETTE.dayHorizon.clone() },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vDir; void main(){ float h = clamp(vDir.y*1.6,0.0,1.0); gl_FragColor = vec4(mix(horizon, top, h),1.0); }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), this.skyMaterial);
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    scene.add(sky);
    sky.onBeforeRender = (_r, _s, camera) => sky.position.copy(camera.position);

    // Lights.
    this.hemi = new THREE.HemisphereLight(0xeef0f0, 0x4d4a42, 0.9);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff6e8, 2.6);
    this.sun.position.set(-60, 110, -40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -40;
    sc.right = 40;
    sc.top = 40;
    sc.bottom = -40;
    sc.near = 10;
    sc.far = 300;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // Ground.
    const grassTex = canvasTexture(256, 256, (g) => {
      g.fillStyle = '#5f6a4e';
      g.fillRect(0, 0, 256, 256);
      const rnd = mulberry32(7);
      for (let i = 0; i < 3500; i++) {
        const v = 90 + Math.floor(rnd() * 40);
        g.fillStyle = `rgba(${v},${v + 12},${v - 20},0.18)`;
        g.fillRect(rnd() * 256, rnd() * 256, 2, 2);
      }
    });
    grassTex.repeat.set(160, 160);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: grassTex, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Run-off apron (lighter, between kerb and barrier).
    const apronMat = new THREE.MeshStandardMaterial({ color: 0x7d806f, roughness: 1 });
    for (const side of [-1, 1]) {
      const a = new THREE.Mesh(ribbon(track, side * (ROAD_HALF_WIDTH + KERB_WIDTH), side * BARRIER_OFFSET, 0.01), apronMat);
      a.receiveShadow = true;
      scene.add(a);
    }

    // Asphalt with subtle grain.
    const asphaltTex = canvasTexture(128, 128, (g) => {
      g.fillStyle = '#2a2a2c';
      g.fillRect(0, 0, 128, 128);
      const rnd = mulberry32(11);
      for (let i = 0; i < 1800; i++) {
        const v = 30 + Math.floor(rnd() * 30);
        g.fillStyle = `rgba(${v},${v},${v + 2},0.5)`;
        g.fillRect(rnd() * 128, rnd() * 128, 1, 1);
      }
    });
    const road = new THREE.Mesh(
      ribbon(track, -ROAD_HALF_WIDTH, ROAD_HALF_WIDTH, 0.02, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: asphaltTex, roughness: 0.92 }),
    );
    road.receiveShadow = true;
    scene.add(road);

    // Edge lines (solid) and centre line (dashed, via texture).
    const lineMat = new THREE.MeshStandardMaterial({ color: PALETTE.line, roughness: 0.7, emissive: 0xffffff, emissiveIntensity: 0 });
    this.markingMaterials.push(lineMat);
    for (const side of [-1, 1]) {
      const l = new THREE.Mesh(ribbon(track, side * (ROAD_HALF_WIDTH - 0.5), side * (ROAD_HALF_WIDTH - 0.25), 0.03), lineMat);
      l.receiveShadow = true;
      scene.add(l);
    }
    const dashTex = canvasTexture(4, 64, (g) => {
      g.clearRect(0, 0, 4, 64);
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, 4, 26);
    });
    const dashMat = new THREE.MeshStandardMaterial({
      color: PALETTE.line,
      map: dashTex,
      alphaTest: 0.5,
      transparent: false,
      roughness: 0.7,
      emissive: 0xffffff,
      emissiveIntensity: 0,
    });
    this.markingMaterials.push(dashMat);
    const centre = new THREE.Mesh(ribbon(track, -0.12, 0.12, 0.03, 10), dashMat);
    centre.receiveShadow = true;
    scene.add(centre);

    // Kerbs (red/white) on the corners only.
    const kerbTex = canvasTexture(4, 64, (g) => {
      g.fillStyle = '#f2efe8';
      g.fillRect(0, 0, 4, 64);
      g.fillStyle = '#c8231b';
      g.fillRect(0, 0, 4, 32);
    });
    const kerbMat = new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.75 });
    const cornerMask = track.samples.map((s) => Math.abs(s.curvature) > 1 / 160);
    for (const side of [-1, 1]) {
      const g = ribbon(track, side * ROAD_HALF_WIDTH, side * (ROAD_HALF_WIDTH + KERB_WIDTH), 0.035, 6);
      // Remove triangles on straights.
      const index = g.getIndex()!;
      const keep: number[] = [];
      for (let k = 0; k < track.count; k++) {
        if (!cornerMask[k]) continue;
        for (let j = 0; j < 6; j++) keep.push(index.getX(k * 6 + j));
      }
      g.setIndex(keep);
      const m = new THREE.Mesh(g, kerbMat);
      m.receiveShadow = true;
      scene.add(m);
    }

    // Barriers: concrete walls with a red cap band.
    const concrete = new THREE.MeshStandardMaterial({ color: PALETTE.concrete, roughness: 0.9 });
    const capMat = new THREE.MeshStandardMaterial({ color: PALETTE.red, roughness: 0.6 });
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(wall(track, side * BARRIER_OFFSET, 0.9, 0.5), concrete);
      w.castShadow = true;
      w.receiveShadow = true;
      scene.add(w);
      const cap = new THREE.Mesh(ribbon(track, side * BARRIER_OFFSET, side * (BARRIER_OFFSET + 0.5), 0.905), capMat);
      scene.add(cap);
    }

    // Start / finish: chequered band across the road and a gantry.
    this.startIndex = this.findStartIndex();
    const st = track.sample(this.startIndex);
    const chequer = canvasTexture(128, 16, (g) => {
      for (let i = 0; i < 16; i++)
        for (let j = 0; j < 2; j++) {
          g.fillStyle = (i + j) % 2 ? '#111111' : '#f2efe8';
          g.fillRect(i * 8, j * 8, 8, 8);
        }
    });
    chequer.wrapS = chequer.wrapT = THREE.ClampToEdgeWrapping;
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, 1.5),
      new THREE.MeshStandardMaterial({ map: chequer, roughness: 0.8 }),
    );
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = Math.atan2(st.tx, st.tz) + Math.PI / 2;
    line.position.set(st.x, 0.032, st.z);
    line.receiveShadow = true;
    scene.add(line);

    const heading = Math.atan2(st.tx, st.tz);
    const gantry = new THREE.Group();
    gantry.position.set(st.x, 0, st.z);
    gantry.rotation.y = heading;
    const steel = new THREE.MeshStandardMaterial({ color: 0x1f2022, roughness: 0.5, metalness: 0.6 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), steel);
      post.position.set(side * (ROAD_HALF_WIDTH + 3), 3.5, 0);
      post.castShadow = true;
      gantry.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF_WIDTH * 2 + 6.5, 1.1, 0.6), steel);
    beam.position.y = 7;
    beam.castShadow = true;
    gantry.add(beam);
    const bandMat = new THREE.MeshStandardMaterial({ color: PALETTE.red, emissive: PALETTE.red, emissiveIntensity: 0.35 });
    const band = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF_WIDTH * 2 + 6.5, 0.18, 0.62), bandMat);
    band.position.y = 6.62;
    gantry.add(band);
    scene.add(gantry);

    // Lamp posts along the main straight; emissive heads read clearly at night.
    this.lampMaterial = new THREE.MeshStandardMaterial({ color: 0xf6f1e6, emissive: 0xffe9c2, emissiveIntensity: 0 });
    this.windowMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2c30, emissive: 0xffd9a0, emissiveIntensity: 0 });
    this.scene.add(this.sceneryGroup);

    this.buildEnvMaps();
    this.setQuality('high');
  }

  /** Start line on the long bottom straight (the lowest-curvature region). */
  private findStartIndex(): number {
    const t = this.track;
    let best = 0;
    let bestScore = Infinity;
    for (let i = 0; i < t.count; i++) {
      let score = 0;
      for (let k = -30; k <= 30; k += 3) score += Math.abs(t.sample(i + k).curvature);
      // Prefer the bottom straight (most negative z).
      score += t.sample(i).z * 1e-5;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  private buildEnvMaps(): void {
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const make = (top: number, mid: number, bottom: number, panel: number, panelIntensity: number) => {
      const s = new THREE.Scene();
      const geo = new THREE.SphereGeometry(10, 32, 16);
      const colors: number[] = [];
      const pos = geo.getAttribute('position');
      const cTop = new THREE.Color(top);
      const cMid = new THREE.Color(mid);
      const cBot = new THREE.Color(bottom);
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / 10;
        const c = y > 0 ? cMid.clone().lerp(cTop, y) : cMid.clone().lerp(cBot, -y);
        colors.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
      // Soft-box panels for crisp highlights on the paint.
      const pm = new THREE.MeshBasicMaterial({ color: new THREE.Color(panel).multiplyScalar(panelIntensity), side: THREE.DoubleSide });
      const p1 = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.2), pm);
      p1.position.set(0, 7, 2);
      p1.rotation.x = Math.PI / 2;
      s.add(p1);
      const p2 = new THREE.Mesh(new THREE.PlaneGeometry(2, 5), pm);
      p2.position.set(8, 2, 0);
      p2.rotation.y = -Math.PI / 2;
      s.add(p2);
      const tex = pmrem.fromScene(s, 0.02).texture;
      geo.dispose();
      return tex;
    };
    this.envDay = make(0xcfd6dd, 0xe9e5dc, 0x5b5a52, 0xffffff, 3);
    this.envNight = make(0x0b0e14, 0x1a1d24, 0x08080a, 0xbfc6d6, 0.6);
    pmrem.dispose();
    this.scene.environment = this.envDay;
  }

  /** Rebuild instanced scenery for a quality level. */
  setQuality(q: Quality): void {
    const group = this.sceneryGroup;
    for (const child of [...group.children]) {
      group.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
    const treeCount = q === 'low' ? 140 : q === 'medium' ? 320 : 560;
    const rnd = mulberry32(42);
    const t = this.track;

    // Trees: abstract cones on trunks.
    const crownGeo = new THREE.ConeGeometry(2.6, 8, q === 'low' ? 6 : 8);
    crownGeo.translate(0, 7, 0);
    const trunkGeo = new THREE.CylinderGeometry(0.35, 0.45, 3.2, 6);
    trunkGeo.translate(0, 1.6, 0);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: PALETTE.tree, roughness: 0.95 }), treeCount);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: PALETTE.trunk, roughness: 1 }), treeCount);
    const m = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    let placed = 0;
    let guard = 0;
    while (placed < treeCount && guard++ < treeCount * 30) {
      const x = (rnd() - 0.5) * 1300;
      const z = (rnd() - 0.5) * 900;
      const near = t.nearest(x, z);
      const d = Math.hypot(x - near.px, z - near.pz);
      if (d < SCENERY_CLEARANCE + 4) continue;
      const sc = 0.7 + rnd() * 0.7;
      scale.set(sc, sc * (0.85 + rnd() * 0.4), sc);
      quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
      m.compose(new THREE.Vector3(x, 0, z), quat, scale);
      crowns.setMatrixAt(placed, m);
      trunks.setMatrixAt(placed, m);
      placed++;
    }
    crowns.count = placed;
    trunks.count = placed;
    crowns.castShadow = q !== 'low';
    trunks.castShadow = false;
    crowns.receiveShadow = true;
    group.add(crowns, trunks);

    // Architectural blocks (pit building, grandstand, sheds) — white masses.
    const blockMat = new THREE.MeshStandardMaterial({ color: PALETTE.building, roughness: 0.85 });
    const st = t.sample(this.startIndex);
    const heading = Math.atan2(st.tx, st.tz);
    const place = (along: number, lateral: number, w: number, h: number, d: number, mat: THREE.Material) => {
      const s = t.sample(this.startIndex + Math.round(along / t.spacing));
      const x = s.x + s.nx * lateral;
      const z = s.z + s.nz * lateral;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      b.position.set(x, h / 2, z);
      b.rotation.y = heading;
      b.castShadow = true;
      b.receiveShadow = true;
      group.add(b);
      return b;
    };
    // Grandstand on the left of the start straight, pit building on the right.
    place(0, SCENERY_CLEARANCE + 6, 8, 6, 70, blockMat);
    const roof = place(0, SCENERY_CLEARANCE + 6, 10, 0.5, 72, new THREE.MeshStandardMaterial({ color: PALETTE.red, roughness: 0.6 }));
    roof.position.y = 9;
    for (let k = 0; k < 4; k++) place(-30 + k * 20, -(SCENERY_CLEARANCE + 6), 9, 4.5, 14, blockMat);
    // Windows strip on pit building (glows at night).
    place(0, -(SCENERY_CLEARANCE + 1.4), 0.2, 1.2, 70, this.windowMaterial).position.y = 2.6;

    // Lamp posts along both straights.
    const postGeo = new THREE.CylinderGeometry(0.12, 0.16, 8, 6);
    postGeo.translate(0, 4, 0);
    const headGeo = new THREE.BoxGeometry(0.5, 0.25, 1.4);
    headGeo.translate(0, 8, 0);
    const steel = new THREE.MeshStandardMaterial({ color: 0x55575a, roughness: 0.6, metalness: 0.4 });
    const lampPositions: THREE.Vector3[] = [];
    for (let k = -8; k <= 8; k++) {
      for (const side of [-1, 1]) {
        const s = t.sample(this.startIndex + k * 12);
        lampPositions.push(new THREE.Vector3(s.x + s.nx * side * (BARRIER_OFFSET + 2.5), 0, s.z + s.nz * side * (BARRIER_OFFSET + 2.5)));
      }
    }
    const posts = new THREE.InstancedMesh(postGeo, steel, lampPositions.length);
    const heads = new THREE.InstancedMesh(headGeo, this.lampMaterial, lampPositions.length);
    lampPositions.forEach((p, i) => {
      m.compose(p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading), new THREE.Vector3(1, 1, 1));
      posts.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
    });
    posts.castShadow = q !== 'low';
    group.add(posts, heads);

    // Shadows.
    this.sun.castShadow = q !== 'low';
    const size = q === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  setNight(night: boolean): void {
    this.night = night;
    const u = this.skyMaterial.uniforms;
    (u.top.value as THREE.Color).copy(night ? PALETTE.nightSky : PALETTE.daySky);
    (u.horizon.value as THREE.Color).copy(night ? PALETTE.nightHorizon : PALETTE.dayHorizon);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(night ? PALETTE.nightHorizon : PALETTE.dayHorizon);
    fog.near = night ? 60 : 220;
    fog.far = night ? 520 : 1100;
    this.sun.intensity = night ? 0.55 : 2.4;
    this.sun.color.set(night ? 0x9fb0d0 : 0xfff6e8);
    this.hemi.intensity = night ? 0.45 : 0.9;
    this.hemi.color.set(night ? 0x52607a : 0xeef0f0);
    this.lampMaterial.emissiveIntensity = night ? 2.4 : 0;
    this.windowMaterial.emissiveIntensity = night ? 1.6 : 0;
    // Retro-reflective road markings glow slightly when lit at night.
    for (const mat of this.markingMaterials) mat.emissiveIntensity = night ? 0.08 : 0;
    this.scene.environment = night ? this.envNight : this.envDay;
    this.scene.environmentIntensity = night ? 0.7 : 0.75;
  }

  get isNight(): boolean {
    return this.night;
  }

  /** Keep the shadow frustum centred on the car. */
  followShadow(x: number, z: number): void {
    const off = new THREE.Vector3(-60, 110, -40);
    this.sun.position.set(x + off.x, off.y, z + off.z);
    this.sun.target.position.set(x, 0, z);
    this.sun.target.updateMatrixWorld();
  }
}
