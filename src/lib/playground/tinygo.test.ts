import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';
import { resolveEditorDefaultSource } from '../../routes/editor-defaults';

const workerInstances: MockWorker[] = [];

const createRuntimeFixtureState = () => ({
	activityLog: '',
	artifact: null as {
		path: string;
		bytes: Uint8Array;
		runnable?: boolean;
		entrypoint?: '_start' | '_initialize' | null;
		reason?: string;
	} | null,
	nextArtifact: null as {
		path: string;
		bytes: Uint8Array;
		runnable?: boolean;
		entrypoint?: '_start' | '_initialize' | null;
		reason?: string;
	} | null,
	workspaceFiles: null as Record<string, string> | null,
	bootCalls: 0,
	planCalls: 0,
	executeCalls: 0,
	disposeCalls: 0
});

const runtimeFixtureState =
	(globalThis as typeof globalThis & {
		__wasmIdleTinyGoRuntimeFixtureState?: ReturnType<typeof createRuntimeFixtureState>;
	}).__wasmIdleTinyGoRuntimeFixtureState ||
	(((globalThis as typeof globalThis & {
		__wasmIdleTinyGoRuntimeFixtureState?: ReturnType<typeof createRuntimeFixtureState>;
	}).__wasmIdleTinyGoRuntimeFixtureState = createRuntimeFixtureState()));

const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_TINYGO_APP_URL: '',
		PUBLIC_WASM_TINYGO_MODULE_URL: ''
	}
}));

const runtimeModuleSource = `
const state = globalThis.__wasmIdleTinyGoRuntimeFixtureState;
export const createBundledTinyGoRuntime = () => ({
  async boot() {
    state.bootCalls += 1;
    state.activityLog += '[12:00:00] emception toolchain is ready\\\\n';
  },
  async plan() {
    state.planCalls += 1;
    state.activityLog += '[12:00:01] driver planned 4 step(s)\\\\n';
    return { ok: true };
  },
  async execute() {
    state.executeCalls += 1;
    state.activityLog += '[12:00:02] build artifact ready: /working/out.wasm (4 bytes)\\\\n';
    state.artifact = state.nextArtifact ?? {
      path: '/working/out.wasm',
      bytes: new Uint8Array([0, 97, 115, 109]),
      runnable: true,
      entrypoint: '_start',
    };
    state.nextArtifact = null;
  },
  reset() {
    state.activityLog = '[12:00:00] log cleared\\\\n';
    state.artifact = null;
  },
  readActivityLog() {
    return state.activityLog;
  },
  readBuildArtifact() {
    return state.artifact;
  },
  setWorkspaceFiles(files) {
    state.workspaceFiles = files;
  },
  dispose() {
    state.disposeCalls += 1;
  },
});
`;

const runtimeModuleUrl = `data:text/javascript;base64,${Buffer.from(runtimeModuleSource, 'utf8').toString('base64')}`;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load) {
			queueMicrotask(() => this.onmessage?.({ data: { load: true } } as MessageEvent<any>));
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'tinygo-ok\n', results: true, buffer: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/tinygo?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import TinyGo from './tinygo';

describe('TinyGo sandbox', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_TINYGO_APP_URL = '';
		publicEnv.PUBLIC_WASM_TINYGO_MODULE_URL = '';
		Object.assign(runtimeFixtureState, createRuntimeFixtureState());
	});

	it('loads the TinyGo runtime module, compiles once during prepare, and runs the cached artifact', async () => {
		const sandbox = new TinyGo();
		const outputs: string[] = [];
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load({
			rootUrl: '/absproxy/5173',
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, ['demo'])
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(runtimeFixtureState.workspaceFiles).toEqual({
			'main.go': code
		});
		expect(runtimeFixtureState.workspaceFiles?.['main.go']).toContain("ReadString('\\n')");
		expect(runtimeFixtureState.workspaceFiles?.['main.go']).toContain(
			'fmt.Printf("factorial_plus_bonus=%d\\n", factorial(n)+bonus)'
		);
		expect(runtimeFixtureState.bootCalls).toBe(1);
		expect(runtimeFixtureState.planCalls).toBe(1);
		expect(runtimeFixtureState.executeCalls).toBe(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(1, { load: true });
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				artifact: expect.any(Uint8Array),
				args: ['demo'],
				log: true
			})
		);
		expect(outputs.join('')).toContain('driver planned 4 step(s)');
		expect(outputs.join('')).toContain('tinygo-ok\n');
	});

	it('writes queued stdin when the TinyGo worker requests input', async () => {
		const sandbox = new TinyGo();
		const worker = new MockWorker();
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');

		sandbox.worker = worker as unknown as Worker;
		let runMessage: any;
		worker.postMessage.mockImplementationOnce((message) => {
			runMessage = message;
			queueMicrotask(() => {
				sandbox.write('42\n');
				worker.onmessage?.({
					data: {
						buffer: true,
						results: true
					}
				} as MessageEvent<any>);
			});
		});

		await sandbox.load({
			rootUrl: '/absproxy/5173',
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});
		await expect(
			sandbox.run(code, false, true, undefined, ['demo'])
		).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
	});

	it('fails load when no TinyGo runtime module url is configured', async () => {
		const sandbox = new TinyGo();

		await expect(
			sandbox.load({
				tinygo: {}
			})
		).rejects.toContain(
			'TinyGo runtime is not configured. Set PUBLIC_WASM_TINYGO_MODULE_URL or runtimeAssets.tinygo.moduleUrl.'
		);
	});

	it('rejects execution when the TinyGo runtime reports a bootstrap-only artifact', async () => {
		const sandbox = new TinyGo();
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');

		await sandbox.load({
			rootUrl: '/absproxy/5173',
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});
		runtimeFixtureState.nextArtifact = {
			path: '/working/out.wasm',
			bytes: new Uint8Array([0, 97, 115, 109]),
			runnable: false,
			entrypoint: null,
			reason: 'bootstrap-artifact'
		};

		await expect(sandbox.run(code, false)).rejects.toContain(
			'TinyGo browser runtime produced a bootstrap artifact and cannot execute it yet.'
		);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(1, { load: true });
	});
});
