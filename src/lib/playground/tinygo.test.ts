import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';
import { resolveEditorDefaultSource } from '../../routes/editor-defaults';

const workerInstances: MockWorker[] = [];

const createRuntimeFixtureState = () => ({
	activityLog: '',
	artifact: null as {
		path: string;
		bytes: Uint8Array;
		artifactKind?: 'probe' | 'bootstrap' | 'execution';
		runnable?: boolean;
		entrypoint?: '_start' | '_initialize' | 'main' | null;
		reason?: string;
	} | null,
	nextArtifact: null as {
		path: string;
		bytes: Uint8Array;
		artifactKind?: 'probe' | 'bootstrap' | 'execution';
		runnable?: boolean;
		entrypoint?: '_start' | '_initialize' | 'main' | null;
		reason?: string;
	} | null,
	workspaceFiles: null as Record<string, string> | null,
	bootCalls: 0,
	planCalls: 0,
	executeCalls: 0,
	disposeCalls: 0,
	lastRuntimeOptions: null as { assetLoader?: unknown; assetPacks?: unknown } | null,
	nextExecutionFailureLine: null as string | null,
	skipArtifact: false
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
		PUBLIC_WASM_TINYGO_MODULE_URL: '',
		PUBLIC_WASM_TINYGO_HOST_COMPILE_URL: ''
	}
}));

