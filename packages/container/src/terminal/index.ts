import { ContainerError } from '../errors.js';
import type { ContainerProcess, ProcessResult } from '../types.js';

export interface TerminalFrame {
  readonly channel: 'stdout' | 'stderr';
  readonly text: string;
  /** Aborted on completion, disposal or failure; cooperate during async rendering. */
  readonly signal: AbortSignal;
}
export interface TerminalOptions {
  /** Calls are serialized; awaiting a call applies output backpressure. */
  readonly render: (frame: TerminalFrame) => void | PromiseLike<void>;
  /** Bytes decoded per rendering step, 1..65536; default 4096. */
  readonly maxRenderBytes?: number;
  /** Owned, queued input bytes, 1..1048576; default 65536. */
  readonly maxPendingInputBytes?: number;
}
export interface TerminalBinding {
  /** Resolves after guest exit, decoder flush and owned stream lock cleanup. */
  readonly completed: Promise<ProcessResult>;
  /** Copies bytes before queuing. Await this promise to respect input pressure. */
  write(bytes: Uint8Array): Promise<void>;
  closeInput(): Promise<void>;
  /** Requests process termination; buffered output may still be rendered. */
  terminate(): Promise<void>;
  /** Stops the process and rendering, discards pending UI output, releases locks. */
  dispose(): Promise<void>;
}

