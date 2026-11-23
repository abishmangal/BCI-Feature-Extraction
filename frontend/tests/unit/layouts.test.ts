import { describe, it, expect } from 'vitest';
import mi from '../../public/fallback/motor_imagery.json';
import p3 from '../../public/fallback/erp_p300.json';
import ss from '../../public/fallback/ssvep.json';
import { layoutFor, helpersFor, tablesFor } from '../../src/layouts';
import { p4Geo } from '../../src/layouts/page4';
import { REG, ticks, tickStep, windowSnap, minWindow, type LayoutCtx } from '../../src/layouts/common';
import { decodeDataset, defaultSettings, emptyPreset, selectChannelGroup, type Data, type Results } from '../../src/store/store';
import { decodeF32, encodeF32 } from '../../src/api/f32';
import { classOrderRank, stratifiedSubset } from '../../src/engine/slots';
import type { DatasetResponse } from '../../src/api/types';
import { EngineCore } from '../../src/engine/core';
import { P } from '../../src/engine/springs';

const BUNDLES: Record<string, unknown> = { motor_imagery: mi, erp_p300: p3, ssvep: ss };

it('adds electrode groups cumulatively and removes the group clicked again', () => {
  const order = ['C3', 'Cz', 'C4', 'P1', 'Pz', 'P2'];
  const central = ['C3', 'Cz', 'C4'];
  const parietal = ['P2', 'Pz', 'P1'];
  const withCentral = selectChannelGroup(order, ['Cz'], central);
  expect(withCentral).toEqual(central);
  const both = selectChannelGroup(order, withCentral, parietal);
  expect(both).toEqual(order);
  expect(selectChannelGroup(order, both, central)).toEqual(['P1', 'Pz', 'P2']);
  expect(selectChannelGroup(order, both, central, 'add')).toEqual(order);
});

function bundle(pid: string): Record<string, unknown> {
  return structuredClone(BUNDLES[pid]) as Record<string, unknown>;
}

function results(b: Record<string, unknown>): Results {
  const w = b.window as Results['window'] & object;
  const ch = b.channels as never as Results['channels'] & object;
  const bd = b.band as never as Results['band'] & object;
  const tr = b.transform as never as Results['transform'] & object;
  const ev = b.evaluate as never as Results['evaluate'] & object;
  const r: Results = {
    window: {
      ...w,
      px: decodeF32((w as never as { probe: { x: never } }).probe.x),
      py: decodeF32((w as never as { probe: { y: never } }).probe.y),
      envD: decodeF32((w as never as { env: never }).env),
    },
    channels: {
      ...ch,
      spark: decodeF32((ch as never as { sparklines: never }).sparklines),
      grid: (ch as never as { map: { grid?: never } }).map.grid
        ? decodeF32((ch as never as { map: { grid: never } }).map.grid)
        : null,
    },
    band: {
      ...bd,
      binsD: decodeF32((bd as never as { bins: never }).bins),
      psdD: (bd as never as { curves: { psd: never }[] }).curves.map((c) => decodeF32(c.psd)),
      baseD: (bd as never as { baseline: never | null }).baseline
        ? decodeF32((bd as never as { baseline: never }).baseline)
        : null,
      raw: decodeF32((bd as never as { example: { raw: never } }).example.raw),
      filt: decodeF32((bd as never as { example: { filtered: never } }).example.filtered),
    },
    features: b.features as never,
    transform: {
      ...tr,
      beforeD: decodeF32((tr as never as { before: { values: never } }).before.values),
      afterD: decodeF32((tr as never as { after: { values: never } }).after.values),
    },
    evaluate: {
      ...ev,
      Z: decodeF32((ev as never as { matrix: never }).matrix),
      F: decodeF32((ev as never as { preMatrix: never }).preMatrix),
      scatterD: decodeF32((ev as never as { scatter: { values: never } }).scatter.values),
      pca2D: decodeF32((ev as never as { pca2: never }).pca2),
      tsneD: null,
      stripD: decodeF32((ev as never as { rowStrip: never }).rowStrip),
      corrD: decodeF32((ev as never as { correlation: { matrix: never } }).correlation.matrix),
    },
  };
  return r;
}

