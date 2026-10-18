import { createRpcClient } from '../../transport/rpc.js';
import type { LiveCommandAdapter } from '../types.js';
import { createWasiHost } from '../wasi/host.js';
import { checkMemoryProfile } from '../wasi/profile.js';
import { createRemoteFileSystem, createRemoteStdio } from './io.js';

type Request = Parameters<LiveCommandAdapter['start']>[0] & { buffer: SharedArrayBuffer; maxBlockedIoMs: number; openStdio: readonly number[] };
let prepared: { request: Request; module: WebAssembly.Module; host: ReturnType<typeof createWasiHost> } | undefined;
let preparing = false, ran = false;
const scope = globalThis as unknown as { onmessage: (event: MessageEvent) => void; postMessage: (message: unknown) => void };
scope.onmessage = async ({ data }) => {
  const generation = data?.generation;
  try {
    if (!data || data.version !== 1 || !Number.isSafeInteger(generation) || generation < 1) throw new Error('Invalid live worker request');
    if (data.type === 'prepare' && !preparing) {
      preparing = true;
      const request = data as Request;
      if (!(request.command.bytes instanceof Uint8Array)) throw new Error('Expected executable bytes');
      checkMemoryProfile(request.command.bytes, request.limits.maxMemoryBytes);
      const module = await WebAssembly.compile(request.command.bytes as Uint8Array<ArrayBuffer>);
      const call = createRpcClient(request.buffer, generation, (notice) => scope.postMessage(notice), request.maxBlockedIoMs);
      const host = createWasiHost({ ...request.invocation, args: [request.command.argv0 ?? request.invocation.command, ...request.invocation.args], fs: createRemoteFileSystem(call), stdio: createRemoteStdio(call, request.openStdio), stdin: new Uint8Array(), maxOutputBytes: request.limits.maxOutputBytes });
      try {
        const imports = WebAssembly.Module.imports(module);
        for (const entry of imports) {
          if (entry.kind !== 'function' || !(entry.module === 'wasi_snapshot_preview1' && Object.hasOwn(host.imports, entry.name) || entry.module === 'wasm_idle_process_v1' && entry.name === 'initial_cwd' || entry.module === 'wasm_idle_fs_v1' && Object.hasOwn(host.filesystemImports, entry.name))) throw new Error(`Unsupported import: ${entry.module}.${entry.name}`);
        }
        if (request.invocation.cwd !== '/' && !imports.some((entry) => entry.module === 'wasm_idle_process_v1' && entry.name === 'initial_cwd')) throw new Error('A non-root cwd requires the initial_cwd guest initialization profile');
        const exports = WebAssembly.Module.exports(module);
        if (!exports.some((entry) => entry.name === 'memory' && entry.kind === 'memory') || !exports.some((entry) => entry.name === '_start' && entry.kind === 'function')) throw new Error('Require exported memory and _start');
      } catch (error) { host.dispose(); throw error; }
      prepared = { request, module, host };
      scope.postMessage({ type: 'ready', version: 1, generation });
    } else if (data.type === 'run' && prepared && !ran && generation === prepared.request.generation) {
      ran = true;
      const { module, host } = prepared;
      try {
        const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: host.imports, wasm_idle_process_v1: host.processImports, wasm_idle_fs_v1: host.filesystemImports });
        const { code } = host.run(instance);
        host.dispose();
        scope.postMessage({ type: 'complete', version: 1, generation, code });
      } finally { host.dispose(); }
    } else throw new Error('Invalid live worker state');
  } catch (error) {
    scope.postMessage({ type: 'error', version: 1, generation, message: error instanceof Error ? error.message : 'Live command failed' });
  }
};
