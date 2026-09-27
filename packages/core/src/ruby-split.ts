import {
	AssetIntegrityError,
	AssetTooLargeError,
	RuntimeConfigurationError,
	TimeoutError
} from './errors.js';
import { resolveExecutionLimits, type ExecutionLimits } from './execution.js';
import type { RuntimeAssetPreflightProgress } from './runtime-preflight.js';
import { RUBY_SPLIT_BUNDLE } from './ruby-split.generated.js';
import {
	RUBY_RUNTIME_ASSET_PATH,
	RUBY_RUNTIME_VERIFIED_WASM_URL,
	RUBY_MAX_ASSET_BYTES,
	RUBY_MAX_LOGICAL_BYTES,
	RUBY_MAX_DELIVERY_BYTES
} from './ruby-runtime.js';

export { RUBY_SPLIT_BUNDLE };
export const RUBY_SPLIT_PROTOCOL = 'wasm-idle-ruby-split-preflight-v1' as const;
const decoder = new TextDecoder('utf-8', { fatal: true });
const fields = ['manifestBytes', 'moduleJavaScriptBytes', 'wasmBytes', 'stdlibBytes'] as const;
export interface RubySplitPayload {
	readonly protocol: typeof RUBY_SPLIT_PROTOCOL;
	readonly version: string;
	readonly manifestBytes: Uint8Array;
	readonly moduleJavaScriptBytes: Uint8Array;
	readonly wasmBytes: Uint8Array;
	readonly stdlibBytes: Uint8Array;
}
export type RubyStdlibEntry = Readonly<
	{ path: string; kind: 'directory' } | { path: string; kind: 'file'; bytes: Uint8Array }
>;
const failure = (message: string) =>
	new AssetIntegrityError(message, { phase: 'asset', runtimeId: 'RUBY' });
const abort = (signal?: AbortSignal) => {
	if (signal?.aborted)
		throw signal.reason ?? new DOMException('Ruby split startup aborted', 'AbortError');
};
async function digest(bytes: Uint8Array) {
	return Array.from(
		new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)),
		(x) => x.toString(16).padStart(2, '0')
	).join('');
}
async function verify(
	bytes: Uint8Array,
	receipt: { bytes: number; sha256: string },
	label: string,
	signal?: AbortSignal
) {
	abort(signal);
	if (bytes.length !== receipt.bytes)
		throw failure(`Ruby split ${label} has an unexpected byte length`);
	if ((await digest(bytes)) !== receipt.sha256)
		throw failure(`Ruby split ${label} failed SHA-256 verification`);
	abort(signal);
}
function validateLimits(max: number) {
	if (!Number.isSafeInteger(max) || max <= 0)
		throw new RuntimeConfigurationError('Ruby split asset limit must be a positive integer', {
			runtimeId: 'RUBY'
		});
	max = Math.min(max, RUBY_MAX_ASSET_BYTES);
	const receipts = [RUBY_SPLIT_BUNDLE.manifest, ...Object.values(RUBY_SPLIT_BUNDLE.assets)];
	for (const receipt of receipts) {
		const size = Math.max(receipt.bytes, 'logicalBytes' in receipt ? receipt.logicalBytes : 0);
		if (size > max)
			throw new AssetTooLargeError(`Ruby split asset exceeds the ${max} byte limit`, {
				phase: 'asset',
				runtimeId: 'RUBY',
				actual: size,
				limit: max
			});
	}
	if (
		receipts.reduce((n, x) => n + x.bytes, 0) > RUBY_MAX_DELIVERY_BYTES ||
		Object.values(RUBY_SPLIT_BUNDLE.assets).reduce((n, x) => n + x.logicalBytes, 0) >
			RUBY_MAX_LOGICAL_BYTES
	)
		throw failure('Ruby split aggregate budget exceeded');
}
function wholeBytes(value: unknown): value is Uint8Array<ArrayBuffer> {
	return (
		value instanceof Uint8Array &&
		value.buffer instanceof ArrayBuffer &&
		value.byteOffset === 0 &&
		value.byteLength === value.buffer.byteLength
	);
}
export function requireRubySplitPayload(value: unknown): RubySplitPayload {
	if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
		throw failure('Ruby split payload must be a plain record');
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = ['protocol', 'version', ...fields];
	if (
		Reflect.ownKeys(descriptors).length !== keys.length ||
		keys.some((k) => !descriptors[k] || !('value' in descriptors[k]))
	)
		throw failure('Ruby split payload has unexpected fields or getters');
	const payload = value as RubySplitPayload;
	if (payload.protocol !== RUBY_SPLIT_PROTOCOL || payload.version !== RUBY_SPLIT_BUNDLE.version)
		throw failure('Ruby split payload has an unknown profile version');
	if (
		fields.some((k) => !wholeBytes(payload[k])) ||
		new Set(fields.map((k) => payload[k].buffer)).size !== 4
	)
		throw failure('Ruby split payload requires four unique owned byte buffers');
	return payload;
}
export async function verifyRubySplitPayload(
	value: unknown,
	options: { maxAssetBytes?: number; signal?: AbortSignal } = {}
): Promise<RubySplitPayload> {
	const payload = requireRubySplitPayload(value);
	validateLimits(options.maxAssetBytes ?? RUBY_MAX_ASSET_BYTES);
	const { module, wasm, stdlib } = RUBY_SPLIT_BUNDLE.assets;
	await Promise.all([
		verify(payload.manifestBytes, RUBY_SPLIT_BUNDLE.manifest, 'manifest', options.signal),
		...(
			[
				[payload.moduleJavaScriptBytes, module, 'module'],
				[payload.wasmBytes, wasm, 'Wasm'],
				[payload.stdlibBytes, stdlib, 'stdlib']
			] as const
		).map(([bytes, receipt, label]) =>
			verify(
				bytes,
				{ bytes: receipt.logicalBytes, sha256: receipt.logicalSha256 },
				label,
				options.signal
			)
		)
	]);
	const manifest = JSON.parse(decoder.decode(payload.manifestBytes));
	if (
		manifest.format !== 'wasm-ruby-split-v1' ||
		manifest.profileId !== RUBY_SPLIT_BUNDLE.profileId
	)
		throw failure('Ruby split manifest identity mismatch');
	if (
		payload.wasmBytes.length < 8 ||
		payload.wasmBytes.slice(0, 8).some((x, i) => x !== [0, 97, 115, 109, 1, 0, 0, 0][i])
	)
		throw failure('Ruby split Wasm header is invalid');
	parseRubyStdlibPack(payload.stdlibBytes);
	return payload;
}

