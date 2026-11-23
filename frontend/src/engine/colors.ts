// Design colours (section 4 and 3.0). Mirrors src/design/tokens.css for the canvas.
export const COLORS = {
  cream: 0xf6f1e7,
  panel: 0xfbf8f1,
  ink: 0x1f1b16,
  grey: 0x7a7266,
  hairline: 0xd9d1c0,
  accent: 0x2b4c8c,
  taupe: 0xcbbfa6,
  scalp: 0xfffdf7,
  excluded: 0xcfc8b8,
  /** Lively secondary accent (teal green) and warm wicker tones for the basket. */
  teal: 0x2a9d8f,
  tealLight: 0xcfe9e5,
  tealDark: 0x17655c,
  amber: 0xe9a23b,
  wicker: 0xb98a4e,
  wickerDark: 0x7d5a2f,
} as const;

/** Card category colours (top stripe and tag). */
export const CATEGORY_COLORS: Record<string, number> = {
  Time: 0x2a9d8f,
  Frequency: 0xe9a23b,
  'Time-frequency': 0x7a4e7e,
  Spatial: 0x2b4c8c,
  Learned: 0x6b7a3a,
};

export const CLASS_COLORS = [0xc4623d, 0x1f6f78, 0xb58b2a, 0x7a4e7e, 0x6b7a3a, 0xa8586b];
export const CLASS_MARKERS = ['circle', 'square', 'triangle', 'diamond', 'cross', 'star'] as const;
export const CLASS_HEX = ['#C4623D', '#1F6F78', '#B58B2A', '#7A4E7E', '#6B7A3A', '#A8586B'];

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255,
    ag = (a >> 8) & 255,
    ab = a & 255;
  const br = (b >> 16) & 255,
    bg = (b >> 8) & 255,
    bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Desaturate toward a warm grey of equal lightness. */
export function desaturate(c: number, amount = 0.7): number {
  const r = (c >> 16) & 255,
    g = (c >> 8) & 255,
    b = c & 255;
  const l = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
  return mix(c, (l << 16) | (l << 8) | l, amount);
}
