import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Hooks = {
  settled(): boolean;
  displayObjects(): number;
  pieceSignature(): { count: number; attached: number; ids: number };
  pieces(): number;
  commits(): number;
  targetDiff(): number;
  store: { getState(): Record<string, unknown> };
  engine: {
    core: {
      lastMaxDelay: number;
      camera: { tScale: number };
      springs: { viaMask: Uint16Array; pendingVia: Uint8Array };
    };
  };
};

async function boot(page: Page, errors: string[] = []): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/#/1');
  await page.waitForFunction(() => !!(window as unknown as { __eeg?: Hooks }).__eeg?.displayObjects());
  await page.getByRole('button', { name: 'Pause ambient motion' }).click(); // settle deterministically
}

async function pour(page: Page, sample = 'Motor imagery'): Promise<void> {
  if (sample !== 'Motor imagery') {
    await page.getByRole('combobox', { name: 'Sample' }).click();
    await page.getByRole('option', { name: sample }).click();
  }
  await page.getByTestId('pour').click();
  await expect(page.getByTestId('shape-badge')).not.toHaveText('no data');
}

async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(150); // let a just-scheduled re-layout start before checking for rest
  await page.waitForFunction(() => (window as unknown as { __eeg: Hooks }).__eeg.settled(), undefined, {
    timeout: 30_000,
  });
}

const go = async (page: Page, n: number): Promise<void> => {
  await page.getByTestId(`rail-${n}`).click();
};

function makeCsv(channels: string[], trials = 8, samples = 40): Buffer {
  const rows = ['trial,label,channel,' + Array.from({ length: samples }, (_, i) => `s${i}`).join(',')];
  for (let t = 0; t < trials; t++)
    for (const ch of channels)
      rows.push(
        `${t},${t % 2 ? 'b' : 'a'},${ch},` +
          Array.from({ length: samples }, (_, i) => Math.sin(i * 0.3 + t + ch.length).toFixed(3)).join(','),
      );
  return Buffer.from(rows.join('\n') + '\n');
}
const TEN_TEN =
  'Fp1 Fpz Fp2 AF7 AF3 AFz AF4 AF8 F7 F5 F3 F1 Fz F2 F4 F6 F8 FT7 FC5 FC3 FC1 FCz FC2 FC4 FC6 FT8 T7 C5 C3 C1 Cz C2 C4 C6 T8 TP7 CP5 CP3 CP1 CPz CP2 CP4 CP6 TP8 P7 P5 P3 P1 Pz P2 P4 P6 P8 PO7 PO3 POz PO4 PO8 O1 Oz O2 Iz T9 T10'.split(
    ' ',
  );

test('jumping mid-transition: no piece created or destroyed, no console errors, end state equals the layout', async ({
  page,
}) => {
  const errors: string[] = [];
  await boot(page, errors);
  await pour(page);
  await settle(page);
  const before = await page.evaluate(() => (window as unknown as { __eeg: Hooks }).__eeg.pieceSignature());
  for (const n of [2, 5, 3, 8, 1, 6, 4, 7, 2]) {
    await go(page, n);
    await page.waitForTimeout(120); // interrupt mid-transition
  }
  await settle(page);
  const after = await page.evaluate(() => (window as unknown as { __eeg: Hooks }).__eeg.pieceSignature());
  expect(after).toEqual(before);
  expect(after.attached).toBe(after.count);
  expect(await page.evaluate(() => (window as unknown as { __eeg: Hooks }).__eeg.targetDiff())).toBeLessThan(
    0.5,
  );
  expect(errors.filter((e) => !/GL Driver|WebGL/.test(e))).toEqual([]);
});

