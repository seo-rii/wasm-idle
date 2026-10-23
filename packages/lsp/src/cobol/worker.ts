import { startCobolLanguageServerWorker } from './worker-host.js';
let started = false;
globalThis.addEventListener('message', async ({ data }: MessageEvent) => {
	if (data?.type !== 'init' || started) return;
	started = true;
	await startCobolLanguageServerWorker(
		data,
		globalThis as unknown as Parameters<typeof startCobolLanguageServerWorker>[1]
	);
});
