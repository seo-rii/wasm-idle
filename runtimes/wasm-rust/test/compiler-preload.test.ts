import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

const { loadBundledRuntimeContextMock } = vi.hoisted(() => ({
	loadBundledRuntimeContextMock: vi.fn()
}));

vi.mock('../src/compiler-runtime.js', () => ({
	loadBundledRuntimeContext: loadBundledRuntimeContextMock
}));

import { preloadBrowserRustRuntime } from '../src/compiler-preload.js';
import {
	clearRegisteredRuntimeAssetReceipts,
	fetchRuntimeAssetBytes,
	registerRuntimeAssetReceipts
} from '../src/runtime-asset.js';
import {
	createRuntimeAssetDeliveryBudget,
	readRuntimeAssetDeliveryBudget
} from '../src/runtime-delivery-budget.js';
import type { WasmRustRuntimeProfile } from '../src/runtime-manifest.js';

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

function createRuntimeProfile(profileId: string): WasmRustRuntimeProfile {
	const manifestFingerprint = sha256(`fingerprint:${profileId}`);
	return {
		profileId,
		protocolVersion: 1,
		manifestPath: 'runtime/runtime-manifest.v3.json',
		manifestFingerprint,
		manifestReceipt: {
			bytes: profileId.length,
			sha256: sha256(`manifest:${profileId}`)
		},
		moduleUrl: `https://${profileId}.example.test/index.js?v=${manifestFingerprint}`
	};
}

function installRuntimeContextMock() {
	loadBundledRuntimeContextMock.mockImplementation(
		(_manifestLoader, _targetTriple, runtimeProfile: WasmRustRuntimeProfile) => {
			const versionedModuleBaseUrl = new URL(runtimeProfile.moduleUrl);
			const versionedRuntimeBaseUrl = new URL('./runtime/', versionedModuleBaseUrl);
			versionedRuntimeBaseUrl.search = versionedModuleBaseUrl.search;
			return {
				manifest: {
					compiler: { rustcWasm: 'rustc/rustc.wasm' }
				},
				targetConfig: {
					targetTriple: 'wasm32-wasip1',
					artifactFormat: 'core-wasm',
					compile: { kind: 'integrated-rustc' },
					execution: { kind: 'preview1' }
				},
				versionedModuleBaseUrl,
				versionedRuntimeBaseUrl
			};
		}
	);
}

function createSuccessfulFetch(bytes = Uint8Array.of(1, 2, 3)) {
	return vi.fn(async () => new Response(bytes));
}

