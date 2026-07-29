function assetUrl(baseUrl, path) {
	return new URL(path, baseUrl).href;
}

function postOutput(text) {
	if (text) self.postMessage({ output: text.endsWith('\n') ? text : `${text}\n` });
}

async function fetchRuntimeBytes(baseUrl, path) {
	const runtimeUrl = assetUrl(baseUrl, path);
	const response = await fetch(runtimeUrl).catch(() => null);
	if (response?.ok) return response.arrayBuffer();

	const compressedResponse = await fetch(assetUrl(baseUrl, `${path}.gz`)).catch(() => null);
	if (!compressedResponse?.ok || !compressedResponse.body) {
		throw new Error(`J runtime asset was not found: ${runtimeUrl}`);
	}
	const contentEncoding = (compressedResponse.headers.get('content-encoding') || '')
		.toLowerCase()
		.split(',')
		.map((value) => value.trim());
	const encoded = contentEncoding.includes('gzip');
	if (encoded) return compressedResponse.arrayBuffer();
	if (typeof DecompressionStream !== 'function') {
		throw new Error(
			'J runtime asset is gzip-compressed, but DecompressionStream is unavailable.'
		);
	}
	const decompressed = compressedResponse.body.pipeThrough(new DecompressionStream('gzip'));
	return new Response(decompressed).arrayBuffer();
}

function createSharedInputReader(channel) {
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
		throw new Error('Invalid J streaming stdin channel.');
	}

	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) {
				throw new Error('J streaming stdin was cancelled.');
			}
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('J streaming stdin counters are invalid.');
			}
			if (available > 0) {
				const value = bytes[read % bytes.byteLength];
				Atomics.store(control, 1, read + 1);
				return value;
			}
			if (Atomics.load(control, 2) === 1) return null;
			self.postMessage({ type: 'stdin-request' });
			Atomics.wait(control, 0, write);
		}
	};
}

function createInputReader(stdin, channel) {
	const sharedReader = createSharedInputReader(channel);
	if (sharedReader) return sharedReader;
	const bytes = Array.from(new TextEncoder().encode(typeof stdin === 'string' ? stdin : ''));
	let index = 0;
	return () => {
		if (index >= bytes.length) return null;
		const value = bytes[index];
		index += 1;
		return value;
	};
}

function isJError(output) {
	return /^\|/mu.test(output || '');
}

function normalizeChunk(output) {
	return String(output || '')
		.replace(/Module initialized!\n?/gu, '')
		.replace(/^warning: unsupported syscall: \d+\n?/gmu, '');
}

async function createJRuntime(baseUrl, stdin, stdinChannel) {
	const wasmBinary = await fetchRuntimeBytes(baseUrl, 'jamalgam.wasm');
	const runtimeModule = await import(assetUrl(baseUrl, 'jamalgam.js'));
	const createModule = runtimeModule.default || runtimeModule;
	if (typeof createModule !== 'function') {
		throw new Error('J runtime module did not export an Emscripten module factory.');
	}
	const module = await createModule({
		locateFile: (path) => assetUrl(baseUrl, path),
		print() {},
		printErr() {},
		stdin: createInputReader(stdin, stdinChannel),
		wasmBinary
	});
	const jinit = module.cwrap('em_jinit', 'number', []);
	const rc = jinit();
	if (rc !== 0) throw new Error(`J runtime initialization failed with code ${rc}.`);
	const jdo = module.cwrap('em_jdo', 'string', ['string']);
	const jsetstr = module.cwrap('em_jsetstr', 'void', ['string', 'string']);
	jdo("(0!:0) <'/jlibrary/system/main/stdlib.ijs'");
	return { jdo, jsetstr };
}

function runJLineByLine(jdo, code, onOutput) {
	for (const line of String(code || '')
		.replace(/\r\n?/gu, '\n')
		.split('\n')) {
		if (!line.trim()) continue;
		const chunk = normalizeChunk(jdo(line));
		if (isJError(chunk)) throw new Error(chunk);
		if (chunk) onOutput(chunk);
	}
}

function runJScript(jdo, jsetstr, code) {
	const source = String(code || '');
	if (!source.trim()) return '';
	jsetstr('CODE_jrx_', source);
	const output = normalizeChunk(jdo('(0!:101) CODE_jrx_'));
	if (isJError(output)) throw new Error(output);
	return output;
}

function readsStdin(code) {
	return /1!:\s*1|\/dev\/stdin|\bstdin\b/iu.test(code);
}

self.onmessage = async (event) => {
	const { baseUrl, code, stdin, stdinChannel, log } = event.data || {};
	try {
		if (log) console.log(`[wasm-idle:j-worker] run start baseUrl=${baseUrl}`);
		const { jdo, jsetstr } = await createJRuntime(baseUrl, stdin, stdinChannel);
		if (readsStdin(String(code || ''))) runJLineByLine(jdo, code, postOutput);
		else postOutput(runJScript(jdo, jsetstr, code));
		if (log) console.log('[wasm-idle:j-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		if (log) console.error('[wasm-idle:j-worker] failed', error);
		self.postMessage({ error: error?.message || String(error) });
	}
};
