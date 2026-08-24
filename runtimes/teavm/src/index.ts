import { TEAVM_ASSET_RECEIPTS, TEAVM_ASSET_VERSION } from './runtime.generated.js';

export { TEAVM_ASSET_RECEIPTS, TEAVM_ASSET_VERSION } from './runtime.generated.js';

export const TEAVM_LOAD_ASSETS = [
	'compiler.wasm-runtime.js',
	'compiler.wasm',
	'compile-classlib-teavm.bin',
	'runtime-classlib-teavm.bin'
] as const;

export type TeaVmLoadAsset = (typeof TEAVM_LOAD_ASSETS)[number];

export interface TeaVmAssetReceipt {
	bytes: number;
	sha256: string;
}

export type TeaVmAssetReceipts = Readonly<Record<TeaVmLoadAsset, Readonly<TeaVmAssetReceipt>>>;

export interface TeaVmAssetResolverOptions {
	baseUrl: string | URL;
	currentUrl?: string | URL;
}

export interface TeaVmFetchAssetOptions extends TeaVmAssetResolverOptions {
	fetch?: typeof fetch;
	signal?: AbortSignal;
	maxAssetBytes?: number;
	integrity?: TeaVmAssetReceipts;
}

const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/u;
export const DEFAULT_MAX_TEAVM_ASSET_BYTES = 128 * 1024 * 1024;
const DEFAULT_TEAVM_ASSET_BUFFER_BYTES = 64 * 1024;

const ensureTrailingSlash = (baseUrl: string) => (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

const stringifyUrl = (url: string | URL) => (url instanceof URL ? url.href : url);

const canResolveWithUrl = (baseUrl: string) => ABSOLUTE_URL_PATTERN.test(baseUrl);

const snapshotTeaVmAssetReceipt = (
	asset: TeaVmLoadAsset,
	value: unknown
): Readonly<TeaVmAssetReceipt> => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`TeaVM runtime receipt is invalid for ${asset}`);
	}
	const receipt = value as Partial<TeaVmAssetReceipt>;
	const bytes = receipt.bytes;
	const sha256 = receipt.sha256;
	if (
		!Number.isSafeInteger(bytes) ||
		(bytes as number) <= 0 ||
		typeof sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(sha256)
	) {
		throw new TypeError(`TeaVM runtime receipt is invalid for ${asset}`);
	}
	return Object.freeze({ bytes: bytes as number, sha256 });
};

export function snapshotTeaVmAssetReceipts(
	value: unknown = TEAVM_ASSET_RECEIPTS
): TeaVmAssetReceipts {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('TeaVM runtime integrity must describe exactly four assets');
	}
	const receivedNames = Object.keys(value).sort();
	const expectedNames = [...TEAVM_LOAD_ASSETS].sort();
	if (
		receivedNames.length !== expectedNames.length ||
		receivedNames.some((name, index) => name !== expectedNames[index])
	) {
		throw new TypeError('TeaVM runtime integrity must describe exactly four assets');
	}
	const receipts = value as Record<TeaVmLoadAsset, unknown>;
	return Object.freeze(
		Object.fromEntries(
			TEAVM_LOAD_ASSETS.map((asset) => [
				asset,
				snapshotTeaVmAssetReceipt(asset, receipts[asset])
			])
		) as unknown as TeaVmAssetReceipts
	);
}

const digestWithSignal = async (bytes: Uint8Array<ArrayBuffer>, signal?: AbortSignal) => {
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) throw new Error('Web Crypto is required to verify TeaVM runtime assets.');
	if (signal?.aborted) {
		throw signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
	}
	const pendingDigest = Promise.resolve(subtle.digest('SHA-256', bytes));
	void pendingDigest.catch(() => undefined);
	if (!signal) return await pendingDigest;
	let cancelOnAbort: (() => void) | undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		cancelOnAbort = () =>
			reject(signal.reason ?? new Error('TeaVM runtime asset load was aborted.'));
		signal.addEventListener('abort', cancelOnAbort, { once: true });
		if (signal.aborted) cancelOnAbort();
	});
	try {
		const digest = await Promise.race([pendingDigest, aborted]);
		if (signal.aborted) {
			throw signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
		}
		return digest;
	} finally {
		if (cancelOnAbort) signal.removeEventListener('abort', cancelOnAbort);
	}
};

