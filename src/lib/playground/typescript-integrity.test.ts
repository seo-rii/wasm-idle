import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WASM_TYPESCRIPT_MODULE_RECEIPT } from './wasmTypeScriptVersion';

const workerInstances: IntegrityWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_TYPESCRIPT_MODULE_URL: '/wasm-typescript/index.js'
	}
}));

class IntegrityWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (!message.load) return;
		queueMicrotask(() => this.onmessage?.({ data: { load: true } } as MessageEvent<any>));
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/typescript?worker', () => ({
	default: IntegrityWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import TypeScriptSandbox from './typescript';

describe('TypeScript runtime integrity handoff', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_TYPESCRIPT_MODULE_URL = '/wasm-typescript/index.js';
	});

	it('sends a detached pinned receipt and the resolved asset limit to the worker', async () => {
		const sandbox = new TypeScriptSandbox('TYPESCRIPT');
		const maxAssetBytes = WASM_TYPESCRIPT_MODULE_RECEIPT.bytes + 1024;

		await sandbox.load('/absproxy/5173', '', true, [], {
			limits: { maxAssetBytes }
		});

		expect(workerInstances).toHaveLength(1);
		const loadMessage = workerInstances[0].postMessage.mock.calls[0][0];
		expect(loadMessage).toEqual(
			expect.objectContaining({
				load: true,
				moduleUrl: expect.stringMatching(/\/wasm-typescript\/index\.js$/u),
				moduleReceipt: WASM_TYPESCRIPT_MODULE_RECEIPT,
				maxAssetBytes
			})
		);
		expect(loadMessage.moduleReceipt).not.toBe(WASM_TYPESCRIPT_MODULE_RECEIPT);
	});

	it('rejects a tighter limit before reusing an already loaded worker', async () => {
		const sandbox = new TypeScriptSandbox('TYPESCRIPT');
		await sandbox.load('/absproxy/5173', '', true, [], {
			limits: { maxAssetBytes: WASM_TYPESCRIPT_MODULE_RECEIPT.bytes }
		});

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], {
				limits: { maxAssetBytes: WASM_TYPESCRIPT_MODULE_RECEIPT.bytes - 1 }
			})
		).rejects.toMatchObject({
			name: 'AssetTooLargeError',
			code: 'asset-too-large',
			limit: WASM_TYPESCRIPT_MODULE_RECEIPT.bytes - 1,
			actual: WASM_TYPESCRIPT_MODULE_RECEIPT.bytes
		});

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenCalledOnce();
		expect(workerInstances[0].terminate).not.toHaveBeenCalled();
	});
});
