// Passed directly to Playwright evaluate. Every dependency is an explicit input.
export async function installCancellationSession(configuration) {
	if (!crossOriginIsolated) throw new Error('Cross-origin isolation required');
	const { descriptions, sdkBase, workerUrl, memory, bashWasmSha256, slowBashAsset } =
		configuration;
	const verified = new Map();
	let sdkModule,
		generation = 0,
		previousMemory;
	const inputs = async (fixture, signal) => {
		const values = {};
		for (const entry of descriptions) {
			if (fixture.slowDownload && entry.key === 'bashWebc') continue;
			if (!verified.has(entry.key)) {
				const response = await fetch(entry.url, {
					signal,
					credentials: 'same-origin',
					redirect: 'error'
				});
				if (!response.ok) throw new Error(`Input HTTP ${response.status}`);
				const bytes = await response.arrayBuffer();
				const digest = Array.from(
					new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
					(value) => value.toString(16).padStart(2, '0')
				).join('');
				if (bytes.byteLength !== entry.bytes || digest !== entry.sha256)
					throw new Error('Input identity mismatch: ' + entry.key);
				verified.set(entry.key, bytes);
			}
			values[entry.key] = verified.get(entry.key);
		}
		if (!sdkModule) sdkModule = await WebAssembly.compile(values.sdkWasm);
		return values;
	};
	globalThis.runCancellationSession = (fixture) =>
		new Promise((resolve) => {
			const events = [];
			const currentGeneration = ++generation;
			const abort = new AbortController();
			let worker,
				outcome,
				cleanupTimer,
				cleanupRequested = false,
				settled = false;
			let cancelRequestedAt,
				memoryDistinctFromPrevious = false;
			let hostSettlementCount = 0;
			const finish = (value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				clearTimeout(cleanupTimer);
				abort.abort();
				worker?.terminate();
				resolve({
					...value,
					events,
					generation: currentGeneration,
					hostSettlementCount: ++hostSettlementCount,
					workerTerminalMessageCount: events.filter(({ type }) =>
						['result', 'failure', 'error'].includes(type)
					).length,
					memoryDistinctFromPrevious,
					...(cancelRequestedAt === undefined
						? {}
						: {
								cancellationAcknowledgementMs: performance.now() - cancelRequestedAt
							})
				});
			};
			const retire = (value) => {
				if (settled || cleanupRequested) return;
				cleanupRequested = true;
				outcome = value;
				abort.abort();
				if (!worker) return finish({ ...value, cleanup: { type: 'no-worker-created' } });
				cancelRequestedAt = performance.now();
				cleanupTimer = setTimeout(
					() => finish({ ...value, cleanup: { type: 'owner-cleanup-timeout' } }),
					2000
				);
				worker.postMessage({ type: 'cleanup' });
			};
			globalThis.cleanupCancellationSession = () =>
				retire({ type: 'harness-cleanup', backendCompleted: false });
			const timer = setTimeout(
				() => retire({ type: 'timeout', backendCompleted: false }),
				20000
			);
			(async () => {
				const values = await inputs(fixture, abort.signal);
				if (settled || cleanupRequested) return;
				const sdkMemory = new WebAssembly.Memory(memory);
				memoryDistinctFromPrevious = sdkMemory !== previousMemory;
				previousMemory = sdkMemory;
				worker = new Worker(workerUrl, { type: 'module' });
				worker.onmessage = ({ data }) => {
					if (settled) return;
					events.push(data);
					if (data.type === 'ownerCleanup' && cleanupRequested)
						return finish({ ...outcome, cleanup: data });
					if (cleanupRequested) return;
					if (fixture.cancel && ['pendingGuest', 'downloadPending'].includes(data.type)) {
						retire({
							type: 'cancelled',
							backendCompleted: false,
							pendingBeforeTermination: true
						});
					} else if (['result', 'failure'].includes(data.type)) retire(data);
				};
				worker.onerror = (event) =>
					retire({ type: 'error', backendCompleted: false, error: event.message });
				worker.postMessage({
					type: 'run',
					fixture,
					...values,
					sdkModule,
					sdkMemory,
					bashWasmSha256,
					slowBashAsset,
					sdkUrl: location.origin + sdkBase + '/index.mjs',
					sdkWorkerUrl: location.origin + sdkBase + '/worker.mjs'
				});
			})().catch((error) => {
				if (!cleanupRequested && !settled)
					retire({ type: 'failure', backendCompleted: false, error: String(error) });
			});
		});
}
