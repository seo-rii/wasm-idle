import type { ObjectiveCAssetIntegrityMap } from '@wasm-idle/llvm-core/objective-c';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeAssetsKey } from '@wasm-idle/core';
import { WASM_OBJECTIVEC_ASSET_RECEIPTS } from './wasmObjectiveCVersion';

vi.mock('$env/dynamic/public', () => ({ env: {} }));

const workerInstances: MockWorker[] = [];

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: (() => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (!message.load) return;
		queueMicrotask(() => this.onmessage?.({ data: { load: true } } as MessageEvent<any>));
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/objectivec?worker', () => ({ default: MockWorker }));

import ObjectiveC from './objectivec';

describe('Objective-C runtime asset ownership', () => {
	beforeEach(() => {
		workerInstances.length = 0;
	});

	it('uses one detached receipt snapshot for cache identity and worker startup', async () => {
		let configuredBytes = WASM_OBJECTIVEC_ASSET_RECEIPTS['libobjc.a'].bytes;
		let configuredSha256: string = WASM_OBJECTIVEC_ASSET_RECEIPTS['libobjc.a'].sha256;
		let observeReceipt!: () => void;
		const receiptObserved = new Promise<void>((resolve) => {
			observeReceipt = resolve;
		});
		const customIntegrity = Object.fromEntries(
			Object.entries(WASM_OBJECTIVEC_ASSET_RECEIPTS).map(([assetName, receipt]) => [
				assetName,
				assetName === 'libobjc.a'
					? {
							get bytes() {
								observeReceipt();
								return configuredBytes;
							},
							get sha256() {
								return configuredSha256;
							}
						}
					: { ...receipt }
			])
		) as ObjectiveCAssetIntegrityMap;
		const sandbox = new ObjectiveC();

		const firstLoad = sandbox.load({ objectivec: { integrity: customIntegrity } });
		await receiptObserved;
		configuredBytes += 1;
		configuredSha256 = 'b'.repeat(64);
		await firstLoad;

		const firstAssets = workerInstances[0]?.postMessage.mock.calls[0]?.[0].objectivecAssets;
		expect(firstAssets.integrity['libobjc.a']).toEqual(
			WASM_OBJECTIVEC_ASSET_RECEIPTS['libobjc.a']
		);
		expect(firstAssets.integrity).not.toBe(customIntegrity);
		expect(sandbox.activeObjectiveCAssetsKey).toBe(
			createRuntimeAssetsKey({ objectivec: firstAssets })
		);

		await sandbox.load({ objectivec: { integrity: customIntegrity } });

		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[0]?.terminate).toHaveBeenCalledOnce();
		const replacementAssets =
			workerInstances[1]?.postMessage.mock.calls[0]?.[0].objectivecAssets;
		expect(replacementAssets.integrity['libobjc.a']).toEqual({
			bytes: configuredBytes,
			sha256: configuredSha256
		});
		expect(sandbox.activeObjectiveCAssetsKey).toBe(
			createRuntimeAssetsKey({ objectivec: replacementAssets })
		);
	});
});
