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

function createLineReader(stdin) {
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

function runGeneratedJavaScript(source, stdin) {
	const readLine = createLineReader(stdin);
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
	const { baseUrl, code, stdin, log, diagnose = false } = event.data || {};
	try {
		if (log) console.log(`[wasm-idle:pascal-worker] run start baseUrl=${baseUrl}`);
		const compiler = await loadCompiler(baseUrl);
		compiler.setFile('system.pas', await fetchText(assetUrl(baseUrl, 'system.pas')));
		compiler.setFile('rtl.js', await fetchText(assetUrl(baseUrl, 'rtl.js')));
		const generated = compiler.compile(String(code || ''));
		if (!diagnose) runGeneratedJavaScript(generated, stdin);
		if (log) console.log('[wasm-idle:pascal-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		if (log) console.error('[wasm-idle:pascal-worker] failed', error);
		self.postMessage({ error: error?.message || String(error) });
	}
};
