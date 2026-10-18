import { ContainerError } from '../../errors.js';

/** v1 deliberately excludes start functions, imported/shared memories and non-Preview1 imports. */
export function checkMemoryProfile(bytes: Uint8Array, maxMemoryBytes: number): void {
  const fail = (message: string): never => { throw new ContainerError('UNSUPPORTED_PROFILE', message); };
  if (!Number.isSafeInteger(maxMemoryBytes) || maxMemoryBytes < 65536 || maxMemoryBytes > 2 ** 32) fail('Invalid memory limit');
  if (bytes.length < 8 || ![0, 97, 115, 109, 1, 0, 0, 0].every((b, i) => bytes[i] === b)) fail('Expected core Wasm v1');
  let offset = 8, end = bytes.length, memories = 0;
  const u32 = (): number => {
    let n = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      if (offset >= end) fail('Truncated Wasm section');
      const b = bytes[offset++]!;
      if (shift === 28 && b > 15) fail('Invalid Wasm integer');
      n += (b & 127) * 2 ** shift;
      if (!(b & 128)) return n;
    }
    return fail('Invalid Wasm integer');
  };
  while (offset < bytes.length) {
    const id = bytes[offset++]!;
    end = bytes.length;
    const length = u32(), next = offset + length;
    if (next > bytes.length) fail('Truncated Wasm section');
    end = next;
    if (id === 8) fail('Wasm start sections are outside the command profile');
    if (id === 5) {
      if (u32() !== 1 || u32() !== 1) fail('Require one bounded, unshared wasm32 memory');
      const initial = u32(), maximum = u32();
      if (initial > maximum || maximum * 65536 > maxMemoryBytes || offset !== end) fail('Wasm memory exceeds the hard limit');
      memories++;
    }
    offset = next;
  }
  if (memories !== 1) fail('Require exactly one defined memory');
}
