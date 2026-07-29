import type { MemoryFileSystem } from './fs/memory-fs.js';
import type { SystemDispatcher } from './system-dispatch.js';

export type BrowserNativeManifestFile = {
	path: string;
	url?: string;
	size: number;
};

export type BrowserNativeManifestRuntimePack = {
	format: 'wasm-of-js-of-ocaml-browser-native-runtime-pack-v1';
	asset: string;
	index: string;
	fileCount: number;
	totalBytes: number;
};

export type BrowserNativeManifestPackage = {
	name: string;
	rootPath: string;
	metaPath?: string;
	archiveBytePath?: string;
	requires: string[];
	files: BrowserNativeManifestFile[];
};

export type BrowserNativeManifest = {
	version: 1;
	generatedAt: string;
	switchPrefix: string;
	findlibConf: string;
	tools: {
		ocamlc: string;
		js_of_ocaml: string;
		wasm_of_ocaml: string;
	};
	binaryenTools?: {
		wasm_opt: string;
		wasm_merge: string;
		wasm_metadce: string;
	};
	toolPatches?: Record<string, unknown>;
	runtimePack?: BrowserNativeManifestRuntimePack;
	ocamlLibFiles: BrowserNativeManifestFile[];
	packages: BrowserNativeManifestPackage[];
};

export type BrowserNativeRuntimePackEntry = {
	offset: number;
	length: number;
};

export type BrowserNativeRuntimePackCache = {
	bytes: Uint8Array<ArrayBuffer>;
	entries: Map<string, BrowserNativeRuntimePackEntry>;
};

export type BrowserNativeRuntimeAssetLimits = {
	maxAssetBytes?: number;
	maxMetadataBytes?: number;
	maxEntries?: number;
	maxEntryBytes?: number;
	maxPathBytes?: number;
};

export type BrowserNativeRuntimeAssetOptions = {
	baseUrl?: string | URL;
	fetch?: typeof fetch;
	limits?: BrowserNativeRuntimeAssetLimits;
	signal?: AbortSignal;
};

type BrowserToolPreloadFile = {
	path: string;
	url?: string;
	text?: string;
	bytes?: ArrayBuffer;
};

type BrowserToolResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
	thrown?: string;
	files: Array<{
		path: string;
		data: Uint8Array;
	}>;
};

type WorkerResponse = {
	type: 'tool-result';
	exitCode: number;
	stdout: string;
	stderr: string;
	thrown?: string;
	files: Array<{
		path: string;
		data: ArrayBuffer;
	}>;
};

const DEFAULT_MAX_RUNTIME_ASSET_BYTES = 128 * 1024 * 1024;
const DEFAULT_MAX_RUNTIME_METADATA_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_RUNTIME_PACK_ENTRIES = 4096;
const DEFAULT_MAX_RUNTIME_PACK_ENTRY_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_RUNTIME_PACK_PATH_BYTES = 1024;
const DEFAULT_RUNTIME_ASSET_BUFFER_BYTES = 64 * 1024;
const RUNTIME_PACK_FORMAT = 'wasm-of-js-of-ocaml-browser-native-runtime-pack-v1';
const RUNTIME_PACK_INDEX_FORMAT = 'wasm-of-js-of-ocaml-browser-native-runtime-pack-index-v1';

type ResolvedRuntimeAssetLimits = Required<BrowserNativeRuntimeAssetLimits>;

function resolveRuntimeAssetLimits(
	limits: BrowserNativeRuntimeAssetLimits = {}
): ResolvedRuntimeAssetLimits {
	const resolved = {
		maxAssetBytes: limits.maxAssetBytes ?? DEFAULT_MAX_RUNTIME_ASSET_BYTES,
		maxMetadataBytes: limits.maxMetadataBytes ?? DEFAULT_MAX_RUNTIME_METADATA_BYTES,
		maxEntries: limits.maxEntries ?? DEFAULT_MAX_RUNTIME_PACK_ENTRIES,
		maxEntryBytes: limits.maxEntryBytes ?? DEFAULT_MAX_RUNTIME_PACK_ENTRY_BYTES,
		maxPathBytes: limits.maxPathBytes ?? DEFAULT_MAX_RUNTIME_PACK_PATH_BYTES
	};
	for (const [name, value] of Object.entries(resolved)) {
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw new TypeError(`${name} must be a positive safe integer`);
		}
	}
	return resolved;
}

