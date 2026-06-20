function assetUrl(baseUrl, path) {
	return new URL(path, baseUrl).href;
}

function postOutput(text) {
	if (text) self.postMessage({ output: text });
}

function waitForRunFunction() {
	return new Promise((resolve, reject) => {
		let attempts = 0;
		const tick = () => {
			if (typeof globalThis.wasmIdleRunAwk === 'function') {
				resolve(globalThis.wasmIdleRunAwk);
				return;
			}
			attempts += 1;
			if (attempts > 100) {
				reject(new Error('GoAWK wasm runtime did not initialize.'));
				return;
			}
			setTimeout(tick, 0);
		};
		tick();
	});
}

async function loadRuntime(baseUrl) {
	importScripts(assetUrl(baseUrl, 'wasm_exec.js'));
	const go = new globalThis.Go();
	const response = await fetch(assetUrl(baseUrl, 'goawk.wasm'));
	if (!response.ok) {
		throw new Error(`failed to load GoAWK wasm: ${response.status}`);
	}
	const { instance } = await WebAssembly.instantiate(
		await response.arrayBuffer(),
		go.importObject
	);
	void go.run(instance).catch((error) => {
		console.error('[wasm-idle:awk-worker] Go runtime stopped', error);
	});
	return waitForRunFunction();
}

self.onmessage = async (event) => {
	const { baseUrl, code, args = [], stdin, log } = event.data || {};
	try {
		if (log) {
			console.log(`[wasm-idle:awk-worker] run start baseUrl=${baseUrl}`);
		}
		const runAwk = await loadRuntime(baseUrl);
		const result = runAwk(String(code || ''), typeof stdin === 'string' ? stdin : '', args);
		postOutput(String(result.stdout || ''));
		postOutput(String(result.stderr || ''));
		if (result.error) {
			throw new Error(String(result.error));
		}
		if (Number(result.status || 0) !== 0) {
			throw new Error(`AWK exited with status ${result.status}.`);
		}
		if (log) {
			console.log('[wasm-idle:awk-worker] run settled');
		}
		self.postMessage({ results: true });
	} catch (error) {
		if (log) {
			console.error('[wasm-idle:awk-worker] failed', error);
		}
		self.postMessage({ error: error?.message || String(error) });
	}
};
