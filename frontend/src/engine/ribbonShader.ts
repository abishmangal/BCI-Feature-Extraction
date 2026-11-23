// Ribbon mesh: custom geometry (triangle-strip), built ONCE per dataset in unit space from at most 200
// decimated points covering the FULL epoch. Animated only through the container transform, alpha, tint
// and the two spring-driven uniforms uWinStart and uWinEnd (0..1) that hide fragments outside the window.
import { Geometry, GlProgram, Mesh, Shader } from 'pixi.js';

const vertex = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform float uThick;
out vec2 vUV;
void main() {
  mat3 m = uWorldTransformMatrix * uTransformMatrix;
  vec3 w = m * vec3(aPosition, 1.0);
  // Constant pixel thickness for the trace, applied after the transform (works at zero height too).
  if (aUV.y < 1.5) w.y += aUV.y * uThick;
  gl_Position = vec4((uProjectionMatrix * w).xy, 0.0, 1.0);
  vUV = aUV;
}
`;

const fragment = /* glsl */ `
in vec2 vUV;
uniform vec4 uColor;
uniform float uWinStart;
uniform float uWinEnd;
uniform float uFill;
uniform float uInk;
uniform vec3 uInkColor;
out vec4 finalColor;
void main() {
  if (vUV.x < uWinStart || vUV.x > uWinEnd) discard;
  float a = uColor.a;
  if (vUV.y > 1.5) {
    // Background fill in the tint colour (premultiplied).
    finalColor = vec4(uColor.rgb, a) * uFill;
  } else {
    vec3 rgb = a > 0.0 ? uColor.rgb / a : vec3(0.0);
    vec3 c = mix(rgb, uInkColor, uInk);
    finalColor = vec4(c * a, a);
  }
}
`;

let program: GlProgram | null = null;
function getProgram(): GlProgram {
  if (!program) program = new GlProgram({ vertex, fragment, name: 'ribbon-shader' });
  return program;
}

export const RIBBON_POINTS = 200;

/** Vertex count for a strip of n points: fill quad (4) + 2 degenerate + 2 per point. */
const vcount = (n: number): number => 4 + 2 + 2 * n;

export interface RibbonMesh {
  mesh: Mesh<Geometry, Shader>;
  uniforms: {
    uWinStart: number;
    uWinEnd: number;
    uFill: number;
    uInk: number;
    uThick: number;
    uInkColor: Float32Array;
  };
  setPoints(y: Float32Array | null): void;
}

/** y: values in [-0.5, 0.5] (unit space), one per point, spanning the full epoch. */
export function buildStrip(
  y: Float32Array | null,
  n = RIBBON_POINTS,
): { pos: Float32Array; uv: Float32Array } {
  const vc = vcount(n);
  const pos = new Float32Array(vc * 2);
  const uv = new Float32Array(vc * 2);
  let k = 0;
  const put = (x: number, yy: number, u: number, side: number): void => {
    pos[2 * k] = x;
    pos[2 * k + 1] = yy;
    uv[2 * k] = u;
    uv[2 * k + 1] = side;
    k++;
  };
  // Fill quad (uv.y = 2 marks fill vertices).
  put(-0.5, -0.5, 0, 2);
  put(-0.5, 0.5, 0, 2);
  put(0.5, -0.5, 1, 2);
  put(0.5, 0.5, 1, 2);
  const yAt = (i: number): number => (y && i < y.length ? y[i] : 0);
  // Degenerate join.
  put(0.5, 0.5, 1, 2);
  put(-0.5, -yAt(0), 0, -1);
  for (let i = 0; i < n; i++) {
    const u = n > 1 ? i / (n - 1) : 0;
    const x = u - 0.5;
    const yy = -yAt(i); // screen y grows downward, so positive values are drawn upward
    put(x, yy, u, -1);
    put(x, yy, u, 1);
  }
  return { pos, uv };
}

export function createRibbonMesh(opts: {
  fill: number;
  ink: number;
  inkColor: number;
  thick?: number;
}): RibbonMesh {
  const n = RIBBON_POINTS;
  const { pos, uv } = buildStrip(null, n);
  const vc = vcount(n);
  const indices = new Uint32Array(vc);
  for (let i = 0; i < vc; i++) indices[i] = i;
  const geometry = new Geometry({
    attributes: {
      aPosition: { buffer: pos, format: 'float32x2' },
      aUV: { buffer: uv, format: 'float32x2' },
    },
    indexBuffer: indices,
    topology: 'triangle-strip',
  });
  const ic = new Float32Array([
    ((opts.inkColor >> 16) & 255) / 255,
    ((opts.inkColor >> 8) & 255) / 255,
    (opts.inkColor & 255) / 255,
  ]);
  const shader = new Shader({
    glProgram: getProgram(),
    resources: {
      ribbonUniforms: {
        uWinStart: { value: 0, type: 'f32' },
        uWinEnd: { value: 1, type: 'f32' },
        uFill: { value: opts.fill, type: 'f32' },
        uInk: { value: opts.ink, type: 'f32' },
        uThick: { value: opts.thick ?? 0.6, type: 'f32' },
        uInkColor: { value: ic, type: 'vec3<f32>' },
      },
    },
  });
  const mesh = new Mesh<Geometry, Shader>({ geometry, shader });
  const uniforms = shader.resources.ribbonUniforms.uniforms as RibbonMesh['uniforms'];
  return {
    mesh,
    uniforms,
    setPoints(y: Float32Array | null) {
      const s = buildStrip(y, n);
      const pb = geometry.getAttribute('aPosition').buffer;
      pb.data = s.pos;
      pb.update();
    },
  };
}
