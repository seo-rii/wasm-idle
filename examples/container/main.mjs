import { createContainerOwnerClient } from '@wasm-idle/container/adapters/wasix';
import { mountContainerWorkbench } from './workbench.mjs';

/** The returned client can also bind host-provided controls; all operations stay on its private port. */
export const application = (async () => {
  const workspaceId = new URL(location.href).searchParams.get('workspace') ?? 'container-workbench';
  if (!/^[a-zA-Z0-9._-]{1,100}$/u.test(workspaceId)) throw new Error('Invalid workspace identifier');
  const worker = new Worker(new URL('./owner.mjs', import.meta.url), { type: 'module', name: 'container-workbench-owner' });
  const channel = new MessageChannel();
  const lifetime = new AbortController();
  const profile = __CONTAINER_WORKBENCH_PROFILE__;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Owner startup deadline exceeded')); }, 30000);
      worker.onmessage = event => {
        clearTimeout(timer);
        if (event.data?.ready === true) resolve(); else reject(new Error(`${event.data?.code ?? 'STARTUP_FAILED'}: ${event.data?.message ?? 'Owner startup failed'}`));
      };
      const failure = error => { clearTimeout(timer); lifetime.abort(error); reject(error); };
      worker.onerror = event => { event.preventDefault(); failure(new Error(event.message)); };
      worker.onmessageerror = () => failure(new Error('Owner Worker response could not be decoded'));
      worker.postMessage({ port: channel.port1, workspaceId }, [channel.port1]);
    });
    const client = createContainerOwnerClient(channel.port2, { signal: lifetime.signal });
    const view = mountContainerWorkbench(document.querySelector('#app'), client, {
      ...profile,
      profileLabel: `Workspace ${workspaceId} · ${profile.profileLabel}`,
      ownerSignal: lifetime.signal,
      onDispose: () => worker.terminate()
    });
    await view.ready;
    return Object.freeze({ client, view });
  } catch (error) { channel.port2.close(); worker.terminate(); throw error; }
})();
void application.catch(error => {
  const message = document.createElement('p'); message.setAttribute('role', 'alert');
  message.textContent = `${error.message}. Existing stored files were preserved. Close any other tab using this workspace, then retry.`;
  document.querySelector('#app').replaceChildren(message);
});
