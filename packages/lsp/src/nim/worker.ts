import { startNimLanguageServerWorker } from './worker-host.js';
let started = false;
globalThis.addEventListener('message', async ({ data }: MessageEvent) => {
	if (data?.type !== 'init' || started) return;
	started = true;
	await startNimLanguageServerWorker(
		data,
		globalThis as unknown as Parameters<typeof startNimLanguageServerWorker>[1]
	);
});
