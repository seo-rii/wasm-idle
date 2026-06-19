let compilerPromise = null;
let projectCounter = 0;

const stdinModuleSource = `@external(javascript, "./stdin_ffi.mjs", "read_line")
pub fn read_line() -> String
`;

const stdinFfiSource = `export function read_line() {
  return globalThis.__wasmIdleReadLine();
}
`;

function assetUrl(baseUrl, path) {
	return new URL(path, baseUrl).href;
}

function normalizeWorkspacePath(path) {
	const parts = [];
	for (const part of String(path || '')
		.replace(/^\/+/, '')
		.split('/')) {
		if (!part || part === '.' || part === '..' || part.includes('\0')) continue;
		parts.push(part);
	}
	return parts.join('/');
}

function moduleNameFromPath(path) {
	const normalized = normalizeWorkspacePath(path);
	if (!normalized.endsWith('.gleam')) return '';
	const withoutPrefix = normalized.startsWith('src/') ? normalized.slice(4) : normalized;
	return withoutPrefix.slice(0, -'.gleam'.length);
}

function createLineReader(stdin) {
	const text = typeof stdin === 'string' ? stdin : '';
	let offset = 0;
	return () => {
		if (offset >= text.length) return '';
		let end = text.indexOf('\n', offset);
		if (end === -1) end = text.length;
		const line = text.slice(offset, end).replace(/\r$/, '');
		offset = end < text.length ? end + 1 : end;
		return line;
	};
}

async function loadCompiler(baseUrl) {
	if (compilerPromise) return compilerPromise;
	compilerPromise = (async () => {
		const compiler = await import(assetUrl(baseUrl, 'compiler/gleam_wasm.js'));
		await compiler.default(assetUrl(baseUrl, 'compiler/gleam_wasm_bg.wasm'));
		return compiler;
	})();
	return await compilerPromise;
}

async function loadManifest(manifestUrl) {
	const response = await fetch(manifestUrl, { cache: 'no-store' });
	if (!response.ok) {
		throw new Error(`Failed to load Gleam source manifest: ${response.status}`);
	}
	return await response.json();
}

async function fetchText(url) {
	const response = await fetch(url);
	if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
	return await response.text();
}

function resolveRelativeModule(fromPath, specifier) {
	const resolved = new URL(specifier, `https://wasm-idle.invalid/${fromPath}`).pathname.slice(1);
	return resolved || specifier;
}

