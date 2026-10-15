// Trusted local application code: the SDK is a fixed static import of the verified package.
import * as sdk from '@wasm-idle/pinned-wasix-sdk';
import { clearRuntimeAssetCache } from '@wasm-idle/core';
import { serveContainerOwner } from '@wasm-idle/container/adapters/wasix';
import { openPersistentWorkspace } from '@wasm-idle/container/persistence';
import { createWorkspaceSaveController } from '@wasm-idle/container/workspace';
import { createBashProfile } from './bash-profile.mjs';

const config = { ...__CONTAINER_BASH_CONFIG__ };
for (const key of ['sdkUrl', 'sdkWorkerUrl', 'liveWorkerUrl', 'clangWorkerUrl']) config[key] = new URL(config[key], import.meta.url).href;
let initialized = false;
self.onmessage = async event => {
  if (initialized || !(event.data?.port instanceof MessagePort)) return;
  initialized = true;
  let workspace, profile, save;
  try {
    const id = event.data.workspaceId;
    if (!/^[a-zA-Z0-9._-]{1,100}$/u.test(id)) throw new Error('Invalid workspace identifier');
    workspace = await openPersistentWorkspace({ id, maxBytes: 256 * 1024 * 1024, maxInodes: 16384 });
    try { workspace.fs.stat('/workspace/main.c'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      workspace.fs.writeFile('/workspace/main.c', new TextEncoder().encode('#include <stdio.h>\nint main(void) { puts("hello"); return 0; }\n'));
    }
    profile = await createBashProfile({ config, sdk, workspace });
    save = createWorkspaceSaveController(workspace, { autosave: false });
    serveContainerOwner(event.data.port, {
      container: profile.container, save, startShell: profile.startShell,
      clearAssetCache: () => clearRuntimeAssetCache({ cache: { enabled: true, namespace: config.cacheNamespace, version: config.manifestSha256 } }),
      async dispose() { try { await profile.dispose(); } finally { await workspace.dispose(); } }
    });
    self.postMessage({ ready: true });
  } catch (error) {
    const cleanup = [() => save?.dispose(), () => profile?.dispose(), () => workspace?.dispose()];
    for (const release of cleanup) { try { await release(); } catch {} }
    event.data.port.close();
    self.postMessage({ ready: false, code: error.code ?? error.name, message: String(error.message ?? error) }); self.close();
  }
};
