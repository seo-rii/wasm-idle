import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContainer } from '../../dist/index.js';
import { openWorkspaceEditor } from '../../dist/workspace/index.js';
import { createWasiAdapter } from '../../dist/adapters/wasi/index.js';
import { createLiveWasiAdapter } from '../../dist/adapters/wasi-live/index.js';
import { workerFactory } from './node-worker.mjs';
import { verifyWorkspaceBindings } from './workspace-fixture.mjs';

test('C16: real live and snapshot guests share editor revisions without silent overwrites', { timeout: 60000 }, async () => {
  await verifyWorkspaceBindings({ createContainer, openWorkspaceEditor,
    liveAdapter: createLiveWasiAdapter({ workerFactory: () => workerFactory('../../dist/adapters/wasi-live/worker.js') }),
    snapshotAdapter: createWasiAdapter({ workerFactory }),
    bytes: new Uint8Array(readFileSync(new URL('../fixtures/live.wasm', import.meta.url)))
  });
});