describe('preloadBrowserRustRuntime cache', () => {
	afterEach(() => {
		clearRegisteredRuntimeAssetReceipts();
		loadBundledRuntimeContextMock.mockReset();
		vi.unstubAllGlobals();
	});

	it('coalesces and retains successful preloads for the same receipt profile', async () => {
		installRuntimeContextMock();
		const fetchMock = createSuccessfulFetch();
		vi.stubGlobal('fetch', fetchMock);
		const runtimeProfile = createRuntimeProfile('cache-same-profile');

		await Promise.all([
			preloadBrowserRustRuntime({ dependencies: { runtimeProfile } }),
			preloadBrowserRustRuntime({ dependencies: { runtimeProfile } })
		]);
		await preloadBrowserRustRuntime({ dependencies: { runtimeProfile } });

		expect(loadBundledRuntimeContextMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it('does not reuse a preload across different receipt profiles', async () => {
		installRuntimeContextMock();
		const fetchMock = createSuccessfulFetch();
		vi.stubGlobal('fetch', fetchMock);

		await preloadBrowserRustRuntime({
			dependencies: { runtimeProfile: createRuntimeProfile('cache-profile-a') }
		});
		await preloadBrowserRustRuntime({
			dependencies: { runtimeProfile: createRuntimeProfile('cache-profile-b') }
		});

		expect(loadBundledRuntimeContextMock).toHaveBeenCalledTimes(2);
		expect(fetchMock).toHaveBeenCalledTimes(6);
	});

	it('bypasses the shared cache when a fetch dependency is injected', async () => {
		installRuntimeContextMock();
		const fetchImpl = createSuccessfulFetch();
		const runtimeProfile = createRuntimeProfile('cache-custom-fetch');

		await preloadBrowserRustRuntime({ dependencies: { fetchImpl, runtimeProfile } });
		await preloadBrowserRustRuntime({ dependencies: { fetchImpl, runtimeProfile } });

		expect(loadBundledRuntimeContextMock).toHaveBeenCalledTimes(2);
		expect(fetchImpl).toHaveBeenCalledTimes(6);
	});

	it('evicts a rejected preload so the same profile can retry', async () => {
		installRuntimeContextMock();
		let shouldReject = true;
		const fetchMock = vi.fn(async () => {
			if (shouldReject) {
				shouldReject = false;
				throw new Error('temporary preload failure');
			}
			return new Response(Uint8Array.of(1, 2, 3));
		});
		vi.stubGlobal('fetch', fetchMock);
		const runtimeProfile = createRuntimeProfile('cache-retry-profile');

		await expect(
			preloadBrowserRustRuntime({ dependencies: { runtimeProfile } })
		).rejects.toThrow('temporary preload failure');
		await preloadBrowserRustRuntime({ dependencies: { runtimeProfile } });

		expect(loadBundledRuntimeContextMock).toHaveBeenCalledTimes(2);
		expect(fetchMock).toHaveBeenCalledTimes(6);
	});

	it('rejects a preloaded runtime asset that does not match its registered receipt', async () => {
		installRuntimeContextMock();
		const runtimeProfile = createRuntimeProfile('cache-receipt-mismatch');
		const runtimeBaseUrl = new URL('./runtime/', runtimeProfile.moduleUrl);
		runtimeBaseUrl.search = new URL(runtimeProfile.moduleUrl).search;
		const expectedBytes = Uint8Array.of(1, 2, 3);
		registerRuntimeAssetReceipts(runtimeBaseUrl, {
			'rustc/rustc.wasm': {
				bytes: expectedBytes.byteLength,
				sha256: sha256(expectedBytes)
			}
		});
		vi.stubGlobal('fetch', createSuccessfulFetch(Uint8Array.of(9, 9, 9)));

		await expect(
			preloadBrowserRustRuntime({ dependencies: { runtimeProfile } })
		).rejects.toThrow('storage SHA-256 differs from its receipt');
	});

	it('scopes optionless module side-effect fetches before starting preload promises', async () => {
		const runtimeProfile = createRuntimeProfile('budgeted-module-side-effect');
		const versionedModuleBaseUrl = new URL(runtimeProfile.moduleUrl);
		const versionedRuntimeBaseUrl = new URL('./runtime/', versionedModuleBaseUrl);
		versionedRuntimeBaseUrl.search = versionedModuleBaseUrl.search;
		loadBundledRuntimeContextMock.mockResolvedValue({
			manifest: { compiler: { rustcWasm: 'rustc/rustc.wasm' } },
			targetConfig: {
				targetTriple: 'wasm32-wasip2',
				artifactFormat: 'component',
				compile: { kind: 'integrated-rustc+component-encoder' },
				execution: { kind: 'preview2-component' }
			},
			versionedModuleBaseUrl,
			versionedRuntimeBaseUrl
		});
		const responseBytes = Uint8Array.of(1, 2, 3);
		const fetchImpl = vi.fn(async () => new Response(responseBytes));
		let importedModules = 0;
		const importRuntimeModule = vi.fn(async () => {
			importedModules += 1;
			await fetchRuntimeAssetBytes(
				`https://example.test/module-side-effect-${importedModules}.bin`,
				'module side effect',
				fetchImpl,
				false
			);
			return {};
		});
		const assetDeliveryBudget = createRuntimeAssetDeliveryBudget(1024);

		await preloadBrowserRustRuntime({
			assetDeliveryBudget,
			dependencies: { fetchImpl, importRuntimeModule, runtimeProfile }
		});

		expect(importRuntimeModule).toHaveBeenCalled();
		expect(readRuntimeAssetDeliveryBudget(assetDeliveryBudget).deliveredBytes).toBe(
			fetchImpl.mock.calls.length * responseBytes.byteLength
		);
	});
});
