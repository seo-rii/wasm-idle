import { describe, expect, it, vi } from 'vitest';
import { installObjectiveCWorker, type ObjectiveCWorkerScope } from '../src/index.js';

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
			waitForStdin: vi.fn(() => null)
		});

		expect(scope.document?.querySelectorAll()).toEqual([]);
		expect(scope.onmessage).not.toBeNull();
		await scope.onmessage?.({ data: { assetResponse: { id: 1 } } });
		expect(handleAssetMessage).toHaveBeenCalledWith({ assetResponse: { id: 1 } });
	});
});
