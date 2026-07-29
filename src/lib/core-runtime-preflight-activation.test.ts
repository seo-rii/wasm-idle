import { createHash } from 'node:crypto';
import {
	RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
	RuntimeProfileActivationStore,
	activatePreflightedRuntimeProfile,
	preflightRuntimeAssets,
	type RuntimeRegistryAsset,
	type RuntimeRegistryManifest
} from '@wasm-idle/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

const encoder = new TextEncoder();
const compressed = encoder.encode('compressed runtime');
const uncompressed = encoder.encode('logical runtime');
const identity = encoder.encode('export default 1;');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const assets: readonly RuntimeRegistryAsset[] = [
	{
		key: 'compiler',
		path: 'compiler.wasm.gz',
		compressedSha256: sha256(compressed),
		uncompressedSha256: sha256(uncompressed),
		compressedBytes: compressed.byteLength,
		uncompressedBytes: uncompressed.byteLength,
		mediaType: 'application/wasm',
		encoding: 'gzip'
	},
	{
		key: 'loader',
		path: 'loader.js',
		compressedSha256: sha256(identity),
		uncompressedSha256: sha256(identity),
		compressedBytes: identity.byteLength,
		uncompressedBytes: identity.byteLength,
		mediaType: 'text/javascript',
		encoding: 'identity'
	}
];

function createManifest(profileId = 'activation-v1'): RuntimeRegistryManifest {
	return {
		schemaVersion: RUNTIME_REGISTRY_MANIFEST_SCHEMA_VERSION,
		manifestId: 'wasm-idle/preflight-activation-test',
		revision: profileId,
		runtimes: [
			{
				runtimeId: 'fortran/activation-test',
				identity: {
					languageId: 'FORTRAN',
					implementationId: 'activation-test',
					implementationVersion: '1.0.0',
					profile: {
						profileId,
						manifestSchemaVersion: 1,
						manifestSha256: sha256(encoder.encode(profileId)),
						protocolVersion: 1,
						trustProfileId: 'restricted-browser-worker-v1',
						trustProfileSchemaVersion: 1
					}
				},
				capabilities: {
					stdin: 'prebuffered',
					workspace: false,
					abort: true,
					artifacts: false,
					streamingOutput: true
				},
				workerLifetime: { mode: 'per-run' },
				requiredBrowserFeatures: ['wasm'],
				assetRoot: 'runtime',
				assets,
				contracts: {
					routeId: 'fortran',
					runtimeAssetKey: 'fortran',
					documentationId: 'FORTRAN'
				}
			}
		]
	};
}

async function createPreflight(manifest: RuntimeRegistryManifest) {
	return await preflightRuntimeAssets({
		manifest,
		runtimeId: 'fortran/activation-test',
		rootUrl: 'https://example.test/',
		fetch: async (input) =>
			String(input).endsWith('.gz')
				? new Response(compressed, { headers: { 'content-type': 'application/gzip' } })
				: new Response(identity, { headers: { 'content-type': 'text/javascript' } })
	});
}

afterEach(() => {
	vi.useRealTimers();
});