const runtimeModuleSource = `
const state = globalThis.__wasmIdleTinyGoRuntimeFixtureState;
export const createBundledTinyGoRuntime = (options = {}) => {
  state.lastRuntimeOptions = options;
  return ({
  async boot() {
    state.bootCalls += 1;
    options.onProgress?.({ assetPath: 'vendor/emception/emception.worker.js', assetUrl: 'https://example.invalid/vendor/emception/emception.worker.js', label: 'emception.worker.js', loaded: 8, total: 16 });
    options.onProgress?.({ assetPath: 'vendor/emception/emception.worker.js', assetUrl: 'https://example.invalid/vendor/emception/emception.worker.js', label: 'emception.worker.js', loaded: 16, total: 16 });
    state.activityLog += '[12:00:00] emception toolchain is ready\\n';
  },
  async plan() {
    state.planCalls += 1;
    options.onProgress?.({ assetPath: 'tools/tinygo-compiler.wasm', assetUrl: 'https://example.invalid/tools/tinygo-compiler.wasm', label: 'tinygo-compiler.wasm', loaded: 2, total: 4 });
    options.onProgress?.({ assetPath: 'tools/tinygo-compiler.wasm', assetUrl: 'https://example.invalid/tools/tinygo-compiler.wasm', label: 'tinygo-compiler.wasm', loaded: 4, total: 4 });
    state.activityLog += '[12:00:01] driver planned 4 step(s)\\n';
    return { ok: true };
  },
  async execute() {
    state.executeCalls += 1;
    options.onProgress?.({ assetPath: 'tools/go-probe.wasm', assetUrl: 'https://example.invalid/tools/go-probe.wasm', label: 'go-probe.wasm', loaded: 3, total: 6 });
    options.onProgress?.({ assetPath: 'tools/go-probe.wasm', assetUrl: 'https://example.invalid/tools/go-probe.wasm', label: 'go-probe.wasm', loaded: 6, total: 6 });
    state.activityLog += '[12:00:02] build artifact ready: /working/out.wasm (4 bytes)\\n';
    if (state.nextExecutionFailureLine) {
      state.activityLog += '[12:00:03] ' + state.nextExecutionFailureLine + '\\n';
      state.nextExecutionFailureLine = null;
    }
    if (state.skipArtifact) {
      state.artifact = null;
      state.skipArtifact = false;
      state.nextArtifact = null;
      return;
    }
	    state.artifact = state.nextArtifact ?? {
	      path: '/working/out.wasm',
	      bytes: new Uint8Array([0, 97, 115, 109]),
	      artifactKind: 'execution',
	      runnable: true,
	      entrypoint: '_start',
	    };
    state.nextArtifact = null;
  },
  reset() {
    state.activityLog = '[12:00:00] log cleared\\n';
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
}
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
		vi.stubGlobal('fetch', vi.fn());
		workerInstances.length = 0;
		window.history.replaceState({}, '', 'http://localhost:3000/');
		publicEnv.PUBLIC_WASM_TINYGO_APP_URL = '';
		publicEnv.PUBLIC_WASM_TINYGO_MODULE_URL = '';
		publicEnv.PUBLIC_WASM_TINYGO_HOST_COMPILE_URL = '';
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

	it('maps browser runtime asset progress into the provided sandbox progress sink', async () => {
		const sandbox = new TinyGo();
		const values: number[] = [];
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');

		await sandbox.load({
			rootUrl: '/absproxy/5173',
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});
		await expect(
			sandbox.run(code, true, true, {
				set(value: number) {
					values.push(value);
				}
			})
		).resolves.toBe(true);

		expect(values.some((value) => value > 0.05 && value < 0.35)).toBe(true);
		expect(values.some((value) => value > 0.35 && value < 0.65)).toBe(true);
		expect(values.some((value) => value > 0.65 && value < 0.92)).toBe(true);
		expect(values.at(-1)).toBe(0.95);
		for (let index = 1; index < values.length; index += 1) {
			expect(values[index]).toBeGreaterThanOrEqual(values[index - 1] || 0);
		}
	});

	it('passes the rust runtime base url into the TinyGo browser runtime', async () => {
		const sandbox = new TinyGo();

		await sandbox.load({
			rootUrl: '/absproxy/5173',
			rust: {
				compilerUrl: '/absproxy/5173/wasm-rust/index.js?v=test'
			},
			tinygo: {
				moduleUrl: runtimeModuleUrl,
				disableHostCompile: true
			}
		});

		expect(runtimeFixtureState.lastRuntimeOptions).toEqual(
			expect.objectContaining({
				rustRuntimeBaseUrl: 'http://localhost:3000/absproxy/5173/wasm-rust/runtime/'
			})
		);
	});

	it('passes TinyGo runtime asset loader and pack references into the runtime module', async () => {
		const sandbox = new TinyGo();
		const loader = vi.fn(async () => null);
		const packs = [
			{
				index: 'https://assets.invalid/runtime-pack.index.json',
				asset: 'https://assets.invalid/runtime-pack.bin',
				fileCount: 2,
				totalBytes: 42
			}
		];

		await sandbox.load({
			tinygo: {
				moduleUrl: runtimeModuleUrl,
				disableHostCompile: true,
				assetLoader: loader,
				assetPacks: packs
			}
		});

		expect(runtimeFixtureState.lastRuntimeOptions).toEqual(
			expect.objectContaining({
				assetLoader: loader,
				assetPacks: packs,
				onProgress: expect.any(Function)
			})
		);
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

	it('fails load when no TinyGo runtime module url is configured outside localhost preview defaults', async () => {
		const sandbox = new TinyGo();
		const originalWindow = window;
		vi.stubGlobal('window', {
			location: {
				href: 'https://example.com/app'
			}
		});

		try {
			await expect(
				sandbox.load({
					tinygo: {}
				})
			).rejects.toContain(
				'TinyGo runtime is not configured. Set PUBLIC_WASM_TINYGO_MODULE_URL, PUBLIC_WASM_TINYGO_HOST_COMPILE_URL, runtimeAssets.tinygo.moduleUrl, or runtimeAssets.tinygo.hostCompileUrl.'
			);
		} finally {
			vi.stubGlobal('window', originalWindow);
		}
	});

	it('prefers the TinyGo host compile endpoint when configured', async () => {
		const sandbox = new TinyGo();
		const outputs: string[] = [];
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => ({
				artifact: {
					bytesBase64: Buffer.from([0x00, 0x61, 0x73, 0x6d]).toString('base64'),
					entrypoint: '_start',
					path: '/host/main.wasm',
					runnable: true
				},
				logs: ['tinygo host compile ready: target=wasip1']
			})
		} as Response);

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load({
			rootUrl: '/absproxy/5173',
			tinygo: {
				hostCompileUrl: 'https://example.com/api/tinygo/compile'
			}
		});
		await expect(sandbox.run(code, false, true, undefined, ['demo'])).resolves.toBe(true);

		expect(fetch).toHaveBeenCalledWith('https://example.com/api/tinygo/compile', {
			body: JSON.stringify({
				source: code
			}),
			headers: {
				'content-type': 'application/json'
			},
			method: 'POST'
		});
		expect(runtimeFixtureState.bootCalls).toBe(0);
		expect(runtimeFixtureState.planCalls).toBe(0);
		expect(runtimeFixtureState.executeCalls).toBe(0);
		expect(outputs.join('')).toContain('tinygo host compile ready: target=wasip1');
		expect(outputs.join('')).toContain('tinygo-ok\n');
	});

	it('rejects execution when the TinyGo host compile endpoint returns a non-runnable artifact', async () => {
		const sandbox = new TinyGo();
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => ({
				artifact: {
					bytesBase64: Buffer.from([0x00, 0x61, 0x73, 0x6d]).toString('base64'),
					artifactKind: 'execution',
					entrypoint: null,
					path: '/host/main.wasm',
					reason: 'missing-wasi-entrypoint',
					runnable: false
				},
				logs: ['tinygo host compile ready: target=wasip1']
			})
		} as Response);

		await sandbox.load({
			rootUrl: '/absproxy/5173',
			tinygo: {
				hostCompileUrl: 'https://example.com/api/tinygo/compile'
			}
		});

		await expect(sandbox.run(code, false)).rejects.toContain(
			'TinyGo host compile returned a non-runnable artifact without a supported WASI entrypoint.'
		);
		expect(runtimeFixtureState.bootCalls).toBe(0);
		expect(runtimeFixtureState.planCalls).toBe(0);
		expect(runtimeFixtureState.executeCalls).toBe(0);
	});

	it('uses PUBLIC_WASM_TINYGO_HOST_COMPILE_URL when runtime assets do not override it', async () => {
		const sandbox = new TinyGo();
		const outputs: string[] = [];
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');
		publicEnv.PUBLIC_WASM_TINYGO_HOST_COMPILE_URL = '/runtime/tinygo/compile';
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => ({
				artifact: {
					bytesBase64: Buffer.from([0x00, 0x61, 0x73, 0x6d]).toString('base64'),
					entrypoint: '_start',
					path: '/host/env-main.wasm',
					runnable: true
				},
				logs: ['tinygo host compile ready: target=wasip1']
			})
		} as Response);

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load();
		await expect(sandbox.run(code, false, true, undefined, ['demo'])).resolves.toBe(true);

		expect(fetch).toHaveBeenCalledWith('http://localhost:3000/runtime/tinygo/compile', {
			body: JSON.stringify({
				source: code
			}),
			headers: {
				'content-type': 'application/json'
			},
			method: 'POST'
		});
		expect(runtimeFixtureState.bootCalls).toBe(0);
		expect(outputs.join('')).toContain('tinygo host compile ready: target=wasip1');
	});

	it('derives the current-page TinyGo host compile endpoint when only a browser runtime module is configured', async () => {
		const sandbox = new TinyGo();
		const outputs: string[] = [];
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');
		window.history.replaceState({}, '', 'http://localhost:3000/absproxy/5173/');
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: async () => ({
				artifact: {
					bytesBase64: Buffer.from([0x00, 0x61, 0x73, 0x6d]).toString('base64'),
					entrypoint: '_start',
					path: '/host/current-page-main.wasm',
					runnable: true
				},
				logs: ['tinygo host compile ready: target=wasip1']
			})
		} as Response);

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load({
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});
		await expect(sandbox.run(code, false, true, undefined, ['demo'])).resolves.toBe(true);

		expect(fetch).toHaveBeenCalledWith('http://localhost:3000/absproxy/5173/api/tinygo/compile', {
			body: JSON.stringify({
				source: code
			}),
			headers: {
				'content-type': 'application/json'
			},
			method: 'POST'
		});
		expect(runtimeFixtureState.bootCalls).toBe(0);
		expect(runtimeFixtureState.planCalls).toBe(0);
		expect(runtimeFixtureState.executeCalls).toBe(0);
		expect(outputs.join('')).toContain('tinygo host compile ready: target=wasip1');
		expect(outputs.join('')).toContain('tinygo-ok\n');
	});

	it('falls back to the browser runtime when the TinyGo host compile endpoint is unavailable', async () => {
		const sandbox = new TinyGo();
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');
		vi.mocked(fetch).mockResolvedValue({
			ok: false,
			status: 404
		} as Response);

		await sandbox.load({
			rootUrl: '/absproxy/5173',
			tinygo: {
				hostCompileUrl: 'https://example.com/api/tinygo/compile',
				moduleUrl: runtimeModuleUrl
			}
		});
		await expect(sandbox.run(code, false)).resolves.toBe(true);

		expect(runtimeFixtureState.bootCalls).toBe(1);
		expect(runtimeFixtureState.planCalls).toBe(1);
		expect(runtimeFixtureState.executeCalls).toBe(1);
	});

	it('does not derive implicit TinyGo host compile endpoints from non-local browser origins', async () => {
		const sandbox = new TinyGo();
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');
		const originalWindow = window;
		vi.stubGlobal('window', {
			...window,
			location: {
				href: 'https://example.com/wasm-idle/'
			}
		});

		try {
			await sandbox.load({
				rootUrl: '/absproxy/5173',
				tinygo: {
					moduleUrl: runtimeModuleUrl
				}
			});
			await expect(sandbox.run(code, false)).resolves.toBe(true);
		} finally {
			vi.stubGlobal('window', originalWindow);
		}

		expect(fetch).not.toHaveBeenCalled();
		expect(runtimeFixtureState.bootCalls).toBe(1);
		expect(runtimeFixtureState.planCalls).toBe(1);
		expect(runtimeFixtureState.executeCalls).toBe(1);
	});

	it('skips TinyGo host compile discovery when browser-only execution explicitly disables it', async () => {
		const sandbox = new TinyGo();
		const outputs: string[] = [];
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');
		window.history.replaceState({}, '', 'http://localhost:3000/absproxy/5173/');

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load({
			tinygo: {
				moduleUrl: runtimeModuleUrl,
				disableHostCompile: true
			}
		});
		await expect(sandbox.run(code, false, true, undefined, ['demo'])).resolves.toBe(true);

		expect(fetch).not.toHaveBeenCalled();
		expect(runtimeFixtureState.bootCalls).toBe(1);
		expect(runtimeFixtureState.planCalls).toBe(1);
		expect(runtimeFixtureState.executeCalls).toBe(1);
		expect(outputs.join('')).toContain('tinygo artifact ready: /working/out.wasm');
		expect(outputs.join('')).toContain('tinygo-ok\n');
	});

	it('retries a localhost sibling wasm-tinygo preview endpoint before using the browser runtime fallback', async () => {
		const sandbox = new TinyGo();
		const outputs: string[] = [];
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');
		vi.mocked(fetch)
			.mockResolvedValueOnce({
				ok: false,
				status: 404
			} as Response)
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					artifact: {
						bytesBase64: Buffer.from([0x00, 0x61, 0x73, 0x6d]).toString('base64'),
						entrypoint: '_start',
						path: '/host/local-preview-main.wasm',
						runnable: true
					},
					logs: ['tinygo host compile ready: target=wasip1']
				})
			} as Response);

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load({
			rootUrl: '/absproxy/5173',
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});
		await expect(sandbox.run(code, false, true, undefined, ['demo'])).resolves.toBe(true);

		expect(fetch).toHaveBeenNthCalledWith(1, 'http://localhost:3000/absproxy/5173/api/tinygo/compile', {
			body: JSON.stringify({
				source: code
			}),
			headers: {
				'content-type': 'application/json'
			},
			method: 'POST'
		});
		expect(fetch).toHaveBeenNthCalledWith(2, 'http://localhost:4175/api/tinygo/compile', {
			body: JSON.stringify({
				source: code
			}),
			headers: {
				'content-type': 'application/json'
			},
			method: 'POST'
		});
		expect(runtimeFixtureState.bootCalls).toBe(0);
		expect(runtimeFixtureState.planCalls).toBe(0);
		expect(runtimeFixtureState.executeCalls).toBe(0);
		expect(outputs.join('')).toContain('tinygo host compile ready: target=wasip1');
		expect(outputs.join('')).toContain('tinygo-ok\n');
	});

	it('runs the browser runtime after the local host compile probes both miss', async () => {
		const sandbox = new TinyGo();
		const outputs: string[] = [];
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');
		window.history.replaceState({}, '', 'http://localhost:3000/absproxy/5173/');
		vi.mocked(fetch)
			.mockResolvedValueOnce({
				ok: false,
				status: 404
			} as Response)
			.mockResolvedValueOnce({
				ok: false,
				status: 404
			} as Response);

		sandbox.output = (chunk: string) => outputs.push(chunk);

		await sandbox.load({
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});
		await expect(sandbox.run(code, false, true, undefined, ['demo'])).resolves.toBe(true);

		expect(fetch).toHaveBeenNthCalledWith(1, 'http://localhost:3000/absproxy/5173/api/tinygo/compile', {
			body: JSON.stringify({
				source: code
			}),
			headers: {
				'content-type': 'application/json'
			},
			method: 'POST'
		});
		expect(fetch).toHaveBeenNthCalledWith(2, 'http://localhost:4175/api/tinygo/compile', {
			body: JSON.stringify({
				source: code
			}),
			headers: {
				'content-type': 'application/json'
			},
			method: 'POST'
		});
		expect(runtimeFixtureState.bootCalls).toBe(1);
		expect(runtimeFixtureState.planCalls).toBe(1);
		expect(runtimeFixtureState.executeCalls).toBe(1);
		expect(outputs.join('')).toContain('tinygo artifact ready: /working/out.wasm');
		expect(outputs.join('')).toContain('tinygo-ok\n');
	});

	it('runs a browser fallback artifact when the runtime reports a main entrypoint', async () => {
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
		runtimeFixtureState.nextArtifact = {
			path: '/working/out.exec.wasm',
			bytes: new Uint8Array([0, 97, 115, 109]),
			runnable: true,
			entrypoint: 'main'
		};

		await expect(sandbox.run(code, false, true, undefined, ['demo'])).resolves.toBe(true);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(2);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(1, { load: true });
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				artifact: expect.any(Uint8Array),
				args: ['demo'],
				log: true
			})
		);
		expect(outputs.join('')).toContain('tinygo-ok\n');
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
			artifactKind: 'bootstrap',
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

	it('rejects execution when the TinyGo browser runtime only produces a non-runnable probe artifact', async () => {
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
			artifactKind: 'probe',
			runnable: false,
			entrypoint: null,
			reason: 'missing-wasi-entrypoint'
		};

		await expect(sandbox.run(code, false)).rejects.toContain(
			'TinyGo browser runtime produced a non-runnable probe artifact without a supported WASI entrypoint.'
		);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(1, { load: true });
	});

	it('reports the unavailable TinyGo host compile endpoints before surfacing a bootstrap fallback artifact', async () => {
		const sandbox = new TinyGo();
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');
		window.history.replaceState({}, '', 'http://localhost:3000/absproxy/5173/');
		vi.mocked(fetch)
			.mockResolvedValueOnce({
				ok: false,
				status: 404
			} as Response)
			.mockResolvedValueOnce({
				ok: false,
				status: 404
			} as Response);

		await sandbox.load({
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});
		runtimeFixtureState.nextArtifact = {
			path: '/working/out.wasm',
			bytes: new Uint8Array([0, 97, 115, 109]),
			artifactKind: 'bootstrap',
			runnable: false,
			entrypoint: null,
			reason: 'bootstrap-artifact'
		};

		await expect(sandbox.run(code, false)).rejects.toContain(
			'TinyGo host compile endpoints were unavailable: http://localhost:3000/absproxy/5173/api/tinygo/compile, http://localhost:4175/api/tinygo/compile. TinyGo browser runtime produced a bootstrap artifact and cannot execute it yet.'
		);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(1, { load: true });
	});

	it('surfaces the browser runtime execution failure after local host compile probes miss', async () => {
		const sandbox = new TinyGo();
		const code = resolveEditorDefaultSource('go', 'wasm32-wasip1');
		window.history.replaceState({}, '', 'http://localhost:3000/absproxy/5173/');
		vi.mocked(fetch)
			.mockResolvedValueOnce({
				ok: false,
				status: 404
			} as Response)
			.mockResolvedValueOnce({
				ok: false,
				status: 404
			} as Response);

		await sandbox.load({
			tinygo: {
				moduleUrl: runtimeModuleUrl
			}
		});
		runtimeFixtureState.skipArtifact = true;
		runtimeFixtureState.nextExecutionFailureLine =
			'build execution failed: browser runtime stopped before linking a final artifact because the backend emitted a probe-only command artifact and no host compile seam is configured';

		const errorMessage = await sandbox.run(code, false).then(
			() => null,
			(error) => (error instanceof Error ? error.message : String(error))
		);
		expect(errorMessage).toContain(
			'TinyGo host compile endpoints were unavailable: http://localhost:3000/absproxy/5173/api/tinygo/compile, http://localhost:4175/api/tinygo/compile. TinyGo browser runtime could not produce a runnable execution artifact: build execution failed: browser runtime stopped before linking a final artifact because the backend emitted a probe-only command artifact and no host compile seam is configured.'
		);
		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(1, { load: true });
	});
});