/** Presentation only: no shell parsing, PTY, ANSI interpretation or file mutation. */
export function attachTerminal(process: ContainerProcess, options: TerminalOptions): TerminalBinding {
  const render = options.render, maxRenderBytes = options.maxRenderBytes ?? 4096;
  const maxPendingInputBytes = options.maxPendingInputBytes ?? 65536;
  if (typeof render !== 'function' || !Number.isSafeInteger(maxRenderBytes) || maxRenderBytes < 1 || maxRenderBytes > 65536
    || !Number.isSafeInteger(maxPendingInputBytes) || maxPendingInputBytes < 1 || maxPendingInputBytes > 1048576) {
    throw new ContainerError('INVALID_ARGUMENT', 'Invalid terminal renderer or buffer limits');
  }
  let input: WritableStreamDefaultWriter<Uint8Array> | undefined;
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  // Acquisition is transactional: an existing consumer must not lose its stream.
  try {
    input = process.stdin.getWriter();
    readers.push(process.stdout.getReader());
    readers.push(process.stderr.getReader());
  } catch (error) {
    for (const reader of readers) reader.releaseLock();
    input?.releaseLock(); throw error;
  }
  const writer = input;
  const controller = new AbortController();
  const stoppedError = new ContainerError('ABORTED', 'Terminal rendering stopped');
  let interrupt!: (error: unknown) => void;
  const interruption = new Promise<never>((_resolve, reject) => { interrupt = reject; });
  void interruption.catch(() => {});
  const interruptible = <T>(work: PromiseLike<T>) => Promise.race([work, interruption]);
  let stopped = false, inputClosed = false, exited = false, pendingInput = 0;
  let failure: { error: unknown } | undefined;
  let termination: Promise<void> | undefined, cleanup: Promise<void> | undefined, closingInput: Promise<void> | undefined;
  let renderTail: Promise<void> = Promise.resolve();
  const released = [false, false]; let inputReleased = false;
  const fail = (error: unknown) => { failure ??= { error }; };
  const terminate = () => {
    if (exited) return Promise.resolve();
    try { return termination ??= Promise.resolve(process.terminate()); }
    catch (error) { return termination ??= Promise.reject(error); }
  };
  const releaseReader = (index: number) => {
    if (!released[index]) { readers[index]!.releaseLock(); released[index] = true; }
  };
  const clean = (stopProcess: boolean): Promise<void> => {
    if (cleanup) return cleanup;
    let resolveCleanup!: () => void, rejectCleanup!: (error: unknown) => void;
    cleanup = new Promise<void>((resolve, reject) => { resolveCleanup = resolve; rejectCleanup = reject; });
    stopped = true; inputClosed = true;
    controller.abort(); interrupt(stoppedError);
    // Stop the guest before waiting for a blocked input write or output reader.
    const terminated = stopProcess ? terminate() : Promise.resolve();
    void (async () => {
      const results = await Promise.allSettled([
        terminated, writer.abort(stoppedError),
        ...readers.map((reader, index) => released[index] ? Promise.resolve() : reader.cancel(stoppedError))
      ]);
      for (let index = 0; index < readers.length; index++) releaseReader(index);
      if (!inputReleased) { writer.releaseLock(); inputReleased = true; }
      // Cancelling an already errored stream may reject. A failed process stop
      // is different: surface it instead of claiming that disposal completed.
      if (results[0]!.status === 'rejected') throw results[0]!.reason;
    })().then(resolveCleanup, rejectCleanup);
    return cleanup;
  };
  const present = async (channel: TerminalFrame['channel'], text: string) => {
    if (!text || stopped) return;
    const next = renderTail.then(() => {
      if (stopped) throw stoppedError;
      return render({ channel, text, signal: controller.signal });
    });
    // Each channel awaits its own step, so at most two rendering steps wait.
    renderTail = next.catch(error => {
      if (error !== stoppedError) { fail(error); void clean(true).catch(fail); }
    });
    await interruptible(next);
  };
  const drain = async (index: number, channel: TerminalFrame['channel']) => {
    const reader = readers[index]!;
    const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
    try {
      while (!stopped) {
        const { done, value } = await interruptible(reader.read());
        if (done) { await present(channel, decoder.decode()); return; }
        if (!(value instanceof Uint8Array)) throw new ContainerError('INVALID_ARGUMENT', 'Terminal output requires bytes');
        for (let offset = 0; offset < value.length && !stopped; offset += maxRenderBytes) {
          await present(channel, decoder.decode(value.subarray(offset, offset + maxRenderBytes), { stream: true }));
        }
      }
    } catch (error) {
      if (error !== stoppedError) { fail(error); void clean(true).catch(fail); }
    } finally { releaseReader(index); }
  };
  const drains = [drain(0, 'stdout'), drain(1, 'stderr')];
  const exit = process.exited.then(result => { exited = true; return result; });
  const completed = (async () => {
    try {
      const [result] = await Promise.all([exit, Promise.all(drains)]);
      await clean(false);
      if (failure) throw failure.error;
      return result;
    } catch (error) {
      fail(error);
      try { await clean(true); } catch (cleanupError) { throw new AggregateError([failure!.error, cleanupError], 'Terminal execution and cleanup failed'); }
      throw failure!.error;
    }
  })();
  // The promise remains rejectable to callers without an unhandled rejection
  // while a UI is performing its own asynchronous teardown.
  void completed.catch(() => {});
  return {
    completed,
    async write(bytes) {
      if (stopped) throw new ContainerError('DISPOSED', 'Terminal binding is closed');
      if (inputClosed) throw new ContainerError('INVALID_ARGUMENT', 'Terminal input is closed');
      if (!(bytes instanceof Uint8Array)) throw new ContainerError('INVALID_ARGUMENT', 'Terminal input requires bytes');
      if (pendingInput + bytes.length > maxPendingInputBytes) throw new ContainerError('RESOURCE_LIMIT', 'Terminal input queue exceeds its byte limit');
      if (!bytes.length) return;
      const owned = Uint8Array.from(bytes); pendingInput += owned.length;
      try { await writer.write(owned); } finally { pendingInput -= owned.length; }
    },
    closeInput() {
      if (closingInput) return closingInput;
      if (inputClosed) return Promise.resolve();
      inputClosed = true;
      return closingInput = writer.close();
    },
    terminate,
    async dispose() {
      await clean(!exited);
      await Promise.all(drains);
    }
  };
}
