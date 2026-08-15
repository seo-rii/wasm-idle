import { AssetIntegrityError } from './errors.js';
import type { RuntimeAssetIntegrityEntry } from './runtime-assets.js';

const JAVASCRIPT_MEDIA_TYPES = new Set(['application/javascript', 'text/javascript']);

export type RuntimeAssetIntegrityStage = 'compressed' | 'uncompressed';

export interface RuntimeAssetIntegrityVerificationRequest {
	asset: string;
	bytes: Uint8Array;
	expected: string | RuntimeAssetIntegrityEntry;
	stage?: RuntimeAssetIntegrityStage;
	mimeType?: string;
	runtimeId?: string;
	profileId?: string;
}

export interface RuntimeAssetPairVerificationRequest {
	asset: string;
	compressed: Uint8Array;
	uncompressed: Uint8Array;
	expected: RuntimeAssetIntegrityEntry;
	mimeType?: string;
	runtimeId?: string;
	profileId?: string;
}

export interface VerifiedRuntimeAssetIntegrity {
	readonly asset: string;
	readonly stage: RuntimeAssetIntegrityStage;
	readonly sha256: string;
	readonly bytes: number;
	readonly mediaType?: string;
}

export interface VerifiedRuntimeAssetPair {
	readonly compressed: VerifiedRuntimeAssetIntegrity;
	readonly uncompressed: VerifiedRuntimeAssetIntegrity;
}

export async function verifyRuntimeAssetIntegrity(
	request: RuntimeAssetIntegrityVerificationRequest
): Promise<VerifiedRuntimeAssetIntegrity> {
	const stage = request.stage ?? 'compressed';
	const context = {
		runtimeId: request.runtimeId,
		profileId: request.profileId
	};
	if (!request.asset || request.asset.includes('\0')) {
		throw new AssetIntegrityError(
			'Runtime asset identity must be a non-empty safe string',
			context
		);
	}
	if (
		!ArrayBuffer.isView(request.bytes) ||
		Object.prototype.toString.call(request.bytes) !== '[object Uint8Array]'
	) {
		throw new AssetIntegrityError(
			`Runtime asset ${request.asset} did not provide byte data`,
			context
		);
	}

	let expectedSha256: string;
	let expectedBytes: number | undefined;
	let expectedMediaType: string | undefined;
	if (typeof request.expected === 'string') {
		if (stage === 'uncompressed') {
			throw new AssetIntegrityError(
				`Runtime asset ${request.asset} is missing uncompressed integrity metadata`,
				context
			);
		}
		expectedSha256 = request.expected;
	} else if (request.expected && typeof request.expected === 'object') {
		if (stage === 'compressed') {
			expectedSha256 = request.expected.sha256;
			expectedBytes = request.expected.bytes;
			if (
				request.expected.uncompressedSha256 === undefined &&
				request.expected.uncompressedBytes === undefined
			) {
				expectedMediaType = request.expected.mediaType;
			}
		} else {
			if (
				request.expected.uncompressedSha256 === undefined ||
				request.expected.uncompressedBytes === undefined
			) {
				throw new AssetIntegrityError(
					`Runtime asset ${request.asset} is missing uncompressed integrity metadata`,
					context
				);
			}
			expectedSha256 = request.expected.uncompressedSha256;
			expectedBytes = request.expected.uncompressedBytes;
			expectedMediaType = request.expected.mediaType;
		}
	} else {
		throw new AssetIntegrityError(
			`Runtime asset ${request.asset} has invalid integrity metadata`,
			context
		);
	}

	if (!/^[a-f0-9]{64}$/u.test(expectedSha256)) {
		throw new AssetIntegrityError(
			`Runtime asset ${request.asset} has an invalid expected ${stage} SHA-256 digest`,
			context
		);
	}
	if (
		expectedBytes !== undefined &&
		(!Number.isSafeInteger(expectedBytes) || expectedBytes < 0)
	) {
		throw new AssetIntegrityError(
			`Runtime asset ${request.asset} has an invalid expected ${stage} byte size`,
			context
		);
	}
	if (expectedBytes !== undefined && request.bytes.byteLength !== expectedBytes) {
		throw new AssetIntegrityError(
			`Runtime asset ${request.asset} ${stage} size mismatch: expected ${expectedBytes} bytes, received ${request.bytes.byteLength}`,
			context
		);
	}
	if (expectedMediaType !== undefined) {
		if (!expectedMediaType.includes('/')) {
			throw new AssetIntegrityError(
				`Runtime asset ${request.asset} has an invalid expected MIME type`,
				context
			);
		}
		const actualMediaType =
			request.mimeType?.split(';', 1)[0]?.trim().toLowerCase() || 'missing';
		const normalizedExpectedMediaType = expectedMediaType.trim().toLowerCase();
		if (
			actualMediaType !== normalizedExpectedMediaType &&
			!(
				JAVASCRIPT_MEDIA_TYPES.has(actualMediaType) &&
				JAVASCRIPT_MEDIA_TYPES.has(normalizedExpectedMediaType)
			)
		) {
			throw new AssetIntegrityError(
				`Runtime asset ${request.asset} MIME type mismatch: expected ${normalizedExpectedMediaType}, received ${actualMediaType}`,
				context
			);
		}
	}
	if (!globalThis.crypto?.subtle) {
		throw new AssetIntegrityError('Web Crypto SHA-256 is unavailable', context);
	}
	const digestInput =
		request.bytes.byteOffset === 0 &&
		request.bytes.byteLength === request.bytes.buffer.byteLength &&
		request.bytes.buffer instanceof ArrayBuffer
			? request.bytes.buffer
			: Uint8Array.from(request.bytes).buffer;
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', digestInput));
	const actualSha256 = Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join(
		''
	);
	if (actualSha256 !== expectedSha256) {
		throw new AssetIntegrityError(
			`Runtime asset ${request.asset} ${stage} SHA-256 mismatch: expected ${expectedSha256}, received ${actualSha256}`,
			context
		);
	}

	return Object.freeze({
		asset: request.asset,
		stage,
		sha256: actualSha256,
		bytes: request.bytes.byteLength,
		mediaType: expectedMediaType
			? request.mimeType?.split(';', 1)[0]?.trim().toLowerCase()
			: undefined
	});
}

export async function verifyRuntimeAssetPair(
	request: RuntimeAssetPairVerificationRequest
): Promise<VerifiedRuntimeAssetPair> {
	const [compressed, uncompressed] = await Promise.all([
		verifyRuntimeAssetIntegrity({
			asset: request.asset,
			bytes: request.compressed,
			expected: request.expected,
			stage: 'compressed',
			runtimeId: request.runtimeId,
			profileId: request.profileId
		}),
		verifyRuntimeAssetIntegrity({
			asset: request.asset,
			bytes: request.uncompressed,
			expected: request.expected,
			stage: 'uncompressed',
			mimeType: request.mimeType,
			runtimeId: request.runtimeId,
			profileId: request.profileId
		})
	]);
	return Object.freeze({ compressed, uncompressed });
}
