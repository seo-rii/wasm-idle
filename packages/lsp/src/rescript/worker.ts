import { configureWorkerLanguageToolPersistentAssets } from '../persistent-assets.js';
import { createReScriptServer } from './host.js';

let started = false;
let server: Awaited<ReturnType<typeof createReScriptServer>> | undefined;
let queue = Promise.resolve();
self.addEventListener('message', ({ data }: MessageEvent) => {
	if (data?.type === 'init') {
		if (started) return;
		started = true;
		queue = queue
			.then(async () => {
				configureWorkerLanguageToolPersistentAssets(data.persistentAssets);
				server = await createReScriptServer(data.options, (message) =>
					self.postMessage(message)
				);
				self.postMessage({ type: 'ready' });
			})
			.catch((error) =>
				self.postMessage({
					type: 'error',
					message: String(error instanceof Error ? error.message : error)
				})
			);
	} else if (data?.jsonrpc === '2.0') {
		queue = queue
			.then(async () => {
				if (!server) throw new Error('ReScript language server is not ready');
				await server.receive(data);
			})
			.catch((error) => {
				if (error?.exitCode === 0) self.close();
				else
					self.postMessage({
						type: 'error',
						message: String(error instanceof Error ? error.message : error)
					});
			});
	}
});
