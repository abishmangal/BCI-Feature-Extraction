// Shared engine types. No React imports anywhere in src/engine.

export type Shape = 'line' | 'ribbon' | 'rect' | 'circle' | 'dot';

/** A target pose for one piece or decor item. Missing optional fields keep their current target. */
export interface TargetState {
  x: number;
  y: number;
  w?: number;
  h?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  alpha?: number;
  /** 0xRRGGBB */
  color?: number;
  cornerRadius?: number;
  reveal?: number;
  winStart?: number;
  winEnd?: number;
  shape?: Shape;
  /** Non-animated state applied when the piece's delay ends (labels, markers, flags). */
  extra?: Record<string, unknown>;
}

export interface StageSize {
  width: number;
  height: number;
  /** Stage area excludes the 56 px rail zone at the bottom. */
  stageHeight: number;
}

export type Layout = Map<string, TargetState>;
