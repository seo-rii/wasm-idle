import { clearRuntimeAssetCache } from '@wasm-idle/core';
import { createContainer, createContainerPackageManager, validateDistribution } from '@wasm-idle/container';
import { createLiveWasiAdapter } from '@wasm-idle/container/adapters/wasi-live';
import { serveContainerOwner } from '@wasm-idle/container/adapters/wasix';
import { openPersistentWorkspace } from '@wasm-idle/container/persistence';
import { createWorkspaceSaveController } from '@wasm-idle/container/workspace';

/** Injected by the local builder, independently of fetched manifest bytes. */
const lock = __CONTAINER_FIXTURE_LOCK__;
const cache = Object.freeze({ enabled: true, namespace: 'container-workbench-fixture', version: lock.assetSha256, storageReserveBytes: 0, maxBytes: 8 * 1024 * 1024 });

/**
 * Real WASI byte-guest profile, for a small reproducible UI example.
 * A Bash application supplies its own statically imported owner entry instead.
 */
export async function serveFixtureOwner(port, settings = {}) {
  const id = settings.workspaceId ?? 'container-workbench';
  if (!/^[a-zA-Z0-9._-]{1,100}$/u.test(id)) throw new Error('Invalid workspace identifier');
  if (!crossOriginIsolated) throw new Error('This example requires cross-origin isolation');
  const response = await fetch(lock.manifestURL, { credentials: 'omit', redirect: 'error', cache: 'no-store' });
  if (response.status !== 200 || response.url !== lock.manifestURL || response.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new Error('Fixture distribution response was not the pinned JSON resource');
  const distribution = await validateDistribution({
    bytes: new Uint8Array(await response.arrayBuffer()), expectedSha256: lock.manifestSha256,
    adapterIds: ['wasi-preview1-live'], allowedAssetURLs: [lock.assetURL]
  });
  const packages = createContainerPackageManager({ distribution, persistentCache: cache, capabilities: ['wasi-preview1'] });
  let workspace, save, container;
  try {
    workspace = await openPersistentWorkspace({ id, maxBytes: 16 * 1024 * 1024, maxInodes: 2048, ...(settings.fault ? { fault: settings.fault } : {}) });
    try { workspace.fs.stat('/workspace/main.c'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      workspace.fs.writeFile('/workspace/main.c', new TextEncoder().encode('#include <stdio.h>\nint main(void) { puts("hello"); return 0; }\n'));
    }
    const adapter = createLiveWasiAdapter({ workerFactory: () => new Worker(new URL('./live-worker.mjs', import.meta.url), { type: 'module', name: 'container-workbench-wasi' }) });
    container = createContainer({ workspace, packages, adapters: [adapter], maxProcesses: 2, maxMemoryBytes: 8 * 1024 * 1024 });
    save = createWorkspaceSaveController(workspace, { autosave: false, delayMs: 100, maxWaitMs: 1000 });
    return serveContainerOwner(port, {
      container, save,
      async startShell(options, signal) {
        const process = await container.spawn('byte-guest', options.args ?? ['echo'], { cwd: options.cwd ?? '/workspace', env: options.env, signal });
        return { ...process, interrupt() { void process.terminate().catch(() => {}); return 1; }, dispose: () => process.terminate() };
      },
      clearAssetCache: () => clearRuntimeAssetCache({ cache }),
      async dispose() { await packages.dispose(); await workspace.dispose(); }
    });
  } catch (error) {
    await save?.dispose(); await container?.dispose(); await packages.dispose(); await workspace?.dispose();
    throw error;
  }
}
