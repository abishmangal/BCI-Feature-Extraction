import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './design/tokens.css';
import './ui/app.css';
import { fontsReady } from './design/fonts';
import { wireEngine, engine, buildCtx } from './engine/wiring';
import { layoutFor } from './layouts';
import { P } from './engine/springs';
import type { Container } from 'pixi.js';
import { commits } from './ui/App';
import { App } from './ui/App';
import { store } from './store/store';

wireEngine();
// Read-only hooks for the end-to-end tests.
function countDisplayObjects(c: Container): number {
  let n = 1;
  for (const ch of c.children) n += countDisplayObjects(ch as Container);
  return n;
}
(window as unknown as Record<string, unknown>).__eeg = {
  engine,
  store,
  settled: () => engine.core.allSettled(),
  displayObjects: () => (engine.stage?.app ? countDisplayObjects(engine.stage.app.stage) : 0),
  pieces: () => engine.core.reg.n,
  pieceSignature: () => engine.stage?.pieceSignature(),
  commits: () => commits.n,
  /** Max |position - layout target| over visible targets of the current page (px). */
  targetDiff: () => {
    const c = buildCtx();
    const m = layoutFor(c.page, c);
    let worst = 0;
    engine.core.reg.ids.forEach((id, i) => {
      const t = m.get(id)!;
      if ((t.alpha ?? 1) < 0.01 || t.scaleX === 0 || t.scaleY === 0) return;
      worst = Math.max(
        worst,
        Math.abs(engine.core.get(i, P.x) - t.x),
        Math.abs(engine.core.get(i, P.y) - t.y),
      );
    });
    return worst;
  },
};

void fontsReady().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