function abortReason(signal: AbortSignal) {
	return (
		signal.reason ?? new DOMException('browser-native runtime asset load aborted', 'AbortError')
	);
}

function throwIfAborted(signal?: AbortSignal) {
	if (signal?.aborted) throw abortReason(signal);
}

async function readBoundedStream(
	stream: ReadableStream<Uint8Array>,
	label: string,
	maxBytes: number,
	signal?: AbortSignal,
	declaredLength?: number
): Promise<Uint8Array<ArrayBuffer>> {
	const reader = stream.getReader();
	const cancelOnAbort = () => {
		void reader.cancel(abortReason(signal!)).catch(() => {});
	};
	signal?.addEventListener('abort', cancelOnAbort, { once: true });
	let bytes: Uint8Array<ArrayBuffer> = new Uint8Array(
		Math.min(maxBytes, Math.max(declaredLength ?? DEFAULT_RUNTIME_ASSET_BUFFER_BYTES, 1))
	);
	let receivedLength = 0;
	let readerCancelled = false;
	try {
		throwIfAborted(signal);
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			const nextLength = receivedLength + value.byteLength;
			if (nextLength > maxBytes) {
				try {
					await reader.cancel();
				} catch {
					// Preserve the size-limit failure.
				}
				readerCancelled = true;
				throw new Error(`${label} exceeds the ${maxBytes} byte limit`);
			}
			if (nextLength > bytes.byteLength) {
				const nextCapacity = Math.min(
					maxBytes,
					Math.max(nextLength, Math.max(bytes.byteLength * 2, 1))
				);
				const grown = new Uint8Array(nextCapacity);
				grown.set(bytes.subarray(0, receivedLength));
				bytes = grown;
			}
			bytes.set(value, receivedLength);
			receivedLength = nextLength;
		}
		throwIfAborted(signal);
		return receivedLength === bytes.byteLength ? bytes : bytes.slice(0, receivedLength);
	} catch (error) {
		if (!readerCancelled) await reader.cancel(error).catch(() => {});
		if (signal?.aborted) throw abortReason(signal);
		throw error;
	} finally {
		signal?.removeEventListener('abort', cancelOnAbort);
		reader.releaseLock();
	}
}

