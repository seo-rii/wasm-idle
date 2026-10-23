import { ContainerError } from '../../errors.js';
import { createLiveWorkerAdapter, type LiveWorkerOptions } from '../live-worker.js';
import { validateClangOptions, type ClangAdapterOptions } from '../clang/configuration.js';
import { createWasiHost } from '../wasi/host.js';
import { createCompilerOutputs } from './outputs.js';
import { RuntimeAssetCache, createPreparedRuntimeWasmModuleService, type RuntimeWasmModuleService } from '@wasm-idle/core';
import { checkMemoryProfile } from '../wasi/profile.js';
import type { LlvmToolExecutable, LlvmToolModuleService } from '@wasm-idle/llvm-core/tool-host';
import type { LiveCommandAdapter } from '../types.js';

export interface LiveClangAdapterOptions extends ClangAdapterOptions, Omit<LiveWorkerOptions, 'workerFactory'> {
  /** Retained compiled modules charged by logical source bytes; default 256 MiB, 0 disables retention. */
  readonly moduleCacheBytes?: number;
  /** Owner module services require a matching Worker. Defaults on only for the built-in Worker. */
  readonly moduleServices?: boolean;
}
export interface LiveClangAdapter extends LiveCommandAdapter {
  clearModuleCache(): void;
}

/** Optional isolated LLVM profile; writes are live and are never rolled back on cancellation. */
export function createLiveClangAdapter(options: LiveClangAdapterOptions): LiveClangAdapter {
  const configuration = validateClangOptions(options);
  const moduleServices = options.moduleServices ?? options.workerFactory === undefined;
  if (typeof moduleServices !== 'boolean') throw new ContainerError('INVALID_ARGUMENT', 'moduleServices must be boolean');
  const cacheBytes = options.moduleCacheBytes ?? 256 * 1024 * 1024;
  let moduleCache = new RuntimeAssetCache(cacheBytes, 2);
  let preparing = 0;
  const pending = new Set<() => void>();
  // Native hashing/compilation cannot be cancelled. Retain slots until native
  // work settles, and discard cancelled queued requests before they start it.
  const acquire = (signal: AbortSignal) => new Promise<() => void>((resolve, reject) => {
    const abort = () => { pending.delete(start); signal.removeEventListener('abort', abort); reject(signal.reason); };
    const start = () => {
      pending.delete(start); signal.removeEventListener('abort', abort);
      if (signal.aborted) { reject(signal.reason); return; }
      preparing++;
      let released = false;
      resolve(() => {
        if (released) return; released = true; preparing--;
        while (preparing < 2 && pending.size) pending.values().next().value!();
      });
    };
    if (signal.aborted) { reject(signal.reason); return; }
    if (preparing < 2) start();
    else { pending.add(start); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); }
  });
  let active = false;
  const adapter = createLiveWorkerAdapter({
    id: 'llvm-clang-tool-host-live-v1', pipeBytes: options.pipeBytes, maxBlockedIoMs: options.maxBlockedIoMs,
    workerFactory: options.workerFactory ?? (() => new Worker(new URL('./worker.js', import.meta.url), { type: 'module', name: 'wasm-idle-live-clang' })),
    configure(request) {
      if (active) throw new ContainerError('RESOURCE_LIMIT', 'One live LLVM command may use this adapter at a time');
      const fs = request.fs;
      for (const path of [configuration.linkerPath, ...configuration.compilerPaths]) {
        const stat = fs.stat(path);
        if (!fs.isReadonly(path) || stat.type !== 'file' || !(stat.mode & 0o111) || stat.command) {
          throw new ContainerError('INVALID_ARGUMENT', 'LLVM paths must name actual readonly executable files');
        }
      }
      const linker = fs.readFile(configuration.linkerPath);
      const probe = createWasiHost({ ...request.invocation, args: [], fs, stdin: new Uint8Array(), maxOutputBytes: 0 });
      const imports = new Set(Object.keys(probe.imports)); probe.dispose();
      const outputs = createCompilerOutputs(fs, request.limits.maxWorkspaceInodes);
      const profile = JSON.stringify(['container-live-llvm-v1', request.limits.maxMemoryBytes, request.invocation.cwd !== '/']);
      const compileKey = 'native-default-v1';
      const maxAssetBytes = Math.max(request.limits.maxWorkspaceBytes, request.command.bytes.length, linker.length);
      const services: Partial<Record<LlvmToolExecutable, LlvmToolModuleService>> = {};
      const endpoints: RuntimeWasmModuleService[] = [];
      try {
        for (const [executable, bytes, sha256] of [
          ['clang', request.command.bytes, configuration.clangSha256],
          ['wasm-ld', linker, configuration.linkerSha256]
        ] as const) {
          checkMemoryProfile(bytes, request.limits.maxMemoryBytes);
          if (!moduleServices) continue;
          const endpoint = createPreparedRuntimeWasmModuleService({ bytes, receipt: { bytes: bytes.length, sha256 },
            cache: moduleCache, identity: `${profile}:${executable}`, compileKey, maxAssetBytes, signal: request.signal,
            acquireVerificationSlot: acquire,
            // Validate the owned snapshot before compiling; a cache hit names a previously
            // admitted module with the same bytes, memory cap and compilation profile.
            async compile(owned, signal = request.signal) {
              checkMemoryProfile(owned, request.limits.maxMemoryBytes);
              const release = await acquire(signal);
              try { signal.throwIfAborted(); return await WebAssembly.compile(owned); }
              finally { release(); }
            }
          });
          endpoints.push(endpoint);
          services[executable] = { port: endpoint.port, bytes: bytes.length, sha256, identity: `${profile}:${executable}`, compileKey, maxAssetBytes };
        }
      } catch (error) { for (const endpoint of endpoints) endpoint.close(); outputs.dispose(); throw error; }
      active = true;
      return {
        configuration: moduleServices ? { ...configuration, services } : { ...configuration, linker },
        ...(moduleServices ? {
          command: { adapter: request.command.adapter, argv0: request.command.argv0 },
          transfer: endpoints.map(endpoint => endpoint.port),
          fallback() {
            for (const endpoint of endpoints) endpoint.close();
            return { command: request.command, configuration: { ...configuration, linker } };
          }
        } : {}),
        onFileChange: outputs.record,
        complete: (code, signal) => configuration.executableOutputProfile === 'wasi-preview1-process'
          ? outputs.qualify(code, imports, request.limits.maxMemoryBytes, signal) : undefined,
        dispose() { for (const endpoint of endpoints) endpoint.close(); outputs.dispose(); active = false; }
      };
    }
  });
  return { ...adapter,
    /** Explicit owner cleanup; sharing/disposing a Container never retires another owner's adapter. */
    clearModuleCache() { moduleCache.dispose(); moduleCache = new RuntimeAssetCache(cacheBytes, 2); }
  };
}
