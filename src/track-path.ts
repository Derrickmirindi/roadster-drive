/**
 * Pure track geometry (no Three.js dependency, so it can be unit-tested in Node).
 *
 * World scale: 1 unit = 1 metre. The track lies on the flat ground plane (y = 0);
 * positions are expressed as (x, z). Heading 0 points along +z, and a heading of
 * θ points along (sin θ, cos θ) — the same convention Three.js uses for rotation.y.
 */

export interface TrackSample {
  /** Centre-line position (m). */
  x: number;
  z: number;
  /** Unit tangent in the direction of travel. */
  tx: number;
  tz: number;
  /** Unit normal pointing to the driver's left. */
  nx: number;
  nz: number;
  /** Arc length from the first sample (m). */
  s: number;
  /** Signed curvature (1/m); positive turns left. */
  curvature: number;
}

export interface NearestResult {
  index: number;
  /** Fraction along the segment index → index + 1. */
  t: number;
  /** Signed distance from the centre line; positive is to the left (m). */
  lateral: number;
  /** Arc length of the projected point (m). */
  along: number;
  /** Projected centre-line point. */
  px: number;
  pz: number;
}

/**
 * Control points for the circuit, in metres. The loop is driven in this order.
 * Designed so that the tightest radius stays well above the barrier offset.
 */
export const CIRCUIT_POINTS: ReadonlyArray<readonly [number, number]> = [
  [-260, -150],
  [-60, -170],
  [160, -165],
  [300, -120],
  [350, -10],
  [300, 90],
  [190, 115],
  [110, 60],
  [20, 70],
  [-40, 150],
  [-170, 185],
  [-300, 140],
  [-350, 20],
  [-330, -95],
];

function centripetalCatmullRom(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
  steps: number,
  out: Array<[number, number]>,
): void {
  const alpha = 0.5;
  const dist = (a: readonly [number, number], b: readonly [number, number]) =>
    Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), alpha) || 1e-4;
  const t0 = 0;
  const t1 = t0 + dist(p0, p1);
  const t2 = t1 + dist(p1, p2);
  const t3 = t2 + dist(p2, p3);
  for (let i = 0; i < steps; i++) {
    const t = t1 + ((t2 - t1) * i) / steps;
    const lerp = (a: readonly [number, number], b: readonly [number, number], ta: number, tb: number) => {
      const w = (t - ta) / (tb - ta);
      return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w] as const;
    };
    const a1 = lerp(p0, p1, t0, t1);
    const a2 = lerp(p1, p2, t1, t2);
    const a3 = lerp(p2, p3, t2, t3);
    const b1 = lerp(a1, a2, t0, t2);
    const b2 = lerp(a2, a3, t1, t3);
    const c = lerp(b1, b2, t1, t2);
    out.push([c[0], c[1]]);
  }
}

export class TrackPath {
  readonly samples: TrackSample[];
  readonly length: number;
  readonly spacing: number;
  readonly minRadius: number;