async function fetchBoundedRuntimeAsset(
	value: string,
	label: string,
	maxBytes: number,
	options: BrowserNativeRuntimeAssetOptions
): Promise<Uint8Array<ArrayBuffer>> {
	throwIfAborted(options.signal);
	const configuredBase = options.baseUrl;
	const baseUrl =
		configuredBase instanceof URL
			? configuredBase.href
			: configuredBase || globalThis.location?.href;
	let requestUrl: URL;
	try {
		requestUrl = baseUrl ? new URL(value, baseUrl) : new URL(value);
	} catch {
		throw new Error(`invalid browser-native runtime asset URL: ${value}`);
	}
	if (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') {
		throw new Error(
			`unsupported browser-native runtime asset URL scheme: ${requestUrl.protocol}`
		);
	}
	if (requestUrl.username || requestUrl.password || requestUrl.hash) {
		throw new Error(
			'browser-native runtime asset URLs must not include credentials or fragments'
		);
	}
	if (/%2f|%5c/iu.test(requestUrl.pathname)) {
		throw new Error(
			'browser-native runtime asset URLs must not include encoded path separators'
		);
	}
	const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
	if (!fetchImpl) throw new Error(`fetch is required to load ${label}`);
	const requestInit: RequestInit = {
		cache: 'no-store',
		credentials: 'omit',
		redirect: 'error',
		referrerPolicy: 'no-referrer'
	};
	if (options.signal) requestInit.signal = options.signal;
	let response: Response;
	try {
		response = await fetchImpl(requestUrl.href, requestInit);
	} catch (error) {
		if (options.signal?.aborted) throw abortReason(options.signal);
		throw new Error(
			`failed to fetch ${label}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error }
		);
	}
	if (options.signal?.aborted) {
		try {
			await response.body?.cancel();
		} catch {
			// Preserve the cancellation reason.
		}
		throw abortReason(options.signal);
	}
	if (response.url) {
		let finalUrl: URL;
		try {
			finalUrl = new URL(response.url, requestUrl);
		} catch {
			try {
				await response.body?.cancel();
			} catch {
				// Preserve the invalid-URL failure.
			}
			throw new Error(`${label} returned an invalid final URL: ${response.url}`);
		}
		if (finalUrl.href !== requestUrl.href) {
			try {
				await response.body?.cancel();
			} catch {
				// Preserve the final-URL mismatch.
			}
			throw new Error(
				`${label} final URL mismatch: expected ${requestUrl.href}, received ${finalUrl.href}`
			);
		}
	}
	if (!response.ok) {
		try {
			await response.body?.cancel();
		} catch {
			// Preserve the HTTP failure.
		}
		throw new Error(`failed to fetch ${label}: HTTP ${response.status}`);
	}

	const rawContentLength = response.headers.get('content-length');
	let contentLength: number | undefined;
	if (rawContentLength !== null) {
		const normalized = rawContentLength.trim();
		const parsed = Number(normalized);
		if (!/^\d+$/u.test(normalized) || !Number.isSafeInteger(parsed)) {
			try {
				await response.body?.cancel();
			} catch {
				// Preserve the invalid-length failure.
			}
			throw new Error(`${label} has an invalid Content-Length`);
		}
		contentLength = parsed;
	}
	if (contentLength !== undefined && contentLength > maxBytes) {
		try {
			await response.body?.cancel();
		} catch {
			// Preserve the size-limit failure.
		}
		throw new Error(`${label} exceeds the ${maxBytes} byte limit`);
	}
	if (!response.body) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		throwIfAborted(options.signal);
		if (bytes.byteLength > maxBytes) {
			throw new Error(`${label} exceeds the ${maxBytes} byte limit`);
		}
		return bytes;
	}
	return readBoundedStream(response.body, label, maxBytes, options.signal, contentLength);
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	let source: string;
	try {
		source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (error) {
		throw new Error(`${label} is not valid UTF-8`, { cause: error });
	}
	try {
		return JSON.parse(source) as unknown;
	} catch (error) {
		throw new Error(`${label} is not valid JSON`, { cause: error });
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateRuntimePackPath(path: string, maxPathBytes: number) {
	if (new TextEncoder().encode(path).byteLength > maxPathBytes) {
		throw new Error(`browser-native runtime pack path exceeds ${maxPathBytes} bytes: ${path}`);
	}
	if (
		!path.startsWith('/static/toolchain/') ||
		path.includes('\\') ||
		Array.from(path).some((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint <= 0x1f || codePoint === 0x7f;
		})
	) {
		throw new Error(`unsafe browser-native runtime pack path: ${path}`);
	}
	const parts = path.slice(1).split('/');
	if (parts.some((part) => !part || part === '.' || part === '..')) {
		throw new Error(`unsafe browser-native runtime pack path: ${path}`);
	}
	return path;
}

function expectedRuntimePackFiles(
	manifest: BrowserNativeManifest,
	limits: ResolvedRuntimeAssetLimits
) {
	if (!Array.isArray(manifest.ocamlLibFiles) || !Array.isArray(manifest.packages)) {
		throw new Error('invalid browser-native runtime manifest file lists');
	}
	const files: unknown[] = [...manifest.ocamlLibFiles];
	for (const manifestPackage of manifest.packages) {
		if (!isRecord(manifestPackage) || !Array.isArray(manifestPackage.files)) {
			throw new Error('invalid browser-native runtime manifest package files');
		}
		files.push(...manifestPackage.files);
	}
	if (files.length > limits.maxEntries) {
		throw new Error(`browser-native runtime pack exceeds the ${limits.maxEntries} entry limit`);
	}
	const expected = new Map<string, number>();
	for (const file of files) {
		if (!isRecord(file) || typeof file.path !== 'string') {
			throw new Error('invalid browser-native runtime manifest file');
		}
		const path = validateRuntimePackPath(file.path, limits.maxPathBytes);
		if (!Number.isSafeInteger(file.size) || (file.size as number) <= 0) {
			throw new Error(`invalid browser-native runtime manifest size for ${path}`);
		}
		const size = file.size as number;
		if (size > limits.maxEntryBytes) {
			throw new Error(
				`browser-native runtime pack entry ${path} exceeds the ${limits.maxEntryBytes} byte limit`
			);
		}
		if (expected.has(path)) {
			throw new Error(`duplicate browser-native runtime manifest path: ${path}`);
		}
		expected.set(path, size);
	}
	return expected;
}

function toArrayBuffer(data: Uint8Array) {
	const copy = new Uint8Array(data.byteLength);
	copy.set(data);
	return copy.buffer;
}

function toToolchainPath(path: string) {
	return path;
}

function isSourceArg(value: string) {
	return /^\/workspace\/.+\.(ml|mli|cmo|cma|cmi)$/.test(value);
}

function resolvePackageClosure(
	packages: string[],
	packageMap: Map<string, BrowserNativeManifestPackage>
) {
	const resolved: BrowserNativeManifestPackage[] = [];
	const visited = new Set<string>();
	const visit = (packageName: string) => {
		if (visited.has(packageName)) {
			return;
		}
		const manifestPackage = packageMap.get(packageName);
		if (!manifestPackage) {
			throw new Error(`browser-native bundle does not include package: ${packageName}`);
		}
		visited.add(packageName);
		for (const dependency of manifestPackage.requires) {
			visit(dependency);
		}
		resolved.push(manifestPackage);
	};
	for (const packageName of packages) {
		visit(packageName);
	}
	return resolved;
}

function expandOcamlfindInvocation(
	argv: string[],
	packageMap: Map<string, BrowserNativeManifestPackage>
) {
	if (argv[1] !== 'ocamlc') {
		throw new Error(`unsupported browser-native ocamlfind subcommand: ${argv[1] || '(none)'}`);
	}

	const packages: string[] = [];
	const forwardedArgs: string[] = [];
	let linkpkg = false;
	for (let index = 2; index < argv.length; index += 1) {
		const argument = argv[index] || '';
		if (argument === '-package') {
			const value = argv[index + 1] || '';
			index += 1;
			for (const packageName of value
				.split(',')
				.map((entry) => entry.trim())
				.filter(Boolean)) {
				packages.push(packageName);
			}
			continue;
		}
		if (argument === '-linkpkg') {
			linkpkg = true;
			continue;
		}
		forwardedArgs.push(argument);
	}

	const resolvedPackages = resolvePackageClosure(packages, packageMap);
	const includeArgs = resolvedPackages.flatMap((manifestPackage) => [
		'-I',
		toToolchainPath(manifestPackage.rootPath)
	]);
	const archiveArgs = linkpkg
		? resolvedPackages.flatMap((manifestPackage) =>
				manifestPackage.archiveBytePath
					? [toToolchainPath(manifestPackage.archiveBytePath)]
					: []
			)
		: [];
	const firstSourceIndex = forwardedArgs.findIndex((argument) => isSourceArg(argument));
	const beforeSources =
		firstSourceIndex >= 0 ? forwardedArgs.slice(0, firstSourceIndex) : forwardedArgs;
	const sourceArgs = firstSourceIndex >= 0 ? forwardedArgs.slice(firstSourceIndex) : [];

	return {
		command: 'ocamlc' as const,
		argv: [...includeArgs, ...beforeSources, ...archiveArgs, ...sourceArgs],
		packages: resolvedPackages
	};
}

function getFilePreloadsFromFs(fs: MemoryFileSystem, prefix: '/workspace' | '/tmp') {
	return fs.listFiles(prefix).map((filePath) => ({
		path: filePath,
		bytes: toArrayBuffer(fs.readFile(filePath))
	}));
}

function getToolchainPreloads(
	command: 'ocamlc' | 'js_of_ocaml' | 'wasm_of_ocaml',
	manifest: BrowserNativeManifest,
	packages: BrowserNativeManifestPackage[],
	runtimePack: BrowserNativeRuntimePackCache | null
) {
	const selectedPackages = command === 'ocamlc' ? packages : [];
	const selectedOcamlLibFiles = manifest.ocamlLibFiles.filter(
		(file) =>
			!file.path.includes('/compiler-libs/') &&
			!file.path.includes('/ocamldoc/') &&
			!file.path.includes('/runtime_events/')
	);
	return [
		...selectedOcamlLibFiles.map((file) => {
			const packedEntry = runtimePack?.entries.get(file.path);
			if (packedEntry) {
				const packedBytes = runtimePack!.bytes.subarray(
					packedEntry.offset,
					packedEntry.offset + packedEntry.length
				);
				const copiedBytes = new Uint8Array(packedBytes.byteLength);
				copiedBytes.set(packedBytes);
				return {
					path: toToolchainPath(file.path),
					bytes: copiedBytes.buffer
				};
			}
			if (!file.url) {
				throw new Error(`missing browser-native preload URL for ${file.path}`);
			}
			return {
				path: toToolchainPath(file.path),
				url: file.url
			};
		}),
		...selectedPackages.flatMap((manifestPackage) =>
			manifestPackage.files.map((file) => {
				const packedEntry = runtimePack?.entries.get(file.path);
				if (packedEntry) {
					const packedBytes = runtimePack!.bytes.subarray(
						packedEntry.offset,
						packedEntry.offset + packedEntry.length
					);
					const copiedBytes = new Uint8Array(packedBytes.byteLength);
					copiedBytes.set(packedBytes);
					return {
						path: toToolchainPath(file.path),
						bytes: copiedBytes.buffer
					};
				}
				if (!file.url) {
					throw new Error(`missing browser-native preload URL for ${file.path}`);
				}
				return {
					path: toToolchainPath(file.path),
					url: file.url
				};
			})
		),
		{
			path: '/static/toolchain/findlib.conf',
			url: manifest.findlibConf
		}
	];
}

export async function fetchBrowserNativeManifest(options: BrowserNativeRuntimeAssetOptions = {}) {
	const limits = resolveRuntimeAssetLimits(options.limits);
	const bytes = await fetchBoundedRuntimeAsset(
		'/.cache/browser-native-bundle/browser-native-manifest.v1.json',
		'browser-native runtime manifest',
		limits.maxMetadataBytes,
		options
	);
	const parsed = parseJson(bytes, 'browser-native runtime manifest');
	if (
		!isRecord(parsed) ||
		parsed.version !== 1 ||
		!Array.isArray(parsed.ocamlLibFiles) ||
		!Array.isArray(parsed.packages)
	) {
		throw new Error('invalid browser-native runtime manifest');
	}
	const manifest = parsed as BrowserNativeManifest;
	expectedRuntimePackFiles(manifest, limits);
	return manifest;
}

export async function loadBrowserNativeRuntimePack(
	manifest: BrowserNativeManifest,
	options: BrowserNativeRuntimeAssetOptions = {}
): Promise<BrowserNativeRuntimePackCache | null> {
	if (!manifest.runtimePack) return null;
	const limits = resolveRuntimeAssetLimits(options.limits);
	const runtimePack = manifest.runtimePack;
	const expectedFiles = expectedRuntimePackFiles(manifest, limits);
	if (
		runtimePack.format !== RUNTIME_PACK_FORMAT ||
		typeof runtimePack.asset !== 'string' ||
		!runtimePack.asset ||
		typeof runtimePack.index !== 'string' ||
		!runtimePack.index
	) {
		throw new Error('invalid browser-native runtime pack metadata');
	}
	if (
		!Number.isSafeInteger(runtimePack.fileCount) ||
		runtimePack.fileCount <= 0 ||
		runtimePack.fileCount > limits.maxEntries
	) {
		throw new Error('invalid browser-native runtime pack file count');
	}
	if (
		!Number.isSafeInteger(runtimePack.totalBytes) ||
		runtimePack.totalBytes <= 0 ||
		runtimePack.totalBytes > limits.maxAssetBytes
	) {
		throw new Error(
			`browser-native runtime pack declares an invalid or oversized expanded size`
		);
	}
	if (runtimePack.fileCount !== expectedFiles.size) {
		throw new Error('browser-native runtime pack file count does not match the manifest');
	}
	let expectedTotalBytes = 0;
	for (const size of expectedFiles.values()) {
		expectedTotalBytes += size;
		if (!Number.isSafeInteger(expectedTotalBytes)) {
			throw new Error('browser-native runtime manifest has an invalid aggregate size');
		}
	}
	if (runtimePack.totalBytes !== expectedTotalBytes) {
		throw new Error('browser-native runtime pack size does not match the manifest');
	}

	const indexBytes = await fetchBoundedRuntimeAsset(
		runtimePack.index,
		'browser-native runtime pack index',
		limits.maxMetadataBytes,
		options
	);
	const parsedIndex = parseJson(indexBytes, 'browser-native runtime pack index');
	if (
		!isRecord(parsedIndex) ||
		parsedIndex.format !== RUNTIME_PACK_INDEX_FORMAT ||
		!Number.isSafeInteger(parsedIndex.fileCount) ||
		parsedIndex.fileCount !== runtimePack.fileCount ||
		!Number.isSafeInteger(parsedIndex.totalBytes) ||
		parsedIndex.totalBytes !== runtimePack.totalBytes ||
		!Array.isArray(parsedIndex.entries) ||
		parsedIndex.entries.length !== runtimePack.fileCount
	) {
		throw new Error('invalid browser-native runtime pack index');
	}

	const entries = new Map<string, BrowserNativeRuntimePackEntry>();
	let nextOffset = 0;
	for (const value of parsedIndex.entries) {
		if (
			!isRecord(value) ||
			typeof value.runtimePath !== 'string' ||
			!Number.isSafeInteger(value.offset) ||
			!Number.isSafeInteger(value.length)
		) {
			throw new Error('invalid browser-native runtime pack entry');
		}
		const path = validateRuntimePackPath(value.runtimePath, limits.maxPathBytes);
		const offset = value.offset as number;
		const length = value.length as number;
		if (offset !== nextOffset || length <= 0) {
			throw new Error(`browser-native runtime pack entry is not contiguous: ${path}`);
		}
		if (length > limits.maxEntryBytes) {
			throw new Error(
				`browser-native runtime pack entry ${path} exceeds the ${limits.maxEntryBytes} byte limit`
			);
		}
		if (entries.has(path)) {
			throw new Error(`duplicate browser-native runtime pack path: ${path}`);
		}
		const expectedSize = expectedFiles.get(path);
		if (expectedSize === undefined || expectedSize !== length) {
			throw new Error(
				`browser-native runtime pack entry does not match the manifest: ${path}`
			);
		}
		nextOffset = offset + length;
		if (!Number.isSafeInteger(nextOffset) || nextOffset > runtimePack.totalBytes) {
			throw new Error(`browser-native runtime pack entry is out of range: ${path}`);
		}
		entries.set(path, { offset, length });
	}
	if (nextOffset !== runtimePack.totalBytes || entries.size !== expectedFiles.size) {
		throw new Error('browser-native runtime pack index does not cover the declared payload');
	}
	for (const path of expectedFiles.keys()) {
		if (!entries.has(path)) {
			throw new Error(`browser-native runtime pack index is missing ${path}`);
		}
	}

	let bytes = await fetchBoundedRuntimeAsset(
		runtimePack.asset,
		'browser-native runtime pack asset',
		limits.maxAssetBytes,
		options
	);
	if (bytes.byteLength >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
		if (typeof DecompressionStream !== 'function') {
			throw new Error(
				"failed to decompress browser-native runtime pack: this browser does not support DecompressionStream('gzip')"
			);
		}
		const decompressed = new Blob([bytes])
			.stream()
			.pipeThrough(new DecompressionStream('gzip'));
		try {
			bytes = await readBoundedStream(
				decompressed,
				'browser-native runtime pack expanded payload',
				runtimePack.totalBytes,
				options.signal,
				runtimePack.totalBytes
			);
		} catch (error) {
			if (options.signal?.aborted) throw abortReason(options.signal);
			if (error instanceof Error && error.message.includes('byte limit')) throw error;
			throw new Error(
				`failed to decompress browser-native runtime pack: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error }
			);
		}
	}
	if (bytes.byteLength !== runtimePack.totalBytes) {
		throw new Error('browser-native runtime pack metadata does not match payload');
	}
	return { bytes, entries };
}

