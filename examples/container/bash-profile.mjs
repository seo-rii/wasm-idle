// Trusted application configuration shared by the workbench owner and the real
// browser acceptance owner. The caller statically imports the pinned SDK.
import {
  createContainer, createContainerPackageManager, createVerifiedAssetLoader,
  validateDistribution, extractTarPackage
} from '@wasm-idle/container';
import { createClangAdapter } from '@wasm-idle/container/adapters/clang';
import { createLiveClangAdapter } from '@wasm-idle/container/adapters/clang-live';
import { createLiveWasiAdapter } from '@wasm-idle/container/adapters/wasi-live';
import { createWasixShellSession, installWasixWorkerGroup } from '@wasm-idle/container/adapters/wasix';
import { selectClangProfile } from './clang-profile.mjs';

export const BASH_BIN = '/usr/local/bin';
export const BASH_SYSROOT = '/usr/share/wasm-sysroot';
export const BASH_APPLETS = Object.freeze(['cat', 'cp', 'grep', 'mkdir', 'mv', 'rm']);
const TOOLCHAIN = '/opt/toolchains/llvm';
const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');

/**
 * Config is trusted application input, never a guest message or remote code URL.
 * It contains manifest/manifestSha256/assetURLs; sdkUrl/sdkWorkerUrl; liveWorkerUrl/
 * clangWorkerUrl; sdkAsset/shellAsset; bashWasmSha256; memory; clangSha256/
 * linkerSha256; cacheNamespace; and an optional commandTimeoutMs/maxWorkers.
 * clangFilesystem is snapshot by default, or an explicit live application profile.
 * The injecting host retains the lifetime of an optional persistence workspace.
 */
export async function createBashProfile({ config, sdk, workspace, fetch: fetcher, onRecord, onInvocation }) {
  const clangProfile = selectClangProfile(config.clangFilesystem);
  const distribution = await validateDistribution({
    bytes: new TextEncoder().encode(config.manifest), expectedSha256: config.manifestSha256,
    adapterIds: ['wasi-preview1-live', clangProfile.adapterId], allowedAssetURLs: config.assetURLs
  });
  const cache = Object.freeze({ enabled: true, namespace: config.cacheNamespace, version: config.manifestSha256, storageReserveBytes: 0 });
  const assetOptions = { distribution, fetch: fetcher, persistentCache: cache, maxCachedBytes: 192 * 1024 * 1024 };
  const manager = createContainerPackageManager({ ...assetOptions, capabilities: ['wasi-preview1', 'llvm-tool-host-exec-v1'] });
  const shellAssets = createVerifiedAssetLoader({ ...assetOptions, maxCachedBytes: 64 * 1024 * 1024 });
  let workers, container;
  try {
    workers = installWasixWorkerGroup({ maxWorkers: config.maxWorkers ?? 32 });
    container = createContainer({
      workspace, packages: manager, maxBytes: workspace?.fs.maxBytes ?? 256 * 1024 * 1024,
      adapters: [
        createLiveWasiAdapter({ maxBlockedIoMs: 120000, workerFactory: () => new Worker(config.liveWorkerUrl, { type: 'module' }) }),
        (clangProfile.filesystem === 'live' ? createLiveClangAdapter : createClangAdapter)({
          clangSha256: config.clangSha256, linkerSha256: config.linkerSha256, linkerPath: `${TOOLCHAIN}/bin/wasm-ld`,
          compilerPaths: [`${TOOLCHAIN}/bin/llvm`],
          executableOutputProfile: 'wasi-preview1-process', workerFactory: () => new Worker(config.clangWorkerUrl, { type: 'module' })
        })
      ],
      artifactAdapter: 'wasi-preview1-live', maxMemoryBytes: 2 ** 32, maxProcesses: 8
    });
  } catch (error) {
    await workers?.dispose(); await manager.dispose(); await shellAssets.dispose(); throw error;
  }
  const routes = {
    ...Object.fromEntries(BASH_APPLETS.map(name => [`${BASH_BIN}/${name}`, { command: name }])),
    [`${BASH_BIN}/clang`]: { command: 'clang', stdio: clangProfile.stdio },
    [`${BASH_BIN}/wasm-run`]: { command: 'wasm-run' }
  };
  let sysroot, session, starting, disposal;
  const stop = new AbortController();
  const prepareCommand = async (invocation, signal) => {
    onInvocation?.(invocation);
    if (invocation.path !== `${BASH_BIN}/clang` || sysroot) return;
    // Each consumer has its own signal. The verified asset loader shares only
    // fetches, so cancelling one preparation cannot cancel another consumer.
    const prepared = await manager.prepare('llvm', { signal });
    const archive = prepared.packages.find(pkg => pkg.id === 'llvm')?.files.find(file => file.path === 'sysroot.tar')?.bytes;
    if (!archive) throw new Error('Pinned LLVM profile has no sysroot archive');
    const entries = extractTarPackage(archive);
    const metadata = { sha256: await digest(archive), entries: entries.length, files: entries.filter(file => file.type === 'file').length };
    signal.throwIfAborted();
    if (!sysroot) { container.fs.mountReadonly(BASH_SYSROOT, entries); sysroot = metadata; }
  };
  return Object.freeze({
    container, manager, shellAssets, workers, cache, clangFilesystem: clangProfile.filesystem,
    inspectSysroot: () => sysroot ?? null,
    startShell(options = {}, signal) {
      if (starting || stop.signal.aborted) return Promise.reject(new Error('The dedicated Bash owner has already started or retired'));
      starting = createWasixShellSession({
        container, sdk, workers, assets: shellAssets,
        sdkAsset: config.sdkAsset ?? { packageId: 'shell', assetId: 'sdk' },
        shellAsset: config.shellAsset ?? { packageId: 'shell', assetId: 'bash' },
        shellWasmSha256: config.bashWasmSha256, sdkUrl: config.sdkUrl, workerUrl: config.sdkWorkerUrl,
        memory: config.memory, routes, moduleDirectories: ['/workspace'], timeoutMs: config.commandTimeoutMs,
        args: options.args ?? ['--noprofile', '--norc'], cwd: options.cwd ?? '/workspace',
        env: { PATH: `${BASH_BIN}:/usr/bin:/bin`, HOME: '/workspace', LANG: 'C', ...options.env },
        signal: signal ? AbortSignal.any([signal, stop.signal]) : stop.signal,
        prepareCommand, onRecord
      }).then(value => { session = value; return value; });
      return starting;
    },
    dispose() {
      return disposal ??= (async () => {
        stop.abort();
        const errors = [];
        for (const cleanup of [() => workers.dispose(), () => session?.dispose(), () => container.dispose(), () => manager.dispose(), () => shellAssets.dispose()]) {
          try { await cleanup(); } catch (error) { errors.push(error); }
        }
        await starting?.catch(() => {});
        if (errors.length) throw new AggregateError(errors, 'Bash profile cleanup failed');
      })();
    }
  });
}
