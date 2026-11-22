/**
 * One Euro filter (Casiez et al.): smooths jitter when still, stays responsive when moving.
 */
class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  constructor(
    private minCutoff = 1.2,
    private beta = 0.02,
    private dCutoff = 1.0,
  ) {}

  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, tMs: number): number {
    if (this.x === null) {
      this.x = value;
      this.t = tMs;
      return value;
    }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const dxRaw = (value - this.x) / dt;
    this.dx += (dxRaw - this.dx) * this.alpha(this.dCutoff, dt);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += (value - this.x) * this.alpha(cutoff, dt);
    return this.x;
  }
}

/** Smooths 2D screen points by key. */
export class PointSmoother {
  private filters = new Map<string, [OneEuro, OneEuro]>();

  smooth(key: string, x: number, y: number, tMs: number): [number, number] {
    let f = this.filters.get(key);
    if (!f) {
      f = [new OneEuro(), new OneEuro()];
      this.filters.set(key, f);
    }
    return [f[0].filter(x, tMs), f[1].filter(y, tMs)];
  }

  reset() {
    this.filters.clear();
  }
}