function ctxFor(data: Data | null, res: Results, page: number, over: Partial<LayoutCtx> = {}): LayoutCtx {
  const settings = defaultSettings(data);
  const shown = data ? data.display.trials : [];
  const nF = page >= 7 ? (res.evaluate?.shape[1] ?? 0) : (res.features?.shape?.[1] ?? 0);
  const tv = data && nF ? Math.min(data.labels.length, Math.floor(4000 / nF)) : 0;
  const vt = data && tv ? stratifiedSubset(data.labels, tv, data.classNames.length) : [];
  return {
    data,
    paradigm: data?.preset ?? emptyPreset(),
    settings,
    ui: {
      scrollY: 0,
      categoryFilter: 'All',
      search: '',
      columnOffset: 0,
      exportPhase: 'chips-left',
      reduceMotion: false,
      ambientPaused: true,
      focusChannel: null,
      hoverTrial: null,
      hoverRow: null,
      draggingWindow: false,
      panelOpen: true,
      loadAnim: 'none',
      leakFlipped: false,
      matrixScroll: 0,
      focusFamily: null,
      expandFamily: null,
      panelHold: false,
      computingSpin: false,
      spinPhase: 0,
      basketSize: { w: 290, h: 400 },
    },
    stageSize: { width: 1120, height: 856, stageHeight: 800 },
    backendResults: res,
    slots: {
      shown,
      shownClassRank: data ? classOrderRank(shown, data.labels) : [],
      nCh: data?.channels.length ?? 0,
      val: {
        trials: vt,
        classRank: data ? classOrderRank(vt, data.labels) : [],
        nFeatures: vt.length ? nF : 0,
        matrix: page >= 7 ? 'Z' : 'F',
      },
    },
    page,
    ...over,
  };
}

function checkAll(c: LayoutCtx): void {
  for (let page = 1; page <= 8; page++) {
    const m = layoutFor(page, { ...c, page });
    for (const id of REG.ids) {
      const t = m.get(id);
      expect(t, `page ${page} missing ${id}`).toBeDefined();
      expect(Number.isFinite(t!.x) && Number.isFinite(t!.y), `page ${page} ${id} non-finite`).toBe(true);
    }
    expect(m.size).toBe(REG.n);
  }
}

describe('layouts return a target for every piece and decor id', () => {
  it('empty app', () => checkAll(ctxFor(null, {}, 1)));
  for (const pid of ['motor_imagery', 'erp_p300', 'ssvep']) {
    it(`preset ${pid}`, () => {
      const b = bundle(pid);
      const data = decodeDataset(b.dataset as DatasetResponse, 1);
      checkAll(ctxFor(data, results(b), 1));
      checkAll(ctxFor(data, {}, 1)); // before any backend result arrived
    });
  }
  it('custom dataset with unpositioned channels (tray)', () => {
    const b = bundle('erp_p300');
    const r = structuredClone(b.dataset) as DatasetResponse;
    r.channels = ['Fz', 'weird1', 'Pz', 'Oz', 'P3', 'P4', 'foo', 'PO8'];
    r.positions = r.positions.map((p, i) => (i === 1 || i === 6 ? null : p));
    r.paradigm = 'custom';
    r.preset = { ...emptyPreset(), defaultWindow: { start: -0.2, end: 0.8 } };
    r.electrodePresets = [];
    const data = decodeDataset(r, 1);
    const c = ctxFor(data, results(b), 1);
    checkAll(c);
    // exactly N electrodes: on-head + tray = N, none extra
    const m = layoutFor(3, { ...c, page: 3 });
    let shown = 0;
    for (let i = 0; i < 128; i++) if ((m.get(`electrode:${i}`)!.scaleX ?? 0) > 0) shown++;
    expect(shown).toBe(8);
    expect(m.get('electrode:1')!.extra!.chip).toBe(true);
  });
});