  constructor(points: ReadonlyArray<readonly [number, number]> = CIRCUIT_POINTS, spacing = 2) {
    // 1. Dense spline evaluation.
    const dense: Array<[number, number]> = [];
    const n = points.length;
    for (let i = 0; i < n; i++) {
      centripetalCatmullRom(
        points[(i - 1 + n) % n],
        points[i],
        points[(i + 1) % n],
        points[(i + 2) % n],
        80,
        dense,
      );
    }
    // 2. Cumulative length of the dense polyline.
    const cum: number[] = [0];
    for (let i = 1; i <= dense.length; i++) {
      const a = dense[i - 1];
      const b = dense[i % dense.length];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
    }
    const total = cum[cum.length - 1];
    // 3. Resample at (nearly) uniform spacing so the loop closes exactly.
    const count = Math.round(total / spacing);
    this.spacing = total / count;
    this.length = total;
    const pos: Array<[number, number]> = [];
    let j = 0;
    for (let k = 0; k < count; k++) {
      const target = k * this.spacing;
      while (cum[j + 1] < target) j++;
      const w = (target - cum[j]) / (cum[j + 1] - cum[j] || 1);
      const a = dense[j];
      const b = dense[(j + 1) % dense.length];
      pos.push([a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w]);
    }
    // 4. Tangents, normals and curvature.
    const samples: TrackSample[] = [];
    for (let k = 0; k < count; k++) {
      const prev = pos[(k - 1 + count) % count];
      const next = pos[(k + 1) % count];
      let tx = next[0] - prev[0];
      let tz = next[1] - prev[1];
      const len = Math.hypot(tx, tz) || 1;
      tx /= len;
      tz /= len;
      // With y up and forward = (sin θ, cos θ), right = forward × up = (−cos θ, sin θ),
      // so the driver's left is (cos θ, −sin θ) = (tz, −tx). A positive yaw turns left.
      samples.push({ x: pos[k][0], z: pos[k][1], tx, tz, nx: tz, nz: -tx, s: k * this.spacing, curvature: 0 });
    }
    let minRadius = Infinity;
    for (let k = 0; k < count; k++) {
      const a = samples[(k - 1 + count) % count];
      const b = samples[(k + 1) % count];
      // dθ/ds using the cross product of neighbouring tangents.
      const cross = a.tx * b.tz - a.tz * b.tx;
      const dot = a.tx * b.tx + a.tz * b.tz;
      const dTheta = Math.atan2(cross, dot);
      // θ = atan2(tx, tz) grows when turning left, while the (x, z) cross product is
      // negative for that rotation, so flip the sign to make "positive = left".
      const curvature = -dTheta / (2 * this.spacing);
      samples[k].curvature = curvature;
      const r = Math.abs(curvature) > 1e-6 ? 1 / Math.abs(curvature) : Infinity;
      if (r < minRadius) minRadius = r;
    }
    this.samples = samples;
    this.minRadius = minRadius;
  }

  get count(): number {
    return this.samples.length;
  }

  sample(index: number): TrackSample {
    const n = this.samples.length;
    return this.samples[((index % n) + n) % n];
  }

  /** Heading (radians) of travel at a sample, matching Three.js rotation.y. */
  headingAt(index: number): number {
    const s = this.sample(index);
    return Math.atan2(s.tx, s.tz);
  }

  /**
   * Nearest point on the centre line. If `hint` is provided, only a window around
   * it is searched (fast, continuous); otherwise the full loop is scanned.
   */
  nearest(x: number, z: number, hint = -1, window = 40): NearestResult {
    const n = this.samples.length;
    let best: NearestResult | null = null;
    let bestD = Infinity;
    const from = hint >= 0 ? hint - window : 0;
    const to = hint >= 0 ? hint + window : n - 1;
    for (let k = from; k <= to; k++) {
      const i = ((k % n) + n) % n;
      const a = this.samples[i];
      const b = this.samples[(i + 1) % n];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const l2 = abx * abx + abz * abz || 1e-9;
      let t = ((x - a.x) * abx + (z - a.z) * abz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a.x + abx * t;
      const pz = a.z + abz * t;
      const d = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d < bestD) {
        bestD = d;
        const nx = a.nx + (b.nx - a.nx) * t;
        const nz = a.nz + (b.nz - a.nz) * t;
        best = {
          index: i,
          t,
          lateral: (x - px) * nx + (z - pz) * nz,
          along: a.s + this.spacing * t,
          px,
          pz,
        };
      }
    }
    // The window search can lose track after a teleport; fall back to a full scan.
    if (hint >= 0 && best && Math.sqrt(bestD) > 60) return this.nearest(x, z, -1);
    return best as NearestResult;
  }

  /** Shortest signed index difference b − a around the loop. */
  indexDelta(a: number, b: number): number {
    const n = this.samples.length;
    let d = (b - a) % n;
    if (d > n / 2) d -= n;
    if (d < -n / 2) d += n;
    return d;
  }
}
