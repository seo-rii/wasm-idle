import { createLlvmToolHost, type LlvmToolHost } from '@wasm-idle/llvm-core/tool-host';
import { MemoryFileSystem } from '../../fs/index.js';
import type { SnapshotCommandAdapter } from '../types.js';
import type { ClangAdapterOptions } from './index.js';
import { createWasiHost } from '../wasi/host.js';
import { checkMemoryProfile } from '../wasi/profile.js';
import { createBatchStdio, type BatchStdio } from '../wasi/stdio.js';

type Request = Parameters<SnapshotCommandAdapter['start']>[0] & { configuration: ClangAdapterOptions };
let prepared: { request: Request; fs: MemoryFileSystem; toolHost: LlvmToolHost } | undefined;
let preparing = false, ran = false;
let stdio: BatchStdio | undefined;
const scope = globalThis as unknown as { onmessage: (event: MessageEvent) => void; postMessage: (message: unknown) => void };
scope.onmessage = async ({ data }) => {
  const generation = data?.generation;
  try {
    if (!data || data.version !== 1 || !Number.isSafeInteger(generation) || generation < 1) throw new Error('Invalid worker request');
    if (data.type === 'prepare' && !preparing) {
      preparing = true;
      const request = data as Request;
      const fs = MemoryFileSystem.fromSnapshot(request.snapshot, { maxBytes: request.limits.maxWorkspaceBytes, maxInodes: request.limits.maxWorkspaceInodes });
      const linker = fs.readFile(request.configuration.linkerPath);
      const linkerPath = fs.realpath(request.configuration.linkerPath);
      const mount = [...request.snapshot.mounts].sort((a, b) => b.path.length - a.path.length).find((mount) => linkerPath === mount.path || linkerPath.startsWith(mount.path === '/' ? '/' : `${mount.path}/`));
      if (!mount?.readonly) throw new Error('Linker must be mounted readonly');
      for (const bytes of [request.command.bytes, linker]) checkMemoryProfile(bytes, request.limits.maxMemoryBytes);
      const probe = createWasiHost({ ...request.invocation, fs, stdin: new Uint8Array(), maxOutputBytes: request.limits.maxOutputBytes });
      const importNames = new Set(Object.keys(probe.imports)); probe.dispose();
      const toolHost = await createLlvmToolHost({
        tools: {
          clang: { bytes: request.command.bytes, sha256: request.configuration.clangSha256 },
          'wasm-ld': { bytes: linker, sha256: request.configuration.linkerSha256 }
        },
        linkerPaths: [request.configuration.linkerPath],
        validateModule(executable, module) {
          for (const entry of WebAssembly.Module.imports(module)) {
            if (entry.kind !== 'function' || !(
              entry.module === 'wasi_snapshot_preview1' && importNames.has(entry.name) ||
              entry.module === 'wasm_idle_process_v1' && entry.name === 'initial_cwd' ||
              executable === 'clang' && entry.module === 'wasm_idle_tool_host' && entry.name === 'exec_v1'
            )) throw new Error(`Unsupported LLVM import: ${entry.module}.${entry.name}`);
          }
          const exports = WebAssembly.Module.exports(module);
          if (!exports.some((e) => e.name === 'memory' && e.kind === 'memory') || !exports.some((e) => e.name === '_start' && e.kind === 'function')) throw new Error('LLVM tools require exported memory and _start');
          if (request.invocation.cwd !== '/' && !WebAssembly.Module.imports(module).some((entry) => entry.module === 'wasm_idle_process_v1' && entry.name === 'initial_cwd')) throw new Error('A non-root cwd requires LLVM producer initial_cwd initialization');
        },
        createBindings(context) {
          if (!stdio) throw new Error('Tool execution requires prepared batch input');
          const host = createWasiHost({ fs, args: context.argv, cwd: context.cwd, env: context.env, stdin: new Uint8Array(), stdio, maxOutputBytes: request.limits.maxOutputBytes });
          return { imports: { wasi_snapshot_preview1: host.imports, wasm_idle_process_v1: host.processImports }, run: host.run, dispose: host.dispose };
        }
      });
      prepared = { request, fs, toolHost };
      scope.postMessage({ type: 'ready', version: 1, generation });
    } else if (data.type === 'run' && prepared && !ran && generation === prepared.request.generation) {
      ran = true;
      const { request, fs, toolHost } = prepared;
      if (!(data.stdin instanceof Uint8Array) || data.stdin.length > request.limits.maxInputBytes) throw new Error('Invalid batch stdin');
      stdio = createBatchStdio(data.stdin, request.limits.maxOutputBytes);
      try {
        const result = toolHost.run({ executable: 'clang', argv: [request.command.argv0 ?? request.invocation.command, ...request.invocation.args], cwd: request.invocation.cwd, env: request.invocation.env });
        scope.postMessage({ type: 'complete', version: 1, generation, ...result, ...stdio.capture(), snapshot: fs.exportSnapshot() });
      } finally { toolHost.dispose(); }
    } else throw new Error('Invalid worker state');
  } catch (error) {
    scope.postMessage({ type: 'error', version: 1, generation, message: error instanceof Error ? error.message : 'LLVM tool failed' });
  }
};
