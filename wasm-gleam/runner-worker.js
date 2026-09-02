let compilerPromise = null;
let compilerIdentity = '';
let runtimePackPromise = null;
let runtimePackIdentity = '';
let projectCounter = 0;

const maxManifestBytes = 4 * 1024 * 1024;
const maxRuntimeAssetBytes = 128 * 1024 * 1024;
const maxRuntimeAssets = 8_192;
const textEncoder = new TextEncoder();
const fatalTextDecoder = new TextDecoder('utf-8', { fatal: true });
const manifestFormat = 'wasm-gleam-runtime-manifest-v2';
const fingerprintDomain = 'wasm-idle:gleam-runtime-manifest:v2';

function compareCodeUnits(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

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

function versionedAssetUrl(baseUrl, path, fingerprint) {
	const url = new URL(path, baseUrl);
	url.searchParams.set('v', fingerprint);
	return url.href;
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
		throw new Error('Invalid Gleam streaming stdin channel.');
	}

	const control = new Int32Array(channel.buffer, 0, 4);
	const bytes = new Uint8Array(channel.buffer, channel.controlBytes, channel.capacity);
	return () => {
		while (true) {
			if (Atomics.load(control, 3) === 1) {
				throw new Error('Gleam streaming stdin was cancelled.');
			}
			const write = Atomics.load(control, 0);
			const read = Atomics.load(control, 1);
			const available = write - read;
			if (available < 0 || available > bytes.byteLength) {
				throw new Error('Gleam streaming stdin counters are invalid.');
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

function requireHttpUrl(value, label) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${label} URL is invalid.`);
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`${label} URL must use HTTP(S).`);
	}
	if (url.username || url.password || url.hash) {
		throw new Error(`${label} URL must not include credentials or a fragment.`);
	}
	return url;
}

function cancelResponseBody(response, reason) {
	try {
		void Promise.resolve(response.body?.cancel(reason)).catch(() => undefined);
	} catch {
		// Preserve the trust-boundary failure that caused cancellation.
	}
}

async function fetchBoundedBytes(urlValue, label, maxBytes, cache) {
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
		throw new Error(`${label} byte limit is invalid.`);
	}
	const requestUrl = requireHttpUrl(urlValue, label);
	const response = await fetch(requestUrl.href, {
		...(cache ? { cache } : {}),
		credentials: 'omit',
		redirect: 'error',
		referrerPolicy: 'no-referrer'
	});
	try {
		if (response.url) {
			let responseUrl;
			try {
				responseUrl = new URL(response.url);
			} catch {
				throw new Error(`${label} response URL is invalid.`);
			}
			if (responseUrl.href !== requestUrl.href) {
				throw new Error(`${label} response URL does not match the requested asset.`);
			}
		}
		if (!response.ok)
			throw new Error(`${label} request failed with status ${response.status}.`);
		const contentLength = response.headers.get('content-length');
		if (contentLength !== null) {
			const normalized = contentLength.trim();
			const parsed = Number(normalized);
			if (!/^\d+$/u.test(normalized) || !Number.isSafeInteger(parsed)) {
				throw new Error(`${label} has an invalid Content-Length.`);
			}
			if (parsed > maxBytes) throw new Error(`${label} exceeds its byte limit.`);
		}
	} catch (error) {
		cancelResponseBody(response, error);
		throw error;
	}

	if (!response.body) throw new Error(`${label} response does not provide a byte stream.`);

	const reader = response.body.getReader();
	const chunks = [];
	let loaded = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!(value instanceof Uint8Array)) {
				throw new Error(`${label} returned an invalid byte stream.`);
			}
			loaded += value.byteLength;
			if (loaded > maxBytes) throw new Error(`${label} exceeds its byte limit.`);
			chunks.push(value.slice());
		}
	} catch (error) {
		try {
			void Promise.resolve(reader.cancel(error)).catch(() => undefined);
		} catch {
			// Preserve the stream or quota failure.
		}
		throw error;
	} finally {
		try {
			reader.releaseLock();
		} catch {
			// Preserve the primary load result.
		}
	}
	const bytes = new Uint8Array(loaded);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

async function sha256Hex(bytes) {
	if (!globalThis.crypto?.subtle?.digest) {
		throw new Error('Gleam runtime integrity verification requires Web Crypto.');
	}
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function requireAssetPath(value, label) {
	if (
		typeof value !== 'string' ||
		!value ||
		value.length > 512 ||
		!/^[A-Za-z0-9._/-]+$/u.test(value) ||
		value.startsWith('/') ||
		value.split('/').some((part) => !part || part === '.' || part === '..' || part.length > 128)
	) {
		throw new Error(`${label} path is invalid.`);
	}
	return value;
}

function normalizeReceipt(value, label) {
	if (!value || typeof value !== 'object') throw new Error(`${label} receipt is required.`);
	const path = requireAssetPath(value.path, label);
	const size = value.size;
	const sha256 = value.sha256;
	if (!Number.isSafeInteger(size) || size <= 0) {
		throw new Error(`${label} receipt size is invalid.`);
	}
	if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(sha256)) {
		throw new Error(`${label} receipt SHA-256 is invalid.`);
	}
	return { path, size, sha256 };
}

async function receiptFingerprint(receipts, compilerVersion) {
	const canonical = `${fingerprintDomain}\nformat\0${manifestFormat}\ncompilerVersion\0${compilerVersion}\n${receipts
		.map((receipt) => `${receipt.path}\0${receipt.size}\0${receipt.sha256}\n`)
		.join('')}`;
	return await sha256Hex(textEncoder.encode(canonical));
}

async function verifyReceiptBytes(receipt, bytes) {
	if (bytes.byteLength !== receipt.size) {
		throw new Error(`Gleam runtime asset ${receipt.path} has an unexpected byte size.`);
	}
	if ((await sha256Hex(bytes)) !== receipt.sha256) {
		throw new Error(`Gleam runtime asset ${receipt.path} failed SHA-256 verification.`);
	}
}

async function normalizeManifest(value, expectedFingerprint) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Gleam runtime manifest must be an object.');
	}
	if (value.format !== manifestFormat) {
		throw new Error('Gleam runtime manifest format is unsupported.');
	}
	if (
		typeof value.compilerVersion !== 'string' ||
		!/^[A-Za-z0-9._-]{1,64}$/u.test(value.compilerVersion)
	) {
		throw new Error('Gleam runtime compiler version is invalid.');
	}
	if (typeof expectedFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedFingerprint)) {
		throw new Error('Gleam runtime expected fingerprint is invalid.');
	}
	if (value.fingerprint !== expectedFingerprint) {
		throw new Error('Gleam runtime manifest fingerprint does not match the pinned runtime.');
	}
	if (!Array.isArray(value.assets) || value.assets.length === 0) {
		throw new Error('Gleam runtime manifest assets are required.');
	}
	if (value.assets.length > maxRuntimeAssets) {
		throw new Error('Gleam runtime manifest declares too many assets.');
	}
	const receipts = value.assets.map((entry, index) =>
		normalizeReceipt(entry, `Gleam runtime asset ${index}`)
	);
	receipts.sort((left, right) => compareCodeUnits(left.path, right.path));
	const receiptByPath = new Map();
	let totalBytes = 0;
	for (const receipt of receipts) {
		if (receiptByPath.has(receipt.path)) {
			throw new Error(`Gleam runtime manifest duplicates asset ${receipt.path}.`);
		}
		totalBytes += receipt.size;
		if (!Number.isSafeInteger(totalBytes) || totalBytes > maxRuntimeAssetBytes) {
			throw new Error('Gleam runtime assets exceed the aggregate byte limit.');
		}
		receiptByPath.set(receipt.path, receipt);
	}
	if ((await receiptFingerprint(receipts, value.compilerVersion)) !== expectedFingerprint) {
		throw new Error('Gleam runtime receipt graph failed fingerprint verification.');
	}

	if (!Array.isArray(value.files) || value.files.length > 4_096) {
		throw new Error('Gleam runtime source manifest is invalid.');
	}
	const files = [];
	const sourcePaths = new Set();
	const requiredPaths = new Set(['compiler/gleam_wasm.js', 'compiler/gleam_wasm_bg.wasm']);
	for (const entry of value.files) {
		const receipt = normalizeReceipt(entry, 'Gleam source');
		if (sourcePaths.has(receipt.path)) {
			throw new Error(`Gleam source manifest duplicates ${receipt.path}.`);
		}
		sourcePaths.add(receipt.path);
		if (!receipt.path.endsWith('.gleam') && !receipt.path.endsWith('.mjs')) {
			throw new Error(`Gleam source path is unsupported: ${receipt.path}.`);
		}
		const assetPath = `src/${receipt.path}`;
		const assetReceipt = receiptByPath.get(assetPath);
		if (
			!assetReceipt ||
			assetReceipt.size !== receipt.size ||
			assetReceipt.sha256 !== receipt.sha256
		) {
			throw new Error(`Gleam source receipt does not match asset ${assetPath}.`);
		}
		requiredPaths.add(assetPath);
		files.push(receipt);
	}
	if (!Array.isArray(value.javascriptFiles) || value.javascriptFiles.length > 4_096) {
		throw new Error('Gleam JavaScript source manifest is invalid.');
	}
	const javascriptFiles = [];
	const javascriptPaths = new Set();
	for (const valuePath of value.javascriptFiles) {
		const path = requireAssetPath(valuePath, 'Gleam JavaScript source');
		if (javascriptPaths.has(path)) {
			throw new Error(`Gleam JavaScript source manifest duplicates ${path}.`);
		}
		javascriptPaths.add(path);
		if (!path.endsWith('.mjs')) {
			throw new Error(`Gleam JavaScript source path is unsupported: ${path}.`);
		}
		const assetPath = `javascript/${path}`;
		if (!receiptByPath.has(assetPath)) {
			throw new Error(`Gleam JavaScript source receipt is missing for ${assetPath}.`);
		}
		requiredPaths.add(assetPath);
		javascriptFiles.push(path);
	}
	if (
		requiredPaths.size !== receiptByPath.size ||
		[...requiredPaths].some((path) => !receiptByPath.has(path))
	) {
		throw new Error('Gleam runtime manifest asset allowlist is inconsistent.');
	}
	return { ...value, assets: receipts, files, javascriptFiles, receiptByPath };
}

async function loadManifest(manifestUrl, baseUrl, expectedFingerprint) {
	const identity = JSON.stringify([baseUrl, manifestUrl, expectedFingerprint]);
	if (runtimePackIdentity === identity && runtimePackPromise) return await runtimePackPromise;
	if (runtimePackIdentity) {
		throw new Error('Gleam runtime profile cannot change inside a warm worker.');
	}
	const runtimePack = await (async () => {
		const manifestBytes = await fetchBoundedBytes(
			manifestUrl,
			'Gleam runtime manifest',
			maxManifestBytes,
			'no-store'
		);
		let parsed;
		try {
			parsed = JSON.parse(fatalTextDecoder.decode(manifestBytes));
		} catch {
			throw new Error('Gleam runtime manifest is not valid UTF-8 JSON.');
		}
		const manifest = await normalizeManifest(parsed, expectedFingerprint);
		const assetBytes = new Map();
		for (const receipt of manifest.assets) {
			const bytes = await fetchBoundedBytes(
				versionedAssetUrl(baseUrl, receipt.path, expectedFingerprint),
				`Gleam runtime asset ${receipt.path}`,
				receipt.size
			);
			await verifyReceiptBytes(receipt, bytes);
			assetBytes.set(receipt.path, bytes);
		}
		return { ...manifest, assetBytes };
	})();
	runtimePackIdentity = identity;
	runtimePackPromise = Promise.resolve(runtimePack);
	return await runtimePackPromise;
}

async function loadCompiler(baseUrl, manifest) {
	const identity = JSON.stringify([baseUrl, manifest.fingerprint]);
	if (compilerIdentity === identity && compilerPromise) return await compilerPromise;
	if (compilerIdentity) {
		throw new Error('Gleam compiler profile cannot change inside a warm worker.');
	}
	const compiler = await (async () => {
		const moduleBytes = manifest.assetBytes.get('compiler/gleam_wasm.js');
		const wasmBytes = manifest.assetBytes.get('compiler/gleam_wasm_bg.wasm');
		if (!moduleBytes || !wasmBytes) throw new Error('Gleam compiler assets are unavailable.');
		if (
			typeof URL.createObjectURL !== 'function' ||
			typeof URL.revokeObjectURL !== 'function'
		) {
			throw new Error('Gleam compiler verification requires Blob URL support.');
		}
		const moduleUrl = URL.createObjectURL(new Blob([moduleBytes], { type: 'text/javascript' }));
		let compiler;
		try {
			compiler = await import(moduleUrl);
		} finally {
			try {
				URL.revokeObjectURL(moduleUrl);
			} catch {
				// Blob URL cleanup must not replace the verified import outcome.
			}
		}
		if (typeof compiler.default !== 'function') {
			throw new Error('Gleam compiler module does not export an initializer.');
		}
		await compiler.default(wasmBytes);
		return compiler;
	})();
	compilerIdentity = identity;
	compilerPromise = Promise.resolve(compiler);
	return await compilerPromise;
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

async function collectStdlibSources(manifest) {
	const sources = new Map();
	for (const entry of manifest.files) {
		const bytes = manifest.assetBytes.get(`src/${entry.path}`);
		if (!bytes) throw new Error(`Gleam source asset is unavailable: ${entry.path}.`);
		sources.set(entry.path, fatalTextDecoder.decode(bytes));
	}
	return sources;
}

async function collectJavascriptSources(manifest) {
	const sources = new Map();
	for (const path of manifest.javascriptFiles) {
		const bytes = manifest.assetBytes.get(`javascript/${path}`);
		if (!bytes) throw new Error(`Gleam JavaScript asset is unavailable: ${path}.`);
		sources.set(path, fatalTextDecoder.decode(bytes));
	}
	return sources;
}

async function buildModuleSources(compiler, projectId, manifest, code, workspaceFiles) {
	const stdlibSources = await collectStdlibSources(manifest);
	const javascriptSources = await collectJavascriptSources(manifest);
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
	const {
		baseUrl,
		manifestUrl,
		manifestFingerprint,
		code,
		stdin,
		stdinChannel,
		workspaceFiles = [],
		log
	} = event.data || {};
	const projectId = ++projectCounter;
	const executionId = `wasm_idle_${Date.now()}_${projectId}`;
	const originalLog = console.log;
	const originalError = console.error;
	let compiler;
	let projectAllocated = false;
	let failed = false;
	let failure;
	console.log = (...args) => {
		self.postMessage({ output: `${args.map(String).join(' ')}\n` });
	};
	console.error = (...args) => {
		self.postMessage({ output: `${args.map(String).join(' ')}\n` });
	};
	try {
		globalThis.__wasmIdleReadLine = createLineReader(stdin, stdinChannel);
		if (log) {
			originalLog(`[wasm-idle:gleam-worker] compile start baseUrl=${baseUrl}`);
		}
		const manifest = await loadManifest(
			manifestUrl || assetUrl(baseUrl, 'source-manifest.v2.json'),
			baseUrl,
			manifestFingerprint
		);
		compiler = await loadCompiler(baseUrl, manifest);
		projectAllocated = true;
		compiler.reset_filesystem(projectId);
		const { moduleSources } = await buildModuleSources(
			compiler,
			projectId,
			manifest,
			code,
			workspaceFiles
		);
		await executeMain(moduleSources, baseUrl, executionId);
	} catch (error) {
		failed = true;
		failure = error;
	} finally {
		if (compiler && projectAllocated) {
			try {
				await compiler.delete_project(projectId);
			} catch (cleanupError) {
				if (!failed) {
					failed = true;
					failure = cleanupError;
				} else if (log) {
					originalError('[wasm-idle:gleam-worker] project cleanup failed', cleanupError);
				}
			}
		}
		console.log = originalLog;
		console.error = originalError;
		delete globalThis.__wasmIdleReadLine;
	}
	if (failed) {
		if (log) {
			originalError('[wasm-idle:gleam-worker] failed', failure);
		}
		self.postMessage({ error: failure?.message || String(failure) });
		return;
	}
	if (log) {
		originalLog('[wasm-idle:gleam-worker] run settled');
	}
	self.postMessage({ results: true });
};
