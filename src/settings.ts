/** Persisted user settings, kept in clearly separated groups. */
import type { Finish } from './car-model.js';
import type { Quality } from './environment.js';

export type Units = 'kmh' | 'mph';

export interface Settings {
  /** Vehicle appearance only. */
  appearance: {
    body: string;
    finish: Finish;
    wheels: string;
  };
  /** Scene lighting (showroom and drive). */
  lighting: {
    night: boolean;
    headlights: boolean;
  };
  /** Driving / physics behaviour. */
  driving: {
    units: Units;
    speedLimitKmh: number;
  };
  /** Rendering and comfort effects. */
  graphics: {
    quality: 'auto' | Quality;
    shake: boolean;
    speedFov: boolean;
    reducedMotion: 'system' | 'on' | 'off';
    touchControls: 'auto' | 'on' | 'off';
  };
  audio: {
    enabled: boolean;
    volume: number; // 0..1
    muted: boolean;
  };
}

export const DEFAULT_APPEARANCE: Settings['appearance'] = {
  body: '#a3141c',
  finish: 'gloss',
  wheels: '#3a3b3d',
};

export const DEFAULT_SETTINGS: Settings = {
  appearance: { ...DEFAULT_APPEARANCE },
  lighting: { night: false, headlights: true },
  driving: { units: 'kmh', speedLimitKmh: 180 },
  graphics: { quality: 'auto', shake: true, speedFov: true, reducedMotion: 'system', touchControls: 'auto' },
  audio: { enabled: true, volume: 0.5, muted: false },
};

export const SPEED_LIMIT_MIN_KMH = 30;
export const SPEED_LIMIT_MAX_KMH = 270;

const KEY = 'grid-roadster.settings.v1';
const BEST_KEY = 'grid-roadster.best-lap.v1';

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode, blocked) — settings simply won't persist */
  }
}

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

export function loadSettings(): Settings {
  const s: Settings = structuredClone(DEFAULT_SETTINGS);
  const raw = safeGet(KEY);
  if (!raw) return s;
  try {
    const p = JSON.parse(raw) as Partial<Settings>;
    if (p.appearance) {
      if (isHex(p.appearance.body)) s.appearance.body = p.appearance.body;
      if (isHex(p.appearance.wheels)) s.appearance.wheels = p.appearance.wheels;
      if (['gloss', 'metallic', 'matte'].includes(p.appearance.finish as string)) s.appearance.finish = p.appearance.finish!;
    }
    if (p.lighting) {
      s.lighting.night = !!p.lighting.night;
      s.lighting.headlights = p.lighting.headlights !== false;
    }
    if (p.driving) {
      if (p.driving.units === 'mph' || p.driving.units === 'kmh') s.driving.units = p.driving.units;
      const lim = Number(p.driving.speedLimitKmh);
      if (Number.isFinite(lim)) s.driving.speedLimitKmh = Math.min(SPEED_LIMIT_MAX_KMH, Math.max(SPEED_LIMIT_MIN_KMH, lim));
    }
    if (p.graphics) {
      const g = p.graphics;
      if (['auto', 'low', 'medium', 'high'].includes(g.quality as string)) s.graphics.quality = g.quality!;
      if (typeof g.shake === 'boolean') s.graphics.shake = g.shake;
      if (typeof g.speedFov === 'boolean') s.graphics.speedFov = g.speedFov;
      if (['system', 'on', 'off'].includes(g.reducedMotion as string)) s.graphics.reducedMotion = g.reducedMotion!;
      if (['auto', 'on', 'off'].includes(g.touchControls as string)) s.graphics.touchControls = g.touchControls!;
    }
    if (p.audio) {
      if (typeof p.audio.enabled === 'boolean') s.audio.enabled = p.audio.enabled;
      if (typeof p.audio.muted === 'boolean') s.audio.muted = p.audio.muted;
      const v = Number(p.audio.volume);
      if (Number.isFinite(v)) s.audio.volume = Math.min(1, Math.max(0, v));
    }
  } catch {
    /* corrupt data — fall back to defaults */
  }
  return s;
}

export function saveSettings(s: Settings): void {
  safeSet(KEY, JSON.stringify(s));
}

export function loadBestLap(): number | null {
  const v = Number(safeGet(BEST_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function saveBestLap(seconds: number | null): void {
  safeSet(BEST_KEY, seconds === null ? null : String(seconds));
}

export const KMH_PER_MS = 3.6;
export const MPH_PER_MS = 2.2369363;

export function speedInUnits(ms: number, units: Units): number {
  return ms * (units === 'kmh' ? KMH_PER_MS : MPH_PER_MS);
}

export function unitLabel(units: Units): string {
  return units === 'kmh' ? 'km/h' : 'mph';
}
