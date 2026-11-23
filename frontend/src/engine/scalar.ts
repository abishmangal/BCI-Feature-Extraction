// A single scalar spring for in-widget animations (gauge needle, odometer, race bars, card previews).
// Same solver as springs.ts (semi-implicit Euler, 1/120 s substeps); there are no fixed-duration tweens.
import { FLAVORS, SUBSTEP, type FlavorName } from './springs';

export class Scalar {
  x: number;
  v = 0;
  t: number;
  private k: number;
  private c: number;
  private acc = 0;
  delayMs = 0;
  constructor(x = 0, flavor: FlavorName = 'standard') {
    this.x = x;
    this.t = x;
    this.k = FLAVORS[flavor].k;
    this.c = FLAVORS[flavor].c;
  }
  set flavor(f: FlavorName) {
    this.k = FLAVORS[f].k;
    this.c = FLAVORS[f].c;
  }
  /** Advance by dtMs; returns true while still moving. */
  step(dtMs: number): boolean {
    if (this.delayMs > 0) {
      this.delayMs -= dtMs;
      return true;
    }
    this.acc += Math.min(dtMs, 100) / 1000;
    while (this.acc >= SUBSTEP) {
      this.acc -= SUBSTEP;
      this.v += (-this.k * (this.x - this.t) - this.c * this.v) * SUBSTEP;
      this.x += this.v * SUBSTEP;
    }
    if (Math.abs(this.v) < 1e-4 && Math.abs(this.x - this.t) < 1e-4) {
      this.x = this.t;
      this.v = 0;
      return false;
    }
    return true;
  }
  snap(v: number): void {
    this.x = this.t = v;
    this.v = 0;
  }
}