export async function runBrowserNativeTool(request: {
	toolUrl: string;
	argv: string[];
	env: Record<string, string>;
	preloadFiles: BrowserToolPreloadFile[];
	outputPrefixes: string[];
	systemBridge?: 'binaryen';
	binaryenTools?: BrowserNativeManifest['binaryenTools'];
}) {
	const worker = new Worker(
		new URL('../browser-harness/native-tool-worker.js', import.meta.url),
		{
			type: 'module'
		}
	);

	try {
		return await new Promise<BrowserToolResult>((resolve, reject) => {
			const transferPreloadBuffers = request.preloadFiles.flatMap((file) =>
				file.bytes ? [file.bytes] : []
			);
			const handleMessage = (event: MessageEvent<WorkerResponse>) => {
				const response = event.data;
				if (!response || response.type !== 'tool-result') {
					return;
				}
				worker.removeEventListener('message', handleMessage);
				resolve({
					exitCode: response.exitCode,
					stdout: response.stdout,
					stderr: response.stderr,
					...(response.thrown ? { thrown: response.thrown } : {}),
					files: response.files.map((file) => ({
						path: file.path,
						data: new Uint8Array(file.data)
					}))
				});
			};
			worker.addEventListener('message', handleMessage);
			worker.addEventListener(
				'error',
				(error) => {
					worker.removeEventListener('message', handleMessage);
					reject(error.error || new Error(error.message));
				},
				{ once: true }
			);
			worker.postMessage(
				{
					type: 'run-tool',
					toolUrl: request.toolUrl,
					argv: request.argv,
					env: request.env,
					preloadFiles: request.preloadFiles,
					outputPrefixes: request.outputPrefixes,
					...(request.systemBridge ? { systemBridge: request.systemBridge } : {}),
					...(request.binaryenTools ? { binaryenTools: request.binaryenTools } : {})
				},
				transferPreloadBuffers
			);
		});
	} finally {
		worker.terminate();
	}
}

