import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWasmIdleSharedBuffer } from './sharedBuffer';
import { flushQueuedStdin, readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_TYPESCRIPT_MODULE_URL: '/runtime/typescript/index.js'
	}
}));
let autoResolveLoad = true;
let autoResolveRun = true;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load) {
			if (autoResolveLoad) queueMicrotask(() => this.resolveLoad());
			return;
		}
		if (autoResolveRun) queueMicrotask(() => this.resolveRun());
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}

	resolveLoad() {
		this.onmessage?.({ data: { load: true } } as MessageEvent<any>);
	}

	resolveRun(result: boolean | string = true) {
		this.onmessage?.({ data: { results: result } } as MessageEvent<any>);
	}
}

vi.mock('$lib/playground/worker/typescript?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import TypeScriptSandbox from './typescript';

async function observeSettlement<T>(promise: Promise<T>) {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise.then(
				(value) => ({ status: 'resolved' as const, value }),
				(reason) => ({ status: 'rejected' as const, reason: reason as unknown })
			),
			new Promise<{ status: 'pending' }>((resolve) => {
				timeout = setTimeout(() => resolve({ status: 'pending' }), 25);
			})
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

describe.each(['TYPESCRIPT', 'JAVASCRIPT'] as const)(
	'%s terminal sandbox lifecycle',
	(language) => {
		beforeEach(() => {
			vi.restoreAllMocks();
			workerInstances.length = 0;
			autoResolveLoad = true;
			autoResolveRun = true;
			publicEnv.PUBLIC_WASM_TYPESCRIPT_MODULE_URL = '/runtime/typescript/index.js';
			history.replaceState({}, '', '/editor');
		});

		it('keeps clear reusable but disposes an idle sandbox exactly once', async () => {
			const sandbox = new TypeScriptSandbox(language);
			const output = vi.fn();
			const diagnostic = vi.fn();
			sandbox.output = output;
			sandbox.oncompilerdiagnostic = diagnostic;
			await sandbox.load('/assets/');
			await expect(sandbox.run('console.log(1)', false)).resolves.toBe(true);
			const firstWorker = workerInstances[0];

			await sandbox.clear();
			expect(firstWorker?.terminate).not.toHaveBeenCalled();
			await sandbox.load('/assets/');
			await expect(sandbox.run('console.log(2)', false)).resolves.toBe(true);
			const worker = workerInstances[0];
			flushQueuedStdin(['buffered input\n'], sandbox.buffer);
			sandbox.write('queued input\n');
			sandbox.eof();

			let cleanupSnapshot: Record<string, unknown> | undefined;
			let reentrantLoad: Promise<void> | undefined;
			let reentrantRun: Promise<boolean | string> | undefined;
			let reentrantDisposal: Promise<void> | undefined;
			worker?.terminate.mockImplementationOnce(() => {
				cleanupSnapshot = {
					worker: sandbox.worker,
					moduleUrl: sandbox.moduleUrl,
					output: sandbox.output,
					diagnostic: sandbox.oncompilerdiagnostic,
					pendingInput: [...sandbox.pendingInput],
					waitingForInput: sandbox.waitingForInput,
					pendingEof: sandbox.pendingEof,
					bufferedInput: readBufferedStdin(sandbox.buffer),
					onmessage: worker.onmessage,
					onerror: worker.onerror,
					onmessageerror: worker.onmessageerror
				};
				reentrantLoad = sandbox.load('/reentrant/');
				reentrantRun = sandbox.run('reentrant()', false);
				void reentrantLoad.catch(() => undefined);
				void reentrantRun.catch(() => undefined);
				reentrantDisposal = sandbox.dispose();
			});

			const firstDisposal = sandbox.dispose();
			const secondDisposal = sandbox.dispose();
			expect(secondDisposal).toBe(firstDisposal);
			expect(reentrantDisposal).toBe(firstDisposal);
			await firstDisposal;

			expect(cleanupSnapshot).toEqual({
				worker: undefined,
				moduleUrl: '',
				output: undefined,
				diagnostic: undefined,
				pendingInput: [],
				waitingForInput: false,
				pendingEof: false,
				bufferedInput: '',
				onmessage: null,
				onerror: null,
				onmessageerror: null
			});
			expect(worker?.terminate).toHaveBeenCalledOnce();
			for (const operation of [reentrantLoad, reentrantRun]) {
				await expect(operation).rejects.toMatchObject({
					name: 'RuntimeConfigurationError',
					code: 'runtime-configuration',
					phase: 'dispose',
					runtimeId: language
				});
			}
			await expect(sandbox.load('/replacement/')).rejects.toMatchObject({
				name: 'RuntimeConfigurationError',
				code: 'runtime-configuration',
				phase: 'dispose',
				runtimeId: language
			});
			await expect(sandbox.run('later()', false)).rejects.toMatchObject({
				name: 'RuntimeConfigurationError',
				code: 'runtime-configuration',
				phase: 'dispose',
				runtimeId: language
			});
			const uidAfterDisposal = sandbox.uid;
			sandbox.write('ignored input\n');
			sandbox.eof();
			sandbox.kill();
			sandbox.terminate();
			await sandbox.clear();
			expect(sandbox.uid).toBe(uidAfterDisposal);
			expect(sandbox.pendingInput).toEqual([]);
			expect(sandbox.pendingEof).toBe(false);
			expect(readBufferedStdin(sandbox.buffer)).toBe('');
			expect(worker?.terminate).toHaveBeenCalledOnce();
			expect(workerInstances).toHaveLength(1);
		});

		it('settles active startup with one terminal cancellation', async () => {
			autoResolveLoad = false;
			const sandbox = new TypeScriptSandbox(language);
			const controller = new AbortController();
			const racingReason = new Error(`${language} startup abort raced disposal`);
			const progress = { set: vi.fn() };
			const loading = sandbox.load(
				'/assets/',
				'',
				true,
				[],
				{ signal: controller.signal },
				progress
			);
			await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
			const worker = workerInstances[0];
			const staleHandler = worker?.onmessage;
			worker?.terminate.mockImplementationOnce(() => controller.abort(racingReason));

			const disposal = sandbox.dispose();
			const cancellation = await loading.catch((error) => error);
			await disposal;

			expect(cancellation).toBe(Reflect.get(sandbox, 'disposeCancellation'));
			expect(cancellation).toMatchObject({
				name: 'CancelledError',
				code: 'cancelled',
				phase: 'dispose',
				runtimeId: language,
				recoverable: false
			});
			expect(worker?.terminate).toHaveBeenCalledOnce();
			staleHandler?.({ data: { load: true } } as MessageEvent<any>);
			expect(progress.set).not.toHaveBeenCalled();
			expect(sandbox.worker).toBeUndefined();
		});

		it('settles an active run and clears its actual and replacement stdin buffers', async () => {
			autoResolveRun = false;
			const sandbox = new TypeScriptSandbox(language);
			const output = vi.fn();
			sandbox.output = output;
			await sandbox.load('/assets/');
			const controller = new AbortController();
			const racingReason = new Error(`${language} execution abort raced disposal`);
			const running = sandbox.run('pending()', false, true, undefined, [], {
				signal: controller.signal
			});
			const worker = workerInstances[0];
			await vi.waitFor(() => expect(worker?.postMessage).toHaveBeenCalledTimes(2));
			const runMessage = worker?.postMessage.mock.calls[1]?.[0] as {
				buffer: SharedArrayBuffer;
			};
			const operationBuffer = runMessage.buffer;
			const staleHandler = worker?.onmessage;
			staleHandler?.({ data: { buffer: true } } as MessageEvent<any>);
			sandbox.write('operation input\n');
			expect(readBufferedStdin(operationBuffer)).toBe('operation input\n');
			const replacementBuffer = createWasmIdleSharedBuffer(1024);
			flushQueuedStdin(['replacement input\n'], replacementBuffer);
			sandbox.buffer = replacementBuffer;
			worker?.terminate.mockImplementationOnce(() => controller.abort(racingReason));

			const disposal = sandbox.dispose();
			const cancellation = await running.catch((error) => error);
			await disposal;

			expect(cancellation).toBe(Reflect.get(sandbox, 'disposeCancellation'));
			expect(readBufferedStdin(operationBuffer)).toBe('');
			expect(readBufferedStdin(replacementBuffer)).toBe('');
			expect(worker?.terminate).toHaveBeenCalledOnce();
			staleHandler?.({
				data: { buffer: true, output: 'late output\n', results: true }
			} as MessageEvent<any>);
			expect(output).not.toHaveBeenCalled();
			expect(sandbox.output).toBeUndefined();
			expect(sandbox.worker).toBeUndefined();
		});

		it('does not retain a replacement worker when retirement reenters disposal', async () => {
			const sandbox = new TypeScriptSandbox(language);
			await sandbox.load('/assets/');
			const retiredWorker = workerInstances[0];
			delete sandbox.worker;
			let reentrantDisposal: Promise<void> | undefined;
			retiredWorker?.terminate.mockImplementationOnce(() => {
				reentrantDisposal = sandbox.dispose();
			});

			const replacement = sandbox.load('/assets/');
			const cancellation = await replacement.catch((error) => error);

			expect(cancellation).toBe(Reflect.get(sandbox, 'disposeCancellation'));
			expect(sandbox.dispose()).toBe(reentrantDisposal);
			await reentrantDisposal;
			expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
			expect(workerInstances).toHaveLength(2);
			expect(workerInstances[1]?.terminate).toHaveBeenCalledOnce();
			expect(sandbox.worker).toBeUndefined();
			expect(sandbox.moduleUrl).toBe('');
		});

		it('does not start a replacement after worker reset reenters disposal', async () => {
			const sandbox = new TypeScriptSandbox(language);
			await sandbox.load('/assets/');
			const retiredWorker = workerInstances[0];
			let reentrantDisposal: Promise<void> | undefined;
			retiredWorker?.terminate.mockImplementationOnce(() => {
				reentrantDisposal = sandbox.dispose();
			});

			const replacement = sandbox.load({
				typescript: { moduleUrl: '/replacement/typescript.js' }
			});
			const cancellation = await replacement.catch((error) => error);

			expect(cancellation).toBe(Reflect.get(sandbox, 'disposeCancellation'));
			expect(sandbox.dispose()).toBe(reentrantDisposal);
			await reentrantDisposal;
			expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
			expect(workerInstances).toHaveLength(1);
			expect(sandbox.worker).toBeUndefined();
			expect(sandbox.moduleUrl).toBe('');
		});

		it('settles a run whose worker attach reenters terminal disposal', async () => {
			autoResolveRun = false;
			const sandbox = new TypeScriptSandbox(language);
			await sandbox.load('/assets/');
			const retiredWorker = workerInstances[0];
			const candidateWorker = new MockWorker();
			sandbox.worker = candidateWorker as unknown as Worker;
			let reentrantDisposal: Promise<void> | undefined;
			retiredWorker?.terminate.mockImplementationOnce(() => {
				reentrantDisposal = sandbox.dispose();
			});

			const running = sandbox.run('pending()', false);
			const settlement = await observeSettlement(running);

			expect(settlement).toEqual({
				status: 'rejected',
				reason: Reflect.get(sandbox, 'disposeCancellation')
			});
			expect(sandbox.dispose()).toBe(reentrantDisposal);
			await reentrantDisposal;
			expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
			expect(candidateWorker.terminate).toHaveBeenCalledOnce();
			expect(candidateWorker.postMessage).not.toHaveBeenCalled();
			expect(sandbox.worker).toBeUndefined();
		});
	}
);

describe('TypeScript and JavaScript sandbox ownership', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		workerInstances.length = 0;
		autoResolveLoad = true;
		autoResolveRun = true;
		publicEnv.PUBLIC_WASM_TYPESCRIPT_MODULE_URL = '/runtime/typescript/index.js';
		history.replaceState({}, '', '/editor');
	});

	it('keeps a TypeScript sandbox alive when a separate JavaScript sandbox is disposed', async () => {
		const javascript = new TypeScriptSandbox('JAVASCRIPT');
		const typescript = new TypeScriptSandbox('TYPESCRIPT');
		await javascript.load('/assets/');
		await typescript.load('/assets/');
		const javascriptWorker = workerInstances[0];
		const typescriptWorker = workerInstances[1];

		await javascript.dispose();

		expect(javascriptWorker?.terminate).toHaveBeenCalledOnce();
		expect(typescriptWorker?.terminate).not.toHaveBeenCalled();
		await expect(typescript.run('console.log(1)', false)).resolves.toBe(true);
		await expect(javascript.run('console.log(1)', false)).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			runtimeId: 'JAVASCRIPT',
			phase: 'dispose'
		});
		await typescript.dispose();
		expect(typescriptWorker?.terminate).toHaveBeenCalledOnce();
	});
});
