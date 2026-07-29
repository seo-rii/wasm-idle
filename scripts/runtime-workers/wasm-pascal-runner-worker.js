function assetUrl(baseUrl, path) {
	return new URL(path, baseUrl).href;
}

function postOutput(text) {
	if (text) self.postMessage({ output: text });
}

async function fetchText(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`failed to load ${url}: ${response.status}`);
	return response.text();
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
		throw new Error('Invalid pas2js streaming stdin channel.');
	}

	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) {
				throw new Error('pas2js streaming stdin was cancelled.');
			}
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('pas2js streaming stdin counters are invalid.');
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

function createSharedLineReader(channel) {
	const readByte = createSharedByteReader(channel);
	if (!readByte) return null;
	const decoder = new TextDecoder();
	let skipLineFeed = false;
	return () => {
		const bytes = [];
		while (true) {
			const value = readByte();
			if (value === null) return decoder.decode(Uint8Array.from(bytes));
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
	};
}

function createLineReader(stdin, channel) {
	const sharedReader = createSharedLineReader(channel);
	if (sharedReader) return sharedReader;
	const source = typeof stdin === 'string' ? stdin : '';
	const lines = source.length ? source.split(/\r\n|\n|\r/) : [];
	let index = 0;
	return () => {
		if (index >= lines.length) return '';
		const line = lines[index];
		index += 1;
		return line;
	};
}

async function loadCompiler(baseUrl) {
	if (!globalThis.__wasmIdlePascalCompiler) {
		await importRuntimeScript(baseUrl, 'compiler.js');
		if (typeof globalThis.rtl?.run !== 'function') {
			throw new Error('Pascal compiler runtime did not initialize.');
		}
		globalThis.rtl.run('program');
	}
	return globalThis.__wasmIdlePascalCompiler;
}

function runGeneratedJavaScript(source, stdin, stdinChannel) {
	const readLine = createLineReader(stdin, stdinChannel);
	const previousConsole = globalThis.console;
	const previousRead = globalThis.__wasm_idle_pascal_read;
	globalThis.console = {
		...previousConsole,
		log: (...args) => postOutput(`${args.join(' ')}\n`),
		error: (...args) => postOutput(`${args.join(' ')}\n`)
	};
	globalThis.__wasm_idle_pascal_read = readLine;
	try {
		const run = new Function(`${source}\nrtl.run("program");`);
		run();
	} finally {
		globalThis.console = previousConsole;
		if (previousRead) {
			globalThis.__wasm_idle_pascal_read = previousRead;
		} else {
			delete globalThis.__wasm_idle_pascal_read;
		}
	}
}

self.onmessage = async (event) => {
	const { baseUrl, code, stdin, stdinChannel, log } = event.data || {};
	try {
		if (log) console.log(`[wasm-idle:pascal-worker] run start baseUrl=${baseUrl}`);
		const compiler = await loadCompiler(baseUrl);
		compiler.setFile('system.pas', await fetchText(assetUrl(baseUrl, 'system.pas')));
		compiler.setFile('rtl.js', await fetchText(assetUrl(baseUrl, 'rtl.js')));
		const generated = compiler.compile(String(code || ''));
		runGeneratedJavaScript(generated, stdin, stdinChannel);
		if (log) console.log('[wasm-idle:pascal-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		if (log) console.error('[wasm-idle:pascal-worker] failed', error);
		self.postMessage({ error: error?.message || String(error) });
	}
};
