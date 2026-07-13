import { beforeEach, describe, expect, it, vi } from 'vitest';

const installObjectiveCWorker = vi.fn();
const configureWorkerRuntimeAssets = vi.fn();
const handleWorkerAssetMessage = vi.fn();
const waitForBufferedStdin = vi.fn();

vi.mock('@seo-rii/wasm-llvm/runtime/objective-c', () => ({ installObjectiveCWorker }));
vi.mock('$lib/playground/worker/assets', () => ({
	configureWorkerRuntimeAssets,
	handleWorkerAssetMessage
}));
vi.mock('$lib/playground/stdinBuffer', () => ({ waitForBufferedStdin }));

describe('Objective-C worker adapter', () => {
	beforeEach(() => {
		vi.resetModules();
		installObjectiveCWorker.mockClear();
		(globalThis as any).self = globalThis;
	});

	it('installs the wasm-llvm worker runtime with wasm-idle asset and stdin hooks', async () => {
		await import('./objectivec');

		expect(installObjectiveCWorker).toHaveBeenCalledOnce();
		expect(installObjectiveCWorker).toHaveBeenCalledWith(globalThis, {
			configureRuntimeAssets: configureWorkerRuntimeAssets,
			handleAssetMessage: handleWorkerAssetMessage,
			waitForStdin: waitForBufferedStdin
		});
	});
});
