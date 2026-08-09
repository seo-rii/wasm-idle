import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
	planDiagnostics: Array<{
		message: string;
		severity: 'error' | 'warning' | 'other';
		fileName?: string | null;
		lineNumber?: number;
		columnNumber?: number;
	}>;
	planGate: Promise<void>;
	runtimeRecords: Array<{
		appendLog: (line: string) => void;
		artifact: { path: string; bytes: Uint8Array; runnable: boolean } | null;
		bootCalls: number;
		buildRequestOverrides: { target?: string } | null;
		disposeCalls: number;
		emitDiagnostic: (diagnostic: RuntimeFixtureState['planDiagnostics'][number]) => void;
		executeCalls: number;
		initialMaxAssetBytes: number | null;
		maxAssetByteLimits: number[];
		planCalls: number;
		workspaceFiles: Record<string, string> | null;
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
	planDiagnostics: [],
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
  appendLog(line) {
    record.activityLog += line;
    options.onLogAppended?.({ line, message: line.trim(), tone: 'idle' });
  },
  artifact: null,
  bootCalls: 0,
  buildRequestOverrides: null,
  disposeCalls: 0,
  emitDiagnostic(diagnostic) {
    options.onCompilerDiagnostic?.(diagnostic);
  },
  executeCalls: 0,
  initialMaxAssetBytes: options.maxAssetBytes ?? null,
  maxAssetByteLimits: [],
  planCalls: 0,
  workspaceFiles: null
};
state.runtimeRecords.push(record);
return ({
  async boot() {
    state.bootCalls += 1;
    record.bootCalls += 1;
    await gates.boot;
    options.onProgress?.({ assetPath: 'boot.wasm', assetUrl: 'boot.wasm', label: 'boot', loaded: 1, total: 1 });
    record.appendLog('boot complete\\n');
  },
  async plan() {
    state.planCalls += 1;
    record.planCalls += 1;
    await gates.plan;
    for (const diagnostic of state.planDiagnostics) record.emitDiagnostic(diagnostic);
    record.appendLog('plan complete\\n');
    return { ok: true };
  },
  async execute() {
    state.executeCalls += 1;
    record.executeCalls += 1;
    await gates.execute;
    record.appendLog('execute complete\\n');
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
  setBuildRequestOverrides(overrides) {
    record.buildRequestOverrides = overrides ? { ...overrides } : null;
  },
  setMaxAssetBytes(maxAssetBytes) {
    record.maxAssetByteLimits.push(maxAssetBytes);
  },
  setWorkspaceFiles(files) {
    record.workspaceFiles = files ? Object.fromEntries(Object.entries(files)) : null;
  },
  dispose() {
    state.disposeCalls += 1;
    record.disposeCalls += 1;
    if (gates.disposeThrows) throw new Error('TinyGo runtime cleanup failed');
  }
});
}
`;

const createRuntimeModuleUrl = (marker = 'default', source = runtimeModuleSource) =>
	`data:text/javascript;base64,${Buffer.from(`${source}\n// ${marker}`, 'utf8').toString('base64')}`;

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
import type { SandboxExecutionOptions } from './options';
import { bufferedSequence } from './stdinBuffer';

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

	afterEach(() => {
		vi.useRealTimers();
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

	it('treats false TinyGo results and empty errors as terminal payloads', async () => {
		autoResolveRun = false;
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		const worker = workerInstances[0];
		const falseResult = sandbox.run('package main\nfunc main() {}', false);

		await vi.waitFor(() =>
			expect(worker?.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ artifact: expect.any(Uint8Array) })
			)
		);
		worker?.onmessage?.({
			data: { results: false, error: 'ignored after result' }
		} as MessageEvent<unknown>);

		await expect(falseResult).resolves.toBe(false);
		expect(worker?.onmessage).toBeNull();

		const emptyError = sandbox.run('package main\nfunc main() {}', false);
		await vi.waitFor(() => expect(worker?.onmessage).not.toBeNull());
		worker?.onmessage?.({ data: { error: '' } } as MessageEvent<unknown>);

		await expect(emptyError).rejects.toBe('');
		expect(worker?.onmessage).toBeNull();

		autoResolveRun = true;
		await expect(sandbox.run('package main\nfunc main() {}', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(1);
		expect(worker?.terminate).not.toHaveBeenCalled();
	});

	it('settles an empty TinyGo startup error and permits a clean retry', async () => {
		autoResolveLoad = false;
		const sandbox = new TinyGo();
		const loading = sandbox.load(runtimeAssets);

		await vi.waitFor(() => expect(workerInstances).toHaveLength(1));
		const retiredWorker = workerInstances[0];
		retiredWorker?.onmessage?.({ data: { error: '' } } as MessageEvent<unknown>);

		await expect(loading).rejects.toMatchObject({ name: 'Error', message: '' });
		expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		autoResolveLoad = true;
		await expect(sandbox.load(runtimeAssets)).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('enforces the TinyGo output budget while a compiler phase is still pending', async () => {
		let releaseBoot!: () => void;
		runtimeFixtureState.bootGate = new Promise<void>((resolve) => {
			releaseBoot = resolve;
		});
		const sandbox = new TinyGo();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load(runtimeAssets);
		const retiredWorker = workerInstances[0];
		const retiredRuntime = runtimeFixtureState.runtimeRecords[0];
		const running = sandbox.run('package main\nfunc main() {}', true, false, undefined, [], {
			limits: { maxOutputBytes: 5 }
		});
		void running.catch(() => undefined);

		try {
			await vi.waitFor(() => expect(runtimeFixtureState.bootCalls).toBe(1));
			expect(runtimeFixtureState.planCalls).toBe(0);
			expect(runtimeFixtureState.executeCalls).toBe(0);
			let hookError: unknown;
			try {
				retiredRuntime?.appendLog('overflow\n');
			} catch (error) {
				hookError = error;
			}
			expect(hookError).toMatchObject({
				name: 'OutputLimitError',
				code: 'output-limit',
				phase: 'execute',
				runtimeId: 'TINYGO',
				limit: 5,
				actual: 9
			});
			await expect(running).rejects.toBe(hookError);
			expect(output).not.toHaveBeenCalled();
			expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
			expect(retiredRuntime?.disposeCalls).toBe(1);
			expect(sandbox.worker).toBeUndefined();
		} finally {
			releaseBoot();
		}

		runtimeFixtureState.bootGate = Promise.resolve();
		sandbox.output = vi.fn();
		await expect(sandbox.load(runtimeAssets)).resolves.toBeUndefined();
		await expect(sandbox.run('package main\nfunc main() {}', true, false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('enforces the TinyGo output budget during compiler activity', async () => {
		const sandbox = new TinyGo();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load(runtimeAssets);
		const retiredWorker = workerInstances[0];
		const retiredRuntime = runtimeFixtureState.runtimeRecords[0];

		await expect(
			sandbox.run('package main\nfunc main() {}', true, false, undefined, [], {
				limits: { maxOutputBytes: 1 }
			})
		).rejects.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			runtimeId: 'TINYGO',
			limit: 1,
			actual: 14
		});

		expect(output).not.toHaveBeenCalled();
		expect(runtimeFixtureState.bootCalls).toBe(1);
		expect(runtimeFixtureState.planCalls).toBe(0);
		expect(runtimeFixtureState.executeCalls).toBe(0);
		expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
		expect(retiredRuntime?.disposeCalls).toBe(1);

		await expect(sandbox.load(runtimeAssets)).resolves.toBeUndefined();
		await expect(sandbox.run('package main\nfunc main() {}', true)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('forwards structured compiler diagnostics without counting activity logs', async () => {
		runtimeFixtureState.planDiagnostics = [
			{
				message: 'unused value',
				severity: 'warning',
				fileName: 'main.go',
				lineNumber: 3,
				columnNumber: 7
			}
		];
		const sandbox = new TinyGo();
		const diagnostic = vi.fn();
		sandbox.oncompilerdiagnostic = diagnostic;
		await sandbox.load(runtimeAssets);

		await expect(
			sandbox.run('package main\nfunc main() {}', true, false, undefined, [], {
				limits: { maxDiagnostics: 1 }
			})
		).resolves.toBe(true);

		expect(diagnostic).toHaveBeenCalledOnce();
		expect(diagnostic).toHaveBeenCalledWith({
			message: 'unused value',
			severity: 'warning',
			fileName: 'main.go',
			lineNumber: 3,
			columnNumber: 7
		});
		expect(runtimeFixtureState.bootCalls).toBe(1);
		expect(runtimeFixtureState.planCalls).toBe(1);
		expect(runtimeFixtureState.executeCalls).toBe(1);
	});

	it('counts compiler diagnostics without a callback and suppresses the first overflow', async () => {
		runtimeFixtureState.planDiagnostics = [
			{ message: 'first error', severity: 'error', lineNumber: 1 },
			{ message: 'second error', severity: 'error', lineNumber: 2 }
		];
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		const retiredWorker = workerInstances[0];
		const retiredRuntime = runtimeFixtureState.runtimeRecords[0];

		await expect(
			sandbox.run('package main\nfunc main() {}', true, false, undefined, [], {
				limits: { maxDiagnostics: 1 }
			})
		).rejects.toMatchObject({
			name: 'DiagnosticLimitError',
			code: 'diagnostic-limit',
			phase: 'execute',
			runtimeId: 'TINYGO',
			limit: 1,
			actual: 2
		});
		expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
		expect(retiredRuntime?.disposeCalls).toBe(1);
		expect(() =>
			retiredRuntime?.emitDiagnostic({
				message: 'stale error',
				severity: 'error',
				lineNumber: 3
			})
		).not.toThrow();

		runtimeFixtureState.planDiagnostics = [];
		await expect(sandbox.load(runtimeAssets)).resolves.toBeUndefined();
		await expect(sandbox.run('package main\nfunc main() {}', true, false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('retires the exact TinyGo runtime when a diagnostic callback throws', async () => {
		runtimeFixtureState.planDiagnostics = [
			{ message: 'callback error', severity: 'error', lineNumber: 1 }
		];
		const sandbox = new TinyGo();
		const callbackError = new Error('TinyGo diagnostic callback failed');
		sandbox.oncompilerdiagnostic = () => {
			throw callbackError;
		};
		await sandbox.load(runtimeAssets);
		const retiredWorker = workerInstances[0];
		const retiredRuntime = runtimeFixtureState.runtimeRecords[0];

		await expect(sandbox.run('package main\nfunc main() {}', true, false)).rejects.toBe(
			callbackError
		);
		expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
		expect(retiredRuntime?.disposeCalls).toBe(1);

		runtimeFixtureState.planDiagnostics = [];
		sandbox.oncompilerdiagnostic = undefined;
		await expect(sandbox.load(runtimeAssets)).resolves.toBeUndefined();
		await expect(sandbox.run('package main\nfunc main() {}', true, false)).resolves.toBe(true);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('enforces one UTF-8 TinyGo output budget across compilation and execution', async () => {
		autoResolveRun = false;
		const sandbox = new TinyGo();
		const output: string[] = [];
		sandbox.output = (chunk: string) => output.push(chunk);
		await sandbox.load(runtimeAssets);
		const retiredWorker = workerInstances[0];
		const retiredRuntime = runtimeFixtureState.runtimeRecords[0];
		const running = sandbox.run('package main\nfunc main() {}', false, false, undefined, [], {
			limits: { maxOutputBytes: 64 }
		});

		await vi.waitFor(() =>
			expect(retiredWorker?.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ artifact: expect.any(Uint8Array) })
			)
		);
		const compilerBytes = new TextEncoder().encode(output.join('')).byteLength;
		expect(compilerBytes).toBeLessThan(64);
		retiredWorker?.onmessage?.({
			data: { output: 'x'.repeat(64 - compilerBytes) }
		} as MessageEvent<unknown>);
		const staleResult = retiredWorker?.onmessage;
		staleResult?.({ data: { output: 'é' } } as MessageEvent<unknown>);

		await expect(running).rejects.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			runtimeId: 'TINYGO',
			limit: 64,
			actual: 66
		});
		expect(new TextEncoder().encode(output.join('')).byteLength).toBe(64);
		expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
		expect(retiredRuntime?.disposeCalls).toBe(1);
		expect(sandbox.worker).toBeUndefined();

		await expect(sandbox.load(runtimeAssets)).resolves.toBeUndefined();
		const replacementWorker = workerInstances[1];
		const retry = sandbox.run('package main\nfunc main() {}', false);
		await vi.waitFor(() =>
			expect(replacementWorker?.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ artifact: expect.any(Uint8Array) })
			)
		);
		const replacementHandler = replacementWorker?.onmessage;
		staleResult?.({
			data: { output: 'stale overflow output', results: true }
		} as MessageEvent<unknown>);
		expect(output.join('')).not.toContain('stale overflow output');
		expect(replacementWorker?.onmessage).toBe(replacementHandler);
		replacementWorker?.resolveRun();
		await expect(retry).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
		expect(replacementWorker?.terminate).not.toHaveBeenCalled();
	});

	it('retires TinyGo compiler ownership when its output callback throws', async () => {
		const sandbox = new TinyGo();
		const callbackError = new Error('TinyGo compiler output failed');
		sandbox.output = vi.fn(() => {
			throw callbackError;
		});
		await sandbox.load(runtimeAssets);
		const retiredWorker = workerInstances[0];
		const retiredRuntime = runtimeFixtureState.runtimeRecords[0];

		await expect(sandbox.run('package main\nfunc main() {}', true, false)).rejects.toBe(
			callbackError
		);
		expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
		expect(retiredRuntime?.disposeCalls).toBe(1);
		expect(sandbox.worker).toBeUndefined();

		sandbox.output = vi.fn();
		await expect(sandbox.load(runtimeAssets)).resolves.toBeUndefined();
		await expect(sandbox.run('package main\nfunc main() {}', true, false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('rejects a TinyGo worker output callback failure before a same-message result', async () => {
		autoResolveRun = false;
		const sandbox = new TinyGo();
		const callbackError = new Error('TinyGo worker output failed');
		sandbox.output = vi.fn((output: string) => {
			if (output === 'callback failure') throw callbackError;
		});
		await sandbox.load(runtimeAssets);
		const retiredWorker = workerInstances[0];
		const retiredRuntime = runtimeFixtureState.runtimeRecords[0];
		const running = sandbox.run('package main\nfunc main() {}', false, false);
		const rejected = expect(running).rejects.toBe(callbackError);
		await vi.waitFor(() =>
			expect(retiredWorker?.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ artifact: expect.any(Uint8Array) })
			)
		);

		retiredWorker?.onmessage?.({
			data: { output: 'callback failure', results: true }
		} as MessageEvent<unknown>);

		await rejected;
		expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
		expect(retiredRuntime?.disposeCalls).toBe(1);
		expect(sandbox.worker).toBeUndefined();

		autoResolveRun = true;
		sandbox.output = vi.fn();
		await expect(sandbox.load(runtimeAssets)).resolves.toBeUndefined();
		await expect(sandbox.run('package main\nfunc main() {}', false, false)).resolves.toBe(true);
	});

	it('preserves a replacement after TinyGo output terminates and then throws', async () => {
		autoResolveRun = false;
		const sandbox = new TinyGo();
		const terminationReason = new Error('replace TinyGo from output');
		const laterError = new Error('TinyGo output threw after replacement');
		let replacement: Promise<void> | undefined;
		let callbackCalls = 0;
		await sandbox.load(runtimeAssets);
		const retiredWorker = workerInstances[0];
		const running = sandbox.run('package main\nfunc main() {}', false, false);
		const rejected = expect(running).rejects.toBe(terminationReason);
		await vi.waitFor(() =>
			expect(retiredWorker?.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ artifact: expect.any(Uint8Array) })
			)
		);
		const staleHandler = retiredWorker?.onmessage;
		sandbox.output = () => {
			callbackCalls += 1;
			sandbox.terminate(terminationReason);
			replacement = sandbox.load(runtimeAssets);
			void replacement.catch(() => undefined);
			throw laterError;
		};

		staleHandler?.({
			data: { output: 'replace runtime', results: true }
		} as MessageEvent<unknown>);

		await rejected;
		expect(replacement).toBeDefined();
		await expect(replacement).resolves.toBeUndefined();
		expect(callbackCalls).toBe(1);
		expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();

		staleHandler?.({
			data: { output: 'stale output', results: true }
		} as MessageEvent<unknown>);
		expect(callbackCalls).toBe(1);

		autoResolveRun = true;
		sandbox.output = vi.fn();
		await expect(sandbox.run('package main\nfunc main() {}', false, false)).resolves.toBe(true);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('snapshots TinyGo workspace, target, and program arguments before compilation', async () => {
		let releaseBoot!: () => void;
		runtimeFixtureState.bootGate = new Promise<void>((resolve) => {
			releaseBoot = resolve;
		});
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		const workspaceFiles = [
			{
				path: 'message.go',
				content: 'package main\nconst message = "original"'
			}
		];
		const programArgs = ['original-argument'];
		const options: SandboxExecutionOptions = {
			activePath: 'main.go',
			programArgs,
			tinygoTarget: 'wasip2',
			workspaceFiles
		};
		const running = sandbox.run(
			'package main\nfunc main() { println(message) }',
			false,
			false,
			undefined,
			[],
			options
		);

		options.activePath = 'changed/main.go';
		options.tinygoTarget = 'wasip3';
		programArgs[0] = 'changed-argument';
		workspaceFiles[0]!.path = 'changed/message.go';
		workspaceFiles[0]!.content = 'package main\nconst message = "changed"';
		workspaceFiles.push({ path: 'late.go', content: 'package main' });

		try {
			await vi.waitFor(() => expect(runtimeFixtureState.bootCalls).toBe(1));
			releaseBoot();
			await expect(running).resolves.toBe(true);
		} finally {
			releaseBoot();
			await running.catch(() => undefined);
		}

		const runtime = runtimeFixtureState.runtimeRecords[0];
		expect(runtime?.buildRequestOverrides).toEqual({ target: 'wasip2' });
		expect(runtime?.workspaceFiles).toEqual({
			'main.go': 'package main\nfunc main() { println(message) }',
			'message.go': 'package main\nconst message = "original"'
		});
		expect(workerInstances[0]?.postMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({ args: ['original-argument'] })
		);

		await expect(
			sandbox.run(
				'package main\nfunc main() { println(message) }',
				true,
				false,
				undefined,
				[],
				{
					tinygoTarget: 'wasip2',
					workspaceFiles: [
						{ path: 'message.go', content: 'package main\nconst message = "updated"' }
					]
				}
			)
		).resolves.toBe(true);
		expect(runtime?.bootCalls).toBe(2);
		expect(runtime?.workspaceFiles?.['message.go']).toContain('"updated"');
	});

	it('updates the cached TinyGo compiler asset quota for every execution', async () => {
		const sandbox = new TinyGo();
		const source = 'package main\nfunc main() {}';
		await sandbox.load(runtimeAssets, '', true, [], {
			limits: { maxAssetBytes: 64 }
		});

		await expect(
			sandbox.run(source, false, true, undefined, [], {
				limits: { maxAssetBytes: 64 }
			})
		).resolves.toBe(true);
		await expect(
			sandbox.run(source, false, true, undefined, [], {
				limits: { maxAssetBytes: 32 }
			})
		).resolves.toBe(true);

		expect(runtimeFixtureState.runtimeRecords).toHaveLength(1);
		expect(runtimeFixtureState.runtimeRecords[0]).toMatchObject({
			bootCalls: 2,
			initialMaxAssetBytes: 64,
			maxAssetByteLimits: [64, 32]
		});
	});

	it('rejects a TinyGo runtime that cannot enforce per-operation asset quotas', async () => {
		const legacyRuntimeSource = runtimeModuleSource.replace(
			`  setMaxAssetBytes(maxAssetBytes) {
    record.maxAssetByteLimits.push(maxAssetBytes);
  },