export function createBrowserWorkerSystemDispatcher(options: {
	manifest: BrowserNativeManifest;
	runtimeAssets?: BrowserNativeRuntimeAssetOptions;
}) {
	const packageMap = new Map(
		options.manifest.packages.map((manifestPackage) => [manifestPackage.name, manifestPackage])
	);
	let runtimePackEntriesPromise: Promise<BrowserNativeRuntimePackCache | null> | null = null;

	return (async (argv, context) => {
		if (argv.length === 0) {
			throw new Error('browser-native system dispatcher requires at least one argv element');
		}

		let commandName: 'ocamlc' | 'js_of_ocaml' | 'wasm_of_ocaml';
		let toolArgv: string[];
		let packageClosure: BrowserNativeManifestPackage[] = [];

		if (argv[0] === 'ocamlfind') {
			const expandedInvocation = expandOcamlfindInvocation(argv, packageMap);
			commandName = expandedInvocation.command;
			toolArgv = expandedInvocation.argv;
			packageClosure = expandedInvocation.packages;
		} else if (
			argv[0] === 'ocamlc' ||
			argv[0] === 'js_of_ocaml' ||
			argv[0] === 'wasm_of_ocaml'
		) {
			commandName = argv[0];
			toolArgv = argv.slice(1);
		} else {
			throw new Error(`unsupported browser-native subprocess: ${argv[0]}`);
		}

		const env = { ...context.env };
		if (commandName === 'ocamlc') {
			env['OCAMLLIB'] = env['OCAMLLIB'] || '/static/toolchain/lib/ocaml';
		}
		if (commandName === 'js_of_ocaml' || commandName === 'wasm_of_ocaml') {
			env['OCAMLFIND_CONF'] = env['OCAMLFIND_CONF'] || '/static/toolchain/findlib.conf';
		}
		if (commandName === 'wasm_of_ocaml') {
			env['WASM_OF_JS_OF_OCAML_BROWSER_FAST_BINARYEN'] =
				env['WASM_OF_JS_OF_OCAML_BROWSER_FAST_BINARYEN'] || '1';
		}
		if (!runtimePackEntriesPromise) {
			runtimePackEntriesPromise = loadBrowserNativeRuntimePack(
				options.manifest,
				options.runtimeAssets
			);
		}
		const runtimePackEntries = await runtimePackEntriesPromise;

		if (commandName === 'wasm_of_ocaml' && !options.manifest.binaryenTools) {
			throw new Error('browser-native bundle is missing static Binaryen tools');
		}

		const result = await runBrowserNativeTool({
			toolUrl: options.manifest.tools[commandName],
			argv: toolArgv,
			env,
			preloadFiles: [
				...getToolchainPreloads(
					commandName,
					options.manifest,
					packageClosure,
					runtimePackEntries
				),
				...getFilePreloadsFromFs(context.fs, '/workspace'),
				...getFilePreloadsFromFs(context.fs, '/tmp')
			],
			outputPrefixes: ['/workspace/_build', '/tmp'],
			...(commandName === 'wasm_of_ocaml'
				? {
						systemBridge: 'binaryen' as const,
						binaryenTools: options.manifest.binaryenTools
					}
				: {})
		});
		const toolReportedSuccess =
			(commandName === 'js_of_ocaml' || commandName === 'wasm_of_ocaml') &&
			result.files.some((file) => file.path.endsWith('.js')) &&
			((result.thrown || '').includes('tool-exit:0') ||
				result.stderr.includes('tool-exit:0'));
		const normalizedExitCode = toolReportedSuccess ? 0 : result.exitCode;
		const normalizedThrown =
			toolReportedSuccess && (result.thrown || '').includes('tool-exit:0')
				? undefined
				: result.thrown;
		const normalizedStderr = toolReportedSuccess
			? result.stderr
					.split('\n')
					.filter((line) => !line.includes('tool-exit:0'))
					.join('\n')
			: result.stderr;

		for (const file of result.files) {
			context.fs.writeFile(file.path, file.data);
		}

		return {
			exitCode: normalizedExitCode,
			stdout: result.stdout,
			stderr: [normalizedStderr, normalizedThrown].filter(Boolean).join('\n')
		};
	}) satisfies SystemDispatcher;
}
