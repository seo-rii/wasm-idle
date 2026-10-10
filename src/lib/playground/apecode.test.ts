import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SandboxExecutionOptions } from './options';
import { flushQueuedStdin, readBufferedStdin } from './stdinBuffer';
import { WASM_APECODE_VERSION, WASM_APECODE_WHEELS } from './wasmApecodeVersion';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const identity = 'state main { return true; }\n';
const workerInstances: MockWorker[] = [];
const sandboxes: Apecode[] = [];
let autoResolveRun = true;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		queueMicrotask(() => {
			if (message.load) this.emit({ load: true });
			else if (autoResolveRun)
				this.emit(message.prepare ? { results: true } : { output: '🦍', results: true });
		});
	});
	terminate = vi.fn();

	constructor() {
		workerInstances.push(this);
	}

	emit(data: Record<string, unknown>) {
		this.onmessage?.({ data } as MessageEvent<any>);
	}
}

vi.mock('$lib/playground/worker/python?worker', () => ({ default: MockWorker }));
import Apecode from './apecode';

function createSandbox() {
	const sandbox = new Apecode();
	sandboxes.push(sandbox);
	return sandbox;
}

describe('APECode sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		autoResolveRun = true;
	});

	afterEach(async () => {
		await Promise.all(sandboxes.splice(0).map((sandbox) => sandbox.dispose()));
		vi.useRealTimers();
	});

	it('pins the committed original interpreter wheel by size and SHA-256', () => {
		expect(WASM_APECODE_VERSION).toBe('0.1.0');
		expect(WASM_APECODE_WHEELS).toHaveLength(1);
		for (const wheel of WASM_APECODE_WHEELS) {
			expect(wheel.fileName).toBe('apecode-0.1.0-py3-none-any.whl');
			const bytes = readFileSync(path.join(repoRoot, 'static/wasm-apecode', wheel.fileName));
			expect({
				bytes: bytes.length,
				sha256: createHash('sha256').update(bytes).digest('hex')
			}).toEqual({ bytes: wheel.bytes, sha256: wheel.sha256 });
		}
	});

	it('resolves extension assets under the app path and recreates only changed wheel URLs', async () => {
		const sandbox = createSandbox();
		await sandbox.load({ rootUrl: 'https://idle.example.test/app' });
		expect(workerInstances[0].postMessage.mock.calls[0][0]).toMatchObject({
			load: true,
			assets: { baseUrl: 'https://idle.example.test/app/pyodide/' },
			extension: {
				language: 'apecode',
				version: WASM_APECODE_VERSION,
				wheels: WASM_APECODE_WHEELS.map((wheel) => ({
					...wheel,
					url: `https://idle.example.test/app/wasm-apecode/${wheel.fileName}`
				}))
			}
		});
		await sandbox.load({ rootUrl: 'https://idle.example.test/app/' });
		expect(workerInstances).toHaveLength(1);
		await sandbox.load({
			rootUrl: 'https://idle.example.test/app/',
			apecode: { baseUrl: 'https://cdn.example.test/interpreters/apecode' }
		});
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
		expect(workerInstances[1].postMessage.mock.calls[0][0].extension.wheels[0].url).toBe(
			`https://cdn.example.test/interpreters/apecode/${WASM_APECODE_WHEELS[0].fileName}`
		);
	});

	it('dispatches finite stdin without mixing old buffered or subsequent terminal input', async () => {
		const sandbox = createSandbox();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/');
		sandbox.write('previous terminal input');
		sandbox.eof();
		flushQueuedStdin(['previous buffered input'], sandbox.buffer);
		autoResolveRun = false;
		const running = sandbox.run(identity, false, true, undefined, [], {
			stdin: '1\n3\n3 1 2\n'
		});
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(workerInstances[0].postMessage.mock.calls[1][0]).toMatchObject({
			code: identity,
			language: 'apecode',
			prepare: false,
			stdin: '1\n3\n3 1 2\n',
			activePath: 'main.ape',
			workspaceFiles: []
		});
		sandbox.write('queued after finite input');
		sandbox.eof();
		workerInstances[0].emit({ output: '3 1 2\n', results: true });
		await expect(running).resolves.toBe(true);
		expect(output).toHaveBeenCalledWith('3 1 2\n');
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');

		autoResolveRun = true;
		await expect(
			sandbox.run(identity, false, true, undefined, [], { stdin: '' })
		).resolves.toBe(true);
		expect(workerInstances[0].postMessage.mock.calls[2][0].stdin).toBe('');
	});

	it('normalizes Unicode active paths and replaces the uploaded active source', async () => {
		const sandbox = createSandbox();
		await sandbox.load('/');
		await expect(
			sandbox.run(identity, false, true, undefined, [], {
				activePath: '프로그램\\🦍.ape',
				workspaceFiles: [
					{ path: '프로그램\\🦍.ape', content: 'outdated source' },
					{ path: 'fixtures\\입력.txt', content: '한글\0🙂\n' }
				]
			})
		).resolves.toBe(true);
		expect(workerInstances[0].postMessage.mock.calls[1][0]).toMatchObject({
			code: identity,
			activePath: '프로그램/🦍.ape',
			workspaceFiles: [{ path: 'fixtures/입력.txt', content: '한글\0🙂\n' }]
		});
	});

	it('rejects escaping paths and UTF-8 source/workspace limits before dispatch', async () => {
		const sandbox = createSandbox();
		await sandbox.load('/');
		const requests: {
			code: string;
			options: SandboxExecutionOptions;
			expected: Record<string, unknown>;
		}[] = [
			{
				code: identity,
				options: { activePath: '../main.ape' },
				expected: { code: 'invalid-path', path: '../main.ape' }
			},
			{
				code: '🦍',
				options: {
					limits: { maxWorkspaceBytes: 3 },
					workspaceLimits: { maxFileBytes: 100 }
				},
				expected: { code: 'file-size-limit', actual: 4, limit: 3 }
			},
			{
				code: '🦍',
				options: {
					limits: { maxWorkspaceBytes: 6 },
					workspaceFiles: [{ path: 'data.txt', content: '가' }],
					workspaceLimits: { maxTotalBytes: 100 }
				},
				expected: { code: 'total-size-limit', actual: 7, limit: 6 }
			},
			{
				code: identity,
				options: {
					workspaceFiles: [{ path: 'data.txt', content: 'A' }],
					workspaceLimits: { maxFiles: 1 }
				},
				expected: { code: 'file-count-limit', actual: 2, limit: 1 }
			}
		];
		for (const { code, options, expected } of requests) {
			await expect(
				sandbox.run(code, false, true, undefined, [], options)
			).rejects.toMatchObject({ name: 'WorkspaceValidationError', ...expected });
			expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(1);
			expect(sandbox.exit).toBe(true);
		}
		await expect(sandbox.run(identity, false)).resolves.toBe(true);
	});

	it('rejects unsupported arguments and debugging while keeping the loaded worker reusable', async () => {
		const sandbox = createSandbox();
		await sandbox.load('/');
		const requests: { args: string[]; options: SandboxExecutionOptions }[] = [
			{ args: ['demo'], options: {} },
			{ args: [], options: { programArgs: ['demo'] } },
			{ args: [], options: { debug: true } },
			{ args: [], options: { debugMode: 'trace' } }
		];
		for (const { args, options } of requests) {
			await expect(
				sandbox.run(identity, false, true, undefined, args, options)
			).rejects.toMatchObject({
				name: 'RuntimeConfigurationError',
				code: 'runtime-configuration',
				runtimeId: 'APECODE'
			});
			expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(1);
		}
		await expect(sandbox.run(identity, false)).resolves.toBe(true);
	});

	it('preserves the active handler, live stdin and cache choice when another run is busy', async () => {
		const sandbox = createSandbox();
		await sandbox.load({ rootUrl: '/', persistentCache: { enabled: true, maxBytes: 4096 } });
		const select = vi.spyOn(sandbox.assetBridge!, 'setExecutionPersistentCache');
		autoResolveRun = false;
		const running = sandbox.run(identity, false, true, undefined, [], {
			persistentCache: false
		});
		const worker = workerInstances[0];
		const activeHandler = worker.onmessage;
		sandbox.write('1\n');
		const readStdin = vi.fn(() => 'must not be read');
		await expect(
			sandbox.run(identity, false, true, undefined, [], {
				get stdin() {
					return readStdin();
				},
				persistentCache: { enabled: true }
			})
		).rejects.toMatchObject({ code: 'busy', phase: 'execute', runtimeId: 'APECODE' });
		expect(readStdin).not.toHaveBeenCalled();
		expect(select).toHaveBeenCalledOnce();
		expect(select.mock.results[0].value).toMatchObject({ enabled: false });
		expect(sandbox.pendingInput).toEqual(['1\n']);
		expect(worker.onmessage).toBe(activeHandler);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);
		expect(worker.terminate).not.toHaveBeenCalled();
		worker.emit({ results: true });
		await expect(running).resolves.toBe(true);
	});

	it('counts cumulative UTF-8 output, rejects stale events and recovers after the limit', async () => {
		const sandbox = createSandbox();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/');
		autoResolveRun = false;
		const running = sandbox.run(identity, false, true, undefined, [], {
			limits: { maxOutputBytes: 6 }
		});
		const worker = workerInstances[0];
		const staleHandler = worker.onmessage;
		worker.emit({ output: '가' });
		worker.emit({ output: '🦍' });
		await expect(running).rejects.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			runtimeId: 'APECODE',
			limit: 6,
			actual: 7
		});
		expect(output).toHaveBeenCalledOnce();
		expect(output).toHaveBeenCalledWith('가');
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.worker).toBeUndefined();
		staleHandler?.({ data: { output: 'stale', results: true } } as MessageEvent<any>);
		expect(output).not.toHaveBeenCalledWith('stale');

		await sandbox.load('/');
		autoResolveRun = true;
		await expect(sandbox.run(identity, false)).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
	});

	it('uses separate prepare/run deadlines and clears the successful recovery timer', async () => {
		for (const prepare of [true, false]) {
			const sandbox = createSandbox();
			await sandbox.load('/');
			const worker = workerInstances.at(-1)!;
			autoResolveRun = false;
			vi.useFakeTimers();
			const timeoutMs = prepare ? 19 : 31;
			const running = sandbox.run(identity, prepare, true, undefined, [], {
				limits: { compileTimeoutMs: 19, runTimeoutMs: 31 }
			});
			const rejected = expect(running).rejects.toMatchObject({
				name: 'TimeoutError',
				code: 'timeout',
				phase: 'execute',
				runtimeId: 'APECODE',
				timeoutMs
			});
			await vi.advanceTimersByTimeAsync(timeoutMs - 1);
			expect(worker.terminate).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			await rejected;
			expect(worker.terminate).toHaveBeenCalledOnce();
			vi.useRealTimers();

			await sandbox.load('/');
			autoResolveRun = true;
			vi.useFakeTimers();
			await expect(
				sandbox.run(identity, prepare, true, undefined, [], {
					limits: { compileTimeoutMs: 19, runTimeoutMs: 31 }
				})
			).resolves.toBe(true);
			const recoveredWorker = workerInstances.at(-1)!;
			await vi.advanceTimersByTimeAsync(100);
			expect(recoveredWorker.terminate).not.toHaveBeenCalled();
			vi.useRealTimers();
		}
	});

	it('clears live input on AbortSignal and Stop and allows fresh input after reload', async () => {
		for (const stop of ['abort', 'kill'] as const) {
			const sandbox = createSandbox();
			const output = vi.fn();
			sandbox.output = output;
			await sandbox.load('/');
			autoResolveRun = false;
			const controller = new AbortController();
			const running = sandbox.run(identity, false, true, undefined, [], {
				signal: controller.signal
			});
			const worker = workerInstances.at(-1)!;
			const staleHandler = worker.onmessage;
			worker.emit({ buffer: true });
			expect(sandbox.waitingForInput).toBe(true);
			sandbox.write('1\n');
			expect(readBufferedStdin(sandbox.buffer)).toBe('1\n');
			sandbox.write('leftover rocks');
			sandbox.eof();
			const reason = new Error('cancel APECode input');
			if (stop === 'abort') controller.abort(reason);
			else sandbox.kill();
			await expect(running).rejects.toBe(stop === 'abort' ? reason : 'Process terminated');
			expect(worker.terminate).toHaveBeenCalledOnce();
			expect(sandbox.pendingInput).toEqual([]);
			expect(sandbox.pendingEof).toBe(false);
			expect(sandbox.waitingForInput).toBe(false);
			expect(readBufferedStdin(sandbox.buffer)).toBe('');
			staleHandler?.({ data: { output: 'stale', results: true } } as MessageEvent<any>);
			expect(output).not.toHaveBeenCalled();

			await sandbox.load('/');
			autoResolveRun = true;
			await expect(
				sandbox.run(identity, false, true, undefined, [], { stdin: '1\n1\n7\n' })
			).resolves.toBe(true);
			expect(workerInstances.at(-1)!.postMessage.mock.calls[1][0].stdin).toBe('1\n1\n7\n');
		}
	});

	it('dispatches prepare as a distinct operation without interpreting source or requesting stdin', async () => {
		const sandbox = createSandbox();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/');
		await expect(sandbox.run('invalid APECode source', true)).resolves.toBe(true);
		expect(workerInstances[0].postMessage.mock.calls[1][0]).toMatchObject({
			code: 'invalid APECode source',
			prepare: true,
			language: 'apecode',
			activePath: 'main.ape'
		});
		expect(output).not.toHaveBeenCalled();
		expect(sandbox.waitingForInput).toBe(false);
		await expect(sandbox.run(identity, false)).resolves.toBe(true);
	});
});
