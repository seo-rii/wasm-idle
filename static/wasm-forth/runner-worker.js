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

function createSharedKeyReader(channel) {
	if (channel === undefined) return null;
	if (
		channel?.protocol !== 'wasm-idle-static-stdin-ring' ||
		channel?.protocolVersion !== 1 ||
		channel?.controlBytes !== 16 ||
		!Number.isSafeInteger(channel?.capacity) ||
		channel.capacity <= 0 ||
		typeof SharedArrayBuffer !== 'function' ||
		!(channel.buffer instanceof SharedArrayBuffer) ||
		channel.buffer.byteLength !== channel.controlBytes + channel.capacity ||
		typeof Atomics.wait !== 'function'
	) {
		throw new Error('Invalid WAForth streaming stdin channel.');
	}

	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) {
				throw new Error('WAForth streaming stdin was cancelled.');
			}
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('WAForth streaming stdin counters are invalid.');
			}
			if (available > 0) {
				const value = bytes[read % bytes.byteLength];
				Atomics.store(control, 1, read + 1);
				return value;
			}
			if (Atomics.load(control, 2) === 1) return -1;
			self.postMessage({ type: 'stdin-request' });
			Atomics.wait(control, 0, write);
		}
	};
}

function createKeyReader(stdin, channel) {
	const sharedReader = createSharedKeyReader(channel);
	if (sharedReader) return sharedReader;
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
	const { baseUrl, code, stdin, stdinChannel, log } = event.data || {};
	const decoder = new TextDecoder();
	try {
		if (log) console.log(`[wasm-idle:forth-worker] run start baseUrl=${baseUrl}`);
		const { runtimePackage, WAForth } = await loadWaforth(baseUrl);
		const forth = new WAForth();
		forth.key = createKeyReader(stdin, stdinChannel);
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
