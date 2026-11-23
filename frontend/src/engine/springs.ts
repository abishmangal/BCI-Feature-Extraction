// Custom spring solver (section 5.3). Structure-of-arrays: one Float32Array per property for
// position, velocity and target, indexed by piece number. Semi-implicit Euler, fixed 1/120 s substep.
// This is the only animation engine in the app.

export const P = {
  x: 0,
  y: 1,
  w: 2,
  h: 3,
  rotation: 4,
  scaleX: 5,
  scaleY: 6,
  alpha: 7,
  r: 8,
  g: 9,
  b: 10,
  cornerRadius: 11,
  reveal: 12,
  winStart: 13,
  winEnd: 14,
} as const;
export type PropName = keyof typeof P;
export const NPROP = 15;
export const PROP_NAMES = Object.keys(P) as PropName[];
/** Properties that use a critically damped spring and never overshoot (alpha, colour, reveal). */
const CRITICAL = new Uint8Array(NPROP);
CRITICAL[P.alpha] = CRITICAL[P.r] = CRITICAL[P.g] = CRITICAL[P.b] = CRITICAL[P.reveal] = 1;
const SIZE = new Uint8Array(NPROP);
SIZE[P.w] = SIZE[P.h] = SIZE[P.scaleX] = SIZE[P.scaleY] = 1;
const CLAMP01 = new Uint8Array(NPROP);
CLAMP01[P.alpha] = CLAMP01[P.reveal] = CLAMP01[P.winStart] = CLAMP01[P.winEnd] = 1;

export const SUBSTEP = 1 / 120;
export const SETTLE_V = 0.01;
export const SETTLE_D = 0.05;
export const SETTLE_STEPS = 10;

export type FlavorName = 'standard' | 'soft' | 'snappy' | 'fall' | 'reveal' | 'reduced';
/** Section 5.3a flavors (stiffness, damping). `reveal` is critically damped. `reduced` = section 5.6. */
export const FLAVORS: Record<FlavorName, { k: number; c: number }> = {
  standard: { k: 170, c: 22 },
  soft: { k: 110, c: 19 },
  snappy: { k: 260, c: 29 },
  fall: { k: 55, c: 7 },
  reveal: { k: 90, c: 2 * Math.sqrt(90) },
  reduced: { k: 400, c: 40 },
};

export class SpringSystem {
  readonly n: number;
  readonly pos: Float32Array[] = [];
  readonly vel: Float32Array[] = [];
  readonly tgt: Float32Array[] = [];
  /** Final (layout) pose applied when the delay ends (or when the via pose is left). */
  readonly fin: Float32Array[] = [];
  /** Via pose and the distance from the start pose to the via pose (for the 70 percent rule). */
  readonly via: Float32Array[] = [];
  readonly viaD0: Float32Array[] = [];
  readonly viaMask: Uint16Array;
  readonly stiff: Float32Array;
  readonly damp: Float32Array;
  /** Pending flavor applied at delay end. */
  readonly pendStiff: Float32Array;
  readonly pendDamp: Float32Array;
  /** Optional second flavor for size properties (w, h, scaleX, scaleY); 0 = same as the main flavor. */
  readonly scaleStiff: Float32Array;
  readonly scaleDamp: Float32Array;
  readonly pendScaleStiff: Float32Array;
  readonly pendScaleDamp: Float32Array;
  /** Engine-clock times in ms. */
  readonly delayUntil: Float64Array;
  readonly viaSince: Float64Array;
  readonly viaMaxMs: Float32Array;
  readonly viaMinHoldMs: Float32Array;
  /** 0 = idle, 1 = waiting for delay, 2 = in via pose. */
  readonly phase: Uint8Array;
  readonly pendingVia: Uint8Array;
  readonly settleCount: Uint8Array;
  readonly active: Uint8Array;
  /** Bitmask of properties the final pose sets (others keep their current target). */
  readonly finMask: Uint16Array;
  /**
   * In-page update of a piece that is still in a page transition (waiting on its delay or in its via
   * pose): only the final pose changes; delay, flavor and via pose are kept so the choreography plays out.
   */
  updateFinal(i: number, values: Float32Array, mask: number): boolean {
    if (this.phase[i] === 0) return false;
    for (let p = 0; p < NPROP; p++) if (mask & (1 << p)) this.fin[p][i] = values[p];
    this.finMask[i] = mask;
    return true;
  }

