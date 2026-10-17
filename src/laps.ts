/**
 * Lap timing with ordered checkpoints (pure, no DOM/Three.js).
 *
 * The loop is divided into `sectors` equal parts. A lap only counts when every
 * intermediate checkpoint has been crossed in order, travelling forwards, before
 * the start/finish line is crossed again. Time is simulation time, so pausing
 * or a slow frame rate does not change lap times.
 */

export type LapEvent =
  | { type: 'started' }
  | { type: 'checkpoint'; index: number; of: number }
  | { type: 'completed'; time: number; best: boolean }
  | { type: 'invalid'; reason: 'missed-checkpoint' | 'wrong-way' | 'reset' };

export class LapTimer {
  readonly checkpoints: number[];
  private prev = -1;
  running = false;
  lapStart = 0;
  nextCheckpoint = 1;
  lastLap: number | null = null;
  bestLap: number | null;
  lapsCompleted = 0;

  constructor(
    readonly sampleCount: number,
    readonly startIndex: number,
    readonly sectors = 8,
    bestLap: number | null = null,
  ) {
    this.bestLap = bestLap;
    this.checkpoints = [];
    for (let k = 1; k < sectors; k++) this.checkpoints.push(Math.round((sampleCount * k) / sectors));
  }

  /** Position relative to the start line, 0..n−1. */
  private rel(index: number): number {
    const n = this.sampleCount;
    return (((index - this.startIndex) % n) + n) % n;
  }

  currentTime(now: number): number {
    return this.running ? now - this.lapStart : 0;
  }

  /** Forget the car's position (after a reset or teleport) and void the lap in progress. */
  invalidate(): LapEvent | null {
    this.prev = -1;
    const wasRunning = this.running;
    this.running = false;
    this.nextCheckpoint = 1;
    return wasRunning ? { type: 'invalid', reason: 'reset' } : null;
  }

  update(index: number, now: number): LapEvent[] {
    const events: LapEvent[] = [];
    const n = this.sampleCount;
    const r = this.rel(index);
    if (this.prev < 0) {
      this.prev = r;
      return events;
    }
    const p = this.prev;
    let delta = r - p;
    if (delta > n / 2) delta -= n;
    if (delta < -n / 2) delta += n;
    this.prev = r;
    if (delta === 0) return events;
    if (Math.abs(delta) > 40) {
      // Discontinuity: treat like a reset.
      const ev = this.invalidate();
      if (ev) events.push(ev);
      this.prev = r;
      return events;
    }

    const crossedStartForward = delta > 0 && r < p; // wrapped past rel 0
    const crossedStartBackward = delta < 0 && r > p;

    if (delta > 0 && !crossedStartForward) {
      // Intermediate checkpoints, strictly in order.
      while (this.nextCheckpoint <= this.checkpoints.length) {
        const cp = this.checkpoints[this.nextCheckpoint - 1];
        if (p < cp && r >= cp) {
          if (this.running) events.push({ type: 'checkpoint', index: this.nextCheckpoint, of: this.checkpoints.length });
          this.nextCheckpoint++;
        } else break;
      }
    } else if (delta < 0 && this.running && !crossedStartBackward) {
      // Driving backwards over a checkpoint un-passes it.
      const lastPassed = this.nextCheckpoint - 1;
      if (lastPassed >= 1) {
        const cp = this.checkpoints[lastPassed - 1];
        if (p >= cp && r < cp) this.nextCheckpoint = lastPassed;
      }
    }

    if (crossedStartBackward && this.running) {
      this.running = false;
      this.nextCheckpoint = 1;
      events.push({ type: 'invalid', reason: 'wrong-way' });
    }

    if (crossedStartForward) {
      if (this.running) {
        if (this.nextCheckpoint > this.checkpoints.length) {
          const time = now - this.lapStart;
          const best = this.bestLap === null || time < this.bestLap;
          if (best) this.bestLap = time;
          this.lastLap = time;
          this.lapsCompleted++;
          events.push({ type: 'completed', time, best });
        } else {
          events.push({ type: 'invalid', reason: 'missed-checkpoint' });
        }
      }
      this.running = true;
      this.lapStart = now;
      this.nextCheckpoint = 1;
      events.push({ type: 'started' });
    }
    return events;
  }
}

export function formatLapTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}