function rewriteImports(source, fromPath, toBlobUrl) {
	return source.replace(
		/((?:import|export)\s+(?:[^'"]*?\s+from\s+)?["']|import\s*\(\s*["'])(\.{1,2}\/[^"']+)(["'])/g,
		(_match, prefix, specifier, suffix) =>
			`${prefix}${toBlobUrl(resolveRelativeModule(fromPath, specifier))}${suffix}`
	);
}

async function collectStdlibSources(baseUrl, manifest) {
	const sources = new Map();
	const files = Array.isArray(manifest.files) ? manifest.files : [];
	for (const entry of files) {
		const path = typeof entry === 'string' ? entry : entry?.path;
		if (!path || (!path.endsWith('.gleam') && !path.endsWith('.mjs'))) continue;
		sources.set(path, await fetchText(assetUrl(baseUrl, `src/${path}`)));
	}
	return sources;
}

async function collectJavascriptSources(baseUrl, manifest) {
	const sources = new Map();
	const files = Array.isArray(manifest.javascriptFiles) ? manifest.javascriptFiles : [];
	for (const path of files) {
		if (typeof path !== 'string' || !path.endsWith('.mjs')) continue;
		sources.set(path, await fetchText(assetUrl(baseUrl, `javascript/${path}`)));
	}
	return sources;
}

async function buildModuleSources(compiler, projectId, baseUrl, manifest, code, workspaceFiles) {
	const stdlibSources = await collectStdlibSources(baseUrl, manifest);
	const javascriptSources = await collectJavascriptSources(baseUrl, manifest);
	compiler.reset_filesystem(projectId);
	compiler.write_file(
		projectId,
		'/gleam.toml',
		'name = "wasm_idle"\\nversion = "0.1.0"\\ntarget = "javascript"\\n'
	);

	const nativeSources = new Map();
	const stdlibModules = new Set(['gleam']);
	const gleamModules = new Set(['main', 'wasm_idle/stdin']);
	for (const [path, source] of stdlibSources) {
		if (path.endsWith('.gleam')) {
			compiler.write_file(projectId, `/src/${path}`, source);
			stdlibModules.add(path.slice(0, -'.gleam'.length));
		} else if (path.endsWith('.mjs')) {
			nativeSources.set(path, source);
			compiler.write_file(projectId, `/src/${path}`, source);
		}
	}

	for (const file of workspaceFiles || []) {
		const moduleName = moduleNameFromPath(file.path);
		if (!moduleName || moduleName === 'main') continue;
		const targetPath = `/src/${moduleName}.gleam`;
		compiler.write_file(projectId, targetPath, file.content);
		gleamModules.add(moduleName);
	}

	compiler.write_file(projectId, '/src/wasm_idle/stdin.gleam', stdinModuleSource);
	compiler.write_file(projectId, '/src/wasm_idle/stdin_ffi.mjs', stdinFfiSource);
	compiler.write_module(projectId, 'main', code);
	compiler.compile_package(projectId, 'javascript');

	const moduleSources = new Map(javascriptSources);
	for (const [path, source] of nativeSources) {
		if (!moduleSources.has(path)) moduleSources.set(path, source);
	}
	moduleSources.set('wasm_idle/stdin_ffi.mjs', stdinFfiSource);
	for (const moduleName of new Set([...stdlibModules, ...gleamModules])) {
		try {
			const javascript = compiler.read_compiled_javascript(projectId, moduleName);
			if (typeof javascript === 'string') moduleSources.set(`${moduleName}.mjs`, javascript);
		} catch {
			// The compiler only emits JavaScript for modules reachable from the current package.
		}
	}
	return { moduleSources };
}

async function executeMain(moduleSources, baseUrl, projectId) {
	if (!globalThis.caches) {
		throw new Error('Gleam browser execution requires Cache Storage for generated modules.');
	}
	const moduleBaseUrl = assetUrl(baseUrl, `../__wasm_idle_dynamic_modules__/${projectId}/`);
	const cache = await caches.open('wasm-idle-dynamic-modules-v1');
	const moduleUrls = [];
	const moduleUrl = (path) => {
		const normalized = normalizeWorkspacePath(path);
		if (!normalized.endsWith('.mjs')) {
			throw new Error(`Invalid Gleam JavaScript module path: ${path}`);
		}
		return new URL(normalized, moduleBaseUrl).href;
	};

	try {
		for (const [path, source] of moduleSources) {
			if (typeof source !== 'string') continue;
			const url = moduleUrl(path);
			moduleUrls.push(url);
			await cache.put(
				new Request(url),
				new Response(rewriteImports(source, path, moduleUrl), {
					headers: {
						'content-type': 'application/javascript'
					}
				})
			);
		}
		const main = await import(moduleUrl('main.mjs'));
		if (typeof main.main === 'function') await main.main();
	} finally {
		await Promise.all(moduleUrls.map((url) => cache.delete(new Request(url))));
	}
}

self.onmessage = async (event) => {
	const { baseUrl, manifestUrl, code, stdin, workspaceFiles = [], log } = event.data || {};
	const projectId = `wasm_idle_${Date.now()}_${++projectCounter}`;
	const readLine = createLineReader(stdin);
	const originalLog = console.log;
	const originalError = console.error;
	globalThis.__wasmIdleReadLine = readLine;
	console.log = (...args) => {
		self.postMessage({ output: `${args.map(String).join(' ')}\n` });
	};
	console.error = (...args) => {
		self.postMessage({ output: `${args.map(String).join(' ')}\n` });
	};
	try {
		if (log) {
			originalLog(`[wasm-idle:gleam-worker] compile start baseUrl=${baseUrl}`);
		}
		const compiler = await loadCompiler(baseUrl);
		const manifest = await loadManifest(
			manifestUrl || assetUrl(baseUrl, 'source-manifest.v1.json')
		);
		const { moduleSources } = await buildModuleSources(
			compiler,
			projectId,
			baseUrl,
			manifest,
			code,
			workspaceFiles
		);
		await executeMain(moduleSources, baseUrl, projectId);
		if (log) {
			originalLog('[wasm-idle:gleam-worker] run settled');
		}
		self.postMessage({ results: true });
	} catch (error) {
		if (log) {
			originalError('[wasm-idle:gleam-worker] failed', error);
		}
		self.postMessage({ error: error?.message || String(error) });
	} finally {
		console.log = originalLog;
		console.error = originalError;
		delete globalThis.__wasmIdleReadLine;
	}
};
