import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { commandFree, commandRun, fromFile, importRuntimeModule, init, packageFree } = vi.hoisted(
	() => ({
		commandFree: vi.fn(),
		commandRun: vi.fn(),
		fromFile: vi.fn(),
		importRuntimeModule: vi.fn(),
		init: vi.fn(async () => {}),
		packageFree: vi.fn()
	})
);

vi.mock('$lib/playground/runtimeModule', () => ({ importRuntimeModule }));

import Bash from './bash';

const byteStream = (text: string) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			if (text) controller.enqueue(new TextEncoder().encode(text));
			controller.close();
		}
	});

describe('Bash execution output limits', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		init.mockResolvedValue(undefined);
		importRuntimeModule.mockResolvedValue({ init, Wasmer: { fromFile } });
		fromFile.mockResolvedValue({
			entrypoint: { run: commandRun, free: commandFree },
			free: packageFree
		});
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(new Uint8Array([0, 97, 115, 109])))
		);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('shares one UTF-8 byte quota across stdout and stderr before cleanup reentry', async () => {
		let stdoutController: ReadableStreamDefaultController<Uint8Array> | undefined;
		let stderrController: ReadableStreamDefaultController<Uint8Array> | undefined;
		let resolveWait: ((value: { ok: boolean; code: number }) => void) | undefined;
		const stdoutCancel = vi.fn();
		const stderrCancel = vi.fn();
		const wait = vi.fn(
			() =>
				new Promise<{ ok: boolean; code: number }>((resolve) => {
					resolveWait = resolve;
				})
		);
		commandRun
			.mockResolvedValueOnce({
				stdin: undefined,
				stdout: new ReadableStream<Uint8Array>({
					start(controller) {
						stdoutController = controller;
					},
					cancel: stdoutCancel
				}),
				stderr: new ReadableStream<Uint8Array>({
					start(controller) {
						stderrController = controller;
					},
					cancel: stderrCancel
				}),
				wait,
				free: vi.fn()
			})
			.mockResolvedValueOnce({
				stdin: undefined,
				stdout: byteStream('retry\n'),
				stderr: byteStream(''),
				wait: vi.fn(async () => ({ ok: true, code: 0 })),
				free: vi.fn()
			});
		const sandbox = new Bash();
		const output = vi.fn();
		sandbox.output = output;
		await sandbox.load('/assets');
		let replacement: Promise<boolean | string> | undefined;
		let listenerRemovals = 0;
		const signal = {
			aborted: false,
			reason: undefined,
			addEventListener: vi.fn(),
			removeEventListener() {
				listenerRemovals += 1;
				if (listenerRemovals === 2) replacement = sandbox.run('printf retry', false);
			}
		} as unknown as AbortSignal;
		const running = sandbox.run('printf bounded', false, true, undefined, [], {
			signal,
			stdin: 'fixed input\n',
			limits: { maxOutputBytes: 5 }
		});
		sandbox.write('discard after quota failure\n');
		sandbox.eof();
		await vi.waitFor(() => expect(wait).toHaveBeenCalledOnce());

		stdoutController?.enqueue(new TextEncoder().encode('abc'));
		await vi.waitFor(() => expect(output).toHaveBeenCalledWith('abc'));
		stderrController?.enqueue(new TextEncoder().encode('éé'));
		const limitError = await running.catch((error) => error);

		expect(limitError).toMatchObject({
			name: 'OutputLimitError',
			code: 'output-limit',
			phase: 'execute',
			runtimeId: 'BASH',
			actual: 7,
			limit: 5
		});
		expect(output).not.toHaveBeenCalledWith('éé');
		await vi.waitFor(() => expect(stdoutCancel).toHaveBeenCalledWith(limitError));
		await vi.waitFor(() => expect(stderrCancel).toHaveBeenCalledWith(limitError));
		expect(sandbox.pendingInput).toEqual([]);
		expect(sandbox.pendingEof).toBe(false);

		resolveWait?.({ ok: true, code: 0 });
		await expect(replacement).resolves.toBe(true);
		expect(output).toHaveBeenCalledWith('retry\n');
		expect(commandRun).toHaveBeenCalledTimes(2);
	});
});
