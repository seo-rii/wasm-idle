import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { lldbSessions, publicEnv } = vi.hoisted(() => ({
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
				compilerUrl: expect.stringMatching(/\/wasm-rust\/index\.js$/),
				debugModuleUrl: expect.stringMatching(/\/wasm-rust\/debug-instrumenter\.js$/),
				path: '/absproxy/5173'
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

	it('rejects load when no rust compiler url is configured', async () => {
		publicEnv.PUBLIC_WASM_RUST_COMPILER_URL = '';
		const sandbox = new Rust();

		await expect(sandbox.load('/absproxy/5173')).rejects.toContain(
			'Rust runtime is not configured'
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

	it('writes queued terminal input when the worker requests stdin', async () => {
		const sandbox = new Rust();
		const worker = new MockWorker();
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
				false
			)
		).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
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
