export interface WasiStdio {
  /** Optional initial descriptor state for inherited bindings; batch defaults to 0/1/2. */
  isOpen?(fd: number): boolean;
  read(length: number): Uint8Array;
  write(fd: 1 | 2, bytes: Uint8Array): number;
  close?(fd: number): void;
  capture(): { stdout: Uint8Array; stderr: Uint8Array };
}
/** One batch byte channel shared by a driver and its synchronous child tools. */
export function createBatchStdio(stdin: Uint8Array, maxOutputBytes: number) {
  let inputOffset = 0, outputBytes = 0;
  const output = [new Uint8Array(0), new Uint8Array(0)];
  const sizes = [0, 0];
  return {
    read(length: number) {
      const bytes = stdin.subarray(inputOffset, inputOffset + length);
      inputOffset += bytes.length;
      return bytes;
    },
    write(fd: 1 | 2, bytes: Uint8Array) {
      if (outputBytes + bytes.length > maxOutputBytes) throw new Error('Batch output exceeds configured limit');
      const index = fd - 1, used = sizes[index]!, required = used + bytes.length;
      if (required > output[index]!.length) {
        const grown = new Uint8Array(Math.min(maxOutputBytes, Math.max(4096, required, output[index]!.length * 2)));
        grown.set(output[index]!); output[index] = grown;
      }
      output[index]!.set(bytes, used); sizes[index] = required; outputBytes += bytes.length;
      return bytes.length;
    },
    capture() { return { stdout: output[0]!.slice(0, sizes[0]), stderr: output[1]!.slice(0, sizes[1]) }; }
  };
}
export type BatchStdio = ReturnType<typeof createBatchStdio>;
