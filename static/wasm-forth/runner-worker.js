function assetUrl(baseUrl, path) {
	return new URL(path, baseUrl).href;
}

function postOutput(text) {
	if (text) self.postMessage({ output: text });
}

async function importRuntimeScript(baseUrl, path) {
	try {
		importScripts(assetUrl(baseUrl, path));
		return;
	} catch (importError) {
		const compressedResponse = await fetch(assetUrl(baseUrl, `${path}.gz`)).catch(() => null);
		if (!compressedResponse?.ok || !compressedResponse.body) throw importError;
		if (typeof DecompressionStream !== 'function') throw importError;
		const encoded = (compressedResponse.headers.get('content-encoding') || '')
			.toLowerCase()
			.split(',')
			.map((value) => value.trim())
			.includes('gzip');
		const body = encoded
			? compressedResponse.body
			: compressedResponse.body.pipeThrough(new DecompressionStream('gzip'));
		const source = await new Response(body).text();
		(0, eval)(source);
	}
}

async function loadWaforth(baseUrl) {
	if (!globalThis.WAForthPackage) {
		await importRuntimeScript(baseUrl, 'waforth.js');
	}
	const runtimePackage = globalThis.WAForthPackage;
	const WAForth = runtimePackage?.default || runtimePackage;
	if (typeof WAForth !== 'function') {
		throw new Error('WAForth runtime did not initialize.');
	}
	return { runtimePackage, WAForth };
}

function createKeyReader(stdin) {
	const source = typeof stdin === 'string' ? stdin : '';
	const bytes = Array.from(new TextEncoder().encode(source));
	let index = 0;
	return () => {
		if (index >= bytes.length) return -1;
		const value = bytes[index];
		index += 1;
		return value;
	};
}

self.onmessage = async (event) => {
	const { baseUrl, code, stdin, log } = event.data || {};
	const decoder = new TextDecoder();
	try {
		if (log) console.log(`[wasm-idle:forth-worker] run start baseUrl=${baseUrl}`);
		const { runtimePackage, WAForth } = await loadWaforth(baseUrl);
		const forth = new WAForth();
		forth.key = createKeyReader(stdin);
		forth.onEmit = (byte) => postOutput(decoder.decode(Uint8Array.of(byte), { stream: true }));
		await forth.load();
		const result = forth.interpret(String(code || ''), true);
		postOutput(decoder.decode());
		if (typeof runtimePackage.isSuccess === 'function' && !runtimePackage.isSuccess(result)) {
			const errorName = runtimePackage.ErrorCode?.[result] || result || 'unknown';
			throw new Error(`Forth exited with error code ${errorName}.`);
		}
		if (log) console.log('[wasm-idle:forth-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		if (log) console.error('[wasm-idle:forth-worker] failed', error);
		self.postMessage({ error: error?.message || String(error) });
	}
};