it('aligns the frequency controls with their plots and leaves a gap between the rows', () => {
  const { y0, y1, wave, controlRects } = p4Geo(ctxFor(null, {}, 4));
  expect(controlRects.spectrum.y).toBe(y0);
  expect(controlRects.spectrum.height).toBe(y1 - y0);
  expect(controlRects.example.y).toBe(wave.y0);
  expect(controlRects.example.height).toBeCloseTo(wave.y1 - wave.y0);
  expect(controlRects.example.height).toBeCloseTo(141.792);
  expect(wave.y0).toBeGreaterThan(y1);
});

describe('time axis rules (section 3.1)', () => {
  it('tick step and ticks', () => {
    expect(tickStep(-0.5, 2.496)).toBe(0.5);
    expect(tickStep(-0.2, 0.796)).toBe(0.1); // -0.2 .. 0.7 = 10 ticks
    expect(tickStep(0, 1)).toBe(0.2); // 0.1 would give 11 ticks
    expect(tickStep(0, 19.9)).toBe(2);
    expect(ticks(-0.5, 2.496)).toEqual([-0.5, 0, 0.5, 1, 1.5, 2]);
    expect(ticks(0, 1).length).toBeLessThanOrEqual(10);
  });
  it('snap and minimum width', () => {
    expect(windowSnap(1.0)).toBe(0.05);
    expect(windowSnap(1.5)).toBe(0.05);
    expect(windowSnap(3)).toBe(0.1);
    expect(minWindow(3)).toBe(0.5);
    expect(minWindow(2.5)).toBe(0.5);
    expect(minWindow(1)).toBe(0.2);
  });
});

describe('decodeF32', () => {
  it('round trips', () => {
    const a = Float32Array.from([1.5, -2.25, 3e-8, 1e6, 0]);
    expect(Array.from(decodeF32(encodeF32(a)))).toEqual(Array.from(a));
  });
});

describe('route independence with the real layouts', () => {
  it('settles at the page 4 layout within 0.5 px for direct, step-by-step and interrupted routes', () => {
    const b = bundle('motor_imagery');
    const data = decodeDataset(b.dataset as DatasetResponse, 1);
    const res = results(b);
    const run = (route: number[], dtBetween: number): EngineCore => {
      const core = new EngineCore();
      const c1 = ctxFor(data, res, 1);
      core.apply(layoutFor(1, c1), {
        from: 1,
        to: 1,
        reduced: false,
        helpers: helpersFor(c1),
        tables: tablesFor(c1),
        initial: true,
      });
      let from = 1;
      for (const to of route) {
        const c = ctxFor(data, res, to);
        core.apply(layoutFor(to, c), {
          from,
          to,
          reduced: false,
          helpers: helpersFor(c),
          tables: tablesFor(c),
        });
        core.tick(dtBetween);
        from = to;
      }
      for (let k = 0; k < 4000 && !core.allSettled(); k++) core.tick(16);
      return core;
    };
    const target = layoutFor(4, ctxFor(data, res, 4));
    for (const core of [run([4], 0), run([2, 3, 4], 2000), run([2, 3, 2, 4], 150)]) {
      expect(core.allSettled()).toBe(true);
      core.reg.ids.forEach((id, i) => {
        const t = target.get(id)!;
        if ((t.alpha ?? 1) < 0.01 || t.scaleX === 0 || t.scaleY === 0) return; // invisible parked pieces
        expect(Math.abs(core.get(i, P.x) - t.x), id).toBeLessThan(0.5);
        expect(Math.abs(core.get(i, P.y) - t.y), id).toBeLessThan(0.5);
      });
    }
  });
});
