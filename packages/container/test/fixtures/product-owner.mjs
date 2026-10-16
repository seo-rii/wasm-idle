// Trusted test-only owner entry. The normal example never installs this fault channel.
import { serveFixtureOwner } from '../../../../examples/container/owner.mjs';

const faults = new BroadcastChannel('container-workbench-ui-test-faults');
let failNextSave = false, initialized = false;
faults.onmessage = event => {
  if (event.data?.operation === 'crash-owner') {
    faults.postMessage({ acknowledged: event.data.id });
    setTimeout(() => { throw new Error('Deterministic owner Worker failure'); }, 0); return;
  }
  if (event.data?.operation !== 'fail-next-save') return;
  failNextSave = true;
  faults.postMessage({ acknowledged: event.data.id });
};
self.onmessage = async event => {
  if (initialized || !(event.data?.port instanceof MessagePort)) return;
  initialized = true;
  try {
    await serveFixtureOwner(event.data.port, {
      workspaceId: event.data.workspaceId,
      fault(point) {
        if (point === 'before-root-publish' && failNextSave) {
          failNextSave = false;
          throw new DOMException('Deterministic storage write failure', 'QuotaExceededError');
        }
      }
    });
    self.postMessage({ ready: true });
  } catch (error) { event.data.port.close(); self.postMessage({ ready: false, code: error.code ?? error.name, message: error.message }); self.close(); }
};
