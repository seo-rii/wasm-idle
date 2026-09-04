import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimeoutError } from '@wasm-idle/core';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { executableGraphFixture, lldbSessions, publicEnv } = vi.hoisted(() => ({
	executableGraphFixture: {
		load: vi.fn()
	},
	lldbSessions: [] as any[],
	publicEnv: {
		PUBLIC_WASM_RUST_COMPILER_URL: ''
	}
}));
let suppressAutoLoadAck = false;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		if (message.load) {
			if (suppressAutoLoadAck) return;
			queueMicrotask(() => this.onmessage?.({ data: { load: true } } as MessageEvent<any>));
			return;
		}
		if (message.prepare) {
			queueMicrotask(() => {
				this.onmessage?.({
					data: {
						diagnostic: {
							fileName: 'main.rs',
							lineNumber: 1,
							columnNumber: 4,
							severity: 'warning',
							message: 'unused mut'
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({ data: { results: true, buffer: true } } as MessageEvent<any>);
			});
			return;
		}
		queueMicrotask(() =>
			this.onmessage?.({
				data: { output: 'hi\n', results: true, buffer: true }
			} as MessageEvent<any>)
		);
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}
}

vi.mock('$lib/playground/worker/rust?worker', () => ({
	default: MockWorker
}));

vi.mock('$lib/playground/rustExecutableGraph', () => ({
	loadVerifiedRustExecutableGraph: executableGraphFixture.load
}));

vi.mock('$lib/playground/wasmRustVersion', () => ({
	WASM_RUST_EXECUTABLE_GRAPH_PROFILE: {
		fingerprint: 'a'.repeat(64)
	},
	WASM_RUST_RUNTIME_PROFILE: {
		profileId: `wasm-rust-${'1'.repeat(64)}`,
		protocolVersion: 1,
		manifestPath: 'runtime/runtime-manifest.v3.json',
		manifestFingerprint: '1'.repeat(64),
		manifestReceipt: { bytes: 42, sha256: '2'.repeat(64) }
	}
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

vi.mock('$lib/playground/lldbSession', () => ({
	LldbSandboxSession: class {
		readonly breakpointCalls: Array<{ lines: number[]; sourcePath: string }> = [];
		readonly options: any;
		private resolveStart?: (value: true) => void;

		constructor(options: any) {
			this.options = options;
			lldbSessions.push(this);
		}

		start() {
			return new Promise<true>((resolve) => {
				this.resolveStart = resolve;
			});
		}

		emit(event: any) {
			this.options.onDebugEvent(event);
		}

		finish() {
			this.resolveStart?.(true);
		}

		setBreakpoints(lines: number[], sourcePath: string) {
			this.breakpointCalls.push({ lines: [...lines], sourcePath });
			return Promise.resolve([]);
		}

		debugCommand() {}
		pause() {}
		write() {}
		eof() {}
		disconnect() {}
		evaluate() {
			return Promise.resolve('?');
		}
		variables() {
			return Promise.resolve([]);
		}
	}
}));

import Rust from './rust';

describe('Rust sandbox', () => {
	beforeEach(() => {
		lldbSessions.length = 0;
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_RUST_COMPILER_URL = '/wasm-rust/index.js';
		suppressAutoLoadAck = false;
		executableGraphFixture.load.mockReset();
		executableGraphFixture.load.mockImplementation(async ({ moduleUrl }: any) => ({
			entryUrl: `blob:http://localhost/verified-rust-${executableGraphFixture.load.mock.calls.length}`,
			sourceModuleUrl: moduleUrl,
			assetBaseUrl: 'http://localhost/wasm-rust/',
			runtimeProfile: {
				profileId: `wasm-rust-${'1'.repeat(64)}`,
				protocolVersion: 1,
				manifestPath: 'runtime/runtime-manifest.v3.json',
				manifestFingerprint: '1'.repeat(64),
				manifestReceipt: { bytes: 42, sha256: '2'.repeat(64) },
				moduleUrl
			},
			moduleUrls: { 'index.js': 'blob:http://localhost/verified-rust-entry' },
			networkModuleUrls: {
				'http://localhost/wasm-rust/index.js': 'blob:http://localhost/verified-rust-entry'
			},
			dispose: vi.fn()
		}));
	});

	it('waits for the active LLDB session to disconnect before terminate resolves', async () => {
		const sandbox = new Rust();
		let releaseDisconnect!: () => void;
		const disconnect = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					releaseDisconnect = resolve;
				})
		);
		(
			sandbox as unknown as {
				lldbSession: { disconnect(): Promise<void> };
			}
		).lldbSession = { disconnect };

		let settled = false;
		const termination = Promise.resolve(sandbox.terminate()).then(() => {
			settled = true;
		});
		await Promise.resolve();

		expect(disconnect).toHaveBeenCalledTimes(1);
		expect(settled).toBe(false);

		releaseDisconnect();
		await expect(termination).resolves.toBeUndefined();
		expect(settled).toBe(true);
	});

	it('forwards target memory reads to the active LLDB session', async () => {
		const sandbox = new Rust();
		const readMemory = vi.fn(
			async (_memoryReference: string, _offset: number, _count: number) => ({
				address: '0x40',
				data: Uint8Array.of(4, 2),
				unreadableBytes: 0
			})
		);
		(
			sandbox as unknown as {
				lldbSession: { readMemory: typeof readMemory };
			}
		).lldbSession = { readMemory };

		await expect(
			(sandbox as unknown as { debugReadMemory: typeof readMemory }).debugReadMemory(
				'0x40',
				0,
				2
			)
		).resolves.toEqual({
			address: '0x40',
			data: Uint8Array.of(4, 2),
			unreadableBytes: 0
		});
		expect(readMemory).toHaveBeenCalledWith('0x40', 0, 2);
	});

	it('forwards frame scope requests to the active LLDB session', async () => {
		const sandbox = new Rust();
		const scopes = vi.fn(async (_frameId: number) => [
			{ name: 'Locals', variablesReference: 9, expensive: false, variables: [] }
		]);
		(
			sandbox as unknown as {
				lldbSession: { scopes: typeof scopes };
			}
		).lldbSession = { scopes };

		await expect(
			(sandbox as unknown as { debugScopes: typeof scopes }).debugScopes(73)
		).resolves.toEqual([
			{ name: 'Locals', variablesReference: 9, expensive: false, variables: [] }
		]);
		expect(scopes).toHaveBeenCalledWith(73);
	});

	it('loads the rust worker and forwards diagnostics plus run output', async () => {
		const sandbox = new Rust();
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const code = `fn main() {
    println!("hi");
}`;

		sandbox.output = (chunk: string) => outputs.push(chunk);
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);

		await sandbox.load('/absproxy/5173');
		await expect(sandbox.run(code, true)).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, ['one', 'two'], {
				rustTargetTriple: 'wasm32-wasip2'
			})
		).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, ['three'], {
				rustTargetTriple: 'wasm32-wasip3'
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				compilerUrl: expect.stringMatching(/^blob:http:\/\/localhost\/verified-rust-/),
				debugModuleUrl: expect.stringMatching(/\/wasm-rust\/debug-instrumenter\.js$/),
				path: '/absproxy/5173',
				executableGraphFingerprint: 'a'.repeat(64),
				runtimeProfile: expect.objectContaining({
					manifestFingerprint: '1'.repeat(64)
				}),
				verifiedModuleUrls: expect.any(Object)
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				args: [],
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				args: ['one', 'two'],
				targetTriple: 'wasm32-wasip2',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			4,
			expect.objectContaining({
				prepare: false,
				code,
				args: ['three'],
				targetTriple: 'wasm32-wasip3',
				log: true
			})
		);
		expect(outputs).toContain('hi\n');
		expect(diagnostics).toEqual([
			{
				fileName: 'main.rs',
				lineNumber: 1,
				columnNumber: 4,
				severity: 'warning',
				message: 'unused mut'
			}
		]);
	});

	it('forwards exact Core worker and thread ceilings on non-debug runs', async () => {
		const sandbox = new Rust();
		sandbox.output = () => {};
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockClear();

		await expect(
			sandbox.run('fn main() {}', false, true, undefined, [], {
				limits: { maxWorkers: 3, maxThreads: 7 }
			})
		).resolves.toBe(true);

		expect(worker.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				limits: expect.objectContaining({
					maxWorkers: 3,
					maxThreads: 7
				})
			})
		);
	});

	it('rejects invalid Core worker limits before posting a run message', async () => {
		const sandbox = new Rust();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockClear();

		await expect(
			sandbox.run('fn main() {}', false, true, undefined, [], {
				limits: { maxWorkers: 0 }
			})
		).rejects.toThrow('Execution limit maxWorkers must be a positive safe integer');

		expect(worker.postMessage).not.toHaveBeenCalled();
	});

	it('rejects load when no rust compiler url is configured', async () => {
		publicEnv.PUBLIC_WASM_RUST_COMPILER_URL = '';
		const sandbox = new Rust();

		await expect(sandbox.load('/absproxy/5173')).rejects.toThrow(
			'Rust runtime is not configured'
		);
	});

	it('does not create an outer worker when executable graph verification fails', async () => {
		executableGraphFixture.load.mockRejectedValueOnce(new Error('graph receipt mismatch'));
		const sandbox = new Rust();

		await expect(sandbox.load('/absproxy/5173')).rejects.toThrow('graph receipt mismatch');

		expect(workerInstances).toHaveLength(0);
	});

	it('preserves the active generation when replacement graph verification fails', async () => {
		const sandbox = new Rust();
		await sandbox.load('/absproxy/5173');
		const activeWorker = workerInstances[0];
		const activeGraph = await executableGraphFixture.load.mock.results[0]!.value;
		executableGraphFixture.load.mockRejectedValueOnce(new Error('replacement rejected'));

		await expect(
			sandbox.load({
				rootUrl: '/replacement',
				rust: {
					compilerUrl: '/replacement/wasm-rust/index.js',
					executableGraphFingerprint: 'a'.repeat(64)
				}
			})
		).rejects.toThrow('replacement rejected');

		expect(activeWorker.terminate).not.toHaveBeenCalled();
		expect(activeGraph.dispose).not.toHaveBeenCalled();
		expect(sandbox.worker).toBe(activeWorker);
	});

	it('rejects a configured runtime manifest profile that differs from the bundle', async () => {
		const sandbox = new Rust();

		await expect(
			sandbox.load({
				rootUrl: '/mirror',
				rust: {
					compilerUrl: `/mirror/wasm-rust/index.js?v=${'3'.repeat(64)}&rustManifestBytes=42&rustManifestSha256=${'2'.repeat(64)}`,
					manifestFingerprint: '3'.repeat(64),
					executableGraphFingerprint: 'a'.repeat(64)
				}
			})
		).rejects.toThrow('Rust runtime profile does not match the bundled receipt profile');
		expect(executableGraphFixture.load).not.toHaveBeenCalled();
		expect(workerInstances).toHaveLength(0);
	});

	it('preserves active stdin state when replacement graph verification fails', async () => {
		const sandbox = new Rust();
		await sandbox.load('/absproxy/5173');
		const activeWorker = workerInstances[0];
		let runMessage: any;
		activeWorker.postMessage.mockImplementationOnce((message) => {
			runMessage = message;
			queueMicrotask(() => {
				activeWorker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
			});
		});
		const runPromise = sandbox.run('fn main() {}', false);
		await vi.waitFor(() => expect(sandbox.waitingForInput).toBe(true));
		executableGraphFixture.load.mockRejectedValueOnce(new Error('replacement rejected'));

		await expect(
			sandbox.load({
				rootUrl: '/replacement',
				rust: {
					compilerUrl: '/replacement/wasm-rust/index.js',
					executableGraphFingerprint: 'a'.repeat(64)
				}
			})
		).rejects.toThrow('replacement rejected');
		sandbox.write('42\n');

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
		activeWorker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(runPromise).resolves.toBe(true);
	});

	it('aborts a pending graph load without creating a late worker', async () => {
		let rejectGraph!: (reason: unknown) => void;
		executableGraphFixture.load.mockImplementationOnce(
			({ signal }: { signal: AbortSignal }) =>
				new Promise((_resolve, reject) => {
					rejectGraph = reject;
					signal.addEventListener(
						'abort',
						() => reject(signal.reason ?? new Error('aborted')),
						{ once: true }
					);
				})
		);
		const sandbox = new Rust();
		const loadPromise = sandbox.load('/absproxy/5173');
		await Promise.resolve();

		await sandbox.terminate();
		rejectGraph(new Error('late graph completion'));

		await expect(loadPromise).rejects.toThrow(/terminated|late graph completion/u);
		expect(workerInstances).toHaveLength(0);
	});

	it('terminates the old worker before disposing only its executable graph', async () => {
		const events: string[] = [];
		let graphIndex = 0;
		executableGraphFixture.load.mockImplementation(async ({ moduleUrl }: any) => {
			const currentGraph = ++graphIndex;
			return {
				entryUrl: `blob:http://localhost/graph-${currentGraph}`,
				sourceModuleUrl: moduleUrl,
				assetBaseUrl: 'http://localhost/wasm-rust/',
				runtimeProfile: {
					profileId: `wasm-rust-${'1'.repeat(64)}`,
					protocolVersion: 1,
					manifestPath: 'runtime/runtime-manifest.v3.json',
					manifestFingerprint: '1'.repeat(64),
					manifestReceipt: { bytes: 42, sha256: '2'.repeat(64) },
					moduleUrl
				},
				moduleUrls: { 'index.js': `blob:http://localhost/graph-${currentGraph}` },
				networkModuleUrls: {
					[moduleUrl]: `blob:http://localhost/graph-${currentGraph}`
				},
				dispose: vi.fn(() => events.push(`dispose-${currentGraph}`))
			};
		});
		const sandbox = new Rust();
		await sandbox.load('/absproxy/5173');
		const firstWorker = workerInstances[0];
		firstWorker.terminate.mockImplementation(() => events.push('terminate-1'));

		await sandbox.load({
			rootUrl: '/replacement',
			rust: {
				compilerUrl: '/replacement/wasm-rust/index.js',
				executableGraphFingerprint: 'a'.repeat(64)
			}
		});

		expect(events).toEqual(['terminate-1', 'dispose-1']);
		expect(workerInstances).toHaveLength(2);
		expect(sandbox.worker).toBe(workerInstances[1]);
	});

	it('rejects an active run when a verified replacement becomes active', async () => {
		const sandbox = new Rust();
		await sandbox.load('/absproxy/5173');
		workerInstances[0].postMessage.mockImplementationOnce(() => {});
		const runPromise = sandbox.run('fn main() {}', false);
		const rejectedRun = expect(runPromise).rejects.toContain('Rust runtime worker replaced');

		await sandbox.load({
			rootUrl: '/replacement',
			rust: {
				compilerUrl: '/replacement/wasm-rust/index.js',
				executableGraphFingerprint: 'a'.repeat(64)
			}
		});

		await rejectedRun;
		expect(sandbox.worker).toBe(workerInstances[1]);
	});

	it('rejects an overlapping run without posting it to the active worker', async () => {
		const sandbox = new Rust();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => {});

		const firstRun = sandbox.run('fn main() {}', false);
		await expect(sandbox.run('fn main() { println!("second"); }', false)).rejects.toContain(
			'Rust runtime already has an active run'
		);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);

		worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(firstRun).resolves.toBe(true);
	});

	it('aborts an active run and disposes its worker graph', async () => {
		const controller = new AbortController();
		const sandbox = new Rust();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const graph = await executableGraphFixture.load.mock.results[0]!.value;
		worker.postMessage.mockImplementationOnce(() => {});

		const runPromise = sandbox.run('fn main() {}', false, true, undefined, [], {
			signal: controller.signal
		});
		const rejectedRun = expect(runPromise).rejects.toThrow('caller cancelled Rust run');
		controller.abort(new Error('caller cancelled Rust run'));

		await rejectedRun;
		expect(worker.terminate).toHaveBeenCalledTimes(1);
		expect(graph.dispose).toHaveBeenCalledTimes(1);
		expect(sandbox.worker).toBeFalsy();
	});

	it('terminates the active generation when compilation exceeds its wall timeout', async () => {
		const sandbox = new Rust();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const graph = await executableGraphFixture.load.mock.results[0]!.value;
		worker.postMessage.mockImplementationOnce(() => {});
		vi.useFakeTimers();
		try {
			const runPromise = sandbox.run('fn main() {}', false, true, undefined, [], {
				limits: { compileTimeoutMs: 5 }
			});
			const rejectedRun = expect(runPromise).rejects.toMatchObject({
				name: 'TimeoutError',
				code: 'timeout',
				phase: 'compile',
				runtimeId: 'RUST',
				timeoutMs: 5,
				message: 'Rust compile timed out after 5 ms'
			} satisfies Partial<TimeoutError>);

			await vi.advanceTimersByTimeAsync(5);
			await rejectedRun;
			expect(worker.terminate).toHaveBeenCalledTimes(1);
			expect(graph.dispose).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('switches to the run timeout when the worker begins execution', async () => {
		const sandbox = new Rust();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => {});
		vi.useFakeTimers();
		try {
			const runPromise = sandbox.run('fn main() {}', false, true, undefined, [], {
				limits: { compileTimeoutMs: 1000, runTimeoutMs: 5 }
			});
			const rejectedRun = expect(runPromise).rejects.toThrow('Rust run timed out after 5 ms');
			worker.onmessage?.({ data: { runtimePhase: 'run' } } as MessageEvent<any>);

			await vi.advanceTimersByTimeAsync(5);
			await rejectedRun;
			expect(worker.terminate).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('preserves the remaining run timeout while trace debugging is paused', async () => {
		const sandbox = new Rust();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => {});
		vi.useFakeTimers();
		try {
			const runPromise = sandbox.run('fn main() {}', false, true, undefined, [], {
				debug: true,
				limits: { compileTimeoutMs: 1000, runTimeoutMs: 10 }
			});
			const rejectedRun = expect(runPromise).rejects.toMatchObject({
				name: 'TimeoutError',
				code: 'timeout',
				phase: 'execute',
				runtimeId: 'RUST',
				timeoutMs: 10,
				message: 'Rust run timed out after 10 ms'
			} satisfies Partial<TimeoutError>);
			worker.onmessage?.({ data: { runtimePhase: 'run' } } as MessageEvent<any>);

			await vi.advanceTimersByTimeAsync(3);
			worker.onmessage?.({
				data: {
					debugEvent: {
						type: 'pause',
						line: 1,
						reason: 'entry',
						locals: [],
						callStack: []
					}
				}
			} as MessageEvent<any>);

			await vi.advanceTimersByTimeAsync(100);
			expect(worker.terminate).not.toHaveBeenCalled();

			sandbox.debugCommand('continue');
			await vi.advanceTimersByTimeAsync(6);
			expect(worker.terminate).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);

			await rejectedRun;
			expect(worker.terminate).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it('uses and suspends the run timeout after handing an artifact to LLDB', async () => {
		const sandbox = new Rust();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => {});
		vi.useFakeTimers();
		try {
			let settled = false;
			const runPromise = sandbox.run('fn main() {}', false, true, undefined, [], {
				debugMode: 'lldb',
				limits: { compileTimeoutMs: 1000, runTimeoutMs: 10 }
			});
			void runPromise.then(
				() => (settled = true),
				() => (settled = true)
			);
			const rejectedRun = expect(runPromise).rejects.toThrow(
				'Rust run timed out after 10 ms'
			);
			worker.onmessage?.({
				data: {
					lldbArtifact: {
						bytes: Uint8Array.of(0, 97, 115, 109),
						descriptor: {},
						sources: []
					}
				}
			} as MessageEvent<any>);
			expect(lldbSessions).toHaveLength(1);

			await vi.advanceTimersByTimeAsync(3);
			lldbSessions[0].emit({
				type: 'pause',
				line: 1,
				reason: 'entry',
				locals: [],
				callStack: []
			});
			await vi.advanceTimersByTimeAsync(100);
			expect(settled).toBe(false);

			lldbSessions[0].emit({ type: 'resume', command: 'continue' });
			await vi.advanceTimersByTimeAsync(6);
			expect(settled).toBe(false);
			await vi.advanceTimersByTimeAsync(1);

			await rejectedRun;
		} finally {
			vi.useRealTimers();
		}
	});

	it('terminates the active generation before forwarding excessive output', async () => {
		const sandbox = new Rust();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		const outputs: string[] = [];
		sandbox.output = (output: string) => outputs.push(output);
		worker.postMessage.mockImplementationOnce(() => {});
		const runPromise = sandbox.run('fn main() {}', false, true, undefined, [], {
			limits: { maxOutputBytes: 5 }
		});
		const rejectedRun = expect(runPromise).rejects.toThrow('Rust output exceeded 5 bytes');

		worker.onmessage?.({ data: { output: '123456' } } as MessageEvent<any>);

		await rejectedRun;
		expect(outputs).toEqual([]);
		expect(worker.terminate).toHaveBeenCalledTimes(1);
	});

	it('bounds worker error payloads with the same output budget', async () => {
		const sandbox = new Rust();
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => {});
		const runPromise = sandbox.run('fn main() {}', false, true, undefined, [], {
			limits: { maxOutputBytes: 5 }
		});
		const rejectedRun = expect(runPromise).rejects.toThrow('Rust output exceeded 5 bytes');

		worker.onmessage?.({ data: { error: '123456' } } as MessageEvent<any>);

		await rejectedRun;
		expect(worker.terminate).toHaveBeenCalledTimes(1);
	});

	it('forwards executable graph asset limits and abort signal', async () => {
		const controller = new AbortController();
		const sandbox = new Rust();

		await sandbox.load('/absproxy/5173', '', true, [], {
			signal: controller.signal,
			limits: { maxAssetBytes: 1234, assetTimeoutMs: 5678 }
		});

		expect(executableGraphFixture.load).toHaveBeenCalledWith(
			expect.objectContaining({
				maxAssetBytes: 1234,
				assetTimeoutMs: 5678,
				signal: expect.any(AbortSignal)
			})
		);
	});

	it('rejects load when the rust worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Rust();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/rust.js',
			lineno: 88,
			colno: 24
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'Rust worker script error: worker script error (/worker/rust.js:88:24)'
		);
	});

	it('aborts a worker bootstrap and disposes its verified graph', async () => {
		suppressAutoLoadAck = true;
		const controller = new AbortController();
		const sandbox = new Rust();
		const loadPromise = sandbox.load('/absproxy/5173', '', true, [], {
			signal: controller.signal
		});
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		const graph = await executableGraphFixture.load.mock.results[0]!.value;

		controller.abort(new Error('caller cancelled Rust startup'));

		await expect(loadPromise).rejects.toThrow('caller cancelled Rust startup');
		expect(worker.terminate).toHaveBeenCalledTimes(1);
		expect(graph.dispose).toHaveBeenCalledTimes(1);
		expect(sandbox.worker).toBeFalsy();
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		const sandbox = new Rust();
		const worker = new MockWorker();
		const report = vi.fn();
		let runMessage: any;

		sandbox.worker = worker as unknown as Worker;
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

		await expect(
			sandbox.run(
				`fn main() {
	    println!("hi");
}`,
				false,
				true,
				{ report }
			)
		).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
		expect(report).toHaveBeenCalledWith({
			kind: 'ready',
			state: 'waiting-input',
			reason: 'stdin-request',
			label: 'Rust program is waiting for input'
		});
	});

	it('does not report stdin readiness for compiler-only preparation', async () => {
		const sandbox = new Rust();
		const worker = new MockWorker();
		const report = vi.fn();
		sandbox.worker = worker as unknown as Worker;

		await expect(sandbox.run('fn main() {}', true, true, { report })).resolves.toBe(true);

		expect(report).not.toHaveBeenCalled();
	});

	it('maps worker compile progress into the provided sandbox progress sink', async () => {
		const sandbox = new Rust();
		const worker = new MockWorker();
		const values: number[] = [];

		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce(() => {
			queueMicrotask(() => {
				worker.onmessage?.({
					data: {
						progress: {
							stage: 'fetch-rustc',
							percent: 12
						}
					}
				} as MessageEvent<any>);
				worker.onmessage?.({
					data: {
						progress: {
							stage: 'link',
							percent: 93
						}
					}
				} as MessageEvent<any>);
				worker.onmessage?.({
					data: {
						results: true
					}
				} as MessageEvent<any>);
			});
		});

		await expect(
			sandbox.run('fn main() {}', true, true, {
				set(value: number) {
					values.push(value);
				}
			})
		).resolves.toBe(true);

		expect(values).toEqual([0.12, 0.93]);
	});

	it('forwards Rust debug options, commands, and breakpoint updates through the worker', async () => {
		const sandbox = new Rust();
		const worker = new MockWorker();
		const events: any[] = [];
		let runMessage: any;

		sandbox.worker = worker as unknown as Worker;
		sandbox.ondebug = (event) => events.push(event);
		worker.postMessage.mockImplementationOnce((message) => {
			runMessage = message;
			queueMicrotask(() => {
				worker.onmessage?.({
					data: {
						debugEvent: {
							type: 'pause',
							line: 2,
							reason: 'entry',
							locals: [],
							callStack: [{ functionName: 'main', line: 2 }]
						}
					}
				} as MessageEvent<any>);
				worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
		});

		await expect(
			sandbox.run('fn main() {}', false, true, undefined, [], {
				debug: true,
				breakpoints: [2],
				pauseOnEntry: true
			})
		).resolves.toBe(true);

		expect(runMessage).toMatchObject({
			debug: true,
			breakpoints: [2],
			pauseOnEntry: true
		});
		expect(runMessage.debugBuffer).toBe(sandbox.debugBuffer);
		expect(events).toContainEqual({
			type: 'pause',
			line: 2,
			reason: 'entry',
			locals: [],
			callStack: [{ functionName: 'main', line: 2 }]
		});
		expect(events).toContainEqual({ type: 'stop' });

		sandbox.debugCommand('nextLine');
		expect(Atomics.load(new Int32Array(sandbox.debugBuffer), 1)).toBe(3);
		sandbox.debugCommand('stepOut');
		expect(Atomics.load(new Int32Array(sandbox.debugBuffer), 1)).toBe(4);
		sandbox.setBreakpoints([5, 3]);
		const control = new Int32Array(sandbox.debugBuffer);
		expect(Atomics.load(control, 3)).toBe(2);
		expect([Atomics.load(control, 4), Atomics.load(control, 5)]).toEqual([3, 5]);
	});

	it('uses canonical Rust DWARF paths while exposing the active editor source alias', async () => {
		const sandbox = new Rust();
		const worker = new MockWorker();
		const events: any[] = [];

		sandbox.worker = worker as unknown as Worker;
		sandbox.ondebug = (event) => events.push(event);
		worker.postMessage.mockImplementationOnce(() => {
			queueMicrotask(() => {
				worker.onmessage?.({
					data: {
						lldbArtifact: {
							bytes: Uint8Array.of(0, 97, 115, 109),
							descriptor: {
								kind: 'dwarf',
								sourceRoot: '/workspace',
								moduleSha256: '1'.repeat(64)
							},
							sources: [
								{
									path: '/workspace/main.rs',
									content: 'fn main() {}',
									contentSha256: '2'.repeat(64)
								}
							]
						}
					}
				} as MessageEvent<any>);
			});
		});

		const run = sandbox.run('fn main() {}', false, true, undefined, [], {
			debugMode: 'lldb',
			activePath: 'src/../solution.rs',
			breakpoints: [7, 2, 2, -1],
			sourceBreakpoints: [
				{ sourcePath: 'solution.rs', lines: [3, 2] },
				{ sourcePath: '/workspace/src/../solution.rs', lines: [4] },
				{ sourcePath: '/workspace/lib.rs', lines: [99] }
			]
		});

		await vi.waitFor(() => expect(lldbSessions).toHaveLength(1));
		const session = lldbSessions[0];
		expect(session.options).toMatchObject({
			sourcePath: '/workspace/main.rs',
			breakpoints: [2, 3, 4, 7],
			sourceBreakpoints: [
				{
					sourcePath: '/workspace/main.rs',
					lines: [2, 3, 4, 7]
				}
			]
		});

		await sandbox.setBreakpoints([8, 6, 8], '/workspace/solution.rs');
		expect(sandbox.setBreakpoints([99], '/workspace/lib.rs')).toBeUndefined();
		expect(session.breakpointCalls).toEqual([
			{
				lines: [6, 8],
				sourcePath: '/workspace/main.rs'
			}
		]);

		session.emit({
			type: 'breakpoints',
			sourcePath: '/workspace/main.rs',
			breakpoints: [{ requestedLine: 2, line: 2, verified: true }]
		});
		session.emit({
			type: 'pause',
			line: 2,
			reason: 'breakpoint',
			sourcePath: '/workspace/main.rs',
			locals: [],
			callStack: [
				{ functionName: 'main', line: 2, sourcePath: '/workspace/main.rs' },
				{ functionName: 'helper', line: 8, sourcePath: '/workspace/main.rs' },
				{ functionName: 'foreign', line: 9, sourcePath: '/workspace/lib.rs' },
				{ functionName: '_start', line: 0 }
			]
		});

		expect(events).toContainEqual({
			type: 'breakpoints',
			sourcePath: '/workspace/solution.rs',
			breakpoints: [{ requestedLine: 2, line: 2, verified: true }]
		});
		expect(events).toContainEqual({
			type: 'pause',
			line: 2,
			reason: 'breakpoint',
			sourcePath: '/workspace/solution.rs',
			locals: [],
			callStack: [
				{
					functionName: 'main',
					line: 2,
					sourcePath: '/workspace/solution.rs'
				},
				{
					functionName: 'helper',
					line: 8,
					sourcePath: '/workspace/solution.rs'
				},
				{ functionName: 'foreign', line: 9, sourcePath: '/workspace/lib.rs' },
				{ functionName: '_start', line: 0 }
			]
		});

		session.finish();
		await expect(run).resolves.toBe(true);
	});
});
