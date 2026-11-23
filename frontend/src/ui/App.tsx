import { Profiler, useEffect, useLayoutEffect, useRef } from 'react';
import * as RTooltip from '@radix-ui/react-tooltip';
import { PageHeader, ShapeBadge, TopBar } from './Shell';
import { StageHost } from './StageHost';
import { ChannelsControls, ControlsPanel, DatasetCards, LoadControls, MatrixControls, TransformControls } from './Panels';
import { get, navigate, store, useStore } from '../store/store';
import { startApp } from '../store/effects';

/** Hash routing #/1 .. #/8 by hand (no router library); keyboard 1..8 and Left/Right. */
function useRouting(): void {
  useEffect(() => {
    const fromHash = (): void => {
      const m = /^#\/(\d)$/.exec(location.hash);
      if (!m) return;
      const requested = +m[1];
      if (requested > 1 && !get().data) history.replaceState(history.state, '', '#/1');
      navigate(requested);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    const unsub = store.subscribe((s, p) => {
      if (s.page !== p.page && location.hash !== `#/${s.page}`) location.hash = `#/${s.page}`;
    });
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        t !== document.body &&
        t.closest(
          'input,select,textarea,button,[role=slider],[role=combobox],[role=switch],[contenteditable]',
        )
      )
        return;
      if (/^[1-8]$/.test(e.key)) navigate(+e.key);
      else if (e.key === 'ArrowLeft') navigate(get().page - 1);
      else if (e.key === 'ArrowRight') navigate(get().page + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('hashchange', fromHash);
      window.removeEventListener('keydown', onKey);
      unsub();
    };
  }, []);
}

function LoadSidebar({ loaded }: { loaded: boolean }) {
  const column = useRef<HTMLDivElement>(null);
  const previous = useRef(new Map<Element, DOMRect>());
  const reduceMotion = useStore((s) => s.ui.reduceMotion);

  useLayoutEffect(() => {
    const cards = Array.from(column.current!.querySelectorAll('.load-tools > .psec, .dataset-cards > .psec'));
    const measure = () => new Map(cards.map((card) => [card, card.getBoundingClientRect()]));
    const current = measure();
    const animations: Animation[] = [];
    if (loaded && previous.current.size && !reduceMotion && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (const [card, to] of current) {
        const from = previous.current.get(card);
        const frames = from
          ? [{ transform: `translate(${from.x - to.x}px, ${from.y - to.y}px)` }, { transform: 'none' }]
          : [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }];
        if (!from || from.x !== to.x || from.y !== to.y) {
          animations.push(card.animate(frames, { duration: 450, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }));
        }
      }
    }
    previous.current = current;

    if (!loaded) {
      const refresh = () => { previous.current = measure(); };
      const observer = new ResizeObserver(refresh);
      observer.observe(column.current!);
      for (const card of cards) observer.observe(card);
      const workspace = column.current!.parentElement!;
      workspace.addEventListener('scroll', refresh);
      return () => {
        observer.disconnect();
        workspace.removeEventListener('scroll', refresh);
      };
    }
    return () => animations.forEach((animation) => animation.cancel());
  }, [loaded, reduceMotion]);

  return (
    <div className="load-content" ref={column}>
      <LoadControls />
      <DatasetCards />
    </div>
  );
}

/** React commit counter (Profiler): used to verify React does not re-render per frame. */
export const commits = { n: 0 };

export function App() {
  useRouting();
  const workspace = useStore((s) => {
    if (s.page === 1) return 'load';
    if (s.page === 7) return 'matrix';
    if (!s.data) return null;
    if (s.page === 3) return 'channels';
    if (s.page === 6) return 'transform';
    return null;
  });
  const loaded = useStore((s) => s.page === 1 && !!s.data);
  useEffect(() => {
    void startApp();
  }, []);
  return (
    <Profiler id="app" onRender={() => (commits.n += 1)}>
      <RTooltip.Provider delayDuration={200}>
        <div className="app">
          <TopBar />
          <main className={`main${workspace ? ` ${workspace}-workspace` : ''}${loaded ? ' load-ready' : ''}`}>
            {workspace === 'matrix' ? (
              <div className="matrix-top">
                <div className="matrix-intro">
                  <PageHeader />
                  <ShapeBadge />
                </div>
                <MatrixControls />
              </div>
            ) : null}
            {workspace === 'load' ? (
              <div className="load-intro">
                <PageHeader />
                <ShapeBadge />
              </div>
            ) : null}
            <StageHost />
            {workspace === 'load' ? <LoadSidebar loaded={loaded} /> : null}
            {workspace === 'channels' ? <ChannelsControls /> : workspace === 'transform' ? <TransformControls /> : <ControlsPanel />}
          </main>
        </div>
      </RTooltip.Provider>
    </Profiler>
  );
}