/** No runtime fetching, eval or import is allowed before the fixed receipts pass. */
export function rewriteRubySplitRuntimeModule(payload: RubySplitPayload): string {
	requireRubySplitPayload(payload);
	const source = decoder.decode(payload.moduleJavaScriptBytes);
	const original = `new URL(${JSON.stringify(RUBY_RUNTIME_ASSET_PATH)},import.meta.url)`;
	if (source.split(original).length !== 2)
		throw failure('Ruby split wrapper has an unexpected Wasm URL expression');
	return source.replace(
		original,
		`new URL(${JSON.stringify(RUBY_RUNTIME_VERIFIED_WASM_URL)},import.meta.url)`
	);
}

function waitForResponse(operation: Promise<Response>, signal: AbortSignal): Promise<Response> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const cancel = () => {
			if (settled) return;
			settled = true;
			signal.removeEventListener('abort', cancel);
			reject(signal.reason ?? new DOMException('Ruby split startup aborted', 'AbortError'));
		};
		signal.addEventListener('abort', cancel, { once: true });
		operation.then(
			(response) => {
				if (settled) {
					void response.body?.cancel(signal.reason).catch(() => {});
					return;
				}
				settled = true;
				signal.removeEventListener('abort', cancel);
				resolve(response);
			},
			(error) => {
				if (settled) return;
				settled = true;
				signal.removeEventListener('abort', cancel);
				reject(error);
			}
		);
		if (signal.aborted) cancel();
	});
}

