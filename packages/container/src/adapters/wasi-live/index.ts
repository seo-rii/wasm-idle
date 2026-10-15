import { ContainerError } from '../../errors.js';
import { createRpcBuffer, createRpcServer } from '../../transport/rpc.js';
import type { LiveCommandAdapter } from '../types.js';
import type { CommandWorker } from '../worker-adapter.js';
import { createLiveIo } from './io.js';

export interface LiveWasiAdapterOptions {
  workerFactory?: () => CommandWorker;
  /** Capacity per stdin/stdout/stderr endpoint; 1..65536, default 65536. */
  pipeBytes?: number;
  /** Per blocked syscall deadline, including idle stdin; default two minutes. */
  maxBlockedIoMs?: number;
}

/** Isolated, dedicated-Worker execution with immediate shared filesystem visibility. */
export function createLiveWasiAdapter(options: LiveWasiAdapterOptions = {}): LiveCommandAdapter {
  const pipeBytes = options.pipeBytes ?? 65536, maxBlockedIoMs = options.maxBlockedIoMs ?? 120000;
  if (!Number.isSafeInteger(pipeBytes) || pipeBytes < 1 || pipeBytes > 65536 || !Number.isSafeInteger(maxBlockedIoMs) || maxBlockedIoMs < 1 || maxBlockedIoMs > 3600000) throw new ContainerError('INVALID_ARGUMENT', 'Invalid live channel limits');
  const workerFactory = options.workerFactory ?? (() => new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'wasm-idle-live-command' }));
  return {
    id: 'wasi-preview1-live', filesystem: 'live',
    async start(request) {
      request.signal.throwIfAborted();
      if (typeof SharedArrayBuffer !== 'function' || typeof globalThis.crossOriginIsolated === 'boolean' && !globalThis.crossOriginIsolated || typeof globalThis.isSecureContext === 'boolean' && !globalThis.isSecureContext) throw new ContainerError('UNSUPPORTED_PROFILE', 'Live WASI requires a secure, cross-origin isolated browser');
      const buffer = createRpcBuffer(request.generation);
      let readyResolve!: () => void, readyReject!: (error: unknown) => void;
      const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
      void ready.catch(() => {});
      let resultResolve!: (result: { code: number }) => void, resultReject!: (error: unknown) => void;
      const result = new Promise<{ code: number }>((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
      void result.catch(() => {});
      let worker: CommandWorker | undefined, dead = false, running = false, isReady = false;
      let disposal: Promise<void> | undefined;
      const io = createLiveIo(request.fs, request.limits, pipeBytes, (error) => fail(error), request.stdio);
      const server = createRpcServer(buffer, request.generation, io.dispatch);
      const dispose = () => disposal ??= (async () => {
        dead = true; server.stop(); io.dispose();
        request.signal.removeEventListener('abort', abort);
        readyReject(new ContainerError('ABORTED', 'Live worker stopped'));
        resultReject(new ContainerError('ABORTED', 'Live worker stopped'));
        if (worker) {
          worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
          await worker.terminate();
        }
      })();
      const fail = (error: unknown) => { readyReject(error); resultReject(error); void dispose().catch(() => {}); };
      const abort = () => fail(new ContainerError('ABORTED', 'Live command cancelled'));
      try {
        worker = workerFactory();
        worker.onmessage = ({ data }) => {
          if (dead) return;
          if (!data || data.version !== 1 || data.generation !== request.generation) { fail(new ContainerError('STARTUP_FAILED', 'Invalid live worker generation')); return; }
          if (data.type === 'io') { void server.accept(data).catch(fail); return; }
          if (data.type === 'ready' && !isReady) { isReady = true; readyResolve(); }
          else if (data.type === 'complete' && running && Number.isSafeInteger(data.code) && data.code >= 0 && data.code <= 0xffffffff) resultResolve({ code: data.code });
          else if (data.type === 'error') fail(new ContainerError(isReady ? 'STARTUP_FAILED' : 'UNSUPPORTED_PROFILE', typeof data.message === 'string' ? data.message.slice(0, 512) : 'Live worker failed'));
          else fail(new ContainerError('STARTUP_FAILED', 'Invalid live worker response'));
        };
        worker.onerror = () => fail(new ContainerError('STARTUP_FAILED', 'Live worker crashed'));
        worker.onmessageerror = () => fail(new ContainerError('STARTUP_FAILED', 'Live worker message could not be decoded'));
        request.signal.addEventListener('abort', abort, { once: true });
        if (request.signal.aborted) abort();
        if (!dead) worker.postMessage({ type: 'prepare', version: 1, generation: request.generation, command: request.command, invocation: request.invocation, limits: request.limits, buffer, maxBlockedIoMs });
        await ready;
        return {
          stdin: io.stdin, stdout: io.stdout, stderr: io.stderr,
          run() {
            if (dead || running) return Promise.reject(new ContainerError('STARTUP_FAILED', 'Live worker run is single-use'));
            running = true; worker!.postMessage({ type: 'run', version: 1, generation: request.generation }); return result;
          },
          dispose
        };
      } catch (error) { await dispose(); throw error; }
    }
  };
}
