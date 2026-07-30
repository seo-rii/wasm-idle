import { beforeEach, describe, expect, it, vi } from 'vitest';

const { commandRun, fromFile, importRuntimeModule, init, packageFree } = vi.hoisted(() => ({
	commandRun: vi.fn(),
	fromFile: vi.fn(),
	importRuntimeModule: vi.fn(),
	init: vi.fn(async () => {}),
	packageFree: vi.fn()
}));

vi.mock('$lib/playground/runtimeModule', () => ({ importRuntimeModule }));

import Bash from './bash';

function byteStream(text: string) {
	return new ReadableStream({
		start(controller) {
			if (text) controller.enqueue(new TextEncoder().encode(text));
			controller.close();
		}
	});
}

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

describe('Bash sandbox', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		importRuntimeModule.mockResolvedValue({ init, Wasmer: { fromFile } });
		fromFile.mockResolvedValue({ entrypoint: { run: commandRun }, free: packageFree });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(new Uint8Array([0, 97, 115, 109])))
		);
	});

	it('runs real Bash source with a script name, program args, stdin, and streamed output', async () => {
		const free = vi.fn();
		commandRun.mockResolvedValue({
			stdin: undefined,
			stdout: byteStream('main=73 arg=demo\n'),
			stderr: byteStream(''),
			wait: vi.fn(async () => ({ ok: true, code: 0 })),
			free
		});
		const sandbox = new Bash();
		const output: string[] = [];
		sandbox.output = (chunk) => output.push(chunk);

		await sandbox.load('/assets', '', true, [], {}, { set: vi.fn() });
		await expect(
			sandbox.run(
				'read number; printf "main=%s arg=%s\\n" "$((number + 5))" "$1"',
				false,
				true,
				undefined,
				['demo'],
				{ activePath: 'script.sh', stdin: '68\n' }
			)
		).resolves.toBe(true);

		expect(fetch).toHaveBeenCalledWith('http://localhost:3000/assets/wasm-bash/bash.webc', {
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer'
		});
		expect(init).toHaveBeenCalledWith({
			sdkUrl: 'http://localhost:3000/assets/wasm-bash/sdk/index.mjs',
			workerUrl: 'http://localhost:3000/assets/wasm-bash/sdk/worker.mjs'
		});
		expect(importRuntimeModule).toHaveBeenCalledWith(
			'http://localhost:3000/assets/wasm-bash/sdk/index.mjs'
		);
		expect(fromFile).toHaveBeenCalledWith(expect.any(Uint8Array));
		expect(commandRun).toHaveBeenCalledWith({
			args: [
				'-c',
				'read number; printf "main=%s arg=%s\\n" "$((number + 5))" "$1"',
				'script.sh',
				'demo'
			],
			mount: {
				'/workspace': {
					'script.sh': 'read number; printf "main=%s arg=%s\\n" "$((number + 5))" "$1"'
				}
			},
			cwd: '/workspace',
			stdin: '68\n'
		});
		expect(output.join('')).toBe('main=73 arg=demo\n');
		expect(free).not.toHaveBeenCalled();
		expect(sandbox.stdinWriter).toBeNull();
	});

	it('propagates caller cancellation and enforces byte limits while loading WEBc', async () => {
		const controller = new AbortController();
		vi.mocked(fetch).mockResolvedValueOnce(
			new Response(new Uint8Array(5), {
				headers: { 'content-length': '5' }
			})
		);
		const sandbox = new Bash();

		await expect(
			sandbox.load('/assets', '', true, [], {
				limits: { maxAssetBytes: 4 },
				signal: controller.signal
			})
		).rejects.toThrow('Bash WEBc package exceeds the 4 byte limit');

		expect(fetch).toHaveBeenCalledWith('http://localhost:3000/assets/wasm-bash/bash.webc', {
			credentials: 'omit',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
			signal: controller.signal
		});
		expect(fromFile).not.toHaveBeenCalled();
	});

	it('rejects a pre-aborted execution without consuming queued stdin or starting Bash', async () => {
		const sandbox = new Bash();
		await sandbox.load();
		sandbox.write('queued\n');
		sandbox.eof();
		const controller = new AbortController();
		const reason = new Error('do not start Bash');
		controller.abort(reason);

		await expect(
			sandbox.run('read value', false, true, undefined, [], {
				stdin: 'replacement\n',
				signal: controller.signal
			})
		).rejects.toBe(reason);

		expect(commandRun).not.toHaveBeenCalled();
		expect(sandbox.uid).toBe(0);
		expect(sandbox.exit).toBe(true);
		expect(sandbox.pendingInput).toEqual(['queued\n']);
		expect(sandbox.pendingEof).toBe(true);
	});

	it('cancels a stalled Bash startup and frees its late instance before retrying', async () => {
		let resolveCommand!: (instance: unknown) => void;
		const pendingCommand = new Promise<unknown>((resolve) => {
			resolveCommand = resolve;
		});
		commandRun.mockReturnValueOnce(pendingCommand);
		const lateFree = vi.fn();
		const lateGetWriter = vi.fn();
		const lateWait = vi.fn(async () => ({ ok: true, code: 0 }));
		const lateInstance = {
			stdin: { getWriter: lateGetWriter },
			stdout: byteStream('late stdout\n'),
			stderr: byteStream('late stderr\n'),
			wait: lateWait,
			free: lateFree
		};
		const retryFree = vi.fn();
		commandRun.mockResolvedValueOnce({
			stdin: undefined,
			stdout: byteStream('retry\n'),
			stderr: byteStream(''),
			wait: vi.fn(async () => ({ ok: true, code: 0 })),
			free: retryFree
		});
		const sandbox = new Bash();
		const output: string[] = [];
		sandbox.output = (chunk) => output.push(chunk);
		await sandbox.load();
		const controller = new AbortController();
		const reason = new Error('stop stalled Bash startup');
		const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
		const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
		const running = sandbox.run('sleep forever', false, true, undefined, [], {
			signal: controller.signal
		});

		try {
			await vi.waitFor(() => expect(commandRun).toHaveBeenCalledOnce());
			controller.abort(reason);
			await expect(observeSettlement(running)).resolves.toEqual({
				status: 'rejected',
				reason
			});
			const abortRegistration = addEventListener.mock.calls.find(
				([type]) => type === 'abort'
			);
			expect(abortRegistration).toBeDefined();
			expect(removeEventListener).toHaveBeenCalledWith('abort', abortRegistration?.[1]);

			resolveCommand(lateInstance);
			await vi.waitFor(() => expect(lateFree).toHaveBeenCalledOnce());
			expect(lateGetWriter).not.toHaveBeenCalled();
			expect(lateWait).not.toHaveBeenCalled();
			await expect(sandbox.run('printf retry', false)).resolves.toBe(true);
			expect(output).toEqual(['retry\n']);
			expect(retryFree).not.toHaveBeenCalled();
		} finally {
			resolveCommand(lateInstance);
			await running.catch(() => {});
		}
	});

	it('cleans a Bash instance when cancellation occurs during stdin writer acquisition', async () => {
		const controller = new AbortController();
		const reason = new Error('stop while acquiring Bash stdin');
		const writerAbort = vi.fn(async () => {});
		const writer = {
			write: vi.fn(async () => {}),
			close: vi.fn(async () => {}),
			abort: writerAbort
		};
		const wait = vi.fn(async () => ({ ok: true, code: 0 }));
		const free = vi.fn();
		commandRun.mockResolvedValueOnce({
			stdin: {
				getWriter() {
					controller.abort(reason);
					return writer;
				}
			},
			stdout: byteStream(''),
			stderr: byteStream(''),
			wait,
			free
		});
		const sandbox = new Bash();
		await sandbox.load();

		await expect(
			sandbox.run('read value', false, true, undefined, [], {
				signal: controller.signal
			})
		).rejects.toBe(reason);
		await vi.waitFor(() => expect(free).toHaveBeenCalledOnce());
		expect(writerAbort).toHaveBeenCalledOnce();
		expect(writerAbort).toHaveBeenCalledWith(reason);
		expect(wait).not.toHaveBeenCalled();
		expect(sandbox.stdinWriter).toBeNull();
		expect(sandbox.instance).toBeNull();
	});

	it.each(['pending', 'throw', 'reject'] as const)(
		'preserves caller cancellation while %s Bash cleanup is uncooperative',
		async (cleanupMode) => {
			let resolveWait!: (result: { ok: boolean; code: number }) => void;
			const pendingWait = new Promise<{ ok: boolean; code: number }>((resolve) => {
				resolveWait = resolve;
			});
			let resolveAbort!: () => void;
			const pendingAbort = new Promise<void>((resolve) => {
				resolveAbort = resolve;
			});
			const writerAbort = vi.fn((reason?: unknown) => {
				void reason;
				if (cleanupMode === 'throw') throw new Error('stdin cleanup threw');
				if (cleanupMode === 'reject') {
					return Promise.reject(new Error('stdin cleanup rejected'));
				}
				return pendingAbort;
			});
			const writer = {
				write: vi.fn(async () => {}),
				close: vi.fn(async () => {}),
				abort: writerAbort
			};
			const wait = vi.fn(() => pendingWait);
			const free = vi.fn(() => {
				if (cleanupMode === 'throw') throw new Error('instance cleanup threw');
			});
			commandRun.mockResolvedValueOnce({
				stdin: { getWriter: () => writer },
				stdout: byteStream(''),
				stderr: byteStream(''),
				wait,
				free
			});
			const sandbox = new Bash();
			await sandbox.load();
			const controller = new AbortController();
			const reason = new Error(`stop Bash with ${cleanupMode} cleanup`);
			const running = sandbox.run('read value', false, true, undefined, [], {
				signal: controller.signal
			});

			try {
				await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());
				controller.abort(reason);
				await expect(observeSettlement(running)).resolves.toEqual({
					status: 'rejected',
					reason
				});
				expect(writerAbort).toHaveBeenCalledOnce();
				expect(writerAbort).toHaveBeenCalledWith(reason);
				expect(free).toHaveBeenCalledOnce();
				expect(sandbox.activeReject).toBeNull();
				expect(sandbox.activeRunCleanup).toBeNull();
				expect(sandbox.stdinWriter).toBeNull();
				expect(sandbox.instance).toBeNull();
				expect(sandbox.exit).toBe(true);
			} finally {
				resolveAbort();
				resolveWait({ ok: true, code: 0 });
				await running.catch(() => {});
			}
		}
	);

	it.each(['write', 'close'] as const)(
		'consumes a cancelled background stdin %s failure before retrying',
		async (operation) => {
			let markIoStarted!: () => void;
			const ioStarted = new Promise<void>((resolve) => {
				markIoStarted = resolve;
			});
			let rejectIo!: (reason: unknown) => void;
			const pendingIo = new Promise<void>((_resolve, reject) => {
				rejectIo = reject;
			});
			const write = vi.fn(() => {
				if (operation !== 'write') return Promise.resolve();
				markIoStarted();
				return pendingIo;
			});
			const close = vi.fn(() => {
				if (operation !== 'close') return Promise.resolve();
				markIoStarted();
				return pendingIo;
			});
			const writerAbort = vi.fn(async (reason?: unknown) => {
				rejectIo(reason);
			});
			let resolveWait!: (result: { ok: boolean; code: number }) => void;
			const wait = vi.fn(
				() =>
					new Promise<{ ok: boolean; code: number }>((resolve) => {
						resolveWait = resolve;
					})
			);
			commandRun.mockResolvedValueOnce({
				stdin: { getWriter: () => ({ write, close, abort: writerAbort }) },
				stdout: byteStream(''),
				stderr: byteStream(''),
				wait,
				free: vi.fn()
			});
			commandRun.mockResolvedValueOnce({
				stdin: undefined,
				stdout: byteStream('retry after stdin cancellation\n'),
				stderr: byteStream(''),
				wait: vi.fn(async () => ({ ok: true, code: 0 })),
				free: vi.fn()
			});
			const sandbox = new Bash();
			const output: string[] = [];
			sandbox.output = (chunk) => output.push(chunk);
			await sandbox.load();
			const controller = new AbortController();
			const reason = new Error(`cancel pending Bash stdin ${operation}`);
			const running = sandbox.run('read value', false, true, undefined, [], {
				signal: controller.signal
			});

			try {
				await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());
				if (operation === 'write') sandbox.write('pending\n');
				else sandbox.eof();
				await ioStarted;
				controller.abort(reason);
				await expect(observeSettlement(running)).resolves.toEqual({
					status: 'rejected',
					reason
				});
				expect(writerAbort).toHaveBeenCalledWith(reason);
				await Promise.resolve();
				await Promise.resolve();
				await expect(sandbox.run('printf retry', false)).resolves.toBe(true);
				expect(output).toEqual(['retry after stdin cancellation\n']);
			} finally {
				rejectIo(reason);
				resolveWait({ ok: true, code: 0 });
				await running.catch(() => {});
			}
		}
	);

	it('ignores stale output after cancellation and removes the signal listener after retry', async () => {
		let stdoutController!: ReadableStreamDefaultController<Uint8Array>;
		let stderrController!: ReadableStreamDefaultController<Uint8Array>;
		const oldStdout = new ReadableStream<Uint8Array>({
			start(controller) {
				stdoutController = controller;
			}
		});
		const oldStderr = new ReadableStream<Uint8Array>({
			start(controller) {
				stderrController = controller;
			}
		});
		let resolveOldWait!: (result: { ok: boolean; code: number }) => void;
		const oldWait = vi.fn(
			() =>
				new Promise<{ ok: boolean; code: number }>((resolve) => {
					resolveOldWait = resolve;
				})
		);
		const oldFree = vi.fn();
		const oldWriterAbort = vi.fn(async () => {});
		commandRun.mockResolvedValueOnce({
			stdin: {
				getWriter: () => ({
					write: vi.fn(async () => {}),
					close: vi.fn(async () => {}),
					abort: oldWriterAbort
				})
			},
			stdout: oldStdout,
			stderr: oldStderr,
			wait: oldWait,
			free: oldFree
		});
		const retryFree = vi.fn();
		commandRun.mockResolvedValueOnce({
			stdin: undefined,
			stdout: byteStream('retry only\n'),
			stderr: byteStream(''),
			wait: vi.fn(async () => ({ ok: true, code: 0 })),
			free: retryFree
		});
		const sandbox = new Bash();
		const output: string[] = [];
		sandbox.output = (chunk) => output.push(chunk);
		await sandbox.load();
		const oldController = new AbortController();
		const oldReason = new Error('replace stalled Bash wait');
		let oldStreamsClosed = false;
		const oldRunning = sandbox.run('read old', false, true, undefined, [], {
			signal: oldController.signal
		});

		try {
			await vi.waitFor(() => expect(oldWait).toHaveBeenCalledOnce());
			oldController.abort(oldReason);
			await expect(oldRunning).rejects.toBe(oldReason);

			const retryController = new AbortController();
			await expect(
				sandbox.run('printf retry', false, true, undefined, [], {
					signal: retryController.signal
				})
			).resolves.toBe(true);
			const settledUid = sandbox.uid;
			retryController.abort(new Error('late retry abort'));
			expect(sandbox.uid).toBe(settledUid);
			expect(retryFree).not.toHaveBeenCalled();

			stdoutController.enqueue(new TextEncoder().encode('stale stdout\n'));
			stderrController.enqueue(new TextEncoder().encode('stale stderr\n'));
			stdoutController.close();
			stderrController.close();
			oldStreamsClosed = true;
			resolveOldWait({ ok: true, code: 0 });
			await vi.waitFor(() => expect(oldFree).toHaveBeenCalledOnce());
			expect(oldWriterAbort).toHaveBeenCalledWith(oldReason);
			expect(output).toEqual(['retry only\n']);
		} finally {
			if (!oldStreamsClosed) {
				stdoutController.close();
				stderrController.close();
			}
			resolveOldWait({ ok: true, code: 0 });
			await oldRunning.catch(() => {});
		}
	});

	it('connects write and eof to a running Bash stdin stream', async () => {
		const writes: Uint8Array[] = [];
		const close = vi.fn(async () => {});
		let finish: ((value: { ok: boolean; code: number }) => void) | undefined;
		const finished = new Promise<{ ok: boolean; code: number }>((resolve) => {
			finish = resolve;
		});
		const writer = {
			write: vi.fn(async (chunk: Uint8Array) => writes.push(chunk)),
			close,
			abort: vi.fn(async () => {})
		};
		commandRun.mockResolvedValue({
			stdin: { getWriter: () => writer },
			stdout: byteStream('typed\n'),
			stderr: byteStream(''),
			wait: vi.fn(() => finished),
			free: vi.fn()
		});
		const sandbox = new Bash();
		await sandbox.load();

		const running = sandbox.run('read value; printf "%s\\n" "$value"', false);
		await vi.waitFor(() => expect(commandRun).toHaveBeenCalledOnce());
		sandbox.write('typed\n');
		sandbox.eof();
		await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
		finish?.({ ok: true, code: 0 });
		await expect(running).resolves.toBe(true);

		expect(writes.map((chunk) => new TextDecoder().decode(chunk))).toEqual(['typed\n']);
		expect(close).toHaveBeenCalledOnce();
		expect(commandRun).toHaveBeenCalledWith(
			expect.objectContaining({
				mount: { '/workspace': { 'main.sh': 'read value; printf "%s\\n" "$value"' } },
				cwd: '/workspace'
			})
		);
		expect(commandRun.mock.calls[0]?.[0]).not.toHaveProperty('stdin');
	});

	it('mounts workspace files next to the active Bash script', async () => {
		commandRun.mockResolvedValue({
			stdin: undefined,
			stdout: byteStream('helper\n'),
			stderr: byteStream(''),
			wait: vi.fn(async () => ({ ok: true, code: 0 })),
			free: vi.fn()
		});
		const sandbox = new Bash();
		await sandbox.load();

		await sandbox.run('source lib/helper.sh; helper', false, true, undefined, [], {
			activePath: 'scripts/main.sh',
			workspaceFiles: [{ path: 'lib/helper.sh', content: 'helper() { printf "helper\\n"; }' }]
		});

		expect(commandRun).toHaveBeenCalledWith(
			expect.objectContaining({
				mount: {
					'/workspace': {
						'lib/helper.sh': 'helper() { printf "helper\\n"; }',
						'scripts/main.sh': 'source lib/helper.sh; helper'
					}
				}
			})
		);
	});

	it('reports a non-zero Bash exit status after forwarding stderr', async () => {
		commandRun.mockResolvedValue({
			stdin: undefined,
			stdout: byteStream(''),
			stderr: byteStream('main.sh: syntax error\n'),
			wait: vi.fn(async () => ({ ok: false, code: 2 })),
			free: vi.fn()
		});
		const sandbox = new Bash();
		const output: string[] = [];
		sandbox.output = (chunk) => output.push(chunk);
		await sandbox.load();

		await expect(sandbox.run('if', false)).rejects.toBe('Bash exited with status 2.');
		expect(output.join('')).toContain('syntax error');
	});
});
