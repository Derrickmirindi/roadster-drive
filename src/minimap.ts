/** 2D minimap drawn on a canvas from the real track samples and car position. */
import { TrackPath } from './track-path.js';

export class Minimap {
  private readonly ctx: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oz = 0;
  private size = 0;
  private path: Path2D | null = null;
  private lastDraw = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly track: TrackPath,
    private readonly startIndex: number,
    private readonly checkpoints: number[],
  ) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    const css = this.canvas.clientWidth || 160;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(css * dpr);
    this.canvas.height = Math.round(css * dpr);
    this.size = this.canvas.width;
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const s of this.track.samples) {
      minX = Math.min(minX, s.x);
      maxX = Math.max(maxX, s.x);
      minZ = Math.min(minZ, s.z);
      maxZ = Math.max(maxZ, s.z);
    }
    const pad = this.size * 0.1;
    this.scale = (this.size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    this.ox = (minX + maxX) / 2;
    this.oz = (minZ + maxZ) / 2;
    const p = new Path2D();
    this.track.samples.forEach((s, i) => {
      const [x, y] = this.project(s.x, s.z);
      if (i === 0) p.moveTo(x, y);
      else p.lineTo(x, y);
    });
    p.closePath();
    this.path = p;
    this.lastDraw = 0;
  }

  /**
   * Screen mapping matches the overhead camera's north-up view from above:
   * world +z is up on the map and world +x is to the left.
   */
  private project(x: number, z: number): [number, number] {
    return [this.size / 2 - (x - this.ox) * this.scale, this.size / 2 - (z - this.oz) * this.scale];
  }

  draw(x: number, z: number, heading: number, nextCheckpoint: number, now: number, force = false): void {
    if (!force && now - this.lastDraw < 1 / 20) return;
    this.lastDraw = now;
    const g = this.ctx;
    const S = this.size;
    const u = S / 160;
    g.clearRect(0, 0, S, S);
    if (!this.path) return;
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(242,239,232,0.22)';
    g.lineWidth = 9 * u;
    g.stroke(this.path);
    g.strokeStyle = 'rgba(242,239,232,0.85)';
    g.lineWidth = 2.2 * u;
    g.stroke(this.path);

    // Checkpoints: passed ones filled, upcoming ones hollow.
    this.checkpoints.forEach((rel, i) => {
      const s = this.track.sample(this.startIndex + rel);
      const [px, py] = this.project(s.x, s.z);
      g.beginPath();
      g.arc(px, py, 3 * u, 0, Math.PI * 2);
      if (i + 1 < nextCheckpoint) {
        g.fillStyle = 'rgba(242,239,232,0.9)';
        g.fill();
      } else {
        g.strokeStyle = 'rgba(242,239,232,0.6)';
        g.lineWidth = 1.2 * u;
        g.stroke();
      }
    });

    // Start / finish bar.
    const st = this.track.sample(this.startIndex);
    const [sx, sy] = this.project(st.x, st.z);
    const [nx, ny] = [-st.nx, -st.nz]; // map x is mirrored
    g.strokeStyle = '#f2efe8';
    g.lineWidth = 2.5 * u;
    g.beginPath();
    g.moveTo(sx - nx * 7 * u, sy - ny * 7 * u);
    g.lineTo(sx + nx * 7 * u, sy + ny * 7 * u);
    g.stroke();

    // Car: a red arrow pointing along the heading.
    const [cx, cy] = this.project(x, z);
    const dx = -Math.sin(heading);
    const dy = -Math.cos(heading);
    g.save();
    g.translate(cx, cy);
    g.rotate(Math.atan2(dy, dx) + Math.PI / 2);
    g.beginPath();
    g.moveTo(0, -7 * u);
    g.lineTo(5 * u, 5 * u);
    g.lineTo(0, 2.5 * u);
    g.lineTo(-5 * u, 5 * u);
    g.closePath();
    g.fillStyle = '#e8322a';
    g.strokeStyle = '#111';
    g.lineWidth = 1.2 * u;
    g.fill();
    g.stroke();
    g.restore();
  }
}
