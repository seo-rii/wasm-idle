import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	STATIC_STDIN_RING_CLOSED_INDEX,
	STATIC_STDIN_RING_CONTROL_SLOTS,
	STATIC_STDIN_RING_WRITE_INDEX
} from './staticStdinRing';
import { StaticWorkerRuntimeSandbox } from './staticWorkerRuntime';

const workers: FakeWorker[] = [];
const initialCrossOriginIsolation = Object.getOwnPropertyDescriptor(
	globalThis,
	'crossOriginIsolated'
);

class FakeWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	readonly runs: any[] = [];
	postMessage = vi.fn((message: any) => {
		if (message?.run) this.runs.push(message);
	});
	terminate = vi.fn();

	constructor(public url: string) {
		workers.push(this);
		queueMicrotask(() =>
			this.onmessage?.({ data: { __wasmIdleStaticWorkerReady: true } } as MessageEvent<any>)
		);
	}

	finishRun() {
		this.onmessage?.({
			data: { runId: this.runs.at(-1).runId, results: true }
		} as MessageEvent<any>);
	}
}

function createSandbox(mode: 'prebuffered' | 'streaming') {
	return new StaticWorkerRuntimeSandbox({
		languageId: 'STDIN_LIFECYCLE_TEST',
		displayName: 'Stdin lifecycle test',
		defaultActivePath: 'main.txt',
		stdin: { mode, sourceHintPattern: /read/ },
		resolveRuntimeAssets: () => ({
			baseUrl: '/stdin-lifecycle-test/',
			workerUrl: '/stdin-lifecycle-test/worker.js'
		})
	});
}

async function waitForDispatchedRun() {
	return vi.waitFor(() => {
		const worker = workers.find((candidate) => candidate.runs.length > 0);
		expect(worker).toBeDefined();
		return worker!;
	});
}

function ringControl(worker: FakeWorker) {
	return new Int32Array(worker.runs[0].stdinChannel.buffer, 0, STATIC_STDIN_RING_CONTROL_SLOTS);
}

describe('static worker stdin lifecycle', () => {
	beforeEach(() => {
		workers.length = 0;
		Object.defineProperty(globalThis, 'crossOriginIsolated', {
			configurable: true,
			value: true
		});
		vi.stubGlobal('Worker', FakeWorker);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('/* static worker */', { status: 200 }))
		);
		let bootstrapId = 0;
		vi.spyOn(URL, 'createObjectURL').mockImplementation(
			() => `blob:stdin-lifecycle-${bootstrapId++}`
		);
		vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		if (initialCrossOriginIsolation) {
			Object.defineProperty(globalThis, 'crossOriginIsolated', initialCrossOriginIsolation);
		} else {
			Reflect.deleteProperty(globalThis, 'crossOriginIsolated');
		}
	});

	it('starts a static runtime from a worker realm with no window', async () => {
		const currentUrl = 'https://example.test/wasm-idle/owner.worker.js';
		vi.stubGlobal('window', undefined);
		vi.stubGlobal('location', { href: currentUrl });
		const resolveRuntimeAssets = vi.fn((_assets: unknown, base: string) => ({
			baseUrl: new URL('./runtime/', base).href,
			workerUrl: './runtime/worker.js'
		}));
		const sandbox = new StaticWorkerRuntimeSandbox({
			languageId: 'WORKER_REALM_TEST',
			displayName: 'Worker realm test',
			defaultActivePath: 'main.txt',
			stdin: { mode: 'none' },
			resolveRuntimeAssets
		});
		try {
			await sandbox.load();
			expect(resolveRuntimeAssets).toHaveBeenCalledWith('', currentUrl);
			expect(fetch).toHaveBeenCalledWith(
				'https://example.test/wasm-idle/runtime/worker.js',
				expect.anything()
			);
			expect(workers).toHaveLength(1);
		} finally {
			await sandbox.dispose();
		}
	});

	it('does not let a buffered-stdin waiter from a failed run consume the next run input', async () => {
		const sandbox = createSandbox('prebuffered');
		await sandbox.load();

		const failedRun = sandbox.run('read()', false);
		await vi.waitFor(() => expect(sandbox.stdinWaiters).toHaveLength(1));
		const failedWorker = workers.at(-1)!;
		failedWorker.onerror?.({ message: 'worker crashed' } as ErrorEvent);
		await expect(failedRun).rejects.toMatchObject({ name: 'RuntimeExecutionError' });
		expect(sandbox.stdinWaiters).toHaveLength(0);

		const liveRun = sandbox.run('read()', false);
		await vi.waitFor(() => expect(sandbox.stdinWaiters).toHaveLength(1));
		sandbox.write('live input\n');
		sandbox.eof();

		const liveWorker = await waitForDispatchedRun();
		expect(liveWorker).not.toBe(failedWorker);
		expect(liveWorker.runs).toEqual([
			expect.objectContaining({ stdin: 'live input\n', stdinEof: true })
		]);
		liveWorker.finishRun();
		await expect(liveRun).resolves.toBe(true);
		await sandbox.dispose();
	});

	it('ignores terminal input after explicit stdin closed the streaming ring', async () => {
		const sandbox = createSandbox('streaming');
		expect(sandbox.stdinMode).toBe('streaming');
		await sandbox.load();

		const run = sandbox.run('read()', false, true, undefined, [], { stdin: 'given\n' });
		const worker = await waitForDispatchedRun();
		const control = ringControl(worker);
		expect(Atomics.load(control, STATIC_STDIN_RING_CLOSED_INDEX)).toBe(1);

		sandbox.write('typed during the run\n');
		sandbox.eof();
		expect(Atomics.load(control, STATIC_STDIN_RING_WRITE_INDEX)).toBe('given\n'.length);

		worker.finishRun();
		await expect(run).resolves.toBe(true);
		await sandbox.dispose();
	});

	it('ignores terminal input typed after Ctrl-D closed the streaming ring', async () => {
		const sandbox = createSandbox('streaming');
		await sandbox.load();

		const run = sandbox.run('read()', false);
		const worker = await waitForDispatchedRun();
		const control = ringControl(worker);
		sandbox.write('line\n');
		sandbox.eof();
		expect(Atomics.load(control, STATIC_STDIN_RING_CLOSED_INDEX)).toBe(1);

		sandbox.write('after ctrl-d\n');
		expect(Atomics.load(control, STATIC_STDIN_RING_WRITE_INDEX)).toBe('line\n'.length);

		worker.finishRun();
		await expect(run).resolves.toBe(true);
		await sandbox.dispose();
	});

	it('still fails a streaming run whose open stdin ring overflows', async () => {
		const sandbox = createSandbox('streaming');
		await sandbox.load();

		const run = sandbox.run('read()', false);
		await waitForDispatchedRun();
		sandbox.write('x'.repeat(128 * 1024 + 1));

		await expect(run).rejects.toMatchObject({ name: 'StaticStdinRingOverflowError' });
		await sandbox.dispose();
	});
});
