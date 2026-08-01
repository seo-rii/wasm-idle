import { beforeEach, describe, expect, it, vi } from 'vitest';

type RuntimeFixtureState = {
	bootCalls: number;
	bootGate: Promise<void>;
	disposeCalls: number;
	disposeThrows: boolean;
	executeCalls: number;
	executeGate: Promise<void>;
	importCalls: number;
	importGate: Promise<void>;
	planCalls: number;
	planGate: Promise<void>;
	runtimeRecords: Array<{
		artifact: { path: string; bytes: Uint8Array; runnable: boolean } | null;
		bootCalls: number;
		disposeCalls: number;
		executeCalls: number;
		planCalls: number;
	}>;
};

const createRuntimeFixtureState = (): RuntimeFixtureState => ({
	bootCalls: 0,
	bootGate: Promise.resolve(),
	disposeCalls: 0,
	disposeThrows: false,
	executeCalls: 0,
	executeGate: Promise.resolve(),
	importCalls: 0,
	importGate: Promise.resolve(),
	planCalls: 0,
	planGate: Promise.resolve(),
	runtimeRecords: []
});

const runtimeFixtureState = createRuntimeFixtureState();

Object.assign(globalThis, {
	__wasmIdleTinyGoLifecycleFixture: runtimeFixtureState
});

const runtimeModuleSource = `
const state = globalThis.__wasmIdleTinyGoLifecycleFixture;
state.importCalls += 1;
await state.importGate;
export const createBundledTinyGoRuntime = (options = {}) => {
const gates = {
  boot: state.bootGate,
  plan: state.planGate,
  execute: state.executeGate,
  disposeThrows: state.disposeThrows
};
const record = {
  activityLog: '',
  artifact: null,
  bootCalls: 0,
  disposeCalls: 0,
  executeCalls: 0,
  planCalls: 0
};
state.runtimeRecords.push(record);
return ({
  async boot() {
    state.bootCalls += 1;
    record.bootCalls += 1;
    await gates.boot;
    options.onProgress?.({ assetPath: 'boot.wasm', assetUrl: 'boot.wasm', label: 'boot', loaded: 1, total: 1 });
    record.activityLog += 'boot complete\\n';
  },
  async plan() {
    state.planCalls += 1;
    record.planCalls += 1;
    await gates.plan;
    record.activityLog += 'plan complete\\n';
    return { ok: true };
  },
  async execute() {
    state.executeCalls += 1;
    record.executeCalls += 1;
    await gates.execute;
    record.activityLog += 'execute complete\\n';
    record.artifact = {
      path: '/working/out.wasm',
      bytes: new Uint8Array([0, 97, 115, 109]),
      runnable: true
    };
  },
  reset() {
    record.activityLog = '';
    record.artifact = null;
  },
  readActivityLog() {
    return record.activityLog;
  },
  readBuildArtifact() {
    return record.artifact;
  },
  setBuildRequestOverrides() {},
  setWorkspaceFiles() {},
  dispose() {
    state.disposeCalls += 1;
    record.disposeCalls += 1;
    if (gates.disposeThrows) throw new Error('TinyGo runtime cleanup failed');
  }
});
}
`;

const createRuntimeModuleUrl = (marker = 'default') =>
	`data:text/javascript;base64,${Buffer.from(`${runtimeModuleSource}\n// ${marker}`, 'utf8').toString('base64')}`;

const runtimeModuleUrl = createRuntimeModuleUrl();

const workerInstances: MockWorker[] = [];
let autoResolveLoad = true;
let autoResolveRun = true;

class MockWorker {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
	postMessage = vi.fn((message: { load?: boolean }) => {
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
		this.onmessage?.({ data: { load: true } } as MessageEvent<unknown>);
	}

	resolveRun(output?: string) {
		this.onmessage?.({ data: { output, results: true } } as MessageEvent<unknown>);
	}
}

const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_TINYGO_APP_URL: '',
		PUBLIC_WASM_TINYGO_MODULE_URL: ''
	}
}));