const verifyTeaVmAsset = async (
	asset: TeaVmLoadAsset,
	bytes: Uint8Array<ArrayBuffer>,
	receipt: Readonly<TeaVmAssetReceipt>,
	signal?: AbortSignal
) => {
	if (signal?.aborted) {
		throw signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
	}
	const snapshot = Uint8Array.from(bytes);
	if (snapshot.byteLength !== receipt.bytes) {
		throw new Error(`TeaVM runtime asset ${asset} failed its byte-size receipt`);
	}
	const digest = new Uint8Array(await digestWithSignal(snapshot, signal));
	const sha256 = [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
	if (sha256 !== receipt.sha256) {
		throw new Error(`TeaVM runtime asset ${asset} failed its SHA-256 receipt`);
	}
	return snapshot;
};

export function normalizeTeaVmBaseUrl(baseUrl: string | URL, currentUrl?: string | URL) {
	if (baseUrl == null) throw new TypeError('TeaVM asset base URL is required.');
	const value = stringifyUrl(baseUrl).trim();
	if (!value) throw new TypeError('TeaVM asset base URL is required.');
	if (
		value.includes('\\') ||
		value.includes('\0') ||
		value.includes('?') ||
		value.includes('#')
	) {
		throw new TypeError(
			'TeaVM asset base URL must not include backslashes, NUL, query, or fragment data.'
		);
	}
	if (value.startsWith('//')) {
		throw new TypeError('TeaVM asset base URL must not be protocol-relative.');
	}
	const normalized = ensureTrailingSlash(value);
	if (currentUrl || canResolveWithUrl(normalized)) {
		const resolved = new URL(normalized, currentUrl ? stringifyUrl(currentUrl) : undefined);
		if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
			throw new TypeError(`TeaVM assets must use HTTP(S), received ${resolved.protocol}`);
		}
		if (resolved.username || resolved.password) {
			throw new TypeError('TeaVM asset base URL must not include credentials.');
		}
		return resolved.href;
	}
	return normalized;
}

export function resolveTeaVmAssetUrl(
	asset: TeaVmLoadAsset | string,
	options: TeaVmAssetResolverOptions
) {
	const assetPath = String(asset).trim();
	const parts = assetPath.split('/');
	if (
		!assetPath ||
		ABSOLUTE_URL_PATTERN.test(assetPath) ||
		assetPath.startsWith('/') ||
		assetPath.includes('\\') ||
		assetPath.includes('\0') ||
		assetPath.includes('?') ||
		assetPath.includes('#') ||
		parts.some(
			(part) => !part || part === '.' || part === '..' || !/^[A-Za-z0-9_.-]+$/u.test(part)
		)
	) {
		throw new TypeError(`Invalid TeaVM runtime asset path: ${assetPath}`);
	}
	const baseUrl = normalizeTeaVmBaseUrl(options.baseUrl, options.currentUrl);
	if (canResolveWithUrl(baseUrl)) return new URL(assetPath, baseUrl).href;
	return `${baseUrl}${assetPath}`;
}

export function createTeaVmAssetManifest(options: TeaVmAssetResolverOptions) {
	return Object.fromEntries(
		TEAVM_LOAD_ASSETS.map((asset) => [asset, resolveTeaVmAssetUrl(asset, options)])
	) as Record<TeaVmLoadAsset, string>;
}

