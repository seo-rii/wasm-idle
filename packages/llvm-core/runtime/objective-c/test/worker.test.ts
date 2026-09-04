import { describe, expect, it, vi } from 'vitest';
import {
	installObjectiveCWorker,
	type ObjectiveCWorkerDependencies,
	type ObjectiveCWorkerScope
} from '../src/index.js';

describe('installObjectiveCWorker', () => {
	it('installs the worker protocol and delegates asset messages', async () => {
		const handleAssetMessage = vi.fn(() => true);
		const scope: ObjectiveCWorkerScope = {
			onmessage: null,
			postMessage: vi.fn()
		};

		installObjectiveCWorker(scope, {
			configureRuntimeAssets: vi.fn(),
			handleAssetMessage,
			waitForStdin: vi.fn(() => null),
			verifyRuntimeAssetIntegrity: vi.fn(async () => undefined)
		});

		expect(scope.document?.querySelectorAll()).toEqual([]);
		expect(scope.onmessage).not.toBeNull();
		await scope.onmessage?.({ data: { assetResponse: { id: 1 } } });
		expect(handleAssetMessage).toHaveBeenCalledWith({ assetResponse: { id: 1 } });
	});

	it('fails closed when the host does not install an integrity verifier', async () => {
		const scope: ObjectiveCWorkerScope = {
			onmessage: null,
			postMessage: vi.fn()
		};

		installObjectiveCWorker(scope, {
			configureRuntimeAssets: vi.fn(),
			handleAssetMessage: vi.fn(() => false),
			waitForStdin: vi.fn(() => null)
		} as unknown as ObjectiveCWorkerDependencies);
		await scope.onmessage?.({
			data: { load: true, log: false, objectivecAssets: {} }
		});

		expect(scope.postMessage).toHaveBeenCalledWith({
			error: 'Objective-C runtime asset integrity verifier is not installed.'
		});
	});

	it('settles an empty source request without waiting for compilation', async () => {
		const scope: ObjectiveCWorkerScope = {
			onmessage: null,
			postMessage: vi.fn()
		};

		installObjectiveCWorker(scope, {
			configureRuntimeAssets: vi.fn(),
			handleAssetMessage: vi.fn(() => false),
			waitForStdin: vi.fn(() => null),
			verifyRuntimeAssetIntegrity: vi.fn(async () => undefined)
		});
		await scope.onmessage?.({ data: { code: '', prepare: true, log: false } });

		expect(scope.postMessage).toHaveBeenCalledWith({ results: true });
	});
});
