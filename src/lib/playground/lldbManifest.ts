import {
	AssetIntegrityError,
	AssetTooLargeError,
	RuntimeConfigurationError,
	verifyRuntimeAssetIntegrity,
	type RuntimeAssetIntegrityEntry
} from '@wasm-idle/core';
import { parseDebugRuntimeManifest, type RuntimeManifestV2 } from '@wasm-idle/llvm-core/debug';

const MAX_DEBUG_MANIFEST_BYTES = 64 * 1024;

function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

function throwIfAborted(signal: AbortSignal | undefined) {
	if (signal?.aborted) throw abortReason(signal);
}

async function cancelResponseBody(response: Response, reason: unknown) {
	try {
		await response.body?.cancel(reason);
	} catch {
		// Preserve the validation or lifecycle failure that initiated cancellation.
	}
}

export async function loadVerifiedDebugRuntimeManifest(
	url: string,
	expected: Readonly<RuntimeAssetIntegrityEntry> | undefined,
	fetchImpl: typeof fetch,
	signal?: AbortSignal
): Promise<RuntimeManifestV2> {
	if (!expected || !/^[a-f0-9]{64}$/u.test(expected.sha256)) {
		throw new RuntimeConfigurationError(
			'LLDB runtime requires an expected manifest SHA-256 receipt.'
		);
	}
	if (
		expected.bytes !== undefined &&
		(!Number.isSafeInteger(expected.bytes) || expected.bytes < 0)
	) {
		throw new RuntimeConfigurationError(
			'LLDB runtime manifest receipt has an invalid byte size.'
		);
	}
	if (expected.bytes !== undefined && expected.bytes > MAX_DEBUG_MANIFEST_BYTES) {
		throw new AssetTooLargeError(
			`LLDB runtime manifest receipt exceeds ${MAX_DEBUG_MANIFEST_BYTES} bytes.`,
			{
				limit: MAX_DEBUG_MANIFEST_BYTES,
				actual: expected.bytes,
				runtimeId: 'wasm-debug',
				profileId: 'lldb-v2'
			}
		);
	}
	const receipt = Object.freeze({
		sha256: expected.sha256,
		...(expected.bytes === undefined ? {} : { bytes: expected.bytes })
	});
	throwIfAborted(signal);
	const response = await fetchImpl(url, { cache: 'no-store', signal });
	if (!response.ok) {
		const error = new Error(`Unable to load the LLDB runtime manifest (${response.status}).`);
		await cancelResponseBody(response, error);
		throw error;
	}
	if (signal?.aborted) {
		const error = abortReason(signal);
		await cancelResponseBody(response, error);
		throw error;
	}
	const contentLengthHeader = response.headers.get('content-length');
	if (contentLengthHeader !== null) {
		if (!/^\d+$/u.test(contentLengthHeader)) {
			const error = new AssetIntegrityError(
				'LLDB runtime manifest returned an invalid Content-Length.',
				{ runtimeId: 'wasm-debug', profileId: 'lldb-v2' }
			);
			await cancelResponseBody(response, error);
			throw error;
		}
		const declaredBytes = Number(contentLengthHeader);
		if (!Number.isSafeInteger(declaredBytes)) {
			const error = new AssetIntegrityError(
				'LLDB runtime manifest returned an invalid Content-Length.',
				{ runtimeId: 'wasm-debug', profileId: 'lldb-v2' }
			);
			await cancelResponseBody(response, error);
			throw error;
		}
		if (declaredBytes > MAX_DEBUG_MANIFEST_BYTES) {
			const error = new AssetTooLargeError(
				`LLDB runtime manifest exceeds ${MAX_DEBUG_MANIFEST_BYTES} bytes.`,
				{
					limit: MAX_DEBUG_MANIFEST_BYTES,
					actual: declaredBytes,
					runtimeId: 'wasm-debug',
					profileId: 'lldb-v2'
				}
			);
			await cancelResponseBody(response, error);
			throw error;
		}
	}
	if (!response.body) {
		throw new AssetIntegrityError('LLDB runtime manifest response body is unavailable.', {
			runtimeId: 'wasm-debug',
			profileId: 'lldb-v2'
		});
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let receivedBytes = 0;
	let readerFinished = false;
	let readerCancelled = false;
	const cancelOnAbort = () => {
		readerCancelled = true;
		void reader.cancel(abortReason(signal!)).catch(() => undefined);
	};
	signal?.addEventListener('abort', cancelOnAbort, { once: true });
	try {
		while (true) {
			throwIfAborted(signal);
			const { done, value } = await reader.read();
			throwIfAborted(signal);
			if (done) {
				readerFinished = true;
				break;
			}
			if (
				!ArrayBuffer.isView(value) ||
				Object.prototype.toString.call(value) !== '[object Uint8Array]'
			) {
				throw new AssetIntegrityError(
					'LLDB runtime manifest stream returned a non-byte chunk.',
					{ runtimeId: 'wasm-debug', profileId: 'lldb-v2' }
				);
			}
			const nextBytes = receivedBytes + value.byteLength;
			if (nextBytes > MAX_DEBUG_MANIFEST_BYTES) {
				const error = new AssetTooLargeError(
					`LLDB runtime manifest exceeds ${MAX_DEBUG_MANIFEST_BYTES} bytes.`,
					{
						limit: MAX_DEBUG_MANIFEST_BYTES,
						actual: nextBytes,
						runtimeId: 'wasm-debug',
						profileId: 'lldb-v2'
					}
				);
				readerCancelled = true;
				try {
					await reader.cancel(error);
				} catch {
					// Preserve the size-limit failure that initiated cancellation.
				}
				throw error;
			}
			chunks.push(Uint8Array.from(value));
			receivedBytes = nextBytes;
		}
	} catch (error) {
		if (!readerFinished && !readerCancelled) {
			try {
				readerCancelled = true;
				await reader.cancel(error);
			} catch {
				// Preserve the read or validation failure that initiated cancellation.
			}
		}
		throw error;
	} finally {
		signal?.removeEventListener('abort', cancelOnAbort);
		reader.releaseLock();
	}
	const bytes = new Uint8Array(receivedBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	await verifyRuntimeAssetIntegrity({
		asset: 'runtime-manifest.v2.json',
		bytes,
		expected: receipt,
		runtimeId: 'wasm-debug',
		profileId: 'lldb-v2'
	});
	return parseDebugRuntimeManifest(JSON.parse(new TextDecoder().decode(bytes)));
}