test('every route settles on the target layout within 0.5 px', async ({ page }) => {
  await boot(page);
  await pour(page);
  await settle(page);
  // direct
  await go(page, 4);
  await settle(page);
  expect(await page.evaluate(() => (window as unknown as { __eeg: Hooks }).__eeg.targetDiff())).toBeLessThan(
    0.5,
  );
  // step by step
  for (const n of [3, 2, 3, 4]) {
    await go(page, n);
    await settle(page);
  }
  expect(await page.evaluate(() => (window as unknown as { __eeg: Hooks }).__eeg.targetDiff())).toBeLessThan(
    0.5,
  );
  // interrupted
  await go(page, 2);
  await page.waitForTimeout(100);
  await go(page, 4);
  await settle(page);
  expect(await page.evaluate(() => (window as unknown as { __eeg: Hooks }).__eeg.targetDiff())).toBeLessThan(
    0.5,
  );
});

test('loading a second dataset (a different preset) reuses the pools', async ({ page }) => {
  await boot(page);
  await pour(page);
  await settle(page);
  const a = await page.evaluate(() => (window as unknown as { __eeg: Hooks }).__eeg.pieceSignature());
  await pour(page, 'SSVEP');
  await expect(page.getByTestId('shape-badge')).toHaveText('160 x 8 x 500');
  await settle(page);
  const b = await page.evaluate(() => (window as unknown as { __eeg: Hooks }).__eeg.pieceSignature());
  expect(b).toEqual(a);
});

test('toggling an electrode by keyboard changes the shape badge; presets change selection, counter and badge', async ({
  page,
}) => {
  await boot(page);
  await pour(page);
  await go(page, 3);
  await expect(page.getByTestId('shape-badge')).toHaveText('100 x 3 x 500');
  await settle(page);
  await page.getByTestId('electrode-C1').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('shape-badge')).toHaveText('100 x 4 x 500');
  await expect(page.getByTestId('counter')).toHaveText('4 of 22 channels selected');
  await page.getByTestId('electrode-C1').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('shape-badge')).toHaveText('100 x 3 x 500');
  await settle(page);
  await page.getByTestId('preset-all').click();
  await expect(page.getByTestId('counter')).toHaveText('22 of 22 channels selected');
  await expect(page.getByTestId('shape-badge')).toHaveText('100 x 22 x 500');
  await expect(page.getByTestId('preset-all')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('preset-clear').click();
  await expect(page.getByTestId('counter')).toHaveText('0 of 22 channels selected');
  await page.getByTestId('preset-region:central').click();
  await expect(page.getByTestId('counter')).toHaveText('17 of 22 channels selected');
  await page.getByTestId('preset-region:parietal').click();
  await expect(page.getByTestId('counter')).toHaveText('21 of 22 channels selected');
  await expect(page.getByTestId('preset-region:central')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('preset-region:parietal')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('preset-region:central').click();
  await expect(page.getByTestId('counter')).toHaveText('4 of 22 channels selected');
  await page.getByTestId('preset-clear').click();
  await page.getByTestId('preset-paradigm0').click();
  await expect(page.getByTestId('counter')).toHaveText('3 of 22 channels selected');
});

for (const n of [32, 64]) {
  test(`a ${n}-channel dataset renders exactly ${n} electrodes`, async ({ page }) => {
    await boot(page);
    const chans = [...TEN_TEN.slice(0, n - 2), 'EXT1', 'EXT2']; // two unpositioned -> tray
    await page
      .getByTestId('csv-input')
      .setInputFiles({ name: `d${n}.csv`, mimeType: 'text/csv', buffer: makeCsv(chans) });
    await expect(page.getByTestId('shape-badge')).toHaveText(`8 x ${n} x 40`);
    await go(page, 3);
    await expect(page.getByTestId('layout-tag')).toHaveText(
      `${n}-channel layout, ${n - 2} on head, 2 in tray`,
    );
    await expect(page.locator('[data-testid^=electrode-]')).toHaveCount(n);
    await settle(page);
    const drawn = await page.evaluate(() => {
      const h = (
        window as unknown as {
          __eeg: { engine: { core: { reg: { index: Map<string, number> }; isVisible(i: number): boolean } } };
        }
      ).__eeg.engine.core;
      let k = 0;
      for (let i = 0; i < 128; i++) if (h.isVisible(h.reg.index.get(`electrode:${i}`)!)) k++;
      return k;
    });
    expect(drawn).toBe(n);
  });
}

