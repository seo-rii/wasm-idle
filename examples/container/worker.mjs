import { serveFixtureOwner } from './owner.mjs';

let initialized = false;
self.onmessage = async event => {
  if (initialized || !(event.data?.port instanceof MessagePort)) return;
  initialized = true;
  try {
    await serveFixtureOwner(event.data.port, { workspaceId: event.data.workspaceId });
    self.postMessage({ ready: true });
  } catch (error) {
    event.data.port.close();
    self.postMessage({ ready: false, code: error.code ?? error.name, message: String(error.message ?? error) });
    self.close();
  }
};
