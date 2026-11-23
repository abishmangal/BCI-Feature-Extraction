import { describe, it, expect } from 'vitest';
import { SpringSystem, P, NPROP, FLAVORS } from '../../src/engine/springs';
import { EngineCore } from '../../src/engine/core';
import { Registry, POOL, DECOR_IDS } from '../../src/engine/registry';
import { rankDelay, PLANS, NON_ADJACENT_PLAN } from '../../src/engine/stagger';
import { buildSlots, stratifiedSubset } from '../../src/engine/slots';
import type { Layout, TargetState } from '../../src/engine/types';
import type { TransitionHelpers } from '../../src/engine/transitions';

const vals = (o: Partial<Record<number, number>>): { v: Float32Array; m: number } => {
  const v = new Float32Array(NPROP);
  let m = 0;
  for (const [k, x] of Object.entries(o)) {
    v[Number(k)] = x!;
    m |= 1 << Number(k);
  }
  return { v, m };
};
const run = (s: SpringSystem, t0: number, ms: number): number => {
  let now = t0;
  const steps = Math.round(ms / (1000 / 120));
  for (let k = 0; k < steps; k++) {
    now += 1000 / 120;
    s.step(now);
  }
  return now;
};

describe('springs', () => {
  it('marks the probe chart visible at the start of its reveal', () => {
    const core = new EngineCore();
    const s = core.springs;
    const i = core.reg.index.get('decor:2:minimap')!;
    const target = vals({ [P.alpha]: 1, [P.scaleX]: 1, [P.scaleY]: 1 });
    s.retarget(i, target.v, target.m, 0, 800, FLAVORS.reveal);
    const now = run(s, 0, 790);
    expect(core.isVisible(i)).toBe(false);
    run(s, now, 60);
    expect(core.isVisible(i)).toBe(true);
    expect(core.allSettled()).toBe(false);
  });

  it('retargets mid-flight without resetting velocity or position', () => {
    const s = new SpringSystem(1);
    const a = vals({ [P.x]: 100 });
    s.retarget(0, a.v, a.m, 0, 0, FLAVORS.standard);
    let now = run(s, 0, 100);
    const x = s.pos[P.x][0];
    const v = s.vel[P.x][0];
    expect(v).toBeGreaterThan(0);
    const b = vals({ [P.x]: -50 });
    s.retarget(0, b.v, b.m, now, 0, FLAVORS.standard);
    expect(s.pos[P.x][0]).toBe(x);
    expect(s.vel[P.x][0]).toBe(v);
    expect(s.tgt[P.x][0]).toBe(-50);
    now = run(s, now, 4000);
    expect(Math.abs(s.pos[P.x][0] + 50)).toBeLessThan(0.05);
    expect(s.active[0]).toBe(0);
  });

  it('standard spring overshoots about 1 percent; alpha never overshoots', () => {
    const s = new SpringSystem(1);
    const a = vals({ [P.x]: 100, [P.alpha]: 1 });
    s.retarget(0, a.v, a.m, 0, 0, FLAVORS.standard);
    let maxX = 0;
    let maxA = 0;
    let now = 0;
    for (let k = 0; k < 400; k++) {
      now += 1000 / 120;
      s.step(now);
      maxX = Math.max(maxX, s.pos[P.x][0]);
      maxA = Math.max(maxA, s.pos[P.alpha][0]);
    }
    expect(maxX).toBeGreaterThan(100);
    expect(maxX).toBeLessThan(103);
    expect(maxA).toBeLessThanOrEqual(1);
  });

  it('keeps pending delays on retarget (no reset)', () => {
    const s = new SpringSystem(1);
    const a = vals({ [P.x]: 10 });
    s.retarget(0, a.v, a.m, 0, 300, FLAVORS.standard);
    const now = run(s, 0, 100);
    const b = vals({ [P.x]: 20 });
    s.retarget(0, b.v, b.m, now, 300, FLAVORS.standard);
    expect(s.delayUntil[0]).toBe(300);
    run(s, now, 150);
    expect(s.tgt[P.x][0]).toBe(0);
    run(s, now + 150, 100);
    expect(s.tgt[P.x][0]).toBe(20);
  });

  it('via pose switches at 70 percent of the distance', () => {
    const s = new SpringSystem(1);
    const f = vals({ [P.x]: 0, [P.y]: 100 });
    const v = vals({ [P.y]: -50 });
    s.retarget(0, f.v, f.m, 0, 0, FLAVORS.snappy, { values: v.v, mask: v.m, maxMs: 10000, minHoldMs: 0 });
    expect(s.tgt[P.y][0]).toBe(-50);
    let now = 0;
    let switchedAt = NaN;
    for (let k = 0; k < 200 && Number.isNaN(switchedAt); k++) {
      now += 1000 / 120;
      s.step(now);
      if (s.tgt[P.y][0] === 100) switchedAt = s.pos[P.y][0];
    }
    expect(switchedAt).toBeGreaterThan(-50);
    expect(switchedAt).toBeLessThanOrEqual(-0.7 * 50 + 2.5); // one substep after the switch
    expect(s.phase[0]).toBe(0);
  });

  it('via pose switches after viaMaxMs when the distance is not covered', () => {
    const s = new SpringSystem(1);
    const f = vals({ [P.y]: 0 });
    const v = vals({ [P.y]: -10000 });
    s.retarget(0, f.v, f.m, 0, 0, FLAVORS.soft, { values: v.v, mask: v.m, maxMs: 100, minHoldMs: 0 });
    run(s, 0, 75);
    // At 75 ms the soft spring has covered well under 70 percent of the way.
    expect(Math.abs(s.pos[P.y][0])).toBeLessThan(0.7 * 10000);
    expect(s.tgt[P.y][0]).toBe(-10000);
    run(s, 75, 34);
    expect(s.tgt[P.y][0]).toBe(0);
  });

  it('via pose is dropped on interruption and velocity is kept', () => {
    const s = new SpringSystem(1);
    const f = vals({ [P.y]: 100 });
    const v = vals({ [P.y]: -100 });
    s.retarget(0, f.v, f.m, 0, 0, FLAVORS.standard, { values: v.v, mask: v.m, maxMs: 10000, minHoldMs: 0 });
    const now = run(s, 0, 50);
    const vel = s.vel[P.y][0];
    const g = vals({ [P.y]: 40 });
    s.retarget(0, g.v, g.m, now, 0, FLAVORS.standard, null);
    expect(s.tgt[P.y][0]).toBe(40);
    expect(s.viaMask[0]).toBe(0);
    expect(s.vel[P.y][0]).toBe(vel);
  });
});

