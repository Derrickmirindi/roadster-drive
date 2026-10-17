/**
 * Stunt Lab: an interactive, scrubbable replay of the half-pipe climb and jet
 * flight trials for any of 13 bodies carrying the same fan-and-jet rig, with a
 * live free-body diagram, in-scene force arrows, cutaway, flight path and
 * three cameras.
 */
import * as THREE from 'three';
import {
  ARC_R,
  FLIGHT_START_X,
  LIFT_THRUST,
  LINEUP_FROM,
  LINEUP_TO,
  PIPE_WIDTH,
  RIG_MASS,
  SUCTION_MAX,
  Sample,
  StuntResult,
  VEHICLES,
  Vec3,
  magnitude,
  sampleAt,
  simulateStunt,
  vehicleById,
} from './stunt-sim.js';
import { buildVehicleVisual, VehicleVisual } from './stunt-vehicles.js';
import { CarModel, Finish } from './car-model.js';
import { isTypingTarget } from './input.js';

export type StuntCamera = 'follow' | 'wide' | 'orbit';

const FORCES = [
  { key: 'gravity', name: 'Gravity', color: '#d9b36c' },
  { key: 'suction', name: 'Fan suction', color: '#6fb7d6' },
  { key: 'contact', name: 'Road contact', color: '#d7dde2' },
  { key: 'tire', name: 'Tyre friction', color: '#7fbf8f' },
  { key: 'thrust', name: 'Jet thrust', color: '#e0251b' },
] as const;
type ForceKey = (typeof FORCES)[number]['key'];
const TORQUE_COLOR = '#a98fd8';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const kN = (n: number) => (n / 1000).toFixed(1);
const fmtMass = (kg: number) => kg.toLocaleString('en-US');

function fmtTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

