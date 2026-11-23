// Array transport: { dtype: "f32", shape, b64 } with little-endian float32 bytes (section 2.2).

export interface F32 {
  dtype: 'f32';
  shape: number[];
  b64: string;
}

const isLittleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

function b64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node (tests)
  const B = (globalThis as unknown as { Buffer: { from(s: string, e: string): Uint8Array } }).Buffer;
  return new Uint8Array(B.from(b64, 'base64'));
}

function bytesToB64(bytes: Uint8Array): string {
  if (typeof btoa === 'function') {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  const B = (globalThis as unknown as { Buffer: { from(b: Uint8Array): { toString(e: string): string } } })
    .Buffer;
  return B.from(bytes).toString('base64');
}

export function decodeF32(obj: F32): Float32Array {
  if (obj.dtype !== 'f32') throw new Error('expected dtype f32');
  const bytes = b64ToBytes(obj.b64);
  const n = bytes.byteLength / 4;
  const out = new Float32Array(n);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < n; i++) out[i] = view.getFloat32(i * 4, true);
  void isLittleEndian;
  return out;
}

export function encodeF32(a: ArrayLike<number>, shape?: number[]): F32 {
  const bytes = new Uint8Array(a.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < a.length; i++) view.setFloat32(i * 4, a[i], true);
  return { dtype: 'f32', shape: shape ?? [a.length], b64: bytesToB64(bytes) };
}

export const size = (o: F32): number => o.shape.reduce((a, b) => a * b, 1);
