/** Errors are symbolic here; each ABI maps them to its own numeric errno. */
export class PipeError extends Error {
  constructor(readonly code: 'EPIPE' | 'EBADF' | 'EINVAL', message = code as string) {
    super(message); this.name = 'PipeError';
  }
}

export interface PipeReader {
  read(length: number): Promise<Uint8Array>;
  dup(): PipeReader;
  close(): void;
}
export interface PipeWriter {
  /** Partial write: resolves with the bytes accepted by the bounded ring. */
  write(bytes: Uint8Array): Promise<number>;
  dup(): PipeWriter;
  close(): void;
}

export function createPipe(capacity = 64 * 1024) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 16 * 1024 * 1024) {
    throw new PipeError('EINVAL', 'Pipe capacity must be 1..16777216 bytes');
  }
  const ring = new Uint8Array(capacity);
  let start = 0, size = 0, readers = 0, writers = 0;
  let failure: unknown;
  const waiters = new Set<() => void>();
  const wake = () => { for (const waiter of waiters) waiter(); waiters.clear(); };
  const wait = () => new Promise<void>((resolve) => waiters.add(resolve));
  const check = (closed: boolean) => {
    if (closed) throw new PipeError('EBADF');
    if (failure !== undefined) throw failure;
  };
  const makeReader = (): PipeReader => {
    readers++;
    let closed = false;
    return {
      async read(length) {
        check(closed);
        if (!Number.isSafeInteger(length) || length < 0) throw new PipeError('EINVAL');
        if (length === 0) return new Uint8Array();
        while (size === 0 && writers !== 0) { await wait(); check(closed); }
        check(closed);
        const count = Math.min(length, size);
        const result = new Uint8Array(count);
        for (let i = 0; i < count; i++) result[i] = ring[(start + i) % capacity]!;
        start = (start + count) % capacity; size -= count;
        wake();
        return result;
      },
      dup() { check(closed); return makeReader(); },
      close() { if (closed) throw new PipeError('EBADF'); closed = true; readers--; wake(); }
    };
  };
  const makeWriter = (): PipeWriter => {
    writers++;
    let closed = false;
    return {
      async write(bytes) {
        check(closed);
        if (!(bytes instanceof Uint8Array)) throw new PipeError('EINVAL');
        if (bytes.length === 0) return 0;
        while (size === capacity && readers !== 0) { await wait(); check(closed); }
        check(closed);
        if (readers === 0) throw new PipeError('EPIPE');
        const count = Math.min(bytes.length, capacity - size);
        for (let i = 0; i < count; i++) ring[(start + size + i) % capacity] = bytes[i]!;
        size += count; wake();
        return count;
      },
      dup() { check(closed); return makeWriter(); },
      close() { if (closed) throw new PipeError('EBADF'); closed = true; writers--; wake(); }
    };
  };
  return {
    reader: makeReader(), writer: makeWriter(),
    get bufferedBytes() { return size; },
    get capacity() { return capacity; },
    abort(reason: unknown = new PipeError('EPIPE')) { failure ??= reason; wake(); }
  };
}

export function pipeReadable(reader: PipeReader, chunkBytes = 64 * 1024) {
  // A zero-length read returns no bytes without reaching EOF; pulling with it would close
  // the reader early and turn pending writes into EPIPE.
  if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 1) throw new PipeError('EINVAL', 'chunkBytes must be a positive integer');
  let closed = false;
  const close = () => { if (!closed) { closed = true; reader.close(); } };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const bytes = await reader.read(chunkBytes);
        if (bytes.length) controller.enqueue(bytes);
        else { close(); controller.close(); }
      } catch (error) { close(); controller.error(error); }
    },
    cancel() { close(); }
  }, { highWaterMark: 0 });
}

export function pipeWritable(writer: PipeWriter) {
  let closed = false;
  const close = () => { if (!closed) { closed = true; writer.close(); } };
  return new WritableStream<Uint8Array>({
    start(controller) { controller.signal.addEventListener('abort', close, { once: true }); },
    async write(bytes) {
      // A rejected sink write errors the stream without calling close/abort, and a later
      // abort() on an errored stream never signals. Release the endpoint here, otherwise the
      // reader would wait for this writer forever instead of observing EOF.
      try {
        if (!(bytes instanceof Uint8Array)) throw new PipeError('EINVAL');
        let offset = 0;
        while (offset < bytes.length) offset += await writer.write(bytes.subarray(offset));
      } catch (error) { close(); throw error; }
    },
    close, abort: close
  }, { highWaterMark: 1 });
}