  /** Called when a piece's delay ends so the owner can apply non-animated extras. */
  onDelayEnd: ((i: number) => void) | null = null;
  activeCount = 0;

  constructor(n: number) {
    this.n = n;
    for (let p = 0; p < NPROP; p++) {
      this.pos.push(new Float32Array(n));
      this.vel.push(new Float32Array(n));
      this.tgt.push(new Float32Array(n));
      this.fin.push(new Float32Array(n));
      this.via.push(new Float32Array(n));
      this.viaD0.push(new Float32Array(n));
    }
    this.viaMask = new Uint16Array(n);
    this.finMask = new Uint16Array(n);
    this.stiff = new Float32Array(n).fill(FLAVORS.standard.k);
    this.damp = new Float32Array(n).fill(FLAVORS.standard.c);
    this.pendStiff = new Float32Array(n).fill(FLAVORS.standard.k);
    this.pendDamp = new Float32Array(n).fill(FLAVORS.standard.c);
    this.scaleStiff = new Float32Array(n);
    this.scaleDamp = new Float32Array(n);
    this.pendScaleStiff = new Float32Array(n);
    this.pendScaleDamp = new Float32Array(n);
    this.delayUntil = new Float64Array(n);
    this.viaSince = new Float64Array(n);
    this.viaMaxMs = new Float32Array(n).fill(260);
    this.viaMinHoldMs = new Float32Array(n);
    this.phase = new Uint8Array(n);
    this.pendingVia = new Uint8Array(n);
    this.settleCount = new Uint8Array(n);
    this.active = new Uint8Array(n);
  }

  /** Instantly place a piece (startup only, or teleporting an invisible piece). */
  setNow(i: number, p: number, v: number): void {
    this.pos[p][i] = v;
    this.vel[p][i] = 0;
    this.tgt[p][i] = v;
    this.fin[p][i] = v;
  }

  wake(i: number): void {
    if (!this.active[i]) {
      this.active[i] = 1;
      this.activeCount++;
    }
    this.settleCount[i] = 0;
  }

  /**
   * Schedule a new final pose for piece i. Only targets change: position and velocity are kept (5.3).
   * `mask` lists which properties `values` sets. If `delayMs` is 0 the target is applied at once.
   * A piece already waiting on a delay keeps waiting (its pending target is replaced, no reset).
   */
  retarget(
    i: number,
    values: Float32Array,
    mask: number,
    now: number,
    delayMs: number,
    flavor: { k: number; c: number },
    via?: { values: Float32Array; mask: number; maxMs: number; minHoldMs: number } | null,
    scaleFlavor?: { k: number; c: number } | null,
  ): void {
    this.pendScaleStiff[i] = scaleFlavor ? scaleFlavor.k : 0;
    this.pendScaleDamp[i] = scaleFlavor ? scaleFlavor.c : 0;
    for (let p = 0; p < NPROP; p++) if (mask & (1 << p)) this.fin[p][i] = values[p];
    this.finMask[i] = mask;
    this.pendStiff[i] = flavor.k;
    this.pendDamp[i] = flavor.c;
    if (via && via.mask) {
      for (let p = 0; p < NPROP; p++) if (via.mask & (1 << p)) this.via[p][i] = via.values[p];
      this.viaMask[i] = via.mask;
      this.viaMaxMs[i] = via.maxMs;
      this.viaMinHoldMs[i] = via.minHoldMs;
      this.pendingVia[i] = 1;
    } else {
      // Interruption rule: any pending or running via pose is dropped; head straight to the new final pose.
      this.pendingVia[i] = 0;
      this.viaMask[i] = 0;
    }
    const until = now + delayMs;
    if (this.phase[i] === 1) {
      // Still waiting: keep the existing delay (no reset of delays), unless the new one is earlier.
      if (until < this.delayUntil[i]) this.delayUntil[i] = until;
    } else {
      this.delayUntil[i] = until;
      this.phase[i] = 1;
    }
    if (this.delayUntil[i] <= now) this.endDelay(i, now);
    this.wake(i);
  }

