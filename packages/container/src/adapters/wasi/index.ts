import { ContainerError } from '../../errors.js';
import type { CommandAdapter, RuntimeCompletion } from '../types.js';

export interface CommandWorker {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  terminate(): void | Promise<unknown>;
}
export interface WasiAdapterOptions {
  /** Explicit trusted host factory, useful for bundlers and Node contract tests. */
  workerFactory?: () => CommandWorker;
}

export function createWasiAdapter(options: WasiAdapterOptions = {}): CommandAdapter {
  const workerFactory = options.workerFactory ?? (() => new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'wasm-idle-command' }));
  return {
    id: 'wasi-preview1', filesystem: 'snapshot',
    async start(request) {
      request.signal.throwIfAborted();
      const worker = workerFactory();
      let readyResolve!: () => void, readyReject!: (error: unknown) => void;
      const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
      let resultResolve!: (result: RuntimeCompletion) => void, resultReject!: (error: unknown) => void;
      const result = new Promise<RuntimeCompletion>((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
      // Startup can fail before anyone calls run(). Preserve rejection without unhandled noise.
      void result.catch(() => {});
      let dead = false, running = false, isReady = false;
      let disposal: Promise<void> | undefined;
      const dispose = () => disposal ??= (async () => {
        dead = true;
        request.signal.removeEventListener('abort', abort);
        worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
        readyReject(new ContainerError('ABORTED', 'Worker stopped'));
        resultReject(new ContainerError('ABORTED', 'Worker stopped'));
        await worker.terminate();
      })();
      const fail = (error: unknown) => { readyReject(error); resultReject(error); void dispose().catch(() => {}); };
      const abort = () => fail(new ContainerError('ABORTED', 'Command cancelled', { cause: request.signal.reason }));
      worker.onmessage = ({ data }) => {
        if (dead) return;
        if (!data || data.version !== 1 || data.generation !== request.generation) {
          fail(new ContainerError('STARTUP_FAILED', 'Invalid worker channel generation')); return;
        }
        if (data.type === 'ready' && !isReady) { isReady = true; readyResolve(); }
        else if (data.type === 'complete' && running && Number.isSafeInteger(data.code) && data.code >= 0 && data.stdout instanceof Uint8Array && data.stderr instanceof Uint8Array && data.stdout.length + data.stderr.length <= request.limits.maxOutputBytes) {
          resultResolve(data);
        } else if (data.type === 'error') {
          fail(new ContainerError(isReady ? 'RESOURCE_LIMIT' : 'UNSUPPORTED_PROFILE', typeof data.message === 'string' ? data.message.slice(0, 512) : 'Worker failure'));
        } else fail(new ContainerError('STARTUP_FAILED', 'Invalid worker response'));
      };
      worker.onerror = () => fail(new ContainerError('STARTUP_FAILED', 'Command worker crashed'));
      worker.onmessageerror = () => fail(new ContainerError('STARTUP_FAILED', 'Command message could not be decoded'));
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) abort();
      try {
        if (!dead) worker.postMessage({ type: 'prepare', version: 1, generation: request.generation, command: request.command, invocation: { command: request.invocation.command, args: request.invocation.args, cwd: request.invocation.cwd, env: request.invocation.env }, snapshot: request.snapshot, limits: request.limits });
        await ready;
        return {
          run(stdin) {
            if (dead || running) return Promise.reject(new ContainerError('STARTUP_FAILED', 'Worker run is single-use'));
            running = true;
            worker.postMessage({ type: 'run', version: 1, generation: request.generation, stdin });
            return result;
          },
          dispose
        };
      } catch (error) { await dispose(); throw error; }
    }
  };
}
