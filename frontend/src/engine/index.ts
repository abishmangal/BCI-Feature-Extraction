// The engine singleton (section 2.4). Created once at module level. `mount(canvas)` is idempotent and
// `unmount()` only detaches the canvas and listeners; pieces are never destroyed. Survives StrictMode.
import { EngineCore } from './core';
import { Stage, type Painters } from './stage';
import type { Layout, StageSize } from './types';
import type { TransitionDef, TransitionHelpers } from './transitions';
import type { OrderTables } from './stagger';

export interface EngineConfig<Ctx> {
  ctx: () => Ctx;
  layout: (page: number, ctx: Ctx) => Layout;
  helpers: (ctx: Ctx) => TransitionHelpers;
  tables: (ctx: Ctx) => OrderTables;
  painters: Painters;
  /** Called before a layout runs so the app can rewrite slot group keys and mesh data. */
  prepare?: (ctx: Ctx, core: EngineCore, stage: Stage) => void;
  reduced: () => boolean;
}

type FrameListener = (dtMs: number) => void;

export class Engine<Ctx = unknown> {
  readonly core = new EngineCore();
  stage: Stage | null = null;
  private config: EngineConfig<Ctx> | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private mountCount = 0;
  private resizeObs: ResizeObserver | null = null;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private frameListeners = new Set<FrameListener>();
  page = 1;
  private started = false;
  dragging = false;
  ready: Promise<void> | null = null;
  /** Count of display objects created after startup (must stay 0). */
  createdAfterStartup = 0;

  configure(config: EngineConfig<Ctx>): void {
    if (this.config) return; // idempotent
    this.config = config;
    this.stage = new Stage(this.core, config.painters);
    this.stage.onFrame = (dt) => {
      for (const l of this.frameListeners) l(dt);
    };
  }

  /** Idempotent. Survives React StrictMode double-mounting. */
  mount(canvas: HTMLCanvasElement): Promise<void> {
    if (!this.config || !this.stage) throw new Error('engine.configure() must run before mount()');
    this.mountCount++;
    if (this.canvas && this.canvas !== canvas) {
      // The engine owns one canvas for its lifetime: put it where React placed the new element.
      canvas.replaceWith(this.canvas);
    } else if (!this.canvas) {
      this.canvas = canvas;
    }
    const host = this.canvas.parentElement;
    if (host && !this.resizeObs) {
      // Debounced: during a panel slide the canvas stretches smoothly and the layout updates once at the end.
      this.resizeObs = new ResizeObserver(() => {
        if (this.resizeTimer) clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() => this.handleResize(), 180);
      });
      this.resizeObs.observe(host);
    }
    if (!this.ready) {
      this.ready = this.stage.init(this.canvas).then(() => {
        this.handleResize();
        if (!this.started) {
          this.started = true;
          this.applyPage(this.page, { initial: true });
        }
      });
    }
    return this.ready;
  }

  unmount(): void {
    this.mountCount = Math.max(0, this.mountCount - 1);
    if (this.resizeObs) {
      this.resizeObs.disconnect();
      this.resizeObs = null;
    }
  }

  get isMounted(): boolean {
    return this.mountCount > 0;
  }

  stageSize(): StageSize {
    const w = this.stage?.width ?? 1280;
    const h = this.stage?.height ?? 800;
    return { width: w, height: h, stageHeight: h - 56 };
  }

  private handleResize(): void {
    const host = this.canvas?.parentElement;
    if (!host || !this.stage) return;
    const w = Math.max(320, host.clientWidth);
    const h = Math.max(320, host.clientHeight);
    if (w === this.stage.width && h === this.stage.height && this.started) return;
    this.stage.resize(w, h);
    if (this.started) this.applyPage(this.page, { inPage: true });
  }

  onFrame(l: FrameListener): () => void {
    this.frameListeners.add(l);
    return () => this.frameListeners.delete(l);
  }

  /** Navigate to a page with its transition. */
  navigate(page: number): void {
    if (page === this.page) return;
    const from = this.page;
    this.page = page;
    if (this.started) this.applyPage(page, { from });
  }

  /** Re-run the current page layout after a settings or data change (in-page, snappy). */
  refresh(): void {
    if (this.started) this.applyPage(this.page, { inPage: true });
  }

  /** Re-run the current page layout with a page-internal choreography (Page 1 load states, Page 8 phase). */
  applyCustom(def: TransitionDef): void {
    if (this.started) this.applyPage(this.page, { inPage: true, custom: def });
  }

  private applyPage(
    page: number,
    o: { from?: number; initial?: boolean; inPage?: boolean; custom?: TransitionDef },
  ): void {
    const cfg = this.config!;
    const ctx = cfg.ctx();
    cfg.prepare?.(ctx, this.core, this.stage!);
    const layout = cfg.layout(page, ctx);
    const reduced = cfg.reduced();
    this.stage!.reduced = reduced;
    this.core.apply(layout, {
      from: o.from ?? page,
      to: page,
      reduced,
      helpers: cfg.helpers(ctx),
      tables: cfg.tables(ctx),
      inPage: o.inPage,
      initial: o.initial,
      dragging: this.dragging,
      custom: o.custom ?? null,
    });
    this.stage!.repaintAll();
  }

  wake(): void {
    this.stage?.wake();
  }
}