test('reduced motion removes stagger, via poses and camera', async ({ page }) => {
  await boot(page);
  await pour(page);
  await settle(page);
  await page.getByRole('switch', { name: 'Reduce motion' }).click();
  await go(page, 2);
  const r = await page.evaluate(() => {
    const c = (window as unknown as { __eeg: Hooks }).__eeg.engine.core;
    let vias = 0;
    for (let i = 0; i < c.springs.viaMask.length; i++)
      vias += c.springs.viaMask[i] || c.springs.pendingVia[i] ? 1 : 0;
    return { delay: c.lastMaxDelay, cam: c.camera.tScale, vias };
  });
  expect(r).toEqual({ delay: 0, cam: 1, vias: 0 });
});

test('the app still loads with the backend offline (fallback tag visible)', async ({ page }) => {
  await page.route('http://localhost:8000/**', (r) => r.abort());
  await boot(page);
  await expect(page.getByTestId('offline-tag')).toBeVisible();
  await pour(page);
  await expect(page.getByTestId('shape-badge')).toHaveText('100 x 22 x 750');
  await go(page, 7);
  await expect(page.getByTestId('accuracy')).toBeVisible();
});

test('the engine survives React StrictMode double-mounting (one canvas, one stage)', async ({ page }) => {
  await boot(page);
  expect(await page.locator('canvas').count()).toBe(1);
  await pour(page);
  await settle(page);
  const sig = await page.evaluate(() => (window as unknown as { __eeg: Hooks }).__eeg.pieceSignature());
  expect(sig.count).toBe(await page.evaluate(() => (window as unknown as { __eeg: Hooks }).__eeg.pieces()));
  expect(sig.attached).toBe(sig.count);
});

test('feature cards: scrolling, searching and filtering', async ({ page }) => {
  await boot(page);
  await pour(page);
  await go(page, 5);
  await settle(page);
  await page.getByTestId('filter-Spatial').click();
  await settle(page);
  const vis = async (f: string): Promise<boolean> => page.getByTestId(`card-${f}`).isVisible();
  expect(await vis('csp')).toBe(true);
  expect(await vis('band_power')).toBe(false);
  await page.getByTestId('filter-All').click();
  await page.getByTestId('card-search').fill('wavelet');
  await settle(page);
  expect(await vis('wavelet')).toBe(true);
  expect(await vis('csp')).toBe(false);
  await page.getByTestId('card-search').fill('');
  await settle(page);
  const box = (await page.getByTestId('card-hjorth').boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(250);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('card-pane')).toBeVisible();
  await settle(page);
  await page.getByTestId('card-pane').locator('summary').click();
  await expect(page.getByTestId('card-pane').locator('math msqrt')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 640 });
  await settle(page);
  await page.mouse.move(10, 300);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(500);
  expect(
    (
      (await page.evaluate(() => (window as unknown as { __eeg: Hooks }).__eeg.store.getState())) as {
        ui: { scrollY: number };
      }
    ).ui.scrollY,
  ).toBeGreaterThan(0);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(300);
  await settle(page);
  await page.getByTestId('card-csp').click();
  await expect(page.getByTestId('feature-total')).toContainText('2 features');
});

test('page 7 selection drawer changes the final shape; React does not re-render per frame', async ({
  page,
}) => {
  await boot(page);
  await pour(page);
  await go(page, 7);
  await expect(page.getByTestId('accuracy')).toBeVisible();
  await expect(page.getByTestId('shape-badge')).toHaveText('100 x 6');
  await page.getByTestId('select-drawer').locator('summary').click();
  await page.getByRole('combobox', { name: 'Projection' }).click();
  await page.getByRole('option', { name: 'PCA' }).click();
  await expect(page.getByTestId('shape-badge')).toHaveText('100 x 2');
  // A page transition with no settings change must not cause per-frame React commits.
  await settle(page);
  const c0 = await page.evaluate(() => (window as unknown as { __eeg: Hooks }).__eeg.commits());
  await go(page, 6);
  await page.waitForTimeout(1500);
  const c1 = await page.evaluate(() => (window as unknown as { __eeg: Hooks }).__eeg.commits());
  expect(c1 - c0).toBeLessThan(25); // ~90 frames elapsed; commits come only from store changes
});

