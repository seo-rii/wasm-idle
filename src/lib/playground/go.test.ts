import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readBufferedStdin } from './stdinBuffer';

const workerInstances: MockWorker[] = [];
const { publicEnv } = vi.hoisted(() => ({
	publicEnv: {
		PUBLIC_WASM_GO_COMPILER_URL: ''
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
						progress: {
							stage: 'compile',
							percent: 18
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({
					data: {
						progress: {
							stage: 'compile',
							percent: 63
						}
					}
				} as MessageEvent<any>);
				this.onmessage?.({
					data: {
						diagnostic: {
							fileName: 'main.go',
							lineNumber: 1,
							columnNumber: 1,
							severity: 'warning',
							message: 'demo warning'
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

vi.mock('$lib/playground/worker/go?worker', () => ({
	default: MockWorker
}));

vi.mock('$env/dynamic/public', () => ({
	env: publicEnv
}));

import Go from './go';

describe('Go sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		publicEnv.PUBLIC_WASM_GO_COMPILER_URL = '/wasm-go/index.js';
		suppressAutoLoadAck = false;
	});

	it('loads the go worker and forwards diagnostics plus run output', async () => {
		const sandbox = new Go();
		const outputs: string[] = [];
		const diagnostics: any[] = [];
		const values: number[] = [];
		const code = `package main

import "fmt"

func main() {
	fmt.Println("hi")
}`;

		sandbox.output = (chunk: string) => outputs.push(chunk);
		sandbox.oncompilerdiagnostic = (diagnostic) => diagnostics.push(diagnostic);

		await sandbox.load('/absproxy/5173');
		await expect(
			sandbox.run(code, true, true, {
				set(value: number) {
					values.push(value);
				}
			})
		).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, ['one', 'two'], {
				goTarget: 'wasip2/wasm'
			})
		).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, ['three'], {
				goTarget: 'wasip3/wasm'
			})
		).resolves.toBe(true);
		await expect(
			sandbox.run(code, false, true, undefined, ['browser'], {
				goTarget: 'js/wasm'
			})
		).resolves.toBe(true);

		expect(workerInstances).toHaveLength(1);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				compilerUrl: expect.stringMatching(/\/wasm-go\/index\.js$/)
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				prepare: true,
				code,
				args: [],
				target: 'wasip1/wasm',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			3,
			expect.objectContaining({
				prepare: false,
				code,
				args: ['one', 'two'],
				target: 'wasip2/wasm',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			4,
			expect.objectContaining({
				prepare: false,
				code,
				args: ['three'],
				target: 'wasip3/wasm',
				log: true
			})
		);
		expect(workerInstances[0].postMessage).toHaveBeenNthCalledWith(
			5,
			expect.objectContaining({
				prepare: false,
				code,
				args: ['browser'],
				target: 'js/wasm',
				log: true
			})
		);
		expect(outputs).toContain('hi\n');
		expect(diagnostics).toEqual([
			{
				fileName: 'main.go',
				lineNumber: 1,
				columnNumber: 1,
				severity: 'warning',
				message: 'demo warning'
			}
		]);
		expect(values).toEqual([0.18, 0.63]);
	});

	it('resolves and forwards the configured manifest plus caller execution limits', async () => {
		const sandbox = new Go();
		sandbox.output = vi.fn();
		await sandbox.load(
			{
				go: {
					compilerUrl: './custom/go/index.js?version=7',
					manifestUrl: './custom/go/runtime/manifest.json?version=8'
				}
			},
			'',
			true,
			[],
			{
				limits: {
					maxAssetBytes: 4_096,
					maxWasmMemoryBytes: 8 * 65_536,
					compileTimeoutMs: 321,
					runTimeoutMs: 123
				}
			}
		);

		const worker = workerInstances[0]!;
		expect(worker.postMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				load: true,
				compilerUrl: expect.stringContaining('/custom/go/index.js?version=7'),
				manifestUrl: expect.stringContaining('/custom/go/runtime/manifest.json?version=8'),
				runtimeLimits: expect.objectContaining({
					maxAssetBytes: 4_096,
					maxWasmMemoryBytes: 8 * 65_536,
					compileTimeoutMs: 321,
					runTimeoutMs: 123
				})
			})
		);

		await sandbox.run('package main\nfunc main() {}', false, true, undefined, [], {
			limits: {
				maxAssetBytes: 2_048,
				maxWasmMemoryBytes: 4 * 65_536
			}
		});
		expect(worker.postMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				runtimeLimits: expect.objectContaining({
					maxAssetBytes: 2_048,
					maxWasmMemoryBytes: 4 * 65_536
				})
			})
		);
	});

	it('recreates the compiler worker when compiler asset limits change', async () => {
		const sandbox = new Go();

		await sandbox.load('/absproxy/5173', '', true, [], {
			limits: { maxAssetBytes: 8_192 }
		});
		const firstWorker = workerInstances[0]!;

		await sandbox.load('/absproxy/5173', '', true, [], {
			limits: { maxAssetBytes: 4_096 }
		});

		expect(workerInstances).toHaveLength(2);
		expect(firstWorker.terminate).toHaveBeenCalledOnce();
		expect(workerInstances[1]?.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				load: true,
				runtimeLimits: expect.objectContaining({ maxAssetBytes: 4_096 })
			})
		);
	});

	it('derives the bundled manifest URL from the compiler URL and preserves its version', async () => {
		const sandbox = new Go();

		await sandbox.load({ go: { compilerUrl: '/wasm-go/index.js?v=bundled' } });

		expect(workerInstances[0]?.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				manifestUrl: expect.stringMatching(
					/\/wasm-go\/runtime\/runtime-manifest\.v1\.json\?v=bundled$/
				)
			})
		);
	});

	it('rejects load when no go compiler url is configured', async () => {
		publicEnv.PUBLIC_WASM_GO_COMPILER_URL = '';
		const sandbox = new Go();

		await expect(sandbox.load('/absproxy/5173')).rejects.toContain(
			'Go runtime is not configured'
		);
	});

	it('rejects load when the go worker script fails before posting load', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Go();
		const loadPromise = sandbox.load('/absproxy/5173');
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];

		worker.onerror?.({
			message: 'worker script error',
			filename: '/worker/go.js',
			lineno: 88,
			colno: 24
		} as ErrorEvent);

		await expect(loadPromise).rejects.toContain(
			'Go worker script error: worker script error (/worker/go.js:88:24)'
		);
	});

	it('rejects a pre-aborted non-debug load without changing runtime state', async () => {
		const sandbox = new Go();
		const reason = new Error('cancel before Go startup');
		const controller = new AbortController();
		controller.abort(reason);
		sandbox.pendingInput = ['queued input\n'];

		await expect(
			sandbox.load('/absproxy/5173', '', true, [], { signal: controller.signal })
		).rejects.toBe(reason);

		expect(workerInstances).toHaveLength(0);
		expect(sandbox.pendingInput).toEqual(['queued input\n']);
		expect(sandbox.compilerUrl).toBe('');
		expect(sandbox.exit).toBe(true);
	});

	it('aborts the active non-debug load and ignores its stale worker messages', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Go();
		const reason = new Error('cancel active Go startup');
		const controller = new AbortController();
		const progress = { set: vi.fn() };
		const loading = sandbox.load(
			'/absproxy/5173',
			'',
			true,
			[],
			{ signal: controller.signal },
			progress
		);
		await vi.dynamicImportSettled();
		const firstWorker = workerInstances[0];
		const staleHandler = firstWorker.onmessage;

		controller.abort(reason);

		await expect(loading).rejects.toBe(reason);
		expect(firstWorker.terminate).toHaveBeenCalledOnce();
		expect(firstWorker.onmessage).toBeNull();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.exit).toBe(true);
		staleHandler?.({ data: { load: true } } as MessageEvent<any>);
		expect(progress.set).not.toHaveBeenCalled();

		suppressAutoLoadAck = false;
		await expect(sandbox.load('/absproxy/5173')).resolves.toBeUndefined();
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[1].terminate).not.toHaveBeenCalled();
	});

	it('removes the load abort handler after successful settlement', async () => {
		const sandbox = new Go();
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');

		await sandbox.load('/absproxy/5173', '', true, [], { signal: controller.signal });
		const worker = workerInstances[0];
		controller.abort(new Error('late Go startup cancellation'));

		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.worker).toBe(worker);
	});

	it('rejects a pre-aborted non-debug run before dispatch or state changes', async () => {
		const sandbox = new Go();
		const worker = new MockWorker();
		const reason = new Error('cancel before Go execution');
		const controller = new AbortController();
		controller.abort(reason);
		sandbox.worker = worker as unknown as Worker;

		await expect(
			sandbox.run('package main\nfunc main() {}', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBe(reason);

		expect(worker.postMessage).not.toHaveBeenCalled();
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(worker.onmessage).toBeNull();
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);
	});

	it('aborts only the active non-debug run and permits a clean retry', async () => {
		const sandbox = new Go();
		const worker = new MockWorker();
		const reason = new Error('cancel active Go execution');
		const controller = new AbortController();
		const output = vi.fn();
		let runMessage: any;
		sandbox.output = output;
		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce((message) => {
			runMessage = message;
		});
		const running = sandbox.run('package main\nfunc main() {}', false, true, undefined, [], {
			signal: controller.signal,
			stdin: 'explicit input\n'
		});
		const staleHandler = worker.onmessage;

		controller.abort(reason);

		await expect(running).rejects.toBe(reason);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBeNull();
		expect(sandbox.worker).toBeUndefined();
		expect(sandbox.pendingInput).toEqual([]);
		expect(readBufferedStdin(runMessage.buffer)).toBe('');
		expect(sandbox.exit).toBe(true);
		staleHandler?.({
			data: { output: 'stale output\n', results: true }
		} as MessageEvent<any>);
		expect(output).not.toHaveBeenCalled();

		const retryWorker = new MockWorker();
		sandbox.worker = retryWorker as unknown as Worker;
		await expect(sandbox.run('package main\nfunc main() {}', false)).resolves.toBe(true);
		expect(retryWorker.terminate).not.toHaveBeenCalled();
	});

	it('terminates an overlapping raw run before another handler can own stale output', async () => {
		const sandbox = new Go();
		const worker = new MockWorker();
		const output = vi.fn();
		sandbox.output = output;
		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce(() => undefined);

		const firstRun = sandbox.run('package main\nfunc main() {}', false);
		const staleHandler = worker.onmessage;
		const secondRun = sandbox.run('package main\nfunc main() {}', false);

		await expect(firstRun).rejects.toMatchObject({ name: 'BusyError', code: 'busy' });
		await expect(secondRun).rejects.toMatchObject({ name: 'BusyError', code: 'busy' });
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(worker.onmessage).toBeNull();
		staleHandler?.({ data: { output: 'stale\n', results: true } } as MessageEvent<any>);
		expect(output).not.toHaveBeenCalled();

		const retryWorker = new MockWorker();
		sandbox.worker = retryWorker as unknown as Worker;
		await expect(sandbox.run('package main\nfunc main() {}', false)).resolves.toBe(true);
	});

	it('physically terminates the worker when the compile phase deadline expires', async () => {
		vi.useFakeTimers();
		try {
			const sandbox = new Go();
			const worker = new MockWorker();
			sandbox.worker = worker as unknown as Worker;
			worker.postMessage.mockImplementationOnce(() => undefined);
			const running = sandbox.run(
				'package main\nfunc main() {}',
				false,
				true,
				undefined,
				[],
				{
					limits: { compileTimeoutMs: 5 }
				}
			);
			const outcome = running.catch((error) => error);

			await vi.advanceTimersByTimeAsync(5);

			await expect(outcome).resolves.toMatchObject({
				name: 'TimeoutError',
				phase: 'compile',
				timeoutMs: 5
			});
			expect(worker.terminate).toHaveBeenCalledOnce();
			expect(sandbox.worker).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not let a superseded load signal cancel the replacement run', async () => {
		suppressAutoLoadAck = true;
		const sandbox = new Go();
		const loadController = new AbortController();
		const staleLoadReason = new Error('stale Go startup cancellation');
		const loading = sandbox.load('/absproxy/5173', '', true, [], {
			signal: loadController.signal
		});
		const loadOutcome = loading.catch((reason) => reason);
		await vi.dynamicImportSettled();
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce(() => undefined);

		const running = sandbox.run('package main\nfunc main() {}', false);
		loadController.abort(staleLoadReason);

		expect(worker.terminate).not.toHaveBeenCalled();
		worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(running).resolves.toBe(true);
		await expect(loadOutcome).resolves.toBe('Worker operation superseded');
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.worker).toBe(worker);
	});

	it('removes the run abort handler after successful settlement', async () => {
		const sandbox = new Go();
		const worker = new MockWorker();
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		sandbox.output = vi.fn();
		sandbox.worker = worker as unknown as Worker;

		await expect(
			sandbox.run('package main\nfunc main() {}', false, true, undefined, [], {
				signal: controller.signal
			})
		).resolves.toBe(true);
		controller.abort(new Error('late Go execution cancellation'));

		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(worker.terminate).not.toHaveBeenCalled();
		expect(sandbox.worker).toBe(worker);
		expect(sandbox.exit).toBe(true);
	});

	it('writes queued terminal input when the worker requests stdin', async () => {
		const sandbox = new Go();
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
				`package main

func main() {}`,
				false
			)
		).resolves.toBe(true);

		expect(readBufferedStdin(runMessage.buffer)).toBe('42\n');
	});

	it('isolates explicit stdin from queued input before, during, and after execution', async () => {
		const sandbox = new Go();
		const worker = new MockWorker();
		let explicitRunMessage: any;
		let bufferedDuringExplicitRun: string | null | undefined;

		sandbox.worker = worker as unknown as Worker;
		sandbox.write('stale before explicit run\n');
		worker.postMessage.mockImplementationOnce((message) => {
			explicitRunMessage = message;
			sandbox.write('stale during explicit run\n');
			queueMicrotask(() => {
				worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
				bufferedDuringExplicitRun = readBufferedStdin(message.buffer);
				worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
		});

		await expect(
			sandbox.run('package main\nfunc main() {}', false, true, undefined, [], {
				stdin: 'explicit input\n'
			})
		).resolves.toBe(true);

		expect(explicitRunMessage.stdin).toBe('explicit input\n');
		expect(bufferedDuringExplicitRun).toBe('');
		expect(sandbox.pendingInput).toEqual([]);
		expect(readBufferedStdin(explicitRunMessage.buffer)).toBe('');

		let bufferedRunMessage: any;
		worker.postMessage.mockImplementationOnce((message) => {
			bufferedRunMessage = message;
		});
		const bufferedRun = sandbox.run('package main\nfunc main() {}', false);
		worker.onmessage?.({ data: { buffer: true } } as MessageEvent<any>);
		expect(readBufferedStdin(bufferedRunMessage.buffer)).toBe('');

		sandbox.write('fresh input\n');
		expect(readBufferedStdin(bufferedRunMessage.buffer)).toBe('fresh input\n');
		worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
		await expect(bufferedRun).resolves.toBe(true);
	});

	it('clears explicit stdin state after a worker error', async () => {
		const sandbox = new Go();
		const worker = new MockWorker();
		let runMessage: any;

		sandbox.worker = worker as unknown as Worker;
		sandbox.write('stale before failed run\n');
		worker.postMessage.mockImplementationOnce((message) => {
			runMessage = message;
			sandbox.write('stale during failed run\n');
			queueMicrotask(() => {
				worker.onmessage?.({ data: { error: 'Go execution failed' } } as MessageEvent<any>);
			});
		});

		await expect(
			sandbox.run('package main\nfunc main() {}', false, true, undefined, [], {
				stdin: 'explicit input\n'
			})
		).rejects.toBe('Go execution failed');

		expect(sandbox.pendingInput).toEqual([]);
		expect(readBufferedStdin(runMessage.buffer)).toBe('');
	});

	it('clears explicit stdin state after synchronous dispatch failure', async () => {
		const sandbox = new Go();
		const worker = new MockWorker();
		const dispatchError = new Error('Go dispatch failed');
		const controller = new AbortController();
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');

		sandbox.output = vi.fn();
		sandbox.worker = worker as unknown as Worker;
		sandbox.write('stale before dispatch\n');
		worker.postMessage.mockImplementationOnce(() => {
			throw dispatchError;
		});

		await expect(
			sandbox.run('package main\nfunc main() {}', false, true, undefined, [], {
				stdin: '',
				signal: controller.signal
			})
		).rejects.toBe(dispatchError);

		expect(sandbox.pendingInput).toEqual([]);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		expect(worker.onmessage).toBeNull();
		expect(sandbox.exit).toBe(true);
		expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
		controller.abort(new Error('late cancellation after dispatch failure'));
		expect(worker.terminate).not.toHaveBeenCalled();
		await expect(sandbox.run('package main\nfunc main() {}', false)).resolves.toBe(true);
	});

	it('clears explicit stdin state when execution is terminated', async () => {
		const sandbox = new Go();
		const worker = new MockWorker();
		let runMessage: any;

		sandbox.worker = worker as unknown as Worker;
		worker.postMessage.mockImplementationOnce((message) => {
			runMessage = message;
		});
		const running = sandbox.run('package main\nfunc main() {}', false, true, undefined, [], {
			stdin: 'explicit input\n'
		});
		sandbox.write('stale during terminated run\n');

		sandbox.kill();

		await expect(running).rejects.toBe('Process terminated');
		expect(sandbox.pendingInput).toEqual([]);
		expect(readBufferedStdin(runMessage.buffer)).toBe('');
	});

	it('passes debug buffers, breakpoints, and debug events through the worker host', async () => {
		const sandbox = new Go();
		const events: any[] = [];
		let runMessage: any;

		sandbox.ondebug = (event) => events.push(event);
		await sandbox.load('/absproxy/5173');
		const worker = workerInstances[0];
		worker.postMessage.mockImplementationOnce((message) => {
			runMessage = message;
			queueMicrotask(() => {
				worker.onmessage?.({
					data: {
						debugEvent: {
							type: 'pause',
							line: 5,
							reason: 'entry',
							locals: [],
							callStack: [{ functionName: 'main', line: 5 }]
						}
					}
				} as MessageEvent<any>);
				sandbox.debugCommand?.('nextLine');
				worker.onmessage?.({ data: { results: true } } as MessageEvent<any>);
			});
		});

		await expect(
			sandbox.run(
				`package main

func main() {
	println("hi")
}`,
				false,
				true,
				undefined,
				[],
				{
					debug: true,
					breakpoints: [8, 5, 5],
					pauseOnEntry: true,
					goTarget: 'wasip2/wasm'
				}
			)
		).resolves.toBe(true);

		expect(runMessage).toEqual(
			expect.objectContaining({
				debug: true,
				breakpoints: [8, 5, 5],
				pauseOnEntry: true,
				target: 'wasip2/wasm'
			})
		);
		expect(runMessage.debugBuffer).toBeDefined();
		const control = new Int32Array(runMessage.debugBuffer);
		expect(Array.from(control.slice(3, 6))).toEqual([2, 5, 8]);
		expect(Atomics.load(control, 1)).toBe(3);
		expect(events).toEqual([
			{
				type: 'pause',
				line: 5,
				reason: 'entry',
				locals: [],
				callStack: [{ functionName: 'main', line: 5 }]
			},
			{ type: 'resume', command: 'nextLine' },
			{ type: 'stop' }
		]);
	});
});
