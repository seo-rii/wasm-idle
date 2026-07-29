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
		throw new Error(`Janet runtime asset was not found: ${runtimeUrl}`);
	}
	const contentEncoding = (compressedResponse.headers.get('content-encoding') || '')
		.toLowerCase()
		.split(',')
		.map((value) => value.trim());
	if (contentEncoding.includes('gzip')) return compressedResponse.arrayBuffer();
	if (typeof DecompressionStream !== 'function') {
		throw new Error(
			'Janet runtime asset is gzip-compressed, but DecompressionStream is unavailable.'
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
		throw new Error('Invalid Janet streaming stdin channel.');
	}

	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) {
				throw new Error('Janet streaming stdin was cancelled.');
			}
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('Janet streaming stdin counters are invalid.');
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

function createCharOutput(onOutput) {
	const decoder = new TextDecoder();
	let bytes = [];
	return (value) => {
		if (value === null || value === 10) {
			const text = decoder.decode(new Uint8Array(bytes));
			bytes = [];
			if (text) onOutput(text);
			return;
		}
		if (value !== 0) bytes.push(value);
	};
}

async function createJanetRuntime(baseUrl, stdin, stdinChannel, onStdout, stderr) {
	const wasmBinary = await fetchRuntimeBytes(baseUrl, 'janet.wasm');
	const runtimeModule = await import(assetUrl(baseUrl, 'janet.js'));
	const createModule = runtimeModule.default || runtimeModule;
	if (typeof createModule !== 'function') {
		throw new Error('Janet runtime module did not export an Emscripten module factory.');
	}
	const readStdin = createInputReader(stdin, stdinChannel);
	const writeStdout = createCharOutput(onStdout);
	const writeStderr = createCharOutput((message) => stderr.push(message));
	return await createModule({
		locateFile: (path) => assetUrl(baseUrl, path),
		print: (message) => onStdout(String(message)),
		printErr: (message) => stderr.push(String(message)),
		preRun: [(module) => module.FS.init(readStdin, writeStdout, writeStderr)],
		stdin: readStdin,
		wasmBinary
	});
}

self.onmessage = async (event) => {
	const { baseUrl, code, stdin, stdinChannel, activePath, log } = event.data || {};
	const stderr = [];
	try {
		if (log) console.log(`[wasm-idle:janet-worker] run start baseUrl=${baseUrl}`);
		const module = await createJanetRuntime(
			baseUrl,
			stdin,
			stdinChannel,
			(message) => postOutput([message]),
			stderr
		);
		const sourcePath = `/${activePath || 'main.janet'}`;
		module.FS.writeFile(sourcePath, String(code || ''));
		const status = module.callMain([sourcePath]);
		if (stderr.length > 0 || status !== 0) {
			throw new Error(stderr.join('\n') || `Janet exited with status ${status}.`);
		}
		if (log) console.log('[wasm-idle:janet-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		const message = stderr.length > 0 ? stderr.join('\n') : error?.message || String(error);
		if (log) console.error('[wasm-idle:janet-worker] failed', error);
		self.postMessage({ error: message });
	}
};
