import { MemoryFileSystem } from '../../fs/index.js';
import type { CommandAdapter } from '../types.js';
import { checkMemoryProfile } from './profile.js';
import { createWasiHost } from './host.js';

type Request = Parameters<CommandAdapter['start']>[0];
let prepared: { request: Request; module: WebAssembly.Module; fs: MemoryFileSystem } | undefined;
let preparing = false, ran = false;
const scope = globalThis as unknown as { onmessage: (event: MessageEvent) => void; postMessage: (message: unknown) => void };
scope.onmessage = async ({ data }) => {
  const generation = data?.generation;
  try {
    if (!data || data.version !== 1 || !Number.isSafeInteger(generation) || generation < 1) throw new Error('Invalid worker request');
    if (data.type === 'prepare' && !preparing) {
      preparing = true;
      const request = data as Request;
      if (!(request.command.bytes instanceof Uint8Array)) throw new Error('Expected executable bytes');
      checkMemoryProfile(request.command.bytes, request.limits.maxMemoryBytes);
      const module = await WebAssembly.compile(request.command.bytes as Uint8Array<ArrayBuffer>);
      const fs = MemoryFileSystem.fromSnapshot(request.snapshot, { maxBytes: request.limits.maxWorkspaceBytes, maxInodes: request.limits.maxWorkspaceInodes });
      const host = createWasiHost({ ...request.invocation, args: [request.command.argv0 ?? request.invocation.command, ...request.invocation.args], fs, stdin: new Uint8Array(), maxOutputBytes: request.limits.maxOutputBytes });
      try {
        for (const entry of WebAssembly.Module.imports(module)) {
          if (entry.kind !== 'function' || !(entry.module === 'wasi_snapshot_preview1' && Object.hasOwn(host.imports, entry.name) || entry.module === 'wasm_idle_process_v1' && entry.name === 'initial_cwd')) throw new Error(`Unsupported import: ${entry.module}.${entry.name}`);
        }
        if (request.invocation.cwd !== '/' && !WebAssembly.Module.imports(module).some((entry) => entry.module === 'wasm_idle_process_v1' && entry.name === 'initial_cwd')) throw new Error('A non-root cwd requires the initial_cwd guest initialization profile');
        const exports = WebAssembly.Module.exports(module);
        if (!exports.some((e) => e.name === 'memory' && e.kind === 'memory') || !exports.some((e) => e.name === '_start' && e.kind === 'function')) throw new Error('Require exported memory and _start');
      } finally { host.dispose(); }
      prepared = { request, module, fs };
      scope.postMessage({ type: 'ready', version: 1, generation });
    } else if (data.type === 'run' && prepared && !ran && generation === prepared.request.generation) {
      ran = true;
      const { request, module, fs } = prepared;
      if (!(data.stdin instanceof Uint8Array) || data.stdin.length > request.limits.maxInputBytes) throw new Error('Invalid batch stdin');
      const host = createWasiHost({ ...request.invocation, args: [request.command.argv0 ?? request.invocation.command, ...request.invocation.args], fs, stdin: data.stdin, maxOutputBytes: request.limits.maxOutputBytes });
      try {
        const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: host.imports, wasm_idle_process_v1: host.processImports });
        const result = host.run(instance);
        host.dispose();
        scope.postMessage({ type: 'complete', version: 1, generation, ...result, snapshot: fs.exportSnapshot() });
      } finally { host.dispose(); }
    } else throw new Error('Invalid worker state');
  } catch (error) {
    scope.postMessage({ type: 'error', version: 1, generation, message: error instanceof Error ? error.message : 'Command failed' });
  }
};
