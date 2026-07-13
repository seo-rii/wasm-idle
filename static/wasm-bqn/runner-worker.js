function assetUrl(baseUrl, path) {
	return new URL(path, baseUrl).href;
}

function postOutput(lines) {
	const output = lines.filter(Boolean).join('\n');
	if (output) self.postMessage({ output: output.endsWith('\n') ? output : `${output}\n` });
}

async function fetchRuntimeBytes(baseUrl, path) {
	const runtimeUrl = assetUrl(baseUrl, path);
	const response = await fetch(runtimeUrl).catch(() => null);
	if (response?.ok) return response.arrayBuffer();

	const compressedResponse = await fetch(assetUrl(baseUrl, `${path}.gz`)).catch(() => null);
	if (!compressedResponse?.ok || !compressedResponse.body) {
		throw new Error(`BQN runtime asset was not found: ${runtimeUrl}`);
	}
	const contentEncoding = (compressedResponse.headers.get('content-encoding') || '')
		.toLowerCase()
		.split(',')
		.map((value) => value.trim());
	if (contentEncoding.includes('gzip')) return compressedResponse.arrayBuffer();
	if (typeof DecompressionStream !== 'function') {
		throw new Error(
			'BQN runtime asset is gzip-compressed, but DecompressionStream is unavailable.'
		);
	}
	const decompressed = compressedResponse.body.pipeThrough(new DecompressionStream('gzip'));
	return new Response(decompressed).arrayBuffer();
}

function createInputReader(stdin) {
	const bytes = Array.from(new TextEncoder().encode(typeof stdin === 'string' ? stdin : ''));
	let index = 0;
	return () => {
		if (index >= bytes.length) return null;
		const value = bytes[index];
		index += 1;
		return value;
	};
}

function createBqnRunner(module) {
	const runLine = module.cwrap('cbqn_runLine', null, ['array', 'int']);
	const encoder = new TextEncoder();
	return (source) => {
		const bytes = encoder.encode(`${source}\0`);
		runLine(bytes, bytes.length - 1);
	};
}

async function createBqnRuntime(baseUrl, stdin, stdout, stderr) {
	const wasmBinary = await fetchRuntimeBytes(baseUrl, 'BQN.wasm');
	const runtimeModule = await import(assetUrl(baseUrl, 'BQN.js'));
	const createModule = runtimeModule.default || runtimeModule;
	if (typeof createModule !== 'function') {
		throw new Error('BQN runtime module did not export an Emscripten module factory.');
	}
	const module = await createModule({
		locateFile: (path) => assetUrl(baseUrl, path),
		print: (message) => stdout.push(String(message)),
		printErr: (message) => stderr.push(String(message)),
		stdin: createInputReader(stdin),
		wasmBinary
	});
	return createBqnRunner(module);
}

self.onmessage = async (event) => {
	const { baseUrl, code, stdin, log } = event.data || {};
	const stdout = [];
	const stderr = [];
	try {
		if (log) console.log(`[wasm-idle:bqn-worker] run start baseUrl=${baseUrl}`);
		const source = String(code || '');
		if (source.trim()) {
			const runBqn = await createBqnRuntime(baseUrl, stdin, stdout, stderr);
			runBqn(source);
		}
		if (stderr.length > 0) throw new Error(stderr.join('\n'));
		postOutput(stdout);
		if (log) console.log('[wasm-idle:bqn-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		const message = stderr.length > 0 ? stderr.join('\n') : error?.message || String(error);
		if (log) console.error('[wasm-idle:bqn-worker] failed', error);
		self.postMessage({ error: message });
	}
};
