import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
	AssetIntegrityError,
	AssetTooLargeError,
	RuntimeConfigurationError
} from '@wasm-idle/core';

const { parseManifest } = vi.hoisted(() => ({
	parseManifest: vi.fn((value: unknown) => value)
}));

vi.mock('@wasm-idle/llvm-core/debug', async (importOriginal) => ({
	...(await importOriginal<typeof import('@wasm-idle/llvm-core/debug')>()),
	parseDebugRuntimeManifest: parseManifest
}));

import { loadVerifiedDebugRuntimeManifest } from './lldbManifest';
import { WASM_DEBUG_RUNTIME_PROFILE } from './wasmDebugVersion';

const manifestUrl = 'https://example.com/wasm-debug/runtime-manifest.v2.json';
const staticManifestPath = resolve(process.cwd(), 'static/wasm-debug/runtime-manifest.v2.json');

function responseFor(bytes: Uint8Array) {
	const owned = new Uint8Array(bytes.byteLength);
	owned.set(bytes);
	return new Response(owned.buffer, {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

describe('LLDB runtime manifest receipt', () => {
	it.skipIf(!existsSync(staticManifestPath))(
		'matches the bundled profile receipt to the exact synced manifest bytes',
		async () => {
			const bytes = await readFile(staticManifestPath);
			expect(bytes.byteLength).toBe(WASM_DEBUG_RUNTIME_PROFILE.manifestReceipt.bytes);
			expect(createHash('sha256').update(bytes).digest('hex')).toBe(
				WASM_DEBUG_RUNTIME_PROFILE.manifestReceipt.sha256
			);
		}
	);

	it('verifies the raw response bytes before parsing the manifest', async () => {
		const bytes = new TextEncoder().encode('{\n  "manifestVersion": 2\n}\n');
		const receipt = {
			bytes: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex')
		};
		const fetchImpl = vi.fn(async () => responseFor(bytes));
		const manifest = await loadVerifiedDebugRuntimeManifest(
			manifestUrl,
			receipt,
			fetchImpl as unknown as typeof fetch
		);

		expect(manifest.manifestVersion).toBe(2);
		expect(parseManifest).toHaveBeenCalledWith({ manifestVersion: 2 });
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it('rejects a custom runtime without an expected manifest SHA before fetching it', async () => {
		const fetchImpl = vi.fn();

		await expect(
			loadVerifiedDebugRuntimeManifest(
				'https://cdn.example/debug/runtime-manifest.v2.json',
				undefined,
				fetchImpl as unknown as typeof fetch
			)
		).rejects.toBeInstanceOf(RuntimeConfigurationError);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('rejects a manifest receipt over 64 KiB before fetching it', async () => {
		const fetchImpl = vi.fn();

		await expect(
			loadVerifiedDebugRuntimeManifest(
				manifestUrl,
				{ bytes: 64 * 1024 + 1, sha256: '0'.repeat(64) },
				fetchImpl as unknown as typeof fetch
			)
		).rejects.toBeInstanceOf(AssetTooLargeError);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('does not fetch when startup was already aborted', async () => {
		const abortController = new AbortController();
		abortController.abort(new Error('debug startup stopped'));
		const fetchImpl = vi.fn();

		await expect(
			loadVerifiedDebugRuntimeManifest(
				manifestUrl,
				{ sha256: '0'.repeat(64) },
				fetchImpl as unknown as typeof fetch,
				abortController.signal
			)
		).rejects.toThrow('debug startup stopped');
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('cancels a response that arrives after startup is aborted', async () => {
		const abortController = new AbortController();
		const response = responseFor(Uint8Array.of(1));
		const cancel = vi.spyOn(response.body!, 'cancel');

		await expect(
			loadVerifiedDebugRuntimeManifest(
				manifestUrl,
				{ sha256: '0'.repeat(64) },
				vi.fn(async () => {
					abortController.abort(new Error('debug startup stopped'));
					return response;
				}) as unknown as typeof fetch,
				abortController.signal
			)
		).rejects.toThrow('debug startup stopped');
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('cancels an unsuccessful manifest response', async () => {
		const response = new Response('unavailable', { status: 503 });
		const cancel = vi.spyOn(response.body!, 'cancel');

		await expect(
			loadVerifiedDebugRuntimeManifest(
				manifestUrl,
				{ sha256: '0'.repeat(64) },
				vi.fn(async () => response) as unknown as typeof fetch
			)
		).rejects.toThrow('Unable to load the LLDB runtime manifest (503).');
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('rejects a raw manifest hash mismatch before parsing the response', async () => {
		parseManifest.mockClear();
		const invalidJson = new TextEncoder().encode('not json');
		const fetchImpl = vi.fn(async () => responseFor(invalidJson));

		await expect(
			loadVerifiedDebugRuntimeManifest(
				manifestUrl,
				{ sha256: '0'.repeat(64) },
				fetchImpl as unknown as typeof fetch
			)
		).rejects.toBeInstanceOf(AssetIntegrityError);
		expect(parseManifest).not.toHaveBeenCalled();
	});

	it('rejects an oversized Content-Length before reading the response body', async () => {
		const response = responseFor(Uint8Array.of(1));
		response.headers.set('content-length', String(64 * 1024 + 1));
		const arrayBuffer = vi.spyOn(response, 'arrayBuffer');
		const getReader = vi.spyOn(response.body!, 'getReader');
		const cancel = vi.spyOn(response.body!, 'cancel');

		await expect(
			loadVerifiedDebugRuntimeManifest(
				manifestUrl,
				{ sha256: '0'.repeat(64) },
				vi.fn(async () => response) as unknown as typeof fetch
			)
		).rejects.toBeInstanceOf(AssetTooLargeError);
		expect(getReader).not.toHaveBeenCalled();
		expect(arrayBuffer).not.toHaveBeenCalled();
		expect(cancel).toHaveBeenCalledOnce();
	});

	it.each(['-1', '65536.5', 'not-a-number'])(
		'rejects invalid Content-Length %s before reading the response body',
		async (contentLength) => {
			const response = responseFor(Uint8Array.of(1));
			response.headers.set('content-length', contentLength);
			const arrayBuffer = vi.spyOn(response, 'arrayBuffer');
			const getReader = vi.spyOn(response.body!, 'getReader');
			const cancel = vi.spyOn(response.body!, 'cancel');

			await expect(
				loadVerifiedDebugRuntimeManifest(
					manifestUrl,
					{ sha256: '0'.repeat(64) },
					vi.fn(async () => response) as unknown as typeof fetch
				)
			).rejects.toBeInstanceOf(AssetIntegrityError);
			expect(getReader).not.toHaveBeenCalled();
			expect(arrayBuffer).not.toHaveBeenCalled();
			expect(cancel).toHaveBeenCalledOnce();
		}
	);

	it.each([undefined, '1'])(
		'cancels a %s Content-Length stream when actual bytes exceed 64 KiB',
		async (contentLength) => {
			const cancel = vi.fn();
			const chunks = [new Uint8Array(32 * 1024), new Uint8Array(32 * 1024), Uint8Array.of(1)];
			const arrayBuffer = vi.fn();
			const response = {
				ok: true,
				status: 200,
				headers: new Headers(
					contentLength ? { 'content-length': contentLength } : undefined
				),
				body: {
					getReader: () => ({
						read: vi.fn(async () => {
							const value = chunks.shift();
							return value
								? { done: false, value }
								: { done: true, value: undefined };
						}),
						cancel,
						releaseLock: vi.fn()
					})
				},
				arrayBuffer
			} as unknown as Response;
			parseManifest.mockClear();

			await expect(
				loadVerifiedDebugRuntimeManifest(
					manifestUrl,
					{ sha256: '0'.repeat(64) },
					vi.fn(async () => response) as unknown as typeof fetch
				)
			).rejects.toBeInstanceOf(AssetTooLargeError);
			expect(cancel).toHaveBeenCalledOnce();
			expect(arrayBuffer).not.toHaveBeenCalled();
			expect(parseManifest).not.toHaveBeenCalled();
		}
	);

	it('preserves the size-limit failure when cancelling an oversized stream also fails', async () => {
		const cancelError = new Error('stream cancellation failed');
		const cancel = vi.fn(async () => {
			throw cancelError;
		});
		const chunks = [new Uint8Array(64 * 1024), Uint8Array.of(1)];
		const response = {
			ok: true,
			status: 200,
			headers: new Headers(),
			body: {
				getReader: () => ({
					read: vi.fn(async () => {
						const value = chunks.shift();
						return value ? { done: false, value } : { done: true, value: undefined };
					}),
					cancel,
					releaseLock: vi.fn()
				})
			}
		} as unknown as Response;

		await expect(
			loadVerifiedDebugRuntimeManifest(
				manifestUrl,
				{ sha256: '0'.repeat(64) },
				vi.fn(async () => response) as unknown as typeof fetch
			)
		).rejects.toBeInstanceOf(AssetTooLargeError);
		expect(cancel).toHaveBeenCalledOnce();
	});

	it('cancels a pending manifest body when startup is aborted', async () => {
		const abortController = new AbortController();
		let reportPull!: () => void;
		const pulled = new Promise<void>((resolve) => {
			reportPull = resolve;
		});
		let cancelled = false;
		const response = new Response(
			new ReadableStream<Uint8Array>({
				pull() {
					reportPull();
					return new Promise<void>(() => undefined);
				},
				cancel() {
					cancelled = true;
				}
			})
		);
		const loading = loadVerifiedDebugRuntimeManifest(
			manifestUrl,
			{ sha256: '0'.repeat(64) },
			vi.fn(async () => response) as unknown as typeof fetch,
			abortController.signal
		);

		await pulled;
		abortController.abort(new Error('debug startup stopped'));

		await expect(loading).rejects.toThrow('debug startup stopped');
		expect(cancelled).toBe(true);
	});
});
