/**
 * Application controller: owns the renderer, simulation loop, modes and UI.
 */
import * as THREE from 'three';
import { TrackPath } from './track-path.js';
import {
  CarState,
  DEFAULT_PARAMS,
  FixedStepper,
  createCarState,
  engageCruise,
  forwardSpeed,
  requestGear,
  speedOf,
  stepCar,
  CRUISE_MIN_SPEED,
} from './physics.js';
import { TrackRules, BARRIER_OFFSET, CAR_HALF_WIDTH } from './world-rules.js';
import { LapTimer, LapEvent, formatLapTime } from './laps.js';
import { CarModel, Finish } from './car-model.js';
import { Environment, Quality } from './environment.js';
import { CameraRig, CameraMode, DRIVE_CAMERAS, CAMERA_LABELS } from './cameras.js';
import { InputManager, ActionName, DriveInput } from './input.js';
import { EngineAudio } from './audio.js';
import { Minimap } from './minimap.js';
import { StuntLab } from './stunt-lab.js';
import { FlightState, createFlightState, launch, stepFlight, canFly, isBurning, RECHARGE_TIME, FlightEvent } from './flight.js';
import {
  DEFAULT_APPEARANCE,
  KMH_PER_MS,
  MPH_PER_MS,
  SPEED_LIMIT_MAX_KMH,
  SPEED_LIMIT_MIN_KMH,
  Settings,
  loadBestLap,
  loadSettings,
  saveBestLap,
  saveSettings,
  speedInUnits,
  unitLabel,
} from './settings.js';

type Mode = 'showroom' | 'drive' | 'stunt';
type PauseReason = 'user' | 'dialog' | 'hidden' | null;

const BODY_SWATCHES: Array<[string, string]> = [
  ['Crimson', '#a3141c'],
  ['Signal', '#e0251b'],
  ['Graphite', '#2e3033'],
  ['Ivory', '#ece8df'],
  ['Racing green', '#1f4a35'],
  ['Ultramarine', '#1f3f8f'],
  ['Sand', '#b9a27b'],
  ['Volt', '#d4dc2a'],
];
const WHEEL_SWATCHES: Array<[string, string]> = [
  ['Gunmetal', '#3a3b3d'],
  ['Black', '#121212'],
  ['Silver', '#b8bcc2'],
  ['Bronze', '#8a6a3a'],
  ['White', '#e9e6df'],
  ['Red', '#c8231b'],
];

const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

