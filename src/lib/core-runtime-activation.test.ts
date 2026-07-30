import { createHash } from 'node:crypto';
import {
	RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
	RuntimeProfileActivationStore,
	type RuntimeRegistryManifest
} from '@wasm-idle/core';
import { describe, expect, it, vi } from 'vitest';

const encoder = new TextEncoder();
const compressed = encoder.encode('compressed runtime');
const uncompressed = encoder.encode('logical runtime');

function createManifest(
	profileId = 'fortran-v1',
	compressedAsset = compressed,
	uncompressedAsset = uncompressed
): RuntimeRegistryManifest {
	return {
		schemaVersion: RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
		manifestId: 'wasm-idle/browser-runtimes',
		revision: profileId,
		runtimes: [
			{
				runtimeId: 'fortran/f2c',
				identity: {
					languageId: 'FORTRAN',
					implementationId: 'netlib-f2c',
					implementationVersion: '20200916',
					profile: {
						profileId,
						manifestSchemaVersion: 1,
						manifestSha256: createHash('sha256').update(profileId).digest('hex'),
						protocolVersion: 1,
						trustProfileId: 'restricted-browser-worker-v1',
						trustProfileSchemaVersion: 1
					}
				},
				capabilities: {
					stdin: 'prebuffered',
					workspace: false,
					abort: false,
					artifacts: false,
					streamingOutput: true
				},
				workerLifetime: { mode: 'per-run' },
				requiredBrowserFeatures: ['wasm'],
				assetRoot: 'wasm-fortran',
				assets: [
					{
						key: 'compiler',
						path: 'f2c.wasm.gz',
						compressedSha256: createHash('sha256')
							.update(compressedAsset)
							.digest('hex'),
						uncompressedSha256: createHash('sha256')
							.update(uncompressedAsset)
							.digest('hex'),
						compressedBytes: compressedAsset.byteLength,
						uncompressedBytes: uncompressedAsset.byteLength,
						mediaType: 'application/wasm',
						encoding: 'gzip'
					}
				],
				contracts: {
					routeId: 'fortran',
					runtimeAssetKey: 'fortran',
					documentationId: 'FORTRAN'
				}
			}
		]
	};
}

const activationAssets = (compressedAsset = compressed, uncompressedAsset = uncompressed) => ({
	compiler: {
		cacheKey: `sha256:${createHash('sha256').update(compressedAsset).digest('hex')}`,
		compressed: compressedAsset,
		uncompressed: uncompressedAsset,
		mimeType: 'application/wasm'
	}
});