  private endDelay(i: number, now: number): void {
    this.stiff[i] = this.pendStiff[i];
    this.damp[i] = this.pendDamp[i];
    this.scaleStiff[i] = this.pendScaleStiff[i];
    this.scaleDamp[i] = this.pendScaleDamp[i];
    if (this.pendingVia[i]) {
      const m = this.viaMask[i];
      for (let p = 0; p < NPROP; p++) {
        if (m & (1 << p)) {
          this.tgt[p][i] = this.via[p][i];
          this.viaD0[p][i] = Math.abs(this.via[p][i] - this.pos[p][i]);
        } else if (this.finMask[i] & (1 << p)) this.tgt[p][i] = this.fin[p][i];
      }
      this.pendingVia[i] = 0;
      this.phase[i] = 2;
      this.viaSince[i] = now;
    } else {
      this.applyFinal(i);
      this.phase[i] = 0;
    }
    if (this.onDelayEnd) this.onDelayEnd(i);
  }

  private applyFinal(i: number): void {
    const m = this.finMask[i];
    for (let p = 0; p < NPROP; p++) if (m & (1 << p)) this.tgt[p][i] = this.fin[p][i];
  }

  private checkVia(i: number, now: number): void {
    const elapsed = now - this.viaSince[i];
    if (elapsed < this.viaMinHoldMs[i]) return;
    let covered = true;
    const m = this.viaMask[i];
    for (let p = 0; p < NPROP && covered; p++) {
      if (!(m & (1 << p))) continue;
      const d0 = this.viaD0[p][i];
      if (d0 < 1e-6) continue;
      if (Math.abs(this.pos[p][i] - this.via[p][i]) > 0.3 * d0) covered = false;
    }
    if (covered || elapsed >= Math.max(this.viaMaxMs[i], this.viaMinHoldMs[i])) {
      this.applyFinal(i);
      this.viaMask[i] = 0;
      this.phase[i] = 0;
      this.settleCount[i] = 0;
    }
  }

  /** Advance one fixed substep. `now` is the engine clock in ms at the end of this substep. */
  step(now: number): void {
    const dt = SUBSTEP;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      if (!this.active[i]) continue;
      const ph = this.phase[i];
      if (ph === 1 && now >= this.delayUntil[i]) this.endDelay(i, now);
      else if (ph === 2) this.checkVia(i, now);
      const k0 = this.stiff[i];
      const c0 = this.damp[i];
      const cc = 2 * Math.sqrt(k0);
      const ks = this.scaleStiff[i];
      let calm = true;
      for (let p = 0; p < NPROP; p++) {
        const pa = this.pos[p];
        const va = this.vel[p];
        const t = this.tgt[p][i];
        let x = pa[i];
        let v = va[i];
        const d = x - t;
        if (v === 0 && d === 0) continue;
        let k = k0;
        let damping = CRITICAL[p] ? cc : c0;
        if (ks > 0 && SIZE[p]) {
          k = ks;
          damping = this.scaleDamp[i];
        }
        v += (-k * d - damping * v) * dt;
        x += v * dt;
        if (CLAMP01[p]) {
          if (x < 0) {
            x = 0;
            if (v < 0) v = 0;
          } else if (x > 1) {
            x = 1;
            if (v > 0) v = 0;
          }
        }
        pa[i] = x;
        va[i] = v;
        if (calm && (Math.abs(v) >= SETTLE_V || Math.abs(x - t) >= SETTLE_D)) calm = false;
      }
      if (calm && this.phase[i] === 0) {
        if (++this.settleCount[i] >= SETTLE_STEPS) {
          for (let p = 0; p < NPROP; p++) {
            this.pos[p][i] = this.tgt[p][i];
            this.vel[p][i] = 0;
          }
          this.active[i] = 0;
          this.activeCount--;
        }
      } else this.settleCount[i] = 0;
    }
  }
}
