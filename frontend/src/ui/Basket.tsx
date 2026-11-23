// The feature basket (Page 5 sidebar). DOM, styled after the reference design; the count and the 5 -> 6
// swell-and-flip are driven by the same spring solver as the stage (no animation library).
import { memo, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Scalar } from '../engine/scalar';
import { buildCtx } from '../engine/wiring';
import { BASKET_FLIP_SCALE, p5Geo } from '../layouts/page5';
import { get, set, updateSettings, useStore, type FamilyId } from '../store/store';
import { TITLES, CATEGORY } from '../layouts/page5';

const CAT_HEX: Record<string, string> = {
  Time: '#2a9d8f',
  Frequency: '#e9a23b',
  'Time-frequency': '#7a4e7e',
  Spatial: '#2b4c8c',
  Learned: '#6b7a3a',
};
const NONE: FamilyId[] = [];

/** Where the basket sat in the sidebar (page coordinates), so it can float out from exactly there. */
let lastRect: { left: number; top: number; width: number; height: number } | null = null;

export const Basket = memo(function Basket({ flipping = false }: { flipping?: boolean }) {
  const chosen = useStore((s) => s.settings.features ?? NONE);
  const total = useStore((s) => s.results.features?.selected.total ?? 0);
  const learned = useStore((s) => (s.results.features?.learnedSelected.length ?? 0) > 0);
  const reduced = useStore((s) => s.ui.reduceMotion);
  const root = useRef<HTMLDivElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const counter = useRef(new Scalar(total, 'soft'));

  // Rolling count (spring).
  useEffect(() => {
    const sc = counter.current;
    sc.t = total;
    if (reduced) sc.snap(total);
    let raf = 0;
    let last = performance.now();
    const tick = (t: number): void => {
      const moving = sc.step(t - last);
      last = t;
      if (count.current) count.current.textContent = String(Math.round(sc.x));
      if (moving) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [total, reduced]);

  // Remember the basket's place in the sidebar while it is shown there.
  useEffect(() => {
    if (flipping) return;
    const save = (): void => {
      const r = root.current?.getBoundingClientRect();
      if (r && r.width > 0) {
        lastRect = { left: r.left, top: r.top, width: r.width, height: r.height };
        const bs = get().ui.basketSize;
        if (Math.abs(bs.w - r.width) > 1 || Math.abs(bs.h - r.height) > 1)
          set({ ui: { ...get().ui, basketSize: { w: r.width, h: r.height } } });
      }
    };
    save();
    const t = setInterval(save, 250);
    return () => {
      save();
      clearInterval(t);
    };
  });

  // 5 -> 6: the basket floats out of the sidebar onto the stage, swells, flips upside down (its
  // contents spill onto the stage) and fades. All motion uses the app's spring solver.
  useEffect(() => {
    const el = root.current;
    const box = el?.parentElement;
    if (!el || !box || !flipping) return;
    if (reduced || !lastRect) {
      box.style.opacity = '0';
      return;
    }
    const host = document.querySelector('.stage-host')?.getBoundingClientRect();
    const b = p5Geo(buildCtx()).basket; // spill origin on the stage (stage coordinates)
    const tx0 = host ? host.left + b.x + b.w / 2 - (lastRect.left + lastRect.width / 2) : -300;
    const ty0 = host ? host.top + b.y + b.h / 2 - (lastRect.top + lastRect.height / 2) : 60;
    const tx = new Scalar(0, 'soft');
    const ty = new Scalar(0, 'soft');
    const scale = new Scalar(1, 'standard');
    const rot = new Scalar(0, 'soft');
    const alpha = new Scalar(1, 'reveal');
    tx.t = tx0;
    ty.t = ty0;
    scale.t = BASKET_FLIP_SCALE;
    rot.delayMs = 380;
    rot.t = -180; // flips the other way round (counter-clockwise)
    alpha.delayMs = 1700; // stays visible while its contents pour out
    alpha.t = 0;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number): void => {
      const dt = t - last;
      last = t;
      const m = [tx.step(dt), ty.step(dt), scale.step(dt), rot.step(dt), alpha.step(dt)].some(Boolean);
      box.style.transform = `translate(${tx.x}px, ${ty.x}px) scale(${scale.x}) rotate(${rot.x}deg)`;
      box.style.opacity = String(Math.max(0, Math.min(1, alpha.x)));
      if (m) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flipping, reduced]);

  const body = (
    <div className="basket" ref={root} data-testid="basket">
      <div className="basket-head">
        <span>FEATURE BASKET</span>
        <span className="basket-count" ref={count} aria-label={`${total} features`}>
          {total}
        </span>
      </div>
      <div className="basket-body">
        {chosen.length === 0 ? (
          <>
            <p className="basket-empty">Basket Empty: Default features used</p>
            <p className="basket-hint">Choose a feature card to begin.</p>
          </>
        ) : (
          <>
            <h4>Selected features</h4>
            <p className="basket-hint">
              {chosen.length} famil{chosen.length === 1 ? 'y' : 'ies'}, {total} features
            </p>
            <ul className="basket-chips">
              {chosen.map((f) => (
                <li key={f}>
                  <button
                    className="basket-chip"
                    style={{ borderColor: CAT_HEX[CATEGORY[f]] }}
                    onClick={() =>
                      updateSettings({ features: get().settings.features.filter((x) => x !== f) })
                    }
                    title="Click to remove from the basket"
                  >
                    <span className="dot" style={{ background: CAT_HEX[CATEGORY[f]] }} />
                    {TITLES[f]}
                    <span className="x" aria-hidden>
                      &times;
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {learned ? <p className="basket-note">fit inside cross-validation to avoid leakage</p> : null}
      </div>
      <div className="basket-wave" />
    </div>
  );
  if (!flipping) return body;
  const r = lastRect ?? { left: window.innerWidth - 330, top: 100, width: 300, height: 360 };
  return createPortal(<FloatBox rect={r}>{body}</FloatBox>, document.body);
});

/** A fixed-position box over the page where the floating basket animates (outside the sidebar). */
function FloatBox({
  rect,
  children,
}: {
  rect: { left: number; top: number; width: number };
  children: ReactNode;
}) {
  return (
    <div className="basket-float" style={{ left: rect.left, top: rect.top, width: rect.width }}>
      {children}
    </div>
  );
}