async function readExact(
	stream: ReadableStream<Uint8Array>,
	expected: number,
	signal: AbortSignal,
	progress?: (size: number) => void
) {
	const reader = stream.getReader();
	const bytes = new Uint8Array(expected);
	let count = 0;
	const cancel = () => {
		void reader.cancel(signal.reason).catch(() => {});
	};
	signal.addEventListener('abort', cancel, { once: true });
	try {
		abort(signal);
		while (true) {
			const part = await reader.read();
			abort(signal);
			if (part.done) break;
			if (part.value.byteLength > expected - count)
				throw failure('Ruby split response exceeds its pinned byte length');
			bytes.set(part.value, count);
			count += part.value.length;
			progress?.(count);
		}
		if (count !== expected)
			throw failure('Ruby split response ended before its pinned byte length');
		return bytes;
	} catch (error) {
		await reader.cancel(error).catch(() => {});
		throw error;
	} finally {
		signal.removeEventListener('abort', cancel);
		reader.releaseLock();
	}
}
export async function preflightRubySplitRuntimeAssets(options: {
	baseUrl: string;
	limits?: Partial<ExecutionLimits>;
	signal?: AbortSignal;
	fetch?: typeof fetch;
	reportProgress?: (progress: RuntimeAssetPreflightProgress) => void;
}): Promise<RubySplitPayload> {
	const limits = resolveExecutionLimits(options.limits);
	validateLimits(limits.maxAssetBytes);
	abort(options.signal);
	const base = new URL(options.baseUrl, typeof location === 'object' ? location.href : undefined);
	if (
		!['http:', 'https:'].includes(base.protocol) ||
		base.username ||
		base.password ||
		base.hash ||
		base.search ||
		!base.pathname.endsWith('/')
	)
		throw new RuntimeConfigurationError(
			'Ruby split requires a credential-free HTTP(S) base directory',
			{ runtimeId: 'RUBY' }
		);
	const controller = new AbortController();
	const signal = controller.signal;
	const forward = () => controller.abort(options.signal?.reason);
	options.signal?.addEventListener('abort', forward, { once: true });
	if (options.signal?.aborted) forward();
	const timer = setTimeout(
		() =>
			controller.abort(
				new TimeoutError('Ruby split asset loading timed out', {
					runtimeId: 'RUBY',
					phase: 'asset',
					timeoutMs: limits.assetTimeoutMs
				})
			),
		limits.assetTimeoutMs
	);
	const fetchImpl = options.fetch ?? globalThis.fetch;
	const receipts = [RUBY_SPLIT_BUNDLE.manifest, ...Object.values(RUBY_SPLIT_BUNDLE.assets)];
	const loaded = new Map<string, number>();
	const total = receipts.reduce((n, r) => n + r.bytes, 0);
	try {
		const decoded = await Promise.all(
			receipts.map(async (receipt) => {
				const url = new URL('split/' + receipt.path, base);
				url.searchParams.set('v', receipt.sha256);
				abort(signal);
				const response = await waitForResponse(
					Promise.resolve().then(() =>
						fetchImpl(url.href, {
							signal,
							credentials: 'omit',
							redirect: 'error',
							referrerPolicy: 'no-referrer'
						})
					),
					signal
				);
				if (
					!response.ok ||
					response.redirected ||
					(response.url && response.url !== url.href) ||
					!response.body
				)
					throw failure('Ruby split response status, URL or body is invalid');
				const storage = await readExact(response.body, receipt.bytes, signal, (count) => {
					loaded.set(receipt.path, count);
					options.reportProgress?.({
						runtimeId: 'RUBY',
						assetKey: receipt.path,
						loadedBytes: [...loaded.values()].reduce((a, b) => a + b, 0),
						totalBytes: total
					});
				});
				await verify(storage, receipt, receipt.path, signal);
				if ('encoding' in receipt && receipt.encoding === 'gzip') {
					const stream = new Response(storage).body!.pipeThrough(
						new DecompressionStream('gzip')
					);
					const bytes = await readExact(stream, receipt.logicalBytes, signal);
					await verify(
						bytes,
						{ bytes: receipt.logicalBytes, sha256: receipt.logicalSha256 },
						receipt.path + ' decoded',
						signal
					);
					return bytes;
				}
				return storage;
			})
		);
		const payload = Object.freeze({
			protocol: RUBY_SPLIT_PROTOCOL,
			version: RUBY_SPLIT_BUNDLE.version,
			manifestBytes: decoded[0]!,
			moduleJavaScriptBytes: decoded[1]!,
			wasmBytes: decoded[2]!,
			stdlibBytes: decoded[3]!
		});
		return await verifyRubySplitPayload(payload, {
			maxAssetBytes: limits.maxAssetBytes,
			signal
		});
	} catch (error) {
		controller.abort(error);
		throw error;
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener('abort', forward);
	}
}