export async function fetchTeaVmAsset(
	asset: TeaVmLoadAsset,
	options: TeaVmFetchAssetOptions
): Promise<Uint8Array<ArrayBuffer>> {
	if (!(TEAVM_LOAD_ASSETS as readonly string[]).includes(asset)) {
		throw new Error(`Unexpected TeaVM runtime asset: ${asset}`);
	}
	const maxAssetBytes = options.maxAssetBytes ?? DEFAULT_MAX_TEAVM_ASSET_BYTES;
	if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes < 0) {
		throw new Error('TeaVM maxAssetBytes must be a non-negative safe integer.');
	}
	if (options.signal?.aborted) {
		throw options.signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
	}
	const integritySource = options.integrity;
	if (options.signal?.aborted) {
		throw options.signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
	}
	const integrity = snapshotTeaVmAssetReceipts(
		integritySource === undefined ? TEAVM_ASSET_RECEIPTS : integritySource
	);
	if (options.signal?.aborted) {
		throw options.signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
	}
	const receipt = integrity[asset];
	if (receipt.bytes > maxAssetBytes) {
		throw new Error(`TeaVM runtime asset ${asset} exceeds the ${maxAssetBytes} byte limit`);
	}
	const byteLimit = receipt.bytes;
	const fetchImpl = options.fetch ?? globalThis.fetch?.bind(globalThis);
	if (!fetchImpl) throw new Error('fetch is required to load TeaVM runtime assets.');
	const assetUrl = resolveTeaVmAssetUrl(asset, options);
	const currentUrl = globalThis.location?.href;
	const expectedUrl =
		ABSOLUTE_URL_PATTERN.test(assetUrl) || currentUrl
			? new URL(assetUrl, currentUrl).href
			: undefined;
	let response: Response;
	try {
		const fetchPromise = Promise.resolve(
			fetchImpl(assetUrl, {
				credentials: 'omit',
				redirect: 'error',
				referrerPolicy: 'no-referrer',
				signal: options.signal
			})
		);
		if (!options.signal) {
			response = await fetchPromise;
		} else {
			const signal = options.signal;
			response = await new Promise<Response>((resolve, reject) => {
				let settled = false;
				const onAbort = () => {
					if (settled) return;
					settled = true;
					signal.removeEventListener('abort', onAbort);
					reject(signal.reason ?? new Error('TeaVM runtime asset load was aborted.'));
				};
				signal.addEventListener('abort', onAbort, { once: true });
				fetchPromise.then(
					(fetchedResponse) => {
						if (settled) {
							void Promise.resolve()
								.then(() =>
									fetchedResponse.body?.cancel(
										signal.reason ??
											new Error('TeaVM runtime asset load was aborted.')
									)
								)
								.catch(() => {});
							return;
						}
						settled = true;
						signal.removeEventListener('abort', onAbort);
						resolve(fetchedResponse);
					},
					(error) => {
						if (settled) return;
						settled = true;
						signal.removeEventListener('abort', onAbort);
						reject(error);
					}
				);
				if (signal.aborted) onAbort();
			});
		}
	} catch (error) {
		if (options.signal?.aborted) {
			throw options.signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
		}
		throw new Error(
			`Failed to load TeaVM runtime asset ${asset}: ${error instanceof Error ? error.message : String(error)}`
		);
	}
	if (expectedUrl && response.url) {
		let finalUrl: URL;
		try {
			finalUrl = new URL(response.url);
		} catch {
			await response.body?.cancel().catch(() => {});
			throw new Error(`TeaVM runtime asset ${asset} returned an invalid final URL`);
		}
		if (finalUrl.href !== expectedUrl) {
			await response.body?.cancel().catch(() => {});
			throw new Error(`TeaVM runtime asset ${asset} returned an unexpected final URL`);
		}
	}
	if (!response.ok) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`Failed to load TeaVM runtime asset ${asset}: ${response.status}`);
	}
	const contentLengthValue = response.headers.get('content-length');
	let contentLength: number | undefined;
	if (contentLengthValue !== null) {
		contentLength = Number(contentLengthValue);
		if (!/^\d+$/u.test(contentLengthValue) || !Number.isSafeInteger(contentLength)) {
			await response.body?.cancel().catch(() => {});
			throw new Error(`TeaVM runtime asset ${asset} has an invalid Content-Length`);
		}
	}
	if (contentLength !== undefined && contentLength > byteLimit) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`TeaVM runtime asset ${asset} exceeds the ${byteLimit} byte limit`);
	}
	if (!response.body) {
		const signal = options.signal;
		let cancelOnAbort: (() => void) | undefined;
		const aborted = signal
			? new Promise<never>((_resolve, reject) => {
					cancelOnAbort = () =>
						reject(signal.reason ?? new Error('TeaVM runtime asset load was aborted.'));
					signal.addEventListener('abort', cancelOnAbort, { once: true });
				})
			: undefined;
		try {
			if (signal?.aborted) {
				throw signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
			}
			const materialized = response.arrayBuffer();
			const bytes = new Uint8Array(
				aborted ? await Promise.race([materialized, aborted]) : await materialized
			);
			if (signal?.aborted) {
				throw signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
			}
			if (bytes.byteLength > byteLimit) {
				throw new Error(`TeaVM runtime asset ${asset} exceeds the ${byteLimit} byte limit`);
			}
			return await verifyTeaVmAsset(asset, bytes, receipt, signal);
		} finally {
			if (cancelOnAbort) {
				signal?.removeEventListener('abort', cancelOnAbort);
			}
		}
	}

	const reader = response.body.getReader();
	let readerCancelled = false;
	const cancelReader = (reason?: unknown) => {
		if (readerCancelled) return;
		readerCancelled = true;
		try {
			void reader.cancel(reason).catch(() => {});
		} catch {}
	};
	if (options.signal?.aborted) {
		const reason = options.signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
		cancelReader(reason);
		try {
			reader.releaseLock();
		} catch {}
		throw reason;
	}
	let cancelOnAbort: (() => void) | undefined;
	const aborted = options.signal
		? new Promise<never>((_resolve, reject) => {
				cancelOnAbort = () => {
					const reason =
						options.signal?.reason ??
						new Error('TeaVM runtime asset load was aborted.');
					cancelReader(reason);
					reject(reason);
				};
				options.signal!.addEventListener('abort', cancelOnAbort, { once: true });
			})
		: undefined;
	let bytes = new Uint8Array(
		Math.min(byteLimit, contentLength ?? DEFAULT_TEAVM_ASSET_BUFFER_BYTES)
	);
	let receivedLength = 0;
	let loadedBytes!: Uint8Array<ArrayBuffer>;
	let releaseFailure: { error: unknown } | undefined;
	try {
		while (true) {
			if (options.signal?.aborted) {
				throw options.signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
			}
			const pendingRead = reader.read();
			const { done, value } = aborted
				? await Promise.race([pendingRead, aborted])
				: await pendingRead;
			if (options.signal?.aborted) {
				throw options.signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
			}
			if (done) break;
			if (!value) continue;
			const nextLength = receivedLength + value.byteLength;
			if (nextLength > byteLimit) {
				const error = new Error(
					`TeaVM runtime asset ${asset} exceeds the ${byteLimit} byte limit`
				);
				cancelReader(error);
				throw error;
			}
			if (nextLength > bytes.byteLength) {
				const nextCapacity = Math.min(
					byteLimit,
					Math.max(nextLength, Math.max(bytes.byteLength * 2, 1))
				);
				const grown = new Uint8Array(nextCapacity);
				grown.set(bytes.subarray(0, receivedLength));
				bytes = grown;
			}
			bytes.set(value, receivedLength);
			receivedLength = nextLength;
		}
		if (options.signal?.aborted) {
			throw options.signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
		}
		loadedBytes = bytes.subarray(0, receivedLength);
	} catch (error) {
		if (options.signal?.aborted) {
			const reason =
				options.signal.reason ?? new Error('TeaVM runtime asset load was aborted.');
			cancelReader(reason);
			throw reason;
		}
		cancelReader(error);
		throw error;
	} finally {
		if (cancelOnAbort) options.signal?.removeEventListener('abort', cancelOnAbort);
		try {
			reader.releaseLock();
		} catch (error) {
			if (!options.signal?.aborted) releaseFailure = { error };
		}
	}
	if (releaseFailure) throw releaseFailure.error;
	return await verifyTeaVmAsset(asset, loadedBytes, receipt, options.signal);
}
