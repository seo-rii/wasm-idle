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
		(0, eval)(`${source}\n//# sourceURL=${assetUrl(baseUrl, path)}`);
	}
}

async function loadCompiler(baseUrl) {
	if (typeof globalThis.wasm_idle?.runner?.execute !== 'function') {
		await importRuntimeScript(baseUrl, 'compiler.js');
	}
	const execute = globalThis.wasm_idle?.runner?.execute;
	if (typeof execute !== 'function') {
		throw new Error('ClojureScript compiler runtime did not initialize.');
	}
	return execute;
}

function normalizePath(value) {
	return String(value || '')
		.replace(/\\/g, '/')
		.replace(/^\.\//, '')
		.replace(/^\/+/, '');
}

function buildWorkspaceFiles(code, activePath, workspaceFiles) {
	const files = Object.create(null);
	for (const file of workspaceFiles || []) {
		if (!file || typeof file.content !== 'string') continue;
		const path = normalizePath(file.path);
		if (path) files[path] = file.content;
	}
	const sourcePath = normalizePath(activePath) || 'main.cljs';
	files[sourcePath] = String(code || '');
	return files;
}

function splitStdinLines(stdin) {
	const source = typeof stdin === 'string' ? stdin : '';
	if (!source) return [];
	const lines = source.split(/\r\n|\n|\r/);
	if (lines.at(-1) === '') lines.pop();
	return lines;
}

function createSharedByteReader(channel) {
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
		throw new Error('Invalid ClojureScript streaming stdin channel.');
	}

	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) {
				throw new Error('ClojureScript streaming stdin was cancelled.');
			}
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('ClojureScript streaming stdin counters are invalid.');
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

function createSharedStdin(channel) {
	const readByte = createSharedByteReader(channel);
	if (!readByte) return null;
	const decoder = new TextDecoder();
	let skipLineFeed = false;
	return {
		readLine() {
			const bytes = [];
			while (true) {
				const value = readByte();
				if (value === null) {
					return bytes.length ? decoder.decode(Uint8Array.from(bytes)) : undefined;
				}
				if (skipLineFeed) {
					skipLineFeed = false;
					if (value === 10) continue;
				}
				if (value === 10) break;
				if (value === 13) {
					skipLineFeed = true;
					break;
				}
				bytes.push(value);
			}
			return decoder.decode(Uint8Array.from(bytes));
		},
		readRemaining() {
			const bytes = [];
			while (true) {
				const value = readByte();
				if (value === null) return decoder.decode(Uint8Array.from(bytes));
				if (skipLineFeed) {
					skipLineFeed = false;
					if (value === 10) continue;
				}
				bytes.push(value);
			}
		}
	};
}

function createStdinContext(stdin, channel) {
	const shared = createSharedStdin(channel);
	if (!shared) {
		const text = typeof stdin === 'string' ? stdin : '';
		return { stdin: text, stdinLines: splitStdinLines(text) };
	}
	const context = { stdinLines: { shift: () => shared.readLine() } };
	Object.defineProperty(context, 'stdin', {
		enumerable: true,
		get: () => shared.readRemaining()
	});
	return context;
}

function postBufferedRemainder(buffered, streamed) {
	const text = typeof buffered === 'string' ? buffered : '';
	if (!text) return;
	postOutput(streamed && text.startsWith(streamed) ? text.slice(streamed.length) : text);
}

function executeSource(execute, source, filename, context) {
	return new Promise((resolve) => execute(source, filename, context, resolve));
}

self.onmessage = async (event) => {
	const {
		baseUrl,
		code,
		args = [],
		stdin = '',
		stdinChannel,
		activePath = 'main.cljs',
		workspaceFiles = [],
		log
	} = event.data || {};
	try {
		const context = createStdinContext(stdin, stdinChannel);
		let streamedStdout = '';
		let streamedStderr = '';
		context.onStdout = (text) => {
			const chunk = String(text || '');
			streamedStdout += chunk;
			postOutput(chunk);
		};
		context.onStderr = (text) => {
			const chunk = String(text || '');
			streamedStderr += chunk;
			postOutput(chunk);
		};
		context.args = Array.isArray(args) ? args.map(String) : [];
		context.files = buildWorkspaceFiles(code, activePath, workspaceFiles);
		if (log) console.log(`[wasm-idle:clojurescript-worker] run start baseUrl=${baseUrl}`);
		self.postMessage({ progress: { percent: 5, stage: 'Loading ClojureScript compiler' } });
		const execute = await loadCompiler(baseUrl);
		self.postMessage({ progress: { percent: 35, stage: 'Compiling ClojureScript' } });
		const result = await executeSource(execute, String(code || ''), activePath, context);
		postBufferedRemainder(result?.stdout, streamedStdout);
		if (!result?.ok) {
			throw new Error(result?.stderr || 'ClojureScript evaluation failed.');
		}
		postBufferedRemainder(result?.stderr, streamedStderr);
		self.postMessage({ progress: { percent: 100, stage: 'Finished' } });
		if (log) console.log('[wasm-idle:clojurescript-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		if (log) console.error('[wasm-idle:clojurescript-worker] failed', error);
		self.postMessage({ error: error?.message || String(error) });
	}
};
