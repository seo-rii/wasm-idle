import { beforeEach, describe, expect, it, vi } from 'vitest';

type RuntimeFixtureState = {
	activityLog: string;
	artifact: { path: string; bytes: Uint8Array; runnable: boolean } | null;
	bootCalls: number;
	bootGate: Promise<void>;
	disposeCalls: number;
	executeCalls: number;
	planCalls: number;
};

const createRuntimeFixtureState = (): RuntimeFixtureState => ({
	activityLog: '',
	artifact: null,
	bootCalls: 0,
	bootGate: Promise.resolve(),
	disposeCalls: 0,
	executeCalls: 0,
	planCalls: 0
});

const runtimeFixtureState = createRuntimeFixtureState();

Object.assign(globalThis, {
	__wasmIdleTinyGoLifecycleFixture: runtimeFixtureState
});

const runtimeModuleSource = `
const state = globalThis.__wasmIdleTinyGoLifecycleFixture;
export const createBundledTinyGoRuntime = () => ({
  async boot() {
    state.bootCalls += 1;
    await state.bootGate;
    state.activityLog += 'boot complete\\n';
  },
  async plan() {
    state.planCalls += 1;
    return { ok: true };
  },
  async execute() {
    state.executeCalls += 1;
    state.artifact = {
      path: '/working/out.wasm',
      bytes: new Uint8Array([0, 97, 115, 109]),
      runnable: true
    };
  },
  reset() {
    state.activityLog = '';
    state.artifact = null;
  },
  readActivityLog() {
    return state.activityLog;
  },
  readBuildArtifact() {
    return state.artifact;
  },
  setBuildRequestOverrides() {},
  setWorkspaceFiles() {},
  dispose() {
    state.disposeCalls += 1;
  }
});
`;

const runtimeModuleUrl = `data:text/javascript;base64,${Buffer.from(runtimeModuleSource, 'utf8').toString('base64')}`;

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

	resolveRun() {
		this.onmessage?.({ data: { results: true } } as MessageEvent<unknown>);
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
});