`,
			''
		);
		const sandbox = new TinyGo();

		await expect(
			sandbox.load({
				rootUrl: '/assets',
				tinygo: {
					moduleUrl: createRuntimeModuleUrl('missing-asset-limit', legacyRuntimeSource)
				}
			})
		).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			runtimeId: 'TINYGO'
		});
	});

	it('snapshots explicit TinyGo stdin and replaces previously queued input with EOF', async () => {
		autoResolveRun = false;
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		sandbox.write('stale queued input\n');
		sandbox.eof();
		const options: SandboxExecutionOptions = { stdin: '' };
		const running = sandbox.run(
			'package main\nfunc main() {}',
			false,
			true,
			undefined,
			[],
			options
		);
		options.stdin = 'late mutation\n';

		const worker = workerInstances[0];
		await vi.waitFor(() =>
			expect(worker?.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ artifact: expect.any(Uint8Array) })
			)
		);
		const runMessage = worker?.postMessage.mock.calls.find(
			([message]) => 'artifact' in message
		)?.[0] as unknown as { buffer: ArrayBufferLike; stdin?: string };
		const initialSequence = bufferedSequence(runMessage.buffer);
		worker?.onmessage?.({ data: { buffer: true } } as MessageEvent<unknown>);

		expect(runMessage.stdin).toBe('');
		expect(bufferedSequence(runMessage.buffer)).toBe(initialSequence);
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		worker?.resolveRun();
		await expect(running).resolves.toBe(true);
	});

	it('isolates explicit TinyGo stdin from terminal writes and the next execution', async () => {
		autoResolveRun = false;
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		const worker = workerInstances[0];
		const running = sandbox.run('package main\nfunc main() {}', false, true, undefined, [], {
			stdin: 'x'.repeat(3_000)
		});

		await vi.waitFor(() =>
			expect(worker?.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ artifact: expect.any(Uint8Array) })
			)
		);
		const firstRunMessage = worker?.postMessage.mock.calls.find(
			([message]) => 'artifact' in message
		)?.[0] as unknown as { buffer: ArrayBufferLike; stdin?: string };
		const explicitSequence = bufferedSequence(firstRunMessage.buffer);
		expect(firstRunMessage.stdin).toBe('x'.repeat(3_000));
		sandbox.write('interactive input must be isolated\n');
		sandbox.eof();
		worker?.onmessage?.({ data: { buffer: true } } as MessageEvent<unknown>);
		expect(bufferedSequence(firstRunMessage.buffer)).toBe(explicitSequence);

		worker?.resolveRun();
		await expect(running).resolves.toBe(true);
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);

		worker?.postMessage.mockClear();
		const nextRun = sandbox.run('package main\nfunc main() {}', false);
		await vi.waitFor(() =>
			expect(worker?.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ artifact: expect.any(Uint8Array) })
			)
		);
		const nextRunMessage = worker?.postMessage.mock.calls.find(
			([message]) => 'artifact' in message
		)?.[0] as unknown as { stdin?: string };
		expect(nextRunMessage.stdin).toBeUndefined();
		worker?.onmessage?.({ data: { buffer: true } } as MessageEvent<unknown>);
		expect(bufferedSequence(firstRunMessage.buffer)).toBe(explicitSequence);
		worker?.resolveRun();
		await expect(nextRun).resolves.toBe(true);
	});

	it('clears terminal writes after an explicit TinyGo stdin execution fails', async () => {
		autoResolveRun = false;
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		const worker = workerInstances[0];
		const running = sandbox.run('package main\nfunc main() {}', false, true, undefined, [], {
			stdin: 'fixed input\n'
		});

		await vi.waitFor(() =>
			expect(worker?.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					artifact: expect.any(Uint8Array),
					stdin: 'fixed input\n'
				})
			)
		);
		sandbox.write('discard after failure\n');
		sandbox.eof();
		worker?.onmessage?.({
			data: { error: 'TinyGo execution failed' }
		} as MessageEvent<unknown>);

		await expect(running).rejects.toBe('TinyGo execution failed');
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
	});

	it('rejects invalid explicit TinyGo stdin before changing compiler or queued input state', async () => {
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		sandbox.write('queued\n');

		await expect(
			sandbox.run('package main\nfunc main() {}', false, true, undefined, [], {
				stdin: 42
			} as unknown as SandboxExecutionOptions)
		).rejects.toThrow('TinyGo stdin must be a string');

		expect(runtimeFixtureState.bootCalls).toBe(0);
		expect(runtimeFixtureState.planCalls).toBe(0);
		expect(runtimeFixtureState.executeCalls).toBe(0);
		expect(sandbox.pendingInput).toEqual(['queued\n']);
		expect(workerInstances[0]?.terminate).not.toHaveBeenCalled();
	});

	it('rejects invalid TinyGo workspaces before changing compiler state', async () => {
		const sandbox = new TinyGo();
		const code = 'package main\nfunc main() {}';
		await sandbox.load(runtimeAssets);
		await sandbox.run(code, true);
		const runtime = runtimeFixtureState.runtimeRecords[0];
		const compiledCacheKey = sandbox.compiledCacheKey;

		await expect(
			sandbox.run(code, true, true, undefined, [], {
				activePath: 'cmd/demo/main.go'
			})
		).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration',
			phase: 'execute',
			runtimeId: 'TINYGO'
		});
		await expect(
			sandbox.run(code, true, true, undefined, [], {
				workspaceFiles: [{ path: '../escape.go', content: 'package main' }]
			})
		).rejects.toMatchObject({
			name: 'WorkspaceValidationError',
			code: 'invalid-path',
			path: '../escape.go'
		});
		await expect(
			sandbox.run(code, true, true, undefined, [], {
				workspaceFiles: [
					{ path: 'cache', content: 'file' },
					{ path: 'cache/data.go', content: 'package cache' }
				]
			})
		).rejects.toMatchObject({
			name: 'WorkspaceValidationError',
			code: 'path-prefix-collision'
		});
		await expect(
			sandbox.run(code, true, true, undefined, [], {
				limits: { maxWorkspaceBytes: 4 }
			})
		).rejects.toMatchObject({
			name: 'WorkspaceValidationError',
			code: 'file-size-limit',
			limit: 4
		});

		expect(runtime?.bootCalls).toBe(1);
		expect(runtime?.planCalls).toBe(1);
		expect(runtime?.executeCalls).toBe(1);
		expect(sandbox.compiledCacheKey).toBe(compiledCacheKey);
		expect(sandbox.runtime).not.toBeNull();
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0]?.terminate).not.toHaveBeenCalled();
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		expect(runtime?.bootCalls).toBe(1);
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

	it('preserves an exact null pre-abort reason without changing idle TinyGo state', async () => {
		const sandbox = new TinyGo();
		sandbox.write('queued\n');
		const controller = new AbortController();
		controller.abort(null);

		await expect(
			sandbox.load(runtimeAssets, '', true, [], { signal: controller.signal })
		).rejects.toBeNull();
		await expect(
			sandbox.run('package main', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBeNull();

		expect(workerInstances).toHaveLength(0);
		expect(runtimeFixtureState.runtimeRecords).toHaveLength(0);
		expect(sandbox.moduleUrl).toBe('');
		expect(sandbox.pendingInput).toEqual(['queued\n']);
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);
	});

	it('preserves replacement startup when the outer signal getter terminates TinyGo', async () => {
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		const retiredWorker = workerInstances[0];
		const retiredRuntime = runtimeFixtureState.runtimeRecords[0];
		const reason = new Error('replace TinyGo during startup option snapshot');
		let replacement: Promise<void> | undefined;
		const options = {
			get signal() {
				sandbox.terminate(reason);
				replacement = sandbox.load(runtimeAssets);
				void replacement.catch(() => undefined);
				return undefined;
			}
		};

		const superseded = sandbox.load(runtimeAssets, '', true, [], options);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
		expect(retiredRuntime?.disposeCalls).toBe(1);
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('preserves the first cancellation across a later TinyGo signal getter failure', async () => {
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace TinyGo during execution option snapshot');
		const laterError = new Error('TinyGo signal getter failed after replacement');
		let replacement: Promise<void> | undefined;
		const options = {
			get signal(): never {
				sandbox.terminate(reason);
				replacement = sandbox.load(runtimeAssets);
				void replacement.catch(() => undefined);
				throw laterError;
			}
		};

		const superseded = sandbox.run(
			'package main\nfunc main() {}',
			false,
			true,
			undefined,
			[],
			options
		);

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
		expect(runtimeFixtureState.bootCalls).toBe(0);
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('snapshots a reentrant TinyGo abort reason exactly once', async () => {
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace TinyGo while reading the abort reason');
		const staleReason = new Error('stale reason returned after replacement');
		let reasonReads = 0;
		let replacement: Promise<void> | undefined;
		const signal = {
			aborted: true,
			get reason() {
				reasonReads += 1;
				sandbox.terminate(reason);
				replacement = sandbox.load(runtimeAssets);
				void replacement.catch(() => undefined);
				return staleReason;
			}
		} as AbortSignal;

		const superseded = sandbox.run('package main\nfunc main() {}', false, true, undefined, [], {
			signal
		});

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(reasonReads).toBe(1);
		expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('preserves cancellation and cleanup when the TinyGo stdin buffer is invalid', async () => {
		autoResolveRun = false;
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		const controller = new AbortController();
		const reason = new Error('stop TinyGo with an invalid stdin buffer');
		const running = sandbox.run('package main\nfunc main() {}', false, true, undefined, [], {
			signal: controller.signal
		});

		await vi.waitFor(() =>
			expect(workerInstances[0]?.postMessage).toHaveBeenCalledWith(
				expect.objectContaining({ artifact: expect.any(Uint8Array) })
			)
		);
		const retiredWorker = workerInstances[0];
		const retiredRuntime = runtimeFixtureState.runtimeRecords[0];
		const originalBuffer = sandbox.buffer;
		sandbox.buffer = new ArrayBuffer(0);

		expect(() => controller.abort(reason)).not.toThrow();
		sandbox.buffer = originalBuffer;

		await expect(running).rejects.toBe(reason);
		expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
		expect(retiredRuntime?.disposeCalls).toBe(1);
		await expect(sandbox.load(runtimeAssets)).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);

		sandbox.buffer = new ArrayBuffer(0);
		await expect(sandbox.clear()).resolves.toBeUndefined();
		expect(workerInstances[1]?.terminate).toHaveBeenCalledOnce();
		expect(runtimeFixtureState.runtimeRecords[1]?.disposeCalls).toBe(1);
		sandbox.buffer = originalBuffer;
	});

	it('stops TinyGo limit snapshots after cancellation and preserves the replacement', async () => {
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		const retiredWorker = workerInstances[0];
		const reason = new Error('replace TinyGo during execution limit snapshot');
		const laterError = new Error('later TinyGo limit getter failed');
		let laterReads = 0;
		let replacement: Promise<void> | undefined;
		const limits = {
			get assetTimeoutMs() {
				sandbox.terminate(reason);
				replacement = sandbox.load(runtimeAssets);
				void replacement.catch(() => undefined);
				return 1;
			},
			get startupTimeoutMs(): never {
				laterReads += 1;
				throw laterError;
			}
		};

		const superseded = sandbox.run('package main\nfunc main() {}', false, true, undefined, [], {
			limits
		});

		await expect(superseded).rejects.toBe(reason);
		await expect(replacement).resolves.toBeUndefined();
		expect(laterReads).toBe(0);
		expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('rejects invalid TinyGo deadlines without changing a loaded runtime', async () => {
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		const worker = workerInstances[0];
		const runtime = sandbox.runtime;
		const moduleUrl = sandbox.moduleUrl;
		sandbox.write('queued\n');

		await expect(
			sandbox.load(runtimeAssets, '', true, [], {
				limits: { assetTimeoutMs: 0 }
			})
		).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration'
		});
		await expect(
			sandbox.run('package main\nfunc main() {}', false, true, undefined, [], {
				limits: { compileTimeoutMs: Number.POSITIVE_INFINITY }
			})
		).rejects.toMatchObject({
			name: 'RuntimeConfigurationError',
			code: 'runtime-configuration'
		});

		expect(sandbox.worker).toBe(worker);
		expect(worker?.terminate).not.toHaveBeenCalled();
		expect(sandbox.runtime).toBe(runtime);
		expect(sandbox.moduleUrl).toBe(moduleUrl);
		expect(sandbox.pendingInput).toEqual(['queued\n']);
		expect(runtimeFixtureState.bootCalls).toBe(0);
	});

	it('enforces the aggregate TinyGo startup deadline and ignores stale readiness', async () => {
		vi.useFakeTimers();
		autoResolveLoad = false;
		const sandbox = new TinyGo();
		const loading = sandbox.load(runtimeAssets, '', true, [], {
			limits: { assetTimeoutMs: 5, startupTimeoutMs: 7 }
		});
		const rejected = expect(loading).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'startup',
			runtimeId: 'TINYGO',
			timeoutMs: 12
		});
		await vi.dynamicImportSettled();
		await vi.advanceTimersByTimeAsync(0);
		const retiredWorker = workerInstances[0];
		const staleReady = retiredWorker?.onmessage;

		await vi.advanceTimersByTimeAsync(12);
		await rejected;
		expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleReady?.({ data: { load: true } } as MessageEvent<unknown>);
		autoResolveLoad = true;
		vi.useRealTimers();
		await expect(sandbox.load(runtimeAssets)).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('enforces the aggregate TinyGo compiler deadline and remains reusable', async () => {
		let releaseBoot!: () => void;
		runtimeFixtureState.bootGate = new Promise<void>((resolve) => {
			releaseBoot = resolve;
		});
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		const retiredWorker = workerInstances[0];
		const retiredRuntime = runtimeFixtureState.runtimeRecords[0];
		vi.useFakeTimers();
		const running = sandbox.run('package main\nfunc main() {}', true, true, undefined, [], {
			limits: { compileTimeoutMs: 4, runTimeoutMs: 6 }
		});
		const rejected = expect(running).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'execute',
			runtimeId: 'TINYGO',
			timeoutMs: 10
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(runtimeFixtureState.bootCalls).toBe(1);

		await vi.advanceTimersByTimeAsync(10);
		await rejected;
		expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
		expect(retiredRuntime?.disposeCalls).toBe(1);

		runtimeFixtureState.bootGate = Promise.resolve();
		releaseBoot();
		await vi.advanceTimersByTimeAsync(0);
		vi.useRealTimers();
		await expect(sandbox.load(runtimeAssets)).resolves.toBeUndefined();
		await expect(sandbox.run('package main\nfunc main() {}', true)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('enforces the aggregate TinyGo execution-worker deadline and remains reusable', async () => {
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets);
		const retiredWorker = workerInstances[0];
		autoResolveRun = false;
		vi.useFakeTimers();
		const running = sandbox.run('package main\nfunc main() {}', false, true, undefined, [], {
			limits: { compileTimeoutMs: 4, runTimeoutMs: 6 }
		});
		const rejected = expect(running).rejects.toMatchObject({
			name: 'TimeoutError',
			code: 'timeout',
			phase: 'execute',
			runtimeId: 'TINYGO',
			timeoutMs: 10
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(retiredWorker?.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ artifact: expect.any(Uint8Array) })
		);
		const staleResult = retiredWorker?.onmessage;

		await vi.advanceTimersByTimeAsync(10);
		await rejected;
		expect(retiredWorker?.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();

		staleResult?.({ data: { output: 'stale output', results: true } } as MessageEvent<unknown>);
		autoResolveRun = true;
		vi.useRealTimers();
		await expect(sandbox.load(runtimeAssets)).resolves.toBeUndefined();
		await expect(sandbox.run('package main\nfunc main() {}', false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1]?.terminate).not.toHaveBeenCalled();
	});

	it('clears settled TinyGo deadlines before they can retire an idle runtime', async () => {
		vi.useFakeTimers();
		const sandbox = new TinyGo();
		await sandbox.load(runtimeAssets, '', true, [], {
			limits: { assetTimeoutMs: 2, startupTimeoutMs: 3 }
		});
		const worker = workerInstances[0];
		const runtime = runtimeFixtureState.runtimeRecords[0];
		await expect(
			sandbox.run('package main\nfunc main() {}', false, true, undefined, [], {
				limits: { compileTimeoutMs: 2, runTimeoutMs: 3 }
			})
		).resolves.toBe(true);

		await vi.advanceTimersByTimeAsync(5_000);

		expect(sandbox.worker).toBe(worker);
		expect(worker?.terminate).not.toHaveBeenCalled();
		expect(runtime?.disposeCalls).toBe(0);
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