vi.mock('$lib/playground/worker/tinygo?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import TinyGo from './tinygo';

const runtimeAssets = {
	rootUrl: '/assets',
	tinygo: { moduleUrl: runtimeModuleUrl }
};

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

describe('TinyGo operation lifecycle', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		workerInstances.length = 0;
		autoResolveLoad = true;
		autoResolveRun = true;
		Object.assign(runtimeFixtureState, createRuntimeFixtureState());
		window.history.replaceState({}, '', 'http://localhost:3000/');
		publicEnv.PUBLIC_WASM_TINYGO_APP_URL = '';
		publicEnv.PUBLIC_WASM_TINYGO_MODULE_URL = '';
	});

	it('rejects load and run calls that overlap TinyGo startup', async () => {
		autoResolveLoad = false;
		const sandbox = new TinyGo();
		const loading = sandbox.load(runtimeAssets);

		try {
			await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
			await expect(sandbox.load('/other-assets')).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: 'TINYGO',
				phase: 'startup'
			});
			await expect(sandbox.run('package main', true)).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: 'TINYGO',
				phase: 'startup'
			});
			expect(sandbox.moduleUrl).toBe(runtimeModuleUrl);

			workerInstances[0]?.resolveLoad();
			await expect(loading).resolves.toBeUndefined();
		} finally {
			workerInstances[0]?.resolveLoad();
			await loading.catch(() => undefined);
		}
	});

	it('owns the TinyGo operation throughout compilation', async () => {
		let releaseBoot!: () => void;
		runtimeFixtureState.bootGate = new Promise<void>((resolve) => {
			releaseBoot = resolve;
		});
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		const running = sandbox.run('package main\nfunc main() {}', false);

		try {
			await vi.waitFor(() => expect(runtimeFixtureState.bootCalls).toBe(1));
			await expect(sandbox.run('package main', true)).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: 'TINYGO',
				phase: 'execute'
			});
			await expect(sandbox.load('/other-assets')).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: 'TINYGO',
				phase: 'execute'
			});
			expect(runtimeFixtureState.planCalls).toBe(0);

			releaseBoot();
			await expect(running).resolves.toBe(true);
			await expect(
				sandbox.run('package main\nfunc main() { println(1) }', true)
			).resolves.toBe(true);
		} finally {
			releaseBoot();
			await running.catch(() => undefined);
		}
	});

	it('owns the TinyGo operation until the execution worker settles', async () => {
		autoResolveRun = false;
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		const running = sandbox.run('package main\nfunc main() {}', false);

		try {
			await vi.waitFor(() =>
				expect(workerInstances[0]?.postMessage).toHaveBeenCalledWith(
					expect.objectContaining({ artifact: expect.any(Uint8Array) })
				)
			);
			await expect(sandbox.run('package main', false)).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: 'TINYGO',
				phase: 'execute'
			});
			await expect(sandbox.load(runtimeAssets)).rejects.toMatchObject({
				name: 'BusyError',
				code: 'busy',
				runtimeId: 'TINYGO',
				phase: 'execute'
			});

			workerInstances[0]?.resolveRun();
			await expect(running).resolves.toBe(true);
		} finally {
			workerInstances[0]?.resolveRun();
			await running.catch(() => undefined);
		}
	});

	it('rejects pre-aborted TinyGo operations without changing runtime state', async () => {
		const sandbox = new TinyGo();
		sandbox.write('queued\n');
		const controller = new AbortController();
		const reason = new Error('do not start TinyGo');
		controller.abort(reason);

		await expect(
			sandbox.load(runtimeAssets, '', true, [], { signal: controller.signal })
		).rejects.toBe(reason);
		await expect(
			sandbox.run('package main', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBe(reason);

		expect(workerInstances).toHaveLength(0);
		expect(runtimeFixtureState.runtimeRecords).toHaveLength(0);
		expect(sandbox.moduleUrl).toBe('');
		expect(sandbox.pendingInput).toEqual(['queued\n']);
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);
	});

	it('aborts TinyGo before its scheduled startup can mutate configuration', async () => {
		const sandbox = new TinyGo();
		const controller = new AbortController();
		const reason = new Error('cancel TinyGo immediately');
		const loading = sandbox.load(runtimeAssets, '', true, [], {
			signal: controller.signal
		});

		controller.abort(reason);

		await expect(observeSettlement(loading)).resolves.toEqual({
			status: 'rejected',
			reason
		});
		expect(workerInstances).toHaveLength(0);
		expect(runtimeFixtureState.runtimeRecords).toHaveLength(0);
		expect(sandbox.moduleUrl).toBe('');
		expect(sandbox.exit).toBe(true);
	});

	it('aborts pending TinyGo worker startup and ignores late readiness before retry', async () => {
		autoResolveLoad = false;
		const sandbox = new TinyGo();
		const controller = new AbortController();
		const reason = new Error('stop TinyGo worker startup');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const loading = sandbox.load(runtimeAssets, '', true, [], {
			signal: controller.signal
		});

		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const oldWorker = workerInstances[0];
		const staleReady = oldWorker?.onmessage;
		controller.abort(reason);

		await expect(observeSettlement(loading)).resolves.toEqual({
			status: 'rejected',
			reason
		});
		expect(oldWorker?.terminate).toHaveBeenCalledOnce();
		expect(oldWorker?.onmessage).toBeNull();
		const abortRegistration = addEventListener.mock.calls.find(([type]) => type === 'abort');
		expect(abortRegistration).toBeDefined();
		expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);

		autoResolveLoad = true;
		await expect(sandbox.load(runtimeAssets)).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
		staleReady?.({ data: { load: true } } as MessageEvent<unknown>);
		expect(sandbox.worker).toBe(workerInstances[1]);
	});

	it('isolates a late TinyGo runtime import from a replacement runtime', async () => {
		let releaseImport!: () => void;
		runtimeFixtureState.importGate = new Promise<void>((resolve) => {
			releaseImport = resolve;
		});
		const oldModuleUrl = createRuntimeModuleUrl('deferred-old-runtime');
		const newModuleUrl = createRuntimeModuleUrl('replacement-runtime');
		const sandbox = new TinyGo();
		const controller = new AbortController();
		const reason = new Error('stop TinyGo runtime import');
		const loading = sandbox.load(
			{ rootUrl: '/assets', tinygo: { moduleUrl: oldModuleUrl } },
			'',
			true,
			[],
			{ signal: controller.signal }
		);

		try {
			await vi.waitFor(() => expect(runtimeFixtureState.importCalls).toBe(1));
			controller.abort(reason);
			await expect(observeSettlement(loading)).resolves.toEqual({
				status: 'rejected',
				reason
			});

			runtimeFixtureState.importGate = Promise.resolve();
			await expect(
				sandbox.load({ rootUrl: '/assets', tinygo: { moduleUrl: newModuleUrl } })
			).resolves.toBeUndefined();
			const replacementRuntime = sandbox.runtime;
			expect(runtimeFixtureState.runtimeRecords).toHaveLength(1);

			releaseImport();
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(sandbox.runtime).toBe(replacementRuntime);
			expect(sandbox.moduleUrl).toBe(newModuleUrl);
			expect(runtimeFixtureState.runtimeRecords).toHaveLength(1);
			expect(runtimeFixtureState.runtimeRecords[0]?.disposeCalls).toBe(0);
		} finally {
			releaseImport();
			await loading.catch(() => undefined);
		}
	});

	it.each([
		{ phase: 'boot', gate: 'bootGate', counter: 'bootCalls' },
		{ phase: 'plan', gate: 'planGate', counter: 'planCalls' },
		{ phase: 'execute', gate: 'executeGate', counter: 'executeCalls' }
	] as const)(
		'aborts TinyGo $phase and isolates its late compiler result from an immediate retry',
		async ({ phase, gate, counter }) => {
			let releasePhase!: () => void;
			runtimeFixtureState[gate] = new Promise<void>((resolve) => {
				releasePhase = resolve;
			});
			const sandbox = new TinyGo();
			await sandbox.load(runtimeAssets);
			const controller = new AbortController();
			const reason = new Error(`stop TinyGo ${phase}`);
			const progressValues: number[] = [];
			const running = sandbox.run(
				'package main\nfunc main() {}',
				true,
				true,
				{ set: (value) => progressValues.push(value) },
				[],
				{ signal: controller.signal }
			);

			try {
				await vi.waitFor(() => expect(runtimeFixtureState[counter]).toBe(1));
				const oldRuntime = runtimeFixtureState.runtimeRecords[0];
				if (!oldRuntime) throw new Error('TinyGo runtime fixture was not created');
				controller.abort(reason);
				await expect(observeSettlement(running)).resolves.toEqual({
					status: 'rejected',
					reason
				});
				expect(oldRuntime.disposeCalls).toBe(1);
				expect(workerInstances[0]?.terminate).toHaveBeenCalledOnce();

				runtimeFixtureState[gate] = Promise.resolve();
				await expect(
					sandbox.run('package main\nfunc main() { println(1) }', true)
				).resolves.toBe(true);
				const retryArtifact = sandbox.compiledArtifact;
				const retryCacheKey = sandbox.compiledCacheKey;
				expect(retryArtifact).toBeInstanceOf(Uint8Array);
				expect(runtimeFixtureState.runtimeRecords).toHaveLength(2);

				const progressCount = progressValues.length;
				releasePhase();
				await new Promise((resolve) => setTimeout(resolve, 0));

				if (phase === 'boot') {
					expect(oldRuntime.planCalls).toBe(0);
					expect(oldRuntime.executeCalls).toBe(0);
				}
				if (phase === 'plan') expect(oldRuntime.executeCalls).toBe(0);
				expect(sandbox.compiledArtifact).toBe(retryArtifact);
				expect(sandbox.compiledCacheKey).toBe(retryCacheKey);
				expect(progressValues).toHaveLength(progressCount);
				expect(oldRuntime.disposeCalls).toBe(1);
			} finally {
				releasePhase();
				await running.catch(() => undefined);
			}
		}
	);

	it('aborts a pending TinyGo worker result and ignores its stale handler after retry', async () => {
		autoResolveRun = false;
		const sandbox = new TinyGo();
		const output: string[] = [];
		sandbox.output = (chunk: string) => output.push(chunk);
		await sandbox.load(runtimeAssets);
		const controller = new AbortController();
		const reason = new Error('stop TinyGo execution');
		const running = sandbox.run('package main\nfunc main() {}', false, true, undefined, [], {
			signal: controller.signal
		});

		await vi.waitFor(() =>
			expect(workerInstances[0]?.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ artifact: expect.any(Uint8Array) })
			)
		);
		const oldWorker = workerInstances[0];
		const staleResult = oldWorker?.onmessage;
		controller.abort(reason);
		await expect(observeSettlement(running)).resolves.toEqual({
			status: 'rejected',
			reason
		});
		expect(oldWorker?.terminate).toHaveBeenCalledOnce();

		autoResolveRun = true;
		await expect(sandbox.run('package main\nfunc main() {}', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
		staleResult?.({
			data: { output: 'stale TinyGo output\n', results: true }
		} as MessageEvent<unknown>);
		expect(output.join('')).not.toContain('stale TinyGo output');
		expect(sandbox.worker).toBe(workerInstances[1]);
	});

	it('kill promptly rejects a pending TinyGo compile and cleanup failures preserve abort reasons', async () => {
		let releaseBoot!: () => void;
		runtimeFixtureState.bootGate = new Promise<void>((resolve) => {
			releaseBoot = resolve;
		});
		runtimeFixtureState.disposeThrows = true;
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		const worker = workerInstances[0];
		worker?.terminate.mockImplementation(() => {
			throw new Error('TinyGo worker cleanup failed');
		});
		const running = sandbox.run('package main\nfunc main() {}', true);

		try {
			await vi.waitFor(() => expect(runtimeFixtureState.bootCalls).toBe(1));
			sandbox.kill();
			await expect(observeSettlement(running)).resolves.toEqual({
				status: 'rejected',
				reason: 'Process terminated'
			});
			expect(runtimeFixtureState.runtimeRecords[0]?.disposeCalls).toBe(1);
			expect(worker?.terminate).toHaveBeenCalledOnce();
			expect(sandbox.worker).toBeUndefined();
			expect(sandbox.exit).toBe(true);
		} finally {
			releaseBoot();
			await running.catch(() => undefined);
		}
	});

	it('removes a settled TinyGo signal listener and keeps a late abort inert', async () => {
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		const controller = new AbortController();
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');

		await expect(
			sandbox.run('package main\nfunc main() {}', true, true, undefined, [], {
				signal: controller.signal
			})
		).resolves.toBe(true);
		const abortRegistration = addEventListener.mock.calls.find(([type]) => type === 'abort');
		expect(abortRegistration).toBeDefined();
		expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);
		const settledWorker = sandbox.worker;
		const settledUid = sandbox.uid;

		controller.abort(new Error('late TinyGo abort'));

		expect(sandbox.worker).toBe(settledWorker);
		expect(sandbox.uid).toBe(settledUid);
	});

	it('clears TinyGo worker, compiler, artifact, and stdin state idempotently', async () => {
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		await sandbox.run('package main\nfunc main() {}', true);
		sandbox.write('queued\n');
		const worker = workerInstances[0];
		const runtime = runtimeFixtureState.runtimeRecords[0];

		await expect(sandbox.clear()).resolves.toBeUndefined();
		await expect(sandbox.clear()).resolves.toBeUndefined();

		expect(worker?.terminate).toHaveBeenCalledOnce();
		expect(runtime?.disposeCalls).toBe(1);
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.runtime).toBeNull();
		expect(sandbox.compiledArtifact).toBeNull();
		expect(sandbox.compiledCacheKey).toBe('');
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(sandbox.exit).toBe(true);
	});
});
