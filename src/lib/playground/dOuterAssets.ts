import { verifyRuntimeAssetPair, type RuntimeAssetIntegrityEntry } from '@wasm-idle/core';

export const D_OUTER_ASSET_NAMES = ['index.js', 'runtime/runtime-manifest.v1.json'] as const;

export type DOuterAssetName = (typeof D_OUTER_ASSET_NAMES)[number];
export type DOuterAssetReceipt = Readonly<
	Required<
		Pick<
			RuntimeAssetIntegrityEntry,
			'bytes' | 'sha256' | 'uncompressedBytes' | 'uncompressedSha256'
		>
	>
>;
export type DOuterAssetReceipts = Readonly<Record<DOuterAssetName, DOuterAssetReceipt>>;

export interface DOuterAssetConfig {
	moduleUrl: string;
	manifestUrl: string;
	integrity: DOuterAssetReceipts;
}

export interface LoadedDOuterAssets {
	moduleBytes: Uint8Array;
	manifestBytes: Uint8Array;
}

const cancelBody = (response: Response, reason?: unknown) => {
	try {
		void Promise.resolve(response.body?.cancel(reason)).catch(() => undefined);
	} catch {
		// Preserve the trust-boundary error that triggered cleanup.
	}
};

const requireReceipt = (
	asset: DOuterAssetName,
	receipt: RuntimeAssetIntegrityEntry | undefined
): DOuterAssetReceipt => {
	if (
		!receipt ||
		!Number.isSafeInteger(receipt.bytes) ||
		(receipt.bytes as number) <= 0 ||
		typeof receipt.sha256 !== 'string' ||
		!/^[a-f0-9]{64}$/u.test(receipt.sha256) ||
		receipt.uncompressedBytes !== receipt.bytes ||
		receipt.uncompressedSha256 !== receipt.sha256
	) {
		throw new TypeError(`D outer runtime receipt is invalid for ${asset}`);
	}
	return Object.freeze({
		bytes: receipt.bytes as number,
		sha256: receipt.sha256,
		uncompressedBytes: receipt.uncompressedBytes as number,
		uncompressedSha256: receipt.uncompressedSha256 as string
	});
};

export function snapshotDOuterAssetConfig(config: DOuterAssetConfig): DOuterAssetConfig {
	if (!config || typeof config !== 'object') {
		throw new TypeError('D outer runtime asset configuration is required');
	}
	const receivedNames = Object.keys(config.integrity || {}).sort();
	const expectedNames = [...D_OUTER_ASSET_NAMES].sort();
	if (
		receivedNames.length !== expectedNames.length ||
		receivedNames.some((name, index) => name !== expectedNames[index])
	) {
		throw new TypeError('D outer runtime receipt must describe exactly two assets');
	}
	const urls = [config.moduleUrl, config.manifestUrl].map((value, index) => {
		let url: URL;
		try {
			url = new URL(value);
		} catch {
			throw new TypeError(`D outer runtime URL is invalid for ${D_OUTER_ASSET_NAMES[index]}`);
		}
		if (
			!['http:', 'https:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.hash
		) {
			throw new TypeError(`D outer runtime URL is unsafe for ${D_OUTER_ASSET_NAMES[index]}`);
		}
		return url.href;
	});
	return Object.freeze({
		moduleUrl: urls[0],
		manifestUrl: urls[1],
		integrity: Object.freeze({
			'index.js': requireReceipt('index.js', config.integrity['index.js']),
			'runtime/runtime-manifest.v1.json': requireReceipt(
				'runtime/runtime-manifest.v1.json',
				config.integrity['runtime/runtime-manifest.v1.json']
			)
		})
	});
}

async function fetchVerifiedDOuterAsset(
	asset: DOuterAssetName,
	url: string,
	receipt: DOuterAssetReceipt,
	fetchImpl: typeof fetch
) {
	const response = await fetchImpl(url, {
		cache: 'no-store',
		credentials: 'omit',
		redirect: 'error',
		referrerPolicy: 'no-referrer'
	});
	if (response.url) {
		let finalUrl: string;
		try {
			finalUrl = new URL(response.url).href;
		} catch {
			const error = new Error(`D outer runtime response URL is invalid for ${asset}`);
			cancelBody(response, error);
			throw error;
		}
		if (finalUrl !== url) {
			const error = new Error(`D outer runtime response URL mismatch for ${asset}`);
			cancelBody(response, error);
			throw error;
		}
	}
	if (!response.ok) {
		const error = new Error(`D outer runtime request failed for ${asset}: ${response.status}`);
		cancelBody(response, error);
		throw error;
	}
	const contentEncoding = response.headers.get('content-encoding')?.trim();
	const rawLength = response.headers.get('content-length');
	if (rawLength !== null) {
		const length = Number(rawLength);
		if (
			!/^\d+$/u.test(rawLength) ||
			!Number.isSafeInteger(length) ||
			(contentEncoding ? length > receipt.bytes : length !== receipt.bytes)
		) {
			const error = new Error(`D outer runtime Content-Length mismatch for ${asset}`);
			cancelBody(response, error);
			throw error;
		}
	}
	let bytes: Uint8Array;
	if (!response.body) {
		bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > (receipt.bytes as number)) {
			throw new Error(`D outer runtime asset exceeds its receipt for ${asset}`);
		}
	} else {
		const reader = response.body.getReader();
		bytes = new Uint8Array(receipt.bytes as number);
		let offset = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				if (!value) continue;
				if (offset + value.byteLength > bytes.byteLength) {
					const error = new Error(
						`D outer runtime asset exceeds its receipt for ${asset}`
					);
					try {
						void Promise.resolve(reader.cancel(error)).catch(() => undefined);
					} catch {}
					throw error;
				}
				bytes.set(value, offset);
				offset += value.byteLength;
			}
		} finally {
			try {
				reader.releaseLock();
			} catch {
				// Stream cleanup must not replace verification outcome.
			}
		}
		if (offset !== bytes.byteLength) bytes = bytes.slice(0, offset);
	}
	if (bytes.byteLength !== receipt.bytes) {
		throw new Error(
			`D outer runtime size mismatch for ${asset}: expected ${receipt.bytes}, received ${bytes.byteLength}`
		);
	}
	await verifyRuntimeAssetPair({
		asset,
		compressed: bytes,
		uncompressed: bytes,
		expected: receipt,
		runtimeId: 'D'
	});
	return bytes;
}

export async function loadVerifiedDOuterAssets(
	config: DOuterAssetConfig,
	fetchImpl: typeof fetch = fetch
): Promise<LoadedDOuterAssets> {
	const snapshot = snapshotDOuterAssetConfig(config);
	const [moduleBytes, manifestBytes] = await Promise.all([
		fetchVerifiedDOuterAsset(
			'index.js',
			snapshot.moduleUrl,
			snapshot.integrity['index.js'],
			fetchImpl
		),
		fetchVerifiedDOuterAsset(
			'runtime/runtime-manifest.v1.json',
			snapshot.manifestUrl,
			snapshot.integrity['runtime/runtime-manifest.v1.json'],
			fetchImpl
		)
	]);
	return { moduleBytes, manifestBytes };
}