describe('registry and pools', () => {
  it('allocates the fixed pools once', () => {
    const r = new Registry();
    expect(r.range('ribbon')[1] - r.range('ribbon')[0]).toBe(POOL.ribbon);
    expect(r.range('val')[1] - r.range('val')[0]).toBe(POOL.val);
    expect(r.range('card')[1] - r.range('card')[0]).toBe(12);
    expect(new Set(r.ids).size).toBe(r.n);
    for (const d of DECOR_IDS) expect(r.index.has(d)).toBe(true);
    expect(r.n).toBeGreaterThan(11000);
  });
  it('pool mapping tables are deterministic and stratified', () => {
    const labels = Array.from({ length: 300 }, (_, i) => (i * 7) % 3);
    const a = buildSlots(labels, 3, 22, 40);
    const b = buildSlots(labels, 3, 22, 40);
    expect(a).toEqual(b);
    expect(a.shownTrials.length).toBe(Math.min(300, Math.floor(2400 / 22), 200));
    const counts = [0, 0, 0];
    a.shownTrials.forEach((t) => counts[labels[t]]++);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(a.valTrials.length).toBe(Math.min(300, Math.floor(4000 / 40)));
    expect([...a.shownTrials].sort((x, y) => x - y)).toEqual(a.shownTrials);
    expect(stratifiedSubset(labels, 400, 3).length).toBe(300);
  });
});

describe('stagger', () => {
  const r = new Registry();
  const i0 = r.range('ribbon')[0];
  it('matches section 5.4 plans', () => {
    r.gTrialRank[i0] = 10;
    r.gClassRank[i0] = 10;
    expect(rankDelay(PLANS['1->2'], r, i0, {})).toBe(50); // class-sorted row order, 5 ms per row
    r.gChannel[i0] = 3;
    expect(rankDelay(PLANS['3->4'], r, i0, {})).toBe(36);
    expect(rankDelay(PLANS['2->3'], r, i0, { channelRank: [5, 4, 3, 7] })).toBe(7 * 30);
    r.gTrialRank[i0] = 300;
    expect(rankDelay(PLANS['7->8'], r, i0, {})).toBe(500);
    const card = r.index.get('card:autoencoder')!;
    expect(rankDelay(PLANS['4->5'], r, card, { cardRank: new Map([[card, 12]]) })).toBe(700);
    const v = r.range('val')[0];
    r.gFeature[v] = 2;
    r.gTrialRank[v] = 5;
    expect(rankDelay(PLANS['5->6'], r, v, {})).toBe(2 * 40 + 5 * 3);
    r.gClassRank[v] = 7;
    expect(rankDelay(NON_ADJACENT_PLAN, r, v, {})).toBe(28);
  });
});

