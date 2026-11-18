import { ContainerError } from '../../errors.js';
import type { WasixInstance, WasixRuntime, WasixSdk } from './types.js';

// Compiled from tty-size.wat with wabt 1.0.39. The final eight bytes are its data
// segment, not SDK memory or a private wasm-bindgen representation.
const moduleBytes = Uint8Array.from(
  atob(
    'AGFzbQEAAAABEQNgAX8Bf2AEf39/fwF/YAAAAk0DCndhc2l4XzMydjEHdHR5X2dldAAACndhc2l4XzMydjEHdHR5X3NldAAAFndhc2lfc25hcHNob3RfcHJldmlldzEIZmRfd3JpdGUAAQMCAQIFAwEAAQcTAgZtZW1vcnkCAAZfc3RhcnQAAwpSAVAAQcAAEAAEQAALQcAAQSAoAgA2AgBBxABBJCgCADYCAEHAABABBEAAC0HAABAABEAAC0EAQcAANgIAQQRBCDYCAEEBQQBBAUEIEAIEQAALCwsOAQBBIAsIAAAAAAAAAAA='
  ),
  (character) => character.charCodeAt(0)
);

export function validateTerminalSize(columns: number, rows: number): void {
  if (
    ![columns, rows].every((value) => Number.isSafeInteger(value) && value >= 1 && value <= 65535)
  )
    throw new ContainerError(
      'INVALID_ARGUMENT',
      'Terminal columns and rows must be integers from 1 to 65535'
    );
}

export function terminalSizeModule(columns: number, rows: number): Uint8Array {
  validateTerminalSize(columns, rows);
  const bytes = moduleBytes.slice();
  const payload = new DataView(bytes.buffer, bytes.length - 8);
  payload.setUint32(0, columns, true);
  payload.setUint32(4, rows, true);
  return bytes;
}

/** Use the same public package runner and shared Runtime as Bash, never runWasix. */
export async function resizeWasixTty(
  sdk: WasixSdk,
  runtime: WasixRuntime,
  columns: number,
  rows: number,
  signal?: AbortSignal
): Promise<void> {
  const bytes = terminalSizeModule(columns, rows);
  signal?.throwIfAborted();
  if (!sdk.Wasmer.fromWasm)
    throw new ContainerError('UNSUPPORTED_PROFILE', 'SDK does not support terminal geometry');
  const pkg = sdk.Wasmer.fromWasm(bytes, runtime);
  const command = pkg.entrypoint;
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => rejectAbort(signal!.reason);
  const wait = <T>(work: Promise<T>) => (signal ? Promise.race([work, aborted]) : work);
  signal?.addEventListener('abort', abort, { once: true });
  let stdin: WritableStream<Uint8Array> | undefined;
  let completed = false;
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  const discard = (instance: WasixInstance) => {
    // A run result may arrive after its owner terminated the SDK worker group.
    const { stdin, stdout, stderr } = instance;
    void stdin?.abort().catch(() => {});
    for (const stream of [stdout, stderr]) void stream.cancel().catch(() => {});
    void instance.waitForExit().catch(() => {});
  };
  try {
    if (!command)
      throw new ContainerError('STARTUP_FAILED', 'Terminal geometry helper has no entrypoint');
    const running = command
      .run({ args: [], cwd: '/', env: {}, mount: {}, rawStdin: true })
      .then((instance) => {
        if (signal?.aborted) {
          discard(instance);
          throw signal.reason;
        }
        return instance;
      });
    const instance = await wait(running);
    if (signal?.aborted) {
      discard(instance);
      throw signal.reason;
    }
    const read = async (stream: ReadableStream<Uint8Array>, limit: number) => {
      const reader = stream.getReader();
      const chunks: number[] = [];
      readers.push(reader);
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (chunks.length + value.length > limit)
            throw new ContainerError(
              'RESOURCE_LIMIT',
              'Terminal geometry helper output exceeds its bound'
            );
          chunks.push(...value);
        }
        return Uint8Array.from(chunks);
      } finally {
        reader.releaseLock();
      }
    };
    // waitForExit consumes the wasm-bindgen Instance, including its stream
    // getters. Retain all three streams before calling it.
    const { stdin: rawInput, stdout: rawOut, stderr: rawErr } = instance;
    stdin = rawInput;
    const output = read(rawOut, 8);
    const errors = read(rawErr, 4096);
    const exit = instance.waitForExit();
    const [stdout, stderr, result] = await wait(
      Promise.all([output, errors, exit, stdin?.close()])
    );
    if (result.code !== 0 || stderr.length || stdout.length !== 8)
      throw new ContainerError('STARTUP_FAILED', 'Terminal geometry helper failed');
    const accepted = new DataView(stdout.buffer);
    if (accepted.getUint32(0, true) !== columns || accepted.getUint32(4, true) !== rows)
      throw new ContainerError(
        'STARTUP_FAILED',
        'Terminal geometry was not accepted by the runtime'
      );
    completed = true;
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!completed) {
      void stdin?.abort().catch(() => {});
      for (const reader of readers) void reader.cancel().catch(() => {});
    }
    command?.free?.();
    pkg.free?.();
  }
}
