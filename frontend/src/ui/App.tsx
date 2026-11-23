import { Profiler, useEffect } from 'react';
import * as RTooltip from '@radix-ui/react-tooltip';
import { TopBar } from './Shell';
import { StageHost } from './StageHost';
import { BandControls, ChannelsControls, ControlsPanel } from './Panels';
import { get, navigate, store, useStore } from '../store/store';
import { startApp } from '../store/effects';

/** Hash routing #/1 .. #/8 by hand (no router library); keyboard 1..8 and Left/Right. */
function useRouting(): void {
  useEffect(() => {
    const fromHash = (): void => {
      const m = /^#\/(\d)$/.exec(location.hash);
      if (m) navigate(+m[1]);
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

/** React commit counter (Profiler): used to verify React does not re-render per frame. */
export const commits = { n: 0 };

export function App() {
  useRouting();
  const workspace = useStore((s) => s.data && s.page === 3 ? 'channels' : s.data && s.page === 4 ? 'band' : null);
  useEffect(() => {
    void startApp();
  }, []);
  return (
    <Profiler id="app" onRender={() => (commits.n += 1)}>
      <RTooltip.Provider delayDuration={200}>
        <div className="app">
          <TopBar />
          <main className={`main${workspace ? ` ${workspace}-workspace` : ''}`}>
            <StageHost />
            {workspace === 'channels' ? <ChannelsControls /> : workspace === 'band' ? <BandControls /> : <ControlsPanel />}
          </main>
        </div>
      </RTooltip.Provider>
    </Profiler>
  );
}
