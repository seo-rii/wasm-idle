import { ContainerError } from '../../errors.js';
import { createLiveWorkerAdapter, type LiveWorkerOptions } from '../live-worker.js';
import { validateClangOptions, type ClangAdapterOptions } from '../clang/configuration.js';
import { createWasiHost } from '../wasi/host.js';
import { createCompilerOutputs } from './outputs.js';

export interface LiveClangAdapterOptions extends ClangAdapterOptions, Omit<LiveWorkerOptions, 'workerFactory'> {}

/** Optional isolated LLVM profile; writes are live and are never rolled back on cancellation. */
export function createLiveClangAdapter(options: LiveClangAdapterOptions) {
  const configuration = validateClangOptions(options);
  let active = false;
  return createLiveWorkerAdapter({
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
      active = true;
      return {
        configuration: { ...configuration, linker },
        onFileChange: outputs.record,
        complete: (code, signal) => configuration.executableOutputProfile === 'wasi-preview1-process'
          ? outputs.qualify(code, imports, request.limits.maxMemoryBytes, signal) : undefined,
        dispose() { outputs.dispose(); active = false; }
      };
    }
  });
}