/** Validate paths and contiguous ranges before exposing a filesystem to Ruby. */
export function parseRubyStdlibPack(bytes: Uint8Array): ReadonlyArray<RubyStdlibEntry> {
	if (
		bytes.length < 16 ||
		bytes.length > 24 * 1024 * 1024 ||
		decoder.decode(bytes.subarray(0, 8)) !== 'RUBYFS1\0'
	)
		throw failure('Ruby stdlib pack header is invalid');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const length = view.getUint32(8, true);
	const count = view.getUint32(12, true);
	if (
		length > 1024 * 1024 ||
		length === 0 ||
		count > 4096 ||
		count === 0 ||
		length > bytes.length - 16
	)
		throw failure('Ruby stdlib index bounds are invalid');
	const index: unknown = JSON.parse(decoder.decode(bytes.subarray(16, 16 + length)));
	if (!Array.isArray(index) || index.length !== count)
		throw failure('Ruby stdlib entry count mismatch');
	const body = bytes.subarray(16 + length);
	let offset = 0;
	const names = new Map<string, string>();
	const result: RubyStdlibEntry[] = [];
	for (const entry of index) {
		if (
			!entry ||
			typeof entry !== 'object' ||
			typeof entry.path !== 'string' ||
			entry.path.length > 1024 ||
			!/^\/(usr|bundle)(\/[^/]+)*$/.test(entry.path) ||
			/[\\\0:]/.test(entry.path) ||
			entry.path.split('/').some((x: string) => x === '.' || x === '..') ||
			names.has(entry.path)
		)
			throw failure('Ruby stdlib path is invalid or duplicated');
		const segments = entry.path.slice(1).split('/');
		let parent = '';
		for (const segment of segments.slice(0, -1)) {
			parent += '/' + segment;
			if (names.get(parent) !== 'directory')
				throw failure('Ruby stdlib parent is missing or is a file');
		}
		if (entry.kind === 'directory') {
			if (Object.keys(entry).sort().join(',') !== 'kind,path')
				throw failure('Ruby stdlib directory schema is invalid');
			result.push(Object.freeze({ path: entry.path, kind: 'directory' }));
		} else if (entry.kind === 'file') {
			if (
				Object.keys(entry).sort().join(',') !== 'kind,length,offset,path' ||
				entry.offset !== offset ||
				!Number.isSafeInteger(entry.length) ||
				entry.length < 0 ||
				entry.length > body.length - offset
			)
				throw failure('Ruby stdlib range is invalid, overlapping or noncontiguous');
			result.push(
				Object.freeze({
					path: entry.path,
					kind: 'file',
					bytes: body.subarray(offset, offset + entry.length)
				})
			);
			offset += entry.length;
		} else throw failure('Ruby stdlib entry kind is unsupported');
		names.set(entry.path, entry.kind);
	}
	if (offset !== body.length) throw failure('Ruby stdlib pack has unreferenced trailing bytes');
	for (const name of RUBY_SPLIT_BUNDLE.mountPaths)
		if (names.get(name) !== 'directory')
			throw failure('Ruby stdlib pack is missing a required mount');
	return Object.freeze(result);
}

/** Fresh directories and descriptors per run; only read-only file contents are shared. */
export function createRubyStdlibPreopens(
	entries: ReadonlyArray<RubyStdlibEntry>,
	shim: any,
	root: Map<string, any> = new Map()
): any[] {
	const directories = new Map<string, Map<string, any>>([['', root]]);
	for (const entry of entries) {
		const slash = entry.path.lastIndexOf('/');
		const parent = directories.get(entry.path.slice(0, slash));
		if (!parent) throw failure('Ruby stdlib parent directory disappeared');
		const name = entry.path.slice(slash + 1);
		if (entry.kind === 'directory') {
			const existing = parent.get(name);
			if (existing && !(existing instanceof shim.Directory))
				throw failure('Workspace conflicts with a Ruby stdlib directory');
			const contents = existing?.contents ?? new Map<string, any>();
			if (!existing) parent.set(name, new shim.Directory(contents));
			directories.set(entry.path, contents);
		} else {
			if (parent.has(name))
				throw failure('Workspace conflicts with a read-only Ruby stdlib file');
			parent.set(name, new shim.File(entry.bytes, { readonly: true }));
		}
	}
	return RUBY_SPLIT_BUNDLE.mountPaths.map(
		(name) => new shim.PreopenDirectory(name, directories.get(name)!)
	);
}