function luminance(hex: string): number {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

export class App {
  readonly renderer: THREE.WebGLRenderer;
  readonly track = new TrackPath();
  readonly env: Environment;
  readonly car = new CarModel();
  readonly rig: CameraRig;
  readonly state: CarState;
  readonly rules: TrackRules;
  readonly laps: LapTimer;
  readonly stepper = new FixedStepper(120, 30);
  readonly input = new InputManager();
  readonly audio = new EngineAudio();
  readonly settings: Settings;
  readonly minimap: Minimap;
  readonly stunt = new StuntLab();
  readonly flight: FlightState = createFlightState();
  private readonly flames: THREE.Mesh[] = [];

  mode: Mode = 'showroom';
  private pauseReason: PauseReason = null;
  private simTime = 0;
  private rafId = 0;
  private lastFrame = -1;
  private driveCamera: CameraMode = 'chase';
  private orbitPointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private lastInput: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  private hudTimer = 0;
  private toastTimer = 0;
  private effectiveQuality: Quality = 'high';
  private perfFrames = 0;
  private perfTime = 0;
  private hasEnteredDrive = false;
  /** Largest distance from the centre line since the last test placement (diagnostics). */
  private diagMaxLateral = 0;
  readonly startIndex: number;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.settings = loadSettings();
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.env = new Environment(this.track, this.renderer);
    this.env.scene.add(this.car.root);
    this.startIndex = this.env.startIndex;

    this.rig = new CameraRig(1);
    this.state = createCarState();
    this.rules = new TrackRules(this.track);
    this.rules.resetCar(this.state, this.startIndex - 25);
    this.laps = new LapTimer(this.track.count, this.startIndex, 8, loadBestLap());
    this.minimap = new Minimap($<HTMLCanvasElement>('minimap'), this.track, this.startIndex, this.laps.checkpoints);

    // Showroom starts with a front three-quarter view.
    this.rig.orbitYaw = this.state.heading + 0.75;
  }

  // ------------------------------------------------------------------ setup

  init(): void {
    this.buildFlames();
    this.applyAppearance();
    this.applyLighting();
    this.applyGraphics();
    this.applyAudioSettings();
    this.bindUi();
    this.bindCanvas();
    this.bindInput();
    this.syncCarVisual();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('blur', () => this.onWindowBlur());
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      cancelAnimationFrame(this.rafId);
      showFatal('Graphics context lost', 'The browser stopped the 3D view (for example after a driver reset or low memory). Reload to continue.');
    });
    this.updateSpecs();
    this.updateHud(true);
    this.wake();
    document.getElementById('app')?.setAttribute('aria-busy', 'false');
    this.exposeDiagnostics();
  }

  private get reducedMotion(): boolean {
    const r = this.settings.graphics.reducedMotion;
    if (r === 'on') return true;
    if (r === 'off') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  private get speedLimitMs(): number {
    return this.settings.driving.speedLimitKmh / KMH_PER_MS;
  }

  /** Simulated 0–100 km/h time, measured with the same physics as driving. */
  private updateSpecs(): void {
    const s = createCarState();
    const stepper = 1 / 120;
    let t = 0;
    while (speedOf(s) < 100 / 3.6 && t < 30) {
      stepCar(s, { throttle: 1, brake: 0, steer: 0, handbrake: false }, DEFAULT_PARAMS, { speedLimit: 75, surface: 'road' }, stepper);
      t += stepper;
    }
    $('spec-accel').textContent = `${t.toFixed(1)} s (simulated)`;
  }

  // ------------------------------------------------------------------ loop

  /** Start the render loop if it is not running. */
  wake(): void {
    if (this.rafId || document.hidden) return;
    this.lastFrame = -1;
    this.rafId = requestAnimationFrame(this.frame);
  }

  private get loopShouldContinue(): boolean {
    if (document.hidden) return false;
    if (this.mode === 'drive' && this.pauseReason === null) return true;
    if (this.mode === 'stunt') return this.stunt.isAnimating || this.orbitPointers.size > 0;
    return this.rig.animating || this.orbitPointers.size > 0;
  }

  private frame = (now: number) => {
    this.rafId = 0;
    const dt = this.lastFrame < 0 ? 1 / 60 : Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (this.mode === 'stunt') {
      this.stunt.update(dt);
      this.stunt.render(this.renderer);
      if (this.loopShouldContinue) this.rafId = requestAnimationFrame(this.frame);
      return;
    }

    if (this.mode === 'drive' && this.pauseReason === null) {
      this.simulate(dt);
      this.trackPerformance(dt);
    }
    this.syncCarVisual();
    this.rig.update(dt, this.pose(), {
      shake: this.settings.graphics.shake,
      speedFov: this.settings.graphics.speedFov,
      reducedMotion: this.reducedMotion,
    });
    this.env.followShadow(this.state.x, this.state.z);
    this.renderer.render(this.env.scene, this.rig.camera);

    this.hudTimer += dt;
    if (this.hudTimer > 1 / 20) {
      this.hudTimer = 0;
      this.updateHud();
    }
    if (this.mode === 'drive') {
      this.minimap.draw(this.state.x, this.state.z, this.state.heading, this.laps.nextCheckpoint, now / 1000);
    }

    if (this.loopShouldContinue) this.rafId = requestAnimationFrame(this.frame);
  };

  /** Render one frame on demand (e.g. after an appearance change while idle). */
  requestRender(): void {
    this.wake();
  }

  private simulate(frameDt: number): void {
    const steps = this.stepper.advance(frameDt);
    const h = this.stepper.step;
    for (let i = 0; i < steps; i++) {
      const airborne = this.flight.airborne;
      const input = airborne ? { throttle: 0, brake: 0, steer: 0, handbrake: false } : this.input.read();
      this.lastInput = input;
      const before = this.rules.apply(this.state); // surface at current position
      if (airborne) {
        // No tyre grip in the air: keep the horizontal velocity (light air drag).
        const s = this.state;
        const drag = Math.exp(-0.02 * h);
        s.vx *= drag;
        s.vz *= drag;
        s.x += s.vx * h;
        s.z += s.vz * h;
        s.wheelSpin += (forwardSpeed(s) / 0.34) * h;
        s.steer = 0;
      } else {
        const ev = stepCar(this.state, input, DEFAULT_PARAMS, { speedLimit: this.speedLimitMs, surface: before.surface }, h);
        if (ev.cruiseDisengaged) this.toast('Cruise control off');
      }
      for (const fe of stepFlight(this.flight, h)) this.onFlightEvent(fe);
      const res = this.rules.apply(this.state);
      this.diagMaxLateral = Math.max(this.diagMaxLateral, res.contact ? BARRIER_OFFSET - CAR_HALF_WIDTH : Math.abs(res.lateral));
      if (res.impact > 1.2) {
        this.audio.impact(res.impact);
        this.rig.addShake(Math.min(0.5, res.impact * 0.05));
      }
      if (this.rules.needsRecovery(this.state, res, input.throttle, h)) {
        this.resetCar('Car recovered to the track');
      }
      this.simTime += h;
      for (const e of this.laps.update(res.index, this.simTime)) this.onLapEvent(e);
    }
    this.audio.update(speedOf(this.state), this.lastInput.throttle, this.state.slip, true);
  }

  private trackPerformance(dt: number): void {
    if (this.settings.graphics.quality !== 'auto') return;
    this.perfFrames++;
    this.perfTime += dt;
    if (this.perfTime >= 4) {
      const fps = this.perfFrames / this.perfTime;
      this.perfFrames = 0;
      this.perfTime = 0;
      if (fps < 40 && this.effectiveQuality !== 'low') {
        this.effectiveQuality = this.effectiveQuality === 'high' ? 'medium' : 'low';
        this.applyQuality(this.effectiveQuality);
        this.toast(`Graphics lowered to ${this.effectiveQuality} for smoother driving`);
      }
    }
  }

  private pose() {
    return { x: this.state.x, z: this.state.z, heading: this.state.heading, speed: speedOf(this.state), y: this.flight.y };
  }

  private syncCarVisual(): void {
    const s = this.state;
    this.car.root.position.set(s.x, this.flight.y, s.z);
    this.car.root.rotation.y = s.heading;
    this.car.root.rotation.z = this.flight.roll;
    const burn = isBurning(this.flight) && this.mode === 'drive';
    for (const f of this.flames) {
      f.visible = burn;
      if (burn) f.scale.set(1, 0.85 + Math.random() * 0.3, 1);
    }
    const f = forwardSpeed(s);
    const angle = (s.steer * DEFAULT_PARAMS.maxSteerAngle) / (1 + Math.abs(f) / DEFAULT_PARAMS.steerFalloffSpeed);
    this.car.updateWheels(1, s.wheelSpin, angle);
    this.car.setBraking(this.mode === 'drive' && (this.lastInput.brake > 0 || this.lastInput.handbrake));
  }

  // ------------------------------------------------------------------ modes

  private setModeUi(mode: Mode): void {
    if (mode !== 'drive') this.cancelFlight();
    if (this.mode === 'stunt' && mode !== 'stunt') {
      this.stunt.pause();
      this.stunt.active = false;
    }
    this.mode = mode;
    document.body.classList.remove('mode-showroom', 'mode-drive', 'mode-stunt');
    document.body.classList.add(`mode-${mode}`);
    for (const m of ['showroom', 'drive', 'stunt'] as const) $(`mode-${m}`).setAttribute('aria-pressed', String(m === mode));
  }

  enterStunt(): void {
    if (this.mode === 'stunt') return;
    this.closeDialogs();
    if (this.mode === 'drive') {
      this.state.vx = 0;
      this.state.vz = 0;
      this.state.cruiseOn = false;
      this.laps.invalidate();
    }
    this.pauseReason = null;
    this.setModeUi('stunt');
    this.input.drivingEnabled = false;
    this.input.releaseAll();
    this.lastInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.audio.update(0, 0, 0, false);
    this.setPanel(false);
    this.updateTouchVisibility();
    this.syncStuntAppearance();
    this.stunt.active = true;
    this.stunt.reducedMotion = () => this.reducedMotion;
    requestAnimationFrame(() => {
      this.stunt.updateViewOffset();
      this.wake();
    });
    this.stunt.update(0);
    this.stunt.updateUi(true);
    this.resize();
    this.wake();
  }

  private syncStuntAppearance(): void {
    const a = this.settings.appearance;
    this.stunt.syncAppearance(a.body, a.wheels, a.finish, this.settings.lighting.headlights);
  }

  enterDrive(): void {
    if (this.mode === 'drive') return;
    this.setModeUi('drive');
    this.input.drivingEnabled = true;
    this.pauseReason = null;
    this.stepper.reset();
    this.laps.invalidate();
    this.rig.setMode(this.driveCamera, this.reducedMotion);
    if (window.matchMedia('(max-width: 760px)').matches) this.setPanel(false);
    this.updateTouchVisibility();
    this.audio.unlock();
    this.audio.resume();
    this.canvas.focus({ preventScroll: true });
    if (!this.hasEnteredDrive) {
      this.hasEnteredDrive = true;
      this.toast(this.touchVisible ? 'Hold Gas to drive · ◀ ▶ to steer' : 'W / ↑ to accelerate · A D to steer · C camera');
    }
    this.minimap.resize();
    this.updateHud(true);
    this.wake();
  }

  enterShowroom(): void {
    if (this.mode === 'showroom') return;
    this.closeDialogs();
    this.pauseReason = null;
    this.setModeUi('showroom');
    this.input.drivingEnabled = false;
    this.input.releaseAll();
    // Park the car where it is.
    this.state.vx = 0;
    this.state.vz = 0;
    this.state.cruiseOn = false;
    this.state.slip = 0;
    this.lastInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.laps.invalidate();
    this.rig.orbitYaw = this.state.heading + 0.75;
    this.rig.setMode('orbit', this.reducedMotion);
    this.updateTouchVisibility();
    this.audio.update(0, 0, 0, false);
    this.updateHud(true);
    this.wake();
  }

  pause(reason: Exclude<PauseReason, null> = 'user'): void {
    if (this.mode !== 'drive' || this.pauseReason !== null) return;
    this.pauseReason = reason;
    this.input.releaseAll();
    this.lastInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.audio.update(0, 0, 0, false);
    this.audio.suspend();
    $('btn-pause').setAttribute('aria-pressed', 'true');
    if (reason === 'user') this.showPauseDialog();
    this.updateHud(true);
    this.wake(); // render one still frame
  }

  resume(): void {
    if (this.pauseReason === null) return;
    this.pauseReason = null;
    const d = $<HTMLDialogElement>('dlg-pause');
    if (d.open) d.close();
    $('btn-pause').setAttribute('aria-pressed', 'false');
    this.stepper.reset();
    this.audio.resume();
    this.canvas.focus({ preventScroll: true });
    this.wake();
  }

  togglePause(): void {
    if (this.mode !== 'drive') return;
    if (this.pauseReason === null) this.pause('user');
    else this.resume();
  }

  private showPauseDialog(): void {
    const d = $<HTMLDialogElement>('dlg-pause');
    const u = this.settings.driving.units;
    $('pause-summary').textContent =
      `Speed ${Math.round(speedInUnits(speedOf(this.state), u))} ${unitLabel(u)} · gear ${this.state.gear} · ` +
      `best lap ${formatLapTime(this.laps.bestLap)}. Lap timing is frozen while paused.`;
    if (!d.open) d.showModal();
    $('p-resume').focus();
  }

  resetCar(message = 'Car reset to the track'): void {
    this.cancelFlight();
    this.rules.resetCar(this.state);
    const ev = this.laps.invalidate();
    this.stepper.reset();
    this.toast(ev ? `${message} — current lap not counted` : message);
    this.syncCarVisual();
    this.updateHud(true);
    this.wake();
  }

  // ------------------------------------------------------------------ jet flight

  private buildFlames(): void {
    const mat = new THREE.MeshBasicMaterial({ color: 0xbfe6f5, transparent: true, opacity: 0.8, depthWrite: false });
    const geo = new THREE.ConeGeometry(0.18, 1.8, 12, 1, true);
    geo.rotateX(Math.PI); // point down
    geo.translate(0, -0.9, 0);
    for (const [x, z] of [
      [-0.62, 1.4],
      [0.62, 1.4],
      [-0.62, -1.4],
      [0.62, -1.4],
    ]) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, 0.22, z);
      m.visible = false;
      m.renderOrder = 3;
      this.car.root.add(m);
      this.flames.push(m);
    }
  }

  /** Fire the lift jets while driving. */
  launchFlight(): void {
    if (this.mode !== 'drive') {
      this.toast('Jet flight works in Drive mode — or try the Flight trial in the Stunt lab');
      return;
    }
    if (this.pauseReason !== null) return;
    if (this.flight.airborne) {
      this.toast('Already in the air');
      return;
    }
    if (!canFly(this.flight)) {
      const left = Math.ceil((1 - this.flight.charge) * RECHARGE_TIME);
      this.toast(`Air tanks refilling — ready in ${left} s`);
      return;
    }
    this.flight.rollEnabled = this.settings.driving.flightRoll;
    if (this.state.cruiseOn) this.state.cruiseOn = false;
    launch(this.flight);
    this.audio.impact(4);
    this.rig.addShake(0.25);
    this.updateHud(true);
    this.wake();
  }

  private cancelFlight(): void {
    const f = this.flight;
    const wasFlying = f.t >= 0;
    f.y = 0;
    f.vy = 0;
    f.roll = 0;
    f.rollRate = 0;
    f.airborne = false;
    f.t = -1;
    if (wasFlying) f.charge = 0;
    for (const m of this.flames) m.visible = false;
  }

  private onFlightEvent(e: FlightEvent): void {
    if (e.type === 'liftoff') {
      this.toast(this.flight.rollEnabled ? 'Lift-off — barrel roll' : 'Lift-off');
    } else if (e.type === 'landed') {
      this.audio.impact(6);
      this.rig.addShake(0.4);
      const u = this.settings.driving.units;
      const dist = speedOf(this.state) * e.airtime;
      const distTxt = u === 'kmh' ? `${Math.round(dist)} m` : `${Math.round(dist * 3.281)} ft`;
      if (e.upright) this.toast(`Landed — ${e.peak.toFixed(1)} m high, ${distTxt} in ${e.airtime.toFixed(1)} s`);
      else this.resetCar('Rough landing — car recovered');
    } else if (e.type === 'ready') {
      this.toast('Jets ready (F)');
    }
    this.updateHud(true);
  }

  cycleCamera(): void {
    if (this.mode !== 'drive') {
      this.toast('Showroom uses the orbit camera — drag to rotate');
      return;
    }
    const i = DRIVE_CAMERAS.indexOf(this.driveCamera);
    this.driveCamera = DRIVE_CAMERAS[(i + 1) % DRIVE_CAMERAS.length];
    this.rig.setMode(this.driveCamera, this.reducedMotion);
    $('camera-label').textContent = CAMERA_LABELS[this.driveCamera];
    $('btn-camera').setAttribute('aria-label', `Camera: ${CAMERA_LABELS[this.driveCamera]}. Change camera`);
    this.toast(`${CAMERA_LABELS[this.driveCamera]} camera`);
    this.wake();
  }

  toggleGear(): void {
    const target = this.state.gear === 'D' ? 'R' : 'D';
    if (requestGear(this.state, target)) {
      this.toast(target === 'R' ? 'Reverse selected — throttle now drives backwards' : 'Drive selected');
    } else {
      this.toast('Stop the car to change gear');
    }
    this.updateHud(true);
  }

  toggleCruise(): void {
    if (this.mode !== 'drive') return;
    if (this.state.cruiseOn) {
      this.state.cruiseOn = false;
      this.toast('Cruise control off');
    } else if (engageCruise(this.state, this.speedLimitMs)) {
      const u = this.settings.driving.units;
      this.toast(`Cruise set to ${Math.round(speedInUnits(this.state.cruiseTarget, u))} ${unitLabel(u)}`);
    } else {
      const u = this.settings.driving.units;
      this.toast(`Cruise needs gear D and at least ${Math.round(speedInUnits(CRUISE_MIN_SPEED, u))} ${unitLabel(u)}`);
    }
    this.updateHud(true);
  }

  adjustCruise(sign: 1 | -1): void {
    if (!this.state.cruiseOn) {
      this.toast('Engage cruise first (K)');
      return;
    }
    const u = this.settings.driving.units;
    const stepMs = 5 / (u === 'kmh' ? KMH_PER_MS : MPH_PER_MS);
    this.state.cruiseTarget = Math.max(CRUISE_MIN_SPEED, Math.min(this.speedLimitMs, this.state.cruiseTarget + sign * stepMs));
    this.toast(`Cruise target ${Math.round(speedInUnits(this.state.cruiseTarget, u))} ${unitLabel(u)}`);
    this.updateHud(true);
  }

  private onLapEvent(e: LapEvent): void {
    switch (e.type) {
      case 'started':
        if (this.laps.lapsCompleted === 0 && this.laps.lastLap === null) this.toast('Lap timer started');
        break;
      case 'completed':
        if (e.best) saveBestLap(this.laps.bestLap);
        this.toast(e.best ? `New best lap ${formatLapTime(e.time)}` : `Lap ${formatLapTime(e.time)}`);
        $('lap-best').classList.toggle('is-best', e.best);
        break;
      case 'invalid':
        if (e.reason === 'missed-checkpoint') this.toast('Lap not counted — a checkpoint was missed');
        if (e.reason === 'wrong-way') this.toast('Wrong way — lap cancelled');
        break;
      case 'checkpoint':
        break;
    }
    this.updateHud(true);
  }

  // ------------------------------------------------------------------ HUD

  private updateHud(force = false): void {
    const u = this.settings.driving.units;
    const speed = speedOf(this.state);
    $('hud-speed').textContent = String(Math.round(speedInUnits(speed, u)));
    if (!force && this.mode !== 'drive') return;
    $('hud-unit').textContent = unitLabel(u);
    $('gear-d').dataset.on = String(this.state.gear === 'D');
    $('gear-r').dataset.on = String(this.state.gear === 'R');
    $('t-gear').textContent = this.state.gear;
    $('hud-limit').textContent = String(Math.round(speedInUnits(this.speedLimitMs, u)));
    $('hud-cruise').textContent = this.state.cruiseOn ? String(Math.round(speedInUnits(this.state.cruiseTarget, u))) : 'Off';
    const fl = this.flight;
    const jets = fl.airborne
      ? `${fl.y.toFixed(1)} m`
      : fl.t >= 0
        ? 'Firing'
        : fl.charge < 1
          ? `${Math.ceil((1 - fl.charge) * RECHARGE_TIME)} s`
          : 'Ready';
    $('hud-jets').textContent = jets;
    const ready = canFly(fl);
    for (const id of ['btn-flight', 't-jet', 'flight-launch']) {
      const b = $(id);
      b.setAttribute('aria-disabled', String(!ready));
      b.classList.toggle('is-charging', !ready);
    }
    const scale = SPEED_LIMIT_MAX_KMH / KMH_PER_MS;
    $('hud-speedbar').style.width = `${Math.min(100, (speed / scale) * 100)}%`;
    $('hud-limitmark').style.left = `${Math.min(100, (this.speedLimitMs / scale) * 100)}%`;
    $('lap-current').textContent = this.laps.running ? formatLapTime(this.laps.currentTime(this.simTime)) : '—';
    $('lap-last').textContent = formatLapTime(this.laps.lastLap);
    $('lap-best').textContent = formatLapTime(this.laps.bestLap);
    $('lap-sector').textContent = this.laps.running ? `${this.laps.nextCheckpoint}/${this.laps.sectors}` : `–/${this.laps.sectors}`;
    $('s-best').textContent = formatLapTime(this.laps.bestLap);
    const ct = $('cruise-toggle');
    ct.setAttribute('aria-pressed', String(this.state.cruiseOn));
    ct.textContent = this.state.cruiseOn ? 'Disengage (K)' : 'Engage (K)';
    $('gear-toggle').textContent = this.state.gear === 'D' ? 'Select reverse (G)' : 'Select drive (G)';
  }

  toast(message: string): void {
    const t = $('toast');
    t.textContent = message;
    t.classList.add('is-visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('is-visible'), 2600);
  }

  // ------------------------------------------------------------------ settings application

  private applyAppearance(): void {
    const a = this.settings.appearance;
    this.car.setBodyColor(a.body);
    this.car.setFinish(a.finish);
    this.car.setWheelColor(a.wheels);
  }

  private applyLighting(): void {
    this.env.setNight(this.settings.lighting.night);
    this.car.setNight(this.settings.lighting.night);
    this.car.setHeadlights(this.settings.lighting.headlights);
  }

  private pickAutoQuality(): Quality {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const cores = navigator.hardwareConcurrency || 4;
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    if (coarse && (mem <= 4 || cores <= 4)) return 'low';
    if (coarse || mem <= 4 || cores <= 4) return 'medium';
    return 'high';
  }

  private applyGraphics(): void {
    const q = this.settings.graphics.quality;
    this.effectiveQuality = q === 'auto' ? this.pickAutoQuality() : q;
    this.applyQuality(this.effectiveQuality);
    document.documentElement.classList.toggle('reduced-motion', this.reducedMotion);
  }

  private applyQuality(q: Quality): void {
    const dpr = window.devicePixelRatio || 1;
    const ratio = q === 'low' ? Math.min(dpr, 1) * 0.8 : q === 'medium' ? Math.min(dpr, 1.5) : Math.min(dpr, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.env.setQuality(q);
    // Materials must recompile when shadows are toggled.
    this.env.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
      else if (m) m.needsUpdate = true;
    });
    this.resize();
    const status = document.getElementById('s-quality-status');
    if (status) status.textContent = `Active: ${q} · render scale ${ratio.toFixed(2)}×`;
  }

  private applyAudioSettings(): void {
    const a = this.settings.audio;
    this.audio.configure(a.enabled, a.volume, a.muted);
    const btn = $('btn-mute');
    btn.setAttribute('aria-pressed', String(a.muted || !a.enabled));
    btn.querySelector('use')?.setAttribute('href', a.muted || !a.enabled ? '#i-mute' : '#i-sound');
    btn.setAttribute('aria-label', a.muted || !a.enabled ? 'Sound off. Turn sound on' : 'Sound on. Mute');
  }

  private persist(): void {
    saveSettings(this.settings);
    this.syncStuntAppearance();
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
    this.stunt.resize(w, h);
    this.minimap.resize();
    this.updateTouchVisibility();
    this.wake();
  }

  // ------------------------------------------------------------------ visibility & focus

  private onVisibility(): void {
    if (document.hidden) {
      this.input.releaseAll();
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      if (this.mode === 'drive' && this.pauseReason === null) this.pause('user');
      this.audio.suspend();
    } else {
      this.wake();
    }
  }

  private onWindowBlur(): void {
    this.input.releaseAll();
    this.lastInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    // A native colour picker can briefly take focus; don't pause for that.
    const active = document.activeElement as HTMLInputElement | null;
    if (active && active.type === 'color') return;
    window.setTimeout(() => {
      if (!document.hasFocus() && this.mode === 'drive' && this.pauseReason === null) this.pause('user');
    }, 150);
  }

  private get touchVisible(): boolean {
    const t = this.settings.graphics.touchControls;
    if (t === 'off') return false;
    if (t === 'on') return true;
    return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  }

  private updateTouchVisibility(): void {
    const show = this.mode === 'drive' && this.touchVisible;
    $('touch').hidden = !show;
    document.body.classList.toggle('touch-on', show);
  }

  // ------------------------------------------------------------------ input

  private bindInput(): void {
    this.input.dialogOpen = () => !!document.querySelector('dialog[open]');
    this.input.onOrbitKey = (dYaw, dPitch, zoom) => {
      if (this.mode !== 'showroom') return;
      this.rig.orbitBy(dYaw, dPitch);
      this.rig.zoomBy(zoom);
      this.wake();
    };
    this.input.onAction((a: ActionName) => this.onAction(a));
    this.input.bindHold($('t-left'), 'left');
    this.input.bindHold($('t-right'), 'right');
    this.input.bindHold($('t-gas'), 'up');
    this.input.bindHold($('t-brake'), 'down');
    this.input.bindHold($('t-hand'), 'handbrake');
    $('t-gear').addEventListener('click', () => this.toggleGear());
    $('t-jet').addEventListener('click', () => this.launchFlight());

    // Any first interaction may start audio (browsers require a user gesture).
    const unlock = () => {
      if (this.settings.audio.enabled) this.audio.unlock();
      if (this.mode !== 'drive' || this.pauseReason !== null) this.audio.update(0, 0, 0, false);
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);

    // Mouse clicks shouldn't leave buttons focused, or Space would press them
    // instead of applying the handbrake. Keyboard focus is unaffected.
    document.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse') return;
      const b = (e.target as HTMLElement | null)?.closest('#topbar-actions button, .modes button, #btn-start, .stunt-controls button, .stunt-timeline button');
      if (b instanceof HTMLElement && !b.closest('dialog')) window.setTimeout(() => b.blur(), 0);
    });
  }

  private onAction(a: ActionName): void {
    switch (a) {
      case 'camera':
        if (this.mode === 'stunt') {
          const c = this.stunt.cycleCamera();
          this.toast(`${c[0].toUpperCase()}${c.slice(1)} camera`);
        } else this.cycleCamera();
        break;
      case 'reset':
        if (this.mode === 'drive') this.resetCar();
        else if (this.mode === 'stunt') this.stunt.restart();
        break;
      case 'pause':
        if (this.mode === 'drive') this.togglePause();
        else if (this.mode === 'stunt' && $('panel').hidden) this.stunt.togglePlay();
        else if (!$('panel').hidden) this.setPanel(false);
        break;
      case 'gear':
        this.toggleGear();
        break;
      case 'cruise':
        this.toggleCruise();
        break;
      case 'cruiseUp':
        this.adjustCruise(1);
        break;
      case 'cruiseDown':
        this.adjustCruise(-1);
        break;
      case 'headlights':
        this.settings.lighting.headlights = !this.settings.lighting.headlights;
        $<HTMLInputElement>('headlights').checked = this.settings.lighting.headlights;
        this.applyLighting();
        this.persist();
        this.toast(`Headlights ${this.settings.lighting.headlights ? 'on' : 'off'}`);
        this.wake();
        break;
      case 'units':
        this.setUnits(this.settings.driving.units === 'kmh' ? 'mph' : 'kmh');
        break;
      case 'mute':
        this.settings.audio.muted = !this.settings.audio.muted;
        this.applyAudioSettings();
        this.syncSettingsForm();
        this.persist();
        this.toast(this.settings.audio.muted ? 'Sound muted' : 'Sound on');
        break;
      case 'flight':
        this.launchFlight();
        break;
      case 'help':
        this.openDialog('dlg-help');
        break;
    }
  }

  private bindCanvas(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (this.mode === 'drive') {
        c.focus({ preventScroll: true });
        return;
      }
      this.orbitPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      c.style.cursor = 'grabbing';
      if (this.orbitPointers.size === 2) this.pinchDist = this.currentPinch();
      this.wake();
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.orbitPointers.get(e.pointerId);
      if (!p || this.mode === 'drive') return;
      if (this.orbitPointers.size === 1) {
        if (this.mode === 'stunt') this.stunt.orbitBy(-(e.clientX - p.x) * 0.006, (e.clientY - p.y) * 0.005);
        else this.rig.orbitBy(-(e.clientX - p.x) * 0.006, (e.clientY - p.y) * 0.005);
      }
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.orbitPointers.size === 2) {
        const d = this.currentPinch();
        if (this.pinchDist > 0 && d > 0) {
          if (this.mode === 'stunt') this.stunt.zoomBy(this.pinchDist / d);
          else this.rig.zoomBy(this.pinchDist / d);
        }
        this.pinchDist = d;
      }
      this.wake();
    });
    const end = (e: PointerEvent) => {
      this.orbitPointers.delete(e.pointerId);
      this.pinchDist = this.orbitPointers.size === 2 ? this.currentPinch() : 0;
      c.style.cursor = '';
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('lostpointercapture', end);
    c.addEventListener(
      'wheel',
      (e) => {
        if (this.mode === 'drive') return;
        e.preventDefault();
        if (this.mode === 'stunt') this.stunt.zoomBy(Math.exp(e.deltaY * 0.0012));
        else this.rig.zoomBy(Math.exp(e.deltaY * 0.0012));
        this.wake();
      },
      { passive: false },
    );
  }

  private currentPinch(): number {
    const pts = [...this.orbitPointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  // ------------------------------------------------------------------ UI bindings

  private setPanel(open: boolean): void {
    $('panel').hidden = !open;
    $('btn-panel').setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('panel-open', open);
  }

  private openDialog(id: string): void {
    const d = $<HTMLDialogElement>(id);
    if (d.open) return;
    if (this.mode === 'drive' && this.pauseReason === null) this.pause('dialog');
    const pd = $<HTMLDialogElement>('dlg-pause');
    if (pd.open && id !== 'dlg-pause') pd.close('switch');
    this.syncSettingsForm();
    d.showModal();
  }

  private closeDialogs(): void {
    document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close('switch'));
  }

  private setUnits(units: 'kmh' | 'mph'): void {
    this.settings.driving.units = units;
    document.querySelectorAll<HTMLInputElement>('input[name="units"]').forEach((r) => (r.checked = r.value === units));
    this.syncLimitSlider();
    this.persist();
    this.updateHud(true);
    this.toast(`Speed shown in ${unitLabel(units)}`);
  }

  private syncLimitSlider(): void {
    const u = this.settings.driving.units;
    const s = $<HTMLInputElement>('speed-limit');
    if (u === 'kmh') {
      s.min = String(SPEED_LIMIT_MIN_KMH);
      s.max = String(SPEED_LIMIT_MAX_KMH);
      s.step = '5';
      s.value = String(this.settings.driving.speedLimitKmh);
    } else {
      s.min = String(Math.round((SPEED_LIMIT_MIN_KMH / KMH_PER_MS) * MPH_PER_MS));
      s.max = String(Math.round((SPEED_LIMIT_MAX_KMH / KMH_PER_MS) * MPH_PER_MS));
      s.step = '5';
      s.value = String(Math.round((this.settings.driving.speedLimitKmh / KMH_PER_MS) * MPH_PER_MS));
    }
    const label = `${s.value} ${unitLabel(u)}`;
    $('speed-limit-out').textContent = label;
    s.setAttribute('aria-valuetext', label);
  }

  private markSwatches(containerId: string, hex: string): void {
    $(containerId)
      .querySelectorAll<HTMLButtonElement>('.swatch')
      .forEach((b) => {
        const on = b.dataset.hex!.toLowerCase() === hex.toLowerCase();
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
      });
  }

  private buildSwatches(containerId: string, list: Array<[string, string]>, groupLabel: string, onPick: (hex: string) => void): void {
    const box = $(containerId);
    box.setAttribute('role', 'radiogroup');
    box.setAttribute('aria-label', groupLabel);
    for (const [name, hex] of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', name);
      b.dataset.hex = hex;
      b.style.setProperty('--c', hex);
      b.style.setProperty('--label', luminance(hex) > 0.5 ? '#0e0e0f' : '#ffffff');
      const span = document.createElement('span');
      span.textContent = name;
      span.setAttribute('aria-hidden', 'true');
      b.append(span);
      b.addEventListener('click', () => onPick(hex));
      box.append(b);
    }
    // Arrow-key navigation within the radio group.
    box.addEventListener('keydown', (e) => {
      const items = [...box.querySelectorAll<HTMLButtonElement>('.swatch')];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0) return;
      let j = i;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % items.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + items.length) % items.length;
      else return;
      e.preventDefault();
      e.stopPropagation();
      items[j].focus();
      items[j].click();
    });
  }

  private setBody(hex: string): void {
    this.settings.appearance.body = hex;
    this.car.setBodyColor(hex);
    $<HTMLInputElement>('body-color').value = hex;
    $('body-hex').textContent = hex.toUpperCase();
    this.markSwatches('body-swatches', hex);
    this.persist();
    this.wake();
  }

  private setWheels(hex: string): void {
    this.settings.appearance.wheels = hex;
    this.car.setWheelColor(hex);
    $<HTMLInputElement>('wheel-color').value = hex;
    $('wheel-hex').textContent = hex.toUpperCase();
    this.markSwatches('wheel-swatches', hex);
    this.persist();
    this.wake();
  }

  private syncAppearanceForm(): void {
    const a = this.settings.appearance;
    $<HTMLInputElement>('body-color').value = a.body;
    $('body-hex').textContent = a.body.toUpperCase();
    this.markSwatches('body-swatches', a.body);
    $<HTMLInputElement>('wheel-color').value = a.wheels;
    $('wheel-hex').textContent = a.wheels.toUpperCase();
    this.markSwatches('wheel-swatches', a.wheels);
    document.querySelectorAll<HTMLInputElement>('input[name="finish"]').forEach((r) => (r.checked = r.value === a.finish));
    $<HTMLInputElement>('headlights').checked = this.settings.lighting.headlights;
    document
      .querySelectorAll<HTMLInputElement>('input[name="time"]')
      .forEach((r) => (r.checked = r.value === (this.settings.lighting.night ? 'night' : 'day')));
  }

  private syncSettingsForm(): void {
    const g = this.settings.graphics;
    $<HTMLSelectElement>('s-quality').value = g.quality;
    $<HTMLInputElement>('s-shake').checked = g.shake;
    $<HTMLInputElement>('s-fov').checked = g.speedFov;
    $<HTMLSelectElement>('s-motion').value = g.reducedMotion;
    $<HTMLSelectElement>('s-touch').value = g.touchControls;
    const a = this.settings.audio;
    $<HTMLInputElement>('s-audio').checked = a.enabled;
    $<HTMLInputElement>('s-volume').value = String(Math.round(a.volume * 100));
    $('s-volume-out').textContent = `${Math.round(a.volume * 100)}%`;
    $<HTMLInputElement>('s-muted').checked = a.muted;
    $('s-best').textContent = formatLapTime(this.laps.bestLap);
  }

  private bindUi(): void {
    // Modes
    $('mode-showroom').addEventListener('click', () => this.enterShowroom());
    $('mode-drive').addEventListener('click', () => this.enterDrive());
    $('mode-stunt').addEventListener('click', () => this.enterStunt());
    this.stunt.onChange = () => this.wake();
    this.stunt.bindUi();
    $('btn-start').addEventListener('click', () => this.enterDrive());

    // Top bar
    $('btn-panel').addEventListener('click', () => this.setPanel($('panel').hidden !== false));
    $('panel-close').addEventListener('click', () => {
      this.setPanel(false);
      $('btn-panel').focus();
    });
    $('btn-camera').addEventListener('click', () => this.cycleCamera());
    $('btn-reset').addEventListener('click', () => this.resetCar());
    $('btn-pause').addEventListener('click', () => this.togglePause());
    $('btn-mute').addEventListener('click', () => {
      const s = this.settings.audio;
      if (!s.enabled) {
        s.enabled = true;
        s.muted = false;
      } else s.muted = !s.muted;
      this.applyAudioSettings();
      if (s.enabled && !s.muted) this.audio.unlock();
      this.persist();
      this.toast(s.muted ? 'Sound muted' : 'Sound on');
    });
    $('btn-settings').addEventListener('click', () => this.openDialog('dlg-settings'));
    $('btn-help').addEventListener('click', () => this.openDialog('dlg-help'));
    $('btn-about').addEventListener('click', () => this.openDialog('dlg-about'));

    // Panel tabs
    const tabs = [$('tab-look'), $('tab-drive')];
    const selectTab = (t: HTMLElement) => {
      for (const x of tabs) {
        const on = x === t;
        x.setAttribute('aria-selected', String(on));
        x.tabIndex = on ? 0 : -1;
        $(x.getAttribute('aria-controls')!).hidden = !on;
      }
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => selectTab(t));
      t.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        n.focus();
        selectTab(n);
      });
    });

    // Appearance
    this.buildSwatches('body-swatches', BODY_SWATCHES, 'Body colour presets', (hex) => this.setBody(hex));
    this.buildSwatches('wheel-swatches', WHEEL_SWATCHES, 'Wheel colour presets', (hex) => this.setWheels(hex));
    $<HTMLInputElement>('body-color').addEventListener('input', (e) => this.setBody((e.target as HTMLInputElement).value));
    $<HTMLInputElement>('wheel-color').addEventListener('input', (e) => this.setWheels((e.target as HTMLInputElement).value));
    document.querySelectorAll<HTMLInputElement>('input[name="finish"]').forEach((r) =>
      r.addEventListener('change', () => {
        this.settings.appearance.finish = r.value as Finish;
        this.car.setFinish(r.value as Finish);
        this.persist();
        this.wake();
      }),
    );
    $<HTMLInputElement>('headlights').addEventListener('change', (e) => {
      this.settings.lighting.headlights = (e.target as HTMLInputElement).checked;
      this.applyLighting();
      this.persist();
      this.wake();
    });
    document.querySelectorAll<HTMLInputElement>('input[name="time"]').forEach((r) =>
      r.addEventListener('change', () => {
        this.settings.lighting.night = r.value === 'night';
        this.applyLighting();
        this.persist();
        this.wake();
      }),
    );
    $('reset-look').addEventListener('click', () => {
      this.settings.appearance = { ...DEFAULT_APPEARANCE };
      this.applyAppearance();
      this.syncAppearanceForm();
      this.persist();
      this.toast('Appearance reset');
      this.wake();
    });
    this.syncAppearanceForm();

    // Driving tab
    document.querySelectorAll<HTMLInputElement>('input[name="units"]').forEach((r) => {
      r.checked = r.value === this.settings.driving.units;
      r.addEventListener('change', () => this.setUnits(r.value as 'kmh' | 'mph'));
    });
    const limit = $<HTMLInputElement>('speed-limit');
    limit.addEventListener('input', () => {
      const v = Number(limit.value);
      const kmh = this.settings.driving.units === 'kmh' ? v : (v / MPH_PER_MS) * KMH_PER_MS;
      this.settings.driving.speedLimitKmh = Math.round(Math.min(SPEED_LIMIT_MAX_KMH, Math.max(SPEED_LIMIT_MIN_KMH, kmh)));
      const label = `${limit.value} ${unitLabel(this.settings.driving.units)}`;
      $('speed-limit-out').textContent = label;
      limit.setAttribute('aria-valuetext', label);
      this.persist();
      this.updateHud(true);
    });
    this.syncLimitSlider();
    $('cruise-toggle').addEventListener('click', () => {
      if (this.mode !== 'drive') {
        this.toast('Cruise control works in Drive mode');
        return;
      }
      this.toggleCruise();
    });
    $('cruise-up').addEventListener('click', () => this.adjustCruise(1));
    $('cruise-down').addEventListener('click', () => this.adjustCruise(-1));
    $('gear-toggle').addEventListener('click', () => this.toggleGear());
    $('btn-flight').addEventListener('click', () => this.launchFlight());
    $('flight-launch').addEventListener('click', () => this.launchFlight());
    const roll = $<HTMLInputElement>('flight-roll');
    roll.checked = this.settings.driving.flightRoll;
    roll.addEventListener('change', () => {
      this.settings.driving.flightRoll = roll.checked;
      this.persist();
      this.toast(roll.checked ? 'Barrel roll on for the next flight' : 'Barrel roll off — straight jumps');
    });

    // Pause dialog
    const pd = $<HTMLDialogElement>('dlg-pause');
    $('p-resume').addEventListener('click', () => this.resume());
    $('p-reset').addEventListener('click', () => {
      this.resetCar();
      this.resume();
    });
    $('p-showroom').addEventListener('click', () => this.enterShowroom());
    $('p-help').addEventListener('click', () => this.openDialog('dlg-help'));
    pd.addEventListener('close', () => {
      // Escape or Resume: continue driving. Switching to another dialog keeps the pause.
      if (pd.returnValue === 'switch') {
        pd.returnValue = '';
        return;
      }
      if (this.pauseReason === 'user') this.resume();
    });

    // Other dialogs: when closed, return to the pause menu or resume.
    for (const id of ['dlg-settings', 'dlg-help', 'dlg-about']) {
      const d = $<HTMLDialogElement>(id);
      d.addEventListener('close', () => {
        if (d.returnValue === 'switch') {
          d.returnValue = '';
          return;
        }
        if (this.mode === 'drive') {
          if (this.pauseReason === 'dialog') this.resume();
          else if (this.pauseReason === 'user') this.showPauseDialog();
        }
      });
    }

    // Settings dialog
    $<HTMLSelectElement>('s-quality').addEventListener('change', (e) => {
      this.settings.graphics.quality = (e.target as HTMLSelectElement).value as Settings['graphics']['quality'];
      this.applyGraphics();
      this.persist();
    });
    $<HTMLInputElement>('s-shake').addEventListener('change', (e) => {
      this.settings.graphics.shake = (e.target as HTMLInputElement).checked;
      this.persist();
    });
    $<HTMLInputElement>('s-fov').addEventListener('change', (e) => {
      this.settings.graphics.speedFov = (e.target as HTMLInputElement).checked;
      this.persist();
    });
    $<HTMLSelectElement>('s-motion').addEventListener('change', (e) => {
      this.settings.graphics.reducedMotion = (e.target as HTMLSelectElement).value as Settings['graphics']['reducedMotion'];
      document.documentElement.classList.toggle('reduced-motion', this.reducedMotion);
      this.persist();
    });
    $<HTMLSelectElement>('s-touch').addEventListener('change', (e) => {
      this.settings.graphics.touchControls = (e.target as HTMLSelectElement).value as Settings['graphics']['touchControls'];
      this.updateTouchVisibility();
      this.persist();
    });
    $<HTMLInputElement>('s-audio').addEventListener('change', (e) => {
      this.settings.audio.enabled = (e.target as HTMLInputElement).checked;
      this.applyAudioSettings();
      if (this.settings.audio.enabled) this.audio.unlock();
      this.persist();
    });
    $<HTMLInputElement>('s-volume').addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value) / 100;
      this.settings.audio.volume = v;
      $('s-volume-out').textContent = `${Math.round(v * 100)}%`;
      this.applyAudioSettings();
      this.persist();
    });
    $<HTMLInputElement>('s-muted').addEventListener('change', (e) => {
      this.settings.audio.muted = (e.target as HTMLInputElement).checked;
      this.applyAudioSettings();
      this.persist();
    });
    $('s-reset-best').addEventListener('click', () => {
      if (this.laps.bestLap === null) {
        this.toast('No best lap recorded yet');
        return;
      }
      if (!window.confirm('Delete your best lap time from this browser?')) return;
      this.laps.bestLap = null;
      saveBestLap(null);
      this.syncSettingsForm();
      this.updateHud(true);
      this.toast('Best lap cleared');
    });
    this.syncSettingsForm();

    // Fatal retry
    $('fatal-retry').addEventListener('click', () => window.location.reload());
  }

  // ------------------------------------------------------------------ diagnostics (used by automated tests)

  private exposeDiagnostics(): void {
    const app = this;
    (window as unknown as { roadster: unknown }).roadster = {
      get mode() {
        return app.mode;
      },
      get paused() {
        return app.pauseReason !== null;
      },
      get camera() {
        return app.rig.mode;
      },
      get gear() {
        return app.state.gear;
      },
      get speedMs() {
        return speedOf(app.state);
      },
      get forwardMs() {
        return forwardSpeed(app.state);
      },
      get flight() {
        const f = app.flight;
        return { y: f.y, vy: f.vy, roll: f.roll, airborne: f.airborne, t: f.t, charge: f.charge, peak: f.peak, rollEnabled: f.rollEnabled };
      },
      get cruise() {
        return { on: app.state.cruiseOn, target: app.state.cruiseTarget };
      },
      get position() {
        return { x: app.state.x, z: app.state.z, heading: app.state.heading };
      },
      get lateral() {
        return app.track.nearest(app.state.x, app.state.z).lateral;
      },
      get maxLateral() {
        return app.diagMaxLateral;
      },
      get laps() {
        return {
          running: app.laps.running,
          next: app.laps.nextCheckpoint,
          last: app.laps.lastLap,
          best: app.laps.bestLap,
          completed: app.laps.lapsCompleted,
        };
      },
      get input() {
        return app.input.read();
      },
      get bodyColor() {
        return '#' + app.car.bodyMaterial.color.getHexString();
      },
      get wheelColor() {
        return '#' + app.car.wheelMaterial.color.getHexString();
      },
      get glassColor() {
        return '#' + app.car.glassMaterial.color.getHexString();
      },
      get finish() {
        const m = app.car.bodyMaterial;
        return { metalness: m.metalness, roughness: m.roughness, clearcoat: m.clearcoat };
      },
      get headlights() {
        return app.car.headlights.map((h) => h.intensity);
      },
      get loopRunning() {
        return app.rafId !== 0;
      },
      get stunt() {
        const st = app.stunt;
        const r = st.stunt;
        return {
          vehicle: r.vehicle.id,
          time: st.time,
          duration: r.duration,
          playing: st.playing,
          camera: st.cameraMode,
          cutaway: st.cutaway,
          path: st.showPath,
          arrows: st.showArrows,
          mass: r.mass,
          verdicts: { wall: r.verdicts.wallHold, ceiling: r.verdicts.ceilingHold, lift: r.verdicts.liftOff },
          ramp: r.ramp,
          flight: r.flight,
          flightStart: r.flightStart,
        };
      },
      get settings() {
        return structuredClone(app.settings);
      },
      startIndex: this.startIndex,
      trackSamples: this.track.count,
      /** Teleport for tests (e.g. to check barriers or laps). */
      place(index: number, lateral = 0, headingOffset = 0, speedMs = 0) {
        const s = app.track.sample(index);
        app.rules.resetCar(app.state, ((index % app.track.count) + app.track.count) % app.track.count);
        app.state.x = s.x + s.nx * lateral;
        app.state.z = s.z + s.nz * lateral;
        app.state.heading += headingOffset;
        app.state.vx = Math.sin(app.state.heading) * speedMs;
        app.state.vz = Math.cos(app.state.heading) * speedMs;
        app.laps.invalidate();
        app.diagMaxLateral = 0;
        app.wake();
      },
      /**
       * Run the real fixed-step pipeline with synthetic frame intervals, to check
       * that results do not depend on the display refresh rate.
       */
      simulateAtFps(fps: number, seconds: number, throttle = 1, steer = 0) {
        const s = createCarState();
        const rules = new TrackRules(app.track);
        rules.resetCar(s, app.startIndex);
        const stepper = new FixedStepper(120);
        const frames = Math.round(seconds * fps);
        for (let f = 0; f < frames; f++) {
          const n = stepper.advance(1 / fps);
          for (let i = 0; i < n; i++) {
            const surf = rules.apply(s).surface;
            stepCar(s, { throttle, brake: 0, steer, handbrake: false }, DEFAULT_PARAMS, { speedLimit: 75, surface: surf }, stepper.step);
            rules.apply(s);
          }
        }
        return { speedKmh: speedOf(s) * 3.6, x: s.x, z: s.z, heading: s.heading };
      },
    };
  }
}

export function showFatal(title: string, text: string): void {
  const f = document.getElementById('fatal');
  const l = document.getElementById('loader');
  if (l) l.hidden = true;
  if (!f) return;
  (document.getElementById('fatal-title') as HTMLElement).textContent = title;
  (document.getElementById('fatal-text') as HTMLElement).textContent = text;
  f.hidden = false;
}