// Two dummy layouts for the headless core.
function dummyLayout(core: EngineCore, page: number): Layout {
  const m: Layout = new Map();
  core.reg.ids.forEach((id, i) => {
    const t: TargetState =
      page === 1
        ? {
            x: (i % 100) * 3,
            y: Math.floor(i / 100),
            w: 2,
            h: 2,
            scaleX: 1,
            scaleY: 1,
            alpha: 1,
            color: 0x112233,
          }
        : {
            x: 500 - (i % 50) * 4,
            y: 300 + Math.floor(i / 50),
            w: 4,
            h: 4,
            scaleX: 1,
            scaleY: 1,
            alpha: 0.5,
            color: 0x445566,
          };
    m.set(id, t);
  });
  return m;
}
const helpers: TransitionHelpers = {
  stageW: 1000,
  stageH: 700,
  shownCount: 100,
  sineInBand: () => true,
  sineBandRank: () => 0,
  prism: { x: 500, y: 350, exitX: 520 },
  bandCentre: { x: 500, y: 300 },
  basket: { x: 800, y: 100, w: 300, h: 400 },
  matrixCentre: { x: 400, y: 300 },
  rowCentreX: 400,
  channelIncluded: () => true,
  includedOrdinal: () => 0,
  includedCount: 1,
  valColumn: () => 0,
  valInspected: () => false,
  cardSelected: () => false,
  chipIndex: () => 0,
  jitter: () => 0,
};

describe('engine core with dummy layouts', () => {
  it('settles at the final layout for any route, within 0.5 px', () => {
    const settle = (route: number[], interruptMs: number): EngineCore => {
      const core = new EngineCore();
      core.apply(dummyLayout(core, 1), {
        from: 1,
        to: 1,
        reduced: false,
        helpers,
        tables: {},
        initial: true,
      });
      let from = 1;
      for (const to of route) {
        core.apply(dummyLayout(core, to === 2 ? 2 : 1), { from, to, reduced: false, helpers, tables: {} });
        core.tick(interruptMs);
        from = to;
      }
      for (let k = 0; k < 2000 && !core.allSettled(); k++) core.tick(16);
      return core;
    };
    const direct = settle([2], 0);
    const interrupted = settle([2, 1, 2], 120);
    const target = dummyLayout(direct, 2);
    expect(direct.allSettled()).toBe(true);
    for (const core of [direct, interrupted]) {
      core.reg.ids.forEach((id, i) => {
        const t = target.get(id)!;
        expect(Math.abs(core.get(i, P.x) - t.x)).toBeLessThan(0.5);
        expect(Math.abs(core.get(i, P.y) - t.y)).toBeLessThan(0.5);
      });
    }
  });

  it('reduced motion removes stagger, via and camera', () => {
    const core = new EngineCore();
    core.apply(dummyLayout(core, 1), { from: 1, to: 1, reduced: false, helpers, tables: {}, initial: true });
    for (let i = 0; i < core.reg.n; i++) core.reg.gTrialRank[i] = i % 100;
    const longest = core.apply(dummyLayout(core, 2), { from: 1, to: 2, reduced: true, helpers, tables: {} });
    expect(longest).toBe(0);
    expect(core.camera.tScale).toBe(1);
    let vias = 0;
    for (let i = 0; i < core.reg.n; i++) vias += core.springs.viaMask[i] ? 1 : 0;
    expect(vias).toBe(0);
  });

  it('forward 1 -> 2 uses the trial stagger and the fan via pose for ribbons', () => {
    const core = new EngineCore();
    core.apply(dummyLayout(core, 1), { from: 1, to: 1, reduced: false, helpers, tables: {}, initial: true });
    const [a] = core.reg.range('ribbon');
    core.reg.gTrialRank[a + 5] = 5;
    core.reg.gClassRank[a + 5] = 8;
    core.apply(dummyLayout(core, 2), { from: 1, to: 2, reduced: false, helpers, tables: {} });
    expect(core.springs.delayUntil[a + 5] - core.now).toBe(40);
    expect(core.springs.pendingVia[a + 5]).toBe(1);
    expect(core.camera.tScale).toBe(1.06);
  });
});