describe('preflighted runtime profile activation', () => {
	it('decodes encoded assets and atomically publishes paired integrity', async () => {
		const manifest = createManifest();
		const preflight = await createPreflight(manifest);
		const store = new RuntimeProfileActivationStore();
		const decode = vi.fn(async ({ encoding, bytes, maxOutputBytes }) => {
			expect(encoding).toBe('gzip');
			expect(Array.from(bytes)).toEqual(Array.from(compressed));
			expect(maxOutputBytes).toBeGreaterThan(uncompressed.byteLength);
			return uncompressed;
		});

		const snapshot = await activatePreflightedRuntimeProfile({
			store,
			manifest,
			preflight,
			decode
		});

		expect(decode).toHaveBeenCalledTimes(1);
		expect(store.get('fortran/activation-test')).toBe(snapshot);
		expect(snapshot.assets.compiler?.integrity).toMatchObject({
			compressed: { sha256: sha256(compressed) },
			uncompressed: { sha256: sha256(uncompressed) }
		});
		expect(snapshot.assets.loader?.integrity.uncompressed.sha256).toBe(sha256(identity));
	});

	it('keeps the active profile unchanged when decoded bytes are corrupt', async () => {
		const store = new RuntimeProfileActivationStore();
		const firstManifest = createManifest('activation-v1');
		const first = await activatePreflightedRuntimeProfile({
			store,
			manifest: firstManifest,
			preflight: await createPreflight(firstManifest),
			decode: async () => uncompressed
		});
		const secondManifest = createManifest('activation-v2');

		await expect(
			activatePreflightedRuntimeProfile({
				store,
				manifest: secondManifest,
				preflight: await createPreflight(secondManifest),
				decode: async () => encoder.encode('corrupt')
			})
		).rejects.toMatchObject({ name: 'AssetIntegrityError', code: 'asset-integrity' });
		expect(store.get('fortran/activation-test')).toBe(first);
	});

	it('requires a decoder for encoded assets', async () => {
		const manifest = createManifest();

		await expect(
			activatePreflightedRuntimeProfile({
				store: new RuntimeProfileActivationStore(),
				manifest,
				preflight: await createPreflight(manifest)
			})
		).rejects.toThrow('requires a gzip decoder');
	});

	it('rejects a forged preflight cache identity before decoding', async () => {
		const manifest = createManifest();
		const preflight = await createPreflight(manifest);
		const decode = vi.fn(async () => uncompressed);

		await expect(
			activatePreflightedRuntimeProfile({
				store: new RuntimeProfileActivationStore(),
				manifest,
				preflight: {
					...preflight,
					assets: {
						...preflight.assets,
						compiler: {
							...preflight.assets.compiler!,
							cacheKey: `sha256:${'0'.repeat(64)}`
						}
					}
				},
				decode
			})
		).rejects.toThrow('cache key does not match its delivery hash');
		expect(decode).not.toHaveBeenCalled();
	});

	it('rejects decoder output above the execution asset limit', async () => {
		const manifest = createManifest();
		const assetLimit = Math.max(compressed.byteLength, uncompressed.byteLength);
		const oversized = new Uint8Array(assetLimit + 1);

		await expect(
			activatePreflightedRuntimeProfile({
				store: new RuntimeProfileActivationStore(),
				manifest,
				preflight: await createPreflight(manifest),
				decode: async () => oversized,
				limits: { maxAssetBytes: assetLimit }
			})
		).rejects.toMatchObject({
			name: 'AssetTooLargeError',
			limit: assetLimit,
			actual: oversized.byteLength
		});
	});

	it('settles with typed timeout when a decoder ignores cancellation', async () => {
		vi.useFakeTimers();
		const manifest = createManifest();
		const pending = activatePreflightedRuntimeProfile({
			store: new RuntimeProfileActivationStore(),
			manifest,
			preflight: await createPreflight(manifest),
			decode: async () => await new Promise<Uint8Array>(() => {}),
			limits: { assetTimeoutMs: 10 }
		});
		const timedOut = expect(pending).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'asset',
			timeoutMs: 10
		});
		await vi.advanceTimersByTimeAsync(11);
		await timedOut;
	});

	it('does not invoke a decoder for a pre-aborted activation', async () => {
		const manifest = createManifest();
		const controller = new AbortController();
		const decode = vi.fn(async () => uncompressed);
		controller.abort(new Error('stop'));

		await expect(
			activatePreflightedRuntimeProfile({
				store: new RuntimeProfileActivationStore(),
				manifest,
				preflight: await createPreflight(manifest),
				decode,
				signal: controller.signal
			})
		).rejects.toMatchObject({ name: 'CancelledError', code: 'cancelled', phase: 'asset' });
		expect(decode).not.toHaveBeenCalled();
	});
});
