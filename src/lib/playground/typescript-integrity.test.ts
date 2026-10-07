import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaygroundRuntimeAssets } from './assets';

const TEST_RUNTIME_ASSETS = {
	typescript: { moduleUrl: '/wasm-typescript/index.js' }
} satisfies PlaygroundRuntimeAssets;

import {
	WASM_TYPESCRIPT_MODULE_RECEIPT,
	WASM_JAVASCRIPT_MODULE_RECEIPT
} from './wasmTypeScriptVersion';

const workerInstances: IntegrityWorker[] = [];
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

import TypeScriptSandbox from './typescript';

describe('TypeScript runtime integrity handoff', () => {
	beforeEach(() => {
		workerInstances.length = 0;
	});

	it('sends a detached pinned receipt and the resolved asset limit to the worker', async () => {
		const sandbox = new TypeScriptSandbox('TYPESCRIPT');
		const maxAssetBytes = WASM_TYPESCRIPT_MODULE_RECEIPT.bytes + 1024;

		await sandbox.load({ ...TEST_RUNTIME_ASSETS, rootUrl: '/absproxy/5173' }, '', true, [], {
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
		await sandbox.load({ ...TEST_RUNTIME_ASSETS, rootUrl: '/absproxy/5173' }, '', true, [], {
			limits: { maxAssetBytes: WASM_TYPESCRIPT_MODULE_RECEIPT.bytes }
		});

		await expect(
			sandbox.load({ ...TEST_RUNTIME_ASSETS, rootUrl: '/absproxy/5173' }, '', true, [], {
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

describe('JavaScript-only runtime selection', () => {
	beforeEach(() => {
		workerInstances.length = 0;
	});
	it('selects the pinned small entry within a limit too small for SWC', async () => {
		const sandbox = new TypeScriptSandbox('JAVASCRIPT');
		await sandbox.load(
			{
				typescript: {
					moduleUrl: 'https://example.test/index.js',
					javascriptModuleUrl: 'https://example.test/javascript.js?v=1'
				}
			},
			'',
			true,
			[],
			{ limits: { maxAssetBytes: WASM_JAVASCRIPT_MODULE_RECEIPT.bytes } }
		);
		const message = workerInstances[0].postMessage.mock.calls[0][0];
		expect(message.moduleUrl).toBe('https://example.test/javascript.js?v=1');
		expect(message.moduleReceipt).toEqual(WASM_JAVASCRIPT_MODULE_RECEIPT);
		expect(message.moduleReceipt).not.toBe(WASM_JAVASCRIPT_MODULE_RECEIPT);
		expect(message.maxAssetBytes).toBe(WASM_JAVASCRIPT_MODULE_RECEIPT.bytes);
		await sandbox.dispose();
	});
	it('preserves the legacy custom module URL and its full receipt', async () => {
		const sandbox = new TypeScriptSandbox('JAVASCRIPT');
		await sandbox.load({ typescript: { moduleUrl: 'https://example.test/legacy.js' } });
		const message = workerInstances[0].postMessage.mock.calls[0][0];
		expect(message.moduleUrl).toBe('https://example.test/legacy.js');
		expect(message.moduleReceipt).toEqual(WASM_TYPESCRIPT_MODULE_RECEIPT);
		await sandbox.dispose();
	});
	it('does not inspect the JavaScript-only URL in a TypeScript sandbox', async () => {
		const sandbox = new TypeScriptSandbox('TYPESCRIPT');
		await sandbox.load({
			typescript: {
				moduleUrl: 'https://example.test/index.js',
				get javascriptModuleUrl(): string {
					throw new Error('must not be read');
				}
			}
		});
		expect(workerInstances[0].postMessage.mock.calls[0][0].moduleReceipt).toEqual(
			WASM_TYPESCRIPT_MODULE_RECEIPT
		);
		await sandbox.dispose();
	});
	it('rejects an undersized JavaScript budget before creating a worker', async () => {
		const sandbox = new TypeScriptSandbox('JAVASCRIPT');
		await expect(
			sandbox.load(
				{ typescript: { javascriptModuleUrl: 'https://example.test/javascript.js' } },
				'',
				true,
				[],
				{ limits: { maxAssetBytes: WASM_JAVASCRIPT_MODULE_RECEIPT.bytes - 1 } }
			)
		).rejects.toMatchObject({
			code: 'asset-too-large',
			actual: WASM_JAVASCRIPT_MODULE_RECEIPT.bytes
		});
		expect(workerInstances).toHaveLength(0);
	});
	it('rejects invalid custom entry types before worker creation', async () => {
		const sandbox = new TypeScriptSandbox('JAVASCRIPT');
		await expect(
			sandbox.load({ typescript: { javascriptModuleUrl: 123 as unknown as string } })
		).rejects.toThrow('must be a string');
		expect(workerInstances).toHaveLength(0);
	});
	it('observes disposal from a caller-owned entry getter', async () => {
		const sandbox = new TypeScriptSandbox('JAVASCRIPT');
		await expect(
			sandbox.load({
				typescript: {
					get javascriptModuleUrl() {
						void sandbox.dispose();
						return 'https://example.test/javascript.js';
					}
				}
			})
		).rejects.toBeDefined();
		expect(workerInstances).toHaveLength(0);
	});
});
