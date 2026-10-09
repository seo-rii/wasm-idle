import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SandboxExecutionOptions } from './options';
import { flushQueuedStdin, readBufferedStdin } from './stdinBuffer';
import { WASM_AHEUI_VERSION, WASM_AHEUI_WHEELS } from './wasmAheuiVersion';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const workerInstances: MockWorker[] = [];
const sandboxes: Aheui[] = [];
let autoResolveRun = true;

class MockWorker {
	onmessage: ((event: MessageEvent<any>) => void) | null = null;
	onerror: ((event: ErrorEvent) => void) | null = null;
	onmessageerror: ((event: MessageEvent<any>) => void) | null = null;
	postMessage = vi.fn((message: any) => {
		queueMicrotask(() => {
			if (message.load) this.emit({ load: true });
			else if (autoResolveRun) this.emit({ output: '가', results: true });
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
import Aheui from './aheui';

function createSandbox() {
	const sandbox = new Aheui();
	sandboxes.push(sandbox);
	return sandbox;
}

describe('Aheui sandbox', () => {
	beforeEach(() => {
		workerInstances.length = 0;
		autoResolveRun = true;
	});

	afterEach(async () => {
		await Promise.all(sandboxes.splice(0).map((sandbox) => sandbox.dispose()));
		vi.useRealTimers();
	});

	it('pins the committed pure Python interpreter wheels by size and SHA-256', () => {
		expect(WASM_AHEUI_VERSION).toBe('1.2.5');
		expect(WASM_AHEUI_WHEELS).toHaveLength(1);
		for (const wheel of WASM_AHEUI_WHEELS) {
			expect(wheel.fileName).toMatch(/^aheui-1\.2\.5-py3-none-any\.whl$/u);
			const bytes = readFileSync(path.join(repoRoot, 'static/wasm-aheui', wheel.fileName));
			expect({
				bytes: bytes.length,
				sha256: createHash('sha256').update(bytes).digest('hex')
			}).toEqual({ bytes: wheel.bytes, sha256: wheel.sha256 });
		}
	});

	it('loads verified Aheui assets and dispatches Unicode stdin with the default source path', async () => {
		const sandbox = createSandbox();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load({ rootUrl: 'https://idle.example.test/app' });
		expect(workerInstances[0].postMessage.mock.calls[0][0]).toMatchObject({
			load: true,
			assets: { baseUrl: 'https://idle.example.test/app/pyodide/' },
			extension: {
				language: 'aheui',
				version: WASM_AHEUI_VERSION,
				wheels: WASM_AHEUI_WHEELS.map((wheel) => ({
					...wheel,
					url: `https://idle.example.test/app/wasm-aheui/${wheel.fileName}`
				}))
			}
		});

		const running = sandbox.run('밯맣희', false, true, undefined, [], { stdin: '가🙂\n' });
		sandbox.write('input queued after dispatch');
		sandbox.eof();
		await expect(running).resolves.toBe(true);
		expect(workerInstances[0].postMessage.mock.calls[1][0]).toMatchObject({
			code: '밯맣희',
			language: 'aheui',
			prepare: false,
			stdin: '가🙂\n',
			activePath: 'main.aheui',
			workspaceFiles: []
		});
		expect(output).toHaveBeenCalledWith('가');
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
	});

	it('reuses matching wheel URLs and recreates the worker when the Aheui base URL changes', async () => {
		const sandbox = createSandbox();
		const firstConfig = { rootUrl: '/', aheui: { baseUrl: 'https://cdn.example.test/aheui' } };
		await sandbox.load(firstConfig);
		expect(workerInstances[0].postMessage.mock.calls[0][0].extension.wheels[0].url).toBe(
			`https://cdn.example.test/aheui/${WASM_AHEUI_WHEELS[0].fileName}`
		);
		await sandbox.load(firstConfig);
		expect(workerInstances).toHaveLength(1);

		await sandbox.load({
			rootUrl: '/',
			aheui: { baseUrl: 'https://mirror.example.test/aheui/' }
		});
		expect(workerInstances).toHaveLength(2);
		expect(workerInstances[0].terminate).toHaveBeenCalledOnce();
		expect(workerInstances[1].postMessage.mock.calls[0][0].extension.wheels[0].url).toBe(
			`https://mirror.example.test/aheui/${WASM_AHEUI_WHEELS[0].fileName}`
		);
	});

	it('normalizes workspace paths and replaces the uploaded active file with the current source', async () => {
		const sandbox = createSandbox();
		await sandbox.load('/');
		await expect(
			sandbox.run('밯맣희', false, true, undefined, [], {
				activePath: 'nested\\main.aheui',
				workspaceFiles: [
					{ path: 'nested\\main.aheui', content: 'outdated source' },
					{ path: 'fixtures\\input.txt', content: '가\n' }
				]
			})
		).resolves.toBe(true);
		expect(workerInstances[0].postMessage.mock.calls[1][0]).toMatchObject({
			code: '밯맣희',
			activePath: 'nested/main.aheui',
			workspaceFiles: [{ path: 'fixtures/input.txt', content: '가\n' }]
		});
	});

	it('rejects invalid paths and UTF-8 workspace limits before dispatch and remains reusable', async () => {
		const sandbox = createSandbox();
		await sandbox.load('/');
		const cases: {
			code: string;
			options: SandboxExecutionOptions;
			expected: Record<string, unknown>;
		}[] = [
			{
				code: '희',
				options: { activePath: '../main.aheui' },
				expected: { code: 'invalid-path', path: '../main.aheui' }
			},
			{
				code: '희',
				options: {
					workspaceFiles: [
						{ path: 'data.txt', content: 'A' },
						{ path: 'data.txt', content: 'B' }
					]
				},
				expected: { code: 'duplicate-path', path: 'data.txt' }
			},
			{
				code: '희',
				options: {
					workspaceFiles: [{ path: 'data.txt', content: 'A' }],
					workspaceLimits: { maxFiles: 1 }
				},
				expected: { code: 'file-count-limit', actual: 2, limit: 1 }
			},
			{
				code: '희',
				options: {
					limits: { maxWorkspaceBytes: 2 },
					workspaceLimits: { maxFileBytes: 100 }
				},
				expected: { code: 'file-size-limit', actual: 3, limit: 2 }
			},
			{
				code: '희',
				options: {
					limits: { maxWorkspaceBytes: 4 },
					workspaceFiles: [{ path: 'data.txt', content: '가' }],
					workspaceLimits: { maxTotalBytes: 100 }
				},
				expected: { code: 'total-size-limit', actual: 6, limit: 4 }
			}
		];
		for (const { code, options, expected } of cases) {
			await expect(
				sandbox.run(code, false, true, undefined, [], options)
			).rejects.toMatchObject({
				name: 'WorkspaceValidationError',
				...expected
			});
			expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(1);
			expect(sandbox.exit).toBe(true);
		}
		await expect(sandbox.run('희', false)).resolves.toBe(true);
	});

	it('rejects unsupported arguments and debugging before worker dispatch', async () => {
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
				sandbox.run('희', false, true, undefined, args, options)
			).rejects.toMatchObject({
				name: 'RuntimeConfigurationError',
				code: 'runtime-configuration',
				runtimeId: 'AHEUI'
			});
			expect(workerInstances[0].postMessage).toHaveBeenCalledTimes(1);
		}
		await expect(sandbox.run('희', false)).resolves.toBe(true);
	});

	it('preserves the active handler, queued stdin and cache selection when a busy run is rejected', async () => {
		const sandbox = createSandbox();
		await sandbox.load({ rootUrl: '/', persistentCache: { enabled: true, maxBytes: 4096 } });
		const select = vi.spyOn(sandbox.assetBridge!, 'setExecutionPersistentCache');
		autoResolveRun = false;
		const running = sandbox.run('밯맣희', false, true, undefined, [], {
			persistentCache: false
		});
		const worker = workerInstances[0];
		const firstHandler = worker.onmessage;
		sandbox.write('live input');
		const readStdin = vi.fn(() => 'must not be read');
		await expect(
			sandbox.run('희', false, true, undefined, [], {
				get stdin() {
					return readStdin();
				},
				persistentCache: { enabled: true }
			})
		).rejects.toMatchObject({ code: 'busy', phase: 'execute', runtimeId: 'AHEUI' });
		expect(readStdin).not.toHaveBeenCalled();
		expect(select).toHaveBeenCalledOnce();
		expect(select.mock.results[0].value).toMatchObject({ enabled: false });
		expect(sandbox.pendingInput).toEqual(['live input']);
		expect(worker.onmessage).toBe(firstHandler);
		expect(worker.postMessage).toHaveBeenCalledTimes(2);
		expect(worker.terminate).not.toHaveBeenCalled();
		worker.emit({ results: true });
		await expect(running).resolves.toBe(true);
	});

	it('limits cumulative UTF-8 output, ignores stale messages and recovers with a fresh worker', async () => {
		const sandbox = createSandbox();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/');
		autoResolveRun = false;
		const running = sandbox.run('밯맣희', false, true, undefined, [], {
			limits: { maxOutputBytes: 5 }
		});
		const worker = workerInstances[0];
		const staleHandler = worker.onmessage;
		worker.emit({ output: '가' });
		worker.emit({ output: '🙂' });
		await expect(running).rejects.toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			runtimeId: 'AHEUI',
			limit: 5,
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
		await expect(
			sandbox.run('밯맣희', false, true, undefined, [], { stdin: '가' })
		).resolves.toBe(true);
		expect(workerInstances).toHaveLength(2);
	});

	it('uses the run and prepare deadlines and clears successful-run timers', async () => {
		for (const prepare of [false, true]) {
			const sandbox = createSandbox();
			await sandbox.load('/');
			const worker = workerInstances.at(-1)!;
			autoResolveRun = false;
			vi.useFakeTimers();
			const timeoutMs = prepare ? 23 : 37;
			const running = sandbox.run('희', prepare, true, undefined, [], {
				limits: { compileTimeoutMs: 23, runTimeoutMs: 37 }
			});
			const rejection = expect(running).rejects.toMatchObject({
				name: 'TimeoutError',
				code: 'timeout',
				phase: 'execute',
				runtimeId: 'AHEUI',
				timeoutMs
			});
			await vi.advanceTimersByTimeAsync(timeoutMs - 1);
			expect(worker.terminate).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			await rejection;
			expect(worker.terminate).toHaveBeenCalledOnce();
			vi.useRealTimers();

			await sandbox.load('/');
			autoResolveRun = true;
			vi.useFakeTimers();
			await expect(
				sandbox.run('희', prepare, true, undefined, [], {
					limits: { compileTimeoutMs: 23, runTimeoutMs: 37 }
				})
			).resolves.toBe(true);
			const recoveredWorker = workerInstances.at(-1)!;
			await vi.advanceTimersByTimeAsync(100);
			expect(recoveredWorker.terminate).not.toHaveBeenCalled();
			vi.useRealTimers();
		}
	});

	it('clears old buffered stdin at run start and cancellation before allowing fresh input', async () => {
		const sandbox = createSandbox();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/');
		sandbox.write('old queued input');
		sandbox.eof();
		flushQueuedStdin(['old buffered input'], sandbox.buffer);
		autoResolveRun = false;
		const controller = new AbortController();
		const running = sandbox.run('밯맣희', false, true, undefined, [], {
			signal: controller.signal
		});
		const worker = workerInstances[0];
		const staleHandler = worker.onmessage;
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');

		worker.emit({ buffer: true });
		expect(sandbox.waitingForInput).toBe(true);
		sandbox.write('가');
		expect(readBufferedStdin(sandbox.buffer)).toBe('가');
		expect(sandbox.waitingForInput).toBe(false);
		sandbox.write('leftover input');
		sandbox.eof();
		const reason = new Error('cancel Aheui input');
		controller.abort(reason);
		await expect(running).rejects.toBe(reason);
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);
		expect(readBufferedStdin(sandbox.buffer)).toBe('');
		staleHandler?.({ data: { output: 'stale', results: true } } as MessageEvent<any>);
		expect(output).not.toHaveBeenCalled();

		await sandbox.load('/');
		autoResolveRun = true;
		await expect(
			sandbox.run('밯맣희', false, true, undefined, [], { stdin: '가' })
		).resolves.toBe(true);
		expect(workerInstances[1].postMessage.mock.calls[1][0]).toMatchObject({ stdin: '가' });
	});
});
