import { createLlvmToolHost, createLlvmToolHostFromServices, type CreateLlvmToolHostOptions, type LlvmToolHost, type LlvmToolExecutable, type LlvmToolModuleService } from '@wasm-idle/llvm-core/tool-host';
import { createRpcClient } from '../../transport/rpc.js';
import type { LiveStartRequest } from '../live-worker.js';
import { createWasiHost } from '../wasi/host.js';
import { checkMemoryProfile } from '../wasi/profile.js';
import { createRemoteFileSystem, createRemoteStdio } from '../wasi-live/io.js';
import type { validateClangOptions } from '../clang/configuration.js';
import { createToolStdio } from './stdio.js';

type Request = Omit<LiveStartRequest, 'command'> & { command: Omit<LiveStartRequest['command'], 'bytes'> & { bytes?: Uint8Array };
  buffer: SharedArrayBuffer; maxBlockedIoMs: number; openStdio: readonly number[];
  configuration: ReturnType<typeof validateClangOptions> & { services?: Readonly<Record<LlvmToolExecutable, LlvmToolModuleService>>; linker?: Uint8Array } };
let prepared: { request: Request; toolHost: LlvmToolHost } | undefined;
let preparing = false, ran = false;
const scope = globalThis as unknown as { onmessage: (event: MessageEvent) => void; postMessage: (message: unknown) => void };
scope.onmessage = async ({ data }) => {
  const generation = data?.generation;
  try {
    if (!data || data.version !== 1 || !Number.isSafeInteger(generation) || generation < 1) throw new Error('Invalid live LLVM request');
    if (data.type === 'prepare' && !preparing) {
      preparing = true;
      const request = data as Request;
      if (request.configuration.services) {
        const services = request.configuration.services;
        const profile = JSON.stringify(['container-live-llvm-v1', request.limits.maxMemoryBytes, request.invocation.cwd !== '/']);
        const assetLimit = Math.max(request.limits.maxWorkspaceBytes, services.clang?.bytes, services['wasm-ld']?.bytes);
        for (const [executable, expected] of [['clang', request.configuration.clangSha256], ['wasm-ld', request.configuration.linkerSha256]] as const) {
          const source = services[executable];
          if (!source || source.sha256 !== expected || source.identity !== `${profile}:${executable}` || source.compileKey !== 'native-default-v1' ||
              source.maxAssetBytes !== assetLimit) throw new Error('LLVM module service does not match the pinned invocation profile');
        }
        if (request.command.bytes !== undefined || request.configuration.linker !== undefined) throw new Error('Module service preparation must omit executable byte buffers');
      } else {
        for (const bytes of [request.command.bytes, request.configuration.linker]) {
          if (!(bytes instanceof Uint8Array)) throw new Error('Legacy LLVM preparation requires pinned byte inputs');
          checkMemoryProfile(bytes, request.limits.maxMemoryBytes);
        }
      }
      const call = createRpcClient(request.buffer, generation, notice => scope.postMessage(notice), request.maxBlockedIoMs);
      const fs = createRemoteFileSystem(call), stdio = createToolStdio(createRemoteStdio(call, request.openStdio));
      const probe = createWasiHost({ ...request.invocation, args: [], fs, stdin: new Uint8Array(), maxOutputBytes: 0 });
      const importNames = new Set(Object.keys(probe.imports)); probe.dispose();
      const hostOptions: Omit<CreateLlvmToolHostOptions, 'tools'> = {
        linkerPaths: [request.configuration.linkerPath], compilerPaths: request.configuration.compilerPaths, allowClangCc1: true,
        validateModule(_executable, module) {
          const imports = WebAssembly.Module.imports(module), exports = WebAssembly.Module.exports(module);
          if (imports.some(entry => entry.kind !== 'function' || !(entry.module === 'wasi_snapshot_preview1' && importNames.has(entry.name) ||
            entry.module === 'wasm_idle_process_v1' && entry.name === 'initial_cwd' || entry.module === 'wasm_idle_tool_host' && entry.name === 'exec_v1'))) {
            throw new Error('Unsupported live LLVM import profile');
          }
          if (!exports.some(entry => entry.name === 'memory' && entry.kind === 'memory') || !exports.some(entry => entry.name === '_start' && entry.kind === 'function')) throw new Error('LLVM tools require memory and _start');
          if (request.invocation.cwd !== '/' && !imports.some(entry => entry.module === 'wasm_idle_process_v1' && entry.name === 'initial_cwd')) throw new Error('LLVM requires producer initial_cwd initialization');
        },
        createBindings(context) {
          const binding = stdio.bind(context.depth);
          try {
            const host = createWasiHost({ fs, args: context.argv, cwd: context.cwd, env: context.env, stdin: new Uint8Array(), stdio: binding.stdio, maxOutputBytes: request.limits.maxOutputBytes });
            return {
              imports: { wasi_snapshot_preview1: host.imports, wasm_idle_process_v1: host.processImports }, run: host.run,
              dispose() { try { host.dispose(); } finally { binding.dispose(); } }
            };
          } catch (error) { binding.dispose(); throw error; }
        }
      };
      const toolHost = request.configuration.services
        ? await createLlvmToolHostFromServices({ ...hostOptions, services: request.configuration.services, timeoutMs: request.maxBlockedIoMs })
        : await createLlvmToolHost({ ...hostOptions, tools: {
          clang: { bytes: request.command.bytes!, sha256: request.configuration.clangSha256 },
          'wasm-ld': { bytes: request.configuration.linker!, sha256: request.configuration.linkerSha256 }
        } });
      prepared = { request, toolHost };
      scope.postMessage({ type: 'ready', version: 1, generation });
    } else if (data.type === 'run' && prepared && !ran && generation === prepared.request.generation) {
      ran = true;
      const { request, toolHost } = prepared;
      try {
        const result = toolHost.run({ executable: 'clang', argv: [request.command.argv0 ?? request.invocation.command, ...request.invocation.args], cwd: request.invocation.cwd, env: request.invocation.env });
        scope.postMessage({ type: 'complete', version: 1, generation, code: result.code });
      } finally { toolHost.dispose(); }
    } else throw new Error('Invalid live LLVM worker state');
  } catch (error) {
    scope.postMessage({ type: 'error', version: 1, generation, message: error instanceof Error ? error.message : 'Live LLVM failed' });
  }
};
