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

function executeSource(execute, source, filename, context) {
	return new Promise((resolve) => execute(source, filename, context, resolve));
}

self.onmessage = async (event) => {
	const {
		baseUrl,
		code,
		args = [],
		stdin = '',
		activePath = 'main.cljs',
		workspaceFiles = [],
		log
	} = event.data || {};
	try {
		if (log) console.log(`[wasm-idle:clojurescript-worker] run start baseUrl=${baseUrl}`);
		self.postMessage({ progress: { percent: 5, stage: 'Loading ClojureScript compiler' } });
		const execute = await loadCompiler(baseUrl);
		self.postMessage({ progress: { percent: 35, stage: 'Compiling ClojureScript' } });
		const context = {
			args: Array.isArray(args) ? args.map(String) : [],
			stdin: typeof stdin === 'string' ? stdin : '',
			stdinLines: splitStdinLines(stdin),
			files: buildWorkspaceFiles(code, activePath, workspaceFiles)
		};
		const result = await executeSource(execute, String(code || ''), activePath, context);
		postOutput(result?.stdout);
		if (!result?.ok) {
			throw new Error(result?.stderr || 'ClojureScript evaluation failed.');
		}
		postOutput(result?.stderr);
		self.postMessage({ progress: { percent: 100, stage: 'Finished' } });
		if (log) console.log('[wasm-idle:clojurescript-worker] run settled');
		self.postMessage({ results: true });
	} catch (error) {
		if (log) console.error('[wasm-idle:clojurescript-worker] failed', error);
		self.postMessage({ error: error?.message || String(error) });
	}
};