describe('runtime profile activation', () => {
	it('publishes a complete profile only after every asset stage verifies', async () => {
		const store = new RuntimeProfileActivationStore();

		const snapshot = await store.activate({
			manifest: createManifest(),
			runtimeId: 'fortran/f2c',
			assets: activationAssets()
		});

		expect(store.get('fortran/f2c')).toBe(snapshot);
		expect(snapshot.profileId).toBe('fortran-v1');
		expect(snapshot.assets.compiler?.integrity.uncompressed.bytes).toBe(
			uncompressed.byteLength
		);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.assets)).toBe(true);
	});

	it('keeps the active profile unchanged when candidate verification fails', async () => {
		const store = new RuntimeProfileActivationStore();
		const active = await store.activate({
			manifest: createManifest(),
			runtimeId: 'fortran/f2c',
			assets: activationAssets()
		});
		const corruptAssets = activationAssets();
		corruptAssets.compiler.uncompressed = encoder.encode('corrupted runtime');

		await expect(
			store.activate({
				manifest: createManifest('fortran-v2'),
				runtimeId: 'fortran/f2c',
				assets: corruptAssets
			})
		).rejects.toThrow('uncompressed size mismatch');
		expect(store.get('fortran/f2c')).toBe(active);
	});

	it('rejects incomplete and unexpected activation sets', async () => {
		const store = new RuntimeProfileActivationStore();

		await expect(
			store.activate({
				manifest: createManifest(),
				runtimeId: 'fortran/f2c',
				assets: {}
			})
		).rejects.toThrow('missing assets: compiler');
		await expect(
			store.activate({
				manifest: createManifest(),
				runtimeId: 'fortran/f2c',
				assets: { ...activationAssets(), unexpected: activationAssets().compiler }
			})
		).rejects.toThrow('unexpected assets: unexpected');
	});

	it('rolls back to the previous fully verified profile', async () => {
		const store = new RuntimeProfileActivationStore();
		const first = await store.activate({
			manifest: createManifest('fortran-v1'),
			runtimeId: 'fortran/f2c',
			assets: activationAssets()
		});
		await store.activate({
			manifest: createManifest('fortran-v2'),
			runtimeId: 'fortran/f2c',
			assets: activationAssets()
		});

		expect(store.rollback('fortran/f2c')).toBe(first);
		expect(store.get('fortran/f2c')).toBe(first);
		expect(store.rollback('fortran/f2c')).toBeUndefined();
	});

	it('prevents a slower stale activation from replacing a newer profile', async () => {
		const store = new RuntimeProfileActivationStore();
		const slowCompressed = new Uint8Array(8 * 1024 * 1024);
		const slowUncompressed = new Uint8Array(8 * 1024 * 1024);
		const stale = store.activate({
			manifest: createManifest('fortran-stale', slowCompressed, slowUncompressed),
			runtimeId: 'fortran/f2c',
			assets: activationAssets(slowCompressed, slowUncompressed)
		});
		const current = store.activate({
			manifest: createManifest('fortran-current'),
			runtimeId: 'fortran/f2c',
			assets: activationAssets()
		});

		const [staleResult, currentResult] = await Promise.allSettled([stale, current]);
		expect(staleResult).toMatchObject({
			status: 'rejected',
			reason: expect.objectContaining({ message: expect.stringContaining('superseded') })
		});
		expect(currentResult).toMatchObject({ status: 'fulfilled' });
		expect(store.get('fortran/f2c')?.profileId).toBe('fortran-current');
	});

	it('does not publish a profile when cancellation wins during verification', async () => {
		const store = new RuntimeProfileActivationStore();
		const controller = new AbortController();
		const reason = new Error('stop integrity verification');
		let rejectDigest!: (reason: unknown) => void;
		const digest = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(
			() =>
				new Promise<ArrayBuffer>((_resolve, reject) => {
					rejectDigest = reject;
				})
		);
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const pending = store.activate({
			manifest: createManifest(),
			runtimeId: 'fortran/f2c',
			assets: activationAssets(),
			signal: controller.signal
		});
		let timeout: ReturnType<typeof setTimeout> | undefined;

		try {
			await vi.waitFor(() => expect(digest).toHaveBeenCalledTimes(2));
			controller.abort(reason);
			const outcome = await Promise.race([
				pending.then(
					(value) => ({ status: 'resolved' as const, value }),
					(error) => ({ status: 'rejected' as const, reason: error as unknown })
				),
				new Promise<{ status: 'pending' }>((resolve) => {
					timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
				})
			]);

			expect(outcome.status).toBe('rejected');
			expect('reason' in outcome ? outcome.reason : undefined).toMatchObject({
				name: 'CancelledError',
				code: 'cancelled',
				phase: 'asset',
				cause: reason
			});
			const abortRegistration = addEventListener.mock.calls.find(
				([type]) => type === 'abort'
			);
			expect(abortRegistration).toBeDefined();
			expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);

			rejectDigest(new Error('late integrity mismatch'));
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(store.get('fortran/f2c')).toBeUndefined();
		} finally {
			if (timeout) clearTimeout(timeout);
			rejectDigest(new Error('release integrity verification'));
			await pending.catch(() => {});
			digest.mockRestore();
		}
	});
});