export class StuntLab {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000);
  private readonly roadsterModel = new CarModel();
  private visual: VehicleVisual | null = null;
  private readonly pose = new THREE.Group();
  private readonly sun: THREE.DirectionalLight;
  private result!: StuntResult;
  private vehicleId = 'roadster';
  time = 0;
  playing = false;
  rate = 1;
  cameraMode: StuntCamera = 'follow';
  cutaway = false;
  showPath = false;
  showArrows = true;
  private pathLine: THREE.Line | null = null;
  private readonly arrows = new Map<ForceKey, THREE.ArrowHelper>();
  private orbitYaw = -0.9;
  private orbitPitch = 0.35;
  private orbitDist = 14;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private camInit = false;
  private hudTimer = 0;
  private fanSpin = 0;
  active = false;
  reducedMotion = () => false;
  onChange: () => void = () => {};
  private ui = false;

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color(0xd8d5ce);
    s.fog = new THREE.Fog(0xd8d5ce, 160, 900);
    s.add(new THREE.HemisphereLight(0xf1f0ec, 0x56544c, 1.0));
    this.sun = new THREE.DirectionalLight(0xfff5e6, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -30;
    sc.right = 30;
    sc.top = 30;
    sc.bottom = -30;
    sc.near = 1;
    sc.far = 200;
    this.sun.shadow.bias = -0.0005;
    s.add(this.sun, this.sun.target);
    this.buildCourse();
    s.add(this.pose);
    for (const f of FORCES) {
      const a = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, new THREE.Color(f.color), 0.6, 0.35);
      a.visible = false;
      (a.line.material as THREE.Material).depthTest = false;
      (a.cone.material as THREE.Material).depthTest = false;
      a.renderOrder = 10;
      s.add(a);
      this.arrows.set(f.key, a);
    }
    this.setVehicle('roadster');
  }

  // ---------------------------------------------------------------- course

  private buildCourse(): void {
    const s = this.scene;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0xb9b5ac, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    s.add(ground);
    const grid = new THREE.GridHelper(600, 120, 0x9d998f, 0xaaa69c);
    grid.position.set(60, 0.005, 0);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    s.add(grid);

    const concrete = new THREE.MeshStandardMaterial({ color: 0xe3dfd7, roughness: 0.85, side: THREE.DoubleSide });
    const lane = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.9 });
    // Approach lane and launch strip.
    const approach = new THREE.Mesh(new THREE.PlaneGeometry(52, PIPE_WIDTH), lane);
    approach.rotation.x = -Math.PI / 2;
    approach.position.set(-26, 0.01, 0);
    approach.receiveShadow = true;
    s.add(approach);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(200, PIPE_WIDTH), lane);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(FLIGHT_START_X - 5 + 100, 0.01, 0);
    strip.receiveShadow = true;
    s.add(strip);
    const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2efe8 });
    for (const x0 of [-52, FLIGHT_START_X - 5])
      for (const side of [-1, 1]) {
        const len = x0 < 0 ? 52 : 200;
        const l = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.15), lineMat);
        l.rotation.x = -Math.PI / 2;
        l.position.set(x0 + len / 2, 0.02, side * (PIPE_WIDTH / 2 - 0.3));
        s.add(l);
      }

    // Half-pipe: inner surface from the ground (θ = 0) to the inverted ceiling (θ = π).
    const segs = 64;
    const pos: number[] = [];
    const idx: number[] = [];
    const outerR = ARC_R + 0.5;
    for (let i = 0; i <= segs; i++) {
      const th = (i / segs) * Math.PI;
      for (const r of [ARC_R, outerR])
        for (const z of [-PIPE_WIDTH / 2, PIPE_WIDTH / 2]) pos.push(r * Math.sin(th), ARC_R - r * Math.cos(th), z);
    }
    for (let i = 0; i < segs; i++) {
      const a = i * 4;
      const b = (i + 1) * 4;
      idx.push(a, b, a + 1, a + 1, b, b + 1); // inner
      idx.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2); // outer
      idx.push(a, a + 2, b, a + 2, b + 2, b); // side -z
      idx.push(a + 1, b + 1, a + 3, a + 3, b + 1, b + 3); // side +z
    }
    const pipeGeo = new THREE.BufferGeometry();
    pipeGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    pipeGeo.setIndex(idx);
    pipeGeo.computeVertexNormals();
    const pipe = new THREE.Mesh(pipeGeo, concrete);
    pipe.castShadow = true;
    pipe.receiveShadow = true;
    s.add(pipe);
    // Ceiling deck continuing back over the approach, and the support tower.
    const deck = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, PIPE_WIDTH), concrete);
    deck.position.set(-5, 2 * ARC_R + 0.25, 0);
    deck.castShadow = true;
    s.add(deck);
    const steel = new THREE.MeshStandardMaterial({ color: 0x3a3b3f, roughness: 0.6, metalness: 0.5 });
    for (const x of [-9.5, ARC_R + 1.2])
      for (const z of [-PIPE_WIDTH / 2 - 0.3, PIPE_WIDTH / 2 + 0.3]) {
        const h = 2 * ARC_R + 0.5;
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.4, h, 0.4), steel);
        col.position.set(x, h / 2, z);
        col.castShadow = true;
        s.add(col);
      }
    const band = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.2, PIPE_WIDTH + 0.02), new THREE.MeshStandardMaterial({ color: 0xe0251b }));
    band.position.set(-5, 2 * ARC_R + 0.55, 0);
    s.add(band);

    // Parked cars to clear on the flight strip.
    const parked = [0x5b5f66, 0x8a8d93, 0x2e3033, 0xb8bcc2];
    const n = 4;
    const span = LINEUP_TO - LINEUP_FROM;
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      const m = new THREE.MeshStandardMaterial({ color: parked[i], roughness: 0.5 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, span / n - 0.6), m);
      b.position.y = 0.6;
      const c = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, span / n - 1.8), m);
      c.position.y = 1.3;
      b.castShadow = c.castShadow = true;
      g.add(b, c);
      g.rotation.y = Math.PI / 2;
      g.position.set(LINEUP_FROM + (i + 0.5) * (span / n), 0, 0);
      s.add(g);
    }
    // Distance posts every 10 m along the strip.
    for (let x = FLIGHT_START_X; x <= FLIGHT_START_X + 180; x += 10) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.15, x % 50 === 0 ? 1.6 : 0.8, 0.15), steel);
      p.position.set(x, x % 50 === 0 ? 0.8 : 0.4, PIPE_WIDTH / 2 + 1.2);
      s.add(p);
    }
  }

  // ---------------------------------------------------------------- vehicle

  setVehicle(id: string): void {
    const spec = vehicleById(id);
    this.vehicleId = spec.id;
    this.result = simulateStunt(spec);
    if (this.visual) {
      this.pose.remove(this.visual.root);
      this.visual.dispose();
    }
    this.visual = buildVehicleVisual(spec, this.roadsterModel);
    this.visual.root.rotation.y = Math.PI / 2; // local +z → world +x
    this.pose.add(this.visual.root);
    this.visual.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.applyCutaway();
    this.rebuildPath();
    this.time = Math.min(this.time, this.result.duration);
    this.camInit = false;
    if (this.ui) {
      this.renderChapters();
      this.updateStatic();
      this.updateUi(true);
    }
    this.onChange();
  }

  syncAppearance(body: string, wheels: string, finish: Finish, headlights: boolean): void {
    this.roadsterModel.setBodyColor(body);
    this.roadsterModel.setWheelColor(wheels);
    this.roadsterModel.setFinish(finish);
    this.roadsterModel.setHeadlights(headlights);
    this.applyCutaway();
  }

  get vehicle() {
    return this.result.vehicle;
  }

  get stunt(): StuntResult {
    return this.result;
  }

  private applyCutaway(): void {
    const v = this.visual;
    if (!v) return;
    for (const m of v.shell) {
      const mat = m as THREE.MeshStandardMaterial;
      mat.transparent = this.cutaway || (mat as THREE.Material).userData.baseTransparent === true;
      mat.opacity = this.cutaway ? 0.16 : 1;
      mat.depthWrite = !this.cutaway;
      mat.needsUpdate = true;
    }
    v.rig.visible = this.cutaway;
  }

  private rebuildPath(): void {
    if (this.pathLine) {
      this.scene.remove(this.pathLine);
      this.pathLine.geometry.dispose();
    }
    const pts: number[] = [];
    const lift = this.vehicle.height / 2;
    for (const s of this.result.samples) {
      const up = this.upVector(s);
      pts.push(s.x + up.x * lift, s.y + up.y * lift, up.z * lift);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.pathLine = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xe0251b, transparent: true, opacity: 0.85 }));
    this.pathLine.visible = this.showPath;
    this.scene.add(this.pathLine);
  }

  private upVector(s: Sample): THREE.Vector3 {
    // Body up axis after pitch (about z) then roll (about x).
    const q = this.orientation(s);
    return new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  }

  private orientation(s: Sample): THREE.Quaternion {
    const qp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), s.pitch);
    const qr = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), s.roll);
    return qp.multiply(qr);
  }

  // ---------------------------------------------------------------- playback

  get duration(): number {
    return this.result.duration;
  }

  get isAnimating(): boolean {
    return this.active && this.playing;
  }

  play(): void {
    if (this.time >= this.duration - 0.01) this.time = 0;
    this.playing = true;
    this.updateUi(true);
    this.onChange();
  }

  pause(): void {
    this.playing = false;
    this.updateUi(true);
  }

  togglePlay(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number): void {
    this.time = Math.min(this.duration, Math.max(0, t));
    this.camInit = this.reducedMotion() ? false : this.camInit;
    this.updateUi(true);
    this.onChange();
  }

  restart(): void {
    this.seek(0);
    this.play();
  }

  startTrial(which: 'ramp' | 'flight'): void {
    this.seek(which === 'ramp' ? 0 : this.result.flightStart);
    this.camInit = false;
    this.play();
  }

  cycleCamera(): StuntCamera {
    const order: StuntCamera[] = ['follow', 'wide', 'orbit'];
    this.setCamera(order[(order.indexOf(this.cameraMode) + 1) % order.length]);
    return this.cameraMode;
  }

  setCamera(c: StuntCamera): void {
    this.cameraMode = c;
    this.camInit = this.reducedMotion() ? false : this.camInit;
    if (this.ui) {
      document.querySelectorAll<HTMLButtonElement>('[data-st-camera]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.stCamera === c)));
    }
    this.onChange();
  }

  orbitBy(dYaw: number, dPitch: number): void {
    if (this.cameraMode !== 'orbit') this.setCamera('orbit');
    this.orbitYaw += dYaw;
    this.orbitPitch = Math.min(1.35, Math.max(-0.05, this.orbitPitch + dPitch));
  }

  zoomBy(f: number): void {
    if (this.cameraMode !== 'orbit') this.setCamera('orbit');
    this.orbitDist = Math.min(80, Math.max(4, this.orbitDist * f));
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.viewW = w;
    this.viewH = h;
    this.updateViewOffset();
  }

  private viewW = 1;
  private viewH = 1;

  /**
   * Centre the vehicle in the part of the screen that is not covered by the
   * panels, by shifting the camera's view window.
   */
  updateViewOffset(): void {
    const w = this.viewW;
    const h = this.viewH;
    const panel = document.getElementById('st-panel');
    const controls = document.querySelector('.stunt-controls');
    const timeline = document.querySelector('.stunt-timeline');
    if (!this.active || !panel || !controls || !timeline) {
      this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
      return;
    }
    const pr = panel.getBoundingClientRect();
    const cr = controls.getBoundingClientRect();
    const tr = timeline.getBoundingClientRect();
    const stacked = pr.width > w * 0.8; // mobile: panel spans the width above the timeline
    const left = 0;
    const right = stacked ? w : pr.left;
    const top = cr.bottom;
    const bottom = stacked ? pr.top : tr.top;
    if (right - left < 100 || bottom - top < 100) {
      this.camera.clearViewOffset();
    } else {
      const cx = (left + right) / 2;
      const cy = (top + bottom) / 2;
      this.camera.setViewOffset(w, h, w / 2 - cx, h / 2 - cy, w, h);
    }
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- frame

  update(dt: number): void {
    if (this.playing) {
      this.time += dt * this.rate;
      if (this.time >= this.duration) {
        this.time = this.duration;
        this.playing = false;
        this.updateUi(true);
      }
    }
    const s = sampleAt(this.result, this.time);
    this.applyPose(s, dt);
    this.updateCamera(s, dt);
    this.hudTimer += dt;
    if (this.hudTimer > 1 / 15) {
      this.hudTimer = 0;
      this.updateUi();
    }
  }

  private applyPose(s: Sample, dt: number): void {
    this.pose.position.set(s.x, s.y, 0);
    this.pose.quaternion.copy(this.orientation(s));
    const v = this.visual!;
    const speed = Math.hypot(s.vx, s.vy);
    const dir = s.trial === 'ramp' && s.vx * Math.cos(s.pitch) + s.vy * Math.sin(s.pitch) < 0 ? -1 : 1;
    const spin = (this.time * speed * dir) / 0.33;
    if (s.state !== 'airborne') for (const w of v.wheels) w.rotation.x = spin;
    this.fanSpin += dt * 40 * s.fan * (this.playing ? 1 : 0);
    for (const f of v.fans) f.rotation.y = this.fanSpin;
    for (const fl of v.flames) {
      fl.visible = s.jets;
      fl.scale.setScalar(s.jets ? 0.85 + 0.3 * Math.sin(this.time * 60) : 1);
    }
    // Force arrows from the body centre, 1 m per 10 kN (capped).
    const c = new THREE.Vector3(s.x, s.y, 0).add(this.upVector(s).multiplyScalar(this.vehicle.height / 2 + 0.2));
    for (const f of FORCES) {
      const a = this.arrows.get(f.key)!;
      const vec = s[f.key] as Vec3;
      const mag = magnitude(vec);
      const show = this.showArrows && mag > 200;
      a.visible = show;
      if (!show) continue;
      const len = Math.min(14, Math.max(0.6, mag / 10000));
      a.position.copy(c);
      a.setDirection(new THREE.Vector3(vec[0], vec[1], vec[2]).normalize());
      a.setLength(len, Math.min(0.8, len * 0.3), Math.min(0.45, len * 0.2));
    }
    this.sun.position.set(s.x - 30, s.y + 60, 25);
    this.sun.target.position.set(s.x, s.y, 0);
  }

  private updateCamera(s: Sample, dt: number): void {
    const target = new THREE.Vector3(s.x, s.y + this.vehicle.height * 0.5, 0);
    const size = Math.max(4, this.vehicle.length);
    const pos = new THREE.Vector3();
    const look = target.clone();
    switch (this.cameraMode) {
      case 'follow': {
        if (s.trial === 'ramp') pos.set(s.x - 6 - size * 0.4, s.y + 3 + size * 0.15, 13 + size * 0.9);
        else pos.set(s.x - 8 - size * 0.5, s.y + 3 + size * 0.2, 12 + size * 0.9);
        break;
      }
      case 'wide': {
        if (s.trial === 'ramp') {
          pos.set(-14, 11, 42);
          look.set(-8, 7, 0);
        } else {
          const y = Math.max(8, s.y * 0.6);
          pos.set(110, y + 6, 70 + Math.min(200, s.y * 0.8));
          look.set(115, Math.max(4, s.y * 0.5), 0);
        }
        break;
      }
      case 'orbit': {
        const cp = Math.cos(this.orbitPitch);
        pos.set(
          target.x + Math.sin(this.orbitYaw) * cp * this.orbitDist,
          target.y + Math.sin(this.orbitPitch) * this.orbitDist,
          target.z + Math.cos(this.orbitYaw) * cp * this.orbitDist,
        );
        break;
      }
    }
    pos.y = Math.max(pos.y, 0.6);
    // While paused or scrubbing, frames are rendered on demand, so cut straight to the target.
    if (!this.camInit || this.reducedMotion() || !this.playing) {
      this.camPos.copy(pos);
      this.camLook.copy(look);
      this.camInit = true;
    } else {
      const k = 1 - Math.exp(-6 * dt);
      this.camPos.lerp(pos, this.cameraMode === 'orbit' ? 1 : k);
      this.camLook.lerp(look, this.cameraMode === 'orbit' ? 1 : Math.min(1, k * 1.5));
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------- UI

  bindUi(): void {
    this.ui = true;
    const sel = $<HTMLSelectElement>('st-vehicle');
    for (const v of VEHICLES) {
      const o = document.createElement('option');
      o.value = v.id;
      o.textContent = v.name;
      sel.append(o);
    }
    sel.value = this.vehicleId;
    sel.addEventListener('change', () => this.setVehicle(sel.value));
    document.querySelectorAll<HTMLButtonElement>('[data-st-camera]').forEach((b) =>
      b.addEventListener('click', () => this.setCamera(b.dataset.stCamera as StuntCamera)),
    );
    const toggle = (id: string, get: () => boolean, set: (v: boolean) => void) => {
      const b = $(id);
      b.setAttribute('aria-pressed', String(get()));
      b.addEventListener('click', () => {
        set(!get());
        b.setAttribute('aria-pressed', String(get()));
        this.onChange();
      });
    };
    toggle('st-cutaway', () => this.cutaway, (v) => {
      this.cutaway = v;
      this.applyCutaway();
    });
    toggle('st-path', () => this.showPath, (v) => {
      this.showPath = v;
      if (this.pathLine) this.pathLine.visible = v;
    });
    toggle('st-arrows', () => this.showArrows, (v) => (this.showArrows = v));
    $('st-play').addEventListener('click', () => this.togglePlay());
    $('st-restart').addEventListener('click', () => this.restart());
    $('st-ramp').addEventListener('click', () => this.startTrial('ramp'));
    $('st-flight').addEventListener('click', () => this.startTrial('flight'));
    const rate = $<HTMLSelectElement>('st-rate');
    rate.addEventListener('change', () => (this.rate = Number(rate.value)));
    const range = $<HTMLInputElement>('st-time');
    range.addEventListener('input', () => {
      const t = Number(range.value);
      this.playing = false;
      this.seek(t);
    });
    $('st-panel-toggle').addEventListener('click', () => {
      const p = $('st-panel');
      const open = p.dataset.open !== 'true';
      p.dataset.open = String(open);
      $('st-panel-toggle').setAttribute('aria-expanded', String(open));
      this.updateViewOffset();
      this.onChange();
    });
    // Legend rows.
    const legend = $('st-forces');
    for (const f of FORCES) {
      const row = document.createElement('div');
      row.className = 'force-row';
      row.style.setProperty('--fc', f.color);
      row.innerHTML = `<span class="force-swatch" aria-hidden="true"></span><span class="force-name">${f.name}</span><span class="force-number" id="st-f-${f.key}">0.0<small>kN</small></span>`;
      legend.append(row);
    }
    const tr = document.createElement('div');
    tr.className = 'force-row';
    tr.style.setProperty('--fc', TORQUE_COLOR);
    tr.innerHTML = `<span class="force-swatch force-swatch--ring" aria-hidden="true"></span><span class="force-name">Roll torque</span><span class="force-number" id="st-f-torque">0.0<small>kN·m</small></span>`;
    legend.append(tr);
    window.addEventListener('keydown', this.onKey);
    this.renderChapters();
    this.updateStatic();
    this.updateUi(true);
  }

  private onKey = (e: KeyboardEvent) => {
    if (!this.active || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target) || document.querySelector('dialog[open]')) return;
    const el = e.target as HTMLElement | null;
    const onControl = !!el?.closest('button, a, select, input, summary');
    if (e.code === 'Space' && !onControl) {
      e.preventDefault();
      this.togglePlay();
    } else if ((e.code === 'ArrowRight' || e.code === 'ArrowLeft') && !onControl) {
      e.preventDefault();
      this.pause();
      this.seek(this.time + (e.code === 'ArrowRight' ? 0.5 : -0.5));
    } else if (e.code === 'Home' && !onControl) {
      e.preventDefault();
      this.seek(0);
    }
  };

  private renderChapters(): void {
    const nav = $('st-chapters');
    nav.textContent = '';
    for (const c of this.result.chapters) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chapter';
      b.textContent = c.label;
      b.dataset.t = String(c.t);
      b.setAttribute('aria-label', `${c.label}, jump to ${c.t.toFixed(1)} seconds`);
      b.addEventListener('click', () => {
        this.pause();
        this.seek(c.t);
      });
      nav.append(b);
    }
    const range = $<HTMLInputElement>('st-time');
    range.max = String(this.result.duration);
    $('st-duration').textContent = fmtTime(this.result.duration);
    // Ticks on the track for each chapter.
    const ticks = $('st-ticks');
    ticks.textContent = '';
    for (const c of this.result.chapters) {
      const i = document.createElement('i');
      i.style.left = `${(c.t / this.result.duration) * 100}%`;
      ticks.append(i);
    }
  }

  private updateStatic(): void {
    const r = this.result;
    const v = r.verdicts;
    $('st-mass').textContent = `${fmtMass(r.mass)} kg total`;
    $('st-rig').textContent = `${RIG_MASS} kg shared rig included`;
    const set = (id: string, ok: boolean, yes: string, no: string) => {
      const el = $(id);
      el.textContent = ok ? yes : no;
      el.dataset.ok = String(ok);
    };
    set('st-wall', v.wallHold, 'Holds', 'Slips');
    set('st-ceiling', v.ceilingHold, 'Holds', 'Falls');
    set('st-lift', v.liftOff, 'Lifts', 'Stays down');
    $('st-vehicle-name').textContent = r.vehicle.name;
    $<HTMLSelectElement>('st-vehicle').value = r.vehicle.id;
  }

  private noteFor(s: Sample): { title: string; body: string } {
    const r = this.result;
    const v = r.verdicts;
    if (s.trial === 'ramp') {
      return {
        title: 'Ramp trial',
        body:
          `${r.ramp.outcome} The fans give at most ${kN(SUCTION_MAX)} kN of suction for every body; ` +
          `this one weighs ${kN(v.weight)} kN (suction ${v.suctionToWeight.toFixed(2)}× weight). ` +
          `On the ceiling, suction must exceed weight; on the wall, tyre friction μ·N must carry it.`,
      };
    }
    return {
      title: 'Flight trial',
      body:
        `${r.flight.outcome} Lift thrust is ${kN(LIFT_THRUST)} kN against ${kN(v.weight)} kN of weight ` +
        `(${v.thrustToWeight.toFixed(2)}×). The same ${(r.rollCouple / 1000).toFixed(2)} kN·m roll couple is applied to every body; ` +
        `this one's roll inertia is ${Math.round(r.inertia).toLocaleString('en-US')} kg·m², so it turns ${r.flight.lifted ? Math.abs(r.flight.rollTurns).toFixed(2) : '0'} times.`,
    };
  }

  updateUi(force = false): void {
    if (!this.ui) return;
    const s = sampleAt(this.result, this.time);
    $('st-now').textContent = fmtTime(this.time);
    const range = $<HTMLInputElement>('st-time');
    if (force || document.activeElement !== range) range.value = String(this.time);
    const chapter = [...this.result.chapters].reverse().find((c) => c.t <= this.time + 1e-6);
    range.setAttribute('aria-valuetext', `${this.time.toFixed(1)} seconds, ${chapter?.label ?? ''}`);
    $('st-progress').style.width = `${(this.time / this.duration) * 100}%`;
    const play = $('st-play');
    play.setAttribute('aria-label', this.playing ? 'Pause' : 'Play');
    play.querySelector('use')?.setAttribute('href', this.playing ? '#i-pause' : '#i-play');
    document.querySelectorAll<HTMLButtonElement>('#st-chapters .chapter').forEach((b) => {
      b.setAttribute('aria-current', String(b.textContent === chapter?.label));
    });

    // Forces.
    for (const f of FORCES) $(`st-f-${f.key}`).firstChild!.textContent = kN(magnitude(s[f.key] as Vec3));
    $('st-f-torque').firstChild!.textContent = kN(s.torque);
    const stateText: Record<Sample['state'], string> = {
      ground: 'On the ground',
      climbing: 'Climbing the pipe',
      wall: 'On the wall',
      inverted: 'Upside down',
      airborne: 'Airborne',
      stopped: 'Stopped',
      crashed: 'Crashed',
    };
    $('st-state').textContent = stateText[s.state];
    $('st-height').textContent = `${s.y.toFixed(1)} m`;
    $('st-vertical').textContent = `${s.vy.toFixed(1)} m/s`;
    $('st-roll').textContent = `${(s.roll / (2 * Math.PI)).toFixed(2)} turns`;
    const note = this.noteFor(s);
    $('st-note-title').textContent = note.title;
    $('st-note').textContent = note.body;
    this.drawDiagram(s);
    if (force || Math.round(this.time * 2) !== Math.round((this.time - 0.07) * 2)) {
      $('st-diagram').setAttribute(
        'aria-label',
        `Free-body diagram: ${FORCES.map((f) => `${f.name} ${kN(magnitude(s[f.key] as Vec3))} kilonewtons`).join(', ')}.`,
      );
    }
  }

  private drawDiagram(s: Sample): void {
    const svg = $('st-diagram');
    const r = this.result;
    const scale = 88 / Math.max(r.verdicts.weight * 1.3, LIFT_THRUST, SUCTION_MAX + r.verdicts.weight);
    const body = svg.querySelector('#st-body') as SVGGElement;
    body.setAttribute('transform', `rotate(${(-s.pitch * 180) / Math.PI})`);
    const g = svg.querySelector('#st-arrows') as SVGGElement;
    let html = '';
    for (const f of FORCES) {
      const v = s[f.key] as Vec3;
      const mag = Math.hypot(v[0], v[1]);
      if (mag < 200) continue;
      const len = Math.max(10, mag * scale);
      const x2 = (v[0] / mag) * len;
      const y2 = -(v[1] / mag) * len;
      html += `<line x1="0" y1="0" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${f.color}" stroke-width="2.4" marker-end="url(#st-arrow-${f.key})"/>`;
    }
    g.innerHTML = html;
    const t = svg.querySelector('#st-torque') as SVGPathElement;
    t.setAttribute('opacity', s.torque > 0 ? '1' : '0');
  }
}