test('inherited-data mode (upstream NPZ) shows provenance and the inherited badge', async ({ page }) => {
  await boot(page);
  const dir = mkdtempSync(join(tmpdir(), 'npz-'));
  const out = join(dir, 'up.npz');
  const py = fileURLToPath(new URL('../../../backend/.venv/Scripts/python.exe', import.meta.url));
  execFileSync(py, [
    '-c',
    `import numpy as np, json; r=np.random.default_rng(0); np.savez(r"${out}", X=r.standard_normal((20,3,200)).astype(np.float32), y=np.array([0,1]*10), sfreq=np.array(100.0), ch_names=np.array(["C3","Cz","C4"]), times=np.arange(200)/100-0.5, meta_json=np.array(json.dumps({"version":"1","units":"uV","artifact_provenance":[{"step":"ica"}],"upstream_settings":{"band":[1,40]}})))`,
  ]);
  await page
    .getByTestId('npz-input')
    .setInputFiles({ name: 'up.npz', mimeType: 'application/octet-stream', buffer: readFileSync(out) });
  await expect(page.getByTestId('shape-badge')).toHaveText('20 x 3 x 200');
  await expect(page.getByText('upstream npz').first()).toBeVisible();
  await go(page, 2);
  await expect(page.getByText('Upstream settings inherited')).toBeVisible();
  await go(page, 4);
  await expect(page.getByText(/feature-specific filter \(additional to upstream\)/)).toBeVisible();
});

test('both matrix download buttons work in both export modes', async ({ page, request }) => {
  await boot(page);
  await pour(page, 'P300 (ERP)');
  await go(page, 8);
  for (const mode of ['Exploratory (all-data fit)', 'Out-of-fold (per fold)']) {
    await page.getByRole('radio', { name: mode }).click();
    await page.waitForTimeout(400);
    await expect(page.getByTestId('dl-csv')).toHaveAttribute('href', /token=/, { timeout: 30_000 });
    await page.waitForFunction(
      (m) => {
        const s = (window as unknown as { __eeg: Hooks }).__eeg.store.getState() as {
          results: { export?: { mode: string } };
        };
        return s.results.export?.mode === m;
      },
      mode.startsWith('Out') ? 'oof' : 'exploratory',
      { timeout: 30_000 },
    );
    for (const id of ['dl-csv', 'dl-npz']) {
      const href = await page.getByTestId(id).getAttribute('href');
      const r = await request.get(href!);
      expect(r.status()).toBe(200);
      expect((await r.body()).length).toBeGreaterThan(100);
    }
  }
});

test('switching "Interpret as" changes the defaults', async ({ page }) => {
  await boot(page);
  const chans = [
    'Fz',
    'FC3',
    'FC1',
    'FCz',
    'FC2',
    'FC4',
    'C5',
    'C3',
    'C1',
    'Cz',
    'C2',
    'C4',
    'C6',
    'CP3',
    'CP1',
    'CPz',
    'CP2',
    'CP4',
    'P1',
    'Pz',
    'P2',
    'POz',
  ];
  await page
    .getByTestId('csv-input')
    .setInputFiles({ name: 'mi.csv', mimeType: 'text/csv', buffer: makeCsv(chans, 10, 500) });
  await expect(page.getByTestId('paradigm-tag')).toHaveText('Custom');
  await expect(page.getByTestId('summary')).toBeVisible();
  await settle(page);
  await page.getByRole('combobox', { name: 'Interpret as' }).click();
  await page.getByRole('option', { name: 'Motor imagery' }).click();
  await expect(page.getByTestId('paradigm-tag')).toHaveText('Motor imagery');
  await expect(page.getByText('defaults from Motor imagery')).toBeVisible();
  await go(page, 3);
  await expect(page.getByTestId('counter')).toHaveText('3 of 22 channels selected');
});
